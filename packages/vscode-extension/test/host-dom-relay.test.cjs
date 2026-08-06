"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { afterEach, test } = require("node:test");
const {
  buildChatHtml,
  CHAT_UI_PROTOCOL_VERSION,
  migrateBootstrapLastSent,
} = require("../src/chat/chat-html");
const { ChatViewProvider } = require("../src/chat/chat-view");
const {
  HOST_DOM_COMMAND,
  HOST_DOM_DRIVER_COMMAND,
  hostDomTokensEqual,
  normalizeHostDomToken,
  validateHostDomRequest,
} = require("../src/chat/host-dom-relay");
const {
  runDomRelayJourney,
  WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  WORKBENCH_NEEDS_INPUT_WARMUP_COUNT,
} = require("./extension-host/driver/dom-relay-journey.cjs");

const TOKEN = "ab".repeat(32);
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("host DOM relay is token-gated and only accepts fixed semantic actions", () => {
  assert.equal(HOST_DOM_COMMAND, "chainlesschain.internal.hostDomCommand");
  assert.equal(HOST_DOM_DRIVER_COMMAND, "chainlesschainTests.runHostJourney");
  assert.equal(normalizeHostDomToken(TOKEN), TOKEN);
  assert.equal(normalizeHostDomToken("short"), null);
  assert.equal(hostDomTokensEqual(TOKEN, TOKEN), true);
  assert.equal(hostDomTokensEqual(TOKEN, "cd".repeat(32)), false);
  assert.deepEqual(validateHostDomRequest({ action: "snapshot" }), {
    action: "snapshot",
  });
  assert.deepEqual(
    validateHostDomRequest({ action: "click", target: "planApprove" }),
    { action: "click", target: "planApprove" },
  );
  assert.throws(
    () =>
      validateHostDomRequest({ action: "evaluate", code: "process.exit()" }),
    /unsupported host DOM action/u,
  );
  assert.throws(
    () => validateHostDomRequest({ action: "click", target: "#arbitrary" }),
    /unsupported host DOM click target/u,
  );
});

test("chat HTML keeps the relay inert without a valid launch token", () => {
  const base = { cspSource: "vscode-webview:", nonce: "nonce", l10n: {} };
  const normal = buildChatHtml(base);
  const enabled = buildChatHtml({ ...base, hostDomToken: TOKEN });
  const rejected = buildChatHtml({
    ...base,
    hostDomToken: '";globalThis.compromised=true;//',
  });

  assert.match(normal, /const CC_HOST_DOM_TOKEN = "";/u);
  assert.match(
    enabled,
    new RegExp(`const CC_HOST_DOM_TOKEN = "${TOKEN}";`, "u"),
  );
  assert.match(enabled, /m\.kind === "hostDomCommand"/u);
  assert.doesNotMatch(enabled, /\beval\s*\(/u);
  assert.doesNotMatch(rejected, /globalThis\.compromised/u);
  const scripts = [...enabled.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)];
  assert.ok(scripts.length > 0, "generated chat HTML contains no scripts");
  for (const [, source] of scripts) {
    assert.doesNotThrow(() => new vm.Script(source));
  }
});

test("first tab activation preserves a bootstrap prompt for retry", () => {
  const bootstrap = { _: "journey:stream" };
  assert.equal(migrateBootstrapLastSent(bootstrap, null, "tab-1"), true);
  assert.deepEqual(bootstrap, { "tab-1": "journey:stream" });

  const established = { _: "stale", "tab-1": "current" };
  assert.equal(migrateBootstrapLastSent(established, "tab-1", "tab-2"), false);
  assert.deepEqual(established, { _: "stale", "tab-1": "current" });

  const alreadyOwned = { _: "bootstrap", "tab-1": "newer" };
  assert.equal(migrateBootstrapLastSent(alreadyOwned, null, "tab-1"), true);
  assert.deepEqual(alreadyOwned, { "tab-1": "newer" });

  const empty = {};
  assert.equal(migrateBootstrapLastSent(empty, null, "tab-1"), false);
  assert.deepEqual(empty, {});

  const html = buildChatHtml({
    cspSource: "vscode-webview:",
    nonce: "nonce",
    l10n: {},
  });
  assert.match(
    html,
    /migrateBootstrapLastSent\(lastSentByTab, activeTabId, m\.activeId\)/u,
  );
});

