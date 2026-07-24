import { useEffect, useState } from "react";
import { api, ApiError, type NotificationSettings } from "../lib/api";
import { Card, ErrorNote, Spinner } from "./fields";
import { TriggerEditor } from "./TriggerEditor";

/** Per-user notification preferences card, shown under Preferences on the profile page. */
export function NotificationPrefsCard() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<NotificationSettings>("/api/notification-settings").then(setSettings).catch(() => {});
  }, []);

  if (!settings) return <Spinner />;

  async function save(enabled: boolean, triggersCents: number[] | null) {
    setError("");
    setSaved(false);
    try {
      const res = await api.put<{ mine: NotificationSettings["mine"] }>(
        "/api/notification-settings",
        { enabled, triggersCents }
      );
      setSettings((s) => (s ? { ...s, mine: res.mine } : s));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    }
  }

  const usingDefaults = settings.mine.triggersCents === null;

  return (
    <Card>
      <h3 className="mb-1 font-bold">Notifications</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Get an email when a tab of yours crosses a trigger amount.
        {usingDefaults && " You're using the instance defaults."}
        {!settings.smtpEnabled && (
          <span className="mt-1 block font-medium text-amber-700 dark:text-amber-400">
            ⚠ This instance has no email (SMTP) configured, so notifications won't send.
          </span>
        )}
      </p>
      <ErrorNote>{error}</ErrorNote>
      <TriggerEditor
        key={usingDefaults ? "defaults" : "custom"}
        enabled={settings.mine.enabled}
        triggersCents={settings.mine.triggersCents ?? settings.instance.triggersCents}
        onSave={(enabled, triggers) => void save(enabled, triggers)}
      />
      <div className="mt-2 flex items-center gap-3">
        {!usingDefaults && (
          <button
            className="text-xs text-muted-foreground underline"
            onClick={() => void save(settings.mine.enabled, null)}
          >
            Reset to instance defaults
          </button>
        )}
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
      </div>
    </Card>
  );
}
