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
  landmarks: "data/campus_landmarks.geojson",
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

/** Map marks, in pixels. They keep their size as the map zooms. */
const MAP = {
  /** Stroke width for a segment with a single ride. */
  minSegmentStroke: 1,
  /** Stroke width for the busiest segment. */
  maxSegmentStroke: 7,
  /** Radius for the largest theft bubble. */
  maxTheftRadius: 22,
  /** Radius for the largest conflict marker. */
  maxConflictRadius: 15,
  /** Ride-count ramps, quiet to busy: busy is the brighter end on dark tiles. */
  rideRampDark: ["#1d4f91", "#bfe3ff"],
  rideRampLight: ["#9ecae1", "#08306b"],
  /**
   * The facility-gap layer marks segments at or above this quantile of
   * ride counts (0.75 = the busiest quarter) whose facility is not
   * `adequate` in FACILITIES.
   */
  gapRidesQuantile: 0.75,
  gapColor: "#ff3b30",
  /**
   * The gap layer also marks its busiest few segments as mixing points,
   * where riders share space with pedestrians or cars. Points are kept at
   * least this far apart so they don't all land on one walkway.
   */
  mixingPointCount: 4,
  mixingPointSpacingFt: 800,
  /** Opacity of the ordinary route layer while the gap layer is on. */
  routeOpacityUnderGaps: 0.35,
  /**
   * Zoom at which priority-2 building labels (residence halls) appear.
   * Below it they would crowd the landmarks out.
   */
  hallLabelMinZoom: 16,
  /** Clear space kept around each building label, in pixels. */
  labelGap: 4,
};

/**
 * The real basemap under the data: the standard OpenStreetMap tiles, the
 * same map the bike theft tracker uses. The stylesheet darkens them in
 * dark mode, so streets and buildings stay exactly where they are.
 */
const BASEMAP = {
  tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
  /**
   * Margin around the theft zones, in degrees (about a quarter mile), so
   * routes just past the outermost zones stay on the map.
   */
  boundsPadDegrees: 0.004,
  /** How far past the cropped area a reader can pan, as a fraction of it. */
  panSlack: 0.05,
  /** Opacity of the shade over everything outside the cropped area. */
  maskOpacity: 0.75,
};

/** The switchable map layers, in the order the checkboxes list them. */
const MAP_LAYERS = [
  { key: "routes", label: "Busiest routes" },
  { key: "gaps", label: "Busy, no bike facility" },
  { key: "conflicts", label: "Conflict points" },
  { key: "thefts", label: "Theft zones" },
  { key: "buildings", label: "Building names" },
];

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
 * Caveats the data guide asks the page to surface, quoted where a view
 * could mislead without them.
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
