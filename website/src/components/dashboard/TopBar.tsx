"use client";

import { COMPOUND_LABEL, levelFor } from "@/lib/format";
import { useRaceStore, useSnapshot } from "@/lib/store";
import { getTrack, TRACK_KEYS } from "@/lib/track";
import { StatusDot } from "@/components/ui/Readouts";

const SPEEDS = [1, 4, 16];

export function TopBar() {
  const t = useSnapshot((f) => f);
  const running = useRaceStore((s) => s.control.running);
  const multiplier = useRaceStore((s) => s.control.speedMultiplier);
  const toggleRunning = useRaceStore((s) => s.toggleRunning);
  const setSpeedMultiplier = useRaceStore((s) => s.setSpeedMultiplier);
  const reset = useRaceStore((s) => s.reset);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-pit-border bg-pit-panel/60 px-4 py-2">
      <span className="flex items-center gap-2 text-[12px]">
        <StatusDot level={t.status === "live" ? "ok" : "warn"} />
        <span className="tracking-[0.14em] text-ink uppercase">{t.status}</span>
      </span>

      <Field label="Lap" value={`${t.lap} / ${t.totalLaps}`} />
      <Field label="Fuel" value={`${t.fuel.remainingKg.toFixed(1)} kg`} />
      <Field
        label="Tyres"
        value={`${t.tyres.wearPct.toFixed(0)}% ${COMPOUND_LABEL[t.tyres.compound]}`}
        level={levelFor(t.tyres.wearPct, 45, 62)}
      />
      <Field label="ERS" value={`${t.ers.socPct.toFixed(0)}%`} />
      <Field
        label="Weather"
        value={`${t.weather.airTempC.toFixed(0)}°C ${t.weather.condition}`}
      />

      <div className="ml-auto flex items-center gap-2">
        <TrackPicker />
        <div className="flex items-center overflow-hidden rounded border border-pit-border">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeedMultiplier(s)}
              className={`tnum px-2 py-1 text-[11px] ${
                multiplier === s
                  ? "bg-[#252525] text-ink"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <button
          onClick={toggleRunning}
          className="rounded border border-pit-border px-2 py-1 text-[11px] text-ink-secondary hover:text-ink"
        >
          {running ? "Pause" : "Resume"}
        </button>
        <button
          onClick={reset}
          className="rounded border border-pit-border px-2 py-1 text-[11px] text-ink-secondary hover:text-ink"
        >
          Reset
        </button>
      </div>
    </header>
  );
}

/** Tracks come from /data/tracks; switching restarts the race. */
function TrackPicker() {
  const trackKey = useRaceStore((s) => s.trackKey);
  const setTrack = useRaceStore((s) => s.setTrack);

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">
        Track
      </span>
      <select
        value={trackKey}
        onChange={(e) => setTrack(e.target.value)}
        className="rounded border border-pit-border bg-pit-panel px-1.5 py-1 text-[11px] text-ink outline-none hover:border-ink focus:border-ink"
      >
        {TRACK_KEYS.map((key) => {
          const t = getTrack(key);
          return (
            <option key={key} value={key}>
              {t.name} · {(t.lengthM / 1000).toFixed(2)} km
            </option>
          );
        })}
      </select>
    </label>
  );
}

function Field({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level?: "ok" | "warn" | "crit";
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="flex items-center gap-1.5">
        {level && <StatusDot level={level} />}
        <span className="tnum text-[13px] text-ink">{value}</span>
      </span>
    </span>
  );
}

