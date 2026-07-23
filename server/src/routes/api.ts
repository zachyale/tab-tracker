import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { getSessionUser, type SessionUser } from "../auth.js";
import { env, googleEnabled, oidcEnabled, smtpEnabled } from "../env.js";
import {
  accountTotals,
  balanceForUser,
  latestUndoableConsume,
  quantitiesForUser,
} from "../lib/ledger.js";
import {
  getInstanceNotificationSettings,
  getUserNotificationPref,
  notifyIfCrossed,
  setInstanceNotificationSettings,
  setUserNotificationPref,
} from "../lib/notifications.js";

type TabAccount = typeof schema.tabAccounts.$inferSelect;

type Vars = {
  user: SessionUser | null;
  account: TabAccount;
  isManager: boolean;
};

const api = new Hono<{ Variables: Vars }>();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(["new", "api", "assets", "login", "signup", "admin"]);

// Decimal (cent-based) currencies only — the ledger stores integer cents.
export const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK"] as const;
const DEFAULT_CURRENCY = "CAD";

function now(): Date {
  return new Date();
}

function isAccountManager(account: TabAccount, userId: string): boolean {
  if (account.ownerId === userId) return true;
  const row = db
    .select()
    .from(schema.accountManagers)
    .where(
      and(
        eq(schema.accountManagers.accountId, account.id),
        eq(schema.accountManagers.userId, userId)
      )
    )
    .get();
  return !!row;
}

// Attach the session user (null when logged out) to every request.
api.use("*", async (c, next) => {
  c.set("user", await getSessionUser(c.req.raw.headers));
  await next();
});

type Ctx = Context<{ Variables: Vars }>;

function requireUser(c: Ctx): SessionUser {
  const user = c.get("user");
  if (!user) throw new AuthError(401, "Login required");
  return user;
}

class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string
  ) {
    super(message);
  }
}

api.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) {
    return c.json({ error: err.issues[0]?.message ?? "Invalid request" }, 400);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

api.get("/config", (c) =>
  c.json({
    instanceName: env.instanceName,
    google: googleEnabled,
    oidc: oidcEnabled ? { name: env.oidc.name } : null,
    smtp: smtpEnabled,
    defaultAuthMethod: env.defaultAuthMethod,
    currencies: CURRENCIES,
    defaultCurrency: DEFAULT_CURRENCY,
  })
);

api.get("/me", (c) => c.json({ user: c.get("user") }));

// ---------------------------------------------------------------------------
// Notification settings: instance defaults (admin-managed) + per-user prefs
// ---------------------------------------------------------------------------

const triggersSchema = z
  .array(z.number().int().positive("Trigger amounts must be positive"))
  .max(20, "Too many trigger amounts")
  .transform((arr) => [...new Set(arr)].sort((a, b) => a - b));

api.get("/notification-settings", (c) => {
  const user = requireUser(c);
  return c.json({
    smtpEnabled,
    instance: getInstanceNotificationSettings(),
    mine: getUserNotificationPref(user.id),
  });
});

api.put("/notification-settings", async (c) => {
  const user = requireUser(c);
  const body = z
    .object({ enabled: z.boolean(), triggersCents: triggersSchema.nullable() })
    .parse(await c.req.json());
  setUserNotificationPref(user.id, body);
  return c.json({ mine: getUserNotificationPref(user.id) });
});

api.put("/admin/notification-settings", async (c) => {
  requireAdmin(c);
  const body = z
    .object({ enabled: z.boolean(), triggersCents: triggersSchema })
    .parse(await c.req.json());
  setInstanceNotificationSettings(body);
  return c.json({ instance: getInstanceNotificationSettings() });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

api.get("/dashboard", (c) => {
  const user = requireUser(c);

  const owedAccountIds = db
    .all<{ accountId: string }>(
      dsql`SELECT DISTINCT account_id AS accountId FROM entry WHERE user_id = ${user.id}`
    )
    .map((r) => r.accountId);

  const owed = owedAccountIds
    .map((id) => {
      const account = db
        .select()
        .from(schema.tabAccounts)
        .where(eq(schema.tabAccounts.id, id))
        .get();
      if (!account) return null;
      const balance = balanceForUser(id, user.id);
      return {
        id: account.id,
        name: account.name,
        slug: account.slug,
        currency: account.currency,
        ...balance,
      };
    })
    .filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => b.balanceCents - a.balanceCents);

  const managedRows = db.all<{ id: string }>(dsql`
    SELECT id FROM tab_account WHERE owner_id = ${user.id}
    UNION
    SELECT account_id FROM account_manager WHERE user_id = ${user.id}
  `);
  const managed = managedRows.map(({ id }) => {
    const account = db
      .select()
      .from(schema.tabAccounts)
      .where(eq(schema.tabAccounts.id, id))
      .get()!;
    const totals = accountTotals(id);
    return {
      id: account.id,
      name: account.name,
      slug: account.slug,
      currency: account.currency,
      isOwner: account.ownerId === user.id,
      outstandingCents: totals.balanceCents,
      unpricedCount: totals.unpricedCount,
      memberCount: totals.memberCount,
    };
  });

  return c.json({ owed, managed });
});

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

const accountBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(1000).default(""),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, "Slug must be 2-50 chars: lowercase letters, numbers, hyphens")
    .refine((s) => !RESERVED_SLUGS.has(s), "That slug is reserved"),
  currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
});

