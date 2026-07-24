const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: "$",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "$",
  NZD: "$",
  CHF: "Fr",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
};

/** Dropdown label like "$ (CAD)". */
export function currencyOption(code: string): { value: string; label: string } {
  const symbol = CURRENCY_SYMBOLS[code] ?? code;
  return { value: code, label: `${symbol} (${code})` };
}

export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/** "$12.50", "$12.50 + 3 items", or "3 items" depending on what's owed. */
export function balanceLabel(
  balanceCents: number,
  unpricedCount: number,
  currency: string
): string {
  const parts: string[] = [];
  if (balanceCents !== 0 || unpricedCount === 0) parts.push(money(balanceCents, currency));
  if (unpricedCount !== 0)
    parts.push(`${unpricedCount} item${Math.abs(unpricedCount) === 1 ? "" : "s"}`);
  return parts.join(" + ");
}

export function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
