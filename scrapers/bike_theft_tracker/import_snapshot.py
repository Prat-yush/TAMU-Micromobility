"""One-time import of the recorded theft incidents from the tamu-bike-theft-tracker repo.

    python scrapers/bike_theft_tracker/import_snapshot.py [path/to/tamu-bike-safety]

That repo already scraped UPD crime alerts and the Clery crime log, merged them,
and matched each incident to a campus zone. This copies its pipeline outputs
into data/raw/bike_theft_tracker/ as JSON, unmodified apart from turning CSV
strings into typed values:

    incidents.json       every row of pipeline/incidents_zoned.csv
    zones.json           pipeline/zones.json (rack-cluster zones and centroids)
    geocode_cache.json   pipeline/geocode_cache.json (address -> [lat, lon])

Nothing from that repo's score.py is imported: no grades, no estimates for
zones without reports. Only incidents that were actually reported.
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "bike_theft_tracker"
DEFAULT_SOURCE = Path.home() / "Documents" / "Bike" / "tamu-bike-safety"

BOOL_FIELDS = {"within_window", "needs_review"}
FLOAT_FIELDS = {"window_hours", "zone_match_score"}


def typed(row: dict) -> dict:
    out = {}
    for key, value in row.items():
        value = value.strip() if key != "narrative_text" else value.strip() or None
        if value == "" or value is None:
            out[key] = None
        elif key in BOOL_FIELDS:
            out[key] = value == "True"
        elif key in FLOAT_FIELDS:
            out[key] = float(value)
        else:
            out[key] = value
    return out


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    pipeline = source / "pipeline"
    if not (pipeline / "incidents_zoned.csv").exists():
        sys.exit(f"No pipeline/incidents_zoned.csv under {source}")

    with open(pipeline / "incidents_zoned.csv", encoding="utf-8") as f:
        incidents = [typed(r) for r in csv.DictReader(f)]
    zones = json.loads((pipeline / "zones.json").read_text(encoding="utf-8"))["zones"]
    cache = json.loads((pipeline / "geocode_cache.json").read_text(encoding="utf-8"))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in [
        ("incidents.json", incidents),
        ("zones.json", zones),
        ("geocode_cache.json", cache),
    ]:
        (OUT_DIR / name).write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    print(f"{len(incidents)} incidents, {len(zones)} zones, {len(cache)} geocoded addresses")
    print(f"-> {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
