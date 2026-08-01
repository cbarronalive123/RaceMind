"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "@/lib/channels";
import { TelemetryFrame } from "@/lib/frame";
import { formatValue, plotSeries, ScaleMode } from "@/lib/explore/series";

interface ChannelChartProps {
  frames: TelemetryFrame[];
  series: { channel: Channel; colour: string }[];
  /** Index into `frames`, or null to follow the newest frame. */
  cursor: number | null;
  onCursor: (index: number | null) => void;
  scale: ScaleMode;
}

/** Height of a row's label line, in pixels. */
const HEADER_H = 17;
/** Vertical inset inside a row's plot, so extremes are not drawn on the edge. */
const PAD = 4;
/** Below this a row is too short to read, so the stack scrolls instead. */
const MIN_ROW_H = 64;

/**
 * Stacked time series, one row per channel.
 *
 * Each row has its own y-axis, because the channels share nothing but time:
 * overlaying fuel in kilograms on rpm in thousands only ever produced a
 * tangle. Rows share the x-axis and a single crosshair, so a spike in one can
 * still be read against the others at the same instant.
 */
export function ChannelChart({
  frames,
  series,
  cursor,
  onCursor,
  scale,
}: ChannelChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const rowCount = Math.max(1, series.length);
  // Rows divide the space evenly until they would be unreadable, past which
  // the stack scrolls rather than shrinking further.
  const rowHeight = Math.max(MIN_ROW_H, height / rowCount);
  const plotHeight = Math.max(1, rowHeight - HEADER_H);

  const plotted = useMemo(
    () =>
      width > 0 && plotHeight > 1
        ? series.map((s) =>
            plotSeries({
              frames,
              channel: s.channel,
              colour: s.colour,
              width,
              height: plotHeight,
              cursor,
              scale,
              pad: PAD,
            }),
          )
        : [],
    [frames, series, width, plotHeight, cursor, scale],
  );

  const indexFromEvent = useCallback(
    (clientX: number) => {
      const el = container.current;
      if (!el || frames.length === 0) return null;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const index = Math.round(ratio * (frames.length - 1));
      return Math.max(0, Math.min(frames.length - 1, index));
    },
    [frames.length],
  );

  const cursorIndex = cursor ?? frames.length - 1;
  const cursorX =
    frames.length > 1 ? (cursorIndex / (frames.length - 1)) * width : width;
  const cursorFrame = frames[cursorIndex];
  const first = frames[0];
  const last = frames[frames.length - 1];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={container}
        className="relative min-h-0 flex-1 cursor-crosshair overflow-x-hidden overflow-y-auto"
        onMouseMove={(e) => onCursor(indexFromEvent(e.clientX))}
        onMouseLeave={() => onCursor(null)}
      >
        {plotted.map((s) => (
          <div
            key={s.channel.id}
            style={{ height: rowHeight }}
            className="relative border-b border-pit-border/60 last:border-b-0"
          >
            <div
              className="flex items-baseline gap-1.5 px-1"
              style={{ height: HEADER_H }}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
                style={{ backgroundColor: s.colour }}
              />
              <span className="text-[11px] text-ink-secondary">
                {s.channel.label}
              </span>
              <span className="tnum text-[12px] text-ink">
                {formatValue(s.channel, s.current)}
              </span>
              <span className="text-[10px] text-ink-muted">
                {s.channel.unit}
              </span>
              <span className="tnum ml-auto text-[10px] text-ink-muted/70">
                {formatValue(s.channel, s.domain[0])} to{" "}
                {formatValue(s.channel, s.domain[1])}
              </span>
            </div>

            <svg
              width={width}
              height={plotHeight}
              className="block"
              aria-label={`${s.channel.label} over time`}
            >
              <line
                x1={0}
                x2={width}
                y1={plotHeight / 2}
                y2={plotHeight / 2}
                stroke="var(--color-pit-border)"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <polyline
                points={s.points}
                fill="none"
                stroke={s.colour}
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {s.current !== null && frames.length > 0 && (
                <circle
                  cx={cursorX}
                  cy={s.toY(s.current)}
                  r={3}
                  fill="var(--color-pit-black)"
                  stroke={s.colour}
                  strokeWidth={1.5}
                />
              )}
            </svg>
          </div>
        ))}

        {/* One crosshair across the whole stack, so rows read at one instant. */}
        {frames.length > 0 && series.length > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-ink-secondary"
            style={{ left: cursorX }}
          />
        )}

        {series.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-muted">
            Select a channel to plot it.
          </div>
        )}
        {series.length > 0 && frames.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-muted">
            Waiting for frames.
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-baseline justify-between border-t border-pit-border px-1 pt-1.5">
        <span className="tnum text-[10px] text-ink-muted">
          {first ? `t+${first.t.toFixed(1)}s` : ""}
        </span>
        <span className="tnum text-[10px] text-ink-secondary">
          {cursorFrame
            ? `t+${cursorFrame.t.toFixed(1)}s · lap ${cursorFrame.lap} · S${cursorFrame.sector}`
            : ""}
        </span>
        <span className="tnum text-[10px] text-ink-muted">
          {last ? `t+${last.t.toFixed(1)}s` : ""}
        </span>
      </div>
    </div>
  );
}
