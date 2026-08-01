import { ReactNode } from "react";
import { STATUS_COLOR, StatusLevel } from "@/lib/format";

export function StatusDot({
  level = "ok",
  className = "",
}: {
  level?: StatusLevel;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: STATUS_COLOR[level] }}
    />
  );
}

/** Label on the left, monospaced value on the right. */
export function Metric({
  label,
  value,
  unit,
  level,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  level?: StatusLevel;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-ink-secondary">{label}</span>
      <span className="flex items-center gap-1.5">
        {level && <StatusDot level={level} />}
        <span className="tnum text-[13px] text-ink">{value}</span>
        {unit && <span className="text-[10px] text-ink-muted">{unit}</span>}
      </span>
    </div>
  );
}

/**
 * Horizontal bar. `color` is a data-viz colour; the track and label stay grey
 * so colour only ever carries meaning.
 */
export function Bar({
  value,
  max = 100,
  color = "#e0e0e0",
  height = 8,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className="w-full overflow-hidden rounded-sm bg-[#1e1e1e]"
      style={{ height }}
      role="presentation"
    >
      <div
        className="h-full rounded-sm transition-[width] duration-100 ease-linear"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function LabeledBar({
  label,
  value,
  display,
  max = 100,
  color,
  level,
}: {
  label: string;
  value: number;
  display: string;
  max?: number;
  color?: string;
  level?: StatusLevel;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-secondary">{label}</span>
        <span className="flex items-center gap-1.5">
          {level && <StatusDot level={level} />}
          <span className="tnum text-[12px] text-ink">{display}</span>
        </span>
      </div>
      <Bar value={value} max={max} color={color ?? (level ? STATUS_COLOR[level] : "#e0e0e0")} />
    </div>
  );
}
