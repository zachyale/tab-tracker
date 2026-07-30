import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string } = {}
): Promise<{ status: number; json: Json; res: Response }> {
  const res = await app.request(path, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json, res };
}

const get = (path: string, cookie?: string) => call("GET", path, { cookie });
const post = (path: string, body: unknown, cookie?: string) =>
  call("POST", path, { body, cookie });
const patch = (path: string, body: unknown, cookie?: string) =>
  call("PATCH", path, { body, cookie });
const del = (path: string, cookie?: string) => call("DELETE", path, { cookie });

async function signup(name: string, email: string): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: "test-password-123" }),
  });
  expect(res.status).toBe(200);
  const cookies = res.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

// Session cookies for the cast. zach is the first user → instance admin and
// account owner; alice is a regular member; bob signs up later.
let zach: string;
let alice: string;

beforeAll(async () => {
  zach = await signup("Zach", "zach@example.com");
  alice = await signup("Alice", "alice@example.com");
});

// ---------------------------------------------------------------------------

describe("auth & instance", () => {
  it("serves instance config publicly", async () => {
    const { status, json } = await get("/api/config");
    expect(status).toBe(200);
    expect(json.instanceName).toBeTruthy();
    expect(json.defaultAuthMethod).toBe("password");
  });

  it("makes the first registered user the instance admin", async () => {
    expect((await get("/api/me", zach)).json.user.role).toBe("admin");
    expect((await get("/api/me", alice)).json.user.role).toBe("user");
  });

  it("returns a null user without a session", async () => {
    expect((await get("/api/me")).json.user).toBeNull();
  });
});

describe("accounts", () => {
  it("requires login to create an account", async () => {
    const { status } = await post("/api/accounts", validAccount());
    expect(status).toBe(401);
  });

  it("creates an account", async () => {
    const { status, json } = await post("/api/accounts", validAccount(), zach);
    expect(status).toBe(201);
    expect(json.slug).toBe("home");
  });

  it("rejects duplicate slugs", async () => {
    const { status } = await post("/api/accounts", validAccount(), zach);
    expect(status).toBe(409);
  });

  it("rejects invalid and reserved slugs", async () => {
    for (const slug of ["Bad Slug!", "-leading", "api", "new"]) {
      const { status } = await post("/api/accounts", { ...validAccount(), slug }, zach);
      expect(status, `slug: ${slug}`).toBe(400);
    }
  });

  it("shows the public page without a session, without tab data", async () => {
    const { status, json } = await get("/api/accounts/home");
    expect(status).toBe(200);
    expect(json.account.name).toBe("Home");
    expect(json.mine).toBeNull();
    expect(json.isManager).toBe(false);
  });

  it("404s unknown slugs", async () => {
    expect((await get("/api/accounts/nope")).status).toBe(404);
  });

  it("only managers can edit the account", async () => {
    expect((await patch("/api/accounts/home", { name: "X" }, alice)).status).toBe(403);
    const { status } = await patch("/api/accounts/home", { description: "The kitchen supply" }, zach);
    expect(status).toBe(200);
  });
});

// Item/option ids used across suites.
let brewItemId: string;
let brewId: string;
let sparklingItemId: string;
let unpricedId: string;

