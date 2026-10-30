/**
 * components/map.js
 *
 * The campus map at the centre of the dashboard: the OpenStreetMap
 * basemap, cropped to the area the theft reports cover, with the data
 * layers drawn on top. The map is built once and kept; a filter change
 * only redraws the overlays, so the reader's pan and zoom survive it.
 *
 * Layers are switched by the checkboxes on the map (STATE.mapLayers) and
 * narrowed by the filter shelf, like every other view.
 */

/** The Leaflet map and its parts, set once by createCampusMap. */
const CAMPUS_MAP = {
  map: null,
  tiles: null,
  overlays: null,
  /** One canvas for every route line: thousands of SVG paths are slow. */
  routeRenderer: null,
  /** A second canvas, above the routes, for the facility-gap layer. */
  gapRenderer: null,
  /** Building labels. They don't depend on filters, so they're built once. */
  labels: null,
  controls: null,
  legend: null,
};

/**
 * Reads a colour token from the stylesheet.
 *
 * Leaflet's canvas renderer cannot resolve `var(--name)`, so map marks
 * are given the resolved value instead.
 *
 * @param {string} name A custom property name, e.g. "--theft".
 * @returns {string} The colour it holds in the current theme.
 */
function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * True when the page is showing its dark theme.
 *
 * @returns {boolean}
 */
function isDarkTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * The area the map is cropped to: every theft zone, plus a margin.
 *
 * Theft reports reach the furthest from the core of campus, so their
 * extent decides how much map a reader gets. The margin keeps the routes
 * that run just past the outermost zones on the map.
 *
 * @param {Object} data Output of loadData.
 * @returns {L.LatLngBounds} The cropped area.
 */
function campusBounds(data) {
  const points = data.zoneFeatures.map((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    return [lat, lon];
  });
  const [[south, west], [north, east]] = [
    [d3.min(points, (p) => p[0]), d3.min(points, (p) => p[1])],
    [d3.max(points, (p) => p[0]), d3.max(points, (p) => p[1])],
  ];
  const pad = BASEMAP.boundsPadDegrees;

  return L.latLngBounds([south - pad, west - pad], [north + pad, east + pad]);
}

/**
 * Builds the map in its host. Called once on startup.
 *
 * @param {HTMLElement} host Element to draw into; must be in the document
 *     and have a height.
 * @param {Object} data Output of loadData.
 * @param {Function} onLayersChange Called after a layer checkbox changes.
 */
function createCampusMap(host, data, onLayersChange) {
  const map = L.map(host, { zoomSnap: 0.25 });
  map.fitBounds(campusBounds(data));
  map.setMinZoom(map.getZoom());

  // The theft zones decide the zoom; the crop is then whatever fills the
  // panel at that zoom, so the map has no dead margins either side.
  const bounds = map.getBounds();
  map.setMaxBounds(bounds.pad(BASEMAP.panSlack));
  map.options.maxBoundsViscosity = 1;

  // One pane per layer, so theft bubbles never hide the conflict rings
  // drawn over them, whatever order they were switched on in.
  map.createPane("mask").style.zIndex = 390;
  map.createPane("routes").style.zIndex = 410;
  map.createPane("gaps").style.zIndex = 415;
  map.createPane("thefts").style.zIndex = 420;
  map.createPane("conflicts").style.zIndex = 430;
  map.createPane("labels").style.zIndex = 440;

  CAMPUS_MAP.map = map;
  CAMPUS_MAP.overlays = L.layerGroup().addTo(map);
  CAMPUS_MAP.routeRenderer = L.canvas({ pane: "routes", tolerance: 4 });
  CAMPUS_MAP.gapRenderer = L.canvas({ pane: "gaps", tolerance: 4 });
  CAMPUS_MAP.labels = buildingLabels(data);
  map.on("zoomend moveend", placeBuildingLabels);

  CAMPUS_MAP.tiles = L.tileLayer(BASEMAP.tiles, {
    attribution: BASEMAP.attribution,
    maxZoom: BASEMAP.maxZoom,
  }).addTo(map);
  drawOutsideMask(bounds);

  // The stylesheet re-tints the tiles if the reader's theme changes while
  // the page is open; the marks take their colours from the theme, so
  // they are redrawn.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onLayersChange);

  CAMPUS_MAP.controls = layerControl(onLayersChange);
  CAMPUS_MAP.controls.addTo(map);

  CAMPUS_MAP.legend = L.control({ position: "bottomleft" });
  CAMPUS_MAP.legend.onAdd = () => {
    const node = el("div", "map-legend");
    L.DomEvent.disableClickPropagation(node);
    return node;
  };
  CAMPUS_MAP.legend.addTo(map);

  // The host can change size without a window resize (a box above it
  // growing, say), so watch the host itself.
  new ResizeObserver(() => map.invalidateSize()).observe(host);
}

