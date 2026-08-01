> **PURPOSE OF THIS FILE:** This is the *engineering spec* — it documents exactly how we simulate F1 telemetry channels from phone sensor inputs using physics models. For the *complete list of what a real F1 car measures* (our ground truth reference), see [`f1-telemetry-data.md`](./f1-telemetry-data.md).

---

# Simulation Models: Phone → F1 Telemetry

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   PHONE HARDWARE                      │
│  GPS · Accelerometer · Gyroscope · Barometer         │
└──────────────────────┬──────────────────────────────┘
                       │ raw sensor data (10-100 Hz)
                       ▼
┌─────────────────────────────────────────────────────┐
│              TIER 1: DIRECT CHANNELS                  │
│  Position, speed, accel, rotation, heading           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│          TIER 2: DERIVED (simple math)               │
│  Steering angle, braking detection, lap counting     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│        TIER 3: PHYSICS SIMULATION MODELS             │
│  Fuel, tyres, brakes, ERS, engine, pressure         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              EXTERNAL INPUTS                          │
│  Weather API · User-selected tyre compound ·         │
│  Track definition (GPS geofences)                    │
└─────────────────────────────────────────────────────┘
```

---

## Constants & Configuration

```python
# Car physics constants (simplified F1 model)
CAR_MASS = 798  # kg (2026 minimum weight with driver)
FUEL_CAPACITY = 110  # kg (max fuel load)
WHEELBASE = 3.6  # meters
TYRE_RADIUS = 0.33  # meters
FRONTAL_AREA = 1.5  # m²
CD_BASE = 0.9  # drag coefficient (high downforce config)
AIR_DENSITY = 1.225  # kg/m³ at sea level

# Scaling factor: maps phone movement to F1 speeds
# A person walking at 5 km/h → simulated as 100 km/h
# This makes the demo feel like F1 even while walking around
SPEED_SCALE = 20.0

# Gear ratios (simplified 8-speed sequential)
GEAR_RATIOS = {
    1: 3.5,   # 0-80 km/h
    2: 2.8,   # 80-130 km/h
    3: 2.2,   # 130-180 km/h
    4: 1.8,   # 180-230 km/h
    5: 1.5,   # 230-270 km/h
    6: 1.3,   # 270-300 km/h
    7: 1.1,   # 300-330 km/h
    8: 0.95,  # 330+ km/h
}
FINAL_DRIVE = 3.2

# Tyre compound characteristics
TYRE_COMPOUNDS = {
    "soft":         {"grip": 1.10, "wear_rate": 1.40, "optimal_temp": 100, "temp_window": 15},
    "medium":       {"grip": 1.00, "wear_rate": 1.00, "optimal_temp": 95,  "temp_window": 20},
    "hard":         {"grip": 0.92, "wear_rate": 0.70, "optimal_temp": 90,  "temp_window": 25},
    "intermediate": {"grip": 0.85, "wear_rate": 1.20, "optimal_temp": 70,  "temp_window": 30},
    "wet":          {"grip": 0.75, "wear_rate": 0.90, "optimal_temp": 60,  "temp_window": 35},
}
```

---

## TIER 1: Direct from Phone Sensors

These channels require no modeling — they come directly from hardware.

### 1.1 GPS Module

| Output Channel | Phone API | Sample Rate | Notes |
|----------------|-----------|-------------|-------|
| `gps_lat`, `gps_lon` | Fused Location Provider | 1-10 Hz | Accuracy ~3-5m outdoors |
| `gps_speed` (m/s) | Location.getSpeed() | 1-10 Hz | Doppler-based, more accurate than position delta |
| `heading` (deg) | Location.getBearing() | 1-10 Hz | Direction of travel, 0=North |
| `altitude` (m) | Location.getAltitude() | 1-10 Hz | Useful for track elevation |

**Scaling:** `f1_speed = gps_speed × SPEED_SCALE`

A person walking at 5 km/h becomes 100 km/h in the simulation. Jogging at 12 km/h = 240 km/h. Cycling at 25 km/h = 500 km/h (we clamp to 370 km/h max).

### 1.2 Accelerometer (IMU)

| Output Channel | Phone API | Sample Rate | Notes |
|----------------|-----------|-------------|-------|
| `accel_x` (lateral) | TYPE_LINEAR_ACCELERATION | 50-200 Hz | Cornering force (positive = right turn) |
| `accel_y` (longitudinal) | TYPE_LINEAR_ACCELERATION | 50-200 Hz | Throttle/brake (positive = accelerating) |
| `accel_z` (vertical) | TYPE_LINEAR_ACCELERATION | 50-200 Hz | Bumps, kerbs |

**Important:** Use `TYPE_LINEAR_ACCELERATION` (gravity removed), not raw `TYPE_ACCELEROMETER`.

**Scaling:** Phone accelerations map 1:1 to g-forces. A person turning sharply while walking generates ~0.1-0.3g lateral. An F1 car corners at 4-6g. We scale: `f1_lateral_g = accel_x × 15.0` (clamped to ±6g).

### 1.3 Gyroscope

| Output Channel | Phone API | Sample Rate | Notes |
|----------------|-----------|-------------|-------|
| `yaw_rate` (deg/s) | TYPE_GYROSCOPE z-axis | 50-200 Hz | Turning rate |
| `roll_rate` (deg/s) | TYPE_GYROSCOPE x-axis | 50-200 Hz | Body roll |
| `pitch_rate` (deg/s) | TYPE_GYROSCOPE y-axis | 50-200 Hz | Nose dive/lift |

**Scaling:** `f1_yaw_rate = gyro_z × 5.0` (walking turn rate amplified to F1 range of ±100 deg/s).

### 1.4 Barometer (optional — not all phones)

| Output Channel | Phone API | Sample Rate | Notes |
|----------------|-----------|-------------|-------|
| `atmospheric_pressure` (mbar) | TYPE_PRESSURE | 1-5 Hz | Used for altitude + air density correction |

### 1.5 Weather API (external)

| Output Channel | Source | Update Rate | Notes |
|----------------|--------|-------------|-------|
| `air_temp` (°C) | OpenWeather / phone weather | Every 5 min | Ambient temperature |
| `humidity` (%) | OpenWeather | Every 5 min | Affects engine intake |
| `wind_speed` (km/h) | OpenWeather | Every 5 min | Headwind/tailwind factor |
| `wind_direction` (deg) | OpenWeather | Every 5 min | Relative to car heading |
| `rain` (mm/h) | OpenWeather | Every 5 min | Precipitation intensity |
| `track_temp` (°C) | `air_temp + 15` (estimate) | Derived | Asphalt is hotter than air |

---

## TIER 2: Derived Channels (Simple Math)

These are computed from Tier 1 inputs with straightforward formulas.

### 2.1 Lap Detection & Timing

```python
# Define a start/finish geofence (GPS polygon or radius)
START_FINISH = {"lat": ..., "lon": ..., "radius": 5.0}  # 5m radius circle

