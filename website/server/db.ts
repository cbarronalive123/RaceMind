import { Pool, QueryResult } from "pg";
import { TelemetryFrame } from "../src/lib/frame";
import { AgentMessage, Alert, LapSummary } from "../src/lib/types";

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? "5433"),
  database: process.env.PGDATABASE ?? "racemind",
  user: process.env.PGUSER ?? "racemind",
  password: process.env.PGPASSWORD ?? "racemind",
  max: 10,
});

export async function query(text: string, params: unknown[]): Promise<QueryResult> {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

export async function closePool() {
  await pool.end();
}

// ─── Tracks ───────────────────────────────────────────────────────────

export async function insertTrack(
  name: string,
  totalDistanceM: number,
  numCorners?: number,
  country?: string,
  city?: string,
): Promise<string> {
  const res = await query(
    `INSERT INTO tracks (name, total_distance_m, num_corners, country, city)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, totalDistanceM, numCorners ?? null, country ?? null, city ?? null],
  );
  return res.rows[0].id as string;
}

// ─── Races ────────────────────────────────────────────────────────────

export async function insertRace(
  trackName: string,
  totalLaps: number,
  startingFuelKg: number,
  tyreCompound: string,
): Promise<string> {
  const trackRes = await query(`SELECT id FROM tracks WHERE name = $1`, [trackName]);
  let trackId: string;
  if (trackRes.rows.length === 0) {
    trackId = await insertTrack(trackName, 5412, 14);
  } else {
    trackId = trackRes.rows[0].id as string;
  }

  const res = await query(
    `INSERT INTO races (track_id, name, total_laps, starting_fuel_kg, tyre_compound_start, status)
     VALUES ($1, $2, $3, $4, $5, 'live') RETURNING id`,
    [trackId, trackName, totalLaps, startingFuelKg, tyreCompound],
  );
  return res.rows[0].id as string;
}

export async function updateRaceStatus(raceId: string, status: string): Promise<void> {
  await query(`UPDATE races SET status = $1 WHERE id = $2`, [status, raceId]);
}

export async function getRaceIdByName(name: string): Promise<string | null> {
  const res = await query(`SELECT id FROM races WHERE name = $1 ORDER BY created_at DESC LIMIT 1`, [name]);
  return res.rows.length > 0 ? res.rows[0].id as string : null;
}

// ─── Telemetry ────────────────────────────────────────────────────────

const TELEMETRY_INSERT = `
INSERT INTO telemetry (
  ts, race_id, lap, speed_kmh, gps_lat, gps_lon, heading_deg,
  lateral_g, longitudinal_g,
  throttle_pct, brake_pct, steering_angle_deg,
  gear, rpm,
  fuel_flow_rate_kgh, fuel_consumed_kg, fuel_remaining_kg,
  tyre_temp_fl, tyre_temp_fr, tyre_temp_rl, tyre_temp_rr,
  tyre_pressure_fl, tyre_pressure_fr, tyre_pressure_rl, tyre_pressure_rr,
  tyre_wear_pct, tyre_grip_level, tyre_compound, tyre_age_laps,
  brake_temp_fl, brake_temp_fr, brake_temp_rl, brake_temp_rr, brake_fade_warning,
  ers_soc_pct, ers_mode, ers_power_kw, ers_harvested_lap_mj, ers_deployed_lap_mj,
  air_temp_c, track_temp_c, wind_speed_kmh, rain_mmh
) VALUES (
  to_timestamp($1), $2, $3, $4, $5, $6, 0,
  $7, $8,
  $9, $10, $11,
  $12, $13,
  $14, $15, $16,
  $17, $18, $19, $20,
  $21, $22, $23, $24,
  $25, $26, $27, $28,
  $29, $30, $31, $32, $33,
  $34, $35, $36, $37, $38,
  $39, $40, $41, $42
)
`;

export async function insertTelemetry(raceId: string, frame: TelemetryFrame): Promise<void> {
  const fuelConsumed = frame.fuel.remaining_kg > 0
    ? Math.max(0, 100 - frame.fuel.remaining_kg)
    : 0;

  await query(TELEMETRY_INSERT, [
    frame.t, raceId, frame.lap,
    frame.speed_kmh, frame.lat, frame.lon,
    frame.lateral_g, frame.longitudinal_g,
    frame.throttle_pct, frame.brake_pct, frame.steering_deg,
    frame.gear, frame.rpm,
    frame.fuel.flow_rate_kg_h, fuelConsumed, frame.fuel.remaining_kg,
    frame.tyres.temps_c.fl, frame.tyres.temps_c.fr, frame.tyres.temps_c.rl, frame.tyres.temps_c.rr,
    frame.tyres.pressures_psi.fl, frame.tyres.pressures_psi.fr, frame.tyres.pressures_psi.rl, frame.tyres.pressures_psi.rr,
    frame.tyres.wear_pct, frame.tyres.grip_level, frame.tyres.compound, frame.tyres.age_laps,
    frame.brakes.temps_c.fl, frame.brakes.temps_c.fr, frame.brakes.temps_c.rl, frame.brakes.temps_c.rr,
    frame.brakes.fade,
    frame.ers.soc_pct, frame.ers.mode, frame.ers.power_kw, frame.ers.harvested_mj, frame.ers.deployed_mj,
    frame.weather.air_temp_c, frame.weather.track_temp_c, frame.weather.wind_kmh, frame.weather.rain_mm_h,
  ]);
}

// ─── Lap Summaries ───────────────────────────────────────────────────

export async function upsertLapSummary(raceId: string, lap: LapSummary): Promise<void> {
  await query(
    `INSERT INTO lap_summaries (
      race_id, lap_number, lap_time_s, sector1_time_s, sector2_time_s, sector3_time_s,
      fuel_used_kg, fuel_remaining_kg, tyre_wear_end_pct, tyre_compound
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (race_id, lap_number) DO UPDATE SET
      lap_time_s = EXCLUDED.lap_time_s,
      sector1_time_s = EXCLUDED.sector1_time_s,
      sector2_time_s = EXCLUDED.sector2_time_s,
      sector3_time_s = EXCLUDED.sector3_time_s`,
    [
      raceId, lap.lap, lap.total, lap.s1, lap.s2, lap.s3,
      lap.fuelKg, null, lap.wearPct, null,
    ],
  );
}

export async function getLapSummaries(raceId: string): Promise<LapSummary[]> {
  const res = await query(
    `SELECT lap_number, lap_time_s, sector1_time_s, sector2_time_s, sector3_time_s,
            fuel_used_kg, tyre_wear_end_pct
     FROM lap_summaries WHERE race_id = $1 ORDER BY lap_number`,
    [raceId],
  );
  return res.rows.map((r) => ({
    lap: r.lap_number,
    total: r.lap_time_s ?? 0,
    s1: r.sector1_time_s ?? 0,
    s2: r.sector2_time_s ?? 0,
    s3: r.sector3_time_s ?? 0,
    fuelKg: r.fuel_used_kg ?? 0,
    wearPct: r.tyre_wear_end_pct ?? 0,
  }));
}

// ─── Agent Messages ──────────────────────────────────────────────────

export async function insertAgentMessage(raceId: string, msg: AgentMessage): Promise<void> {
  await query(
    `INSERT INTO agent_messages (race_id, lap, message_type, message, urgency)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      raceId, msg.lap, "strategy", msg.text, "normal",
    ],
  );
}

export async function getAgentMessages(raceId: string): Promise<AgentMessage[]> {
  const res = await query(
    `SELECT id, lap, message, ts FROM agent_messages WHERE race_id = $1 ORDER BY ts`,
    [raceId],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    lap: r.lap,
    text: r.message,
    createdAt: new Date(r.ts).getTime(),
  }));
}

