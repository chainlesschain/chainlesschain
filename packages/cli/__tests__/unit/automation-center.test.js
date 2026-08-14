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
import {
  listAutomationExecutionIncidents,
  upsertAutomationExecutionIncident,
} from "../../src/lib/automation-execution-incident.js";
import { grantPermission } from "../../src/lib/permission-engine.js";
import { CHECKPOINT_V1_RUNTIME_CONTROL } from "../../src/lib/scheduler-kernel/runtime-control-capabilities.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

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

  function runningRuntimeStore() {
    const schedulerDir = mkdtempSync(join(tmpdir(), "cc-center-runtime-root-"));
    const schedulerStore = openSchedulerStore({
      file: join(schedulerDir, "scheduler.db"),
      Database,
      clock: () => now,
    });
    cleanups.push(() => rmSync(schedulerDir, { recursive: true, force: true }));
    cleanups.push(() => schedulerStore.close());
    const authority = {
      schemaVersion: 1,
      principal: { type: "agent", id: "runtime-principal-must-not-leak" },
      tenantId: "runtime-tenant-must-not-leak",
      workspaceId: "runtime-workspace-must-not-leak",
      requestedCapabilities: ["runtime.capability.must-not-leak"],
      authorizationRefs: {
        decisionId: "runtime-decision-must-not-leak",
        policyRevision: "runtime-policy-must-not-leak",
        grantIds: [],
        approvalIds: [],
        delegationIds: [],
      },
    };
    schedulerStore.createJob({
      id: "center-runtime-job",
      kind: "automation",
      trigger: { type: "schedule" },
      payload: { secret: "runtime-payload-must-not-leak" },
      authority,
      maxAttempts: 3,
    });
    const occurrence = schedulerStore.enqueueOccurrence({
      jobId: "center-runtime-job",
      scheduledFor: now,
      triggerKey: "center-runtime:root-projection",
    });
    const claim = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "runtime-owner-must-not-leak",
      leaseMs: 60_000,
    });
    schedulerStore.db
      .prepare(
        "UPDATE occurrences SET last_error_json = ? WHERE occurrence_id = ?",
      )
      .run('{"body":"runtime-error-must-not-leak"}', occurrence.id);
    schedulerStore.createJob({
      id: "unsupported-runtime-job",
      kind: "unsupported-runtime-kind",
      trigger: { type: "private" },
      payload: { secret: "unsupported-payload-must-not-leak" },
      authority,
      maxAttempts: 1,
    });
    const unsupportedOccurrence = schedulerStore.enqueueOccurrence({
      jobId: "unsupported-runtime-job",
      scheduledFor: now,
      triggerKey: "center-runtime:unsupported",
    });
    schedulerStore.claimOccurrence({
      occurrenceId: unsupportedOccurrence.id,
      ownerId: "unsupported-owner-must-not-leak",
      leaseMs: 60_000,
    });
    return { schedulerStore, occurrence, claim };
  }

  it("projects flows, scoped triggers, history, actions and live authority", () => {
    const f = fixture();
    const center = projection(f);

    expect(center).toMatchObject({
      schema: "chainlesschain.automation-center/v3",
      schemaVersion: 3,
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

  it("defaults the root projection to an empty v1 scheduler runtime", () => {
    const center = projection(fixture());

    expect(center.runtime).toEqual({
      schema: "chainlesschain.automation-center-runtime/v1",
      schemaVersion: 1,
      items: [],
    });
    expect(center.summary).toMatchObject({
      runtimeRunning: 0,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    });
  });

  it("projects running scheduler controls into the root revision without leaking execution evidence", () => {
    const f = fixture();
    const runtime = runningRuntimeStore();
    const initial = projection(f, {
      schedulerStore: runtime.schedulerStore,
    });

    expect(initial.runtime).toMatchObject({
      schema: "chainlesschain.automation-center-runtime/v1",
      schemaVersion: 1,
      items: [
        {
          id: runtime.occurrence.id,
          jobId: "center-runtime-job",
          jobKind: "automation",
          status: "running",
          occurrenceStatus: "running",
          attempt: 1,
          fence: runtime.claim.fence,
          controlRevision: 0,
          runtimeControl: {
            pauseResume: "checkpoint_v1",
            safePoints: ["adapter_checkpoint", "before_execute"],
          },
        },
      ],
    });
    expect(initial.summary).toMatchObject({
      runtimeRunning: 1,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    });
    const unsupported = projection(f, {
      schedulerStore: runtime.schedulerStore,
      runtimeCapabilityForKind: () => ({
        schemaVersion: 1,
        pauseResume: "none",
        safePoints: [],
      }),
    });
    expect(unsupported.revision).not.toBe(initial.revision);
    expect(unsupported.runtime.items[0]).toMatchObject({
      runtimeControl: null,
      actions: [
        expect.objectContaining({
          id: "pause",
          available: false,
          preview: null,
        }),
        expect.objectContaining({
          id: "resume",
          available: false,
          preview: null,
        }),
      ],
    });

    const requested = runtime.schedulerStore.requestOccurrencePause({
      occurrenceId: runtime.occurrence.id,
      expectedFence: runtime.claim.fence,
      requestId: "center-root-pause",
      capability: CHECKPOINT_V1_RUNTIME_CONTROL,
    });
    const pauseRequested = projection(f, {
      schedulerStore: runtime.schedulerStore,
    });
    expect(pauseRequested.revision).not.toBe(initial.revision);
    expect(pauseRequested.runtime.items[0]).toMatchObject({
      status: "pause_requested",
      fence: runtime.claim.fence,
      controlRevision: requested.revision,
    });
    expect(pauseRequested.summary).toMatchObject({
      runtimeRunning: 0,
      runtimePauseRequested: 1,
      runtimePaused: 0,
    });

    const paused = runtime.schedulerStore.ackOccurrencePause({
      occurrenceId: runtime.occurrence.id,
      ownerId: "runtime-owner-must-not-leak",
      fence: runtime.claim.fence,
      requestId: "center-root-pause",
      expectedRevision: requested.revision,
      safePoint: "adapter_checkpoint",
      checkpoint: { secret: "runtime-checkpoint-must-not-leak" },
    });
    runtime.schedulerStore.resumeOccurrence({
      occurrenceId: runtime.occurrence.id,
      expectedRevision: paused.control.revision,
      requestId: "center-root-resume",
    });
    const reclaimed = runtime.schedulerStore.claimOccurrence({
      occurrenceId: runtime.occurrence.id,
      ownerId: "runtime-resume-owner-must-not-leak",
      leaseMs: 60_000,
    });
    const resumed = projection(f, {
      schedulerStore: runtime.schedulerStore,
    });
    expect(resumed.revision).not.toBe(pauseRequested.revision);
    const resumedControl = runtime.schedulerStore.getOccurrenceControl(
      runtime.occurrence.id,
    );
    expect(resumed.runtime.items[0]).toMatchObject({
      status: "running",
      attempt: 1,
      fence: reclaimed.fence,
      controlRevision: resumedControl.revision,
    });
    expect(resumedControl.revision).toBeGreaterThan(requested.revision);
    expect(reclaimed.fence).not.toBe(runtime.claim.fence);
    expect(resumed.summary).toMatchObject({
      runtimeRunning: 1,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    });

    const runtimeItem = resumed.runtime.items[0];
    for (const field of [
      "payload",
      "authority",
      "owner",
      "ownerId",
      "leaseOwner",
      "checkpoint",
      "error",
      "lastError",
    ]) {
      expect(runtimeItem).not.toHaveProperty(field);
    }
    const encoded = JSON.stringify(resumed);
    for (const secret of [
      "runtime-payload-must-not-leak",
      "runtime-principal-must-not-leak",
      "runtime-tenant-must-not-leak",
      "runtime-workspace-must-not-leak",
      "runtime.capability.must-not-leak",
      "runtime-decision-must-not-leak",
      "runtime-policy-must-not-leak",
      "runtime-owner-must-not-leak",
      "runtime-resume-owner-must-not-leak",
      "runtime-checkpoint-must-not-leak",
      "runtime-error-must-not-leak",
      "unsupported-payload-must-not-leak",
      "unsupported-owner-must-not-leak",
    ]) {
      expect(encoded).not.toContain(secret);
    }

    runtime.schedulerStore.settle({
      occurrenceId: runtime.occurrence.id,
      ownerId: "runtime-resume-owner-must-not-leak",
      fence: reclaimed.fence,
      outcome: "succeeded",
      result: { secret: "runtime-result-must-not-leak" },
    });
    const terminal = projection(f, {
      schedulerStore: runtime.schedulerStore,
    });
    expect(terminal.runtime.items).toEqual([]);
    expect(terminal.summary).toMatchObject({
      runtimeRunning: 0,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    });
    expect(JSON.stringify(terminal)).not.toContain(
      "runtime-result-must-not-leak",
    );
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

  it("projects bounded run incidents and counts open incidents as attention", () => {
    const f = fixture();
    upsertAutomationExecutionIncident(f.db, {
      runId: "exec-center-denied",
      flowId: f.flowId,
      occurrenceId: "center-occurrence-denied",
      triggerType: "manual",
      category: "connector",
      code: "AUTOMATION_EXECUTION_PERMISSION_DENIED",
      authorityDigest: "a".repeat(64),
      boundary: {
        deniedPermissions: ["automation:connector:slack"],
      },
      details: { reasonCode: "AUTOMATION_EXECUTION_PERMISSION_DENIED" },
    });
    const center = projection(f);
    expect(center.summary.needsAttention).toBe(1);
    expect(center.items[0].incidents).toEqual([
      expect.objectContaining({
        runId: "exec-center-denied",
        occurrenceId: "center-occurrence-denied",
        category: "connector",
        status: "open",
      }),
    ]);
    expect(JSON.stringify(center)).not.toContain("deniedPermissions");
    expect(
      listAutomationExecutionIncidents(f.db, { flowId: f.flowId }),
    ).toHaveLength(1);
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

  it("holds an immediate transaction across the revision recheck and mutation", () => {
    const f = fixture();
    let observedTransaction = false;
    f.db.function("observe_center_transaction", () => {
      observedTransaction = f.db.inTransaction;
      return 1;
    });
    f.db.exec(`
      CREATE TEMP TRIGGER observe_center_flow_update
      BEFORE UPDATE ON auto_flows
      BEGIN
        SELECT observe_center_transaction();
      END;
    `);
    const flow = projection(f).items[0];

    runAutomationCenterAction(f.db, {
      flowId: f.flowId,
      action: "pause",
      expectedRevision: flow.revision,
      now: () => now,
    });

    expect(observedTransaction).toBe(true);
    expect(f.db.inTransaction).toBe(false);
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
