import { useCallback, useEffect, useState, type FormEvent } from "react";
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{data.account.name}</h1>
          <Link to={`/accounts/${slug}`} className="text-sm text-muted-foreground underline">
            View public page
          </Link>
        </div>
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
  | { kind: "edit"; member: Member }
  | { kind: "link"; member: Member }
  | { kind: "remove"; member: Member }
  | {
      kind: "overpay";
      payment: { userId: string; amountCents: number; note: string };
      balanceCents: number;
    }
  | null;

function MembersTab({ slug, data }: { slug: string; data: AccountPageData }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<MemberDialog>(null);
  const [error, setError] = useState("");
  const currency = data.account.currency;

  const load = useCallback(() => {
    api
      .get<{ members: Member[] }>(`/api/accounts/${slug}/members`)
      .then((r) => setMembers(r.members))
      .catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load]);

  async function adjust(userId: string, optionId: string, action: "increment" | "decrement") {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/entries`, { optionId, action, userId });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function addGhost(name: string, email: string) {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/ghosts`, { name, email: email || null });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function editGhost(m: Member, values: Record<string, string>) {
    setError("");
    try {
      await api.patch(`/api/accounts/${slug}/ghosts/${m.id}`, {
        name: values.name,
        email: values.email.trim() || null,
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function linkGhost(m: Member, email: string) {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/ghosts/${m.id}/link`, { email: email.trim() });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function removeGhost(m: Member) {
    setError("");
    try {
      await api.del(`/api/accounts/${slug}/ghosts/${m.id}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function recordCharge(userId: string, amountCents: number, note: string) {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/charges`, { userId, amountCents, note });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function recordPayment(userId: string, amountCents: number, note: string) {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/payments`, { userId, amountCents, note });
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.requiresConfirmation) {
        setDialog({
          kind: "overpay",
          payment: { userId, amountCents, note },
          balanceCents: (e.data.balanceCents as number) ?? 0,
        });
      } else {
        setError(e instanceof ApiError ? e.message : "Failed");
      }
    }
  }

  async function confirmOverpay(payment: { userId: string; amountCents: number; note: string }) {
    setError("");
    try {
      await api.post(`/api/accounts/${slug}/payments`, { ...payment, allowNegative: true });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  if (!members) return <Spinner />;

  return (
    <div className="space-y-2">
      <ErrorNote>{error}</ErrorNote>
      {members.length === 0 && (
        <Card className="text-sm text-muted-foreground">
          No tabs yet. Share the public link to get started.
        </Card>
      )}
      {members.map((m) => (
        <Card key={m.id} className="space-y-3">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setExpanded(expanded === m.id ? null : m.id)}
          >
            <div>
              <div className="font-semibold">
                {m.name}
                {m.isGhost && (
                  <Badge variant="secondary" className="ml-2">
                    👻 ghost
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
            </div>
            <span
              className={`font-bold ${
                m.balanceCents > 0 || m.unpricedCount > 0 ? "text-red-700" : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {balanceLabel(m.balanceCents, m.unpricedCount, currency)}
            </span>
          </button>

          {expanded === m.id && (
            <div className="space-y-3 border-t border-border pt-3">
              {flattenItems(data.items).map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm">
                  <span>{o.label}</span>
                  <span className="flex items-center gap-2">
                    <button
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
                      onClick={() => void adjust(m.id, o.id, "increment")}
                      className="grid size-8 place-items-center rounded-full bg-primary font-bold text-primary-foreground"
                    >
                      +
                    </button>
                  </span>
                </div>
              ))}
              <PaymentForm
                currency={currency}
                balanceCents={m.balanceCents}
                onPayment={(cents, note) => void recordPayment(m.id, cents, note)}
                onCharge={(cents, note) => void recordCharge(m.id, cents, note)}
              />
              {m.isGhost && (
                <div className="flex gap-3 text-xs">
                  <button
                    className="text-muted-foreground underline"
                    onClick={() => setDialog({ kind: "edit", member: m })}
                  >
                    Edit ghost
                  </button>
                  <button
                    className="text-muted-foreground underline"
                    onClick={() => setDialog({ kind: "link", member: m })}
                  >
                    Link to user
                  </button>
                  <button
                    className="text-destructive underline"
                    onClick={() => setDialog({ kind: "remove", member: m })}
                  >
                    Remove ghost
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
      <AddGhostForm onAdd={(name, email) => void addGhost(name, email)} />

      <PromptDialog
        open={dialog?.kind === "edit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Edit ghost member"
        description="If you set an email, their tab transfers automatically when that email registers."
        fields={
          dialog?.kind === "edit"
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
        onSubmit={(values) => dialog?.kind === "edit" && void editGhost(dialog.member, values)}
      />
      <PromptDialog
        open={dialog?.kind === "link"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "link" ? `Link "${dialog.member.name}" to a user` : ""}
        description="Their tab — balance and full history — will transfer to the registered user's account, and the ghost will be removed."
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
        onSubmit={(values) => dialog?.kind === "link" && void linkGhost(dialog.member, values.email)}
      />
      <ConfirmDialog
        open={dialog?.kind === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Remove ghost member?"
        description={
          dialog?.kind === "remove"
            ? `This deletes "${dialog.member.name}" and their entire tab history. This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => dialog?.kind === "remove" && void removeGhost(dialog.member)}
      />
      <ConfirmDialog
        open={dialog?.kind === "overpay"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Record payment above balance?"
        description={
          dialog?.kind === "overpay"
            ? `This payment is more than their current balance (${money(
                dialog.balanceCents,
                currency
              )}). Recording it will leave them in credit.`
            : ""
        }
        confirmLabel="Record anyway"
        onConfirm={() => dialog?.kind === "overpay" && void confirmOverpay(dialog.payment)}
      />
    </div>
  );
}

function AddGhostForm({ onAdd }: { onAdd: (name: string, email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-muted-foreground underline">
        + Add a ghost member (someone who hasn't signed up yet)
      </button>
    );
  }

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(name.trim(), email.trim());
          setName("");
          setEmail("");
          setOpen(false);
        }}
        className="space-y-2"
      >
        <p className="text-sm text-muted-foreground">
          Ghost members let you backfill a tab for someone before they register. If you set
          their email, the tab transfers to them automatically when they sign up with it.
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-40 flex-1">
            <Input
              label="Name"
              required
              placeholder="Dave"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="min-w-40 flex-1">
            <Input
              label="Email (optional)"
              type="email"
              placeholder="dave@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Add ghost</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PaymentForm({
  currency,
  balanceCents,
  onPayment,
  onCharge,
}: {
  currency: string;
  balanceCents: number;
  onPayment: (cents: number, note: string) => void;
  onCharge: (cents: number, note: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function submit(handler: (cents: number, note: string) => void) {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    handler(cents, note);
    setAmount("");
    setNote("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(onPayment);
      }}
      className="flex flex-wrap items-end gap-2 rounded-xl bg-muted/50 p-3"
    >
      <div className="w-28">
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="min-w-32 flex-1">
        <Input
          label="Note"
          placeholder="Venmo, cash, backfill…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button type="submit" variant="secondary">
        Record payment
      </Button>
      <Button type="button" variant="secondary" onClick={() => submit(onCharge)}>
        Add charge
      </Button>
      {balanceCents > 0 && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => setAmount((balanceCents / 100).toFixed(2))}
        >
          settle {money(balanceCents, currency)}
        </button>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------

function ActivityTab({ slug, currency }: { slug: string; currency: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    api
      .get<{ activity: ActivityItem[] }>(`/api/accounts/${slug}/activity`)
      .then((r) => setItems(r.activity))
      .catch(console.error);
  }, [slug]);

  if (!items) return <Spinner />;

  return (
    <Card className="divide-y divide-border p-0">
      {items.length === 0 && <p className="p-3 text-sm text-muted-foreground">No activity yet.</p>}
      {items.map((h) => (
        <div key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0">
            <strong>{h.userName}</strong>{" "}
            {h.kind === "payment"
              ? `paid ${money(h.amountCents ?? 0, currency)}`
              : h.kind === "charge"
                ? `was charged ${money(h.amountCents ?? 0, currency)}`
                : h.kind === "undo"
                  ? `removed ${h.optionName ?? "an item"}${h.count > 1 ? ` ×${h.count}` : ""}`
                  : `had ${h.optionName ?? "an item"}${h.count > 1 ? ` ×${h.count}` : ""}${
                      h.amountCents != null
                        ? ` (${money(h.amountCents * h.count, currency)})`
                        : ""
                    }`}
            {h.byManager && <span className="ml-1 text-xs text-muted-foreground">by {h.actorName}</span>}
            {h.note && <span className="ml-1 text-xs text-muted-foreground">({h.note})</span>}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(h.createdAt)}</span>
        </div>
      ))}
    </Card>
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
