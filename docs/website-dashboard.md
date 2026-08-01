# Website Dashboard Layout

## Overview

The website is the **pit wall** — the command center where the race engineer (user) sets up tracks, configures vehicles, reviews pre-race strategy, and monitors live telemetry. It has 4 main views accessed sequentially:

1. **Track Setup** — draw/import a track, define sectors and DRS zones
2. **Race Configuration** — set vehicle specs, laps, fuel, tyres, weather
3. **Pre-Race Report** — run a test lap, Gemma generates strategy report
4. **Live Race Dashboard** — real-time telemetry, strategy updates, agent comms

---

## Navigation Structure

```
┌─────────────────────────────────────────────┐
│  RACEMIND        [Track] [Config] [Report] [Live]    [Settings]  │
├─────────────────────────────────────────────┤
│                                             │
│              Active View Content             │
│                                             │
└─────────────────────────────────────────────┘
```

Top nav bar shows race status: `Setup → Test Lap → Pre-Race → LIVE → Completed`

---

## VIEW 1: Track Setup

**Purpose:** Receive the GPS trace from the mobile app, render it on a 3D map, and let the user mark key points (start/finish, pit, sectors, DRS zones).

**The track path itself is NOT drawn here.** It comes from physically walking/driving it with the phone app (see `mobile-app.md` → Screen 2: Trace Track). This view renders the result and lets you annotate it.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  TRACK SETUP                                    [Save Track]  │
├────────────────────────────────────┬─────────────────────────┤
│                                    │  TRACK SPECS (auto)      │
│                                    │                         │
│       3D MAP VIEW                  │  Name: [____________]   │
│  (Google Maps Photorealistic 3D)   │  Country: [Canada ▼]    │
│                                    │  City: [Waterloo ▼]     │
│   Track path rendered as glowing   │                         │
│   green polyline over 3D buildings │  Distance: 1.243 km ●   │
│   and satellite imagery.           │  Corners: 8 ●           │
│                                    │  Elevation: 330-338m ●  │
│   Click on the track to place:     │  DRS Zones: 0           │
│   🏁 Start/Finish                  │                         │
│   ━━ Sector boundaries             │  ● = auto-calculated    │
│   🔵 Pit entry / exit              │    from GPS trace       │
│   🟣 DRS zones                     │                         │
│                                    │─────────────────────────│
│   [Orbit View] [Flythrough]        │  KEY POINTS             │
│                                    │  ☑ Start/Finish line    │
│                                    │  ☑ Sector 1 boundary    │
│                                    │  ☑ Sector 2 boundary    │
│                                    │  ☐ Pit entry            │
│                                    │  ☐ Pit exit             │
│                                    │  ☐ DRS Zone 1 (det/act) │
│                                    │  ☐ DRS Zone 2 (det/act) │
├────────────────────────────────────┴─────────────────────────┤
│  TRACE STATUS                                                │
│                                                              │
│  ● Track received from mobile app (847 points → smoothed    │
│    to 124 points, loop closed, 1.243 km total)              │
│                                                              │
│  [Re-trace from App]  [Import GPX]  [Preview Flythrough]    │
├──────────────────────────────────────────────────────────────┤
│  SECTOR BREAKDOWN (after marking)                            │
│  S1: 0.45km (Turns 1-3)  │  S2: 0.48km (Turns 4-6)  │  S3: 0.32km (Turns 7-8)  │
└──────────────────────────────────────────────────────────────┘
```

### How It Works

1. User traces the track with the mobile app (walk/drive it once)
2. App submits raw GPS → backend smooths, closes loop, calculates specs
3. This view auto-loads the processed track and renders it on Google 3D Map
4. User clicks on the polyline to place key markers:
   - First click: "What is this point?" → dropdown menu appears
   - Select: Start/Finish, Sector line, Pit entry, Pit exit, DRS detection/start/end
   - Marker appears on the track with appropriate icon/color
5. User gives the track a name and saves

### Features
- **3D Map** (Google Photorealistic) — satellite + textured buildings + terrain
- **Track polyline** rendered from processed GPS trace (green, glowing, 2m above ground)
- **Click-to-mark** key points directly on the track line (no free-form drawing)
- **Auto-calculated specs** from GPS trace: distance, corners, elevation
- **Orbit view** button: camera orbits the full track in 3D
- **Flythrough** button: camera follows the track path like an onboard lap
- **Re-trace** button: sends signal to app to do another trace (if first one was bad)
- **Import GPX** fallback: upload a GPX file if trace isn't available

### Data Flow
- **Reads:** processed track points from `track_points` table (written by backend after app submit)
- **Writes:** key point markers to `track_points` (type = start_finish, sector_line, pit_entry, etc.), `track_sectors`, `track_drs_zones`
- **Auto-populated:** `tracks.total_distance_m`, `tracks.num_corners`, `tracks.elevation_*` (from backend processing)

---

## VIEW 2: Race Configuration

**Purpose:** Set up everything before the race — vehicle specs, race length, weather conditions, and the alert rules/patterns the engineer wants active. Uses tabbed navigation so the form doesn't get overwhelming.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  RACE CONFIGURATION                        [Start Test Lap]   │
├──────────────────────────────────────────────────────────────┤
│  [Race & Vehicle]  [Weather]  [Alert Rules]  [Strategy]       │
├──────────────────────────────────────────────────────────────┤
```