// ─── Alerts ──────────────────────────────────────────────────────────

export async function insertAlert(raceId: string, alert: Alert): Promise<void> {
  await query(
    `INSERT INTO agent_messages (race_id, lap, message_type, message, urgency, data_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      raceId, alert.lap,
      alert.tier === "2c" ? "warning" : alert.tier === "2b" ? "warning" : "info",
      alert.message,
      alert.severity,
      JSON.stringify({ id: alert.id, title: alert.title, tier: alert.tier, channels: alert.channels }),
    ],
  );
}

// ─── Pit Stops ──────────────────────────────────────────────────────

export async function insertPitStop(
  raceId: string,
  lapNumber: number,
  oldCompound: string,
  newCompound: string,
  tyreWearAtStop: number,
): Promise<void> {
  await query(
    `INSERT INTO pit_stop_log (race_id, lap_number, old_compound, new_compound, tyre_wear_at_stop)
     VALUES ($1, $2, $3, $4, $5)`,
    [raceId, lapNumber, oldCompound, newCompound, tyreWearAtStop],
  );
}

// ─── Race History ───────────────────────────────────────────────────

export interface RaceRow {
  id: string;
  name: string;
  track_id: string;
  total_laps: number;
  status: string;
  created_at: string;
}

export async function listRaces(): Promise<RaceRow[]> {
  const res = await query(
    `SELECT id, name, track_id, total_laps, status, created_at FROM races ORDER BY created_at DESC`,
    [],
  );
  return res.rows;
}

export async function getRaceById(raceId: string): Promise<RaceRow | null> {
  const res = await query(
    `SELECT id, name, track_id, total_laps, status, created_at FROM races WHERE id = $1`,
    [raceId],
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

export async function getTelemetryFrames(
  raceId: string,
  limit = 1000,
): Promise<TelemetryFrame[]> {
  const res = await query(
    `SELECT * FROM telemetry WHERE race_id = $1 ORDER BY ts LIMIT $2`,
    [raceId, limit],
  );
  return res.rows.map((r) => ({
    t: new Date(r.ts).getTime() / 1000,
    lap: r.lap,
    lap_time_s: 0,
    track_pos: 0,
    sector: 1,
    lat: r.gps_lat,
    lon: r.gps_lon,
    speed_kmh: r.speed_kmh,
    rpm: r.rpm,
    gear: r.gear,
    throttle_pct: r.throttle_pct,
    brake_pct: r.brake_pct,
    steering_deg: r.steering_angle_deg,
    lateral_g: r.lateral_g,
    longitudinal_g: r.longitudinal_g,
    tyres: {
      compound: r.tyre_compound,
      wear_pct: r.tyre_wear_pct,
      grip_level: r.tyre_grip_level,
      age_laps: r.tyre_age_laps,
      temps_c: { fl: r.tyre_temp_fl, fr: r.tyre_temp_fr, rl: r.tyre_temp_rl, rr: r.tyre_temp_rr },
      pressures_psi: { fl: r.tyre_pressure_fl, fr: r.tyre_pressure_fr, rl: r.tyre_pressure_rl, rr: r.tyre_pressure_rr },
    },
    fuel: {
      remaining_kg: r.fuel_remaining_kg,
      flow_rate_kg_h: r.fuel_flow_rate_kgh,
      avg_per_lap_kg: 0,
      laps_remaining: 0,
    },
    ers: {
      soc_pct: r.ers_soc_pct,
      mode: r.ers_mode,
      power_kw: r.ers_power_kw,
      harvested_mj: r.ers_harvested_lap_mj,
      deployed_mj: r.ers_deployed_lap_mj,
    },
    brakes: {
      temps_c: { fl: r.brake_temp_fl, fr: r.brake_temp_fr, rl: r.brake_temp_rl, rr: r.brake_temp_rr },
      pad_pct: 0,
      fade: r.brake_fade_warning,
    },
    weather: {
      air_temp_c: r.air_temp_c,
      track_temp_c: r.track_temp_c,
      wind_kmh: r.wind_speed_kmh,
      wind_dir: "N",
      rain_mm_h: r.rain_mmh,
      condition: "dry" as const,
    },
  }));
}
