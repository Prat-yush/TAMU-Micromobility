"""Clean the recorded theft incidents and give each one a map position.

Reads data/raw/bike_theft_tracker/ (see scrapers/bike_theft_tracker/) and
returns one dict per micromobility incident (bike, e-bike, e-scooter), all
treated as bike theft with no split by vehicle type. Cars, motorcycles, mopeds,
golf carts and the like are dropped, and so are reports where nothing was
stolen (arrests, recoveries, cases police marked unfounded). `report_type`
still marks the attempted thefts.

Position, in order of preference (`location_precision`):
  "address"  the street address in the location text, geocoded by the
             tracker repo (its geocode_cache.json)
  "zone"     centroid of the campus zone the tracker matched by name
  "none"     no usable location; lat/lon are None
"""

import json
import re
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw" / "bike_theft_tracker"

# Same address extraction the tracker used when it filled geocode_cache.json,
# so the cache keys line up.
ADDR_RE = re.compile(r"\(([^)]*College Station[^)]*)\)", re.I)
SUITE_RE = re.compile(r",?\s*Ste\.?\s*\S+", re.I)
ABBR_MAP = [
    (re.compile(r"\bBl\b\.?", re.I), "Blvd"),
    (re.compile(r"\bDr\b\.?", re.I), "Drive"),
    (re.compile(r"\bPw\b\.?", re.I), "Pkwy"),
    (re.compile(r"\bLn\b\.?", re.I), "Lane"),
]

def cache_key(address: str) -> str:
    address = SUITE_RE.sub("", address)
    for pat, repl in ABBR_MAP:
        address = pat.sub(repl, address)
    return address.strip() + ", TX"


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return datetime.fromisoformat(value).date()


NOT_THEFT = {"arrest", "recovery", "unfounded"}


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


def locate(row: dict, zones: dict, cache: dict) -> tuple[float | None, float | None, str]:
    m = ADDR_RE.search(row["location_raw"] or "")
    if m and cache.get(cache_key(m.group(1))):
        lat, lon = cache[cache_key(m.group(1))]
        return lat, lon, "address"
    zone = zones.get(row["zone_id"])
    if zone:
        return zone["lat"], zone["lon"], "zone"
    return None, None, "none"


def load_incidents() -> list[dict]:
    raw = json.loads((RAW_DIR / "incidents.json").read_text(encoding="utf-8"))
    zones = {
        z["id"]: z
        for z in json.loads((RAW_DIR / "zones.json").read_text(encoding="utf-8"))
    }
    cache = json.loads((RAW_DIR / "geocode_cache.json").read_text(encoding="utf-8"))

    incidents = []
    for row in filter(is_micromobility, raw):
        rtype = report_type(row)
        if rtype in NOT_THEFT:
            continue
        lat, lon, precision = locate(row, zones, cache)
        report_date = parse_date(row["alert_date"])
        seen = parse_date(row["last_seen"])
        missing = parse_date(row["discovered_missing"])
        incidents.append({
            "case_no": row["case_no"],
            # Best available day the theft happened: when it was found missing,
            # else when last seen, else when it was reported.
            "incident_date": (missing or seen or report_date).isoformat(),
            "report_date": report_date.isoformat(),
            "last_seen": row["last_seen"],
            "discovered_missing": row["discovered_missing"],
            "window_hours": row["window_hours"],
            "report_type": rtype,
            "location": row["location_raw"],
            "zone_id": row["zone_id"],
            "zone_name": row["zone_name"],
            "lat": round(lat, 6) if lat is not None else None,
            "lon": round(lon, 6) if lon is not None else None,
            "location_precision": precision,
            "source": "clery_log" if row["source_format"] == "clery" else "upd_crime_alert",
            "source_url": row["alert_url"],
        })
    incidents.sort(key=lambda r: (r["incident_date"], r["case_no"] or ""))
    return incidents
