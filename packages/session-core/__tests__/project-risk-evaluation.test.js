import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import evaluator from "../lib/project-risk-evaluation.js";
import contracts from "../lib/business-object-contract.js";

const { evaluateProjectRiskSnapshot: evaluate } = evaluator;
const copy = (value) => JSON.parse(JSON.stringify(value));
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../__fixtures__/project-risk/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const riskCases = fixture("risk-cases");
const insufficientCases = fixture("insufficient-cases");
const snapshot = () => copy(riskCases[0].input);
const emptySnapshot = () => copy(riskCases[3].input);
const task = (id, overrides = {}) => ({
  id,
  project_id: "project-1",
  status: "pending",
  due_date: null,
  blocked_by: [],
  updated_at: 1791158400000,
  ...overrides,
});
function expectInsufficient(input, reason) {
  const result = evaluate(input);
  expect(result.status).toBe("insufficient-data");
  expect(result.reasonCodes).toEqual([reason]);
  expect(result.tasks).toEqual([]);
  expect(result.taskRefs).toEqual([]);
  expect(result.projectRef).toBeNull();
  expect(result.summary).toBeNull();
  return result;
}

describe("independent offline project risk fixtures", () => {
  it.each(riskCases)("$name", ({ input, expected }) => {
    const result = evaluate(input);
    expect({
      status: result.status,
      reasonCodes: result.reasonCodes,
      tasks: result.tasks.map((entry) => ({
        id: entry.taskRef.id,
        reasonCodes: entry.reasonCodes,
        blockingTaskIds: entry.blockingTaskRefs.map((ref) => ref.id),
      })),
      summary: result.summary,
    }).toEqual(expected);
    expect(result.schema).toBe("chainlesschain.project-risk-evaluation/v1");
    expect(result.ruleVersion).toBe("project-risk/v1");
    expect(result.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.asOf).toBe(input.asOf);
    expect(result.taskRefs).toHaveLength(input.tasks.length);
    for (const ref of [result.projectRef, ...result.taskRefs]) {
      expect(contracts.validateBusinessObjectRef(ref)).toEqual(ref);
      expect(ref.scope).toEqual(input.scope);
      expect(ref.sourceKind).toMatch(/^desktop\.project-risk-(project|task)$/u);
    }
    expect(Object.hasOwn(result, "safe")).toBe(false);
    expect(Object.hasOwn(result, "actionRun")).toBe(false);
  });

  it.each(insufficientCases)("$name", ({ input, reasonCode }) => {
    expectInsufficient(input, reasonCode);
  });
});

describe("read completeness, schemas and identities", () => {
  it.each(["partial", "unknown", "failed", null, true])(
    "requires explicit complete read status: %s",
    (readStatus) => {
      expectInsufficient(
        { ...emptySnapshot(), readStatus },
        "READ_NOT_COMPLETE",
      );
    },
  );

  it("does not infer omitted completeness, scope or risk fields", () => {
    for (const key of [
      "readStatus",
      "asOf",
      "sourceSchema",
      "scope",
      "tasks",
    ]) {
      const input = snapshot();
      delete input[key];
      expectInsufficient(input, "INVALID_SNAPSHOT");
    }
    for (const key of ["due_date", "blocked_by", "updated_at"]) {
      const input = snapshot();
      delete input.tasks[0][key];
      expectInsufficient(input, "INVALID_TASK");
    }
  });

  it.each(["board-tasks/v1", "desktop.project-tasks/v2", "", null])(
    "does not auto detect unsupported source schema: %s",
    (sourceSchema) => {
      expectInsufficient(
        { ...snapshot(), sourceSchema },
        "UNSUPPORTED_SOURCE_SCHEMA",
      );
    },
  );

  it.each(["planning", "delivered", "unknown", null])(
    "rejects project status outside the actual database contract: %s",
    (status) => {
      const input = snapshot();
      input.project.status = status;
      expectInsufficient(input, "UNKNOWN_PROJECT_STATUS");
    },
  );

  it.each(["done", "open", "in_progress", "cancelled", null])(
    "rejects unknown baseline SQL task status: %s",
    (status) => {
      const input = snapshot();
      input.tasks[0].status = status;
      expectInsufficient(input, "UNKNOWN_TASK_STATUS");
    },
  );

  it("rejects duplicate task IDs before reporting a plausible risk", () => {
    const input = snapshot();
    input.tasks.push(copy(input.tasks[0]));
    expectInsufficient(input, "DUPLICATE_TASK");
  });

  it.each([
    { kind: "public", id: "owner-1" },
    { kind: "personal", id: "../owner" },
    { kind: "organization" },
  ])("rejects invalid or missing scope identity: %o", (scope) => {
    expectInsufficient({ ...snapshot(), scope }, "INVALID_SCOPE");
  });

  it("rejects private content and extra ambiguous fields in strict snapshots", () => {
    const input = snapshot();
    input.project.description = "private document content";
    const result = expectInsufficient(input, "INVALID_PROJECT");
    expect(JSON.stringify(result)).not.toContain("private document content");
  });
});