describe("items & options", () => {
  it("managers create items; non-managers cannot", async () => {
    expect(
      (await post("/api/accounts/home/items", { name: "Nope", options: [{}] }, alice)).status
    ).toBe(403);
    const brew = await post(
      "/api/accounts/home/items",
      { name: "Cold brew", options: [{ priceCents: 300 }] },
      zach
    );
    expect(brew.status).toBe(201);
    brewItemId = brew.json.id;
    const sparkling = await post(
      "/api/accounts/home/items",
      { name: "Sparkling water", options: [{}] },
      zach
    );
    sparklingItemId = sparkling.json.id;

    const { json } = await get("/api/accounts/home");
    brewId = json.items.find((i: Json) => i.name === "Cold brew").options[0].id;
    unpricedId = json.items.find((i: Json) => i.name === "Sparkling water").options[0].id;
    expect(brewId).toBeTruthy();
    expect(unpricedId).toBeTruthy();
  });

  it("lists active items publicly, with nested options", async () => {
    const { json } = await get("/api/accounts/home");
    expect(json.items.map((i: Json) => i.name).sort()).toEqual(["Cold brew", "Sparkling water"]);
    const brew = json.items.find((i: Json) => i.name === "Cold brew");
    expect(brew.options).toHaveLength(1);
    expect(brew.options[0].name).toBeNull();
    expect(brew.options[0].priceCents).toBe(300);
  });

  it("supports multi-option items (two items, two sizes)", async () => {
    const icedTea = await post(
      "/api/accounts/home/items",
      {
        name: "Iced tea",
        description: "Second tap",
        options: [
          { name: "Large", priceCents: 500 },
          { name: "Small", priceCents: 250 },
        ],
      },
      zach
    );
    expect(icedTea.status).toBe(201);
    const { json } = await get("/api/accounts/home");
    const item = json.items.find((i: Json) => i.name === "Iced tea");
    expect(item.options.map((o: Json) => o.name)).toEqual(["Large", "Small"]);
  });

  it("requires a name or price on every option once an item has several", async () => {
    // two anonymous options at creation
    const bad = await post(
      "/api/accounts/home/items",
      { name: "Bundle", options: [{ priceCents: 100 }, {}] },
      zach
    );
    expect(bad.status).toBe(400);

    // adding a sibling when the existing sole option has no name and no price
    const add = await post(
      `/api/accounts/home/items/${sparklingItemId}/options`,
      { name: "Small", priceCents: 150 },
      zach
    );
    expect(add.status).toBe(400);

    // fine when the existing sole option has a price (it stays identifiable)
    const ok = await post(
      `/api/accounts/home/items/${brewItemId}/options`,
      { name: "Small", priceCents: 150 },
      zach
    );
    expect(ok.status).toBe(201);

    // stripping name+price from an option that has siblings
    const { json } = await get("/api/accounts/home");
    const icedTeaFull = json.items
      .find((i: Json) => i.name === "Iced tea")
      .options.find((o: Json) => o.name === "Large");
    const strip = await patch(
      `/api/accounts/home/options/${icedTeaFull.id}`,
      { name: null, priceCents: null },
      zach
    );
    expect(strip.status).toBe(400);
  });

  it("refuses to archive an item's last active option", async () => {
    const { status, json } = await patch(
      `/api/accounts/home/options/${unpricedId}`,
      { archived: true },
      zach
    );
    expect(status).toBe(409);
    expect(json.error).toContain("archive the item");
  });

  it("managers reorder items; order is reflected everywhere", async () => {
    const items = (await get("/api/accounts/home/items", zach)).json.items;
    const ids = items.map((i: Json) => i.id);
    const reversed = [...ids].reverse();
    expect(
      (await call("PUT", "/api/accounts/home/items/order", {
        body: { itemIds: reversed },
        cookie: zach,
      })).status
    ).toBe(200);
    let { json } = await get("/api/accounts/home");
    expect(json.items[0].id).toBe(reversed[0]);

    // restore original order
    await call("PUT", "/api/accounts/home/items/order", {
      body: { itemIds: ids },
      cookie: zach,
    });
    ({ json } = await get("/api/accounts/home"));
    expect(json.items[0].id).toBe(ids[0]);
  });

  it("rejects reorders that don't cover the exact item set", async () => {
    const { status } = await call("PUT", "/api/accounts/home/items/order", {
      body: { itemIds: [brewItemId] },
      cookie: zach,
    });
    expect(status).toBe(400);
  });

  it("only managers can reorder", async () => {
    const items = (await get("/api/accounts/home/items", zach)).json.items;
    const { status } = await call("PUT", "/api/accounts/home/items/order", {
      body: { itemIds: items.map((i: Json) => i.id) },
      cookie: alice,
    });
    expect(status).toBe(403);
  });
});

