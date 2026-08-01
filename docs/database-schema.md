# Database Schema

## Overview

Two database layers:
- **TimescaleDB** (PostgreSQL) — persistent storage for all historical telemetry, track definitions, race configs, and reports
- **Redis** — real-time hot state for the live dashboard and Gemma agent queries

---

## TimescaleDB Schema

### Track Definition

```sql
CREATE TABLE tracks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    country         VARCHAR(60),
    city            VARCHAR(60),
    total_distance_m FLOAT NOT NULL,          -- total lap distance in meters
    num_corners     INT,
    elevation_min_m FLOAT,
    elevation_max_m FLOAT,
    drs_zones_count INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE track_points (
    id          BIGSERIAL,
    track_id    UUID REFERENCES tracks(id) ON DELETE CASCADE,
    seq         INT NOT NULL,                  -- point order along track
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    elevation_m FLOAT,
    point_type  VARCHAR(20) DEFAULT 'track',   -- track | sector_line | start_finish | pit_entry | pit_exit | drs_detection | drs_start | drs_end
    label       VARCHAR(50),                   -- e.g. "Turn 1", "Sector 2 start"
    PRIMARY KEY (track_id, seq)
);

CREATE TABLE track_sectors (
    track_id    UUID REFERENCES tracks(id) ON DELETE CASCADE,
    sector_num  SMALLINT NOT NULL,             -- 1, 2, 3
    start_lat   DOUBLE PRECISION NOT NULL,
    start_lon   DOUBLE PRECISION NOT NULL,
    end_lat     DOUBLE PRECISION NOT NULL,
    end_lon     DOUBLE PRECISION NOT NULL,
    distance_m  FLOAT,
    PRIMARY KEY (track_id, sector_num)
);

CREATE TABLE track_drs_zones (
    id              SERIAL PRIMARY KEY,
    track_id        UUID REFERENCES tracks(id) ON DELETE CASCADE,
    zone_number     SMALLINT NOT NULL,
    detection_lat   DOUBLE PRECISION NOT NULL,
    detection_lon   DOUBLE PRECISION NOT NULL,
    activation_lat  DOUBLE PRECISION NOT NULL,
    activation_lon  DOUBLE PRECISION NOT NULL,
    end_lat         DOUBLE PRECISION NOT NULL,
    end_lon         DOUBLE PRECISION NOT NULL
);
```

### Race Configuration

```sql
CREATE TABLE races (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id        UUID REFERENCES tracks(id),
    name            VARCHAR(100),
    total_laps      INT NOT NULL,
    starting_fuel_kg FLOAT NOT NULL DEFAULT 100.0,
    tyre_compound_start VARCHAR(20) NOT NULL DEFAULT 'medium',
    created_at      TIMESTAMPTZ DEFAULT now(),
    status          VARCHAR(20) DEFAULT 'setup'  -- setup | test_lap | pre_race | live | completed
);

CREATE TABLE race_vehicle_config (
    race_id             UUID PRIMARY KEY REFERENCES races(id),
    car_mass_kg         FLOAT NOT NULL DEFAULT 798,
    fuel_capacity_kg    FLOAT NOT NULL DEFAULT 110,
    ers_capacity_mj     FLOAT NOT NULL DEFAULT 4.0,
    mgu_k_max_kw       FLOAT NOT NULL DEFAULT 350,
    max_harvest_per_lap_mj FLOAT NOT NULL DEFAULT 8.5,
    brake_bias_pct      FLOAT NOT NULL DEFAULT 57.0,
    front_wing_angle    FLOAT DEFAULT 12.0,
    rear_wing_angle     FLOAT DEFAULT 8.0,
    tyre_cold_pressure_front_psi FLOAT DEFAULT 21.0,
    tyre_cold_pressure_rear_psi  FLOAT DEFAULT 19.5
);

CREATE TABLE race_weather (
    id              BIGSERIAL,
    race_id         UUID REFERENCES races(id),
    ts              TIMESTAMPTZ NOT NULL,
    air_temp_c      FLOAT,
    track_temp_c    FLOAT,
    humidity_pct    FLOAT,
    wind_speed_kmh  FLOAT,
    wind_direction_deg FLOAT,
    rainfall_mmh    FLOAT,
    atmospheric_pressure_mbar FLOAT,
    track_wetness   VARCHAR(10) DEFAULT 'dry'  -- dry | damp | wet
);
SELECT create_hypertable('race_weather', 'ts');
```

