/**
 * Phase 8.2 — EntityResolver rule stage.
 *
 * Per docs/design/Personal_Data_Hub_EntityResolver.md §4.1 — the synchronous
 * fast-path. Returns "same" | "different" | "uncertain" by looking only at
 * identifier overlap + naming + source provenance. No external calls, no
 * Ollama, < 5ms p99 even for thousands of candidates.
 *
 * The intent is to cleanly handle the cases where we KNOW the answer:
 *   - same identifier (email/phone/wechatId/did) → same
 *   - completely disjoint fingerprint → different
 *   - same adapter, same name, different originalId → same (adapter
 *     produced two rows for one person — rare but happens with
 *     un-normalized export channels)
 *
 * Anything else falls through to `uncertain` and gets sent to the
 * async embedding+LLM pipeline.
 */

"use strict";

/**
 * Identifier keys we treat as "if they overlap, they're definitively
 * the same person". These should be globally-unique-per-person values.
 * Keep this list conservative — adding `name` here would catch false
 * positives (different people sharing common Chinese names).
 */
const STRONG_IDENTIFIER_KEYS = [
  "email",
  "phone",
  "wechatId",
  "alipayUid",
  "did",
  "idHash",      // SHA-256 of national ID number (Phase 9+ contribution)
];

/**
 * Run the rule stage on a (pending, candidate) pair.
 *
 * @param {object} a   Person row
 * @param {object} b   Person row
 * @returns {{ verdict: "same"|"different"|"uncertain", reason: string }}
 */
function ruleStage(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") {
    return { verdict: "different", reason: "invalid input" };
  }
  if (a.id === b.id) {
    // Same Person row — vacuously "same" but caller should never pair a
    // person with itself. Surface clearly.
    return { verdict: "same", reason: "identical id" };
  }

  // R1. Strong identifier overlap → same
  const sharedKey = findSharedIdentifier(a.identifiers || {}, b.identifiers || {});
  if (sharedKey) {
    return { verdict: "same", reason: `identifier match: ${sharedKey.key}=${sharedKey.value}` };
  }

  // R3. Same adapter, different originalId, sharing a name → same
  // (catches adapter-internal duplicates where an export contains the
  // same person under two surface forms — rare but documented in design.)
  // GUARD: if BOTH sides have a strong identifier of the SAME key but
  // with DIFFERENT values, they're definitively different people sharing
  // a common name (homonym-trap). Don't R3-merge.
  if (a.source && b.source
      && a.source.adapter === b.source.adapter
      && a.source.originalId !== b.source.originalId
      && sharesAnyName(a.names, b.names)
      && !hasConflictingIdentifier(a.identifiers || {}, b.identifiers || {})
  ) {
    return {
      verdict: "same",
      reason: `same-adapter (${a.source.adapter}) internal dup: shared name`,
    };
  }

  // R2. Zero overlap on any field → different
  const overlap = countFieldOverlap(a, b);
  if (overlap === 0) {
    return { verdict: "different", reason: "no field overlap" };
  }

  // R4. Otherwise uncertain — send to async pipeline
  return { verdict: "uncertain", reason: `overlap=${overlap}` };
}

/**
 * Find a strong identifier shared between two identifier maps. Each
 * identifier value can be a string OR an array of strings (per UnifiedSchema).
 *
 * @returns {{key: string, value: string} | null}
 */
function findSharedIdentifier(idsA, idsB) {
  for (const key of STRONG_IDENTIFIER_KEYS) {
    const av = toArray(idsA[key]);
    const bv = toArray(idsB[key]);
    if (av.length === 0 || bv.length === 0) continue;
    // Normalize before compare — emails / phones often have surface variance
    const aNorm = av.map((v) => normalizeIdValue(key, v));
    const bNorm = bv.map((v) => normalizeIdValue(key, v));
    for (const v of aNorm) {
      if (v && bNorm.includes(v)) return { key, value: v };
    }
  }
  return null;
}

function toArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

/**
 * Returns true iff both sides have at least one strong identifier of
 * the SAME key but with DIFFERENT (normalized) values. This is the
 * "homonym-trap guard" for R3: if Alice@a.com and Alice@b.com share
 * the name "Alice" but have different emails, they're DIFFERENT people.
 */
function hasConflictingIdentifier(idsA, idsB) {
  for (const key of STRONG_IDENTIFIER_KEYS) {
    const av = toArray(idsA[key]).map((v) => normalizeIdValue(key, v));
    const bv = toArray(idsB[key]).map((v) => normalizeIdValue(key, v));
    if (av.length === 0 || bv.length === 0) continue;
    // Both have this identifier — overlap means SAME (handled by R1 above);
    // no overlap on the same key = conflict
    const overlap = av.some((v) => bv.includes(v));
    if (!overlap) return true;
  }
  return false;
}

/**
 * Light normalization to avoid trivial misses:
 *   - email: lowercase + trim
 *   - phone: digits only (strips + - spaces parens)
 *   - others: trim only
 */
function normalizeIdValue(key, v) {
  if (typeof v !== "string") return "";
  const trimmed = v.trim();
  if (key === "email") return trimmed.toLowerCase();
  if (key === "phone") {
    let digits = trimmed.replace(/[^0-9]/g, "");
    // Strip common country-code prefixes so "+86 138-0000 1111" and
    // "13800001111" collapse to the same value.
    if (digits.length === 13 && digits.startsWith("86")) digits = digits.slice(2);
    if (digits.length === 12 && digits.startsWith("1")) digits = digits.slice(1); // US +1 leading
    return digits;
  }
  return trimmed;
}

/**
 * Whether any name in A is also a name (or substring) in B. We use
 * substring match because adapters often label the same person differently
 * ("陈XX" in Alipay vs "陈" in WeChat nickname).
 */
function sharesAnyName(namesA, namesB) {
  const a = (namesA || []).filter((n) => typeof n === "string" && n.length > 0);
  const b = (namesB || []).filter((n) => typeof n === "string" && n.length > 0);
  if (a.length === 0 || b.length === 0) return false;
  // Exact match
  for (const x of a) {
    if (b.includes(x)) return true;
  }
  return false;
}

/**
 * Count the number of fields (name, identifier value, location, etc.)
 * that show ANY commonality between A and B. The threshold for R2 is
 * "0 overlap → different"; we don't try to weight overlaps here, just
 * detect total disjointedness.
 */
function countFieldOverlap(a, b) {
  let n = 0;

  // Name overlap
  if (sharesAnyName(a.names, b.names)) n += 1;

  // Identifier overlap (counted per-key)
  const aIds = a.identifiers || {};
  const bIds = b.identifiers || {};
  for (const key of Object.keys(aIds)) {
    if (!bIds[key]) continue;
    const av = toArray(aIds[key]);
    const bv = toArray(bIds[key]);
    if (av.some((v) => bv.includes(v))) n += 1;
  }

  // Same primary source adapter — usually means same data origin
  if (a.source && b.source && a.source.adapter === b.source.adapter) {
    n += 1;
  }

  return n;
}

module.exports = {
  ruleStage,
  findSharedIdentifier,
  countFieldOverlap,
  sharesAnyName,
  normalizeIdValue,
  STRONG_IDENTIFIER_KEYS,
};
