import { cn } from "@vidyam/ui/lib/utils";

/** How much of a limit is used: a thin bar with its label; past the limit, in the warning colour. */
export function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const share = max > 0 ? Math.min(1, value / max) : 1;
  const over = value >= max;
  return (
    <div className="space-y-1">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div
          className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
