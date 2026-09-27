"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NativeQuestionLifecycle,
} = require("../src/app-server-question-lifecycle");
const binding = {
  backgroundAgentId: null,
  sessionId: "thread",
  turnId: "turn",
  toolUseId: "tool",
  sequence: 1,
};
const request = {
  id: "q1",
  threadId: "thread",
  turnId: "turn",
  binding,
  question: "Color?",
};

test("native callback values await matching server resolution and duplicate requests cannot reopen authority", async () => {
  let called = 0;
  const lifecycle = new NativeQuestionLifecycle({
    answer: async () => {
      called++;
      return "blue";
    },
  });
  const owner = {};
  try {
    assert.equal(await lifecycle.review(owner, request), "blue");
    assert.equal(lifecycle.status[0].state, "awaiting");
    lifecycle.notification(
      {},
      {
        method: "question/resolved",
        params: { threadId: "thread", turnId: "turn", questionId: "q1" },
      },
    );
    lifecycle.notification(owner, {
      method: "question/resolved",
      params: { threadId: "other", turnId: "turn", questionId: "q1" },
    });
    assert.equal(lifecycle.status[0].state, "awaiting");
    lifecycle.notification(owner, {
      method: "question/resolved",
      params: {
        threadId: "thread",
        turnId: "turn",
        questionId: "q1",
        via: "user-answer",
      },
    });
    assert.equal(lifecycle.status[0].state, "resolved");
    assert.equal(await lifecycle.review(owner, request), null);
    assert.equal(called, 1);
  } finally {
    lifecycle.close(owner);
  }
});

test("owner exit revokes an open callback even when its handler ignores cancellation", async () => {
  let release, signal;
  const lifecycle = new NativeQuestionLifecycle({
    answer: (_request, context) => {
      signal = context.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const owner = {};
  const pending = lifecycle.review(owner, request);
  await Promise.resolve();
  lifecycle.close(owner);
  assert.equal(signal.aborted, true);
  release("late");
  assert.equal(await pending, null);
  assert.equal(lifecycle.status[0].state, "unknown");
  lifecycle.notification(owner, {
    method: "question/resolved",
    params: {
      threadId: "thread",
      turnId: "turn",
      questionId: "q1",
      via: "user-answer",
    },
  });
  assert.equal(
    lifecycle.status[0].state,
    "resolved",
    "late authoritative evidence can settle unknown delivery",
  );
});

test("turn completion archives blocking reviews, retains deferred reviews, and interrupt revokes both", async () => {
  const callbacks = [];
  const lifecycle = new NativeQuestionLifecycle({
    answer: (req, { signal }) =>
      new Promise((resolve) => {
        callbacks.push({ req, signal });
        signal.addEventListener("abort", () => resolve(null));
      }),
  });
  const owner = {};
  const blocking = lifecycle.review(owner, request);
  const deferred = lifecycle.review(owner, {
    ...request,
    id: "later",
    mode: "deferred",
    blocking: false,
  });
  await Promise.resolve();
  lifecycle.notification(owner, {
    method: "turn/completed",
    params: { turn: { id: "turn", threadId: "thread" } },
  });
  assert.equal(callbacks[0].signal.aborted, true);
  assert.equal(callbacks[1].signal.aborted, false);
  lifecycle.interrupt(owner, { threadId: "thread", turnId: "turn" });
  assert.equal(callbacks[1].signal.aborted, true);
  assert.deepEqual(await Promise.all([blocking, deferred]), [null, null]);
});

test("expired and reused question identities cannot be reported as confirmed", async () => {
  let called = 0;
  const lifecycle = new NativeQuestionLifecycle({
    answer: async () => {
      called++;
      return "value";
    },
  });
  const owner = {};
  try {
    assert.equal(
      await lifecycle.review(owner, {
        ...request,
        expiresAt: new Date(0).toISOString(),
      }),
      null,
    );
    assert.equal(called, 0);
    assert.equal(
      await lifecycle.review(owner, { ...request, question: "Changed schema" }),
      "value",
    );
    lifecycle.notification(owner, {
      method: "question/resolved",
      params: { threadId: "thread", turnId: "turn", questionId: "q1" },
    });
    assert.ok(lifecycle.status.every((s) => s.state === "unknown"));
  } finally {
    lifecycle.close(owner);
  }
});

test("duplicate live requests share one review and request objects are detached before the callback", async () => {
  let release,
    seen,
    calls = 0;
  const lifecycle = new NativeQuestionLifecycle({
    answer: (req) => {
      calls++;
      seen = req;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const owner = {};
  const source = JSON.parse(JSON.stringify(request));
  try {
    const first = lifecycle.review(owner, source);
    const second = lifecycle.review(owner, source);
    source.binding.turnId = "mutated";
    source.question = "mutated";
    await Promise.resolve();
    assert.equal(seen.binding.turnId, "turn");
    assert.equal(seen.question, "Color?");
    assert.equal(calls, 1);
    release("blue");
    assert.deepEqual(await Promise.all([first, second]), ["blue", "blue"]);
  } finally {
    lifecycle.close(owner);
  }
});

test("MCP presentation and password changes invalidate an already open native review", async () => {
  const signals = [];
  const lifecycle = new NativeQuestionLifecycle({
    answer: (_request, { signal }) =>
      new Promise((resolve) => {
        signals.push(signal);
        signal.addEventListener("abort", () => resolve(null));
      }),
  });
  const owner = {};
  const original = lifecycle.review(owner, {
    ...request,
    mode: "blocking",
    metadata: { kind: "mcp_elicitation", mode: "form" },
  });
  await Promise.resolve();
  const replacement = lifecycle.review(owner, {
    ...request,
    mode: "blocking",
    metadata: { kind: "mcp_elicitation", mode: "url" },
  });
  await Promise.resolve();
  assert.equal(signals[0].aborted, true);
  const sensitive = lifecycle.review(owner, { ...request, password: true });
  await Promise.resolve();
  assert.equal(signals[1].aborted, true);
  lifecycle.close(owner);
  assert.deepEqual(await Promise.all([original, replacement, sensitive]), [
    null,
    null,
    null,
  ]);
});
