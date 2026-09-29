"""Write frontend/data/theft_zones.geojson: one point per rack zone.

    python -m backend.export.thefts

Every main-campus rack zone is included, even with no reported thefts, plus
off-campus places where thefts were reported. Each feature carries its total
rack capacity and the full list of its incidents, so the dashboard can filter
by date without another file. Incidents whose place couldn't be located are
listed under the top-level "unplaced_incidents" key instead.
"""

import json
from pathlib import Path

from backend.analysis.theft_zones import zone_theft_summary

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "data" / "theft_zones.geojson"


def to_feature(zone: dict) -> dict:
    props = {k: v for k, v in zone.items() if k not in ("lat", "lon", "incidents")}
    props["incidents"] = zone["incidents"]
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [zone["lon"], zone["lat"]]},
        "properties": props,
    }


def main():
    zones, unplaced = zone_theft_summary()
    zones.sort(key=lambda z: (-z["theft_count"], z["name"]))
    all_dates = [i["incident_date"] for z in zones for i in z["incidents"]]
    all_dates += [i["incident_date"] for i in unplaced]
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "description": "Reported bike, e-bike and e-scooter thefts per rack zone. "
                           "Reported incidents only; no estimates.",
            "sources": ["TAMU UPD crime alerts", "TAMU Clery crime log",
                        "TAMU Transportation Services bike rack inventory"],
            "date_range": [min(all_dates), max(all_dates)],
            "incident_count": len(all_dates),
            "placed_incident_count": len(all_dates) - len(unplaced),
            "rack_capacity_note": "Regular bike racks only; null for off-campus places.",
        },
        "unplaced_incidents": unplaced,
        "features": [to_feature(z) for z in zones],
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(collection, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    with_thefts = [z for z in zones if z["theft_count"]]
    print(f"{len(zones)} zones ({len(with_thefts)} with thefts) -> {OUT_PATH.relative_to(ROOT)}")
    print(f"  {len(all_dates) - len(unplaced)} incidents placed, {len(unplaced)} unplaced")
    for z in with_thefts[:10]:
        print(f"  {z['theft_count']:3}  {z['name']}  (capacity {z['rack_capacity']})")


if __name__ == "__main__":
    main()
