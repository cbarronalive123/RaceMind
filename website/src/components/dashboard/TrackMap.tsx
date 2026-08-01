"use client";

import { useRaceStore, useSnapshot } from "@/lib/store";
import { getTrack, pointAt } from "@/lib/track";

/**
 * 2D fallback for the Google Photorealistic 3D map described in
 * docs/website-dashboard.md. Renders the real GPS trace from /data/tracks and
 * the live car position; swapping in Map3DElement later only changes this
 * component.
 */
export function TrackMap() {
  const trackKey = useRaceStore((s) => s.trackKey);
  const trackPos = useSnapshot((f) => f.trackPos);
  const sector = useSnapshot((f) => f.sector);

  const track = getTrack(trackKey);
  const car = pointAt(track, trackPos);
  const start = pointAt(track, 0);

  // Stroke widths are in metres, since the viewBox is a metric projection.
  const road = Math.max(6, track.lengthM / 190);

  return (
    <div className="flex h-full flex-col gap-2">
      <svg
        viewBox={track.svg.viewBox}
        className="w-full flex-1"
        role="img"
        aria-label={`${track.name} map, car in sector ${sector}`}
      >
        <path
          d={track.svg.pathD}
          fill="none"
          stroke="#2e2e2e"
          strokeWidth={road * 1.9}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={track.svg.pathD}
          fill="none"
          stroke="#4a4a4a"
          strokeWidth={road * 1.45}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={track.svg.pathD}
          fill="none"
          stroke="#141414"
          strokeWidth={road}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {track.sectorSplits.map((split, i) => {
          const p = pointAt(track, split);
          return (
            <g key={split}>
              <circle
                cx={p.x}
                cy={-p.y}
                r={road * 0.7}
                fill="#0a0a0a"
                stroke="#606060"
                strokeWidth={road * 0.22}
              />
              <text
                x={p.x}
                y={-p.y - road * 1.4}
                textAnchor="middle"
                fill="#a0a0a0"
                fontSize={road * 1.6}
              >
                S{i + 2}
              </text>
            </g>
          );
        })}

        <g>
          <rect
            x={start.x - road * 0.28}
            y={-start.y - road * 1.2}
            width={road * 0.56}
            height={road * 2.4}
            fill="#ffffff"
          />
          <text
            x={start.x}
            y={-start.y - road * 1.8}
            textAnchor="middle"
            fill="#ffffff"
            fontSize={road * 1.6}
          >
            S/F
          </text>
        </g>

        <circle cx={car.x} cy={-car.y} r={road * 1.5} fill="rgba(0,200,83,0.16)" />
        <circle cx={car.x} cy={-car.y} r={road * 0.68} fill="var(--color-status-ok)" />
      </svg>

      <div className="flex items-center justify-between border-t border-pit-border pt-2 text-[11px]">
        <span className="truncate text-ink-secondary">{track.name}</span>
        <span className="tnum shrink-0 text-ink">
          {(track.lengthM / 1000).toFixed(3)} km · Sector {sector}
        </span>
      </div>
    </div>
  );
}
