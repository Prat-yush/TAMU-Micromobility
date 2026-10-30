/**
 * sections/routes.js
 *
 * Where riders actually go. The segment network carries a ride count, so
 * the map is the primary view and the ranked list is its index.
 */

/**
 * Renders the busiest-routes worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data, counts and the render callback.
 */
function renderRoutesSheet(main, context) {
  const { data, counts } = context;

  const left = sheetFrame(main, {
    title: "Which routes carry the riders?",
    lede:
      "Every path and street segment a Veo rider used, drawn thicker and " +
      "darker the more rides it carried. The network itself is the basemap.",
    badge: "Veo · routes",
    marks: {
      mark: "Line (path segment)",
      position: "Geographic, Mercator",
      color: "Sequential blue, square root of rides",
      size: "Stroke width, square root of rides",
      detail: "Route name, facility, length, speed limit",
      why:
        "Rides are counted on segments, so segments are the mark. Width and " +
        "colour encode the same value redundantly, which keeps the busiest " +
        "corridors readable at a glance and in greyscale.",
      caveat: CAVEATS.routes,
    },
  });

  const mapCard = card(
    "Ride counts by segment",
    `${formatCount(counts.rideCount)} rides · ${describeFilters(STATE, data) || "all collection days"}`
  );
  left.append(mapCard);

  const { host, side } = mapLayout(mapCard);

  drawMap(host, {
    data,
    layers: new Set(["segments"]),
    segmentRides: counts.segmentRides,
    colorBy: "rides",
  });

  side.append(
    legend([
      { label: "Quieter segment", color: "#c6dbef", shape: "line" },
      { label: "Busier segment", color: "#08519c", shape: "line" },
      { label: "Unridden network", color: "var(--axis)", shape: "line" },
    ])
  );

  const ROUTE_COUNT = 12;
  const routes = busiestRoutes(data, counts.segmentRides, ROUTE_COUNT);

  side.append(el("h3", null, `Busiest ${ROUTE_COUNT} named routes`));
  side.append(el("p", "sub", "A route's figure is its busiest single segment"));

  const listHost = el("div", "viz");
  side.append(listHost);

  horizontalBars(
    listHost,
    routes.map((route) => ({
      label: route.name,
      value: route.rides,
      color: FACILITY_COLORS[route.facility] || COLOR.veo,
      tooltip:
        `<b>${route.name}</b>` +
        `<div class="m">${route.facility}</div>` +
        `<div>${route.rides} rides on its busiest segment</div>`,
    })),
    { labelWidth: 190 }
  );

  side.append(
    el(
      "p",
      "caption",
      "Bars are coloured by the facility a rider has on that route. " +
        "Adding a route's segments together would count one ride many times, " +
        "so each route is represented by its busiest segment."
    )
  );
}
