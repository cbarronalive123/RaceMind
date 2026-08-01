/**
 * One recorded race: its summary, every lap, and every alert that fired.
 *
 * Deliberately a separate endpoint from anything the live race uses. A
 * recorded alert is a record of what fired during that race — it is not a
 * pending item, and nothing here should ever reach the engineer's approval
 * queue or the agent feed. Replay is evidence, not telemetry.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import trackIndex from "@data/tracks/index.json";

const TRACK_KEYS = new Set(trackIndex.tracks.map((t) => t.key));
const DATA = join(process.cwd(), "..", "data");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ track: string }> },
) {
  const { track } = await params;

  // Checked against a fixed set before any path is built, so a crafted
  // segment cannot escape data/timeseries.
  if (!TRACK_KEYS.has(track)) {
    return Response.json({ error: `unknown run: ${track}` }, { status: 404 });
  }

  const dir = join(DATA, "timeseries", track);
  try {
    const [meta, laps, alerts] = await Promise.all([
      readFile(join(dir, "meta.json"), "utf8"),
      readFile(join(dir, "laps.json"), "utf8"),
      readFile(join(dir, "alerts.json"), "utf8"),
    ]);
    return Response.json(
      {
        meta: JSON.parse(meta),
        laps: JSON.parse(laps),
        alerts: JSON.parse(alerts),
      },
      { headers: { "cache-control": "public, max-age=3600" } },
    );
  } catch {
    return Response.json(
      { error: `no archive for ${track} - run npm run generate:data` },
      { status: 404 },
    );
  }
}
