/**
 * Build the additive, protocol-safe PermissionDecision attached to a gated
 * tool result. The runtime remains the authority; IDEs and SDKs only render
 * this explanation and must never re-evaluate it.
 *
 * The source result can contain user-controlled rules/reasons. Keep the wire
 * object bounded and run every text field through the export-grade secret
 * redactor before it reaches transcripts, ledgers, or IDE logs.
 */

import { redactSecrets } from "./secret-scan.js";

export const PERMISSION_DECISION_VERSION = 1;

const MAX_TEXT = 512;
const MAX_CHAIN = 8;

function boundedText(value, max = MAX_TEXT) {
  if (value == null) return null;
  let text;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (typeof text !== "string") text = String(value);
  text = redactSecrets(text);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeChain(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CHAIN).map((entry) => {
    const row = entry && typeof entry === "object" ? entry : {};
    return {
      layer: boundedText(row.layer, 80),
      outcome: boundedText(row.outcome, 80),
      via: boundedText(row.via || row.source, 120),
      rule: boundedText(row.rule, 256),
      reason: boundedText(row.reason),
    };
  });
}

/**
 * @param {{
 *   toolUseId?: string,
 *   tool?: string,
 *   result?: object,
 * }} input
 * @returns {object|null}
 */
export function buildPermissionDecision(input = {}) {
  const result =
    input.result && typeof input.result === "object" ? input.result : {};
  const policy =
    result.policy && typeof result.policy === "object" ? result.policy : {};
  const approval =
    result.approval && typeof result.approval === "object"
      ? result.approval
      : {};
  const chain = normalizeChain(result.permissionChain);
  const terminal = chain.length > 0 ? chain[chain.length - 1] : {};

  const decision = boundedText(
    policy.decision || approval.decision || terminal.outcome,
    32,
  );
  if (!decision && chain.length === 0) return null;

  const via = boundedText(
    policy.via || approval.via || terminal.via || terminal.layer,
    120,
  );
  const rule = boundedText(policy.rule || approval.rule || terminal.rule, 256);
  const reason = boundedText(
    policy.reason ||
      approval.reason ||
      terminal.reason ||
      result.shellCommandPolicy?.reason,
  );
  const toolUseId = boundedText(input.toolUseId, 160);
  const gate = via || decision || "policy";

  return {
    version: PERMISSION_DECISION_VERSION,
    id: toolUseId ? `${toolUseId}:perm:${gate}` : null,
    tool: boundedText(input.tool, 120),
    decision,
    via,
    rule,
    reason,
    chain,
  };
}
