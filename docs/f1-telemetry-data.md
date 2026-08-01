> **PURPOSE OF THIS FILE:** This is the *reference document* — it catalogs every telemetry channel a real F1 car measures today, plus what's coming in the future. Use this to understand what we're modeling and to validate that our simulation is grounded in reality. For *how we actually simulate these channels from phone sensors*, see [`simulation-models.md`](./simulation-models.md).

---

# F1 Telemetry Data: Complete Reference

A modern F1 car carries approximately 300 sensors, generates over 1 million data points per second, and produces ~1.5 terabytes of telemetry per race weekend (~30 MB per lap streamed live, with 2-3x more offloaded via physical connection in the pits).

Sources: [F1 Chronicle](https://f1chronicle.com/f1-telemetry-and-data-explained/), [Forbes](https://www.forbes.com/sites/johnkoetsier/2026/05/23/formula-1s-data-explosion-the-petabyte-race-weekend-is-not-far-off/), [Pure Storage](https://blog.purestorage.com/perspectives/how-formula-1-car-sensors-create-data-at-every-turn/), [FormulaNerds](https://formulanerds.com/explainer/f1/the-sensors-that-tell-f1-engineers-everything-they-need-to-know/)

---

## 1. VEHICLE DYNAMICS & MOTION

| Channel | Unit | Description |
|---------|------|-------------|
| Speed | km/h | Car ground speed |
| GPS Speed | km/h | Speed from GPS (independent of wheel slip) |
| Longitudinal Acceleration | g | Acceleration/braking force |
| Lateral Acceleration | g | Cornering force |
| Vertical Acceleration | g | Bump/kerb impacts |
| Yaw Rate | deg/s | Rotation rate around vertical axis |
| Roll Rate | deg/s | Body roll rate |
| Pitch Rate | deg/s | Nose up/down rate |
| Heading | deg | Car direction relative to north |
| GPS Position (X, Y) | m | Track position coordinates |
| Distance | m | Distance traveled in lap |
| Lap Number | - | Current lap count |
| Lap Time | s | Current lap elapsed time |
| Sector Times (S1, S2, S3) | s | Time through each track sector |

---

## 2. POWER UNIT — ICE (Internal Combustion Engine)

| Channel | Unit | Description |
|---------|------|-------------|
| Engine RPM | rpm | Crankshaft rotational speed |
| Throttle Position | % | Driver throttle demand |
| Engine Torque | Nm | Torque output |
| Intake Air Temperature | °C | Air entering engine |
| Exhaust Gas Temperature | °C | Per-cylinder exhaust temp |
| Engine Oil Temperature | °C | Lubricant thermal state |
| Engine Oil Pressure | bar | Oil system pressure |
| Engine Coolant Temperature | °C | Water cooling circuit |
| Fuel Flow Rate | kg/h | FIA-mandated sensor (max 100 kg/h) |
| Fuel Pressure | bar | Injection system pressure |
| Fuel Consumed | kg | Running total of fuel used |
| Fuel Remaining | kg | Estimated fuel left in tank |
| Turbo Speed | rpm | Turbocharger shaft speed |
| Turbo Inlet Pressure | bar | Boost pressure |
| Intercooler Temperature | °C | Charge air cooler outlet |
| Ignition Timing | deg | Spark advance per cylinder |
| Lambda (Air-Fuel Ratio) | - | Combustion mixture richness |
| Crankcase Pressure | mbar | Engine breathing/seal health |
| Cylinder Pressure | bar | In-cylinder combustion pressure |
| Knock Sensor | - | Detonation detection per cylinder |
| Engine Vibration | g | NVH monitoring |

---

## 3. POWER UNIT — ERS (Energy Recovery System)

### MGU-K (Motor Generator Unit - Kinetic)
| Channel | Unit | Description |
|---------|------|-------------|
| MGU-K Power Output | kW | Power delivered to/from drivetrain (max 350 kW in 2026) |
| MGU-K RPM | rpm | Motor speed |
| MGU-K Temperature | °C | Motor winding temperature |
| MGU-K Torque | Nm | Torque demand/delivery |
| MGU-K Mode | - | Deploy / Harvest / Off |
| Energy Harvested per Lap | MJ | Kinetic energy recovered (up to 8.5 MJ/lap in 2026) |
| Energy Deployed per Lap | MJ | Energy sent to wheels |

### MGU-H (Motor Generator Unit - Heat) — *Pre-2026 only*
| Channel | Unit | Description |
|---------|------|-------------|
| MGU-H Power | kW | Power from exhaust heat |
| MGU-H RPM | rpm | Motor speed |
| MGU-H Temperature | °C | Winding temperature |

### Energy Store (Battery)
| Channel | Unit | Description |
|---------|------|-------------|
| State of Charge (SOC) | % | Battery level |
| Battery Voltage | V | Pack voltage |
| Battery Current | A | Charge/discharge current |
| Battery Temperature | °C | Cell temperatures (multiple zones) |
| Energy Store Power | kW | Net power flow in/out |
| Cell Balancing Status | - | Individual cell health |
| Battery Cooling Flow | L/min | Coolant flow rate |

---

## 4. TRANSMISSION & DRIVETRAIN

| Channel | Unit | Description |
|---------|------|-------------|
| Gear Position | 1-8 / N / R | Current gear selected |
| Gear Shift Request | - | Upshift / Downshift command |
| Gearbox Oil Temperature | °C | Transmission fluid temp |
| Gearbox Oil Pressure | bar | Lubrication pressure |
| Clutch Position | % | Clutch engagement (starts) |
| Clutch Temperature | °C | Clutch plate thermal state |
| Differential Setting | - | Electronic diff map / torque split |
| Driveshaft Torque | Nm | Torque transmitted to wheels |
| Gearbox Vibration | g | Bearing/gear health |

---

## 5. TYRES

| Channel | Unit | Description |
|---------|------|-------------|
| Tyre Surface Temperature (FL, FR, RL, RR) | °C | Infrared surface measurement (inner/middle/outer) |
| Tyre Carcass Temperature (FL, FR, RL, RR) | °C | Internal body temperature |
| Tyre Pressure (FL, FR, RL, RR) | psi | Internal air pressure |
| Wheel Speed (FL, FR, RL, RR) | rpm | Individual wheel rotational speed |
| Tyre Slip Ratio | % | Difference between wheel speed and ground speed |
| Tyre Slip Angle | deg | Angle between tyre heading and travel direction |
| Tyre Compound | - | Soft / Medium / Hard / Intermediate / Wet |
| Tyre Age | laps | Laps since fitting |
| Tyre Wear Estimate | % | Derived degradation model |
| Tyre Graining/Blistering | - | Surface condition (visual + thermal inference) |
| Wheel Nut Torque | Nm | Post-pitstop retention confirmation |

---

## 6. BRAKES

| Channel | Unit | Description |
|---------|------|-------------|
| Brake Pressure (Front/Rear) | bar | Hydraulic brake pressure |
| Brake Pedal Position | % | Driver pedal travel |
| Brake Bias | % front | Front/rear brake balance setting |
| Brake Disc Temperature (FL, FR, RL, RR) | °C | Disc surface temp (can exceed 1000°C) |
| Brake Pad Wear | mm | Remaining pad thickness |
| Brake Caliper Temperature | °C | Caliper body temp |
| Brake-by-Wire Demand | - | Rear brake electronic control signal |
| Brake Cooling Duct Position | - | Duct openings for airflow |

---

## 7. SUSPENSION & CHASSIS

| Channel | Unit | Description |
|---------|------|-------------|
| Ride Height (Front/Rear) | mm | Ground clearance |
| Suspension Travel (FL, FR, RL, RR) | mm | Damper displacement |
| Damper Velocity | mm/s | Compression/rebound speed |
| Spring Rate | N/mm | Effective spring stiffness |
| Anti-Roll Bar Position | mm | Roll stiffness setting |
| Heave (Front/Rear) | mm | Vertical displacement of axle |
| Steering Angle | deg | Driver steering input |
| Steering Torque | Nm | Force at steering column |
| Chassis Load (FL, FR, RL, RR) | N | Vertical load per corner |
| Push Rod / Pull Rod Load | N | Structural loads |
| Torsion Bar Load | N | Anti-roll forces |

---

## 8. AERODYNAMICS

| Channel | Unit | Description |
|---------|------|-------------|
| Pitot Tube Pressure (multiple locations) | Pa | Dynamic air pressure at various body points |
| Total Pressure | Pa | Combined static + dynamic |
| Static Pressure | Pa | Ambient reference pressure |
| Front Wing Angle | deg | Flap position |
| Rear Wing Angle / DRS Position | deg/open-closed | DRS flap state |
| DRS Activation | 0/1 | DRS enabled flag |
| Airbox Pressure | Pa | Engine intake pressure |
| Diffuser Pressure | Pa | Underbody suction measurement |
| Downforce Estimate (Front/Rear) | N | Derived from load cells + aero model |
| Drag Coefficient Estimate | - | Derived from speed vs. power |
| Yaw Angle (Sideslip) | deg | Angle of attack relative to airflow |
| Cooling Inlet Position | mm | Bodywork opening size |
| Brake Duct Inlet Area | mm² | Cooling flow to brakes |

---

## 9. HYDRAULICS & SYSTEMS

| Channel | Unit | Description |
|---------|------|-------------|
| Hydraulic Pressure | bar | System operating pressure |
| Hydraulic Fluid Temperature | °C | System fluid temp |
| Hydraulic Flow Rate | L/min | Pump output |
| Power Steering Pressure | bar | Assist system load |
| Gearbox Actuator Pressure | bar | Shift mechanism |
| DRS Actuator Pressure | bar | Rear wing mechanism |
| Electrical System Voltage | V | 12V/48V bus voltage |
| Alternator Output | A | Charging system |

---

## 10. DRIVER INPUTS & CONTROLS

| Channel | Unit | Description |
|---------|------|-------------|
| Throttle Pedal Position | % | Right foot input |
| Brake Pedal Position | % | Left foot input |
| Steering Wheel Angle | deg | Steering input |
| Clutch Paddle Position (L/R) | % | Start procedure |
| Gear Shift Paddle | up/down | Shift command |
| DRS Button | 0/1 | DRS activation request |
| Overtake Button (Deploy) | 0/1 | Extra ERS deployment |
| Brake Bias Adjustment | % | Rotary dial position |
| Differential Entry/Mid/Exit | setting | Diff maps via rotary |
| Engine Brake Setting | 1-12 | Engine braking map |
| Fuel Mix / Power Mode | 1-8 | ICE mapping |
| ERS Deploy Mode | - | Strategy mode selection |
| Multi-Function Rotary Positions | - | Various adjustable parameters |
| Radio Transmit Button | 0/1 | Team radio activation |
| Drink Button | 0/1 | Hydration system trigger |
| Pit Limiter | 0/1 | Speed limiter engagement |
| Neutral Button | 0/1 | Emergency neutral |

---

## 11. ENVIRONMENTAL & WEATHER

| Channel | Unit | Description |
|---------|------|-------------|
| Air Temperature | °C | Ambient air temp |
| Track Surface Temperature | °C | Asphalt temperature |
| Humidity | % | Relative humidity |
| Atmospheric Pressure | mbar | Barometric pressure |
| Wind Speed | km/h | Local wind measurement |
| Wind Direction | deg | Direction relative to track |
| Rainfall Intensity | mm/h | Precipitation rate |
| Track Wetness | - | Dry / Damp / Wet |

---

## 12. TIMING & RACE STATUS

| Channel | Unit | Description |
|---------|------|-------------|
| Session Clock | s | Elapsed session time |
| Gap to Car Ahead | s | Time delta to next car |
| Gap to Car Behind | s | Time delta from following car |
| Gap to Leader | s | Time behind race leader |
| Pit Stop Duration | s | Stationary time + pit lane transit |
| Track Status Flags | - | Green / Yellow / Red / VSC / SC |
| Safety Car Deployed | 0/1 | Safety car flag |
| VSC Delta | s | Virtual safety car target delta |
| Race Position | 1-20 | Current classification position |
| Mini Sectors | s | Micro-timing between marshall posts |

---

## 13. DRIVER BIOMETRICS (Emerging / FIA Mandated)

| Channel | Unit | Description |
|---------|------|-------------|
| Heart Rate | bpm | Pulse via biometric glove sensor |
| Blood Oxygen (SpO2) | % | Oxygen saturation |
| Breathing Rate | breaths/min | Respiration monitoring |
| Core Body Temperature | °C | Thermal stress indicator |
| G-Force Exposure (cumulative) | g·s | Impact and fatigue tracking |
| Grip Force | N | Hand grip on steering wheel |
| Head Acceleration (Earpiece) | g | Potential concussion detection |

*Note: Biometric gloves have been FIA-mandated since 2018. Data is primarily used by medical teams, not yet widely used in race strategy. Sources: [FIA](https://www.fia.com/news/biometric-gloves-set-f1-debut), [NYU JIPEL](https://jipel.law.nyu.edu/the-future-of-biometrics-in-formula-1-racing/)*

---

## 14. COMMUNICATIONS & DATA SYSTEMS

| Channel | Unit | Description |
|---------|------|-------------|
| Telemetry Link Quality | % | Signal strength car-to-pit |
| Data Transmission Rate | Mbps | Live bandwidth utilization |
| On-Board Storage Status | % | Logger capacity remaining |
| ECU Diagnostic Codes | - | System fault flags |
| Sensor Health Flags | - | Per-sensor validity status |

---

## 15. PIT STOP & STRATEGY DATA

| Channel | Unit | Description |
|---------|------|-------------|
| Pit Entry/Exit Speed | km/h | Speed at pit lane lines |
| Pit Limiter Active | 0/1 | 80 km/h limiter engaged |
| Wheel Gun Torque (per corner) | Nm | Nut removal/fastening |
| Jack Contact | 0/1 | Front/rear jack engaged |
| Pit Stop Total Time | s | Stationary + reaction time |
| Tyre Set Identification | ID | Barcode/RFID on tyre |
| Pit Window (computed) | lap range | Optimal stop window from model |
| Undercut/Overcut Delta | s | Strategic advantage estimate |

---

---

# FUTURE / EMERGING TELEMETRY (What teams want or is coming)

## Near-Term (2026-2028)

| Data Area | Description | Status |
|-----------|-------------|--------|
| **Real-time tyre wear imaging** | On-car cameras or laser sensors measuring actual rubber thickness in real-time, not just inferred from thermal models | R&D / Prototype |
| **Tyre rubber compound chemical state** | Sensors detecting polymer chain degradation state for precise grip prediction | Research |
| **Active aero position sensors** | 2026 regs introduce moveable aerodynamic surfaces; position and load sensors for active front/rear wing elements | Implemented 2026 |
| **Enhanced battery degradation modeling** | Cell-level impedance spectroscopy for real-time battery aging beyond simple SOC | Near-term |
| **Driver cognitive load** | EEG-derived attention/fatigue signals to inform communication timing | Research |
| **Driver muscle fatigue (EMG)** | Electromyography in seat/gloves to detect physical fatigue onset | Research |
| **Driver vision tracking** | Eye-tracking in helmet visor to understand attention distribution | Prototype |
| **Predictive component failure** | ML models ingesting vibration, temperature, pressure trends to predict failures laps before they happen | Active development |
| **Car-to-car relative telemetry** | Real-time access to competitor proximity data (beyond GPS) for better overtake prediction | Partially available via FIA |
| **Track surface micro-grip mapping** | Lap-by-lap rubber buildup and grip evolution modeling per meter of track | Simulation + inference |



---

## DATA AVAILABLE VIA PUBLIC APIS (for hackathon use)

### FastF1 Python Library
Channels available: Speed, RPM, Gear, Throttle %, Brake %, DRS status, X/Y/Z position, lap times, sector times, tyre compound, tyre age, pit stops, weather data, track status.

Source: [FastF1 Docs](https://docs.fastf1.dev/)

### OpenF1 API
Real-time and historical: car data, driver info, intervals, laps, location, meetings, pit stops, position, race control, sessions, stints, team radio, weather.

Source: [OpenF1.org](https://openf1.org/)

---

## KEY NUMBERS

- **~300 sensors** per car
- **>1,000,000 data points/second** generated
- **~1.5 TB** of data per race weekend per car
- **~30 MB/lap** streamed live to pit wall
- **2-3x more** data offloaded via physical umbilical in pits
- **Sampling rates** range from 100 Hz to 10,000+ Hz depending on channel
- **Telemetry is one-way** (car → pit only; FIA banned car-to-track commands since 2003)

---

*Content was compiled from multiple sources and rephrased for compliance with licensing restrictions.*
