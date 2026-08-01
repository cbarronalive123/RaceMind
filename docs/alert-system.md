# Alert System — Multi-Tiered Architecture

## Core Concept

RaceMind eliminates radio comms delay by synchronizing alerts between the **Racer HUD** (phone/edge device) and the **Engineer Control Panel** (website) in real-time. Alerts are classified into three tiers with different routing:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ALERT TIERS                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TIER 2a: Preventative Rules        ──── INSTANT ────► Racer HUD   │
│  (configurable intervals/thresholds)                                │
│                                                                     │
│  TIER 2b: Signal Detection           ──── INSTANT ────► Racer HUD  │
│  (statistical pattern matching)                                     │
│                                                                     │
│  TIER 2c: Anomaly Detection          ──► Engineer ──► Racer HUD    │
│  (TimesFM + Gemma interpretation)         Panel         (approved)  │
│                                          (approve/                  │
│                                           reject)                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Key difference:** 2a and 2b go directly to the driver (zero latency). 2c requires engineer validation first (seconds of latency, but prevents false positives from confusing the driver mid-race).

---

## TIER 2a: Predetermined Preventative Maintenance Rules

### What It Is

Simple configurable rules set by the engineering team before or during the race. These are interval-based or threshold-based checks that fire automatically.

### Configuration Interface (Engineer Control Panel)

Engineers create rules via a form on the website:

```
┌─────────────────────────────────────────────────────┐
│  ADD PREVENTATIVE RULE                              │
│                                                     │
│  Name: [Brake temp check        ]                   │
│                                                     │
│  Type: ○ Interval  ● Threshold  ○ Combined          │
│                                                     │
│  INTERVAL OPTIONS:                                  │
│  Trigger every: [3] laps                            │
│  Message: "Check brake temps"                       │
│                                                     │
│  THRESHOLD OPTIONS:                                 │
│  Channel: [brake_temp_fl         ▼]                 │
│  Condition: [>] [900] °C                            │
│  Message: "Front-left brake hot — ease braking S1"  │
│                                                     │
│  COMBINED:                                          │
│  Channel: [fuel_remaining        ▼]                 │
│  Condition: [<] [fuel_per_lap × 5]                  │
│  AND every: [1] laps                                │
│  Message: "Fuel critical — lift and coast"          │
│                                                     │
│  Priority: ○ Low  ● Medium  ○ High                  │
│  Audio: ☑ Play TTS on Racer HUD                     │
│                                                     │
│  [Save Rule]  [Test Rule]                           │
└─────────────────────────────────────────────────────┘
```

### Rule Engine (Backend)

```python
class PreventativeRule:
    def __init__(self, config):
        self.name = config["name"]
        self.rule_type = config["type"]  # interval | threshold | combined
        self.channel = config.get("channel")
        self.condition = config.get("condition")  # ">", "<", ">=", "<=", "=="
        self.value = config.get("value")
        self.interval_laps = config.get("interval_laps")
        self.message = config["message"]
        self.priority = config.get("priority", "medium")
        self.audio = config.get("audio", True)
        self.last_fired_lap = 0
        self.cooldown_laps = config.get("cooldown_laps", 1)  # don't spam
    
    def evaluate(self, telemetry, current_lap):
        """Returns alert dict or None."""
        
        # Cooldown check
        if current_lap - self.last_fired_lap < self.cooldown_laps:
            return None
        
        fired = False
        
        if self.rule_type == "interval":
            fired = (current_lap % self.interval_laps == 0) and current_lap > 0
        
        elif self.rule_type == "threshold":
            channel_value = telemetry.get(self.channel)
            if channel_value is not None:
                fired = self._check_condition(channel_value)
        
        elif self.rule_type == "combined":
            interval_met = (current_lap % self.interval_laps == 0)
            channel_value = telemetry.get(self.channel)
            threshold_met = self._check_condition(channel_value) if channel_value else False
            fired = interval_met and threshold_met
        
        if fired:
            self.last_fired_lap = current_lap
            return {
                "tier": "2a",
                "name": self.name,
                "message": self.message,
                "priority": self.priority,
                "audio": self.audio,
                "lap": current_lap,
                "routing": "instant_to_hud",  # bypasses engineer
            }
        
        return None
    
    def _check_condition(self, value):
        ops = {">": lambda a, b: a > b, "<": lambda a, b: a < b,
               ">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b}
        return ops[self.condition](value, self.value)
```

