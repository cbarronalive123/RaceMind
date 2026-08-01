# Behind the Scenes: Internals Section and Explore View

## Problem

RaceMind turns a phone's sensors into 55 channels of F1 telemetry through three layers of models, described in `docs/simulation-models.md` and configured by the JSON files in `data/config/`.
None of that is visible from the website.
The models are documented in prose and implemented in `website/src/lib/simulation.ts`, but there is no way to look at what a layer actually emits.

The eventual goal is a "behind the scenes" section of the site that shows each layer of models alongside its configuration.
This spec covers the first slice of that section: an explore view that streams telemetry channels and charts them as they arrive.

## Scope

In scope:

- An `/internals` section shell with navigation, including placeholders for the Models and Config views.
- An `/internals/explore` view that charts selected telemetry channels from either the live simulator or a recorded archive.
- The shared frame definition and channel registry that both this view and the later Models view will read from.

Out of scope, deferred to later specs:

- The Models view itself, which will explain each tier and link its channels to the code that produces them.
- The Config view, which will render `data/config/*.json`.
- Any backend.
  Both data sources are local: the running in-browser simulator, and the `.jsonl` files committed under `data/timeseries/`.

## Background: two shapes of the same data

The same telemetry exists in two different shapes today.

The live simulator carries the `Telemetry` interface from `website/src/lib/types.ts`, which is camelCase and nested (`speedKmh`, `tyres.wearPct`).
The generated archives under `data/timeseries/` carry the flat snake_case frame written by `frameOf()` in `website/scripts/generate-data.ts` (`speed_kmh`, `tyres.wear_pct`), and that shape is the one `data/schema/telemetry-frame.schema.json` describes.

For one view to render both sources, the two shapes have to meet somewhere.
They meet at the archive frame, because it is the shape that already has a published schema.

## Design

### 1. Shared frame definition

`frameOf()` moves out of `website/scripts/generate-data.ts` and into a new `website/src/lib/frame.ts`, which exports:

- `TelemetryFrame`, the TypeScript type matching `data/schema/telemetry-frame.schema.json`.
- `toFrame(telemetry, clock, track, center)`, the existing conversion, unchanged in behaviour.

`generate-data.ts` imports `toFrame` instead of defining it.
This leaves exactly one definition of a frame in the codebase, used by both the file writer and the browser.

Behaviour must not change.
`npm run generate:data` followed by `npm run validate:data` must still produce byte-identical archives that pass schema validation.

### 2. Channel registry

New `website/src/lib/channels.ts` exports a registry describing every numeric channel worth charting:

```ts
interface Channel {
  id: string;           // "tyres.wear_pct"
  label: string;        // "Tyre wear"
  unit: string;         // "%"
  tier: 1 | 2 | 3;      // per docs/simulation-models.md
  group: string;        // "Tyres"
  get: (f: TelemetryFrame) => number;
  domain?: [number, number];  // fixed axis range where one is meaningful
}
```

The picker, the chart, the legend, and the later Models view all read from this registry.
No component hardcodes a channel list.

`tier` is the link to the model layers.
Tier 1 channels come straight from phone sensors, tier 2 are simple derivations, tier 3 are modelled.
Assigning it here is what lets the Models view be built later without restructuring anything.

### 3. Two sources behind one interface

New `website/src/lib/explore/source.ts` defines the contract both sources satisfy:

```ts
interface FrameSource {
  frames: TelemetryFrame[];   // oldest to newest
  cursor: number;             // index the readouts describe
  status: "live" | "playing" | "paused" | "ended";
  controls: { ... };
}
```

**Live source.**
Subscribes to the existing `useRaceStore`, maps each tick through `toFrame`, and appends to a ring buffer capped at 3000 frames, which is five minutes at 10 Hz.
It does not start a second clock.
`useRaceClock` remains the only thing driving the simulation, so `/dashboard` and `/internals/explore` always show the same race at the same moment.
Transport controls delegate to the store's existing pause and speed multiplier.

