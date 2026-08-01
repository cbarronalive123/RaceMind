# RaceMind — Tech Stack

## Database

**TimescaleDB** (PostgreSQL extension) for time-series telemetry storage + **Redis** for real-time hot state the Gemma agent queries against.

---

## Data Simulation Strategy: Phone as F1 Car

We don't have an F1 car. We have phones. The idea: use phone sensors as the "ground truth" input layer, then run physics-based models to derive the full F1 telemetry stack in real-time — as if the phone's movement IS the car.

---

## Phone Sensors → F1 Telemetry Mapping

### TIER 1: Direct from Phone (raw sensor data)

These channels come straight from phone hardware with no modeling needed.

| F1 Channel | Phone Source | Notes |
|------------|--------------|-------|
| GPS Position (X, Y) | GPS | ~1-10 Hz, meter-level accuracy |
| GPS Speed | GPS | Derived from position delta |
| Heading | Magnetometer + GPS | Direction of travel |
| Longitudinal Acceleration | Accelerometer Y-axis | Braking/accelerating force |
| Lateral Acceleration | Accelerometer X-axis | Cornering force |
| Vertical Acceleration | Accelerometer Z-axis | Bumps |
| Yaw Rate | Gyroscope Z-axis | Turning rate |
| Roll Rate | Gyroscope X-axis | Body roll |
| Pitch Rate | Gyroscope Y-axis | Nose up/down |
| Air Temperature | Weather API | Ambient conditions |
| Humidity | Weather API | Relative humidity |
| Atmospheric Pressure | Barometer (if phone has one) | Some phones have this |
| Wind Speed/Direction | Weather API | Local conditions |
| Rainfall | Weather API | Precipitation |

### TIER 2: Derived from Phone Motion (simple physics models)

These are computed from Tier 1 inputs using straightforward formulas.

| F1 Channel | Derived From | Model |
|------------|--------------|-------|
| Speed (km/h) | GPS speed | Direct |
| Distance per lap | GPS path integration | Sum of position deltas |
| Lap Time | GPS geofence crossing | Define start/finish line |
| Sector Times | GPS geofence sectors | Define sector boundaries |
| Steering Angle | Yaw rate + speed | `angle ≈ arctan(yaw_rate × wheelbase / speed)` |
| Braking (yes/no) | Negative longitudinal accel | Threshold: < -0.2g = braking |
| Throttle (yes/no) | Positive longitudinal accel | Threshold: > 0.1g = accelerating |
| Cornering intensity | Lateral acceleration magnitude | Direct mapping |
| Lap Number | GPS geofence counter | Increment on crossing |

### TIER 3: Simulated via Physics Models (the interesting part)

These are the channels where we build simplified F1 physics models that take Tier 1 + Tier 2 as inputs and produce realistic simulated telemetry.

---

## FUEL CONSUMPTION MODEL

**The core idea:** Fuel burn rate is a function of how hard you're pushing the engine, which we infer from your phone's acceleration/speed profile.

### Inputs (from phone)
- `speed` (km/h) — from GPS
- `longitudinal_accel` (g) — from accelerometer (positive = throttle, negative = brake)
- `lateral_accel` (g) — from accelerometer (cornering load)
- `weather.wind_speed` (km/h) — headwind increases drag
- `weather.rain` (boolean) — wet = more wheelspin = more fuel
- `tyre_compound` (user-selected) — softer = more rolling resistance

### Formula (simplified)

```
base_consumption = 2.0 kg/h                          # idle fuel flow

# Speed component (aerodynamic drag ∝ v²)
drag_fuel = 0.0008 × speed²                          # kg/h added from drag

# Acceleration component (more throttle = more fuel)
throttle_fuel = max(0, longitudinal_accel) × 25.0    # kg/h when accelerating

# Cornering component (lateral load increases rolling resistance)
cornering_fuel = |lateral_accel| × 5.0               # kg/h from tire scrub

# Wind penalty (headwind increases effective drag)
wind_factor = 1.0 + (wind_speed / 200.0)             # 100 km/h wind = 1.5x drag

# Rain penalty (wheelspin + cautious re-acceleration)
rain_factor = 1.15 if raining else 1.0

# Tyre compound factor (soft = grippier = slightly more fuel from mechanical grip)
tyre_factor = { soft: 1.05, medium: 1.00, hard: 0.97 }

# TOTAL
fuel_flow_rate = (base_consumption + drag_fuel + throttle_fuel + cornering_fuel) 
                 × wind_factor × rain_factor × tyre_factor

# Clamp to F1 max (100 kg/h)
fuel_flow_rate = min(fuel_flow_rate, 100.0)

# Integration over time
fuel_consumed += fuel_flow_rate × dt
fuel_remaining = starting_fuel - fuel_consumed
```

