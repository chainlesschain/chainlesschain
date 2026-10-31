"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ChatViewProvider } = require("../src/chat/chat-view");

function makeConfigurationProbe(probe) {
  const posts = [];
  const provider = new ChatViewProvider(
    {},
    { deps: { getLlmConfigurationState: probe } },
  );
  provider.view = {};
  provider._cliCommand = () => "cc";
  provider._post = (message) => posts.push(message);
  return { provider, posts };
}

test("first-run onboarding distinguishes an unset provider from unreadable configuration", async () => {
  for (const status of ["configured", "unconfigured", "unavailable"]) {
    const { provider, posts } = makeConfigurationProbe(async () => ({
      status,
    }));
    await provider._probeLlmConfiguration(provider.view);
    assert.equal(
      posts.some((message) => message.kind === "setup"),
      status === "unconfigured",
    );
    if (status === "unavailable") {
      assert.equal(posts.length, 1);
      assert.equal(posts[0].kind, "info");
      assert.match(posts[0].text, /could not be read/i);
    }
    if (status === "configured") assert.equal(posts.length, 0);
  }
});

test("a failed config probe reports fixed guidance without leaking its diagnostic", async () => {
  const { provider, posts } = makeConfigurationProbe(async () => {
    throw new Error("private-key /profile/config.json");
  });
  await provider._probeLlmConfiguration(provider.view);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, "info");
  assert.ok(!JSON.stringify(posts).includes("private-key"));
  assert.ok(!JSON.stringify(posts).includes("/profile"));
});

test("a view closing during onboarding delivery cannot reject panel initialization", async () => {
  const { provider } = makeConfigurationProbe(async () => ({
    status: "unconfigured",
  }));
  provider._post = () => {
    throw new Error("webview was disposed");
  };
  await assert.doesNotReject(provider._probeLlmConfiguration(provider.view));
});

test("late onboarding results are ignored after the view or connection changes", async () => {
  for (const change of ["replace", "dispose", "configure"]) {
    let settle;
    const { provider, posts } = makeConfigurationProbe(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const pending = provider._probeLlmConfiguration(provider.view);
    if (change === "replace") provider.view = {};
    if (change === "dispose") provider.view = null;
    if (change === "configure") provider._reloadLlmConfig();
    settle({ status: "unconfigured" });
    await pending;
    assert.ok(!posts.some((message) => message.kind === "setup"));
  }
});

test("global connection changes report every affected running conversation", () => {
  const { provider, posts } = makeConfigurationProbe(async () => ({
    status: "configured",
  }));
  const first = provider._activeConv();
  const second = provider._convs.create({});
  provider._convs.setSession(first.id, { running: true });
  provider._convs.setSession(second.id, { running: true });
  const stopped = [];
  provider._stopSession = (conversation) => stopped.push(conversation.id);
  provider._reloadLlmConfig();
  assert.deepEqual(new Set(stopped), new Set([first.id, second.id]));
  assert.match(posts.at(-1).text, /2 running conversations/);
});

function makeModelConversations(saved = new Map()) {
  const records = [],
    posts = [],
    contextCalls = [];
  const opts = {
    state: {
      get: (key) => saved.get(key),
      update: (key, value) => saved.set(key, value),
    },
    deps: {
      resolveChatLlm: ({ model } = {}) => ({
        provider: "openai",
        model: model || "configured-model",
        baseUrl: "https://relay.example/v1",
        apiKey: "",
      }),
      draftStore: {
        prepare: async (_key, sessionId) => ({ sessionId, paths: [] }),
        settle: async () => {},
      },
      runCliText: async ({ args }) => {
        contextCalls.push(args);
        return JSON.stringify({ contextWindow: 200000, totalTokens: 10 });
      },
      createSession: (options) => {
        const record = { options, stops: 0, sent: [] };
        const session = {
          running: true,
          sendEvent: (event) => {
            record.sent.push(event);
            return true;
          },
          stopAndWait: async () => {
            record.stops++;
            session.running = false;
          },
        };
        record.session = session;
        records.push(record);
        queueMicrotask(() =>
          options.onEvent({
            type: "system",
            subtype: "init",
            session_id: options.args[options.args.indexOf("--resume") + 1],
            input_receipts: { version: 1 },
          }),
        );
        return session;
      },
    },
  };
  const provider = new ChatViewProvider(
    {
      commands: { executeCommand() {} },
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
        workspaceFolders: [],
      },
    },
    opts,
  );
  provider._post = (message) => posts.push(message);
  provider._updateModeStatus = () => {};
  provider._restoreDraft = async () => {};
  provider._restoreTranscript = () => {};
  provider._cliCommand = () => "cc";
  return { provider, records, posts, saved, contextCalls };
}

