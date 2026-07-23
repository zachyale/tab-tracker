import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// better-auth tables (field shapes required by the drizzle adapter)
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("user"),
  // Ghost members: manager-created placeholders that can't log in. Their email
  // is a synthetic @ghost.invalid address; claimEmail is the real person's
  // email, matched on signup to hand the tab over.
  isGhost: integer("is_ghost", { mode: "boolean" }).notNull().default(false),
  claimEmail: text("claim_email"),
  ghostAccountId: text("ghost_account_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

// ---------------------------------------------------------------------------
// Application tables. "tab account" = a ledger (e.g. "Home"), distinct from
// better-auth's `account` table (OAuth account links).
// ---------------------------------------------------------------------------

export const tabAccounts = sqliteTable("tab_account", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("USD"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const accountManagers = sqliteTable(
  "account_manager",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => tabAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] })]
);

export const options = sqliteTable(
  "option",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tabAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // null = unpriced (track quantity only)
    priceCents: integer("price_cents"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("option_account_idx").on(t.accountId)]
);

// Append-only ledger. kind:
//   drink   — one unit consumed; amountCents = unit price at that moment (null if unpriced)
//   undo    — reverses one specific drink entry; amountCents copied from it
//   payment — money received against the balance; amountCents = payment amount
//   charge  — arbitrary amount added to the balance (backfill, breakage, etc.)
export const entries = sqliteTable(
  "entry",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tabAccounts.id, { onDelete: "cascade" }),
    // whose tab this affects
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // who performed the action (differs from userId for manager adjustments)
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind", { enum: ["drink", "undo", "payment", "charge"] }).notNull(),
    optionId: text("option_id").references(() => options.id),
    amountCents: integer("amount_cents"),
    note: text("note"),
    reversesEntryId: text("reverses_entry_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("entry_account_idx").on(t.accountId),
    index("entry_account_user_idx").on(t.accountId, t.userId),
  ]
);