/**
 * Shades everything outside the cropped area.
 *
 * Leaflet still loads a few tiles past the bounds while panning; dimming
 * them makes the edge of the data read as the edge of the map.
 *
 * @param {L.LatLngBounds} bounds The cropped area.
 */
function drawOutsideMask(bounds) {
  const world = [
    [-90, -180],
    [-90, 180],
    [90, 180],
    [90, -180],
  ];
  const hole = [
    bounds.getSouthWest(),
    bounds.getSouthEast(),
    bounds.getNorthEast(),
    bounds.getNorthWest(),
  ];

  L.polygon([world, hole], {
    pane: "mask",
    stroke: false,
    fillColor: cssColor("--bg"),
    fillOpacity: BASEMAP.maskOpacity,
    interactive: false,
  }).addTo(CAMPUS_MAP.map);
}

/**
 * Builds the checkbox panel that switches map layers.
 *
 * @param {Function} onChange Called after any change.
 * @returns {L.Control} The control, not yet added to a map.
 */
function layerControl(onChange) {
  const control = L.control({ position: "topright" });

  control.onAdd = () => {
    const node = el("div", "map-layers");
    node.append(el("div", "ml-title", "Map layers"));

    MAP_LAYERS.forEach((layer) => {
      const row = el("label", "ml-row");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = STATE.mapLayers[layer.key];
      box.onchange = () => {
        STATE.mapLayers[layer.key] = box.checked;
        onChange();
      };
      row.append(box, el("span", `ml-sw ml-sw-${layer.key}`), document.createTextNode(layer.label));
      node.append(row);
    });

    node.append(el("div", "ml-title", "Colour routes by"));
    node.append(
      segmentedControl(
        [
          ["rides", "Rides"],
          ["facility", "Facility"],
        ],
        STATE.routeColor,
        (value) => {
          STATE.routeColor = value;
          syncLayerControl();
          onChange();
        },
        "Colour routes by"
      )
    );

    // Clicks and scrolls on the panel must not pan or zoom the map.
    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);
    return node;
  };

  return control;
}

/**
 * Sets the layer panel's checkboxes and toggle from STATE, after something
 * other than the panel changed them.
 */
function syncLayerControl() {
  const node = CAMPUS_MAP.controls.getContainer();

  node.querySelectorAll("input[type=checkbox]").forEach((box, index) => {
    box.checked = STATE.mapLayers[MAP_LAYERS[index].key];
  });
  node.querySelectorAll(".seg button").forEach((button, index) => {
    button.setAttribute("aria-pressed", String(["rides", "facility"][index] === STATE.routeColor));
  });
}

/**
 * Redraws the data layers for the current filters and layer switches.
 *
 * @param {Object} context Data, counts and the zone click handler.
 */
function updateCampusMap(context) {
  const { data, counts, incidentCounts, selectZone } = context;
  const overlays = CAMPUS_MAP.overlays;
  overlays.clearLayers();

  const legendItems = [];

  if (STATE.mapLayers.routes) {
    legendItems.push(...drawRouteLayer(overlays, data, counts.segmentRides));
  }
  if (STATE.mapLayers.gaps) {
    legendItems.push(...drawGapLayer(overlays, data, counts.segmentRides));
  }
  if (STATE.mapLayers.thefts) {
    legendItems.push(...drawTheftLayer(overlays, data, incidentCounts, selectZone));
  }
  if (STATE.mapLayers.conflicts) {
    legendItems.push(...drawConflictLayer(overlays, data, counts.conflictRides));
  }

  const { map, labels } = CAMPUS_MAP;
  if (STATE.mapLayers.buildings && !map.hasLayer(labels)) {
    labels.addTo(map);
    placeBuildingLabels();
  } else if (!STATE.mapLayers.buildings && map.hasLayer(labels)) {
    map.removeLayer(labels);
  }

  const legendNode = CAMPUS_MAP.legend.getContainer();
  legendNode.innerHTML = "";
  legendNode.hidden = legendItems.length === 0;
  legendNode.append(legend(legendItems));
}

