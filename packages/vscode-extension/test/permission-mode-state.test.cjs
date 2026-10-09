"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  acceptModeAcknowledgement,
} = require("../src/chat/permission-mode-state");

function pendingConversation() {
  return {
    sessionId: "session-current",
    modeRequestId: "request-current",
    mode: "auto",
    effectiveMode: "default",
    modeStatus: "pending",
    policyRevision: "a".repeat(16),
    modeError: "awaiting acknowledgement",
  };
}

function acknowledgement(sessionId) {
  return {
    session_id: sessionId,
    permission_mode_state: {
      correlation_id: "request-current",
      requested: "auto",
      effective: "auto",
      policy_revision: "b".repeat(16),
    },
  };
}

test("rejects a foreign-session ACK even when request and mode match", () => {
  const conv = pendingConversation();
  const before = { ...conv };

  assert.equal(
    acceptModeAcknowledgement(conv, acknowledgement("session-foreign")),
    false,
  );
  assert.deepEqual(conv, before);
});

test("accepts the same ACK when it belongs to the current session", () => {
  const conv = pendingConversation();

  assert.equal(
    acceptModeAcknowledgement(conv, acknowledgement("session-current")),
    true,
  );
  assert.equal(conv.effectiveMode, "auto");
  assert.equal(conv.modeStatus, "effective");
  assert.equal(conv.policyRevision, "b".repeat(16));
  assert.equal(conv.modeError, "");
});
