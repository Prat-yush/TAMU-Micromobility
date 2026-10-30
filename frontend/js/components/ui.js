/**
 * components/ui.js
 *
 * The page furniture the dashboard is built from: cards, segmented
 * toggles, legends and headline figures. Sections compose these rather
 * than writing their own markup, so the page stays consistent.
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
 * Builds a placeholder card for a view that is still being built.
 *
 * It says plainly that nothing is shown yet and what will be, so a reader
 * never mistakes the empty panel for a finding.
 *
 * @param {string} title Card heading.
 * @param {string} text What the view will show, and what it waits on.
 * @returns {HTMLElement} The card.
 */
function placeholderCard(title, text) {
  const node = card(title, "");
  node.classList.add("is-wip");
  node.querySelector(".sub").replaceWith(el("span", "badge", "Work in progress"));
  node.append(el("p", "wip-text", text));
  return node;
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
 * Builds a legend from a list of swatch descriptions.
 *
 * @param {Array<Object>} items Each with `label`, `color` and optional
 *     `shape` ("line", "dot", "ring", "ring-dashed" or "square", default
 *     "square").
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
        : shape === "ring" || shape === "ring-dashed"
        ? `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" style="fill:none;stroke:${item.color};stroke-width:2${
            shape === "ring-dashed" ? ";stroke-dasharray:3 2" : ""
          }"/></svg>`
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
