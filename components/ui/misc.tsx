"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/lib/types";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent opacity-60", className)}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 text-[10.5px] font-semibold text-ink-3", className)}>
      {children}
    </kbd>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-[var(--radius-panel)] border border-dashed border-line px-5 py-6", className)}>
      {Icon ? <Icon className="h-5 w-5 text-ink-3" /> : null}
      <p className="text-sm font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bars: number }> = {
  urgent: { label: "Urgente", color: "var(--danger)", bars: 3 },
  high: { label: "Haute", color: "var(--warning)", bars: 3 },
  normal: { label: "Normale", color: "var(--text-3)", bars: 2 },
  low: { label: "Basse", color: "var(--text-3)", bars: 1 },
};

/** Three-bar signal glyph — readable without colour. */
export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const m = PRIORITY_META[priority];
  if (priority === "urgent")
    return (
      <svg viewBox="0 0 14 14" className={cn("h-3.5 w-3.5", className)} aria-label={m.label}>
        <rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill={m.color} />
        <rect x="6.25" y="3" width="1.5" height="5" rx="0.75" fill="#fff" />
        <circle cx="7" cy="10.4" r="0.95" fill="#fff" />
      </svg>
    );
  return (
    <svg viewBox="0 0 14 14" className={cn("h-3.5 w-3.5", className)} aria-label={m.label}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3.5} width="3" height={3.5 + i * 3.5} rx="1" fill={i < m.bars ? m.color : "var(--border-strong)"} />
      ))}
    </svg>
  );
}

export function TaskCheck({
  checked,
  onChange,
  priority = "normal",
  size = "md",
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  priority?: TaskPriority;
  size?: "sm" | "md";
  label: string;
}) {
  const ring = priority === "urgent" ? "var(--danger)" : priority === "high" ? "var(--warning)" : "var(--border-strong)";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "group/check relative flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all",
        size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]",
        checked ? "border-accent bg-accent" : "hover:bg-accent-soft",
      )}
      style={checked ? undefined : { borderColor: ring }}
    >
      <Check
        strokeWidth={3}
        className={cn("h-2.5 w-2.5 transition-opacity", checked ? "text-accent-fg opacity-100" : "text-ink-3 opacity-0 group-hover/check:opacity-60")}
      />
    </button>
  );
}

export function Badge({ children, tone = "default", className }: { children: React.ReactNode; tone?: "default" | "danger" | "warning" | "accent" | "muted"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-[11.5px] font-semibold tabular",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "accent" && "bg-accent-soft text-accent-text",
        tone === "muted" && "text-ink-3",
        tone === "default" && "bg-surface-2 text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-[var(--radius-ctl)] bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] px-2.5 font-semibold transition-colors",
            size === "sm" ? "h-6 text-xs" : "h-7 text-xs md:text-[12.5px]",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SWATCHES = ["#5E17EB", "#3E7BFA", "#12A594", "#2F9E44", "#F5A524", "#E5484D", "#D6409F", "#8B8D98", "#1B1B1B"];

export function SwatchPicker({ value, onChange }: { value: string | null | undefined; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Couleur ${c}`}
          aria-pressed={value?.toLowerCase() === c.toLowerCase()}
          onClick={() => onChange(c)}
          className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition", value?.toLowerCase() === c.toLowerCase() ? "ring-2 ring-ink" : "hover:scale-110")}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
