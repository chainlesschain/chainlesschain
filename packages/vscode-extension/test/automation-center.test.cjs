const assert = require("node:assert/strict");
const test = require("node:test");

const automationCenter = require("../src/automation-center");

const digest = (character) => `sha256:${character.repeat(64)}`;

function unavailableAction(id) {
  return { id, available: false, reason: "unavailable", preview: null };
}

function incidentAction(incidentId, id, available, revision = 1) {
  return {
    id,
    available,
    reason: available ? null : "unavailable",
    preview: available
      ? {
          executor: "cli",
          argv: [
            "automation",
            "center-incident-action",
            incidentId,
            id,
            "--expected-revision",
            String(revision),
            "--json",
          ],
          mutates: true,
        }
      : null,
  };
}

function runtimeAction(occurrenceId, id, available, fence, revision) {
  return {
    id,
    available,
    reason: available ? null : "unavailable",
    preview: available
      ? {
          executor: "cli",
          argv: [
            "automation",
            "center-runtime-action",
            occurrenceId,
            id,
            "--expected-fence",
            String(fence),
            "--expected-control-revision",
            String(revision),
            "--json",
          ],
          mutates: true,
        }
      : null,
  };
}

function fixture() {
  const catalogRevision = digest("d");
  return {
    schema: "chainlesschain.automation-center/v3",
    schemaVersion: 3,
    authority: "cli",
    connected: true,
    revision: digest("a"),
    routineCatalogRevision: catalogRevision,
    summary: {
      total: 1,
      flows: 1,
      routines: 0,
      active: 1,
      paused: 0,
      needsAttention: 1,
      runtimeRunning: 1,
      runtimePauseRequested: 0,
      runtimePaused: 0,
    },
    mutations: {
      createRoutine: {
        available: true,
        reason: null,
        preview: {
          executor: "cli",
          argv: [
            "automation",
            "center-routine-create",
            "--expected-revision",
            catalogRevision,
            "--json-stdin",
            "--json",
          ],
          stdin: "json",
          mutates: true,
        },
      },
    },
    items: [
      {
        kind: "flow",
        id: "flow-1",
        revision: digest("b"),
        name: "Deploy",
        description: "Release flow",
        status: "active",
        schedule: "*/5 * * * *",
        security: {
          state: "ready",
          ready: true,
          principalId: "alice",
          connectors: ["slack"],
          permissions: [],
          budget: { remainingRuns: 2, remainingActionSteps: 2 },
          issue: null,
        },
        triggers: [],
        history: [],
        incidents: [
          {
            incidentId: "e".repeat(64),
            runId: "<run&1>",
            occurrenceId: "occurrence-1",
            triggerType: "manual",
            category: "connector",
            code: "AUTOMATION_EXECUTION_PERMISSION_DENIED",
            status: "open",
            revision: 1,
            createdAtMs: 1_786_600_000_000,
            updatedAtMs: 1_786_600_000_001,
            actions: [
              incidentAction("e".repeat(64), "retry", false),
              incidentAction("e".repeat(64), "cancel", true),
            ],
          },
        ],
        actions: automationCenter.FLOW_ACTIONS.map(unavailableAction),
      },
    ],
    runtime: {
      schema: "chainlesschain.automation-center-runtime/v1",
      schemaVersion: 1,
      items: [
        {
          id: "occurrence-1",
          jobId: "automation:flow-1",
          jobKind: "automation",
          status: "running",
          occurrenceStatus: "running",
          scheduledFor: 1_786_600_000_000,
          attempt: 1,
          maxAttempts: 3,
          fence: 7,
          controlRevision: 0,
          createdAt: 1_786_600_000_000,
          updatedAt: 1_786_600_000_001,
          runtimeControl: {
            pauseResume: "checkpoint_v1",
            safePoints: ["before_execute", "adapter_checkpoint"],
          },
          actions: [
            runtimeAction("occurrence-1", "pause", true, 7, 0),
            runtimeAction("occurrence-1", "resume", false, 7, 0),
          ],
        },
      ],
    },
  };
}

