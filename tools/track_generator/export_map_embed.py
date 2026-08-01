#!/usr/bin/env python3
"""
Turn generated track_*.json files into embeddable map pages, overlaid on a
real basemap centred on RIM Park, Waterloo.

Outputs two self-contained HTML files (track coordinates are inlined, no
runtime fetch needed):

  map_google.html    -- Google Maps JavaScript API. Requires an API key
                        (see docs/map-technology.md "Setup for Hackathon").
                        This is the one to embed on your website.

  map_leaflet.html   -- Leaflet + free tile servers (OSM / Esri World
                        Imagery). No API key, no billing account -- open
                        it locally right now to see the overlay before
                        your Google Maps key is ready.

Usage:
    python3 export_map_embed.py --dir tracks/ --api-key YOUR_KEY
    python3 export_map_embed.py --dir tracks/   # key placeholder, fill in later
"""
import argparse
import glob
import json
import os

TRACK_COLORS = {
    # OSM road circuits (build_tracks_from_osm.py)
    "sprint": "#ff5252",
    "club": "#ffd600",
    "grand": "#00e5ff",
    # legacy procedural shapes (generate_tracks.py)
    "tight": "#ff5252",
    "medium": "#ffd600",
    "flowing": "#00e5ff",
}

ORDER = ["sprint", "club", "grand", "tight", "medium", "flowing"]


def load_tracks(track_dir):
    tracks = []
    for fp in glob.glob(os.path.join(track_dir, "track_*.json")):
        with open(fp) as f:
            tracks.append(json.load(f))
    if not tracks:
        raise SystemExit(
            f"No track_*.json files found in {track_dir} -- "
            "run build_tracks_from_osm.py (real roads) or generate_tracks.py (procedural) first."
        )

    def sort_key(t):
        k = t.get("key", t.get("difficulty", ""))
        return (ORDER.index(k) if k in ORDER else 99, t.get("total_distance_m", 0))

    return sorted(tracks, key=sort_key)


def track_js_data(tracks):
    """Build the inline JS array of track objects (path, color, meta)."""
    out = []
    for t in tracks:
        key = t.get("key", t.get("difficulty", ""))
        color = TRACK_COLORS.get(key, "#e0e0e0")
        path = [{"lat": p["lat"], "lng": p["lon"]} for p in t["points"]]
        path.append(path[0])  # close the loop visually
        markers = [
            {"lat": p["lat"], "lng": p["lon"], "type": p["point_type"], "label": p["label"]}
            for p in t["points"]
            if p["point_type"] != "track"
        ]
        out.append(
            {
                "name": t.get("name", key),
                "key": key,
                "color": color,
                "distance_m": t["total_distance_m"],
                "corners": t["num_corners"],
                "roads": t.get("roads", []),
                "path": path,
                "markers": markers,
            }
        )
    return out


def bounds_of(tracks_data):
    lats = [p["lat"] for t in tracks_data for p in t["path"]]
    lngs = [p["lng"] for t in tracks_data for p in t["path"]]
    return min(lats), min(lngs), max(lats), max(lngs)


GOOGLE_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>RaceMind — Track Overlay (Google Maps)</title>
<style>
  html, body {{ margin:0; padding:0; height:100%; font-family: ui-monospace, "SF Mono", Menlo, monospace; background:#000; }}
  #map {{ height:100%; width:100%; }}
  #legend {{
    position:absolute; top:12px; left:12px; z-index:5;
    background:rgba(10,10,10,0.88); border:1px solid #2e2e2e; border-radius:8px;
    padding:12px 14px; color:#e0e0e0; font-size:12px; min-width:200px;
  }}
  #legend h1 {{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#a0a0a0; margin:0 0 8px; font-weight:600; }}
  #legend .row {{ display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; user-select:none; }}
  #legend .sw {{ width:14px; height:3px; border-radius:2px; flex-shrink:0; }}
  #legend .meta {{ color:#606060; font-size:10.5px; margin-left:auto; }}
  #legend .row.off {{ opacity:0.35; }}
