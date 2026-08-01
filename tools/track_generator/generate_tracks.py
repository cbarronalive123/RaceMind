#!/usr/bin/env python3
"""
Generate procedural closed-loop race track GPS data anchored near
Millennium Blvd / RIM Park, Waterloo ON -- for RaceMind local testing.

No third-party dependencies. Outputs JSON (matching the RaceMind
track_points shape from docs/database-schema.md) plus GPX, plus a
dependency-free SVG preview you can open in any browser.

Usage:
    python3 generate_tracks.py --seed 1 --count 3 --out tracks/
"""
import argparse
import json
import math
import os
import random

# Real geocoded coordinates for RIM Park, 2001 University Ave E,
# Waterloo, ON N2K 4K4, Canada (matches the pin in the reference
# screenshot, near the Millennium Blvd loop path). Good for generating
# and previewing test tracks -- still verify with a live GPS fix on-site
# before race day, since the mobile app's own trace-track flow is the
# source of truth for the real track shape.
CENTER_LAT = 43.51731
CENTER_LON = -80.505752

EARTH_R = 6371000.0  # meters


def meters_to_latlon(dx, dy, lat0=CENTER_LAT, lon0=CENTER_LON):
    """dx = east meters, dy = north meters -> (lat, lon)."""
    dlat = (dy / EARTH_R) * (180.0 / math.pi)
    dlon = (dx / (EARTH_R * math.cos(math.radians(lat0)))) * (180.0 / math.pi)
    return lat0 + dlat, lon0 + dlon


def catmull_rom_point(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    x = 0.5 * (
        (2 * p1[0])
        + (-p0[0] + p2[0]) * t
        + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
        + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
    )
    y = 0.5 * (
        (2 * p1[1])
        + (-p0[1] + p2[1]) * t
        + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
        + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
    )
    return x, y


def generate_control_points(rng, n_points, min_r, max_r, irregularity):
    """
    Place n control points around a circle with randomized angular spacing
    and radius, so the resulting loop has straights and corners rather than
    being a perfect circle. Classic procedural-track approach.
    """
    lower = (2 * math.pi / n_points) - irregularity
    upper = (2 * math.pi / n_points) + irregularity
    total = 0.0
    cum = []
    for _ in range(n_points):
        total += rng.uniform(lower, upper)
        cum.append(total)
    cum = [c * (2 * math.pi / total) for c in cum]  # normalize to full circle

    points = []
    for c in cum:
        r = rng.uniform(min_r, max_r)
        points.append((r * math.cos(c), r * math.sin(c)))
    return points


def smooth_closed_path(points, samples_per_seg=24):
    n = len(points)
    path = []
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i % n]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n]
        for s in range(samples_per_seg):
            path.append(catmull_rom_point(p0, p1, p2, p3, s / samples_per_seg))
    return path


def resample_even(path, spacing_m=10.0):
    """Resample a closed path at even arc-length spacing."""
    n = len(path)
    cum = [0.0]
    for i in range(n):
        x1, y1 = path[i]
        x2, y2 = path[(i + 1) % n]
        cum.append(cum[-1] + math.hypot(x2 - x1, y2 - y1))
    total = cum[-1]
    n_out = max(int(total // spacing_m), 8)

    out = []
    idx = 0
    for k in range(n_out):
        target = (k * total) / n_out
        while cum[idx + 1] < target:
            idx += 1
        seg_len = cum[idx + 1] - cum[idx]
        frac = 0.0 if seg_len == 0 else (target - cum[idx]) / seg_len
        x1, y1 = path[idx % n]
        x2, y2 = path[(idx + 1) % n]
        out.append((x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac))
    return out, total


def detect_corners(path, angle_thresh_deg=30, window_m=50, spacing_m=10.0):
    win = max(1, int(round(window_m / spacing_m)))
    n = len(path)
    corners = 0
    in_corner = False
    for i in range(n):
        x0, y0 = path[(i - win) % n]
        x1, y1 = path[i]
        x2, y2 = path[(i + win) % n]
        v1 = (x1 - x0, y1 - y0)
        v2 = (x2 - x1, y2 - y1)
        d1, d2 = math.hypot(*v1), math.hypot(*v2)
        if d1 == 0 or d2 == 0:
            continue
        cosang = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (d1 * d2)))
        ang = math.degrees(math.acos(cosang))
        if ang > angle_thresh_deg and not in_corner:
            corners += 1
            in_corner = True
        elif ang <= angle_thresh_deg:
            in_corner = False
    return corners


PROFILES = {
    # n control points, radius range (m), angular irregularity, point spacing (m)
    "tight": dict(n=9, min_r=90, max_r=170, irregularity=0.6, spacing=8.0),
    "medium": dict(n=11, min_r=140, max_r=260, irregularity=0.5, spacing=10.0),
    "flowing": dict(n=8, min_r=180, max_r=320, irregularity=0.3, spacing=10.0),
}


