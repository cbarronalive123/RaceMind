"use client";

import { useEffect } from "react";
import { create } from "zustand";

import { fromFrame, TelemetryFrame } from "./frame";
import {
  ClientMessage,
  ControlState,
  DEFAULT_WS_URL,
  RaceMeta,
  ServerMessage,
} from "./protocol";
import { createSmoothingState, publish } from "./snapshot";
import { DEFAULT_TRACK_KEY } from "./track";
import { Compound, Telemetry } from "./types";

/**
 * Client-side race state.
 *
 * This store does not simulate. The server owns the race; this is a projection
 * of what it last sent, and every action is a request rather than a local
 * mutation. That is what makes two tabs show one race, where before each tab
 * ran its own simulator and drifted apart immediately.
 *
 * Two layers, per feedback/round-01 D2:
 *
 *   telemetry  what the server last sent, unpacked. The source of truth.
 *   display    one smoothed snapshot per tick, and the only thing widgets read.
 *
 * The smoothing in `snapshot.ts` is display-only — it never changes a stored
 * value, and the frames written to `/data/timeseries` are unaffected.
 */

export type ConnectionState = "connecting" | "open" | "closed";

const WS_URL = process.env.NEXT_PUBLIC_RACE_WS_URL ?? DEFAULT_WS_URL;

/** Reconnect backoff, milliseconds. Caps so a dead server is retried calmly. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8000;

interface RaceStore {
  connection: ConnectionState;
  /** What the server last sent, unpacked. Null until the first snapshot. */
  telemetry: Telemetry | null;
  /**
   * The one snapshot the dashboard renders (feedback/round-01 D2). Derived
   * from `telemetry` once per received frame, carrying the same `seq`, so
   * every widget in a painted frame is looking at the same instant.
   */
  display: Telemetry | null;
  /**
   * The most recent frame exactly as it came off the wire, unsmoothed. For
   * consumers that want canonical frames — the explore view, which also
   * replays them off disk — rather than the display projection.
   */
  frame: TelemetryFrame | null;
  meta: RaceMeta | null;
  control: ControlState;
  trackKey: string;

  setSpeedMultiplier: (multiplier: number) => void;
  toggleRunning: () => void;
  reset: () => void;
  setTrack: (key: string) => void;
  approveAlert: (id: string, message?: string) => void;
  dismissAlert: (id: string) => void;
  pitStop: (compound: Compound) => void;
}

let socket: WebSocket | null = null;
const smoothing = createSmoothingState();

function sendToServer(message: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  connection: "connecting",
  telemetry: null,
  display: null,
  frame: null,
  meta: null,
  control: { running: true, speedMultiplier: 4 },
  trackKey: DEFAULT_TRACK_KEY,

  setSpeedMultiplier: (multiplier) =>
    sendToServer({ type: "setSpeed", multiplier }),
  toggleRunning: () =>
    sendToServer({ type: "setRunning", running: !get().control.running }),
  reset: () => sendToServer({ type: "reset" }),
  setTrack: (key) => sendToServer({ type: "setTrack", key }),
  approveAlert: (id, message) => sendToServer({ type: "approve", id, message }),
  dismissAlert: (id) => sendToServer({ type: "dismiss", id }),
  pitStop: (compound) => sendToServer({ type: "pit", compound }),
}));

/**
 * Reads from the rendered snapshot (feedback/round-01 D2). Every dashboard
 * widget must go through this rather than touching `telemetry`, so that one
 * painted frame is one tick.
 *
 * Only valid beneath `<RaceGate>`, which does not render its children until
 * the first snapshot has arrived. `display` is never set back to null once
 * received, so within the gate this is always defined — a dropped connection
 * freezes the last frame rather than blanking the screen.
 */
export function useSnapshot<T>(select: (frame: Telemetry) => T): T {
  return useRaceStore((s) => {
    if (!s.display) {
      throw new Error("useSnapshot used outside <RaceGate>");
    }
    return select(s.display);
  });
}

/**
 * A step change rather than a trend, so the filter memory is dropped and the
 * new values appear immediately instead of ramping in: a fresh set of tyres,
 * a different track, or a race that restarted under us.
 */
