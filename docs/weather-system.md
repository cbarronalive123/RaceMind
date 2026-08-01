# Weather System

## Overview

Weather affects every simulation model — fuel consumption, tyre degradation, tyre temperature, grip levels, and strategy decisions. We handle weather in two modes:

| Mode | When | Source | Purpose |
|------|------|--------|---------|
| **Real Weather (API)** | Preliminary / Test Lap | OpenWeatherMap API | Snapshot of actual conditions at the track location |
| **Weather Simulator** | Live Race | Physics model with random events | Evolving conditions that create strategy decisions during the race |

**Why two modes?**
- During the **preliminary test lap**, we want real weather so the pre-race report is grounded in actual conditions.
- During the **live race**, we can't guarantee weather will change (it might be sunny all day). The simulator injects realistic weather evolution — gradual temperature shifts, sudden rain, wind changes — that force real-time strategy decisions. This is what makes the demo interesting.

---

## Mode 1: Real Weather API (Preliminary)

### API Choice: OpenWeatherMap

- **Free tier:** 1,000 calls/day (more than enough)
- **Endpoint:** `api.openweathermap.org/data/2.5/weather`
- **Data available:** temp, humidity, wind speed/direction, rain, pressure, clouds
- **Response time:** ~200ms

### When It's Called

1. **Once at race config** — snapshot stored as initial conditions
2. **Once at test lap start** — refresh to current conditions
3. **Optionally during test lap** — if test lap takes > 5 minutes

### API Request

```python
import requests

def fetch_weather(lat, lon, api_key):
    """Fetch current weather for the track location."""
    url = "https://api.openweathermap.org/data/2.5/weather"
    params = {
        "lat": lat,
        "lon": lon,
        "appid": api_key,
        "units": "metric"
    }
    response = requests.get(url, params=params)
    data = response.json()
    
    return {
        "air_temp_c": data["main"]["temp"],
        "humidity_pct": data["main"]["humidity"],
        "atmospheric_pressure_mbar": data["main"]["pressure"],
        "wind_speed_kmh": data["wind"]["speed"] * 3.6,  # m/s → km/h
        "wind_direction_deg": data["wind"].get("deg", 0),
        "rainfall_mmh": data.get("rain", {}).get("1h", 0.0),
        "clouds_pct": data["clouds"]["all"],
        "description": data["weather"][0]["description"],
        "track_temp_c": data["main"]["temp"] + 15,  # estimate: asphalt ~15°C hotter
        "track_wetness": classify_wetness(data),
    }

def classify_wetness(data):
    """Derive track state from rain data."""
    rain_1h = data.get("rain", {}).get("1h", 0.0)
    if rain_1h == 0:
        return "dry"
    elif rain_1h < 2.0:
        return "damp"
    else:
        return "wet"
```

### Data Written (Preliminary)

Stored in `race_weather` table as a single row (the "starting conditions"):

```sql
INSERT INTO race_weather (race_id, ts, air_temp_c, track_temp_c, humidity_pct,
    wind_speed_kmh, wind_direction_deg, rainfall_mmh, 
    atmospheric_pressure_mbar, track_wetness)
VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9);
```

Also pushed to Redis `race:{id}:weather` hash for simulation models to read.

### What the Pre-Race Report Uses

Gemma receives the weather snapshot and factors it into strategy:
- High track temp → softer compounds degrade faster
- Rain → recommend inters, adjust pit strategy
- Wind → affects fuel consumption (headwind sections burn more)
- Humidity → marginal effect on engine intake density

---

## Mode 2: Weather Simulator (Live Race)

### Purpose

During the live race, weather **evolves** to create strategic scenarios. The simulator produces gradual shifts with occasional dramatic events (rain, sudden wind) that force the Gemma agent to adapt its strategy in real-time.

### Design Principles

1. **Starts from real conditions** — seeds with the preliminary API snapshot
2. **Gradual drift** — temperature, wind shift slowly (realistic)
3. **Random events** — rain can start/stop, wind can gust (drama for the demo)
4. **Configurable intensity** — can tune how "eventful" the weather is
5. **Deterministic seed option** — for reproducible demos, can seed the RNG

### Weather Simulator Model

