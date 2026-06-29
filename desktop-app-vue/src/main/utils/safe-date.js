"use strict";

/**
 * `new Date(x).toISOString()` throws `RangeError: Invalid time value` when x is
 * an invalid/missing date (undefined, NaN, a non-date string). When x comes from
 * external/remote/DB data that may be malformed, one bad value would throw out of
 * a `.map` and break the whole list (e.g. a P2P-shared recording with a corrupt
 * `sharedAt`, or an external-device file with a bad `last_modified`).
 *
 * `safeToISOString` returns the fallback instead of throwing.
 *
 * @param {*} value - anything `new Date()` accepts (epoch, string, Date)
 * @param {string|null} [fallback=null] - returned when the date is invalid
 * @returns {string|null} ISO-8601 string, or the fallback
 */
function safeToISOString(value, fallback = null) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

module.exports = { safeToISOString };