### Telemetry (time-series — the big one)

```sql
CREATE TABLE telemetry (
    ts                  TIMESTAMPTZ NOT NULL,
    race_id             UUID NOT NULL,
    lap                 INT,
    
    -- Motion (Tier 1 direct)
    speed_kmh           FLOAT,
    gps_lat             DOUBLE PRECISION,
    gps_lon             DOUBLE PRECISION,
    heading_deg         FLOAT,
    lateral_g           FLOAT,
    longitudinal_g      FLOAT,
    vertical_g          FLOAT,
    yaw_rate            FLOAT,
    roll_rate           FLOAT,
    pitch_rate          FLOAT,
    
    -- Driver inputs (Tier 2 derived)
    throttle_pct        FLOAT,
    brake_pct           FLOAT,
    steering_angle_deg  FLOAT,
    
    -- Engine (Tier 3 simulated)
    gear                SMALLINT,
    rpm                 INT,
    engine_coolant_temp FLOAT,
    
    -- Fuel (Tier 3 simulated)
    fuel_flow_rate_kgh  FLOAT,
    fuel_consumed_kg    FLOAT,
    fuel_remaining_kg   FLOAT,
    
    -- Tyres - Temperature (Tier 3 simulated)
    tyre_temp_fl        FLOAT,
    tyre_temp_fr        FLOAT,
    tyre_temp_rl        FLOAT,
    tyre_temp_rr        FLOAT,
    tyre_carcass_temp_fl FLOAT,
    tyre_carcass_temp_fr FLOAT,
    tyre_carcass_temp_rl FLOAT,
    tyre_carcass_temp_rr FLOAT,
    
    -- Tyres - Pressure (Tier 3 simulated)
    tyre_pressure_fl    FLOAT,
    tyre_pressure_fr    FLOAT,
    tyre_pressure_rl    FLOAT,
    tyre_pressure_rr    FLOAT,
    
    -- Tyres - Wear (Tier 3 simulated)
    tyre_wear_pct       FLOAT,
    tyre_grip_level     FLOAT,
    tyre_compound       VARCHAR(15),
    tyre_age_laps       INT,
    tyre_cliff_warning  BOOLEAN DEFAULT FALSE,
    
    -- Brakes (Tier 3 simulated)
    brake_temp_fl       FLOAT,
    brake_temp_fr       FLOAT,
    brake_temp_rl       FLOAT,
    brake_temp_rr       FLOAT,
    brake_pad_wear_fl   FLOAT,
    brake_pad_wear_fr   FLOAT,
    brake_pad_wear_rl   FLOAT,
    brake_pad_wear_rr   FLOAT,
    brake_fade_warning  BOOLEAN DEFAULT FALSE,
    
    -- ERS (Tier 3 simulated)
    ers_soc_pct         FLOAT,
    ers_mode            VARCHAR(10),  -- harvest | deploy | neutral
    ers_power_kw        FLOAT,
    ers_harvested_lap_mj FLOAT,
    ers_deployed_lap_mj FLOAT,
    
    -- Weather snapshot at this tick
    
    -- Weather snapshot at this tick
    air_temp_c          FLOAT,
    track_temp_c        FLOAT,
    wind_speed_kmh      FLOAT,
    rain_mmh            FLOAT
);

SELECT create_hypertable('telemetry', 'ts');

-- Index for fast queries by race + lap
CREATE INDEX idx_telemetry_race_lap ON telemetry (race_id, lap, ts DESC);
```

### Lap Summaries

```sql
CREATE TABLE lap_summaries (
    id              BIGSERIAL,
    race_id         UUID REFERENCES races(id),
    lap_number      INT NOT NULL,
    lap_time_s      FLOAT,
    sector1_time_s  FLOAT,
    sector2_time_s  FLOAT,
    sector3_time_s  FLOAT,
    avg_speed_kmh   FLOAT,
    max_speed_kmh   FLOAT,
    fuel_used_kg    FLOAT,
    fuel_remaining_kg FLOAT,
    tyre_wear_end_pct FLOAT,
    tyre_compound   VARCHAR(15),
    ers_soc_start   FLOAT,
    ers_soc_end     FLOAT,
    ers_harvested_mj FLOAT,
    ers_deployed_mj FLOAT,
    avg_tyre_temp   FLOAT,
    max_brake_temp  FLOAT,
    pit_stop        BOOLEAN DEFAULT FALSE,
    pit_duration_s  FLOAT,
    new_compound    VARCHAR(15),  -- if pitted, what we switched to
    ts              TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (race_id, lap_number)
);
```