</style>
</head>
<body>
<div id="map"></div>
<div id="legend">
  <h1>RaceMind test tracks</h1>
  {legend_rows}
</div>
<script>
  const TRACKS = {tracks_json};
  const CENTER = {{ lat: {center_lat}, lng: {center_lon} }};

  const BOUNDS = {{ south: {min_lat}, west: {min_lon}, north: {max_lat}, east: {max_lon} }};

  let map;
  const layers = [];  // one entry per track: all overlays belonging to it

  function initMap() {{
    map = new google.maps.Map(document.getElementById("map"), {{
      center: CENTER,
      zoom: 16,
      mapTypeId: "hybrid",
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    }});
    map.fitBounds(BOUNDS, 48);

    TRACKS.forEach(track => {{
      const group = [];
      // dark casing under the coloured line so it reads over satellite imagery
      group.push(new google.maps.Polyline({{
        path: track.path, strokeColor: "#000", strokeOpacity: 0.55,
        strokeWeight: 8, map: map, zIndex: 1,
      }}));
      group.push(new google.maps.Polyline({{
        path: track.path, strokeColor: track.color, strokeOpacity: 0.95,
        strokeWeight: 4, map: map, zIndex: 2,
      }}));

      track.markers.forEach(m => {{
        group.push(new google.maps.Marker({{
          position: {{ lat: m.lat, lng: m.lng }},
          map: map,
          title: `${{track.name}} — ${{m.label || m.type}}`,
          zIndex: 3,
          icon: {{
            path: google.maps.SymbolPath.CIRCLE,
            scale: m.type === "start_finish" ? 7 : 5,
            fillColor: m.type === "start_finish" ? "#d50000" : "#ffab00",
            fillOpacity: 1,
            strokeColor: "#000",
            strokeWeight: 1.5,
          }},
        }}));
      }});
      layers.push(group);
    }});

    document.querySelectorAll("#legend .row").forEach((row, i) => {{
      row.addEventListener("click", () => {{
        const visible = !row.classList.contains("off");
        layers[i].forEach(o => o.setMap(visible ? null : map));
        row.classList.toggle("off", visible);
      }});
    }});
  }}
  window.initMap = initMap;
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key={api_key}&callback=initMap"></script>
</body>
</html>
"""

LEAFLET_TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>RaceMind — Track Overlay (no API key)</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body {{ margin:0; padding:0; height:100%; font-family: ui-monospace, "SF Mono", Menlo, monospace; background:#000; }}
  #map {{ height:100%; width:100%; }}
  #legend {{
    position:absolute; top:12px; left:12px; z-index:1000;
    background:rgba(10,10,10,0.88); border:1px solid #2e2e2e; border-radius:8px;
    padding:12px 14px; color:#e0e0e0; font-size:12px; min-width:200px;
  }}
  #legend h1 {{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#a0a0a0; margin:0 0 8px; font-weight:600; }}
  #legend .row {{ display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; user-select:none; }}
  #legend .sw {{ width:14px; height:3px; border-radius:2px; flex-shrink:0; }}
  #legend .meta {{ color:#606060; font-size:10.5px; margin-left:auto; }}
  #legend .row.off {{ opacity:0.35; }}
  #legend .note {{ color:#606060; font-size:10px; margin-top:8px; border-top:1px solid #2e2e2e; padding-top:8px; line-height:1.5; }}
</style>
</head>
<body>
<div id="map"></div>
<div id="legend">
  <h1>RaceMind test tracks</h1>
  {legend_rows}
  <div class="note">No API key needed — Esri World Imagery satellite tiles. Swap for the Google Maps version (map_google.html) once you have a key.</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const TRACKS = {tracks_json};
  const CENTER = [{center_lat}, {center_lon}];

  const BOUNDS = [[{min_lat}, {min_lon}], [{max_lat}, {max_lon}]];

  const map = L.map("map", {{ zoomControl: true }}).setView(CENTER, 16);

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}",
    {{ attribution: "Tiles &copy; Esri", maxZoom: 19 }}
  ).addTo(map);
  const roadmap = L.tileLayer(
    "https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png",
    {{ attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }}
  );
  L.control.layers({{ "Satellite": satellite, "Roadmap": roadmap }}).addTo(map);
  map.fitBounds(BOUNDS, {{ padding: [40, 40] }});

  const layers = [];
  TRACKS.forEach(track => {{
    const latlngs = track.path.map(p => [p.lat, p.lng]);
    const group = L.layerGroup().addTo(map);
    // dark casing so the coloured line reads over satellite imagery
    L.polyline(latlngs, {{ color: "#000", weight: 8, opacity: 0.55 }}).addTo(group);
    L.polyline(latlngs, {{ color: track.color, weight: 4, opacity: 0.95 }})
      .addTo(group)
      .bindTooltip(`${{track.name}} — ${{track.distance_m}}m, ${{track.corners}} corners`);

    track.markers.forEach(m => {{
      L.circleMarker([m.lat, m.lng], {{
        radius: m.type === "start_finish" ? 7 : 5,
        fillColor: m.type === "start_finish" ? "#d50000" : "#ffab00",
        fillOpacity: 1,
        color: "#000",
        weight: 1.5,
      }}).addTo(group).bindTooltip(`${{track.name}} — ${{m.label || m.type}}`);
    }});
    layers.push(group);
  }});

  document.querySelectorAll("#legend .row").forEach((row, i) => {{
    row.addEventListener("click", () => {{
      const visible = map.hasLayer(layers[i]);
      if (visible) map.removeLayer(layers[i]); else map.addLayer(layers[i]);
      row.classList.toggle("off", visible);
    }});
  }});
</script>
</body>
</html>
"""


