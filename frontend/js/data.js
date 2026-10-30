/**
 * data.js
 *
 * Loads the five exports from `frontend/data/` and derives the shapes the
 * views need. Nothing here draws; nothing that draws reads raw files.
 */

/**
 * Loads every export in parallel and indexes what the views look up often.
 *
 * @returns {Promise<Object>} The loaded datasets plus derived indexes.
 */
async function loadData() {
  const [segments, rides, conflicts, timeline, thefts] = await Promise.all([
    d3.json(DATA_PATHS.segments),
    d3.json(DATA_PATHS.rides),
    d3.json(DATA_PATHS.conflicts),
    d3.json(DATA_PATHS.timeline),
    d3.json(DATA_PATHS.thefts),
  ]);

  const segmentFeatures = segments.features;
  const rideFeatures = rides.features;
  const conflictFeatures = conflicts.features;
  const zoneFeatures = thefts.features;

  return {
    segments,
    rides,
    conflicts,
    timeline,
    thefts,

    segmentFeatures,
    rideFeatures,
    conflictFeatures,
    zoneFeatures,

    /** segment_id to feature, for resolving a ride's route. */
    segmentById: new Map(
      segmentFeatures.map((f) => [f.properties.segment_id, f])
    ),

    /** Every incident, flattened out of its zone and tagged with it. */
    incidents: flattenIncidents(zoneFeatures),

    /** Days the Veo scraper ran, with the window it covered. */
    collectionDays: timeline.days.map((day) => ({
      date: day.date,
      weekday: day.weekday,
      window: day.window,
      rides: day.rides,
    })),

    /** Reports whose location could not be placed on a zone. */
    unplacedIncidents: thefts.unplaced_incidents || [],

    totalRides: segments.metadata ? segments.metadata.ride_count : rideFeatures.length,
  };
}

/**
 * Pulls every incident out of its zone into one flat list.
 *
 * Each incident keeps a reference to the zone it belongs to, so the log
 * table and the timing heatmap can show zone names without a second lookup.
 *
 * @param {Array<Object>} zoneFeatures Features from theft_zones.geojson.
 * @returns {Array<Object>} One record per reported incident.
 */
function flattenIncidents(zoneFeatures) {
  const incidents = [];

  zoneFeatures.forEach((feature) => {
    const zone = feature.properties;
    (zone.incidents || []).forEach((incident) => {
      incidents.push({
        ...incident,
        zoneId: zone.zone_id,
        zoneName: zone.name,
        zoneKind: zone.kind,
      });
    });
  });

  return incidents.sort((a, b) =>
    d3.descending(a.incident_date, b.incident_date)
  );
}

/**
 * Recounts rides per segment and per conflict point for the active filters.
 *
 * The exports carry pre-computed splits (`rides_by_hour`, `rides_by_date`),
 * but those cannot be combined: a day filter and an hour filter together
 * would need a day-by-hour breakdown that isn't in the file. Walking the
 * rides and re-reading their `segment_ids` gives an exact count for any
 * combination of filters, and 1,859 rides is small enough to do on every
 * change.
 *
 * When no Veo filter is active the pre-computed `rides` totals are used
 * unchanged, which skips the walk entirely on first load.
 *
 * @param {Object} data Output of loadData.
 * @param {Object} filters Active filter state.
 * @returns {{segmentRides: Map, conflictRides: Map, rideCount: number,
 *     filtered: boolean}} Counts keyed by id.
 */
function countRides(data, filters) {
  const usingDefaults = !isVeoFiltered(filters);

  if (usingDefaults) {
    return {
      segmentRides: new Map(
        data.segmentFeatures.map((f) => [f.properties.segment_id, f.properties.rides])
      ),
      conflictRides: new Map(
        data.conflictFeatures.map((f, index) => [index, f.properties.rides])
      ),
      rideCount: data.totalRides,
      filtered: false,
    };
  }

  const matchingRides = data.rideFeatures.filter((feature) =>
    rideMatchesFilters(feature.properties, filters)
  );

  const segmentRides = new Map();
  matchingRides.forEach((feature) => {
    // A ride counts once per segment even if its route revisits one.
    new Set(feature.properties.segment_ids).forEach((segmentId) => {
      segmentRides.set(segmentId, (segmentRides.get(segmentId) || 0) + 1);
    });
  });

  return {
    segmentRides,
    conflictRides: countConflictRides(data, matchingRides),
    rideCount: matchingRides.length,
    filtered: true,
  };
}

