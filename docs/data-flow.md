# Data Flow Architecture

## End-to-End System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              RACEMIND ARCHITECTURE                               │
└─────────────────────────────────────────────────────────────────────────────────┘

┌───────────────┐         ┌───────────────┐         ┌───────────────────────────┐
│  MOBILE APP   │         │  WEATHER API  │         │      WEBSITE              │
│  (The Car)    │         │  (OpenWeather)│         │   (The Pit Wall)          │
│               │         │               │         │                           │
│ • GPS         │         │ • air_temp    │         │ • Track Setup (writes)    │
│ • Accel       │         │ • humidity    │         │ • Race Config (writes)    │
│ • Gyro        │         │ • wind        │         │ • Pre-Race Report (reads) │
│ • Barometer   │         │ • rain        │         │ • Live Dashboard (reads)  │
└───────┬───────┘         └───────┬───────┘         └─────────────┬─────────────┘
        │                         │                               │
        │ WebSocket (10 Hz)       │ REST (every 5 min)            │ WebSocket + REST
        │ wss://api/ws/telemetry  │                               │
        ▼                         ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND SERVER (Python)                                │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                     INGESTION LAYER                                      │   │
│  │                                                                         │   │
│  │  WebSocket Handler → Validates → Buffers → Passes to Simulation Engine  │   │
│  └────────────────────────────────┬────────────────────────────────────────┘   │
│                                   │                                             │
│                                   ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                   SIMULATION ENGINE (runs every tick)                     │   │
│  │                                                                         │   │
│  │  Raw Phone Data ──► Scale ──► Tier 2 Derivation ──► Tier 3 Models       │   │
│  │                                                                         │   │
│  │  Models: Fuel │ Tyre Temp │ Tyre Wear │ ERS │ Brakes │ Engine │ Pressure │   │
│  └────────────────────────────┬────────────────────────────────────────────┘   │
│                               │                                                 │
│                    Produces full telemetry packet (60+ channels)                 │
│                               │                                                 │
│              ┌────────────────┼────────────────┐                               │
│              ▼                ▼                ▼                               │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐                  │
│  │    REDIS      │  │  TimescaleDB  │  │   GEMMA AGENT     │                  │
│  │  (hot state)  │  │  (history)    │  │   (strategy AI)   │                  │
│  │               │  │               │  │                   │                  │
│  │ Latest packet │  │ telemetry     │  │ Reads: Redis +    │                  │
│  │ Per-system    │  │ lap_summaries │  │   lap_summaries   │                  │
│  │ hashes        │  │ pit_stop_log  │  │                   │                  │
│  │ Agent msgs    │  │               │  │ Writes: strategy  │                  │
│  │ Active strat  │  │               │  │   + messages      │                  │
│  └───────┬───────┘  └───────────────┘  └─────────┬─────────┘                  │
│          │                                        │                             │
│          │         WebSocket push                  │                             │
│          ├─────────────────────────────────────────┘                             │
│          │                                                                       │
└──────────┼───────────────────────────────────────────────────────────────────────┘
           │
           │  WebSocket (to website) + WebSocket (to mobile)
           ▼
    ┌──────────────┐              ┌──────────────┐
    │   WEBSITE    │              │  MOBILE APP  │
    │  Live View   │              │  Agent Msgs  │
    │  (consumes)  │              │  (receives)  │
    └──────────────┘              └──────────────┘
```

---

## Data Flow by Phase

### Phase 1: Track Setup (one-time, before race)

```
Website (user draws track)
    │
    │  POST /api/tracks
    │  POST /api/tracks/{id}/points
    │  POST /api/tracks/{id}/sectors
    │  POST /api/tracks/{id}/drs-zones
    ▼
TimescaleDB
    │
    │  tracks, track_points, track_sectors, track_drs_zones
    ▼
