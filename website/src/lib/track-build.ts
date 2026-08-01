/**
 * Build-time geometry derivation. Turns the canonical GPS tracks in
 * `/data/tracks` into the projected, smoothed racing line every client uses.
 *
 * This runs in `scripts/generate-data.ts`, never at request time. Two reasons:
 *
 *  - `Math.cos` is not guaranteed bit-identical across V8 versions, so running
 *    the projection in both Node and the browser produced SVG coordinates that
 *    differed in the last decimal and tripped a React hydration mismatch.
 *  - The driver app would otherwise have to reimplement resampling, smoothing,
 *    and curvature in Dart and match it exactly.
 *
 * Deriving once and committing the result to `/data/tracks/*.geometry.json`
 * removes both problems.
 *
 * Raw OSM centrelines have unevenly spaced vertices and sharp corners at
 * intersections, so we resample to even spacing and smooth before measuring
 * curvature — otherwise a single stray vertex reads as a hairpin and the
 * driver model brakes for nothing.
 */

/** Shape of a `/data/tracks/*.json` file — see data/schema/track.schema.json. */
export interface RawTrack {
  name: string;
  key: string;
  source?: string;
  roads?: string[];
  total_distance_m: number;
  num_corners: number;
  center: { lat: number; lon: number };
  points: {
    seq: number;
    lat: number;
    lon: number;
    point_type: string;
    label?: string | null;
  }[];
}

export interface TrackPoint {
  /** Metres east of the track centre. */
  x: number;
  /** Metres north of the track centre. */
  y: number;
  /** Cumulative distance from start/finish, metres. */
  s: number;
  /** Signed 1/radius, in 1/m. Positive turns one way, negative the other. */
  curvature: number;
}

/** Serialised form written to /data/tracks/<key>.geometry.json. */
export interface TrackGeometry {
  key: string;
  name: string;
  roads: string[];
  length_m: number;
  num_corners: number;
  /** Sector boundaries as fractions of a lap, ascending. */
  sector_splits: number[];
  svg: { path_d: string; view_box: string };
  /** Flat triples of [x metres, y metres, curvature 1/m], one per point. */
  points: number[][];
}

/** Even-spacing resample count. ~3-8 m between points on these circuits. */
const SAMPLES = 384;
/** Half-width of the curvature stencil, in resampled points. */
const CURVATURE_STENCIL = 4;
const SMOOTHING_PASSES = 3;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

type Vec = { x: number; y: number };

/** Equirectangular projection — accurate to centimetres over a 3 km circuit. */
function toMetres(
  point: { lat: number; lon: number },
  center: { lat: number; lon: number },
): Vec {
  return {
    x: (point.lon - center.lon) * M_PER_DEG_LON * Math.cos((center.lat * Math.PI) / 180),
    y: (point.lat - center.lat) * M_PER_DEG_LAT,
  };
}

/** Resample a closed polyline to `count` evenly spaced points. */
function resampleClosed(ring: Vec[], count: number): Vec[] {
  const n = ring.length;
  const cumulative: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const a = ring[i - 1];
    const b = ring[i % n];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cumulative[n];

  const out: Vec[] = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (seg < n - 1 && cumulative[seg + 1] < target) seg++;
    const segLen = cumulative[seg + 1] - cumulative[seg];
    const f = segLen > 0 ? (target - cumulative[seg]) / segLen : 0;
    const a = ring[seg];
    const b = ring[(seg + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/** Binomial smoothing around the ring, preserving the closed loop. */
function smoothClosed(ring: Vec[], passes: number): Vec[] {
  let cur = ring;
  const n = ring.length;
  for (let p = 0; p < passes; p++) {
    const next: Vec[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n];
      const b = cur[i];
      const c = cur[(i + 1) % n];
      next[i] = {
        x: (a.x + 2 * b.x + c.x) / 4,
        y: (a.y + 2 * b.y + c.y) / 4,
      };
    }
    cur = next;
  }
  return cur;
}

/** Menger curvature over a wide stencil, signed by turn direction. */
function curvatureAt(ring: Vec[], i: number): number {
  const n = ring.length;
  const a = ring[(i - CURVATURE_STENCIL + n) % n];
  const b = ring[i];
  const c = ring[(i + CURVATURE_STENCIL) % n];

  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) return 0;

  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const area = Math.abs(cross);
  if (area < 1e-9) return 0;

  return (Math.sign(cross) * (2 * area)) / (ab * bc * ca);
}

/** Where the sector lines sit, as fractions of a lap. */
function sectorSplitsFor(raw: RawTrack): number[] {
  const n = raw.points.length;
  const splits = raw.points
    .map((p, i) => ({ type: p.point_type, pos: i / n }))
    .filter((p) => p.type === "sector_line")
    .map((p) => p.pos)
    .filter((pos) => pos > 0.02 && pos < 0.98)
    .sort((a, b) => a - b);

  // Fall back to even thirds if the track has no marked sector lines.
  return splits.length >= 2 ? splits.slice(0, 2) : [1 / 3, 2 / 3];
}

function buildSvg(points: TrackPoint[]): { pathD: string; viewBox: string } {
  const pad = 30;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;

  // SVG y grows downward; north should point up, so flip y.
  const d =
    points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${(-p.y).toFixed(1)}`)
      .join(" ") + " Z";

  return {
    pathD: d,
    viewBox: `${minX.toFixed(1)} ${(-maxY).toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`,
  };
}

export function buildGeometry(raw: RawTrack): TrackGeometry {
  const ring = raw.points.map((p) => toMetres(p, raw.center));
  const resampled = smoothClosed(resampleClosed(ring, SAMPLES), SMOOTHING_PASSES);

  const points: TrackPoint[] = [];
  let s = 0;
  for (let i = 0; i < resampled.length; i++) {
    if (i > 0) {
      const prev = resampled[i - 1];
      s += Math.hypot(resampled[i].x - prev.x, resampled[i].y - prev.y);
    }
    points.push({
      x: resampled[i].x,
      y: resampled[i].y,
      s,
      curvature: curvatureAt(resampled, i),
    });
  }

  const last = resampled[resampled.length - 1];
  const lengthM = s + Math.hypot(resampled[0].x - last.x, resampled[0].y - last.y);

  const svg = buildSvg(points);
  return {
    key: raw.key,
    name: raw.name,
    roads: raw.roads ?? [],
    length_m: Number(lengthM.toFixed(2)),
    num_corners: raw.num_corners,
    sector_splits: sectorSplitsFor(raw).map((v) => Number(v.toFixed(6))),
    svg: { path_d: svg.pathD, view_box: svg.viewBox },
    points: points.map((p) => [
      Number(p.x.toFixed(2)),
      Number(p.y.toFixed(2)),
      Number(p.curvature.toFixed(6)),
    ]),
  };
}