test("a conversation model switch preserves running work and restarts only its idle child", async () => {
  const { provider, records } = makeModelConversations();
  const a = provider._activeConv();
  const b = provider._convs.create({});
  const oldA = provider._ensureSession(a);
  const oldB = provider._ensureSession(b);
  a.turnActive = true;
  provider._convs.switchTo(a.id);
  provider._handleMessage({ type: "sessionModel", spec: "team/custom-alias" });
  assert.equal(provider._ensureSession(a), oldA);
  assert.equal(records[0].stops, 0);
  assert.equal(records[1].stops, 0);
  assert.equal(b.modelOverride, "");
  a.turnActive = false;
  assert.equal(
    await provider._sendDurableMessage(
      { text: "continue", clientMessageId: "model-switch" },
      a,
    ),
    true,
  );
  assert.equal(records[0].stops, 1);
  assert.equal(records[1].stops, 0);
  assert.equal(b.session, oldB);
  assert.equal(records.length, 3);
  assert.ok(records[2].options.args.includes("team/custom-alias"));
  assert.ok(records[2].options.args.includes("https://relay.example/v1"));
  assert.ok(records[2].options.args.includes(a.sessionId));
  assert.ok(!records[2].options.args.includes("--api-key"));
  assert.equal(
    records[2].sent.filter((event) => event.type === "user").length,
    1,
  );
  a.turnActive = false;
  provider._setSessionModel("--default");
  assert.equal(
    await provider._sendDurableMessage(
      { text: "continue", clientMessageId: "model-reset" },
      a,
    ),
    true,
  );
  assert.ok(records[3].options.args.includes("configured-model"));
  assert.equal(records[1].stops, 0);
});

test("closing and reopening a tab retains its model without spawning a child", () => {
  const { provider, records } = makeModelConversations();
  const conv = provider._activeConv();
  provider._setSessionModel("team/alias");
  provider._handleMessage({ type: "closeTab", id: conv.id });
  provider.reopenClosedSession();
  const pending = provider._pendingReopen;
  provider._reopenInto(
    pending.sessionId,
    pending.draftKey,
    pending.modelOverride,
  );
  assert.equal(provider._activeConv().modelOverride, "team/alias");
  assert.equal(records.length, 0);
});

test("model overrides and resets survive tab restore without changing another conversation", () => {
  const { provider, saved } = makeModelConversations();
  const a = provider._activeConv();
  const b = provider._convs.create({});
  provider._convs.switchTo(a.id);
  provider._setSessionModel("team/alias");
  const restored = makeModelConversations(saved).provider;
  assert.equal(restored._activeConv().modelOverride, "team/alias");
  restored._setSessionModel("--default");
  assert.equal(restored._activeConv().modelOverride, "");
  assert.equal(b.modelOverride, "");
  saved.get("chainlesschain.chat.tabs").tabs[0].modelOverride =
    "unsafe & command";
  assert.equal(
    makeModelConversations(saved).provider._activeConv().modelOverride,
    "",
  );
});

test("invalid model input cannot mutate the selection or leak its text in a diagnostic", () => {
  const { provider, posts } = makeModelConversations();
  provider._setSessionModel("team/valid");
  for (const value of [
    undefined,
    {},
    "bad & command",
    "x\ny",
    "a".repeat(257),
    "x%PATH%",
    "x\u0000y",
  ]) {
    provider._setSessionModel(value);
    assert.equal(provider._activeConv().modelOverride, "team/valid");
    assert.equal(posts.at(-1).kind, "error");
    assert.ok(!posts.at(-1).text.includes("bad & command"));
  }
});

test("a context response from the previous model cannot overwrite the new child's indicator", async () => {
  const { provider, posts } = makeModelConversations();
  const conv = provider._activeConv();
  provider._ensureSession(conv);
  let finish;
  provider.opts.deps.runCliText = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  provider._refreshContextStatus(conv.id);
  provider._setSessionModel("team/new-model");
  await provider._sendDurableMessage(
    { text: "continue", clientMessageId: "late-context" },
    conv,
  );
  const count = posts.filter((message) => message.kind === "ctxStatus").length;
  finish(JSON.stringify({ contextWindow: 1000, totalTokens: 900 }));
  await new Promise(setImmediate);
  assert.equal(
    posts.filter((message) => message.kind === "ctxStatus").length,
    count,
  );
  assert.equal(provider._ctxWindowCache, null);
});

