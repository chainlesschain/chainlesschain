/**
 * format-size.js — human-readable byte sizes for the web panel.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];

/**
 * Format a byte count as a human-readable size (e.g. 1536 → "1.5 KB").
 *
 * Returns "-" for null / NaN / negative input. The unit index is clamped so
 * sub-byte and very large values still render a real unit instead of
 * `units[NaN]` / `units[>maxIndex]` === "undefined" (the bug in the old
 * inline `Math.log(num)/Math.log(1024)` implementation).
 *
 * @param {number|string|null|undefined} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return "-";
  const num = Number(bytes);
  if (num < 0) return "-";
  if (num === 0) return "0 B";
  let i = Math.floor(Math.log(num) / Math.log(1024));
  if (i < 0) i = 0;
  if (i >= UNITS.length) i = UNITS.length - 1;
  return (num / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + UNITS[i];
}
