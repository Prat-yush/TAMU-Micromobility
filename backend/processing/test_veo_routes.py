import math

from backend.geo.network import Network, Segment, SegmentIndex, to_lonlat
from backend.processing.veo_routes import match_ride


def grid_network(blocks=3, block_ft=500):
    """Square street grid, `blocks` blocks a side, segments named by their two corners."""
    node_xy, segments, adjacency = {}, {}, {}
    for i in range(blocks + 1):
        for j in range(blocks + 1):
            node_xy[i * 10 + j] = (i * block_ft, j * block_ft)
    for n, (x, y) in node_xy.items():
        for m in (n + 10, n + 1):
            if m in node_xy and math.dist(node_xy[n], node_xy[m]) == block_ft:
                sid = f"{n}-{m}"
                xy = [node_xy[n], node_xy[m]]
                segments[sid] = Segment(sid, n, m, xy, block_ft, {}, [0.0, block_ft])
                adjacency.setdefault(n, []).append((sid, m))
                adjacency.setdefault(m, []).append((sid, n))
    return Network(segments, adjacency, node_xy)


def test_ride_along_streets_matches_them_in_order():
    net = grid_network()
    # East along y=0 from x=100 to the corner at x=1000, then north to y=400,
    # each position a little off the street.
    ride = [(100, 12), (600, -10), (900, 10), (1010, 400)]
    m = match_ride(net, SegmentIndex(net), [to_lonlat(*p) for p in ride])
    assert m["segments"] == ["0-10", "10-20", "20-21"]
    assert m["breaks"] == 0 and m["positions_unmatched"] == 0


def test_position_far_from_any_street_is_skipped():
    net = grid_network()
    ride = [(0, 0), (250, 250), (500, 0)]  # the middle point is in a block's interior
    m = match_ride(net, SegmentIndex(net), [to_lonlat(*p) for p in ride])
    assert m["positions_unmatched"] == 1
    assert m["segments"] == ["0-10"]
