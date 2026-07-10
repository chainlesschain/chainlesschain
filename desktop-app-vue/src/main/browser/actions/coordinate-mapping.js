/**
 * Pure coordinate-space transforms for computer-use / vision actions.
 *
 * No electron / robotjs / playwright dependency — fully unit-testable without
 * a real display or vision model. Extracted to make the coordinate CONTRACT
 * explicit, because the recurring bug here is that it was implicit and lost:
 *
 *   A screenshot is captured in ONE pixel space — a desktop thumbnail fit to
 *   a box, or a page viewport scaled by devicePixelRatio — and a vision model
 *   returns coordinates in THAT space. The click is then performed in a
 *   DIFFERENT space (physical screen pixels for robotjs, CSS viewport pixels
 *   for playwright). The two only coincide at 1:1; otherwise the click lands
 *   off by the ratio between the spaces (and off in a way that grows with
 *   scaleFactor / how far down a full-page shot the target sits).
 *
 * @module browser/actions/coordinate-mapping
 */

function assertPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `coordinate-mapping: ${name} must be a positive finite number (got ${value})`,
    );
  }
}

/**
 * Linear map of a point from a source pixel space to a target pixel space.
 * X and Y scale INDEPENDENTLY: desktopCapturer preserves aspect so they are
 * usually equal, but a clip or a non-matching aspect ratio makes them differ,
 * and reusing one axis' scale for the other would skew the off-axis
 * coordinate.
 *
 * @returns {{ x: number, y: number }}
 */
function scalePoint({
  x,
  y,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
}) {
  assertPositive("sourceWidth", sourceWidth);
  assertPositive("sourceHeight", sourceHeight);
  assertPositive("targetWidth", targetWidth);
  assertPositive("targetHeight", targetHeight);
  return {
    x: (x * targetWidth) / sourceWidth,
    y: (y * targetHeight) / sourceHeight,
  };
}

/**
 * Physical device-pixel size of an Electron display: logical size ×
 * scaleFactor. This is the space robotjs' SetCursorPos uses on Windows.
 *
 * @param {{ size?: {width:number,height:number}, scaleFactor?: number }} display
 * @returns {{ width: number, height: number, scaleFactor: number }}
 */
function displayPhysicalSize(display) {
  const size = (display && display.size) || {};
  const scaleFactor = (display && display.scaleFactor) || 1;
  return {
    width: size.width * scaleFactor,
    height: size.height * scaleFactor,
    scaleFactor,
  };
}

/**
 * Map a point picked on a desktop SCREENSHOT (thumbnail) to the coordinate
 * a mouse driver expects.
 *
 *   space 'physical' (default): screen physical pixels — what robotjs uses on
 *     Windows (SetCursorPos operates on the raw resolution).
 *   space 'logical': DIP / logical pixels (the display's `size`, pre-scale) —
 *     for drivers/platforms that address the mouse in logical coordinates.
 *
 * Rounds to whole pixels (mouse drivers take integers).
 *
 * @returns {{ x: number, y: number, space: string }}
 */
function imageToScreen({
  imageX,
  imageY,
  imageWidth,
  imageHeight,
  display,
  space = "physical",
}) {
  const scaleFactor = (display && display.scaleFactor) || 1;
  const logical = (display && display.size) || {};
  const target =
    space === "logical"
      ? { width: logical.width, height: logical.height }
      : {
          width: logical.width * scaleFactor,
          height: logical.height * scaleFactor,
        };
  const mapped = scalePoint({
    x: imageX,
    y: imageY,
    sourceWidth: imageWidth,
    sourceHeight: imageHeight,
    targetWidth: target.width,
    targetHeight: target.height,
  });
  return { x: Math.round(mapped.x), y: Math.round(mapped.y), space };
}

/**
 * Map a point picked on a PAGE screenshot to the coordinates playwright's
 * page.mouse.click expects (CSS pixels, viewport-relative).
 *
 *   screenshot pixel dims = CSS dims × deviceScaleFactor
 *   → cssX = imageX / dsf, cssY = imageY / dsf
 *
 * For a viewport (non-fullPage) shot the CSS point IS the viewport point.
 * For a fullPage shot the CSS point is a PAGE coordinate; page.mouse.click is
 * viewport-relative, so the caller must scroll the target into view first —
 * `needsScroll` flags that and `pageX/pageY` give the page coordinate to
 * scroll to.
 *
 * At dsf = 1, non-fullPage this is the identity — the historical common-case
 * behavior is unchanged.
 *
 * @returns {{ x?: number, y?: number, pageX: number, pageY: number, needsScroll: boolean }}
 */
function imageToViewport({
  imageX,
  imageY,
  deviceScaleFactor = 1,
  fullPage = false,
}) {
  assertPositive("deviceScaleFactor", deviceScaleFactor);
  const cssX = imageX / deviceScaleFactor;
  const cssY = imageY / deviceScaleFactor;
  if (fullPage) {
    return { pageX: cssX, pageY: cssY, needsScroll: true };
  }
  return { x: cssX, y: cssY, pageX: cssX, pageY: cssY, needsScroll: false };
}

module.exports = {
  scalePoint,
  displayPhysicalSize,
  imageToScreen,
  imageToViewport,
};
