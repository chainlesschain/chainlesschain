"use strict";

const {
  validateApprovalDecision,
} = require("../vendor/agent-sdk/generated/app-protocol.js");

/**
 * Convert the webview's binary approval control into the canonical protocol
 * decision. The webview is deliberately not allowed to request turn/session
 * permission grants; those require a separately reviewed native control.
 */
function buildApprovalResponse(message) {
  const approve = message?.approve === true;
  const decision = approve ? { kind: "acceptOnce" } : { kind: "decline" };
  const validation = validateApprovalDecision(decision);
  if (!validation.ok) {
    throw new TypeError(
      `Invalid ApprovalDecision: ${validation.errors
        .map((error) => `${error.path} ${error.message}`)
        .join("; ")}`,
    );
  }

  return {
    type: "approval",
    id: String(message?.id || ""),
    decision,
    // Retain the compatibility bit while older CLI versions are supported.
    approve,
    ...(typeof message?.binding === "string" && message.binding
      ? { binding: message.binding }
      : {}),
  };
}

module.exports = { buildApprovalResponse };
