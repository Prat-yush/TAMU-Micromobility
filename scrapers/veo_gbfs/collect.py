"""Poll Veo's public GBFS feed for Texas A&M and save vehicle snapshots.

    python scrapers/veo_gbfs/collect.py --seconds 1800 --out-dir data/raw/veo_gbfs

The feed (free_bike_status) lists every vehicle that is parked and not being
ridden, with no history, so a dataset only exists if we keep sampling it. This
polls once per --interval for --seconds and writes one segment file:

    <out-dir>/<YYYY-MM-DD>/<HHMMSS>.jsonl.xz     (date and time in campus local time)

Each line is one snapshot: {"fetched_at", "last_updated", "bikes": [...]}, or
{"fetched_at", "error"} if that poll failed. Vehicles are saved as the feed
returned them, except that `rental_uris` is replaced by `number`, the vehicle
number inside those links. Keep `number`: the feed's `bike_id` changes over
time for the same vehicle, while the number stays fixed, so it is the only way
to follow a vehicle from one snapshot to the next.

The static vehicle_types feed is saved once per day next to the segments.
"""

import argparse
import json
import lzma
import re
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

FEED = "https://cluster-prod.veoride.com/api/shares/name/tam/gbfs"
USER_AGENT = "TAMU-Micromobility class project (github.com/Prat-yush/TAMU-Micromobility)"
CAMPUS_TZ = ZoneInfo("America/Chicago")
NUMBER_RE = re.compile(r"[?&]number=(\d+)")


def fetch(session: requests.Session, name: str) -> dict:
    r = session.get(f"{FEED}/{name}", timeout=20)
    r.raise_for_status()
    return r.json()


def trim(bike: dict) -> dict:
    uris = bike.get("rental_uris") or {}
    m = NUMBER_RE.search(uris.get("ios") or uris.get("android") or "")
    out = {k: v for k, v in bike.items() if k != "rental_uris"}
    out["number"] = m.group(1) if m else None
    return out


def snapshot(session: requests.Session) -> dict:
    fetched_at = int(time.time())
    try:
        feed = fetch(session, "free_bike_status")
        return {
            "fetched_at": fetched_at,
            "last_updated": feed["last_updated"],
            "bikes": [trim(b) for b in feed["data"]["bikes"]],
        }
    except Exception as e:  # a failed poll shouldn't end the run
        return {"fetched_at": fetched_at, "error": repr(e)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--seconds", type=int, required=True, help="how long to collect")
    ap.add_argument("--interval", type=int, default=60, help="seconds between polls")
    ap.add_argument("--out-dir", type=Path, required=True)
    args = ap.parse_args()

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    start = datetime.now(CAMPUS_TZ)
    day_dir = args.out_dir / start.strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)

    types_path = day_dir / "vehicle_types.json"
    if not types_path.exists():
        try:
            types = fetch(session, "vehicle_types")["data"]["vehicle_types"]
            types_path.write_text(json.dumps(types, indent=2) + "\n", encoding="utf-8")
        except Exception as e:
            print(f"vehicle_types fetch failed: {e!r}")

    out_path = day_dir / f"{start.strftime('%H%M%S')}.jsonl.xz"
    deadline = time.monotonic() + args.seconds
    next_poll = time.monotonic()
    polls = errors = 0
    with lzma.open(out_path, "wt", encoding="utf-8") as f:
        while True:
            snap = snapshot(session)
            f.write(json.dumps(snap, separators=(",", ":")) + "\n")
            polls += 1
            errors += "error" in snap
            next_poll += args.interval
            if next_poll >= deadline:
                break
            time.sleep(max(0.0, next_poll - time.monotonic()))

    print(f"{polls} snapshots ({errors} failed) -> {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
