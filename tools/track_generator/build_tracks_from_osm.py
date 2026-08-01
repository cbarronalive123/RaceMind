#!/usr/bin/env python3
"""
Build RaceMind test tracks from REAL road geometry around RIM Park, Waterloo.

Unlike the procedural generator (generate_tracks.py), every point here comes
from OpenStreetMap road centrelines, so the tracks lie exactly on real
pavement when overlaid on Google Maps / satellite imagery.

How it works:
  1. Fetch highway ways in a bbox around RIM Park from Overpass (cached).
  2. Build an undirected graph, snapping shared endpoints.
  3. Reduce to the 2-core (drop dead-end spurs).
  4. Enumerate fundamental cycles (remove edge -> shortest path between its
     endpoints) to find genuine closed road circuits.
  5. Match circuits against the named presets below, resample at even
     spacing, tag start/finish + sector lines, and export.

Outputs per track: <name>.json (RaceMind track_points shape) + <name>.gpx,
plus a combined preview.svg.

Usage:
    python3 build_tracks_from_osm.py                # uses cache if present
    python3 build_tracks_from_osm.py --refresh      # re-query Overpass
"""
import argparse
import heapq
import json
import math
import os
import subprocess
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "osm_roads_cache.json")

# RIM Park, Waterloo ON -- OSM park relation centroid (id 9062632)
PARK_CENTER = (43.5168813, -80.4964103)
BBOX = (43.5100, -80.5150, 43.5250, -80.4890)  # S, W, N, E

EARTH_R = 6371000.0

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

QUERY = f"""[out:json][timeout:90];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street)$"]
  ({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
out geom;
"""

# Circuits to export. `require` names must all appear in the circuit;
# `exclude` names must not appear at all (keeps the short loop from wandering
# into the residential subdivisions NE of the park). Ordered short -> long.
_SUBDIVISION_ROADS = {
    "Grey Silo Road", "Crossgate Boulevard", "Cider Mill Drive", "Oak Park Drive",
    "Country Squire Road", "Country Squire Lane", "243 Grey Silo Road",
    "New Bedford Drive", "New Hampshire Street", "Deerfoot Trail",
    "Labrador Drive", "Rim Campus Lane",
}

PRESETS = [
    {
        # Millennium Blvd is a divided boulevard -- up one carriageway, back the
        # other. Shortest usable loop and literally "around Millennium Blvd".
        "key": "sprint",
        "name": "Millennium Boulevard Sprint",
        "require": {"Millennium Boulevard"},
        "exclude": _SUBDIVISION_ROADS | {"Park Road", "University Avenue East"},
        "target_len": 774,
        "spacing": 8.0,
    },
    {
        # The loop around the Manulife Sportsplex / RIM Park main building.
        "key": "club",
        "name": "RIM Park Club Circuit",
        "require": {"Millennium Boulevard", "Park Road", "University Avenue East"},
        "exclude": _SUBDIVISION_ROADS,
        "target_len": 1220,
        "spacing": 10.0,
    },
    {
        "key": "grand",
        "name": "RIM Park Grand Circuit",
        "require": {"Millennium Boulevard", "Country Squire Road", "University Avenue East"},
        "exclude": set(),
        "target_len": 2962,
        "spacing": 12.0,
    },
]


# ---------- geo helpers ----------

def hav(a, b):
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    return 2 * EARTH_R * math.asin(math.sqrt(
        math.sin((la2 - la1) / 2) ** 2
        + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    ))


def local_xy(p, lat0):
    x = math.radians(p[1]) * EARTH_R * math.cos(math.radians(lat0))
    y = math.radians(p[0]) * EARTH_R
    return x, y


def polygon_area_m2(poly):
    lat0 = sum(p[0] for p in poly) / len(poly)
    pts = [local_xy(p, lat0) for p in poly]
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


# ---------- fetch ----------

def fetch_roads(refresh=False):
    if os.path.exists(CACHE) and not refresh:
        with open(CACHE) as f:
            return json.load(f)
    last_err = None
    for host in OVERPASS_MIRRORS:
        try:
            print(f"querying {host} ...", file=sys.stderr)
            out = subprocess.run(
                ["curl", "-s", "--max-time", "90", "-X", "POST", host, "--data-binary", "@-"],
                input=QUERY.encode(), capture_output=True, timeout=120,
            ).stdout
            data = json.loads(out.decode())
            if data.get("elements"):
                with open(CACHE, "w") as f:
                    json.dump(data, f)
                print(f"cached {len(data['elements'])} ways -> {CACHE}", file=sys.stderr)
                return data
            last_err = "no elements returned"
        except Exception as e:  # noqa: BLE001 - mirror fallback is the point
            last_err = e
    raise SystemExit(f"Could not fetch OSM road data: {last_err}")


# ---------- graph + cycles ----------

SNAP = 6


def nkey(lat, lon):
    return (round(lat, SNAP), round(lon, SNAP))