/**
 * Builds a text label for each landmark, library and residence hall.
 *
 * @param {Object} data Output of loadData.
 * @returns {L.LayerGroup} The labels, not yet on the map.
 */
function buildingLabels(data) {
  const group = L.layerGroup();

  data.landmarkFeatures.forEach((feature) => {
    const [lon, lat] = feature.geometry.coordinates;
    const { label, category, priority } = feature.properties;
    const marker = L.marker([lat, lon], {
      pane: "labels",
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: `bldg-label bldg-${category}`,
        html: `<span>${label}</span>`,
        iconSize: null,
      }),
    });
    marker.priority = priority;
    group.addLayer(marker);
  });

  return group;
}

/**
 * Shows the building labels that fit at the current zoom.
 *
 * Labels are placed in priority order and any that would overlap one
 * already placed is hidden, so zooming in reveals more names rather than
 * piling them on top of each other.
 */
function placeBuildingLabels() {
  const { map, labels } = CAMPUS_MAP;
  if (!map.hasLayer(labels)) return;

  const zoom = map.getZoom();
  const gap = MAP.labelGap;
  const placed = [];

  labels.getLayers().forEach((marker) => {
    const node = marker.getElement();
    if (!node) return;
    const span = node.firstChild;

    if (marker.priority > 1 && zoom < MAP.hallLabelMinZoom) {
      span.style.visibility = "hidden";
      return;
    }

    const box = span.getBoundingClientRect();
    const overlaps = placed.some(
      (other) =>
        box.left - gap < other.right &&
        box.right + gap > other.left &&
        box.top - gap < other.bottom &&
        box.bottom + gap > other.top
    );

    span.style.visibility = overlaps ? "hidden" : "visible";
    if (!overlaps) placed.push(box);
  });
}

/**
 * Wires the shared tooltip to a Leaflet layer.
 *
 * @param {L.Layer} layer The mark.
 * @param {Function} contentFor Returns the tooltip HTML.
 */
function tooltipOn(layer, contentFor) {
  layer.on("mouseover", (event) => showTip(event.originalEvent, contentFor()));
  layer.on("mousemove", (event) => moveTip(event.originalEvent));
  layer.on("mouseout", hideTip);
}

/**
 * Draws ridden segments, weighted by how many rides used them.
 *
 * Busiest segments are drawn last so they sit on top of quieter ones.
 *
 * @param {L.LayerGroup} group Where to draw.
 * @param {Object} data Output of loadData.
 * @param {Map<string, number>} segmentRides Filtered ride counts.
 * @returns {Array<Object>} Legend entries for this layer.
 */
function drawRouteLayer(group, data, segmentRides) {
  const ridden = data.segmentFeatures
    .filter((feature) => segmentRides.get(feature.properties.segment_id) > 0)
    .sort((a, b) =>
      d3.ascending(
        segmentRides.get(a.properties.segment_id),
        segmentRides.get(b.properties.segment_id)
      )
    );

  const maxRides = d3.max(ridden, (f) => segmentRides.get(f.properties.segment_id)) || 1;

  // Square root, because stroke width is read as the area of ink laid down
  // rather than as a length.
  const strokeWidth = d3
    .scaleSqrt()
    .domain([1, maxRides])
    .range([MAP.minSegmentStroke, MAP.maxSegmentStroke])
    .clamp(true);

  // On dark tiles the busiest routes must be the brightest, and on light
  // tiles the darkest, so the ramp runs the other way in each theme.
  const ramp = isDarkTheme() ? MAP.rideRampDark : MAP.rideRampLight;
  const rideColor = d3
    .scaleSequential(d3.interpolateRgb(ramp[0], ramp[1]))
    .domain([0, Math.sqrt(maxRides)]);

  const byFacility = STATE.routeColor === "facility";
  const renderer = CAMPUS_MAP.routeRenderer;

  ridden.forEach((feature) => {
    const rides = segmentRides.get(feature.properties.segment_id);
    const line = L.polyline(
      feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      {
        renderer,
        color: byFacility
          ? FACILITY_COLORS[feature.properties.facility] || cssColor("--muted")
          : rideColor(Math.sqrt(rides)),
        weight: strokeWidth(rides),
        // Faded under the gap layer, so the gaps are what the eye finds.
        opacity: STATE.mapLayers.gaps ? MAP.routeOpacityUnderGaps : 0.95,
        lineCap: "round",
      }
    );
    tooltipOn(line, () => segmentTooltip(feature, rides));
    group.addLayer(line);
  });

  if (byFacility) {
    const present = new Set(ridden.map((f) => f.properties.facility));
    return FACILITIES.filter((f) => present.has(f.key)).map((f) => ({
      label: f.label,
      color: FACILITY_COLORS[f.key],
      shape: "line",
    }));
  }

  return [
    { label: "Fewer rides", color: ramp[0], shape: "line" },
    { label: `Busiest (${formatCount(maxRides)} rides)`, color: ramp[1], shape: "line" },
  ];
}