describe("ledger entries", () => {
  it("any logged-in visitor can start a tab (open participation)", async () => {
    const { status, json } = await post(
      "/api/accounts/home/entries",
      { optionId: brewId, action: "increment" },
      alice
    );
    expect(status).toBe(200);
    expect(json.balanceCents).toBe(300);
    expect(json.quantities[brewId]).toBe(1);
  });

  it("tracks unpriced options as item counts", async () => {
    const { json } = await post(
      "/api/accounts/home/entries",
      { optionId: unpricedId, action: "increment" },
      alice
    );
    expect(json.balanceCents).toBe(300);
    expect(json.unpricedCount).toBe(1);
  });

  it("decrement reverses the latest entry", async () => {
    const { json } = await post(
      "/api/accounts/home/entries",
      { optionId: unpricedId, action: "decrement" },
      alice
    );
    expect(json.unpricedCount).toBe(0);
  });

  it("refuses to decrement below zero", async () => {
    const { status } = await post(
      "/api/accounts/home/entries",
      { optionId: unpricedId, action: "decrement" },
      alice
    );
    expect(status).toBe(409);
  });

  it("locks prices at the time of each entry", async () => {
    await patch(`/api/accounts/home/options/${brewId}`, { priceCents: 400 }, zach);
    const { json } = await post(
      "/api/accounts/home/entries",
      { optionId: brewId, action: "increment" },
      alice
    );
    // one entry at $3 + one at $4
    expect(json.balanceCents).toBe(700);
  });

  it("blocks non-managers from touching someone else's tab", async () => {
    const me = (await get("/api/me", zach)).json.user.id;
    const { status } = await post(
      "/api/accounts/home/entries",
      { optionId: brewId, action: "increment", userId: me },
      alice
    );
    expect(status).toBe(403);
  });

  it("records batched taps as one request (count)", async () => {
    const inc = await post(
      "/api/accounts/home/entries",
      { optionId: brewId, action: "increment", count: 3 },
      alice
    );
    // 2 servings on the tab before this (300 + 400), +3 at current price 400
    expect(inc.json.quantities[brewId]).toBe(5);
    const dec = await post(
      "/api/accounts/home/entries",
      { optionId: brewId, action: "decrement", count: 3 },
      alice
    );
    expect(dec.json.quantities[brewId]).toBe(2);
    expect(dec.json.balanceCents).toBe(700);
  });

  it("groups batched entries in the activity feed", async () => {
    const { json } = await get("/api/accounts/home/activity?mine=1", alice);
    // the batched decrement of 3 shows as one grouped line
    const undos = json.activity.find((a: Json) => a.kind === "undo" && a.count === 3);
    expect(undos).toBeTruthy();
    expect(undos.optionName).toBe("Cold brew");
    // batched entries group too (older same-priced entries may join the group)
    const consumes = json.activity.find((a: Json) => a.kind === "consume" && a.count >= 3);
    expect(consumes).toBeTruthy();
  });

  it("blocks incrementing options of archived items", async () => {
    await patch(`/api/accounts/home/items/${sparklingItemId}`, { archived: true }, zach);
    const { status } = await post(
      "/api/accounts/home/entries",
      { optionId: unpricedId, action: "increment" },
      alice
    );
    expect(status).toBe(409);
  });
});