### Example Rules (Pre-configured defaults)

| Rule Name | Type | Condition | Message | Priority |
|-----------|------|-----------|---------|----------|
| Brake check | Interval | Every 5 laps | "Check brake balance" | Low |
| Tyre cliff approaching | Threshold | `tyre_wear_pct > 55` | "TYRE CLIFF — prepare to pit" | High |
| Fuel critical | Threshold | `fuel_remaining < fuel_per_lap × 3` | "FUEL CRITICAL — lift and coast" | High |
| ERS depleted | Threshold | `ers_soc < 10` | "Battery empty — harvest mode" | Medium |
| Brake fade | Threshold | `brake_temp_fl > 1000 OR brake_temp_fr > 1000` | "BRAKE FADE — reduce braking" | High |
| Tyre pressure low | Threshold | `tyre_pressure_fl < 18` | "FL pressure low — possible puncture" | High |
| Coolant overheat | Threshold | `engine_coolant_temp > 120` | "Engine hot — reduce pace" | High |
| Stint report | Interval | Every 3 laps | "Stint update: wear X%, fuel Y kg" | Low |
| Planned lift-coast | Combined | `fuel_margin < 3kg` AND `lap % 2 == 0` | "Lift and coast T1 + T4 — protect fuel" | Medium |
| Safety car deploy | Threshold | `track_status == safety_car` | "SC DEPLOYED — box immediately" | Critical |
| Brake fade warn | Threshold | `brake_temp_fl > 950 AND lap < total_laps - 5` | "Brake fade imminent — plan brake saving" | High |

---

## TIER 2b: Predetermined Signal Detection

### What It Is

Statistical pattern matching that identifies **known defect signatures** in the telemetry stream. These are more sophisticated than simple thresholds — they look at relationships between channels, trends over time, and normalized patterns.

### How It Differs from 2a

| 2a (Rules) | 2b (Signal Detection) |
|------------|----------------------|
| Single channel, single threshold | Multi-channel correlation |
| Point-in-time check | Trend over time (rolling window) |
| "Is X > 900?" | "Is X drifting up relative to Y?" |
| Simple | Statistical |

### Signal Patterns (Configurable by Engineers)

Each pattern is a Python class that evaluates a rolling window of telemetry:

