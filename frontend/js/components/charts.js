/**
 * components/charts.js
 *
 * The non-spatial chart forms the worksheets share: horizontal bars, a
 * weekday-by-hour heatmap, a day timeline, an hour profile and a scatter.
 * Each one sizes itself from its host, so the page reflows without the
 * sections doing any layout maths.
 */

/**
 * Draws horizontal bars, sorted as given.
 *
 * Bars run horizontally because the labels are place names: vertical bars
 * would need rotated or truncated text.
 *
 * @param {HTMLElement} host Element to draw into.
 * @param {Array<Object>} rows Each with `label`, `value`, optional `color`,
 *     `tooltip`, `selected` and `key`.
 * @param {Object} [options] `rowHeight`, `labelWidth`, `valueFormat`,
 *     `onClick`.
 */
function horizontalBars(host, rows, options = {}) {
  const {
    rowHeight = CHART.barRowHeight,
    labelWidth = CHART.barLabelWidth,
    valueFormat = formatCount,
    onClick = null,
  } = options;

  const width = host.clientWidth || 600;
  const rightGutter = 52;
  const height = rows.length * rowHeight + 8;

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(rows, (row) => row.value) || 1])
    .range([labelWidth, Math.max(labelWidth + 10, width - rightGutter)]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const groups = svg
    .selectAll("g")
    .data(rows)
    .join("g")
    .attr("transform", (row, index) => `translate(0, ${index * rowHeight})`)
    .attr("class", onClick ? "clickable" : null);

  groups
    .append("text")
    .attr("class", "lab-2")
    .attr("x", labelWidth - 8)
    .attr("y", rowHeight / 2)
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((row) => row.label);

  groups
    .append("rect")
    .attr("x", labelWidth)
    .attr("y", 4)
    .attr("height", rowHeight - 10)
    .attr("rx", 2)
    .attr("width", (row) => Math.max(1, x(row.value) - labelWidth))
    .attr("fill", (row) => row.color || COLOR.veo)
    .attr("fill-opacity", (row) => (row.selected === false ? 0.45 : 1));

  groups
    .append("text")
    .attr("class", "lab-ink")
    .attr("x", (row) => x(row.value) + 6)
    .attr("y", rowHeight / 2)
    .attr("dy", "0.32em")
    .text((row) => valueFormat(row.value));

  attachTooltip(groups, (row) => row.tooltip || `<b>${row.label}</b><div>${valueFormat(row.value)}</div>`);

  if (onClick) groups.on("click", (event, row) => onClick(row));
}

/**
 * Draws a weekday-by-hour matrix of theft exposure.
 *
 * A matrix is used rather than a line because the pattern being looked for
 * is cyclic in two periods at once — time of day and day of week — which a
 * single axis cannot show.
 *
 * @param {HTMLElement} host Element to draw into.
 * @param {Array<Array<number>>} grid Seven rows of 24 values.
 */