test("pending approvals and prepared inputs retain their original child during a model change", () => {
  const { provider, records } = makeModelConversations();
  const conv = provider._activeConv();
  const session = provider._ensureSession(conv);
  provider._setSessionModel("team/new-model");
  provider._convs.setPendingApproval(conv.id, {
    kind: "approval",
    id: "keep-approval",
  });
  assert.equal(provider._ensureSession(conv), session);
  assert.equal(provider._convs.pendingInteractions(conv.id).length, 1);
  provider._convs.clearApproval(conv.id);
  conv.preparingSubmission = true;
  assert.equal(provider._ensureSession(conv), session);
  assert.equal(records[0].stops, 0);
});

test("context queries follow the running model until the selected model is launched", async () => {
  const { provider, records, contextCalls } = makeModelConversations();
  const conv = provider._activeConv();
  provider._ensureSession(conv);
  provider._setSessionModel("team/new-model");
  provider._refreshContextStatus(conv.id);
  await new Promise(setImmediate);
  assert.ok(contextCalls[0].includes("configured-model"));
  await provider._sendDurableMessage(
    { text: "continue", clientMessageId: "context-switch" },
    conv,
  );
  provider._refreshContextStatus(conv.id);
  await new Promise(setImmediate);
  assert.ok(contextCalls.at(-1).includes("team/new-model"));
  assert.equal(records[0].stops, 1);
});

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

function makeLoopConversation() {
  const writes = [],
    posts = [],
    sessions = [];
  const provider = new ChatViewProvider(
    {
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
        workspaceFolders: [],
      },
    },
    {
      deps: {
        resolveChatLlm: () => ({}),
        createSession: (callbacks) => {
          const session = {
            running: true,
            send: (text) => {
              writes.push(text);
              return true;
            },
            sendEvent: (event) => {
              writes.push(event);
              return true;
            },
          };
          sessions.push({ callbacks, session });
          return session;
        },
      },
    },
  );
  provider._post = (message) => posts.push(message);
  provider._persistTabs = () => {};
  provider._restoreTranscript = () => {};
  provider._restoreDraft = async () => {};
  provider._refreshContextStatus = () => {};
  provider._cliCommand = () => "cc";
  const conv = provider._activeConv();
  conv.title = "Existing conversation";
  provider._ensureSession(conv);
  const onEvent = sessions[0].callbacks.onEvent;
  onEvent({
    type: "system",
    subtype: "init",
    session_id: conv.sessionId,
    input_receipts: { version: 1 },
  });
  return { conv, provider, onEvent, posts, writes, sessions };
}

test("ChatView pauses recurring input on persistence or unknown acceptance and retains completed tool views", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const event of [
    {
      type: "result",
      subtype: "error_persistence",
      is_error: true,
      code: "CC_SESSION_PERSISTENCE_FAILED",
      persistence: { phase: "after-model" },
    },
    {
      type: "result",
      subtype: "error_session_persistence",
      is_error: true,
      code: "SESSION_REVISION_STALE",
    },
    {
      type: "result",
      is_error: true,
      code: "CC_SESSION_TOOL_ROUND_PERSISTENCE_FAILED",
    },
    {
      type: "result",
      subtype: "error_input_receipt",
      is_error: true,
      acceptance: "unknown",
      error: "Cannot verify input acceptance",
    },
    { type: "session_error", code: "EPIPE", error: "Input delivery failed" },
  ]) {
    const { conv, provider, onEvent, posts, writes, sessions } =
      makeLoopConversation();
    t.after(() => provider._stopLoop(conv.id));
    provider._setLoop("1s inspect progress");
    assert.equal(writes.length, 1);
    onEvent({
      type: "tool_use",
      tool: "read_file",
      args: { path: "completed.txt" },
    });
    onEvent({
      type: "tool_result",
      tool: "read_file",
      is_error: false,
      result: { content: "saved output" },
    });
    const completedView = conv.transcript.find((row) => row.role === "tool");
    assert.ok(completedView);
    onEvent(event);
    t.mock.timers.tick(5000);
    assert.equal(writes.length, 1, JSON.stringify(event));
    assert.equal(sessions.length, 1);
    assert.ok(conv.transcript.includes(completedView));
    assert.ok(
      posts.some(
        (message) =>
          /\/loop paused/.test(message?.text) &&
          /Inspect.*session/.test(message.text),
      ),
    );
    if (event.type === "session_error")
      assert.ok(
        posts.some(
          (message) =>
            message?.code === "EPIPE" && message.text.includes("EPIPE"),
        ),
      );
    assert.equal(provider._loopTimers.has(conv.id), false);
  }
});

