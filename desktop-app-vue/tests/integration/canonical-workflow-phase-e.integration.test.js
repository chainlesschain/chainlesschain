/**
 * Canonical Coding Workflow — Phase E E2E integration.
 *
 * Wires the full Phase E stack end-to-end against a real tmp dir:
 *   $deep-interview handler
 *       → SessionStateManager (real fs)
 *       → setRoutingHint persistence
 *   workflow-session-ipc
 *       → register real channels against a fake ipcMain
 *   preload-shim
 *       → expose invoke() as window.electronAPI.workflowSession.*
 *   Pinia store (useWorkflowSessionStore)
 *       → refreshList / selectSession / classifyIntake
 *       → reads routingHint via currentState.mode.routingHint
 *
 * This proves the full Phase E chain works against real modules —
 * handler writes, IPC reads, store consumes — without needing
 * Electron or Playwright.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Mock the renderer logger before importing the store.
vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const deepInterview = require("../../src/main/ai-engine/cowork/skills/builtin/deep-interview/handler.js");
const {
  registerWorkflowSessionIPC,
  CHANNELS,
} = require("../../src/main/ai-engine/code-agent/workflow-session-ipc.js");
const {
  SessionStateManager,
} = require("../../src/main/ai-engine/code-agent/session-state-manager.js");

// Dynamic import for the ESM store module.
let useWorkflowSessionStore;

function makeFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(ch, fn) {
      handlers.set(ch, fn);
    },
    removeHandler(ch) {
      handlers.delete(ch);
    },
    invoke(ch, ...args) {
      const fn = handlers.get(ch);
      if (!fn) {
        throw new Error(`no handler for ${ch}`);
      }
      return fn({}, ...args);
    },
  };
}

function installPreloadShim(ipc) {
  // Mirror the exact shape exposed by src/preload/index.js for workflowSession.
  globalThis.window = {
    electronAPI: {
      workflowSession: {
        list: () => ipc.invoke("workflow-session:list"),
        get: (sessionId) => ipc.invoke("workflow-session:get", sessionId),
        listMembers: (parentId) =>
          ipc.invoke("workflow-session:list-members", parentId),
        classifyIntake: (input) =>
          ipc.invoke("workflow-session:classify-intake", input),
      },
    },
  };
}

describe("Canonical Workflow Phase E — E2E", () => {
  let tmpRoot;
  let ipc;

  beforeEach(async () => {
    setActivePinia(createPinia());
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-phase-e-e2e-"));
    ipc = makeFakeIpcMain();
    registerWorkflowSessionIPC({ ipcMain: ipc, projectRoot: tmpRoot });
    installPreloadShim(ipc);

    if (!useWorkflowSessionStore) {
      ({ useWorkflowSessionStore } =
        await import("../../src/renderer/stores/workflow-session"));
    }
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
    delete globalThis.window;
  });

  it("registers all 4 canonical channels", () => {
    expect(CHANNELS).toEqual([
      "workflow-session:list",
      "workflow-session:get",
      "workflow-session:list-members",
      "workflow-session:classify-intake",
    ]);
    for (const ch of CHANNELS) {
      expect(ipc.handlers.has(ch)).toBe(true);
    }
  });

  it("deep-interview → fs → IPC → store: ralph hint flows end-to-end", async () => {
    // 1. Stage write via real handler
    const r = await deepInterview.execute(
      {
        params: {
          goal: "fix typo in README",
          sessionId: "e2e-ralph",
        },
      },
      { projectRoot: tmpRoot },
    );
    expect(r.success).toBe(true);
    expect(r.result.routingHint.decision).toBe("ralph");

    // 2. Renderer refresh + select via store
    const store = useWorkflowSessionStore();
    await store.refreshList();
    expect(store.sessions.map((s) => s.sessionId)).toContain("e2e-ralph");

    await store.selectSession("e2e-ralph");
    expect(store.currentSessionId).toBe("e2e-ralph");
    expect(store.currentState).toBeTruthy();
    expect(store.currentState.stage).toBe("intent");

    // 3. Store surfaces the routing hint via currentState.mode.routingHint
    const hint = store.currentState.mode.routingHint;
    expect(hint).toBeTruthy();
    expect(hint.decision).toBe("ralph");
    expect(hint.confidence).toBeTruthy();
  });

  it("deep-interview multi-scope → store: team hint with correct scopeCount", async () => {
    await deepInterview.execute(
      {
        params: {
          goal: "cross-module refactor",
          sessionId: "e2e-team",
          scopePaths: [
            "desktop-app-vue/src/main/a.js",
            "desktop-app-vue/src/renderer/b.ts",
            "packages/cli/src/c.js",
          ],
        },
      },
      { projectRoot: tmpRoot },
    );

    const store = useWorkflowSessionStore();
    await store.refreshList();
    await store.selectSession("e2e-team");

    const hint = store.currentState.mode.routingHint;
    expect(hint.decision).toBe("team");
    expect(hint.scopeCount).toBe(3);
    expect(hint.recommendedConcurrency).toBeGreaterThanOrEqual(2);
    expect(hint.suggestedRoles.length).toBeGreaterThan(1);
  });

  it("store.classifyIntake → IPC → pure classifier round-trip", async () => {
    const store = useWorkflowSessionStore();
    const result = await store.classifyIntake({
      request: "wire main and renderer",
      scopePaths: [
        "desktop-app-vue/src/main/x.js",
        "desktop-app-vue/src/renderer/y.ts",
      ],
    });
    expect(result).toBeTruthy();
    expect(result.decision).toBe("team");
    expect(result.scopeCount).toBe(2);
    expect(store.lastClassification).toEqual(result);
    expect(store.error).toBeNull();
  });

  it("store.classifyIntake with sessionId enriches from real tasks.json", async () => {
    // Seed intent + plan + tasks on disk
    const manager = new SessionStateManager({ projectRoot: tmpRoot });
    manager.writeIntent("e2e-enrich", { goal: "ship" });
    manager.writePlan("e2e-enrich", { title: "P", steps: ["a"] });
    manager.approvePlan("e2e-enrich");
    manager.writeTasks("e2e-enrich", {
      tasks: [
        {
          id: "t1",
          status: "pending",
          scopePaths: ["desktop-app-vue/src/main/a.js"],
        },
        {
          id: "t2",
          status: "pending",
          scopePaths: ["backend/project-service/b.java"],
        },
      ],
    });

    const store = useWorkflowSessionStore();
    const result = await store.classifyIntake({
      sessionId: "e2e-enrich",
      request: "continue",
    });
    expect(result.decision).toBe("team");
    expect(result.scopeCount).toBe(2);
    expect(result.boundaries.sort()).toEqual(
      ["backend/project-service", "desktop-app-vue/src/main"].sort(),
    );
  });

  it("routingHint survives $ralplan stage transition (end-to-end via store)", async () => {
    // Multi-scope deep-interview
    await deepInterview.execute(
      {
        params: {
          goal: "parallel refactor",
          sessionId: "e2e-survive",
          scopePaths: [
            "desktop-app-vue/src/main/a.js",
            "packages/cli/src/b.js",
          ],
        },
      },
      { projectRoot: tmpRoot },
    );

    // Advance stage via SessionStateManager (simulates $ralplan write+approve)
    const manager = new SessionStateManager({ projectRoot: tmpRoot });
    manager.writePlan("e2e-survive", { title: "P", steps: ["x"] });
    manager.approvePlan("e2e-survive");

    // Store sees updated stage but preserved routingHint
    const store = useWorkflowSessionStore();
    await store.selectSession("e2e-survive");
    expect(store.currentState.stage).toBe("plan");
    const hint = store.currentState.mode.routingHint;
    expect(hint).toBeTruthy();
    expect(hint.decision).toBe("team");
    expect(hint.scopeCount).toBe(2);
  });

  it("bridge-missing error propagates through store layer", async () => {
    globalThis.window = { electronAPI: {} };
    const store = useWorkflowSessionStore();
    await store.refreshList();
    expect(store.error).toMatch(/workflowSession IPC bridge not available/);
    expect(store.sessions).toEqual([]);
  });
});
