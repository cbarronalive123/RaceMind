/**
 * Every numeric channel a telemetry frame carries, and which layer of models
 * produces it.
 *
 * The tiers mirror docs/simulation-models.md:
 *
 *   Tier 1  straight off the phone's sensors or the weather API, scaled but
 *           not modelled
 *   Tier 2  simple arithmetic on tier 1 (lap detection, pedal inference)
 *   Tier 3  the physics models: fuel burn, tyre thermals and wear, ERS,
 *           brake temperature, the engine map
 *
 * Everything that renders a channel reads it from here. Adding a channel to
 * this list is the only step needed to make it explorable.
 */

import vehicle from "@data/config/vehicle.json";
import { FrameCorners, TelemetryFrame } from "./frame";

export type Tier = 1 | 2 | 3;

export interface Channel {
  /** Dotted path into the frame; also the stable identity used in state. */
  id: string;
  label: string;
  /** Empty string for dimensionless channels like gear. */
  unit: string;
  tier: Tier;
  /** Heading the channel sits under in the picker. */
  group: string;
  get: (f: TelemetryFrame) => number;
  /**
   * Fixed axis range, where the channel has a meaningful one. Channels
   * without a domain are scaled to the range actually present in the window.
   */
  domain?: [number, number];
}

const { rpm_min, rpm_max } = vehicle.gearbox;
const MAX_G = vehicle.limits.max_lateral_g;
const MAX_SPEED = vehicle.limits.max_speed_kmh;
const FUEL_CAPACITY = vehicle.fuel.capacity_kg;
const MAX_FLOW = vehicle.fuel.max_flow_kg_h;
const MGU_K_MAX = vehicle.ers.mgu_k_max_kw;
const BRAKE_MIN = vehicle.brakes.min_temp_c;
const BRAKE_MAX = vehicle.brakes.max_temp_c;

const CORNERS: { key: keyof FrameCorners; label: string }[] = [
  { key: "fl", label: "FL" },
  { key: "fr", label: "FR" },
  { key: "rl", label: "RL" },
  { key: "rr", label: "RR" },
];

/** Expands a per-wheel reading into its four corner channels. */
function corners(
  idPrefix: string,
  labelPrefix: string,
  unit: string,
  tier: Tier,
  group: string,
  pick: (f: TelemetryFrame) => FrameCorners,
  domain?: [number, number],
): Channel[] {
  return CORNERS.map(({ key, label }) => ({
    id: `${idPrefix}.${key}`,
    label: `${labelPrefix} ${label}`,
    unit,
    tier,
    group,
    get: (f: TelemetryFrame) => pick(f)[key],
    domain,
  }));
}

