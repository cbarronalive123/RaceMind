# Mobile App Specification

## Overview

The mobile app is the **car**. It rides in the driver's pocket or is mounted to their body, captures raw sensor data, and streams it to the backend where the simulation engine transforms it into F1 telemetry. The app is intentionally minimal — it's a sensor relay, not a dashboard.

**Platform:** Android (core target) — iOS support deprioritized
**Framework:** Flutter (Dart) — cross-platform, fast sensor access
**Alternative:** Native Android (Kotlin) if sensor polling rate is insufficient in cross-platform

---

## App Screens

### Screen 1: Connect & Calibrate

```
┌────────────────────────────┐
│                            │
│      RACEMIND DRIVER       │
│                            │
│  Race: [Melbourne GP  ▼]   │
│  Status: ● Connected       │
│                            │
│  ┌──────────────────────┐  │
│  │    CALIBRATION       │  │
│  │                      │  │
│  │  Hold phone still    │  │
│  │  in driving position │  │
│  │  for 3 seconds...    │  │
│  │                      │  │
│  │  Accel: ✓ zeroed     │  │
│  │  Gyro:  ✓ zeroed     │  │
│  │  GPS:   ✓ locked     │  │
│  │  Baro:  ✓ reading    │  │
│  │                      │  │
│  └──────────────────────┘  │
│                            │
│  Orientation: [Pocket ▼]   │
│  • Pocket (phone upright)  │
│  • Hand (screen up)        │
│  • Armband (screen out)    │
│                            │
│      [ READY TO RACE ]     │
│                            │
└────────────────────────────┘
```

**Purpose:**
- Select active race (pulls from backend)
- Calibrate IMU (zero out gravity, establish axis orientation)
- Set phone placement mode (maps axes correctly)
- Confirm GPS lock and sensor availability

### Screen 2: Trace Track (Pre-Race Setup)

```
┌────────────────────────────┐
│                            │
│      TRACE TRACK           │
│                            │
│  ┌──────────────────────┐  │
│  │                      │  │
│  │    Mini Map View     │  │
│  │    (shows your GPS   │  │
│  │     path live as     │  │
│  │     you walk it)     │  │
│  │                      │  │
│  │     ● ─ ─ ─ ●       │  │
│  │    /           \     │  │
│  │   ●             ●    │  │
│  │    \           /     │  │
│  │     ● ─ ─ ─ ●       │  │
│  │                      │  │
│  └──────────────────────┘  │
│                            │
│  GPS Accuracy: 3.1m ✓      │
│  Points Captured: 847      │
│  Distance: 1,243m          │
│  Duration: 4:12            │
│                            │
│  ┌────────────────────────┐│
│  │                        ││
│  │  [ 🔴 START TRACING ]  ││
│  │                        ││
│  │  [ ⬛ STOP TRACING  ]  ││
│  │                        ││
│  └────────────────────────┘│
│                            │
│  Status: Recording...      │
│  Walk the track at a       │
│  steady pace. Stay on      │
│  the racing line.          │
│                            │
│  ──────────────────────    │
│  [ DISCARD & RETRY ]       │
│  [ ✓ SUBMIT TRACK ]        │
│                            │
└────────────────────────────┘
```

**Purpose:**
- One-time use before a race to capture the track layout
- User walks/drives the track path while phone records GPS at high accuracy (10 Hz)
- Live mini-map shows the path forming in real-time so user can verify coverage
- On stop, app auto-connects start/finish into a closed loop
- User reviews the trace, can discard and retry if GPS was bad
- On submit, raw GPS trace is sent to backend for smoothing and storage

