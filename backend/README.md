# Backend and data guide

This guide is for the people building the dashboard, and for the AI assistant
(Claude, ChatGPT) helping them. It says what data the backend produces, where
it is, what every field means, what the data can and can't support, and how
it's made. Paste it into your assistant's context before you start; it
should be enough to brainstorm views and write the D3 code without digging
through the backend.

Everything the dashboard needs is in **`frontend/data/`**. The frontend reads
only from there (see [ARCHITECTURE.md](../ARCHITECTURE.md)). If a view needs
something that isn't in those files, ask the backend owner for a new export
rather than reading `data/raw/` or `data/interim/` from the page.

## Quick facts

- **Six files**, all plain JSON, loaded with `d3.json()`:

  | File | Size | What it is |
  |---|---|---|
  | `veo_segments.geojson` | 2.9 MB | Ride counts on every path and street segment Veo riders used, with what's on the ground there |
  | `veo_rides.geojson` | 2.6 MB | Every ride: its GPS path, times, distance, speeds, and the segments its route used |
  | `veo_conflict_points.geojson` | 28 KB | Places where rides cross or turn onto a major road, with the crossing treatment |
  | `veo_timeline.json` | 3 KB | Rides started per 15 minutes for each collection day |
  | `theft_zones.geojson` | 98 KB | Reported bike, e-bike and e-scooter thefts per bike rack zone |
  | `campus_landmarks.geojson` | 16 KB | Landmarks, libraries and residence halls as points, for map labels (`label`, `category`, `priority`: 1 at every zoom, 2 when zoomed in) |

- **Coordinates are WGS84 longitude, latitude** (GeoJSON order: `[lon, lat]`),
  so `d3.geoPath()` with `d3.geoMercator().fitSize(...)` draws them directly.
  Main campus is about lon -96.3625 to -96.3295, lat 30.592 to 30.634.
- **US units everywhere:** feet (`_ft`), miles, mph (`_mph`). Times are
  campus local time (America/Chicago, CDT, UTC-5) as ISO strings with offset.
- **Every value is real, recorded data or a plain count of it.** Nothing is
  predicted or estimated per place, with one exception: which path a ride
  used between GPS positions is inferred (see "Caveats").
- **Required credit in the page footer:** "© OpenStreetMap contributors",
  linked to https://www.openstreetmap.org/copyright, wherever the Veo route
  data is shown. Also credit Veo, Texas A&M Transportation Services and the
  TAMU campus basemap, the City of College Station, and TAMU UPD crime alerts
  and the Clery crime log. The exact text is in each file's `metadata.credit`
  or `credit`.

## The project's questions, and where the answers are

| Question | File | Fields |
|---|---|---|
| What are the busiest routes on campus? | `veo_segments.geojson` | `rides` (line width or colour), by `rides_weekday`, `rides_weekend`, `rides_after_dark`, `rides_by_hour`, `rides_by_date` |
| Which busy routes have no good bike facility? | `veo_segments.geojson` | `facility` with `rides` and `length_ft` (ride-miles = `rides * length_ft / 5280`), `walking_surface`, `in_dismount_zone` |
| Where do bike routes meet busy car roads (conflict zones)? | `veo_conflict_points.geojson` | `rides`, `speed_limit_mph`, `lanes`, `signalized`, `city_crossing_treatment`, `grade_separation_nearby` |
| Which routes are used at night? | `veo_segments.geojson`, `veo_conflict_points.geojson` | `rides_after_dark`, `rides_by_hour` |
| When do people ride? | `veo_timeline.json` | `days[].rides_started` per 15 minutes |
| How long and how fast are rides? Which rides used this road? | `veo_rides.geojson` | `duration_s`, `path_miles`, `avg_speed_mph`, `max_speed_mph`, `segment_ids`, `times` |
| Where are bikes stolen? | `theft_zones.geojson` | `theft_count`, `rack_capacity`, `incidents` |

First findings, to check your views against: 1,859 rides; 61% of ride-miles
are on shared walkways (41%) or roads with no bike facility (20%); the
busiest route is Pickard Pass (424 rides); the busiest conflict points are
on University Drive, George Bush Drive West and Wellborn Road.

## File by file

### `veo_segments.geojson`