def check_lap_crossing(position, prev_position):
    """Detect when car crosses start/finish line."""
    crossed = (
        distance(prev_position, START_FINISH) > START_FINISH["radius"]
        and distance(position, START_FINISH) <= START_FINISH["radius"]
    )
    return crossed

# State
lap_number = 0
lap_start_time = now()

def on_position_update(position, prev_position):
    global lap_number, lap_start_time
    if check_lap_crossing(position, prev_position):
        lap_time = now() - lap_start_time
        lap_number += 1
        lap_start_time = now()
        return {"lap_number": lap_number, "last_lap_time": lap_time}
```

### 2.2 Sector Times

```python
# Define 3 sector boundaries as GPS geofences
SECTOR_LINES = [
    {"lat": ..., "lon": ..., "radius": 5.0},  # S1/S2 boundary
    {"lat": ..., "lon": ..., "radius": 5.0},  # S2/S3 boundary
    # S3/S1 boundary = start/finish line
]

sector_start_time = now()
current_sector = 1

def on_sector_crossing(sector_idx):
    global sector_start_time, current_sector
    sector_time = now() - sector_start_time
    current_sector = (sector_idx % 3) + 1
    sector_start_time = now()
    return {"sector": sector_idx, "time": sector_time}
```

### 2.3 Steering Angle

```python
def compute_steering_angle(yaw_rate_deg_s, speed_ms):
    """
    From bicycle model: steering_angle = arctan(yaw_rate * wheelbase / speed)
    """
    if speed_ms < 1.0:  # avoid division by zero at standstill
        return 0.0
    
    yaw_rate_rad = math.radians(yaw_rate_deg_s)
    angle_rad = math.atan(yaw_rate_rad * WHEELBASE / speed_ms)
    angle_deg = math.degrees(angle_rad)
    
    # F1 steering range is roughly ±200 degrees (lock to lock)
    return clamp(angle_deg, -200, 200)
```

### 2.4 Throttle & Brake Detection

```python
def compute_throttle_brake(longitudinal_accel_g):
    """
    Classify driver input from longitudinal acceleration.
    Returns (throttle_pct, brake_pct)
    """
    if longitudinal_accel_g > 0.05:  # accelerating threshold
        # Map 0.05g → 0%, max_accel → 100%
        throttle = clamp(longitudinal_accel_g / MAX_ACCEL_G, 0, 1) * 100
        brake = 0.0
    elif longitudinal_accel_g < -0.1:  # braking threshold
        # Map -0.1g → 0%, -max_brake → 100%
        throttle = 0.0
        brake = clamp(abs(longitudinal_accel_g) / MAX_BRAKE_G, 0, 1) * 100
    else:  # coasting
        throttle = 0.0
        brake = 0.0
    
    return throttle, brake

# After speed scaling:
MAX_ACCEL_G = 2.0   # F1 acceleration ~1.5-2g
MAX_BRAKE_G = 5.5   # F1 braking ~5-6g
```

### 2.5 Distance Traveled

```python
distance_in_lap = 0.0

