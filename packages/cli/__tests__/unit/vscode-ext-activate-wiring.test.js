/**
 * activate() command-wiring smoke test — drives the REAL extension.js entry
 * point against the fake `vscode` module (resolver-hooked below).
 *
 * Why this exists: the diff Accept/Reject keybinding callbacks shipped
 * referencing a variable that only existed inside startBridge()'s scope — a
 * guaranteed ReferenceError on every keypress — and no test caught it,
 * because the existing tests only asserted package.json declarations or
 * called facade methods directly. Declaring a command is not wiring it; this
 * test invokes each registered callback (the side-effect-safe ones) so the
 * whole ReferenceError class dies in CI instead of on a user's keyboard.
 *
 * The bridge is disabled via config (chainlesschain.ide.enabled=false), so
 * activation registers everything WITHOUT starting a server, writing a
 * lockfile, or probing the cc binary — pure wiring, fast and hermetic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

// extension.js does a native `require("vscode")` — vite aliases don't reach
// it, so hook Node's resolver to hand it the fake module, THEN load the real
// entry point through the same (native) require graph.
const require = createRequire(import.meta.url);
const Module = require("node:module");
const fakeVscodePath = require.resolve("../helpers/fake-vscode-module.cjs");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") return fakeVscodePath;
  return origResolve.call(this, request, ...rest);
};

const vscode = require("../helpers/fake-vscode-module.cjs");
const {
  activate,
  deactivate,
} = require("../../../vscode-extension/src/extension.js");

function fakeContext() {
  const store = new Map();
  return {
    subscriptions: [],
    workspaceState: {
      get: (k, d) => (store.has(k) ? store.get(k) : d),
      update: (k, v) => (store.set(k, v), Promise.resolve()),
    },
    globalState: {
      get: (k, d) => d,
      update: () => Promise.resolve(),
    },
    environmentVariableCollection: {
      replace: () => {},
      clear: () => {},
    },
  };
}

// Commands whose callbacks are safe to invoke headless (no real spawn /
// network). The rest are still asserted registered — invoking e.g.
// llm.configure would spawn real `cc config get` probes.
const INVOKABLE = [
  "chainlesschain.ide.showStatus",
  "chainlesschain.ide.openDashboard",
  "chainlesschain.diff.accept",
  "chainlesschain.diff.reject",
  "chainlesschain.preview.start", // no workspace folder → warning path
  "chainlesschain.preview.stop",
  "chainlesschain.chat.insertReference", // no editor → info path
  "chainlesschain.chat.fixDiagnostics", // no editor → info path
  "chainlesschain.chat.explainSelection", // no editor → info path
  "chainlesschain.chat.refactorSelection",
  "chainlesschain.chat.newConversation",
  "chainlesschain.chat.reopenClosedSession",
  "chainlesschain.memory.files", // fake terminal
];

const SPAWNING = [
  "chainlesschain.ide.restart", // bridge disabled → cheap, but still async
  "chainlesschain.cli.upgrade", // terminal npm i -g
  "chainlesschain.cli.checkUpdate", // npm registry fetch
  "chainlesschain.cli.whatsNew", // spawns cc changelog
  "chainlesschain.memory.init", // quickpick → cancelled, safe but async-heavy
  "chainlesschain.llm.configure", // spawns cc config get probes
  "chainlesschain.llm.configureVision", // spawns cc config get probes
];

describe("extension activate() wiring", () => {
  let ctx;

  beforeEach(() => {
    vscode.__reset();
    // Keep activation pure wiring: no MCP server, no lockfile, no cc probes.
    vscode.__setConfig({ "chainlesschain.ide.enabled": false });
    ctx = fakeContext();
    activate(ctx);
  });

  afterEach(async () => {
    await deactivate();
    for (const d of ctx.subscriptions) {
      try {
        d?.dispose?.();
      } catch {
        /* fake disposables */
      }
    }
  });

  it("registers every command it relies on", () => {
    for (const id of [...INVOKABLE, ...SPAWNING]) {
      expect(vscode.__commands[id], id).toBeTypeOf("function");
    }
  });

  it("every safe command callback runs without throwing (ReferenceError guard)", () => {
    for (const id of INVOKABLE) {
      expect(() => vscode.__commands[id](), id).not.toThrow();
    }
  });

  it("diff accept/reject are inert (no review, bridge down) instead of crashing", () => {
    // Regression: these callbacks used to reference a startBridge()-scoped
    // variable → ReferenceError on every keypress. With the bridge disabled
    // there is no facade at all, which is exactly the hostile case.
    expect(vscode.__commands["chainlesschain.diff.accept"]()).toBeUndefined();
    expect(vscode.__commands["chainlesschain.diff.reject"]()).toBeUndefined();
  });
});
