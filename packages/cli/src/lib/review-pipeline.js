/**
 * Multi-agent code-review pipeline core (P2 "多 Agent Code Review").
 *
 * `cc review` today is a single read-only agent pass. The gap upgrades it to:
 *   1. multiple finders (correctness / security / performance / tests),
 *   2. a verifier that independently reproduces each finding,
 *   3. a deduper that merges duplicates and confidence-filters,
 *   4. structured output (path / line / category / severity / failure_scenario /
 *      evidence).
 *
 * This module is the PURE aggregation core — normalize, dedup+merge, apply
 * verifier verdicts, confidence-filter, rank, and render the structured report.
 * The fan-out of finder/verifier AGENTS is orchestration the command layer adds;
 * everything here is deterministic and testable without an LLM.
 *
 * P1-1 wiring (行评论锚定): when the caller supplies the reviewed file contents,
 * each finding's output carries a re-anchorable comment ANCHOR (file + base hash
 * + line + anchored line text + context) via [[review-comment-anchor.js]] instead
 * of only a bare `line` coordinate — so a downstream IDE Diff Review can relocate
 * or stale the comment after the agent edits the file, never reusing a dead line.
 */

import { makeCommentAnchor } from "./review-comment-anchor.js";

/** The finder dimensions a full review fans out across. */
export const REVIEW_DIMENSIONS = Object.freeze([
  "correctness",
  "security",
  "performance",
  "tests",
]);

const SEVERITY_RANK = Object.freeze({
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  note: 1,
});
const SEVERITY_LABEL = Object.freeze({
  5: "Critical",
  4: "High",
  3: "Medium",
  2: "Low",
  1: "Note",
});

/** Canonical severity label (unknown → "Note"). */
export function normalizeSeverity(sev) {
  const r = SEVERITY_RANK[String(sev || "").toLowerCase()] || 1;
  return SEVERITY_LABEL[r];
}
export function severityRank(sev) {
  return SEVERITY_RANK[String(sev || "").toLowerCase()] || 0;
}

/** Clamp a confidence to [0,1]; non-numeric → `dflt`. */
export function clampConfidence(v, dflt = 0.5) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(0, Math.min(1, n));
}

function confOf(f) {
  const n = Number(f?.confidence);
  return Number.isFinite(n) ? n : 0.5;
}

function normTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** Dedup identity: same file location + same issue (title). Category-agnostic so
 *  two finders reporting one bug under different categories merge. */
export function findingKey(f) {
  return `${f?.path || ""}:${f?.line ?? ""}:${normTitle(f?.title)}`;
}

function unionField(group, keys) {
  const out = [];
  const seen = new Set();
  for (const f of group) {
    for (const key of keys) {
      const v = f?.[key];
      const list = Array.isArray(v) ? v : v != null ? [v] : [];
      for (const item of list) {
        const s = String(item);
        if (s && !seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    }
  }
  return out;
}

function maxSeverityLabel(group) {
  let best = 0;
  for (const f of group) best = Math.max(best, severityRank(f.severity));
  return SEVERITY_LABEL[best] || "Note";
}

/**
 * Merge findings that describe the SAME issue at the SAME location. The
 * representative keeps the highest severity + highest confidence; categories /
 * dimensions / evidence are unioned WHEN PRESENT (so a plain
 * `{path,line,severity,title}` finding round-trips unchanged — the wiring into
 * `parseFindings` relies on this). Shape-preserving for inputs without those
 * fields.
 */
export function dedupeFindings(findings) {
  const groups = new Map();
  const order = [];
  for (const f of findings || []) {
    if (!f) continue;
    const key = findingKey(f);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(f);
  }
  return order.map((key) => {
    const group = groups.get(key);
    const winner = [...group].sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        confOf(b) - confOf(a),
    )[0];
    const merged = { ...winner, severity: maxSeverityLabel(group) };
    if (Number.isFinite(Number(winner.confidence))) {
      merged.confidence = Math.max(...group.map(confOf));
    }
    const cats = unionField(group, ["category", "categories"]);
    if (cats.length) merged.categories = cats;
    const dims = unionField(group, ["dimension", "dimensions"]);
    if (dims.length) merged.dimensions = dims;
    if (group.length > 1) merged.mergedCount = group.length;
    return merged;
  });
}

/**
 * Apply verifier verdicts. `verdicts` maps a findingKey → { verified, confidence?,
 * note? }. A finding the verifier could NOT reproduce (`verified === false`) is
 * DROPPED; a reproduced one is kept, its confidence updated and a `verified`
 * flag set. Findings with no verdict pass through as unverified.
 */
export function applyVerdicts(findings, verdicts = {}) {
  const map =
    verdicts instanceof Map
      ? verdicts
      : new Map(Object.entries(verdicts || {}));
  const out = [];
  for (const f of findings || []) {
    if (!f) continue;
    const v = map.get(findingKey(f));
    if (!v) {
      out.push(f);
      continue;
    }
    if (v.verified === false) continue; // refuted → drop
    out.push({
      ...f,
      verified: true,
      confidence:
        v.confidence != null ? clampConfidence(v.confidence) : confOf(f),
      ...(v.note ? { verifierNote: String(v.note) } : {}),
    });
  }
  return out;
}

/** Keep findings whose confidence is at least `minConfidence`. */
export function filterByConfidence(findings, { minConfidence = 0 } = {}) {
  return (findings || []).filter((f) => f && confOf(f) >= minConfidence);
}

/** Sort by severity (desc) then confidence (desc) then path/line for stability. */
export function rankFindings(findings) {
  return [...(findings || [])].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      confOf(b) - confOf(a) ||
      String(a.path || "").localeCompare(String(b.path || "")) ||
      (Number(a.line) || 0) - (Number(b.line) || 0),
  );
}

