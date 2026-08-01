/**
 * The canonical telemetry frame: one 10 Hz sample of derived F1 telemetry.
 *
 * This is the shape written to `/data/timeseries/<key>/*.jsonl` and described
 * by `/data/schema/telemetry-frame.schema.json`. It is snake_case and rounded,
 * unlike the camelCase `Telemetry` the simulator carries internally.
 *
 * Both the generator and the browser convert through `toFrame`, so a frame
 * read off disk and a frame taken from the running simulator are the same
 * shape and can be rendered by the same code.
 */

import trackIndex from "@data/tracks/index.json";
import vehicle from "@data/config/vehicle.json";
import { pointAt, Track } from "./track";
import { Compound, Telemetry } from "./types";

export interface FrameCorners {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

export interface TelemetryFrame {
  /** Seconds since race start. */
  t: number;
  lap: number;
  lap_time_s: number;
  /** Normalised position around the lap, 0..1. */
  track_pos: number;
  sector: 1 | 2 | 3;
  lat: number;
  lon: number;
  speed_kmh: number;
  rpm: number;
  gear: number;
  throttle_pct: number;
  brake_pct: number;
  steering_deg: number;
  lateral_g: number;
  longitudinal_g: number;
  tyres: {
    compound: Compound;
    wear_pct: number;
    grip_level: number;
    age_laps: number;
    temps_c: FrameCorners;
    pressures_psi: FrameCorners;
  };
  fuel: {
    remaining_kg: number;
    flow_rate_kg_h: number;
    avg_per_lap_kg: number;
    laps_remaining: number;
  };
  ers: {
    soc_pct: number;
    mode: "deploy" | "harvest" | "balanced";
    power_kw: number;
    harvested_mj: number;
    deployed_mj: number;
  };
  brakes: {
    temps_c: FrameCorners;
    pad_pct: number;
    fade: boolean;
  };
  weather: {
    air_temp_c: number;
    track_temp_c: number;
    wind_kmh: number;
    wind_dir: string;
    rain_mm_h: number;
    condition: "dry" | "damp" | "wet";
  };
}

export interface LatLon {
  lat: number;
  lon: number;
}

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

/** Rounds to `dp` decimals. Frames are rounded so the files stay readable. */
export const r = (v: number, dp = 2) => Number(v.toFixed(dp));

/**
 * The geographic centre each track's projection was built around. Emitted GPS
 * fixes are relative to it, so they land back on the real roads.
 */
export function centerFor(trackKey: string): LatLon {
  const entry = trackIndex.tracks.find((t) => t.key === trackKey);
  if (!entry) throw new Error(`unknown track: ${trackKey}`);
  return entry.center;
}

/** Inverse of the projection in track-build.ts, for reconstructing GPS fixes. */
export function toLatLon(x: number, y: number, center: LatLon): LatLon {
  return {
    lat: center.lat + y / M_PER_DEG_LAT,
    lon:
      center.lon +
      x / (M_PER_DEG_LON * Math.cos((center.lat * Math.PI) / 180)),
  };
}

/** The physics slice of `Telemetry` that a frame can reconstruct. */
export type FramePhysics = Omit<
  Telemetry,
  | "seq"
  | "status"
  | "totalLaps"
  | "lastLapS"
  | "deltaToTargetS"
  | "strategy"
  | "laps"
  | "alerts"
  | "agentMessages"
>;

/**
 * The two values the physics slice needs that a frame does not carry: the
 * fuel target is calibrated per race, and SOC history is a per-lap series.
 * Both arrive alongside the frame in the protocol's `LiveExtras`.
 */
export interface FrameContext {
  fuelTargetPerLapKg: number;
  /**
   * What the car started with. Sized to the race distance rather than fixed,
   * since refuelling is banned — see race-defaults.json fuel_policy.
   */
  fuelStartKg: number;
  socHistory: number[];
}

/**
 * Unpacks a frame back into the camelCase shape the components read.
 *
 * The inverse of `toFrame` for every field a frame carries. Rounding is not
 * reversed — frames are the canonical record, so what the pit wall renders is
 * exactly what a replay off disk would show.
 *
 * Fields a frame does not carry (laps, alerts, strategy, agent messages)
 * arrive as their own protocol messages and are merged by the store.
 */
export function fromFrame(f: TelemetryFrame, ctx: FrameContext): FramePhysics {
  return {
    lap: f.lap,
    lapTimeS: f.lap_time_s,
    trackPos: f.track_pos,
    sector: f.sector,
    speedKmh: f.speed_kmh,
    rpm: f.rpm,
    gear: f.gear,
    throttlePct: f.throttle_pct,
    brakePct: f.brake_pct,
    steeringDeg: f.steering_deg,
    lateralG: f.lateral_g,
    longitudinalG: f.longitudinal_g,
    tyres: {
      compound: f.tyres.compound,
      wearPct: f.tyres.wear_pct,
      gripLevel: f.tyres.grip_level,
      ageLaps: f.tyres.age_laps,
      temps: { ...f.tyres.temps_c },
      pressures: { ...f.tyres.pressures_psi },
    },
    fuel: {
      remainingKg: f.fuel.remaining_kg,
      startKg: ctx.fuelStartKg,
      capacityKg: vehicle.fuel.capacity_kg,
      flowRateKgH: f.fuel.flow_rate_kg_h,
      avgPerLapKg: f.fuel.avg_per_lap_kg,
      targetPerLapKg: ctx.fuelTargetPerLapKg,
      lapsRemaining: f.fuel.laps_remaining,
    },
    ers: {
      socPct: f.ers.soc_pct,
      mode: f.ers.mode,
      powerKw: f.ers.power_kw,
      harvestedMj: f.ers.harvested_mj,
      deployedMj: f.ers.deployed_mj,
      socHistory: ctx.socHistory,
    },
    brakes: {
      temps: { ...f.brakes.temps_c },
      padPct: f.brakes.pad_pct,
      fade: f.brakes.fade,
    },
    weather: {
      airTempC: f.weather.air_temp_c,
      trackTempC: f.weather.track_temp_c,
      windKmh: f.weather.wind_kmh,
      windDir: f.weather.wind_dir,
      rainMmH: f.weather.rain_mm_h,
      condition: f.weather.condition,
    },
  };
}

/** Projects one tick of simulator state into a canonical frame. */
export function toFrame(
  t: Telemetry,
  clock: number,
  track: Track,
  center: LatLon,
): TelemetryFrame {
  const p = pointAt(track, t.trackPos);
  const { lat, lon } = toLatLon(p.x, p.y, center);
  return {
    t: r(clock, 1),
    lap: t.lap,
    lap_time_s: r(t.lapTimeS, 2),
    track_pos: r(t.trackPos, 5),
    sector: t.sector,
    lat: r(lat, 7),
    lon: r(lon, 7),
    speed_kmh: r(t.speedKmh, 1),
    rpm: Math.round(t.rpm),
    gear: t.gear,
    throttle_pct: r(t.throttlePct, 1),
    brake_pct: r(t.brakePct, 1),
    steering_deg: r(t.steeringDeg, 2),
    lateral_g: r(t.lateralG, 3),
    longitudinal_g: r(t.longitudinalG, 3),
    tyres: {
      compound: t.tyres.compound,
      wear_pct: r(t.tyres.wearPct, 3),
      grip_level: r(t.tyres.gripLevel, 4),
      age_laps: t.tyres.ageLaps,
      temps_c: {
        fl: r(t.tyres.temps.fl, 1),
        fr: r(t.tyres.temps.fr, 1),
        rl: r(t.tyres.temps.rl, 1),
        rr: r(t.tyres.temps.rr, 1),
      },
      pressures_psi: {
        fl: r(t.tyres.pressures.fl, 2),
        fr: r(t.tyres.pressures.fr, 2),
        rl: r(t.tyres.pressures.rl, 2),
        rr: r(t.tyres.pressures.rr, 2),
      },
    },
    fuel: {
      remaining_kg: r(t.fuel.remainingKg, 3),
      flow_rate_kg_h: r(t.fuel.flowRateKgH, 1),
      avg_per_lap_kg: r(t.fuel.avgPerLapKg, 3),
      laps_remaining: t.fuel.lapsRemaining,
    },
    ers: {
      soc_pct: r(t.ers.socPct, 2),
      mode: t.ers.mode,
      power_kw: r(t.ers.powerKw, 1),
      harvested_mj: r(t.ers.harvestedMj, 3),
      deployed_mj: r(t.ers.deployedMj, 3),
    },
    brakes: {
      temps_c: {
        fl: r(t.brakes.temps.fl, 1),
        fr: r(t.brakes.temps.fr, 1),
        rl: r(t.brakes.temps.rl, 1),
        rr: r(t.brakes.temps.rr, 1),
      },
      pad_pct: r(t.brakes.padPct, 2),
      fade: t.brakes.fade,
    },
    weather: {
      air_temp_c: r(t.weather.airTempC, 1),
      track_temp_c: r(t.weather.trackTempC, 1),
      wind_kmh: r(t.weather.windKmh, 1),
      wind_dir: t.weather.windDir,
      rain_mm_h: r(t.weather.rainMmH, 2),
      condition: t.weather.condition,
    },
  };
}
