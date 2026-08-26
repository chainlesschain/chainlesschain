"use strict";

const {
  validateApprovalDecision,
} = require("../vendor/agent-sdk/generated/app-protocol.js");

const APPROVAL_DECISION_KINDS = new Set([
  "acceptOnce",
  "acceptForTurn",
  "acceptForSession",
  "decline",
  "cancel",
]);

function trustedPermissions(request) {
  if (!Array.isArray(request?.permissions)) return [];
  return request.permissions
    .filter(
      (permission) =>
        permission &&
        typeof permission === "object" &&
        !Array.isArray(permission) &&
        typeof permission.capability === "string" &&
        permission.capability.length > 0 &&
        permission.capability.length <= 128 &&
        typeof permission.scope === "string" &&
        permission.scope.length > 0 &&
        permission.scope.length <= 1024 &&
        (permission.expiresAt == null ||
          (typeof permission.expiresAt === "string" &&
            !Number.isNaN(Date.parse(permission.expiresAt)))),
    )
    .slice(0, 64)
    .map((permission) => ({
      capability: permission.capability,
      scope: permission.scope,
      ...(permission.expiresAt ? { expiresAt: permission.expiresAt } : {}),
    }));
}

/**
 * Convert a Webview or native approval action into the canonical protocol
 * decision. Request bindings and scoped permissions always come from the
 * extension-host copy of the pending CLI event; the Webview cannot widen them.
 */
function buildApprovalResponse(message, request = null) {
  const id = String(message?.id || "");
  if (!id || (request?.id && String(request.id) !== id)) {
    throw new TypeError("Approval response does not match a pending request");
  }
  if (
    request?.binding &&
    message?.binding &&
    request.binding !== message.binding
  ) {
    throw new TypeError("Approval response binding does not match the request");
  }

  const requestedKind =
    typeof message?.decisionKind === "string" &&
    APPROVAL_DECISION_KINDS.has(message.decisionKind)
      ? message.decisionKind
      : message?.approve === true
        ? "acceptOnce"
        : "decline";
  const permissions = trustedPermissions(request);
  const decision =
    requestedKind === "acceptForTurn" || requestedKind === "acceptForSession"
      ? { kind: requestedKind, permissions }
      : requestedKind === "decline"
        ? { kind: "decline" }
        : { kind: requestedKind };
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
    id,
    decision,
    // Retain the compatibility bit while older CLI versions are supported.
    approve: ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
      decision.kind,
    ),
    ...(typeof request?.binding === "string" && request.binding
      ? { binding: request.binding }
      : {}),
  };
}

module.exports = { buildApprovalResponse };
