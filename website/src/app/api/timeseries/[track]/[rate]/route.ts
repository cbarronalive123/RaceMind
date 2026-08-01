/**
 * Serves the recorded race archives to the explore view.
 *
 * `/data` sits outside `website/`, so Next cannot serve these files from
 * `public/` without duplicating them. A route handler reads them in place,
 * which keeps `data/` the single copy.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import trackIndex from "@data/tracks/index.json";

const TRACK_KEYS = new Set(trackIndex.tracks.map((t) => t.key));

/** Request rate to filename. Also the allowlist - nothing else is readable. */
const FILES: Record<string, string> = {
  "10hz": "telemetry-10hz.jsonl",
  "1hz": "telemetry-1hz.jsonl",
};

const DATA = join(process.cwd(), "..", "data");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ track: string; rate: string }> },
) {
  const { track, rate } = await params;

  // Both segments are checked against fixed sets before any path is built, so
  // a crafted segment cannot escape data/timeseries.
  if (!TRACK_KEYS.has(track)) {
    return Response.json({ error: `unknown track: ${track}` }, { status: 404 });
  }
  const file = FILES[rate];
  if (!file) {
    return Response.json({ error: `unknown rate: ${rate}` }, { status: 404 });
  }

  try {
    const body = await readFile(join(DATA, "timeseries", track, file), "utf8");
    return new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        // The archives only change when generate:data is re-run.
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return Response.json(
      { error: `no ${file} for ${track} - run npm run generate:data` },
      { status: 404 },
    );
  }
}