Stored. Ready for race configuration.
```

**Parameters written:**
| Parameter | Source | Table |
|-----------|--------|-------|
| Track name, country, city | User input (form) | `tracks` |
| GPS path points | User draws on map | `track_points` |
| Start/finish location | User pins on map | `track_points` (type=start_finish) |
| Pit entry/exit | User pins on map | `track_points` (type=pit_entry/pit_exit) |
| Sector boundaries | User pins on map | `track_sectors` |
| DRS zones (detection, activation, end) | User pins on map | `track_drs_zones` |
| Total distance | Auto-calculated from path | `tracks.total_distance_m` |
| Corner count | Auto-detected from path curvature | `tracks.num_corners` |
| Elevation range | From map terrain data | `tracks.elevation_min/max` |

---

### Phase 2: Race Configuration (one-time, before race)

```
Website (user fills config form)
    │
    │  POST /api/races
    │  POST /api/races/{id}/vehicle-config
    │  POST /api/races/{id}/weather
    ▼
TimescaleDB
    │
    │  races, race_vehicle_config, race_weather
    ▼
Backend loads config into memory for simulation engine.
```

**Parameters written:**
| Parameter | Source | Table |
|-----------|--------|-------|
| Total laps | User input | `races.total_laps` |
| Starting fuel | User input | `races.starting_fuel_kg` |
| Starting compound | User selection | `races.tyre_compound_start` |
| Car mass | User input (default 798) | `race_vehicle_config` |
| ERS specs (capacity, max kW, harvest limit) | User input (defaults from 2026 regs) | `race_vehicle_config` |
| Brake bias | User input | `race_vehicle_config` |
| Wing angles | User input | `race_vehicle_config` |
| Cold tyre pressures | User input | `race_vehicle_config` |
| Weather (temp, humidity, wind, rain) | Weather API or manual | `race_weather` |

---

### Phase 3: Test Lap (pre-race, one lap)

```
Mobile App                    Backend                         Website
    │                            │                               │
    │  WS: sensor_data (10 Hz)   │                               │
    ├───────────────────────────►│                               │
    │                            │  Simulation Engine runs        │
    │                            │  (same as live, but 1 lap)     │
    │                            │                               │
    │                            ├──► TimescaleDB (telemetry)     │
    │                            ├──► Redis (latest state)        │
    │                            │                               │
    │                            │  On lap complete:              │
    │                            ├──► lap_summaries               │
    │                            │                               │
    │                            │  Trigger Gemma:                │
    │                            ├──► Gemma analyzes test data    │
    │                            │    + track + config + weather  │
    │                            │                               │
    │                            ├──► pre_race_reports (write)    │
    │                            ├──► pit_strategies (write)      │
    │                            ├──► Redis: strategy:active      │
    │                            │                               │
    │                            ├──────────────────────────────►│
    │                            │  Push: report ready            │
    │                            │                               │
    │                            │                    Pre-Race Report View
    │                            │                    displays analysis
```

**Data flowing:**
| From | Through | To | What |
|------|---------|----|----|
| Phone GPS + IMU | WebSocket | Backend ingestion | Raw sensor packet |
| Backend simulation | Computation | TimescaleDB | Full telemetry row (60+ cols) |
| Backend simulation | Computation | Redis | Latest state hashes |
| Backend (lap complete) | Aggregation | TimescaleDB | `lap_summaries` row |
| Gemma agent | Analysis | TimescaleDB | `pre_race_reports` row |
| Gemma agent | Strategy | TimescaleDB + Redis | `pit_strategies` + `strategy:active` |
| Backend | WebSocket push | Website | "Report ready" notification |

---

### Phase 4: Live Race (continuous, main event)

```
Mobile App              Backend                    Redis              Website
    │                      │                         │                   │
    │ sensor_data (10Hz)   │                         │                   │
    ├─────────────────────►│                         │                   │
    │                      │ Simulation Engine        │                   │
    │                      │ (every 100ms tick):      │                   │
    │                      │                         │                   │
    │                      │ 1. Scale raw data        │                   │
    │                      │ 2. Derive Tier 2         │                   │
    │                      │ 3. Run all Tier 3 models │                   │
    │                      │ 4. Compose packet        │                   │
    │                      │                         │                   │
    │                      ├────────────────────────►│                   │
    │                      │ SET telemetry:latest     │                   │
    │                      │ HSET tyres, brakes, etc  │                   │
    │                      │                         │──────────────────►│
    │                      │                         │ WS push (2-10 Hz) │
    │                      │                         │                   │
    │                      ├──► TimescaleDB           │                   │
    │                      │    (batch insert 1/sec)  │                   │
    │                      │                         │                   │
    │                      │ On lap crossing:         │                   │
    │                      │ • Write lap_summaries    │                   │
    │                      │ • Trigger Gemma eval     │                   │
    │                      │                         │                   │
    │                      │ Gemma (async, per lap):  │                   │
    │                      │ • Read latest + history  │                   │
    │                      │ • Evaluate strategy      │                   │
    │                      │ • Generate message       │                   │
    │                      │                         │                   │
    │                      ├────────────────────────►│                   │
    │                      │ RPUSH agent_messages     │──────────────────►│
    │◄─────────────────────┤                         │   Strategy panel  │
    │ WS: agent_message    │ If pit call:             │   + Comms feed    │
    │                      │ PUBLISH alerts           │──────────────────►│
    │                      │                         │   Alert banner    │