/** Look a path's content up from a Map or plain object, or return undefined. */
function lookupContent(fileContents, filePath) {
  if (!fileContents) return undefined;
  if (typeof fileContents.get === "function") return fileContents.get(filePath);
  return fileContents[filePath];
}

function toOutputFinding(f, fileContents) {
  const line = Number.isFinite(Number(f.line))
    ? Math.floor(Number(f.line))
    : null;
  const failureScenario = String(f.failureScenario || f.failure_scenario || "");
  const out = {
    path: String(f.path || ""),
    line,
    category: f.category || (f.categories && f.categories[0]) || "correctness",
    severity: normalizeSeverity(f.severity),
    failure_scenario: failureScenario,
    evidence: String(f.evidence || ""),
    confidence: clampConfidence(f.confidence),
  };
  // P1-1: anchor the comment to the CODE it addresses, not to a coordinate, so
  // an IDE diff review can relocate/stale it after edits (never reuse a dead
  // line). Only when the caller supplied this file's content AND we have a
  // valid 1-based line to anchor.
  if (line != null && line >= 1) {
    const content = lookupContent(fileContents, out.path);
    if (typeof content === "string") {
      out.anchor = makeCommentAnchor({
        file: out.path,
        content,
        line,
        comment: failureScenario || out.evidence,
        id: `${out.path}:${line}:${out.category}`,
      });
    }
  }
  return out;
}

/**
 * The full pipeline: dedup → apply verdicts → confidence-filter → rank → render
 * the structured report (the gap's path/line/category/severity/failure_scenario/
 * evidence output) plus severity/category rollups.
 *
 * @param {Array} rawFindings   findings from all finders
 * @param {object} [opts]       { verdicts, minConfidence, fileContents }
 *   fileContents — optional Map/object of `path → current file content`. When a
 *   finding's file is present, its output gains a re-anchorable `anchor` (P1-1);
 *   omit it and the output is byte-identical to before.
 */
export function buildReviewReport(
  rawFindings,
  { verdicts = {}, minConfidence = 0, fileContents = null } = {},
) {
  const deduped = dedupeFindings(rawFindings);
  const verified = applyVerdicts(deduped, verdicts);
  const filtered = filterByConfidence(verified, { minConfidence });
  const ranked = rankFindings(filtered);
  const findings = ranked.map((f) => toOutputFinding(f, fileContents));

  const bySeverity = { Critical: 0, High: 0, Medium: 0, Low: 0, Note: 0 };
  const byCategory = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }
  return {
    findings,
    summary: { total: findings.length, bySeverity, byCategory },
  };
}
