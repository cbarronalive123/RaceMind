/**
 * The display snapshot: what the dashboard renders, as opposed to what the
 * simulator computed.
 *
 * Two things from feedback/round-01 live here.
 *
 * D2 — every widget renders from one snapshot per tick. The simulator produces
 * a whole `Telemetry` object per tick carrying a monotonic `seq`, and the store
 * publishes exactly one derived snapshot from it. Nothing in the dashboard
 * reads a channel independently, so two widgets can never land on different
 * ticks and disagree — the tyre-age-vs-lap mismatch was that class of bug.
 *
 * P2 — live values are visually noisy at 10 Hz. Each smoothed channel gets an
 * exponential filter with its own time constant, so a bulk-thermal reading like
 * tyre temperature settles instead of flickering while speed stays responsive.
 *
 * Smoothing is display-only. `Telemetry` is still the source of truth and is
 * what `generate-data.ts` writes to `/data/timeseries` — nothing here changes
 * a stored value, which is what P2 asks for.
 *
 * Why one cadence rather than a slow tier for the calm widgets: two publish
 * rates would let a slow widget sit a tick behind a fast one, which is exactly
 * the inconsistency D2 is blocking on. A long time constant gives the same
 * visual calm without breaking the single-frame guarantee.
 */

import { Telemetry } from "./types";

/** Wall-clock gap between published snapshots. Matches the store's tick. */
const PUBLISH_MS = 100;

/**
 * Per-channel smoothing time constants, in milliseconds. Roughly the time a
 * channel takes to cover 63% of a step change. A channel absent from this map
 * is published raw — anything discrete (lap, gear, sector) or textual must be,
 * since averaging it would be meaningless.
 */
const TAU_MS = {
  speed: 150,
  rpm: 150,
  pedals: 120,
  gForce: 200,
  steering: 150,
  fuelFlow: 800,
  fuelLevel: 1000,
  ersPower: 300,
  ersSoc: 500,
  tyreTemp: 1500,
  tyrePressure: 1500,
  tyreWear: 1500,
  brakeTemp: 800,
  weather: 3000,
} as const;

/** Fraction of the gap to close per publish, for a given time constant. */
const alpha = (tauMs: number) => 1 - Math.exp(-PUBLISH_MS / tauMs);

const A = Object.fromEntries(
  Object.entries(TAU_MS).map(([k, v]) => [k, alpha(v)]),
) as Record<keyof typeof TAU_MS, number>;

type Corners = Telemetry["tyres"]["temps"];

/**
 * Holds the filter state between publishes. Kept outside the store because it
 * is neither race state nor rendered — it is the smoother's memory.
 */
export interface SmoothingState {
  prev: Telemetry | null;
}

export const createSmoothingState = (): SmoothingState => ({ prev: null });

const ema = (prev: number, next: number, a: number) => prev + (next - prev) * a;

const emaCorners = (prev: Corners, next: Corners, a: number): Corners => ({
  fl: ema(prev.fl, next.fl, a),
  fr: ema(prev.fr, next.fr, a),
  rl: ema(prev.rl, next.rl, a),
  rr: ema(prev.rr, next.rr, a),
});

/**
 * True when the filter's memory is about a different race and has to be
 * dropped rather than ramped: a reset or track change rewinds `seq`, and a pit
 * stop swaps the tyres for a set at a different temperature and wear.
 */
function isDiscontinuous(prev: Telemetry, next: Telemetry): boolean {
  return (
    next.seq <= prev.seq ||
    next.tyres.compound !== prev.tyres.compound ||
    next.tyres.ageLaps < prev.tyres.ageLaps
  );
}

/**
 * Derives the snapshot the dashboard renders from one simulator tick.
 *
 * Returns a whole new `Telemetry` carrying the same `seq` as its source, so a
 * snapshot is always attributable to exactly one tick.
 */
export function publish(state: SmoothingState, next: Telemetry): Telemetry {
  const prev = state.prev;

  if (!prev || isDiscontinuous(prev, next)) {
    state.prev = next;
    return next;
  }

  const smoothed: Telemetry = {
    ...next,
    speedKmh: ema(prev.speedKmh, next.speedKmh, A.speed),
    rpm: ema(prev.rpm, next.rpm, A.rpm),
    throttlePct: ema(prev.throttlePct, next.throttlePct, A.pedals),
    brakePct: ema(prev.brakePct, next.brakePct, A.pedals),
    steeringDeg: ema(prev.steeringDeg, next.steeringDeg, A.steering),
    lateralG: ema(prev.lateralG, next.lateralG, A.gForce),
    longitudinalG: ema(prev.longitudinalG, next.longitudinalG, A.gForce),
    tyres: {
      ...next.tyres,
      wearPct: ema(prev.tyres.wearPct, next.tyres.wearPct, A.tyreWear),
      gripLevel: ema(prev.tyres.gripLevel, next.tyres.gripLevel, A.tyreWear),
      temps: emaCorners(prev.tyres.temps, next.tyres.temps, A.tyreTemp),
      pressures: emaCorners(
        prev.tyres.pressures,
        next.tyres.pressures,
        A.tyrePressure,
      ),
    },
    fuel: {
      ...next.fuel,
      remainingKg: ema(prev.fuel.remainingKg, next.fuel.remainingKg, A.fuelLevel),
      flowRateKgH: ema(prev.fuel.flowRateKgH, next.fuel.flowRateKgH, A.fuelFlow),
    },
    ers: {
      ...next.ers,
      socPct: ema(prev.ers.socPct, next.ers.socPct, A.ersSoc),
      powerKw: ema(prev.ers.powerKw, next.ers.powerKw, A.ersPower),
    },
    brakes: {
      ...next.brakes,
      temps: emaCorners(prev.brakes.temps, next.brakes.temps, A.brakeTemp),
    },
    weather: {
      ...next.weather,
      airTempC: ema(prev.weather.airTempC, next.weather.airTempC, A.weather),
      trackTempC: ema(prev.weather.trackTempC, next.weather.trackTempC, A.weather),
      windKmh: ema(prev.weather.windKmh, next.weather.windKmh, A.weather),
    },
  };

  state.prev = smoothed;
  return smoothed;
}
