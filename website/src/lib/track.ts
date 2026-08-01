/**
 * Track geometry, loaded from `/data/tracks/*.geometry.json`.
 *
 * Those files are derived once at build time by `scripts/generate-data.ts`
 * (see `track-build.ts` for the projection, resampling, smoothing, and
 * curvature maths) and committed. Nothing here recomputes them:
 *
 *  - the numbers are then byte-identical on the server and in the browser,
 *    which a runtime projection could not guarantee, and
 *  - the driver app reads the same files instead of reimplementing the maths
 *    in Dart.
 *
 * Regenerate with `npm run generate:data` after changing a track.
 */

import clubGeometry from "@data/tracks/club.geometry.json";
import grandGeometry from "@data/tracks/grand.geometry.json";
import sprintGeometry from "@data/tracks/sprint.geometry.json";
import trackIndex from "@data/tracks/index.json";

export interface TrackPoint {
  /** Metres east of the track centre. */
  x: number;
  /** Metres north of the track centre. */
  y: number;
  /** Signed 1/radius, in 1/m. Positive turns one way, negative the other. */
  curvature: number;
}

export interface Track {
  key: string;
  name: string;
  roads: string[];
  lengthM: number;
  numCorners: number;
  points: TrackPoint[];
  /** Sector boundaries as fractions of a lap, ascending. */
  sectorSplits: number[];
  svg: { pathD: string; viewBox: string };
}

/** Shape of a `*.geometry.json` file. */
interface GeometryFile {
  key: string;
  name: string;
  roads: string[];
  length_m: number;
  num_corners: number;
  sector_splits: number[];
  svg: { path_d: string; view_box: string };
  points: number[][];
}

function load(geometry: GeometryFile): Track {
  return {
    key: geometry.key,
    name: geometry.name,
    roads: geometry.roads,
    lengthM: geometry.length_m,
    numCorners: geometry.num_corners,
    sectorSplits: geometry.sector_splits,
    svg: { pathD: geometry.svg.path_d, viewBox: geometry.svg.view_box },
    points: geometry.points.map(([x, y, curvature]) => ({ x, y, curvature })),
  };
}

export const TRACKS: Record<string, Track> = {
  sprint: load(sprintGeometry as GeometryFile),
  club: load(clubGeometry as GeometryFile),
  grand: load(grandGeometry as GeometryFile),
};

export const TRACK_KEYS = trackIndex.tracks.map((t) => t.key);
export const DEFAULT_TRACK_KEY = trackIndex.default;

export function getTrack(key: string): Track {
  return TRACKS[key] ?? TRACKS[DEFAULT_TRACK_KEY];
}

export function sectorFor(track: Track, pos: number): 1 | 2 | 3 {
  if (pos < track.sectorSplits[0]) return 1;
  if (pos < track.sectorSplits[1]) return 2;
  return 3;
}

/** Interpolated point at a normalised lap position (0..1). */
export function pointAt(track: Track, pos: number): TrackPoint {
  const t = ((pos % 1) + 1) % 1;
  const n = track.points.length;
  const f = t * n;
  const i = Math.floor(f);
  const frac = f - i;
  const a = track.points[i % n];
  const b = track.points[(i + 1) % n];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    curvature: a.curvature + (b.curvature - a.curvature) * frac,
  };
}

/**
 * Peak absolute curvature within `metres` down the road — used to decide when
 * to lift and brake for a corner the car has not reached yet.
 */
export function curvatureAhead(track: Track, pos: number, metres: number): number {
  let peak = 0;
  // Step at the track's own point spacing. Sampling coarser than the geometry
  // steps straight over a short corner: a fixed 8 samples over 140 m meant a
  // 17.5 m stride, which missed the 3.7 m radius hairpin on the sprint circuit
  // entirely, so the car arrived at it unbraked at 14.9 g.
  const spacing = track.lengthM / track.points.length;
  const steps = Math.max(8, Math.ceil(metres / spacing));
  for (let i = 1; i <= steps; i++) {
    const ahead = pos + (metres * i) / steps / track.lengthM;
    peak = Math.max(peak, Math.abs(pointAt(track, ahead).curvature));
  }
  return peak;
}