def build_legend_rows(tracks_data):
    rows = []
    for t in tracks_data:
        title = t["key"].title() if t["key"] else t["name"]
        roads = ", ".join(t["roads"])
        tip = f' title="{roads}"' if roads else ""
        rows.append(
            f'<div class="row"{tip}><span class="sw" style="background:{t["color"]};"></span>'
            f'{title}<span class="meta">{t["distance_m"]:.0f}m · {t["corners"]}c</span></div>'
        )
    return "\n  ".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "tracks"))
    ap.add_argument("--api-key", default="YOUR_GOOGLE_MAPS_API_KEY")
    ap.add_argument("--out-google", default=None)
    ap.add_argument("--out-leaflet", default=None)
    args = ap.parse_args()

    tracks = load_tracks(args.dir)
    tracks_data = track_js_data(tracks)
    min_lat, min_lon, max_lat, max_lon = bounds_of(tracks_data)
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2
    legend_rows = build_legend_rows(tracks_data)
    tracks_json = json.dumps(tracks_data)

    out_google = args.out_google or os.path.join(args.dir, "..", "map_google.html")
    out_leaflet = args.out_leaflet or os.path.join(args.dir, "..", "map_leaflet.html")

    fmt = dict(
        legend_rows=legend_rows,
        tracks_json=tracks_json,
        center_lat=round(center_lat, 7),
        center_lon=round(center_lon, 7),
        min_lat=round(min_lat, 7),
        min_lon=round(min_lon, 7),
        max_lat=round(max_lat, 7),
        max_lon=round(max_lon, 7),
    )

    with open(out_google, "w") as f:
        f.write(GOOGLE_TEMPLATE.format(api_key=args.api_key, **fmt))
    with open(out_leaflet, "w") as f:
        f.write(LEAFLET_TEMPLATE.format(**fmt))

    print(f"Wrote {os.path.abspath(out_google)}")
    print(f"Wrote {os.path.abspath(out_leaflet)}")
    if args.api_key == "YOUR_GOOGLE_MAPS_API_KEY":
        print("\nNo --api-key passed -- map_google.html has a placeholder key and will show a")
        print("'For development purposes only' watermark until you fill it in (see docs/map-technology.md).")


if __name__ == "__main__":
    main()
