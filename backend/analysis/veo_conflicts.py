"""Find conflict points: where Veo rides cross or turn onto a major road.

A ride meets a major road at a network node when the node is on a major road
(see backend.processing.segment_context) and the ride passes through it
without just continuing along that road: crossing it on a crosswalk or a side
street, or turning onto or off it. Nodes within CLUSTER_FT of each other are
one place, since a single intersection of a divided road has several nodes. A
ride counts once per place.

For each place this reports the rides through it and what crossing exists:
OpenStreetMap crossing tags, City of College Station crosswalks (signal, stop
sign, high-visibility marking, refuge island) and TAMU's painted crosswalk
and bike crossing markings within NEARBY_FT. These are places where bikes meet heavy
traffic, not a record of crashes.
"""

import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from backend.geo.network import Network, to_lonlat
from backend.geo.spatial import LineLayer, read_layer, rings_of
from backend.processing.segment_context import Context

ROOT = Path(__file__).resolve().parents[2]
RIDES_PATH = ROOT / "data" / "interim" / "veo_rides.geojson"
ROUTES_PATH = ROOT / "data" / "interim" / "veo_routes.json"
CLUSTER_FT = 120
NEARBY_FT = 150
GRADE_SEP_FT = 300


def outlines(features):
    """Polygon features as line features along their outer rings, for distance lookups."""
    return [{"properties": f["properties"],
             "geometry": {"type": "MultiLineString",
                          "coordinates": [poly[0] for poly in rings_of(f["geometry"])]}}
            for f in features]


def conflict_points(net: Network, ctx: Context) -> list[dict]:
    rides = {f["properties"]["ride_id"]: f["properties"]
             for f in json.loads(RIDES_PATH.read_text(encoding="utf-8"))["features"]}
    routes = json.loads(ROUTES_PATH.read_text(encoding="utf-8"))
    described = {}

    def info(sid):
        if sid not in described:
            described[sid] = ctx.describe(net.segments[sid])
        return described[sid]

    def major_at(node):
        return [sid for sid, _ in net.adjacency.get(node, ()) if info(sid)["major_road"]]

    # Every (ride, node) where a ride meets a major road.
    meets = defaultdict(set)  # node -> ride ids
    for route in routes:
        segs = route["segments"]
        for s1, s2 in zip(segs, segs[1:]):
            a, b = net.segments[s1], net.segments[s2]
            shared = {a.a, a.b} & {b.a, b.b}
            for node in shared:
                if major_at(node) and not (info(s1)["major_road"] and info(s2)["major_road"]):
                    meets[node].add(route["ride_id"])

    # Group nearby nodes into places (single-link clustering).
    nodes = list(meets)
    parent = {n: n for n in nodes}

    def root(n):
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    for i, n in enumerate(nodes):
        for m in nodes[i + 1:]:
            if math.dist(net.node_xy[n], net.node_xy[m]) <= CLUSTER_FT:
                parent[root(n)] = root(m)
    places = defaultdict(list)
    for n in nodes:
        places[root(n)].append(n)

    city_crossings = LineLayer([f for f in read_layer("cs_pedestrian_plan") if f["properties"]
                                .get("FacilityType") in ("Crosswalk", "Mid-Block Crossing")])
    # The city bike plan marks existing bridges and underpasses for bikes. A place
    # near one may be where riders leave the road to go over or under it.
    grade_separations = LineLayer([f for f in read_layer("bike_plan")
                                   if f["properties"].get("Status") == "Grade Separation Existing"])
    tamu_crossings = LineLayer(outlines(read_layer("tamu_crossing_markings")))
    tamu_xwalk_paint = LineLayer([f for f in read_layer("tamu_bike_lane_markings")
                                  if f["properties"].get("Street_Use") == "X-Walk"])

    out = []
    for members in places.values():
        ride_ids = set().union(*(meets[n] for n in members))
        x = sum(net.node_xy[n][0] for n in members) / len(members)
        y = sum(net.node_xy[n][1] for n in members) / len(members)
        majors = {sid for n in members for sid in major_at(n)}
        others = {sid for n in members for sid, _ in net.adjacency[n]} - majors
        major_names = sorted({info(s)["road_name"] for s in majors} - {None})
        cross_names = sorted({net.segments[s].tags.get("name") or info(s)["road_name"]
                              for s in others} - {None} - set(major_names))
        speeds = [info(s)["speed_limit_mph"] for s in majors if info(s)["speed_limit_mph"]]
        lanes = [info(s)["lanes"] for s in majors if info(s)["lanes"]]
        osm_crossing = sorted({net.segments[s].tags.get("crossing") for s in others} - {None})
        city = city_crossings.within((x, y), NEARBY_FT)
        tamu = Counter(p.get("name") for p in tamu_crossings.within((x, y), NEARBY_FT))
        controls = sorted({p.get("TrafficControl") for p in city} - {None, "", " "})
        treatments = sorted({p.get("CrossingTreatment") for p in city} - {None, "", " ", "None"})
        hours, weekday, dark = [0] * 24, 0, 0
        for rid in ride_ids:
            r = rides[rid]
            hours[datetime.fromisoformat(r["started_at"]).hour] += 1
            weekday += r["weekday"]
            dark += r["after_dark"]
        out.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(v, 6) for v in to_lonlat(x, y)]},
            "properties": {
                "major_roads": major_names,
                "crossing_streets": cross_names,
                "rides": len(ride_ids),
                "rides_weekday": weekday,
                "rides_weekend": len(ride_ids) - weekday,
                "rides_after_dark": dark,
                "rides_by_hour": hours,
                "speed_limit_mph": max(speeds) if speeds else None,
                "lanes": max(lanes) if lanes else None,
                "grade_separation_nearby": bool(grade_separations.within((x, y), GRADE_SEP_FT)),
                "signalized": "traffic_signals" in osm_crossing or "Traffic Signals" in controls,
                "osm_crossing": osm_crossing,
                "city_traffic_control": controls,
                "city_crossing_treatment": treatments,
                "tamu_crosswalk_markings": tamu.get("Ped X", 0)
                + len(tamu_xwalk_paint.within((x, y), NEARBY_FT)),
                "tamu_bike_crossing_markings": tamu.get("Dutch Junction", 0),
            },
        })
    out.sort(key=lambda f: -f["properties"]["rides"])
    return out
