/**
 * Agent tool admission + attribution — the session-level gate behind P1-6
 * (Agent 内 Skills / MCP / Plugin 治理) of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md:
 *
 *   "Extension Tier 工具需经过 Capability、Policy、权限、预算和 UI 支持检查后再
 *    开放。每次 Tool/Skill 调用显示 Attribution。"
 *
 * [[plugin-runtime/capabilities.js]] decides whether a PLUGIN declared the
 * capabilities its components need (an install-time contract). It does NOT decide
 * whether an agent TOOL may be opened into a running session. MVP-tier tools
 * (read/write/shell/…) are the baseline set; extension-tier tools (run_skill,
 * spawn_sub_agent, browser, schedule, publish_artifact, MCP tools) reach further
 * and must clear five gates first — and every admitted call must be attributable.
 *
 * This module is that pure decision + the attribution record. Fail-closed and
 * EXHAUSTIVE (every unmet gate is collected, like [[pr-automation-policy.js]]):
 * an extension tool opens only when Capability, Policy, permission, budget and UI
 * support are ALL satisfied. An unknown tier is treated as extension — the
 * most-restrictive reading.
 *
 * PURE: no fs / clock / RNG / process. The caller passes the signals it already
 * gathered (capability grant, policy allow, permission grant, budget, UI
 * support) and reads back allow/deny + a log-safe attribution record.
 */

/** Tool tiers. MVP = baseline built-ins; EXTENSION = the gated, further-reaching set. */
export const TOOL_TIER = Object.freeze({
  MVP: "mvp",
  EXTENSION: "extension",
});

/** Normalize a tier label; anything unrecognized → EXTENSION (fail-closed). */
export function normalizeToolTier(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  if (s === "mvp" || s === "baseline" || s === "core") return TOOL_TIER.MVP;
  return TOOL_TIER.EXTENSION;
}

/**
 * Decide whether a tool may be admitted into the session. EXHAUSTIVE fail-closed.
 *
 * Extension-tier gates (all required): capability, policy, permission, budget,
 * ui-support. MVP-tier gates: policy + budget only (capability / UI support /
 * per-tool permission do not gate a built-in's ADMISSION — a built-in still
 * asks permission per call at execution time).
 *
 * @param {object} params
 * @param {string}  params.tool               tool name (for the record)
 * @param {string}  params.tier               "mvp" | "extension"
 * @param {boolean} params.capabilityGranted  plugin declared the capability
 * @param {boolean} params.policyAllowed      enterprise/allowlist policy permits it
 * @param {boolean} params.permissionGranted  session permission mode permits it
 * @param {boolean} params.budgetOk           the run's budget is not exhausted
 * @param {boolean} params.uiSupported        the current surface can render it
 * @returns {{admitted:boolean, unmet:string[], reason:string, tier:string}}
 */
export function admitTool(params = {}) {
  const tier = normalizeToolTier(params.tier);
  const unmet = [];

  // Policy + budget gate every tier.
  if (params.policyAllowed !== true) unmet.push("policy-blocked");
  if (params.budgetOk !== true) unmet.push("budget-exhausted");

  // Extension tier additionally requires capability, permission and UI support.
  if (tier === TOOL_TIER.EXTENSION) {
    if (params.capabilityGranted !== true) unmet.push("capability-not-granted");
    if (params.permissionGranted !== true) unmet.push("permission-not-granted");
    if (params.uiSupported !== true) unmet.push("ui-unsupported");
  }

  return {
    admitted: unmet.length === 0,
    unmet,
    reason: unmet.length === 0 ? "ok" : unmet[0],
    tier,
  };
}

/**
 * Build the log-safe attribution record shown per Tool/Skill call. Carries WHERE
 * a tool came from and WHETHER it was admitted — never a secret, arg value or
 * credential. `decision` is an admitTool() result (or omitted for a bare record).
 *
 * @param {object} params {tool, source, version, scope, tier, callId, decision}
 * @returns {object}
 */
export function buildToolAttribution(params = {}) {
  const decision = params.decision || null;
  const tier = normalizeToolTier(params.tier ?? decision?.tier);
  return {
    tool: params.tool == null ? null : String(params.tool),
    source: params.source == null ? null : String(params.source),
    version: params.version == null ? null : String(params.version),
    scope: params.scope == null ? null : String(params.scope),
    tier,
    callId: params.callId == null ? null : String(params.callId),
    admitted: decision ? decision.admitted === true : null,
    reason: decision ? decision.reason : null,
    unmet: decision && Array.isArray(decision.unmet) ? [...decision.unmet] : [],
  };
}

/**
 * A one-line, token-free attribution string for the transcript
 * (e.g. "run_skill ← acme-skills@1.2.0 (project) · extension · admitted").
 */
export function describeToolAttribution(attr = {}) {
  const parts = [String(attr.tool || "tool")];
  if (attr.source) {
    parts.push(
      `← ${attr.source}${attr.version ? `@${attr.version}` : ""}${
        attr.scope ? ` (${attr.scope})` : ""
      }`,
    );
  }
  parts.push(`· ${normalizeToolTier(attr.tier)}`);
  if (attr.admitted === true) parts.push("· admitted");
  else if (attr.admitted === false)
    parts.push(`· denied(${attr.reason || "policy"})`);
  return parts.join(" ");
}
