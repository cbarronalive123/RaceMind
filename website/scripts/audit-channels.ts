/**
 * Per-channel realism audit (feedback/round-01 D4).
 *
 * Runs a full race on every track and checks each telemetry channel against
 * the range its own label and units imply. The reference ranges come from
 * `docs/f1-telemetry-data.md` (what the channel is) and
 * `docs/simulation-models.md` (what the model is tuned to produce).
 *
 * Run from website/:  npm run audit:channels
 *
 * This reports rather than fixes. Several of the scaling factors in
 * simulation.ts are interdependent — flow rate feeds laps-remaining feeds the
 * fuel-critical rule — so a per-channel report is the input to a deliberate
 * retune, not a substitute for one.
 */

import raceDefaults from "../../data/config/race-defaults.json" with { type: "json" };
import vehicle from "../../data/config/vehicle.json" with { type: "json" };
import { createSimState, SimState, step } from "../src/lib/simulation";
import { TRACK_KEYS } from "../src/lib/track";
import { Telemetry } from "../src/lib/types";

const SUBSTEP = 0.1;
const MAX_SIM_SECONDS = 4 * 60 * 60;

/**
 * What each channel is allowed to be. `lo`/`hi` bound every sample; `meanLo`/
 * `meanHi` bound the race average, which is what catches a channel that is
 * technically in range but sits at one end of it for the whole race.
 */
interface ChannelSpec {
  name: string;
  unit: string;
  get: (t: Telemetry) => number;
  lo: number;
  hi: number;
  meanLo?: number;
  meanHi?: number;
  /** Where the range comes from, quoted in the report. */
  source: string;
}

const SPECS: ChannelSpec[] = [
  {
    name: "speed_kmh",
    unit: "km/h",
    get: (t) => t.speedKmh,
    lo: 0,
    hi: vehicle.limits.max_speed_kmh,
    meanLo: 90,
    meanHi: 260,
    source: "vehicle.limits.max_speed_kmh",
  },
  {
    name: "rpm",
    unit: "rpm",
    get: (t) => t.rpm,
    lo: vehicle.gearbox.rpm_min,
    hi: vehicle.gearbox.rpm_max,
    source: "vehicle.gearbox",
  },
  {
    name: "gear",
    unit: "-",
    get: (t) => t.gear,
    lo: 1,
    hi: 8,
    source: "f1-telemetry-data.md: Gear Position 1-8",
  },
  {
    name: "throttle_pct",
    unit: "%",
    get: (t) => t.throttlePct,
    lo: 0,
    hi: 100,
    source: "percentage",
  },
  {
    name: "brake_pct",
    unit: "%",
    get: (t) => t.brakePct,
    lo: 0,
    hi: 100,
    source: "percentage",
  },
  {
    name: "lateral_g",
    unit: "g",
    get: (t) => Math.abs(t.lateralG),
    lo: 0,
    hi: vehicle.limits.max_lateral_g,
    source: "vehicle.limits.max_lateral_g",
  },
  {
    name: "longitudinal_g",
    unit: "g",
    get: (t) => Math.abs(t.longitudinalG),
    lo: 0,
    hi: Math.max(vehicle.limits.max_accel_ms2, vehicle.limits.max_decel_ms2) / 9.81,
    source: "vehicle.limits accel/decel",
  },
  {
    name: "steering_deg",
    unit: "deg",
    get: (t) => Math.abs(t.steeringDeg),
    lo: 0,
    hi: 200,
    source: "simulation-models.md: F1 steering roughly +/-200 deg lock to lock",
  },
  {
    name: "fuel_flow_kg_h",
    unit: "kg/h",
    get: (t) => t.fuel.flowRateKgH,
    lo: 0.5,
    hi: vehicle.fuel.max_flow_kg_h,
    meanLo: 25,
    meanHi: 95,
    source: "f1-telemetry-data.md: FIA sensor max 100 kg/h; models.md activity table",
  },
  {
    name: "fuel_remaining_kg",
    unit: "kg",
    get: (t) => t.fuel.remainingKg,
    lo: 0,
    hi: vehicle.fuel.capacity_kg,
    source: "vehicle.fuel.capacity_kg",
  },
  {
    name: "fuel_laps_remaining",
    unit: "laps",
    get: (t) => t.fuel.lapsRemaining,
    lo: 0,
    // The whole point of D1: fuel must be a constraint, so laps-remaining can
    // never sit far above the laps actually left to run.
    hi: raceDefaults.total_laps + 6,
    source: "feedback D1/Q1: must track slightly above laps_remaining",
  },
  {
    name: "tyre_wear_pct",
    unit: "%",
    get: (t) => t.tyres.wearPct,
    lo: 0,
    hi: 100,
    source: "percentage",
  },
  {
    name: "tyre_grip_level",
    unit: "-",
    get: (t) => t.tyres.gripLevel,
    lo: 0,
    hi: 1,
    source: "simulation-models.md: grip multiplier 0.0-1.0",
  },
  {
    name: "tyre_temp_c",
    unit: "°C",
    get: (t) => maxCorner(t.tyres.temps),
    lo: 55,
    hi: 150,
    meanLo: 70,
    meanHi: 120,
    source: "simulation-models.md: working range 70-120 C, clamp 150",
  },
  {
    name: "tyre_pressure_psi",
    unit: "psi",
    get: (t) => maxCorner(t.tyres.pressures),
    lo: 15,
    hi: 30,
    source: "vehicle.tyre_pressures_psi, cold 19.5-21.0",
  },
  {
    name: "brake_temp_c",
    unit: "°C",
    get: (t) => maxCorner(t.brakes.temps),
    lo: vehicle.brakes.min_temp_c,
    hi: vehicle.brakes.max_temp_c,
    meanLo: 300,
    meanHi: 800,
    source: "vehicle.brakes min/max, fade at 1000 C",
  },
  {
    name: "brake_pad_pct",
    unit: "%",
    get: (t) => t.brakes.padPct,
    lo: 0,
    hi: 100,
    source: "percentage",
  },
  {
    name: "ers_soc_pct",
    unit: "%",
    get: (t) => t.ers.socPct,
    lo: 0,
    hi: 100,
    source: "percentage",
  },
  {
    name: "ers_power_kw",
    unit: "kW",
    get: (t) => Math.abs(t.ers.powerKw),
    lo: 0,
    hi: vehicle.ers.mgu_k_max_kw,
    source: "vehicle.ers.mgu_k_max_kw (350 kW, 2026)",
  },
  {
    name: "ers_harvested_mj",
    unit: "MJ",
    get: (t) => t.ers.harvestedMj,
    lo: 0,
    hi: vehicle.ers.max_harvest_per_lap_mj,
    source: "vehicle.ers.max_harvest_per_lap_mj (8.5 MJ/lap, 2026)",
  },
  {
    name: "ers_deployed_mj",
    unit: "MJ",
    get: (t) => t.ers.deployedMj,
    lo: 0,
    hi: vehicle.ers.max_harvest_per_lap_mj,
    source: "deploy cannot exceed the per-lap harvest ceiling",
  },
  {
    name: "air_temp_c",
    unit: "°C",
    get: (t) => t.weather.airTempC,
    lo: -10,
    hi: 50,
    source: "weather-presets.json",
  },
  {
    name: "track_temp_c",
    unit: "°C",
    get: (t) => t.weather.trackTempC,
    lo: -5,
    hi: 65,
    source: "simulation-models.md: track_temp = air_temp + 15",
  },
];

