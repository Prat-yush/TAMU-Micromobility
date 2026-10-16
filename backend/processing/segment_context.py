"""Describe what's on the ground along each network segment.

For a segment from backend.geo.network, `describe()` returns its bike
facility, the walking surface it runs over, whether it's in a dismount zone,
and the road it follows: class, owner, speed limit, lanes. It combines the
segment's own OpenStreetMap tags with the TAMU and City of College Station
layers in data/raw/gis_layers/ (see scrapers/gis_layers/fetch.py).

A layer counts for a segment when at least MATCH_SHARE of points sampled
along the segment have a matching feature within reach, so a lane that only
touches the end of a segment doesn't count for all of it. Line layers must
also run roughly parallel to the segment.

Facility, best first; a segment gets the first that applies:
  separated bike path   cycleway, or a path with separate bike and walking lanes
  protected bike lane   city bike plan: protected or raised cycle track, existing
  painted bike lane     TAMU lane stripes, or city bike plan: bike lane or buffered lane
  sharrow or signed route   TAMU sharrows, or city bike plan: signed route
  shared-use path       path marked for both, or a city shared-use path, existing
  shared walkway        any other footway or path: riders share it with walkers
  crossing              a crosswalk or crossing across a road
  road, no bike facility    a road with none of the above
Proposed or funded facilities in the city plans aren't counted; they don't exist yet.
"""

from collections import Counter

from backend.geo.spatial import LineLayer, PolygonLayer, read_layer, sample_along

MATCH_SHARE = 0.5
SAMPLE_STEP_FT = 25
ROAD_REACH_FT = 50  # road centerline to the matching street centerline or marking
PATH_REACH_FT = 30

PATH_HIGHWAYS = {"footway", "path", "pedestrian", "cycleway", "bridleway"}
MAJOR_HIGHWAYS = {"trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"}
MAJOR_CITY_CLASSES = {"FREEWAY", "MAJOR ARTERIAL", "MINOR ARTERIAL"}
# Lane stripes only: emblems and arrows are short marks, often at junctions.
LANE_MARKINGS = {"Lane", "Skip"}
# TAMU walkway "Type" values that describe a walking route rather than a fixture on it.
WALKING_SURFACES = {"Walkway", "Sidewalk", "Plaza", "Mall", "Quad", "Military Walk", "Pathway",
                    "Bridge", "Underpass", "Walkway 2nd Level", "ADA Accessible Path", "Bike Pad",
                    "Cart Path", "Terrace", "Patio", "Landing"}
CITY_BIKE = {
    "Protected bike lanes or cycle tracks (one-way or two-way)": "protected bike lane",
    "Grade-separated/raised cycle tracks (one-way or two-way)": "protected bike lane",
    "Buffered Bike Lanes": "painted bike lane",
    "Bike Lanes (inc. Standard, contra-flow, left side)": "painted bike lane",
    "Signed Bike Route with no on-street bike facility": "sharrow or signed route",
}


