/**
 * sections/dashboard.js
 *
 * The overview the project's argument hangs on: how much riding there is,
 * how little of it has a bike facility, where it meets traffic, and where
 * vehicles get stolen — in one screen, each panel linking to the sheet
 * that explains it.
 */

/**
 * Renders the dashboard.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data, counts and callbacks.
 */
function renderDashboard(main, context) {
  const { data, counts, selectZone, goToSheet } = context;

  const header = el("div", "sheet-head");
  const titleBlock = el("div");
  titleBlock.append(el("h2", null, "From pavement to protection"));
  titleBlock.append(
    el(
      "p",
      null,
      "Riders are already on campus in numbers. Most of them have no bike " +
        "facility under them, some of them cross 40 mph roads to get where " +
        "they are going, and their vehicles are being stolen from the racks " +
        "they park at. Each panel opens the sheet behind it."
    )
  );
  header.append(titleBlock);
  header.append(el("span", "badge", "Overview"));
  main.append(header);

  const facilityRows = rideMilesByFacility(data, counts.segmentRides);
  const gapShare = d3.sum(
    facilityRows.filter((row) => GAP_FACILITIES.includes(row.key)),
    (row) => row.share
  );

  const incidentCounts = incidentsByZone(data, STATE);
  const placedThefts = d3.sum(incidentCounts.values());

  const conflictPoints = data.conflictFeatures
    .map((feature, index) => ({
      properties: feature.properties,
      count: counts.conflictRides.has(index)
        ? counts.conflictRides.get(index)
        : feature.properties.rides,
    }))
    .filter((point) => point.count > 0)
    .sort((a, b) => d3.descending(a.count, b.count));

  const unsignalized = conflictPoints.filter((point) => !point.properties.signalized);

  main.append(
    metricRow([
      {
        label: "Rides recorded",
        value: formatCount(counts.rideCount),
        color: COLOR.veo,
        note: `${data.collectionDays.length} partial days, Oct 10–14`,
      },
      {
        label: "On no bike facility",
        value: formatPercent(gapShare),
        note: "of ride-miles, walkways or open road",
      },
      {
        label: "Exposure points",
        value: formatCount(unsignalized.length),
        note: `of ${conflictPoints.length}, with no traffic signal`,
      },
      {
        label: "Reported thefts",
        value: formatCount(placedThefts),
        color: COLOR.theft,
        note: "Feb 2025 – Aug 2026, placed on a zone",
      },
    ])
  );

  const grid = el("div", "dash-grid");
  grid.style.marginTop = "12px";
  main.append(grid);

  const mapCard = card(
    "Where the riding happens",
    `${formatCount(counts.rideCount)} rides · ${
      describeFilters(STATE, data) || "all collection days"
    }`
  );
  grid.append(mapCard);

  const mapArea = mapLayout(mapCard);

  drawMap(mapArea.host, {
    data,
    layers: new Set(["segments", "conflicts"]),
    segmentRides: counts.segmentRides,
    conflictRides: counts.conflictRides,
    colorBy: "rides",
    labelCount: 4,
    // Compact on purpose: the dashboard is an overview, and the full-size
    // version of this map is one tab away.
    maxHeight: 520,
  });

  mapArea.side.append(
    legend([
      { label: "Quieter segment", color: "#c6dbef", shape: "line" },
      { label: "Busier segment", color: "#08519c", shape: "line" },
      { label: "Where rides meet a major road", color: "var(--accent)", shape: "dot" },
    ])
  );

  const sideColumn = el("div", "sheet-col");
  grid.append(sideColumn);

  const facilityCard = card("What riders have under them", "Share of ride-miles");
  sideColumn.append(facilityCard);

  horizontalBars(
    vizHost(facilityCard),
    facilityRows.map((row) => ({
      label: row.label,
      value: row.share,
      color: row.color,
      tooltip:
        `<b>${row.label}</b><div>${formatDecimal(row.miles)} ride-miles</div>` +
        `<div class="m">${formatPercent(row.share)} of all riding</div>`,
    })),
    {
      labelWidth: 150,
      rowHeight: 24,
      valueFormat: formatPercent,
      onClick: () => goToSheet("facilities"),
    }
  );

  caption(
    facilityCard,
    `<b>${formatPercent(gapShare)}</b> of riding happens with no bike ` +
      "facility. Click for the full breakdown."
  );

  const conflictCard = card("Busiest crossings with no signal", "Rides through each point");
  sideColumn.append(conflictCard);

  const TOP_CONFLICTS = 5;
  horizontalBars(
    vizHost(conflictCard),
    unsignalized.slice(0, TOP_CONFLICTS).map((point) => ({
      label: point.properties.major_roads[0],
      value: point.count,
      color: COLOR.accent,
      tooltip: conflictRowTooltip(point),
    })),
    { labelWidth: 150, rowHeight: 24, onClick: () => goToSheet("conflicts") }
  );

  caption(conflictCard, CAVEATS.conflicts);

  const bottom = el("div", "dash-bottom");
  bottom.style.marginTop = "12px";
  main.append(bottom);

  const theftCard = card(
    "Where vehicles are stolen",
    `${placedThefts} reports placed on a rack zone`
  );
  bottom.append(theftCard);

  drawMap(vizHost(theftCard), {
    data,
    layers: new Set(["thefts"]),
    incidentCounts,
    onZoneClick: selectZone,
    labelCount: 3,
    maxHeight: 440,
  });

  caption(theftCard, "Click a bubble to filter the workbook to that zone.");

  const timingCard = card("When people ride", "Rides started per 15 minutes");
  bottom.append(timingCard);
  dayTimeline(vizHost(timingCard), data.timeline);
  caption(
    timingCard,
    "Hatched spans were never recorded. " +
      `No day starts before ${d3.min(
        data.collectionDays,
        (day) => day.window[0].slice(11, 16)
      )}, so there is no morning commute in this data.`
  );
}
