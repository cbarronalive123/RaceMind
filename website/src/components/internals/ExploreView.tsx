"use client";

import { useCallback, useMemo, useState } from "react";
import { ChannelChart } from "@/components/internals/ChannelChart";
import { ChannelPicker } from "@/components/internals/ChannelPicker";
import { RawFrame } from "@/components/internals/RawFrame";
import { CHANNELS_BY_ID, MAX_SERIES, SERIES_COLOURS } from "@/lib/channels";
import {
  FrameSource,
  Rate,
  SPEEDS,
  useLiveSource,
  useReplaySource,
} from "@/lib/explore/source";
import { ScaleMode, windowFrames, WINDOWS } from "@/lib/explore/series";
import { useRaceConnection, useRaceStore } from "@/lib/store";
import { getTrack, TRACK_KEYS } from "@/lib/track";

/** Channels selected on first load: one from each tier, to show the idea. */
const DEFAULT_SELECTION = ["speed_kmh", "throttle_pct", "tyres.wear_pct"];

export function ExploreView() {
  // Feeds the LIVE source. Deliberately the bare connection rather than
  // <RaceGate>: REPLAY reads off disk and must keep working when no race
  // server is running.
  useRaceConnection();

  const [kind, setKind] = useState<"live" | "replay">("live");
  const [rate, setRate] = useState<Rate>("10hz");
  const [replayTrack, setReplayTrack] = useState(TRACK_KEYS[0]);
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);
  const [windowIndex, setWindowIndex] = useState(0);
  const [scale, setScale] = useState<ScaleMode>("auto");
  const [hover, setHover] = useState<number | null>(null);

  const liveTrack = useRaceStore((s) => s.trackKey);
  const setLiveTrack = useRaceStore((s) => s.setTrack);

  // Both hooks always run: hooks cannot be called conditionally, and keeping
  // the live buffer filling in the background means switching back to LIVE
  // shows history rather than an empty chart.
  const live = useLiveSource();
  const replay = useReplaySource(replayTrack, rate);
  const source: FrameSource = kind === "live" ? live : replay;

  const trackKey = kind === "live" ? liveTrack : replayTrack;
  const setTrackKey = kind === "live" ? setLiveTrack : setReplayTrack;

  const colourOf = useCallback(
    (id: string) => {
      const i = selected.indexOf(id);
      return i === -1 ? null : SERIES_COLOURS[i % SERIES_COLOURS.length];
    },
    [selected],
  );

  const toggle = useCallback((id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : current.length >= MAX_SERIES
          ? current
          : [...current, id],
    );
  }, []);

  const series = useMemo(
    () =>
      selected
        .map((id, i) => {
          const channel = CHANNELS_BY_ID.get(id);
          return channel
            ? { channel, colour: SERIES_COLOURS[i % SERIES_COLOURS.length] }
            : null;
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [selected],
  );

  const visible = useMemo(
    () =>
      windowFrames(source.frames, source.playhead, WINDOWS[windowIndex].seconds),
    [source.frames, source.playhead, windowIndex],
  );

  // The hover index addresses the visible window, which is what the chart and
  // the raw frame below it both describe.
  const cursorFrame = visible[hover ?? visible.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Controls
        kind={kind}
        setKind={setKind}
        rate={rate}
        setRate={setRate}
        trackKey={trackKey}
        setTrackKey={setTrackKey}
        windowIndex={windowIndex}
        setWindowIndex={setWindowIndex}
        scale={scale}
        setScale={setScale}
        source={source}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-pit-border">
          <ChannelPicker
            selected={selected}
            onToggle={toggle}
            colourOf={colourOf}
          />
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {source.state === "error" ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-status-warn">
                {source.error}
              </div>
            ) : source.state === "loading" ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-ink-muted">
                Loading {trackKey} at {rate}…
              </div>
            ) : (
              <ChannelChart
                frames={visible}
                series={series}
                cursor={hover}
                onCursor={setHover}
                scale={scale}
              />
            )}
          </div>

          <RawFrame frame={cursorFrame} />
        </div>
      </div>
    </div>
  );
}

function Controls({
  kind,
  setKind,
  rate,
  setRate,
  trackKey,
  setTrackKey,
  windowIndex,
  setWindowIndex,
  scale,
  setScale,
  source,
}: {
  kind: "live" | "replay";
  setKind: (k: "live" | "replay") => void;
  rate: Rate;
  setRate: (r: Rate) => void;
  trackKey: string;
  setTrackKey: (k: string) => void;
  windowIndex: number;
  setWindowIndex: (i: number) => void;
  scale: ScaleMode;
  setScale: (s: ScaleMode) => void;
  source: FrameSource;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-pit-border px-3 py-2">
      <div className="flex rounded border border-pit-border">
        {(["live", "replay"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`px-2.5 py-1 text-[10px] tracking-[0.12em] uppercase transition-colors ${
              kind === k
                ? "bg-pit-panel-2 text-ink"
                : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <Select
        label="Track"
        value={trackKey}
        onChange={setTrackKey}
        options={TRACK_KEYS.map((key) => ({
          value: key,
          label: getTrack(key).name,
        }))}
      />

      {kind === "replay" && (
        <Select
          label="Rate"
          value={rate}
          onChange={(v) => setRate(v as Rate)}
          options={[
            { value: "10hz", label: "10 Hz (opening laps)" },
            { value: "1hz", label: "1 Hz (whole race)" },
          ]}
        />
      )}

      <Select
        label="Window"
        value={String(windowIndex)}
        onChange={(v) => setWindowIndex(Number(v))}
        options={WINDOWS.map((w, i) => ({ value: String(i), label: w.label }))}
      />

      <Select
        label="Scale"
        value={scale}
        onChange={(v) => setScale(v as ScaleMode)}
        options={[
          { value: "auto", label: "Fit window" },
          { value: "limits", label: "Car limits" },
        ]}
      />

      <button
        onClick={() => source.setPlaying(!source.playing)}
        className="rounded border border-pit-border px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:border-ink hover:text-ink"
      >
        {source.playing ? "Pause" : "Play"}
      </button>

      <Select
        label="Speed"
        value={String(source.speed)}
        onChange={(v) => source.setSpeed(Number(v))}
        options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
      />

      {source.seek && (
        <label className="flex min-w-40 flex-1 items-center gap-2">
          <input
            type="range"
            min={0}
            max={Math.max(0, source.total - 1)}
            value={Math.max(0, source.playhead)}
            onChange={(e) => source.seek?.(Number(e.target.value))}
            className="w-full accent-white"
            aria-label="Seek"
          />
        </label>
      )}

      <span className="tnum ml-auto text-[10px] text-ink-muted">
        {source.total > 0
          ? `${Math.max(0, source.playhead) + 1} / ${source.total} frames`
          : "no frames"}
      </span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] tracking-[0.12em] text-ink-muted uppercase">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-pit-border bg-pit-panel px-1.5 py-1 text-[11px] text-ink outline-none hover:border-ink focus:border-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
