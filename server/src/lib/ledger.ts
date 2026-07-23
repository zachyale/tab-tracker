import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export type Balance = { balanceCents: number; unpricedCount: number };

// balance = consumption + charges − undos − payments, at amounts recorded on each
// entry. Unpriced entries carry no amount; they're surfaced as a separate count.
const BALANCE_EXPR = sql`
  COALESCE(SUM(CASE
    WHEN kind = 'consume' THEN COALESCE(amount_cents, 0)
    WHEN kind = 'undo' THEN -COALESCE(amount_cents, 0)
    WHEN kind = 'payment' THEN -amount_cents
    WHEN kind = 'charge' THEN amount_cents
  END), 0)`;

const UNPRICED_EXPR = sql`
  COALESCE(SUM(CASE
    WHEN kind = 'consume' AND amount_cents IS NULL THEN 1
    WHEN kind = 'undo' AND amount_cents IS NULL THEN -1
    ELSE 0
  END), 0)`;

export function balanceForUser(accountId: string, userId: string): Balance {
  const row = db.get<{ balance: number; unpriced: number }>(sql`
    SELECT ${BALANCE_EXPR} AS balance, ${UNPRICED_EXPR} AS unpriced
    FROM entry WHERE account_id = ${accountId} AND user_id = ${userId}
  `);
  return { balanceCents: row?.balance ?? 0, unpricedCount: row?.unpriced ?? 0 };
}

/** Net quantity per option for one user's tab. */
export function quantitiesForUser(accountId: string, userId: string): Record<string, number> {
  const rows = db.all<{ optionId: string; qty: number }>(sql`
    SELECT option_id AS optionId,
           SUM(CASE kind WHEN 'consume' THEN 1 WHEN 'undo' THEN -1 ELSE 0 END) AS qty
    FROM entry
    WHERE account_id = ${accountId} AND user_id = ${userId} AND option_id IS NOT NULL
    GROUP BY option_id
  `);
  return Object.fromEntries(rows.map((r) => [r.optionId, r.qty]));
}

export function accountTotals(accountId: string): Balance & { memberCount: number } {
  const row = db.get<{ balance: number; unpriced: number; members: number }>(sql`
    SELECT ${BALANCE_EXPR} AS balance, ${UNPRICED_EXPR} AS unpriced,
           COUNT(DISTINCT user_id) AS members
    FROM entry WHERE account_id = ${accountId}
  `);
  return {
    balanceCents: row?.balance ?? 0,
    unpricedCount: row?.unpriced ?? 0,
    memberCount: row?.members ?? 0,
  };
}

/** The most recent consumption entry for user+option that hasn't been undone yet. */
export function latestUndoableConsume(
  accountId: string,
  userId: string,
  optionId: string
): { id: string; amountCents: number | null } | undefined {
  return db.get<{ id: string; amountCents: number | null }>(sql`
    SELECT id, amount_cents AS amountCents
    FROM entry
    WHERE account_id = ${accountId} AND user_id = ${userId} AND option_id = ${optionId}
      AND kind = 'consume'
      AND id NOT IN (
        SELECT reverses_entry_id FROM entry
        WHERE kind = 'undo' AND reverses_entry_id IS NOT NULL
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
}
