"""Turn Veo snapshots into rides.

    python -m backend.processing.veo_rides

Reads every day folder in data/raw/veo_gbfs/ (see scrapers/veo_gbfs/collect.py)
and writes data/interim/veo_rides.geojson: one LineString per ride, through the
positions Veo reported while the vehicle was being ridden.

How a ride is found. Veo keeps a vehicle in its feed while it is being ridden,
marked `is_reserved`, and keeps reporting its position about once a minute.
Vehicles are followed by `number`, because `bike_id` changes over time for the
same vehicle. For each vehicle, a ride is one unbroken run of reserved
snapshots, plus the parked position just before it (where the ride started)
and just after it (where it ended).

Nothing here uses a street or path network: these are the positions Veo
reported, not a route. Snapping rides to paths is a later step.

A run is dropped, and counted by reason, when:
  - it was already under way when the collection window opened, or still
    going when it closed
  - the vehicle vanished from the feed mid-ride for longer than MAX_GAP_S
  - the vehicle's first sighting of the day is already reserved. These are
    nearly all Veo putting vehicles into service: reserved for a few minutes,
    moving a few metres.
  - the vehicle moved less than MIN_PATH_M along its path. About 25-35
    vehicles sit reserved for hours without moving; those aren't rides.
  - any step between positions implies more than MAX_SPEED_MS, which no
    e-bike or scooter does; it's a GPS glitch
"""

import json
import lzma
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw" / "veo_gbfs"
OUT_PATH = ROOT / "data" / "interim" / "veo_rides.geojson"
CAMPUS_TZ = ZoneInfo("America/Chicago")
CAMPUS_LAT, CAMPUS_LON = 30.615, -96.340

# Snapshots are a minute apart. A single failed poll leaves a 2-minute gap,
# which shouldn't end a ride; anything longer means we lost track of it.
MAX_GAP_S = 150
MIN_PATH_M = 150
MAX_SPEED_MS = 15.0  # 54 km/h


@dataclass(frozen=True)
class Sighting:
    t: int  # Unix time of the snapshot
    lat: float
    lon: float
    reserved: bool
    vehicle_type_id: str


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def read_snapshots(day_dir: Path) -> list[dict]:
    """Successful snapshots of one day, in time order. Failed polls are skipped."""
    snaps = []
    for path in sorted(day_dir.glob("*.jsonl.xz")):
        with lzma.open(path, "rt", encoding="utf-8") as f:
            snaps += [s for s in map(json.loads, f) if "bikes" in s]
    return sorted(snaps, key=lambda s: s["fetched_at"])


def tracks_by_vehicle(snapshots: list[dict]) -> dict[str, list[Sighting]]:
    tracks = defaultdict(list)
    for s in snapshots:
        for b in s["bikes"]:
            if b.get("number"):
                tracks[b["number"]].append(Sighting(
                    s["fetched_at"], b["lat"], b["lon"], bool(b["is_reserved"]),
                    b["vehicle_type_id"]))
    return tracks


def reserved_runs(track: list[Sighting], window: tuple[int, int]):
    """Yield (sightings, status) for each run of reserved sightings.

    status is "complete" when the run has a parked sighting before and after
    it, each within MAX_GAP_S; then the sightings include both. Otherwise it
    names why the start or end is unknown. `window` is the first and last
    snapshot time of the day.
    """
    def edge(t):
        return t - window[0] <= MAX_GAP_S or window[1] - t <= MAX_GAP_S

    run, start_known = None, False
    for prev, cur in zip([None] + track, track):
        gap_ok = prev is not None and cur.t - prev.t <= MAX_GAP_S
        if run is not None and not gap_ok:
            yield run, "lost mid-ride"
            run = None
        if cur.reserved:
            if run is None:
                start_known = gap_ok and not prev.reserved
                run = [prev] if start_known else []
                if not start_known:
                    reason = ("window edge" if edge(cur.t) else
                              "first seen reserved" if prev is None else "lost mid-ride")
            run.append(cur)
        elif run is not None:
            run.append(cur)
            yield run, "complete" if start_known else reason
            run = None
    if run is not None:
        yield run, "window edge" if edge(run[-1].t) else "lost mid-ride"


def path_length_m(points: list[Sighting]) -> float:
    return sum(haversine_m(a.lat, a.lon, b.lat, b.lon) for a, b in zip(points, points[1:]))


def max_speed_ms(points: list[Sighting]) -> float:
    return max((haversine_m(a.lat, a.lon, b.lat, b.lon) / max(b.t - a.t, 1)
                for a, b in zip(points, points[1:])), default=0.0)