A GeoJSON FeatureCollection of **4,455 LineStrings**, one per network
segment that at least one ride used, sorted busiest first. A segment is a
piece of an OpenStreetMap path or road between two junctions; median length
about 60 ft. Segments no ride used aren't included.

`metadata`: `description`, `ride_count` (1,859), `collection_windows`
(`{date: [start, end]}`), `units`, `credit`.

| Property | Type | Meaning |
|---|---|---|
| `segment_id` | string | `"<OpenStreetMap way id>-<piece>"`, e.g. `"138068425-0"`. Unique and stable while the map data is unchanged. |
| `length_ft` | int | Segment length in feet |
| `rides` | int | Rides whose route used this segment. A ride counts once per segment. |
| `rides_weekday`, `rides_weekend` | int | Split of `rides`. Weekend is only Saturday Oct 10. |
| `rides_after_dark` | int | Rides that started after civil dusk (about 7:20 PM in mid-October) |
| `rides_by_hour` | int[24] | Rides by the hour they started, index 0 = midnight |
| `rides_by_date` | `{date: int}` | Rides by collection day |
| `facility` | string | What a rider has here; one of the categories below |
| `walking_surface` | string or null | TAMU basemap surface the segment runs over: `Walkway`, `Sidewalk`, `Plaza`, `Pathway`, `Bike Pad`, `Military Walk`, `Quad`, `Underpass`, `Bridge`, `Walkway 2nd Level`. Null on streets and where no surface matched. |
| `in_dismount_zone` | bool | Any part is inside a TAMU dismount zone (MSC–Rudder Plaza, Military Walk) |
| `road_name` | string or null | Street name; null on paths |
| `road_class` | string or null | City street class: `TAMU` (campus street), `MAJOR ARTERIAL`, `MAJOR COLLECTOR`, `MINOR COLLECTOR`, `LOCAL STREET`, `ACCESS EASEMENT`. Null on paths or where no city street matched. |
| `road_owner` | string or null | `TAMU`, `TXDOT` (state roads: University Dr, Wellborn Rd, George Bush Dr, Texas Ave), `COCS` (city), `PRIVATE` |
| `speed_limit_mph` | int or null | Posted limit from the city streets layer |
| `lanes` | int or null | Travel lanes, city layer or OpenStreetMap |
| `major_road` | bool | A major road (trunk, primary or secondary in OpenStreetMap, a city arterial, or TxDOT-owned) |
| `osm_*` | string, optional | Raw OpenStreetMap tags, present only when OpenStreetMap has them: `osm_highway` (always: `footway`, `service`, `unclassified`, `cycleway`, `tertiary`, `primary`, `residential`, `path`, `secondary`, `*_link`, `pedestrian`), `osm_name` (on about a quarter of segments), `osm_bicycle`, `osm_foot`, `osm_segregated`, `osm_cycleway`, `osm_footway` (`crossing`, `sidewalk`), `osm_crossing`, `osm_surface`, `osm_lanes`, `osm_maxspeed`, `osm_oneway`, `osm_service`, `osm_lit` |

**`facility` categories**, decided in this order (a segment gets the first that applies):

| Value | Meaning | Segments |
|---|---|---|
| `separated bike path` | Cycleway, or a path with separate bike and walking lanes (e.g. Pickard Pass) | 62 |
| `protected bike lane` | Protected or raised cycle track on a street (city bike plan) | 34 |
| `painted bike lane` | Painted bike lane or buffered lane (TAMU lane striping or city bike plan) | 491 |
| `sharrow or signed route` | Shared-lane markings or a signed bike route, no lane | 36 |
| `shared-use path` | Path marked for both bikes and walkers, or a city shared-use path | 147 |
| `shared walkway` | Any other footway or path: riders mix with pedestrians | 1,789 |
| `crossing` | A crosswalk or crossing across a road | 575 |
| `road, no bike facility` | A street with none of the above | 1,321 |

Only facilities that exist today count; proposed or funded ones in city plans don't.

**Names:** most busy central walkways have no name in OpenStreetMap
(`osm_name` missing). Label them by nearby buildings, or show "walkway".
Use `osm_name ?? road_name` for a label.

### `veo_rides.geojson`

