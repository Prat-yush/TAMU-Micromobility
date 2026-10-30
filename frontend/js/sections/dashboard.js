/**
 * sections/dashboard.js
 *
 * The one-screen dashboard: the campus map fills the centre, and the
 * smaller views sit in a column either side of it. The map is built once;
 * the boxes are redrawn on every filter change.
 */

/** Longest crossing name shown on a bar; the tooltip carries the full one. */
const MAX_CROSSING_LABEL = 22;

/** How many unsignalized crossings the ranking lists. */
const TOP_CONFLICTS = 5;

/**
 * Builds the dashboard frame: two box columns and the map host between
 * them.
 *
 * @param {HTMLElement} main The main element.
 * @returns {{left: HTMLElement, mapHost: HTMLElement, right: HTMLElement}}
 */
function buildDashboard(main) {
  main.innerHTML = "";

  const layout = el("div", "dash");
  const left = el("div", "dash-side dash-left");
  const center = el("section", "dash-map");
  const right = el("div", "dash-side dash-right");

  center.setAttribute("aria-label", "Campus map");
  const mapHost = el("div", "map-host");
  center.append(mapHost);

  layout.append(left, center, right);
  main.append(layout);

  return { left, mapHost, right };
}

/**
 * Redraws the boxes around the map for the current filters.
 *
 * @param {{left: HTMLElement, right: HTMLElement}} columns From
 *     buildDashboard.
 * @param {Object} context Data, counts and incident counts.
 */
function renderDashboardBoxes(columns, context) {
  const { data, counts, incidentCounts } = context;
  const { left, right } = columns;
  left.innerHTML = "";
  right.innerHTML = "";

  const facilityRows = rideMilesByFacility(data, counts.segmentRides);
  const gapShare = d3.sum(
    facilityRows.filter((row) => GAP_FACILITIES.includes(row.key)),
    (row) => row.share
  );
  const conflictPoints = conflictPointsByRides(data, counts.conflictRides);
  const unsignalized = conflictPoints.filter((point) => !point.properties.signalized);
  const placedThefts = d3.sum(incidentCounts.values());

  const headline = card(
    "At a glance",
    describeFilters(STATE, data) || "All collection days and theft reports"
  );
  headline.append(
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
        label: "Unsignalized crossings",
        value: formatCount(unsignalized.length),
        note: `of ${conflictPoints.length} where rides meet a major road`,
      },
      {
        label: "Reported thefts",
        value: formatCount(placedThefts),
        color: COLOR.theft,
        note: "Feb 2025 – Aug 2026, placed on a zone",
      },
    ])
  );
  left.append(headline);

  const facilityCard = card("What riders have under them", "Share of ride-miles");
  left.append(facilityCard);
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
      labelWidth: 138,
      rowHeight: 24,
      valueFormat: formatPercent,
      onClick: showFacilitiesOnMap,
    }
  );
  caption(
    facilityCard,
    `<b>${formatPercent(gapShare)}</b> of riding happens with no bike ` +
      "facility. Click a bar to colour the map by facility."
  );

  const conflictCard = card("Busiest crossings with no signal", "Rides through each point");
  right.append(conflictCard);
  horizontalBars(
    vizHost(conflictCard),
    unsignalized.slice(0, TOP_CONFLICTS).map((point) => ({
      label: truncate(point.properties.major_roads[0], MAX_CROSSING_LABEL),
      value: point.count,
      color: COLOR.accent,
      tooltip: conflictRowTooltip(point),
    })),
    { labelWidth: 138, rowHeight: 24 }
  );
  caption(conflictCard, CAVEATS.conflicts);

  right.append(
    placeholderCard(
      "Crash locations",
      "Where micromobility crashes happen on campus. Campus crash figures " +
        "are only published as yearly totals; this box will map them if " +
        "located records become available."
    )
  );
  right.append(
    placeholderCard(
      "Rider survey",
      "Routes, near misses and parking habits from our student survey. " +
        "Responses are still being collected."
    )
  );
}

/** Switches the map to colour routes by facility, and makes sure they show. */
function showFacilitiesOnMap() {
  STATE.routeColor = "facility";
  STATE.mapLayers.routes = true;
  syncLayerControl();
  render();
}

/**
 * Shortens a label to a length, marking the cut.
 *
 * @param {string} text The label.
 * @param {number} length Longest result allowed.
 * @returns {string}
 */
function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * Builds the tooltip for a row in the conflict ranking.
 *
 * @param {Object} point A conflict point with its filtered count.
 * @returns {string} Tooltip HTML.
 */
function conflictRowTooltip(point) {
  const properties = point.properties;
  const facts = [
    properties.speed_limit_mph ? `${properties.speed_limit_mph} mph` : null,
    properties.lanes ? `${properties.lanes} lanes` : null,
    properties.signalized ? "signalized" : "no signal",
  ].filter(Boolean);

  const treatment = properties.city_crossing_treatment.length
    ? `<div class="m">${properties.city_crossing_treatment.join("; ")}</div>`
    : "";

  const grade = properties.grade_separation_nearby
    ? '<div class="m">Bridge or underpass nearby</div>'
    : "";

  return (
    `<b>${properties.major_roads.join(" / ")}</b>` +
    `<div class="m">${facts.join(" · ")}</div>` +
    `<div>${point.count} rides</div>` +
    treatment +
    grade
  );
}