api.post("/accounts", async (c) => {
  const user = requireUser(c);
  const body = accountBodySchema.parse(await c.req.json());

  const existing = db
    .select()
    .from(schema.tabAccounts)
    .where(eq(schema.tabAccounts.slug, body.slug))
    .get();
  if (existing) return c.json({ error: "That URL slug is already taken" }, 409);

  const id = nanoid();
  db.insert(schema.tabAccounts)
    .values({ id, ...body, ownerId: user.id, createdAt: now() })
    .run();
  return c.json({ id, slug: body.slug }, 201);
});

// Load account + role for all /accounts/:slug/* routes.
api.use("/accounts/:slug/*", async (c, next) => {
  const account = db
    .select()
    .from(schema.tabAccounts)
    .where(eq(schema.tabAccounts.slug, c.req.param("slug")))
    .get();
  if (!account) return c.json({ error: "Account not found" }, 404);
  const user = c.get("user");
  c.set("account", account);
  c.set("isManager", user ? isAccountManager(account, user.id) : false);
  await next();
});
api.use("/accounts/:slug", async (c, next) => {
  const account = db
    .select()
    .from(schema.tabAccounts)
    .where(eq(schema.tabAccounts.slug, c.req.param("slug")))
    .get();
  if (!account) return c.json({ error: "Account not found" }, 404);
  const user = c.get("user");
  c.set("account", account);
  c.set("isManager", user ? isAccountManager(account, user.id) : false);
  await next();
});

function requireManager(c: Ctx): SessionUser {
  const user = requireUser(c);
  if (!c.get("isManager")) throw new AuthError(403, "Manager access required");
  return user;
}

function requireOwner(c: Ctx): SessionUser {
  const user = requireUser(c);
  if (c.get("account").ownerId !== user.id) throw new AuthError(403, "Owner access required");
  return user;
}

function requireAdmin(c: Ctx): SessionUser {
  const user = requireUser(c);
  if (user.role !== "admin") throw new AuthError(403, "Instance admin access required");
  return user;
}

// Public account page. Includes the viewer's tab when logged in.
api.get("/accounts/:slug", (c) => {
  const account = c.get("account");
  const user = c.get("user");

  const activeOptions = db
    .select()
    .from(schema.options)
    .where(and(eq(schema.options.accountId, account.id), eq(schema.options.archived, false)))
    .orderBy(schema.options.createdAt)
    .all();

  const mine = user
    ? {
        quantities: quantitiesForUser(account.id, user.id),
        ...balanceForUser(account.id, user.id),
      }
    : null;

  return c.json({
    account: {
      id: account.id,
      name: account.name,
      description: account.description,
      slug: account.slug,
      currency: account.currency,
    },
    options: activeOptions.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      priceCents: o.priceCents,
    })),
    isManager: c.get("isManager"),
    isOwner: !!user && account.ownerId === user.id,
    mine,
  });
});