#### Tab 1: Race & Vehicle

```
├──────────────────────────┬───────────────────────────────────┤
│  RACE PARAMETERS         │  VEHICLE SETUP                    │
│                          │                                   │
│  Race Name: ________     │  Car Mass: [798] kg               │
│  Track: [Melbourne ▼]    │  Fuel Capacity: [110] kg          │
│  Total Laps: [57]        │  Starting Fuel: [100] kg          │
│                          │  ERS Capacity: [4.0] MJ           │
│  Starting Compound:      │  MGU-K Max: [350] kW              │
│  ○ Soft  ● Medium  ○ Hard│  Max Harvest/Lap: [8.5] MJ       │
│  ○ Intermediate  ○ Wet   │                                   │
│                          │  Brake Bias: [57]% front          │
│                          │  Front Wing: [12]°                │
│                          │  Rear Wing: [8]°                  │
│                          │  Tyre Pressure F: [21.0] psi      │
│                          │  Tyre Pressure R: [19.5] psi      │
└──────────────────────────┴───────────────────────────────────┘
```

#### Tab 2: Weather

```
┌──────────────────────────────────────────────────────────────┐
│  PRELIMINARY CONDITIONS (used for test lap + pre-race report) │
│                                                              │
│  ○ Fetch from phone location (OpenWeather API)               │
│  ● Set manually:                                             │
│                                                              │
│  Air Temp: [28]°C   Track Temp: [42]°C   Humidity: [45]%    │
│  Wind: [12] km/h    Direction: [NW ▼]    Rain: [0] mm/h     │
│  Conditions: ● Dry  ○ Damp  ○ Wet                           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  LIVE RACE WEATHER SIMULATOR                                 │
│                                                              │
│  The simulator seeds from the conditions above, then         │
│  evolves them throughout the race to create strategy events. │
│                                                              │
│  Event Intensity:                                            │
│  ○ Calm     (~1 event / 20 laps)  Realistic, few changes    │
│  ● Normal   (~1 event / 7 laps)   Recommended for demo      │
│  ○ Dramatic (~1 event / 3 laps)   High action, tests agent  │
│  ○ Off      (weather stays fixed throughout race)            │
│                                                              │
│  Possible events: rain start/stop, wind gusts, temp shifts,  │
│  track drying. Each triggers a Gemma strategy re-evaluation. │
│                                                              │
│  ☑ Notify engineer when weather event fires                  │
│  ☑ Auto-trigger Gemma re-evaluation on weather change        │
└──────────────────────────────────────────────────────────────┘
```

#### Tab 3: Alert Rules

