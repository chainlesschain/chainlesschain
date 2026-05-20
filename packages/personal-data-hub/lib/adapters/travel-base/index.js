/**
 * Phase 9 — shared travel adapter base.
 *
 * Common normalize logic for the 4 travel sources (12306 / Ctrip /
 * Amap / Baidu Map). Each per-vendor adapter parses its source format
 * into a `TravelRecord` then calls `normalizeTravelRecord()` here.
 *
 * TravelRecord shape (vendor-neutral):
 *   {
 *     vendorId:         "12306" | "ctrip" | "amap" | "baidumap"
 *     recordId:         string   (vendor's order/trip id, unique)
 *     vehicleType:      "flight" | "train" | "hotel" | "bus" | "car" | "visit"
 *     from?:            { city?, station?, lat?, lng? }
 *     to?:              { city?, station?, lat?, lng? }
 *     departureMs?:     number   (ms epoch)
 *     arrivalMs?:       number
 *     carrier?:         string   ("国航" / "12306" / "携程酒店预订" / ...)
 *     vehicleNumber?:   string   ("CA1234" / "G35" / "京A88888")
 *     totalCost?:       { value, currency }
 *     traveler?:        string   (passenger name)
 *     confirmationCode?:string
 *     bookedAt?:        number
 *     extras?:          { ... vendor-specific }
 *   }
 *
 * normalizeTravelRecord() returns a NormalizedBatch with:
 *   - 1 Event of subtype `trip`
 *   - 0-2 Place entities (from / to)
 *   - 0-2 Person entities (traveler if known + carrier as merchant)
 */

"use strict";

const { newId } = require("../../ids");

/**
 * Convert a TravelRecord to a NormalizedBatch.
 *
 * @param {TravelRecord} rec
 * @param {object}        ctx       optional context for cross-source link
 * @param {string}        ctx.accountKey   typically email or username
 * @param {string}        ctx.adapterName  the actual adapter.name string
 * @param {string}        ctx.adapterVersion
 * @returns {NormalizedBatch}
 */
function normalizeTravelRecord(rec, ctx = {}) {
  if (!rec || typeof rec !== "object") {
    throw new Error("normalizeTravelRecord: rec required");
  }
  if (!rec.recordId) throw new Error("normalizeTravelRecord: rec.recordId required");

  const now = Date.now();
  const occurredAt = Number.isFinite(rec.departureMs)
    ? rec.departureMs
    : Number.isFinite(rec.bookedAt)
      ? rec.bookedAt
      : now;

  const adapterName = ctx.adapterName || rec.vendorId || "travel";
  const adapterVersion = ctx.adapterVersion || "0.1.0";
  const source = {
    adapter: adapterName,
    adapterVersion,
    originalId: String(rec.recordId),
    capturedAt: occurredAt,
    capturedBy: "export",
  };

  // Places
  const places = [];
  const fromPlaceId = rec.from ? placeIdFor(rec.from, adapterName) : null;
  const toPlaceId = rec.to ? placeIdFor(rec.to, adapterName) : null;
  if (fromPlaceId) {
    places.push(makePlace(fromPlaceId, rec.from, now, source));
  }
  if (toPlaceId) {
    places.push(makePlace(toPlaceId, rec.to, now, source));
  }

  // Carrier as merchant Person (so spending skill can attribute)
  const persons = [];
  let carrierPersonId = null;
  if (rec.carrier) {
    carrierPersonId = `person-${adapterName}-carrier-${slug(rec.carrier)}`;
    persons.push({
      id: carrierPersonId,
      type: "person",
      subtype: "merchant",
      names: [rec.carrier],
      identifiers: {},
      ingestedAt: now,
      source,
      extra: { fromAdapter: adapterName, carrier: true },
    });
  }
  // Traveler (if not self)
  let travelerPersonId = null;
  if (rec.traveler && rec.traveler !== ctx.selfName) {
    travelerPersonId = `person-${adapterName}-traveler-${slug(rec.traveler)}`;
    persons.push({
      id: travelerPersonId,
      type: "person",
      subtype: "contact",
      names: [rec.traveler],
      identifiers: {},
      ingestedAt: now,
      source,
      extra: { fromAdapter: adapterName, role: "traveler" },
    });
  }

  // Event
  const eventId = newId();
  const event = {
    id: eventId,
    type: "event",
    subtype: "trip",
    occurredAt,
    actor: travelerPersonId || "person-self",
    participants: dedup(["person-self", travelerPersonId, carrierPersonId].filter(Boolean)),
    content: {
      title: buildTitle(rec),
      ...(rec.extras && rec.extras.note ? { text: rec.extras.note } : {}),
      ...(rec.totalCost && Number.isFinite(rec.totalCost.value)
        ? { amount: { value: rec.totalCost.value, currency: rec.totalCost.currency || "CNY", direction: "out" } }
        : {}),
    },
    ingestedAt: now,
    source,
    extra: {
      vehicleType: rec.vehicleType,
      vendorId: rec.vendorId,
      ...(rec.from ? { from: rec.from.station || rec.from.city || formatPlace(rec.from) } : {}),
      ...(rec.to ? { to: rec.to.station || rec.to.city || formatPlace(rec.to) } : {}),
      ...(rec.from ? { fromPlaceId } : {}),
      ...(rec.to ? { toPlaceId } : {}),
      ...(rec.arrivalMs ? { arrivalMs: rec.arrivalMs } : {}),
      ...(rec.vehicleNumber ? { vehicleNumber: rec.vehicleNumber } : {}),
      ...(rec.confirmationCode ? { confirmationCode: rec.confirmationCode } : {}),
      ...(rec.bookedAt ? { bookedAt: rec.bookedAt } : {}),
      ...(carrierPersonId ? { carrier: rec.carrier, carrierPersonId } : {}),
      ...(rec.extras ? { vendorExtras: rec.extras } : {}),
    },
  };

  return { events: [event], persons, places, items: [], topics: [] };
}

