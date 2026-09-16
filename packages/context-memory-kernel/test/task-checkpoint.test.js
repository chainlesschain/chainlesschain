"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ContextMemoryKernel,
  createTaskCheckpoint,
  verifyTaskCheckpoint,
} = require("../lib/index.js");
const state = {
  version: 1,
  sessionId: "task-1",
  workspace: "workspace",
  events: [],
  requests: ["fix"],
};

test("task checkpoints preserve session scope, untrusted evidence and digest", () => {
  const value = createTaskCheckpoint({ sessionId: "task-1", state });
  assert.equal(value.scope, "session");
  assert.equal(value.trust, "untrusted");
  assert.equal(verifyTaskCheckpoint(value, "task-1").revision, 1);
  assert.throws(() =>
    verifyTaskCheckpoint({ ...value, trust: "host" }, "task-1"),
  );
  assert.throws(() =>
    verifyTaskCheckpoint(
      { ...value, state: { ...state, requests: ["forged"] } },
      "task-1",
    ),
  );
  assert.throws(() => verifyTaskCheckpoint(value, "task-2"));
});

test("shadow mode never mutates a task checkpoint, canonical settlement checks revisions", () => {
  let calls = 0;
  const port = {
    commitTaskCheckpoint(value, expectedRevision) {
      calls++;
      return { ok: expectedRevision === 0 };
    },
  };
  const shadow = new ContextMemoryKernel({ mode: "shadow", sessionPort: port });
  assert.throws(() =>
    shadow.checkpointTaskProgress({ sessionId: "task-1", state }),
  );
  assert.equal(calls, 0);
  const kernel = new ContextMemoryKernel({ sessionPort: port });
  assert.equal(
    kernel.checkpointTaskProgress({ sessionId: "task-1", state }).checkpoint
      .revision,
    1,
  );
  assert.throws(() =>
    kernel.checkpointTaskProgress({
      sessionId: "task-1",
      state,
      expectedRevision: 1,
    }),
  );
});