```
┌──────────────────────────────────────────────────────────────┐
│  PREVENTATIVE RULES (2a) — fire instantly to Racer HUD       │
│                                              [+ Add Rule]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ☑  Brake temp check      every 5 laps          Low  [Edit] │
│  ☑  Tyre cliff warning    wear > 55%             High [Edit] │
│  ☑  Fuel critical         remaining < 3 laps     High [Edit] │
│  ☑  ERS depleted          SOC < 10%              Med  [Edit] │
│  ☑  Coolant overheat      coolant > 120°C        High [Edit] │
│  ☐  Stint lap report      every 3 laps           Low  [Edit] │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  SIGNAL DETECTION PATTERNS (2b) — fire instantly to HUD      │
│                                                              │
│  ☑  Oil Temp Drift        window: [5] laps  slope: [0.02]   │
│  ☑  Tyre Asymmetry        delta threshold:  [15]°C          │
│  ☑  ERS Harvest Decline   min harvest:      [5.0] MJ        │
│  ☑  Fuel Overconsumption  target:           [1.72] kg/lap   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ANOMALY DETECTION (2c) — requires engineer approval         │
│                                                              │
│  ☑  Enable TimesFM anomaly detection                         │
│  Detection sensitivity: ○ Low (3.5σ)  ● Normal (2.5σ)       │
│                         ○ High (1.8σ — noisy, more alerts)  │
│  Check interval: [10] seconds                                │
│                                                              │
│  ⓘ Anomalies appear in the Engineer Panel during the race.  │
│    You approve, modify, or dismiss before they reach         │
│    the driver's HUD.                                         │
└──────────────────────────────────────────────────────────────┘
```

#### Tab 4: Strategy

```
┌──────────────────────────────────────────────────────────────┐
│  STRATEGY CONSTRAINTS (hints for Gemma)                      │
│                                                              │
│  Max pit stops: [2]       Min stint length: [10] laps        │
│  Available compounds: ☑ Soft  ☑ Medium  ☑ Hard               │
│  Safety car probability: [Low ▼]                             │
└──────────────────────────────────────────────────────────────┘
```

### Features
- All fields have sensible defaults (2026 F1 spec values)
- Track dropdown populated from saved tracks in View 1
- Weather API fetch uses phone's current GPS location
- Compound selection shows estimated life (e.g., "Soft: ~18 laps, Medium: ~30 laps")
- Alert rules configured here carry into the live race without further setup
- Validation: warns if starting fuel > capacity, or laps × estimated consumption > fuel

### Data Written
- `races` table (track reference, laps, fuel, compound, status)
- `race_vehicle_config` table (all vehicle parameters)
- `race_weather` table (initial weather snapshot + simulator intensity)
- `alert_rules` table (all 2a rules configured in Tab 3)
- `signal_patterns` table (all 2b pattern configs from Tab 3)

---

## VIEW 3: Pre-Race Report

**Purpose:** After a test lap (user walks/runs the "track" with phone), Gemma analyzes the data and produces a strategy report.