function isDiscontinuity(prev: Telemetry, next: Telemetry): boolean {
  // The clock rewound, so this is a different race.
  if (next.lap < prev.lap) return true;
  // Fresh rubber: the compound changed, or the stint counter reset.
  if (next.tyres.compound !== prev.tyres.compound) return true;
  if (next.tyres.ageLaps < prev.tyres.ageLaps) return true;
  return false;
}

/** Folds one server message into store state. */
function apply(message: ServerMessage) {
  const store = useRaceStore.getState();

  switch (message.type) {
    case "snapshot": {
      const { frame, live, laps, alerts, agentMessages, meta, control } = message;
      const telemetry: Telemetry = {
        ...fromFrame(frame, {
          fuelTargetPerLapKg: live.fuelTargetPerLapKg,
          fuelStartKg: live.fuelStartKg,
          socHistory: live.socHistory,
        }),
        seq: live.seq,
        status: live.status,
        totalLaps: meta.totalLaps,
        lastLapS: live.lastLapS,
        deltaToTargetS: live.deltaToTargetS,
        strategy: live.strategy,
        laps,
        alerts,
        agentMessages,
      };
      // A fresh connection has no trend to continue from.
      smoothing.prev = null;
      useRaceStore.setState({
        meta,
        control,
        trackKey: meta.trackKey,
        frame,
        telemetry,
        display: publish(smoothing, telemetry),
      });
      break;
    }

    case "frame": {
      const current = store.telemetry;
      // A frame before the snapshot has no lists to merge into, so drop it;
      // the snapshot is moments away.
      if (!current) return;
      const { frame, live } = message;
      const telemetry: Telemetry = {
        ...current,
        ...fromFrame(frame, {
          fuelTargetPerLapKg: live.fuelTargetPerLapKg,
          fuelStartKg: live.fuelStartKg,
          socHistory: live.socHistory,
        }),
        seq: live.seq,
        status: live.status,
        lastLapS: live.lastLapS,
        deltaToTargetS: live.deltaToTargetS,
        strategy: live.strategy,
      };
      if (isDiscontinuity(current, telemetry)) smoothing.prev = null;
      useRaceStore.setState({
        frame,
        telemetry,
        display: publish(smoothing, telemetry),
      });
      break;
    }

    // Lists are never smoothed, so they are written straight through to both
    // layers and the two stay identical.
    case "laps":
      if (!store.telemetry || !store.display) return;
      useRaceStore.setState({
        telemetry: { ...store.telemetry, laps: message.laps },
        display: { ...store.display, laps: message.laps },
      });
      break;

    case "alerts":
      if (!store.telemetry || !store.display) return;
      useRaceStore.setState({
        telemetry: { ...store.telemetry, alerts: message.alerts },
        display: { ...store.display, alerts: message.alerts },
      });
      break;

    case "agentMessages":
      if (!store.telemetry || !store.display) return;
      useRaceStore.setState({
        telemetry: { ...store.telemetry, agentMessages: message.agentMessages },
        display: { ...store.display, agentMessages: message.agentMessages },
      });
      break;

    case "control":
      useRaceStore.setState({ control: message.control });
      break;

    case "meta":
      useRaceStore.setState({
        meta: message.meta,
        trackKey: message.meta.trackKey,
      });
      break;
  }
}

/**
 * Opens the connection to the race server and keeps it open.
 *
 * Mount once per page. The socket is a module singleton, so a second mount
 * would open a second connection and double the message rate.
 */
export function useRaceConnection() {
  useEffect(() => {
    let closed = false;
    let retryMs = RECONNECT_MIN_MS;
    let retryTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      useRaceStore.setState({ connection: "connecting" });

      const ws = new WebSocket(WS_URL);
      socket = ws;

      ws.onopen = () => {
        retryMs = RECONNECT_MIN_MS;
        useRaceStore.setState({ connection: "open" });
      };

      ws.onmessage = (event) => {
        try {
          apply(JSON.parse(event.data as string) as ServerMessage);
        } catch (error) {
          console.error("bad message from race server", error);
        }
      };

      ws.onclose = () => {
        if (closed) return;
        useRaceStore.setState({ connection: "closed" });
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
      };

      // An error is always followed by close, which owns the retry.
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    };
  }, []);
}
