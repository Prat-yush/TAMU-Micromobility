"""Small spatial helpers for matching network segments to other GIS layers.

Everything works in feet on the flat campus plane from backend.geo.network.
There is no spatial library in this project, and the layers are small enough
that a grid lookup in plain Python is fast.
"""

import json
import math
from collections import defaultdict
from pathlib import Path

from backend.geo.network import to_ft

GIS_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "gis_layers"


def read_layer(name: str) -> list[dict]:
    return [f for f in json.loads((GIS_DIR / f"{name}.geojson").read_text(encoding="utf-8"))
            ["features"] if f.get("geometry")]


def lines_of(geom: dict) -> list[list]:
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


def rings_of(geom: dict) -> list[list[list]]:
    """Polygons as [outer ring, holes...], each ring a list of coordinates."""
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def sample_along(xy: list, step_ft: float = 25) -> list[tuple[tuple, tuple]]:
    """Points every step_ft along a polyline, each with its unit direction."""
    out = []
    for a, b in zip(xy, xy[1:]):
        length = math.dist(a, b)
        if length == 0:
            continue
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        n = max(1, int(length // step_ft))
        for k in range(n):
            t = (k + 0.5) * length / n
            out.append(((a[0] + ux * t, a[1] + uy * t), (ux, uy)))
    return out


def _point_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    span = dx * dx + dy * dy
    t = 0.0 if span == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / span))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


class LineLayer:
    """Line features, queryable for the nearest one roughly parallel to a direction."""

    def __init__(self, features: list[dict], cell_ft: float = 200):
        self.cell, self.grid, self.props = cell_ft, defaultdict(list), []
        for fi, f in enumerate(features):
            self.props.append(f["properties"])
            for line in lines_of(f["geometry"]):
                xy = [to_ft(*c[:2]) for c in line]
                for a, b in zip(xy, xy[1:]):
                    for i in range(int(min(a[0], b[0]) // cell_ft), int(max(a[0], b[0]) // cell_ft) + 1):
                        for j in range(int(min(a[1], b[1]) // cell_ft),
                                       int(max(a[1], b[1]) // cell_ft) + 1):
                            self.grid[(i, j)].append((fi, a, b))

    def nearest(self, p, radius_ft: float, direction=None, min_alignment: float = 0.8):
        """Properties of the nearest feature within radius, or None.

        With `direction`, only pieces within about 37 degrees of parallel count
        (|cos| >= min_alignment), so a cross street doesn't match a road it meets.
        """
        best, best_d = None, radius_ft
        ci, cj = int(p[0] // self.cell), int(p[1] // self.cell)
        r = int(math.ceil(radius_ft / self.cell))
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for fi, a, b in self.grid.get((i, j), ()):
                    if direction is not None:
                        length = math.dist(a, b)
                        if length == 0:
                            continue
                        cos = ((b[0] - a[0]) * direction[0] + (b[1] - a[1]) * direction[1]) / length
                        if abs(cos) < min_alignment:
                            continue
                    d = _point_segment(p, a, b)
                    if d <= best_d:
                        best, best_d = self.props[fi], d
        return best

    def within(self, p, radius_ft: float) -> list[dict]:
        """Properties of every feature within radius, nearest first, each once."""
        found = {}
        ci, cj = int(p[0] // self.cell), int(p[1] // self.cell)
        r = int(math.ceil(radius_ft / self.cell))
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for fi, a, b in self.grid.get((i, j), ()):
                    d = _point_segment(p, a, b)
                    if d <= radius_ft and d < found.get(fi, math.inf):
                        found[fi] = d
        return [self.props[fi] for fi in sorted(found, key=found.get)]


class PolygonLayer:
    """Polygon features, queryable for which ones contain a point."""

    def __init__(self, features: list[dict], cell_ft: float = 200):
        self.cell, self.grid, self.polys = cell_ft, defaultdict(list), []
        for f in features:
            for poly in rings_of(f["geometry"]):
                rings = [[to_ft(*c[:2]) for c in ring] for ring in poly]
                xs, ys = [q[0] for q in rings[0]], [q[1] for q in rings[0]]
                self.polys.append((rings, f["properties"]))
                k = len(self.polys) - 1
                for i in range(int(min(xs) // cell_ft), int(max(xs) // cell_ft) + 1):
                    for j in range(int(min(ys) // cell_ft), int(max(ys) // cell_ft) + 1):
                        self.grid[(i, j)].append(k)

    @staticmethod
    def _inside(p, ring) -> bool:
        x, y, inside = p[0], p[1], False
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
        return inside

    def containing(self, p) -> list[dict]:
        out = []
        for k in self.grid.get((int(p[0] // self.cell), int(p[1] // self.cell)), ()):
            rings, props = self.polys[k]
            if self._inside(p, rings[0]) and not any(self._inside(p, h) for h in rings[1:]):
                out.append(props)
        return out
