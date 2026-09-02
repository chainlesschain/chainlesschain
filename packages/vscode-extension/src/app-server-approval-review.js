"use strict";

const MAX_REVIEW_BYTES = 64 * 1024;

function decline(reason) {
  return { kind: "decline", reason };
}

function reviewDocument(request) {
  try {
    const content = JSON.stringify(
      {
        id: request.id,
        risk: request.risk,
        reason: request.reason,
        binding: request.binding,
        requestedPermissions: request.requestedPermissions || [],
        operation: request.operation,
      },
      null,
      2,
    );
    if (Buffer.byteLength(content, "utf8") > MAX_REVIEW_BYTES) return null;
    return content;
  } catch {
    return null;
  }
}

async function reviewAppServerApproval(vscodeApi, request, options = {}) {
  const now = options.now || Date.now;
  const binding = request?.binding;
  if (
    !request ||
    typeof request !== "object" ||
    !binding ||
    typeof binding !== "object" ||
    typeof request.id !== "string" ||
    typeof binding.operationDigest !== "string" ||
    typeof binding.policyDigest !== "string" ||
    typeof binding.nonce !== "string" ||
    !Number.isFinite(Date.parse(binding.expiresAt))
  ) {
    return decline("VS Code received an invalid App Server approval binding");
  }
  if (Date.parse(binding.expiresAt) <= now()) {
    return decline("VS Code received an expired App Server approval request");
  }
  const detail = reviewDocument(request);
  if (detail === null) {
    return decline(
      "App Server approval is too large to review safely in VS Code",
    );
  }
  const approveOnce = "Approve once";
  const approveForTurn = "Approve for turn";
  const declineAction = "Decline";
  const actions = [approveOnce];
  if (request.requestedPermissions?.length) actions.push(approveForTurn);
  actions.push(declineAction);
  const selected = await vscodeApi.window.showWarningMessage(
    `CC App Server requests a ${request.risk || "controlled"} operation`,
    {
      modal: true,
      detail,
    },
    ...actions,
  );
  if (Date.parse(binding.expiresAt) <= now()) {
    return decline("App Server approval expired during VS Code review");
  }
  if (selected === approveOnce) return { kind: "acceptOnce" };
  if (selected === approveForTurn && request.requestedPermissions?.length) {
    return {
      kind: "acceptForTurn",
      permissions: JSON.parse(JSON.stringify(request.requestedPermissions)),
    };
  }
  return decline("VS Code reviewer declined the App Server operation");
}

module.exports = {
  MAX_REVIEW_BYTES,
  reviewAppServerApproval,
};