```python
class SignalPattern:
    def __init__(self, config):
        self.name = config["name"]
        self.description = config["description"]
        self.window_laps = config.get("window_laps", 5)
        self.message = config["message"]
        self.priority = config.get("priority", "high")
        self.audio = config.get("audio", True)
        self.cooldown_laps = config.get("cooldown_laps", 3)
        self.last_fired_lap = 0
    
    def evaluate(self, lap_history, current_lap):
        """
        lap_history: list of last N lap summaries with all channel averages
        Returns: alert dict or None
        """
        raise NotImplementedError  # subclass per pattern


class OilTempDrift(SignalPattern):
    """
    PATTERN: Engine coolant temperature drifting up normalized against speed.
    If temp is rising while speed is constant or decreasing = cooling issue.
    Signature of: radiator blockage, coolant leak, water pump degradation.
    """
    def evaluate(self, lap_history, current_lap):
        if len(lap_history) < self.window_laps:
            return None
        if current_lap - self.last_fired_lap < self.cooldown_laps:
            return None
        
        recent = lap_history[-self.window_laps:]
        
        # Compute normalized temp (temp / speed ratio)
        # If this ratio is increasing, temp is rising independent of speed
        ratios = [lap["avg_coolant_temp"] / max(lap["avg_speed"], 50) for lap in recent]
        
        # Linear regression slope over window
        slope = compute_slope(ratios)
        
        if slope > 0.02:  # threshold: ratio increasing
            self.last_fired_lap = current_lap
            return {
                "tier": "2b",
                "name": self.name,
                "message": "STABILIZE — Coolant temp rising independent of speed",
                "priority": "high",
                "audio": True,
                "routing": "instant_to_hud",
                "data": {"slope": slope, "window": self.window_laps},
            }
        return None


class TyreAsymmetry(SignalPattern):
    """
    PATTERN: Temperature difference between left/right tyres growing.
    Signature of: setup imbalance, puncture developing, uneven wear.
    """
    def evaluate(self, lap_history, current_lap):
        if len(lap_history) < 3:
            return None
        if current_lap - self.last_fired_lap < self.cooldown_laps:
            return None
        
        recent = lap_history[-3:]
        
        # Front asymmetry
        front_deltas = [abs(lap["tyre_temp_fl"] - lap["tyre_temp_fr"]) for lap in recent]
        # Rear asymmetry
        rear_deltas = [abs(lap["tyre_temp_rl"] - lap["tyre_temp_rr"]) for lap in recent]
        
        # If asymmetry is growing AND exceeds threshold
        front_growing = front_deltas[-1] > front_deltas[0] + 5  # 5°C growth
        rear_growing = rear_deltas[-1] > rear_deltas[0] + 5
        
        if front_growing and front_deltas[-1] > 15:
            self.last_fired_lap = current_lap
            return {
                "tier": "2b",
                "name": "Front Tyre Asymmetry",
                "message": f"TYRE ALERT — Front L/R delta {front_deltas[-1]:.0f}°C and growing",
                "priority": "high",
                "audio": True,
                "routing": "instant_to_hud",
            }
        if rear_growing and rear_deltas[-1] > 15:
            self.last_fired_lap = current_lap
            return {
                "tier": "2b",
                "name": "Rear Tyre Asymmetry",
                "message": f"TYRE ALERT — Rear L/R delta {rear_deltas[-1]:.0f}°C and growing",
                "priority": "high",
                "audio": True,
                "routing": "instant_to_hud",
            }
        return None


class ERSHarvestDecline(SignalPattern):
    """
    PATTERN: Energy harvested per lap declining over consecutive laps.
    Signature of: braking pattern change, MGU-K degradation, or driving style shift.
    """
    def evaluate(self, lap_history, current_lap):
        if len(lap_history) < 4:
            return None
        if current_lap - self.last_fired_lap < self.cooldown_laps:
            return None
        
        recent = lap_history[-4:]
        harvests = [lap["ers_harvested_mj"] for lap in recent]
        
        # Declining 3+ consecutive laps AND below target
        declining = all(harvests[i] > harvests[i+1] for i in range(len(harvests)-1))
        below_target = harvests[-1] < 5.0  # MJ — below efficient threshold
        
        if declining and below_target:
            self.last_fired_lap = current_lap
            return {
                "tier": "2b",
                "name": "ERS Harvest Declining",
                "message": "ERS harvest dropping — brake harder into zones or check MGU-K",
                "priority": "medium",
                "audio": True,
                "routing": "instant_to_hud",
            }
        return None


class FuelConsumptionSpike(SignalPattern):
    """
    PATTERN: Fuel consumption per lap exceeding target by >10% for 3+ laps.
    Signature of: driving too aggressively, headwind sector, or fuel leak.
    """
    def evaluate(self, lap_history, current_lap):
        if len(lap_history) < 3:
            return None
        if current_lap - self.last_fired_lap < self.cooldown_laps:
            return None
        
        recent = lap_history[-3:]
        target = self.config.get("fuel_target_per_lap", 1.72)
        
        over_target = all(lap["fuel_used"] > target * 1.10 for lap in recent)
        
        if over_target:
            avg_over = sum(lap["fuel_used"] for lap in recent) / 3
            pct_over = ((avg_over - target) / target) * 100
            self.last_fired_lap = current_lap
            return {
                "tier": "2b",
                "name": "Fuel Overconsumption",
                "message": f"FUEL — {pct_over:.0f}% over target for 3 laps. Lift and coast.",
                "priority": "high",
                "audio": True,
                "routing": "instant_to_hud",
            }
        return None


class WetCrossoverPredictor(SignalPattern):
    """
    PATTERN: Track wetness trend + forecast rain → predict when inters overtake slicks.
    Looks ahead 5-10 laps instead of reacting on the spot.
    """
    def evaluate(self, lap_history, current_lap):
        if len(lap_history) < 5:
            return None
        if current_lap - self.last_fired_lap < self.cooldown_laps:
            return None

        # Rolling track wetness trend from weather simulator state
        wetness_trend = [lap["track_wetness_score"] for lap in lap_history[-5:]]
        wetness_increasing = wetness_trend[-1] > wetness_trend[0] + 0.15
        
        # Rain probability from simulator forecast channel
        rain_prob_next_3 = self.config.get("forecast_rain_prob_next_3", 0.0)

        # Rough grip model: wetness score 0-1 → slick grip falls as wetness rises
        slick_grip = 114 - (wetness_trend[-1] * 100)
        inters_grip = 95
        crossover_lap = current_lap + max(1, int((wetness_increasing) * 3))

        if wetness_increasing and rain_prob_next_3 > 0.60 and slick_grip > inters_grip:
            self.last_fired_lap = current_lap
            return {
                "tier": "2b",
                "name": "Wet Crossover Predicted",
                "message": f"WET CROSSOVER — Inters faster on lap {crossover_lap}",
                "priority": "high",
                "audio": True,
                "routing": "instant_to_hud",
                "data": {"crossover_lap": crossover_lap, "wetness_score": wetness_trend[-1]},
            }
        return None
```

