import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  automationExecutionAuthorityDigest,
  automationExecutionAuthoritySnapshot,
  inspectAutomationExecutionAuthority,
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
