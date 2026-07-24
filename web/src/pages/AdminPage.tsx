import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type NotificationSettings } from "../lib/api";
import { authClient } from "../lib/auth";
import { money, timeAgo } from "../lib/format";
import { Button, Card, ErrorNote, Spinner } from "../components/fields";
import { TriggerEditor } from "../components/TriggerEditor";
import { PromptDialog } from "../components/dialogs";
import { Badge } from "@/components/ui/badge";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  createdAt: string | Date;
};

export default function AdminPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    const me = await api.get<{ user: { role: string } | null }>("/api/me");
    if (me.user?.role !== "admin") {
      navigate("/");
      return;
    }
    const res = await authClient.admin.listUsers({
      query: { limit: 200, sortBy: "createdAt" },
    });
    if (res.error) setError(res.error.message ?? "Failed to load users");
    // Ghosts are account-level bookkeeping, not instance users.
    else setUsers((res.data.users as AdminUser[]).filter((u) => !u.email.endsWith("@ghost.invalid")));
    api.get<NotificationSettings>("/api/notification-settings").then(setSettings);
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleBan(u: AdminUser) {
    setError("");
    const res = u.banned
      ? await authClient.admin.unbanUser({ userId: u.id })
      : await authClient.admin.banUser({ userId: u.id });
    if (res.error) setError(res.error.message ?? "Failed");
    else void load();
  }

  async function setPassword(u: AdminUser, newPassword: string) {
    setError("");
    setNotice("");
    const res = await authClient.admin.setUserPassword({ userId: u.id, newPassword });
    if (res.error) setError(res.error.message ?? "Failed");
    else setNotice(`Password updated for ${u.name}.`);
  }

  async function saveInstanceSettings(enabled: boolean, triggersCents: number[]) {
    setError("");
    try {
      const res = await api.put<{ instance: NotificationSettings["instance"] }>(
        "/api/admin/notification-settings",
        { enabled, triggersCents }
      );
      setSettings((s) => (s ? { ...s, instance: res.instance } : s));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    }
  }

  if (!users) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Instance admin</h1>
      <ErrorNote>{error}</ErrorNote>
      {notice && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <Card className="divide-y divide-border p-0">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <div className="font-semibold">
                {u.name}
                {u.role === "admin" && (
                  <Badge variant="secondary" className="ml-2">
                    admin
                  </Badge>
                )}
                {u.banned && (
                  <Badge variant="destructive" className="ml-2">
                    deactivated
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {u.email} · joined {timeAgo(new Date(u.createdAt).getTime())}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPasswordTarget(u)}>
                Set password
              </Button>
              <Button
                variant={u.banned ? "secondary" : "danger"}
                onClick={() => void toggleBan(u)}
              >
                {u.banned ? "Reactivate" : "Deactivate"}
              </Button>
            </div>
          </div>
        ))}
      </Card>

      <PromptDialog
        open={passwordTarget !== null}
        onOpenChange={(o) => !o && setPasswordTarget(null)}
        title={passwordTarget ? `Set password for ${passwordTarget.name}` : ""}
        description="Share the new password with them securely; they can change it after logging in."
        fields={[
          { name: "password", label: "New password", type: "password", required: true },
        ]}
        submitLabel="Set password"
        onSubmit={(values) =>
          passwordTarget && void setPassword(passwordTarget, values.password)
        }
      />

      {settings && (
        <Card>
          <h3 className="mb-1 font-bold">Notifications (instance defaults)</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Members get an email when their tab crosses a trigger amount. Users can override
            these defaults or opt out from their dashboard.
            {!settings.smtpEnabled && (
              <span className="mt-1 block font-medium text-amber-700">
                ⚠ SMTP is not configured, so no emails will actually send.
              </span>
            )}
          </p>
          <TriggerEditor
            enabled={settings.instance.enabled}
            triggersCents={settings.instance.triggersCents}
            onSave={(enabled, triggers) => void saveInstanceSettings(enabled, triggers)}
          />
        </Card>
      )}
    </div>
  );
}