/**
 * Counts how many of the given rides pass through each conflict point.
 *
 * Conflict points have no ride list of their own, so membership is taken
 * from the segments meeting at the point: a ride reaches the point if its
 * route used any of them. The segment sets are built once and cached on
 * the dataset, since they depend only on geometry, not on filters.
 *
 * @param {Object} data Output of loadData.
 * @param {Array<Object>} matchingRides Ride features passing the filters.
 * @returns {Map<number, number>} Ride count keyed by conflict point index.
 */
function countConflictRides(data, matchingRides) {
  if (!data.conflictSegmentSets) {
    data.conflictSegmentSets = buildConflictSegmentSets(data);
  }

  const counts = new Map();

  data.conflictSegmentSets.forEach((segmentIds, index) => {
    let rides = 0;
    matchingRides.forEach((feature) => {
      if (feature.properties.segment_ids.some((id) => segmentIds.has(id))) {
        rides += 1;
      }
    });
    counts.set(index, rides);
  });

  return counts;
}

/**
 * Works out which segments touch each conflict point.
 *
 * A conflict point is a junction, so the segments that reach it are the
 * ones with an endpoint near its coordinates. The threshold is generous
 * because the backend groups nodes within 120 ft into one point.
 *
 * @param {Object} data Output of loadData.
 * @returns {Array<Set<string>>} Segment ids per conflict point index.
 */
function buildConflictSegmentSets(data) {
  /** Degrees of latitude roughly equal to 150 ft at this latitude. */
  const thresholdDegrees = 0.0005;

  return data.conflictFeatures.map((conflict) => {
    const [conflictLon, conflictLat] = conflict.geometry.coordinates;
    const nearbySegments = new Set();

    data.segmentFeatures.forEach((segment) => {
      const line = segment.geometry.coordinates;
      const endpoints = [line[0], line[line.length - 1]];

      const touches = endpoints.some(
        ([lon, lat]) =>
          Math.abs(lon - conflictLon) < thresholdDegrees &&
          Math.abs(lat - conflictLat) < thresholdDegrees
      );

      if (touches) nearbySegments.add(segment.properties.segment_id);
    });

    return nearbySegments;
  });
}

/**
 * Sums ride-miles per facility category for the active filters.
 *
 * Ride-miles — rides on a segment times its length — is the fair way to
 * compare facility types, because a long quiet path and a short busy one
 * are not equivalent.
 *
 * @param {Object} data Output of loadData.
 * @param {Map<string, number>} segmentRides Counts from countRides.
 * @returns {Array<Object>} One row per facility, with miles and share.
 */
function rideMilesByFacility(data, segmentRides) {
  const milesByFacility = new Map();

  data.segmentFeatures.forEach((feature) => {
    const { segment_id, facility, length_ft } = feature.properties;
    const rides = segmentRides.get(segment_id) || 0;
    if (!rides) return;

    const FEET_PER_MILE = 5280;
    const miles = (rides * length_ft) / FEET_PER_MILE;
    milesByFacility.set(facility, (milesByFacility.get(facility) || 0) + miles);
  });

  const total = d3.sum(milesByFacility.values());

  return FACILITIES.map((facility) => {
    const miles = milesByFacility.get(facility.key) || 0;
    return {
      ...facility,
      miles,
      share: total ? miles / total : 0,
      color: FACILITY_COLORS[facility.key],
    };
  })
    .filter((row) => row.miles > 0)
    .sort((a, b) => d3.descending(a.miles, b.miles));
}

/**
 * Groups segments into named routes and keeps each one's busiest segment.
 *
 * Adding segment counts along a path would count one ride many times, so a
 * route's ride figure is its busiest single segment, as the data guide
 * instructs.
 *
 * @param {Object} data Output of loadData.
 * @param {Map<string, number>} segmentRides Counts from countRides.
 * @param {number} limit How many routes to return.
 * @returns {Array<Object>} Routes sorted busiest first.
 */
