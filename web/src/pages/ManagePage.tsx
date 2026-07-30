import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import QRCode from "qrcode";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  api,
  ApiError,
  flattenItems,
  type AccountPageData,
  type ActivityItem,
  type Item,
  type ItemOption,
  type Member,
} from "../lib/api";
import { useConfig } from "../App";
import { balanceLabel, currencyOption, money, timeAgo } from "../lib/format";
import { Button, Card, ErrorNote, Input, Select, Spinner } from "../components/fields";
import { ConfirmDialog, PromptDialog } from "../components/dialogs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Tab = "members" | "activity" | "options" | "settings";

export default function ManagePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AccountPageData | null>(null);
  const [tab, setTab] = useState<Tab>("members");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .get<AccountPageData>(`/api/accounts/${slug}`)
      .then((d) => {
        if (!d.isManager) navigate(`/accounts/${slug}`);
        else setData(d);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [slug, navigate]);

  useEffect(load, [load]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Spinner />;

  const tabs: { id: Tab; label: string }[] = [
    { id: "members", label: "Members" },
    { id: "activity", label: "Activity" },
    { id: "options", label: "Items" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{data.account.name}</h1>
        <Link
          to={`/accounts/${slug}`}
          className="shrink-0 rounded-xl border border-input bg-card px-3 py-2 text-sm font-semibold hover:bg-muted"
        >
          View public page
        </Link>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === t.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "members" && <MembersTab slug={slug!} data={data} />}
      {tab === "activity" && <ActivityTab slug={slug!} currency={data.account.currency} />}
      {tab === "options" && <ItemsTab slug={slug!} currency={data.account.currency} />}
      {tab === "settings" && <SettingsTab slug={slug!} data={data} onSaved={load} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

type MemberDialog =
  | { kind: "payment" }
  | { kind: "charge" }
  | { kind: "settle" }
  | { kind: "merge" }
  | { kind: "remove-ghosts" }
  | { kind: "add-ghost" }
  | { kind: "edit-ghost"; member: Member }
  | { kind: "link-ghost"; member: Member }
  | {
      kind: "overpay";
      userIds: string[];
      amountCents: number;
      note: string;
      balanceCents: number;
    }
  | null;

function MembersTab({ slug, data }: { slug: string; data: AccountPageData }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<MemberDialog>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currency = data.account.currency;

  const load = useCallback(() => {
    api
      .get<{ members: Member[] }>(`/api/accounts/${slug}/members`)
      .then((r) => setMembers(r.members))
      .catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load]);

  /** Run a manager action, then refresh and drop the selection. */
  async function run(fn: () => Promise<unknown>, message?: string) {
    setError("");
    setNotice("");
    try {
      await fn();
      setDialog(null);
      setSelectedIds(new Set());
      if (message) setNotice(message);
      load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
      return false;
    }
  }

  if (!members) return <Spinner />;

  const selected = members.filter((m) => selectedIds.has(m.id));
  const allSelected = members.length > 0 && selected.length === members.length;
  const onlyGhosts = selected.length > 0 && selected.every((m) => m.isGhost);
  const owing = selected.filter((m) => m.balanceCents > 0);
  const selectedTotal = selected.reduce((sum, m) => sum + m.balanceCents, 0);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function adjust(userId: string, optionId: string, action: "increment" | "decrement") {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/entries`, { optionId, action, userId });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function pay(userIds: string[], amountCents: number, note: string, allowNegative = false) {
    setError("");
    setNotice("");
    try {
      await api.post(`/api/accounts/${slug}/payments`, {
        userIds,
        amountCents,
        note,
        allowNegative,
      });
      setDialog(null);
      setSelectedIds(new Set());
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.requiresConfirmation) {
        setDialog({
          kind: "overpay",
          userIds,
          amountCents,
          note,
          balanceCents: (e.data.balanceCents as number) ?? 0,
        });
      } else {
        setError(e instanceof ApiError ? e.message : "Failed");
      }
    }
  }

  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>
      {notice && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {members.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          No tabs yet. Share the account link, or add a member to backfill an existing balance.
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {selected.length === 0
                ? `${members.length} member${members.length === 1 ? "" : "s"}`
                : `${selected.length} selected · ${balanceLabel(
                    selectedTotal,
                    selected.reduce((s, m) => s + m.unpricedCount, 0),
                    currency
                  )}`}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setDialog({ kind: "add-ghost" })}>
                + Add member
              </Button>
              <DropdownMenu>
              <DropdownMenuTrigger
                disabled={selected.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-input bg-card px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-40"
              >
                Actions
                <ChevronDown className="size-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onClick={() => setDialog({ kind: "payment" })}>
                  Record payment…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog({ kind: "charge" })}>
                  Add charge…
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={owing.length === 0}
                  onClick={() => setDialog({ kind: "settle" })}
                >
                  Settle full balance{owing.length === 1 ? "" : "s"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={selected.length < 2}
                  onClick={() => setDialog({ kind: "merge" })}
                >
                  Merge members…
                </DropdownMenuItem>
                {selected.length === 1 && selected[0]!.isGhost && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDialog({ kind: "edit-ghost", member: selected[0]! })}
                    >
                      Edit placeholder…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDialog({ kind: "link-ghost", member: selected[0]! })}
                    >
                      Link to registered user…
                    </DropdownMenuItem>
                  </>
                )}
                {onlyGhosts && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDialog({ kind: "remove-ghosts" })}
                    >
                      Remove placeholder{selected.length === 1 ? "" : "s"}
                    </DropdownMenuItem>
                  </>
                )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Card className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all members"
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setSelectedIds(
                          checked === true ? new Set(members.map((m) => m.id)) : new Set()
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <Fragment key={m.id}>
                    <TableRow data-state={selectedIds.has(m.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${m.name}`}
                          checked={selectedIds.has(m.id)}
                          onCheckedChange={() => toggle(m.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {m.name}
                          {m.isGhost && (
                            <Badge variant="secondary" className="ml-2">
                              placeholder
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.isGhost
                            ? m.claimEmail
                              ? `claimable by ${m.claimEmail}`
                              : "no claim email set"
                            : m.email}{" "}
                          · active {timeAgo(m.lastActivity)}
                        </div>
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold ${
                          m.balanceCents > 0 || m.unpricedCount > 0
                            ? "text-destructive"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {balanceLabel(m.balanceCents, m.unpricedCount, currency)}
                      </TableCell>
                      <TableCell>
                        <button
                          aria-label={`${expanded === m.id ? "Hide" : "Show"} ${m.name}'s items`}
                          onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {expanded === m.id ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </button>
                      </TableCell>
                    </TableRow>
                    {expanded === m.id && (
                      <TableRow>
                        <TableCell colSpan={4} className="bg-muted/40">
                          <div className="space-y-2">
                            {flattenItems(data.items).map((o) => (
                              <div
                                key={o.id}
                                className="flex items-center justify-between text-sm"
                              >
                                <span>{o.label}</span>
                                <span className="flex items-center gap-2">
                                  <button
                                    aria-label={`Remove one ${o.label} from ${m.name}`}
                                    onClick={() => void adjust(m.id, o.id, "decrement")}
                                    disabled={(m.quantities[o.id] ?? 0) === 0}
                                    className="grid size-8 place-items-center rounded-full border border-input font-bold disabled:opacity-30"
                                  >
                                    −
                                  </button>
                                  <span className="w-6 text-center font-bold tabular-nums">
                                    {m.quantities[o.id] ?? 0}
                                  </span>
                                  <button
                                    aria-label={`Add one ${o.label} to ${m.name}`}
                                    onClick={() => void adjust(m.id, o.id, "increment")}
                                    className="grid size-8 place-items-center rounded-full bg-primary font-bold text-primary-foreground"
                                  >
                                    +
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {members.length === 0 && (
        <Button variant="secondary" onClick={() => setDialog({ kind: "add-ghost" })}>
          + Add member
        </Button>
      )}

      <PromptDialog
        open={dialog?.kind === "add-ghost"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add a member"
        description="Adds a placeholder for someone who hasn't signed up yet, so you can backfill their tab now. If you set their email, the tab transfers to them automatically when they register."
        fields={[
          { name: "name", label: "Name", placeholder: "Sam", required: true },
          {
            name: "email",
            label: "Email they'll sign up with (optional)",
            type: "email",
            placeholder: "sam@example.com",
          },
        ]}
        submitLabel="Add member"
        onSubmit={(values) =>
          void run(() =>
            api.post(`/api/accounts/${slug}/ghosts`, {
              name: values.name.trim(),
              email: values.email.trim() || null,
            })
          )
        }
      />

      {/* Bulk money actions */}
      <PromptDialog
        open={dialog?.kind === "payment"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Record payment${selected.length > 1 ? "s" : ""}`}
        description={
          selected.length > 1
            ? `This records the same payment against each of the ${selected.length} selected members.`
            : undefined
        }
        fields={[
          { name: "amount", label: `Amount (${currency})`, type: "number", required: true },
          { name: "note", label: "Note (optional)", placeholder: "e-transfer, cash…" },
        ]}
        submitLabel="Record"
        onSubmit={(values) => {
          const cents = parsePrice(values.amount);
          if (!cents) return;
          void pay(selected.map((m) => m.id), cents, values.note);
        }}
      />
      <PromptDialog
        open={dialog?.kind === "charge"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Add charge${selected.length > 1 ? "s" : ""}`}
        description={
          selected.length > 1
            ? `This adds the same charge to each of the ${selected.length} selected members.`
            : "Use this to backfill a balance or add a one-off cost."
        }
        fields={[
          { name: "amount", label: `Amount (${currency})`, type: "number", required: true },
          { name: "note", label: "Note (optional)", placeholder: "backfill, deposit…" },
        ]}
        submitLabel="Add charge"
        onSubmit={(values) => {
          const cents = parsePrice(values.amount);
          if (!cents) return;
          void run(
            () =>
              api.post(`/api/accounts/${slug}/charges`, {
                userIds: selected.map((m) => m.id),
                amountCents: cents,
                note: values.note,
              }),
            `Charged ${money(cents, currency)} to ${selected.length} member${
              selected.length === 1 ? "" : "s"
            }.`
          );
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "settle"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Settle ${owing.length} balance${owing.length === 1 ? "" : "s"}?`}
        description={`This records a payment matching each member's current balance, totalling ${money(
          owing.reduce((sum, m) => sum + m.balanceCents, 0),
          currency
        )}. Members who owe nothing are skipped.`}
        confirmLabel="Settle up"
        onConfirm={() =>
          void run(
            () =>
              api.post(`/api/accounts/${slug}/members/settle`, {
                userIds: owing.map((m) => m.id),
              }),
            "Balances settled."
          )
        }
      />
      <ConfirmDialog
        open={dialog?.kind === "overpay"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Payment is more than the balance"
        description={
          dialog?.kind === "overpay"
            ? `At least one selected member owes less than ${money(
                dialog.amountCents,
                currency
              )} (one has ${money(
                dialog.balanceCents,
                currency
              )}). Recording it will leave them in credit.`
            : ""
        }
        confirmLabel="Record anyway"
        onConfirm={() => {
          if (dialog?.kind !== "overpay") return;
          void pay(dialog.userIds, dialog.amountCents, dialog.note, true);
        }}
      />

      <MergeDialog
        open={dialog?.kind === "merge"}
        onOpenChange={(o) => !o && setDialog(null)}
        members={selected}
        currency={currency}
        onMerge={(targetUserId) =>
          void run(
            () =>
              api.post(`/api/accounts/${slug}/members/merge`, {
                targetUserId,
                sourceUserIds: selected.map((m) => m.id).filter((id) => id !== targetUserId),
              }),
            "Members merged."
          )
        }
      />

      {/* Placeholder-member actions */}
      <PromptDialog
        open={dialog?.kind === "edit-ghost"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Edit placeholder member"
        description="If you set an email, their tab transfers automatically when that email registers."
        fields={
          dialog?.kind === "edit-ghost"
            ? [
                { name: "name", label: "Name", defaultValue: dialog.member.name, required: true },
                {
                  name: "email",
                  label: "Email they'll sign up with (optional)",
                  type: "email",
                  defaultValue: dialog.member.claimEmail ?? "",
                },
              ]
            : []
        }
        onSubmit={(values) => {
          if (dialog?.kind !== "edit-ghost") return;
          void run(() =>
            api.patch(`/api/accounts/${slug}/ghosts/${dialog.member.id}`, {
              name: values.name,
              email: values.email.trim() || null,
            })
          );
        }}
      />
      <PromptDialog
        open={dialog?.kind === "link-ghost"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          dialog?.kind === "link-ghost" ? `Link "${dialog.member.name}" to a user` : ""
        }
        description="Their tab — balance and full history — transfers to the registered user's account, and the placeholder is removed."
        fields={[
          {
            name: "email",
            label: "Registered user's email",
            type: "email",
            required: true,
            placeholder: "friend@example.com",
          },
        ]}
        submitLabel="Link"
        onSubmit={(values) => {
          if (dialog?.kind !== "link-ghost") return;
          void run(() =>
            api.post(`/api/accounts/${slug}/ghosts/${dialog.member.id}/link`, {
              email: values.email.trim(),
            })
          );
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "remove-ghosts"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Remove ${selected.length} placeholder${selected.length === 1 ? "" : "s"}?`}
        description={`This deletes ${
          selected.length === 1 ? `"${selected[0]?.name}"` : "these placeholder members"
        } and their entire tab history. This cannot be undone.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() =>
          void run(() =>
            api.post(`/api/accounts/${slug}/ghosts/delete`, {
              userIds: selected.map((m) => m.id),
            })
          )
        }
      />
    </div>
  );
}

/** Pick which of the selected members absorbs the others' tabs. */
function MergeDialog({
  open,
  onOpenChange,
  members,
  currency,
  onMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  currency: string;
  onMerge: (targetUserId: string) => void;
}) {
  const [target, setTarget] = useState("");
  const effectiveTarget = target && members.some((m) => m.id === target) ? target : members[0]?.id;

  const total = members.reduce((sum, m) => sum + m.balanceCents, 0);
  const unpriced = members.reduce((sum, m) => sum + m.unpricedCount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {members.length} members</DialogTitle>
          <DialogDescription>
            Every entry from the other members moves onto the member you pick, combining their
            balances and history. Placeholder members left empty are removed; registered users
            keep their login and simply have no tab here afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select
            label="Merge into"
            options={members.map((m) => ({
              value: m.id,
              label: `${m.name} · ${balanceLabel(m.balanceCents, m.unpricedCount, currency)}`,
            }))}
            value={effectiveTarget ?? ""}
            onValueChange={setTarget}
          />
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            Combined balance:{" "}
            <strong>{balanceLabel(total, unpriced, currency)}</strong>
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!effectiveTarget}
            onClick={() => effectiveTarget && onMerge(effectiveTarget)}
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

const ACTIVITY_PAGE_SIZE = 15;

function ActivityTab({ slug, currency }: { slug: string; currency: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api
      .get<{ activity: ActivityItem[] }>(`/api/accounts/${slug}/activity`)
      .then((r) => setItems(r.activity))
      .catch(console.error);
  }, [slug]);

  if (!items) return <Spinner />;
  if (items.length === 0)
    return <Card className="text-sm text-muted-foreground">No activity yet.</Card>;

  const pageCount = Math.max(1, Math.ceil(items.length / ACTIVITY_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = items.slice((current - 1) * ACTIVITY_PAGE_SIZE, current * ACTIVITY_PAGE_SIZE);

  function describe(h: ActivityItem): string {
    if (h.kind === "payment") return "Payment";
    if (h.kind === "charge") return "Charge";
    const label = h.optionName ?? "an item";
    return `${h.kind === "undo" ? "Removed " : ""}${label}${h.count > 1 ? ` ×${h.count}` : ""}`;
  }

  return (
    <div className="space-y-3">
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="font-medium">{h.userName}</TableCell>
                <TableCell>
                  {describe(h)}
                  {h.byManager && (
                    <span className="ml-1 text-xs text-muted-foreground">by {h.actorName}</span>
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
                        currency
                      )}`}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {timeAgo(h.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {(current - 1) * ACTIVITY_PAGE_SIZE + 1}–
            {Math.min(current * ACTIVITY_PAGE_SIZE, items.length)} of {items.length}
          </span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={current === 1}
                  className={current === 1 ? "pointer-events-none opacity-40" : ""}
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(current - 1);
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-2 text-sm text-muted-foreground">
                  Page {current} of {pageCount}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={current === pageCount}
                  className={current === pageCount ? "pointer-events-none opacity-40" : ""}
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(current + 1);
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cents = Math.round(parseFloat(trimmed) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

type ItemDialog =
  | { kind: "edit-item"; item: Item }
  | { kind: "add-option"; item: Item }
  | { kind: "edit-option"; item: Item; option: ItemOption }
  | null;

function ItemsTab({ slug, currency }: { slug: string; currency: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<ItemDialog>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [firstOptionName, setFirstOptionName] = useState("");
  const [price, setPrice] = useState("");

  const load = useCallback(() => {
    api
      .get<{ items: Item[] }>(`/api/accounts/${slug}/items`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    await run(() =>
      api.post(`/api/accounts/${slug}/items`, {
        name,
        description,
        options: [{ name: firstOptionName.trim() || null, priceCents: parsePrice(price) }],
      })
    );
    setName("");
    setDescription("");
    setFirstOptionName("");
    setPrice("");
  }

  async function move(itemId: string, delta: -1 | 1) {
    if (!items) return;
    const visible = visibleItems;
    const vIdx = visible.findIndex((i) => i.id === itemId);
    const neighbour = visible[vIdx + delta];
    if (!neighbour) return;
    const ids = items.map((i) => i.id);
    const a = ids.indexOf(itemId);
    const b = ids.indexOf(neighbour.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    await run(() => api.put(`/api/accounts/${slug}/items/order`, { itemIds: ids }));
  }

  if (!items) return <Spinner />;

  const archivedCount =
    items.filter((i) => i.archived).length +
    items.filter((i) => !i.archived).flatMap((i) => i.options.filter((o) => o.archived)).length;
  const visibleItems = showArchived
    ? items
    : items
        .filter((i) => !i.archived)
        .map((i) => ({ ...i, options: i.options.filter((o) => !o.archived) }));

  const priceLabel = (cents: number | null) =>
    cents != null ? money(cents, currency) : "no price";

  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>
      <Card>
        <form onSubmit={addItem} className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                label="New item"
                required
                placeholder="Cold brew"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="w-28">
              <Input
                label={`Price (${currency})`}
                type="number"
                step="0.01"
                min="0"
                placeholder="none"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="w-40">
              <Input
                placeholder="Option label, e.g. Large"
                value={firstOptionName}
                onChange={(e) => setFirstOptionName(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Items can have several options (say, large and small sizes) — add more from the item
            card below.
          </p>
          <Button type="submit">Add item</Button>
        </form>
      </Card>

      {visibleItems.map((item, i) => (
        <Card key={item.id} className={`space-y-2 ${item.archived ? "opacity-60" : ""}`}>
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 flex-col">
              <button
                aria-label={`Move ${item.name} up`}
                disabled={i === 0}
                onClick={() => void move(item.id, -1)}
                className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                aria-label={`Move ${item.name} down`}
                disabled={i === visibleItems.length - 1}
                onClick={() => void move(item.id, 1)}
                className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {item.name}
                {item.archived && (
                  <Badge variant="secondary" className="ml-2">
                    archived
                  </Badge>
                )}
              </div>
              {item.description && (
                <div className="truncate text-xs text-muted-foreground">{item.description}</div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                onClick={() => setDialog({ kind: "edit-item", item })}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    api.patch(`/api/accounts/${slug}/items/${item.id}`, {
                      archived: !item.archived,
                    })
                  )
                }
              >
                {item.archived ? "Restore" : "Archive"}
              </Button>
            </div>
          </div>

          <div className="divide-y divide-border border-t border-border">
            {item.options.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 py-2 pl-7">
                <div className="min-w-0 text-sm">
                  <span className={o.archived ? "opacity-60" : ""}>
                    {o.name ?? <em className="text-muted-foreground">unnamed</em>}{" "}
                    <span className="text-muted-foreground">· {priceLabel(o.priceCents)}</span>
                    {o.archived && (
                      <span className="ml-1 text-xs text-muted-foreground">(archived)</span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 gap-3 text-xs">
                  <button
                    className="text-muted-foreground underline"
                    onClick={() => setDialog({ kind: "edit-option", item, option: o })}
                  >
                    Edit
                  </button>
                  <button
                    className="text-muted-foreground underline"
                    onClick={() =>
                      void run(() =>
                        api.patch(`/api/accounts/${slug}/options/${o.id}`, {
                          archived: !o.archived,
                        })
                      )
                    }
                  >
                    {o.archived ? "Restore" : "Archive"}
                  </button>
                </div>
              </div>
            ))}
            <div className="py-2 pl-7">
              <button
                className="text-xs text-muted-foreground underline"
                onClick={() => setDialog({ kind: "add-option", item })}
              >
                + Add option
              </button>
            </div>
          </div>
        </Card>
      ))}

      {archivedCount > 0 && (
        <button
          className="text-sm text-muted-foreground underline"
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived
            ? "Hide archived"
            : `Show archived (${archivedCount})`}
        </button>
      )}

      <PromptDialog
        open={dialog?.kind === "edit-item"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "edit-item" ? `Edit "${dialog.item.name}"` : ""}
        fields={
          dialog?.kind === "edit-item"
            ? [
                { name: "name", label: "Name", defaultValue: dialog.item.name, required: true },
                {
                  name: "description",
                  label: "Description",
                  defaultValue: dialog.item.description,
                },
              ]
            : []
        }
        onSubmit={(values) => {
          if (dialog?.kind !== "edit-item") return;
          void run(() =>
            api.patch(`/api/accounts/${slug}/items/${dialog.item.id}`, {
              name: values.name,
              description: values.description,
            })
          );
        }}
      />
      <PromptDialog
        open={dialog?.kind === "add-option"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "add-option" ? `Add option to "${dialog.item.name}"` : ""}
        description="With multiple options, each needs a name or a price. Think sizes: Large, Small…"
        fields={[
          { name: "name", label: "Option name", placeholder: "Large" },
          { name: "price", label: `Price (${currency}, optional)`, type: "number" },
          { name: "description", label: "Description (optional)" },
        ]}
        submitLabel="Add option"
        onSubmit={(values) => {
          if (dialog?.kind !== "add-option") return;
          void run(() =>
            api.post(`/api/accounts/${slug}/items/${dialog.item.id}/options`, {
              name: values.name.trim() || null,
              description: values.description,
              priceCents: parsePrice(values.price),
            })
          );
        }}
      />
      <PromptDialog
        open={dialog?.kind === "edit-option"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          dialog?.kind === "edit-option"
            ? `Edit ${dialog.option.name ?? "option"} (${dialog.item.name})`
            : ""
        }
        description="Price changes apply to future entries only — recorded tabs keep their prices."
        fields={
          dialog?.kind === "edit-option"
            ? [
                {
                  name: "name",
                  label: "Option name",
                  defaultValue: dialog.option.name ?? "",
                },
                {
                  name: "price",
                  label: `Price (${currency})`,
                  type: "number",
                  defaultValue:
                    dialog.option.priceCents != null
                      ? (dialog.option.priceCents / 100).toFixed(2)
                      : "",
                },
                {
                  name: "description",
                  label: "Description",
                  defaultValue: dialog.option.description,
                },
              ]
            : []
        }
        onSubmit={(values) => {
          if (dialog?.kind !== "edit-option") return;
          void run(() =>
            api.patch(`/api/accounts/${slug}/options/${dialog.option.id}`, {
              name: values.name.trim() || null,
              description: values.description,
              priceCents: parsePrice(values.price),
            })
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SettingsTab({
  slug,
  data,
  onSaved,
}: {
  slug: string;
  data: AccountPageData;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const config = useConfig();
  const [name, setName] = useState(data.account.name);
  const [description, setDescription] = useState(data.account.description);
  const [newSlug, setNewSlug] = useState(data.account.slug);
  const [currency, setCurrency] = useState(data.account.currency);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [managers, setManagers] = useState<{
    owner: { id: string; name: string; email: string } | null;
    managers: { id: string; name: string; email: string }[];
  } | null>(null);
  const [managerEmail, setManagerEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const publicUrl = `${window.location.origin}/accounts/${data.account.slug}`;

  const loadManagers = useCallback(() => {
    api
      .get<NonNullable<typeof managers>>(`/api/accounts/${slug}/managers`)
      .then(setManagers)
      .catch(console.error);
  }, [slug]);
  useEffect(loadManagers, [loadManagers]);

  useEffect(() => {
    QRCode.toDataURL(publicUrl, { width: 512, margin: 2 }).then(setQr).catch(console.error);
  }, [publicUrl]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      const res = await api.patch<{ slug: string }>(`/api/accounts/${slug}`, {
        name,
        description,
        slug: newSlug,
        currency,
      });
      setSaved(true);
      if (res.slug !== slug) navigate(`/accounts/${res.slug}/manage`);
      else onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    }
  }

  async function addManager(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/managers`, { email: managerEmail });
      setManagerEmail("");
      loadManagers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add manager");
    }
  }

  async function removeAccount() {
    await api.del(`/api/accounts/${slug}`);
    navigate("/");
  }

  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>

      <Card>
        <h3 className="mb-3 font-bold">Details</h3>
        <form onSubmit={save} className="space-y-3">
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <Input
            label="URL slug"
            required
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
          />
          <Select
            label="Currency"
            options={config.currencies.map(currencyOption)}
            value={currency}
            onValueChange={setCurrency}
          />
          <div className="flex items-center gap-3">
            <Button type="submit">Save</Button>
            {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Share</h3>
        <p className="mb-3 break-all text-sm text-muted-foreground">{publicUrl}</p>
        {qr && (
          <div className="flex flex-col items-start gap-2">
            <img src={qr} alt="QR code for account page" className="w-40 rounded-lg border" />
            <a
              href={qr}
              download={`${data.account.slug}-qr.png`}
              className="text-sm font-semibold underline"
            >
              Download QR code
            </a>
          </div>
        )}
        <div className="mt-3 border-t border-border pt-3">
          <a href={`/api/accounts/${slug}/export.csv`} className="text-sm font-semibold underline">
            Export ledger as CSV
          </a>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Managers</h3>
        {managers?.owner && (
          <p className="text-sm">
            <strong>{managers.owner.name}</strong>{" "}
            <span className="text-xs text-muted-foreground">owner · {managers.owner.email}</span>
          </p>
        )}
        {managers?.managers.map((m) => (
          <p key={m.id} className="mt-1 flex items-center justify-between text-sm">
            <span>
              <strong>{m.name}</strong>{" "}
              <span className="text-xs text-muted-foreground">{m.email}</span>
            </span>
            {data.isOwner && (
              <button
                className="text-xs text-red-700 underline"
                onClick={() =>
                  void api.del(`/api/accounts/${slug}/managers/${m.id}`).then(loadManagers)
                }
              >
                remove
              </button>
            )}
          </p>
        ))}
        {data.isOwner && (
          <form onSubmit={addManager} className="mt-3 flex gap-2">
            <div className="flex-1">
              <Input
                type="email"
                required
                placeholder="friend@example.com"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        )}
      </Card>

      {data.isOwner && (
        <Card className="border-destructive/30">
          <h3 className="mb-2 font-bold text-destructive">Danger zone</h3>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete account
          </Button>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`Delete "${data.account.name}"?`}
            description="This deletes the account and its entire ledger — every tab, entry, and payment. This cannot be undone."
            confirmLabel="Delete account"
            destructive
            onConfirm={() => void removeAccount()}
          />
        </Card>
      )}
    </div>
  );
}
