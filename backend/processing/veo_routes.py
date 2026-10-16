"""Match each Veo ride to the path and road network.

    python -m backend.processing.veo_routes

Reads data/interim/veo_rides.geojson (from backend.processing.veo_rides) and
writes data/interim/veo_routes.json: for each ride, the network segments its
route most likely used, in order, plus how well the match went.

Ride positions are about a minute apart, often 500+ ft, so the route between
them has to be inferred. This uses the standard method for sparse GPS (a
hidden Markov model, as in Newson & Krumm 2009). For each position, every
segment within SEARCH_RADIUS_FT is a candidate. The chosen sequence balances
two things: each position should be close to its segment (GPS error is about
GPS_SIGMA_FT), and the network route between consecutive positions should be
about as long as the straight line between them, since riders don't take
long detours within a minute.

The result is an estimate. In particular, where a sidewalk runs right beside
a road, positions this coarse can't tell which one a rider used.
"""

import heapq
import json
import math
from collections import Counter
from pathlib import Path

from backend.geo.network import Network, SegmentIndex, load_network, to_ft

ROOT = Path(__file__).resolve().parents[2]
RIDES_PATH = ROOT / "data" / "interim" / "veo_rides.geojson"
OUT_PATH = ROOT / "data" / "interim" / "veo_routes.json"

GPS_SIGMA_FT = 40
SEARCH_RADIUS_FT = 160
MAX_CANDIDATES = 6
# How much a route may exceed the straight line before it's penalised heavily.
DETOUR_BETA_FT = 300
MAX_DETOUR_FACTOR, MAX_DETOUR_EXTRA_FT = 3, 1500
MIN_USE_FT = 1


def routes_from(net: Network, seg_id: str, along: float, limit: float):
    """Shortest network distance from a point on a segment to every node within limit.

    Returns {node: (distance ft, previous node, segment used to arrive)}.
    """
    seg = net.segments[seg_id]
    best, tie = {}, 0  # `tie` keeps heap entries with equal distances comparable
    heap = [(along, 0, seg.a, None, seg_id), (seg.length_ft - along, 1, seg.b, None, seg_id)]
    while heap:
        d, _, n, prev, via = heapq.heappop(heap)
        if n in best or d > limit:
            continue
        best[n] = (d, prev, via)
        for sid, other in net.adjacency.get(n, ()):
            if other not in best:
                tie += 1
                heapq.heappush(heap, (d + net.segments[sid].length_ft, tie + 1, other, n, sid))
    return best


def route_to(net: Network, reach: dict, src: tuple, dst: tuple):
    """Distance and segment sequence from candidate src to candidate dst, or None."""
    (s_id, s_along), (t_id, t_along) = src, dst
    options = []
    if s_id == t_id:
        options.append((abs(t_along - s_along), [s_id]))
    t = net.segments[t_id]
    for end, extra in ((t.a, t_along), (t.b, t.length_ft - t_along)):
        if end in reach:
            options.append((reach[end][0] + extra, end))
    if not options:
        return None
    dist, how = min(options, key=lambda o: o[0])
    if isinstance(how, list):
        return dist, how
    # A segment counts only if the route travels along it. A point sitting on
    # a junction touches every segment there but uses at most two.
    end_extra = t_along if how == t.a else t.length_ft - t_along
    segs, n = ([t_id] if end_extra >= MIN_USE_FT else []), how
    while True:
        d, prev, via = reach[n]
        if prev is None:
            if d >= MIN_USE_FT and (not segs or via != segs[-1]):
                segs.append(via)  # the start segment, from the point to this node
            break
        if not segs or via != segs[-1]:
            segs.append(via)
        n = prev
    segs.reverse()
    return dist, segs


def match_ride(net: Network, index: SegmentIndex, coords: list) -> dict:
    points = [to_ft(lon, lat) for lon, lat in coords]
    cands = [[(d, (sid, along)) for d, along, sid in index.near(p, SEARCH_RADIUS_FT)
              [:MAX_CANDIDATES]] for p in points]

    chains, chain = [], None  # chain: list of {state: (score, back pointer, route)}
    unmatched, prev_i = 0, None
    for i, cs in enumerate(cands):
        if not cs:
            unmatched += 1
            continue
        emit = {state: -0.5 * (d / GPS_SIGMA_FT) ** 2 for d, state in cs}
        layer = {}
        if chain:
            straight = math.dist(points[prev_i], points[i])
            limit = straight * MAX_DETOUR_FACTOR + MAX_DETOUR_EXTRA_FT
            for src, (score, _, _) in chain[-1].items():
                reach = routes_from(net, src[0], src[1], limit)
                for dst, e in emit.items():
                    r = route_to(net, reach, src, dst)
                    if r is None or r[0] > limit:
                        continue
                    s = score + e - abs(r[0] - straight) / DETOUR_BETA_FT
                    if dst not in layer or s > layer[dst][0]:
                        layer[dst] = (s, src, r)
        if not layer:  # first position, or no plausible route from the last one
            if chain:
                chains.append(chain)
            chain = [{state: (e, None, None) for state, e in emit.items()}]
        else:
            chain.append(layer)
        prev_i = i
    if chain:
        chains.append(chain)

    segments, route_ft, snap = [], 0.0, []
    for chain in chains:
        state = max(chain[-1], key=lambda s: chain[-1][s][0])
        pieces = []
        for layer in reversed(chain):
            _, back, r = layer[state]
            if r is not None:
                pieces.append(r)
            state = back if back is not None else state
        for dist, segs in reversed(pieces):
            route_ft += dist
            for sid in segs:
                if not segments or segments[-1] != sid:
                    segments.append(sid)
        if len(chain) == 1:  # a lone position: keep the segment it sits on
            only = max(chain[0], key=lambda s: chain[0][s][0])
            if not segments or segments[-1] != only[0]:
                segments.append(only[0])
    for cs in cands:
        if cs:
            snap.append(cs[0][0])
    return {
        "segments": segments,
        "route_ft": round(route_ft),
        "positions": len(points),
        "positions_unmatched": unmatched,
        "breaks": len(chains) - 1,
        "median_snap_ft": round(sorted(snap)[len(snap) // 2]) if snap else None,
    }


def main():
    net = load_network()
    index = SegmentIndex(net)
    rides = json.loads(RIDES_PATH.read_text(encoding="utf-8"))["features"]
    out, stats = [], Counter()
    for k, ride in enumerate(rides, 1):
        m = match_ride(net, index, ride["geometry"]["coordinates"])
        out.append({"ride_id": ride["properties"]["ride_id"], **m})
        stats["positions"] += m["positions"]
        stats["unmatched"] += m["positions_unmatched"]
        stats["rides with a break"] += m["breaks"] > 0
        stats["rides with no route"] += not m["segments"]
        if k % 500 == 0:
            print(f"  {k} rides matched")
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(out)} rides -> {OUT_PATH.relative_to(ROOT)}; "
          f"{stats['unmatched']} of {stats['positions']} positions had no segment within "
          f"{SEARCH_RADIUS_FT} ft; {stats['rides with a break']} rides have a break; "
          f"{stats['rides with no route']} have no route")


if __name__ == "__main__":
    main()
