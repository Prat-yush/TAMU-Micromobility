/**
 * state.js
 *
 * The filter state shared by the map and every box, and the predicates that read
 * it. Views never test filter fields directly — they call the helpers here,
 * so adding a filter means changing one file.
 */

/**
 * Active filters and view options.
 *
 * Veo filters narrow rides; theft filters narrow incidents; `zoneId` is a
 * cross-filter set by clicking a zone anywhere, and applies to both.
 */
const STATE = {
  /** A date from the collection days, or "all". */
  day: "all",
  /** Ride start hour, inclusive of `hourFrom`, exclusive of `hourTo`. */
  hourFrom: 0,
  hourTo: 24,
  /** "all", or "dark" to keep only rides started after civil dusk. */
  light: "all",

  /** "all", "upd_crime_alert" or "clery_log". */
  source: "all",
  /** "all", "pre" (before Nov 2025) or "post". */
  period: "all",

  /** zone_id of the cross-filtered zone, or null. */
  zoneId: null,

  /** Which map layers are switched on, keyed as in MAP_LAYERS. */
  mapLayers: { routes: true, gaps: false, conflicts: true, thefts: false, buildings: true },
  /** "rides" or "facility": what colours the route layer. */
  routeColor: "rides",
};

/** The month the UPD crime-alert list begins, which changes coverage. */
const COVERAGE_CHANGE_DATE = "2025-11-01";

/**
 * True when any Veo filter would change the ride set.
 *
 * Used to skip the per-ride recount on first load, where the pre-computed
 * totals in the export are already correct.
 *
 * @param {Object} filters Filter state.
 * @returns {boolean}
 */
function isVeoFiltered(filters) {
  return (
    filters.day !== "all" ||
    filters.hourFrom !== 0 ||
    filters.hourTo !== 24 ||
    filters.light !== "all"
  );
}

/**
 * Tests one ride against the Veo filters.
 *
 * @param {Object} ride A ride feature's properties.
 * @param {Object} filters Filter state.
 * @returns {boolean} True when the ride should be counted.
 */
function rideMatchesFilters(ride, filters) {
  if (filters.day !== "all" && ride.date !== filters.day) return false;
  if (filters.light === "dark" && !ride.after_dark) return false;

  const startHour = new Date(ride.started_at).getHours();
  if (startHour < filters.hourFrom || startHour >= filters.hourTo) return false;

  return true;
}

/**
 * Tests one incident against the theft filters and the selected zone.
 *
 * @param {Object} incident A flattened incident.
 * @param {Object} filters Filter state.
 * @param {boolean} applyZone Whether the zone cross-filter applies here.
 * @returns {boolean} True when the incident should be counted.
 */
function incidentMatchesFilters(incident, filters, applyZone = true) {
  if (filters.source !== "all" && incident.source !== filters.source) return false;

  if (filters.period === "pre" && incident.incident_date >= COVERAGE_CHANGE_DATE) {
    return false;
  }
  if (filters.period === "post" && incident.incident_date < COVERAGE_CHANGE_DATE) {
    return false;
  }

  if (applyZone && filters.zoneId && incident.zoneId !== filters.zoneId) {
    return false;
  }

  return true;
}

/**
 * Returns the incidents passing the current theft filters.
 *
 * @param {Object} data Output of loadData.
 * @param {Object} filters Filter state.
 * @param {boolean} applyZone Whether the zone cross-filter applies.
 * @returns {Array<Object>} Matching incidents.
 */
function filteredIncidents(data, filters, applyZone = true) {
  return data.incidents.filter((incident) =>
    incidentMatchesFilters(incident, filters, applyZone)
  );
}

/**
 * Counts filtered incidents per zone.
 *
 * The export's `theft_count` is the unfiltered total, so any view that
 * respects the source or period filters needs its own count.
 *
 * @param {Object} data Output of loadData.
 * @param {Object} filters Filter state.
 * @returns {Map<string, number>} Incident count keyed by zone_id.
 */
function incidentsByZone(data, filters) {
  const counts = new Map();

  // The zone cross-filter is deliberately not applied: a zone's own bubble
  // should keep its size when it is the selected one.
  filteredIncidents(data, filters, false).forEach((incident) => {
    counts.set(incident.zoneId, (counts.get(incident.zoneId) || 0) + 1);
  });

  return counts;
}

/**
 * Describes the active filters in a sentence, for captions and empty states.
 *
 * @param {Object} filters Filter state.
 * @param {Object} data Output of loadData.
 * @returns {string} A human description, or "" when nothing is filtered.
 */
function describeFilters(filters, data) {
  const parts = [];

  if (filters.day !== "all") parts.push(formatDay(filters.day));
  if (filters.hourFrom !== 0 || filters.hourTo !== 24) {
    parts.push(`${formatHour(filters.hourFrom)}–${formatHour(filters.hourTo)}`);
  }
  if (filters.light === "dark") parts.push("after dark");
  if (filters.source !== "all") parts.push(LABELS.source[filters.source]);
  if (filters.period === "pre") parts.push("before Nov 2025");
  if (filters.period === "post") parts.push("Nov 2025 onward");

  if (filters.zoneId) {
    const zone = data.zoneFeatures.find(
      (f) => f.properties.zone_id === filters.zoneId
    );
    if (zone) parts.push(zone.properties.name);
  }

  return parts.join(" · ");
}

/**
 * Formats a collection date as a short weekday and day.
 *
 * @param {string} date An ISO date, YYYY-MM-DD.
 * @returns {string} e.g. "Mon Oct 12".
 */
function formatDay(date) {
  // Parsed as local midnight so the weekday does not shift by a timezone.
  const [year, month, day] = date.split("-").map(Number);
  return d3.timeFormat("%a %b %-d")(new Date(year, month - 1, day));
}

/**
 * Formats an hour of the day.
 *
 * @param {number} hour 0 to 24.
 * @returns {string} e.g. "09:00".
 */
function formatHour(hour) {
  return String(hour).padStart(2, "0") + ":00";
}