**Technical Details:**
- GPS in **high-accuracy mode** (uses GPS + WiFi + cell triangulation)
- Records at 10 Hz (10 points/second)
- Stores locally until submit (in case of network loss during trace)
- Shows real-time stats: distance covered, point count, GPS accuracy indicator
- If accuracy drops below 8m, shows warning (orange indicator)
- On "Stop Tracing": calculates gap between start and end point
  - If < 20m: auto-connects (good trace)
  - If 20-50m: warns user, offers to connect anyway or retry
  - If > 50m: suggests retry (trace didn't close properly)

**Data Sent to Backend on Submit:**

```json
{
  "action": "submit_track_trace",
  "trace": {
    "points": [
      {"lat": 43.7325, "lon": -79.6214, "altitude": 334.2, "accuracy": 3.1, "ts": 1722430567.100},
      {"lat": 43.7326, "lon": -79.6213, "altitude": 334.3, "accuracy": 2.8, "ts": 1722430567.200},
      ...
    ],
    "start_ts": 1722430567.100,
    "end_ts": 1722430819.400,
    "total_points": 2523,
    "total_distance_m": 5412,
    "avg_accuracy_m": 3.4
  }
}
```

**Backend Processing (after receive):**
1. Remove outlier points (accuracy > 10m or jump > 10m from neighbors)
2. Simplify with Ramer-Douglas-Peucker (reduce to ~200-500 points)
3. Smooth with cubic spline interpolation
4. Close the loop (blend end → start seamlessly)
5. Resample at even spacing (~10m intervals)
6. Calculate track specs (distance, corners, elevation)
7. Store in `track_points` table
8. Push to website for rendering on 3D map

---

### Screen 3: Racer HUD (During Race)

The live screen IS the HUD. It's designed to be glanceable in <0.5 seconds with audio-first communication. The driver doesn't read — they listen. The screen is a backup visual.

```
┌────────────────────────────┐
│  🟢 LIVE   Lap 14 / 57    │
├────────────────────────────┤
│                            │
│     267 km/h       [6]     │
│     ████████████████░░     │
│     +0.3s vs target        │
│                            │
├────────────────────────────┤
│                            │
│  ┌──────────────────────┐  │
│  │  🔶 ALERT            │  │
│  │                      │  │
│  │  "Tyre wear 55% —   │  │
│  │   prepare to pit     │  │
│  │   next 3 laps"       │  │
│  │                      │  │
│  │  [2a] HIGH  Lap 14   │  │
│  └──────────────────────┘  │
│                            │
│  Recent:                   │
│  • "Stint update: 41%      │
│     wear, fuel on target"  │
│  • "ERS harvest declining  │
│     — brake harder zones"  │
│                            │
├────────────────────────────┤
│  Fuel: ███████░░░  62 kg   │
│  Tyres: █████░░░░  55%     │
│  ERS:  ████████░░  67%     │
│  Brakes: 612° OK           │
│                            │
├────────────────────────────┤
│  [ PIT REQUEST ]           │
│                            │
│  ─ Out-Lap Guide ──────    │
│  ● T1-T4 push hard to     │
│    build tyre temp         │
│  ● T5-T7 lift and coast   │
│                            │
│  ──────────────────────    │
│  🔊 Audio: ON  │ 10Hz ●   │
└────────────────────────────┘
```

**Alert Display Behavior:**

| Priority | Visual | Audio | Duration |
|----------|--------|-------|----------|
| Critical | Full-screen RED flash | Urgent tone + TTS interrupts | Until driver taps dismiss |
| High | Orange banner (top card) | Alert chime + TTS | 10 seconds |
| Medium | Yellow card | Subtle chime + TTS | 5 seconds |
| Wet Crossover | Blue card + steering wheel icon | Two-tone chime + TTS | Until box confirmed or 3 laps pass |
| Out-Lap Guide | Green card (mini-map style) | Single soft tone + TTS | Shows for first 2 laps after pit |
| Low | Gray text in "Recent" list | TTS only (no chime) | 3 seconds |

**Alert Tier Indicators:**
- `[2a]` = Preventative rule (configured by engineer)
- `[2b]` = Signal detection (pattern matched)
- `[2c] ✓ VERIFIED` = Anomaly, engineer-approved before reaching HUD

**Audio TTS (Core Feature, Not Stretch Goal):**
- Every alert is spoken aloud via TTS immediately on arrival
- Priority queue: Critical interrupts current speech, High waits, Medium/Low queue
- Voice: short, imperative sentences ("Brake temps high. Ease S1." not "Your brake temperatures appear elevated, you may want to...")
- TTS keeps working even with screen off / phone in pocket
- Volume: max system volume, overrides media

**What the Driver Experiences:**

```
[Walking along, phone in pocket]

CHIME + TTS: "Tyre wear fifty-five percent. Prepare to pit next three laps."

[3 laps later]

CHIME + TTS: "Box box box. Pit this lap for hard tyres."

[Driver walks to pit zone, speed drops to 0]
→ Auto-switches to Pit Stop screen
```

**Key Design Principles:**
- Audio-first: driver should NEVER need to look at phone during race
- Screen is backup/confirmation only
- Alerts auto-dismiss after timeout (no interaction required)
- Only critical alerts require tap-to-dismiss (safety: ensures driver acknowledged)
- Recent alerts list scrolls so driver can check what they missed at a glance
- Minimal data on screen: speed, gear, 3 gauges, alert card — nothing else

### Screen 4: Pit Stop

```
┌────────────────────────────┐
│                            │
│     🔴 PIT STOP MODE      │
│                            │
│  Speed: 0 km/h            │
│  Pit limiter: ACTIVE       │
│                            │
│  ┌──────────────────────┐  │
│  │  SELECT NEW TYRES:   │  │
│  │                      │  │
│  │  ○ Soft    (~18 laps)│  │
│  │  ● Hard    (~32 laps)│  │
│  │  ○ Inter   (if wet)  │  │
│  │                      │  │
│  │  [ CONFIRM CHANGE ]  │  │
│  └──────────────────────┘  │
│                            │
│  Agent recommends: HARD    │
│  "Switch to hard as        │
│   planned. Track temp is   │
│   rising — hards will      │
│   work well."              │
│                            │
│  Stationary time: 2.4s     │
│                            │
│     [ RESUME RACE ]        │
│                            │
└────────────────────────────┘
```

**Purpose:**
- Triggered when speed drops to 0 in pit zone GPS area
- Driver selects new tyre compound
- Shows agent recommendation
- Tracks stationary time (pit duration)
- "Resume Race" resets tyre model to fresh

---

## Sensor Capture Specification

### Sensors Used

| Sensor | Android API | iOS API | Rate | Purpose |
|--------|-------------|---------|------|---------|
| GPS | FusedLocationProvider | CLLocationManager | 10 Hz | Position, speed, heading |
| Accelerometer | TYPE_LINEAR_ACCELERATION | CMDeviceMotion.userAcceleration | 50 Hz | Braking, throttle, cornering |
| Gyroscope | TYPE_GYROSCOPE | CMDeviceMotion.rotationRate | 50 Hz | Yaw, roll, pitch |
| Barometer | TYPE_PRESSURE | CMAltimeter | 1 Hz | Altitude, air density |
| Magnetometer | TYPE_MAGNETIC_FIELD | CLHeading | 10 Hz | Heading backup |

### Data Packet Format

Sent to backend every 100ms (10 Hz) via WebSocket:

```json
{
  "ts": 1722430567.234,
  "race_id": "uuid-here",
  "gps": {
    "lat": 43.7325,
    "lon": -79.6214,
    "speed_ms": 2.4,
    "heading_deg": 187.3,
    "altitude_m": 334.2,
    "accuracy_m": 3.1
  },
  "imu": {
    "accel_x": 0.12,
    "accel_y": -0.34,
    "accel_z": 0.02,
    "gyro_x": 0.005,
    "gyro_y": 0.002,
    "gyro_z": -0.087
  },
  "baro": {
    "pressure_mbar": 1013.2
  },
  "meta": {
    "battery_pct": 72,
    "orientation": "pocket"
  }
}
```

### Sensor Fusion & Preprocessing (on-device)

Before sending, the app does minimal preprocessing:

```python
# 1. Axis remapping based on orientation mode
def remap_axes(raw_accel, raw_gyro, orientation):
    if orientation == "pocket":
        # Phone vertical in pocket: Y=forward, X=lateral, Z=up
        return {
            "accel_longitudinal": raw_accel.y,
            "accel_lateral": raw_accel.x,
            "accel_vertical": raw_accel.z,
            "yaw_rate": raw_gyro.z,
            "roll_rate": raw_gyro.x,
            "pitch_rate": raw_gyro.y,
        }
    elif orientation == "hand":
        # Phone flat in hand: X=lateral, Y=forward, Z=up
        return {
            "accel_longitudinal": raw_accel.y,
            "accel_lateral": raw_accel.x,
            "accel_vertical": raw_accel.z,
            "yaw_rate": raw_gyro.z,
            "roll_rate": raw_gyro.y,
            "pitch_rate": raw_gyro.x,
        }

# 2. Low-pass filter to smooth noise
def low_pass(new_val, prev_val, alpha=0.3):
    return alpha * new_val + (1 - alpha) * prev_val

# 3. GPS speed validation (reject jumps > 50 km/h between readings)
def validate_gps_speed(new_speed, prev_speed, max_jump=13.9):  # 50 km/h in m/s
    if abs(new_speed - prev_speed) > max_jump:
        return prev_speed  # reject outlier
    return new_speed
```

---

## Communication Protocol

### WebSocket Connection

```
Phone  ──── WebSocket ────►  Backend (Python)
       wss://api.racemind.app/ws/telemetry/{race_id}
```

| Direction | Message Type | Payload |
|-----------|-------------|---------|
| Phone → Server | `sensor_data` | Raw sensor packet (see format above) |
| Phone → Server | `pit_request` | `{"compound": "hard"}` |
| Phone → Server | `pit_resume` | `{}` |
| Phone → Server | `heartbeat` | `{"battery": 72}` |
| Server → Phone | `agent_message` | `{"message": "...", "type": "strategy", "urgency": "normal"}` |
| Server → Phone | `pit_confirm` | `{"compound": "hard", "lap": 25}` |
| Server → Phone | `race_status` | `{"status": "live", "lap": 14}` |
| Server → Phone | `alert` | `{"type": "rain_incoming", "message": "..."}` |

### Offline Resilience

If WebSocket disconnects:
1. Buffer sensor data locally (SQLite or in-memory ring buffer, ~60s worth)
2. Show "Reconnecting..." indicator on screen
3. On reconnect, send buffered data with timestamps (backend processes in order)
4. Simulation models handle gaps gracefully (interpolate or skip)

---

## Battery & Performance Considerations

| Concern | Solution |
|---------|----------|
| GPS drains battery fast | Use balanced accuracy mode (not high-accuracy continuously) |
| 50 Hz IMU is expensive | Downsample to 10 Hz for transmission, keep 50 Hz for on-device smoothing |
| Screen-on drains battery | Dim screen during race, use AMOLED-friendly dark theme |
| Race length (1-2 hours) | Expect 30-40% battery drain; warn user to start above 80% |
| Network usage | ~10 KB/s at 10 Hz packet rate = ~36 MB/hour (very manageable) |
| Background mode | Request foreground service (Android) / background location (iOS) |

---

## App Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | **Flutter (Dart)** | Cross-platform, high-performance UI, excellent sensor plugin ecosystem |
| Sensors | **sensors_plus** + **geolocator** | Cross-platform IMU + GPS/barometer access |
| WebSocket | **web_socket_channel** | Official Dart package, simple API |
| Local Storage | **Hive** (fast NoSQL) or **drift** (SQLite FFI) | Offline buffering with minimal latency |
| UI | **Flutter Material** (custom widgets) | Native performance, precise gauge rendering |
| Audio (TTS) | **flutter_tts** | Core feature — spoken alerts to driver hands-free |

### Alternative: Native Android (Kotlin)

If Flutter sensor rates are too slow:
- Use `SensorManager` directly for guaranteed 50-100 Hz
- Use `FusedLocationProviderClient` for GPS
- Compose UI for screens
- Ktor for WebSocket client

---

## User Flow

```
1. Open app → Select race from dropdown (fetched from backend)
2. TRACK TRACE (one-time, before race):
   a. Tap "Trace Track" tab
   b. Walk to starting position
   c. Tap "Start Tracing" → walk/drive the full track loop
   d. Tap "Stop Tracing" → review the path on mini-map
   e. Tap "Submit Track" → backend processes + website renders
3. RACE SETUP:
   a. Place phone in pocket/armband → Select orientation mode
   b. Tap "Calibrate" → Hold still 3 seconds → Sensors zeroed
   c. Tap "Ready to Race" → WebSocket connects → Status: ● Connected
4. Walk to start/finish line → Wait for race start signal from website
5. START → App begins streaming at 10 Hz
6. During race:
   - App streams sensor data continuously
   - Receives agent messages → displays + optional TTS
   - Detects pit zone entry (speed → 0 near pit GPS coords)
   - Shows pit stop screen → driver selects compound → confirms
   - Resume → fresh tyre model reset on backend
7. Race ends (all laps complete) → App shows summary → stops streaming
```

---

## Data Written to Backend

| What | When | Where It Goes |
|------|------|---------------|
| Raw sensor packets | Every 100ms (10 Hz) | Backend simulation engine → `telemetry` table + Redis |
| Pit request | Driver taps button | `pit_stop_log` table |
| Compound change | Driver confirms in pit | `pit_stop_log.new_compound` + model reset |
| App heartbeat | Every 5s | Backend monitors connection health |

---

*The app is intentionally thin. All intelligence lives on the backend (simulation models + Gemma). The phone is just a really good sensor array that happens to fit in your pocket.*
