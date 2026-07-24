import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useConfig } from "../App";
import { api, ApiError } from "../lib/api";
import { Button, Card, ErrorNote, Input, Select } from "../components/fields";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export default function NewAccount() {
  const navigate = useNavigate();
  const config = useConfig();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState(config.defaultCurrency);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post<{ slug: string }>("/api/accounts", {
        name,
        slug,
        description,
        currency,
      });
      navigate(`/accounts/${res.slug}/manage`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-bold">New account</h1>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Name"
            required
            value={name}
            placeholder="Home"
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
          <Input
            label="Custom URL slug"
            required
            value={slug}
            placeholder="sample-home"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
          {slug && (
            <p className="-mt-2 text-xs text-stone-500">
              Your account will live at <code>/accounts/{slug}</code>
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="The Guinness keg in the garage"
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-2 focus:ring-amber-300/50"
            />
          </label>
          <Select
            label="Currency"
            options={config.currencies}
            value={currency}
            onValueChange={setCurrency}
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
