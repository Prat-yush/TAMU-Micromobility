/**
 * components/ui.js
 *
 * The page furniture every worksheet is built from: cards, headers, the
 * marks panel, segmented toggles and legends. Sections compose these
 * rather than writing their own markup, so the workbook stays consistent.
 */

/**
 * Creates an element with an optional class and inner HTML.
 *
 * @param {string} tag Tag name.
 * @param {string|null} className Class attribute, or null for none.
 * @param {string} [html] Inner HTML.
 * @returns {HTMLElement} The new element.
 */
function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

/**
 * Builds a titled card, the container for one view.
 *
 * @param {string} title Card heading.
 * @param {string} [subtitle] Smaller line under the heading.
 * @returns {HTMLElement} The card, ready to append content to.
 */
function card(title, subtitle) {
  const node = el("section", "card");
  const header = el("div");
  header.append(el("h3", null, title));
  header.append(el("p", "sub", subtitle || ""));
  node.append(header);
  return node;
}

/**
 * Adds a chart host to a card and returns it.
 *
 * Charts measure this element to size themselves, so it must be in the
 * document before a chart is drawn into it.
 *
 * @param {HTMLElement} parent The card.
 * @returns {HTMLElement} The chart host.
 */
function vizHost(parent) {
  const host = el("div", "viz");
  parent.append(host);
  return host;
}

/**
 * Splits a card into a map column and a column beside it.
 *
 * Campus is markedly taller than it is wide, so a map that fills a card's
 * height uses only part of its width. Putting the legend, caption and any
 * ranked list in the space beside it keeps the card compact and lets the
 * reader compare the two without scrolling.
 *
 * On a narrow screen the CSS stacks the two columns.
 *
 * @param {HTMLElement} parent The card.
 * @returns {{host: HTMLElement, side: HTMLElement}} The map host and the
 *     column beside it.
 */
function mapLayout(parent) {
  const row = el("div", "map-layout");
  const host = el("div", "viz");
  const side = el("div", "map-side");

  row.append(host, side);
  parent.append(row);

  return { host, side };
}

/**
 * Adds a caption below a card's content.
 *
 * @param {HTMLElement} parent The card.
 * @param {string} html Caption HTML; `<b>` marks the figures worth seeing.
 */
function caption(parent, html) {
  parent.append(el("p", "caption", html));
}

/**
 * Builds a segmented control for switching a view between modes.
 *
 * @param {Array<[string, string]>} options Value and label pairs.
 * @param {string} value The selected value.
 * @param {Function} onPick Called with the newly picked value.
 * @param {string} ariaLabel Describes the group for screen readers.
 * @returns {HTMLElement} The control.
 */
function segmentedControl(options, value, onPick, ariaLabel) {
  const group = el("div", "seg");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", ariaLabel);

  options.forEach(([optionValue, label]) => {
    const button = el("button", null, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(optionValue === value));
    button.onclick = () => onPick(optionValue);
    group.append(button);
  });

  return group;
}

/**
 * Builds the header and two-column body for a worksheet.
 *
 * Every sheet has the same shape: a title and lede, the views down the
 * left, and a marks panel on the right explaining the encoding.
 *
 * @param {HTMLElement} main The main element to render into.
 * @param {Object} sheet Title, lede, badge and marks for this worksheet.
 * @returns {HTMLElement} The left column, for the sheet to append views to.
 */
function sheetFrame(main, sheet) {
  const header = el("div", "sheet-head");
  const titleBlock = el("div");
  titleBlock.append(el("h2", null, sheet.title));
  if (sheet.lede) titleBlock.append(el("p", null, sheet.lede));
  header.append(titleBlock);
  if (sheet.badge) header.append(el("span", "badge", sheet.badge));
  main.append(header);

  const grid = el("div", "sheet-grid");
  main.append(grid);

  const left = el("div", "sheet-col");
  grid.append(left);
  grid.append(marksPanel(sheet.marks));

  return left;
}

/**
 * Builds the panel describing how a worksheet encodes its data.
 *
 * Naming the marks, channels and the reason for them keeps the design
 * decisions visible rather than buried in the code, and gives a reader a
 * way to check whether a view says what it appears to say.
 *
 * @param {Object} marks Encoding description for one worksheet.
 * @returns {HTMLElement} The panel.
 */
function marksPanel(marks) {
  const panel = el("aside", "card marks");
  if (!marks) return panel;

  panel.append(el("h4", null, "Marks"));

  const list = el("dl");
  const rows = [
    ["Mark", marks.mark],
    ["Position", marks.position],
    ["Colour", marks.color],
    ["Size", marks.size],
    ["Detail", marks.detail],
  ];

  rows.forEach(([term, value]) => {
    if (!value) return;
    list.append(el("dt", null, term));
    list.append(el("dd", null, value));
  });

  panel.append(list);

  if (marks.why) {
    panel.append(el("h4", null, "Why this form"));
    panel.append(el("p", "why", marks.why));
  }
  if (marks.caveat) {
    panel.append(el("h4", null, "Read with care"));
    panel.append(el("p", "why", marks.caveat));
  }

  return panel;
}

/**
 * Builds a legend from a list of swatch descriptions.
 *
 * @param {Array<Object>} items Each with `label`, `color` and optional
 *     `shape` ("line", "dot" or "square", default "square").
 * @returns {HTMLElement} The legend.
 */
function legend(items) {
  const node = el("div", "legend");

  items.forEach((item) => {
    const entry = el("span", "it");
    const shape = item.shape || "square";
    const swatch =
      shape === "line"
        ? `<svg width="16" height="10" aria-hidden="true"><line x1="0" y1="5" x2="16" y2="5" style="stroke:${item.color};stroke-width:3"/></svg>`
        : shape === "dot"
        ? `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" style="fill:${item.color}"/></svg>`
        : `<svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" style="fill:${item.color}"/></svg>`;
    entry.innerHTML = `${swatch}${item.label}`;
    node.append(entry);
  });

  return node;
}

/**
 * Builds a row of headline figures.
 *
 * @param {Array<Object>} metrics Each with `label`, `value`, optional
 *     `note` and optional `color` for a leading swatch.
 * @returns {HTMLElement} The row.
 */
function metricRow(metrics) {
  const row = el("div", "kpis");

  metrics.forEach((metric) => {
    const node = el("div", "kpi");
    const swatch = metric.color
      ? `<span class="sw" style="background:${metric.color}"></span>`
      : "";
    node.append(el("div", "k-lbl", swatch + metric.label));
    node.append(el("div", "k-val", metric.value));
    if (metric.note) node.append(el("div", "k-note", metric.note));
    row.append(node);
  });

  return row;
}

/** Formats a whole number with thousands separators. */
const formatCount = d3.format(",");

/** Formats a number to one decimal place. */
const formatDecimal = d3.format(".1f");

/**
 * Formats a fraction as a percentage.
 *
 * A share small enough to round to zero is shown as "<1%" instead, so a
 * category that exists is never labelled as though it does not.
 *
 * @param {number} fraction A value between 0 and 1.
 * @returns {string} e.g. "41%" or "<1%".
 */
function formatPercent(fraction) {
  const ONE_PERCENT = 0.01;
  if (fraction > 0 && fraction < ONE_PERCENT) return "<1%";
  return d3.format(".0%")(fraction);
}
