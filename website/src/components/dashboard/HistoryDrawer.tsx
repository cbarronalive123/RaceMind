"use client";

import { useEffect, useMemo, useState } from "react";

import { Rate, SPEEDS, useReplaySource } from "@/lib/explore/source";
import { lapTime } from "@/lib/format";

/**
 * Historical runs, docked under the live telemetry.
 *
 * Isolation is the point. This component touches `useRaceStore` nowhere: a
 * replayed frame cannot reach the alert rules, the anomaly approval queue, or
 * the Gemma feed, because it never enters the live store at all. Recorded
 * alerts render here as a read-only record of what fired during that race, and
 * carry no approve or dismiss actions.
 *
 * It is also styled to be unmistakable — hatched chrome, a dashed edge, a
 * REPLAY wordmark and an archive clock rather than a live status light — so
 * nobody glancing at the pit wall mistakes a recording for the car on track.
 */

interface RunMeta {
  track_key: string;
  track_name: string;
  total_laps: number;
  duration_s: number;
  fastest_lap_s: number | null;
  fuel_used_kg: number;
  final_tyre_wear_pct: number;
  alerts_by_tier: Record<string, number>;
}

interface RunLap {
  lap: number;
  total: number;
  delta_to_target_s: number;
  wear_pct: number;
}

interface RunAlert {
  id: string;
  tier: "2a" | "2b" | "2c";
  severity: string;
  lap: number;
  title: string;
  message: string;
  status: "pending" | "sent" | "dismissed";
}

interface RunDetail {
  meta: RunMeta;
  laps: RunLap[];
  alerts: RunAlert[];
}

/** What each archive file covers, so nobody reads a partial file as a whole race. */
const RATES: { key: Rate; label: string; coverage: string }[] = [
  { key: "1hz", label: "1 Hz", coverage: "whole race" },
  { key: "10hz", label: "10 Hz", coverage: "first 3 laps" },
];

export function HistoryDrawer() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((body: { runs: RunMeta[] }) => {
        setRuns(body.runs);
        setSelected((current) => current ?? body.runs[0]?.track_key ?? null);
      })
      .catch(() => setRuns([]));
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="replay-hatch flex shrink-0 items-center gap-3 rounded-md border border-dashed border-pit-border bg-pit-black px-3 py-2 text-left hover:border-ink-secondary"
      >
        <span className="text-[11px] tracking-[0.16em] text-ink-secondary uppercase">
          Historical runs
        </span>
        <span className="tnum text-[11px] text-ink-muted">
          {runs.length
            ? `${runs.length} recorded · ${runs.reduce((n, r) => n + r.total_laps, 0)} laps`
            : "loading"}
        </span>
        <span className="ml-auto text-[11px] text-ink-secondary">Expand ▲</span>
      </button>
    );
  }

  return (
    <section
      className="absolute inset-0 z-10 flex flex-col rounded-md border border-dashed border-ink-muted bg-pit-black shadow-[0_-12px_32px_rgba(0,0,0,0.8)]"
      aria-label="Historical runs, recorded archive"
    >
      <Header
        runs={runs}
        selected={selected}
        onSelect={setSelected}
        onClose={() => setOpen(false)}
      />
      {selected ? (
        <RunReview trackKey={selected} />
      ) : (
        <p className="p-4 text-[12px] text-ink-muted">
          No recorded runs. Generate them with{" "}
          <code className="text-ink-secondary">npm run generate:data</code>.
        </p>
      )}
    </section>
  );
}