### Why this works for a demo
- Walking = ~2-5 km/h = barely any fuel used (idle)
- Jogging = ~10-15 km/h = light fuel usage
- Cycling/driving = ~30-80 km/h = moderate usage
- Sharp turns = lateral accel spike = fuel bump
- Sprinting then stopping = acceleration + braking pattern visible

The judges see realistic fuel curves that respond to actual human movement patterns.

---

## OTHER TIER 3 MODELS (same pattern as fuel)

### Tyre Degradation Model
```
Inputs: speed, lateral_accel, tyre_compound, tyre_age, track_temp
Logic:  wear_rate = base_wear 
        + (|lateral_accel| × cornering_wear_factor)
        + (speed / max_speed × speed_wear_factor)
        + (track_temp - optimal_temp) × thermal_factor
Output: tyre_wear_% (0-100), tyre_surface_temp, grip_level
```

### Tyre Temperature Model
```
Inputs: speed, lateral_accel, braking, ambient_temp, tyre_compound
Logic:  heat_in = braking_energy + cornering_friction + rolling_resistance
        heat_out = cooling_from_airflow(speed) + radiation
        tyre_temp += (heat_in - heat_out) × dt
Output: tyre_temp per corner (FL, FR, RL, RR)
        - Higher lateral_accel heats outer tyres more
        - Braking heats fronts more
```

### ERS / Battery Model
```
Inputs: braking (longitudinal_accel < 0), speed, throttle
Logic:  if braking: harvest energy (SOC increases)
        if accelerating: deploy energy (SOC decreases)
        harvest_rate = |braking_accel| × speed × efficiency
        deploy_rate = throttle_demand × deploy_map
Output: SOC %, energy_harvested_this_lap, energy_deployed_this_lap
```

### Brake Temperature Model
```
Inputs: braking_intensity, speed_at_braking, ambient_temp
Logic:  heat_in = brake_pressure × speed (kinetic energy → heat)
        heat_out = airflow_cooling(speed) + radiation
        brake_temp += (heat_in - heat_out) × dt
Output: brake_disc_temp per corner (200°C - 1000°C range)
```

### Engine RPM & Gear Model
```
Inputs: speed
Logic:  gear = lookup_table(speed)  # e.g. 0-60=1st, 60-110=2nd, etc.
        rpm = speed × gear_ratio[gear] × final_drive
Output: rpm (6000-15000 range), gear (1-8)
```

---

## What We DON'T Simulate (out of scope for hackathon)

| Category | Reason |
|----------|--------|
| Hydraulics | No strategic value, just system health |
| Gearbox oil temp/pressure | Internal plumbing — not interesting for strategy |
| Pit stop mechanics (wheel guns, jacks) | We simulate pit stop timing, not the physical act |
| Telemetry link quality | We ARE the link |
| Sensor health flags | Meta-data, not strategy |
| Biometrics (heart rate, SpO2) | Could use phone/watch, but not core to pit strategy |

---

## Summary: Our Simulated Telemetry Stack

| Channel Group | Count | Source Method |
|---------------|-------|---------------|
| Motion & Position | 14 | Direct from phone sensors |
| Weather/Environment | 6 | Weather API |
| Fuel | 4 | Physics model from accel + speed |
| Tyres (temp, wear, pressure) | 12 | Physics model from lateral-g + speed + compound |
| Brakes | 6 | Physics model from braking events |
| ERS / Battery | 5 | Physics model from braking/throttle |
| Engine (RPM, gear) | 3 | Lookup table from speed |
| Timing (laps, sectors) | 6 | GPS geofencing |
| **TOTAL** | **~55 channels** | |

55+ realistic channels from a phone — that's plenty for the alert system and Gemma agent to reason about pit strategy, tyre management, and fuel targets.