### Flow
1. User clicks "Start Test Lap" → phone begins capturing data
2. User physically walks/runs around defined track (1 lap)
3. Phone sends telemetry → simulation models run → data stored
4. Gemma ingests: track profile, test lap telemetry, weather, vehicle config
5. Gemma generates a full pre-race strategy report

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  PRE-RACE REPORT                    Generated: 9:45 AM       │
│  Track: Melbourne  │  Laps: 57  │  Conditions: Dry, 28°C     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ TRACK ANALYSIS ────────────────────────────────────────┐ │
│  │ "This is a high-speed circuit with 3 heavy braking      │ │
│  │  zones in S1. Tyre degradation will be rear-limited     │ │
│  │  due to traction zones in S2. S1 straight is the        │ │
│  │  primary zone for gaining time under braking."           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ RECOMMENDED STRATEGY ──────────────────────────────────┐ │
│  │                                                         │ │
│  │  OPTION A (Primary): 1-stop                             │ │
│  │  ├─ Start: Medium (Laps 1-25)                           │ │
│  │  └─ Stop 1: → Hard (Laps 26-57)                         │ │
│  │  Estimated time: 1:22:45.2                              │ │
│  │                                                         │ │
│  │  OPTION B (Aggressive): 2-stop                          │ │
│  │  ├─ Start: Soft (Laps 1-18)                             │ │
│  │  ├─ Stop 1: → Medium (Laps 19-38)                       │ │
│  │  └─ Stop 2: → Soft (Laps 39-57)                         │ │
│  │  Estimated time: 1:22:32.8 (faster but riskier)         │ │
│  │                                                         │ │
│  │  [Select Strategy A]  [Select Strategy B]               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
├───────────────────────┬──────────────────────────────────────┤
│  FUEL ANALYSIS        │  TYRE ANALYSIS                       │
│                       │                                      │
│  Avg consumption:     │  Test lap wear rate:                 │
│    1.72 kg/lap        │    0.98% / lap (medium)              │
│  Starting fuel: 100kg │  Predicted life:                     │
│  Fuel target: 98.0kg  │    Soft: 18 laps                    │
│  Margin: +2.0kg       │    Medium: 30 laps                  │
│  Fuel-save needed: No │    Hard: 42 laps                    │
│                       │  Grip cliff at: ~62% wear            │
│                       │  Optimal temp window: 85-105°C       │
├───────────────────────┼──────────────────────────────────────┤
│  ERS ANALYSIS         │  WEATHER IMPACT                      │
│                       │                                      │
│  Harvest efficiency:  │  Current: Dry, 28°C                  │
│    6.2 MJ/lap         │  Rain probability: 15%               │
│  Deploy zones:        │  If rain starts:                     │
│    S1 straight, S3    │    → Pit for inters immediately      │
│  SOC sweet spot:      │    → Don't extend beyond 5 laps wet  │
│    Keep above 30%     │  Wind impact: minimal (12 km/h)      │
│  Deploy mode:         │                                      │
│    Full each lap      │                                      │
├───────────────────────┴──────────────────────────────────────┤
│  RISK FACTORS                                                │
│                                                              │
│  ⚠ Heavy braking in S1 → monitor front brake temps          │
│  ⚠ Traction zones in S2 → rear tyre wear elevated           │
│  ⚠ If safety car: pit immediately if on lap 18+             │
│  ✓ Fuel consumption is within target                         │
│  ✓ ERS harvest is sufficient for full deploy each lap        │
└──────────────────────────────────────────────────────────────┘
```

### Features
- Report generated entirely by Gemma based on test lap data
- User selects which strategy to follow (feeds into live race agent)
- Can re-run test lap to get updated predictions
- Print/export report as PDF for quick reference during race

### Data Read
- `telemetry` (test lap data)
- `lap_summaries` (test lap summary)
- `tracks`, `race_vehicle_config`, `race_weather`

### Data Written
- `pre_race_reports` table (full analysis + predictions)
- `pit_strategies` table (selected strategy stored as `pre_race` type)

---

## VIEW 4: Live Race Dashboard

**Purpose:** Real-time pit wall during the race. Shows all telemetry, strategy status, and Gemma agent communications.

### Layout

Three permanent columns. The Engineer Control Panel lives in the right column at all times — engineers never lose sight of pending anomalies while watching telemetry.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│  🟢 LIVE   Lap 14 / 57   │   Fuel: 62.4 kg   │   Tyres: 41% Med   │   ERS: 67%   │   28°C Dry  │
├──────────────────────────┬──────────────────────────────────────────┬────────────────────────────┤
│   LEFT (30%)             │   CENTRE (40%)                           │   RIGHT (30%)              │
│   Track & Car            │   Telemetry & Strategy                   │   Engineer Panel           │
├──────────────────────────┼──────────────────────────────────────────┼────────────────────────────┤
│                          │                                          │                            │
│   TRACK MAP              │   SPEED & INPUTS                         │  ⚠ PENDING APPROVAL        │
│                          │                                          │  ┌──────────────────────┐  │
│   ┌──────────────┐       │   Speed: ████████████████░  267 km/h     │  │ 🔴 HIGH  Lap 22  3.1σ│  │
│   │              │       │   RPM:   ███████████████░░  12,400        │  │ brake_temp_fl +3.1σ  │  │
│   │     ●←car   │       │   Gear:  [6]                             │  │ tyre_temp_fl  +1.8σ  │  │
│   │    ╱    ╲   │       │                                          │  │                      │  │
│   │   ╱      ╲  │       │   Throttle: █████████████░░  85%          │  │ "Brake caliper may   │  │
│   │  ╱        ╲ │       │   Brake:    ░░░░░░░░░░░░░░   0%           │  │  be sticking —       │  │
│   │ Pit ──►   │ │       │   Steering: ◄━━━━━━━●━━━━► +12°          │  │  excess heat to      │  │
│   └──────────────┘       │   G-Force:  Lat: 2.3g │ Long: 0.8g      │  │  tyre."              │  │
│   Sector: S2              │                                          │  │                      │  │
│                          │──────────────────────────────────────────│  │ → Ease braking T1/T4 │  │
│   TYRES                  │                                          │  │   Rear bias up       │  │
│                          │   ENERGY (ERS)                           │  │                      │  │
│   ┌─FL──FR─┐             │                                          │  │ [✓ APPROVE]          │  │
│   │ 98° 101°│             │   Battery: ████████████░░░░  67%         │  │ [✎ MODIFY]           │  │
│   │ 21.3 21.5│ psi        │   Mode: DEPLOY │ Power: +245 kW          │  │ [✗ DISMISS]          │  │
│   │         │             │   Harvested: 4.2 MJ │ Deployed: 3.1 MJ  │  └──────────────────────┘  │
│   │ 96°  97°│             │                                          │                            │
│   │ 19.8 19.9│ psi        │   SOC (last 5 laps):                     │  ┌──────────────────────┐  │
│   └─RL──RR─┘             │   ╱╲  ╱╲  ╱╲  ╱╲  ╱╲                    │  │ 🟡 MED  Lap 21  2.6σ │  │
│                          │  ╱  ╲╱  ╲╱  ╲╱  ╲╱  ╲                   │  │ ers_soc declining    │  │
│   Wear:  41.2%           │                                          │  │ faster than model    │  │
│   Grip:  0.918           │──────────────────────────────────────────│  │ [✓][✎][✗]            │  │
│   Age:   14 laps         │                                          │  └──────────────────────┘  │
│   ░░░░░████░ OK          │   BRAKES                                 │                            │
│                          │   FL: 612°  FR: 598°                     │ ────────────────────────── │
│   FUEL                   │   RL: 445°  RR: 430°                     │                            │
│                          │   Fade: No  │ Pad: 12%                   │  📋 RULES (2a)  [+ Add]    │
│   ████████████░░░        │                                          │  ☑ Brake check  5 laps Low │
│   62.4 / 100 kg          │──────────────────────────────────────────│  ☑ Tyre cliff  >55%  High  │
│                          │                                          │  ☑ Fuel crit   <3lap High  │
│   Flow:  68.2 kg/h       │   STRATEGY                               │  ☑ ERS low     <10%  Med   │
│   Avg:   1.68 kg/lap     │   Plan: 1-stop Med → Hard @ Lap 25       │  ☑ Coolant     >120° High  │
│   Remaining: 37 laps     │   Stint: Lap 14 of 25                    │                            │
│   Status: ✓ On target    │                                          │  📊 PATTERNS (2b)          │
│                          │   ┌────────────────────────────────────┐ │  ☑ Oil Temp Drift          │
│   WEATHER                │   │  GEMMA SAYS:                       │ │  ☑ Tyre Asymmetry          │
│   28°C track: 42°C       │   │  "Tyre wear tracking well.         │ │  ☑ ERS Harvest Decline     │
│   Wind: 12 km/h NW       │   │   Extend to lap 27 — fuel          │ │  ☑ Fuel Overconsumption    │
│   Conditions: Dry        │   │   and tyres support it.            │ │                            │
│                          │   │   Recommend: push S1, protect      │ │  [Configure]               │
│                          │   │   tyres in S2."          [Lap 14]   │ │                            │
│                          │   └────────────────────────────────────┘ │ ────────────────────────── │
│                          │   Pit Window: Laps 23-28  82% conf       │                            │
│                          │   Wet crossover: —   Δvs Hard: +0.4s     │  📜 ALERT HISTORY           │
│                          │                                          │  22│2c│Brake caliper│PENDING│
│                          │   [BOX NOW]  [Extend]  [Override Plan]   │  21│2b│ERS declining│SENT ✓ │
│                          │                                          │  20│2a│Stint report │SENT ✓ │
│  TIMING                                                             │  18│2c│Tyre anomaly │DISMISS│
│  Lap │ S1    │ S2    │ S3    │ Total   │ Fuel  │ Wear │ Alert       │  15│2a│Brake check  │SENT ✓ │
│   14 │ 28.42 │ 32.18 │ 24.91 │ 1:25.51 │ 1.71  │ 41%  │ [2a] Tyre  │                            │
│   13 │ 28.38 │ 32.05 │ 24.88 │ 1:25.31 │ 1.69  │ 38%  │            └────────────────────────────┘
│   12 │ 28.51 │ 32.22 │ 25.01 │ 1:25.74 │ 1.74  │ 35%  │
│   11 │ 28.44 │ 32.11 │ 24.95 │ 1:25.50 │ 1.70  │ 32%  │
└─────────────────────────────────────────────────────────┘
```

