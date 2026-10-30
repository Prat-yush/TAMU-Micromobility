/**
 * components/map.js
 *
 * The campus map every spatial worksheet uses. There is no basemap in the
 * data, so the ridden segments themselves draw the campus: they outline
 * the paths and streets closely enough to recognise.
 *
 * Layers are opt-in, so one renderer serves the route map, the conflict
 * map and the theft map without any of them carrying the others' weight.
 */

/** Unique suffix per map, so clip paths and gradients never collide. */
let mapInstanceCount = 0;

/**
 * Chooses a map height for the available width.
 *
 * @param {number} width Host width in pixels.
 * @returns {number} Height in pixels, clamped to the configured range.
 */
function mapHeight(width) {
  return Math.round(
    Math.max(MAP.minHeight, Math.min(MAP.maxHeight, width * MAP.heightRatio))
  );
}

/**
 * Fits a projection to the data, then trims the canvas to what it draws.
 *
 * `fitExtent` preserves the data's aspect ratio, so fitting a tall, narrow
 * campus into a wide box centres it and leaves the rest empty. Measuring
 * the projected bounds afterwards and re-fitting to those dimensions gives
 * a canvas the same shape as the content.
 *
 * @param {Object} geojson The features defining the extent.
 * @param {number} maxWidth Width available, in pixels.
 * @param {number} maxHeight Height available, in pixels.
 * @returns {{projection: Function, width: number, height: number}}
 */
function fitProjectionToContent(geojson, maxWidth, maxHeight) {
  const inset = MAP.padding;
  const box = [
    [inset, inset],
    [maxWidth - inset, maxHeight - inset],
  ];

  const probe = d3.geoMercator().fitExtent(box, geojson);
  const [[left, top], [right, bottom]] = d3.geoPath(probe).bounds(geojson);

  const width = Math.ceil(right - left) + inset * 2;
  const height = Math.ceil(bottom - top) + inset * 2;

  return {
    projection: d3.geoMercator().fitExtent(
      [
        [inset, inset],
        [width - inset, height - inset],
      ],
      geojson
    ),
    width,
    height,
  };
}

/**
 * Draws the campus map into a host element.
 *
 * @param {HTMLElement} host Element to draw into; must be in the document.
 * @param {Object} options Layers and data for this map.
 * @param {Object} options.data Output of loadData.
 * @param {Set<string>} options.layers Any of "segments", "conflicts",
 *     "thefts".
 * @param {Map<string, number>} [options.segmentRides] Filtered ride counts.
 * @param {Map<number, number>} [options.conflictRides] Filtered counts.
 * @param {Map<string, number>} [options.incidentCounts] Filtered counts.
 * @param {"rides"|"facility"} [options.colorBy] How to colour segments.
 * @param {Function} [options.onZoneClick] Called with a zone_id.
 * @param {number} [options.labelCount] How many busiest features to label.
 * @returns {Object} The projection and the features actually drawn.
 */
function drawMap(host, options) {
  const {
    data,
    layers,
    segmentRides = new Map(),
    conflictRides = new Map(),
    incidentCounts = new Map(),
    colorBy = "rides",
    onZoneClick = null,
    labelCount = MAP.labelCount,
    maxHeight = null,
  } = options;

  const availableWidth = host.clientWidth || 800;
  const uid = `map-${(mapInstanceCount += 1)}`;

  // Campus is markedly taller than it is wide, so fitting the projection to
  // the full card would leave wide empty gutters either side. Fit it to the
  // available box first, then shrink the SVG to the ink: the map ends up
  // narrower than its card and centred, with no dead space.
  const { projection, width, height } = fitProjectionToContent(
    data.segments,
    availableWidth,
    maxHeight || mapHeight(availableWidth)
  );
  const geoPath = d3.geoPath(projection);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("class", "map")
    .attr("width", width)
    .attr("height", height)
    .style("margin", "0 auto")
    .attr("role", "img")
    .attr("aria-label", "Map of Texas A&M campus micromobility activity");

  // Always draw the full network faintly, so filtered views keep the shape
  // of campus instead of dissolving into a few bright lines.
  drawBaseNetwork(svg, data, geoPath);

  const drawn = {};

  if (layers.has("segments")) {
    drawn.segments = drawSegmentLayer(svg, {
      data,
      geoPath,
      segmentRides,
      colorBy,
    });
  }

  if (layers.has("thefts")) {
    drawn.zones = drawTheftLayer(svg, {
      data,
      projection,
      incidentCounts,
      onZoneClick,
    });
  }

  if (layers.has("conflicts")) {
    drawn.conflicts = drawConflictLayer(svg, {
      data,
      projection,
      conflictRides,
    });
  }

  drawLabels(svg, { projection, geoPath, layers, drawn, labelCount, uid });

  return { projection, geoPath, ...drawn };
}

