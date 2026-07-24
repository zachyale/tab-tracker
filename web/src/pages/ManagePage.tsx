import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import QRCode from "qrcode";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  api,
  ApiError,
  type AccountPageData,
  type ActivityItem,
  type Member,
  type Option,
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
    { id: "options", label: "Options" },
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
      {tab === "options" && <OptionsTab slug={slug!} currency={data.account.currency} />}
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
          No tabs yet. Share the public link and get pouring.
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
              {data.options.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm">
                  <span>{o.name}</span>
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
                  ? `removed ${h.optionName ?? "an item"}`
                  : `had ${h.optionName ?? "an item"}${
                      h.amountCents != null ? ` (${money(h.amountCents, currency)})` : ""
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

function OptionsTab({ slug, currency }: { slug: string; currency: string }) {
  const [options, setOptions] = useState<(Option & { archived: boolean })[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [priceDialog, setPriceDialog] = useState<Option | null>(null);

  const load = useCallback(() => {
    api
      .get<{ options: (Option & { archived: boolean })[] }>(`/api/accounts/${slug}/options`)
      .then((r) => setOptions(r.options))
      .catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    const priceCents = price.trim() === "" ? null : Math.round(parseFloat(price) * 100);
    try {
      await api.post(`/api/accounts/${slug}/options`, { name, description, priceCents });
      setName("");
      setDescription("");
      setPrice("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function update(id: string, patch: Record<string, unknown>) {
    setError("");
    try {
      await api.patch(`/api/accounts/${slug}/options/${id}`, patch);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function move(index: number, delta: -1 | 1) {
    if (!options) return;
    const ids = options.map((o) => o.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Optimistic reorder for a snappy feel
    setOptions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setError("");
    try {
      await api.put(`/api/accounts/${slug}/options/order`, { optionIds: ids });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reorder");
      load();
    }
  }

  if (!options) return <Spinner />;

  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>
      <Card>
        <form onSubmit={add} className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                label="New option"
                required
                placeholder="Guinness pint"
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
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit">Add option</Button>
        </form>
      </Card>

      {options.map((o, i) => (
        <Card key={o.id} className={`flex items-center justify-between gap-2 ${o.archived ? "opacity-50" : ""}`}>
          <div className="flex shrink-0 flex-col">
            <button
              aria-label={`Move ${o.name} up`}
              disabled={i === 0}
              onClick={() => void move(i, -1)}
              className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              aria-label={`Move ${o.name} down`}
              disabled={i === options.length - 1}
              onClick={() => void move(i, 1)}
              className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              {o.name}
              {o.archived && <span className="ml-2 text-xs text-muted-foreground">archived</span>}
            </div>
            {o.description && <div className="truncate text-xs text-muted-foreground">{o.description}</div>}
            <div className="text-sm text-muted-foreground">
              {o.priceCents != null ? money(o.priceCents, currency) : "no price"}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={() => setPriceDialog(o)}>
              Price
            </Button>
            <Button variant="secondary" onClick={() => void update(o.id, { archived: !o.archived })}>
              {o.archived ? "Restore" : "Archive"}
            </Button>
          </div>
        </Card>
      ))}

      <PromptDialog
        open={priceDialog !== null}
        onOpenChange={(o) => !o && setPriceDialog(null)}
        title={priceDialog ? `Set price for "${priceDialog.name}"` : ""}
        description="Leave blank for no price. Existing tabs keep the prices recorded at the time of each drink."
        fields={
          priceDialog
            ? [
                {
                  name: "price",
                  label: `Price (${currency})`,
                  type: "number",
                  placeholder: "none",
                  defaultValue:
                    priceDialog.priceCents != null
                      ? (priceDialog.priceCents / 100).toFixed(2)
                      : "",
                },
              ]
            : []
        }
        onSubmit={(values) => {
          if (!priceDialog) return;
          const raw = values.price.trim();
          const priceCents = raw === "" ? null : Math.round(parseFloat(raw) * 100);
          if (priceCents !== null && !Number.isFinite(priceCents)) return;
          void update(priceDialog.id, { priceCents });
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
            description="This deletes the account and its entire ledger — every tab, drink, and payment. This cannot be undone."
            confirmLabel="Delete account"
            destructive
            onConfirm={() => void removeAccount()}
          />
        </Card>
      )}
    </div>
  );
}