def on_position_update(position, prev_position, dt):
    global distance_in_lap
    delta = haversine(prev_position, position)  # meters
    distance_in_lap += delta * SPEED_SCALE  # scale to F1 distances
    # Reset on new lap
```

---

## TIER 3: Physics Simulation Models

These models take Tier 1 + Tier 2 as inputs and produce realistic simulated F1 telemetry. Each model runs every tick (10-50 Hz) and maintains internal state.

---

### 3.1 FUEL CONSUMPTION MODEL

**Purpose:** Simulate realistic fuel burn that responds to driving style — aggressive driving burns more fuel.

**Outputs:**
- `fuel_flow_rate` (kg/h) — instantaneous consumption rate
- `fuel_consumed` (kg) — running total
- `fuel_remaining` (kg) — starting fuel minus consumed
- `fuel_laps_remaining` — estimated laps until empty

**Inputs:**
- `speed` (km/h) — from Tier 1 scaled
- `throttle` (%) — from Tier 2
- `lateral_accel` (g) — from Tier 1 scaled
- `wind_speed` (km/h), `wind_direction` (deg), `heading` (deg) — from weather/GPS
- `rain` (boolean) — from weather
- `tyre_compound` — user selection

```python
class FuelModel:
    def __init__(self, starting_fuel_kg=100.0):
        self.fuel_remaining = starting_fuel_kg
        self.fuel_consumed = 0.0
    
    def update(self, dt, speed_kmh, throttle_pct, lateral_g, 
               wind_speed, wind_direction, heading, raining, tyre_compound):
        """
        dt: time step in hours (for kg/h integration)
        Returns: fuel_flow_rate (kg/h)
        """
        speed = max(speed_kmh, 0)
        
        # === Component 1: Base idle consumption ===
        # Even at 0 throttle, engine idles at ~2.0 kg/h
        base = 2.0
        
        # === Component 2: Aerodynamic drag (proportional to v²) ===
        # F1 at 300 km/h uses ~90 kg/h; drag ∝ v²
        # Coefficient: 90 / 300² = 0.001
        drag_fuel = 0.001 * speed ** 2
        
        # === Component 3: Throttle/acceleration demand ===
        # Full throttle at high speed = max fuel flow
        # Scales linearly with throttle percentage
        throttle_fuel = (throttle_pct / 100.0) * 40.0  # max 40 kg/h from throttle alone
        
        # === Component 4: Cornering load ===
        # Lateral forces increase tire scrub and rolling resistance
        # More aggressive cornering = more fuel from fighting friction
        cornering_fuel = abs(lateral_g) * 4.0  # 4 kg/h per g of lateral
        
        # === Component 5: Headwind factor ===
        # Headwind increases effective drag; tailwind reduces it
        relative_wind_angle = math.radians(wind_direction - heading)
        headwind_component = wind_speed * math.cos(relative_wind_angle)  # positive = headwind
        wind_factor = 1.0 + (headwind_component / 300.0)  # ±100 km/h wind = ±33% drag
        wind_factor = clamp(wind_factor, 0.7, 1.5)
        
        # === Component 6: Rain penalty ===
        # Wet conditions: more wheelspin, more cautious re-acceleration = ~15% more fuel
        rain_factor = 1.15 if raining else 1.0
        
        # === Component 7: Tyre compound factor ===
        # Softer tyres = more mechanical grip = slightly more fuel from deformation
        compound_factors = {"soft": 1.05, "medium": 1.00, "hard": 0.97,
                           "intermediate": 1.03, "wet": 1.01}
        tyre_factor = compound_factors.get(tyre_compound, 1.0)
        
        # === TOTAL ===
        fuel_flow = (base + drag_fuel + throttle_fuel + cornering_fuel)
        fuel_flow *= wind_factor * rain_factor * tyre_factor
        
        # Clamp to F1 regulations (max 100 kg/h)
        fuel_flow = clamp(fuel_flow, 0.5, 100.0)
        
        # Integrate
        consumed_this_tick = fuel_flow * dt  # dt in hours
        self.fuel_consumed += consumed_this_tick
        self.fuel_remaining = max(0, self.fuel_remaining - consumed_this_tick)
        
        return {
            "fuel_flow_rate": round(fuel_flow, 2),
            "fuel_consumed": round(self.fuel_consumed, 3),
            "fuel_remaining": round(self.fuel_remaining, 3),
        }
    
    def estimate_laps_remaining(self, avg_fuel_per_lap):
        """Call after at least 1 lap to get estimate."""
        if avg_fuel_per_lap <= 0:
            return 99
        return int(self.fuel_remaining / avg_fuel_per_lap)
