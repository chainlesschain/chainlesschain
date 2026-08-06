"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  isSessionsWorkbenchOpen,
  openSessionsWorkbench,
  runSessionsWorkbenchHostDomCommand,
} = require("../src/ui/sessions-view.js");

const HOST_TOKEN = "ab".repeat(32);

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../agent-sdk/__fixtures__/delivery-workflow/cases.json",
    ),
    "utf8",
  ),
);

function disconnectedSessions() {
  return {
    connected: false,
    revision: null,
    rows: [],
    error: "test session projection disabled",
  };
}

function createHost({ deliveryOutputs, hostDomToken = null }) {
  const posts = [];
  const deliveryCalls = [];
  const outputQueue = [...deliveryOutputs];
  const openPaths = [
    fixture.controllerCase.statePath,
    fixture.controllerCase.resultPath,
  ];
  let messageHandler = null;
  let disposeHandler = null;

  const panel = {
    visible: true,
    reveal() {},
    webview: {
      html: "",
      postMessage(message) {
        posts.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage(handler) {
        messageHandler = handler;
        return { dispose() {} };
      },
    },
    onDidDispose(handler) {
      disposeHandler = handler;
      return { dispose() {} };
    },
  };

  const vscode = {
    ViewColumn: { Active: 1 },
    workspace: {
      workspaceFolders: [],
      getConfiguration() {
        return { get: () => "cc" };
      },
    },
    window: {
      createWebviewPanel() {
        return panel;
      },
      async showOpenDialog() {
        return [{ fsPath: openPaths.shift() }];
      },
      async showWarningMessage(_message, _options, confirmation) {
        return confirmation;
      },
    },
  };

  openSessionsWorkbench(vscode, {
    hostDomToken,
    readSessionProjection: async () => disconnectedSessions(),
    runDeliveryCli: async (args) => {
      deliveryCalls.push([...args]);
      assert.ok(
        outputQueue.length > 0,
        `unexpected delivery CLI call: ${args.join(" ")}`,
      );
      const output = outputQueue.shift();
      return output && output.ok === false ? output : JSON.stringify(output);
    },
    readDeliveryResultFile: async () =>
      JSON.stringify(fixture.controllerCase.resultEnvelope),
  });

  return {
    panel,
    posts,
    deliveryCalls,
    async send(message) {
      assert.equal(typeof messageHandler, "function");
      await messageHandler(message);
    },
    dispose() {
      if (disposeHandler) disposeHandler();
    },
  };
}

test("token-gated Workbench relay exposes only fixed rendered-DOM semantics", async (t) => {
  const host = createHost({ deliveryOutputs: [], hostDomToken: HOST_TOKEN });
  t.after(() => host.dispose());

  assert.equal(isSessionsWorkbenchOpen(), true);
  assert.match(host.panel.webview.html, /hostWorkbenchDomCommand/u);
  assert.match(host.panel.webview.html, new RegExp(HOST_TOKEN, "u"));
  assert.doesNotMatch(host.panel.webview.html, /\beval\s*\(/u);
  await host.send({ type: "hostWorkbenchDomReady", token: HOST_TOKEN });

  const pending = runSessionsWorkbenchHostDomCommand({
    surface: "sessions-workbench",
    action: "snapshot",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const request = host.posts.find(
    (message) => message.kind === "hostWorkbenchDomCommand",
  );
  assert.ok(request);
  assert.deepEqual(request.request, {
    surface: "sessions-workbench",
    action: "snapshot",
  });
  await host.send({
    type: "hostWorkbenchDomResult",
    token: HOST_TOKEN,
    requestId: request.requestId,
    result: { rowCount: 5, artifactVisible: true },
  });
  assert.deepEqual(await pending, { rowCount: 5, artifactVisible: true });
});

test("Workbench open-state probe tracks panel disposal", () => {
  const host = createHost({ deliveryOutputs: [] });
  assert.equal(isSessionsWorkbenchOpen(), true);
  host.dispose();
  assert.equal(isSessionsWorkbenchOpen(), false);
});

function lastDeliveryPost(host) {
  return host.posts.filter((message) => message.type === "delivery").at(-1);
}

test("ready handshake routes exact revision/effect-bound delivery actions", async (t) => {
  const c = fixture.controllerCase;
  const host = createHost({
    deliveryOutputs: [
      c.initial,
      c.initial,
      c.requested,
      c.requested,
      c.settled,
    ],
  });
  t.after(() => host.dispose());

  assert.match(host.panel.webview.html, /data-delivery-command="select"/);
  assert.match(host.panel.webview.html, /postMessage\(\{command:'ready'\}\)/);
  await host.send({ command: "ready" });
  assert.match(lastDeliveryPost(host).html, /data-delivery-command="select"/);

  await host.send({ command: "delivery-select" });
  assert.deepEqual(host.deliveryCalls[0], [
    "artifacts",
    "delivery-project",
    c.statePath,
    "--json",
  ]);
  assert.match(
    lastDeliveryPost(host).html,
    /data-delivery-action="refresh_ci"/,
  );

  await host.send({ command: "delivery-request", action: "refresh_ci" });
  assert.deepEqual(host.deliveryCalls[2], c.expectedRequestArgs);
  assert.match(lastDeliveryPost(host).html, /data-delivery-command="settle"/);
  assert.ok(
    host.posts.some(
      (message) =>
        message.type === "info" &&
        /Pending delivery request recorded: refresh_ci/.test(message.text),
    ),
  );

  await host.send({ command: "delivery-settle" });
  assert.deepEqual(host.deliveryCalls[4], c.expectedSettleArgs);
  assert.doesNotMatch(
    lastDeliveryPost(host).html,
    /data-delivery-command="settle"/,
  );
  assert.match(lastDeliveryPost(host).html, /active \/ evidence/);
});

test("stale revision recheck routes no step and removes rendered actions", async (t) => {
  const c = fixture.controllerCase;
  const host = createHost({ deliveryOutputs: [c.initial, c.stale] });
  t.after(() => host.dispose());

  await host.send({ command: "delivery-select" });
  await host.send({ command: "delivery-request", action: "refresh_ci" });

  assert.equal(host.deliveryCalls.length, 2);
  assert.equal(
    host.deliveryCalls.some((args) => args[1] === "delivery-step"),
    false,
  );
  assert.doesNotMatch(lastDeliveryPost(host).html, /data-delivery-action=/);
  assert.match(lastDeliveryPost(host).html, /confirmation is stale/);
});

test("refresh failure clears stale actions while preserving a retry path", async (t) => {
  const c = fixture.controllerCase;
  const host = createHost({
    deliveryOutputs: [c.initial, { ok: false, error: "offline" }],
  });
  t.after(() => host.dispose());

  await host.send({ command: "delivery-select" });
  assert.match(
    lastDeliveryPost(host).html,
    /data-delivery-action="refresh_ci"/,
  );
  await host.send({ command: "delivery-refresh" });

  const disconnected = lastDeliveryPost(host).html;
  assert.match(disconnected, /Delivery flow unavailable: offline/);
  assert.match(disconnected, /data-delivery-command="refresh"/);
  assert.doesNotMatch(disconnected, /data-delivery-action=/);

  await host.send({ command: "delivery-request", action: "refresh_ci" });
  assert.equal(host.deliveryCalls.length, 2);
  assert.match(
    lastDeliveryPost(host).html,
    /Delivery request rejected: no delivery projection is loaded/,
  );
});
