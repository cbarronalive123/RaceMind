-- RaceMind Database Schema
-- Based on docs/database-schema.md

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- TRACK DEFINITION
-- =====================================================================

CREATE TABLE IF NOT EXISTS tracks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    country         VARCHAR(60),
    city            VARCHAR(60),
    total_distance_m FLOAT NOT NULL,
    num_corners     INT,
    elevation_min_m FLOAT,
    elevation_max_m FLOAT,
    drs_zones_count INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS track_points (
    id          BIGSERIAL,
    track_id    UUID REFERENCES tracks(id) ON DELETE CASCADE,
    seq         INT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    elevation_m FLOAT,
    point_type  VARCHAR(20) DEFAULT 'track',
    label       VARCHAR(50),
    PRIMARY KEY (track_id, seq)
);

CREATE TABLE IF NOT EXISTS track_sectors (
    track_id    UUID REFERENCES tracks(id) ON DELETE CASCADE,
    sector_num  SMALLINT NOT NULL,
    start_lat   DOUBLE PRECISION NOT NULL,
    start_lon   DOUBLE PRECISION NOT NULL,
    end_lat     DOUBLE PRECISION NOT NULL,
    end_lon     DOUBLE PRECISION NOT NULL,
    distance_m  FLOAT,
    PRIMARY KEY (track_id, sector_num)
);

CREATE TABLE IF NOT EXISTS track_drs_zones (
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

-- =====================================================================
-- RACE CONFIGURATION
-- =====================================================================

CREATE TABLE IF NOT EXISTS races (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id        UUID REFERENCES tracks(id),
    name            VARCHAR(100),
    total_laps      INT NOT NULL,
    starting_fuel_kg FLOAT NOT NULL DEFAULT 100.0,
    tyre_compound_start VARCHAR(20) NOT NULL DEFAULT 'medium',
    created_at      TIMESTAMPTZ DEFAULT now(),
    status          VARCHAR(20) DEFAULT 'setup'
);

CREATE TABLE IF NOT EXISTS race_vehicle_config (
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

CREATE TABLE IF NOT EXISTS race_weather (
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
    track_wetness   VARCHAR(10) DEFAULT 'dry'
);

-- =====================================================================
-- TELEMETRY (time-series — the big one)
-- =====================================================================

CREATE TABLE IF NOT EXISTS telemetry (
    ts                  TIMESTAMPTZ NOT NULL,
    race_id             UUID NOT NULL,
    lap                 INT,

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

    throttle_pct        FLOAT,
    brake_pct           FLOAT,
    steering_angle_deg  FLOAT,

    gear                SMALLINT,
    rpm                 INT,
    engine_coolant_temp FLOAT,

    fuel_flow_rate_kgh  FLOAT,
    fuel_consumed_kg    FLOAT,
    fuel_remaining_kg   FLOAT,

    tyre_temp_fl        FLOAT,
    tyre_temp_fr        FLOAT,
    tyre_temp_rl        FLOAT,
    tyre_temp_rr        FLOAT,
    tyre_carcass_temp_fl FLOAT,
    tyre_carcass_temp_fr FLOAT,
    tyre_carcass_temp_rl FLOAT,
    tyre_carcass_temp_rr FLOAT,

    tyre_pressure_fl    FLOAT,
    tyre_pressure_fr    FLOAT,
    tyre_pressure_rl    FLOAT,
    tyre_pressure_rr    FLOAT,

    tyre_wear_pct       FLOAT,
    tyre_grip_level     FLOAT,
    tyre_compound       VARCHAR(15),
    tyre_age_laps       INT,
    tyre_cliff_warning  BOOLEAN DEFAULT FALSE,

    brake_temp_fl       FLOAT,
    brake_temp_fr       FLOAT,
    brake_temp_rl       FLOAT,
    brake_temp_rr       FLOAT,
    brake_pad_wear_fl   FLOAT,
    brake_pad_wear_fr   FLOAT,
    brake_pad_wear_rl   FLOAT,
    brake_pad_wear_rr   FLOAT,
    brake_fade_warning  BOOLEAN DEFAULT FALSE,

    ers_soc_pct         FLOAT,
    ers_mode            VARCHAR(10),
    ers_power_kw        FLOAT,
    ers_harvested_lap_mj FLOAT,
    ers_deployed_lap_mj FLOAT,

    air_temp_c          FLOAT,
    track_temp_c        FLOAT,
    wind_speed_kmh      FLOAT,
    rain_mmh            FLOAT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_race_lap ON telemetry (race_id, lap, ts DESC);

-- =====================================================================
-- LAP SUMMARIES
-- =====================================================================

CREATE TABLE IF NOT EXISTS lap_summaries (
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
    new_compound    VARCHAR(15),
    ts              TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (race_id, lap_number)
);

-- =====================================================================
-- PIT STOP STRATEGY
-- =====================================================================

CREATE TABLE IF NOT EXISTS pit_strategies (
    id              SERIAL PRIMARY KEY,
    race_id         UUID REFERENCES races(id),
    strategy_type   VARCHAR(20) NOT NULL,
    generated_at    TIMESTAMPTZ DEFAULT now(),
    planned_stops   JSONB NOT NULL,
    reasoning       TEXT,
    confidence_pct  FLOAT,
    estimated_total_time_s FLOAT,
    estimated_position     INT
);

CREATE TABLE IF NOT EXISTS pit_stop_log (
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

CREATE TABLE IF NOT EXISTS pace_targets (
    id                  BIGSERIAL PRIMARY KEY,
    race_id             UUID REFERENCES races(id),
    ts                  TIMESTAMPTZ DEFAULT now(),
    lap                 INT NOT NULL,
    target_lap_time_s   FLOAT NOT NULL,
    recommended_compound VARCHAR(15),
    ers_deploy_map      JSONB,
    lift_coast_zones    JSONB,
    wet_crossover_lap   INT,
    confidence_pct      FLOAT,
    reasoning           TEXT
);

-- =====================================================================
-- GEMMA AGENT MESSAGES
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_messages (
    id              BIGSERIAL PRIMARY KEY,
    race_id         UUID REFERENCES races(id),
    ts              TIMESTAMPTZ DEFAULT now(),
    lap             INT,
    message_type    VARCHAR(20) NOT NULL,
    message         TEXT NOT NULL,
    data_snapshot   JSONB,
    urgency         VARCHAR(10) DEFAULT 'normal'
);

-- =====================================================================
-- PRE-RACE REPORT
-- =====================================================================

CREATE TABLE IF NOT EXISTS pre_race_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    race_id         UUID REFERENCES races(id),
    generated_at    TIMESTAMPTZ DEFAULT now(),
    track_analysis      TEXT,
    strategy_recommendation TEXT,
    tyre_recommendation TEXT,
    fuel_target_kg      FLOAT,
    weather_impact      TEXT,
    risk_factors        TEXT,
    predicted_lap_time_s FLOAT,
    predicted_pit_window JSONB,
    predicted_fuel_per_lap FLOAT,
    predicted_tyre_life_laps INT,
    full_report_md      TEXT
);
