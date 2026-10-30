/**
 * sections/ride-timing.js
 *
 * When riding happens. The collection windows differ by day, so this sheet
 * works hard to keep a gap in the record from reading as a quiet hour.
 */

/**
 * Renders the ride-timing worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data, counts and the render callback.
 */
function renderRideTimingSheet(main, context) {
  const { data, counts } = context;

  const left = sheetFrame(main, {
    title: "When do people ride?",
    lede:
      "Rides started per 15 minutes, one row per collection day. Hatched " +
      "spans are time the scraper did not cover — not quiet periods.",
    badge: "Veo · timing",
    marks: {
      mark: "Bar (small multiples)",
      position: "Time of day across, one day per row",
      color: "Veo blue; uncovered time hatched in grey",
      size: "Bar height, rides started in the bin",
      detail: "Day, bin start, rides",
      why:
        "Small multiples share one vertical scale, so the days compare " +
        "directly without a colour key, and each day keeps its own window.",
      caveat: CAVEATS.coverage,
    },
  });

  const timelineCard = card(
    "Ride starts per 15 minutes",
    `${data.collectionDays.length} collection days · ${formatCount(
      d3.sum(data.collectionDays, (day) => day.rides)
    )} rides`
  );
  left.append(timelineCard);
  dayTimeline(vizHost(timelineCard), data.timeline);

  const earliest = d3.min(data.collectionDays, (day) => day.window[0].slice(11, 16));
  caption(
    timelineCard,
    `No day was recorded before <b>${earliest}</b>, so this data holds no ` +
      "morning commute. Saturday Oct 10 is the only weekend day, and " +
      "Wednesday Oct 14 was an evening-only run."
  );

  const profileCard = card(
    "Rides through the day, all days combined",
    "Summed from each segment's hourly split"
  );
  left.append(profileCard);

  const byHour = ridesByHour(data, counts);
  hourProfile(vizHost(profileCard), byHour, { label: "rides counted" });

  const peakHour = d3.maxIndex(byHour);
  caption(
    profileCard,
    `The busiest hour recorded is <b>${formatHour(peakHour)}</b>. Because ` +
      "the days cover different windows, read this as when riding was seen, " +
      "not as a full daily profile."
  );
}

/**
 * Sums rides per hour of the day across the conflict points.
 *
 * Conflict points carry an hourly split and are few enough that summing
 * them is cheap, where summing all 4,455 segments would count one ride
 * once per segment it used.
 *
 * @param {Object} data Output of loadData.
 * @param {Object} counts Output of countRides.
 * @returns {Array<number>} 24 values, index 0 is midnight.
 */
function ridesByHour(data, counts) {
  if (counts.filtered) {
    // Under a filter the per-ride walk is already the source of truth, so
    // count ride start times directly.
    const byHour = new Array(24).fill(0);
    data.rideFeatures.forEach((feature) => {
      if (!rideMatchesFilters(feature.properties, STATE)) return;
      byHour[new Date(feature.properties.started_at).getHours()] += 1;
    });
    return byHour;
  }

  const byHour = new Array(24).fill(0);
  data.rideFeatures.forEach((feature) => {
    byHour[new Date(feature.properties.started_at).getHours()] += 1;
  });
  return byHour;
}
