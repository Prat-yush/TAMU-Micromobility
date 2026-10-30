/**
 * sections/facilities.js
 *
 * The project's central finding: most riding happens where no bike
 * facility exists. Ride-miles is the measure, because a long quiet path
 * and a short busy one are not equivalent.
 */

/**
 * Renders the facility-gap worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data, counts and the render callback.
 */
function renderFacilitiesSheet(main, context) {
  const { data, counts, rerender } = context;

  const left = sheetFrame(main, {
    title: "What do riders actually have under them?",
    lede:
      "Ride-miles by facility type: rides on a segment times its length. " +
      "The share on shared walkways and on roads with no bike facility is " +
      "the gap this project is about.",
    badge: "Veo · facilities",
    marks: {
      mark: "Bar (horizontal) and line (map)",
      position: "Sorted by ride-miles; geographic on the map",
      color: "Categorical by facility; warm hues mark the gap categories",
      detail: "Miles, share of all ride-miles, segment count",
      why:
        "Ride-miles weights each segment by how far people rode on it, so a " +
        "60 ft crossing does not count the same as a half-mile path. " +
        "Sorted bars turn the comparison into a ranking.",
      caveat:
        "Facility tags can flicker on short segments near intersections, " +
        "where a 20 ft piece may be tagged differently from the street " +
        "around it.",
    },
  });

  const rows = rideMilesByFacility(data, counts.segmentRides);
  const gapShare = d3.sum(
    rows.filter((row) => GAP_FACILITIES.includes(row.key)),
    (row) => row.share
  );

  const barCard = card(
    "Ride-miles by facility",
    `${formatCount(counts.rideCount)} rides · ${formatDecimal(d3.sum(rows, (r) => r.miles))} ride-miles`
  );
  left.append(barCard);

  horizontalBars(
    vizHost(barCard),
    rows.map((row) => ({
      label: row.label,
      value: row.miles,
      color: row.color,
      tooltip:
        `<b>${row.label}</b>` +
        `<div>${formatDecimal(row.miles)} ride-miles</div>` +
        `<div class="m">${formatPercent(row.share)} of all riding</div>`,
    })),
    { labelWidth: 190, valueFormat: (value) => formatDecimal(value) }
  );

  caption(
    barCard,
    `<b>${formatPercent(gapShare)}</b> of ride-miles are on shared walkways ` +
      "or on roads with no bike facility — riders mixing with pedestrians, " +
      "or with traffic. That is the case for building facilities rather " +
      "than banning the vehicles."
  );

  const mapCard = card(
    "Where each facility type is",
    "Ridden segments coloured by what a rider has under them"
  );
  left.append(mapCard);

  mapCard.append(
    segmentedControl(
      [
        ["rides", "Colour by ride count"],
        ["facility", "Colour by facility"],
      ],
      STATE.routeMetric === "facility" ? "facility" : "rides",
      (value) => {
        STATE.routeMetric = value;
        rerender();
      },
      "Map colour"
    )
  );

  const { host, side } = mapLayout(mapCard);

  drawMap(host, {
    data,
    layers: new Set(["segments"]),
    segmentRides: counts.segmentRides,
    colorBy: STATE.routeMetric === "facility" ? "facility" : "rides",
    labelCount: 0,
  });

  side.append(
    STATE.routeMetric === "facility"
      ? legend(
          rows.map((row) => ({ label: row.label, color: row.color, shape: "line" }))
        )
      : legend([
          { label: "Quieter segment", color: "#c6dbef", shape: "line" },
          { label: "Busier segment", color: "#08519c", shape: "line" },
        ])
  );

  side.append(
    el(
      "p",
      "caption",
      STATE.routeMetric === "facility"
        ? "Green is somewhere of a rider's own; orange and red are shared " +
            "walkways and open road. The warm colour dominating the centre " +
            "of campus is the gap, drawn on the ground."
        : "Switch the colour to facility type to see which of these busy " +
            "corridors actually give a rider somewhere to be."
    )
  );
}