```

**Expected behavior at different phone activities:**
| Activity | Simulated Speed | Fuel Flow | Feel |
|----------|----------------|-----------|------|
| Standing still | 0 km/h | ~2 kg/h | Idle on grid |
| Slow walk | 60 km/h | ~12 kg/h | Pit lane / safety car |
| Normal walk | 100 km/h | ~25 kg/h | Medium-speed corner |
| Fast walk | 140 km/h | ~40 kg/h | Fast corner |
| Jogging | 240 km/h | ~70 kg/h | Straight at high throttle |
| Sharp turn while jogging | 240 km/h + 3g lat | ~82 kg/h | Heavy braking zone entry |

---

### 3.2 TYRE TEMPERATURE MODEL

**Purpose:** Simulate per-corner tyre temperatures that heat up from driving and cool down from airflow. Temperature affects grip → affects strategy decisions.

**Outputs (per corner: FL, FR, RL, RR):**
- `tyre_surface_temp` (°C) — working range 70-120°C
- `tyre_carcass_temp` (°C) — slower-responding internal temp
- `in_optimal_window` (boolean) — whether temp is in grip sweet spot

**Inputs:**
- `speed` (km/h), `lateral_g`, `braking` (boolean), `throttle` (%)
- `tyre_compound` — determines optimal window
- `air_temp` (°C) — ambient cooling baseline
- `track_temp` (°C) — conductive heating from surface

```python
class TyreTemperatureModel:
    def __init__(self, compound="medium", ambient_temp=25.0):
        self.compound = TYRE_COMPOUNDS[compound]
        self.ambient = ambient_temp
        # Initialize at ambient + small offset (tyres start cold)
        self.surface_temp = {"FL": ambient_temp + 10, "FR": ambient_temp + 10,
                            "RL": ambient_temp + 10, "RR": ambient_temp + 10}
        self.carcass_temp = {"FL": ambient_temp + 5, "FR": ambient_temp + 5,
                            "RL": ambient_temp + 5, "RR": ambient_temp + 5}
    
    def update(self, dt_s, speed_kmh, lateral_g, braking, throttle_pct, track_temp):
        """dt_s: time step in seconds."""
        speed_ms = speed_kmh / 3.6
        
        for corner in ["FL", "FR", "RL", "RR"]:
            # === HEAT INPUT ===
            
            # 1. Cornering friction (lateral load)
            # Left turn (positive lateral_g) heats right tyres more
            if corner in ["FR", "RR"]:
                corner_heat = max(0, lateral_g) * 8.0  # °C/s per g
            else:
                corner_heat = max(0, -lateral_g) * 8.0
            # Both sides get some base cornering heat
            corner_heat += abs(lateral_g) * 3.0
            
            # 2. Braking friction (fronts heat more)
            brake_heat = 0.0
            if braking:
                if corner in ["FL", "FR"]:
                    brake_heat = 12.0  # °C/s — front brakes do 60-70% of braking
                else:
                    brake_heat = 6.0   # °C/s — rears
            
            # 3. Traction (rears heat from throttle)
            traction_heat = 0.0
            if corner in ["RL", "RR"]:
                traction_heat = (throttle_pct / 100.0) * 5.0  # °C/s at full throttle
            
            # 4. Track surface conduction (always present)
            track_heat = (track_temp - self.surface_temp[corner]) * 0.02  # slow conduction
            
            total_heat_in = corner_heat + brake_heat + traction_heat + track_heat
            
            # === HEAT OUTPUT (cooling) ===
            
            # Airflow cooling (proportional to speed)
            airflow_cooling = (speed_ms / 80.0) * 15.0  # °C/s at 80 m/s (288 km/h)
            
            # Radiation cooling (always present, proportional to temp above ambient)
            radiation_cooling = (self.surface_temp[corner] - self.ambient) * 0.05
            
            total_heat_out = airflow_cooling + radiation_cooling
            
            # === NET TEMPERATURE CHANGE ===
            delta_surface = (total_heat_in - total_heat_out) * dt_s
            self.surface_temp[corner] += delta_surface
            
            # Carcass follows surface with lag (thermal mass)
            carcass_delta = (self.surface_temp[corner] - self.carcass_temp[corner]) * 0.1 * dt_s
            self.carcass_temp[corner] += carcass_delta
            
            # Clamp to realistic range
            self.surface_temp[corner] = clamp(self.surface_temp[corner], self.ambient, 150.0)
            self.carcass_temp[corner] = clamp(self.carcass_temp[corner], self.ambient, 130.0)
        
        # Check optimal window
        optimal = self.compound["optimal_temp"]
        window = self.compound["temp_window"]
        in_window = {}
        for corner in ["FL", "FR", "RL", "RR"]:
            in_window[corner] = abs(self.surface_temp[corner] - optimal) <= window
        
        return {
            "tyre_surface_temp": {k: round(v, 1) for k, v in self.surface_temp.items()},
            "tyre_carcass_temp": {k: round(v, 1) for k, v in self.carcass_temp.items()},
            "in_optimal_window": in_window,
        }