test("ChatViewProvider correlates a token-authenticated DOM response", async () => {
  const vscode = { l10n: { t: (value) => value } };
  const provider = new ChatViewProvider(vscode, { hostDomToken: TOKEN });
  provider._webviewReady = true;
  provider._webviewProtocolConfirmed = true;
  provider.view = {
    webview: {
      postMessage(message) {
        queueMicrotask(() => {
          provider._handleMessage({
            type: "hostDomResult",
            token: TOKEN,
            requestId: message.requestId,
            ok: true,
            result: { text: "real DOM", inputPresent: true, sendEnabled: true },
          });
        });
        return Promise.resolve(true);
      },
    },
  };

  assert.deepEqual(await provider.runHostDomCommand({ action: "snapshot" }), {
    text: "real DOM",
    inputPresent: true,
    sendEnabled: true,
  });
});

test("ChatViewProvider reveals a suspended relay view once and reports readiness state", async () => {
  const vscode = { l10n: { t: (value) => value } };
  const provider = new ChatViewProvider(vscode, { hostDomToken: TOKEN });
  let revealCount = 0;
  provider.view = {
    visible: false,
    show(preserveFocus) {
      assert.equal(preserveFocus, false);
      revealCount += 1;
    },
  };

  await assert.rejects(
    provider.runHostDomCommand({ action: "snapshot" }),
    /view=true, visible=false, ready=false, protocol=false/u,
  );
  await assert.rejects(
    provider.runHostDomCommand({ action: "snapshot" }),
    /chat webview DOM is not ready/u,
  );
  assert.equal(revealCount, 1);
});