describe("payments & charges", () => {
  let aliceId: string;
  beforeAll(async () => {
    aliceId = (await get("/api/me", alice)).json.user.id;
  });

  async function balanceOf(userId: string): Promise<number> {
    const members = (await get("/api/accounts/home/members", zach)).json.members;
    return members.find((m: Json) => m.id === userId).balanceCents;
  }

  it("rejects overpayment without confirmation, then accepts with it", async () => {
    const over = await post(
      "/api/accounts/home/payments",
      { userIds: [aliceId], amountCents: 100000 },
      zach
    );
    expect(over.status).toBe(409);
    expect(over.json.requiresConfirmation).toBe(true);
    expect(over.json.overpaidUserIds).toEqual([aliceId]);

    const confirmed = await post(
      "/api/accounts/home/payments",
      { userIds: [aliceId], amountCents: 800, allowNegative: true },
      zach
    );
    expect(confirmed.status).toBe(200);
    expect(await balanceOf(aliceId)).toBe(-100); // $7.00 owed − $8.00 paid
  });

  it("records charges with notes", async () => {
    const { status } = await post(
      "/api/accounts/home/charges",
      { userIds: [aliceId], amountCents: 1050, note: "old paper tab" },
      zach
    );
    expect(status).toBe(200);
    expect(await balanceOf(aliceId)).toBe(950); // −$1.00 + $10.50
  });

  it("applies a charge to several members at once", async () => {
    const g1 = (await post("/api/accounts/home/ghosts", { name: "Split A" }, zach)).json.id;
    const g2 = (await post("/api/accounts/home/ghosts", { name: "Split B" }, zach)).json.id;
    const { status, json } = await post(
      "/api/accounts/home/charges",
      { userIds: [g1, g2], amountCents: 1500, note: "supply deposit split" },
      zach
    );
    expect(status).toBe(200);
    expect(json.applied).toBe(2);
    expect(await balanceOf(g1)).toBe(1500);
    expect(await balanceOf(g2)).toBe(1500);

    // settle both in one call: payment == each current balance
    const settle = await post("/api/accounts/home/members/settle", { userIds: [g1, g2] }, zach);
    expect(settle.json).toEqual({ settled: 2, skipped: 0 });
    expect(await balanceOf(g1)).toBe(0);
    expect(await balanceOf(g2)).toBe(0);

    // settling a zero balance is a no-op, not an error
    const again = await post("/api/accounts/home/members/settle", { userIds: [g1] }, zach);
    expect(again.json).toEqual({ settled: 0, skipped: 1 });

    await post("/api/accounts/home/ghosts/delete", { userIds: [g1, g2] }, zach);
  });

  it("rejects bulk actions naming a non-member", async () => {
    const outsider = (await get("/api/me", zach)).json.user.id;
    await post("/api/accounts", { ...validAccount(), name: "Other", slug: "other" }, zach);
    const { status } = await post(
      "/api/accounts/other/charges",
      { userIds: [outsider], amountCents: 100 },
      zach
    );
    expect(status).toBe(400);
    await del("/api/accounts/other", zach);
  });

  it("only managers can record payments or charges", async () => {
    expect(
      (await post("/api/accounts/home/payments", { userIds: [aliceId], amountCents: 1 }, alice))
        .status
    ).toBe(403);
    expect(
      (await post("/api/accounts/home/charges", { userIds: [aliceId], amountCents: 1 }, alice))
        .status
    ).toBe(403);
    expect(
      (await post("/api/accounts/home/members/settle", { userIds: [aliceId] }, alice)).status
    ).toBe(403);
  });
});

describe("merging members", () => {
  it("combines any number of members' balances into one", async () => {
    const ids: string[] = [];
    for (const [name, cents] of [
      ["Merge Target", 500],
      ["Merge A", 250],
      ["Merge B", 125],
    ] as const) {
      const id = (await post("/api/accounts/home/ghosts", { name }, zach)).json.id;
      await post("/api/accounts/home/charges", { userIds: [id], amountCents: cents }, zach);
      ids.push(id);
    }
    const [target, a, b] = ids;

    const merged = await post(
      "/api/accounts/home/members/merge",
      { targetUserId: target, sourceUserIds: [a, b] },
      zach
    );
    expect(merged.status).toBe(200);
    expect(merged.json.merged).toBe(2);
    expect(merged.json.balanceCents).toBe(875); // 500 + 250 + 125

    const members = (await get("/api/accounts/home/members", zach)).json.members;
    expect(members.find((m: Json) => m.id === target).balanceCents).toBe(875);
    // merged-away ghosts are gone
    expect(members.find((m: Json) => m.id === a)).toBeUndefined();
    expect(members.find((m: Json) => m.id === b)).toBeUndefined();

    await post("/api/accounts/home/ghosts/delete", { userIds: [target] }, zach);
  });

  it("preserves merged history under the target", async () => {
    const target = (await post("/api/accounts/home/ghosts", { name: "Hist Target" }, zach)).json.id;
    const source = (await post("/api/accounts/home/ghosts", { name: "Hist Source" }, zach)).json.id;
    await post(
      "/api/accounts/home/charges",
      { userIds: [source], amountCents: 300, note: "from the whiteboard" },
      zach
    );
    await post(
      "/api/accounts/home/members/merge",
      { targetUserId: target, sourceUserIds: [source] },
      zach
    );
    const activity = (await get("/api/accounts/home/activity", zach)).json.activity;
    const moved = activity.find((a: Json) => a.note === "from the whiteboard");
    expect(moved.userName).toBe("Hist Target");
    await post("/api/accounts/home/ghosts/delete", { userIds: [target] }, zach);
  });

  it("merging a registered member leaves their account intact but tab empty", async () => {
    const dan = await signup("Dan", "dan@example.com");
    const danId = (await get("/api/me", dan)).json.user.id;
    // Dan becomes a member by starting his own tab (a serving at $4).
    await post("/api/accounts/home/entries", { optionId: brewId, action: "increment" }, dan);
    const target = (await post("/api/accounts/home/ghosts", { name: "Absorber" }, zach)).json.id;

    await post(
      "/api/accounts/home/members/merge",
      { targetUserId: target, sourceUserIds: [danId] },
      zach
    );

    // Dan can still sign in and simply has no tab here anymore
    expect((await get("/api/me", dan)).json.user).not.toBeNull();
    expect((await get("/api/dashboard", dan)).json.owed).toHaveLength(0);
    const members = (await get("/api/accounts/home/members", zach)).json.members;
    expect(members.find((m: Json) => m.id === target).balanceCents).toBe(400);

    await post("/api/accounts/home/ghosts/delete", { userIds: [target] }, zach);
  });

  it("rejects merging a member into itself and non-members", async () => {
    const solo = (await post("/api/accounts/home/ghosts", { name: "Solo" }, zach)).json.id;
    expect(
      (await post(
        "/api/accounts/home/members/merge",
        { targetUserId: solo, sourceUserIds: [solo] },
        zach
      )).status
    ).toBe(400);
    expect(
      (await post(
        "/api/accounts/home/members/merge",
        { targetUserId: solo, sourceUserIds: ["nope"] },
        zach
      )).status
    ).toBe(400);
    await post("/api/accounts/home/ghosts/delete", { userIds: [solo] }, zach);
  });

  it("only managers can merge", async () => {
    const { status } = await post(
      "/api/accounts/home/members/merge",
      { targetUserId: "a", sourceUserIds: ["b"] },
      alice
    );
    expect(status).toBe(403);
  });
});

