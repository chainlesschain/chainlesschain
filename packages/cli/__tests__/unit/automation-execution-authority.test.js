import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  automationExecutionAuthorityDigest,
  automationExecutionAuthoritySnapshot,
  assertAutomationRuntimeBoundary,
  classifyAutomationBoundaryError,
  inspectAutomationExecutionAuthority,
  normalizeAutomationExecutionAuthoritySnapshot,
  reserveAutomationExecutionAuthority,
  setAutomationExecutionBudget,
} from "../../src/lib/automation-execution-authority.js";
import {
  createFlow,
  ensureAutomationTables,
} from "../../src/lib/automation-engine.js";
import {
  checkPermission,
  grantPermission,
} from "../../src/lib/permission-engine.js";

describe("automation execution authority", () => {
  const cleanups = [];
  const principalId = "did:test:automation-budget-owner";
  const now = 1_786_500_000_000;

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture({ createdBy = principalId } = {}) {
    const db = new Database(":memory:");
    cleanups.push(() => db.close());
    ensureAutomationTables(db);
    const flow = createFlow(db, {
      name: "governed automation",
      createdBy,
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
        {
          id: "issue",
          type: "action",
          connector: "github",
          action: "createIssue",
        },
      ],
      edges: [{ from: "notify", to: "issue" }],
    });
    return { db, flow };
  }

  function configure(f, overrides = {}) {
    grantPermission(f.db, principalId, "automation:execute");
    grantPermission(f.db, principalId, "automation:connector:*");
    return setAutomationExecutionBudget(
      f.db,
      f.flow.id,
      {
        windowMs: 60 * 60_000,
        maxRuns: 2,
        maxActionSteps: 4,
        ...overrides,
      },
      { now: () => now },
    );
  }

  it("uses hierarchical connector grants and exposes a bounded live preflight", () => {
    const f = fixture();
    configure(f);

    expect(
      checkPermission(f.db, principalId, "automation:connector:slack", {
        nowMs: now,
      }),
    ).toBe(true);
    expect(
      inspectAutomationExecutionAuthority(f.db, f.flow, { now: () => now }),
    ).toMatchObject({
      ready: true,
      snapshot: {
        flowId: f.flow.id,
        principalId,
        connectors: ["github", "slack"],
        actionSteps: 2,
        requiredPermissions: [
          "automation:execute",
          "automation:connector:github",
          "automation:connector:slack",
        ],
      },
      permissions: [
        { permission: "automation:execute", allowed: true },
        { permission: "automation:connector:github", allowed: true },
        { permission: "automation:connector:slack", allowed: true },
      ],
      window: { usedRuns: 0, usedActionSteps: 0, remainingRuns: 2 },
    });
  });

  it("binds every simulated write to a versioned resource boundary", () => {
    const f = fixture();
    configure(f);
    const snapshot = automationExecutionAuthoritySnapshot(f.db, f.flow);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.effectBoundary).toMatchObject({
      schemaVersion: 1,
      effects: [
        {
          nodeId: "notify",
          connector: "slack",
          action: "postMessage",
          effect: "write",
          resourceScopes: [
            `automation-flow:${f.flow.id}:node:notify:simulated`,
          ],
        },
        {
          nodeId: "issue",
          connector: "github",
          action: "createIssue",
          effect: "write",
          resourceScopes: [`automation-flow:${f.flow.id}:node:issue:simulated`],
        },
      ],
    });
    expect(() =>
      assertAutomationRuntimeBoundary(snapshot, f.flow, {
        nodeId: "notify",
        connector: "slack",
        action: "postMessage",
        effect: "write",
        resourceScopes: ["channel:outside"],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_WRITE_SCOPE_DENIED",
      }),
    );
    expect(
      classifyAutomationBoundaryError({
        code: "AUTOMATION_EXECUTION_PERMISSION_DENIED",
        details: { permissions: ["automation:connector:slack"] },
      }),
    ).toEqual({
      category: "connector",
      code: "AUTOMATION_EXECUTION_PERMISSION_DENIED",
    });
  });

  it("accepts a released v1 snapshot without weakening its legacy digest", () => {
    const f = fixture();
    configure(f);
    const current = automationExecutionAuthoritySnapshot(f.db, f.flow);
    const legacy = {
      schemaVersion: 1,
      flowId: current.flowId,
      principalId: current.principalId,
      requiredPermissions: current.requiredPermissions,
      connectors: current.connectors,
      actionSteps: current.actionSteps,
      budget: current.budget,
    };
    const digest = automationExecutionAuthorityDigest(legacy, f.flow);
    const normalized = normalizeAutomationExecutionAuthoritySnapshot(
      legacy,
      f.flow,
    );

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      effectBoundary: current.effectBoundary,
    });
    expect(
      reserveAutomationExecutionAuthority(
        f.db,
        f.flow,
        "legacy-v1-occurrence",
        legacy,
        digest,
        { now: () => now },
      ),
    ).toMatchObject({
      occurrenceId: "legacy-v1-occurrence",
      authorityDigest: digest,
      deduplicated: false,
    });
  });

  it("reserves each occurrence exactly once and atomically enforces both caps", () => {
    const f = fixture();
    configure(f);
    const snapshot = automationExecutionAuthoritySnapshot(f.db, f.flow);
    const digest = automationExecutionAuthorityDigest(snapshot, f.flow);

    const first = reserveAutomationExecutionAuthority(
      f.db,
      f.flow,
      "occurrence-1",
      snapshot,
      digest,
      { now: () => now },
    );
    const replay = reserveAutomationExecutionAuthority(
      f.db,
      f.flow,
      "occurrence-1",
      snapshot,
      digest,
      { now: () => now },
    );
    const second = reserveAutomationExecutionAuthority(
      f.db,
      f.flow,
      "occurrence-2",
      snapshot,
      digest,
      { now: () => now },
    );

    expect(first.deduplicated).toBe(false);
    expect(replay).toMatchObject({
      occurrenceId: "occurrence-1",
      deduplicated: true,
    });
    expect(second.deduplicated).toBe(false);
    expect(() =>
      reserveAutomationExecutionAuthority(
        f.db,
        f.flow,
        "occurrence-3",
        snapshot,
        digest,
        { now: () => now },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_BUDGET_EXHAUSTED",
      }),
    );
    expect(
      inspectAutomationExecutionAuthority(f.db, f.flow, { now: () => now }),
    ).toMatchObject({
      ready: false,
      window: { usedRuns: 2, usedActionSteps: 4, remainingRuns: 0 },
    });
  });

  it("rejects a stale policy revision instead of applying a relaxed budget", () => {
    const f = fixture();
    configure(f);
    const snapshot = automationExecutionAuthoritySnapshot(f.db, f.flow);
    const digest = automationExecutionAuthorityDigest(snapshot, f.flow);
    setAutomationExecutionBudget(
      f.db,
      f.flow.id,
      { windowMs: 60 * 60_000, maxRuns: 100, maxActionSteps: 100 },
      { now: () => now + 1 },
    );

    expect(() =>
      reserveAutomationExecutionAuthority(
        f.db,
        f.flow,
        "occurrence-stale",
        snapshot,
        digest,
        { now: () => now + 1 },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_AUTHORITY_STALE",
      }),
    );
  });

  it("fails closed on corrupt durable usage instead of granting extra runs", () => {
    const f = fixture();
    configure(f);
    const snapshot = automationExecutionAuthoritySnapshot(f.db, f.flow);
    const digest = automationExecutionAuthorityDigest(snapshot, f.flow);
    const reservation = reserveAutomationExecutionAuthority(
      f.db,
      f.flow,
      "occurrence-corrupt-usage",
      snapshot,
      digest,
      { now: () => now },
    );
    f.db
      .prepare(
        `UPDATE auto_execution_budget_usage
         SET runs = 0
         WHERE flow_id = ? AND budget_revision = ? AND window_started_at_ms = ?`,
      )
      .run(f.flow.id, snapshot.budget.revision, reservation.windowStartedAtMs);

    expect(() =>
      inspectAutomationExecutionAuthority(f.db, f.flow, { now: () => now }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_BUDGET_STATE_INVALID",
      }),
    );
  });

  it("fails closed when an unattended flow has no bound principal", () => {
    const f = fixture({ createdBy: null });
    setAutomationExecutionBudget(
      f.db,
      f.flow.id,
      { windowMs: 60 * 60_000, maxRuns: 1, maxActionSteps: 2 },
      { now: () => now },
    );
    expect(() =>
      automationExecutionAuthoritySnapshot(f.db, f.flow),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_PRINCIPAL_REQUIRED",
      }),
    );
  });
});