```

---

## Complete Parameter Trace (every channel, end to end)

### Motion & Position Channels

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| GPS lat/lon | Phone GPS | Direct (no scaling) | `telemetry.gps_lat/lon` | `telemetry:latest` | Track map (car dot) |
| Speed | Phone GPS speed | `× SPEED_SCALE`, clamp 0-370 | `telemetry.speed_kmh` | `telemetry:latest` | Speed gauge |
| Heading | Phone GPS bearing | Direct | `telemetry.heading_deg` | `telemetry:latest` | Track map (car direction) |
| Lateral G | Phone accel X | `× LATERAL_SCALE`, clamp ±6 | `telemetry.lateral_g` | `telemetry:latest` | G-force diamond |
| Longitudinal G | Phone accel Y | `× LONG_SCALE`, clamp ±6 | `telemetry.longitudinal_g` | `telemetry:latest` | G-force diamond |
| Vertical G | Phone accel Z | `× VERT_SCALE` | `telemetry.vertical_g` | `telemetry:latest` | (used by models) |
| Yaw rate | Phone gyro Z | `× YAW_SCALE` | `telemetry.yaw_rate` | `telemetry:latest` | (used for steering calc) |
| Roll rate | Phone gyro X | `× ROLL_SCALE` | `telemetry.roll_rate` | `telemetry:latest` | (model input) |
| Pitch rate | Phone gyro Y | `× PITCH_SCALE` | `telemetry.pitch_rate` | `telemetry:latest` | (model input) |

### Driver Input Channels (Derived — Tier 2)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Throttle % | Longitudinal G (positive) | Threshold + normalize | `telemetry.throttle_pct` | `telemetry:latest` | Throttle bar |
| Brake % | Longitudinal G (negative) | Threshold + normalize | `telemetry.brake_pct` | `telemetry:latest` | Brake bar |
| Steering angle | Yaw rate + speed | Bicycle model formula | `telemetry.steering_angle_deg` | `telemetry:latest` | Steering indicator |

### Timing Channels (Derived — Tier 2)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Lap number | GPS geofence crossing | Counter increment | `telemetry.lap` | `race:{id}:state` | Lap counter header |
| Lap time | Timer between crossings | Elapsed seconds | `lap_summaries.lap_time_s` | `race:{id}:laps` | Timing tower |
| Sector 1 time | GPS geofence S1 boundary | Elapsed seconds | `lap_summaries.sector1_time_s` | `race:{id}:laps` | Timing tower |
| Sector 2 time | GPS geofence S2 boundary | Elapsed seconds | `lap_summaries.sector2_time_s` | `race:{id}:laps` | Timing tower |
| Sector 3 time | GPS geofence S3/finish | Elapsed seconds | `lap_summaries.sector3_time_s` | `race:{id}:laps` | Timing tower |
| Distance in lap | GPS position integration | Sum of deltas × scale | (computed in-memory) | — | (model input) |

### Engine Channels (Simulated — Tier 3)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Gear | Speed → lookup table | Speed range mapping | `telemetry.gear` | `race:{id}:engine` | Gear indicator |
| RPM | Speed + gear ratio | Gear-specific interpolation | `telemetry.rpm` | `race:{id}:engine` | RPM dial |
| Coolant temp | Throttle + RPM + airflow | Thermal model | `telemetry.engine_coolant_temp` | `race:{id}:engine` | (agent monitors) |

### Fuel Channels (Simulated — Tier 3)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Fuel flow rate | Speed, throttle, lateral G, wind, rain, compound | Fuel model formula | `telemetry.fuel_flow_rate_kgh` | `race:{id}:fuel` | Fuel flow readout |
| Fuel consumed | Integration of flow × dt | Running sum | `telemetry.fuel_consumed_kg` | `race:{id}:fuel` | (derived) |
| Fuel remaining | Starting − consumed | Subtraction | `telemetry.fuel_remaining_kg` | `race:{id}:fuel` | Fuel gauge |
| Fuel laps remaining | Remaining ÷ avg per lap | Division | (computed) | `race:{id}:fuel` | Laps remaining number |

### Tyre Channels (Simulated — Tier 3)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Surface temp FL/FR/RL/RR | Speed, lateral G, braking, throttle, track temp | Thermal model (heat in/out) | `telemetry.tyre_temp_*` | `race:{id}:tyres` | Tyre temp heatmap |
| Carcass temp FL/FR/RL/RR | Surface temp with lag | Delayed follow | `telemetry.tyre_carcass_temp_*` | `race:{id}:tyres` | (agent uses) |
| Pressure FL/FR/RL/RR | Surface temp + cold pressure | Ideal gas law | `telemetry.tyre_pressure_*` | `race:{id}:tyres` | Pressure readouts |
| Wear % | Speed, lateral G, temp, compound | Wear accumulation model | `telemetry.tyre_wear_pct` | `race:{id}:tyres` | Wear progress bar |
| Grip level | Wear % | Non-linear cliff function | `telemetry.tyre_grip_level` | `race:{id}:tyres` | Grip indicator |
| Cliff warning | Wear > 55% | Threshold check | `telemetry.tyre_cliff_warning` | `race:{id}:tyres` | Orange pulse alert |
| Compound | User selection (pit stop) | Direct | `telemetry.tyre_compound` | `race:{id}:tyres` | Compound badge |
| Tyre age (laps) | Lap counter since pit | Counter | `telemetry.tyre_age_laps` | `race:{id}:tyres` | Age number |

### Brake Channels (Simulated — Tier 3)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Disc temp FL/FR/RL/RR | Braking intensity, speed, airflow | Thermal model | `telemetry.brake_temp_*` | `race:{id}:brakes` | Brake temp bars |
| Pad wear FL/FR/RL/RR | Braking intensity, temp | Accumulation | `telemetry.brake_pad_wear_*` | `race:{id}:brakes` | (agent monitors) |
| Fade warning | Any disc > 1000°C | Threshold | `telemetry.brake_fade_warning` | `race:{id}:brakes` | Red flash alert |

### ERS Channels (Simulated — Tier 3)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| SOC % | Braking (harvest) + throttle (deploy) | Energy balance model | `telemetry.ers_soc_pct` | `race:{id}:ers` | Battery gauge |
| Mode | Braking vs throttle state | State machine | `telemetry.ers_mode` | `race:{id}:ers` | Mode badge |
| Power kW | Harvest/deploy rate | Computed from intensity | `telemetry.ers_power_kw` | `race:{id}:ers` | Power flow indicator |
| Harvested this lap MJ | Accumulated braking energy | Sum with lap cap (8.5 MJ) | `telemetry.ers_harvested_lap_mj` | `race:{id}:ers` | Harvest counter |
| Deployed this lap MJ | Accumulated deploy energy | Running sum | `telemetry.ers_deployed_lap_mj` | `race:{id}:ers` | Deploy counter |

### Weather Channels (External API)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Air temp | OpenWeather API | Direct | `race_weather.air_temp_c` + `telemetry.air_temp_c` | `race:{id}:weather` | Weather banner |
| Track temp | Air temp + 15°C estimate | Derived | `race_weather.track_temp_c` + `telemetry.track_temp_c` | `race:{id}:weather` | Weather banner |
| Humidity | OpenWeather API | Direct | `race_weather.humidity_pct` | `race:{id}:weather` | Weather banner |
| Wind speed | OpenWeather API | Direct | `race_weather.wind_speed_kmh` + `telemetry.wind_speed_kmh` | `race:{id}:weather` | Weather banner |
| Wind direction | OpenWeather API | Direct | `race_weather.wind_direction_deg` | `race:{id}:weather` | (model input) |
| Rain | OpenWeather API | Direct | `race_weather.rainfall_mmh` + `telemetry.rain_mmh` | `race:{id}:weather` | Weather banner + alert |
| Track wetness | Derived from rain history | State machine | `race_weather.track_wetness` | `race:{id}:weather` | Conditions badge |
| Atmo pressure | Phone barometer or API | Direct | `race_weather.atmospheric_pressure_mbar` | `race:{id}:weather` | (model input) |

### Strategy & Agent Channels (Gemma Output)

| Channel | Origin | Processing | DB Column | Redis Key | Website Widget |
|---------|--------|-----------|-----------|-----------|----------------|
| Pit strategy | Gemma analysis | JSON with planned stops | `pit_strategies.planned_stops` | `race:{id}:strategy:active` | Strategy panel |
| Strategy reasoning | Gemma natural language | Text | `pit_strategies.reasoning` | `race:{id}:strategy:active` | Strategy panel |
| Agent messages | Gemma per-lap evaluation | Text + metadata | `agent_messages.message` | `race:{id}:agent_messages` | Comms feed |
| Message urgency | Gemma classification | low/normal/high/critical | `agent_messages.urgency` | `race:{id}:agent_messages` | Color coding |
| Pit window | Gemma computation | Lap range | `pit_strategies.planned_stops` | `race:{id}:strategy:active` | Pit window indicator |
| Pre-race report | Gemma (from test lap) | Markdown document | `pre_race_reports.full_report_md` | — | Pre-Race Report view |
| Target lap delta | Gemma (pace optimizer) | Target lap time + delta per lap | `pace_targets.target_lap_time_s` | `race:{id}:pace:current` | Live Delta widget + Racer HUD |
| ERS deploy map | Gemma (sector analysis) | Deploy/Hold/Harvest per sector | `pace_targets.ers_deploy_map` | `race:{id}:pace:current` | HUD sector indicator |
| Wet crossover prediction | Gemma (weather model) | Compound switch lap + seconds delta | `pace_targets.wet_crossover_lap` | `race:{id}:pace:wet_crossover` | Strategy panel + HUD banner |
| Lift-coast zones | Gemma (fuel/brake model) | Corner list to lift and coast | `pace_targets.lift_coast_zones` | `race:{id}:pace:current` | HUD + alert banner |

---

## Gemma Agent Integration

### When Gemma Runs

| Trigger | Input | Output | Latency Target |
|---------|-------|--------|----------------|
| Pre-race (after test lap) | Test lap telemetry + track + config + weather | Full strategy report + pit plan | 10-30 seconds (OK, user waits) |
| Every lap crossing (live) | Latest lap summary + rolling 5-lap trend + current strategy | Updated recommendation or "hold" | 2-5 seconds |
| Alert condition (live) | Specific trigger data (e.g., rain detected, tyre cliff) | Urgent message + possible strategy change | 1-3 seconds |
| Pit stop event | Current race state + remaining laps + available compounds | Compound recommendation | 1-2 seconds |

### Gemma Context Window (per invocation)

```json
{
  "race_context": {
    "track": "Melbourne, 5.412km, 57 laps",
    "current_lap": 14,
    "laps_remaining": 43
  },
  "current_state": {
    "fuel_remaining_kg": 62.4,
    "fuel_laps_remaining": 37,
    "tyre_wear_pct": 41.2,
    "tyre_grip": 0.918,
    "tyre_compound": "medium",
    "tyre_age_laps": 14,
    "ers_soc": 67,
    "brake_temps": {"FL": 612, "FR": 598, "RL": 445, "RR": 430}
  },
  "recent_laps": [
    {"lap": 14, "time": 85.51, "fuel_used": 1.71, "wear_delta": 3.1},
    {"lap": 13, "time": 85.31, "fuel_used": 1.69, "wear_delta": 2.9},
    {"lap": 12, "time": 85.74, "fuel_used": 1.74, "wear_delta": 3.2}
  ],
  "active_strategy": {
    "plan": "1-stop: Medium→Hard @ Lap 25",
    "pit_window": [23, 28]
  },
  "weather": {
    "air_temp": 28,
    "track_temp": 42,
    "rain": false,
    "wind_speed": 12
  },
  "pace_context": {
    "avg_lap_time_last_5": 85.6,
    "fuel_per_lap_kg": 1.68,
    "fuel_margin_vs_target_kg": "+2.0",
    "tyre_wear_pct": 41.2,
    "tyre_grip_level": 0.918,
    "remaining_stint_laps": 11,
    "pit_window_range": [23, 28],
    "fresh_tyre_pace_estimate_s": 84.5,
    "wet_crossover_projected_lap": null
  },
  "alerts": []
}
```

### Gemma Output Format

```json
{
  "action": "hold",  // hold | pit_now | adjust_strategy | warn
  "message": "Tyre wear is tracking well. Current pace suggests we can extend to lap 27 before pitting. Tyre and fuel margins are both inside the safety window — no extra stop needed.",
  "urgency": "normal",
  "strategy_update": null,  // or {"new_plan": [...], "reasoning": "..."}
  "driver_instruction": "Continue pushing. Maintain brake balance and protect tyres in S2.",
  "pace_coaching": {
    "target_lap_time_s": 86.1,
    "compound_delta_s_vs_alternative": 0.4,
    "ers_deploy_map": {"S1": "deploy", "S2": "hold", "S3": "deploy"},
    "lift_coast_zones": ["T1", "T4"],
    "wet_crossover_lap": null,
    "reasoning": "Target set to conserve fuel margin while keeping pace within 0.4s of fresh-tyre estimate."
  }
}
```

---

## API Endpoints

### REST API (setup + queries)

| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| POST | `/api/tracks` | Create track | Website (Track Setup) |
| POST | `/api/tracks/{id}/points` | Save track GPS points | Website (Track Setup) |
| POST | `/api/tracks/{id}/sectors` | Define sector boundaries | Website (Track Setup) |
| POST | `/api/tracks/{id}/drs-zones` | Define DRS zones | Website (Track Setup) |
| GET | `/api/tracks` | List all tracks | Website (Race Config dropdown) |
| GET | `/api/tracks/{id}` | Get track with all points | Website (map display) |
| POST | `/api/races` | Create race | Website (Race Config) |
| PUT | `/api/races/{id}/vehicle-config` | Set vehicle parameters | Website (Race Config) |
| PUT | `/api/races/{id}/weather` | Set/update weather | Website (Race Config) |
| POST | `/api/races/{id}/start-test` | Begin test lap mode | Website (trigger) |
| POST | `/api/races/{id}/start-race` | Begin live race | Website (trigger) |
| POST | `/api/races/{id}/end-race` | End race | Website (trigger) |
| GET | `/api/races/{id}/report` | Get pre-race report | Website (Report View) |
| GET | `/api/races/{id}/strategy` | Get active strategy | Website (Live View) |
| GET | `/api/races/{id}/laps` | Get lap summaries | Website (Timing Tower) |
| GET | `/api/races/{id}/messages` | Get agent messages | Website (Comms Feed) |

### WebSocket Endpoints

| Endpoint | Direction | Purpose |
|----------|-----------|---------|
| `wss://api/ws/telemetry/{race_id}` | Phone → Server | Stream raw sensor data |
| `wss://api/ws/dashboard/{race_id}` | Server → Website | Push live telemetry + alerts |
| `wss://api/ws/driver/{race_id}` | Server ↔ Phone | Agent messages + pit commands |