def build_graph(data):
    adj = defaultdict(list)
    names = {}
    for el in data["elements"]:
        g = el.get("geometry")
        if not g or len(g) < 2:
            continue
        name = el.get("tags", {}).get("name", "")
        pts = [(p["lat"], p["lon"]) for p in g]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ka, kb = nkey(*a), nkey(*b)
            if ka == kb:
                continue
            L = hav(a, b)
            adj[ka].append((kb, L, [a, b]))
            adj[kb].append((ka, L, [b, a]))
            names[frozenset((ka, kb))] = name
    return adj, names


def two_core(adj):
    removed = set()
    changed = True
    while changed:
        changed = False
        for n in list(adj):
            if n in removed:
                continue
            nbrs = {m for m, _, _ in adj[n] if m not in removed}
            if len(nbrs) <= 1:
                removed.add(n)
                changed = True
    return {n: [(m, L, pl) for m, L, pl in adj[n] if m not in removed]
            for n in adj if n not in removed}


def dijkstra(core, src, banned):
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        dcur, u = heapq.heappop(pq)
        if dcur > dist.get(u, float("inf")):
            continue
        for v, L, pl in core.get(u, []):
            if frozenset((u, v)) == banned:
                continue
            nd = dcur + L
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = (u, pl)
                heapq.heappush(pq, (nd, v))
    return dist, prev


def find_cycles(core, names, min_len=600, max_len=4200):
    seen = set()
    cycles = []
    for u in core:
        for v, L, pl in core[u]:
            e = frozenset((u, v))
            if e in seen:
                continue
            seen.add(e)
            dist, prev = dijkstra(core, u, e)
            if v not in dist:
                continue
            total = dist[v] + L
            if not (min_len <= total <= max_len):
                continue
            poly, cur, guard = [], v, 0
            road_names = set()
            while cur != u and guard < 20000:
                p, seg = prev[cur]
                poly.extend(reversed(seg))
                nm = names.get(frozenset((cur, p)), "")
                if nm:
                    road_names.add(nm)
                cur = p
                guard += 1
            if cur != u:
                continue
            poly.extend(pl[1:])
            if len(poly) < 6:
                continue
            nm = names.get(e, "")
            if nm:
                road_names.add(nm)
            cycles.append({
                "length": total,
                "area": polygon_area_m2(poly),
                "poly": poly,
                "names": road_names,
            })
    # dedupe near-identical cycles
    uniq = {}
    for c in cycles:
        k = (round(c["length"] / 25), round(c["area"] / 2500))
        if k not in uniq or len(c["poly"]) > len(uniq[k]["poly"]):
            uniq[k] = c
    return list(uniq.values())


# ---------- track assembly ----------

