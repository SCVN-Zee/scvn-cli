/**
 * components/ui/checkbox.tsx — Dependency-free checkbox (shadcn look).
 *
 * A button styled as a checkbox with a lucide check glyph (a dash when
 * indeterminate). Kept free of a Radix dep; consumers drive a plain string[]
 * of selected values.
 */

import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Render the mixed/tri-state look (a dash); implies not fully checked. */
  indeterminate?: boolean;
}

export function Checkbox({ checked, onCheckedChange, id, disabled, className, indeterminate }: CheckboxProps) {
  const state = indeterminate ? "indeterminate" : checked ? "checked" : "unchecked";
  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={indeterminate ? "mixed" : checked}
      disabled={disabled}
      data-slot="checkbox"
      data-state={state}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs outline-none transition-[color,box-shadow] duration-150 ease-[var(--ease-out)]",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {indeterminate ? <Minus className="size-3.5" /> : checked ? <Check className="size-3.5" /> : null}
    </button>
  );
}
