"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ChatViewProvider } = require("../src/chat/chat-view");

function makeSubmission() {
  const writes = [];
  const settlements = [];
  const posts = [];
  const stops = [];
  const provider = new ChatViewProvider(
    {},
    {
      deps: {
        draftStore: {
          prepare: async (_key, sessionId) => ({ sessionId, paths: [] }),
          settle: async (_key, _id, state) => settlements.push(state),
        },
      },
    },
  );
  provider._post = (message) => posts.push(message);
  provider._persistTabs = async () => {};
  provider._restoreDraft = async () => {};
  provider._updateModeStatus = () => {};
  const conv = provider._activeConv();
  conv.title = "Existing conversation";
  conv._sessionToken = {};
  const session = {
    running: true,
    sendEvent: (event) => {
      writes.push(event);
      return true;
    },
    stopAndWait: () => {
      stops.push(session);
      session.running = false;
      return Promise.resolve();
    },
  };
  provider._convs.setSession(conv.id, session);
  provider._ensureSession = () => session;
  const onEvent = provider._makeOnEvent(conv.id, conv._sessionToken);
  const send = () =>
    provider._sendDurableMessage(
      { text: "Who are you?", clientMessageId: "msg-1" },
      conv,
    );
  return { conv, onEvent, posts, provider, send, settlements, stops, writes };
}

async function waitForInitWaiter(conv) {
  for (let i = 0; i < 20 && !conv.inputInitWaiters?.size; i++)
    await Promise.resolve();
  assert.equal(conv.inputInitWaiters?.size, 1);
}

test("doctor observes the active child and discards stale generation capabilities", () => {
  const { conv, onEvent, provider, writes } = makeSubmission();
  assert.equal(provider.runtimeDiagnostics().state, "initializing");
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  assert.equal(provider.runtimeDiagnostics().inputReceipts, true);
  assert.equal(
    provider.runtimeDiagnostics().permissionMode.status,
    "unconfirmed",
  );
  conv._sessionToken = {};
  conv.inputReceiptVersion = undefined;
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  assert.equal(provider.runtimeDiagnostics().inputReceipts, null);
  conv.session.running = false;
  assert.equal(provider.runtimeDiagnostics().state, "not-started");
  assert.deepEqual(writes, []);
});

test("a cold agent can initialize after the former 15-second limit and dispatch once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { conv, onEvent, send, settlements, writes } = makeSubmission();
  const submission = send();
  await waitForInitWaiter(conv);
  t.mock.timers.tick(30_000);
  assert.deepEqual(writes, []);
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  assert.equal(await submission, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].client_message_id, "msg-1");
  assert.deepEqual(settlements, ["unknown"]);
});

test("an initialization failure before waiter registration rejects saved input immediately", async () => {
  const { conv, onEvent, posts, send, settlements, writes } = makeSubmission();
  onEvent({ type: "session_error", error: "spawn failed" });
  assert.equal(await send(), false);
  assert.deepEqual(writes, []);
  assert.deepEqual(settlements, ["rejected"]);
  assert.ok(
    posts.some(
      (message) =>
        message.kind === "submissionFailed" &&
        /failed to initialize/.test(message.text),
    ),
  );
  assert.equal(conv.inputInitWaiters?.size || 0, 0);
});

test("init timeout keeps the draft and a late init never dispatches it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { conv, onEvent, posts, send, settlements, stops, writes } =
    makeSubmission();
  const submission = send();
  await waitForInitWaiter(conv);
  t.mock.timers.tick(120_000);
  assert.equal(await submission, false);
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  assert.deepEqual(writes, []);
  assert.deepEqual(settlements, ["rejected"]);
  assert.equal(stops.length, 1);
  assert.equal(conv.session, null);
  assert.equal(conv.stoppingSession, null);
  assert.ok(
    posts.some(
      (message) =>
        message.kind === "submissionFailed" && /timed out/.test(message.text),
    ),
  );
});

test("a resend after init timeout starts a new child and only sends after its init", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { conv, onEvent, provider, send, stops, writes } = makeSubmission();
  const first = send();
  await waitForInitWaiter(conv);
  t.mock.timers.tick(120_000);
  assert.equal(await first, false);
  assert.equal(stops.length, 1);
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });

  const replacementToken = {};
  const replacement = {
    running: true,
    sendEvent: (event) => {
      writes.push(event);
      return true;
    },
    stopAndWait: () => Promise.resolve(),
  };
  provider._ensureSession = () => {
    conv._sessionToken = replacementToken;
    provider._convs.setSession(conv.id, replacement);
    return replacement;
  };
  const second = send();
  await waitForInitWaiter(conv);
  assert.deepEqual(writes, []);
  provider._makeOnEvent(
    conv.id,
    replacementToken,
  )({
    type: "system",
    subtype: "init",
    input_receipts: { version: 1 },
  });
  assert.equal(await second, true);
  assert.equal(writes.length, 1);
});
