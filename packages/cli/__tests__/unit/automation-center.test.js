import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  buildAutomationCenterProjection,
  runAutomationCenterAction,
} from "../../src/lib/automation-center.js";
import {
  addTrigger,
  createFlow,
  ensureAutomationTables,
  getFlow,
  updateFlowStatus,
  FLOW_STATUS,
} from "../../src/lib/automation-engine.js";
import { setAutomationExecutionBudget } from "../../src/lib/automation-execution-authority.js";
import { grantPermission } from "../../src/lib/permission-engine.js";

describe("Automation Center projection", () => {
  const cleanups = [];
  const now = 1_786_600_000_000;
  const principalId = "did:test:automation-center";

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture({ configure = true } = {}) {
    const db = new Database(":memory:");
    cleanups.push(() => db.close());
    ensureAutomationTables(db);
    const flow = createFlow(db, {
      name: "IDE delivery alert",
      description: "Notify a scoped channel",
      createdBy: principalId,
      schedule: "*/5 * * * *",
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
      edges: [],
    });
    addTrigger(db, flow.id, {
      type: "event",
      config: {
        event: "channel.event",
        scope: { origins: ["telegram"], senders: ["ops-room"] },
      },
    });
    updateFlowStatus(db, flow.id, FLOW_STATUS.ACTIVE);
    if (configure) {
      grantPermission(db, principalId, "automation:execute");
      grantPermission(db, principalId, "automation:connector:slack");
      setAutomationExecutionBudget(
        db,
        flow.id,
        { windowMs: 3_600_000, maxRuns: 3, maxActionSteps: 3 },
        { now: () => now },
      );
    }
    return { db, flowId: flow.id };
  }

  it("projects flows, scoped triggers, history, actions and live authority", () => {
    const f = fixture();
    const projection = buildAutomationCenterProjection(f.db, {
      now: () => now,
    });

    expect(projection).toMatchObject({
      schema: "chainlesschain.automation-center/v1",
      schemaVersion: 1,
      authority: "cli",
      connected: true,
      summary: { total: 1, active: 1, paused: 0, needsAttention: 0 },
    });
    const flow = projection.flows[0];
    expect(flow.security).toMatchObject({
      state: "ready",
      principalId,
      connectors: ["slack"],
      budget: { remainingRuns: 3, remainingActionSteps: 3 },
    });
    expect(flow.triggers[0]).toMatchObject({
      type: "event",
      enabled: true,
      scope: { origins: ["telegram"], senders: ["ops-room"] },
    });
    expect(
      flow.actions.find((action) => action.id === "run_now"),
    ).toMatchObject({
      available: true,
      preview: { executor: "cli", mutates: true },
    });
  });

  it("fails closed when principal, permissions or budget are not configured", () => {
    const f = fixture({ configure: false });
    const flow = buildAutomationCenterProjection(f.db, {
      now: () => now,
    }).flows[0];
    expect(flow.security).toMatchObject({
      ready: false,
      state: "unconfigured",
      issue: { code: "AUTOMATION_EXECUTION_BUDGET_REQUIRED" },
    });
    expect(
      flow.actions.find((action) => action.id === "run_now"),
    ).toMatchObject({
      available: false,
      preview: null,
    });
  });

  it("uses item-revision CAS for run-now, pause and resume", () => {
    const f = fixture();
    let flow = buildAutomationCenterProjection(f.db, {
      now: () => now,
    }).flows[0];
    expect(() =>
      runAutomationCenterAction(f.db, {
        flowId: f.flowId,
        action: "pause",
        expectedRevision: "sha256:stale",
        now: () => now,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "AUTOMATION_CENTER_STALE" }),
    );

    const run = runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "run_now",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(run.result.status).toBe("success");

    flow = buildAutomationCenterProjection(f.db, { now: () => now }).flows[0];
    runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "pause",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(getFlow(f.db, f.flowId).status).toBe(FLOW_STATUS.PAUSED);

    flow = buildAutomationCenterProjection(f.db, { now: () => now }).flows[0];
    runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "resume",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(getFlow(f.db, f.flowId).status).toBe(FLOW_STATUS.ACTIVE);
  });

  it("keeps revisions stable across generatedAt-only changes", () => {
    const f = fixture();
    const first = buildAutomationCenterProjection(f.db, { now: () => now });
    const second = buildAutomationCenterProjection(f.db, {
      now: () => now + 1_000,
    });
    expect(second.revision).toBe(first.revision);
    expect(second.flows[0].revision).toBe(first.flows[0].revision);
  });
});