/**
 * Draws the busy segments that have no proper bike facility.
 *
 * This is the project's question put on the map: where are many people
 * riding with nothing built for them? "Busy" is relative to the current
 * filters (the busiest quarter of ridden segments), so the layer still
 * answers after dark or on one day, when every count is smaller.
 *
 * @param {L.LayerGroup} group Where to draw.
 * @param {Object} data Output of loadData.
 * @param {Map<string, number>} segmentRides Filtered ride counts.
 * @returns {Array<Object>} Legend entries for this layer.
 */
function drawGapLayer(group, data, segmentRides) {
  const ridden = data.segmentFeatures.filter(
    (feature) => segmentRides.get(feature.properties.segment_id) > 0
  );
  const rideCounts = ridden
    .map((feature) => segmentRides.get(feature.properties.segment_id))
    .sort(d3.ascending);
  const threshold = Math.max(1, Math.ceil(d3.quantileSorted(rideCounts, MAP.gapRidesQuantile) || 1));
  const maxRides = rideCounts[rideCounts.length - 1] || 1;

  const adequate = new Set(FACILITIES.filter((f) => f.adequate).map((f) => f.key));
  const gaps = ridden
    .filter(
      (feature) =>
        segmentRides.get(feature.properties.segment_id) >= threshold &&
        !adequate.has(feature.properties.facility)
    )
    .sort((a, b) =>
      d3.ascending(
        segmentRides.get(a.properties.segment_id),
        segmentRides.get(b.properties.segment_id)
      )
    );

  const strokeWidth = d3
    .scaleSqrt()
    .domain([threshold, maxRides])
    .range([MAP.minSegmentStroke + 2, MAP.maxSegmentStroke + 1])
    .clamp(true);

  gaps.forEach((feature) => {
    const rides = segmentRides.get(feature.properties.segment_id);
    const line = L.polyline(
      feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      {
        renderer: CAMPUS_MAP.gapRenderer,
        color: MAP.gapColor,
        weight: strokeWidth(rides),
        opacity: 0.95,
        lineCap: "round",
      }
    );
    tooltipOn(line, () => segmentTooltip(feature, rides));
    group.addLayer(line);
  });

  // Drawn exactly like the conflict points (an unsignalized one), since
  // they mark the same thing: where riders are exposed.
  const accent = cssColor("--accent");
  const mixing = mixingPoints(gaps, segmentRides);
  mixing.forEach((point) => {
    const marker = L.circleMarker(point.latLng, {
      pane: "conflicts",
      radius: MAP.maxConflictRadius,
      color: accent,
      weight: 2,
      fill: true,
      // A transparent fill keeps the whole ring hoverable.
      fillOpacity: 0,
    });
    tooltipOn(marker, () => mixingTooltip(point));
    group.addLayer(marker);
  });

  return [
    {
      label: `${threshold}+ rides, no bike facility (${formatCount(gaps.length)} segments)`,
      color: MAP.gapColor,
      shape: "line",
    },
    { label: `Busiest ${mixing.length} spots riders share with walkers or cars`, color: accent, shape: "ring" },
  ];
}

/**
 * Picks the busiest facility-gap segments, spaced apart, as mixing points.
 *
 * Where many riders use a segment with nothing built for them, they share
 * it: with people walking on a shared walkway, with cars on a road. Like
 * the conflict points, these mark exposure, not crashes.
 *
 * @param {Array<Object>} gaps Gap segments from drawGapLayer.
 * @param {Map<string, number>} segmentRides Filtered ride counts.
 * @returns {Array<Object>} Up to MAP.mixingPointCount points, busiest first.
 */
