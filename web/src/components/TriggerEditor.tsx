import { useState } from "react";
import { Button, Input } from "./ui";

/**
 * Editor for notification trigger amounts: enable/disable plus an editable
 * list of dollar thresholds. Used for instance defaults (admin) and per-user
 * overrides (dashboard).
 */
export function TriggerEditor({
  enabled: initialEnabled,
  triggersCents: initialTriggers,
  onSave,
  saveLabel = "Save",
}: {
  enabled: boolean;
  triggersCents: number[];
  onSave: (enabled: boolean, triggersCents: number[]) => void;
  saveLabel?: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [triggers, setTriggers] = useState<number[]>(initialTriggers);
  const [newAmount, setNewAmount] = useState("");
  const [dirty, setDirty] = useState(false);

  function addTrigger() {
    const cents = Math.round(parseFloat(newAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    setTriggers((t) => [...new Set([...t, cents])].sort((a, b) => a - b));
    setNewAmount("");
    setDirty(true);
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setDirty(true);
          }}
          className="size-4 accent-stone-900"
        />
        Notifications enabled
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {triggers.length === 0 && (
          <span className="text-sm text-stone-500">No trigger amounts.</span>
        )}
        {triggers.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm font-medium"
          >
            ${(t / 100).toFixed(2)}
            <button
              aria-label={`Remove $${(t / 100).toFixed(2)} trigger`}
              className="text-stone-400 hover:text-red-700"
              onClick={() => {
                setTriggers((prev) => prev.filter((x) => x !== t));
                setDirty(true);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1">
          <div className="w-24">
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="20.00"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTrigger();
                }
              }}
            />
          </div>
          <Button type="button" variant="secondary" onClick={addTrigger}>
            Add
          </Button>
        </div>
      </div>

      <Button type="button" disabled={!dirty} onClick={() => onSave(enabled, triggers)}>
        {saveLabel}
      </Button>
    </div>
  );
}
