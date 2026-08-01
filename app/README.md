# RaceMind Driver App

Flutter (Dart) app targeting Android. This is the **car**: a sensor relay that
streams GPS + IMU + barometer to the backend at 10 Hz and speaks Gemma's calls
aloud to the driver.

Full specification: [`../docs/mobile-app.md`](../docs/mobile-app.md).

## Status

Not scaffolded yet. The HUD (Screen 3) has a browser reference implementation at
[`../website/src/components/hud/Hud.tsx`](../website/src/components/hud/Hud.tsx)
— layout, alert tiers, and gauge thresholds there are the spec the Flutter
screen should match.

## Shared data

The app does not define its own tracks, vehicle spec, or alert rules — it reads
[`/data`](../data/README.md), the same files the website uses. Declare it in
`pubspec.yaml`:

```yaml
flutter:
  assets:
    - ../data/tracks/
    - ../data/config/
```

Generate the Dart models from `/data/schema/*.schema.json` rather than
hand-writing them, so the app and website types cannot drift. The sample
packets in `/data/samples` replay a real lap without a backend, and
`/data/timeseries` has full simulated races for testing the HUD against
realistic input.

## Talking to the race server

The website's race server (`website/server/index.ts`) already speaks the
protocol the app needs, so the HUD can be wired up before any Python exists:

```
ws://<host>:4000
```

`website/src/lib/protocol.ts` is the message contract. The app subscribes,
renders `frame` messages, and sends `pit` when the driver boxes. Telemetry
arrives in the canonical snake_case shape from
`/data/schema/telemetry-frame.schema.json`, so generated Dart models fit it
directly.

Alerts reach the driver only once an engineer has approved them, which is the
whole point of the 2c tier — the app renders what it is sent and does not
decide.

## Planned structure

```
app/
  lib/
    main.dart
    screens/
      connect_calibrate.dart   # Screen 1 — race select, IMU calibration
      trace_track.dart         # Screen 2 — walk the track, submit GPS trace
      racer_hud.dart           # Screen 3 — the live HUD, audio-first
      pit_stop.dart            # Screen 4 — compound selection
    services/
      sensors.dart             # sensors_plus + geolocator, axis remapping
      telemetry_socket.dart    # web_socket_channel client + offline buffer
      replay.dart              # play back /data/samples without a backend
      tts.dart                 # flutter_tts priority queue
    models/                    # generated from /data/schema
  pubspec.yaml
```

## Getting started (once scaffolded)

```bash
flutter create --org app.racemind --platforms=android .
flutter pub add sensors_plus geolocator web_socket_channel flutter_tts hive
flutter run
```

## Key requirements from the spec

- GPS at 10 Hz in high-accuracy mode; IMU at 50 Hz, downsampled to 10 Hz for transmission
- Axis remapping per phone orientation (pocket / hand / armband)
- Offline buffer of ~60 s of packets, replayed in order on reconnect
- TTS is a core feature, not a stretch goal: every alert is spoken immediately,
  with critical alerts interrupting whatever is currently being said
- Foreground service so streaming survives a screen-off pocket