type Corners = { fl: number; fr: number; rl: number; rr: number };
const maxCorner = (c: Corners) => Math.max(c.fl, c.fr, c.rl, c.rr);

interface Stat {
  min: number;
  max: number;
  sum: number;
  n: number;
}

function advance(sim: SimState, dt: number): SimState {
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  let cur = sim;
  for (let i = 0; i < steps; i++) cur = step(cur, h);
  return cur;
}

interface Finding {
  track: string;
  channel: string;
  detail: string;
  /**
   * A violation breaks a hard bound the channel's own label or spec sets, and
   * is a defect. An advisory is inside those bounds but outside the band the
   * reference material expects — usually a statement about these circuits
   * rather than about the model, and a judgement call rather than a fix.
   */
  kind: "violation" | "advisory";
}

/** Tolerance for comparing against a bound the model clamps exactly to. */
const EPS = 1e-6;

function auditTrack(trackKey: string): {
  findings: Finding[];
  rows: string[];
  summary: string;
} {
  let sim = createSimState(trackKey);
  const stats = new Map<string, Stat>();
  const dt = 1 / raceDefaults.telemetry_hz;
  let clock = 0;

  const record = (t: Telemetry) => {
    for (const spec of SPECS) {
      const v = spec.get(t);
      if (!Number.isFinite(v)) continue;
      const s = stats.get(spec.name) ?? { min: Infinity, max: -Infinity, sum: 0, n: 0 };
      s.min = Math.min(s.min, v);
      s.max = Math.max(s.max, v);
      s.sum += v;
      s.n += 1;
      stats.set(spec.name, s);
    }
  };

  // D2 regression guard: a set fitted at the start must report an age equal to
  // the lap on the header for the whole race. These used to drift by one.
  let ageDesync = 0;

  // Skip the standing start: lap 1 begins at 0 km/h from a dead stop, which is
  // not representative of anything and would drag every mean down.
  while (sim.telemetry.status === "live" && clock < MAX_SIM_SECONDS) {
    sim = advance(sim, dt);
    clock += dt;
    if (sim.telemetry.tyres.ageLaps !== sim.telemetry.lap) ageDesync += 1;
    if (sim.telemetry.lap >= 2) record(sim.telemetry);
  }

  const t = sim.telemetry;
  const lapTimes = t.laps.map((l) => l.total).filter((v) => v > 0);
  const avgLapS = lapTimes.reduce((a, b) => a + b, 0) / Math.max(1, lapTimes.length);
  const lapFuels = t.laps.map((l) => l.fuelKg).filter((v) => v > 0);
  const avgLapFuel = lapFuels.reduce((a, b) => a + b, 0) / Math.max(1, lapFuels.length);
  const fuelUsed = t.fuel.startKg - t.fuel.remainingKg;
  const trackKm = sim.track.lengthM / 1000;

  const findings: Finding[] = [];
  const rows: string[] = [];

  if (ageDesync > 0) {
    findings.push({
      track: trackKey,
      channel: "tyre_age_laps",
      kind: "violation",
      detail: `out of sync with lap number on ${ageDesync} ticks [feedback D2: one snapshot per tick, no cross-widget lag]`,
    });
  }

  for (const spec of SPECS) {
    const s = stats.get(spec.name);
    if (!s || s.n === 0) continue;
    const mean = s.sum / s.n;
    const violations: string[] = [];
    const advisories: string[] = [];

    if (s.min < spec.lo - EPS) violations.push(`min ${fmt(s.min)} < ${fmt(spec.lo)}`);
    if (s.max > spec.hi + EPS) violations.push(`max ${fmt(s.max)} > ${fmt(spec.hi)}`);
    if (spec.meanLo !== undefined && mean < spec.meanLo)
      advisories.push(`mean ${fmt(mean)} below the ${fmt(spec.meanLo)} expected`);
    if (spec.meanHi !== undefined && mean > spec.meanHi)
      advisories.push(`mean ${fmt(mean)} above the ${fmt(spec.meanHi)} expected`);

    const mark = violations.length ? "FAIL" : advisories.length ? "note" : "ok  ";
    rows.push(
      `  ${mark}  ${spec.name.padEnd(20)} ` +
        `${fmt(s.min).padStart(9)} ${fmt(mean).padStart(9)} ${fmt(s.max).padStart(9)}  ${spec.unit}`,
    );
    if (violations.length) {
      findings.push({
        track: trackKey,
        channel: spec.name,
        kind: "violation",
        detail: `${violations.join("; ")}  [bound ${fmt(spec.lo)}..${fmt(spec.hi)} — ${spec.source}]`,
      });
    }
    if (advisories.length) {
      findings.push({
        track: trackKey,
        channel: spec.name,
        kind: "advisory",
        detail: `${advisories.join("; ")}  [${spec.source}]`,
      });
    }
  }

  const summary =
    `  laps completed      ${t.laps.length} of ${t.totalLaps}\n` +
    `  track length        ${trackKm.toFixed(3)} km\n` +
    `  race distance       ${(trackKm * t.totalLaps).toFixed(1)} km\n` +
    `  avg lap time        ${avgLapS.toFixed(2)} s\n` +
    `  avg fuel per lap    ${avgLapFuel.toFixed(3)} kg\n` +
    `  fuel used all race  ${fuelUsed.toFixed(1)} kg of ${t.fuel.startKg.toFixed(1)} kg loaded\n` +
    `  fuel left at flag   ${t.fuel.remainingKg.toFixed(1)} kg\n` +
    `  final tyre wear     ${t.tyres.wearPct.toFixed(1)} %\n` +
    `  final tyre age      ${t.tyres.ageLaps} laps (header lap ${t.lap})`;

  return { findings, rows, summary };
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

const all: Finding[] = [];
console.log("Channel realism audit — feedback/round-01 D4\n");

for (const key of TRACK_KEYS) {
  const { findings, rows, summary } = auditTrack(key);
  console.log(`── ${key} ${"─".repeat(Math.max(0, 60 - key.length))}`);
  console.log(summary);
  console.log(`\n  status  ${"channel".padEnd(20)} ${"min".padStart(9)} ${"mean".padStart(9)} ${"max".padStart(9)}`);
  console.log(rows.join("\n"));
  console.log("");
  all.push(...findings);
}

const violations = all.filter((f) => f.kind === "violation");
const advisories = all.filter((f) => f.kind === "advisory");

if (violations.length === 0) {
  console.log("No violations: every channel is inside the bounds its label sets.\n");
} else {
  console.log(`${violations.length} violation(s) — a channel outside its own spec:\n`);
  for (const f of violations) {
    console.log(`  [${f.track}] ${f.channel}`);
    console.log(`      ${f.detail}`);
  }
  console.log("");
}

if (advisories.length) {
  console.log(
    `${advisories.length} advisory note(s) — in spec, but outside the band the\n` +
      `reference material expects. These are judgement calls, not defects:\n`,
  );
  for (const f of advisories) {
    console.log(`  [${f.track}] ${f.channel}`);
    console.log(`      ${f.detail}`);
  }
}

// Only a violation fails the run. Advisories are for a human to weigh.
process.exit(violations.length ? 1 : 0);