export const CHANNELS: Channel[] = [
  // Tier 1 - the phone, scaled into F1 ranges.
  {
    id: "speed_kmh",
    label: "Speed",
    unit: "km/h",
    tier: 1,
    group: "GPS",
    get: (f) => f.speed_kmh,
    domain: [0, MAX_SPEED],
  },
  { id: "lat", label: "Latitude", unit: "°", tier: 1, group: "GPS", get: (f) => f.lat },
  { id: "lon", label: "Longitude", unit: "°", tier: 1, group: "GPS", get: (f) => f.lon },
  {
    id: "lateral_g",
    label: "Lateral G",
    unit: "g",
    tier: 1,
    group: "IMU",
    get: (f) => f.lateral_g,
    domain: [-MAX_G, MAX_G],
  },
  {
    id: "longitudinal_g",
    label: "Longitudinal G",
    unit: "g",
    tier: 1,
    group: "IMU",
    get: (f) => f.longitudinal_g,
    domain: [-MAX_G, MAX_G],
  },
  {
    id: "weather.air_temp_c",
    label: "Air temp",
    unit: "°C",
    tier: 1,
    group: "Weather",
    get: (f) => f.weather.air_temp_c,
  },
  {
    id: "weather.track_temp_c",
    label: "Track temp",
    unit: "°C",
    tier: 1,
    group: "Weather",
    get: (f) => f.weather.track_temp_c,
  },
  {
    id: "weather.wind_kmh",
    label: "Wind",
    unit: "km/h",
    tier: 1,
    group: "Weather",
    get: (f) => f.weather.wind_kmh,
  },
  {
    id: "weather.rain_mm_h",
    label: "Rain",
    unit: "mm/h",
    tier: 1,
    group: "Weather",
    get: (f) => f.weather.rain_mm_h,
  },

  // Tier 2 - arithmetic on tier 1.
  { id: "lap", label: "Lap", unit: "", tier: 2, group: "Timing", get: (f) => f.lap },
  {
    id: "lap_time_s",
    label: "Lap time",
    unit: "s",
    tier: 2,
    group: "Timing",
    get: (f) => f.lap_time_s,
  },
  {
    id: "sector",
    label: "Sector",
    unit: "",
    tier: 2,
    group: "Timing",
    get: (f) => f.sector,
    domain: [1, 3],
  },
  {
    id: "track_pos",
    label: "Lap position",
    unit: "",
    tier: 2,
    group: "Timing",
    get: (f) => f.track_pos,
    domain: [0, 1],
  },
  {
    id: "throttle_pct",
    label: "Throttle",
    unit: "%",
    tier: 2,
    group: "Driver inputs",
    get: (f) => f.throttle_pct,
    domain: [0, 100],
  },
  {
    id: "brake_pct",
    label: "Brake",
    unit: "%",
    tier: 2,
    group: "Driver inputs",
    get: (f) => f.brake_pct,
    domain: [0, 100],
  },
  {
    id: "steering_deg",
    label: "Steering",
    unit: "°",
    tier: 2,
    group: "Driver inputs",
    get: (f) => f.steering_deg,
  },

  // Tier 3 - the physics models.
  {
    id: "rpm",
    label: "RPM",
    unit: "rpm",
    tier: 3,
    group: "Engine",
    get: (f) => f.rpm,
    domain: [rpm_min, rpm_max],
  },
  {
    id: "gear",
    label: "Gear",
    unit: "",
    tier: 3,
    group: "Engine",
    get: (f) => f.gear,
    domain: [1, 8],
  },
  {
    id: "tyres.wear_pct",
    label: "Tyre wear",
    unit: "%",
    tier: 3,
    group: "Tyres",
    get: (f) => f.tyres.wear_pct,
    domain: [0, 100],
  },
  {
    id: "tyres.grip_level",
    label: "Grip level",
    unit: "",
    tier: 3,
    group: "Tyres",
    get: (f) => f.tyres.grip_level,
    domain: [0, 1],
  },
  {
    id: "tyres.age_laps",
    label: "Tyre age",
    unit: "laps",
    tier: 3,
    group: "Tyres",
    get: (f) => f.tyres.age_laps,
  },
  ...corners(
    "tyres.temps_c",
    "Tyre temp",
    "°C",
    3,
    "Tyres",
    (f) => f.tyres.temps_c,
  ),
  ...corners(
    "tyres.pressures_psi",
    "Tyre pressure",
    "psi",
    3,
    "Tyres",
    (f) => f.tyres.pressures_psi,
  ),
  {
    id: "fuel.remaining_kg",
    label: "Fuel remaining",
    unit: "kg",
    tier: 3,
    group: "Fuel",
    get: (f) => f.fuel.remaining_kg,
    domain: [0, FUEL_CAPACITY],
  },
  {
    id: "fuel.flow_rate_kg_h",
    label: "Fuel flow",
    unit: "kg/h",
    tier: 3,
    group: "Fuel",
    get: (f) => f.fuel.flow_rate_kg_h,
    domain: [0, MAX_FLOW],
  },
  {
    id: "fuel.avg_per_lap_kg",
    label: "Fuel per lap",
    unit: "kg",
    tier: 3,
    group: "Fuel",
    get: (f) => f.fuel.avg_per_lap_kg,
  },
  {
    id: "fuel.laps_remaining",
    label: "Laps of fuel",
    unit: "laps",
    tier: 3,
    group: "Fuel",
    get: (f) => f.fuel.laps_remaining,
  },
  {
    id: "ers.soc_pct",
    label: "ERS charge",
    unit: "%",
    tier: 3,
    group: "ERS",
    get: (f) => f.ers.soc_pct,
    domain: [0, 100],
  },
  {
    id: "ers.power_kw",
    label: "ERS power",
    unit: "kW",
    tier: 3,
    group: "ERS",
    get: (f) => f.ers.power_kw,
    domain: [-MGU_K_MAX, MGU_K_MAX],
  },
  {
    id: "ers.harvested_mj",
    label: "ERS harvested",
    unit: "MJ",
    tier: 3,
    group: "ERS",
    get: (f) => f.ers.harvested_mj,
  },
  {
    id: "ers.deployed_mj",
    label: "ERS deployed",
    unit: "MJ",
    tier: 3,
    group: "ERS",
    get: (f) => f.ers.deployed_mj,
  },
  ...corners(
    "brakes.temps_c",
    "Brake temp",
    "°C",
    3,
    "Brakes",
    (f) => f.brakes.temps_c,
    [BRAKE_MIN, BRAKE_MAX],
  ),
  {
    id: "brakes.pad_pct",
    label: "Brake pad",
    unit: "%",
    tier: 3,
    group: "Brakes",
    get: (f) => f.brakes.pad_pct,
    domain: [0, 100],
  },
];

export const CHANNELS_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

export const TIERS: { tier: Tier; title: string; blurb: string }[] = [
  {
    tier: 1,
    title: "Tier 1",
    blurb: "Direct from phone sensors and the weather API",
  },
  { tier: 2, title: "Tier 2", blurb: "Derived by simple arithmetic" },
  { tier: 3, title: "Tier 3", blurb: "Output of the physics models" },
];

/** Channels of one tier, bucketed by group, in registry order. */
export function groupsForTier(tier: Tier): { group: string; channels: Channel[] }[] {
  const out: { group: string; channels: Channel[] }[] = [];
  for (const channel of CHANNELS) {
    if (channel.tier !== tier) continue;
    const existing = out.find((g) => g.group === channel.group);
    if (existing) existing.channels.push(channel);
    else out.push({ group: channel.group, channels: [channel] });
  }
  return out;
}

/**
 * Series colours, assigned in selection order. Chosen to stay distinguishable
 * against the dark pit-wall background and from each other.
 */
export const SERIES_COLOURS = [
  "#4da3ff",
  "#ffb020",
  "#3ddc97",
  "#ff5c7c",
  "#b98cff",
  "#5ee0e6",
];

export const MAX_SERIES = SERIES_COLOURS.length;
