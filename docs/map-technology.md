# Map Technology Decision

## The Question

We need a 3D map view with satellite imagery AND 3D buildings that displays a racing track traced by the mobile app. The website renders the track and lets users mark key points (start/finish, pit, sectors, DRS zones) — but the track path itself comes from physically walking/driving it with the phone.

---

## Recommendation: Google Maps Platform — Photorealistic 3D Maps

**Why Google wins for this project:**

Google's `Map3DElement` (their new 3D Maps for JavaScript API) gives you photorealistic 3D buildings, terrain, and satellite imagery out of the box — it looks like Google Earth in a browser. This is the closest thing to "satellite view with 3D buildings" that exists. Mapbox has extruded building footprints (blocky shapes), but Google has actual textured photogrammetry meshes of real buildings.

---

## Comparison

| Feature | Google Maps 3D (Map3DElement) | Mapbox GL JS v3 |
|---------|-------------------------------|-----------------|
| **3D Buildings** | Photorealistic textured meshes (Google Earth quality) | Extruded footprints (blocky, untextured) + landmark models for famous buildings |
| **Satellite Imagery** | Full Google satellite/aerial coverage | Mapbox satellite (good but less detail in some areas) |
| **Terrain** | Full 3D terrain (photogrammetry) | DEM-based terrain (elevation mesh with draped satellite) |
| **Polylines in 3D** | `Polyline3DElement` — draws lines at altitude | Standard line layers (2D on surface or with some hacks) |
| **3D Markers** | `Marker3DInteractiveElement` (clickable, custom) | Standard markers (2D unless using Three.js plugin) |
| **Camera Control** | Tilt, heading, zoom, fov, position (orbit around track) | Pitch, bearing, zoom (good but less cinematic) |
| **Flythrough/Animation** | Built-in `flyCameraTo` + `flyCameraAround` methods | Custom animation via `flyTo` + easing |
| **Performance** | Streams 3D tiles — heavier on GPU, needs decent hardware | WebGL vector tiles — lighter, works on low-end |
| **React Integration** | `@vis.gl/react-google-maps` (community) | `react-map-gl` (Uber, very mature) |
| **Free Tier** | ~10,000 loads/month free (per SKU) + $3,250/mo credit equiv | 50,000 map loads/month free |
| **For a hackathon** | More than enough free — you'll use maybe 100 loads total | Also more than enough free |

---

## Why Not Mapbox?

1. **3D buildings look blocky** — extruded polygons, not real building textures. For a demo that's supposed to feel like "looking at a real race track from above," Google's photorealistic 3D is dramatically more impressive.

2. **The hackathon is sponsored by Google DeepMind** — using Google Maps Platform is a natural fit. Judges from Google will recognize and appreciate it.

3. **Satellite + 3D in one view** — Google combines satellite imagery with 3D building meshes natively. In Mapbox you'd need to layer satellite tiles under extruded buildings, which looks less cohesive.

---

## Track Creation Method: Mobile GPS Trace

**No manual drawing.** The track is created by physically walking/driving it with the phone. This produces a clean, accurate, real-world GPS path.

### Flow

```
1. User opens Mobile App → "Trace Track" mode
2. User taps "Start Tracing" and walks/drives the track path
3. Phone records GPS at 10 Hz (high-accuracy mode)
4. User taps "Stop Tracing" when back at start
5. App sends raw GPS trace to backend
6. Backend smooths the path (Ramer-Douglas-Peucker + cubic spline)
7. Backend auto-connects start → finish into a closed loop
8. Track appears on Website 3D map as a clean polyline
9. User clicks on the rendered track to mark key points:
   - Start/Finish line
   - Sector 1/2 boundaries
   - Pit entry / Pit exit
   - DRS zones (detection, activation, end)
```

### Why This Is Better Than Drawing

| Manual Drawing | GPS Trace |
|---------------|-----------|
| Imprecise (clicking on a map) | Meter-accurate (real GPS path) |
| Looks amateur (jagged lines) | Smooth curves (spline-fitted) |
| Doesn't follow actual roads/paths | IS the actual road/path |
| Hard to get corners right | Corners captured naturally |
| Slow (clicking dozens of points) | Fast (just walk/drive it once) |

### Path Smoothing (Backend)

The raw GPS trace will have jitter. Backend cleans it up:

```python
def smooth_track_trace(raw_points):
    """
    raw_points: list of {lat, lon, ts} from phone GPS at 10 Hz
    Returns: clean list of {lat, lon, elevation} for the track
    """
    # 1. Remove obvious outliers (points that jump > 10m from neighbors)
    cleaned = remove_outliers(raw_points, max_jump_m=10.0)
    
    # 2. Reduce point density (Ramer-Douglas-Peucker algorithm)
    #    Keeps shape but reduces 1000s of points to ~200-500
    simplified = rdp_simplify(cleaned, epsilon=2.0)  # 2m tolerance
    
    # 3. Smooth with cubic spline interpolation
    #    Produces racing-line smooth curves through the simplified points
    smoothed = cubic_spline_interpolate(simplified, num_output_points=500)
    
    # 4. Close the loop: blend last 20m into first 20m
    #    So start and finish connect seamlessly
    closed = close_loop(smoothed, blend_distance_m=20.0)
    
    # 5. Resample at even spacing (every ~10m)
    final = resample_even_spacing(closed, spacing_m=10.0)
    
    return final

def close_loop(points, blend_distance_m=20.0):
    """Smoothly connect the end back to the start."""
    start = points[0]
    end = points[-1]
    gap = haversine(start, end)
    
    if gap < blend_distance_m:
        # Close enough — just snap end to start and smooth the join
        # Use weighted average for last N points approaching start
        blend_points = get_points_within_distance(points, end, blend_distance_m)
        for i, p in enumerate(blend_points):
            weight = i / len(blend_points)  # 0 at end → 1 at blend start
            p.lat = p.lat * weight + start.lat * (1 - weight)
            p.lon = p.lon * weight + start.lon * (1 - weight)
        points[-1] = start  # final point = start point
    else:
        # Gap too large — interpolate straight line from end to start
        bridge = interpolate_line(end, start, spacing_m=10.0)
        points.extend(bridge)
    
    return points
```

