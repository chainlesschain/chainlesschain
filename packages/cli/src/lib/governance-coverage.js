/**
 * Governance coverage metrics — the last open item of P1-9 ("覆盖率指标") in
 * docs/CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md, and the
 * computation behind two §11.3 acceptance targets:
 *
 *   - "高风险 Tool Call Ledger/Trace 覆盖率：100%"
 *       every high-risk (irreversible side-effecting) tool call MUST have a
 *       side-effect-ledger entry AND a trace span.
 *   - "Plugin/MCP/Skill/Hook 来源、版本、权限可追溯率：100%"
 *       every externally-sourced tool/skill call MUST carry full provenance
 *       (source + version + scope + a recorded permission decision).
 *
 * "High-risk" is NOT re-defined here — it is exactly what [[side-effect-ledger.js]]
 * `classifyToolSideEffect` records (the ONE source), so this metric can't drift
 * from what the ledger actually tracks. Provenance rows are the attribution
 * records [[agent-tool-admission.js]] `buildToolAttribution` produces.
 *
 * PURE + deterministic: no fs / process / clock / RNG. The caller gathers a run's
 * tool calls, the op-ids that got a ledger entry, the op-ids that got a trace
 * span, and the attribution records; this reads back coverage ratios + the exact
 * uncovered items so a gap is actionable, not just a number.
 */

import { classifyToolSideEffect } from "./side-effect-ledger.js";

/** Coverage ratio in [0,1]; an empty population is vacuously fully covered. */
function ratio(covered, total) {
  return total === 0 ? 1 : covered / total;
}

/** Whether a tool call is high-risk (records an irreversible side effect). */
export function isHighRiskToolCall(call) {
  return classifyToolSideEffect(call?.tool, call?.args || {}) != null;
}

/**
 * High-risk tool-call ledger + trace coverage (§11.3 metric).
 *
 * @param {object} params
 * @param {Array<{tool:string, args?:object, opId?:string}>} params.toolCalls
 *   every tool call the run issued (only high-risk ones enter the denominator)
 * @param {Iterable<string>} [params.ledgerOpIds]  op-ids that got a ledger entry
 * @param {Iterable<string>} [params.tracedOpIds]  op-ids that got a trace span
 * @returns {{highRiskCount:number, ledgerCovered:number, traceCovered:number,
 *            ledgerCoverage:number, traceCoverage:number,
 *            uncoveredLedger:object[], uncoveredTrace:object[], ok:boolean}}
 */
export function computeSideEffectCoverage({
  toolCalls = [],
  ledgerOpIds = [],
  tracedOpIds = [],
} = {}) {
  const ledgerSet = new Set([...ledgerOpIds].map(String));
  const traceSet = new Set([...tracedOpIds].map(String));

  const highRisk = [];
  (Array.isArray(toolCalls) ? toolCalls : []).forEach((call, index) => {
    const cls = classifyToolSideEffect(call?.tool, call?.args || {});
    if (!cls) return; // not high-risk — excluded from the denominator
    const opId = call?.opId == null ? null : String(call.opId);
    highRisk.push({
      index,
      tool: String(call?.tool || ""),
      kind: cls.kind,
      opId,
      ledger: opId != null && ledgerSet.has(opId),
      traced: opId != null && traceSet.has(opId),
    });
  });

  const total = highRisk.length;
  const ledgerCovered = highRisk.filter((h) => h.ledger).length;
  const traceCovered = highRisk.filter((h) => h.traced).length;
  const pick = (h) => ({
    index: h.index,
    tool: h.tool,
    kind: h.kind,
    opId: h.opId,
  });

  return {
    highRiskCount: total,
    ledgerCovered,
    traceCovered,
    ledgerCoverage: ratio(ledgerCovered, total),
    traceCoverage: ratio(traceCovered, total),
    uncoveredLedger: highRisk.filter((h) => !h.ledger).map(pick),
    uncoveredTrace: highRisk.filter((h) => !h.traced).map(pick),
    ok: total === 0 ? true : ledgerCovered === total && traceCovered === total,
  };
}

/** An attribution is in the provenance denominator if it's externally sourced. */
function inProvenanceScope(attr) {
  return Boolean(attr?.source) || String(attr?.tier || "") === "extension";
}

/**
 * Plugin/MCP/Skill/Hook provenance traceability coverage (§11.3 metric). Only
 * externally-sourced (or extension-tier) calls enter the denominator; a built-in
 * mvp tool with no source is not part of this metric. An in-scope row is
 * traceable only when source + version + scope are all present AND a permission
 * decision was recorded (`admitted` is not null).
 *
 * @param {Array<object>} attributions  buildToolAttribution() records
 * @returns {{total:number, traceable:number, coverage:number,
 *            untraceable:Array<{index:number, tool:(string|null), missing:string[]}>,
 *            ok:boolean}}
 */
export function computeProvenanceCoverage(attributions = []) {
  const rows = [];
  (Array.isArray(attributions) ? attributions : []).forEach((attr, index) => {
    if (!inProvenanceScope(attr)) return;
    const missing = [];
    if (!attr?.source) missing.push("source");
    if (!attr?.version) missing.push("version");
    if (!attr?.scope) missing.push("scope");
    if (attr?.admitted == null) missing.push("permission");
    rows.push({
      index,
      tool: attr?.tool ?? null,
      traceable: missing.length === 0,
      missing,
    });
  });

  const total = rows.length;
  const traceable = rows.filter((r) => r.traceable).length;
  return {
    total,
    traceable,
    coverage: ratio(traceable, total),
    untraceable: rows.filter((r) => !r.traceable),
    ok: total === 0 ? true : traceable === total,
  };
}

/** Format a ratio in [0,1] as a whole-or-1-decimal percentage string. */
function pct(r) {
  const v = r * 100;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + "%";
}

/**
 * Combine both metrics into one report + a fail-closed `ok` (both must be 100%).
 *
 * @param {object} params
 * @param {Array} [params.toolCalls]
 * @param {Iterable<string>} [params.ledgerOpIds]
 * @param {Iterable<string>} [params.tracedOpIds]
 * @param {Array} [params.attributions]
 * @returns {{sideEffect:object, provenance:object, ok:boolean}}
 */
export function computeGovernanceCoverage({
  toolCalls = [],
  ledgerOpIds = [],
  tracedOpIds = [],
  attributions = [],
} = {}) {
  const sideEffect = computeSideEffectCoverage({
    toolCalls,
    ledgerOpIds,
    tracedOpIds,
  });
  const provenance = computeProvenanceCoverage(attributions);
  return { sideEffect, provenance, ok: sideEffect.ok && provenance.ok };
}

/** One-line, token-free summary of a governance coverage report. */
export function summarizeGovernanceCoverage(report) {
  const se = report?.sideEffect || {};
  const pr = report?.provenance || {};
  return (
    `high-risk ledger ${pct(se.ledgerCoverage ?? 1)} / trace ` +
    `${pct(se.traceCoverage ?? 1)} (${se.highRiskCount ?? 0} calls) · ` +
    `provenance ${pct(pr.coverage ?? 1)} (${pr.total ?? 0} sourced) · ` +
    `${report?.ok ? "OK" : "GAPS"}`
  );
}
