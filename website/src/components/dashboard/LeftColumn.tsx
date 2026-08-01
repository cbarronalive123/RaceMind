"use client";

import { Panel } from "@/components/ui/Panel";
import { Bar, LabeledBar, Metric, StatusDot } from "@/components/ui/Readouts";
import { COMPOUND_COLOR, COMPOUND_LABEL, levelFor } from "@/lib/format";
import { useSnapshot } from "@/lib/store";
import { Corners } from "@/lib/types";
import { TrackMap } from "./TrackMap";

export function LeftColumn() {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <Panel title="Track & Car" className="shrink-0" bodyClassName="h-[260px]">
        <TrackMap />
      </Panel>
      <TyrePanel />
      <FuelPanel />
      <WeatherPanel />
    </div>
  );
}

function TyrePanel() {
  const tyres = useSnapshot((f) => f.tyres);
  const wearLevel = levelFor(tyres.wearPct, 45, 62);

  return (
    <Panel
      title="Tyres"
      className="shrink-0"
      action={
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: COMPOUND_COLOR[tyres.compound] }}
          />
          <span className="text-[11px] text-ink">{COMPOUND_LABEL[tyres.compound]}</span>
        </span>
      }
    >
      <CornerGrid temps={tyres.temps} pressures={tyres.pressures} />
      <div className="mt-3 space-y-2">
        <LabeledBar
          label="Wear"
          value={tyres.wearPct}
          display={`${tyres.wearPct.toFixed(1)}%`}
          level={wearLevel}
        />
        <Metric label="Grip level" value={tyres.gripLevel.toFixed(3)} />
        <Metric label="Age" value={tyres.ageLaps} unit="laps" />
      </div>
    </Panel>
  );
}

function CornerGrid({ temps, pressures }: { temps: Corners; pressures: Corners }) {
  const keys: (keyof Corners)[] = ["fl", "fr", "rl", "rr"];
  return (
    <div className="grid grid-cols-2 gap-2">
      {keys.map((k) => {
        const level = levelFor(temps[k], 108, 122);
        return (
          <div
            key={k}
            className="rounded border border-pit-border bg-pit-panel-2 px-2 py-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] tracking-[0.1em] text-ink-muted uppercase">
                {k}
              </span>
              <StatusDot level={level} />
            </div>
            <div className="tnum text-[15px] text-ink">{temps[k].toFixed(0)}°C</div>
            <div className="tnum text-[10px] text-ink-secondary">
              {pressures[k].toFixed(1)} psi
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Fuel is only interesting as a margin (feedback/round-01 D1, Q1). Refuelling
 * is banned, so the car has what it started with, and the single number that
 * matters is how many laps of fuel are left against how many laps are left to
 * run. Showing the surplus directly is what makes it read as a constraint —
 * against the tank's 110 kg capacity the bar sat near empty all race and said
 * nothing.
 */
function FuelPanel() {
  const fuel = useSnapshot((f) => f.fuel);
  const lap = useSnapshot((f) => f.lap);
  const totalLaps = useSnapshot((f) => f.totalLaps);

  const lapsToRun = Math.max(0, totalLaps - lap + 1);
  const surplus = fuel.lapsRemaining - lapsToRun;
  const level = surplus < 0 ? "crit" : surplus < 1 ? "warn" : "ok";

  return (
    <Panel title="Fuel" className="shrink-0">
      <Bar value={fuel.remainingKg} max={fuel.startKg} height={10} />
      <div className="tnum mt-1.5 text-[15px] text-ink">
        {fuel.remainingKg.toFixed(1)}
        <span className="text-[11px] text-ink-secondary">
          {" "}
          / {fuel.startKg.toFixed(1)} kg race load
        </span>
      </div>
      <div className="mt-2 space-y-0.5">
        <Metric
          label="Fuel laps vs laps left"
          value={`${fuel.lapsRemaining} / ${lapsToRun}`}
          level={level}
        />
        <Metric
          label="Margin"
          value={`${surplus >= 0 ? "+" : ""}${surplus}`}
          unit="laps"
          level={level}
        />
        <Metric label="Per lap" value={fuel.avgPerLapKg.toFixed(2)} unit="kg" />
        <Metric label="Flow" value={fuel.flowRateKgH.toFixed(1)} unit="kg/h" />
      </div>
    </Panel>
  );
}

function WeatherPanel() {
  const w = useSnapshot((f) => f.weather);
  return (
    <Panel title="Weather" className="shrink-0">
      <Metric label="Air" value={w.airTempC.toFixed(1)} unit="°C" />
      <Metric label="Track" value={w.trackTempC.toFixed(1)} unit="°C" />
      <Metric label="Wind" value={`${w.windKmh.toFixed(0)} ${w.windDir}`} unit="km/h" />
      <Metric label="Rain" value={w.rainMmH.toFixed(1)} unit="mm/h" />
      <Metric
        label="Condition"
        value={w.condition.toUpperCase()}
        level={w.condition === "dry" ? "ok" : "warn"}
      />
    </Panel>
  );
}