```

---

### 3.3 TYRE DEGRADATION (WEAR) MODEL

**Purpose:** Simulate tyre life degrading over time, making grip decrease and lap times increase — the core driver of pit stop strategy.

**Outputs:**
- `tyre_wear` (%) — 0% = new, 100% = destroyed
- `tyre_grip_level` (0.0-1.0) — available grip multiplier
- `tyre_cliff_warning` (boolean) — true when approaching sudden grip drop-off
- `estimated_laps_remaining` — until performance becomes unacceptable

**Inputs:**
- `speed`, `lateral_g`, `tyre_surface_temp`, `tyre_compound`, `laps_on_tyre`

```python
class TyreWearModel:
    def __init__(self, compound="medium"):
        self.compound = compound
        self.wear_pct = 0.0  # 0 = new, 100 = gone
        self.laps_on_tyre = 0
        self.wear_rate_multiplier = TYRE_COMPOUNDS[compound]["wear_rate"]
    
    def update(self, dt_s, speed_kmh, lateral_g, surface_temp, compound_data):
        """Called every tick."""
        
        # Base wear rate: ~1% per lap for medium (tune to lap length)
        # A lap is roughly 90 seconds, so per-second base:
        base_wear_per_second = 0.011  # ~1%/lap at 90s/lap for medium
        
        # === Wear factors ===
        
        # 1. Speed factor: faster = more wear (surface abrasion)
        speed_factor = (speed_kmh / 300.0) ** 1.5  # non-linear; 300 km/h = 1.0
        
        # 2. Lateral load factor: cornering wears tyres most
        lateral_factor = 1.0 + (abs(lateral_g) * 0.8)  # 4g cornering = 4.2x wear
        
        # 3. Temperature factor: over/under optimal temp = more wear
        optimal = compound_data["optimal_temp"]
        temp_delta = abs(surface_temp - optimal)
        if temp_delta < 10:
            temp_factor = 1.0  # in sweet spot
        else:
            temp_factor = 1.0 + (temp_delta - 10) * 0.03  # 20°C over = 1.3x wear
        
        # 4. Compound multiplier
        compound_factor = self.wear_rate_multiplier  # soft=1.4, med=1.0, hard=0.7
        
        # === Total wear this tick ===
        wear_this_tick = (base_wear_per_second * speed_factor * lateral_factor 
                         * temp_factor * compound_factor * dt_s)
        
        self.wear_pct += wear_this_tick
        self.wear_pct = clamp(self.wear_pct, 0, 100)
        
        # === Grip model (includes "cliff") ===
        # Grip is ~constant until 60% wear, then drops off rapidly
        if self.wear_pct < 60:
            grip = 1.0 - (self.wear_pct * 0.002)  # gentle 0-12% loss over first 60% wear
        elif self.wear_pct < 80:
            grip = 0.88 - ((self.wear_pct - 60) * 0.015)  # steeper drop: 88% → 58%
        else:
            grip = 0.58 - ((self.wear_pct - 80) * 0.025)  # cliff: 58% → 8%
        
        grip = clamp(grip, 0.05, 1.0)
        cliff_warning = self.wear_pct >= 55  # warn before cliff
        
        return {
            "tyre_wear_pct": round(self.wear_pct, 2),
            "tyre_grip_level": round(grip, 3),
            "tyre_cliff_warning": cliff_warning,
        }
    
    def on_new_lap(self):
        self.laps_on_tyre += 1
    
    def pit_stop(self, new_compound):
        """Reset on tyre change."""
        self.compound = new_compound
        self.wear_pct = 0.0
        self.laps_on_tyre = 0
        self.wear_rate_multiplier = TYRE_COMPOUNDS[new_compound]["wear_rate"]
