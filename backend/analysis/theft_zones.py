"""Count recorded thefts per zone.

Plain counts only: no rates, smoothing or estimates. Zones with no reports
get a count of 0, which means none were reported, not that the zone is safe.
"""

from backend.processing.thefts import load_incidents, load_zones


def zone_theft_summary() -> tuple[list[dict], list[dict]]:
    """Returns (zones with their incidents attached, incidents with no zone)."""
    incidents = load_incidents()
    zones = load_zones()
    by_zone = {z["zone_id"]: z for z in zones}
    for z in zones:
        z["incidents"] = []

    unplaced = []
    for inc in incidents:
        zone = by_zone.get(inc["zone_id"])
        if zone is None:
            unplaced.append(inc)
        else:
            zone["incidents"].append({k: v for k, v in inc.items() if k != "zone_id"})

    for z in zones:
        dates = [i["incident_date"] for i in z["incidents"]]
        z["theft_count"] = len(dates)
        z["first_incident"] = min(dates, default=None)
        z["last_incident"] = max(dates, default=None)
    return zones, unplaced