**Column responsibilities:**

| Column | Role | Who Uses It |
|--------|------|-------------|
| Left (30%) | Track position, tyres, fuel, weather at a glance | Both engineer and driver spotter |
| Centre (40%) | Full telemetry channels, ERS, brakes, strategy, Gemma output | Primary engineer focus |
| Right (30%) | Pending anomaly approvals, alert rules, pattern config, alert history | Engineer only — always visible |

The right column is **sticky** — it does not scroll away when the timing tower or strategy panel is viewed. Pending anomalies with a pulsing border draw the eye immediately.

### Widget Breakdown

| Widget | Data Source (Redis Key) | Update Rate | Interaction |
|--------|------------------------|-------------|-------------|
| Track Map + Car Position | `telemetry:latest` (lat/lon) | 1 Hz | Hover for corner info |
| Speed Gauge | `telemetry:latest.speed_kmh` | 10 Hz | None |
| RPM Dial | `engine.rpm` | 10 Hz | None |
| Gear Indicator | `engine.gear` | 10 Hz | None |
| Throttle/Brake Bars | `telemetry:latest.throttle/brake` | 10 Hz | None |
| Steering Indicator | `telemetry:latest.steering_angle` | 10 Hz | None |
| G-Force Diamond | `telemetry:latest.lateral_g/longitudinal_g` | 10 Hz | None |
| Tyre Temps (4-corner) | `tyres` hash | 2 Hz | Click for history chart |
| Tyre Pressures | `tyres` hash | 2 Hz | None |
| Tyre Wear Bar | `tyres.wear_pct` | Per lap | Color: green→yellow→red |
| Grip Level | `tyres.grip_level` | Per lap | None |
| ERS Battery Gauge | `ers.soc` | 2 Hz | None |
| ERS Power Flow | `ers.power_kw` | 2 Hz | None |
| ERS History Chart | `laps` list (soc per lap) | Per lap | None |
| Brake Temps (4-corner) | `brakes` hash | 2 Hz | Color-coded bars |
| Fuel Gauge | `fuel.remaining` | 2 Hz | None |
| Fuel Flow Rate | `fuel.flow_rate` | 2 Hz | None |
| Fuel Target Comparison | `fuel` vs `pre_race_reports` | Per lap | Shows +/- target |
| Strategy Panel | `strategy:active` | On change | Click to override |
| Gemma Comms Feed | `agent_messages` list | On new message | Scrollable history |
| Timing Tower | `laps` list | Per lap | Sortable columns |
| Live Delta (target time delta) | `pace_targets.target_lap_time_s` + `lap_summaries.lap_time_s` | Per lap | Green/red ± vs. Gemma target |
| Weather Banner | `weather` hash | Every 5 min | None |
| Pit Window Indicator | `strategy:active.planned_stops` | Per lap | Countdown to window |

