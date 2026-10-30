"""Write frontend/data/campus_landmarks.geojson: building names for the map.

    python -m backend.export.landmarks

The basemap names few campus buildings at the zoom a reader starts at, so
the dashboard labels the ones riders orient by: well-known landmarks,
libraries and residence halls. They come from data/raw/gis_layers/
osm_buildings.geojson (fetched by scrapers/gis_layers/fetch.py). Each
feature is a point at the building's center with a short label and a
priority: 1 is shown at every zoom, 2 once the map is zoomed in.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_PATH = ROOT / "data" / "raw" / "gis_layers" / "osm_buildings.geojson"
OUT_PATH = ROOT / "frontend" / "data" / "campus_landmarks.geojson"

# Buildings most Aggies know by name, keyed by their OpenStreetMap name, with
# the label to show. Picked by hand: OSM has no tag for "well known".
LANDMARKS = {
    "Memorial Student Center": "MSC",
    "Academic Building": "Academic Building",
    "Kyle Field": "Kyle Field",
    "Reed Arena": "Reed Arena",
    "Student Recreation Center": "Rec Center",
    "Zachry Engineering Education Complex": "Zachry",
    "Rudder Tower": "Rudder Tower",
    "Koldus Building": "Koldus",
    "Student Services Building": "Student Services",
    "Sbisa Dining Hall": "Sbisa Dining",
    "Duncan Dining Hall": "Duncan Dining",
    "Commons": "The Commons",
    "Liberal Arts and Arts & Humanities Building": "Liberal Arts",
    "Wehner Building": "Mays (Wehner)",
    "Blue Bell Park": "Blue Bell Park",
    "George Bush Presidential Library & Museum": "Bush Library",
}

# Annexes sit beside the main library and would only crowd its label.
SKIP = {"Sterling C. Evans Library Annex"}


def short_label(name: str) -> str:
    """A label short enough to sit on the map: "Hart Residence Hall" -> "Hart Hall"."""
    name = re.sub(r"\s*-\s*Dorm \d+$", "", name)  # "Spence Hall - Dorm 1"
    name = name.replace("Residence Hall", "Hall")
    name = name.replace("Sterling C. Evans Library", "Evans Library")
    name = name.replace("Cushing Memorial Library", "Cushing Library")
    return name


def classify(props: dict) -> tuple[str, int] | None:
    """(category, priority) for a building worth labelling, or None."""
    name = props.get("name", "")
    if name in SKIP:
        return None
    if name in LANDMARKS:
        return "landmark", 1
    if props.get("amenity") == "library":
        return "library", 1
    if props.get("building") == "dormitory" or "Residence Hall" in name:
        return "residence_hall", 2
    return None


def main():
    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    features, seen = [], set()
    for feature in source["features"]:
        props = feature["properties"]
        kind = classify(props)
        if not kind:
            continue
        name = props["name"]
        # Kyle Field is in OSM twice, as the stadium and as its building.
        if name in seen:
            continue
        seen.add(name)
        category, priority = kind
        lon, lat = feature["geometry"]["coordinates"]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "name": name,
                "label": LANDMARKS.get(name) or short_label(name),
                "category": category,
                "priority": priority,
            },
        })
    features.sort(key=lambda f: (f["properties"]["priority"], f["properties"]["label"]))

    missing = sorted(set(LANDMARKS) - seen)
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "description": "Campus landmarks, libraries and residence halls, for map labels. "
                           "priority 1 shows at every zoom, 2 when zoomed in.",
            "credit": "© OpenStreetMap contributors",
        },
        "features": features,
    }
    OUT_PATH.write_text(json.dumps(collection, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    counts = {}
    for f in features:
        counts[f["properties"]["category"]] = counts.get(f["properties"]["category"], 0) + 1
    print(f"{len(features)} labels -> {OUT_PATH.relative_to(ROOT)}: {counts}")
    if missing:
        print(f"  not found in OSM: {', '.join(missing)}")


if __name__ == "__main__":
    main()
