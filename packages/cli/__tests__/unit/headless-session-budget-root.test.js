import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { SessionBudgetSidecarStore } from "../../src/lib/session-budget-runtime.js";
import { readProductionSessionBudget } from "../../src/lib/session-budget-production-root.js";

const temporaryDirectories = [];

function makeStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-headless-budget-root-"),
  );
  temporaryDirectories.push(directory);
  return new SessionBudgetSidecarStore({
    resolvePath: (sessionId) => path.join(directory, `${sessionId}.json`),
    allowUnsupportedPlatformForTests: true,
  });
}

function makeDeps(store, loop) {
  return {
    bootstrap: async () => ({ db: null }),
    getApprovalGate: async () => ({
      setSessionPolicy: () => {},
      setConfirmer: () => {},
      decide: async () => ({ decision: "allow", via: "test" }),
    }),
    writeOut: () => {},
    writeErr: () => {},
    agentLoop: loop,
    sessionBudgetStore: store,
    sessionBudgetRegistry: new Map(),
    sessionExists: () => false,
    rebuildMessages: () => [],
    startSession: () => {},
    appendUserMessage: () => {},
    appendAssistantMessage: () => {},
    appendTokenUsage: () => {},
    appendToolCallCompact: () => {},
    appendLlmRetryCompact: () => {},
    appendEvent: () => {},
    appendCompactEvent: () => {},
    appendAuthorityEvent: () => true,
    getLastSessionId: () => null,
    verifySession: () => ({ status: "verified" }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("headless production session budget root", () => {
  it("opens one root, threads it into the loop, and charges only direct usage", async () => {
    const store = makeStore();
    let observedBudget = null;
    const loop = async function* (_messages, options) {
      observedBudget = options.sessionBudget;
      expect(observedBudget.consumeTurn({ id: "turn:fake" }).ok).toBe(true);
      yield {
        type: "token-usage",
        provider: "anthropic",
        model: "claude-test",
        usage: { input_tokens: 2, output_tokens: 1 },
      };
      yield {
        type: "token-usage",
        provider: "anthropic",
        model: "claude-child",
        usage: { input_tokens: 20, output_tokens: 10 },
        attribution: { origin: "subagent", subagentId: "child" },
      };
      yield { type: "response-complete", content: "done" };
      yield { type: "run-ended", reason: "complete" };
    };

    const result = await runAgentHeadless(
      {
        prompt: "go",
        sessionId: "budgeted-headless",
        persistSession: true,
        outputFormat: "text",
        sessionBudgetRoot: {
          enabled: true,
          limits: { maxTurns: 2, maxTokens: 10 },
        },
      },
      makeDeps(store, loop),
    );

    expect(result).toMatchObject({ exitCode: 0, isError: false });
    expect(observedBudget).toBeTruthy();
    expect(
      readProductionSessionBudget("budgeted-headless", { store }),
    ).toMatchObject({
      totals: { turns: 1, tokens: 3 },
      recoveryRequired: false,
    });
  });

  it("refuses recovery-pending authority before entering the agent loop", async () => {
    const store = makeStore();
    const { openSessionBudget } = await import(
      "../../src/lib/session-budget-runtime.js"
    );
    const crashed = openSessionBudget("dirty-headless", {
      store,
      registry: new Map(),
    });
    crashed.budget.beginTool({ id: "tool:dirty", kind: "write_file" });
    crashed.close();
    const loop = vi.fn(async function* () {
      yield { type: "response-complete", content: "must not run" };
    });

    await expect(
      runAgentHeadless(
        {
          prompt: "go",
          sessionId: "dirty-headless",
          persistSession: true,
          sessionBudgetRoot: { enabled: true, limits: {} },
        },
        makeDeps(store, loop),
      ),
    ).rejects.toMatchObject({
      code: "CC_SESSION_BUDGET_RECOVERY_REQUIRED",
    });
    expect(loop).not.toHaveBeenCalled();
  });
});
