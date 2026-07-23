import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-stone-900 text-amber-50 hover:bg-stone-700 disabled:bg-stone-400",
    secondary:
      "border border-stone-300 bg-white text-stone-900 hover:bg-stone-100 disabled:text-stone-400",
    danger: "bg-red-700 text-white hover:bg-red-600 disabled:bg-stone-400",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

export function Input({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input
      {...props}
      className={`w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-2 focus:ring-amber-300/50 ${className}`}
    />
  );
  if (!label) return input;
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {input}
    </label>
  );
}

export function Select({
  label,
  options,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; options: string[] }) {
  const select = (
    <select
      {...props}
      className={`w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-2 focus:ring-amber-300/50 ${className}`}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {select}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="size-6 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
    </div>
  );
}