describe("dates and direct dependency semantics", () => {
  it.each([
    "2026-10-06",
    "2026-10-06T00:00:00Z",
    "2026-10-06T08:00:00.000+08:00",
    "2026-02-30T00:00:00.000Z",
    1791244800000,
    null,
  ])("rejects ambiguous or invalid asOf: %s", (asOf) => {
    expectInsufficient({ ...snapshot(), asOf }, "INVALID_AS_OF");
  });

  it.each([-1, 1.5, "1791158400000", "yesterday", 253402300800000])(
    "rejects invalid task timestamps: %s",
    (value) => {
      for (const key of ["due_date", "updated_at"]) {
        const input = snapshot();
        input.tasks[0][key] = value;
        expectInsufficient(input, "INVALID_TASK_DATE");
      }
    },
  );

  it("does not silently evaluate a newer snapshot as historical evidence", () => {
    const input = snapshot();
    input.project.updated_at = 1791244800001;
    expectInsufficient(input, "SNAPSHOT_AFTER_AS_OF");
    input.project.updated_at = 1791244800000;
    input.tasks[0].updated_at = 1791244800001;
    expectInsufficient(input, "SNAPSHOT_AFTER_AS_OF");
  });

  it("keeps epoch zero as an actual overdue deadline instead of absent", () => {
    const input = emptySnapshot();
    input.tasks = [task("epoch", { due_date: 0 })];
    const result = evaluate(input);
    expect(result.tasks[0].dueDate).toBe(0);
    expect(result.reasonCodes).toEqual(["OVERDUE_INCOMPLETE_TASK"]);
  });

  it.each([null, "", "broken json", "{}", "[null]", ["same", "same"], [1]])(
    "rejects malformed dependency data without a fallback empty list: %s",
    (blocked_by) => {
      const input = snapshot();
      input.tasks[0].blocked_by = blocked_by;
      expectInsufficient(input, "INVALID_DEPENDENCIES");
    },
  );

  it("rejects a self dependency", () => {
    const input = snapshot();
    input.tasks[0].blocked_by = [input.tasks[0].id];
    expectInsufficient(input, "SELF_DEPENDENCY");
  });

  it("still validates missing references on terminal tasks", () => {
    const input = emptySnapshot();
    input.tasks = [
      task("done", { status: "completed", blocked_by: ["missing"] }),
    ];
    expectInsufficient(input, "MISSING_DEPENDENCY");
  });

  it("does not infer a transitive blocker through a completed dependency", () => {
    const input = emptySnapshot();
    input.tasks = [
      task("a", { blocked_by: ["b"] }),
      task("b", { status: "completed", blocked_by: ["c"] }),
      task("c", { status: "failed" }),
    ];
    const result = evaluate(input);
    expect(result.status).toBe("evaluated");
    expect(result.tasks).toEqual([]);
    expect(result.summary.unresolvedTaskCount).toBe(2);
  });
});