```python
import random
import math

class WeatherSimulator:
    def __init__(self, initial_weather, event_probability=0.15, seed=None):
        """
        initial_weather: dict from API (Mode 1 output)
        event_probability: chance per lap of a weather event (0.0-1.0)
        seed: optional RNG seed for reproducibility
        """
        if seed is not None:
            random.seed(seed)
        
        self.event_probability = event_probability
        
        # Current state (starts from real weather)
        self.air_temp = initial_weather["air_temp_c"]
        self.track_temp = initial_weather["track_temp_c"]
        self.humidity = initial_weather["humidity_pct"]
        self.wind_speed = initial_weather["wind_speed_kmh"]
        self.wind_direction = initial_weather["wind_direction_deg"]
        self.rainfall = initial_weather["rainfall_mmh"]
        self.pressure = initial_weather["atmospheric_pressure_mbar"]
        self.track_wetness = initial_weather["track_wetness"]
        
        # Internal state for event tracking
        self.rain_active = self.rainfall > 0
        self.rain_start_lap = None
        self.time_of_day_offset = 0  # simulated time progression
        self.events_log = []
    
    def tick(self, dt_s):
        """
        Called every simulation tick (e.g., every second).
        Applies gradual drift to temperature, wind.
        """
        self.time_of_day_offset += dt_s
        
        # === Gradual temperature drift ===
        # Simulate day warming/cooling: ±0.5°C per 10 minutes
        temp_drift = random.gauss(0, 0.001) * dt_s  # very slow
        self.air_temp += temp_drift
        self.air_temp = clamp(self.air_temp, -5, 50)
        
        # Track temp follows air with offset + solar gain
        self.track_temp = self.air_temp + 12 + random.gauss(0, 0.5)
        self.track_temp = clamp(self.track_temp, self.air_temp, self.air_temp + 25)
        
        # === Gradual wind drift ===
        wind_speed_drift = random.gauss(0, 0.01) * dt_s
        wind_dir_drift = random.gauss(0, 0.05) * dt_s
        self.wind_speed += wind_speed_drift
        self.wind_speed = clamp(self.wind_speed, 0, 80)
        self.wind_direction = (self.wind_direction + wind_dir_drift) % 360
        
        # === Rain evolution ===
        if self.rain_active:
            # Rain intensity varies
            self.rainfall += random.gauss(0, 0.1) * dt_s
            self.rainfall = clamp(self.rainfall, 0.1, 30.0)
            
            # Track wetness increases
            if self.rainfall > 5.0:
                self.track_wetness = "wet"
            elif self.rainfall > 0.5:
                self.track_wetness = "damp"
        else:
            self.rainfall = 0.0
            # Track dries slowly after rain stops
            # (handled in on_lap for simplicity)
        
        # === Humidity follows rain ===
        if self.rain_active:
            self.humidity = clamp(self.humidity + 0.01 * dt_s, 0, 100)
        else:
            self.humidity += random.gauss(0, 0.005) * dt_s
            self.humidity = clamp(self.humidity, 20, 100)
    
    def on_new_lap(self, lap_number, total_laps):
        """
        Called once per lap. Checks for weather events.
        Returns: event dict or None
        """
        event = None
        
        # === Random event check ===
        roll = random.random()
        
        if roll < self.event_probability:
            event = self._generate_event(lap_number, total_laps)
        
        # === Track drying (if rain stopped) ===
        if not self.rain_active and self.track_wetness != "dry":
            # Takes ~5-8 laps to dry from wet → damp → dry
            dry_roll = random.random()
            if dry_roll < 0.15:  # 15% chance per lap to improve
                if self.track_wetness == "wet":
                    self.track_wetness = "damp"
                    event = {"type": "track_drying", "message": "Track is drying — now damp"}
                elif self.track_wetness == "damp":
                    self.track_wetness = "dry"
                    event = {"type": "track_dry", "message": "Track is now dry"}
        
        if event:
            self.events_log.append({"lap": lap_number, **event})
        
        return event
    
    def _generate_event(self, lap_number, total_laps):
        """Generate a random weather event."""
        
        # Don't start rain in first 3 or last 3 laps (boring/unfair)
        can_rain = 3 < lap_number < (total_laps - 3)
        
        events = []
        
        # Rain start (if not already raining and allowed)
        if not self.rain_active and can_rain:
            events.append(("rain_start", 0.4))
        
        # Rain stop (if currently raining, more likely after 5+ laps of rain)
        if self.rain_active:
            laps_raining = lap_number - (self.rain_start_lap or lap_number)
            stop_chance = min(0.6, 0.1 * laps_raining)
            events.append(("rain_stop", stop_chance))
        
        # Wind gust
        events.append(("wind_gust", 0.3))
        
        # Temperature spike (cloud cover change)
        events.append(("temp_shift", 0.3))
        
        if not events:
            return None
        
        # Weighted random choice
        total_weight = sum(w for _, w in events)
        r = random.random() * total_weight
        cumulative = 0
        chosen = events[0][0]
        for event_type, weight in events:
            cumulative += weight
            if r <= cumulative:
                chosen = event_type
                break
        
        return self._apply_event(chosen, lap_number)
    
    def _apply_event(self, event_type, lap_number):
        """Apply an event and return description."""
        
        if event_type == "rain_start":
            self.rain_active = True
            self.rain_start_lap = lap_number
            self.rainfall = random.uniform(1.0, 8.0)  # mm/h
            intensity = "light" if self.rainfall < 3 else "heavy"
            self.track_wetness = "damp"
            return {
                "type": "rain_start",
                "intensity": intensity,
                "rainfall_mmh": round(self.rainfall, 1),
                "message": f"Rain starting — {intensity} ({self.rainfall:.1f} mm/h)",
                "strategy_impact": "Consider pit for intermediates/wets"
            }
        
        elif event_type == "rain_stop":
            self.rain_active = False
            self.rainfall = 0.0
            return {
                "type": "rain_stop",
                "message": "Rain has stopped",
                "strategy_impact": "Track will dry in 5-8 laps — consider staying out or switching to slicks"
            }
        
        elif event_type == "wind_gust":
            old_speed = self.wind_speed
            self.wind_speed = clamp(self.wind_speed + random.uniform(10, 30), 0, 80)
            self.wind_direction = (self.wind_direction + random.uniform(-45, 45)) % 360
            return {
                "type": "wind_gust",
                "old_speed": round(old_speed, 1),
                "new_speed": round(self.wind_speed, 1),
                "direction": round(self.wind_direction, 0),
                "message": f"Wind gust — now {self.wind_speed:.0f} km/h",
                "strategy_impact": "Increased fuel consumption on exposed straights"
            }
        
        elif event_type == "temp_shift":
            shift = random.uniform(-3, 5)  # can cool or warm
            self.air_temp += shift
            self.track_temp = self.air_temp + 12 + random.uniform(0, 3)
            direction = "rising" if shift > 0 else "dropping"
            return {
                "type": "temp_shift",
                "shift_c": round(shift, 1),
                "new_air_temp": round(self.air_temp, 1),
                "new_track_temp": round(self.track_temp, 1),
                "message": f"Temperature {direction} — track now {self.track_temp:.0f}°C",
                "strategy_impact": "Affects tyre operating window and degradation rate"
            }
        
        return None
    
    def get_current(self):
        """Get current weather state for simulation models."""
        return {
            "air_temp_c": round(self.air_temp, 1),
            "track_temp_c": round(self.track_temp, 1),
            "humidity_pct": round(self.humidity, 1),
            "wind_speed_kmh": round(self.wind_speed, 1),
            "wind_direction_deg": round(self.wind_direction, 0),
            "rainfall_mmh": round(self.rainfall, 1),
            "atmospheric_pressure_mbar": round(self.pressure, 1),
            "track_wetness": self.track_wetness,
            "rain_active": self.rain_active,
        }
```