function mixingPoints(gaps, segmentRides) {
  const FEET_PER_DEGREE_LAT = 364000;
  const picked = [];

  const busiestFirst = gaps
    .slice()
    .sort((a, b) =>
      d3.descending(
        segmentRides.get(a.properties.segment_id),
        segmentRides.get(b.properties.segment_id)
      )
    );

  for (const feature of busiestFirst) {
    if (picked.length >= MAP.mixingPointCount) break;

    const line = feature.geometry.coordinates;
    const [lon, lat] = line[Math.floor(line.length / 2)];
    const feetPerDegreeLon = FEET_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

    const tooClose = picked.some(
      (point) =>
        Math.hypot(
          (point.lon - lon) * feetPerDegreeLon,
          (point.lat - lat) * FEET_PER_DEGREE_LAT
        ) < MAP.mixingPointSpacingFt
    );
    if (tooClose) continue;

    picked.push({
      feature,
      lon,
      lat,
      latLng: [lat, lon],
      rides: segmentRides.get(feature.properties.segment_id),
    });
  }

  return picked;
}

/**
 * Builds the tooltip for a mixing point.
 *
 * @param {Object} point A point from mixingPoints.
 * @returns {string} Tooltip HTML.
 */
function mixingTooltip(point) {
  const properties = point.feature.properties;
  const facility =
    FACILITIES.find((f) => f.key === properties.facility) || { label: properties.facility };
  const sharedWith =
    properties.facility === "road, no bike facility" || properties.facility === "sharrow or signed route"
      ? "Riders share the road with cars"
      : properties.facility === "crossing"
      ? "Riders cross with pedestrians and traffic"
      : "Riders share the path with pedestrians";

  return (
    `<b>${routeLabel(properties)}</b>` +
    `<div class="m">${facility.label} · ${properties.length_ft} ft</div>` +
    `<div>${formatCount(point.rides)} rides · ${sharedWith}</div>` +
    '<div class="m">Exposure, not crashes</div>'
  );
}

/**
 * Builds the tooltip for a segment.
 *
 * @param {Object} feature A segment feature.
 * @param {number} rides Rides on it under the current filters.
 * @returns {string} Tooltip HTML.
 */
function segmentTooltip(feature, rides) {
  const properties = feature.properties;
  const facility =
    FACILITIES.find((f) => f.key === properties.facility) || {
      label: properties.facility,
    };

  const road = properties.road_name
    ? `<div class="m">${properties.road_name}` +
      (properties.speed_limit_mph ? ` · ${properties.speed_limit_mph} mph` : "") +
      "</div>"
    : "";

  return (
    `<b>${routeLabel(properties)}</b>` +
    `<div class="m">${facility.label} · ${properties.length_ft} ft</div>` +
    road +
    `<div>${formatCount(rides)} ride${rides === 1 ? "" : "s"}</div>`
  );
}

/**
 * Draws rack zones as bubbles sized by reported thefts.
 *
 * Area encodes the count, so a zone with four times the thefts covers four
 * times the ink. Zones with no reports are drawn as small hollow marks:
 * they are part of the inventory, and leaving them out would imply the map
 * shows every rack.
 *
 * @param {L.LayerGroup} group Where to draw.
 * @param {Object} data Output of loadData.
 * @param {Map<string, number>} incidentCounts Filtered counts per zone.
 * @param {Function} onZoneClick Called with a zone_id.
 * @returns {Array<Object>} Legend entries for this layer.
 */
function drawTheftLayer(group, data, incidentCounts, onZoneClick) {
  const zones = data.zoneFeatures
    .map((feature) => ({
      feature,
      properties: feature.properties,
      count: incidentCounts.get(feature.properties.zone_id) || 0,
    }))
    .sort((a, b) => d3.descending(a.count, b.count));

  const maxCount = d3.max(zones, (z) => z.count) || 1;
  const radius = d3.scaleSqrt().domain([0, maxCount]).range([0, MAP.maxTheftRadius]);
  const theft = cssColor("--theft");

  zones.forEach((zone) => {
    const [lon, lat] = zone.feature.geometry.coordinates;
    const selected = zone.properties.zone_id === STATE.zoneId;

    const marker = L.circleMarker([lat, lon], {
      pane: "thefts",
      radius: zone.count ? radius(zone.count) : 2.5,
      color: selected ? cssColor("--ink") : zone.count ? theft : cssColor("--muted"),
      weight: selected ? 2.5 : 1,
      fillColor: theft,
      fillOpacity: zone.count ? (selected ? 0.8 : 0.5) : 0,
    });

    tooltipOn(marker, () => zoneTooltip(zone));
    if (zone.count) {
      marker.on("click", () => {
        hideTip();
        onZoneClick(zone.properties.zone_id);
      });
    }
    group.addLayer(marker);
  });

  return [{ label: "Reported thefts (click to filter)", color: theft, shape: "dot" }];
}

