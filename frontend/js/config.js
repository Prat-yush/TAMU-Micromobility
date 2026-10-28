/**
 * config.js
 *
 * Every tunable value for the dashboard. Nothing elsewhere hard-codes a
 * colour, a size, a label or a data path: changing the palette, the map
 * height or a category label is a one-line edit here.
 */

/** Where each export lives, relative to index.html. */
const DATA_PATHS = {
  segments: "data/veo_segments.geojson",
  rides: "data/veo_rides.geojson",
  conflicts: "data/veo_conflict_points.geojson",
  timeline: "data/veo_timeline.json",
  thefts: "data/theft_zones.geojson",
};

/**
 * Colours are CSS custom properties so light and dark mode are handled in
 * one place (css/styles.css). JavaScript refers to them by name.
 */
const COLOR = {
  veo: "var(--veo)",
  veoWash: "var(--veo-wash)",
  theft: "var(--theft)",
  theftLight: "var(--theft-2)",
  accent: "var(--accent)",
  ink: "var(--ink)",
  ink2: "var(--ink-2)",
  muted: "var(--muted)",
  grid: "var(--grid)",
  surface: "var(--surface)",
  warn: "var(--warn-ink)",
  good: "var(--good-ink)",
};

/**
 * Facility categories in the order the backend decides them, best first.
 *
 * `adequate` marks the categories that give a rider somewhere of their own
 * to be. The project's headline finding is the share of ride-miles that
 * falls outside them, so the flag lives with the category rather than
 * being recomputed in each view.
 */
const FACILITIES = [
  { key: "separated bike path", label: "Separated bike path", adequate: true },
  { key: "protected bike lane", label: "Protected bike lane", adequate: true },
  { key: "painted bike lane", label: "Painted bike lane", adequate: true },
  { key: "shared-use path", label: "Shared-use path", adequate: true },
  {
    key: "sharrow or signed route",
    label: "Sharrow or signed route",
    adequate: false,
  },
  { key: "crossing", label: "Crossing", adequate: false },
  { key: "shared walkway", label: "Shared walkway", adequate: false },
  { key: "road, no bike facility", label: "Road, no bike facility", adequate: false },
];

/** The two categories the story is about, used for the headline figure. */
const GAP_FACILITIES = ["shared walkway", "road, no bike facility"];

/**
 * Colour per facility category. Warm hues mark the gap categories, cool
 * hues the ones that serve riders, so the map reads without the legend.
 */
const FACILITY_COLORS = {
  "separated bike path": "#1b7f5a",
  "protected bike lane": "#2f9e74",
  "painted bike lane": "#5cb98f",
  "shared-use path": "#8fcfae",
  "sharrow or signed route": "#d8b24a",
  crossing: "#c9a227",
  "shared walkway": "#e8833f",
  "road, no bike facility": "#cf4f2e",
};

/** Map rendering. Heights clamp so the map stays usable at any width. */
const MAP = {
  minHeight: 380,
  maxHeight: 720,
  /** Height as a fraction of available width, before clamping. */
  heightRatio: 0.82,
  /** Inset in pixels so strokes and bubbles are not clipped at the edge. */
  padding: 12,
  /** Stroke width in pixels for a segment with a single ride. */
  minSegmentStroke: 0.5,
  /** Stroke width in pixels for the busiest segment. */
  maxSegmentStroke: 7,
  /** Radius in pixels for the largest theft bubble. */
  maxTheftRadius: 22,
  /** Radius in pixels for the largest conflict marker. */
  maxConflictRadius: 15,
  /**
   * How many of the busiest features get a label drawn on the map.
   *
   * Kept low on purpose: campus zones cluster tightly, and more labels
   * than this start overlapping each other and the marks they name.
   */
  labelCount: 4,
};

/** Shared chart geometry, in pixels. */
const CHART = {
  barRowHeight: 26,
  barLabelWidth: 180,
  margin: { top: 12, right: 18, bottom: 32, left: 40 },
  tooltipFadeMs: 110,
};

/** Human labels for values that appear raw in the data. */
const LABELS = {
  source: {
    upd_crime_alert: "UPD crime alert",
    clery_log: "Clery crime log",
  },
  reportType: { theft: "Theft", attempted_theft: "Attempted theft" },
  weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

/**
 * Caveats the data guide asks the page to surface. Shown on the coverage
 * sheet and quoted where a specific view could mislead without them.
 */
const CAVEATS = {
  coverage:
    "Veo data covers Oct 10–14, 2026 only, and no day was recorded before " +
    "9:50 AM, so there is no morning commute in this data. Compare rates, " +
    "not totals.",
  routes:
    "Routes between one-minute GPS positions are inferred. Counts per " +
    "segment are reliable in aggregate, but where a sidewalk runs beside a " +
    "road the data cannot tell which one a rider used.",
  conflicts:
    "These points show exposure to traffic, not crashes. Usable campus " +
    "micromobility crash data does not exist.",
  thefts:
    "Reported thefts only. A zone with none is not necessarily safe, and " +
    "4 reports could not be placed on a zone.",
};

/** Credit line the data guide requires wherever route data is shown. */
const CREDITS = [
  { label: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
  { label: "Veo", url: null },
  { label: "Texas A&M Transportation Services", url: null },
  { label: "City of College Station", url: null },
  { label: "TAMU UPD crime alerts and Clery crime log", url: null },
];