function busiestRoutes(data, segmentRides, limit) {
  const routes = new Map();

  data.segmentFeatures.forEach((feature) => {
    const properties = feature.properties;
    const rides = segmentRides.get(properties.segment_id) || 0;
    if (!rides) return;

    const name = routeLabel(properties);
    const existing = routes.get(name);

    if (!existing || rides > existing.rides) {
      routes.set(name, { name, rides, facility: properties.facility });
    }
  });

  return Array.from(routes.values())
    .sort((a, b) => d3.descending(a.rides, b.rides))
    .slice(0, limit);
}

/**
 * Picks the best available name for a segment.
 *
 * Most busy central walkways have no name in OpenStreetMap, so the guide
 * recommends falling back through the street name to a generic label.
 *
 * @param {Object} properties A segment's properties.
 * @returns {string} A label safe to show to a reader.
 */
function routeLabel(properties) {
  return (
    properties.osm_name ||
    properties.road_name ||
    (properties.walking_surface ? `Unnamed ${properties.walking_surface.toLowerCase()}` : "Unnamed walkway")
  );
}

/**
 * Builds a weekday-by-hour grid of theft exposure.
 *
 * A victim reports a window — last seen, then found missing — not a moment.
 * Spreading each theft evenly across the hours of its window shows when
 * vehicles were exposed; a ten-hour window adds 0.1 to each hour it covers.
 * Windows longer than a week carry no information about time of day and are
 * left out.
 *
 * @param {Array<Object>} incidents Flattened incidents.
 * @returns {{grid: Array<Array<number>>, used: number, skipped: number}}
 */
function theftExposureGrid(incidents) {
  const HOURS_IN_WEEK = 24 * 7;
  const grid = d3.range(7).map(() => new Array(24).fill(0));
  let used = 0;
  let skipped = 0;

  incidents.forEach((incident) => {
    const start = incident.last_seen ? new Date(incident.last_seen) : null;
    const end = incident.discovered_missing
      ? new Date(incident.discovered_missing)
      : null;

    if (!start || !end || Number.isNaN(+start) || Number.isNaN(+end)) {
      skipped += 1;
      return;
    }

    const windowHours = (end - start) / 36e5;
    if (windowHours < 0 || windowHours > HOURS_IN_WEEK) {
      skipped += 1;
      return;
    }

    // A zero-length window is a single moment: credit the hour it falls in.
    const steps = Math.max(1, Math.ceil(windowHours));
    const weightPerStep = 1 / steps;

    for (let step = 0; step < steps; step += 1) {
      const moment = new Date(+start + step * 36e5);
      grid[moment.getDay()][moment.getHours()] += weightPerStep;
    }
    used += 1;
  });

  return { grid, used, skipped };
}

/**
 * Fills the gaps in a day's 15-minute ride counts.
 *
 * Bins with no rides are left out of the export. They are filled with zero
 * inside the collection window and left undefined outside it, because time
 * the scraper did not cover is a gap, never a quiet period.
 *
 * @param {Object} day One entry from timeline.days.
 * @param {number} binMinutes Bin width from the timeline file.
 * @returns {Array<Object>} One row per bin across the whole day.
 */
function fillDayBins(day, binMinutes) {
  const MINUTES_IN_DAY = 24 * 60;
  const [windowStart, windowEnd] = day.window.map((t) => new Date(t));
  const startMinutes = windowStart.getHours() * 60 + windowStart.getMinutes();
  const endMinutes = windowEnd.getHours() * 60 + windowEnd.getMinutes();

  const bins = [];
  for (let minute = 0; minute < MINUTES_IN_DAY; minute += binMinutes) {
    const label =
      String(Math.floor(minute / 60)).padStart(2, "0") +
      ":" +
      String(minute % 60).padStart(2, "0");
    const covered = minute >= startMinutes - binMinutes && minute <= endMinutes;

    bins.push({
      minute,
      label,
      covered,
      rides: covered ? day.rides_started[label] || 0 : null,
    });
  }

  return bins;
}