def resample_closed(poly, spacing_m):
    pts = list(poly)
    if hav(pts[0], pts[-1]) > 1.0:
        pts.append(pts[0])
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + hav(pts[i], pts[i + 1]))
    total = cum[-1]
    n_out = max(int(total // spacing_m), 12)
    out = []
    idx = 0
    for k in range(n_out):
        target = k * total / n_out
        while idx < len(cum) - 2 and cum[idx + 1] < target:
            idx += 1
        seg = cum[idx + 1] - cum[idx]
        frac = 0.0 if seg <= 0 else (target - cum[idx]) / seg
        a, b = pts[idx], pts[idx + 1]
        out.append((a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac))
    return out, total


def count_corners(path, angle_thresh_deg=30, window_m=50, spacing_m=10.0):
    win = max(1, int(round(window_m / spacing_m)))
    n = len(path)
    lat0 = sum(p[0] for p in path) / n
    xy = [local_xy(p, lat0) for p in path]
    corners, in_corner = 0, False
    for i in range(n):
        x0, y0 = xy[(i - win) % n]
        x1, y1 = xy[i]
        x2, y2 = xy[(i + win) % n]
        v1 = (x1 - x0, y1 - y0)
        v2 = (x2 - x1, y2 - y1)
        d1, d2 = math.hypot(*v1), math.hypot(*v2)
        if d1 == 0 or d2 == 0:
            continue
        cosang = max(-1.0, min(1.0, (v1[0]*v2[0] + v1[1]*v2[1]) / (d1*d2)))
        ang = math.degrees(math.acos(cosang))
        if ang > angle_thresh_deg and not in_corner:
            corners += 1
            in_corner = True
        elif ang <= angle_thresh_deg:
            in_corner = False
    return corners


def make_track(cycle, preset):
    path, total = resample_closed(cycle["poly"], preset["spacing"])
    corners = count_corners(path, spacing_m=preset["spacing"])
    n = len(path)
    s1, s2 = n // 3, (2 * n) // 3
    points = []
    for i, (lat, lon) in enumerate(path):
        ptype, label = "track", None
        if i == 0:
            ptype, label = "start_finish", "Start/Finish"
        elif i == s1:
            ptype, label = "sector_line", "Sector 1/2 boundary"
        elif i == s2:
            ptype, label = "sector_line", "Sector 2/3 boundary"
        points.append({"seq": i, "lat": round(lat, 7), "lon": round(lon, 7),
                       "point_type": ptype, "label": label})
    lats = [p[0] for p in path]
    lons = [p[1] for p in path]
    return {
        "name": preset["name"],
        "key": preset["key"],
        "source": "OpenStreetMap road centrelines (real pavement)",
        "roads": sorted(cycle["names"]),
        "total_distance_m": round(total, 1),
        "num_corners": corners,
        "center": {"lat": round(sum(lats)/len(lats), 7), "lon": round(sum(lons)/len(lons), 7)},
        "bounds": {"min_lat": round(min(lats), 7), "max_lat": round(max(lats), 7),
                   "min_lon": round(min(lons), 7), "max_lon": round(max(lons), 7)},
        "points": points,
    }


def pick(cycles, preset):
    exclude = preset.get("exclude", set())
    scored = []
    for c in cycles:
        if not preset["require"].issubset(c["names"]):
            continue
        if exclude & c["names"]:
            continue
        scored.append((abs(c["length"] - preset["target_len"]), c))
    if not scored:
        return None
    scored.sort(key=lambda t: t[0])
    return scored[0][1]


def write_gpx(track, path_out):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="RaceMind OSM track builder">',
             f'  <trk><name>{track["name"]}</name><trkseg>']
    for pt in track["points"]:
        lines.append(f'    <trkpt lat="{pt["lat"]}" lon="{pt["lon"]}"></trkpt>')
    first = track["points"][0]
    lines.append(f'    <trkpt lat="{first["lat"]}" lon="{first["lon"]}"></trkpt>')
    lines += ["  </trkseg></trk>", "</gpx>"]
    with open(path_out, "w") as f:
        f.write("\n".join(lines))


def build_svg(tracks, path_out, tile=420, pad=38):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{tile*len(tracks)}" '
             f'height="{tile+30}" viewBox="0 0 {tile*len(tracks)} {tile+30}" font-family="monospace">',
             '<rect width="100%" height="100%" fill="#0a0a0a"/>']
    for i, t in enumerate(tracks):
        pts = [(p["lat"], p["lon"]) for p in t["points"]]
        lat0 = sum(p[0] for p in pts) / len(pts)
        xy = [local_xy(p, lat0) for p in pts]
        xs = [p[0] for p in xy]; ys = [p[1] for p in xy]
        span = max(max(xs)-min(xs), max(ys)-min(ys), 1.0)
        sc = (tile - 2*pad) / span
        px = [(x-min(xs))*sc + pad for x in xs]
        py = [tile - ((y-min(ys))*sc + pad) for y in ys]
        parts.append(f'<g transform="translate({i*tile},0)">')
        parts.append(f'<text x="{tile/2}" y="18" fill="#e0e0e0" font-size="12" text-anchor="middle">'
                     f'{t["key"].upper()} — {t["total_distance_m"]}m, {t["num_corners"]} corners</text>')
        parts.append('<g transform="translate(0,25)">')
        poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(px, py))
        parts.append(f'<polygon points="{poly}" fill="none" stroke="#3a3a3a" stroke-width="2.5"/>')
        for p, x, y in zip(t["points"], px, py):
            if p["point_type"] == "start_finish":
                parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#d50000"/>')
            elif p["point_type"] == "sector_line":
                parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#ffab00"/>')
        parts.append("</g></g>")
    parts.append("</svg>")
    with open(path_out, "w") as f:
        f.write("\n".join(parts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-query Overpass instead of using cache")
    ap.add_argument(
        "--out",
        default=os.path.join(HERE, "..", "..", "data", "tracks"),
        help="canonical output dir; data/tracks is the single source of "
             "truth shared by the website and the driver app",
    )
    args = ap.parse_args()

    data = fetch_roads(refresh=args.refresh)
    adj, names = build_graph(data)
    core = two_core(adj)
    print(f"graph {len(adj)} nodes -> 2-core {len(core)} nodes", file=sys.stderr)
    cycles = find_cycles(core, names)
    print(f"{len(cycles)} distinct road circuits found", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    # clear stale output so the dir only holds the tracks built this run.
    # index.json is regenerated below; everything else is disposable.
    for old in os.listdir(args.out):
        if old == "index.json":
            continue
        if old.endswith((".json", ".gpx", ".svg")):
            os.remove(os.path.join(args.out, old))

    tracks = []
    for preset in PRESETS:
        c = pick(cycles, preset)
        if not c:
            print(f"  !! no circuit matched preset '{preset['key']}' "
                  f"(needs {sorted(preset['require'])})", file=sys.stderr)
            continue
        t = make_track(c, preset)
        tracks.append(t)
        base = os.path.join(args.out, preset["key"])
        with open(f"{base}.json", "w") as f:
            json.dump(t, f, indent=2)
        write_gpx(t, f"{base}.gpx")
        print(f"  {preset['key']:7s} {t['total_distance_m']:7.1f}m  "
              f"{t['num_corners']:2d} corners  {len(t['points']):3d} pts  "
              f"via {', '.join(t['roads'])}")

    if not tracks:
        raise SystemExit("No tracks built -- check presets against the circuit list.")

    build_svg(tracks, os.path.join(args.out, "preview.svg"))
    print(f"\nWrote {len(tracks)} tracks + preview.svg to {args.out}")


if __name__ == "__main__":
    main()
