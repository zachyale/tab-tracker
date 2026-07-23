import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type AccountSummary, type ManagedSummary } from "../lib/api";
import { useSession } from "../lib/auth";
import { balanceLabel } from "../lib/format";
import { Card, Spinner } from "../components/ui";

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
            You don't manage any accounts. Create one for your keg, coffee stash, or snack drawer.
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
    </div>
  );
}
