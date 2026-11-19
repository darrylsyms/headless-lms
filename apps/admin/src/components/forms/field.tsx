import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One field layout for every form: label, control, optional hint, and an
 * inline validation error. Keeps Zod errors visually consistent everywhere.
 */
export function Field({
  id,
  label,
  labelAside,
  error,
  hint,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  labelAside?: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {labelAside ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={id}>{label}{required && <span className="text-danger">*</span>}</Label>
          {labelAside}
        </div>
      ) : (
        <Label htmlFor={id}>{label}{required && <span className="text-danger">*</span>}</Label>
      )}
      {children}
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : hint ? (
        <p className="text-sm text-ink-4 text-pretty">{hint}</p>
      ) : null}
    </div>
  );
}