### Alert System & Engineer Control Panel

The Live Dashboard is split into two roles:
- **Telemetry view** (left/center): the data widgets shown above
- **Engineer Control Panel** (right): alert management, rule configuration, and anomaly approval

#### Engineer Control Panel Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ENGINEER CONTROL PANEL                                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ⚠ PENDING APPROVAL (2c Anomalies)                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  🔴 HIGH — Lap 22                          3.1σ        │  │
│  │  Channels: brake_temp_fl (+3.1σ), tyre_temp_fl (+1.8σ)│  │
│  │                                                        │  │
│  │  Gemma: "Left front brake caliper may be sticking.     │  │
│  │  Generating excess heat transferring to tyre."         │  │
│  │                                                        │  │
│  │  Recommended to driver:                                │  │
│  │  "Reduce braking T1/T4. Rear bias up.                  │  │
│  │   Monitor 2 laps — box if no improvement."             │  │
│  │                                                        │  │
│  │  [✓ APPROVE]  [✎ MODIFY]  [✗ DISMISS]                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  🟡 MEDIUM — Lap 21                        2.6σ        │  │
│  │  Channel: ers_soc_pct — declining faster than model    │  │
│  │  Gemma: "ERS degradation slightly above normal..."     │  │
│  │  [✓ APPROVE]  [✎ MODIFY]  [✗ DISMISS]                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  📋 ACTIVE RULES (2a) — [+ Add Rule]                        │
│                                                              │
│  ☑ Brake check         │ every 5 laps      │ Low            │
│  ☑ Tyre cliff          │ wear > 55%        │ High           │
│  ☑ Fuel critical       │ < 3 laps fuel     │ High           │
│  ☑ ERS depleted        │ SOC < 10%         │ Medium         │
│  ☑ Coolant overheat    │ > 120°C           │ High           │
│  ☐ Stint report        │ every 3 laps      │ Low (disabled) │
│                                                              │
│  [Edit Rules]                                                │
├──────────────────────────────────────────────────────────────┤
│  📊 SIGNAL PATTERNS (2b)                                     │
│                                                              │
│  ☑ Oil Temp Drift       │ window: 5 laps   │ Active         │
│  ☑ Tyre Asymmetry       │ threshold: 15°C  │ Active         │
│  ☑ ERS Harvest Decline  │ min: 5.0 MJ      │ Active         │
│  ☑ Fuel Overconsumption │ target: 1.72kg   │ Active         │
│                                                              │
│  [Configure Patterns]                                        │
├──────────────────────────────────────────────────────────────┤
│  📜 ALERT HISTORY                                            │
│                                                              │
│  Lap 22 │ 2c │ Brake caliper alert    │ PENDING ⏳          │
│  Lap 21 │ 2b │ ERS harvest declining  │ SENT ✓ → HUD       │
│  Lap 20 │ 2a │ Stint report           │ SENT ✓ → HUD       │
│  Lap 18 │ 2c │ Tyre anomaly           │ DISMISSED ✗         │
│  Lap 15 │ 2a │ Brake check            │ SENT ✓ → HUD       │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

