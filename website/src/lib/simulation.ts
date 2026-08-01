/**
 * Client-side telemetry simulator.
 *
 * Stand-in for the real pipeline: phone sensors -> backend physics models ->
 * Redis hot state -> WebSocket (docs/data-flow.md). The models here are the
 * same shape as the ones in docs/tech-stack.md (fuel burn, tyre wear/temp,
 * brake temp, ERS harvest/deploy), driven by a synthetic car lapping one of
 * the real tracks in /data/tracks instead of by a human with a phone.
 *
 * Every tunable comes from /data/config so the driver app, the website, and
 * the eventual backend all agree on one set of numbers.
 *
 * Everything is deterministic — no Date.now(), no Math.random() — so the
 * server-rendered first frame matches the client's.
 */

import anomalyConfig from "@data/config/anomaly-detection.json";
import compoundConfig from "@data/config/tyre-compounds.json";
import raceDefaults from "@data/config/race-defaults.json";
import vehicle from "@data/config/vehicle.json";
import weatherPresets from "@data/config/weather-presets.json";

import {
  Alert,
  AlertTier,
  Compound,
  Corners,
  LapSummary,
  Severity,
  Telemetry,
  WeatherState,
} from "./types";
import {
  curvatureAhead,
  DEFAULT_TRACK_KEY,
  getTrack,
  pointAt,
  sectorFor,
  Track,
} from "./track";

const G = 9.81;
const LOOKAHEAD_M = 140;
/** Retained history. Sized to hold a full race rather than a scrolling window. */
const MAX_LAP_HISTORY = 200;
const MAX_ALERT_HISTORY = 400;
/** Damps tyre thermal response: bulk rubber does not swing 40C per corner. */
const TYRE_INERTIA = 0.3;
/** Road-wheel angle to steering-wheel angle. */
const STEERING_RATIO = 4.2;
/**
 * Pedal travel rates, in percent per second. A driver takes roughly a quarter
 * of a second to go from closed to full throttle and is quicker onto the
 * brake, so transitions are ramps rather than steps.
 */
const THROTTLE_RATE = 400;
const BRAKE_RATE = 650;

const MAX_LAT_G = vehicle.limits.max_lateral_g;
const V_MAX_KMH = vehicle.limits.max_speed_kmh;
const V_MIN_KMH = vehicle.limits.min_speed_kmh;
const MAX_ACCEL = vehicle.limits.max_accel_ms2;
const MAX_DECEL = vehicle.limits.max_decel_ms2;
const MAX_FUEL_FLOW_KG_H = vehicle.fuel.max_flow_kg_h;
/**
 * Fuel carried over the race's own requirement, as a fraction.
 *
 * With in-race refuelling banned the car starts with everything it will ever
 * have, so this margin is the entire fuel strategy: it is what "laps of fuel
 * remaining" runs above "laps left to run", and what lift-and-coast protects
 * (feedback/round-01 Q1).
 */
const FUEL_MARGIN = raceDefaults.targets.fuel_margin_pct / 100;
const MGU_K_MAX_KW = vehicle.ers.mgu_k_max_kw;
const DEPLOY_MAX_KW = vehicle.ers.deploy_max_kw;
const ERS_CAPACITY_KJ = vehicle.ers.capacity_mj * 1000;
const GEAR_THRESHOLDS = vehicle.gearbox.gear_upshift_speeds_kmh;
const BRAKE_MIN_C = vehicle.brakes.min_temp_c;
const BRAKE_MAX_C = vehicle.brakes.max_temp_c;
const BRAKE_FADE_C = vehicle.brakes.fade_temp_c;
const GRIP_CLIFF_PCT = compoundConfig.grip_cliff_wear_pct;

const COMPOUND_WEAR = Object.fromEntries(
  compoundConfig.compounds.map((c) => [c.key, c.wear_factor]),
) as Record<Compound, number>;
const COMPOUND_FUEL = Object.fromEntries(
  compoundConfig.compounds.map((c) => [c.key, c.fuel_factor]),
) as Record<Compound, number>;

const SEED_WEATHER =
  weatherPresets.presets.find((p) => p.key === weatherPresets.default_preset) ??
  weatherPresets.presets[0];

const ANOMALY_TEMPLATES = anomalyConfig.templates;

/** Mutable bits the models need across ticks that aren't part of the UI state. */
interface SimScratch {
  clock: number;
  seq: number;
  sectorStart: number;
  sectorTimes: [number, number, number];
  lapFuelStart: number;
  lapHarvest: number;
  lapDeploy: number;
  lastRuleLap: Record<string, number>;
  nextAnomalyAt: number;
  anomalyCount: number;
}