api.patch("/accounts/:slug", async (c) => {
  requireManager(c);
  const account = c.get("account");
  const body = accountBodySchema.partial().parse(await c.req.json());

  if (body.slug && body.slug !== account.slug) {
    const taken = db
      .select()
      .from(schema.tabAccounts)
      .where(eq(schema.tabAccounts.slug, body.slug))
      .get();
    if (taken) return c.json({ error: "That URL slug is already taken" }, 409);
  }

  db.update(schema.tabAccounts)
    .set(body)
    .where(eq(schema.tabAccounts.id, account.id))
    .run();
  return c.json({ ok: true, slug: body.slug ?? account.slug });
});

api.delete("/accounts/:slug", (c) => {
  requireOwner(c);
  const account = c.get("account");
  // entries/options/managers cascade via foreign keys
  db.delete(schema.tabAccounts).where(eq(schema.tabAccounts.id, account.id)).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Managers
// ---------------------------------------------------------------------------

api.get("/accounts/:slug/managers", (c) => {
  requireManager(c);
  const account = c.get("account");
  const rows = db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.accountManagers)
    .innerJoin(schema.user, eq(schema.accountManagers.userId, schema.user.id))
    .where(eq(schema.accountManagers.accountId, account.id))
    .all();
  const owner = db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, account.ownerId))
    .get();
  return c.json({ owner, managers: rows });
});

api.post("/accounts/:slug/managers", async (c) => {
  requireOwner(c);
  const account = c.get("account");
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(
    await c.req.json()
  );
  const target = db.select().from(schema.user).where(eq(schema.user.email, email)).get();
  if (!target) return c.json({ error: "No user with that email on this instance" }, 404);
  if (target.id === account.ownerId)
    return c.json({ error: "That user is already the owner" }, 409);
  db.insert(schema.accountManagers)
    .values({ accountId: account.id, userId: target.id, createdAt: now() })
    .onConflictDoNothing()
    .run();
  return c.json({ ok: true }, 201);
});

api.delete("/accounts/:slug/managers/:userId", (c) => {
  requireOwner(c);
  const account = c.get("account");
  db.delete(schema.accountManagers)
    .where(
      and(
        eq(schema.accountManagers.accountId, account.id),
        eq(schema.accountManagers.userId, c.req.param("userId"))
      )
    )
    .run();
  return c.json({ ok: true });
});

api.post("/accounts/:slug/transfer", async (c) => {
  requireOwner(c);
  const account = c.get("account");
  const { userId } = z.object({ userId: z.string() }).parse(await c.req.json());
  const target = db.select().from(schema.user).where(eq(schema.user.id, userId)).get();
  if (!target) return c.json({ error: "User not found" }, 404);
  db.update(schema.tabAccounts)
    .set({ ownerId: userId })
    .where(eq(schema.tabAccounts.id, account.id))
    .run();
  // Keep the old owner on as a manager so they don't lose access unexpectedly.
  db.insert(schema.accountManagers)
    .values({ accountId: account.id, userId: account.ownerId, createdAt: now() })
    .onConflictDoNothing()
    .run();
  db.delete(schema.accountManagers)
    .where(
      and(
        eq(schema.accountManagers.accountId, account.id),
        eq(schema.accountManagers.userId, userId)
      )
    )
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const optionBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(1000).default(""),
  priceCents: z.number().int().min(0).nullable().default(null),
});

api.post("/accounts/:slug/options", async (c) => {
  requireManager(c);
  const account = c.get("account");
  const body = optionBodySchema.parse(await c.req.json());
  const id = nanoid();
  db.insert(schema.options)
    .values({ id, accountId: account.id, ...body, createdAt: now() })
    .run();
  return c.json({ id }, 201);
});

api.patch("/accounts/:slug/options/:optionId", async (c) => {
  requireManager(c);
  const account = c.get("account");
  const body = optionBodySchema
    .partial()
    .extend({ archived: z.boolean().optional() })
    .parse(await c.req.json());
  const option = db
    .select()
    .from(schema.options)
    .where(
      and(
        eq(schema.options.id, c.req.param("optionId")),
        eq(schema.options.accountId, account.id)
      )
    )
    .get();
  if (!option) return c.json({ error: "Option not found" }, 404);
  db.update(schema.options).set(body).where(eq(schema.options.id, option.id)).run();
  return c.json({ ok: true });
});

