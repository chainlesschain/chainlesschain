import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAutomationCenterProjection,
  runAutomationCenterAction,
} from "../../src/lib/automation-center.js";
import {
  createAutomationCenterRoutine,
  editAutomationCenterRoutine,
  runAutomationCenterRoutineAction,
} from "../../src/lib/automation-center-routines.js";
import { RoutineStore } from "../../src/lib/routine-store.js";
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
    const routineDir = mkdtempSync(join(tmpdir(), "cc-center-routines-"));
    cleanups.push(() => rmSync(routineDir, { recursive: true, force: true }));
    const routineStore = new RoutineStore({
      dir: routineDir,
      now: () => now,
    });
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
    return { db, flowId: flow.id, routineStore };
  }

  function projection(f, options = {}) {
    return buildAutomationCenterProjection(f.db, {
      routineStore: f.routineStore,
      now: () => now,
      ...options,
    });
  }

  it("projects flows, scoped triggers, history, actions and live authority", () => {
    const f = fixture();
    const center = projection(f);

    expect(center).toMatchObject({
      schema: "chainlesschain.automation-center/v2",
      schemaVersion: 2,
      authority: "cli",
      connected: true,
      summary: {
        total: 1,
        flows: 1,
        routines: 0,
        active: 1,
        paused: 0,
        needsAttention: 0,
      },
    });
    const flow = center.items[0];
    expect(flow.kind).toBe("flow");
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
    expect(flow.actions.map((action) => action.id)).toEqual([
      "run_now",
      "retry_failed",
      "pause",
      "resume",
      "disable",
      "delete",
    ]);
  });

  it("fails closed when principal, permissions or budget are not configured", () => {
    const f = fixture({ configure: false });
    const flow = projection(f).items[0];
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

  it("uses item-revision CAS for run-now, lifecycle and delete actions", () => {
    const f = fixture();
    let flow = projection(f).items[0];
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

    flow = projection(f).items[0];
    runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "pause",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(getFlow(f.db, f.flowId).status).toBe(FLOW_STATUS.PAUSED);

    flow = projection(f).items[0];
    runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "resume",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(getFlow(f.db, f.flowId).status).toBe(FLOW_STATUS.ACTIVE);

    flow = projection(f).items[0];
    runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "disable",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(getFlow(f.db, f.flowId).status).toBe(FLOW_STATUS.ARCHIVED);

    flow = projection(f).items[0];
    const removed = runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "delete",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(removed.result).toEqual({ deleted: true });
    expect(getFlow(f.db, f.flowId)).toBeNull();
    expect(
      f.db
        .prepare("SELECT flow_id FROM auto_execution_budgets WHERE flow_id = ?")
        .get(f.flowId),
    ).toBeUndefined();
  });

  it("only offers retry for the latest failed run and binds it to that run", () => {
    const f = fixture();
    const failedId = "exec-failed-center";
    f.db
      .prepare(
        `INSERT INTO auto_executions
         (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
          duration_ms, error, test_mode, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        failedId,
        f.flowId,
        "manual",
        '{"ticket":"INC-42"}',
        null,
        "failed",
        "[]",
        1,
        "temporary failure",
        0,
        "2026-08-12T00:00:00.000Z",
        "2026-08-12T00:00:00.001Z",
      );
    const flow = projection(f).items[0];
    expect(
      flow.actions.find((action) => action.id === "retry_failed"),
    ).toMatchObject({ available: true });
    const retried = runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "retry_failed",
      expectedRevision: flow.revision,
      now: () => now,
    });
    expect(retried.retryOf).toBe(failedId);
    expect(retried.result.inputData).toEqual({ ticket: "INC-42" });
  });

  it("keeps revisions stable across generatedAt-only changes", () => {
    const f = fixture();
    const first = projection(f);
    const second = projection(f, { now: () => now + 1_000 });
    expect(second.revision).toBe(first.revision);
    expect(second.items[0].revision).toBe(first.items[0].revision);
  });

  it("projects Routine one-shot/GitHub definitions and revision-gates create/edit/lifecycle", async () => {
    const f = fixture();
    const initial = projection(f);
    expect(initial.mutations.createRoutine.preview).toMatchObject({
      stdin: "json",
      argv: [
        "automation",
        "center-routine-create",
        "--expected-revision",
        initial.routineCatalogRevision,
        "--json-stdin",
        "--json",
      ],
    });
    const created = createAutomationCenterRoutine(f.routineStore, {
      expectedRevision: initial.routineCatalogRevision,
      definition: {
        name: "Release watcher",
        prompt: "Summarize the release event",
        trigger: {
          kind: "github",
          repo: "acme/app",
          events: ["PushEvent", "ReleaseEvent"],
        },
      },
    });
    expect(() =>
      createAutomationCenterRoutine(f.routineStore, {
        expectedRevision: initial.routineCatalogRevision,
        definition: {
          name: "stale",
          prompt: "must fail",
          trigger: { kind: "webhook" },
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "ROUTINE_REVISION_CONFLICT" }),
    );

    let center = projection(f);
    let routine = center.items.find((item) => item.kind === "routine");
    expect(routine).toMatchObject({
      id: created.routineId,
      status: "active",
      definition: {
        trigger: { kind: "github", repo: "acme/app" },
      },
      security: { state: "snapshot_bound", ready: true },
    });
    expect(
      routine.actions.find((action) => action.id === "edit").preview,
    ).toMatchObject({
      stdin: "json",
    });

    editAutomationCenterRoutine(f.routineStore, {
      routineId: routine.id,
      expectedRevision: routine.revision,
      definition: {
        name: "One shot release summary",
        prompt: "Summarize once",
        trigger: { kind: "once", at: now + 60_000 },
      },
    });
    center = projection(f);
    routine = center.items.find((item) => item.kind === "routine");
    expect(routine).toMatchObject({
      name: "One shot release summary",
      schedule: new Date(now + 60_000).toISOString(),
      definition: { trigger: { kind: "once", at: now + 60_000 } },
    });

    const triggerRoutine = vi.fn(async (snapshot) => ({
      runId: `run-${snapshot.id}`,
      status: "ok",
    }));
    const fired = await runAutomationCenterRoutineAction(f.routineStore, {
      routineId: routine.id,
      action: "run_now",
      expectedRevision: routine.revision,
      triggerRoutine,
    });
    expect(fired.result).toEqual({ runId: `run-${routine.id}`, status: "ok" });
    expect(triggerRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: routine.id, prompt: "Summarize once" }),
    );

    await runAutomationCenterRoutineAction(f.routineStore, {
      routineId: routine.id,
      action: "pause",
      expectedRevision: routine.revision,
    });
    routine = projection(f).items.find((item) => item.kind === "routine");
    expect(routine.status).toBe("paused");
    expect(() =>
      editAutomationCenterRoutine(f.routineStore, {
        routineId: routine.id,
        expectedRevision: "sha256:stale",
        definition: routine.definition,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "ROUTINE_REVISION_CONFLICT" }),
    );
  });
});
