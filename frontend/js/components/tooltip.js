/**
 * components/tooltip.js
 *
 * The single hover tooltip shared by every mark on every worksheet. One
 * node is created and reused so the fade stays smooth as the cursor moves
 * between marks.
 */

/** The tooltip element, created on first use. */
let tooltipNode = null;

/**
 * Returns the tooltip element, creating it if this is the first call.
 *
 * @returns {HTMLElement} The tooltip node.
 */
function tooltipElement() {
  if (!tooltipNode) {
    tooltipNode = document.createElement("div");
    tooltipNode.className = "tip";
    tooltipNode.setAttribute("role", "status");
    document.body.append(tooltipNode);
  }
  return tooltipNode;
}

/**
 * Shows the tooltip at the cursor with the given HTML.
 *
 * @param {MouseEvent} event The triggering event.
 * @param {string} html Tooltip content.
 */
function showTip(event, html) {
  const node = tooltipElement();
  node.innerHTML = html;
  moveTip(event);
  node.style.opacity = 1;
}

/**
 * Moves the tooltip to follow the cursor, keeping it inside the viewport.
 *
 * Without the flip, a tooltip near the right or bottom edge would be cut
 * off by the window.
 *
 * @param {MouseEvent} event The triggering event.
 */
function moveTip(event) {
  const node = tooltipElement();
  const offset = 14;
  const box = node.getBoundingClientRect();

  const overflowsRight = event.clientX + offset + box.width > innerWidth;
  const overflowsBottom = event.clientY + offset + box.height > innerHeight;

  const left = overflowsRight
    ? event.clientX - offset - box.width
    : event.clientX + offset;
  const top = overflowsBottom
    ? event.clientY - offset - box.height
    : event.clientY + offset;

  node.style.left = `${Math.max(4, left)}px`;
  node.style.top = `${Math.max(4, top)}px`;
}

/** Hides the tooltip. */
function hideTip() {
  tooltipElement().style.opacity = 0;
}

/**
 * Attaches the standard hover behaviour to a d3 selection.
 *
 * @param {d3.Selection} selection Marks to make hoverable.
 * @param {Function} contentFor Called with the datum, returns tooltip HTML.
 */
function attachTooltip(selection, contentFor) {
  selection
    .on("mouseenter", (event, datum) => showTip(event, contentFor(datum)))
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip);
}
