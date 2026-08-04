"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { afterEach, test } = require("node:test");
const { buildChatHtml } = require("../src/chat/chat-html");
const { ChatViewProvider } = require("../src/chat/chat-view");
const {
  HOST_DOM_COMMAND,
  hostDomTokensEqual,
  normalizeHostDomToken,
  validateHostDomRequest,
} = require("../src/chat/host-dom-relay");
const {
  runDomRelayJourney,
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

test("DOM relay driver produces the same auditable phase ledger and snapshots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-dom-relay-"));
  temporaryRoots.push(root);
  const artifactDir = path.join(root, "artifacts");
  const traceFile = path.join(artifactDir, "cdp-journey.jsonl");
  const state = {
    text: "",
    planVisible: false,
    planApproveEnabled: false,
    approvalApproveEnabled: false,
    stopEnabled: true,
  };
  let streamCount = 0;
  const commands = {
    async executeCommand(command, token, request) {
      assert.equal(command, HOST_DOM_COMMAND);
      assert.equal(token, TOKEN);
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
      workspaceDir: root,
    });
  }

  const trace = fs.readFileSync(traceFile, "utf8");
  assert.match(trace, /"targetType":"vscode-webview-message-relay"/u);
  for (const step of [
    "stream",
    "retry",
    "plan-approval",
    "permission",
    "interrupt",
    "ide-restart-resume",
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
});