### Configurable by Engineers

Engineers can enable/disable patterns, adjust thresholds, and set window sizes from the control panel:

```
┌──────────────────────────────────────────────────────┐
│  SIGNAL DETECTION PATTERNS                           │
│                                                      │
│  ☑ Oil Temp Drift          window: [5] laps  slope: [0.02] │
│  ☑ Tyre Asymmetry          threshold: [15]°C delta        │
│  ☑ ERS Harvest Decline     min harvest: [5.0] MJ          │
│  ☑ Fuel Overconsumption    target: [1.72] kg/lap          │
│  ☐ Brake Wear Accelerating  (disabled)                    │
│  ☐ Custom Pattern...                                      │
│                                                      │
│  [Save Configuration]                                │
└──────────────────────────────────────────────────────┘
```

---

## TIER 2c: Anomaly Detection (TimesFM + Gemma + Engineer-in-the-Loop)

### What It Is

Fully autonomous anomaly detection for conditions that **haven't been pre-programmed**. The system decomposes the telemetry time-series, detects something "weird," Gemma interprets what it might mean, and surfaces it to the engineer for validation before sending to the driver.

### Why Engineer Approval?

Anomalies can be false positives (sensor noise, one-off GPS glitch, unusual but harmless driving). Sending false alerts to a driver at 300 km/h is dangerous and erodes trust. Engineers validate that the anomaly is real and the recommended action makes sense.

### Pipeline

```
Raw Telemetry (60+ channels, 10 Hz)
        │
        ▼
┌─────────────────────────────────────┐
│  1. SIGNAL DECOMPOSITION (TimesFM)  │
│                                     │
│  Google's TimesFM foundation model  │
│  for time-series forecasting.       │
│                                     │
│  Input: rolling window of telemetry │
│  Output: predicted next N values    │
│         + confidence intervals      │
│                                     │
│  If actual diverges from predicted  │
│  beyond confidence band = ANOMALY   │
└──────────────────┬──────────────────┘
                   │ anomaly detected
                   ▼
┌─────────────────────────────────────┐
│  2. GEMMA INTERPRETATION            │
│                                     │
│  Context: which channels anomalous, │
│  how they diverged, current car     │
│  state, recent history              │
│                                     │
│  Output: human-readable explanation │
│  + recommended action + severity    │
└──────────────────┬──────────────────┘
                   │ interpreted anomaly
                   ▼
┌─────────────────────────────────────┐
│  3. ENGINEER CONTROL PANEL          │
│                                     │
│  Shows: anomaly details, Gemma's    │
│  interpretation, recommended action │
│                                     │
│  Engineer can:                      │
│  [✓ APPROVE] → sends to Racer HUD  │
│  [✗ DISMISS] → false positive, log │
│  [✎ MODIFY]  → edit message, send  │
└──────────────────┬──────────────────┘
                   │ approved
                   ▼
┌─────────────────────────────────────┐
│  4. RACER HUD                       │
│                                     │
│  Displays approved message +        │
│  audio TTS instruction              │
│  Tagged as "ENGINEER VERIFIED"      │
└─────────────────────────────────────┘
```

### TimesFM Integration

