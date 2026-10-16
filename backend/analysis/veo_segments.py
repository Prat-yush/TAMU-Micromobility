"""Count Veo rides on each network segment.

Plain counts of the matched routes from backend.processing.veo_routes. A ride
counts once on every segment its route uses, including the segments where it
starts and ends. Counts are split by weekday/weekend, after dark, start hour
and date, so the dashboard can filter without recounting.
"""

import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RIDES_PATH = ROOT / "data" / "interim" / "veo_rides.geojson"
ROUTES_PATH = ROOT / "data" / "interim" / "veo_routes.json"


def segment_counts() -> tuple[dict[str, dict], list[dict]]:
    """Returns ({segment id: counts}, ride properties in start order)."""
    rides = {f["properties"]["ride_id"]: f["properties"]
             for f in json.loads(RIDES_PATH.read_text(encoding="utf-8"))["features"]}
    counts = defaultdict(lambda: {"rides": 0, "rides_weekday": 0, "rides_weekend": 0,
                                  "rides_after_dark": 0, "rides_by_hour": [0] * 24,
                                  "rides_by_date": defaultdict(int)})
    for route in json.loads(ROUTES_PATH.read_text(encoding="utf-8")):
        ride = rides[route["ride_id"]]
        hour = datetime.fromisoformat(ride["started_at"]).hour
        for sid in set(route["segments"]):
            c = counts[sid]
            c["rides"] += 1
            c["rides_weekday" if ride["weekday"] else "rides_weekend"] += 1
            c["rides_after_dark"] += ride["after_dark"]
            c["rides_by_hour"][hour] += 1
            c["rides_by_date"][ride["date"]] += 1
    for c in counts.values():
        c["rides_by_date"] = dict(sorted(c["rides_by_date"].items()))
    return dict(counts), sorted(rides.values(), key=lambda r: r["started_at"])
