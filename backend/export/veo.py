"""Write the Veo ride files the dashboard reads.

    python -m backend.export.veo

Run backend.processing.veo_rides and backend.processing.veo_routes first.

frontend/data/veo_segments.geojson
    One line per network segment that at least one ride used, with ride
    counts (total, weekday, weekend, after dark, by start hour, by date), the
    segment's OpenStreetMap description, and what's on the ground: bike
    facility, walking surface, dismount zone, road class, owner, speed limit
    and lanes. See backend/processing/segment_context.py. Routes are estimated from GPS
    positions about a minute apart; see backend/processing/veo_routes.py.

frontend/data/veo_conflict_points.geojson
    Places where rides cross or turn onto a major road, with the rides through
    each and what crossing exists there. See backend/analysis/veo_conflicts.py.

frontend/data/veo_rides.geojson
    One line per ride through the GPS positions Veo reported, with its times,
    distance and speeds, and the network segments its estimated route used
    (`segment_ids`, matching veo_segments.geojson).

frontend/data/veo_timeline.json
    Rides started per 15 minutes for each collection day, plus each day's
    collection window. Time outside a window wasn't collected; it isn't zero.
"""

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from backend.analysis.veo_conflicts import conflict_points
from backend.analysis.veo_segments import segment_counts
from backend.geo.network import load_network, to_lonlat
from backend.processing.segment_context import Context
from backend.processing.veo_rides import CAMPUS_TZ, RAW_DIR, read_snapshots

ROOT = Path(__file__).resolve().parents[2]
SEGMENTS_PATH = ROOT / "frontend" / "data" / "veo_segments.geojson"
TIMELINE_PATH = ROOT / "frontend" / "data" / "veo_timeline.json"
CONFLICTS_PATH = ROOT / "frontend" / "data" / "veo_conflict_points.geojson"
RIDES_OUT_PATH = ROOT / "frontend" / "data" / "veo_rides.geojson"
RIDES_IN_PATH = ROOT / "data" / "interim" / "veo_rides.geojson"
ROUTES_PATH = ROOT / "data" / "interim" / "veo_routes.json"
# Ride fields the frontend gets. Vehicle type ids stay behind: every ride is an e-bike.
RIDE_FIELDS = ("ride_id", "date", "weekday", "after_dark", "started_at", "ended_at", "duration_s",
               "path_miles", "straight_miles", "avg_speed_mph", "max_speed_mph", "times")
BIN_MIN = 15
CREDIT = ("Ride data: Veo GBFS feed. Paths and roads: © OpenStreetMap contributors. "
          "Facilities: Texas A&M Transportation Services, TAMU campus basemap, "
          "City of College Station.")


def collection_windows() -> dict[str, list[str]]:
    windows = {}
    for day_dir in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        snaps = read_snapshots(day_dir)
        windows[day_dir.name] = [datetime.fromtimestamp(snaps[i]["fetched_at"], CAMPUS_TZ)
                                 .isoformat(timespec="minutes") for i in (0, -1)]
    return windows


def export_rides(windows: dict) -> int:
    routes = {r["ride_id"]: r["segments"]
              for r in json.loads(ROUTES_PATH.read_text(encoding="utf-8"))}
    features = []
    for f in json.loads(RIDES_IN_PATH.read_text(encoding="utf-8"))["features"]:
        p = f["properties"]
        features.append({
            "type": "Feature",
            # 5 decimal places is about 3 ft, well under the GPS error.
            "geometry": {"type": "LineString",
                         "coordinates": [[round(v, 5) for v in c] for c in f["geometry"]["coordinates"]]},
            "properties": {**{k: p[k] for k in RIDE_FIELDS},
                           "segment_ids": routes.get(p["ride_id"], [])},
        })
    RIDES_OUT_PATH.write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {
            "description": "One Veo ride per feature, drawn through the GPS positions Veo reported "
                           "about once a minute. `times` are the Unix times of each position; "
                           "`segment_ids` is the estimated route on the network.",
            "ride_count": len(features),
            "collection_windows": windows,
            "units": {"path_miles": "miles", "straight_miles": "miles", "duration_s": "seconds",
                      "avg_speed_mph": "miles per hour", "max_speed_mph": "miles per hour"},
            "credit": CREDIT,
        },
        "features": features,
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    return len(features)


def main():
    net = load_network()
    ctx = Context()
    counts, rides = segment_counts()
    windows = collection_windows()

    features = []
    # Ties sorted by id, so a rerun writes an identical file.
    for sid, c in sorted(counts.items(), key=lambda kv: (-kv[1]["rides"], kv[0])):
        seg = net.segments[sid]
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[round(v, 6) for v in to_lonlat(*p)] for p in seg.xy]},
            "properties": {"segment_id": sid, "length_ft": round(seg.length_ft),
                           **ctx.describe(seg),
                           **{f"osm_{k}": v for k, v in seg.tags.items()}, **c},
        })
    SEGMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEGMENTS_PATH.write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {
            "description": "Veo rides counted per path or road segment. Routes are estimated "
                           "by matching GPS positions about a minute apart to the network.",
            "ride_count": len(rides),
            "collection_windows": windows,
            "units": {"length_ft": "feet", "speed_limit_mph": "miles per hour"},
            "credit": CREDIT,
        },
        "features": features,
    }, separators=(",", ":")) + "\n", encoding="utf-8")

    conflicts = conflict_points(net, ctx)
    CONFLICTS_PATH.write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {
            "description": "Places where Veo rides cross or turn onto a major road. These are "
                           "places where bikes meet heavy traffic, not a record of crashes.",
            "ride_count": len(rides),
            "collection_windows": windows,
            "units": {"speed_limit_mph": "miles per hour"},
            "credit": CREDIT,
        },
        "features": conflicts,
    }, separators=(",", ":")) + "\n", encoding="utf-8")

    n_rides = export_rides(windows)

    by_day = {day: Counter() for day in windows}
    for r in rides:
        t = datetime.fromisoformat(r["started_at"])
        by_day[r["date"]][f"{t.hour:02d}:{t.minute // BIN_MIN * BIN_MIN:02d}"] += 1
    TIMELINE_PATH.write_text(json.dumps({
        "bin_minutes": BIN_MIN,
        "credit": CREDIT,
        "days": [{"date": day, "weekday": datetime.fromisoformat(day).weekday() < 5,
                  "window": windows[day], "rides": sum(by_day[day].values()),
                  "rides_started": dict(sorted(by_day[day].items()))} for day in windows],
    }, indent=1) + "\n", encoding="utf-8")

    print(f"{len(features)} segments -> {SEGMENTS_PATH.relative_to(ROOT)} "
          f"({SEGMENTS_PATH.stat().st_size / 1e6:.1f} MB)")
    print(f"{len(conflicts)} conflict points -> {CONFLICTS_PATH.relative_to(ROOT)}")
    print(f"{n_rides} rides -> {RIDES_OUT_PATH.relative_to(ROOT)} "
          f"({RIDES_OUT_PATH.stat().st_size / 1e6:.1f} MB)")
    print(f"{len(windows)} days -> {TIMELINE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