/**
 * Builds the tooltip for a rack zone.
 *
 * @param {Object} zone A zone with its filtered count.
 * @returns {string} Tooltip HTML.
 */
function zoneTooltip(zone) {
  const { name, rack_capacity, kind } = zone.properties;
  const capacity =
    rack_capacity != null
      ? `${formatCount(rack_capacity)} rack spaces`
      : "rack inventory not held";

  return (
    `<b>${name}</b>` +
    `<div class="m">${kind === "off_campus" ? "Off campus · " : ""}${capacity}</div>` +
    `<div>${zone.count} reported theft${zone.count === 1 ? "" : "s"}</div>`
  );
}

/**
 * Draws the places where rides meet a major road.
 *
 * These mark exposure to traffic, not crashes, so they are drawn as rings
 * rather than filled warning dots. A ring reads as "look here", where a
 * solid red blob would read as "something happened here".
 *
 * @param {L.LayerGroup} group Where to draw.
 * @param {Object} data Output of loadData.
 * @param {Map<number, number>} conflictRides Filtered counts.
 * @returns {Array<Object>} Legend entries for this layer.
 */
function drawConflictLayer(group, data, conflictRides) {
  const points = conflictPointsByRides(data, conflictRides);

  const maxCount = d3.max(points, (p) => p.count) || 1;
  const radius = d3
    .scaleSqrt()
    .domain([0, maxCount])
    .range([3, MAP.maxConflictRadius]);
  const accent = cssColor("--accent");

  points.forEach((point) => {
    const [lon, lat] = point.feature.geometry.coordinates;
    const marker = L.circleMarker([lat, lon], {
      pane: "conflicts",
      radius: radius(point.count),
      color: accent,
      weight: 2,
      fill: true,
      // A transparent fill keeps the whole ring hoverable.
      fillOpacity: 0,
      // Unsignalized points get a solid ring, signalized ones a dashed one,
      // so the distinction survives in greyscale and for colour-blind readers.
      dashArray: point.properties.signalized ? "3 2" : null,
    });
    tooltipOn(marker, () => conflictTooltip(point));
    group.addLayer(marker);
  });

  return [
    { label: "Meets a major road, no signal", color: accent, shape: "ring" },
    { label: "Signalized", color: accent, shape: "ring-dashed" },
  ];
}

/**
 * Conflict points that rides reach under the current filters, busiest
 * first.
 *
 * @param {Object} data Output of loadData.
 * @param {Map<number, number>} conflictRides Filtered counts.
 * @returns {Array<Object>} Points with their filtered ride count.
 */
function conflictPointsByRides(data, conflictRides) {
  return data.conflictFeatures
    .map((feature, index) => ({
      feature,
      properties: feature.properties,
      index,
      count: conflictRides.has(index) ? conflictRides.get(index) : feature.properties.rides,
    }))
    .filter((point) => point.count > 0)
    .sort((a, b) => d3.descending(a.count, b.count));
}

/**
 * Builds the tooltip for a conflict point.
 *
 * @param {Object} point A conflict point with its filtered count.
 * @returns {string} Tooltip HTML.
 */
function conflictTooltip(point) {
  const properties = point.properties;
  const roads = properties.major_roads.join(" / ");
  const limit = properties.speed_limit_mph
    ? `${properties.speed_limit_mph} mph`
    : "limit not recorded";
  const lanes = properties.lanes ? `${properties.lanes} lanes` : "";
  const control = properties.signalized ? "Signalized" : "No signal";
  const grade = properties.grade_separation_nearby
    ? '<div class="m">Bike bridge or underpass nearby — riders may not cross here</div>'
    : "";

  return (
    `<b>${roads}</b>` +
    `<div class="m">${[limit, lanes].filter(Boolean).join(" · ")}</div>` +
    `<div>${point.count} ride${point.count === 1 ? "" : "s"} · ${control}</div>` +
    grade
  );
}