describe("ghost members", () => {
  let daveGhostId: string;

  it("managers create ghosts; they appear in members with no entries", async () => {
    const { status, json } = await post(
      "/api/accounts/home/ghosts",
      { name: "Dave", email: "dave@example.com" },
      zach
    );
    expect(status).toBe(201);
    daveGhostId = json.id;

    const members = (await get("/api/accounts/home/members", zach)).json.members;
    const dave = members.find((m: Json) => m.id === daveGhostId);
    expect(dave).toBeTruthy();
    expect(dave.isGhost).toBe(true);
    expect(dave.claimEmail).toBe("dave@example.com");
    expect(dave.balanceCents).toBe(0);
  });

  it("rejects ghosts for already-registered emails", async () => {
    const { status } = await post(
      "/api/accounts/home/ghosts",
      { name: "Alice Ghost", email: "alice@example.com" },
      zach
    );
    expect(status).toBe(409);
  });

  it("managers backfill a ghost's tab with items and charges", async () => {
    await post(
      "/api/accounts/home/entries",
      { optionId: brewId, action: "increment", userId: daveGhostId },
      zach
    );
    await post(
      "/api/accounts/home/charges",
      { userIds: [daveGhostId], amountCents: 2000, note: "backfilled from whiteboard" },
      zach
    );
    const members = (await get("/api/accounts/home/members", zach)).json.members;
    const dave = members.find((m: Json) => m.id === daveGhostId);
    expect(dave.balanceCents).toBe(2400); // $4 serving + $20 backfill
  });

  it("transfers the tab automatically when the claim email registers", async () => {
    const dave = await signup("Real Dave", "dave@example.com");
    const dashboard = (await get("/api/dashboard", dave)).json;
    expect(dashboard.owed).toHaveLength(1);
    expect(dashboard.owed[0].balanceCents).toBe(2400);

    const members = (await get("/api/accounts/home/members", zach)).json.members;
    expect(members.find((m: Json) => m.id === daveGhostId)).toBeUndefined();
    expect(members.find((m: Json) => m.name === "Real Dave")?.balanceCents).toBe(2400);
  });

  it("manually links a ghost to an existing user (OAuth email mismatch case)", async () => {
    await signup("Bob", "bob@example.com");
    const ghost = await post("/api/accounts/home/ghosts", { name: "Bobby?" }, zach);
    await post(
      "/api/accounts/home/charges",
      { userIds: [ghost.json.id], amountCents: 500 },
      zach
    );

    const link = await post(
      `/api/accounts/home/ghosts/${ghost.json.id}/link`,
      { email: "bob@example.com" },
      zach
    );
    expect(link.status).toBe(200);
    expect(link.json.linkedTo.name).toBe("Bob");

    const members = (await get("/api/accounts/home/members", zach)).json.members;
    expect(members.find((m: Json) => m.name === "Bobby?")).toBeUndefined();
    expect(members.find((m: Json) => m.name === "Bob")?.balanceCents).toBe(500);
  });

  it("linking to an unknown email fails cleanly", async () => {
    const ghost = await post("/api/accounts/home/ghosts", { name: "Nobody" }, zach);
    const { status } = await post(
      `/api/accounts/home/ghosts/${ghost.json.id}/link`,
      { email: "stranger@example.com" },
      zach
    );
    expect(status).toBe(404);
    await del(`/api/accounts/home/ghosts/${ghost.json.id}`, zach);
  });

  it("deleting a ghost removes its ledger", async () => {
    const ghost = await post("/api/accounts/home/ghosts", { name: "Temp" }, zach);
    await post("/api/accounts/home/charges", { userIds: [ghost.json.id], amountCents: 100 }, zach);
    expect((await del(`/api/accounts/home/ghosts/${ghost.json.id}`, zach)).status).toBe(200);
    const members = (await get("/api/accounts/home/members", zach)).json.members;
    expect(members.find((m: Json) => m.id === ghost.json.id)).toBeUndefined();
  });

  it("non-managers cannot manage ghosts", async () => {
    expect((await post("/api/accounts/home/ghosts", { name: "X" }, alice)).status).toBe(403);
  });
});

