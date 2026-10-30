/**
 * sections/rack-audit.js
 *
 * Whether thefts simply follow rack supply. If they did, the answer would
 * be more racks; where they do not, something about the place is the
 * problem.
 */

/**
 * Renders the rack-audit worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data and the zone selection callback.
 */
function renderRackAuditSheet(main, context) {
  const { data, selectZone } = context;

  const left = sheetFrame(main, {
    title: "Do thefts just follow rack supply?",
    lede:
      "Each point is a rack zone: its rack spaces against its reported " +
      "thefts. Points well above the crowd lose more vehicles than their " +
      "rack supply alone would explain.",
    badge: "Theft · supply",
    marks: {
      mark: "Circle (scatter)",
      position: "Rack spaces (symlog) against reported thefts (linear)",
      color: "Orange where thefts were reported, grey where none were",
      size: "Fixed; the selected zone is enlarged",
      detail: "Zone, rack spaces, reported thefts",
      why:
        "Position on a common scale is the most accurate channel for " +
        "comparing two quantities, and a symlog axis keeps the zones with " +
        "few or no recorded spaces visible.",
      caveat:
        "Rack inventory covers TAMU's regular campus racks. Park West and " +
        "The Gardens show low capacity because their own racks are not in " +
        "that inventory, so their per-space figures run high.",
    },
  });

  const counts = incidentsByZone(data, STATE);

  const zones = data.zoneFeatures
    .map((feature) => ({
      zoneId: feature.properties.zone_id,
      name: feature.properties.name,
      capacity: feature.properties.rack_capacity || 0,
      thefts: counts.get(feature.properties.zone_id) || 0,
    }))
    .filter((zone) => zone.capacity > 0);

  const scatterCard = card(
    "Rack spaces against reported thefts",
    `${zones.length} campus zones with a rack inventory`
  );
  left.append(scatterCard);

  capacityScatter(vizHost(scatterCard), zones, selectZone);

  const withThefts = zones.filter((zone) => zone.thefts > 0);
  const totalSpaces = d3.sum(zones, (zone) => zone.capacity);
  const totalThefts = d3.sum(zones, (zone) => zone.thefts);

  caption(
    scatterCard,
    `<b>${withThefts.length} of ${zones.length}</b> zones with racks have a ` +
      `reported theft. Across ${formatCount(totalSpaces)} spaces that is ` +
      `${formatDecimal((totalThefts / totalSpaces) * 100)} thefts per 100 ` +
      "spaces on average — the line a zone should be read against."
  );

  const mapCard = card(
    "The same zones on the map",
    "Bubble area is reported thefts; hollow marks have none"
  );
  left.append(mapCard);

  const { host, side } = mapLayout(mapCard);

  drawMap(host, {
    data,
    layers: new Set(["thefts"]),
    incidentCounts: counts,
    onZoneClick: selectZone,
    labelCount: 4,
  });

  side.append(
    legend([
      { label: "Reported thefts", color: "var(--theft)", shape: "dot" },
      { label: "Rack zone, none reported", color: "var(--axis)", shape: "dot" },
    ])
  );

  side.append(
    el(
      "p",
      "caption",
      "Read the two views together: a point high on the scatter and a large " +
        "bubble in a residential cluster is a different problem from the " +
        "same point beside a lecture hall. Click a zone in either to filter " +
        "the workbook to it."
    )
  );
}