class Context:
    """The layers, loaded once."""

    def __init__(self):
        self.bike_plan = LineLayer([f for f in read_layer("bike_plan")
                                    if "Existing" in (f["properties"].get("Status") or "")])
        self.shared_paths = LineLayer([f for f in read_layer("cs_shared_use_paths")
                                       if "Existing" in (f["properties"].get("Status") or "")])
        markings = read_layer("tamu_bike_lane_markings")
        self.lanes = LineLayer([f for f in markings if f["properties"].get("Street_Use") in LANE_MARKINGS])
        self.sharrows = LineLayer([f for f in markings if f["properties"].get("Street_Use") == "Sharrow"])
        self.streets = LineLayer(read_layer("cs_streets"))
        self.walkways = PolygonLayer([f for f in read_layer("tamu_walkways")
                                      if f["properties"].get("Type") in WALKING_SURFACES])
        self.dismount = PolygonLayer(read_layer("tamu_dismount_zones"))

    def share(self, samples, hit) -> float:
        return sum(1 for s in samples if hit(s)) / len(samples) if samples else 0.0

    def majority(self, samples, value):
        """Most common non-empty value across samples, if it covers MATCH_SHARE of them."""
        c = Counter(v for v in (value(s) for s in samples) if v is not None)
        if c:
            v, n = c.most_common(1)[0]
            if n / len(samples) >= MATCH_SHARE:
                return v
        return None

    def describe(self, seg) -> dict:
        tags = seg.tags
        hw = tags.get("highway")
        is_path = hw in PATH_HIGHWAYS
        samples = sample_along(seg.xy, SAMPLE_STEP_FT) or [(seg.xy[0], (1.0, 0.0))]
        reach = PATH_REACH_FT if is_path else ROAD_REACH_FT

        city_bike = self.majority(samples, lambda s: (
            (self.bike_plan.nearest(s[0], reach, s[1]) or {}).get("Facility_Type")))
        street = self.majority(samples, lambda s: (
            (self.streets.nearest(s[0], ROAD_REACH_FT, s[1]) or {}).get("OBJECTID")))
        street_props = next((p for p in self.streets.props if p.get("OBJECTID") == street), {}) \
            if street is not None else {}
        surface = self.majority(samples, lambda s: next(
            (p["Type"] for p in self.walkways.containing(s[0])), None))
        in_dismount = any(self.dismount.containing(s[0]) for s in samples)

        is_crossing = tags.get("footway") == "crossing" or tags.get("cycleway") == "crossing"
        bike_ok = tags.get("bicycle") in ("designated", "yes")
        if is_path and not is_crossing and (
                hw == "cycleway" and tags.get("foot") not in ("designated", "yes")
                or tags.get("segregated") == "yes" and bike_ok):
            facility = "separated bike path"
        elif CITY_BIKE.get(city_bike) == "protected bike lane":
            facility = "protected bike lane"
        elif not is_path and (
                self.share(samples, lambda s: self.lanes.nearest(s[0], reach, s[1])) >= MATCH_SHARE
                or CITY_BIKE.get(city_bike) == "painted bike lane"):
            facility = "painted bike lane"
        elif not is_path and (
                self.share(samples, lambda s: self.sharrows.nearest(s[0], reach)) > 0
                or CITY_BIKE.get(city_bike) == "sharrow or signed route"):
            facility = "sharrow or signed route"
        elif is_path and not is_crossing and (
                hw == "cycleway" or tags.get("bicycle") == "designated"
                or self.share(samples, lambda s: self.shared_paths.nearest(s[0], reach, s[1]))
                >= MATCH_SHARE):
            facility = "shared-use path"
        elif is_crossing:
            facility = "crossing"
        elif is_path:
            facility = "shared walkway"
        else:
            facility = "road, no bike facility"

        lanes = [street_props.get("FT_Lanes"), street_props.get("TF_Lanes")]
        if all(isinstance(x, int) for x in lanes) and sum(lanes) > 0:
            lane_count = sum(lanes)
        else:  # the city layer rarely has lanes; OpenStreetMap often does
            lane_count = int(tags["lanes"]) if str(tags.get("lanes", "")).isdigit() else None
        return {
            "facility": facility,
            "walking_surface": surface,
            "in_dismount_zone": in_dismount,
            "road_name": (tags.get("name") or (street_props.get("FULL_NAME") or "").title() or None)
            if not is_path else None,
            "road_class": street_props.get("FSC") if not is_path else None,
            "road_owner": street_props.get("Owner") if not is_path else None,
            "speed_limit_mph": (street_props.get("SPD_LIMIT") or None) if not is_path else None,
            "lanes": lane_count if not is_path else None,
            "major_road": not is_path and (hw in MAJOR_HIGHWAYS
                                           or street_props.get("FSC") in MAJOR_CITY_CLASSES
                                           or street_props.get("Owner") == "TXDOT"),
        }
