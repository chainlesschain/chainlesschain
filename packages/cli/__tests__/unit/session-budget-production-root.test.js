import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionBudgetSidecarStore } from "../../src/lib/session-budget-runtime.js";
import {
  adjudicateProductionSessionBudgetRecovery,
  openProductionSessionBudgetRoot,
  readProductionSessionBudget,
  resolveSessionBudgetRootOptions,
} from "../../src/lib/session-budget-production-root.js";

const temporaryDirectories = [];

function makeStore() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-production-budget-root-"),
  );
  temporaryDirectories.push(directory);
  return new SessionBudgetSidecarStore({
    resolvePath: (sessionId) => path.join(directory, `${sessionId}.json`),
    allowUnsupportedPlatformForTests: true,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("production session budget root", () => {
  it("strictly resolves opt-in limits and rejects malformed values", () => {
    expect(resolveSessionBudgetRootOptions({})).toEqual({
      schema: "chainlesschain.session-budget-root/v1",
      enabled: false,
      limits: {},
    });
    expect(
      resolveSessionBudgetRootOptions({
        sessionMaxTurns: "3",
        sessionMaxDepth: "0",
        sessionMaxCostUsd: "1.25",
      }),
    ).toEqual({
      schema: "chainlesschain.session-budget-root/v1",
      enabled: true,
      limits: { maxTurns: 3, maxDepth: 0, maxUsd: 1.25 },
    });
    expect(() =>
      resolveSessionBudgetRootOptions({ sessionMaxTokens: "7.5" }),
    ).toThrow(/session-max-tokens.*positive integer/);
    expect(() =>
      resolveSessionBudgetRootOptions({ sessionMaxWallMs: "0" }),
    ).toThrow(/session-max-wall-ms.*positive integer/);
  });

  it("persists turn, known usage, and tool totals across root reopen", () => {
    const store = makeStore();
    const first = openProductionSessionBudgetRoot(
      "rooted",
      {
        enabled: true,
        limits: { maxTurns: 3, maxTokens: 20 },
      },
      { persist: true, store, registry: new Map() },
    );

    expect(first.budget.consumeTurn({ id: "turn:one" })).toMatchObject({
      ok: true,
    });
    const tool = first.budget.beginTool({ id: "tool:one", kind: "read_file" });
    expect(tool.ok).toBe(true);
    tool.end();
    first.budget.recordUsage({
      provider: "ollama",
      model: "local",
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    first.close();

    expect(readProductionSessionBudget("rooted", { store })).toMatchObject({
      sessionId: "rooted",
      recoveryRequired: false,
      limits: { maxTurns: 3, maxTokens: 20 },
      totals: { turns: 1, tokens: 6 },
    });

    const resumed = openProductionSessionBudgetRoot(
      "rooted",
      { enabled: true, limits: { maxTurns: 30, maxTokens: 10 } },
      { persist: true, store, registry: new Map() },
    );
    expect(resumed.budget.status()).toMatchObject({
      turns: 1,
      tokens: 6,
      maxTurns: 3,
      maxTokens: 10,
    });
    resumed.close();
  });

  it("fails closed on crash-pending work until every exact id is adjudicated", () => {
    const store = makeStore();
    const crashed = openProductionSessionBudgetRoot(
      "dirty-root",
      { enabled: true, limits: {} },
      { persist: true, store, registry: new Map() },
    );
    const tool = crashed.budget.beginTool({
      id: "tool:crashed",
      kind: "write_file",
    });
    crashed.close();

    const status = readProductionSessionBudget("dirty-root", { store });
    expect(status).toMatchObject({
      recoveryRequired: true,
      pendingRecovery: [
        {
          authorityId: tool.authorityId,
          resourceType: "tool",
          kind: "tool",
        },
      ],
    });
    expect(() =>
      openProductionSessionBudgetRoot(
        "dirty-root",
        { enabled: true, limits: {} },
        { persist: true, store, registry: new Map() },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_SESSION_BUDGET_RECOVERY_REQUIRED",
      }),
    );
    expect(() =>
      adjudicateProductionSessionBudgetRecovery(
        "dirty-root",
        ["tool-00000000-0000-4000-8000-000000000000"],
        { store, registry: new Map() },
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_SESSION_BUDGET_RECOVERY_INCOMPLETE",
      }),
    );

    expect(
      adjudicateProductionSessionBudgetRecovery(
        "dirty-root",
        [tool.authorityId],
        { store, registry: new Map() },
      ),
    ).toMatchObject({
      sessionId: "dirty-root",
      abandoned: [tool.authorityId],
      status: { recoveryRequired: false },
    });
    expect(readProductionSessionBudget("dirty-root", { store })).toMatchObject({
      recoveryRequired: false,
      pendingRecovery: [],
    });
  });

  it("requires an exact durable session before opening any authority", () => {
    expect(() =>
      openProductionSessionBudgetRoot(null, { enabled: true, limits: {} }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_SESSION_BUDGET_REQUIRES_DURABLE_SESSION",
      }),
    );
  });
});