function exposureHeatmap(host, grid) {
  const width = host.clientWidth || 600;
  const margin = { top: 18, right: 10, bottom: 10, left: 38 };
  const cellSize = Math.max(
    10,
    Math.floor((width - margin.left - margin.right) / 24)
  );
  const height = margin.top + cellSize * 7 + margin.bottom;

  const maxValue = d3.max(grid.flat()) || 1;
  // Square root, because a few extreme cells would otherwise flatten the
  // rest of the matrix into one indistinguishable shade.
  const color = d3
    .scaleSequential(d3.interpolateOranges)
    .domain([0, Math.sqrt(maxValue)]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const cells = [];
  grid.forEach((row, dayIndex) => {
    row.forEach((value, hour) => {
      cells.push({ dayIndex, hour, value });
    });
  });

  const marks = svg
    .append("g")
    .selectAll("rect")
    .data(cells)
    .join("rect")
    .attr("x", (cell) => margin.left + cell.hour * cellSize)
    .attr("y", (cell) => margin.top + cell.dayIndex * cellSize)
    .attr("width", cellSize - 1)
    .attr("height", cellSize - 1)
    .attr("rx", 1)
    .attr("fill", (cell) => (cell.value ? color(Math.sqrt(cell.value)) : "var(--grid)"));

  attachTooltip(
    marks,
    (cell) =>
      `<b>${LABELS.weekday[cell.dayIndex]} ${formatHour(cell.hour)}</b>` +
      `<div>${formatDecimal(cell.value)} theft-equivalents</div>`
  );

  svg
    .append("g")
    .selectAll("text")
    .data(LABELS.weekday)
    .join("text")
    .attr("class", "lab")
    .attr("x", margin.left - 6)
    .attr("y", (day, index) => margin.top + index * cellSize + cellSize / 2)
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((day) => day);

  // Label every third hour, so the axis stays legible at any cell size.
  svg
    .append("g")
    .selectAll("text")
    .data(d3.range(0, 24, 3))
    .join("text")
    .attr("class", "lab")
    .attr("x", (hour) => margin.left + hour * cellSize)
    .attr("y", margin.top - 6)
    .text((hour) => String(hour).padStart(2, "0"));
}

/**
 * Draws ride starts over each collection day as small multiples.
 *
 * Every day shares one vertical scale so the rows compare directly, and
 * the hours outside a day's collection window are drawn as a hatched gap
 * rather than as zero, because nothing was recorded there.
 *
 * @param {HTMLElement} host Element to draw into.
 * @param {Object} timeline The timeline export.
 */
function dayTimeline(host, timeline) {
  const width = host.clientWidth || 600;
  const rowHeight = 64;
  const margin = { top: 16, right: 12, bottom: 24, left: 86 };
  const height = margin.top + timeline.days.length * rowHeight + margin.bottom;

  const allDays = timeline.days.map((day) => ({
    day,
    bins: fillDayBins(day, timeline.bin_minutes),
  }));

  const maxRides = d3.max(allDays, (row) => d3.max(row.bins, (b) => b.rides || 0)) || 1;

  const MINUTES_IN_DAY = 24 * 60;
  const x = d3
    .scaleLinear()
    .domain([0, MINUTES_IN_DAY])
    .range([margin.left, width - margin.right]);
  const barHeight = d3.scaleLinear().domain([0, maxRides]).range([0, rowHeight - 24]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const binWidth = Math.max(1, x(timeline.bin_minutes) - x(0) - 0.5);

  allDays.forEach((row, index) => {
    const top = margin.top + index * rowHeight;
    const baseline = top + rowHeight - 20;
    const group = svg.append("g");

    group
      .append("text")
      .attr("class", "lab-ink")
      .attr("x", margin.left - 10)
      .attr("y", top + 14)
      .attr("text-anchor", "end")
      .text(formatDay(row.day.date));

    group
      .append("text")
      .attr("class", "lab")
      .attr("x", margin.left - 10)
      .attr("y", top + 28)
      .attr("text-anchor", "end")
      .text(`${formatCount(row.day.rides)} rides`);

    // The uncovered span is drawn first, under the bars.
    group
      .selectAll("rect.gap")
      .data(row.bins.filter((bin) => !bin.covered))
      .join("rect")
      .attr("class", "timeline-gap")
      .attr("x", (bin) => x(bin.minute))
      .attr("y", top + 6)
      .attr("width", binWidth)
      .attr("height", rowHeight - 26);

    const bars = group
      .selectAll("rect.bar")
      .data(row.bins.filter((bin) => bin.covered))
      .join("rect")
      .attr("class", "timeline-bar")
      .attr("x", (bin) => x(bin.minute))
      .attr("y", (bin) => baseline - barHeight(bin.rides))
      .attr("width", binWidth)
      .attr("height", (bin) => barHeight(bin.rides));

    attachTooltip(
      bars,
      (bin) =>
        `<b>${formatDay(row.day.date)} ${bin.label}</b>` +
        `<div>${bin.rides} ride${bin.rides === 1 ? "" : "s"} started</div>`
    );

    group
      .append("line")
      .attr("class", "axis-line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", baseline)
      .attr("y2", baseline);
  });

  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(d3.range(0, 25, 3).map((hour) => hour * 60))
        .tickFormat((minutes) => formatHour(minutes / 60))
    );
}

/**
 * Draws a 24-hour profile as vertical bars.
 *
 * @param {HTMLElement} host Element to draw into.
 * @param {Array<number>} byHour 24 values, index 0 is midnight.
 * @param {Object} [options] `color` and `label` for the tooltip.
 */
function hourProfile(host, byHour, options = {}) {
  const { color = COLOR.veo, label = "rides" } = options;
  const width = host.clientWidth || 600;
  const height = 180;
  const margin = CHART.margin;

  const x = d3
    .scaleBand()
    .domain(d3.range(24))
    .range([margin.left, width - margin.right])
    .padding(0.18);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(byHour) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(width - margin.left - margin.right)))
    .call((axis) => axis.select(".domain").remove())
    .call((axis) => axis.selectAll(".tick line").attr("class", "gridline"));

  const bars = svg
    .append("g")
    .selectAll("rect")
    .data(byHour.map((value, hour) => ({ hour, value })))
    .join("rect")
    .attr("x", (d) => x(d.hour))
    .attr("y", (d) => y(d.value))
    .attr("width", x.bandwidth())
    .attr("height", (d) => y(0) - y(d.value))
    .attr("rx", 1)
    .attr("fill", color);

  attachTooltip(
    bars,
    (d) => `<b>${formatHour(d.hour)}</b><div>${formatCount(d.value)} ${label}</div>`
  );

  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(d3.range(0, 24, 3))
        .tickFormat((hour) => String(hour).padStart(2, "0"))
    );
}

