"use client";

/**
 * The two ways the explore view gets frames, behind one interface.
 *
 * LIVE follows the simulator that /dashboard is already running. REPLAY reads
 * a recorded archive out of /data/timeseries. Both hand back the same
 * TelemetryFrame shape, so nothing downstream knows which it has.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TelemetryFrame } from "../frame";
import { useRaceStore } from "../store";

export type SourceKind = "live" | "replay";
export type Rate = "10hz" | "1hz";

export interface FrameSource {
  kind: SourceKind;
  /** Frames that have arrived so far, oldest to newest. */
  frames: TelemetryFrame[];
  /** Index of the current frame, or -1 while empty. */
  playhead: number;
  /**
   * Frames the source will ever have. For REPLAY this is the whole file, which
   * is what the scrubber needs; for LIVE it is however many have arrived.
   */
  total: number;
  state: "loading" | "ready" | "error";
  error: string | null;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  /** REPLAY only: move the playhead. LIVE always sits at the newest frame. */
  seek?: (index: number) => void;
}

/**
 * How many frames the live view keeps. Five minutes at 10 Hz - enough to hold
 * several laps of any of the tracks without growing without bound.
 */
const LIVE_BUFFER = 3000;

export const SPEEDS = [1, 4, 16];

/**
 * Follows the running race.
 *
 * This opens no connection of its own — `<RaceGate>` owns the socket, and this
 * only accumulates the frames the server pushes, so the explore view and the
 * dashboard always show the same race at the same moment. Transport controls
 * are requests to the server, which is why pausing here pauses it for every
 * connected client, not just this tab.
 */
export function useLiveSource(): FrameSource {
  const buffer = useRef<TelemetryFrame[]>([]);
  const [frames, setFrames] = useState<TelemetryFrame[]>([]);

  const running = useRaceStore((s) => s.control.running);
  const speed = useRaceStore((s) => s.control.speedMultiplier);
  const setSpeed = useRaceStore((s) => s.setSpeedMultiplier);
  const toggleRunning = useRaceStore((s) => s.toggleRunning);
  const trackKey = useRaceStore((s) => s.trackKey);

  // Switching track restarts the race, invalidating everything buffered.
  useEffect(() => {
    buffer.current = [];
    setFrames([]);
  }, [trackKey]);

  useEffect(() => {
    const unsubscribe = useRaceStore.subscribe((state, prev) => {
      const frame = state.frame;
      if (!frame || frame === prev.frame) return;
      // A reset rewinds the clock; drop the stale tail rather than drawing a
      // line backwards through time.
      const last = buffer.current[buffer.current.length - 1];
      if (last && frame.t < last.t) buffer.current = [];

      buffer.current.push(frame);
      if (buffer.current.length > LIVE_BUFFER) buffer.current.shift();
      // A fresh array each tick, so consumers see a new identity and rerender.
      setFrames(buffer.current.slice());
    });
    return unsubscribe;
  }, []);

  const setPlaying = useCallback(
    (next: boolean) => {
      if (next !== useRaceStore.getState().control.running) toggleRunning();
    },
    [toggleRunning],
  );

  return {
    kind: "live",
    frames,
    playhead: frames.length - 1,
    total: frames.length,
    state: "ready",
    error: null,
    playing: running,
    setPlaying,
    speed,
    setSpeed,
  };
}

/**
 * Plays back a recorded archive.
 *
 * The whole file is parsed up front, which is what makes seeking possible.
 * See the risks note in the design spec: fine for a local development view,
 * not for a public one.
 */
export function useReplaySource(trackKey: string, rate: Rate): FrameSource {
  const [all, setAll] = useState<TelemetryFrame[]>([]);
  const [playhead, setPlayhead] = useState(-1);
  const [state, setState] = useState<FrameSource["state"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(4);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    setAll([]);
    setPlayhead(-1);

    fetch(`/api/timeseries/${trackKey}/${rate}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `request failed (${res.status})`);
        }
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const frames = text
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as TelemetryFrame);
        setAll(frames);
        setPlayhead(frames.length ? 0 : -1);
        setState("ready");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [trackKey, rate]);

  // Advance the playhead in wall-clock time, scaled by the speed multiplier.
  // Frame spacing comes from the file's own rate, so 1x is real time for both.
  useEffect(() => {
    if (state !== "ready" || !playing || all.length === 0) return;
    const frameMs = rate === "10hz" ? 100 : 1000;
    // Ideal gap between frames at this speed. Below ~20 ms the browser cannot
    // keep up with one frame per tick, so tick slower and step further.
    const idealMs = frameMs / speed;
    const tickMs = Math.max(20, idealMs);
    const stride = Math.max(1, Math.round(tickMs / idealMs));

    const id = window.setInterval(() => {
      setPlayhead((i) => {
        const next = i + stride;
        if (next >= all.length) {
          setPlaying(false);
          return all.length - 1;
        }
        return next;
      });
    }, tickMs);
    return () => window.clearInterval(id);
  }, [state, playing, speed, rate, all.length]);

  const seek = useCallback(
    (index: number) => {
      if (all.length === 0) return;
      setPlayhead(Math.max(0, Math.min(all.length - 1, Math.round(index))));
    },
    [all.length],
  );

  // Only what has "arrived" so far, so replay reads like a stream rather than
  // a chart of the whole file that happens to have a cursor on it.
  const frames = useMemo(
    () => (playhead < 0 ? [] : all.slice(0, playhead + 1)),
    [all, playhead],
  );

  return {
    kind: "replay",
    frames,
    playhead,
    total: all.length,
    state,
    error,
    playing,
    setPlaying,
    speed,
    setSpeed,
    seek,
  };
}