test("token-gated fresh Webviews do not self-reload during cold startup", () => {
  const vscode = { l10n: { t: (value) => value } };
  const provider = new ChatViewProvider(vscode, { hostDomToken: TOKEN });
  const posted = [];
  const view = {
    webview: {
      postMessage(message) {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
  };
  provider.view = view;
  provider._webviewProtocolGuard = true;

  provider._armWebviewProtocolCheck(view);

  assert.deepEqual(posted, [
    { kind: "protocolProbe", uiProtocolVersion: CHAT_UI_PROTOCOL_VERSION },
  ]);
  assert.equal(provider._webviewProtocolTimer, null);
});

test("DOM relay driver produces the same auditable phase ledger and snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dom-relay-"));
  temporaryRoots.push(root);
  const artifactDir = path.join(root, "artifacts");
  const traceFile = path.join(artifactDir, "cdp-journey.jsonl");
  const workspaceFolders = [
    path.join(root, "workspace-primary"),
    path.join(root, "workspace-secondary"),
  ];
  workspaceFolders.forEach((workspaceFolder) => fs.mkdirSync(workspaceFolder));
  const state = {
    text: "",
    planVisible: false,
    planApproveEnabled: false,
    approvalApproveEnabled: false,
    stopEnabled: true,
    workbenchStage: "ready",
  };
  let streamCount = 0;
  let dispatchCount = 0;
  let replyCount = 0;
  const commands = {
    async executeCommand(command, token, request) {
      assert.equal(command, HOST_DOM_COMMAND);
      assert.equal(token, TOKEN);
      if (request.surface === "sessions-workbench") {
        if (request.action === "snapshot") {
          const needsInput = state.workbenchStage === "needs_input";
          const completed = state.workbenchStage === "completed";
          return {
            text: completed
              ? "Workbench lifecycle fixture workbench-result.md PR #88 merged"
              : "Workbench lifecycle fixture",
            rowCount: 5,
            kinds: ["local", "background", "remote", "team", "workflow"],
            backgroundState: needsInput ? "needs_input" : "done",
            dispatchEnabled: !needsInput,
            replyEnabled: needsInput,
            artifactVisible: completed,
            prVisible: completed,
          };
        }
        if (request.action === "click" && request.target === "dispatch") {
          const sample = dispatchCount;
          assert.equal(
            request.text,
            sample < WORKBENCH_NEEDS_INPUT_WARMUP_COUNT
              ? "dispatch from VS Code Workbench warmup"
              : `dispatch from VS Code Workbench sample ${
                  sample - WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + 1
                }`,
          );
          dispatchCount += 1;
          state.workbenchStage = "needs_input";
          return { clicked: "dispatch" };
        }
        if (request.action === "click" && request.target === "reply") {
          const sample = replyCount;
          assert.equal(
            request.text,
            sample < WORKBENCH_NEEDS_INPUT_WARMUP_COUNT
              ? "beta-warmup"
              : `beta-${sample - WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + 1}`,
          );
          replyCount += 1;
          state.workbenchStage = "completed";
          return { clicked: "reply" };
        }
        throw new Error("unsupported Workbench relay request");
      }
      if (request.action === "snapshot") {
        return {
          readyState: "complete",
          url: "vscode-webview://chainlesschainIdeChat",
          text: state.text,
          inputPresent: true,
          sendEnabled: true,
          stopEnabled: state.stopEnabled,
          planVisible: state.planVisible,
          planApproveEnabled: state.planApproveEnabled,
          approvalApproveEnabled: state.approvalApproveEnabled,
        };
      }
      if (request.action === "send") {
        if (request.text === "journey:stream") {
          streamCount += 1;
          state.text += ` fixture stream complete #${streamCount}`;
        } else if (request.text === "/retry") {
          streamCount += 1;
          state.text += ` fixture stream complete #${streamCount}`;
        } else if (request.text === "journey:plan") {
          state.planVisible = state.planApproveEnabled = true;
        } else if (request.text === "journey:permission") {
          state.approvalApproveEnabled = true;
        } else if (request.text === "journey:resume") {
          state.text +=
            " resumed previous conversation fixture stream complete #6";
        }
        return { sent: true };
      }
      if (request.target === "planApprove") {
        state.text += " fixture plan approve #3";
        state.planApproveEnabled = false;
      } else if (request.target === "latestApprovalApprove") {
        state.text += " fixture permission approved #4";
        state.approvalApproveEnabled = false;
      } else if (request.target === "stop") {
        state.text += " interrupted";
      }
      return { clicked: request.target };
    },
  };

  for (const phase of ["initial", "restart"]) {
    await runDomRelayJourney({
      commands,
      token: TOKEN,
      phase,
      readyFile: path.join(root, `${phase}-ready.json`),
      resultFile: path.join(root, `${phase}-result.json`),
      traceFile,
      artifactDir,
      extensionPath: root,
      workspaceDir: workspaceFolders[0],
      workspaceFolders,
    });
  }

  const trace = fs.readFileSync(traceFile, "utf8");
  const traceRecords = trace
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(
    dispatchCount,
    WORKBENCH_NEEDS_INPUT_WARMUP_COUNT + WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  );
  assert.equal(replyCount, dispatchCount);
  assert.equal(
    traceRecords.filter((record) => record.metric === "needs-input-visible")
      .length,
    WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  );
  assert.equal(
    traceRecords.find(
      (record) => record.metric === "needs-input-visible-summary",
    )?.samples,
    WORKBENCH_NEEDS_INPUT_SAMPLE_COUNT,
  );
  assert.match(trace, /"targetType":"vscode-webview-message-relay"/u);
  for (const step of [
    "stream",
    "retry",
    "plan-approval",
    "permission",
    "interrupt",
    "workbench-dispatch-needs-input",
    "workbench-reply-artifact",
    "ide-restart-resume",
    "workbench-restart-recovery",
  ]) {
    assert.match(trace, new RegExp(`"step":"${step}","status":"passed"`, "u"));
  }
  assert.match(
    fs.readFileSync(path.join(artifactDir, "initial-dom.txt"), "utf8"),
    /fixture permission approved #4[\s\S]*interrupted/u,
  );
  assert.match(
    fs.readFileSync(path.join(artifactDir, "restart-dom.txt"), "utf8"),
    /resumed previous conversation[\s\S]*fixture stream complete #6/u,
  );
  assert.match(
    fs.readFileSync(
      path.join(artifactDir, "initial-workbench-dom.txt"),
      "utf8",
    ),
    /workbench-result\.md[\s\S]*PR #88 merged/u,
  );
  assert.match(
    fs.readFileSync(
      path.join(artifactDir, "restart-workbench-dom.txt"),
      "utf8",
    ),
    /workbench-result\.md[\s\S]*PR #88 merged/u,
  );
});
