"""Clean the recorded theft incidents and assign each one to a rack zone.

Reads data/raw/bike_theft_tracker/ (see scrapers/bike_theft_tracker/) and the
hand-reviewed data/reference/theft_places.json.

Incidents: one dict per micromobility incident (bike, e-bike, e-scooter), all
treated as bike theft with no split by vehicle type. Cars, motorcycles, mopeds,
golf carts and the like are dropped, and so are reports where nothing was
stolen (arrests, recoveries, cases police marked unfounded). `report_type`
still marks the attempted thefts. `zone_id` comes from theft_places.json, and
is None for the few places that couldn't be located.

Zones: the tracker's rack-cluster zones plus off-campus places, with capacity
summed over regular bike racks only (Veo shared-mobility posts are left out,
since personal bikes don't normally park there).
"""

import json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw" / "bike_theft_tracker"
PLACES_PATH = ROOT / "data" / "reference" / "theft_places.json"

NOT_THEFT = {"arrest", "recovery", "unfounded"}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return datetime.fromisoformat(value).date()


def is_micromobility(row: dict) -> bool:
    # Every row from UPD's consolidated bulletin is an e-bike or e-scooter by
    # definition of that bulletin; the tracker leaves those rows "unknown".
    # Narrative rows it couldn't classify are all other vehicle types.
    return row["source_format"] == "list" or row["vehicle_type"] != "unknown"


def report_type(row: dict) -> str:
    text = (row["narrative_text"] or "").lower()
    if "unfounded" in text:
        return "unfounded"
    if "attempted" in text:
        return "attempted_theft"
    if "report of a stolen" not in text:
        if "arrested" in text:
            return "arrest"
        if "recover" in text:
            return "recovery"
    return "theft"


def place_zone(row: dict, places: dict) -> str | None:
    """Zone id for the place a report names; None if it's a known unresolved place."""
    # A few narrative alerts leave the location blank but name the building in the text.
    text = (row["location_raw"] or row["narrative_text"] or "").lower()
    for place in places["campus"] + places["off_campus"] + places["unresolved"]:
        if any(m in text for m in place["match"]):
            return place.get("zone_id") or place.get("id")
    raise ValueError(
        f"Case {row['case_no']}: no entry in {PLACES_PATH.name} matches {text[:80]!r}"
    )


def load_incidents() -> list[dict]:
    raw = read_json(RAW_DIR / "incidents.json")
    places = read_json(PLACES_PATH)

    incidents = []
    for row in filter(is_micromobility, raw):
        rtype = report_type(row)
        if rtype in NOT_THEFT:
            continue
        report_date = parse_date(row["alert_date"])
        seen = parse_date(row["last_seen"])
        missing = parse_date(row["discovered_missing"])
        incidents.append({
            "case_no": row["case_no"],
            "zone_id": place_zone(row, places),
            # Best available day the theft happened: when it was found missing,
            # else when last seen, else when it was reported.
            "incident_date": (missing or seen or report_date).isoformat(),
            "report_date": report_date.isoformat(),
            "last_seen": row["last_seen"],
            "discovered_missing": row["discovered_missing"],
            "window_hours": row["window_hours"],
            "report_type": rtype,
            "location": row["location_raw"],
            "source": "clery_log" if row["source_format"] == "clery" else "upd_crime_alert",
            "source_url": row["alert_url"],
        })
    incidents.sort(key=lambda r: (r["incident_date"], r["case_no"] or ""))
    return incidents


def load_zones() -> list[dict]:
    places = read_json(PLACES_PATH)
    racks = [
        f["properties"]
        for f in read_json(RAW_DIR / "racks.geojson")["features"]
        if f["properties"]["kind"] == "regular"
    ]

    zones = []
    for z in read_json(RAW_DIR / "zones.json"):
        if z["id"] in places["excluded_zones"]:
            continue
        zone_racks = [r for r in racks if r["zone_id"] == z["id"]]
        zones.append({
            "zone_id": z["id"],
            "name": places["zone_names"].get(z["id"], z["name"]),
            "kind": "campus",
            "lat": z["lat"],
            "lon": z["lon"],
            "rack_count": len(zone_racks),
            "rack_capacity": sum(r["capacity"] for r in zone_racks),
        })
    for p in places["off_campus"]:
        zones.append({
            "zone_id": p["id"],
            "name": p["name"],
            "kind": "off_campus",
            "lat": p["lat"],
            "lon": p["lon"],
            # Not in TAMU's rack inventory.
            "rack_count": None,
            "rack_capacity": None,
        })
    return zones
