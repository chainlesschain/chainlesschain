"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const childProcess = require("node:child_process");
const { parseSessionProjection } = require("../src/sessions-workbench.js");

const modulePath = require.resolve("../src/ui/sessions-view.js");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const unavailable = (error) => ({
  connected: false,
  revision: null,
  rows: [],
  error,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function host(t, readSessionProjection, execFile) {
  if (execFile) t.mock.method(childProcess, "execFile", execFile);
  delete require.cache[modulePath];
  const view = require(modulePath);
  const posts = [];
  let receive, dispose;
  const panel = {
    visible: true,
    reveal() {},
    webview: {
      html: "",
      postMessage(message) {
        posts.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage(callback) {
        receive = callback;
      },
    },
    onDidDispose(callback) {
      dispose = callback;
    },
  };
  const vscode = {
    ViewColumn: { Active: 1 },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: () => "cc" }),
    },
    window: { createWebviewPanel: () => panel },
  };
  view.openSessionsWorkbench(vscode, { readSessionProjection });
  t.after(() => {
    dispose();
    delete require.cache[modulePath];
  });
  return { posts, send: (message) => receive(message), dispose };
}

test("a late initial projection cannot overwrite a newer explicit refresh", async (t) => {
  const old = deferred();
  let reads = 0;
  const h = host(t, () =>
    ++reads === 1
      ? old.promise
      : Promise.resolve(unavailable("fresh snapshot")),
  );
  await h.send({ command: "refresh" });
  old.resolve(unavailable("obsolete snapshot"));
  await flush();
  const rows = h.posts.filter((message) => message.type === "rows");
  assert.equal(rows.length, 1);
  assert.match(rows[0].html, /fresh snapshot/);
  assert.doesNotMatch(rows[0].html, /obsolete snapshot/);
});

test("disposing a panel prevents its pending read from publishing rows", async (t) => {
  const pending = deferred();
  const h = host(t, () => pending.promise);
  h.dispose();
  pending.resolve(unavailable("disposed snapshot"));
  await flush();
  assert.equal(h.posts.filter((message) => message.type === "rows").length, 0);
});

async function projection(phase = "stopped") {
  const { buildSessionProjection } =
    await import("../../cli/src/lib/session-projection.js");
  return parseSessionProjection(
    JSON.stringify(
      buildSessionProjection({
        background: [
          {
            id: "refresh-agent",
            title: "refresh fixture",
            status: phase === "stopped" ? "completed" : "running",
            phase,
            sessionId: "refresh-session",
            cwd: process.cwd(),
            interactive: true,
            heartbeatAt: Date.parse("2026-10-12T00:00:00Z"),
          },
        ],
      }),
    ),
  );
}

function dispatch(snapshot) {
  const row = snapshot.rows.find((item) => item.kind === "background");
  assert.ok(row);
  return {
    command: "action",
    id: row.id,
    act: "dispatch",
    revision: snapshot.revision,
    itemRevision: row.revision,
    text: "continue refresh fixture",
  };
}

test("periodic refresh waits for the action's existing canonical refresh", async (t) => {
  const snapshot = await projection();
  let reads = 0,
    completeMutation;
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = host(
    t,
    async () => {
      reads++;
      return snapshot;
    },
    (_command, args, _options, callback) => {
      assert.match(String(args), /\bresume\b/);
      completeMutation = callback;
    },
  );
  await flush();
  const action = h.send(dispatch(snapshot));
  await flush();
  assert.equal(typeof completeMutation, "function");
  assert.equal(reads, 2, "initial read and fresh authority preflight both run");
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(
    reads,
    2,
    "a timer must not start another CLI read during mutation",
  );
  completeMutation(null, '{"accepted":true}', "");
  await action;
  assert.equal(
    reads,
    3,
    "the post-mutation canonical read still runs exactly once",
  );
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(reads, 4, "idle periodic refresh resumes normally");
});

test("a read started before dispatch cannot overwrite the post-mutation revision", async (t) => {
  const initial = await projection(),
    after = await projection("needs_input"),
    old = deferred();
  let reads = 0,
    completeMutation;
  const h = host(
    t,
    () => {
      reads++;
      return reads === 2
        ? old.promise
        : Promise.resolve(reads >= 4 ? after : initial);
    },
    (_command, _args, _options, callback) => {
      completeMutation = callback;
    },
  );
  await flush();
  const refresh = h.send({ command: "refresh" });
  const action = h.send(dispatch(initial));
  await flush();
  assert.equal(typeof completeMutation, "function");
  completeMutation(null, '{"accepted":true}', "");
  await action;
  old.resolve(unavailable("obsolete pre-mutation read"));
  await refresh;
  const rows = h.posts.filter((message) => message.type === "rows");
  assert.match(rows.at(-1).html, /needs_input/);
  assert.doesNotMatch(rows.at(-1).html, /obsolete pre-mutation read/);
  assert.equal(reads, 4);
});

test("a timer during the post-mutation read does not queue a redundant read", async (t) => {
  const snapshot = await projection();
  const postMutation = deferred();
  let reads = 0;
  let completeMutation;
  t.mock.timers.enable({ apis: ["setInterval"] });
  const h = host(
    t,
    () => (++reads === 3 ? postMutation.promise : Promise.resolve(snapshot)),
    (_command, _args, _options, callback) => {
      completeMutation = callback;
    },
  );
  await flush();
  const action = h.send(dispatch(snapshot));
  await flush();
  completeMutation(null, '{"accepted":true}', "");
  await flush();
  assert.equal(reads, 3);
  t.mock.timers.tick(15_000);
  postMutation.resolve(snapshot);
  await action;
  assert.equal(
    reads,
    3,
    "the in-flight canonical refresh covers the timer tick",
  );
});