```

---

### 3.4 ERS (ENERGY RECOVERY SYSTEM) MODEL

**Purpose:** Simulate battery charge/discharge — harvesting energy under braking, deploying it under acceleration. SOC management is a key strategy lever.

**Outputs:**
- `ers_soc` (%) — state of charge (4-100%)
- `ers_mode` — Harvest / Deploy / Neutral
- `ers_power` (kW) — current flow (positive = deploy, negative = harvest)
- `energy_harvested_this_lap` (MJ)
- `energy_deployed_this_lap` (MJ)

**Inputs:**
- `braking` (boolean), `brake_intensity` (g)
- `throttle_pct` (%), `speed` (km/h)
- `deploy_mode` — strategy setting (user/auto)

```python
class ERSModel:
    def __init__(self):
        self.soc = 50.0  # start at 50%
        self.energy_capacity_mj = 4.0  # 2026 energy store capacity
        self.max_deploy_kw = 350.0  # 2026 MGU-K max
        self.max_harvest_kw = 350.0  # harvest rate
        self.harvested_this_lap = 0.0  # MJ
        self.deployed_this_lap = 0.0  # MJ
        self.max_harvest_per_lap = 8.5  # MJ cap per 2026 regs
    
    def update(self, dt_s, braking, brake_intensity_g, throttle_pct, speed_kmh):
        """
        dt_s: time step in seconds
        brake_intensity_g: magnitude of braking deceleration
        """
        power_kw = 0.0
        mode = "neutral"
        
        # === HARVESTING (during braking) ===
        if braking and speed_kmh > 30:  # no harvest at very low speed
            # Harvest proportional to braking force × speed (kinetic energy)
            # More aggressive braking at higher speed = more energy captured
            harvest_fraction = clamp(brake_intensity_g / 5.0, 0, 1)  # 5g = full harvest
            speed_fraction = clamp(speed_kmh / 300.0, 0, 1)
            
            power_kw = -(self.max_harvest_kw * harvest_fraction * speed_fraction)
            mode = "harvest"
            
            # Check lap harvest limit
            energy_this_tick_mj = abs(power_kw) * dt_s / 1000.0
            if self.harvested_this_lap + energy_this_tick_mj > self.max_harvest_per_lap:
                energy_this_tick_mj = max(0, self.max_harvest_per_lap - self.harvested_this_lap)
                power_kw = -(energy_this_tick_mj * 1000.0 / dt_s) if dt_s > 0 else 0
            
            self.harvested_this_lap += energy_this_tick_mj
        
        # === DEPLOYING (during acceleration) ===
        elif throttle_pct > 20 and self.soc > 5:
            # Deploy proportional to throttle demand
            deploy_fraction = clamp((throttle_pct - 20) / 80.0, 0, 1)
            power_kw = self.max_deploy_kw * deploy_fraction
            mode = "deploy"
        
        # === UPDATE SOC ===
        # power_kw: negative = charging, positive = discharging
        energy_delta_mj = power_kw * dt_s / 1000.0  # kW × s = kJ, /1000 = MJ
        soc_delta = (energy_delta_mj / self.energy_capacity_mj) * 100.0
        
        self.soc -= soc_delta  # deploy reduces SOC, harvest increases
        self.soc = clamp(self.soc, 2.0, 100.0)  # never fully deplete
        
        if power_kw > 0:
            self.deployed_this_lap += energy_delta_mj
        
        return {
            "ers_soc": round(self.soc, 1),
            "ers_mode": mode,
            "ers_power_kw": round(power_kw, 1),
            "energy_harvested_this_lap_mj": round(self.harvested_this_lap, 3),
            "energy_deployed_this_lap_mj": round(self.deployed_this_lap, 3),
        }
    
    def on_new_lap(self):
        self.harvested_this_lap = 0.0
        self.deployed_this_lap = 0.0
```

---

### 3.5 BRAKE TEMPERATURE MODEL

**Purpose:** Simulate brake disc temperatures — overly hot brakes fade and can fail; cold brakes have poor bite. Strategy implications: brake cooling vs. aero performance tradeoff.

**Outputs (per corner):**
- `brake_disc_temp` (°C) — range 200-1200°C
- `brake_fade_warning` (boolean) — true above 1000°C
- `brake_wear_pct` (%) — accumulated pad wear

```python
class BrakeTemperatureModel:
    def __init__(self, ambient_temp=25.0):
        self.ambient = ambient_temp
        # Brakes start warm (from install lap)
        self.disc_temp = {"FL": 300, "FR": 300, "RL": 250, "RR": 250}
        self.pad_wear = {"FL": 0, "FR": 0, "RL": 0, "RR": 0}
    
    def update(self, dt_s, braking, brake_intensity_g, speed_kmh):
        speed_ms = speed_kmh / 3.6
        
        for corner in ["FL", "FR", "RL", "RR"]:
            # === HEAT INPUT (braking) ===
            heat_in = 0.0
            if braking:
                # Kinetic energy converted to heat: KE = 0.5 × m × v²
                # Distributed: fronts get 65%, rears get 35%
                brake_energy_rate = brake_intensity_g * speed_ms * 50.0  # °C/s scaling
                if corner in ["FL", "FR"]:
                    heat_in = brake_energy_rate * 0.65 / 2  # split between L/R
                else:
                    heat_in = brake_energy_rate * 0.35 / 2
            
            # === HEAT OUTPUT (cooling) ===
            # Airflow cooling
            airflow = (speed_ms / 80.0) * 20.0  # °C/s at 288 km/h
            
            # Radiation (Stefan-Boltzmann simplified — hot objects radiate more)
            temp_above_ambient = self.disc_temp[corner] - self.ambient
            radiation = temp_above_ambient * 0.08  # stronger at high temps
            
            total_cooling = airflow + radiation
            
            # === NET ===
            delta = (heat_in - total_cooling) * dt_s
            self.disc_temp[corner] += delta
            self.disc_temp[corner] = clamp(self.disc_temp[corner], self.ambient, 1200.0)
            
            # Pad wear accumulates with brake usage and temperature
            if braking:
                wear_rate = brake_intensity_g * 0.001  # %/s at 1g braking
                if self.disc_temp[corner] > 800:
                    wear_rate *= 1.5  # hot brakes wear pads faster
                self.pad_wear[corner] += wear_rate * dt_s
        
        fade_warning = any(t > 1000 for t in self.disc_temp.values())
        
        return {
            "brake_disc_temp": {k: round(v, 0) for k, v in self.disc_temp.items()},
            "brake_fade_warning": fade_warning,
            "brake_pad_wear_pct": {k: round(v, 2) for k, v in self.pad_wear.items()},
        }
