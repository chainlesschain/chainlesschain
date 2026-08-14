import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runAutomationChannelEvent } from "../../src/commands/automation.js";
import {
  automationExecutionAuthoritySnapshot,
  setAutomationExecutionBudget,
} from "../../src/lib/automation-execution-authority.js";
import { listAutomationExecutionIncidents } from "../../src/lib/automation-execution-incident.js";
import {
  EXECUTION_STATUS,
  FLOW_STATUS,
  TRIGGER_TYPE,
  addTrigger,
  createFlow,
  ensureAutomationTables,
  getExecution,
  listExecutions,
  updateFlowStatus,
} from "../../src/lib/automation-engine.js";
import {
  grantPermission,
  revokePermission,
} from "../../src/lib/permission-engine.js";
import {
  AUTOMATION_EVENT_CAPABILITY,
  AUTOMATION_EVENT_KIND,
  AutomationEventDispatcher,
  authorizeAutomationEventOccurrence,
  automationChannelEventDigest,
  automationEventExecutionId,
  automationEventTriggerKey,
  buildAutomationEventJob,
  createAutomationEventAdapter,
  enqueueAutomationChannelEvent,
  matchesAutomationChannelEvent,
} from "../../src/lib/scheduler-kernel/automation-event-adapter.js";
import { SchedulerRuntime } from "../../src/lib/scheduler-kernel/runtime.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel automation channel event adapter", () => {
  const cleanups = [];
  const principalId = "did:test:automation-event-owner";

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
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  function activeEventDefinition(f, scope = { origins: ["webhook"] }) {
    const created = createFlow(f.db, {
      name: "channel event flow",
      createdBy: principalId,
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
    });
    grantPermission(f.db, principalId, "automation:execute");
    grantPermission(f.db, principalId, "automation:connector:slack");
    setAutomationExecutionBudget(
      f.db,
      created.id,
      { windowMs: 60 * 60_000, maxRuns: 100, maxActionSteps: 100 },
      { now: () => f.now },
    );
    const flow = updateFlowStatus(f.db, created.id, FLOW_STATUS.ACTIVE);
    const trigger = addTrigger(f.db, flow.id, {
      type: TRIGGER_TYPE.EVENT,
      config: { event: "channel.event", scope },
    });
    return { flow, trigger };
  }

  function executionAuthority(f, flow) {
    return automationExecutionAuthoritySnapshot(f.db, flow);
  }

  function enqueue(f, flow, trigger, event) {
    return enqueueAutomationChannelEvent(
      f.schedulerStore,
      flow,
      trigger,
      event,
      executionAuthority(f, flow),
    );
  }

  function channelEvent(f, overrides = {}) {
    return {
      id: "event-1",
      type: "channel.event",
      origin: "webhook",
      sender: "ci",
      text: "build completed",
      meta: { repository: "chainlesschain" },
      producedAt: f.now,
      ...overrides,
    };
  }

  it("requires explicit origin scope and binds least-capability authority", () => {
    const f = fixture();
    const { flow, trigger } = activeEventDefinition(f, {
      origins: ["webhook"],
      senders: ["ci"],
    });
    const event = channelEvent(f);
    const job = buildAutomationEventJob(
      flow,
      trigger,
      executionAuthority(f, flow),
    );

    expect(job).toMatchObject({
      kind: AUTOMATION_EVENT_KIND,
      enabled: true,
      trigger: {
        channel: "channel_event",
        type: "channel.event",
        origins: ["webhook"],
      },
      authority: {
        principal: { type: "user", id: principalId },
        requestedCapabilities: [
          "automation.connector.slack",
          AUTOMATION_EVENT_CAPABILITY,
        ],
      },
    });
    expect(matchesAutomationChannelEvent(trigger, event)).toBe(true);
    expect(
      matchesAutomationChannelEvent(trigger, {
        ...event,
        sender: "untrusted",
      }),
    ).toBe(false);
    expect(() =>
      buildAutomationEventJob(flow, {
        ...trigger,
        config: { event: "channel.event" },
      }),
    ).toThrow(/scope is required/u);
  });

  it("dispatches one matching channel event through a durable occurrence", async () => {
    const f = fixture();
    const { flow } = activeEventDefinition(f, {
      origins: ["webhook"],
      senders: ["ci"],
    });
    activeEventDefinition(f, { origins: ["telegram"] });
    const event = channelEvent(f);
    const dispatcher = new AutomationEventDispatcher({
      db: f.db,
      schedulerStore: f.schedulerStore,
      ownerId: "automation-event-owner",
      leaseMs: 10_000,
    });

    const dispatched = await dispatcher.dispatch(event);
    expect(dispatched).toMatchObject({
      eventId: "event-1",
      matched: 1,
      rejected: [],
      results: [
        {
          flowId: flow.id,
          deduplicated: false,
          result: { status: "succeeded" },
        },
      ],
    });
    const executions = listExecutions(f.db, { flowId: flow.id });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      status: EXECUTION_STATUS.SUCCESS,
      triggerType: TRIGGER_TYPE.EVENT,
      inputData: { event },
    });
  });

  it("exposes the production channel-event command path", async () => {
    const f = fixture();
    const { flow } = activeEventDefinition(f);
    const output = [];

    const summary = await runAutomationChannelEvent(
      f.db,
      {
        eventId: "event-command-1",
        origin: "webhook",
        sender: "ci",
        text: "deploy completed",
        meta: { environment: "staging" },
        producedAt: f.now,
        leaseMs: 10_000,
        json: true,
      },
      {
        schedulerStore: f.schedulerStore,
        ownerId: "automation-event-command",
        log: (line) => output.push(line),
      },
    );

    expect(summary).toMatchObject({
      eventId: "event-command-1",
      matched: 1,
      executions: [{ flowId: flow.id, status: "succeeded" }],
    });
    expect(JSON.parse(output.join("\n"))).toMatchObject({
      eventId: "event-command-1",
      matched: 1,
    });
  });

  it("deduplicates a replay and rejects event-id content collisions", async () => {
    const f = fixture();
    const { flow } = activeEventDefinition(f);
    const event = channelEvent(f);
    const dispatcher = new AutomationEventDispatcher({
      db: f.db,
      schedulerStore: f.schedulerStore,
      ownerId: "automation-event-dedupe",
      leaseMs: 10_000,
    });

    const first = await dispatcher.dispatch(event);
    const replay = await dispatcher.dispatch(event);
    expect(first.results[0].occurrenceId).toBe(replay.results[0].occurrenceId);
    expect(replay.results[0]).toMatchObject({
      deduplicated: true,
      result: { status: "succeeded", alreadySettled: true },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);

    await expect(
      dispatcher.dispatch({ ...event, text: "different content" }),
    ).rejects.toMatchObject({ code: "AUTOMATION_EVENT_ID_COLLISION" });
    await expect(
      dispatcher.dispatch({
        ...event,
        text: "different content and timestamp",
        producedAt: event.producedAt + 1,
      }),
    ).rejects.toMatchObject({ code: "AUTOMATION_EVENT_ID_COLLISION" });
    expect(
      f.schedulerStore.listOccurrencesByTrigger({
        jobId: f.schedulerStore.getOccurrence(first.results[0].occurrenceId)
          .jobId,
        triggerKey: automationEventTriggerKey(event),
      }),
    ).toHaveLength(1);
  });

  it("fails closed when the trigger definition changes after enqueue", async () => {
    const f = fixture();
    const { flow, trigger } = activeEventDefinition(f);
    const event = channelEvent(f);
    const occurrence = enqueue(f, flow, trigger, event);
    f.db.prepare("UPDATE auto_triggers SET config = ? WHERE id = ?").run(
      JSON.stringify({
        event: "channel.event",
        scope: { origins: ["webhook"], senders: ["release-bot"] },
      }),
      trigger.id,
    );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationEventAdapter({ db: f.db })],
      authorize: authorizeAutomationEventOccurrence,
      ownerId: "automation-event-stale",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_EVENT_STALE_SNAPSHOT" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("rejects tampered event payloads before adapter execution", async () => {
    const f = fixture();
    const { flow, trigger } = activeEventDefinition(f);
    const event = channelEvent(f);
    const occurrence = enqueue(f, flow, trigger, event);
    f.schedulerStore.db
      .prepare(
        "UPDATE occurrences SET payload_json = ? WHERE occurrence_id = ?",
      )
      .run(
        JSON.stringify({
          ...occurrence.payload,
          event: { ...event, text: "tampered" },
          eventDigest: automationChannelEventDigest(event),
        }),
        occurrence.id,
      );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationEventAdapter({ db: f.db })],
      authorize: authorizeAutomationEventOccurrence,
      ownerId: "automation-event-tamper",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("recovers committed success and dead-letters start-only evidence", async () => {
    const f = fixture();
    const first = activeEventDefinition(f);
    const firstOccurrence = enqueue(
      f,
      first.flow,
      first.trigger,
      channelEvent(f),
    );
    const firstExecutionId = automationEventExecutionId(firstOccurrence.id);
    f.db
      .prepare(
        `INSERT INTO auto_executions
         (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
          duration_ms, error, test_mode, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        firstExecutionId,
        first.flow.id,
        TRIGGER_TYPE.EVENT,
        "{}",
        "{}",
        EXECUTION_STATUS.SUCCESS,
        "[]",
        0,
        null,
        0,
        new Date(f.now).toISOString(),
        new Date(f.now).toISOString(),
      );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationEventAdapter({ db: f.db })],
      authorize: authorizeAutomationEventOccurrence,
      ownerId: "automation-event-recovery",
      leaseMs: 10_000,
    });
    await expect(
      runtime.runOccurrence(firstOccurrence.id),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { id: firstExecutionId },
    });

    const second = activeEventDefinition(f);
    const secondEvent = channelEvent(f, { id: "event-2" });
    const secondOccurrence = enqueue(
      f,
      second.flow,
      second.trigger,
      secondEvent,
    );
    const secondExecutionId = automationEventExecutionId(secondOccurrence.id);
    f.db
      .prepare(
        `INSERT INTO auto_executions
         (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
          duration_ms, error, test_mode, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        secondExecutionId,
        second.flow.id,
        TRIGGER_TYPE.EVENT,
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
    await expect(
      runtime.runOccurrence(secondOccurrence.id),
    ).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_EVENT_OUTCOME_UNKNOWN" },
    });
    expect(getExecution(f.db, secondExecutionId)).toMatchObject({
      status: EXECUTION_STATUS.RUNNING,
    });

    const candidate = f.schedulerStore.getAdjudicationCase(secondOccurrence.id);
    f.schedulerStore.adjudicateOccurrence({
      occurrenceId: secondOccurrence.id,
      decision: "confirmed_not_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: candidate.attempt,
      expectedFence: candidate.fence,
      reasonDigest: `sha256:${"4".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    await expect(
      runtime.runOccurrence(secondOccurrence.id),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { id: secondExecutionId, status: EXECUTION_STATUS.SUCCESS },
    });
    expect(getExecution(f.db, secondExecutionId)).toMatchObject({
      status: EXECUTION_STATUS.SUCCESS,
    });
    expect(listExecutions(f.db, { flowId: second.flow.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secondExecutionId,
          status: EXECUTION_STATUS.SUCCESS,
        }),
        expect.objectContaining({ status: EXECUTION_STATUS.CANCELLED }),
      ]),
    );
    expect(
      f.schedulerStore.getOccurrenceAdjudication(secondOccurrence.id),
    ).toMatchObject({ status: "applied" });
  });

  it("derives stable trigger and execution identities", () => {
    const f = fixture();
    const event = channelEvent(f);
    expect(automationEventTriggerKey(event)).toMatch(/^channel:[0-9a-f]{64}$/u);
    expect(automationChannelEventDigest(event)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("denies a scoped channel event when live connector authority is revoked", async () => {
    const f = fixture();
    const { flow } = activeEventDefinition(f);
    revokePermission(f.db, principalId, "automation:connector:slack");
    const dispatcher = new AutomationEventDispatcher({
      db: f.db,
      schedulerStore: f.schedulerStore,
      ownerId: "automation-event-revoked",
      leaseMs: 10_000,
      now: () => f.now,
    });

    await expect(dispatcher.dispatch(channelEvent(f))).resolves.toMatchObject({
      matched: 1,
      rejected: [],
      results: [
        {
          flowId: flow.id,
          result: {
            status: "dead_letter",
            error: { code: "AUTOMATION_EXECUTION_PERMISSION_DENIED" },
          },
        },
      ],
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
    const incident = listAutomationExecutionIncidents(f.db, {
      flowId: flow.id,
      status: "open",
    })[0];
    expect(incident).toMatchObject({
      occurrenceId: expect.stringMatching(/^occ_/u),
      triggerType: "event",
      category: "connector",
      code: "AUTOMATION_EXECUTION_PERMISSION_DENIED",
    });
    expect(incident.runId).toBe(
      automationEventExecutionId(incident.occurrenceId),
    );

    grantPermission(f.db, principalId, "automation:connector:slack");
    const deadLetter = f.schedulerStore.getOccurrence(incident.occurrenceId);
    f.schedulerStore.requeueDeadLetter({
      occurrenceId: incident.occurrenceId,
      expectedFence: deadLetter.fence,
      expectedErrorCode: incident.code,
      requestId: "retry-revoked-event-incident",
    });
    const retryRuntime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationEventAdapter({ db: f.db, now: () => f.now })],
      authorize: authorizeAutomationEventOccurrence,
      ownerId: "automation-event-restored",
      leaseMs: 10_000,
    });
    await expect(
      retryRuntime.runOccurrence(incident.occurrenceId),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { id: incident.runId },
    });
    expect(listAutomationExecutionIncidents(f.db, { flowId: flow.id })).toEqual(
      [
        expect.objectContaining({
          runId: incident.runId,
          status: "resolved",
          resolutionCode: "EXECUTION_SUCCEEDED",
        }),
      ],
    );
  });
});