---

## Configuration: Event Probability

The `event_probability` parameter controls how dramatic the race weather is:

| Setting | Value | Effect | Good For |
|---------|-------|--------|----------|
| Calm | 0.05 | ~1 event per 20 laps | Realistic, boring demo |
| Normal | 0.15 | ~1 event per 7 laps | Balanced — recommended for hackathon |
| Dramatic | 0.30 | ~1 event per 3 laps | Lots of action, tests agent adaptability |
| Chaos | 0.50 | Event almost every other lap | Stress-test, not realistic |

**For the hackathon demo:** Use `0.20-0.30`. Judges want to see the agent react to changing conditions. A race with no weather events is a missed opportunity.

---

## How Weather Feeds Into Simulation Models

| Weather Channel | Affects | How |
|-----------------|---------|-----|
| `air_temp_c` | Engine cooling, intake density | Higher temp = less dense air = slightly less power |
| `track_temp_c` | Tyre temperature model, tyre degradation | Hot track = tyres overheat faster, wear increases |
| `humidity_pct` | Minor: air density | High humidity = slightly less dense air |
| `wind_speed_kmh` | Fuel consumption model | Headwind = more drag = more fuel burn |
| `wind_direction_deg` | Fuel model (relative to car heading) | Cross-section of track with headwind burns more |
| `rainfall_mmh` | Fuel model (rain factor), grip level | Rain = wheelspin = +15% fuel, reduced grip |
| `track_wetness` | Tyre compound effectiveness, grip | Wet = slick tyres useless, inters needed |
| `atmospheric_pressure_mbar` | Air density (engine power) | Lower pressure = less power (altitude tracks) |