A FeatureCollection of **1,859 LineStrings**, one per ride, sorted by start
time. Each line runs through the GPS positions Veo reported for the vehicle,
about one a minute: from where it was parked before the ride to where it was
parked after. These are the measured positions, not the estimated route;
straight lines between them cut corners. `metadata` has `ride_count`,
`collection_windows`, `units` and `credit`.

| Property | Type | Meaning |
|---|---|---|
| `ride_id` | string | `"<YYYYMMDD-HHMMSS start>-<Veo vehicle number>"`, unique |
| `date` | string | `YYYY-MM-DD`, campus local |
| `weekday`, `after_dark` | bool | As in segments |
| `started_at`, `ended_at` | string | ISO time with offset. A ride started between the last parked sighting and this time, so starts are accurate to about a minute. |
| `duration_s` | int | Seconds from `started_at` to `ended_at` |
| `path_miles` | number | Distance along the GPS positions |
| `straight_miles` | number | Straight line from start to end |
| `avg_speed_mph` | number | `path_miles` over the time between the parked sightings |
| `max_speed_mph` | number | Fastest step between positions. Veo caps vehicles at 15 mph; readings a little above that are GPS noise. |
| `times` | int[] | Unix time (seconds) of each coordinate, same length and order as the geometry. Use it to animate rides or slice them by time. |
| `segment_ids` | string[] | The estimated route, in order: `segment_id`s from `veo_segments.geojson`. Use it to highlight the rides that used a clicked segment, or to recount segments for any custom filter (a ride counts once per segment). |

Typical ride: 5 minutes, 0.65 miles, 6 mph average.

### `veo_conflict_points.geojson`

A FeatureCollection of **49 Points**, sorted by `rides`. Each is a place
where rides cross a major road, or turn onto or off one, with nearby network
nodes grouped together (within 120 ft) so one intersection is one point. A
ride counts once per point. `metadata` as above.

**These show exposure to traffic, not crashes.** Usable micromobility crash
data doesn't exist for campus (TxDOT's CRIS has almost none), so don't title
these "accident hotspots".

| Property | Type | Meaning |
|---|---|---|
| `major_roads` | string[] | Name(s) of the major road(s) here |
| `crossing_streets` | string[] | Other named streets meeting here (may be empty) |
| `rides`, `rides_weekday`, `rides_weekend`, `rides_after_dark`, `rides_by_hour` | int / int[24] | As in segments |
| `speed_limit_mph`, `lanes` | int or null | Of the major road |
| `signalized` | bool | Traffic signal, from OpenStreetMap or the city |
| `osm_crossing` | string[] | OpenStreetMap crossing types here: `traffic_signals`, `marked`, `unmarked`, `uncontrolled` |
| `city_traffic_control` | string[] | City crosswalks within 150 ft: `Traffic Signals`, `Stop Sign`, `No Traffic Control` |
| `city_crossing_treatment` | string[] | `High Visibility Crosswalk Marking Only`, `Raised Refuge Island OR Curb Extension(s) Only` |
| `tamu_crosswalk_markings`, `tamu_bike_crossing_markings` | int | TAMU-painted crosswalks and bike crossings within 150 ft (TAMU paints only campus streets, so 0 on state roads) |
| `grade_separation_nearby` | bool | An existing bike bridge or underpass within 300 ft. Riders there may go over or under the road instead of crossing it; flag these rather than ranking them as conflicts. |

Notable: the busiest unsignalized points are University Drive (63 rides,
40 mph, unmarked crossing; not yet checked on the ground), Wellborn Road
(61 rides, but next to a grade separation), the University Dr / Wellborn Rd
ramps (45, marked but uncontrolled) and George Bush Drive West (36, 40 mph).

### `veo_timeline.json`

```json
{
  "bin_minutes": 15,
  "credit": "...",
  "days": [
    {"date": "2026-10-10", "weekday": false,
     "window": ["2026-10-10T10:56-05:00", "2026-10-10T19:59-05:00"],
     "rides": 332,
     "rides_started": {"10:45": 4, "11:00": 16, "...": 0}}
  ]
}
```

`rides_started` maps `"HH:MM"` (start of each 15-minute bin) to rides started.
**Bins with no rides are left out**: fill zeros yourself, but only between
`window[0]` and `window[1]`. Time outside a window wasn't collected; draw it
as a gap, never as zero.

### `theft_zones.geojson`

