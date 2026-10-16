"""Download campus path, bike and street GIS layers into data/raw/gis_layers/.

    python scrapers/gis_layers/fetch.py              # every layer
    python scrapers/gis_layers/fetch.py tamu_walkways osm_paths   # just these

Sources, all public:
  - TAMU's official campus basemap and Transportation Services' BikeMap (gis.tamu.edu)
  - TAMU Transportation Services' bike lane layers (arc.ts.tamu.edu)
  - City of College Station open data (gis.cstx.gov)
  - OpenStreetMap, through the Overpass API

Only features that touch the area around main campus (BBOX) are kept. Each
layer is saved as GeoJSON in WGS84 as the source returned it, with ArcGIS
coordinates rounded to 6 decimal places (about 4 inches), and
_sources.json records where each file came from, when, and how many features
it has. bike_plan.geojson and trails.geojson in the same folder were added by
hand and are not touched here.
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "raw" / "gis_layers"
USER_AGENT = "TAMU-Micromobility class project (github.com/Prat-yush/TAMU-Micromobility)"

# Main campus plus the roads around it: west of Texas Ave, east of FM 2818,
# north of the Research Park, south of Northgate.
BBOX = (-96.375, 30.585, -96.315, 30.640)  # min lon, min lat, max lon, max lat

TAMU = "https://gis.tamu.edu/arcgis/rest/services"
TAMU_TS = "https://arc.ts.tamu.edu/arcgis/rest/services/Hosted"
CITY = "https://gis.cstx.gov/csgis/rest/services/_OpenData"

ARCGIS_LAYERS = {
    # TAMU campus basemap. Area outlines, not center lines: every paved
    # walking surface on campus, typed (Walkway, Sidewalk, Plaza, Mall,
    # Military Walk, Bike Pad, Lamp Base, ...).
    "tamu_walkways": f"{TAMU}/FCOR/TAMU_Basemap_20261008/MapServer/18",
    "tamu_street_pavement": f"{TAMU}/FCOR/TAMU_Basemap_20261008/MapServer/13",
    "tamu_steps": f"{TAMU}/FCOR/TAMU_Basemap_20261008/MapServer/15",
    "tamu_campus_driveways": f"{TAMU}/FCOR/TAMU_Basemap_20261008/MapServer/19",
    # TAMU Transportation Services' bike map.
    "tamu_bike_lane_markings": f"{TAMU}/TS/BikeMap/FeatureServer/3",
    "tamu_dismount_zones": f"{TAMU}/TS/BikeMap/FeatureServer/5",
    "tamu_bike_fix_stations": f"{TAMU}/TS/BikeMap/FeatureServer/2",
    "tamu_crossing_markings": f"{TAMU_TS}/Bike_Lanes_view/FeatureServer/0",
    # City of College Station. The city's Bicycle Plan is bike_plan.geojson.
    "cs_pedestrian_plan": f"{CITY}/OpenData_PDS/FeatureServer/9",
    "cs_shared_use_paths": f"{CITY}/OpenData_PDS/FeatureServer/20",
    "cs_streets": f"{CITY}/OpenData_PWS/FeatureServer/1",
}

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OSM_QUERIES = {
    # Footways, cycleways, crossings, steps: the connected path network
    # through campus that the city and TAMU layers don't provide as lines.
    "osm_paths": 'way["highway"~"^(footway|cycleway|path|pedestrian|steps|bridleway)$"]',
    "osm_roads": 'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|'
                 'residential|service|living_street)(_link)?$"]',
}


def get_json(session, url, **kw):
    for attempt in range(4):
        try:
            r = session.get(url, timeout=120, **kw) if "data" not in kw else None
            if r is None:
                r = session.post(url, timeout=180, **kw)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            if attempt == 3:
                raise
            print(f"    retrying after {e!r:.120}")
            time.sleep(10 * (attempt + 1))


def fetch_arcgis(session, url):
    """All features in BBOX, paged by resultOffset, as one GeoJSON FeatureCollection."""
    meta = get_json(session, url, params={"f": "json"})
    page = meta.get("maxRecordCount") or 1000
    # Paging needs a stable sort; the id field isn't always called OBJECTID.
    oid = meta.get("objectIdField") or next(
        f["name"] for f in meta["fields"] if f["type"] == "esriFieldTypeOID")
    features, offset = [], 0
    while True:
        data = get_json(session, f"{url}/query", params={
            "where": "1=1",
            "geometry": ",".join(map(str, BBOX)),
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "outSR": 4326,
            "orderByFields": oid,
            # 6 decimal places is about 4 inches; the source's 15 add only file size.
            "geometryPrecision": 6,
            "resultOffset": offset,
            "resultRecordCount": page,
            "f": "geojson",
        })
        if "error" in data:
            raise RuntimeError(data["error"])
        batch = data.get("features", [])
        features += batch
        if len(batch) < page:
            break
        offset += page
    return {"type": "FeatureCollection", "features": features}, meta.get("name")


def fetch_osm(session, selector):
    """Overpass ways with their tags and geometry, as GeoJSON LineStrings."""
    s, w, n, e = BBOX[1], BBOX[0], BBOX[3], BBOX[2]
    query = f"[out:json][timeout:180];{selector}({s},{w},{n},{e});out geom tags;"
    last = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            data = get_json(session, endpoint, data={"data": query})
            break
        except Exception as e:  # these public servers are often overloaded
            last = e
            print(f"    {endpoint} failed: {e!r:.120}")
    else:
        raise RuntimeError(f"every Overpass endpoint failed: {last!r}")
    features = [
        {
            "type": "Feature",
            "id": f"way/{el['id']}",
            "geometry": {"type": "LineString",
                         "coordinates": [[g["lon"], g["lat"]] for g in el["geometry"]]},
            "properties": {"osm_id": el["id"], **el.get("tags", {})},
        }
        for el in data["elements"] if el.get("type") == "way" and el.get("geometry")
    ]
    meta = {"osm_base": data.get("osm3s", {}).get("timestamp_osm_base")}
    return {"type": "FeatureCollection", "features": features}, meta


def main():
    wanted = set(sys.argv[1:]) or set(ARCGIS_LAYERS) | set(OSM_QUERIES)
    unknown = wanted - set(ARCGIS_LAYERS) - set(OSM_QUERIES)
    if unknown:
        sys.exit(f"Unknown layer(s): {', '.join(sorted(unknown))}")

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    sources_path = OUT_DIR / "_sources.json"
    sources = json.loads(sources_path.read_text()) if sources_path.exists() else {}
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    failed = []
    for name in sorted(wanted):
        print(name)
        try:
            if name in ARCGIS_LAYERS:
                url = ARCGIS_LAYERS[name]
                collection, title = fetch_arcgis(session, url)
                source = {"url": url, "source_layer_name": title}
            else:
                collection, extra = fetch_osm(session, OSM_QUERIES[name])
                source = {"url": "OpenStreetMap via Overpass API", "selector": OSM_QUERIES[name],
                          "license": "ODbL 1.0, (c) OpenStreetMap contributors", **extra}
        except Exception as e:
            print(f"  FAILED: {e!r:.200}")
            failed.append(name)
            continue
        path = OUT_DIR / f"{name}.geojson"
        path.write_text(json.dumps(collection, separators=(",", ":")) + "\n", encoding="utf-8")
        sources[name] = {
            **source,
            "file": path.name,
            "bbox": BBOX,
            "feature_count": len(collection["features"]),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        print(f"  {len(collection['features'])} features, {path.stat().st_size / 1e6:.1f} MB")

    sources_path.write_text(json.dumps(dict(sorted(sources.items())), indent=2) + "\n")
    if failed:
        sys.exit(f"Failed: {', '.join(failed)}. Re-run with just those names to retry.")


if __name__ == "__main__":
    main()
