/**
 * sections/theft-timing.js
 *
 * When vehicles are exposed. Victims report a window, not a moment, so
 * this sheet is careful never to present the result as the time a theft
 * happened.
 */

/**
 * Renders the theft-timing worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data and the render callback.
 */
function renderTheftTimingSheet(main, context) {
  const { data } = context;

  const left = sheetFrame(main, {
    title: "When are vehicles taken?",
    lede:
      "A victim reports a window — last seen, then found missing — not a " +
      "moment. Each theft is spread evenly across the hours of its window, " +
      "so a ten-hour window adds 0.1 to each hour it covers.",
    badge: "Theft · timing",
    marks: {
      mark: "Square (matrix)",
      position: "Hour across, weekday down",
      color: "Sequential orange, square root of theft-equivalents",
      detail: "Weekday, hour, theft-equivalents",
      why:
        "The pattern is cyclic in two periods at once — time of day and day " +
        "of week — which a single time axis cannot show. One sequential hue " +
        "keeps it readable for colour-blind viewers.",
      caveat:
        "This shows when vehicles were exposed, not when they were taken. " +
        "Windows longer than a week carry no time-of-day information and " +
        "are left out.",
    },
  });

  const incidents = filteredIncidents(data, STATE);
  const { grid, used, skipped } = theftExposureGrid(incidents);

  const heatCard = card(
    "Hour by weekday",
    `${used} reports used · ${skipped} left out (no window, or longer than a week)`
  );
  left.append(heatCard);

  exposureHeatmap(vizHost(heatCard), grid);

  const byHour = d3.range(24).map((hour) => d3.sum(grid, (row) => row[hour]));
  const peakHour = d3.maxIndex(byHour);
  const byDay = grid.map((row) => d3.sum(row));
  const peakDay = d3.maxIndex(byDay);

  caption(
    heatCard,
    `Exposure peaks around <b>${formatHour(peakHour)}</b> and on ` +
      `<b>${LABELS.weekday[peakDay]}</b>. Because most windows span several ` +
      "hours, read the bright band as when vehicles sat unattended, not as " +
      "when a thief arrived."
  );

  const windowCard = card(
    "How long were the windows?",
    "Hours between last seen and found missing"
  );
  left.append(windowCard);

  const buckets = windowBuckets(incidents);
  horizontalBars(
    vizHost(windowCard),
    buckets.map((bucket) => ({
      label: bucket.label,
      value: bucket.count,
      color: COLOR.theft,
      tooltip: `<b>${bucket.label}</b><div>${bucket.count} reports</div>`,
    })),
    { labelWidth: 150 }
  );

  const withWindow = incidents.filter((incident) => incident.window_hours != null);
  const median = d3.median(withWindow, (incident) => incident.window_hours);

  caption(
    windowCard,
    `Median window is about <b>${formatDecimal(median || 0)} hours</b>. The ` +
      "longer the window, the less the hour-by-weekday matrix above can say " +
      "about any single report."
  );
}

/**
 * Buckets report windows into readable spans.
 *
 * @param {Array<Object>} incidents Filtered incidents.
 * @returns {Array<Object>} One row per bucket, in order.
 */
function windowBuckets(incidents) {
  const buckets = [
    { label: "Under 1 hour", test: (hours) => hours < 1 },
    { label: "1 to 6 hours", test: (hours) => hours >= 1 && hours < 6 },
    { label: "6 to 24 hours", test: (hours) => hours >= 6 && hours < 24 },
    { label: "1 to 7 days", test: (hours) => hours >= 24 && hours < 168 },
    { label: "Over a week", test: (hours) => hours >= 168 },
  ];

  const rows = buckets.map((bucket) => ({
    label: bucket.label,
    count: incidents.filter(
      (incident) => incident.window_hours != null && bucket.test(incident.window_hours)
    ).length,
  }));

  rows.push({
    label: "No window reported",
    count: incidents.filter((incident) => incident.window_hours == null).length,
  });

  return rows;
}