---

## Timing & Throughput

| Data Path | Frequency | Packet Size | Throughput |
|-----------|-----------|-------------|------------|
| Phone → Backend (raw sensors) | 10 Hz | ~500 bytes | 5 KB/s |
| Backend → Redis (state update) | 10 Hz | ~2 KB | 20 KB/s |
| Backend → TimescaleDB (batch insert) | 1 Hz (batch of 10) | ~5 KB | 5 KB/s |
| Redis → Website (WS push) | 2-10 Hz | ~2 KB | 4-20 KB/s |
| Backend → Phone (agent msgs) | ~1 per lap | ~500 bytes | negligible |
| Gemma invocation | 1 per lap + alerts | ~4 KB context | ~1 call/90s |
| Lap summary write | 1 per lap | ~500 bytes | negligible |

Total system load: very light. A single $5/mo VPS handles this easily for a hackathon demo.

---

## Backend Server Structure

```
backend/
├── main.py                  # FastAPI app entry point
├── config.py                # Constants, scaling factors, DB URLs
├── api/
│   ├── tracks.py            # REST: track CRUD
│   ├── races.py             # REST: race setup + control
│   ├── reports.py           # REST: pre-race report
│   └── strategy.py          # REST: strategy queries
├── ws/
│   ├── telemetry.py         # WebSocket: phone sensor ingestion
│   ├── dashboard.py         # WebSocket: push to website
│   └── driver.py            # WebSocket: comms to phone
├── simulation/
│   ├── engine.py            # Main simulation loop (tick-based)
│   ├── scaling.py           # Tier 1: raw → scaled values
│   ├── derived.py           # Tier 2: throttle, brake, steering, laps
│   ├── models/
│   │   ├── fuel.py          # FuelModel class
│   │   ├── tyre_temp.py     # TyreTemperatureModel class
│   │   ├── tyre_wear.py     # TyreWearModel class
│   │   ├── ers.py           # ERSModel class
│   │   ├── brakes.py        # BrakeTemperatureModel class
│   │   ├── engine_rpm.py    # EngineModel class
│   │   ├── drs.py           # DRSModel class
│   │   └── pressure.py      # TyrePressureModel class
│   └── composer.py          # Assembles full telemetry packet from all models
├── agent/
│   ├── gemma.py             # Gemma API interface
│   ├── prompts.py           # System prompts + context formatting
│   ├── evaluator.py         # Per-lap strategy evaluation logic
│   └── report_generator.py  # Pre-race report generation
├── db/
│   ├── timescale.py         # TimescaleDB connection + queries
│   └── redis_client.py      # Redis connection + helpers
└── weather/
    └── openweather.py       # Weather API polling
```

