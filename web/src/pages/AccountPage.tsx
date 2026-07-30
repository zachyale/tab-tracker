import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type AccountPageData, type ActivityItem } from "../lib/api";
import { useSession } from "../lib/auth";
import { balanceLabel, money, timeAgo } from "../lib/format";
import { Card, ErrorNote, Spinner } from "../components/fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Rapid taps are applied optimistically and flushed as one batch after this
// long, so four entries land as one request (and one ledger transaction).
const FLUSH_DELAY_MS = 2000;

export default function AccountPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<AccountPageData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ActivityItem[] | null>(null);

  // Net un-flushed tap deltas per option id.
  const pendingRef = useRef<Record<string, number>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);

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

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (flushingRef.current) {
      // A flush is in flight; try again shortly with whatever accumulated.
      timerRef.current = setTimeout(() => void flush(), 500);
      return;
    }
    const batch = pendingRef.current;
    pendingRef.current = {};
    const ops = Object.entries(batch).filter(([, delta]) => delta !== 0);
    if (ops.length === 0) return;

    flushingRef.current = true;
    try {
      let latest: {
        quantities: Record<string, number>;
        balanceCents: number;
        unpricedCount: number;
      } | null = null;
      for (const [optionId, delta] of ops) {
        latest = await api.post(`/api/accounts/${slug}/entries`, {
          optionId,
          action: delta > 0 ? "increment" : "decrement",
          count: Math.abs(delta),
        });
      }
      if (latest && Object.keys(pendingRef.current).length === 0) {
        const mine = latest;
        setData((d) => (d ? { ...d, mine } : d));
      }
      setHistory(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong");
      load();
    } finally {
      flushingRef.current = false;
    }
  }, [slug, load]);

  // Flush whatever is queued when the page is left.
  useEffect(() => {
    const onPageHide = () => void flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void flush();
    };
  }, [flush]);

  function bump(optionId: string, action: "increment" | "decrement") {
    if (!data?.mine) return;
    setError("");
    const delta = action === "increment" ? 1 : -1;
    const price =
      data.items.flatMap((i) => i.options).find((o) => o.id === optionId)?.priceCents ?? null;

    // Optimistic update — quantities and the balance banner move instantly.
    setData((d) =>
      d?.mine
        ? {
            ...d,
            mine: {
              quantities: {
                ...d.mine.quantities,
                [optionId]: (d.mine.quantities[optionId] ?? 0) + delta,
              },
              balanceCents: d.mine.balanceCents + (price ?? 0) * delta,
              unpricedCount: d.mine.unpricedCount + (price == null ? delta : 0),
            },
          }
        : d
    );

    pendingRef.current[optionId] = (pendingRef.current[optionId] ?? 0) + delta;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }

  async function loadHistory() {
    const res = await api.get<{ activity: ActivityItem[] }>(
      `/api/accounts/${slug}/activity?mine=1`
    );
    setHistory(res.activity);
  }

  if (notFound)
    return (
      <Card className="text-center text-muted-foreground">
        No account at <code>/{slug}</code>.
      </Card>
    );
  if (!data || isPending) return <Spinner />;

  const { account, items, mine } = data;
  const loggedIn = !!session?.user;

  function controls(optionId: string) {
    const qty = mine?.quantities[optionId] ?? 0;
    if (!loggedIn || !mine)
      return <span className="text-xs text-muted-foreground">log in to track</span>;
    return (
      <div className="flex shrink-0 items-center gap-2">
        <button
          aria-label="Remove one"
          disabled={qty === 0}
          onClick={() => bump(optionId, "decrement")}
          className="grid size-11 place-items-center rounded-full border border-input text-xl font-bold text-foreground active:bg-muted disabled:opacity-30"
        >
          −
        </button>
        <span className="w-8 text-center text-lg font-bold tabular-nums">{qty}</span>
        <button
          aria-label="Add one"
          onClick={() => bump(optionId, "increment")}
          className="grid size-11 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground active:bg-primary/80"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{account.name}</h1>
            {account.description && (
              <p className="mt-1 text-sm text-muted-foreground">{account.description}</p>
            )}
          </div>
          {data.isManager && (
            <Link
              to={`/accounts/${account.slug}/manage`}
              className="shrink-0 rounded-xl border border-input bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted"
            >
              Manage
            </Link>
          )}
        </div>
      </div>

      {loggedIn && mine && (
        <div className="flex items-center justify-between rounded-2xl bg-primary p-4 text-primary-foreground shadow-sm">
          <span className="text-sm">Your tab</span>
          <span className="text-xl font-bold">
            {balanceLabel(mine.balanceCents, mine.unpricedCount, account.currency)}
          </span>
        </div>
      )}

      {!loggedIn && (
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Log in to start a tab and track what you owe.</p>
          <Link
            to={`/login?next=${encodeURIComponent(`/accounts/${account.slug}`)}`}
            className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/80"
          >
            Log in
          </Link>
        </Card>
      )}

      <ErrorNote>{error}</ErrorNote>

      <div className="space-y-2">
        {items.length === 0 && (
          <Card className="text-sm text-muted-foreground">Nothing here yet.</Card>
        )}
        {items.map((item) => {
          // An item whose only option is anonymous renders as a single row.
          const single = item.options.length === 1 && !item.options[0].name;
          const price = (cents: number | null) =>
            cents != null ? money(cents, account.currency) : "no price";
          return (
            <Card key={item.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{item.name}</div>
                  {item.description && (
                    <div className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </div>
                  )}
                  {single && (
                    <div className="text-sm text-muted-foreground">
                      {price(item.options[0].priceCents)}
                    </div>
                  )}
                </div>
                {single && controls(item.options[0].id)}
              </div>
              {!single && (
                <div className="mt-1 divide-y divide-border">
                  {item.options.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {o.name ?? price(o.priceCents)}
                        </div>
                        {o.description && (
                          <div className="truncate text-xs text-muted-foreground">
                            {o.description}
                          </div>
                        )}
                        {o.name && (
                          <div className="text-sm text-muted-foreground">
                            {price(o.priceCents)}
                          </div>
                        )}
                      </div>
                      {controls(o.id)}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {loggedIn && mine && (
        <Accordion type="single" collapsible>
          <AccordionItem value="activity" className="rounded-2xl border bg-card px-4">
            <AccordionTrigger onClick={() => void loadHistory()}>My activity</AccordionTrigger>
            <AccordionContent className="px-0">
              {!history ? (
                <Spinner />
              ) : history.length === 0 ? (
                <p className="pb-3 text-sm text-muted-foreground">Nothing on your tab yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>
                          {h.kind === "payment"
                            ? "Payment"
                            : h.kind === "charge"
                              ? "Charge"
                              : `${h.kind === "undo" ? "Removed " : ""}${h.optionName ?? ""}${
                                  h.count > 1 ? ` ×${h.count}` : ""
                                }`.trim()}
                          {h.byManager && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              by {h.actorName}
                            </span>
                          )}
                          {h.note && (
                            <span className="ml-1 text-xs text-muted-foreground">({h.note})</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {h.amountCents == null
                            ? "—"
                            : `${h.kind === "payment" || h.kind === "undo" ? "−" : ""}${money(
                                h.amountCents * h.count,
                                account.currency
                              )}`}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {timeAgo(h.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

    </div>
  );
}
