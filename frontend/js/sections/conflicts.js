/**
 * sections/conflicts.js
 *
 * Where riders meet fast traffic. These are exposure points, not crash
 * sites, and the sheet says so in several places on purpose: the data
 * cannot support a crash claim, and a map of rings near busy roads invites
 * exactly that reading if nothing pushes back.
 */

/**
 * Renders the road-conflict worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data, counts and the render callback.
 */
function renderConflictsSheet(main, context) {
  const { data, counts } = context;

  const left = sheetFrame(main, {
    title: "Where do riders meet fast traffic?",
    lede:
      "Places where rides cross a major road, or turn onto one. Ring size " +
      "is how many rides passed through; a dashed ring has a traffic " +
      "signal, a solid one does not.",
    badge: "Veo · exposure",
    marks: {
      mark: "Ring (open circle)",
      position: "Geographic, Mercator",
      color: "Single accent hue — no severity scale, because none is known",
      size: "Radius, square root of rides",
      detail: "Roads, speed limit, lanes, signal, crossing treatment",
      why:
        "An open ring reads as 'look here'; a filled warning dot would read " +
        "as 'something happened here', which this data cannot support.",
      caveat: CAVEATS.conflicts,
    },
  });

  const points = data.conflictFeatures
    .map((feature, index) => ({
      properties: feature.properties,
      count: counts.conflictRides.has(index)
        ? counts.conflictRides.get(index)
        : feature.properties.rides,
    }))
    .filter((point) => point.count > 0)
    .sort((a, b) => d3.descending(a.count, b.count));

  const unsignalized = points.filter((point) => !point.properties.signalized);

  const mapCard = card(
    "Conflict points",
    `${points.length} points in view · ${formatCount(counts.rideCount)} rides`
  );
  left.append(mapCard);

  const { host, side } = mapLayout(mapCard);

  drawMap(host, {
    data,
    layers: new Set(["conflicts"]),
    conflictRides: counts.conflictRides,
    labelCount: 5,
  });

  side.append(
    legend([
      { label: "No traffic signal", color: "var(--accent)", shape: "dot" },
      { label: "Signalized (dashed)", color: "var(--accent)", shape: "dot" },
    ])
  );

  side.append(
    el(
      "p",
      "caption",
      `<b>${unsignalized.length} of ${points.length}</b> points in view have no ` +
        "traffic signal. These show how often riders are exposed to a major " +
        "road, not how often anything went wrong there."
    )
  );

  const RANK_COUNT = 10;
  side.append(el("h3", null, `Busiest ${RANK_COUNT} points`));
  side.append(el("p", "sub", "Ranked by rides passing through"));

  const listHost = el("div", "viz");
  side.append(listHost);

  horizontalBars(
    listHost,
    points.slice(0, RANK_COUNT).map((point) => ({
      label: point.properties.major_roads.join(" / "),
      value: point.count,
      // Unsignalized points are the ones worth acting on first, so they
      // keep the accent; signalized ones recede.
      color: point.properties.signalized ? COLOR.muted : COLOR.accent,
      tooltip: conflictRowTooltip(point),
    })),
    { labelWidth: 200 }
  );

  const worst = unsignalized[0];
  if (worst) {
    side.append(
      el(
        "p",
        "caption",
        `The busiest point with no signal is <b>${worst.properties.major_roads.join(" / ")}</b>` +
          (worst.properties.speed_limit_mph
            ? ` (${worst.properties.speed_limit_mph} mph` +
              (worst.properties.lanes ? `, ${worst.properties.lanes} lanes` : "") +
              ")"
            : "") +
          `, with ${worst.count} rides through it. Grey bars already have a signal.`
      )
    );
  }
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