---

## Deployment (Hackathon Day)

```
┌──────────────────────────────────────────┐
│  LAPTOP / VPS (single machine)           │
│                                          │
│  Docker Compose:                         │
│  ├── timescaledb (port 5432)             │
│  ├── redis (port 6379)                   │
│  ├── backend (port 8000) — FastAPI       │
│  └── frontend (port 3000) — Next.js      │
│                                          │
│  Exposed via ngrok or local WiFi         │
└──────────────────────────────────────────┘
         ▲                    ▲
         │                    │
    Phone (WiFi)        Browser (WiFi)
    sensor stream       live dashboard
```

All services on one machine. Phone connects over local WiFi. No cloud needed for demo.

---

## Verification: All Parameters Accounted For

Cross-reference against `simulation-models.md` output channels:

| Model | Channels Produced | In DB? | In Redis? | On Dashboard? |
|-------|-------------------|--------|-----------|---------------|
| Fuel | flow_rate, consumed, remaining, laps_remaining | ✓ | ✓ | ✓ Fuel gauge + flow + laps |
| Tyre Temp | surface×4, carcass×4, in_optimal_window | ✓ | ✓ | ✓ Tyre heatmap |
| Tyre Wear | wear_pct, grip_level, cliff_warning | ✓ | ✓ | ✓ Wear bar + alert |
| Tyre Pressure | pressure×4 | ✓ | ✓ | ✓ Pressure readouts |
| ERS | soc, mode, power_kw, harvested, deployed | ✓ | ✓ | ✓ Battery gauge + flow |
| Brakes | disc_temp×4, pad_wear×4, fade_warning | ✓ | ✓ | ✓ Brake bars + alert |
| Engine | gear, rpm, coolant_temp | ✓ | ✓ | ✓ RPM dial + gear |
| Weather | air/track temp, humidity, wind, rain, wetness, pressure | ✓ | ✓ | ✓ Weather banner |
| Motion | speed, lat/lon, heading, accel×3, gyro×3 | ✓ | ✓ | ✓ Map + gauges + G-force |
| Inputs | throttle, brake, steering | ✓ | ✓ | ✓ Pedal bars + steering |
| Timing | lap, sectors×3, lap_time | ✓ | ✓ | ✓ Timing tower |
| Strategy | pit_plan, reasoning, messages, urgency | ✓ | ✓ | ✓ Strategy panel + comms |

**Result: 60+ channels, all traced from source → processing → storage → display. No orphan parameters.**

---

*This document ties together all other docs. If you add a new parameter anywhere in the system, trace it through this file to ensure it has a source, a DB home, and a place to be seen.*