A FeatureCollection of **92 Points**: 89 campus bike-rack zones (clusters of
racks) and 3 off-campus places where thefts were reported. 36 have thefts.
Covers reported thefts, Feb 3, 2025 to Aug 8, 2026.

| Property | Type | Meaning |
|---|---|---|
| `zone_id`, `name` | string | e.g. `zone-046`, `Zachry & Emerging Technologies` |
| `kind` | string | `campus` or `off_campus` |
| `rack_count`, `rack_capacity` | int or null | Regular bike racks and their total spaces (TAMU inventory). Null off campus. Park West and The Gardens show low capacity because their own racks aren't in TAMU's inventory. |
| `theft_count` | int | Reported thefts; 0 means none reported, not "safe" |
| `first_incident`, `last_incident` | string or null | Dates |
| `incidents` | object[] | Each theft: `case_no`, `incident_date` (best-known day), `report_date`, `last_seen`, `discovered_missing`, `window_hours`, `report_type` (`theft` or `attempted_theft`), `location` (as reported), `source` (`upd_crime_alert` or `clery_log`), `source_url` |

Top-level `unplaced_incidents` lists 4 thefts whose building couldn't be
located. `metadata` has the date range and counts.

## Caveats the dashboard should show

1. **Collection windows.** Veo data covers only these times:
   Sat Oct 10 10:56 AM–8:00 PM, Mon Oct 12 9:50 AM–8:00 PM,
   Tue Oct 13 11:31 AM–8:00 PM, Wed Oct 14 5:58 PM–11:00 PM (an evening run).
   No day has data before 9:50 AM, so there is no morning commute. Saturday is
   the only weekend day. Say "Oct 10–14, 2026, partial days", and don't
   compare days as if they were equal.
2. **Routes are estimates.** Veo reports a ridden vehicle's position about
   once a minute (often 500+ ft apart). The backend infers the path between
   positions from the street and path network. Counts per segment are
   reliable in aggregate, but where a sidewalk runs right beside a road, the
   data can't tell which one a rider used.
3. **Counts are per segment, not per route.** A long path is many segments
   with slightly different counts. To rank "routes", group by name and take
   the busiest segment (adding segments counts a ride several times).
4. **After dark** = started after civil dusk. Mostly Wednesday's evening run
   (169 of 245 after-dark rides).
5. **All rides are Veo e-bikes.** No pedal-bike rides were recorded.
6. **Facility tags can flicker** on short segments near intersections (a
   20 ft piece tagged differently from the street around it).
7. **Conflict points are exposure, not crashes.** Theft counts are reported
   thefts only.

## Loading the data in D3

```js
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const [segments, rides, conflicts, timeline, thefts] = await Promise.all([
  d3.json("data/veo_segments.geojson"),
  d3.json("data/veo_rides.geojson"),
  d3.json("data/veo_conflict_points.geojson"),
  d3.json("data/veo_timeline.json"),
  d3.json("data/theft_zones.geojson"),
]);

const projection = d3.geoMercator().fitSize([width, height], segments);
const path = d3.geoPath(projection);

svg.selectAll("path.segment")
  .data(segments.features.slice().reverse())   // busiest drawn last, on top
  .join("path")
  .attr("d", path)
  .attr("fill", "none")
  .attr("stroke-width", (d) => Math.sqrt(d.properties.rides) / 2);
```

For a time filter, sum `rides_by_hour[h]` over the chosen hours; for a day
filter, read `rides_by_date[date]`. Both exist on every segment and
conflict point, so nothing needs recomputing. For any other filter (a
custom time range, rides over 10 minutes), filter `veo_rides.geojson` and
recount segments from each ride's `segment_ids`.

There is no basemap (buildings, streets) in `frontend/data/` yet. The
segments themselves outline campus well. If you want buildings or the full
street grid behind them, ask for an export; the raw layers exist.

## What else exists (ask for an export if you need it)

These aren't in `frontend/data/`, so the page can't use them yet. The backend
can export any of them on request:

- **The whole path and street network**, including segments nobody rode.
- **Basemap layers** in `data/raw/gis_layers/`: campus walkways, street
  pavement, steps, bike lane markings, dismount zones, bike fix stations,
  city sidewalks, crosswalks, shared-use paths, the city bike plan (existing
  **and proposed** facilities), and park trails. TAMU building outlines
  aren't downloaded yet; the campus basemap has them.