/**
 * Draws rack capacity against reported thefts, one point per zone.
 *
 * Capacity spans three orders of magnitude, so the horizontal axis is
 * symlog: a linear axis would pile most zones against the left edge, and a
 * plain log axis cannot show the zones with no racks recorded.
 *
 * @param {HTMLElement} host Element to draw into.
 * @param {Array<Object>} zones Each with `name`, `capacity` and `thefts`.
 * @param {Function} onClick Called with a zone_id.
 */
function capacityScatter(host, zones, onClick) {
  const width = host.clientWidth || 600;
  const height = 300;
  const margin = { top: 14, right: 18, bottom: 38, left: 42 };

  const x = d3
    .scaleSymlog()
    .constant(10)
    .domain([0, d3.max(zones, (z) => z.capacity) || 1])
    .range([margin.left, width - margin.right]);
  const y = d3
    .scaleLinear()
    .domain([0, Math.max(5, d3.max(zones, (z) => z.thefts))])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)))
    .call((axis) => axis.select(".domain").remove())
    .call((axis) => axis.selectAll(".tick line").attr("class", "gridline"));

  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues([0, 10, 50, 100, 250, 500, 1000].filter((v) => v <= x.domain()[1]))
        .tickFormat(formatCount)
    );

  svg
    .append("text")
    .attr("class", "lab")
    .attr("x", width - margin.right)
    .attr("y", height - 6)
    .attr("text-anchor", "end")
    .text("rack spaces in zone →");

  svg
    .append("text")
    .attr("class", "lab")
    .attr("x", margin.left)
    .attr("y", margin.top - 2)
    .text("reported thefts ↑");

  const points = svg
    .append("g")
    .selectAll("circle")
    .data(zones)
    .join("circle")
    .attr("class", "clickable")
    .attr("cx", (z) => x(z.capacity))
    .attr("cy", (z) => y(z.thefts))
    .attr("r", (z) => (z.zoneId === STATE.zoneId ? 7 : 5))
    .attr("fill", (z) => (z.thefts ? COLOR.theft : COLOR.muted))
    .attr("fill-opacity", (z) => (z.thefts ? 0.78 : 0.3))
    .attr("stroke", (z) => (z.zoneId === STATE.zoneId ? COLOR.ink : "none"))
    .attr("stroke-width", 2);

  attachTooltip(
    points,
    (z) =>
      `<b>${z.name}</b>` +
      `<div class="m">${formatCount(z.capacity)} rack spaces</div>` +
      `<div>${z.thefts} reported theft${z.thefts === 1 ? "" : "s"}</div>`
  );

  points.on("click", (event, z) => onClick(z.zoneId));
}

/**
 * Draws a coverage strip showing when each source has data.
 *
 * @param {HTMLElement} host Element to draw into.
 * @param {Array<Object>} sources Each with `label`, `from`, `to`, `color`
 *     and optional `note`.
 */
function coverageStrip(host, sources) {
  const width = host.clientWidth || 600;
  const rowHeight = 30;
  const margin = { top: 10, right: 16, bottom: 28, left: 180 };
  const height = margin.top + sources.length * rowHeight + margin.bottom;

  const x = d3
    .scaleTime()
    .domain([
      d3.min(sources, (s) => new Date(s.from)),
      d3.max(sources, (s) => new Date(s.to)),
    ])
    .range([margin.left, width - margin.right]);

  const svg = d3
    .select(host)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const rows = svg
    .selectAll("g")
    .data(sources)
    .join("g")
    .attr("transform", (source, index) => `translate(0, ${margin.top + index * rowHeight})`);

  rows
    .append("text")
    .attr("class", "lab-2")
    .attr("x", margin.left - 10)
    .attr("y", rowHeight / 2)
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((source) => source.label);

  const bars = rows
    .append("rect")
    .attr("x", (source) => x(new Date(source.from)))
    .attr("y", 6)
    .attr("height", rowHeight - 14)
    .attr("rx", 3)
    // A single-day source would otherwise be invisible.
    .attr("width", (source) =>
      Math.max(3, x(new Date(source.to)) - x(new Date(source.from)))
    )
    .attr("fill", (source) => source.color);

  attachTooltip(
    bars,
    (source) =>
      `<b>${source.label}</b>` +
      `<div class="m">${source.from} to ${source.to}</div>` +
      (source.note ? `<div>${source.note}</div>` : "")
  );

  svg
    .append("g")
    .attr("class", "ax")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6));
}
