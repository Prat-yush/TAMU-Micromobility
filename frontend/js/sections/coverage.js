/**
 * sections/coverage.js
 *
 * What the data can and cannot say. Each source covers a different window,
 * and several of the figures elsewhere in the workbook would be misread
 * without that context.
 */

/**
 * Renders the coverage worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data and counts.
 */
function renderCoverageSheet(main, context) {
  const { data } = context;

  const left = sheetFrame(main, {
    title: "What this data can and can't say",
    lede:
      "Three sources, three different windows. Read every comparison across " +
      "them with that in mind.",
    badge: "Method",
    marks: {
      mark: "Bar (coverage strip)",
      position: "Date across, one source per row",
      color: "Theft sources orange, Veo blue",
      detail: "Source, span, what it holds",
      why:
        "A coverage strip makes the gaps visible before anyone compares " +
        "numbers that came from different spans.",
    },
  });

  const theftDates = data.incidents.map((incident) => incident.incident_date);
  const veoDates = data.collectionDays.map((day) => day.date);

  const strip = card("Source coverage", "");
  left.append(strip);

  coverageStrip(vizHost(strip), [
    {
      label: "UPD crime alerts",
      from: d3.min(
        data.incidents.filter((i) => i.source === "upd_crime_alert"),
        (i) => i.incident_date
      ),
      to: d3.max(
        data.incidents.filter((i) => i.source === "upd_crime_alert"),
        (i) => i.incident_date
      ),
      color: COLOR.theft,
      note: "Weekly alerts naming bike, e-bike and e-scooter thefts",
    },
    {
      label: "Clery crime log",
      from: d3.min(
        data.incidents.filter((i) => i.source === "clery_log"),
        (i) => i.incident_date
      ),
      to: d3.max(
        data.incidents.filter((i) => i.source === "clery_log"),
        (i) => i.incident_date
      ),
      color: COLOR.theftLight,
      note: "Public log retains roughly 60 days at a time",
    },
    {
      label: "Veo GBFS snapshots",
      from: d3.min(veoDates),
      to: d3.max(veoDates),
      color: COLOR.veo,
      note: "One-minute snapshots on four partial days",
    },
  ]);

  caption(
    strip,
    "The theft record runs over 18 months; the Veo record is four partial " +
      "days. Nothing in this workbook divides one by the other, and neither " +
      "should a reader."
  );

  const notes = card("Known limits", "");
  left.append(notes);

  const list = el("ul", "caption");
  list.style.paddingLeft = "18px";
  list.innerHTML = [
    `<li><b>Veo collection windows.</b> ${data.collectionDays
      .map((day) => `${formatDay(day.date)} ${day.window[0].slice(11, 16)}–${day.window[1].slice(11, 16)}`)
      .join(", ")}. No morning commute was recorded.</li>`,
    `<li><b>Routes are estimated.</b> ${CAVEATS.routes}</li>`,
    "<li><b>Counts are per segment.</b> A long path is many segments with " +
      "slightly different counts, so route rankings use the busiest single " +
      "segment rather than a sum.</li>",
    `<li><b>Conflict points are exposure.</b> ${CAVEATS.conflicts}</li>`,
    `<li><b>Thefts are reports.</b> ${CAVEATS.thefts} ` +
      "The UPD alert list begins in November 2025, so part of the rise " +
      "after that date is better coverage, not more crime.</li>",
    "<li><b>All recorded rides are Veo e-bikes.</b> No pedal-bike rides " +
      "appear in the GBFS feed, so nothing here describes private bikes.</li>",
  ].join("");

  notes.append(list);

  const totals = card("What is in the files", "");
  left.append(totals);

  totals.append(
    metricRow([
      {
        label: "Segments ridden",
        value: formatCount(data.segmentFeatures.length),
        note: "of a 14,053-segment network",
      },
      {
        label: "Rides",
        value: formatCount(data.totalRides),
        color: COLOR.veo,
        note: "inferred from snapshots",
      },
      {
        label: "Conflict points",
        value: formatCount(data.conflictFeatures.length),
        note: "where rides meet a major road",
      },
      {
        label: "Theft reports",
        value: formatCount(data.incidents.length),
        color: COLOR.theft,
        note: `${data.unplacedIncidents.length} more could not be placed`,
      },
    ])
  );
}
