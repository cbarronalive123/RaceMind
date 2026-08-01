# RaceMind Website (Pit Wall)

Next.js 15 App Router + TypeScript + Tailwind v4 + Zustand.
Specification: [`../docs/website-dashboard.md`](../docs/website-dashboard.md).

## Run

Two processes: the race server owns the race, Next serves the UI.

```bash
npm install
npm run dev:all     # race server + web, http://localhost:3000
```

Or separately, in two terminals:

```bash
npm run dev:server  # ws://localhost:4000
npm run dev         # http://localhost:3000
```

Node 20+ required. Without the race server the UI shows a "no race server"
card and retries — it will not fall back to simulating locally, because a
silent local fallback is exactly the desync this architecture removes.

## Routes

| Route        | What it is                                                              |
| ------------ | ----------------------------------------------------------------------- |
| `/`          | Index of what is built and what is not                                   |
| `/dashboard` | View 4 — Live Race Dashboard, three columns, engineer control panel      |
| `/hud`       | Driver HUD (mobile app Screen 3) rendered at phone width in the browser  |

Views 1-3 (Track Setup, Race Configuration, Pre-Race Report) are not built yet.

## Shared data

Tracks, vehicle spec, tyre compounds, alert rules, and weather presets all come
from [`/data`](../data/README.md) via the `@data/*` path alias — the same files
the Flutter app reads, so the two cannot drift. Nothing in `src/` hardcodes a
physics constant.

```bash
npm run build:geometry   # derive tracks/*.geometry.json from the GPS traces
npm run generate:data    # + full simulated races into data/timeseries
npm run validate:data    # everything against data/schema
```

The track picker in the top bar switches between the three RIM Park circuits;
switching restarts the race, since the physics state is track-specific.

## Architecture

```
                    ┌─────────────────────────┐
                    │  server/index.ts        │
                    │  owns the race          │
                    │  ticks physics at 10 Hz │
                    └───────────┬─────────────┘
                                │ WebSocket :4000
                   ┌────────────┴────────────┐
                   ▼                         ▼
            /dashboard                    /hud
            (pit wall)                (driver HUD)
```

One process holds the race. Clients subscribe and render what they are sent;
they never mutate race state locally. Approving a 2c anomaly on the pit wall
is a request to the server, which applies it once and broadcasts the result,
so the driver HUD sees the same alert with the same wording.

The wire protocol is `src/lib/protocol.ts`. Telemetry rides in the canonical
snake_case frame from `frame.ts` — the same shape as `/data/timeseries` and
`/data/schema/telemetry-frame.schema.json` — so the Flutter app can reuse
models generated from that schema.

The server is TypeScript purely so it can import `src/lib/simulation.ts`
directly, keeping one implementation of the physics rather than a second in
Python that has to be kept in step. It stands in for the Python backend in
`docs/data-flow.md`; when that arrives it should keep this protocol, and the
clients do not change. No auth, no persistence, one race at a time.

## Historical runs

The pit wall has a collapsed **HISTORICAL RUNS** bar under the live telemetry.
Expanding it opens a replay of any recorded race from `/data/timeseries`, with
its own transport: play, pause, scrub, and 1x/4x/16x. The live race keeps
running behind it — the left column, engineer panel, and timing tower stay
live, so pausing the replay does not pause the race and vice versa.

Replay is deliberately kept away from the live pipeline. `HistoryDrawer.tsx`
imports the race store nowhere, so a replayed frame cannot reach the alert
rules, the anomaly approval queue, or the Gemma feed. Recorded alerts render
as a read-only record of what fired during that race — each showing whether it
reached the driver, was dismissed, or was never actioned — and carry no
approve or dismiss buttons.

It is styled to be unmistakable: hatched chrome, a dashed edge, a REPLAY
wordmark, a square marker rather than the round live status light, and an
archive clock counting time within the recording rather than wall time.

The rate selector names what each file covers, since they differ: 1 Hz is the
whole race, 10 Hz is the first three laps (see `/data/README.md` for why).

Served by `/api/runs` (the index) and `/api/runs/[track]` (summary, laps, and
alert record), both separate from anything the live race uses.

## The simulator

There is no backend yet, so `src/lib/simulation.ts` stands in for the whole
pipeline described in `docs/data-flow.md` (phone sensors → physics models →
Redis → WebSocket). It runs a synthetic car around a real GPS track and applies
the same models the backend will:

| Model      | Drives                                                        |
| ---------- | ------------------------------------------------------------- |
| Driver     | Target speed from track curvature, braking on corner approach  |
| Fuel       | Flow rate from speed², throttle, cornering load, wind, compound |
| Tyre wear  | Lateral load + speed + track temp, with a grip cliff past 62%   |
| Tyre temp  | Per corner — outer tyres in a corner, fronts under braking      |
| Brake temp | Per corner, front-biased, cooled by airflow                     |
| ERS        | Harvest under braking, deploy on throttle, 4 MJ store           |

It is fully deterministic — no `Date.now()`, no `Math.random()` — so the
server-rendered frame matches the client's and there are no hydration errors.
For the same reason, track geometry is derived at build time into
`/data/tracks/*.geometry.json` rather than projected at render time: `Math.cos`
is not bit-identical across V8 versions, and the last-decimal difference
between Node and the browser was enough to trip a hydration mismatch.

Top-bar controls: 1x / 4x / 16x time compression, pause, reset. 4x is the
default so a lap takes about 20 seconds.

### Alert tiers

The alert system (`docs/alert-system.md`) is wired end to end:

- **2a** preventative rules and **2b** signal patterns fire automatically and
  land on the HUD immediately
- **2c** anomalies queue in the engineer panel as **pending**. Approve, modify
  the driver-facing wording, or dismiss. Only approved ones reach `/hud`, tagged
  `[2c] ✓ VERIFIED`

Open `/dashboard` and `/hud` in two windows to watch the handoff live: both are
connected to the same race, so an approval on the pit wall appears on the HUD
within a frame.

## Swapping in the real backend

Reimplement `server/index.ts` in Python behind the same protocol. The browser
does not change: `src/lib/store.ts` already consumes frames off a socket, and
`src/lib/types.ts` mirrors the Redis hot-state shape.

`src/components/dashboard/TrackMap.tsx` is a 2D SVG placeholder for the Google
Photorealistic 3D map (`Map3DElement`); replacing it touches nothing else. It
renders the real GPS trace, so the 3D swap is a rendering change only.

## Design rules

From the spec's pit-wall theme: typography and UI edges are strictly
white/grey. Colour only ever carries data meaning — status dots, gauge fills,
compound badges — never headings, links, borders, or body text.