describe("bounded, content-bound immutable evidence", () => {
  it("accepts exactly 1000 tasks and rejects 1001 without partial results", () => {
    const input = emptySnapshot();
    input.tasks = Array.from({ length: 1000 }, (_, index) =>
      task(`task-${index}`),
    );
    expect(evaluate(input).summary.taskCount).toBe(1000);
    input.tasks.push(task("overflow"));
    expectInsufficient(input, "TASK_LIMIT_EXCEEDED");
  });

  it("accepts 10000 edges, then rejects an additional edge", () => {
    const input = emptySnapshot();
    const ids = Array.from({ length: 101 }, (_, index) => `task-${index}`);
    input.tasks = ids.map((id, index) =>
      task(id, {
        blocked_by: index < 100 ? ids.filter((other) => other !== id) : [],
      }),
    );
    expect(evaluate(input).summary.blockedTaskCount).toBe(100);
    input.tasks[100].blocked_by = [ids[0]];
    expectInsufficient(input, "DEPENDENCY_LIMIT_EXCEEDED");
  });

  it("rejects oversized input without returning its contents or digest", () => {
    const input = snapshot();
    input.secret = "x".repeat(2097153);
    const result = expectInsufficient(input, "INPUT_BOUNDS_EXCEEDED");
    expect(result.inputDigest).toBeNull();
  });

  it("never invokes executable input descriptors or serializers", () => {
    const getter = vi.fn(() => "complete");
    const input = snapshot();
    Object.defineProperty(input, "readStatus", {
      enumerable: true,
      get: getter,
    });
    expectInsufficient(input, "INVALID_SNAPSHOT");
    expect(getter).not.toHaveBeenCalled();
    const serialize = vi.fn();
    expectInsufficient(
      { ...snapshot(), toJSON: serialize },
      "INVALID_SNAPSHOT",
    );
    expect(serialize).not.toHaveBeenCalled();
    const trap = vi.fn();
    expectInsufficient(new Proxy({}, { ownKeys: trap }), "INVALID_SNAPSHOT");
    expect(trap).not.toHaveBeenCalled();
  });

  it.each([undefined, NaN, Infinity, 1n, new Date(), new Map(), [, 1]])(
    "rejects non JSON input without throwing: %s",
    (input) => expectInsufficient(input, "INVALID_SNAPSHOT"),
  );

  it("rejects circular structures and hidden properties", () => {
    const input = snapshot();
    input.circular = input;
    expectInsufficient(input, "INVALID_SNAPSHOT");
    const hidden = snapshot();
    Object.defineProperty(hidden, "secret", { value: "hidden" });
    expectInsufficient(hidden, "INVALID_SNAPSHOT");
  });

  it("is independent of query order and serialized dependency formatting", () => {
    const input = copy(riskCases[1].input);
    const before = evaluate(input);
    input.tasks.reverse();
    for (const row of input.tasks) {
      if (typeof row.blocked_by === "string")
        row.blocked_by = JSON.parse(row.blocked_by);
      row.blocked_by = JSON.stringify(row.blocked_by.reverse());
    }
    expect(evaluate(input)).toEqual(before);
  });

  it("binds snapshot changes and schema, with stable row refs across asOf changes", () => {
    const input = snapshot();
    const first = evaluate(input);
    input.asOf = "2026-10-07T00:00:00.000Z";
    const later = evaluate(input);
    expect(later.inputDigest).not.toBe(first.inputDigest);
    expect(later.taskRefs).toEqual(first.taskRefs);
    input.tasks[0].due_date--;
    const changed = evaluate(input);
    expect(changed.inputDigest).not.toBe(later.inputDigest);
    expect(
      changed.taskRefs.find((ref) => ref.id === "before").version,
    ).not.toBe(later.taskRefs.find((ref) => ref.id === "before").version);
    const differentSchema = emptySnapshot();
    const baseline = evaluate(differentSchema);
    differentSchema.sourceSchema = "desktop.task-manager/v1";
    expect(evaluate(differentSchema).projectRef.version).not.toBe(
      baseline.projectRef.version,
    );
  });

  it("returns detached, deeply immutable evidence and never changes the input", () => {
    const input = copy(riskCases[1].input);
    const original = copy(input);
    const result = evaluate(input);
    expect(input).toEqual(original);
    input.scope.id = "different-owner";
    input.tasks[0].blocked_by.push("external");
    expect(result.projectRef.scope.id).toBe("org-1");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tasks[0].blockingTaskRefs[0].scope)).toBe(
      true,
    );
    expect(Object.isFrozen(result.tasks[0].reasonCodes)).toBe(true);
    expect(Object.isFrozen(result.summary)).toBe(true);
  });
});
