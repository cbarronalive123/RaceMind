"use client";

import { useMemo } from "react";
import { Bar, StatusDot } from "@/components/ui/Readouts";
import { COMPOUND_LABEL, levelFor, severityLevel, signed } from "@/lib/format";
import { useRaceStore, useSnapshot } from "@/lib/store";
import { Alert } from "@/lib/types";

/**
 * Browser rendering of the driver HUD (docs/mobile-app.md, Screen 3).
 * Audio-first in the real app: the screen is a backup, so everything here is
 * sized to be read in under half a second. Phone-width by design.
 */
export function Hud() {
  const t = useSnapshot((f) => f);
  const sent = useMemo(
    () => t.alerts.filter((a) => a.status === "sent"),
    [t.alerts],
  );
  const [current, ...recent] = sent;
  const critical = current?.severity === "critical";

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[430px] flex-1 flex-col overflow-y-auto bg-pit-black">
      <header className="flex items-center justify-between border-b border-pit-border px-4 py-2.5">
        <span className="flex items-center gap-2">
          <StatusDot level={t.status === "live" ? "ok" : "warn"} />
          <span className="text-[12px] tracking-[0.16em] text-ink uppercase">
            {t.status}
          </span>
        </span>
        <span className="tnum text-[13px] text-ink">
          Lap {t.lap} / {t.totalLaps}
        </span>
      </header>

      <SpeedBlock />

      <section
        className={`flex min-h-[190px] flex-1 flex-col border-b border-pit-border px-4 py-3 ${critical ? "hud-flash" : ""}`}
      >
        {current ? (
          <AlertCard alert={current} />
        ) : (
          <p className="text-[13px] text-ink-muted">
            No active call. Gemma is monitoring — you will hear it before you see it.
          </p>
        )}

        <div className="mt-3">
          <div className="text-[10px] tracking-[0.14em] text-ink-muted uppercase">
            Recent
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {recent.slice(0, 3).map((a) => (
              <li key={a.id} className="flex gap-2 text-[12px] leading-snug text-ink-secondary">
                <span className="tnum shrink-0 text-ink-muted">L{a.lap}</span>
                <span className="truncate">{a.message}</span>
              </li>
            ))}
            {recent.length === 0 && (
              <li className="text-[12px] text-ink-muted">Nothing yet.</li>
            )}
          </ul>
        </div>
      </section>

      <Gauges />
      <PitStrip />

      <footer className="mt-auto flex items-center justify-between border-t border-pit-border px-4 py-2.5 text-[11px] text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <StatusDot level="ok" />
          Audio TTS on
        </span>
        <span className="tnum">10 Hz uplink</span>
      </footer>
    </div>
  );
}

function SpeedBlock() {
  const t = useSnapshot((f) => f);
  const onPace = t.deltaToTargetS <= 0;

  return (
    <section className="border-b border-pit-border px-4 py-5 text-center">
      <div className="flex items-end justify-center gap-4">
        <div className="tnum text-[76px] leading-none font-light text-ink">
          {t.speedKmh.toFixed(0)}
        </div>
        <div className="pb-2 text-left">
          <div className="text-[11px] text-ink-secondary">km/h</div>
          <div className="tnum mt-1 flex size-11 items-center justify-center rounded border border-pit-border text-2xl text-ink">
            {t.gear}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Bar value={t.speedKmh} max={330} height={10} />
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <StatusDot level={onPace ? "ok" : "warn"} />
        <span className="tnum text-[15px] text-ink">
          {t.lastLapS ? `${signed(t.deltaToTargetS, 1)}s vs target` : "Out lap"}
        </span>
      </div>
    </section>
  );
}

const TIER_LABEL: Record<Alert["tier"], string> = {
  "2a": "[2a]",
  "2b": "[2b]",
  "2c": "[2c] ✓ VERIFIED",
};

function AlertCard({ alert }: { alert: Alert }) {
  const level = severityLevel(alert.severity);
  return (
    <article className="rounded border border-pit-border bg-pit-panel-2 p-3">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <StatusDot level={level} />
          <span className="text-[11px] tracking-[0.14em] text-ink uppercase">
            {alert.severity}
          </span>
        </span>
        <span className="tnum text-[11px] text-ink-secondary">
          {TIER_LABEL[alert.tier]} · Lap {alert.lap}
        </span>
      </header>
      <p className="mt-2 text-[19px] leading-snug text-ink">{alert.message}</p>
    </article>
  );
}

function Gauges() {
  const t = useSnapshot((f) => f);
  const hottestBrake = Math.max(
    t.brakes.temps.fl,
    t.brakes.temps.fr,
    t.brakes.temps.rl,
    t.brakes.temps.rr,
  );

  return (
    <section className="space-y-3 border-b border-pit-border px-4 py-3">
      <Gauge
        label="Fuel"
        value={t.fuel.remainingKg}
        max={t.fuel.startKg}
        display={`${t.fuel.remainingKg.toFixed(0)} kg`}
        level={t.fuel.lapsRemaining < 3 ? "crit" : t.fuel.lapsRemaining < 6 ? "warn" : "ok"}
      />
      <Gauge
        label={`Tyres · ${COMPOUND_LABEL[t.tyres.compound]}`}
        value={t.tyres.wearPct}
        max={100}
        display={`${t.tyres.wearPct.toFixed(0)}% worn`}
        level={levelFor(t.tyres.wearPct, 45, 62)}
      />
      <Gauge
        label="ERS"
        value={t.ers.socPct}
        max={100}
        display={`${t.ers.socPct.toFixed(0)}%`}
        color="var(--color-data-ers)"
        level={t.ers.socPct < 12 ? "crit" : t.ers.socPct < 30 ? "warn" : "ok"}
      />
      <Gauge
        label="Brakes"
        value={hottestBrake}
        max={1150}
        display={`${hottestBrake.toFixed(0)}°C`}
        level={levelFor(hottestBrake, 820, 1000)}
      />
    </section>
  );
}

function Gauge({
  label,
  value,
  max,
  display,
  level,
  color = "#e0e0e0",
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  level: "ok" | "warn" | "crit";
  color?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-ink-secondary">{label}</span>
        <span className="flex items-center gap-1.5">
          <StatusDot level={level} />
          <span className="tnum text-[14px] text-ink">{display}</span>
        </span>
      </div>
      <div className="mt-1">
        <Bar value={value} max={max} color={color} height={10} />
      </div>
    </div>
  );
}

function PitStrip() {
  const pitStop = useRaceStore((s) => s.pitStop);
  const stintLap = useSnapshot((f) => f.tyres.ageLaps);
  const inOutLap = stintLap <= 2;

  return (
    <section className="px-4 py-3">
      <button
        onClick={() => pitStop("hard")}
        className="w-full rounded border border-ink py-3 text-[14px] font-medium tracking-[0.18em] text-ink uppercase hover:bg-[#1c1c1c]"
      >
        Pit request
      </button>

      {inOutLap && (
        <div className="mt-3 rounded border border-pit-border p-2.5">
          <div className="text-[10px] tracking-[0.14em] text-ink-muted uppercase">
            Out-lap guide
          </div>
          <ul className="mt-1.5 space-y-1 text-[12px] text-ink-body">
            <li className="flex gap-2">
              <StatusDot level="ok" className="mt-1.5" />
              T1-T4 push hard to build tyre temperature
            </li>
            <li className="flex gap-2">
              <StatusDot level="ok" className="mt-1.5" />
              T5-T7 lift and coast, protect the fronts
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
