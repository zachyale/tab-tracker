import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type AccountPageData, type ActivityItem } from "../lib/api";
import { useSession } from "../lib/auth";
import { balanceLabel, money, timeAgo } from "../lib/format";
import { Card, ErrorNote, Spinner } from "../components/ui";

export default function AccountPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<AccountPageData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [history, setHistory] = useState<ActivityItem[] | null>(null);

  const load = useCallback(() => {
    api
      .get<AccountPageData>(`/api/accounts/${slug}`)
      .then(setData)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e.message);
      });
  }, [slug]);

  useEffect(load, [load, session?.user?.id]);

  async function bump(optionId: string, action: "increment" | "decrement") {
    if (!data?.mine || pending) return;
    setPending(optionId);
    setError("");
    // Optimistic update; reconciled with the server response below.
    const delta = action === "increment" ? 1 : -1;
    setData((d) =>
      d?.mine
        ? {
            ...d,
            mine: {
              ...d.mine,
              quantities: {
                ...d.mine.quantities,
                [optionId]: (d.mine.quantities[optionId] ?? 0) + delta,
              },
            },
          }
        : d
    );
    try {
      const res = await api.post<{
        quantities: Record<string, number>;
        balanceCents: number;
        unpricedCount: number;
      }>(`/api/accounts/${slug}/entries`, { optionId, action });
      setData((d) => (d ? { ...d, mine: res } : d));
      setHistory(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
      load();
    } finally {
      setPending(null);
    }
  }

  async function toggleHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    const res = await api.get<{ activity: ActivityItem[] }>(
      `/api/accounts/${slug}/activity?mine=1`
    );
    setHistory(res.activity);
  }

  if (notFound)
    return (
      <Card className="text-center text-stone-600">
        No account at <code>/{slug}</code>.
      </Card>
    );
  if (!data || isPending) return <Spinner />;

  const { account, options, mine } = data;
  const loggedIn = !!session?.user;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{account.name}</h1>
            {account.description && (
              <p className="mt-1 text-sm text-stone-600">{account.description}</p>
            )}
          </div>
          {data.isManager && (
            <Link
              to={`/accounts/${account.slug}/manage`}
              className="shrink-0 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-stone-100"
            >
              Manage
            </Link>
          )}
        </div>
      </div>

      {loggedIn && mine && (
        <div className="flex items-center justify-between rounded-2xl bg-stone-900 p-4 text-amber-50 shadow-sm">
          <span className="text-sm">Your tab</span>
          <span className="text-xl font-bold">
            {balanceLabel(mine.balanceCents, mine.unpricedCount, account.currency)}
          </span>
        </div>
      )}

      {!loggedIn && (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-stone-600">Log in to start a tab and track what you owe.</p>
          <Link
            to={`/login?next=${encodeURIComponent(`/accounts/${account.slug}`)}`}
            className="shrink-0 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-stone-700"
          >
            Log in
          </Link>
        </Card>
      )}

      <ErrorNote>{error}</ErrorNote>

      <div className="space-y-2">
        {options.length === 0 && (
          <Card className="text-sm text-stone-500">No options here yet.</Card>
        )}
        {options.map((o) => {
          const qty = mine?.quantities[o.id] ?? 0;
          return (
            <Card key={o.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{o.name}</div>
                {o.description && (
                  <div className="truncate text-xs text-stone-500">{o.description}</div>
                )}
                <div className="text-sm text-stone-600">
                  {o.priceCents != null ? money(o.priceCents, account.currency) : "no price"}
                </div>
              </div>
              {loggedIn && mine ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    aria-label={`Remove one ${o.name}`}
                    disabled={qty === 0 || pending === o.id}
                    onClick={() => void bump(o.id, "decrement")}
                    className="grid size-11 place-items-center rounded-full border border-stone-300 text-xl font-bold text-stone-700 active:bg-stone-200 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-lg font-bold tabular-nums">{qty}</span>
                  <button
                    aria-label={`Add one ${o.name}`}
                    disabled={pending === o.id}
                    onClick={() => void bump(o.id, "increment")}
                    className="grid size-11 place-items-center rounded-full bg-stone-900 text-xl font-bold text-amber-50 active:bg-stone-700 disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="text-xs text-stone-400">log in to track</span>
              )}
            </Card>
          );
        })}
      </div>

      {loggedIn && mine && (
        <div className="pt-2">
          <button onClick={() => void toggleHistory()} className="text-sm text-stone-500 underline">
            {history ? "Hide my history" : "Show my history"}
          </button>
          {history && (
            <Card className="mt-2 divide-y divide-stone-100 p-0">
              {history.length === 0 && (
                <p className="p-3 text-sm text-stone-500">No activity yet.</p>
              )}
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    {h.kind === "payment"
                      ? `Paid ${money(h.amountCents ?? 0, account.currency)}`
                      : `${h.kind === "undo" ? "Removed" : ""} ${h.optionName ?? ""}`.trim()}
                    {h.byManager && (
                      <span className="ml-1 text-xs text-stone-400">by {h.actorName}</span>
                    )}
                    {h.note && <span className="ml-1 text-xs text-stone-400">({h.note})</span>}
                  </span>
                  <span className="text-xs text-stone-400">{timeAgo(h.createdAt)}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

    </div>
  );
}