def make_track(seed, difficulty="medium"):
    rng = random.Random(seed)
    p = PROFILES[difficulty]
    ctrl = generate_control_points(rng, p["n"], p["min_r"], p["max_r"], p["irregularity"])
    raw_path = smooth_closed_path(ctrl)
    path, total_len = resample_even(raw_path, spacing_m=p["spacing"])
    corners = detect_corners(path, spacing_m=p["spacing"])

    n = len(path)
    s1, s2 = n // 3, (2 * n) // 3

    points = []
    for i, (x, y) in enumerate(path):
        lat, lon = meters_to_latlon(x, y)
        point_type, label = "track", None
        if i == 0:
            point_type, label = "start_finish", "Start/Finish"
        elif i == s1:
            point_type, label = "sector_line", "Sector 1/2 boundary"
        elif i == s2:
            point_type, label = "sector_line", "Sector 2/3 boundary"
        points.append(
            {"seq": i, "lat": round(lat, 7), "lon": round(lon, 7), "point_type": point_type, "label": label}
        )

    return {
        "name": f"RIM Park Loop ({difficulty})",
        "difficulty": difficulty,
        "seed": seed,
        "total_distance_m": round(total_len, 1),
        "num_corners": corners,
        "center": {"lat": CENTER_LAT, "lon": CENTER_LON},
        "points": points,
    }


def write_gpx(track, path_out):
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="RaceMind track generator">',
        f'  <trk><name>{track["name"]} seed={track["seed"]}</name><trkseg>',
    ]
    for pt in track["points"]:
        lines.append(f'    <trkpt lat="{pt["lat"]}" lon="{pt["lon"]}"></trkpt>')
    first = track["points"][0]
    lines.append(f'    <trkpt lat="{first["lat"]}" lon="{first["lon"]}"></trkpt>')  # close the loop
    lines += ["  </trkseg></trk>", "</gpx>"]
    with open(path_out, "w") as f:
        f.write("\n".join(lines))


def latlon_to_xy(lat, lon, lat0, lon0):
    dy = math.radians(lat - lat0) * EARTH_R
    dx = math.radians(lon - lon0) * EARTH_R * math.cos(math.radians(lat0))
    return dx, dy


def build_svg_preview(tracks, path_out, tile_size=420, pad=40):
    """Dependency-free SVG preview -- open directly in a browser."""
    tiles = []
    for track in tracks:
        lat0, lon0 = track["center"]["lat"], track["center"]["lon"]
        xy = [latlon_to_xy(p["lat"], p["lon"], lat0, lon0) for p in track["points"]]
        xs = [p[0] for p in xy]
        ys = [p[1] for p in xy]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        span = max(max_x - min_x, max_y - min_y, 1.0)
        scale = (tile_size - 2 * pad) / span
        # flip Y (screen coords grow downward, north should point up)
        px = [(x - min_x) * scale + pad for x in xs]
        py = [tile_size - ((y - min_y) * scale + pad) for y in ys]
        tiles.append((track, list(zip(px, py))))

    total_w = tile_size * len(tiles)
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{tile_size + 30}" '
        f'viewBox="0 0 {total_w} {tile_size + 30}" font-family="monospace">',
        '<rect width="100%" height="100%" fill="#0a0a0a"/>',
    ]

    for i, (track, pts) in enumerate(tiles):
        ox = i * tile_size
        svg.append(f'<g transform="translate({ox},0)">')
        svg.append(
            f'<text x="{tile_size/2}" y="18" fill="#e0e0e0" font-size="13" text-anchor="middle">'
            f'{track["difficulty"].upper()} — {track["total_distance_m"]}m, {track["num_corners"]} corners</text>'
        )
        svg.append(f'<g transform="translate(0,25)">')
        poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        svg.append(f'<polygon points="{poly}" fill="none" stroke="#3a3a3a" stroke-width="2.5"/>')
        for pt, (x, y) in zip(track["points"], pts):
            if pt["point_type"] == "start_finish":
                svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#d50000"/>')
                svg.append(f'<text x="{x+9:.1f}" y="{y+4:.1f}" fill="#a0a0a0" font-size="10">start/finish</text>')
            elif pt["point_type"] == "sector_line":
                svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#ffab00"/>')
        svg.append("</g></g>")

    svg.append("</svg>")
    with open(path_out, "w") as f:
        f.write("\n".join(svg))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--count", type=int, default=3)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "tracks"))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    diffs = list(PROFILES.keys())
    tracks = []
    for i in range(args.count):
        difficulty = diffs[i % len(diffs)]
        track = make_track(seed=args.seed + i, difficulty=difficulty)
        tracks.append(track)
        base = os.path.join(args.out, f"track_{i+1}_{difficulty}")
        with open(f"{base}.json", "w") as f:
            json.dump(track, f, indent=2)
        write_gpx(track, f"{base}.gpx")
        print(f"track_{i+1}_{difficulty}: {track['total_distance_m']}m, {track['num_corners']} corners, {len(track['points'])} points")

    svg_path = os.path.join(args.out, "preview.svg")
    build_svg_preview(tracks, svg_path)
    print(f"\nPreview: {svg_path}  (open directly in a browser, no dependencies)")


if __name__ == "__main__":
    main()
