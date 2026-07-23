import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type NotificationSettings } from "../lib/api";
import { authClient } from "../lib/auth";
import { money, timeAgo } from "../lib/format";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { TriggerEditor } from "../components/TriggerEditor";

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
  const [settings, setSettings] = useState<NotificationSettings | null>(null);

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

  async function setPassword(u: AdminUser) {
    const newPassword = window.prompt(
      `Set a new password for ${u.name} (${u.email}). Share it with them securely; they can change it after logging in.`
    );
    if (!newPassword) return;
    setError("");
    const res = await authClient.admin.setUserPassword({ userId: u.id, newPassword });
    if (res.error) setError(res.error.message ?? "Failed");
    else window.alert("Password updated.");
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

      <Card className="divide-y divide-stone-100 p-0">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <div className="font-semibold">
                {u.name}
                {u.role === "admin" && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    admin
                  </span>
                )}
                {u.banned && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    deactivated
                  </span>
                )}
              </div>
              <div className="text-xs text-stone-500">
                {u.email} · joined {timeAgo(new Date(u.createdAt).getTime())}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void setPassword(u)}>
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

      {settings && (
        <Card>
          <h3 className="mb-1 font-bold">Notifications (instance defaults)</h3>
          <p className="mb-3 text-sm text-stone-600">
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