export interface SimState {
  track: Track;
  telemetry: Telemetry;
  scratch: SimScratch;
}

const corners = (v: number): Corners => ({ fl: v, fr: v, rl: v, rr: v });

export function createSimState(trackKey: string = DEFAULT_TRACK_KEY): SimState {
  const track = getTrack(trackKey);

  const seedWeather: WeatherState = {
    airTempC: SEED_WEATHER.air_temp_c,
    trackTempC: SEED_WEATHER.track_temp_c,
    windKmh: SEED_WEATHER.wind_kmh,
    windDir: SEED_WEATHER.wind_dir,
    rainMmH: SEED_WEATHER.rain_mm_h,
    condition: SEED_WEATHER.condition as WeatherState["condition"],
  };
  const startingCompound = raceDefaults.starting_compound as Compound;

  // Fuel is loaded for this race on this circuit, not out of a fixed number in
  // a config file (feedback/round-01 D1). The circuits run from 0.76 km to
  // 2.92 km, so a fixed load that is a real constraint on one is hundreds of
  // laps of slack on another — which is exactly what the readout was showing.
  const lapFuelKg = estimateLapFuelKg(track, seedWeather, startingCompound);
  const raceFuelKg = Math.min(
    vehicle.fuel.capacity_kg,
    lapFuelKg * raceDefaults.total_laps * (1 + FUEL_MARGIN),
  );

  const telemetry: Telemetry = {
    seq: 0,
    status: "live",
    lap: 1,
    totalLaps: raceDefaults.total_laps,
    lapTimeS: 0,
    lastLapS: 0,
    deltaToTargetS: 0,
    trackPos: 0,
    sector: 1,
    speedKmh: 0,
    rpm: 4200,
    gear: 1,
    throttlePct: 0,
    brakePct: 0,
    steeringDeg: 0,
    lateralG: 0,
    longitudinalG: 0,
    tyres: {
      compound: startingCompound,
      wearPct: 0,
      gripLevel: 1,
      // Age counts the lap the set is currently running, not the laps it has
      // finished, so it reads the same as the header's lap number for a set
      // fitted at the start (feedback/round-01 D2).
      ageLaps: 1,
      temps: { fl: 82, fr: 84, rl: 79, rr: 80 },
      pressures: {
        fl: vehicle.tyre_pressures_psi.front,
        fr: vehicle.tyre_pressures_psi.front,
        rl: vehicle.tyre_pressures_psi.rear,
        rr: vehicle.tyre_pressures_psi.rear,
      },
    },
    fuel: {
      remainingKg: raceFuelKg,
      startKg: raceFuelKg,
      capacityKg: vehicle.fuel.capacity_kg,
      flowRateKgH: 0,
      avgPerLapKg: lapFuelKg,
      targetPerLapKg: lapFuelKg,
      lapsRemaining: Math.floor(raceFuelKg / lapFuelKg),
    },
    ers: {
      socPct: 68,
      mode: "balanced",
      powerKw: 0,
      harvestedMj: 0,
      deployedMj: 0,
      socHistory: [],
    },
    brakes: { temps: corners(320), padPct: 100, fade: false },
    weather: seedWeather,
    strategy: {
      plan: raceDefaults.strategy.plan,
      stintLap: 1,
      stintLength: raceDefaults.strategy.stint_length_laps,
      pitWindow: raceDefaults.strategy.pit_window_laps as [number, number],
      confidencePct: raceDefaults.strategy.confidence_pct,
      deltaVsAltS: raceDefaults.strategy.delta_vs_alt_s,
      // Nominal until the first lap is on the board; the real pre-race report
      // supplies these from the test lap (docs/website-dashboard.md, View 3).
      targetLapTimeS:
        track.lengthM / (raceDefaults.targets.nominal_avg_speed_kmh / 3.6),
    },
    laps: [],
    alerts: [],
    agentMessages: [
      {
        id: "gemma-0",
        lap: 1,
        text: "Green flag. Build tyre temperature through S1 and settle into a rhythm — I will set your lap and fuel targets off the first flying lap.",
        createdAt: 0,
      },
    ],
  };

  return {
    track,
    telemetry,
    scratch: {
      clock: 0,
      seq: 0,
      sectorStart: 0,
      sectorTimes: [0, 0, 0],
      lapFuelStart: raceFuelKg,
      lapHarvest: 0,
      lapDeploy: 0,
      lastRuleLap: {},
      nextAnomalyAt: 45,
      anomalyCount: 0,
    },
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Moves `from` towards `to` by at most `step`. */
function approach(from: number, to: number, step: number) {
  if (to > from) return Math.min(to, from + step);
  return Math.max(to, from - step);
}

/**
 * The fastest this corner can be taken on the available grip.
 *
 * Deliberately not floored by the demo's minimum speed: this is the physical
 * limit, and it is what bounds that floor at the call site. Flooring here
 * instead made the floor unbounded, which drove a 3.4 m radius hairpin
 * through the corner at 74 km/h and reported it as 12.75 g.
 */
function corneringSpeedKmh(curvature: number): number {
  const k = Math.abs(curvature);
  if (k < 1e-4) return V_MAX_KMH;
  const vMs = Math.sqrt((MAX_LAT_G * G) / k);
  return Math.min(vMs * 3.6, V_MAX_KMH);
}

/**
 * Instantaneous fuel burn (docs/simulation-models.md 3.1). Shared by the race
 * loop and by `estimateLapFuelKg`, so the fuel a race is loaded with is
 * computed by the same model that then burns it.
 */
function fuelFlowKgH(
  speedKmh: number,
  longitudinalG: number,
  lateralG: number,
  weather: WeatherState,
  compound: Compound,
): number {
  const windFactor = 1 + weather.windKmh / 200;
  const rainFactor = weather.rainMmH > 0 ? 1.15 : 1;
  return Math.min(
    MAX_FUEL_FLOW_KG_H,
    (2.0 +
      0.0008 * speedKmh * speedKmh +
      Math.max(0, longitudinalG) * 25 +
      Math.abs(lateralG) * 5) *
      windFactor *
      rainFactor *
      COMPOUND_FUEL[compound],
  );
}

interface Kinematics {
  speedKmh: number;
  longitudinalG: number;
  lateralG: number;
  /** How much of the corner's speed budget is unused, 0..1. Drives throttle. */
  headroom: number;
  braking: boolean;
}

/**
 * One tick of the driver model: pick a speed for where the car is and what is
 * coming, then report the accelerations that speed implies.
 *
 * Extracted so `estimateLapFuelKg` drives exactly the car the race does. The
 * race fuel load is sized from that estimate, so if the two ever diverged the
 * car would be fuelled for a lap it does not actually drive.
 *
 * `headroom` is returned because the pedal model in `step` needs it, and
 * recomputing it there would be a second place to keep in sync.
 */
function drive(track: Track, trackPos: number, speedKmhNow: number, dt: number): Kinematics {
  const here = pointAt(track, trackPos);
  const vNow = speedKmhNow / 3.6;
  const vCorner = corneringSpeedKmh(here.curvature) / 3.6;
  const vAhead = corneringSpeedKmh(curvatureAhead(track, trackPos, LOOKAHEAD_M)) / 3.6;

  // Brake for whichever bites first: the corner ahead, or the one already
  // being taken. Looking only ahead let the car sit above the grip limit all
  // the way through a corner it had entered too fast, with the brake at 0%.
  const vLimit = Math.min(vCorner, vAhead);
  const braking = vNow > vLimit + 0.5;
  const headroom = clamp((vCorner - vNow) / Math.max(vCorner, 1), 0, 1);

  let accel: number;
  if (braking) {
    // Brake proportionally to how much speed has to come off before the corner.
    const overspeed = (vNow - vLimit) / Math.max(vNow, 1);
    accel = -MAX_DECEL * clamp(overspeed * 3.2, 0.15, 1);
  } else {
    // Power-limited at high speed: less acceleration available the faster you go.
    accel = MAX_ACCEL * headroom * (1 - 0.55 * (vNow / (V_MAX_KMH / 3.6)));
  }

  // The speed floor keeps the demo lively on slow sections, but it is a
  // presentation choice and must not overrule physics. Two things bound it:
  //
  //  - grip: forcing the car through a 3.4 m radius hairpin at the floor
  //    would read as 12.75 g, so the floor never exceeds the corner speed
  //  - inertia: from a standstill the floor would otherwise teleport the car
  //    to 74 km/h in one frame, which reads as 21 g off the line
  const floorMs = Math.min(V_MIN_KMH / 3.6, vCorner, vNow + MAX_ACCEL * dt);

  // Grip also caps from above, and this is separate from braking for the
  // corner ahead. Curvature rises as the car turns in, so `vCorner` keeps
  // dropping while the car is still shedding speed towards it — for those
  // ticks the car is already in the corner above the limit, which read as
  // 5.37 g on the sprint hairpin even with the lookahead braking working.
  // A real car cannot hold more grip than it has; it understeers instead.
  const ceilMs = Math.max(floorMs, Math.min(V_MAX_KMH / 3.6, vCorner));
  const vNext = clamp(vNow + accel * dt, floorMs, ceilMs);

  return {
    speedKmh: vNext * 3.6,
    longitudinalG: (vNext - vNow) / dt / G,
    lateralG: (vNext * vNext * here.curvature) / G,
    headroom,
    braking,
  };
}

/**
 * Fuel a single lap costs, by driving one around an empty track.
 *
 * This is what the race fuel load is sized from (feedback/round-01 D1). It has
 * to be measured rather than configured because the circuits differ by a
 * factor of four in length: a constant that makes fuel a real constraint on
 * the Grand circuit leaves several hundred laps of margin on the Sprint.
 *
 * Deterministic, and cheap — one lap at a 100 ms step is a few hundred
 * iterations.
 */
export function estimateLapFuelKg(
  track: Track,
  weather: WeatherState,
  compound: Compound,
): number {
  const dt = 0.1;
  let trackPos = 0;
  let speedKmh = V_MIN_KMH;
  let fuelKg = 0;
  let guard = 0;

  // Settle first: starting from the pit-lane speed at the start line would
  // charge the opening corners an acceleration cost a flying lap never pays.
  for (let warmup = 0; warmup < 2; warmup++) {
    trackPos = 0;
    let lapFuel = 0;
    while (trackPos < 1 && guard++ < 200_000) {
      const k = drive(track, trackPos, speedKmh, dt);
      const advanceM = ((speedKmh + k.speedKmh) / 2 / 3.6) * dt;
      trackPos += advanceM / track.lengthM;
      speedKmh = k.speedKmh;
      lapFuel +=
        (fuelFlowKgH(speedKmh, k.longitudinalG, k.lateralG, weather, compound) * dt) /
        3600;
    }
    fuelKg = lapFuel;
  }

  return fuelKg;
}

function gearFor(speedKmh: number): number {
  let gear = 1;
  for (let i = 0; i < GEAR_THRESHOLDS.length; i++) {
    if (speedKmh >= GEAR_THRESHOLDS[i]) gear = i + 1;
  }
  return gear;
}

function rpmFor(speedKmh: number, gear: number): number {
  const lo = GEAR_THRESHOLDS[gear - 1];
  const hi = GEAR_THRESHOLDS[gear] ?? V_MAX_KMH + 20;
  const frac = clamp((speedKmh - lo) / Math.max(1, hi - lo), 0, 1);
  return Math.round(8200 + frac * 6600);
}

/**
 * Advance the simulation by `dt` seconds. Returns a fresh telemetry object
 * (new nested objects included) so store selectors see changed references.
 */
export function step(sim: SimState, dt: number): SimState {
  const track = sim.track;
  const t = sim.telemetry;
  const sc = { ...sim.scratch };
  sc.clock += dt;

  if (t.status !== "live") return sim;

  // ---- Driver model. The whole of it lives in `drive`, so the one-lap fuel
  // estimate that sizes the race load drives the same car this loop does.
  const here = pointAt(track, t.trackPos);
  const { speedKmh, longitudinalG, lateralG, headroom, braking } = drive(
    track,
    t.trackPos,
    t.speedKmh,
    dt,
  );
  const vNow = t.speedKmh / 3.6;
  const vNext = speedKmh / 3.6;

  // Pedal position reflects driver *demand*, not achieved acceleration. Flat
  // out on a drag-limited straight is 100% throttle even though the car is
  // barely gaining speed; mid-corner is maintenance throttle.
  //
  // Demand is then rate-limited, because a pedal is a physical thing: a real
  // trace ramps between closed and open over a couple of tenths. Applying
  // demand directly made throttle a square wave that sat at exactly 0 or 100
  // for 91% of the race.
  const throttleTarget = braking ? 0 : clamp(30 + headroom * 95, 0, 100);
  const brakeTarget = clamp(longitudinalG < 0 ? -longitudinalG * 26 : 0, 0, 100);
  const throttlePct = approach(t.throttlePct, throttleTarget, THROTTLE_RATE * dt);
  const brakePct = approach(t.brakePct, brakeTarget, BRAKE_RATE * dt);
  const steeringDeg =
    ((Math.atan(here.curvature * 3.6) * 180) / Math.PI) * STEERING_RATIO;

  // ---- Position, sectors, laps.
  const advanceM = ((vNow + vNext) / 2) * dt;
  let trackPos = t.trackPos + advanceM / track.lengthM;
  let lap = t.lap;
  const lapTimeS = t.lapTimeS + dt;
  let lastLapS = t.lastLapS;
  const laps = t.laps;
  let crossedLine = false;

  const prevSector = t.sector;
  if (trackPos >= 1) {
    trackPos -= 1;
    crossedLine = true;
  }
  const sector = sectorFor(track, trackPos);

  // ---- Fuel model (docs/tech-stack.md).
  const flowRateKgH = fuelFlowKgH(
    speedKmh,
    longitudinalG,
    lateralG,
    t.weather,
    t.tyres.compound,
  );
  const remainingKg = Math.max(0, t.fuel.remainingKg - (flowRateKgH * dt) / 3600);

  // ---- Tyre wear + grip.
  const thermal = 1 + (t.weather.trackTempC - 40) * 0.012;
  // Scaled so a medium runs to roughly 55% over a 30-lap stint at this track.
  const wearRate =
    (0.0058 + Math.abs(lateralG) * 0.0075 + (speedKmh / V_MAX_KMH) * 0.0032) *
    COMPOUND_WEAR[t.tyres.compound] *
    thermal;
  const wearPct = clamp(t.tyres.wearPct + wearRate * dt, 0, 100);
  // Grip falls off gently, then falls off a cliff past 62% wear.
  const cliff =
    wearPct > GRIP_CLIFF_PCT ? (wearPct - GRIP_CLIFF_PCT) * 0.006 : 0;
  const gripLevel = clamp(1 - wearPct * 0.0013 - cliff, 0.55, 1);

  // ---- Tyre temperatures, per corner. Lateral load heats the outside pair,
  // braking heats the fronts.
  const tyreTemps = mapCorners(t.tyres.temps, (temp, corner) => {
    const outside =
      (lateralG > 0 && (corner === "fr" || corner === "rr")) ||
      (lateralG < 0 && (corner === "fl" || corner === "rl"));
    const front = corner === "fl" || corner === "fr";
    const load = Math.abs(lateralG) * (outside ? 1.35 : 0.6) * (front ? 1.08 : 0.94);
    // Target the 85-105C working window the pre-race report calls for.
    const heatIn = 7 + load * 5.5 + (brakePct / 100) * (front ? 8 : 3.5);
    const cooling = (temp - t.weather.airTempC) * (0.05 + speedKmh * 0.00095);
    // TYRE_INERTIA damps the response: bulk rubber temperature does not swing
    // 40C between one corner and the next.
    return clamp(temp + (heatIn - cooling) * dt * TYRE_INERTIA, 55, 145);
  });
  const tyrePressures = mapCorners(t.tyres.pressures, (psi, corner) => {
    const base = corner === "fl" || corner === "fr" ? 21.0 : 19.5;
    // Pressure tracks temperature — roughly +0.035 psi per degree over 90C.
    return base + (tyreTemps[corner] - 90) * 0.035;
  });

  // ---- Brake temperatures.
  const brakeTemps = mapCorners(t.brakes.temps, (temp, corner) => {
    const front = corner === "fl" || corner === "fr";
    const bias = front ? 1.34 : 0.72;
    const heatIn = (brakePct / 100) * speedKmh * 2.2 * bias;
    // Discs shed heat fast on the straights but hold a working temperature.
    // Balanced so they swing through roughly 350-750C: hot enough to be worth
    // watching, short of the 1000C fade threshold under normal running.
    const cooling = (temp - t.weather.airTempC) * (0.02 + speedKmh * 0.00035);
    return clamp(temp + (heatIn - cooling) * dt, BRAKE_MIN_C, BRAKE_MAX_C);
  });
  const brakeFade = Math.max(brakeTemps.fl, brakeTemps.fr) > BRAKE_FADE_C;

  // ---- ERS harvest / deploy.
  let socPct = t.ers.socPct;
  let powerKw = 0;
  let mode: Telemetry["ers"]["mode"] = "balanced";
  if (brakePct > 4) {
    powerKw = Math.min(MGU_K_MAX_KW, (brakePct / 100) * speedKmh * 4.5);
    mode = "harvest";
  } else if (throttlePct < 45) {
    // Maintenance throttle through a corner still trickles charge back in.
    powerKw = 120;
    mode = "harvest";
  } else if (throttlePct > 62) {
    // Deploy scales with available charge, so the store settles into a band
    // instead of emptying on lap one and staying there.
    powerKw = -(throttlePct / 100) * DEPLOY_MAX_KW * (socPct / 100);
    mode = "deploy";
  }
  socPct = clamp(socPct + ((powerKw * dt) / ERS_CAPACITY_KJ) * 100, 0, 100);
  if (powerKw > 0) sc.lapHarvest += (powerKw * dt) / 1000;
  if (powerKw < 0) sc.lapDeploy += (-powerKw * dt) / 1000;

  // ---- Weather drift: slow, deterministic wander around the seeded values.
  const weather = {
    ...t.weather,
    airTempC: 28 + Math.sin(sc.clock / 180) * 1.2,
    trackTempC: 42 + Math.sin(sc.clock / 150 + 1) * 2.4,
    windKmh: 12 + Math.sin(sc.clock / 95) * 4,
  };

  const gear = gearFor(speedKmh);

  const next: Telemetry = {
    ...t,
    seq: t.seq + 1,
    trackPos,
    sector,
    speedKmh,
    gear,
    rpm: rpmFor(speedKmh, gear),
    throttlePct,
    brakePct,
    steeringDeg,
    lateralG,
    longitudinalG,
    lapTimeS,
    lastLapS,
    lap,
    tyres: {
      ...t.tyres,
      wearPct,
      gripLevel,
      temps: tyreTemps,
      pressures: tyrePressures,
    },
    fuel: {
      ...t.fuel,
      remainingKg,
      flowRateKgH,
      lapsRemaining: Math.floor(remainingKg / Math.max(0.1, t.fuel.avgPerLapKg)),
    },
    ers: { ...t.ers, socPct, powerKw, mode },
    brakes: {
      temps: brakeTemps,
      padPct: clamp(t.brakes.padPct - dt * 0.0012 * (brakePct / 100 + 0.1) * 100, 0, 100),
      fade: brakeFade,
    },
    weather,
    laps,
    alerts: t.alerts,
    agentMessages: t.agentMessages,
  };

  // Sector splits.
  if (sector !== prevSector || crossedLine) {
    const split = lapTimeS - sc.sectorStart;
    sc.sectorTimes[prevSector - 1] = split;
    sc.sectorStart = crossedLine ? 0 : lapTimeS;
  }

  if (crossedLine) {
    lastLapS = lapTimeS;
    const lapFuel = sc.lapFuelStart - remainingKg;
    const summary: LapSummary = {
      lap,
      s1: sc.sectorTimes[0],
      s2: sc.sectorTimes[1],
      s3: sc.sectorTimes[2],
      total: lastLapS,
      fuelKg: lapFuel,
      wearPct,
    };

    next.laps = [summary, ...laps].slice(0, MAX_LAP_HISTORY);
    next.lastLapS = lastLapS;
    next.deltaToTargetS = lastLapS - t.strategy.targetLapTimeS;
    lap = Math.min(t.totalLaps, lap + 1);
    next.lap = lap;
    next.lapTimeS = 0;
    // Age advances with the lap counter, never past it. The final lap clamps
    // `lap`, so an unconditional increment left the tyres a lap older than the
    // race they were running (feedback/round-01 D2).
    if (lap > t.lap) next.tyres = { ...next.tyres, ageLaps: t.tyres.ageLaps + 1 };
    next.fuel = {
      ...next.fuel,
      avgPerLapKg: laps.length
        ? (t.fuel.startKg - remainingKg) / Math.max(1, lap - 1)
        : lapFuel || t.fuel.avgPerLapKg,
    };
    next.ers = {
      ...next.ers,
      harvestedMj: sc.lapHarvest,
      deployedMj: sc.lapDeploy,
      socHistory: [...t.ers.socHistory, socPct].slice(-12),
    };
    next.strategy = { ...t.strategy, stintLap: next.tyres.ageLaps };

    // Calibrate the lap-time and fuel targets off the first flying lap. Lap 1
    // includes the standing start, so it is not representative. Stands in for
    // the pre-race report's predictions.
    if (summary.lap === 2) {
      next.strategy = { ...next.strategy, targetLapTimeS: lastLapS * 0.995 };
      next.fuel = { ...next.fuel, targetPerLapKg: lapFuel };
      next.deltaToTargetS = lastLapS - next.strategy.targetLapTimeS;
    }

    sc.lapFuelStart = remainingKg;
    sc.lapHarvest = 0;
    sc.lapDeploy = 0;
    sc.sectorTimes = [0, 0, 0];

    evaluateLapRules(next, sc);
    maybeSpeak(next, sc);
    if (next.laps[0]) next.laps[0].alertTier = latestTierForLap(next, summary.lap);
    // The chequered flag falls when the last lap is *completed*, so compare
    // against the lap just banked rather than the one about to start.
    if (summary.lap >= t.totalLaps) next.status = "finished";
  }

  evaluateInstantRules(next, sc);
  maybeAnomaly(next, sc);

  return { track, telemetry: next, scratch: sc };
}

type CornerKey = keyof Corners;

function mapCorners(c: Corners, fn: (v: number, k: CornerKey) => number): Corners {
  return { fl: fn(c.fl, "fl"), fr: fn(c.fr, "fr"), rl: fn(c.rl, "rl"), rr: fn(c.rr, "rr") };
}

function latestTierForLap(t: Telemetry, lap: number): AlertTier | undefined {
  return t.alerts.find((a) => a.lap === lap)?.tier;
}

function pushAlert(
  t: Telemetry,
  sc: SimScratch,
  a: Omit<Alert, "id" | "createdAt" | "lap">,
) {
  sc.seq += 1;
  t.alerts = [
    { ...a, id: `alert-${sc.seq}`, lap: t.lap, createdAt: sc.clock },
    ...t.alerts,
  ].slice(0, MAX_ALERT_HISTORY);
}

/** Fire at most once every `everyLaps` laps. */
function gated(sc: SimScratch, key: string, lap: number, everyLaps: number): boolean {
  const last = sc.lastRuleLap[key];
  if (last !== undefined && lap - last < everyLaps) return false;
  sc.lastRuleLap[key] = lap;
  return true;
}

/** Tier 2a preventative rules + 2b signal patterns evaluated once per lap. */
function evaluateLapRules(t: Telemetry, sc: SimScratch) {
  if (t.lap % 5 === 0 && gated(sc, "brake-check", t.lap, 4)) {
    pushAlert(t, sc, {
      tier: "2a",
      severity: "low",
      title: "Brake temp check",
      message: `Brakes ${Math.round(t.brakes.temps.fl)}° front, ${Math.round(t.brakes.temps.rl)}° rear. In window.`,
      status: "sent",
    });
  }

  const harvest = t.ers.harvestedMj;
  if (harvest > 0 && harvest < 5.0 && gated(sc, "ers-harvest", t.lap, 6)) {
    pushAlert(t, sc, {
      tier: "2b",
      severity: "medium",
      title: "ERS harvest decline",
      message: `Harvest ${harvest.toFixed(1)} MJ, below the 5.0 MJ floor. Brake later into the heavy zones.`,
      status: "sent",
    });
  }

  const lastLap = t.laps[0];
  if (
    lastLap &&
    lastLap.fuelKg > t.fuel.targetPerLapKg * 1.06 &&
    gated(sc, "fuel-over", t.lap, 5)
  ) {
    pushAlert(t, sc, {
      tier: "2b",
      severity: "medium",
      title: "Fuel overconsumption",
      message: `${lastLap.fuelKg.toFixed(2)} kg last lap against a ${t.fuel.targetPerLapKg.toFixed(2)} kg target. Lift and coast into T7.`,
      status: "sent",
    });
  }
}

/** Rules that can fire at any moment during the lap. */
function evaluateInstantRules(t: Telemetry, sc: SimScratch) {
  if (t.tyres.wearPct > 55 && gated(sc, "tyre-cliff", t.lap, 8)) {
    pushAlert(t, sc, {
      tier: "2a",
      severity: "high",
      title: "Tyre cliff warning",
      message: `Tyre wear ${t.tyres.wearPct.toFixed(0)}%. Prepare to pit within three laps.`,
      status: "sent",
    });
  }

  if (t.fuel.lapsRemaining < 3 && gated(sc, "fuel-crit", t.lap, 3)) {
    pushAlert(t, sc, {
      tier: "2a",
      severity: "critical",
      title: "Fuel critical",
      message: `${t.fuel.remainingKg.toFixed(1)} kg remaining, under three laps. Fuel save mode now.`,
      status: "sent",
    });
  }

  if (t.ers.socPct < 10 && gated(sc, "ers-low", t.lap, 4)) {
    pushAlert(t, sc, {
      tier: "2a",
      severity: "medium",
      title: "ERS depleted",
      message: `Battery ${t.ers.socPct.toFixed(0)}%. Harvest through S2, hold deploy for the main straight.`,
      status: "sent",
    });
  }

  const asymmetry = Math.abs(t.tyres.temps.fl - t.tyres.temps.fr);
  if (asymmetry > 15 && gated(sc, "tyre-asym", t.lap, 6)) {
    pushAlert(t, sc, {
      tier: "2b",
      severity: "medium",
      title: "Tyre asymmetry",
      message: `Front axle split ${asymmetry.toFixed(0)}°C. Left front working harder than the right.`,
      status: "sent",
    });
  }
}


/** Tier 2c: TimesFM-style anomaly, queued for engineer approval. */
function maybeAnomaly(t: Telemetry, sc: SimScratch) {
  if (sc.clock < sc.nextAnomalyAt) return;
  sc.nextAnomalyAt = sc.clock + 95 + (sc.anomalyCount % 4) * 18;
  const tpl = ANOMALY_TEMPLATES[sc.anomalyCount % ANOMALY_TEMPLATES.length];
  sc.anomalyCount += 1;
  pushAlert(t, sc, {
    tier: "2c",
    severity: tpl.severity as Severity,
    title: tpl.title,
    message: tpl.interpretation,
    recommendation: tpl.recommendation,
    channels: tpl.channels,
    sigma: tpl.sigma,
    status: "pending",
  });
}

const GEMMA_LINES = [
  "Tyre wear tracking to plan. Extend to lap 27 — fuel and tyres both support it.",
  "Pace is stable within a tenth. Push S1, protect the rears through S2.",
  "Fuel margin holding at plus two kilos. No lift and coast needed yet.",
  "Track temp climbing. Expect degradation to steepen over the next five laps.",
  "Pit window confidence up to 86%. Hards are the right call at this track temp.",
  "Harvest is strong in S3. Keep the late braking into T9.",
];

function maybeSpeak(t: Telemetry, sc: SimScratch) {
  if (t.lap % 3 !== 0) return;
  sc.seq += 1;
  t.agentMessages = [
    {
      id: `gemma-${sc.seq}`,
      lap: t.lap,
      text: GEMMA_LINES[(t.lap / 3) % GEMMA_LINES.length | 0],
      createdAt: sc.clock,
    },
    ...t.agentMessages,
  ].slice(0, 20);
}

// ---------------------------------------------------------------------------
// Engineer and driver actions.
//
// These used to live in the browser store, which meant each tab applied them
// to its own copy of the race. They belong here so the server can apply them
// once, authoritatively, and broadcast the result to every client.
// ---------------------------------------------------------------------------

/** Engineer approves a pending 2c anomaly, optionally rewording it. */
export function applyApprove(
  sim: SimState,
  id: string,
  message?: string,
): SimState {
  const telemetry: Telemetry = {
    ...sim.telemetry,
    alerts: sim.telemetry.alerts.map((a) =>
      a.id === id ? { ...a, status: "sent", message: message ?? a.message } : a,
    ),
  };
  return { ...sim, telemetry };
}

/** Engineer dismisses a pending 2c anomaly as a false positive. */
export function applyDismiss(sim: SimState, id: string): SimState {
  const telemetry: Telemetry = {
    ...sim.telemetry,
    alerts: sim.telemetry.alerts.map((a) =>
      a.id === id ? { ...a, status: "dismissed" } : a,
    ),
  };
  return { ...sim, telemetry };
}

/** Pit stop: fresh rubber, stint counter reset, and a word from Gemma. */
export function applyPit(sim: SimState, compound: Compound): SimState {
  const t = sim.telemetry;
  const telemetry: Telemetry = {
    ...t,
    tyres: {
      ...t.tyres,
      compound,
      wearPct: 0,
      gripLevel: 1,
      ageLaps: 0,
      temps: { fl: 78, fr: 80, rl: 76, rr: 77 },
    },
    strategy: { ...t.strategy, stintLap: 0 },
    agentMessages: [
      {
        id: `gemma-pit-${t.lap}-${sim.scratch.clock.toFixed(0)}`,
        lap: t.lap,
        text: `Box confirmed. ${compound.toUpperCase()} fitted on lap ${t.lap}. Two laps to build temperature — push T1 to T4.`,
        createdAt: sim.scratch.clock,
      },
      ...t.agentMessages,
    ].slice(0, 20),
  };
  return { ...sim, telemetry };
}
