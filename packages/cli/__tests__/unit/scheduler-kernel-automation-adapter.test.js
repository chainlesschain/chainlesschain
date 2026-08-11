import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runAutomationScheduled } from "../../src/commands/automation.js";
import {
  EXECUTION_STATUS,
  FLOW_STATUS,
  TRIGGER_TYPE,
  createFlow,
  ensureAutomationTables,
  executeFlow,
  getExecution,
  getFlow,
  listExecutions,
  scheduleFlow,
  updateFlowStatus,
} from "../../src/lib/automation-engine.js";
import {
  AUTOMATION_SCHEDULER_CAPABILITY,
  AutomationSchedulerBridge,
  authorizeAutomationOccurrence,
  automationFlowSnapshotDigest,
  automationSchedulerExecutionId,
  buildAutomationSchedulerJob,
  createAutomationSchedulerAdapter,
  enqueueScheduledAutomation,
} from "../../src/lib/scheduler-kernel/automation-adapter.js";
import { SchedulerRuntime } from "../../src/lib/scheduler-kernel/runtime.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel automation adapter", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture() {
    const db = new Database(":memory:");
    ensureAutomationTables(db);
    let now = Date.now();
    const schedulerStore = openSchedulerStore({
      file: ":memory:",
      Database,
      clock: () => now,
    });
    cleanups.push(() => schedulerStore.close());
    cleanups.push(() => db.close());
    return {
      db,
      schedulerStore,
      clock: () => now,
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  function activeScheduledFlow(f, cron = "* * * * *") {
    const created = createFlow(f.db, {
      name: "scheduled flow",
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
    });
    scheduleFlow(f.db, created.id, cron);
    const active = updateFlowStatus(f.db, created.id, FLOW_STATUS.ACTIVE);
    f.now = Date.parse(active.updatedAt) + 10 * 60_000;
    return active;
  }

  it("binds a canonical flow snapshot and least-capability authority", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const job = buildAutomationSchedulerJob(flow);

    expect(job).toMatchObject({
      kind: "automation",
      enabled: true,
      maxAttempts: 3,
      trigger: { channel: "scheduled", cron: "* * * * *" },
      authority: {
        principal: { type: "automation", id: flow.id },
        requestedCapabilities: [AUTOMATION_SCHEDULER_CAPABILITY],
      },
      payload: {
        channel: "scheduled",
        flow: expect.objectContaining({ id: flow.id, status: "active" }),
      },
    });
    expect(job.payload.snapshotDigest).toBe(
      automationFlowSnapshotDigest(job.payload.flow),
    );
    const occurrence = {
      payload: job.payload,
      authority: job.authority,
    };
    expect(authorizeAutomationOccurrence({ job, occurrence })).toEqual({
      allowed: true,
      reason: "automation_snapshot_bound",
    });
  });

  it("runs one catch-up occurrence and records durable automation history", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const bridge = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-owner",
      leaseMs: 10_000,
    });

    const first = await bridge.runDue();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      flow: flow.id,
      result: { status: "succeeded" },
    });
    const executions = listExecutions(f.db, { flowId: flow.id });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      status: EXECUTION_STATUS.SUCCESS,
      triggerType: TRIGGER_TYPE.SCHEDULE,
    });

    await expect(bridge.runDue()).resolves.toEqual([]);
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("exposes the production run-scheduled command path", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const output = [];

    await expect(
      runAutomationScheduled(
        f.db,
        { json: true, leaseMs: 10_000 },
        {
          schedulerStore: f.schedulerStore,
          now: f.clock,
          ownerId: "automation-command-owner",
          log: (line) => output.push(line),
        },
      ),
    ).resolves.toBe(0);
    const summary = JSON.parse(output.join("\n"));
    expect(summary).toMatchObject({
      due: 1,
      executions: [
        {
          flow: flow.id,
          status: "succeeded",
          recovered: false,
        },
      ],
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("deduplicates two live drivers for the same logical cron occurrence", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const first = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-contender-a",
      leaseMs: 10_000,
    });
    const second = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-contender-b",
      leaseMs: 10_000,
    });

    await Promise.all([first.runDue(), second.runDue()]);
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("resets the cron cursor when a schedule definition is edited", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const first = enqueueScheduledAutomation(f.schedulerStore, flow, f.now);
    const editedAt = f.now + 60 * 60_000;
    f.db
      .prepare(
        "UPDATE auto_flows SET schedule = ?, updated_at = ? WHERE id = ?",
      )
      .run("* * * * *", new Date(editedAt).toISOString(), flow.id);
    f.now = editedAt + 2 * 60_000;

    const second = enqueueScheduledAutomation(
      f.schedulerStore,
      getFlow(f.db, flow.id),
      f.now,
    );
    expect(second.id).not.toBe(first.id);
    expect(second.scheduledFor).toBeGreaterThan(editedAt);
  });

  it("rejects a queued occurrence when the flow is paused before execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueueScheduledAutomation(
      f.schedulerStore,
      flow,
      f.now,
    );
    updateFlowStatus(f.db, flow.id, FLOW_STATUS.PAUSED);
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-paused-owner",
      leaseMs: 10_000,
    });

    const result = await runtime.runOccurrence(occurrence.id);
    expect(result).toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_SCHEDULER_FLOW_NOT_ACTIVE" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("rejects a stale flow snapshot before connector execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueueScheduledAutomation(
      f.schedulerStore,
      flow,
      f.now,
    );
    scheduleFlow(f.db, flow.id, "*/2 * * * *");
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-stale-owner",
      leaseMs: 10_000,
    });

    const result = await runtime.runOccurrence(occurrence.id);
    expect(result).toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_SCHEDULER_STALE_SNAPSHOT" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("recovers committed success without executing the flow twice", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueueScheduledAutomation(
      f.schedulerStore,
      flow,
      f.now,
    );
    const executionId = automationSchedulerExecutionId(occurrence.id);
    executeFlow(f.db, flow.id, {
      triggerType: TRIGGER_TYPE.SCHEDULE,
      executionId,
    });
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      result: { id: executionId },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("dead-letters a start-only execution as outcome unknown", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueueScheduledAutomation(
      f.schedulerStore,
      flow,
      f.now,
    );
    const executionId = automationSchedulerExecutionId(occurrence.id);
    f.db
      .prepare(
        `INSERT INTO auto_executions
         (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
          duration_ms, error, test_mode, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        executionId,
        flow.id,
        TRIGGER_TYPE.SCHEDULE,
        "{}",
        null,
        EXECUTION_STATUS.RUNNING,
        "[]",
        0,
        null,
        0,
        new Date(f.now).toISOString(),
        null,
      );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-unknown-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_SCHEDULER_OUTCOME_UNKNOWN" },
    });
    expect(getExecution(f.db, executionId)).toMatchObject({
      status: EXECUTION_STATUS.RUNNING,
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("rejects a tampered authority envelope before adapter execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueueScheduledAutomation(
      f.schedulerStore,
      flow,
      f.now,
    );
    f.schedulerStore.db
      .prepare(
        "UPDATE occurrences SET authority_json = ? WHERE occurrence_id = ?",
      )
      .run(
        JSON.stringify({
          ...occurrence.authority,
          requestedCapabilities: ["automation.admin"],
        }),
        occurrence.id,
      );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-denied-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });
});
