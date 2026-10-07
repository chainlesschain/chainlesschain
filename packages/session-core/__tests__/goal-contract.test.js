import { describe, expect, it } from "vitest";
import contract from "../lib/goal-contract.js";
import business from "../lib/business-object-contract.js";
import repository from "../lib/goal-repository.js";

const {
  createGoalRecord,
  validateGoalRecord,
  upgradeLegacyGoal,
  reviseGoalRecord,
  completeGoalRecord,
} = contract;
const stamp = "2026-10-07T00:00:00.000Z";
const later = "2026-10-07T00:01:00.000Z";
const actor = "did:chainless:owner";
function goal(extra = {}) {
  return createGoalRecord({
    id: "g1",
    storeId: "store-one",
    objective: "Follow project risk",
    createdAt: stamp,
    ...extra,
  });
}
function projectGoal() {
  return goal({
    ownerRef: actor,
    projectRef: business.createBusinessObjectRef({
      type: "Project",
      id: "p1",
      sourceKind: "desktop.project-goals",
      scope: { kind: "personal", id: actor },
      version: 1,
    }),
    acceptanceCriteria: [
      {
        id: "risk-reviewed",
        kind: "manual",
        description: "Review current project evidence",
      },
    ],
  });
}

describe("versioned long-lived goal contract", () => {
  it("creates immutable intent with no authorization or scheduled work", () => {
    const record = goal();
    expect(record).toMatchObject({
      revision: 1,
      controlGeneration: 0,
      status: "active",
      ownerRef: null,
      projectRef: null,
      executionState: "idle",
      completion: null,
    });
    expect(record.triggerRefs).toEqual([]);
    expect(Object.isFrozen(record.budgetPolicy)).toBe(true);
    expect(record.budgetPolicy.maxCostUsd).toBeNull();
  });
  it("reads a legacy goal without inventing identity, monitoring or verification", () => {
    const legacy = {
      id: "legacy",
      objective: "Ship",
      title: "Ship",
      status: "done",
      progress: 100,
      createdAt: stamp,
      updatedAt: stamp,
      notes: [{ at: stamp, text: "user declared done", by: "user" }],
    };
    const before = JSON.stringify(legacy);
    const migrated = upgradeLegacyGoal(legacy, "store-one");
    expect(JSON.stringify(legacy)).toBe(before);
    expect(migrated).toMatchObject({
      status: "done",
      completion: null,
      ownerRef: null,
      projectRef: null,
    });
    expect(migrated.notes).toEqual(legacy.notes);
    expect(migrated.triggerRefs).toEqual([]);
  });
  it("increments revision and invalidates prior control generation", () => {
    const current = projectGoal();
    const next = reviseGoalRecord(current, { status: "paused" }, later);
    expect(next).toMatchObject({
      revision: 2,
      controlGeneration: 1,
      status: "paused",
    });
    expect(current.status).toBe("active");
    expect(() =>
      reviseGoalRecord(next, { objective: "Changed" }, stamp),
    ).toThrow("GOAL_CLOCK_MOVED_BACKWARDS");
  });
  it.each([
    "ownerRef",
    "projectRef",
    "storeId",
    "revision",
    "controlGeneration",
    "completion",
    "executionState",
  ])("does not accept %s as an untrusted patch", (key) => {
    expect(() =>
      reviseGoalRecord(projectGoal(), { [key]: null }, later),
    ).toThrow("GOAL_INVALID_FIELDS");
  });
  it("does not treat model progress as verified project completion", () => {
    const record = projectGoal();
    expect(validateGoalRecord({ ...record, progress: 100 }).status).toBe(
      "active",
    );
    expect(() => reviseGoalRecord(record, { status: "done" }, later)).toThrow(
      "GOAL_COMPLETION_EVIDENCE_REQUIRED",
    );
    expect(() =>
      validateGoalRecord({ ...record, status: "done", progress: 100 }),
    ).toThrow("GOAL_COMPLETION_EVIDENCE_REQUIRED");
  });
  it("binds trusted verification to the definition and all criteria", () => {
    const record = projectGoal();
    const proof = {
      met: true,
      verifierRef: "host-checker",
      criteriaIds: ["risk-reviewed"],
      evidenceRefs: [{ kind: "manual-confirmation", id: "confirmation-1" }],
    };
    const completed = completeGoalRecord(record, proof, later);
    expect(completed).toMatchObject({
      status: "done",
      revision: 2,
      completion: { forRevision: 2 },
    });
    expect(() =>
      validateGoalRecord({ ...completed, objective: "Different work" }),
    ).toThrow("GOAL_INVALID_COMPLETION");
    expect(() =>
      completeGoalRecord(record, { ...proof, criteriaIds: [] }, later),
    ).toThrow("GOAL_INVALID_COMPLETION");
    expect(() =>
      completeGoalRecord(record, { ...proof, evidenceRefs: [] }, later),
    ).toThrow("GOAL_INVALID_COMPLETION");
    const reopened = reviseGoalRecord(completed, { status: "active" }, later);
    expect(reopened.completion).toBeNull();
    expect(reopened.controlGeneration).toBe(1);
  });
  it("rejects future schemas, cross-owner references and invalid numeric budgets", () => {
    expect(() => validateGoalRecord({ ...goal(), schemaVersion: 2 })).toThrow(
      "GOAL_UNSUPPORTED_SCHEMA",
    );
    expect(() =>
      validateGoalRecord({ ...projectGoal(), ownerRef: "did:other" }),
    ).toThrow("GOAL_INVALID_PROJECT_SCOPE");
    expect(() => goal({ budgetPolicy: { maxRuns: 0 } })).toThrow(
      "GOAL_INVALID_NUMBER",
    );
    expect(() => goal({ budgetPolicy: { maxCostUsd: -1 } })).toThrow(
      "GOAL_INVALID_BUDGET",
    );
  });
  it("rejects non-data JSON without running a getter", () => {
    let reads = 0;
    const invalid = {
      get objective() {
        reads++;
        return "hidden";
      },
    };
    expect(() => createGoalRecord(invalid)).toThrow("GOAL_INVALID_JSON");
    expect(reads).toBe(0);
    expect(() => goal({ objective: "x".repeat(8193) })).toThrow(
      "GOAL_INVALID_TEXT",
    );
  });
  it("bounds the complete serialized record, including metadata overhead", () => {
    expect(() =>
      validateGoalRecord({
        ...goal(),
        notes: Array.from({ length: 200 }, () => ({
          at: stamp,
          text: "x".repeat(280),
          by: "user",
        })),
      }),
    ).toThrow("GOAL_INVALID_JSON");
  });
  it("checks repository input before spreading caller properties", () => {
    let reads = 0;
    const adapter = {
      storeId: "store-one",
      create: () => {},
      get: () => null,
      list: () => [],
      compareAndSwap: () => {},
    };
    const repo = new repository.GoalRepository({ adapter });
    expect(() =>
      repo.create({
        get objective() {
          reads++;
          return "hidden";
        },
      }),
    ).toThrow("GOAL_INVALID_REQUEST");
    expect(reads).toBe(0);
  });
  it("does not complete when no trusted host verifier is available", () => {
    const adapter = {
      storeId: "store-one",
      create: () => {},
      get: () => null,
      list: () => [],
      compareAndSwap: () => {},
    };
    const repo = new repository.GoalRepository({ adapter });
    expect(() => repo.complete({ id: "g1", expectedRevision: 1 })).toThrow(
      "GOAL_VERIFIER_UNAVAILABLE",
    );
  });
});