---

## Weather Events → Gemma Agent Decisions

When a weather event fires, it's immediately:
1. Pushed to Redis `race:{id}:weather` (models read new values next tick)
2. Added to `race:{id}:alerts` pub/sub channel
3. Included in next Gemma invocation context
4. Displayed on website weather banner

**Example agent reasoning when rain starts:**

```
Event: Rain starting — heavy (6.2 mm/h)
Current state: Lap 18/57, on Medium tyres, wear 35%

Gemma thinks:
- Track is going damp → wet in 1-2 laps
- Medium tyres will lose grip rapidly on wet surface
- We were planning to pit on lap 25 anyway
- Option A: Pit NOW for intermediates (7 laps early, lose track position)
- Option B: Stay out 1-2 more laps hoping rain is brief (risky)
- Rain data says 6.2 mm/h = heavy = unlikely to stop quickly

Decision: "BOX BOX BOX. Pit this lap for intermediate tyres. 
          Rain is heavy — track will be wet within 2 laps.
          Early stop is better than losing 3+ seconds per lap on slicks."
```

---

## Integration into Simulation Loop

```python
# At race start
weather_api_data = fetch_weather(track.center_lat, track.center_lon, API_KEY)
weather_sim = WeatherSimulator(
    initial_weather=weather_api_data,
    event_probability=0.25,  # dramatic for demo
    seed=None  # random each time (or set for reproducible demo)
)

# Every tick (10 Hz)
weather_sim.tick(dt_s=0.1)
current_weather = weather_sim.get_current()

# Pass to all models
fuel_model.update(..., wind_speed=current_weather["wind_speed_kmh"], 
                  raining=current_weather["rain_active"], ...)
tyre_temp_model.update(..., track_temp=current_weather["track_temp_c"], ...)
tyre_wear_model.update(..., track_temp=current_weather["track_temp_c"], ...)

# Push to Redis (every second, not every tick)
redis.hset(f"race:{race_id}:weather", mapping=current_weather)

# Every lap crossing
event = weather_sim.on_new_lap(current_lap, total_laps)
if event:
    # Alert the system
    redis.publish(f"race:{race_id}:alerts", json.dumps(event))
    # Store for history
    db.insert_weather_event(race_id, current_lap, event)
    # Trigger Gemma re-evaluation
    agent.evaluate_weather_event(event, current_state)
```

---

## Database Storage

### Preliminary Weather (from API)

```sql
-- Single snapshot stored at race setup / test lap start
INSERT INTO race_weather (race_id, ts, air_temp_c, track_temp_c, humidity_pct,
    wind_speed_kmh, wind_direction_deg, rainfall_mmh, 
    atmospheric_pressure_mbar, track_wetness)
VALUES (...);
```

### Live Weather (from simulator, periodic snapshots)

```sql
-- Written every lap (or every 30 seconds) during live race
-- Same table, new rows — gives weather history over the race
INSERT INTO race_weather (race_id, ts, air_temp_c, track_temp_c, ...)
VALUES (...);
```

### Weather Events Log

```sql
CREATE TABLE weather_events (
    id          SERIAL PRIMARY KEY,
    race_id     UUID REFERENCES races(id),
    lap         INT NOT NULL,
    ts          TIMESTAMPTZ DEFAULT now(),
    event_type  VARCHAR(20) NOT NULL,  -- rain_start, rain_stop, wind_gust, temp_shift, track_drying, track_dry
    message     TEXT NOT NULL,
    strategy_impact TEXT,
    data        JSONB  -- full event details
);
```

---

## Summary

| Aspect | Preliminary (Test Lap) | Live Race |
|--------|----------------------|-----------|
| **Source** | OpenWeatherMap API | Weather Simulator (seeded from API) |
| **Updates** | Once (snapshot) | Every tick (gradual) + events per lap |
| **Real?** | Yes — actual weather at location | No — simulated evolution for drama |
| **Why?** | Accurate pre-race strategy | Forces real-time adaptation decisions |
| **Events** | None | Rain, wind gusts, temp shifts, track drying |
| **Stored in** | `race_weather` (1 row) | `race_weather` (many rows) + `weather_events` |
| **Affects models?** | Yes — initial calibration | Yes — continuous model input |
| **Agent uses?** | Pre-race report generation | Live strategy adaptation |

---

*Weather is the wildcard that makes this demo exciting. Without it, the agent just says "pit on lap 25 as planned." With it, the agent has to think on its feet.*
