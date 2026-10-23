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

test("a failed durable pipe write remains unknown and is not reported as dispatched", async () => {
  const { conv, onEvent, posts, send, settlements, writes } = makeSubmission();
  conv.session.sendEvent = () => false;
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  assert.equal(await send(), false);
  assert.deepEqual(writes, []);
  assert.deepEqual(settlements, ["unknown"]);
  assert.equal(
    posts.some((message) => message.kind === "submissionDispatched"),
    false,
  );
  assert.ok(
    posts.some((message) => /Input delivery is unknown/.test(message.text)),
  );
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

test("a failed live child is stopped before a retry starts a new child", async () => {
  let stops = 0;
  let starts = 0;
  const oldSession = {
    running: true,
    stopAndWait: () => {
      stops++;
      oldSession.running = false;
      return Promise.resolve();
    },
  };
  const replacement = { running: true, sendEvent: () => true };
  const provider = new ChatViewProvider(
    {
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
        workspaceFolders: [],
      },
    },
    {
      deps: {
        createSession: () => {
          starts++;
          return replacement;
        },
        resolveChatLlm: () => ({}),
      },
    },
  );
  provider._cliCommand = () => "cc";
  provider._indexConversation = () => {};
  provider._post = () => {};
  provider._postFrom = () => {};
  provider._updateModeStatus = () => {};
  const conv = provider._activeConv();
  conv.sessionId = "panel-retry";
  conv.inputInitError = new Error("provider credentials were rejected");
  conv.inputInitErrorReported = true;
  provider._convs.setSession(conv.id, oldSession);

  assert.equal(provider._ensureSession(conv).running, false);
  assert.equal(stops, 1);
  assert.equal(starts, 0);
  await Promise.resolve();
  assert.equal(provider._ensureSession(conv), replacement);
  assert.equal(starts, 1);
  assert.equal(conv.inputInitError, null);
});

test("one explicit resend waits for failed child exit and replacement init", async () => {
  const { conv, onEvent, provider, send, writes } = makeSubmission();
  const failed = conv.session;
  let stops = 0;
  failed.stopAndWait = () => {
    stops++;
    failed.running = false;
    return Promise.resolve();
  };
  onEvent({ type: "result", is_error: true, error: "HTTP 401 unauthorized" });
  assert.equal(await send(), false);
  assert.equal(stops, 0);
  assert.deepEqual(writes, []);
  let replacementEvent;
  provider._ensureSession = () => {
    const token = {};
    const replacement = {
      running: true,
      sendEvent: (event) => {
        writes.push(event);
        return true;
      },
    };
    conv._sessionToken = token;
    conv.inputReceiptVersion = undefined;
    conv.inputInitError = null;
    provider._convs.setSession(conv.id, replacement);
    replacementEvent = provider._makeOnEvent(conv.id, token);
    return replacement;
  };

  const retry = send();
  await waitForInitWaiter(conv);
  assert.equal(stops, 1);
  assert.deepEqual(writes, []);
  replacementEvent({
    type: "system",
    subtype: "init",
    input_receipts: { version: 1 },
  });
  assert.equal(await retry, true);
  assert.equal(writes.length, 1);
});

test("a retry keeps its draft when failed child termination is unconfirmed", async () => {
  const { conv, onEvent, provider, send, writes } = makeSubmission();
  onEvent({ type: "result", is_error: true, error: "HTTP 401 unauthorized" });
  assert.equal(await send(), false);
  conv.session.stopAndWait = () => Promise.reject(new Error("kill failed"));
  let starts = 0;
  provider._ensureSession = () => {
    starts++;
    return { running: true, sendEvent: () => true };
  };

  assert.equal(await send(), false);
  assert.equal(starts, 0);
  assert.deepEqual(writes, []);
  assert.equal(conv.stoppingSession.status, "failed");
});

for (const { label, event, expected } of [
  {
    label: "missing CLI process",
    event: { type: "session_error", error: "spawn cc ENOENT" },
    expected: /process could not start; check the CLI installation and Doctor/,
  },
  {
    label: "rejected provider credentials",
    event: { type: "result", is_error: true, error: "HTTP 401 unauthorized" },
    expected: /provider credentials were rejected/,
  },
  {
    label: "unsupported provider endpoint",
    event: {
      type: "result",
      is_error: true,
      error: "provider endpoint not supported",
    },
    expected: /provider endpoint or model is unavailable/,
  },
]) {
  test(`startup reports ${label} without dispatching the saved input`, async () => {
    const { onEvent, posts, provider, send, writes } = makeSubmission();
    onEvent(event);
    assert.equal(provider.runtimeDiagnostics().state, "failed");
    assert.equal(await send(), false);
    assert.deepEqual(writes, []);
    assert.ok(
      posts.some(
        (message) =>
          message.kind === "submissionFailed" && expected.test(message.text),
      ),
    );
  });
}

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
