"""Write the Veo ride files the dashboard reads.

    python -m backend.export.veo

Run backend.processing.veo_rides and backend.processing.veo_routes first.

frontend/data/veo_segments.geojson
    One line per network segment that at least one ride used, with ride
    counts (total, weekday, weekend, after dark, by start hour, by date) and
    the segment's OpenStreetMap description. Routes are estimated from GPS
    positions about a minute apart; see backend/processing/veo_routes.py.

frontend/data/veo_timeline.json
    Rides started per 15 minutes for each collection day, plus each day's
    collection window. Time outside a window wasn't collected; it isn't zero.
"""

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from backend.analysis.veo_segments import segment_counts
from backend.geo.network import load_network, to_lonlat
from backend.processing.veo_rides import RAW_DIR, CAMPUS_TZ, read_snapshots

ROOT = Path(__file__).resolve().parents[2]
SEGMENTS_PATH = ROOT / "frontend" / "data" / "veo_segments.geojson"
TIMELINE_PATH = ROOT / "frontend" / "data" / "veo_timeline.json"
BIN_MIN = 15
CREDIT = "Ride data: Veo GBFS feed. Paths and roads: © OpenStreetMap contributors."


def collection_windows() -> dict[str, list[str]]:
    windows = {}
    for day_dir in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        snaps = read_snapshots(day_dir)
        windows[day_dir.name] = [datetime.fromtimestamp(snaps[i]["fetched_at"], CAMPUS_TZ)
                                 .isoformat(timespec="minutes") for i in (0, -1)]
    return windows


def main():
    net = load_network()
    counts, rides = segment_counts()
    windows = collection_windows()

    features = []
    for sid, c in sorted(counts.items(), key=lambda kv: -kv[1]["rides"]):
        seg = net.segments[sid]
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[round(v, 6) for v in to_lonlat(*p)] for p in seg.xy]},
            "properties": {"segment_id": sid, "length_ft": round(seg.length_ft),
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
            "units": {"length_ft": "feet"},
            "credit": CREDIT,
        },
        "features": features,
    }, separators=(",", ":")) + "\n", encoding="utf-8")

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
    print(f"{len(windows)} days -> {TIMELINE_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
