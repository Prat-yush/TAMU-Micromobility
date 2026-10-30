/**
 * app.js
 *
 * Wires the workbook together: the sheet registry, the filter shelf, the
 * tab strip and the render loop. Sheets never talk to each other — they
 * read STATE and call back into here, and one render redraws whatever is
 * showing.
 */

/**
 * The worksheets, in tab order.
 *
 * `id` is the tab's key, `tag` the small mark on the tab, and `render` a
 * function taking the main element and the render context.
 */
const SHEETS = [
  { id: "dashboard", tag: "★", name: "Dashboard", render: renderDashboard },
  { id: "routes", tag: "1", name: "Busiest routes", render: renderRoutesSheet },
  { id: "facilities", tag: "2", name: "Facility gap", render: renderFacilitiesSheet },
  { id: "conflicts", tag: "3", name: "Road conflicts", render: renderConflictsSheet },
  { id: "ride-timing", tag: "4", name: "Ride timing", render: renderRideTimingSheet },
  { id: "theft-map", tag: "5", name: "Theft hotspots", render: renderTheftMapSheet },
  { id: "rack-audit", tag: "6", name: "Rack audit", render: renderRackAuditSheet },
  { id: "theft-timing", tag: "7", name: "Theft timing", render: renderTheftTimingSheet },
  { id: "incident-log", tag: "8", name: "Incident log", render: renderIncidentLogSheet },
  { id: "coverage", tag: "9", name: "Data & coverage", render: renderCoverageSheet },
];

/** The loaded datasets, set once on startup. */
let DATA = null;

/** Starts the workbook. */
async function start() {
  const main = document.querySelector("#main");
  main.innerHTML = '<p class="loading">Loading campus data…</p>';

  try {
    DATA = await loadData();
  } catch (error) {
    main.innerHTML =
      '<p class="loading">Could not load the data files. ' +
      "The page reads them over HTTP, so it needs to be served rather than " +
      "opened from the filesystem.</p>";
    throw error;
  }

  buildFilterShelf();
  buildTabs();
  render();

  // Charts size themselves to their host, so a width change needs a redraw.
  let lastWidth = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    render();
  });
}

/** Redraws the active worksheet. */
function render() {
  const main = document.querySelector("#main");
  main.innerHTML = "";

  const counts = countRides(DATA, STATE);
  const sheet = SHEETS.find((entry) => entry.id === STATE.sheet) || SHEETS[0];

  sheet.render(main, {
    data: DATA,
    counts,
    rerender: render,
    selectZone,
    goToSheet,
  });

  updateTabs();
  updateShelf();
}

/**
 * Selects or clears the cross-filtered zone.
 *
 * Clicking the zone that is already selected clears it, so a reader can
 * undo a cross-filter with the same gesture that set it.
 *
 * @param {string} zoneId The zone to select.
 */
function selectZone(zoneId) {
  STATE.zoneId = STATE.zoneId === zoneId ? null : zoneId;
  render();
}

/**
 * Switches to another worksheet.
 *
 * @param {string} sheetId The sheet to show.
 */
function goToSheet(sheetId) {
  STATE.sheet = sheetId;
  scrollTo({ top: 0, behavior: "smooth" });
  render();
}

/** Builds the tab strip. */
function buildTabs() {
  const strip = document.querySelector("#tabs");
  strip.innerHTML = "";

  SHEETS.forEach((sheet) => {
    const button = el(
      "button",
      sheet.id === "dashboard" ? "is-dashboard" : null,
      `<span class="ic">${sheet.tag}</span>${sheet.name}`
    );
    button.type = "button";
    button.setAttribute("role", "tab");
    button.dataset.sheet = sheet.id;
    button.onclick = () => goToSheet(sheet.id);
    strip.append(button);
  });
}

/** Marks the active tab. */
function updateTabs() {
  document.querySelectorAll("#tabs button").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.sheet === STATE.sheet)
    );
  });
}

