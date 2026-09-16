"use strict";

const { canonicalDigest, cloneCanonical } = require("./canonical.js");
const { invalidArgument } = require("./errors.js");

const TASK_CHECKPOINT_SCHEMA = "chainlesschain.task-checkpoint/v1";

// Task progress is session-scoped context, not an automatically promoted memory.
// Hosts may project it to Markdown but only the session port owns its revision.
function createTaskCheckpoint({ sessionId, expectedRevision = 0, state }) {
  if (
    typeof sessionId !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sessionId) ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision >= Number.MAX_SAFE_INTEGER ||
    state?.sessionId !== sessionId ||
    state?.version !== 1 ||
    typeof state.workspace !== "string" ||
    !Array.isArray(state.events) ||
    state.events.length > 24 ||
    !Array.isArray(state.requests) ||
    state.requests.length > 4 ||
    Buffer.byteLength(JSON.stringify(state)) > 32768
  )
    throw invalidArgument("Invalid bounded task checkpoint");
  const checkpoint = {
    schema: TASK_CHECKPOINT_SCHEMA,
    sessionId,
    revision: expectedRevision + 1,
    scope: "session",
    trust: "untrusted",
    state: cloneCanonical(state),
  };
  checkpoint.digest = canonicalDigest(checkpoint, TASK_CHECKPOINT_SCHEMA);
  return checkpoint;
}

function verifyTaskCheckpoint(checkpoint, sessionId) {
  if (
    checkpoint?.schema !== TASK_CHECKPOINT_SCHEMA ||
    checkpoint.sessionId !== sessionId
  )
    throw invalidArgument("Task checkpoint identity mismatch");
  const normalized = createTaskCheckpoint({
    sessionId,
    expectedRevision: checkpoint.revision - 1,
    state: checkpoint.state,
  });
  const { digest, ...unsigned } = checkpoint;
  if (
    normalized.digest !== digest ||
    canonicalDigest(unsigned, TASK_CHECKPOINT_SCHEMA) !== digest
  )
    throw invalidArgument("Task checkpoint digest mismatch");
  return normalized;
}

module.exports = {
  TASK_CHECKPOINT_SCHEMA,
  createTaskCheckpoint,
  verifyTaskCheckpoint,
};
