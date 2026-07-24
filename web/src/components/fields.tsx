import { useId, type ComponentProps, type ReactNode } from "react";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input as UiInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * App-level wrappers over the shadcn/ui primitives: a padded Card, a Button
 * with the app's variant names, and label-included form fields.
 */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  // shadcn's Card base is a flex column; reset to plain block flow so
  // call-site layout classes behave like a regular div.
  return <UiCard className={cn("block flex-row gap-0 p-4", className)}>{children}</UiCard>;
}

const VARIANT_MAP = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
} as const;

export function Button({
  variant = "primary",
  ...props
}: Omit<ComponentProps<typeof UiButton>, "variant"> & {
  variant?: keyof typeof VARIANT_MAP;
}) {
  return <UiButton variant={VARIANT_MAP[variant]} {...props} />;
}

export function Input({
  label,
  ...props
}: ComponentProps<typeof UiInput> & { label?: string }) {
  const id = useId();
  if (!label) return <UiInput {...props} />;
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id ?? id}>{label}</Label>
      <UiInput id={props.id ?? id} {...props} />
    </div>
  );
}

export function Select({
  label,
  options,
  value,
  onValueChange,
}: {
  label?: string;
  options: string[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const id = useId();
  const select = (
    <UiSelect value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </UiSelect>
  );
  if (!label) return select;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {select}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  );
}
