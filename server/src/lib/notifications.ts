import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env, smtpEnabled } from "../env.js";
import { sendMail } from "../mailer.js";

// Instance defaults: notifications on, one trigger at $20.
export const DEFAULT_TRIGGERS_CENTS = [2000];

export type NotificationSettings = { enabled: boolean; triggersCents: number[] };

function getSetting(key: string): string | undefined {
  return db
    .select()
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.key, key))
    .get()?.value;
}

function setSetting(key: string, value: string): void {
  db.insert(schema.instanceSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.instanceSettings.key, set: { value } })
    .run();
}

export function getInstanceNotificationSettings(): NotificationSettings {
  const raw = getSetting("notifications");
  if (!raw) return { enabled: true, triggersCents: DEFAULT_TRIGGERS_CENTS };
  try {
    const parsed = JSON.parse(raw) as NotificationSettings;
    return {
      enabled: !!parsed.enabled,
      triggersCents: Array.isArray(parsed.triggersCents)
        ? parsed.triggersCents
        : DEFAULT_TRIGGERS_CENTS,
    };
  } catch {
    return { enabled: true, triggersCents: DEFAULT_TRIGGERS_CENTS };
  }
}

export function setInstanceNotificationSettings(settings: NotificationSettings): void {
  setSetting("notifications", JSON.stringify(settings));
}

export type UserNotificationPref = { enabled: boolean; triggersCents: number[] | null };

export function getUserNotificationPref(userId: string): UserNotificationPref {
  const row = db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId))
    .get();
  if (!row) return { enabled: true, triggersCents: null };
  return {
    enabled: row.enabled,
    triggersCents: row.triggersCents ? (JSON.parse(row.triggersCents) as number[]) : null,
  };
}

export function setUserNotificationPref(userId: string, pref: UserNotificationPref): void {
  db.insert(schema.notificationPrefs)
    .values({
      userId,
      enabled: pref.enabled,
      triggersCents: pref.triggersCents ? JSON.stringify(pref.triggersCents) : null,
    })
    .onConflictDoUpdate({
      target: schema.notificationPrefs.userId,
      set: {
        enabled: pref.enabled,
        triggersCents: pref.triggersCents ? JSON.stringify(pref.triggersCents) : null,
      },
    })
    .run();
}

/** Trigger amounts whose threshold the balance crossed upward. Pure — unit tested. */
export function crossedTriggers(
  preCents: number,
  postCents: number,
  triggersCents: number[]
): number[] {
  if (postCents <= preCents) return [];
  return triggersCents.filter((t) => t > 0 && preCents < t && postCents >= t);
}

/**
 * Called after any balance-increasing ledger write. Sends at most one email
 * per crossing (fire-and-forget — a mail failure never fails the request).
 */
export function notifyIfCrossed(
  accountId: string,
  userId: string,
  preCents: number,
  postCents: number
): void {
  const instance = getInstanceNotificationSettings();
  if (!instance.enabled || !smtpEnabled) return;

  const user = db.select().from(schema.user).where(eq(schema.user.id, userId)).get();
  if (!user || user.isGhost) return;

  const pref = getUserNotificationPref(userId);
  if (!pref.enabled) return;

  const triggers = pref.triggersCents ?? instance.triggersCents;
  const crossed = crossedTriggers(preCents, postCents, triggers);
  if (crossed.length === 0) return;

  const account = db
    .select()
    .from(schema.tabAccounts)
    .where(eq(schema.tabAccounts.id, accountId))
    .get();
  if (!account) return;

  const owed = (postCents / 100).toFixed(2);
  void sendMail(
    user.email,
    `Your ${account.name} tab is at ${account.currency} ${owed}`,
    `Heads up — your tab on "${account.name}" is now ${account.currency} ${owed}.\n\n` +
      `Review it at ${env.baseUrl}/accounts/${account.slug}\n\n` +
      `You can adjust these notifications from your dashboard on ${env.instanceName}.`
  ).catch((err) => console.error("[notifications] failed to send:", err));
}