```

---

### 3.6 ENGINE RPM & GEAR MODEL

**Purpose:** Simulate gear selection and engine RPM from speed. Gives the telemetry that "heartbeat" feel.

**Outputs:**
- `gear` (1-8)
- `rpm` (6000-15000)
- `engine_temp` (°C) — coolant temperature

```python
class EngineModel:
    def __init__(self, ambient_temp=25.0):
        self.coolant_temp = 80.0  # start warm
        self.ambient = ambient_temp
        self.rpm_idle = 6000
        self.rpm_max = 15000
    
    def update(self, dt_s, speed_kmh, throttle_pct):
        # === GEAR SELECTION ===
        # Simple speed-based gear lookup
        if speed_kmh < 80:
            gear = 1
        elif speed_kmh < 130:
            gear = 2
        elif speed_kmh < 180:
            gear = 3
        elif speed_kmh < 230:
            gear = 4
        elif speed_kmh < 270:
            gear = 5
        elif speed_kmh < 300:
            gear = 6
        elif speed_kmh < 330:
            gear = 7
        else:
            gear = 8
        
        # === RPM CALCULATION ===
        if gear == 0 or speed_kmh < 5:
            rpm = self.rpm_idle
        else:
            # RPM = speed × gear_ratio × final_drive × conversion
            # Simplified: map speed within gear range to RPM range
            gear_speeds = [0, 80, 130, 180, 230, 270, 300, 330, 370]
            low = gear_speeds[gear - 1]
            high = gear_speeds[gear]
            fraction = clamp((speed_kmh - low) / (high - low), 0, 1)
            rpm = self.rpm_idle + fraction * (self.rpm_max - self.rpm_idle)
        
        rpm = clamp(rpm, self.rpm_idle, self.rpm_max)
        
        # === COOLANT TEMPERATURE ===
        # Heat from engine load
        heat_in = (throttle_pct / 100.0) * 2.0 + (rpm / self.rpm_max) * 1.5  # °C/s
        # Cooling from radiator (proportional to speed)
        speed_ms = speed_kmh / 3.6
        cooling = (speed_ms / 80.0) * 3.0 + (self.coolant_temp - self.ambient) * 0.02
        
        self.coolant_temp += (heat_in - cooling) * dt_s
        self.coolant_temp = clamp(self.coolant_temp, self.ambient, 130.0)
        
        return {
            "gear": gear,
            "rpm": int(rpm),
            "engine_coolant_temp": round(self.coolant_temp, 1),
        }
```

---

### 3.7 TYRE PRESSURE MODEL

**Purpose:** Tyre pressure rises with temperature (ideal gas law). Over/under pressure affects grip and wear.

**Outputs (per corner):**
- `tyre_pressure` (psi)

```python
class TyrePressureModel:
    def __init__(self):
        # Starting pressures (set by team, cold)
        self.cold_pressure = {"FL": 21.0, "FR": 21.0, "RL": 19.5, "RR": 19.5}  # psi
        self.cold_temp = 25.0  # °C when pressures were set
    
    def update(self, tyre_surface_temps):
        """
        Ideal gas law: P1/T1 = P2/T2 (at constant volume)
        Pressure rises ~0.1 psi per 1°C above cold set temp.
        """
        pressures = {}
        for corner in ["FL", "FR", "RL", "RR"]:
            temp_delta = tyre_surface_temps[corner] - self.cold_temp
            # Approximately 0.1 psi per degree C
            pressures[corner] = round(self.cold_pressure[corner] + (temp_delta * 0.1), 1)
        
        return {"tyre_pressure_psi": pressures}
```

---

## EDGE CASES & ERROR HANDLING

### Phone Stationary (speed = 0)
- All models go to idle/cooling state
- Fuel: idle consumption (2 kg/h)
- Tyres: cool toward ambient
- Brakes: cool toward ambient
- ERS: neutral (no harvest, no deploy)
- Equivalent to: car stopped on grid, red flag, or pit stop

### GPS Signal Loss
- Fall back to accelerometer-only dead reckoning
- Speed estimated from integrating longitudinal acceleration
- Flag `gps_quality: "dead_reckoning"` in telemetry output
- Models continue running on estimated speed

### Sudden Speed Spikes (GPS glitch)
- Apply low-pass filter: `filtered_speed = 0.7 × prev_speed + 0.3 × new_speed`
- Reject speed jumps > 50 km/h between consecutive readings
- Log glitch for debugging

### Phone Orientation Changes
- Use rotation vector sensor to maintain consistent axis mapping
- Accelerometer axes must be transformed to car frame (longitudinal/lateral)
- Handle phone in pocket (different orientation than mounted on dashboard)
- Best approach: calibration step at start ("hold phone steady for 3 seconds")

---

## SIMULATION LOOP (putting it all together)

```python
import time

# Initialize models
fuel = FuelModel(starting_fuel_kg=100.0)
tyre_temp = TyreTemperatureModel(compound="medium", ambient_temp=weather.air_temp)
tyre_wear = TyreWearModel(compound="medium")
ers = ERSModel()
brakes = BrakeTemperatureModel(ambient_temp=weather.air_temp)
engine = EngineModel(ambient_temp=weather.air_temp)
pressure = TyrePressureModel()