/** Builds the filter shelf that applies to every worksheet. */
function buildFilterShelf() {
  const shelf = document.querySelector("#shelf");
  shelf.innerHTML = "";

  shelf.append(
    selectFilter({
      id: "f-day",
      label: "Veo · day",
      options: [
        ["all", `All ${DATA.collectionDays.length} days`],
        ...DATA.collectionDays.map((day) => [day.date, formatDay(day.date)]),
      ],
      value: STATE.day,
      onChange: (value) => {
        STATE.day = value;
        render();
      },
    })
  );

  shelf.append(buildHourFilter());

  shelf.append(
    selectFilter({
      id: "f-light",
      label: "Veo · light",
      options: [
        ["all", "Any time"],
        ["dark", "After dark only"],
      ],
      value: STATE.light,
      onChange: (value) => {
        STATE.light = value;
        render();
      },
    })
  );

  shelf.append(
    selectFilter({
      id: "f-source",
      label: "Theft · source",
      options: [
        ["all", "Both sources"],
        ["upd_crime_alert", LABELS.source.upd_crime_alert],
        ["clery_log", LABELS.source.clery_log],
      ],
      value: STATE.source,
      onChange: (value) => {
        STATE.source = value;
        render();
      },
    })
  );

  shelf.append(
    selectFilter({
      id: "f-period",
      label: "Theft · period",
      options: [
        ["all", "Feb 2025 – Aug 2026"],
        ["pre", "Before Nov 2025"],
        ["post", "Nov 2025 onward"],
      ],
      value: STATE.period,
      onChange: (value) => {
        STATE.period = value;
        render();
      },
    })
  );

  const zoneCard = el("div", "fcard is-active");
  zoneCard.id = "f-zone";
  zoneCard.hidden = true;
  shelf.append(zoneCard);

  shelf.append(el("span", "note", "Filters apply to every worksheet"));
}

/**
 * Builds one labelled select for the shelf.
 *
 * @param {Object} options Id, label, option pairs, value and handler.
 * @returns {HTMLElement} The filter card.
 */
function selectFilter({ id, label, options, value, onChange }) {
  const wrapper = el("div", "fcard");
  wrapper.dataset.filter = id;

  const labelNode = el("label", null, label);
  labelNode.htmlFor = id;
  wrapper.append(labelNode);

  const select = document.createElement("select");
  select.id = id;
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    option.selected = optionValue === value;
    select.append(option);
  });
  select.onchange = () => onChange(select.value);
  wrapper.append(select);

  return wrapper;
}

/**
 * Builds the two-ended hour filter.
 *
 * @returns {HTMLElement} The filter card.
 */
function buildHourFilter() {
  const wrapper = el("div", "fcard");
  wrapper.dataset.filter = "f-hours";
  wrapper.append(el("span", "flbl", "Veo · ride start"));

  const row = el("div", "row");

  const from = hourSelect("f-hour-from", STATE.hourFrom, 0, 23);
  const to = hourSelect("f-hour-to", STATE.hourTo, 1, 24);

  /** Applies both ends, keeping `from` below `to`. */
  function apply() {
    const fromValue = Number(from.value);
    const toValue = Number(to.value);
    STATE.hourFrom = Math.min(fromValue, toValue - 1);
    STATE.hourTo = Math.max(toValue, fromValue + 1);
    render();
  }

  from.onchange = apply;
  to.onchange = apply;

  row.append(from, document.createTextNode("to"), to);
  wrapper.append(row);

  return wrapper;
}

/**
 * Builds an hour dropdown.
 *
 * @param {string} id Element id.
 * @param {number} value Selected hour.
 * @param {number} min First hour offered.
 * @param {number} max Last hour offered.
 * @returns {HTMLSelectElement} The dropdown.
 */
function hourSelect(id, value, min, max) {
  const select = document.createElement("select");
  select.id = id;
  select.setAttribute("aria-label", id === "f-hour-from" ? "From hour" : "To hour");

  for (let hour = min; hour <= max; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour);
    option.textContent = formatHour(hour);
    option.selected = hour === value;
    select.append(option);
  }

  return select;
}

/** Marks filters holding a non-default value, and shows the zone chip. */
function updateShelf() {
  const nonDefault = {
    "f-day": STATE.day !== "all",
    "f-hours": STATE.hourFrom !== 0 || STATE.hourTo !== 24,
    "f-light": STATE.light !== "all",
    "f-source": STATE.source !== "all",
    "f-period": STATE.period !== "all",
  };

  Object.entries(nonDefault).forEach(([filterId, isActive]) => {
    const node = document.querySelector(`[data-filter="${filterId}"]`);
    if (node) node.classList.toggle("is-active", isActive);
  });

  const zoneCard = document.querySelector("#f-zone");
  if (!zoneCard) return;

  if (!STATE.zoneId) {
    zoneCard.hidden = true;
    return;
  }

  const zone = DATA.zoneFeatures.find(
    (feature) => feature.properties.zone_id === STATE.zoneId
  );

  zoneCard.hidden = false;
  zoneCard.innerHTML = '<span class="flbl">Selected zone</span>';

  const row = el("div", "row");
  row.append(document.createTextNode(zone ? zone.properties.name : STATE.zoneId));

  const clear = el("button", "clear", "Clear");
  clear.type = "button";
  clear.onclick = () => {
    STATE.zoneId = null;
    render();
  };
  row.append(clear);

  zoneCard.append(row);
}

start();
