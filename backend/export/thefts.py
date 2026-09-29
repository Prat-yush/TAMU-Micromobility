"""Write frontend/data/thefts.geojson: one point per recorded theft incident.

    python -m backend.export.thefts

Incidents with no usable location are still included with a null geometry,
so counts over time stay complete; map layers should skip them.
"""

import json
from collections import Counter
from pathlib import Path

from backend.processing.thefts import load_incidents

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "frontend" / "data" / "thefts.geojson"


def to_feature(incident: dict) -> dict:
    props = {k: v for k, v in incident.items() if k not in ("lat", "lon")}
    geometry = None
    if incident["lat"] is not None:
        geometry = {"type": "Point", "coordinates": [incident["lon"], incident["lat"]]}
    return {"type": "Feature", "geometry": geometry, "properties": props}


def main():
    incidents = load_incidents()
    collection = {
        "type": "FeatureCollection",
        "features": [to_feature(i) for i in incidents],
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(collection, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"{len(incidents)} incidents -> {OUT_PATH.relative_to(ROOT)}")
    print("  location:", dict(Counter(i["location_precision"] for i in incidents)))
    print("  report:  ", dict(Counter(i["report_type"] for i in incidents)))


if __name__ == "__main__":
    main()