def civil_dusk_and_dawn(day: date) -> tuple[datetime, datetime]:
    """Campus civil dusk and dawn (sun 6 degrees below the horizon), NOAA approximation."""
    def event(rising: bool) -> datetime:
        n = day.timetuple().tm_yday
        lng_hour = CAMPUS_LON / 15
        t = n + ((6 if rising else 18) - lng_hour) / 24
        m = 0.9856 * t - 3.289
        lon = (m + 1.916 * math.sin(math.radians(m)) + 0.020 * math.sin(math.radians(2 * m))
               + 282.634) % 360
        ra = math.degrees(math.atan(0.91764 * math.tan(math.radians(lon)))) % 360
        ra = (ra + (lon // 90) * 90 - (ra // 90) * 90) / 15
        sin_dec = 0.39782 * math.sin(math.radians(lon))
        cos_dec = math.cos(math.asin(sin_dec))
        cos_h = ((math.cos(math.radians(96)) - sin_dec * math.sin(math.radians(CAMPUS_LAT)))
                 / (cos_dec * math.cos(math.radians(CAMPUS_LAT))))
        h = math.degrees(math.acos(cos_h))
        h = (360 - h if rising else h) / 15
        ut = (h + ra - 0.06571 * t - 6.622 - lng_hour) % 24
        midnight_utc = datetime(day.year, day.month, day.day, tzinfo=ZoneInfo("UTC"))
        return (midnight_utc + timedelta(hours=ut)).astimezone(CAMPUS_TZ)

    dawn, dusk = event(True), event(False)
    # The UTC hour can wrap past midnight; keep both on the campus-local day.
    dusk = dusk.replace(year=day.year, month=day.month, day=day.day)
    dawn = dawn.replace(year=day.year, month=day.month, day=day.day)
    return dusk, dawn


def to_feature(number: str, points: list[Sighting], vehicle_types: dict) -> dict:
    start, end = points[0], points[-1]
    started = datetime.fromtimestamp(points[1].t, CAMPUS_TZ)  # first reserved sighting
    ended = datetime.fromtimestamp(end.t, CAMPUS_TZ)
    dusk, dawn = civil_dusk_and_dawn(started.date())
    vtype = vehicle_types.get(start.vehicle_type_id, {})
    return {
        "type": "Feature",
        "geometry": {"type": "LineString",
                     "coordinates": [[round(p.lon, 6), round(p.lat, 6)] for p in points]},
        "properties": {
            "ride_id": f"{started:%Y%m%d-%H%M%S}-{number}",
            "vehicle_number": number,
            "vehicle_type_id": start.vehicle_type_id,
            "form_factor": vtype.get("form_factor"),
            "propulsion_type": vtype.get("propulsion_type"),
            "date": started.date().isoformat(),
            "weekday": started.weekday() < 5,
            # A ride starts between the last parked sighting and the first
            # reserved one, and ends by the first parked sighting after it.
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "duration_s": end.t - points[1].t,
            "path_m": round(path_length_m(points)),
            "straight_m": round(haversine_m(start.lat, start.lon, end.lat, end.lon)),
            "after_dark": not (dawn <= started <= dusk),
            # Unix time of each coordinate, so a route can be timed per segment later.
            "times": [p.t for p in points],
        },
    }


def find_rides(day_dir: Path) -> tuple[list[dict], Counter]:
    types_path = day_dir / "vehicle_types.json"
    vehicle_types = {}
    if types_path.exists():
        vehicle_types = {v["vehicle_type_id"]: v for v in json.loads(types_path.read_text())}

    snapshots = read_snapshots(day_dir)
    window = (snapshots[0]["fetched_at"], snapshots[-1]["fetched_at"])
    rides, dropped = [], Counter()
    for number, track in tracks_by_vehicle(snapshots).items():
        for points, status in reserved_runs(track, window):
            if status != "complete":
                dropped[status] += 1
            elif path_length_m(points) < MIN_PATH_M:
                dropped[f"moved less than {MIN_PATH_M} m"] += 1
            elif max_speed_ms(points) > MAX_SPEED_MS:
                dropped["GPS jump"] += 1
            else:
                rides.append(to_feature(number, points, vehicle_types))
    return rides, dropped


def main():
    all_rides, all_dropped = [], Counter()
    for day_dir in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        rides, dropped = find_rides(day_dir)
        all_rides += rides
        all_dropped += dropped
        dark = sum(r["properties"]["after_dark"] for r in rides)
        print(f"{day_dir.name}: {len(rides)} rides ({dark} after dark); dropped {dict(dropped)}")

    all_rides.sort(key=lambda r: r["properties"]["started_at"])
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({"type": "FeatureCollection", "features": all_rides},
                                   separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(all_rides)} rides -> {OUT_PATH.relative_to(ROOT)} "
          f"({OUT_PATH.stat().st_size / 1e6:.1f} MB); dropped {dict(all_dropped)}")


if __name__ == "__main__":
    main()