**Replay source.**
A route handler at `/api/timeseries/[track]/[rate]` reads the requested `.jsonl` from `data/timeseries/` and returns it.
A route handler is required rather than a static asset because `data/` sits outside `website/`, so Next cannot serve it from `public/` without copying the files.
The handler validates `track` against `data/tracks/index.json` and `rate` against `10hz` and `1hz` before touching the filesystem, so a request cannot reach an arbitrary path.

The client parses the response once into an array, then plays frames out on a timer.
Because the whole array is in memory, the replay source can offer seek and scrubbing, which the live source cannot.

Swapping the source swaps nothing downstream.
The picker and chart consume `FrameSource` and do not know which implementation they have.

### 4. Layout

`/internals/layout.tsx` renders the section header and its navigation: Explore active, Models and Config present but marked as not built yet.
The landing page at `website/src/app/page.tsx` gains a link to the section.

`/internals/explore` is laid out in four parts.

**Top bar.**
A `LIVE | REPLAY` toggle and a track selector.
In replay, it also carries the rate selector (10 Hz or 1 Hz), play and pause, a speed multiplier, a scrubber, and a frame counter.
In live, it reuses the race store's pause and speed so the controls do not fight the dashboard's.

**Channel picker.**
A left rail listing channels grouped under Tier 1, Tier 2, and Tier 3 headings, with a filter box.
Each selected channel gets a colour, assigned from a fixed palette in selection order.
Selection is capped at six concurrent series, past which further channels are disabled rather than hidden, so the limit is visible rather than mysterious.

**Chart.**
Hand-rolled SVG in the same idiom as the existing sparkline in `website/src/components/dashboard/CentreColumn.tsx`.
No charting dependency is added.

The series share one time axis.
Each series is scaled to its own vertical range, because the units differ too widely to share a value axis: fuel in kilograms and rpm in thousands cannot share a scale usefully.
The legend therefore carries each series' actual value and unit, which is where the numbers are read.
Hovering shows a crosshair and moves the cursor, so the legend and the raw frame below both describe the hovered moment.

A Scale control chooses what that vertical range means, because the two useful readings are different questions:

- **Fit window** (default) fits the range present in the window.
  Without it a channel that moves through a sliver of its configured range is an unreadable flat line: tyre wear crossing 0.2% is invisible on a 0-100 axis and a legible curve when fitted.
  The fitted range is clamped to the channel's configured bounds, so a throttle trace never claims an axis running from -8% to 108%.
- **Car limits** uses the range from `data/config/vehicle.json`, which answers instead how close the car is to what it can do.

The legend prints each series' current axis range, so a fitted line is never a mystery about what it is scaled to.
The plot is inset vertically by a few pixels, so a channel sitting at either end of its range is drawn fully rather than reading as clipped by the frame.

**Raw frame.**
A collapsible pretty-printed JSON dump of the frame at the cursor.
This is what makes the view honest: the chart is an interpretation, and the frame underneath it is the data.

## Testing

The repository has no test runner today, and this spec does not add one.
Verification is the checks that already exist, all of which pass on the current commit and must still pass:

- `npm run typecheck`
- `npm run lint`
- `npm run validate:data`, which currently validates 514 records against `data/schema`

Because the frame extraction in step 1 is a refactor of code that writes committed data, it carries a specific regression check.
After extracting `toFrame`, regenerate the archives and confirm `git diff` reports no change to any file under `data/`.
If the diff is non-empty, the extraction changed behaviour and is wrong.

Beyond that, verification is manual against the running app: both sources stream, the channel picker drives the chart, replay seeks, and the live view stays in step with `/dashboard`.

## Risks

The replay files are large.
`telemetry-1hz.jsonl` is around 2 MB per track, and parsing it into memory on the client is acceptable for a local development view but would not be for a public one.
If that becomes a problem, the route handler is the place to fix it, by ranging over the file rather than returning it whole.
That is deliberately not built now.