api.get("/accounts/:slug/options", (c) => {
  requireManager(c);
  const account = c.get("account");
  const all = db
    .select()
    .from(schema.options)
    .where(eq(schema.options.accountId, account.id))
    .orderBy(schema.options.createdAt)
    .all();
  return c.json({ options: all });
});

// ---------------------------------------------------------------------------
// Ledger: consumption, undos, payments
// ---------------------------------------------------------------------------

api.post("/accounts/:slug/entries", async (c) => {
  const me = requireUser(c);
  const account = c.get("account");
  const body = z
    .object({
      optionId: z.string(),
      action: z.enum(["increment", "decrement"]),
      userId: z.string().optional(),
    })
    .parse(await c.req.json());

  const targetUserId = body.userId ?? me.id;
  if (targetUserId !== me.id && !c.get("isManager"))
    throw new AuthError(403, "Only managers can adjust someone else's tab");

  const option = db
    .select()
    .from(schema.options)
    .where(
      and(eq(schema.options.id, body.optionId), eq(schema.options.accountId, account.id))
    )
    .get();
  if (!option) return c.json({ error: "Option not found" }, 404);
  if (option.archived && body.action === "increment")
    return c.json({ error: "That option has been archived" }, 409);

  const preBalance = balanceForUser(account.id, targetUserId).balanceCents;

  if (body.action === "increment") {
    db.insert(schema.entries)
      .values({
        id: nanoid(),
        accountId: account.id,
        userId: targetUserId,
        actorId: me.id,
        kind: "consume",
        optionId: option.id,
        amountCents: option.priceCents,
        createdAt: now(),
      })
      .run();
    notifyIfCrossed(
      account.id,
      targetUserId,
      preBalance,
      balanceForUser(account.id, targetUserId).balanceCents
    );
  } else {
    const consume = latestUndoableConsume(account.id, targetUserId, option.id);
    if (!consume) return c.json({ error: "Nothing to undo for this option" }, 409);
    db.insert(schema.entries)
      .values({
        id: nanoid(),
        accountId: account.id,
        userId: targetUserId,
        actorId: me.id,
        kind: "undo",
        optionId: option.id,
        amountCents: consume.amountCents,
        reversesEntryId: consume.id,
        createdAt: now(),
      })
      .run();
  }

  return c.json({
    quantities: quantitiesForUser(account.id, targetUserId),
    ...balanceForUser(account.id, targetUserId),
  });
});

api.post("/accounts/:slug/payments", async (c) => {
  const me = requireManager(c);
  const account = c.get("account");
  const body = z
    .object({
      userId: z.string(),
      amountCents: z.number().int().positive("Payment must be a positive amount"),
      note: z.string().trim().max(500).optional(),
      allowNegative: z.boolean().optional(),
    })
    .parse(await c.req.json());

  const current = balanceForUser(account.id, body.userId);
  if (body.amountCents > current.balanceCents && !body.allowNegative) {
    return c.json(
      {
        error: "Payment exceeds current balance; this would leave the member in credit",
        balanceCents: current.balanceCents,
        requiresConfirmation: true,
      },
      409
    );
  }

  db.insert(schema.entries)
    .values({
      id: nanoid(),
      accountId: account.id,
      userId: body.userId,
      actorId: me.id,
      kind: "payment",
      amountCents: body.amountCents,
      note: body.note,
      createdAt: now(),
    })
    .run();

  return c.json(balanceForUser(account.id, body.userId));
});

api.post("/accounts/:slug/charges", async (c) => {
  const me = requireManager(c);
  const account = c.get("account");
  const body = z
    .object({
      userId: z.string(),
      amountCents: z.number().int().positive("Charge must be a positive amount"),
      note: z.string().trim().max(500).optional(),
    })
    .parse(await c.req.json());

  const preBalance = balanceForUser(account.id, body.userId).balanceCents;
  db.insert(schema.entries)
    .values({
      id: nanoid(),
      accountId: account.id,
      userId: body.userId,
      actorId: me.id,
      kind: "charge",
      amountCents: body.amountCents,
      note: body.note,
      createdAt: now(),
    })
    .run();

  const post = balanceForUser(account.id, body.userId);
  notifyIfCrossed(account.id, body.userId, preBalance, post.balanceCents);
  return c.json(post);
});