### Pit Stop Strategy

```sql
CREATE TABLE pit_strategies (
    id              SERIAL PRIMARY KEY,
    race_id         UUID REFERENCES races(id),
    strategy_type   VARCHAR(20) NOT NULL,      -- pre_race | live_update
    generated_at    TIMESTAMPTZ DEFAULT now(),
    
    -- JSON array of planned stops
    -- e.g. [{"lap": 18, "compound": "hard"}, {"lap": 40, "compound": "medium"}]
    planned_stops   JSONB NOT NULL,
    
    -- Gemma agent reasoning
    reasoning       TEXT,
    confidence_pct  FLOAT,
    
    -- Estimated outcome
    estimated_total_time_s FLOAT,
    estimated_position     INT
);

CREATE TABLE pit_stop_log (
    id              SERIAL PRIMARY KEY,
    race_id         UUID REFERENCES races(id),
    lap_number      INT NOT NULL,
    entry_speed_kmh FLOAT,
    stationary_time_s FLOAT,
    total_time_s    FLOAT,
    old_compound    VARCHAR(15),
    new_compound    VARCHAR(15),
    fuel_at_stop_kg FLOAT,
    tyre_wear_at_stop FLOAT,
    ts              TIMESTAMPTZ DEFAULT now()
);

-- Pace Coaching (target lap generated by Gemma per lap)
CREATE TABLE pace_targets (
    id                  BIGSERIAL PRIMARY KEY,
    race_id             UUID REFERENCES races(id),
    ts                  TIMESTAMPTZ DEFAULT now(),
    lap                 INT NOT NULL,
    target_lap_time_s   FLOAT NOT NULL,       -- Gemma's computed realistic target
    recommended_compound VARCHAR(15),         -- current best compound for remaining laps
    ers_deploy_map      JSONB,                -- {"S1": "deploy", "S2": "hold", "S3": "harvest"}
    lift_coast_zones    JSONB,                -- ["T1", "T4"] or null
    wet_crossover_lap   INT,                  -- lap when inters faster than slicks
    confidence_pct      FLOAT,
    reasoning           TEXT                  -- Gemma's explanation for this target
);
```

### Gemma Agent Messages

```sql
CREATE TABLE agent_messages (
    id              BIGSERIAL PRIMARY KEY,
    race_id         UUID REFERENCES races(id),
    ts              TIMESTAMPTZ DEFAULT now(),
    lap             INT,
    message_type    VARCHAR(20) NOT NULL,  -- strategy | warning | info | pit_call
    message         TEXT NOT NULL,
    data_snapshot   JSONB,                 -- telemetry state at time of message
    urgency         VARCHAR(10) DEFAULT 'normal'  -- low | normal | high | critical
);
```

### Pre-Race Report

```sql
CREATE TABLE pre_race_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    race_id         UUID REFERENCES races(id),
    generated_at    TIMESTAMPTZ DEFAULT now(),
    
    -- Gemma-generated analysis
    track_analysis      TEXT,     -- track characteristics summary
    strategy_recommendation TEXT, -- recommended pit strategy
    tyre_recommendation TEXT,     -- which compounds and when
    fuel_target_kg      FLOAT,   -- recommended starting fuel
    weather_impact      TEXT,     -- how weather affects strategy
    risk_factors        TEXT,     -- things to watch for
    
    -- Computed predictions
    predicted_lap_time_s FLOAT,
    predicted_pit_window JSONB,   -- {"optimal_lap": 22, "range": [19, 26]}
    predicted_fuel_per_lap FLOAT,
    predicted_tyre_life_laps INT,
    
    -- Full report as markdown (for display)
    full_report_md      TEXT
);
```

---

## Redis Schema (Real-Time State)

All keys are prefixed with the race_id for multi-race isolation.