function Header({
  runs,
  selected,
  onSelect,
  onClose,
}: {
  runs: RunMeta[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <header className="replay-hatch flex shrink-0 items-center gap-3 border-b border-dashed border-ink-muted px-3 py-2">
      {/* A square, not the round live status light. Different shape reads as a
          different kind of thing even before the label is read. */}
      <span aria-hidden className="size-2 shrink-0 bg-ink-secondary" />
      <span className="text-[11px] font-medium tracking-[0.18em] text-ink uppercase">
        Replay
      </span>
      <span className="text-[11px] text-ink-muted">recorded archive</span>

      <label className="ml-3 flex items-center gap-1.5">
        <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">
          Run
        </span>
        <select
          value={selected ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded border border-pit-border bg-pit-panel px-1.5 py-1 text-[11px] text-ink outline-none hover:border-ink focus:border-ink"
        >
          {runs.map((r) => (
            <option key={r.track_key} value={r.track_key}>
              {r.track_name} · {r.total_laps} laps
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={onClose}
        className="ml-auto rounded border border-pit-border px-2 py-1 text-[11px] text-ink-secondary hover:text-ink"
      >
        Collapse ▼
      </button>
    </header>
  );
}

function RunReview({ trackKey }: { trackKey: string }) {
  const [rate, setRate] = useState<Rate>("1hz");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetch(`/api/runs/${trackKey}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "request failed");
        return r.json();
      })
      .then((body: RunDetail) => !cancelled && setDetail(body))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [trackKey]);

  const source = useReplaySource(trackKey, rate);
  const frame = source.frames[source.frames.length - 1];

  if (error) {
    return <p className="p-4 text-[12px] text-ink-muted">{error}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Summary meta={detail?.meta} />
      <Transport source={source} rate={rate} setRate={setRate} frame={frame} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <Channels frame={frame} />
        <LapTable laps={detail?.laps ?? []} currentLap={frame?.lap} />
        <AlertRecord alerts={detail?.alerts ?? []} currentLap={frame?.lap} />
      </div>
    </div>
  );
}

function Summary({ meta }: { meta?: RunMeta }) {
  if (!meta) {
    return (
      <div className="shrink-0 border-b border-pit-border px-3 py-2 text-[11px] text-ink-muted">
        Loading run…
      </div>
    );
  }
  const tiers = meta.alerts_by_tier;
  return (
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-pit-border px-3 py-2">
      <Stat label="Laps" value={String(meta.total_laps)} />
      <Stat label="Duration" value={`${Math.round(meta.duration_s / 60)} min`} />
      <Stat
        label="Fastest"
        value={meta.fastest_lap_s ? lapTime(meta.fastest_lap_s) : "—"}
      />
      <Stat label="Fuel used" value={`${meta.fuel_used_kg.toFixed(1)} kg`} />
      <Stat label="Final wear" value={`${meta.final_tyre_wear_pct.toFixed(0)}%`} />
      <Stat
        label="Alerts"
        value={`${tiers["2a"] ?? 0} · ${tiers["2b"] ?? 0} · ${tiers["2c"] ?? 0}`}
        hint="2a · 2b · 2c"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="tnum text-[12px] text-ink">{value}</span>
      {hint && <span className="text-[9px] text-ink-muted">{hint}</span>}
    </span>
  );
}

function Transport({
  source,
  rate,
  setRate,
  frame,
}: {
  source: ReturnType<typeof useReplaySource>;
  rate: Rate;
  setRate: (r: Rate) => void;
  frame?: { t: number; lap: number };
}) {
  const coverage = RATES.find((r) => r.key === rate)?.coverage ?? "";
  const clock = frame ? formatClock(frame.t) : "--:--";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-pit-border px-3 py-2">
      <button
        onClick={() => source.setPlaying(!source.playing)}
        disabled={source.state !== "ready"}
        className="w-20 rounded border border-ink px-3 py-1.5 text-[11px] tracking-[0.12em] text-ink uppercase hover:bg-[#1c1c1c] disabled:border-pit-border disabled:text-ink-muted"
      >
        {source.playing ? "Pause" : "Play"}
      </button>

      {/* Archive clock, not a wall clock: this is time within the recording. */}
      <span className="tnum text-[12px] text-ink">{clock}</span>
      <span className="tnum text-[11px] text-ink-secondary">
        Lap {frame?.lap ?? "—"}
      </span>

      <input
        type="range"
        min={0}
        max={Math.max(0, source.total - 1)}
        value={Math.max(0, source.playhead)}
        onChange={(e) => source.seek?.(Number(e.target.value))}
        disabled={source.state !== "ready"}
        aria-label="Scrub through the recording"
        className="h-1 min-w-[140px] flex-1 accent-white"
      />

      <div className="flex items-center overflow-hidden rounded border border-pit-border">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => source.setSpeed(s)}
            className={`tnum px-2 py-1 text-[11px] ${
              source.speed === s
                ? "bg-[#252525] text-ink"
                : "text-ink-secondary hover:text-ink"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <label className="flex items-center gap-1.5">
        <select
          value={rate}
          onChange={(e) => setRate(e.target.value as Rate)}
          className="rounded border border-pit-border bg-pit-panel px-1.5 py-1 text-[11px] text-ink outline-none hover:border-ink focus:border-ink"
        >
          {RATES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-ink-muted">{coverage}</span>
      </label>
    </div>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ReplayFrame = NonNullable<
  ReturnType<typeof useReplaySource>["frames"][number]
>;

function Channels({ frame }: { frame?: ReplayFrame }) {
  return (
    <Pane title="Channels at playhead">
      {!frame ? (
        <p className="text-[11px] text-ink-muted">No frame.</p>
      ) : (
        <div className="space-y-0.5">
          <Row label="Speed" value={`${frame.speed_kmh.toFixed(0)} km/h`} />
          <Row label="Gear" value={String(frame.gear)} />
          <Row label="Throttle" value={`${frame.throttle_pct.toFixed(0)}%`} />
          <Row label="Brake" value={`${frame.brake_pct.toFixed(0)}%`} />
          <Row
            label="Tyres"
            value={`${frame.tyres.wear_pct.toFixed(1)}% ${frame.tyres.compound}`}
          />
          <Row
            label="Tyre temp"
            value={`${frame.tyres.temps_c.fl.toFixed(0)}/${frame.tyres.temps_c.fr.toFixed(0)}°C`}
          />
          <Row label="Fuel" value={`${frame.fuel.remaining_kg.toFixed(1)} kg`} />
          <Row label="ERS" value={`${frame.ers.soc_pct.toFixed(0)}%`} />
          <Row
            label="Brakes"
            value={`${frame.brakes.temps_c.fl.toFixed(0)}°C`}
          />
          <Row label="Sector" value={String(frame.sector)} />
        </div>
      )}
    </Pane>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[2px]">
      <span className="text-[11px] text-ink-secondary">{label}</span>
      <span className="tnum text-[12px] text-ink">{value}</span>
    </div>
  );
}

function LapTable({
  laps,
  currentLap,
}: {
  laps: RunLap[];
  currentLap?: number;
}) {
  return (
    <Pane title={`Laps (${laps.length})`}>
      {laps.length === 0 ? (
        <p className="text-[11px] text-ink-muted">Loading laps…</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[10px] tracking-[0.1em] text-ink-muted uppercase">
              <th className="px-1 py-1 font-medium">Lap</th>
              <th className="px-1 py-1 font-medium">Total</th>
              <th className="px-1 py-1 font-medium">Wear</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr
                key={l.lap}
                className={`tnum border-t border-pit-border/60 text-[11px] ${
                  l.lap === currentLap ? "bg-[#1e1e1e] text-ink" : "text-ink-body"
                }`}
              >
                <td className="px-1 py-0.5">{l.lap}</td>
                <td className="px-1 py-0.5">{lapTime(l.total)}</td>
                <td className="px-1 py-0.5">{l.wear_pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Pane>
  );
}

const OUTCOME: Record<RunAlert["status"], string> = {
  sent: "reached driver",
  dismissed: "dismissed",
  pending: "never actioned",
};

function AlertRecord({
  alerts,
  currentLap,
}: {
  alerts: RunAlert[];
  currentLap?: number;
}) {
  // Only what had already fired by the playhead, so the record reads forward
  // through the race rather than spoiling what is about to happen.
  const shown = useMemo(
    () =>
      currentLap === undefined
        ? alerts
        : alerts.filter((a) => a.lap <= currentLap),
    [alerts, currentLap],
  );

  return (
    <Pane title={`Alert record (${shown.length} of ${alerts.length})`}>
      {shown.length === 0 ? (
        <p className="text-[11px] text-ink-muted">
          Nothing fired yet at this point in the recording.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {[...shown].reverse().map((a) => (
            <li key={a.id} className="border-b border-pit-border/60 pb-1.5">
              <div className="flex items-baseline gap-2">
                <span className="tnum text-[10px] text-ink-muted">L{a.lap}</span>
                <span className="text-[10px] text-ink-secondary">{a.tier}</span>
                <span className="flex-1 truncate text-[11px] text-ink">
                  {a.title}
                </span>
                <span className="text-[9px] text-ink-muted">
                  {OUTCOME[a.status]}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-secondary">
                {a.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col rounded border border-pit-border bg-pit-panel/60">
      <div className="shrink-0 border-b border-pit-border px-2.5 py-1.5 text-[10px] tracking-[0.14em] text-ink-secondary uppercase">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">{children}</div>
    </div>
  );
}