// ---------------------------------------------------------------------------
// Ghost members: placeholders for people who haven't registered yet. Their
// tab is claimed automatically when someone signs up with the claim email.
// ---------------------------------------------------------------------------

const ghostBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email().nullable().optional(),
});

function findGhost(accountId: string, userId: string) {
  return db
    .select()
    .from(schema.user)
    .where(
      and(
        eq(schema.user.id, userId),
        eq(schema.user.isGhost, true),
        eq(schema.user.ghostAccountId, accountId)
      )
    )
    .get();
}

api.post("/accounts/:slug/ghosts", async (c) => {
  requireManager(c);
  const account = c.get("account");
  const body = ghostBodySchema.parse(await c.req.json());

  if (body.email) {
    const existing = db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, body.email))
      .get();
    if (existing)
      return c.json(
        { error: "That email already has an account — adjust their tab directly" },
        409
      );
  }

  const id = nanoid();
  db.insert(schema.user)
    .values({
      id,
      name: body.name,
      email: `ghost-${id}@ghost.invalid`,
      emailVerified: false,
      role: "user",
      isGhost: true,
      claimEmail: body.email ?? null,
      ghostAccountId: account.id,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return c.json({ id }, 201);
});

api.patch("/accounts/:slug/ghosts/:userId", async (c) => {
  requireManager(c);
  const account = c.get("account");
  const ghost = findGhost(account.id, c.req.param("userId"));
  if (!ghost) return c.json({ error: "Ghost member not found" }, 404);
  const body = ghostBodySchema.partial().parse(await c.req.json());
  db.update(schema.user)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.email !== undefined ? { claimEmail: body.email } : {}),
      updatedAt: now(),
    })
    .where(eq(schema.user.id, ghost.id))
    .run();
  return c.json({ ok: true });
});

// Manually merge a ghost's tab into an existing registered user — for when
// automatic claiming can't work (e.g. they signed up via OAuth with a
// different email than the manager expected).
api.post("/accounts/:slug/ghosts/:userId/link", async (c) => {
  requireManager(c);
  const account = c.get("account");
  const ghost = findGhost(account.id, c.req.param("userId"));
  if (!ghost) return c.json({ error: "Ghost member not found" }, 404);

  const { email } = z
    .object({ email: z.string().trim().toLowerCase().email() })
    .parse(await c.req.json());
  const target = db.select().from(schema.user).where(eq(schema.user.email, email)).get();
  if (!target) return c.json({ error: "No registered user with that email" }, 404);
  if (target.isGhost) return c.json({ error: "Cannot link one ghost to another" }, 409);

  db.update(schema.entries)
    .set({ userId: target.id })
    .where(eq(schema.entries.userId, ghost.id))
    .run();
  db.delete(schema.user).where(eq(schema.user.id, ghost.id)).run();
  return c.json({ ok: true, linkedTo: { id: target.id, name: target.name } });
});

