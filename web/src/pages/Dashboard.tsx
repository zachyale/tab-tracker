import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  api,
  ApiError,
  type AccountSummary,
  type ManagedSummary,
  type NotificationSettings,
} from "../lib/api";
import { useSession } from "../lib/auth";
import { balanceLabel } from "../lib/format";
import { Card, ErrorNote, Spinner } from "../components/fields";
import { TriggerEditor } from "../components/TriggerEditor";

type DashboardData = { owed: AccountSummary[]; managed: ManagedSummary[] };

export default function Dashboard() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      navigate("/login");
      return;
    }
    api.get<DashboardData>("/api/dashboard").then(setData).catch(console.error);
  }, [session, isPending, navigate]);

  if (isPending || !data) return <Spinner />;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">Your tabs</h2>
        {data.owed.length === 0 ? (
          <Card className="text-sm text-stone-500">
            Nothing on your tab yet. Open an account's link to start one.
          </Card>
        ) : (
          <div className="space-y-2">
            {data.owed.map((a) => (
              <Link key={a.id} to={`/accounts/${a.slug}`} className="block">
                <Card className="flex items-center justify-between transition-colors hover:border-stone-400">
                  <span className="font-semibold">{a.name}</span>
                  <span
                    className={`text-sm font-bold ${
                      a.balanceCents > 0 || a.unpricedCount > 0
                        ? "text-red-700"
                        : "text-emerald-700"
                    }`}
                  >
                    {balanceLabel(a.balanceCents, a.unpricedCount, a.currency)}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Accounts you manage</h2>
          <Link
            to="/accounts/new"
            className="rounded-xl bg-stone-900 px-3 py-1.5 text-sm font-semibold text-amber-50 hover:bg-stone-700"
          >
            + New account
          </Link>
        </div>
        {data.managed.length === 0 ? (
          <Card className="text-sm text-stone-500">
            You don't manage any accounts. Create one for your coffee supply, snack drawer, or shared fridge.
          </Card>
        ) : (
          <div className="space-y-2">
            {data.managed.map((a) => (
              <Link key={a.id} to={`/accounts/${a.slug}/manage`} className="block">
                <Card className="flex items-center justify-between transition-colors hover:border-stone-400">
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-xs text-stone-500">
                      {a.memberCount} member{a.memberCount === 1 ? "" : "s"}
                      {a.isOwner ? " · owner" : " · manager"}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-stone-700">
                    {balanceLabel(a.outstandingCents, a.unpricedCount, a.currency)} out
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <NotificationPrefs />
    </div>
  );
}

function NotificationPrefs() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<NotificationSettings>("/api/notification-settings").then(setSettings).catch(() => {});
  }, []);

  if (!settings) return null;

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
    <section>
      <button onClick={() => setOpen(!open)} className="text-sm text-stone-500 underline">
        {open ? "Hide notification settings" : "Notification settings"}
      </button>
      {open && (
        <Card className="mt-2">
          <p className="mb-3 text-sm text-stone-600">
            Get an email when a tab of yours crosses a trigger amount.
            {usingDefaults && " You're using the instance defaults."}
            {!settings.smtpEnabled && (
              <span className="mt-1 block font-medium text-amber-700">
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
                className="text-xs text-stone-500 underline"
                onClick={() => void save(settings.mine.enabled, null)}
              >
                Reset to instance defaults
              </button>
            )}
            {saved && <span className="text-xs text-emerald-700">Saved ✓</span>}
          </div>
        </Card>
      )}
    </section>
  );
}
