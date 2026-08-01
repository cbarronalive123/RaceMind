export type Compound = "soft" | "medium" | "hard" | "intermediate" | "wet";

export type Severity = "low" | "medium" | "high" | "critical";

/** Alert tiers from docs/alert-system.md. */
export type AlertTier = "2a" | "2b" | "2c";

export type AlertStatus = "pending" | "sent" | "dismissed";

export interface Corners {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

export interface TyreState {
  compound: Compound;
  wearPct: number;
  gripLevel: number;
  ageLaps: number;
  temps: Corners;
  pressures: Corners;
}

export interface FuelState {
  remainingKg: number;
  /**
   * What the car started the race with. Sized to the race distance, since
   * refuelling is banned and this is the entire fuel budget — see
   * `race-defaults.json` fuel_policy.
   */
  startKg: number;
  /** Tank size. A spec limit, not the load actually carried. */
  capacityKg: number;
  flowRateKgH: number;
  avgPerLapKg: number;
  targetPerLapKg: number;
  lapsRemaining: number;
}

export interface ErsState {
  socPct: number;
  mode: "deploy" | "harvest" | "balanced";
  powerKw: number;
  harvestedMj: number;
  deployedMj: number;
  socHistory: number[];
}

export interface WeatherState {
  airTempC: number;
  trackTempC: number;
  windKmh: number;
  windDir: string;
  rainMmH: number;
  condition: "dry" | "damp" | "wet";
}

export interface LapSummary {
  lap: number;
  s1: number;
  s2: number;
  s3: number;
  total: number;
  fuelKg: number;
  wearPct: number;
  alertTier?: AlertTier;
}

export interface Alert {
  id: string;
  tier: AlertTier;
  severity: Severity;
  lap: number;
  title: string;
  message: string;
  status: AlertStatus;
  createdAt: number;
  /** 2c only: channels + deviation that triggered the anomaly. */
  channels?: { name: string; sigma: number }[];
  sigma?: number;
  recommendation?: string;
}

export interface AgentMessage {
  id: string;
  lap: number;
  text: string;
  createdAt: number;
}

export interface StrategyState {
  plan: string;
  stintLap: number;
  stintLength: number;
  pitWindow: [number, number];
  confidencePct: number;
  deltaVsAltS: number;
  targetLapTimeS: number;
}

export interface Telemetry {
  /**
   * Monotonic tick counter. Every field below was produced by this one tick,
   * so any two values carrying the same `seq` are consistent with each other
   * (feedback/round-01 D2). Widgets must render from a single snapshot rather
   * than reading channels independently.
   */
  seq: number;
  status: "live" | "paused" | "finished";
  lap: number;
  totalLaps: number;
  lapTimeS: number;
  lastLapS: number;
  deltaToTargetS: number;
  /** 0..1 position around the track path. */
  trackPos: number;
  sector: 1 | 2 | 3;
  speedKmh: number;
  rpm: number;
  gear: number;
  throttlePct: number;
  brakePct: number;
  steeringDeg: number;
  lateralG: number;
  longitudinalG: number;
  tyres: TyreState;
  fuel: FuelState;
  ers: ErsState;
  brakes: { temps: Corners; padPct: number; fade: boolean };
  weather: WeatherState;
  strategy: StrategyState;
  laps: LapSummary[];
  alerts: Alert[];
  agentMessages: AgentMessage[];
}
