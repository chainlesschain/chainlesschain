import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_EXECUTION_INCIDENT_CATEGORY,
  AUTOMATION_EXECUTION_INCIDENT_STATUS,
  automationExecutionBoundaryDigest,
  cancelAutomationExecutionIncident,
  deriveAutomationExecutionIncidentId,
  ensureAutomationExecutionIncidentSchema,
  getAutomationExecutionIncident,
  listAutomationExecutionIncidents,
  resolveAutomationExecutionIncident,
  upsertAutomationExecutionIncident,
} from "../../src/lib/automation-execution-incident.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

describe("automation execution incidents", () => {
  const cleanups = [];
  const firstNow = 1_786_500_000_000;

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function memoryDatabase() {
    const db = new Database(":memory:");
    cleanups.push(() => db.close());
    return db;
  }

  function incidentInput(overrides = {}) {
    return {
      runId: "auto-scheduler-run-7",
      flowId: "flow-7",
      occurrenceId: "occurrence-7",
      triggerType: "schedule",
      triggerId: null,
      category: AUTOMATION_EXECUTION_INCIDENT_CATEGORY.PERMISSION,
      code: "AUTOMATION_PERMISSION_DENIED",
      authorityDigest: sha256("authority-7"),
      boundary: {
        deniedPermissions: [
          "automation:connector:github",
          "automation:execute",
        ],
        policyRevision: "policy-3",
        evidenceDigests: [sha256("decision-7")],
      },
      details: {
        actionId: "publish-release",
        actionIndex: 2,
        reasonCode: "PERMISSION_DENIED",
        retryable: false,
      },
      ...overrides,
    };
  }

  it("creates the schema and idempotently binds an incident to the original domain run", () => {
    const db = memoryDatabase();
    const input = incidentInput();
    const first = upsertAutomationExecutionIncident(db, input, {
      now: () => firstNow,
    });
    const replay = upsertAutomationExecutionIncident(
      db,
      {
        ...input,
        boundary: {
          evidenceDigests: [sha256("decision-7")],
          policyRevision: "policy-3",
          deniedPermissions: [
            "automation:execute",
            "automation:connector:github",
          ],
        },
        details: {
          retryable: false,
          reasonCode: "PERMISSION_DENIED",
          actionIndex: 2,
          actionId: "publish-release",
        },
      },
      { now: () => firstNow + 1_000 },
    );

    expect(first).toMatchObject({
      incidentId: expect.stringMatching(/^[0-9a-f]{64}$/u),
      runId: "auto-scheduler-run-7",
      flowId: "flow-7",
      occurrenceId: "occurrence-7",
      triggerType: "schedule",
      triggerId: null,
      category: "permission",
      code: "AUTOMATION_PERMISSION_DENIED",
      status: AUTOMATION_EXECUTION_INCIDENT_STATUS.OPEN,
      revision: 1,
      createdAtMs: firstNow,
      updatedAtMs: firstNow,
      deduplicated: false,
    });
    expect(first.boundaryDigest).toBe(
      automationExecutionBoundaryDigest(input.boundary),
    );
    expect(first.incidentId).toBe(deriveAutomationExecutionIncidentId(input));
    expect(replay).toMatchObject({
      incidentId: first.incidentId,
      revision: 1,
      createdAtMs: firstNow,
      updatedAtMs: firstNow,
      deduplicated: true,
    });
    expect(listAutomationExecutionIncidents(db)).toHaveLength(1);
  });

  it("records changed authority, boundary, or details as distinct observations", () => {
    const db = memoryDatabase();
    const input = incidentInput();
    const stored = upsertAutomationExecutionIncident(db, input, {
      now: () => firstNow,
    });

    const observations = [];
    for (const conflictingInput of [
      { ...input, authorityDigest: sha256("other-authority") },
      {
        ...input,
        boundary: {
          ...input.boundary,
          deniedPermissions: ["automation:execute"],
        },
      },
      {
        ...input,
        details: { ...input.details, actionIndex: 3 },
      },
    ]) {
      observations.push(
        upsertAutomationExecutionIncident(db, conflictingInput, {
          now: () => firstNow + 1,
        }),
      );
    }

    expect(new Set(observations.map((item) => item.incidentId)).size).toBe(3);
    expect(observations.every((item) => item.deduplicated === false)).toBe(
      true,
    );
    expect(observations.map((item) => item.incidentId)).not.toContain(
      stored.incidentId,
    );
    expect(listAutomationExecutionIncidents(db)).toHaveLength(4);

    expect(getAutomationExecutionIncident(db, stored.incidentId)).toMatchObject(
      {
        authorityDigest: input.authorityDigest,
        boundary: input.boundary,
        details: input.details,
        revision: 1,
      },
    );
  });

  it("deduplicates the same observation across independent database handles", () => {
    const directory = mkdtempSync(join(tmpdir(), "cc-incident-concurrency-"));
    const file = join(directory, "incidents.db");
    const firstDb = new Database(file);
    const secondDb = new Database(file);
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    cleanups.push(() => firstDb.close());
    cleanups.push(() => secondDb.close());
    const input = incidentInput();

    const first = upsertAutomationExecutionIncident(firstDb, input, {
      now: () => firstNow,
    });
    const replay = upsertAutomationExecutionIncident(secondDb, input, {
      now: () => firstNow + 1,
    });

    expect(first.deduplicated).toBe(false);
    expect(replay).toMatchObject({
      incidentId: first.incidentId,
      deduplicated: true,
      createdAtMs: firstNow,
      updatedAtMs: firstNow,
    });
  });

  it("stores only bounded allowlisted evidence and rejects obvious secret material", () => {
    const db = memoryDatabase();
    for (const unsafe of [
      incidentInput({
        details: { message: "Bearer super-secret-access-token" },
      }),
      incidentInput({
        details: { actionId: `step-${"github_pat_secret".repeat(3)}` },
      }),
      incidentInput({
        boundary: { token: "never-store-this" },
      }),
    ]) {
      expect(() => upsertAutomationExecutionIncident(db, unsafe)).toThrowError(
        expect.objectContaining({
          code: "AUTOMATION_EXECUTION_INCIDENT_UNSAFE_DETAILS",
        }),
      );
    }

    const oversizedDetails = incidentInput({
      details: {
        deniedPermissions: Array.from(
          { length: 32 },
          (_, index) => `automation:scope:${index}:${"x".repeat(180)}`,
        ),
      },
    });
    expect(() =>
      upsertAutomationExecutionIncident(db, oversizedDetails),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_INCIDENT_INVALID",
      }),
    );
    expect(listAutomationExecutionIncidents(db)).toEqual([]);
  });

  it("lists incidents by durable run, flow, occurrence, trigger, category, and status", () => {
    const db = memoryDatabase();
    const permission = upsertAutomationExecutionIncident(db, incidentInput(), {
      now: () => firstNow,
    });
    const budget = upsertAutomationExecutionIncident(
      db,
      incidentInput({
        runId: "auto-manual-run-8",
        flowId: "flow-8",
        occurrenceId: null,
        triggerType: "manual",
        category: AUTOMATION_EXECUTION_INCIDENT_CATEGORY.BUDGET,
        code: "AUTOMATION_BUDGET_EXHAUSTED",
        authorityDigest: sha256("authority-8"),
        boundary: {
          budgetRevision: 4,
          budgetLimit: 10,
          budgetUsed: 10,
          budgetRequested: 1,
        },
        details: { recoveryCode: "UPDATE_BUDGET_POLICY" },
      }),
      { now: () => firstNow + 10 },
    );
    resolveAutomationExecutionIncident(db, permission.incidentId, {
      expectedRevision: permission.revision,
      resolutionCode: "POLICY_GRANTED",
      now: () => firstNow + 20,
    });

    expect(
      listAutomationExecutionIncidents(db, {
        runId: "auto-manual-run-8",
        flowId: "flow-8",
        triggerType: "manual",
        category: "budget",
        status: "open",
      }),
    ).toEqual([expect.objectContaining({ incidentId: budget.incidentId })]);
    expect(
      listAutomationExecutionIncidents(db, {
        occurrenceId: "occurrence-7",
        status: "resolved",
      }),
    ).toEqual([expect.objectContaining({ incidentId: permission.incidentId })]);
    expect(listAutomationExecutionIncidents(db, { limit: 1 })).toHaveLength(1);
  });

  it("resolves and cancels open incidents with strict revision CAS", () => {
    const db = memoryDatabase();
    const resolvedSource = upsertAutomationExecutionIncident(
      db,
      incidentInput(),
      { now: () => firstNow },
    );
    expect(() =>
      resolveAutomationExecutionIncident(db, resolvedSource.incidentId, {
        expectedRevision: 2,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_INCIDENT_REVISION_CONFLICT",
      }),
    );
    const resolved = resolveAutomationExecutionIncident(
      db,
      resolvedSource.incidentId,
      {
        expectedRevision: 1,
        resolutionCode: "OPERATOR_VERIFIED_POLICY",
        now: () => firstNow + 20,
      },
    );
    expect(resolved).toMatchObject({
      status: "resolved",
      revision: 2,
      resolutionCode: "OPERATOR_VERIFIED_POLICY",
      closedAtMs: firstNow + 20,
    });
    expect(() =>
      cancelAutomationExecutionIncident(db, resolved.incidentId, {
        expectedRevision: 2,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_EXECUTION_INCIDENT_STATE_CONFLICT",
      }),
    );

    const cancelSource = upsertAutomationExecutionIncident(
      db,
      incidentInput({
        runId: "auto-event-run-9",
        occurrenceId: "event-occurrence-9",
        triggerType: "event",
        triggerId: "trigger-9",
        category: AUTOMATION_EXECUTION_INCIDENT_CATEGORY.CONNECTOR,
        code: "AUTOMATION_CONNECTOR_DENIED",
        authorityDigest: sha256("authority-9"),
        boundary: { connector: "slack" },
      }),
      { now: () => firstNow + 30 },
    );
    const cancelled = cancelAutomationExecutionIncident(
      db,
      cancelSource.incidentId,
      {
        expectedRevision: 1,
        resolutionCode: "RUN_ABANDONED",
        now: () => firstNow + 40,
      },
    );
    expect(cancelled).toMatchObject({
      status: "cancelled",
      revision: 2,
      resolutionCode: "RUN_ABANDONED",
      closedAtMs: firstNow + 40,
    });
  });

  it("survives closing and reopening the SQLite database", () => {
    const directory = mkdtempSync(join(tmpdir(), "automation-incident-"));
    cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
    const databasePath = join(directory, "automation.db");
    const firstDb = new Database(databasePath);
    ensureAutomationExecutionIncidentSchema(firstDb);
    const created = upsertAutomationExecutionIncident(
      firstDb,
      incidentInput({
        runId: "auto-event-run-durable",
        triggerType: "event",
        triggerId: "trigger-durable",
      }),
      { now: () => firstNow },
    );
    firstDb.close();

    const reopenedDb = new Database(databasePath);
    const reopened = getAutomationExecutionIncident(
      reopenedDb,
      created.incidentId,
    );
    expect(reopened).toMatchObject({
      incidentId: created.incidentId,
      runId: "auto-event-run-durable",
      status: "open",
      revision: 1,
      boundaryDigest: created.boundaryDigest,
      authorityDigest: created.authorityDigest,
    });
    reopenedDb.close();
  });
});
