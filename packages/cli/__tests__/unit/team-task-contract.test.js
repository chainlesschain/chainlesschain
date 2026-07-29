import { describe, expect, it } from "vitest";
import { resolveTeamTaskContract } from "../../src/lib/agent-team/team-task-contract.js";

const parent = {
  permissionMode: "manual",
  maxTurns: 20,
  maxBudgetUsd: 4,
  maxTokens: 10000,
  maxWallMs: 120000,
  checkpointRequired: true,
  worktreeRequired: true,
  model: "parent-model",
};

describe("resolveTeamTaskContract", () => {
  it("inherits every parent default when the task is silent", () => {
    expect(resolveTeamTaskContract({ parent, task: {} })).toEqual({
      permissionMode: "manual",
      maxTurns: 20,
      maxBudgetUsd: 4,
      maxTokens: 10000,
      maxWallMs: 120000,
      checkpointRequired: true,
      worktreeRequired: true,
      model: "parent-model",
      adjustments: [],
    });
  });

  it("honors child requests that tighten permission and every budget", () => {
    expect(
      resolveTeamTaskContract({
        parent: {
          ...parent,
          permissionMode: "bypassPermissions",
          checkpointRequired: false,
          worktreeRequired: false,
        },
        task: {
          agent: {
            permissionMode: "acceptEdits",
            maxTurns: 10,
            maxBudgetUsd: 1.5,
            maxTokens: 4000,
            maxWallMs: 30000,
            checkpointRequired: true,
            worktreeRequired: true,
            model: "child-model",
          },
        },
      }),
    ).toEqual({
      permissionMode: "acceptEdits",
      maxTurns: 10,
      maxBudgetUsd: 1.5,
      maxTokens: 4000,
      maxWallMs: 30000,
      checkpointRequired: true,
      worktreeRequired: true,
      model: "child-model",
      adjustments: [],
    });
  });

  it("clamps permission, budgets, and required isolation to the parent", () => {
    const result = resolveTeamTaskContract({
      parent,
      task: {
        policy: {
          permissionMode: "bypassPermissions",
          maxTurns: 40,
          maxBudgetUsd: 8,
          maxTokens: 20000,
          maxWallMs: 240000,
          checkpointRequired: false,
          worktreeRequired: false,
        },
      },
    });

    expect(result).toMatchObject({
      permissionMode: "manual",
      maxTurns: 20,
      maxBudgetUsd: 4,
      maxTokens: 10000,
      maxWallMs: 120000,
      checkpointRequired: true,
      worktreeRequired: true,
    });
    expect(result.adjustments).toEqual([
      {
        field: "permissionMode",
        source: "task.policy",
        requested: "bypassPermissions",
        effective: "manual",
        reason: "parent-permission-ceiling",
      },
      {
        field: "maxTurns",
        source: "task.policy",
        requested: 40,
        effective: 20,
        reason: "parent-budget-ceiling",
      },
      {
        field: "maxBudgetUsd",
        source: "task.policy",
        requested: 8,
        effective: 4,
        reason: "parent-budget-ceiling",
      },
      {
        field: "maxTokens",
        source: "task.policy",
        requested: 20000,
        effective: 10000,
        reason: "parent-budget-ceiling",
      },
      {
        field: "maxWallMs",
        source: "task.policy",
        requested: 240000,
        effective: 120000,
        reason: "parent-budget-ceiling",
      },
      {
        field: "checkpointRequired",
        source: "task.policy",
        requested: false,
        effective: true,
        reason: "parent-requirement",
      },
      {
        field: "worktreeRequired",
        source: "task.policy",
        requested: false,
        effective: true,
        reason: "parent-requirement",
      },
    ]);
  });

  it("lets task.policy override task.agent for the same field", () => {
    const result = resolveTeamTaskContract({
      parent: { ...parent, permissionMode: "bypassPermissions" },
      task: {
        agent: {
          permissionMode: "acceptEdits",
          maxTurns: 10,
          model: "agent-model",
        },
        policy: {
          permissionMode: "plan",
          maxTurns: 5,
          model: "policy-model",
        },
      },
    });

    expect(result.permissionMode).toBe("plan");
    expect(result.maxTurns).toBe(5);
    expect(result.model).toBe("policy-model");
    expect(result.adjustments).toEqual([]);
  });

  it("inherits parent values for invalid, non-finite, or non-positive requests", () => {
    const result = resolveTeamTaskContract({
      parent,
      task: {
        agent: {
          permissionMode: "root",
          maxTurns: 2.5,
          maxBudgetUsd: Number.POSITIVE_INFINITY,
          maxTokens: 0,
          maxWallMs: -1,
          checkpointRequired: "false",
          worktreeRequired: 0,
          model: "  ",
        },
      },
    });

    expect(result).toMatchObject({
      permissionMode: "manual",
      maxTurns: 20,
      maxBudgetUsd: 4,
      maxTokens: 10000,
      maxWallMs: 120000,
      checkpointRequired: true,
      worktreeRequired: true,
      model: "parent-model",
    });
    expect(result.adjustments.map((entry) => entry.field)).toEqual([
      "permissionMode",
      "maxTurns",
      "maxBudgetUsd",
      "maxTokens",
      "maxWallMs",
      "checkpointRequired",
      "worktreeRequired",
      "model",
    ]);
    expect(
      result.adjustments.every(
        (entry) => entry.reason === "invalid-value-inherited",
      ),
    ).toBe(true);
  });

  it("does not fall through to task.agent when task.policy is explicitly invalid", () => {
    const result = resolveTeamTaskContract({
      parent,
      task: {
        agent: { maxTokens: 5000, model: "agent-model" },
        policy: { maxTokens: "bad", model: "" },
      },
    });

    expect(result.maxTokens).toBe(10000);
    expect(result.model).toBe("parent-model");
    expect(result.adjustments).toEqual([
      {
        field: "maxTokens",
        source: "task.policy",
        requested: "bad",
        effective: 10000,
        reason: "invalid-value-inherited",
      },
      {
        field: "model",
        source: "task.policy",
        requested: "",
        effective: "parent-model",
        reason: "invalid-value-inherited",
      },
    ]);
  });

  it("does not fall through to task.agent when task.policy explicitly uses null", () => {
    const result = resolveTeamTaskContract({
      parent,
      task: {
        agent: { maxTokens: 5000, model: "agent-model" },
        policy: { maxTokens: null, model: null },
      },
    });

    expect(result.maxTokens).toBe(10000);
    expect(result.model).toBe("parent-model");
    expect(result.adjustments).toEqual([
      {
        field: "maxTokens",
        source: "task.policy",
        requested: null,
        effective: 10000,
        reason: "invalid-value-inherited",
      },
      {
        field: "model",
        source: "task.policy",
        requested: null,
        effective: "parent-model",
        reason: "invalid-value-inherited",
      },
    ]);
  });

  it("accepts finite child ceilings when the parent dimension is unlimited", () => {
    const result = resolveTeamTaskContract({
      parent: {
        permissionMode: "bypassPermissions",
        checkpointRequired: false,
        worktreeRequired: false,
      },
      task: {
        policy: {
          maxTurns: "7",
          maxBudgetUsd: "0.25",
          maxTokens: "2048",
          maxWallMs: "30000",
        },
      },
    });

    expect(result).toEqual({
      permissionMode: "bypassPermissions",
      maxTurns: 7,
      maxBudgetUsd: 0.25,
      maxTokens: 2048,
      maxWallMs: 30000,
      checkpointRequired: false,
      worktreeRequired: false,
      model: null,
      adjustments: [],
    });
  });

  it("normalizes malformed parent defaults to safe inherited values", () => {
    const result = resolveTeamTaskContract({
      parent: {
        permissionMode: "unknown",
        maxTurns: Infinity,
        maxBudgetUsd: -1,
        maxTokens: 1.5,
        maxWallMs: NaN,
        checkpointRequired: "true",
        worktreeRequired: 1,
        model: {},
      },
      task: { agent: { unknownField: "ignored" } },
    });

    expect(result).toEqual({
      permissionMode: "default",
      maxTurns: null,
      maxBudgetUsd: null,
      maxTokens: null,
      maxWallMs: null,
      checkpointRequired: false,
      worktreeRequired: false,
      model: null,
      adjustments: [],
    });
  });

  it("is pure and tolerates non-object task sections", () => {
    const frozenParent = Object.freeze({ ...parent });
    const task = Object.freeze({ agent: "bad", policy: ["bad"] });
    const before = JSON.stringify({ parent: frozenParent, task });

    const first = resolveTeamTaskContract({ parent: frozenParent, task });
    const second = resolveTeamTaskContract({ parent: frozenParent, task });

    expect(second).toEqual(first);
    expect(JSON.stringify({ parent: frozenParent, task })).toBe(before);
  });
});
