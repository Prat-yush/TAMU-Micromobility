"""The routable path and road network around campus, built from OpenStreetMap.

Reads data/raw/gis_layers/osm_paths.geojson and osm_roads.geojson (see
scrapers/gis_layers/fetch.py). OpenStreetMap ways that meet share a node,
so they share an exact coordinate; that is how ways are joined. Each way is
split at every junction into segments, and a segment is the unit that rides
are counted on.

Left out, because a bike can't use them: steps, ways marked access=no or
private, and drive-throughs. Everything else is kept, including footways
without a bicycle tag: riders use campus walkways whether or not they're
signed for bikes, and the point here is where they actually ride.

Coordinates are projected to feet on a flat plane centred on campus, which is
accurate to well under 1% across an area this small.
"""

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GIS_DIR = ROOT / "data" / "raw" / "gis_layers"

ORIGIN_LAT, ORIGIN_LON = 30.615, -96.340
FT_PER_DEG_LAT = 364_567
FT_PER_DEG_LON = FT_PER_DEG_LAT * math.cos(math.radians(ORIGIN_LAT))

EXCLUDED_HIGHWAYS = {"steps"}
EXCLUDED_ACCESS = {"no", "private"}
EXCLUDED_SERVICE = {"drive-through"}
# OpenStreetMap tags carried onto each segment, for describing it later.
KEPT_TAGS = ("highway", "name", "footway", "cycleway", "bicycle", "foot", "segregated",
             "surface", "lit", "lanes", "maxspeed", "oneway", "service", "crossing")


def to_ft(lon: float, lat: float) -> tuple[float, float]:
    return (lon - ORIGIN_LON) * FT_PER_DEG_LON, (lat - ORIGIN_LAT) * FT_PER_DEG_LAT


def to_lonlat(x: float, y: float) -> tuple[float, float]:
    return ORIGIN_LON + x / FT_PER_DEG_LON, ORIGIN_LAT + y / FT_PER_DEG_LAT


@dataclass
class Segment:
    id: str  # "<osm way id>-<piece>", stable as long as the OpenStreetMap data is
    a: int  # node at the start
    b: int  # node at the end
    xy: list[tuple[float, float]]  # polyline in feet
    length_ft: float
    tags: dict
    # Cumulative length at each vertex, for locating a point along the segment.
    cum: list[float] = field(default_factory=list)


@dataclass
class Network:
    segments: dict[str, Segment]
    adjacency: dict[int, list[tuple[str, int]]]  # node -> [(segment id, other node)]
    node_xy: dict[int, tuple[float, float]]


def rideable(tags: dict) -> bool:
    return not (tags.get("highway") in EXCLUDED_HIGHWAYS
                or tags.get("access") in EXCLUDED_ACCESS
                or tags.get("service") in EXCLUDED_SERVICE)


def polyline_length(xy):
    return sum(math.dist(p, q) for p, q in zip(xy, xy[1:]))


def load_network() -> Network:
    ways = []
    for name in ("osm_paths", "osm_roads"):
        for f in json.loads((GIS_DIR / f"{name}.geojson").read_text(encoding="utf-8"))["features"]:
            if rideable(f["properties"]) and len(f["geometry"]["coordinates"]) > 1:
                ways.append(f)

    # A coordinate shared by two ways, or that ends a way, is a junction.
    use = defaultdict(int)
    for f in ways:
        coords = [tuple(c) for c in f["geometry"]["coordinates"]]
        for c in coords:
            use[c] += 1
        use[coords[0]] += 1
        use[coords[-1]] += 1
    node_ids, node_xy = {}, {}

    def node(c):
        if c not in node_ids:
            node_ids[c] = len(node_ids)
            node_xy[node_ids[c]] = to_ft(*c)
        return node_ids[c]

    segments, adjacency = {}, defaultdict(list)
    for f in ways:
        coords = [tuple(c) for c in f["geometry"]["coordinates"]]
        tags = {k: f["properties"][k] for k in KEPT_TAGS if k in f["properties"]}
        piece, start = 0, 0
        for i in range(1, len(coords)):
            if use[coords[i]] > 1 or i == len(coords) - 1:
                xy = [to_ft(*c) for c in coords[start:i + 1]]
                seg = Segment(f"{f['properties']['osm_id']}-{piece}", node(coords[start]),
                              node(coords[i]), xy, polyline_length(xy), tags)
                seg.cum = [0.0]
                for p, q in zip(xy, xy[1:]):
                    seg.cum.append(seg.cum[-1] + math.dist(p, q))
                if seg.length_ft > 0:
                    segments[seg.id] = seg
                    adjacency[seg.a].append((seg.id, seg.b))
                    adjacency[seg.b].append((seg.id, seg.a))
                piece, start = piece + 1, i
    return keep_largest_component(Network(segments, adjacency, node_xy))


def keep_largest_component(net: Network) -> Network:
    """Drop pieces that don't connect to the main network; no route can reach them."""
    seen, best = set(), set()
    for start in net.adjacency:
        if start in seen:
            continue
        comp, stack = {start}, [start]
        while stack:
            for _, other in net.adjacency[stack.pop()]:
                if other not in comp:
                    comp.add(other)
                    stack.append(other)
        seen |= comp
        best = max(best, comp, key=len)
    segments = {k: s for k, s in net.segments.items() if s.a in best}
    adjacency = {n: net.adjacency[n] for n in best}
    return Network(segments, adjacency, {n: net.node_xy[n] for n in best})


def project(seg: Segment, p: tuple[float, float]) -> tuple[float, float, tuple[float, float]]:
    """Closest point on the segment to p: (distance ft, distance along segment ft, point)."""
    best = (math.inf, 0.0, seg.xy[0])
    for i, (a, b) in enumerate(zip(seg.xy, seg.xy[1:])):
        dx, dy = b[0] - a[0], b[1] - a[1]
        span = dx * dx + dy * dy
        t = 0.0 if span == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / span))
        q = (a[0] + t * dx, a[1] + t * dy)
        d = math.dist(p, q)
        if d < best[0]:
            best = (d, seg.cum[i] + t * math.dist(a, b), q)
    return best


class SegmentIndex:
    """Grid lookup of segments near a point."""

    def __init__(self, net: Network, cell_ft: float = 300):
        self.net, self.cell = net, cell_ft
        self.grid = defaultdict(set)
        for seg in net.segments.values():
            xs, ys = [p[0] for p in seg.xy], [p[1] for p in seg.xy]
            for i in range(int(min(xs) // cell_ft), int(max(xs) // cell_ft) + 1):
                for j in range(int(min(ys) // cell_ft), int(max(ys) // cell_ft) + 1):
                    self.grid[(i, j)].add(seg.id)

    def near(self, p: tuple[float, float], radius_ft: float) -> list[tuple[float, float, str]]:
        """(distance ft, distance along segment ft, segment id) for segments within radius."""
        r = int(math.ceil(radius_ft / self.cell))
        ci, cj = int(p[0] // self.cell), int(p[1] // self.cell)
        ids = set()
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                ids |= self.grid.get((i, j), set())
        out = []
        for sid in ids:
            d, along, _ = project(self.net.segments[sid], p)
            if d <= radius_ft:
                out.append((d, along, sid))
        return sorted(out)