/**
 * Draws every segment as a hairline, as the campus outline.
 *
 * @param {d3.Selection} svg The map SVG.
 * @param {Object} data Output of loadData.
 * @param {Function} geoPath A configured d3.geoPath.
 */
function drawBaseNetwork(svg, data, geoPath) {
  svg
    .append("g")
    .attr("class", "map-base")
    .selectAll("path")
    .data(data.segmentFeatures)
    .join("path")
    .attr("d", geoPath)
    .attr("fill", "none");
}

/**
 * Draws ridden segments, weighted by how many rides used them.
 *
 * Busiest segments are drawn last so they sit on top of quieter ones.
 *
 * @param {d3.Selection} svg The map SVG.
 * @param {Object} options Data, path generator, counts and colour mode.
 * @returns {Array<Object>} The features drawn, busiest first.
 */
function drawSegmentLayer(svg, options) {
  const { data, geoPath, segmentRides, colorBy } = options;

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

  const rideColor = d3
    .scaleSequential(d3.interpolateBlues)
    .domain([0, Math.sqrt(maxRides)]);

  /**
   * Colour for one segment, by whichever mode the sheet asked for.
   *
   * @param {Object} feature A segment feature.
   * @returns {string} A CSS colour.
   */
  function colorFor(feature) {
    if (colorBy === "facility") {
      return FACILITY_COLORS[feature.properties.facility] || COLOR.muted;
    }
    return rideColor(Math.sqrt(segmentRides.get(feature.properties.segment_id)));
  }

  const paths = svg
    .append("g")
    .attr("class", "map-segments")
    .selectAll("path")
    .data(ridden)
    .join("path")
    .attr("d", geoPath)
    .attr("fill", "none")
    .attr("stroke", colorFor)
    .attr("stroke-width", (f) => strokeWidth(segmentRides.get(f.properties.segment_id)))
    .attr("stroke-linecap", "round");

  attachTooltip(paths, (feature) =>
    segmentTooltip(feature, segmentRides.get(feature.properties.segment_id))
  );

  return ridden.slice().reverse();
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
 * @param {d3.Selection} svg The map SVG.
 * @param {Object} options Data, projection, counts and the click handler.
 * @returns {Array<Object>} Zone features with thefts, busiest first.
 */
function drawTheftLayer(svg, options) {
  const { data, projection, incidentCounts, onZoneClick } = options;

  const zones = data.zoneFeatures.map((feature) => ({
    feature,
    properties: feature.properties,
    count: incidentCounts.get(feature.properties.zone_id) || 0,
    point: projection(feature.geometry.coordinates),
  }));

  const maxCount = d3.max(zones, (z) => z.count) || 1;
  const radius = d3.scaleSqrt().domain([0, maxCount]).range([0, MAP.maxTheftRadius]);

  const group = svg.append("g").attr("class", "map-thefts");

  const empty = zones.filter((z) => z.count === 0);
  group
    .selectAll("circle.zone-empty")
    .data(empty)
    .join("circle")
    .attr("class", "zone-empty")
    .attr("cx", (z) => z.point[0])
    .attr("cy", (z) => z.point[1])
    .attr("r", 2);

  const withThefts = zones
    .filter((z) => z.count > 0)
    .sort((a, b) => d3.descending(a.count, b.count));

  const bubbles = group
    .selectAll("circle.zone")
    .data(withThefts)
    .join("circle")
    .attr("class", "zone clickable")
    .attr("cx", (z) => z.point[0])
    .attr("cy", (z) => z.point[1])
    .attr("r", (z) => radius(z.count))
    .classed("is-selected", (z) => z.properties.zone_id === STATE.zoneId);

  attachTooltip(bubbles, (zone) => zoneTooltip(zone));

  if (onZoneClick) {
    bubbles.on("click", (event, zone) => onZoneClick(zone.properties.zone_id));
  }

  return withThefts;
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
 * @param {d3.Selection} svg The map SVG.
 * @param {Object} options Data, projection and filtered counts.
 * @returns {Array<Object>} Conflict features with rides, busiest first.
 */
function drawConflictLayer(svg, options) {
  const { data, projection, conflictRides } = options;

  const points = data.conflictFeatures
    .map((feature, index) => ({
      feature,
      properties: feature.properties,
      index,
      count: conflictRides.has(index)
        ? conflictRides.get(index)
        : feature.properties.rides,
      point: projection(feature.geometry.coordinates),
    }))
    .filter((p) => p.count > 0)
    .sort((a, b) => d3.descending(a.count, b.count));

  const maxCount = d3.max(points, (p) => p.count) || 1;
  const radius = d3
    .scaleSqrt()
    .domain([0, maxCount])
    .range([3, MAP.maxConflictRadius]);

  const markers = svg
    .append("g")
    .attr("class", "map-conflicts")
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (p) => p.point[0])
    .attr("cy", (p) => p.point[1])
    .attr("r", (p) => radius(p.count))
    // Unsignalized points get a solid ring, signalized ones a dashed one,
    // so the distinction survives in greyscale and for colour-blind readers.
    .attr("stroke-dasharray", (p) => (p.properties.signalized ? "3 2" : null));

  attachTooltip(markers, conflictTooltip);

  return points;
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

/**
 * Labels the busiest features on the map.
 *
 * Only a handful are labelled: enough to orient a reader, few enough that
 * the labels do not cover the marks they describe.
 *
 * @param {d3.Selection} svg The map SVG.
 * @param {Object} options Projection, layers, drawn features and the count.
 */
function drawLabels(svg, options) {
  const { projection, layers, drawn, labelCount } = options;
  if (!labelCount) return;

  const labels = [];

  if (layers.has("thefts") && drawn.zones) {
    drawn.zones.slice(0, labelCount).forEach((zone) => {
      labels.push({
        text: shortenName(zone.properties.name),
        point: zone.point,
      });
    });
  } else if (layers.has("conflicts") && drawn.conflicts) {
    drawn.conflicts.slice(0, labelCount).forEach((point) => {
      labels.push({
        text: point.properties.major_roads[0],
        point: point.point,
      });
    });
  } else if (layers.has("segments") && drawn.segments) {
    const seen = new Set();
    drawn.segments.forEach((feature) => {
      if (labels.length >= labelCount) return;
      const name = routeLabel(feature.properties);
      if (name.startsWith("Unnamed") || seen.has(name)) return;
      seen.add(name);
      labels.push({ text: name, point: projection(midpointOf(feature)) });
    });
  }

  svg
    .append("g")
    .attr("class", "map-labels")
    .selectAll("text")
    .data(labels)
    .join("text")
    .attr("class", "maplab")
    .attr("x", (d) => d.point[0])
    .attr("y", (d) => d.point[1] - 8)
    .attr("text-anchor", "middle")
    .text((d) => d.text);
}

/**
 * Returns the middle coordinate of a line, as a label anchor.
 *
 * @param {Object} feature A LineString feature.
 * @returns {Array<number>} A [lon, lat] pair.
 */
function midpointOf(feature) {
  const line = feature.geometry.coordinates;
  return line[Math.floor(line.length / 2)];
}

/**
 * Shortens a long zone name so a map label stays readable.
 *
 * @param {string} name The full zone name.
 * @returns {string} A shorter label.
 */
function shortenName(name) {
  const trimmed = name
    .replace(/ & Emerging Technologies/, "")
    .replace(/ Apartments| Halls?| Building| Center/g, "");
  const MAX_LENGTH = 22;
  return trimmed.length > MAX_LENGTH ? `${trimmed.slice(0, MAX_LENGTH - 1)}…` : trimmed;
}