- **Bike racks** with capacity (`data/raw/bike_theft_tracker/racks.geojson`).

## How the backend works

```
scrapers/                 data/raw/                      backend/                         frontend/data/
veo_gbfs/collect.py   ->  veo_gbfs/<date>/*.jsonl.xz  -> processing/veo_rides.py   -> data/interim/veo_rides.geojson
gis_layers/fetch.py   ->  gis_layers/*.geojson        -> geo/network.py
                                                         processing/veo_routes.py  -> data/interim/veo_routes.json
                                                         processing/segment_context.py
                                                         analysis/veo_segments.py
                                                         analysis/veo_conflicts.py
                                                         export/veo.py             -> veo_segments.geojson
                                                                                      veo_rides.geojson
                                                                                      veo_conflict_points.geojson
                                                                                      veo_timeline.json
bike_theft_tracker/   ->  bike_theft_tracker/*        -> processing/thefts.py
  import_snapshot.py      data/reference/theft_places.json   analysis/theft_zones.py
                                                         export/thefts.py          -> theft_zones.geojson
```

| Module | What it does |
|---|---|
| `processing/veo_rides.py` | Turns one-minute Veo snapshots into rides. A ridden vehicle stays in Veo's feed marked `is_reserved` with a fresh position each minute; vehicles are followed by their `number` because Veo rotates `bike_id`. Drops runs cut off by a collection window, under 500 ft, or Veo putting vehicles into service. Cleans stale GPS repeats and glitches over 25 mph (Veo caps at 15 mph). |
| `geo/network.py` | Builds a routable network (14,053 segments) from OpenStreetMap paths and roads. Leaves out steps, private ways and drive-throughs. |
| `processing/veo_routes.py` | Matches each ride to the network (a hidden Markov model, the standard method for sparse GPS). |
| `processing/segment_context.py` | Tags each segment with its facility, walking surface, dismount zone and road context from the TAMU, city and OpenStreetMap layers. |
| `analysis/veo_segments.py`, `analysis/veo_conflicts.py` | Count rides per segment; find conflict points. |
| `export/veo.py`, `export/thefts.py`, `export/landmarks.py` | Write the files in `frontend/data/`. |
| `geo/spatial.py` | Small spatial helpers (nearest line, point in polygon); no spatial library is used. |

**Regenerate everything** (Python 3.12+, `pip install -r requirements.txt`; the only dependency is `requests`):

```bash
python -m backend.processing.veo_rides
python -m backend.processing.veo_routes    # about 80 s
python -m backend.export.veo
python -m backend.export.thefts
python -m backend.export.landmarks
pytest                                     # 15 tests
```

The outputs are deterministic: rerunning on the same raw data gives the same
files.

### Raw data in `data/raw/`

| Folder | Contents | Source |
|---|---|---|
| `veo_gbfs/` | 2,031 one-minute snapshots of every Veo vehicle, Oct 10, 12, 13, 14, 2026, one `.jsonl.xz` file per half hour. Format in `scrapers/veo_gbfs/collect.py`. | Veo's public GBFS feed for Texas A&M |
| `gis_layers/` | 15 layers around main campus; `_sources.json` records each one's URL, date and feature count | TAMU campus basemap and BikeMap, TAMU Transportation Services, City of College Station open data, OpenStreetMap (ODbL) |
| `bike_theft_tracker/` | 139 recorded theft incidents, rack zones, rack inventory | Our earlier tamu-bike-theft-tracker project (UPD crime alerts, Clery log, TAMU rack inventory) |

`data/reference/theft_places.json` is the hand-reviewed mapping from each
place named in a theft report to a rack zone.

## Glossary

- **Ride**: one Veo rental with a known start and end, from the vehicle's
  last parked position to its first parked position after.
- **Segment**: a piece of path or street between two junctions, the unit
  rides are counted on.
- **Ride-miles**: rides on a segment times its length in miles; the fair way
  to compare how much riding happens on each facility type.
- **Conflict point**: a place where rides meet a major road.
- **Major road**: trunk, primary or secondary in OpenStreetMap, a city
  arterial, or TxDOT-owned.
- **After dark**: started after civil dusk (sun 6° below the horizon).
- **Dismount zone**: TAMU area where riders must walk their bikes.
