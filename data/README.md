# Shared data

Everything the driver app, the website, and the eventual backend must agree on.
Plain JSON and JSONL, no build step, no package to install — the website imports
these files directly and Flutter loads them as bundled assets.

If a number is here, nothing else should hardcode it.

## Layout

| Path                | Contents                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| `tracks/`           | Canonical circuits: raw GPS traces plus derived racing-line geometry           |
| `config/`           | Vehicle spec, tyre compounds, alert rules, weather presets, race defaults      |
| `schema/`           | JSON Schema for every record type — the contract between the three components  |
| `samples/`          | One lap of raw phone sensor packets per track, for replay and tests            |
| `timeseries/`       | Full simulated races: telemetry frames, lap summaries, alerts                  |

## tracks/

Built by `tools/track_generator` from OpenStreetMap road centrelines around RIM
Park, Waterloo ON. Three circuits sharing the same roads:

| Key      | Circuit                 | Length   | Corners |
| -------- | ----------------------- | -------- | ------- |
| `sprint` | RIM Park Sprint Circuit | 774 m    | 3       |
| `club`   | RIM Park Club Circuit   | 1,220 m  | 7       |
| `grand`  | RIM Park Grand Circuit  | 2,962 m  | 4       |

Two files per track:

- **`<key>.json`** — the raw trace: ordered lat/lon points with typed markers
  (`start_finish`, `sector_line`, and eventually `pit_entry`, `drs_*`). Same
  shape the mobile app's Trace Track screen submits after backend smoothing.
  Regenerate with `python3 tools/track_generator/build_tracks_from_osm.py`,
  which writes here by default.
- **`<key>.geometry.json`** — the derived racing line: the trace projected to
  metres, resampled to 384 even points, smoothed, with signed curvature per
  point, sector splits, and a ready-to-render SVG path.

`index.json` lists the tracks and names the default (`club`).

### Why geometry is precomputed rather than derived at runtime

Two reasons, both practical:

1. `Math.cos` is not guaranteed bit-identical across V8 versions, so projecting
   in Node and again in the browser produced SVG coordinates differing in the
   last decimal — enough for React to report a hydration mismatch.
2. Otherwise the Flutter app would have to reimplement resampling, smoothing,
   and curvature in Dart and match the TypeScript exactly.

Deriving once and committing the result removes both problems. The maths lives
in `website/src/lib/track-build.ts`; run `npm run build:geometry` to refresh.

Smoothing shortens each loop by 1-2% against the raw trace, which is the
corner-cutting a racing line actually does. `build:geometry` prints the drift.

## config/

| File                     | What it seeds                                                        |
| ------------------------ | -------------------------------------------------------------------- |
| `vehicle.json`           | 2026 spec: mass, fuel, ERS, brakes, aero, tyre pressures, grip limits  |
| `tyre-compounds.json`    | Wear and fuel multipliers, colours, expected life, the grip cliff      |
| `alert-rules.json`       | Tier 2a preventative rules                                            |
| `signal-patterns.json`   | Tier 2b signal detection patterns                                     |
| `anomaly-detection.json` | Tier 2c sensitivity and Gemma's interpretation templates               |
| `weather-presets.json`   | Seed conditions and the live simulator's event cadence                 |
| `race-defaults.json`     | Track, lap count, starting compound, strategy, telemetry rate          |

The physics constants in `vehicle.json` are not decoration — the simulator reads
them directly, so changing `max_lateral_g` changes how the car corners.

## schema/

JSON Schema 2020-12 for each record type:

| Schema                        | Describes                                            |
| ----------------------------- | ---------------------------------------------------- |
| `track.schema.json`           | A raw GPS track file                                  |
| `sensor-packet.schema.json`   | One 10 Hz packet, app → backend                       |
| `telemetry-frame.schema.json` | One frame of derived F1 telemetry, backend → clients  |
| `lap-summary.schema.json`     | A completed lap                                       |
| `alert.schema.json`           | An alert at any of the three tiers                    |

Validate everything against them:

```bash
cd website && npm run validate:data
```

These are also the source to generate Dart models from, so the app's types
cannot drift from the website's.

## timeseries/

A full 57-lap simulated race per track, produced by the same physics the live
dashboard runs.

| File                   | Contents                                                  |
| ---------------------- | ---------------------------------------------------------- |
| `telemetry-10hz.jsonl` | Full-rate frames, first 3 laps                             |
| `telemetry-1hz.jsonl`  | The whole race, decimated to 1 Hz                          |
| `laps.json`            | All 57 lap summaries                                       |
| `alerts.json`          | Every 2a/2b/2c alert raised, with status                   |
| `meta.json`            | Provenance, totals, fastest lap, alert counts by tier      |

A whole race at 10 Hz is 16k-36k frames, about 20 MB per track — too much to
keep in git, hence the split. Both files are slices of the same deterministic
run, so nothing is inconsistent between them. To materialise the full thing
locally:

```bash
cd website && npm run generate:data -- --full-rate-laps=57
```

## samples/

`<key>-sensor-packets.jsonl` is one lap of raw phone packets, reconstructed
from the simulated run. The real pipeline runs the other way (packets in,
telemetry out), so these are useful as replay fixtures for the app and as
inputs when testing backend physics models.

## Regenerating

```bash
cd website
npm run build:geometry   # tracks/*.geometry.json from tracks/*.json
npm run generate:data    # geometry, then timeseries/ and samples/
npm run validate:data    # everything against schema/
```

Output is deterministic — no `Date.now()`, no `Math.random()` — so the same
code and config produce byte-identical files. A diff in `git status` after
regenerating means something actually changed.

## Reading it

**Website** — imported directly via the `@data/*` path alias:

```ts
import vehicle from "@data/config/vehicle.json";
```

**Flutter** — declare `../data` in `pubspec.yaml` assets and read at startup:

```dart
final vehicle = jsonDecode(await rootBundle.loadString('data/config/vehicle.json'));
```

Prefer streaming the `.jsonl` files line by line rather than parsing them whole;
the largest is a few MB.