function legacyFixture() {
  const value = fixture();
  value.schema = automationCenter.LEGACY_SCHEMA;
  value.schemaVersion = automationCenter.LEGACY_SCHEMA_VERSION;
  delete value.runtime;
  delete value.summary.runtimeRunning;
  delete value.summary.runtimePauseRequested;
  delete value.summary.runtimePaused;
  delete value.items[0].incidents;
  const revision = value.items[0].revision;
  value.items[0].actions[0] = {
    id: "run_now",
    available: true,
    reason: null,
    preview: {
      executor: "cli",
      argv: [
        "automation",
        "center-action",
        "flow-1",
        "run_now",
        "--expected-revision",
        revision,
        "--json",
      ],
      mutates: true,
    },
  };
  return value;
}

test("accepts strict v3 incident and runtime controls", () => {
  const parsed = automationCenter.parseAutomationCenter(fixture());
  assert.equal(parsed.connected, true);
  assert.equal(automationCenter.SCHEMA_VERSION, 3);
  assert.deepEqual(parsed.items[0].incidents, [
    {
      incidentId: "e".repeat(64),
      runId: "<run&1>",
      occurrenceId: "occurrence-1",
      triggerType: "manual",
      category: "connector",
      code: "AUTOMATION_EXECUTION_PERMISSION_DENIED",
      status: "open",
      revision: 1,
      createdAtMs: 1_786_600_000_000,
      updatedAtMs: 1_786_600_000_001,
      actions: {
        retry: {
          available: false,
          reason: "unavailable",
          preview: null,
        },
        cancel: {
          available: true,
          reason: null,
          preview: {
            executor: "cli",
            argv: [
              "automation",
              "center-incident-action",
              "e".repeat(64),
              "cancel",
              "--expected-revision",
              "1",
              "--json",
            ],
            mutates: true,
          },
        },
      },
    },
  ]);
  assert.equal(parsed.runtimeItems.length, 1);
  assert.deepEqual(
    automationCenter.previewAutomationRuntimeAction(parsed, {
      id: "occurrence-1",
      action: "pause",
      revision: parsed.revision,
      fence: 7,
      controlRevision: 0,
    }).argv,
    [
      "automation",
      "center-runtime-action",
      "occurrence-1",
      "pause",
      "--expected-fence",
      "7",
      "--expected-control-revision",
      "0",
      "--json",
    ],
  );

  const html = automationCenter.renderAutomationRows(
    parsed.items,
    parsed.runtimeItems,
  );
  assert.match(html, /Incidents \(1\)/);
  assert.match(html, /&lt;run&amp;1&gt;/);
  assert.match(html, /data-control="incident"/);
  assert.match(html, /data-control="runtime"/);
  assert.doesNotMatch(html, /center-runtime-action|center-incident-action/);
  assert.equal(
    automationCenter.filterAutomationItems(parsed.items, "permission_denied")
      .length,
    1,
  );
});

test("accepts the released v2 pair without v3 controls", () => {
  const parsed = automationCenter.parseAutomationCenter(legacyFixture());
  assert.equal(parsed.connected, true);
  assert.equal(parsed.schema, automationCenter.LEGACY_SCHEMA);
  assert.deepEqual(parsed.runtimeItems, []);
  assert.deepEqual(parsed.items[0].incidents, []);
  assert.equal(
    automationCenter.previewAutomationAction(parsed, {
      kind: "flow",
      id: "flow-1",
      action: "run_now",
      revision: parsed.revision,
      itemRevision: parsed.items[0].revision,
    }).argv[1],
    "center-action",
  );
  assert.equal(
    automationCenter.previewAutomationRuntimeAction(parsed, {
      id: "occurrence-1",
      action: "pause",
      revision: parsed.revision,
      fence: 7,
      controlRevision: 0,
    }),
    null,
  );
});

