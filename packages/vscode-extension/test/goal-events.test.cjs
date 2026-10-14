const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  mapAgentEvent,
  createTurnState,
} = require("../src/chat/chat-events.js");
test("goal verification remains distinct from completion and budget stops", () => {
  const state = createTurnState();
  assert.equal(
    mapAgentEvent({ type: "goal_started" }, state).goalStatus,
    "running",
  );
  const pending = mapAgentEvent(
    { type: "goal_evaluated", met: false, reason: "tests failing" },
    state,
  );
  assert.equal(pending.verificationPassed, false);
  assert.match(pending.text, /pending.*tests failing/);
  assert.equal(
    mapAgentEvent({ type: "goal_evaluated", met: true }, state).goalStatus,
    "checking",
  );
  assert.equal(
    mapAgentEvent({ type: "goal_completed" }, state).goalStatus,
    "completed",
  );
  const exhausted = mapAgentEvent({ type: "goal_exhausted" }, state);
  assert.equal(exhausted.goalStatus, "incomplete");
  assert.equal(exhausted.verificationPassed, false);
  assert.match(exhausted.text, /incomplete/);
});
test("goal events preserve text-stream state and bound diagnostic text", () => {
  const state = { sawDelta: true };
  assert.ok(
    mapAgentEvent({ type: "goal_evaluated", reason: "a".repeat(2000) }, state)
      .text.length < 1100,
  );
  assert.equal(state.sawDelta, true);
  assert.equal(
    mapAgentEvent({ type: "goal_not_a_protocol_event" }, state),
    null,
  );
});