// ─── helpers ────────────────────────────────────────────────────────────

function buildTitle(rec) {
  const vt = rec.vehicleType || "trip";
  const from = rec.from ? (rec.from.station || rec.from.city || "?") : "";
  const to = rec.to ? (rec.to.station || rec.to.city || "?") : "";
  if (from && to) return `${vt}: ${from} → ${to}`;
  if (to) return `${vt}: → ${to}`;
  return `${vt}: ${rec.carrier || rec.recordId}`;
}

function formatPlace(p) {
  if (!p) return "";
  const parts = [p.city, p.station, p.name].filter(Boolean);
  return parts.join(" ");
}

function placeIdFor(p, adapterName) {
  // Stable id keyed by station/city/lat-lng so cross-trip places dedup
  if (!p) return null;
  const key = (p.station || p.city || p.name || `${p.lat},${p.lng}` || "").toString().toLowerCase();
  if (!key) return null;
  return `place-${adapterName}-${slug(key)}`;
}

function makePlace(id, p, now, source) {
  return {
    id,
    type: "place",
    subtype: "venue",
    name: p.station || p.city || p.name || id,
    address: p.address || undefined,
    aliases: [p.station, p.city, p.name].filter(Boolean),
    coordinates: (Number.isFinite(p.lat) && Number.isFinite(p.lng))
      ? { lat: p.lat, lng: p.lng }
      : undefined,
    ingestedAt: now,
    source,
    extra: {},
  };
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w一-鿿-]/g, "")
    .slice(0, 80);
}

function dedup(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (x == null || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/**
 * Parse a Chinese date string ("2026年4月15日 14:30") to ms epoch.
 * Handles 4 common formats; returns null on failure.
 */
function parseChineseDateTime(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  // YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6] || 0).getTime();
  }
  // YYYY/MM/DD HH:MM
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  // 2026年4月15日 14:30
  m = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  // 2026年4月15日 (no time)
  m = /^(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  // Fallback: Date.parse
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

module.exports = {
  normalizeTravelRecord,
  parseChineseDateTime,
  placeIdFor,
  slug,
};
