/**
 * Derives `/data/tracks/<key>.geometry.json` from the canonical GPS tracks.
 *
 * Run from website/:  npm run build:geometry
 * (also run automatically as the first step of `npm run generate:data`)
 *
 * Must run before anything that imports `src/lib/track.ts`, which loads these
 * files rather than recomputing them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGeometry, RawTrack } from "../src/lib/track-build";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACKS_DIR = join(HERE, "..", "..", "data", "tracks");

const index = JSON.parse(readFileSync(join(TRACKS_DIR, "index.json"), "utf8"));

for (const entry of index.tracks) {
  const raw: RawTrack = JSON.parse(
    readFileSync(join(TRACKS_DIR, `${entry.key}.json`), "utf8"),
  );
  const geometry = buildGeometry(raw);
  writeFileSync(
    join(TRACKS_DIR, `${entry.key}.geometry.json`),
    JSON.stringify(geometry, null, 2) + "\n",
  );

  const drift = ((geometry.length_m / raw.total_distance_m - 1) * 100).toFixed(2);
  console.log(
    `${entry.key.padEnd(7)} ${geometry.points.length} pts  ` +
      `${geometry.length_m.toFixed(1)} m (${drift}% vs raw trace)  ` +
      `sectors at ${geometry.sector_splits.map((s) => s.toFixed(3)).join(", ")}`,
  );
}