#### Engineer Workflow

1. **2a/2b alerts fire automatically** → appear in Alert History as "SENT ✓ → HUD"
   - Engineer can see what the driver received but doesn't need to act
   - Can disable/modify rules mid-race if too noisy

2. **2c anomaly detected** → appears in "PENDING APPROVAL" section
   - Shows: which channels, deviation sigma, Gemma's interpretation, recommended message
   - Engineer decides:
     - **APPROVE**: message sent instantly to Racer HUD with `[2c] ✓ VERIFIED` tag
     - **MODIFY**: edit the message text before sending (e.g., soften language, add context)
     - **DISMISS**: false positive — logged but not sent to driver

3. **Time pressure**: pending anomalies have a subtle pulse animation and show elapsed time since detection. Engineer should act within 10-30 seconds.

#### Approval Flow Timing

```
TimesFM detects anomaly     → +0s
Gemma interprets            → +2-5s  
Engineer sees on panel      → +3-6s
Engineer reads + decides    → +8-20s
Driver hears on HUD         → +8-21s (after approve)

Total latency: 8-21 seconds from anomaly to driver awareness
(vs. traditional F1 radio: engineer notices → formulates message → waits for 
gap in radio → speaks → driver processes = 15-60+ seconds)
```

#### Alert System (Overlay Alerts — unchanged for known conditions)