test("ChatView successful and ordinary-error turns keep the explicit loop active", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { conv, provider, onEvent, posts, writes } = makeLoopConversation();
  t.after(() => provider._stopLoop(conv.id));
  provider._setLoop("1s inspect progress");
  onEvent({ type: "result", is_error: false, result: "Completed" });
  t.mock.timers.tick(1000);
  assert.equal(writes.length, 2);
  onEvent({
    type: "result",
    is_error: true,
    error: "Rate limit exceeded; retry later",
    code: "RATE_LIMIT",
  });
  assert.ok(
    posts.some(
      (message) =>
        message?.kind === "turn_end" &&
        message.text.includes("Rate limit exceeded; retry later"),
    ),
  );
  t.mock.timers.tick(1000);
  assert.equal(writes.length, 3);
  assert.equal(provider._loopTimers.has(conv.id), true);
});

test("ChatView pauses recurring input on abnormal close and exposes exit diagnostics", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const { code, signal, completed } of [
    { code: 1, signal: null, completed: true },
    { code: null, signal: "SIGTERM", completed: false },
    { code: 0, signal: null, completed: false },
  ]) {
    const { conv, provider, onEvent, posts, writes, sessions } =
      makeLoopConversation();
    t.after(() => provider._stopLoop(conv.id));
    provider._setLoop("1s inspect progress");
    if (completed)
      onEvent({ type: "result", is_error: false, result: "Completed" });
    sessions[0].session.running = false;
    sessions[0].callbacks.onExit({ code, signal });
    t.mock.timers.tick(5000);
    assert.equal(writes.length, 1);
    assert.equal(sessions.length, 1);
    const diagnostic = posts.find(
      (message) =>
        message?.kind === "error" && message.code === "CC_AGENT_PROCESS_EXITED",
    );
    assert.ok(diagnostic);
    assert.ok(diagnostic.text.includes(signal || String(code)));
    assert.ok(posts.some((message) => /\/loop paused/.test(message?.text)));
  }
});

test("ChatView a clean close after a result permits the next scheduled turn", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { conv, provider, onEvent, writes, sessions } = makeLoopConversation();
  t.after(() => provider._stopLoop(conv.id));
  provider._setLoop("1s inspect progress");
  onEvent({ type: "result", is_error: false, result: "Completed" });
  sessions[0].session.running = false;
  sessions[0].callbacks.onExit({ code: 0, signal: null });
  t.mock.timers.tick(1000);
  assert.equal(writes.length, 2);
  assert.equal(sessions.length, 2);
  assert.equal(provider._loopTimers.has(conv.id), true);
});

test("ChatView compaction failure pauses input and preserves its cause through expected exit", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const reason of [
    "provider_transport_outcome_unknown",
    "provider_usage_not_reported",
    undefined,
  ]) {
    const { conv, provider, onEvent, posts, writes, sessions } =
      makeLoopConversation();
    t.after(() => provider._stopLoop(conv.id));
    provider._setLoop("1s inspect progress");
    conv.modeStatus = "pending";
    onEvent({
      type: "result",
      subtype: "error_compaction_usage_unknown",
      is_error: true,
      code: "CC_COMPACTION_USAGE_UNKNOWN",
      usage_unknown_reason: reason,
      error: "fetch failed secret-provider-request",
    });
    assert.equal(provider._loopTimers.has(conv.id), false);
    const result = posts.find((message) => message.kind === "turn_end");
    assert.match(result.text, /CC_COMPACTION_USAGE_UNKNOWN/);
    assert.match(result.text, /saved session.*provider usage/);
    if (reason === "provider_usage_not_reported")
      assert.match(result.text, /did not report/);
    if (reason === "provider_transport_outcome_unknown")
      assert.match(result.text, /request failed/);
    assert.ok(!JSON.stringify(posts).includes("secret-provider-request"));
    assert.ok(!conv.modeError.includes("secret-provider-request"));
    assert.ok(!posts.some((message) => message.kind === "setup"));
    // Cleanup telemetry after a terminal result does not change its meaning.
    onEvent({ type: "usage_summary", usage: {} });
    sessions[0].callbacks.onExit({ code: 1, signal: null });
    t.mock.timers.tick(5000);
    assert.equal(writes.length, 1);
    assert.ok(
      !posts.some((message) => message?.code === "CC_AGENT_PROCESS_EXITED"),
    );
  }
});