```
# Current telemetry (overwritten every tick)
SET  race:{race_id}:telemetry:latest          → JSON blob (full telemetry packet)

# Per-corner breakdowns (for quick widget queries)
HSET race:{race_id}:tyres                     → {fl_temp, fr_temp, rl_temp, rr_temp, wear_pct, grip, compound, pressure_fl, ...}
HSET race:{race_id}:brakes                    → {fl_temp, fr_temp, rl_temp, rr_temp, fade_warning}
HSET race:{race_id}:ers                       → {soc, mode, power_kw, harvested_mj, deployed_mj}
HSET race:{race_id}:fuel                      → {flow_rate, consumed, remaining, laps_remaining}
HSET race:{race_id}:engine                    → {rpm, gear, coolant_temp}

# Race state
HSET race:{race_id}:state                     → {status, current_lap, total_laps, elapsed_s, position}

# Weather (refreshed every 5 min)
HSET race:{race_id}:weather                   → {air_temp, track_temp, humidity, wind_speed, wind_dir, rain, wetness}

# Lap history (append-only list)
RPUSH race:{race_id}:laps                     → JSON per lap summary

# Agent messages (last N for display)
RPUSH race:{race_id}:agent_messages           → JSON per message
LTRIM race:{race_id}:agent_messages 0 49      → keep last 50

# Active strategy
SET  race:{race_id}:strategy:active           → JSON with planned stops + reasoning

# Pace coaching (latest target lap + ERS deploy map, written every lap by Gemma)
SET  race:{race_id}:pace:current               → JSON {target_lap_time_s, compound, ers_deploy_map, lift_coast_zones, wet_crossover_lap, reasoning}

# Wet crossover prediction (recalculated when weather changes)
SET  race:{race_id}:pace:wet_crossover          → JSON {optimal_lap, compound_switch, delta_seconds}

# Alerts (pub/sub channel for live push)
PUBLISH race:{race_id}:alerts                 → {"type": "pit_call", "message": "Box box box!", "lap": 22}
```

---

## Data Source Mapping

Every parameter tracked back to its origin:

| Parameter | Source | Stored In | Displayed On |
|-----------|--------|-----------|--------------|
| Track GPS points | User draws on map (website) | `track_points` | Track Map view |
| Sector boundaries | User defines (website) | `track_sectors` | Track Map + Timing |
| DRS zones | User defines (website) | `track_drs_zones` | Track Map (markers only) |
| Total laps | User sets (website) | `races.total_laps` | Race header |
| Starting fuel | User sets (website) | `races.starting_fuel_kg` | Vehicle config panel |
| Tyre compound | User selects (website/app) | `races.tyre_compound_start` | Tyre widget |
| Vehicle mass/specs | User configures (website) | `race_vehicle_config` | Vehicle panel |
| Speed, position, accel | Phone GPS + IMU | `telemetry` + Redis | Speed gauge, map, g-force |
| Throttle/Brake | Derived from phone accel | `telemetry` + Redis | Pedal bars |
| Steering angle | Derived from phone gyro | `telemetry` + Redis | Steering indicator |
| Fuel flow/remaining | Simulation model | `telemetry` + Redis | Fuel gauge + trend |
| Tyre temps (×4) | Simulation model | `telemetry` + Redis | Tyre temp heatmap |
| Tyre wear/grip | Simulation model | `telemetry` + Redis | Wear bar + cliff alert |
| Tyre pressure (×4) | Simulation model | `telemetry` + Redis | Pressure readout |
| Brake temps (×4) | Simulation model | `telemetry` + Redis | Brake temp bars |
| ERS SOC/power | Simulation model | `telemetry` + Redis | Battery gauge + flow |
| Engine RPM/gear | Simulation model | `telemetry` + Redis | RPM dial + gear number |
| DRS state | Simulation model (rule-based) | `telemetry` + Redis | DRS indicator |
| Gap to car ahead | Simulation model (random walk) | `telemetry` + Redis | Gap display |
| Weather | Phone weather API | `race_weather` + Redis | Weather banner |
| Lap times/sectors | GPS geofence crossing | `lap_summaries` | Timing tower |
| Pit strategy | Gemma agent | `pit_strategies` + Redis | Strategy panel |
| Agent messages | Gemma agent | `agent_messages` + Redis | Comms feed |
| Pre-race report | Gemma agent (from test lap) | `pre_race_reports` | Report page |
| Target lap time | Gemma agent (pace model) | `pace_targets` + Redis `pace:current` | Live dashboard delta + HUD |
| Wet crossover prediction | Gemma agent (weather model) | `pace_targets.wet_crossover_lap` + Redis `pace:wet_crossover` | Strategy panel + HUD |
| ERS deploy map | Gemma agent (sector analysis) | `pace_targets.ers_deploy_map` + Redis | HUD + dashboard chart |
| Lift-coast zones | Gemma agent (fuel/brake model) | `pace_targets.lift_coast_zones` + Redis | HUD + alert |

---

*Every column in the telemetry table maps to a simulation model output from `simulation-models.md`. Every config field maps to a user input on the website.*
