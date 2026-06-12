/**
 * Shared field-extraction helpers for FAMILY-23 live JSON fetchers
 * (edu-zuoyebang / edu-huawei-learning / finance-alipay).
 *
 * Same semantics as the locals in game-honor-of-kings/api-client.js — kept
 * separate so existing clients (KOH / genshin) stay untouched; new live
 * clients require from here instead of re-duplicating.
 */
"use strict";

/** First present, non-empty value among `keys` on `obj`. */
function pick(obj, keys, fallback = null) {
  if (!obj || typeof obj !== "object") return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}

/**
 * Coerce a seconds-or-ms duration to ms. Session lengths separate cleanly:
 * seconds form is ≤ ~7200 (2h), ms form is ≥ ~300000 (5min) — a 1e5 threshold
 * disambiguates without overlap.
 */
function toDurationMs(v) {
  if (!Number.isFinite(v)) {
    const n = typeof v === "string" && /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return 0;
    v = n;
  }
  if (v <= 0) return 0;
  return v < 1e5 ? v * 1000 : v;
}

/** Coerce epoch seconds-or-ms (or date string) to ms, else null. */
function toEpochMs(v) {
  if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      return n > 1e12 ? n : n * 1000;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

module.exports = { pick, toDurationMs, toEpochMs };