test("fails closed on mismatched schemas and malformed incident envelopes", () => {
  const mismatched = legacyFixture();
  mismatched.schemaVersion = 3;
  assert.equal(
    automationCenter.parseAutomationCenter(mismatched).connected,
    false,
  );
  const unknown = legacyFixture();
  unknown.schema = "chainlesschain.automation-center/v1";
  unknown.schemaVersion = 1;
  assert.equal(
    automationCenter.parseAutomationCenter(unknown).connected,
    false,
  );

  const malformed = fixture();
  malformed.items[0].incidents[0].status = "retry";
  assert.equal(
    automationCenter.parseAutomationCenter(malformed).connected,
    false,
  );

  const duplicate = fixture();
  duplicate.items[0].incidents.push({
    ...duplicate.items[0].incidents[0],
  });
  assert.equal(
    automationCenter.parseAutomationCenter(duplicate).connected,
    false,
  );

  const controlled = fixture();
  controlled.items[0].incidents[0].runId = "run\nid";
  assert.equal(
    automationCenter.parseAutomationCenter(controlled).connected,
    false,
  );
});

test("requires canonical flow incidents and controls", () => {
  const input = fixture();
  delete input.items[0].incidents;
  const parsed = automationCenter.parseAutomationCenter(input);
  assert.equal(parsed.connected, false);
  assert.deepEqual(parsed.items, []);
});

test("rechecks exact incident and runtime revisions before execution", () => {
  const rendered = automationCenter.parseAutomationCenter(fixture());
  const runtimeRequest = {
    id: "occurrence-1",
    action: "pause",
    revision: rendered.revision,
    fence: 7,
    controlRevision: 0,
  };
  assert.equal(
    automationCenter.recheckAutomationRuntimeAction(
      rendered,
      automationCenter.parseAutomationCenter(fixture()),
      runtimeRequest,
    ).argv[1],
    "center-runtime-action",
  );
  const changedFence = fixture();
  changedFence.runtime.items[0].fence = 8;
  changedFence.runtime.items[0].actions = [
    runtimeAction("occurrence-1", "pause", true, 8, 0),
    runtimeAction("occurrence-1", "resume", false, 8, 0),
  ];
  assert.equal(
    automationCenter.recheckAutomationRuntimeAction(
      rendered,
      automationCenter.parseAutomationCenter(changedFence),
      runtimeRequest,
    ),
    null,
  );

  const incidentRequest = {
    id: "e".repeat(64),
    action: "cancel",
    revision: rendered.revision,
    incidentRevision: 1,
  };
  assert.equal(
    automationCenter.recheckAutomationIncidentAction(
      rendered,
      automationCenter.parseAutomationCenter(fixture()),
      incidentRequest,
    ).argv[1],
    "center-incident-action",
  );
  const changedIncident = fixture();
  changedIncident.items[0].incidents[0].revision = 2;
  changedIncident.items[0].incidents[0].actions = [
    incidentAction("e".repeat(64), "retry", false, 2),
    incidentAction("e".repeat(64), "cancel", true, 2),
  ];
  assert.equal(
    automationCenter.recheckAutomationIncidentAction(
      rendered,
      automationCenter.parseAutomationCenter(changedIncident),
      incidentRequest,
    ),
    null,
  );
});

test("rejects duplicate, unknown, malformed, and boundary-crossing controls", () => {
  const duplicateRuntime = fixture();
  duplicateRuntime.runtime.items.push({ ...duplicateRuntime.runtime.items[0] });
  assert.equal(
    automationCenter.parseAutomationCenter(duplicateRuntime).connected,
    false,
  );

  const unknownRuntimeAction = fixture();
  unknownRuntimeAction.runtime.items[0].actions[1].id = "terminate";
  assert.equal(
    automationCenter.parseAutomationCenter(unknownRuntimeAction).connected,
    false,
  );

  for (const forbidden of ["payload", "authority", "checkpoint"]) {
    const crossed = fixture();
    crossed.runtime.items[0][forbidden] = { secret: "must-not-cross" };
    assert.equal(
      automationCenter.parseAutomationCenter(crossed).connected,
      false,
    );
  }

  const incidentBoundary = fixture();
  incidentBoundary.items[0].incidents[0].authority = { secret: true };
  assert.equal(
    automationCenter.parseAutomationCenter(incidentBoundary).connected,
    false,
  );

  const duplicateIncidentAction = fixture();
  duplicateIncidentAction.items[0].incidents[0].actions[1] = {
    ...duplicateIncidentAction.items[0].incidents[0].actions[0],
  };
  assert.equal(
    automationCenter.parseAutomationCenter(duplicateIncidentAction).connected,
    false,
  );
});
