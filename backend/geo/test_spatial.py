from backend.geo.network import to_lonlat
from backend.geo.spatial import LineLayer, PolygonLayer, sample_along


def line(*pts_ft, **props):
    return {"properties": props,
            "geometry": {"type": "LineString", "coordinates": [to_lonlat(*p) for p in pts_ft]}}


def square(x0, y0, size, **props):
    ring = [(x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size), (x0, y0)]
    return {"properties": props,
            "geometry": {"type": "Polygon", "coordinates": [[to_lonlat(*p) for p in ring]]}}


def test_nearest_line_must_run_roughly_parallel():
    layer = LineLayer([line((0, 0), (1000, 0), name="east-west")])
    assert layer.nearest((500, 20), 50, direction=(1.0, 0.0))["name"] == "east-west"
    assert layer.nearest((500, 20), 50, direction=(0.0, 1.0)) is None  # a cross street
    assert layer.nearest((500, 80), 50) is None  # too far


def test_within_lists_each_feature_once_nearest_first():
    layer = LineLayer([line((0, 100), (1000, 100), name="far"),
                       line((0, 10), (1000, 10), name="near")])
    assert [p["name"] for p in layer.within((500, 0), 150)] == ["near", "far"]


def test_polygon_contains_respects_holes():
    outer = square(0, 0, 100, name="plaza")
    outer["geometry"]["coordinates"].append(
        [to_lonlat(*p) for p in [(40, 40), (60, 40), (60, 60), (40, 60), (40, 40)]])
    layer = PolygonLayer([outer])
    assert [p["name"] for p in layer.containing((10, 10))] == ["plaza"]
    assert layer.containing((50, 50)) == []  # in the hole
    assert layer.containing((150, 50)) == []


def test_sample_along_spaces_points_evenly():
    samples = sample_along([(0, 0), (100, 0)], step_ft=25)
    assert [round(p[0]) for p, _ in samples] == [12, 38, 62, 88]
    assert all(d == (1.0, 0.0) for _, d in samples)