### Auto-Calculated Track Specs (from GPS trace)

Once the trace is processed, the backend auto-computes:

| Spec | How | Stored In |
|------|-----|-----------|
| Total distance | Sum of point-to-point distances | `tracks.total_distance_m` |
| Corner count | Curvature analysis (heading change > 30° over 50m) | `tracks.num_corners` |
| Elevation range | Min/max altitude from GPS | `tracks.elevation_min/max_m` |
| Track center | Centroid of all points | Used for camera positioning |
| Bounding box | Min/max lat/lon | Used for map viewport |

---

## Website: Rendering & Marking

The website **does not draw** the track. It:
1. **Receives** the processed GPS trace from backend
2. **Renders** it as a `Polyline3DElement` on the 3D map
3. **Lets the user click** on the track to place key markers

### Marker Placement (click on track)

```javascript
// User clicks on the rendered track polyline
polyline.addEventListener('gmp-click', (event) => {
  const clickedPoint = event.position;
  
  // Show marker type selector
  showMarkerMenu(clickedPoint, [
    { type: 'start_finish', label: 'Start/Finish', icon: '🏁' },
    { type: 'sector_line', label: 'Sector Boundary', icon: '━' },
    { type: 'pit_entry', label: 'Pit Entry', icon: '🔵→' },
    { type: 'pit_exit', label: 'Pit Exit', icon: '←🔵' },
    { type: 'drs_detection', label: 'DRS Detection', icon: '👁' },
    { type: 'drs_start', label: 'DRS Activation', icon: '🟣' },
    { type: 'drs_end', label: 'DRS End', icon: '✕' },
  ]);
});
```

### Pin Types

| Pin | Color | Icon | Purpose |
|-----|-------|------|---------|
| Start/Finish | Checkered | Flag | Lap crossing detection |
| Sector boundary | Yellow | Line | S1/S2/S3 splits |
| Pit entry | Blue | Arrow-in | Where pit lane begins |
| Pit exit | Blue | Arrow-out | Where pit lane ends |
| DRS detection | Purple | Eye | Gap measurement point |
| DRS activation | Purple | Wing | Where DRS can open |
| DRS end | Purple | X | Where DRS must close |

---

## Camera Presets for Track Views

```javascript
// Overview: see entire track from above at angle
map3d.flyCameraTo({
  endCamera: {
    center: trackCenter,
    tilt: 55,
    heading: 0,
    range: 2000,
  },
  durationMillis: 2000,
});

// Flythrough: orbit around track
map3d.flyCameraAround({
  camera: { center: trackCenter, tilt: 65, range: 800 },
  durationMillis: 20000,
  rounds: 1,
});

// Follow car (during live race): snap to car position
function followCar(carPosition, carHeading) {
  map3d.flyCameraTo({
    endCamera: {
      center: carPosition,
      tilt: 70,
      heading: carHeading - 180,
      range: 150,
    },
    durationMillis: 500,
  });
}
```

---

## Setup for Hackathon

### 1. Get API Key
- Go to [Google Cloud Console](https://console.cloud.google.com/google/maps-apis)
- Enable: Maps JavaScript API + Map Tiles API (for 3D Tiles)
- Create API key, restrict to your domain

### 2. Install

```bash
npm install @googlemaps/js-api-loader
```

### 3. Basic Setup

```html
<gmp-map-3d
  center="43.7325,-79.6214"
  tilt="67"
  heading="30"
  range="1500"
  default-labels-disabled
>
</gmp-map-3d>
```

```javascript
import { Loader } from '@googlemaps/js-api-loader';

const loader = new Loader({
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY,
  version: 'alpha',
  libraries: ['maps3d'],
});

await loader.load();
```

---

## Fallback: Mapbox (if Google 3D has issues)

```
Mapbox GL JS v3
├── Satellite basemap (mapbox://styles/mapbox/satellite-streets-v12)
├── 3D terrain (setTerrain with raster-dem source)
├── Extruded buildings (fill-extrusion layer from Streets source)
└── Standard line/circle layers for track + markers
```

Less visually impressive but faster load times and more reliable.

---

## Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| **Primary map** | Google Maps 3D (`Map3DElement`) | Photorealistic buildings + satellite = most impressive demo |
| **Track path source** | Mobile app GPS trace | Accurate, smooth, real-world path — no drawing needed |
| **Path smoothing** | Backend (RDP + cubic spline + loop closure) | Clean professional result from raw GPS |
| **Key point marking** | Website clicks on rendered track | User marks start/finish, sectors, pit, DRS on the 3D polyline |
| **Pins/markers** | `Marker3DInteractiveElement` | Clickable, labeled, color-coded |
| **Track polyline** | `Polyline3DElement` | Floats above ground, visible in 3D |
| **Camera** | `flyCameraTo` / `flyCameraAround` | Cinematic track overview + car chase view |
| **Fallback** | Mapbox GL JS v3 | If Google 3D is unreliable |
| **Cost** | Free for hackathon volume | Way under free tier limits |

---

*The track is traced by walking it — real GPS data, professionally smoothed. The website renders it beautifully in photorealistic 3D. No janky hand-drawing.*
