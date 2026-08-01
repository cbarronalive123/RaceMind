# Feedback

Drop zone for review rounds during the build. Each round is a folder holding the
written feedback plus whatever data backs it up, so a note and the telemetry it
refers to stay together.

## Layout

```
feedback/
├── README.md            <- this file
├── round-01/
│   ├── feedback.md      <- the written feedback
│   └── timeseries/      <- CSV / JSON / JSONL telemetry backing it
└── round-02/
    └── ...
```

Add `round-02/`, `round-03/`, … as they come. Anything that doesn't fit a round
(one-off notes, reference captures) can sit loose in `feedback/`.

## Writing a `feedback.md`

No required template — plain prose is fine. These are the things that most change
what I do with it, so include them when they apply:

- **What you were doing** — which surface (mobile sensor stream, simulation engine,
  Gemma agent, dashboard), and what you expected versus what happened.
- **When** — a timestamp, lap number, or filename so I can line the note up against
  the time series.
- **Priority** — blocking the demo, or a polish item. Determines whether I fix it
  now or log it.

## Time series files

Drop them in the round's `timeseries/` folder. Any of these read cleanly:

| Format | Notes |
|--------|-------|
| CSV | Header row with channel names; a `ts` or `timestamp` column |
| JSONL | One telemetry packet per line — matches the WebSocket packet shape |
| JSON | A single array of packets, or a `lap_summaries`-style export |

Channel names matching [`docs/database-schema.md`](../docs/database-schema.md)
(`speed_kmh`, `tyre_wear_pct`, `fuel_remaining_kg`, …) let me cross-reference
against the simulation models without guessing. If they don't match, a line in
`feedback.md` mapping them is enough.

Large captures are fine, but note the sample rate and duration in `feedback.md`
so I know whether a gap is real or just downsampling.

## How I work through a round

1. Read `feedback.md` first, then the time series it points at.
2. Reproduce before changing anything — if I can't, I say so rather than guessing.
3. Fix, verify against the data, and report what changed and what I left alone.

Findings that outlive a round get written up in `docs/`; the round folder stays as
the record of what was raised and when.