These still overlay the telemetry widgets for immediate engineer awareness:

| Alert | Trigger | Visual |
|-------|---------|--------|
| "BOX BOX BOX" | Agent calls pit stop | Full-width red banner + sound |
| Tyre cliff warning | `tyre_wear > 55%` | Tyre widget pulses orange |
| Brake fade | `brake_temp > 1000°C` | Brake widget flashes red |
| Low fuel | `fuel_remaining < fuel_per_lap × 3` | Fuel widget pulses |
| ERS empty | `ers_soc < 10%` | Battery widget red |
| Rain incoming | Weather simulator event | Weather banner changes to blue |
| Safety car | Track status changes | Full banner "SC DEPLOYED" |

---

## Tech Stack (Website)

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | **Next.js 14** (React) | Fast to scaffold, SSR for initial load, great for dashboards |
| Real-time | **Socket.IO** or **SSE** | Push telemetry updates to browser without polling |
| Charts | **Recharts** or **Lightweight Charts** | Live-updating time-series graphs |
| Maps | **Google Maps 3D** (`Map3DElement`) | Photorealistic 3D buildings + satellite, Google-sponsored hackathon |
| UI Components | **shadcn/ui** + Tailwind | Fast to build, clean look, dark theme for pit wall |
| State | **Zustand** | Lightweight, handles high-frequency telemetry updates |
| API | **REST** (setup views) + **WebSocket** (live view) | REST for CRUD, WS for streaming |

### Color Scheme (Pit Wall Dark Theme)

All typography and UI edges are strictly white/grey scale. Colour is reserved for
data meaning (status lights, tyre compounds) — never for fonts, headings, links,
borders, or decorative elements.

```
Background:   #000000 (pure black)
         →    #0a0f1e (almost-black blue) — linear gradient, top-left to bottom-right
Panels:       #111111 (near-black, neutral)
Borders:      #2e2e2e (dark grey — panel edges, dividers, card outlines)

Typography (white/grey only):
  Headings:      #ffffff (pure white)
  Body text:     #e0e0e0 (light grey)
  Secondary:     #a0a0a0 (mid grey — labels, units, timestamps)
  Muted:         #606060 (dark grey — disabled, placeholders)

Status indicators (data dots/lights only, never text):
  OK/Good:    #00c853 (green dot)
  Warning:    #ffab00 (amber dot)
  Critical:   #d50000 (red dot)

Data visualization only (gauges, charts, bars — not typographic):
  ERS/Energy:   #2979ff (gauge fill)
  Tyre Soft:    #d50000 (compound badge)
  Tyre Medium:  #ffd600 (compound badge)
  Tyre Hard:    #ffffff (compound badge)

Gradient:     linear-gradient(135deg, #000000 0%, #0a0f1e 100%)
```

**Rules:**
- Buttons, tabs, and nav items are white/grey text on dark panels, with grey borders
- Active states use a white border or fill — never a colored glow
- Status is communicated by the colored dot/light next to neutral-colored text,
  not by coloring the text itself
- Charts may use the data-viz palette for series lines/fills; axes and labels stay grey

---

## Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| Desktop (>1200px) | Full grid as shown above |
| Tablet (768-1200px) | 2-column, timing tower collapses |
| Mobile (<768px) | Not primary target — redirect to mobile app for driver use |

---

## Page-by-Page Data Dependencies

| View | Reads From DB | Writes To DB | Reads From Redis | Writes To Redis |
|------|--------------|--------------|------------------|-----------------|
| Track Setup | `tracks`, `track_points` | `tracks`, `track_points`, `track_sectors`, `track_drs_zones` | — | — |
| Race Config | `tracks` (dropdown) | `races`, `race_vehicle_config`, `race_weather` | — | — |
| Pre-Race Report | `telemetry`, `lap_summaries`, `race_*` | `pre_race_reports`, `pit_strategies` | — | `strategy:active` |
| Live Dashboard | `lap_summaries` (history) | — | All `race:{id}:*` keys | — |

---

*The website is read-heavy during live racing (consuming from Redis) and write-heavy during setup (populating TimescaleDB). The mobile app is the write-heavy component during live racing.*