```python
from timesfm import TimesFM

class AnomalyDetector:
    def __init__(self, model_checkpoint="google/timesfm-2.0-500m"):
        self.model = TimesFM.from_pretrained(model_checkpoint)
        self.window_size = 128  # input context length (ticks)
        self.horizon = 16  # predict 16 steps ahead
        self.anomaly_threshold = 2.5  # standard deviations
        self.channels_to_monitor = [
            "speed_kmh", "rpm", "fuel_flow_rate_kgh",
            "tyre_temp_fl", "tyre_temp_fr", "tyre_temp_rl", "tyre_temp_rr",
            "brake_temp_fl", "brake_temp_fr",
            "ers_soc_pct", "engine_coolant_temp",
            "tyre_wear_pct", "lateral_g", "longitudinal_g",
        ]
        self.history = {ch: [] for ch in self.channels_to_monitor}
    
    def ingest(self, telemetry_tick):
        """Called every tick — buffers data."""
        for ch in self.channels_to_monitor:
            value = telemetry_tick.get(ch, 0)
            self.history[ch].append(value)
            # Keep only window_size + buffer
            if len(self.history[ch]) > self.window_size * 2:
                self.history[ch] = self.history[ch][-self.window_size * 2:]
    
    def check_anomalies(self):
        """
        Called periodically (every 5-10 seconds, not every tick).
        Returns: list of anomalies or empty list.
        """
        anomalies = []
        
        for ch in self.channels_to_monitor:
            if len(self.history[ch]) < self.window_size:
                continue
            
            # Get input window
            input_series = self.history[ch][-self.window_size:]
            
            # TimesFM prediction
            forecast = self.model.predict(
                inputs=[input_series],
                freq="100ms",  # 10 Hz data
                horizon=self.horizon,
            )
            
            predicted = forecast.mean[0]  # predicted values
            std = forecast.std[0]  # uncertainty
            
            # Compare actual recent values against what was predicted
            # (we look at the last `horizon` actual values vs what was predicted `horizon` steps ago)
            actual_recent = self.history[ch][-self.horizon:]
            
            for i, (actual, pred, s) in enumerate(zip(actual_recent, predicted, std)):
                deviation = abs(actual - pred) / max(s, 0.001)
                if deviation > self.anomaly_threshold:
                    anomalies.append({
                        "channel": ch,
                        "actual": actual,
                        "predicted": pred,
                        "deviation_sigma": round(deviation, 2),
                        "direction": "above" if actual > pred else "below",
                    })
                    break  # one anomaly per channel per check
        
        return anomalies if anomalies else None
```

### Gemma Interpretation

When anomalies are detected, we build context and ask Gemma to interpret:

```python
def interpret_anomaly(anomalies, current_state, lap_history):
    """Send anomaly to Gemma for interpretation."""
    
    context = f"""
    ANOMALY DETECTED in live telemetry.
    
    Anomalous channels:
    {json.dumps(anomalies, indent=2)}
    
    Current car state:
    - Lap: {current_state['lap']}, Tyre: {current_state['tyre_compound']} ({current_state['tyre_age_laps']} laps old)
    - Wear: {current_state['tyre_wear_pct']}%, Grip: {current_state['tyre_grip_level']}
    - Fuel: {current_state['fuel_remaining_kg']} kg, ERS: {current_state['ers_soc']}%
    - Weather: {current_state['weather']['track_wetness']}, {current_state['weather']['track_temp_c']}°C
    
    Recent lap trend: {json.dumps(lap_history[-3:])}
    
    Based on this anomaly:
    1. What is the most likely cause?
    2. What is the severity? (low / medium / high / critical)
    3. What specific action should the driver take RIGHT NOW?
    4. Should we pit? (yes / no / monitor)
    
    Respond in JSON format:
    {{"cause": "...", "severity": "...", "action": "...", "pit": "...", "explanation": "..."}}
    """
    
    response = gemma.generate(context)
    return json.loads(response)
```

### Example Anomaly Flow

