import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runAutomationChannelEvent } from "../../src/commands/automation.js";
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
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
    });
    const flow = updateFlowStatus(f.db, created.id, FLOW_STATUS.ACTIVE);
    const trigger = addTrigger(f.db, flow.id, {
      type: TRIGGER_TYPE.EVENT,
      config: { event: "channel.event", scope },
    });
    return { flow, trigger };
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
    const job = buildAutomationEventJob(flow, trigger);

    expect(job).toMatchObject({
      kind: AUTOMATION_EVENT_KIND,
      enabled: true,
      trigger: {
        channel: "channel_event",
        type: "channel.event",
        origins: ["webhook"],
      },
      authority: {
        principal: { type: "automation", id: flow.id },
        requestedCapabilities: [AUTOMATION_EVENT_CAPABILITY],
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
    const occurrence = enqueueAutomationChannelEvent(
      f.schedulerStore,
      flow,
      trigger,
      event,
    );
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
    const occurrence = enqueueAutomationChannelEvent(
      f.schedulerStore,
      flow,
      trigger,
      event,
    );
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
    const firstOccurrence = enqueueAutomationChannelEvent(
      f.schedulerStore,
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
    const secondOccurrence = enqueueAutomationChannelEvent(
      f.schedulerStore,
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
  });

  it("derives stable trigger and execution identities", () => {
    const f = fixture();
    const event = channelEvent(f);
    expect(automationEventTriggerKey(event)).toMatch(/^channel:[0-9a-f]{64}$/u);
    expect(automationChannelEventDigest(event)).toMatch(/^[0-9a-f]{64}$/u);
  });
});
