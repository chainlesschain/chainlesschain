const MODES = new Set([
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "dontAsk",
  "plan",
]);

function modeState(conv) {
  return {
    requested: conv.mode || "default",
    effective: conv.effectiveMode || null,
    status: conv.modeStatus || "pending",
    policyRevision: conv.policyRevision || null,
    reason: conv.modeError || "",
  };
}

/** ACK is display evidence, never a replacement for the CLI permission gate. */
function acceptModeAcknowledgement(conv, event) {
  const ack = event?.permission_mode_state;
  if (
    ack &&
    (ack.correlation_id !== conv.modeRequestId ||
      false)
  )
    return false;
  if (
    !ack ||
    ack.correlation_id !== conv.modeRequestId ||
    ack.requested !== conv.mode ||
    !MODES.has(ack.effective) ||
    typeof ack.policy_revision !== "string" ||
    !/^[a-f0-9]{16,64}$/.test(ack.policy_revision)
  ) {
    conv.modeStatus = "unconfirmed";
    conv.modeError =
      "The CLI has not confirmed its effective approval mode. Update the CLI if needed.";
    return false;
  }
  conv.effectiveMode = ack.effective;
  conv.policyRevision = ack.policy_revision;
  conv.modeStatus = "effective";
  conv.modeError = "";
  return true;
}

module.exports = { modeState, acceptModeAcknowledgement };