```
1. TimesFM detects: brake_temp_fl is 3.1σ above predicted (actual: 1050°C, predicted: 890°C)
   Also: tyre_temp_fl is 1.8σ above predicted (not anomalous alone, but correlated)

2. Gemma interprets:
   {
     "cause": "Left front brake caliper may be sticking — generating excess heat 
               that's also transferring to the tyre. The brake is not cooling normally 
               between braking zones.",
     "severity": "high",
     "action": "Reduce braking pressure into Turn 1 and Turn 4. Use more rear brake 
               bias. Monitor for 2 laps — if temp doesn't stabilize, box.",
     "pit": "monitor",
     "explanation": "Brake temp is significantly above model prediction independent of 
                    driving intensity. Correlated tyre heating confirms heat transfer 
                    from brake to tyre. Likely caliper issue."
   }

3. Engineer sees on Control Panel:
   ┌────────────────────────────────────────────────────────┐
   │  ⚠ ANOMALY — Lap 22 — HIGH SEVERITY                   │
   │                                                        │
   │  Channel: brake_temp_fl (+3.1σ), tyre_temp_fl (+1.8σ) │
   │                                                        │
   │  Gemma: "Left front brake caliper may be sticking..."  │
   │                                                        │
   │  Recommended to driver:                                │
   │  "Reduce braking into T1/T4. More rear bias.           │
   │   Monitor 2 laps — box if no improvement."             │
   │                                                        │
   │  [✓ APPROVE]  [✎ MODIFY]  [✗ DISMISS]                 │
   └────────────────────────────────────────────────────────┘

4. Engineer clicks APPROVE.

5. Racer HUD (instant):
   🔶 ENGINEER ALERT
   "Reduce braking T1/T4. Rear bias up. Monitor 2 laps."
   [Audio TTS plays simultaneously]
```

---

## Alert Routing & Priority

### Routing Rules

| Tier | Source | Goes To | Latency | Driver Sees |
|------|--------|---------|---------|-------------|
| 2a | Rule engine | Racer HUD directly | <100ms | Immediately + audio |
| 2b | Signal detection | Racer HUD directly | <100ms | Immediately + audio |
| 2c | TimesFM + Gemma | Engineer Panel → (approved) → Racer HUD | 5-30s | After engineer approves |

### Priority Levels

| Priority | Visual (HUD) | Audio | Duration | Example |
|----------|-------------|-------|----------|---------|
| **Critical** | Full-screen red flash | Loud urgent tone + TTS | Until acknowledged | "PIT NOW — brake failure imminent" |
| **High** | Large orange banner | Alert tone + TTS | 10 seconds | "TYRE CLIFF — prepare to pit" |
| **Medium** | Yellow notification | Subtle tone + TTS | 5 seconds | "ERS harvest declining" |
| **Low** | Small gray text | TTS only (no tone) | 3 seconds | "Stint update: wear 41%" |

### Audio TTS Queue

Multiple alerts can fire simultaneously. TTS has a priority queue:

```python
class TTSQueue:
    def __init__(self):
        self.queue = []  # priority queue (higher priority = spoken first)
    
    def add(self, alert):
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        heapq.heappush(self.queue, (priority_order[alert["priority"]], time.time(), alert))
    
    def next(self):
        """Get next alert to speak. Critical interrupts current speech."""
        if self.queue:
            _, _, alert = heapq.heappop(self.queue)
            return alert
        return None
    
    def has_critical(self):
        return any(p == 0 for p, _, _ in self.queue)
```

**Rules:**
- Critical interrupts whatever is currently being spoken
- High waits for current speech to finish, then plays
- Medium/Low only play if nothing else is queued
- Max 1 alert spoken at a time
- If same alert fires twice within 10s, deduplicate

---

## WebSocket Alert Protocol

### Backend → Racer HUD (instant alerts: 2a, 2b)

```json
{
  "type": "alert",
  "tier": "2a",
  "name": "Tyre cliff approaching",
  "message": "TYRE CLIFF — prepare to pit",
  "priority": "high",
  "audio": true,
  "lap": 22,
  "ts": 1722430567.234
}
```

### Backend → Engineer Panel (2c pending approval)

```json
{
  "type": "anomaly_pending",
  "id": "anom_uuid_123",
  "tier": "2c",
  "channels": [{"channel": "brake_temp_fl", "deviation_sigma": 3.1}],
  "gemma_interpretation": {
    "cause": "Left front brake caliper may be sticking...",
    "severity": "high",
    "action": "Reduce braking into T1/T4...",
    "pit": "monitor"
  },
  "recommended_message": "Reduce braking T1/T4. Rear bias up. Monitor 2 laps.",
  "lap": 22,
  "ts": 1722430567.234
}
```

### Engineer Panel → Backend (approval)

```json
{
  "type": "anomaly_decision",
  "id": "anom_uuid_123",
  "decision": "approve",  // approve | dismiss | modify
  "modified_message": null,  // only if decision = modify
  "engineer_note": "Confirmed — brake temp trend is real"
}
```

