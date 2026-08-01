/**
 * The wire protocol between the race server and its clients.
 *
 * One server process owns the race. Every client — the pit wall, the driver
 * HUD, and eventually the Flutter app — is a subscriber that renders what it
 * is sent and asks the server to make changes. No client mutates race state
 * locally, which is what keeps the two views showing the same race.
 *
 * Telemetry rides in the canonical snake_case `TelemetryFrame` from
 * `frame.ts`, the same shape as `/data/timeseries/*.jsonl` and
 * `/data/schema/telemetry-frame.schema.json`, so a Dart client can reuse the
 * models generated from that schema.
 *
 * Bandwidth: `frame` goes out at 10 Hz and is roughly 1 KB. Everything else
 * changes at most once a lap, so those messages carry the whole list rather
 * than a delta — simpler, and the lists are small and capped.
 */

import { TelemetryFrame } from "./frame";
import {
  AgentMessage,
  Alert,
  Compound,
  LapSummary,
  StrategyState,
  Telemetry,
} from "./types";

/** Fixed for the life of a race. Re-sent when the track changes. */
export interface RaceMeta {
  raceId: string;
  trackKey: string;
  trackName: string;
  totalLaps: number;
}

/** Playback controls. Server-owned, so every client agrees on them. */
export interface ControlState {
  running: boolean;
  /** 1x is real time; higher values compress the race for demos. */
  speedMultiplier: number;
}

/**
 * Per-tick state that isn't part of the physics frame but changes often
 * enough to ride along with it.
 */
export interface LiveExtras {
  /**
   * The server's tick counter for this frame. Carried through so the client's
   * display snapshot keeps the single-frame guarantee (feedback/round-01 D2).
   */
  seq: number;
  status: Telemetry["status"];
  lastLapS: number;
  deltaToTargetS: number;
  socHistory: number[];
  /** Calibrated off the first flying lap, so it is not a frame field. */
  fuelTargetPerLapKg: number;
  /** The race's whole fuel load, sized to its distance. Not a frame field. */
  fuelStartKg: number;
  strategy: StrategyState;
}

export type ServerMessage =
  /** Sent once on connect so a client joining mid-race is immediately correct. */
  | {
      type: "snapshot";
      meta: RaceMeta;
      control: ControlState;
      frame: TelemetryFrame;
      live: LiveExtras;
      laps: LapSummary[];
      alerts: Alert[];
      agentMessages: AgentMessage[];
    }
  | { type: "frame"; frame: TelemetryFrame; live: LiveExtras }
  | { type: "laps"; laps: LapSummary[] }
  | { type: "alerts"; alerts: Alert[] }
  | { type: "agentMessages"; agentMessages: AgentMessage[] }
  | { type: "control"; control: ControlState }
  | { type: "meta"; meta: RaceMeta };

export type ClientMessage =
  /** Engineer approves a 2c anomaly, optionally rewording it for the driver. */
  | { type: "approve"; id: string; message?: string }
  | { type: "dismiss"; id: string }
  | { type: "pit"; compound: Compound }
  | { type: "setTrack"; key: string }
  | { type: "setSpeed"; multiplier: number }
  | { type: "setRunning"; running: boolean }
  | { type: "reset" };

/** Where the browser looks for the race server. */
function getDefaultWsUrl(): string {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const isLocalDev = host === "localhost" || host === "127.0.0.1";
    if (isLocalDev) {
      return "ws://localhost:4000";
    }
    return `${proto}//${window.location.host}/ws`;
  }
  return "ws://localhost:4000";
}
export const DEFAULT_WS_URL = getDefaultWsUrl();
export const DEFAULT_WS_PORT = 4000;