TICK_RATE = 10  # Hz
dt_s = 1.0 / TICK_RATE

while race_active:
    tick_start = time.time()
    
    # === TIER 1: Read phone sensors ===
    raw = phone.read_sensors()  # {accel, gyro, gps, barometer}
    weather_data = weather_api.get_current()  # cached, refreshes every 5 min
    
    # === TIER 2: Derive basic channels ===
    speed_kmh = raw.gps_speed * 3.6 * SPEED_SCALE
    speed_kmh = clamp(speed_kmh, 0, 370)
    lateral_g = raw.accel_x * LATERAL_SCALE
    longitudinal_g = raw.accel_y * LONGITUDINAL_SCALE
    throttle_pct, brake_pct = compute_throttle_brake(longitudinal_g)
    braking = brake_pct > 0
    steering = compute_steering_angle(raw.gyro_z * YAW_SCALE, speed_kmh / 3.6)
    
    check_lap_crossing(raw.gps_position)
    check_sector_crossing(raw.gps_position)
    
    # === TIER 3: Run physics models ===
    dt_h = dt_s / 3600.0  # for fuel (kg/h units)
    
    fuel_data = fuel.update(dt_h, speed_kmh, throttle_pct, lateral_g,
                            weather_data.wind_speed, weather_data.wind_dir,
                            raw.heading, weather_data.raining, current_compound)
    
    tyre_temp_data = tyre_temp.update(dt_s, speed_kmh, lateral_g, braking,
                                      throttle_pct, weather_data.track_temp)
    
    tyre_wear_data = tyre_wear.update(dt_s, speed_kmh, lateral_g,
                                      tyre_temp_data["tyre_surface_temp"]["RL"],  # use rear as reference
                                      TYRE_COMPOUNDS[current_compound])
    
    ers_data = ers.update(dt_s, braking, abs(longitudinal_g), throttle_pct, speed_kmh)
    
    brake_data = brakes.update(dt_s, braking, abs(longitudinal_g), speed_kmh)
    
    engine_data = engine.update(dt_s, speed_kmh, throttle_pct)
    
    pressure_data = pressure.update(tyre_temp_data["tyre_surface_temp"])
    
    # === COMPOSE TELEMETRY PACKET ===
    telemetry = {
        "timestamp": time.time(),
        "lap": current_lap,
        "speed_kmh": round(speed_kmh, 1),
        "throttle_pct": round(throttle_pct, 1),
        "brake_pct": round(brake_pct, 1),
        "steering_angle": round(steering, 1),
        "lateral_g": round(lateral_g, 2),
        "longitudinal_g": round(longitudinal_g, 2),
        "gear": engine_data["gear"],
        "rpm": engine_data["rpm"],
        **fuel_data,
        **tyre_temp_data,
        **tyre_wear_data,
        **ers_data,
        **brake_data,
        **pressure_data,
        "weather": weather_data.__dict__,
    }
    
    # === OUTPUT ===
    redis.set("telemetry:latest", json.dumps(telemetry))
    timescaledb.insert(telemetry)
    
    # Maintain tick rate
    elapsed = time.time() - tick_start
    sleep_time = dt_s - elapsed
    if sleep_time > 0:
        time.sleep(sleep_time)
```

---

## CALIBRATION NOTES

| Parameter | How to tune | Default |
|-----------|-------------|---------|
| `SPEED_SCALE` | Adjust so walking feels like pit lane, jogging feels like a straight | 20.0 |
| `LATERAL_SCALE` | Walk in circles, check that lateral_g reaches 3-4g | 15.0 |
| `LONGITUDINAL_SCALE` | Sprint then stop, verify braking reaches 4-5g | 12.0 |
| `base_wear_per_second` | Tune so medium tyres last ~25 "laps" before cliff | 0.011 |
| `fuel base/drag/throttle` | Tune so 100 kg lasts a full "race" (~57 laps) | See model |
| Brake cooling rates | Verify temps stabilize ~400-600°C during normal driving | See model |

---

## WHAT THE GEMMA AGENT SEES

Every second, the agent can query Redis for a JSON blob like:

```json
{
  "lap": 14,
  "speed_kmh": 267.3,
  "fuel_remaining": 62.4,
  "fuel_laps_remaining": 28,
  "tyre_wear_pct": 41.2,
  "tyre_grip_level": 0.918,
  "tyre_cliff_warning": false,
  "tyre_surface_temp": {"FL": 98.2, "FR": 101.4, "RL": 95.7, "RR": 97.1},
  "ers_soc": 67.3,
  "brake_disc_temp": {"FL": 612, "FR": 598, "RL": 445, "RR": 430},
  "weather": {"rain": false, "wind_speed": 12, "track_temp": 42}
}
```

From this, the agent reasons about:
- "Should we pit this lap or next?"
- "Tyres are heating unevenly — is there a setup issue?"
- "Battery is low — should we harvest more on braking zones?"

---

*This document is the implementation guide. Each model can be implemented as a Python class and composed in the main simulation loop.*