describe("managers", () => {
  it("owner adds a co-manager by email; co-manager gains access", async () => {
    expect((await get("/api/accounts/home/members", alice)).status).toBe(403);
    const { status } = await post(
      "/api/accounts/home/managers",
      { email: "alice@example.com" },
      zach
    );
    expect(status).toBe(201);
    expect((await get("/api/accounts/home/members", alice)).status).toBe(200);
  });

  it("only the owner manages the manager list", async () => {
    expect(
      (await post("/api/accounts/home/managers", { email: "bob@example.com" }, alice)).status
    ).toBe(403);
  });
});

describe("activity, export, dashboard", () => {
  it("members see only their own activity; managers see everything", async () => {
    const bob = await signup("Bob2", "bob2@example.com");
    await post("/api/accounts/home/entries", { optionId: brewId, action: "increment" }, bob);
    const mine = (await get("/api/accounts/home/activity", bob)).json.activity;
    expect(mine.every((a: Json) => a.userName === "Bob2")).toBe(true);
    const all = (await get("/api/accounts/home/activity", zach)).json.activity;
    expect(new Set(all.map((a: Json) => a.userName)).size).toBeGreaterThan(1);
  });

  it("flags manager-recorded entries", async () => {
    const all = (await get("/api/accounts/home/activity", zach)).json.activity;
    expect(all.some((a: Json) => a.byManager)).toBe(true);
  });

  it("exports the ledger as CSV for managers only", async () => {
    const { res, status } = await call("GET", "/api/accounts/home/export.csv", {
      cookie: zach,
    });
    expect(status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const bob2 = await get("/api/accounts/home/export.csv");
    expect(bob2.status).toBe(401);
  });

  it("dashboard splits owed and managed accounts", async () => {
    const dash = (await get("/api/dashboard", zach)).json;
    expect(dash.managed.some((a: Json) => a.slug === "home" && a.isOwner)).toBe(true);
    const aliceDash = (await get("/api/dashboard", alice)).json;
    expect(aliceDash.owed.some((a: Json) => a.slug === "home")).toBe(true);
    expect(aliceDash.managed.some((a: Json) => a.slug === "home" && !a.isOwner)).toBe(true);
  });
});

describe("currency", () => {
  it("only accepts supported currencies", async () => {
    const { status } = await post(
      "/api/accounts",
      { ...validAccount(), slug: "yen", currency: "JPY" },
      zach
    );
    expect(status).toBe(400);
  });

  it("defaults to CAD when omitted", async () => {
    const { currency, ...rest } = validAccount();
    await post("/api/accounts", { ...rest, name: "Loonie", slug: "loonie" }, zach);
    const { json } = await get("/api/accounts/loonie");
    expect(json.account.currency).toBe("CAD");
    await del("/api/accounts/loonie", zach);
  });
});

describe("notification settings", () => {
  it("serves instance defaults ($20 trigger, enabled)", async () => {
    const { status, json } = await get("/api/notification-settings", alice);
    expect(status).toBe(200);
    expect(json.instance).toEqual({ enabled: true, triggersCents: [2000] });
    expect(json.mine.triggersCents).toBeNull();
  });

  it("lets users customize and reset their own triggers", async () => {
    const put = await call("PUT", "/api/notification-settings", {
      body: { enabled: true, triggersCents: [5000, 1000, 1000] },
      cookie: alice,
    });
    expect(put.status).toBe(200);
    // deduped and sorted
    expect(put.json.mine.triggersCents).toEqual([1000, 5000]);

    const reset = await call("PUT", "/api/notification-settings", {
      body: { enabled: false, triggersCents: null },
      cookie: alice,
    });
    expect(reset.json.mine).toEqual({ enabled: false, triggersCents: null });
  });

  it("only admins change instance defaults", async () => {
    const denied = await call("PUT", "/api/admin/notification-settings", {
      body: { enabled: true, triggersCents: [1000] },
      cookie: alice,
    });
    expect(denied.status).toBe(403);

    const ok = await call("PUT", "/api/admin/notification-settings", {
      body: { enabled: true, triggersCents: [1500, 3000] },
      cookie: zach,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.instance.triggersCents).toEqual([1500, 3000]);
  });

  it("rejects invalid trigger amounts", async () => {
    const { status } = await call("PUT", "/api/notification-settings", {
      body: { enabled: true, triggersCents: [-5] },
      cookie: alice,
    });
    expect(status).toBe(400);
  });
});

describe("instance administration", () => {
  it("blocks non-admins from admin endpoints", async () => {
    const res = await app.request("/api/auth/admin/list-users?limit=10", {
      headers: { Cookie: alice },
    });
    expect([401, 403]).toContain(res.status);
  });

  it("admins list users", async () => {
    const res = await app.request("/api/auth/admin/list-users?limit=100", {
      headers: { Cookie: zach },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.users.some((u: Json) => u.email === "alice@example.com")).toBe(true);
  });

  it("banning a user revokes their sessions and blocks sign-in", async () => {
    const carol = await signup("Carol", "carol@example.com");
    expect((await get("/api/me", carol)).json.user).not.toBeNull();

    const carolId = (
      await app
        .request("/api/auth/admin/list-users?limit=100", { headers: { Cookie: zach } })
        .then((r) => r.json() as Promise<Json>)
    ).users.find((u: Json) => u.email === "carol@example.com").id;

    const ban = await post("/api/auth/admin/ban-user", { userId: carolId }, zach);
    expect(ban.status).toBe(200);

    // existing session is dead
    expect((await get("/api/me", carol)).json.user).toBeNull();

    // sign-in refused while banned
    const signin = await post("/api/auth/sign-in/email", {
      email: "carol@example.com",
      password: "test-password-123",
    });
    expect(signin.status).toBeGreaterThanOrEqual(400);

    // unban restores access
    await post("/api/auth/admin/unban-user", { userId: carolId }, zach);
    const again = await post("/api/auth/sign-in/email", {
      email: "carol@example.com",
      password: "test-password-123",
    });
    expect(again.status).toBe(200);
  });

  it("admins can set a user's password directly", async () => {
    const users = (await app
      .request("/api/auth/admin/list-users?limit=100", { headers: { Cookie: zach } })
      .then((r) => r.json() as Promise<Json>)) as Json;
    const carolId = users.users.find((u: Json) => u.email === "carol@example.com").id;

    const set = await post(
      "/api/auth/admin/set-user-password",
      { userId: carolId, newPassword: "brand-new-password-1" },
      zach
    );
    expect(set.status).toBe(200);

    const login = await post("/api/auth/sign-in/email", {
      email: "carol@example.com",
      password: "brand-new-password-1",
    });
    expect(login.status).toBe(200);
  });
});

describe("account deletion", () => {
  it("only the owner can delete; deletion removes the ledger", async () => {
    await post("/api/accounts", { ...validAccount(), name: "Temp", slug: "temp" }, zach);
    expect((await del("/api/accounts/temp", alice)).status).toBe(403);
    expect((await del("/api/accounts/temp", zach)).status).toBe(200);
    expect((await get("/api/accounts/temp")).status).toBe(404);
  });
});

function validAccount() {
  return {
    name: "Home",
    description: "The coffee supply",
    slug: "home",
    currency: "USD",
  };
}
