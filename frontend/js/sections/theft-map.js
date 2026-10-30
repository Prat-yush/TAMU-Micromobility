/**
 * sections/theft-map.js
 *
 * Where vehicles are stolen. Clicking a zone cross-filters every other
 * worksheet, so this is the usual entry point into the theft half of the
 * workbook.
 */

/**
 * Renders the theft-hotspot worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data, counts and the render callback.
 */
function renderTheftMapSheet(main, context) {
  const { data, selectZone } = context;

  const left = sheetFrame(main, {
    title: "Where are vehicles stolen?",
    lede:
      "Each bubble is a rack zone, its area the number of reported thefts " +
      "placed there. Small hollow marks are rack zones with none reported. " +
      "Click a bubble to filter the whole workbook.",
    badge: "Theft · hotspots",
    marks: {
      mark: "Circle (symbol map)",
      position: "Geographic, Mercator",
      color: "Theft orange, fixed",
      size: "Area, square root of reported thefts",
      detail: "Zone, rack spaces, reported thefts",
      why:
        "Counts belong to points, not regions, so a symbol map is right " +
        "where a choropleth would invent boundaries. Area encodes magnitude " +
        "without implying a catchment.",
      caveat: CAVEATS.thefts,
    },
  });

  const counts = incidentsByZone(data, STATE);
  const placed = d3.sum(counts.values());

  const mapCard = card(
    "Reported thefts by rack zone",
    `${placed} placed reports · ${data.unplacedIncidents.length} could not be placed`
  );
  left.append(mapCard);

  const { host, side } = mapLayout(mapCard);

  drawMap(host, {
    data,
    layers: new Set(["thefts"]),
    incidentCounts: counts,
    onZoneClick: selectZone,
  });

  side.append(
    legend([
      { label: "Reported thefts", color: "var(--theft)", shape: "dot" },
      { label: "Rack zone, none reported", color: "var(--axis)", shape: "dot" },
    ])
  );

  const RANK_COUNT = 12;
  const ranked = rankedZones(data, counts).slice(0, RANK_COUNT);

  side.append(el("h3", null, `Top ${RANK_COUNT} zones`));

  side.append(
    segmentedControl(
      [
        ["count", "Reported thefts"],
        ["per100", "Per 100 rack spaces"],
      ],
      STATE.rankMetric,
      (value) => {
        STATE.rankMetric = value;
        context.rerender();
      },
      "Ranking metric"
    )
  );

  const usePer100 = STATE.rankMetric === "per100";
  const rows = (usePer100
    ? ranked.filter((zone) => zone.capacity > 0)
    : ranked
  ).map((zone) => ({
    label: zone.name,
    value: usePer100 ? zone.per100 : zone.thefts,
    color: COLOR.theft,
    selected: STATE.zoneId ? zone.zoneId === STATE.zoneId : undefined,
    tooltip:
      `<b>${zone.name}</b>` +
      `<div class="m">${
        zone.capacity ? `${formatCount(zone.capacity)} rack spaces` : "no rack inventory"
      }</div>` +
      `<div>${zone.thefts} reported theft${zone.thefts === 1 ? "" : "s"}</div>`,
    zoneId: zone.zoneId,
  }));

  const listHost = el("div", "viz");
  side.append(listHost);

  horizontalBars(listHost, rows, {
    labelWidth: 210,
    valueFormat: usePer100 ? (value) => formatDecimal(value) : formatCount,
    onClick: (row) => selectZone(row.zoneId),
  });

  side.append(
    el(
      "p",
      "caption",
      usePer100
      ? "Per 100 spaces needs a rack inventory, so off-campus places drop " +
          "out of this view. Small rack sets make this figure jumpy — read " +
          "it alongside the raw count."
        : "Raw counts favour the biggest rack zones. Switch to per 100 spaces " +
            "to see where a small rack set loses a lot. Click a bar to select " +
            "that zone across the workbook."
    )
  );
}

/**
 * Ranks zones by reported thefts under the current filters.
 *
 * @param {Object} data Output of loadData.
 * @param {Map<string, number>} counts Filtered counts per zone.
 * @returns {Array<Object>} Zones with thefts, busiest first.
 */
function rankedZones(data, counts) {
  const PER_UNIT = 100;

  return data.zoneFeatures
    .map((feature) => {
      const properties = feature.properties;
      const thefts = counts.get(properties.zone_id) || 0;
      const capacity = properties.rack_capacity || 0;

      return {
        zoneId: properties.zone_id,
        name: properties.name,
        kind: properties.kind,
        capacity,
        thefts,
        per100: capacity ? (thefts / capacity) * PER_UNIT : 0,
      };
    })
    .filter((zone) => zone.thefts > 0)
    .sort((a, b) =>
      STATE.rankMetric === "per100"
        ? d3.descending(a.per100, b.per100)
        : d3.descending(a.thefts, b.thefts)
    );
}
