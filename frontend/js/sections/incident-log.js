/**
 * sections/incident-log.js
 *
 * Details on demand: every reported incident behind the other sheets,
 * with a link back to the public record it came from.
 */

/**
 * Renders the incident-log worksheet.
 *
 * @param {HTMLElement} main The main element.
 * @param {Object} context Data and the zone selection callback.
 */
function renderIncidentLogSheet(main, context) {
  const { data, selectZone } = context;

  const left = sheetFrame(main, {
    title: "Every reported incident",
    lede:
      "The records behind every other theft view, with the window each " +
      "victim reported. Filters and the selected zone apply here too.",
    badge: "Theft · detail",
    marks: {
      mark: "Text table",
      position: "Sorted by incident date, newest first",
      detail: "Date, case number, zone, location, window, source",
      why:
        "Overview first, then details on demand: the table is the drill-down " +
        "every other sheet points at, and the place a reader checks a figure " +
        "they do not believe.",
      caveat:
        "Case numbers and locations come from public UPD crime alerts and " +
        "the Clery crime log, as reported.",
    },
  });

  const incidents = filteredIncidents(data, STATE);

  const tableCard = card(
    "Incidents",
    `${incidents.length} report${incidents.length === 1 ? "" : "s"} · ${
      describeFilters(STATE, data) || "no filters"
    }`
  );
  left.append(tableCard);

  const wrap = el("div", "log-wrap");
  const table = el("table", "log");
  table.innerHTML =
    "<thead><tr><th>Date</th><th>Zone</th><th>Where</th>" +
    "<th>Window</th><th>Type</th><th>Source</th></tr></thead>";

  const body = el("tbody");

  incidents.forEach((incident) => {
    const row = el("tr", "clickable");
    row.innerHTML =
      `<td class="num">${incident.incident_date}` +
      `<div class="case-no">${incident.case_no}</div></td>` +
      `<td>${incident.zoneName}</td>` +
      `<td>${incident.location || ""}</td>` +
      `<td class="num">${formatWindow(incident.window_hours)}</td>` +
      `<td>${LABELS.reportType[incident.report_type] || incident.report_type}</td>` +
      `<td>${sourceCell(incident)}</td>`;

    // Clicking the row selects the zone, but a click on the source link
    // should follow the link instead.
    row.onclick = (event) => {
      if (event.target.closest("a")) return;
      selectZone(incident.zoneId);
    };

    body.append(row);
  });

  table.append(body);
  wrap.append(table);
  tableCard.append(wrap);

  if (data.unplacedIncidents.length) {
    caption(
      tableCard,
      `A further <b>${data.unplacedIncidents.length}</b> reports could not be ` +
        "placed on a rack zone and are not shown here or counted on the map."
    );
  }
}

/**
 * Formats a report window in hours.
 *
 * @param {number|null} hours The reported window.
 * @returns {string} A readable span, or an em dash when none was reported.
 */
function formatWindow(hours) {
  if (hours == null) return "—";
  if (hours < 0.1) return "<0.1 h";

  const HOURS_PER_DAY = 24;
  if (hours >= HOURS_PER_DAY) return `${formatDecimal(hours / HOURS_PER_DAY)} d`;
  return `${formatDecimal(hours)} h`;
}

/**
 * Builds the source cell, linking to the public record when there is one.
 *
 * @param {Object} incident A flattened incident.
 * @returns {string} Cell HTML.
 */
function sourceCell(incident) {
  const label = LABELS.source[incident.source] || incident.source;
  if (!incident.source_url) return label;

  return `<a href="${incident.source_url}" target="_blank" rel="noopener">${label}</a>`;
}