test("ChatView still reports crashes after an earlier session failure", (t) => {
  for (const { code, signal, next } of [
    { code: null, signal: "SIGTERM" },
    { code: 2, signal: null },
    {
      code: 1,
      signal: null,
      next: { type: "result", is_error: false, result: "Recovered" },
    },
    {
      code: 1,
      signal: null,
      next: { type: "tool_use", tool: "read_file", args: {} },
    },
  ]) {
    const { conv, provider, onEvent, posts, sessions } = makeLoopConversation();
    t.after(() => provider._stopLoop(conv.id));
    onEvent({
      type: "result",
      is_error: true,
      code: "CC_COMPACTION_USAGE_UNKNOWN",
    });
    if (next) onEvent(next);
    sessions[0].callbacks.onExit({ code, signal });
    assert.ok(
      posts.some((message) => message?.code === "CC_AGENT_PROCESS_EXITED"),
    );
  }
});

test("ChatView a paused loop cannot dispatch an already-preparing durable input", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { conv, provider, onEvent, writes } = makeSubmission();
  provider._refreshContextStatus = () => {};
  t.after(() => provider._stopLoop(conv.id));
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  let finishPreparation;
  provider._draftStore.prepare = () =>
    new Promise((resolve) => {
      finishPreparation = resolve;
    });
  provider._setLoop("1s inspect progress");
  for (let i = 0; i < 30 && !finishPreparation; i++) await Promise.resolve();
  assert.equal(typeof finishPreparation, "function");
  onEvent({
    type: "result",
    subtype: "error_persistence",
    is_error: true,
    code: "CC_SESSION_PERSISTENCE_FAILED",
  });
  finishPreparation({ sessionId: conv.sessionId, paths: [] });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  t.mock.timers.tick(5000);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.deepEqual(writes, []);
  assert.equal(provider._loopTimers.has(conv.id), false);
});

test("ChatView persistence diagnostics do not leak through setup or mode failure channels", () => {
  const { conv, onEvent, posts } = makeLoopConversation();
  conv.modeStatus = "pending";
  onEvent({
    type: "result",
    subtype: "error_persistence",
    is_error: true,
    code: "CC_SESSION_PERSISTENCE_FAILED",
    persistence: { phase: "after-model" },
    error: "HTTP 401 Bearer secret-request-body",
    result: "secret-request-body",
  });
  assert.equal(JSON.stringify(posts).includes("secret-request-body"), false);
  assert.equal(conv.modeError.includes("secret-request-body"), false);
  assert.ok(conv.modeError.includes("CC_SESSION_PERSISTENCE_FAILED"));
  assert.equal(
    posts.some((message) => message?.kind === "setup"),
    false,
  );
});

test("ChatView stale or other-session failures cannot pause the current loop", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { conv, provider, onEvent, posts, writes } = makeLoopConversation();
  t.after(() => provider._stopLoop(conv.id));
  provider._setLoop("1s inspect progress");
  const failure = {
    type: "result",
    subtype: "error_persistence",
    is_error: true,
  };
  onEvent({ ...failure, session_id: "another-session" });
  conv._sessionToken = {};
  onEvent(failure);
  assert.equal(provider._loopTimers.has(conv.id), true);
  t.mock.timers.tick(1000);
  assert.equal(writes.length, 2);
  assert.equal(
    posts.some((message) => /\/loop paused/.test(message?.text)),
    false,
  );
});

test("ChatView unknown durable write pauses a loop without resending", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const { conv, provider, onEvent, writes } = makeSubmission();
  t.after(() => provider._stopLoop(conv.id));
  conv.session.sendEvent = (event) => {
    writes.push(event);
    return false;
  };
  onEvent({ type: "system", subtype: "init", input_receipts: { version: 1 } });
  provider._setLoop("1s inspect progress");
  for (let i = 0; i < 30; i++) await Promise.resolve();
  t.mock.timers.tick(5000);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(provider._loopTimers.has(conv.id), false);
});

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