### Backend → Racer HUD (after engineer approval)

```json
{
  "type": "alert",
  "tier": "2c",
  "name": "Engineer Alert",
  "message": "Reduce braking T1/T4. Rear bias up. Monitor 2 laps.",
  "priority": "high",
  "audio": true,
  "engineer_verified": true,
  "lap": 22,
  "ts": 1722430572.100
}
```

---

## Database Schema (Alerts)

```sql
-- Configurable rules (2a)
CREATE TABLE alert_rules (
    id          SERIAL PRIMARY KEY,
    race_id     UUID REFERENCES races(id),
    name        VARCHAR(100) NOT NULL,
    rule_type   VARCHAR(20) NOT NULL,  -- interval | threshold | combined
    channel     VARCHAR(50),
    condition   VARCHAR(5),   -- > < >= <= ==
    value       FLOAT,
    interval_laps INT,
    message     TEXT NOT NULL,
    priority    VARCHAR(10) DEFAULT 'medium',
    audio       BOOLEAN DEFAULT TRUE,
    enabled     BOOLEAN DEFAULT TRUE,
    cooldown_laps INT DEFAULT 1,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Signal detection configs (2b)
CREATE TABLE signal_patterns (
    id          SERIAL PRIMARY KEY,
    race_id     UUID REFERENCES races(id),
    name        VARCHAR(100) NOT NULL,
    pattern_class VARCHAR(50) NOT NULL,  -- OilTempDrift, TyreAsymmetry, etc.
    config      JSONB NOT NULL,  -- thresholds, window sizes, etc.
    enabled     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- All fired alerts log (all tiers)
CREATE TABLE alert_log (
    id          BIGSERIAL PRIMARY KEY,
    race_id     UUID REFERENCES races(id),
    ts          TIMESTAMPTZ DEFAULT now(),
    lap         INT NOT NULL,
    tier        VARCHAR(5) NOT NULL,  -- 2a | 2b | 2c
    name        VARCHAR(100),
    message     TEXT NOT NULL,
    priority    VARCHAR(10),
    routing     VARCHAR(30),  -- instant_to_hud | pending_engineer | dismissed
    
    -- 2c specific
    anomaly_data    JSONB,      -- raw anomaly channels + deviations
    gemma_response  JSONB,      -- Gemma interpretation
    engineer_decision VARCHAR(10),  -- approve | dismiss | modify
    engineer_note   TEXT,
    decision_ts     TIMESTAMPTZ,   -- when engineer acted
    delivered_to_hud BOOLEAN DEFAULT FALSE,
    delivered_ts    TIMESTAMPTZ
);
```

---

## Integration into Simulation Loop

```python
# Initialize
rule_engine = [PreventativeRule(r) for r in load_rules(race_id)]
signal_patterns = [load_pattern(p) for p in load_signal_configs(race_id)]
anomaly_detector = AnomalyDetector()

# Every tick (10 Hz)
anomaly_detector.ingest(telemetry_tick)

# Every lap
for rule in rule_engine:
    alert = rule.evaluate(telemetry_tick, current_lap)
    if alert:
        send_to_hud(alert)  # 2a: instant
        log_alert(alert)

for pattern in signal_patterns:
    alert = pattern.evaluate(lap_history, current_lap)
    if alert:
        send_to_hud(alert)  # 2b: instant
        log_alert(alert)

# Every 10 seconds
anomalies = anomaly_detector.check_anomalies()
if anomalies:
    interpretation = interpret_anomaly(anomalies, current_state, lap_history)
    send_to_engineer_panel(anomalies, interpretation)  # 2c: needs approval
    log_alert_pending(anomalies, interpretation)
```

---

## Summary

| Tier | Speed | Intelligence | Trust Level | Routing |
|------|-------|-------------|-------------|---------|
| 2a | Instant | Low (simple rules) | High (deterministic, engineer-configured) | → HUD |
| 2b | Instant | Medium (statistical patterns) | High (known signatures, engineer-configured) | → HUD |
| 2c | 5-30s | High (ML anomaly + LLM interpretation) | Medium (novel, needs human check) | → Engineer → HUD |

*The 3-tier system balances speed vs accuracy. Known problems (2a/2b) bypass the human. Unknown problems (2c) get human verification. Comms time to zero for everything except genuinely novel situations.*