api.delete("/accounts/:slug/ghosts/:userId", (c) => {
  requireManager(c);
  const account = c.get("account");
  const ghost = findGhost(account.id, c.req.param("userId"));
  if (!ghost) return c.json({ error: "Ghost member not found" }, 404);
  db.delete(schema.entries).where(eq(schema.entries.userId, ghost.id)).run();
  db.delete(schema.user).where(eq(schema.user.id, ghost.id)).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Members, activity, export
// ---------------------------------------------------------------------------

api.get("/accounts/:slug/members", (c) => {
  requireManager(c);
  const account = c.get("account");
  const memberRows = db.all<{ userId: string; lastActivity: number }>(dsql`
    SELECT user_id AS userId, MAX(created_at) AS lastActivity
    FROM entry WHERE account_id = ${account.id}
    GROUP BY user_id
  `);
  const lastActivity = new Map(memberRows.map((m) => [m.userId, m.lastActivity]));

  // Ghosts belong to the list even before any entries are recorded.
  const ghostRows = db
    .select()
    .from(schema.user)
    .where(and(eq(schema.user.isGhost, true), eq(schema.user.ghostAccountId, account.id)))
    .all();
  const memberIds = new Set([...lastActivity.keys(), ...ghostRows.map((g) => g.id)]);

  const members = [...memberIds]
    .map((userId) => {
      const u = db.select().from(schema.user).where(eq(schema.user.id, userId)).get();
      if (!u) return null;
      return {
        id: u.id,
        name: u.name,
        email: u.isGhost ? null : u.email,
        isGhost: u.isGhost,
        claimEmail: u.isGhost ? u.claimEmail : null,
        lastActivity: lastActivity.get(userId) ?? u.createdAt.getTime(),
        quantities: quantitiesForUser(account.id, userId),
        ...balanceForUser(account.id, userId),
      };
    })
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => b.balanceCents - a.balanceCents);
  return c.json({ members });
});

api.get("/accounts/:slug/activity", (c) => {
  const user = requireUser(c);
  const account = c.get("account");
  const mineOnly = c.req.query("mine") === "1" || !c.get("isManager");

  const rows = db
    .select({
      id: schema.entries.id,
      kind: schema.entries.kind,
      amountCents: schema.entries.amountCents,
      note: schema.entries.note,
      createdAt: schema.entries.createdAt,
      userId: schema.entries.userId,
      actorId: schema.entries.actorId,
      optionId: schema.entries.optionId,
    })
    .from(schema.entries)
    .where(
      mineOnly
        ? and(eq(schema.entries.accountId, account.id), eq(schema.entries.userId, user.id))
        : eq(schema.entries.accountId, account.id)
    )
    .orderBy(desc(schema.entries.createdAt))
    .limit(200)
    .all();

  const userNames = new Map<string, string>();
  const optionNames = new Map<string, string>();
  const lookupUser = (id: string) => {
    if (!userNames.has(id)) {
      const u = db.select().from(schema.user).where(eq(schema.user.id, id)).get();
      userNames.set(id, u?.name ?? "Unknown");
    }
    return userNames.get(id)!;
  };
  const lookupOption = (id: string | null) => {
    if (!id) return null;
    if (!optionNames.has(id)) {
      const o = db.select().from(schema.options).where(eq(schema.options.id, id)).get();
      optionNames.set(id, o?.name ?? "Unknown");
    }
    return optionNames.get(id)!;
  };

  return c.json({
    activity: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountCents: r.amountCents,
      note: r.note,
      createdAt: r.createdAt,
      userName: lookupUser(r.userId),
      actorName: lookupUser(r.actorId),
      byManager: r.actorId !== r.userId,
      optionName: lookupOption(r.optionId),
    })),
  });
});

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

api.get("/accounts/:slug/export.csv", (c) => {
  requireManager(c);
  const account = c.get("account");
  const rows = db.all<{
    createdAt: number;
    kind: string;
    userName: string;
    userEmail: string;
    actorName: string;
    optionName: string | null;
    amountCents: number | null;
    note: string | null;
  }>(dsql`
    SELECT e.created_at AS createdAt, e.kind,
           u.name AS userName, u.email AS userEmail,
           a.name AS actorName,
           o.name AS optionName,
           e.amount_cents AS amountCents, e.note
    FROM entry e
    JOIN user u ON u.id = e.user_id
    JOIN user a ON a.id = e.actor_id
    LEFT JOIN option o ON o.id = e.option_id
    WHERE e.account_id = ${account.id}
    ORDER BY e.created_at ASC
  `);

  const header = "timestamp,kind,user,email,actor,option,amount,currency,note";
  const lines = rows.map((r) =>
    [
      new Date(r.createdAt).toISOString(),
      r.kind,
      csvEscape(r.userName),
      csvEscape(r.userEmail),
      csvEscape(r.actorName),
      csvEscape(r.optionName ?? ""),
      r.amountCents == null ? "" : (r.amountCents / 100).toFixed(2),
      account.currency,
      csvEscape(r.note ?? ""),
    ].join(",")
  );

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${account.slug}-ledger.csv"`
  );
  return c.body([header, ...lines].join("\n"));
});

export { api };
