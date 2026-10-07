import { describe, expect, it, vi } from "vitest";
import { rrsiEvaluationFixture } from "../fixtures/rrsi-evaluation.js";
import {
  buildEvolutionEvalSuite,
  buildEvolutionEvalPolicy,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import {
  buildRrsiEvaluationMapping,
  verifyRrsiEvaluationMapping,
  projectRrsiEvaluationTrainingView,
  collectRrsiEvalRowEvidence,
} from "../../src/lib/evolution/rrsi-evaluation-adapter.js";

function suiteWith(suite, tasks) {
  return buildEvolutionEvalSuite({
    suiteId: suite.suiteId,
    datasetVersion: suite.datasetVersion,
    tasks,
  });
}
function policyWith(policy, fields) {
  const input = { ...policy, ...fields };
  delete input.schema;
  delete input.policyDigest;
  return buildEvolutionEvalPolicy(input);
}

describe("RRSI five-pool Eval correspondence", () => {
  it("maps all five pools while preserving the original three-split Eval schemas", () => {
    const value = rrsiEvaluationFixture();
    const map = verifyRrsiEvaluationMapping(value.mapping, value.context);
    expect(map.roles.find((role) => role.role === "gate").splitCounts).toEqual({
      training: 60,
      validation: 40,
      test: 40,
    });
    for (const role of map.roles) {
      expect(
        role.mappings
          .filter((row) => row.split !== "training")
          .every((row) =>
            role.role === "selection"
              ? row.rrsiPartition === "select"
              : role.role === "audit"
                ? row.rrsiPartition === "audit"
                : ["gate-validation", "gate-test"].includes(row.rrsiPartition),
          ),
      ).toBe(true);
      expect(value.context.suites[role.role]).not.toHaveProperty(
        "rrsiPartition",
      );
    }
    expect(map).toMatchObject({
      sourceProvenanceVerified: false,
      independentExecutionContextsVerified: false,
      mappingAuthenticated: false,
      qualifiesForPromotion: false,
    });
    expect(JSON.stringify(map)).not.toContain("TEST ONLY private");
  });

  it("returns only verified training references to the proposer and rejects forged projections", () => {
    const value = rrsiEvaluationFixture();
    const view = projectRrsiEvaluationTrainingView(value.mapping);
    expect(view.tasks).toHaveLength(60);
    expect(
      view.tasks.every((task) => task.taskId.startsWith("train-task-")),
    ).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(
      /gate-test-task|select-task|audit-task|privateExpected|private instruction/,
    );
    const copied = structuredClone(value.mapping);
    copied.roles[0].mappings[0].rrsiPartition = "train";
    expect(() => projectRrsiEvaluationTrainingView(copied)).toThrow(
      /verified evaluation mapping/,
    );
    expect(Object.isFrozen(view.tasks[0])).toBe(true);
  });

  it("rejects using Gate holdouts as selection data", () => {
    const value = rrsiEvaluationFixture();
    const context = {
      ...value.context,
      suites: { ...value.context.suites, selection: value.context.suites.gate },
    };
    expect(() => buildRrsiEvaluationMapping(context)).toThrow(/pool differs/);
  });

  it("rejects incomplete pool mapping even when the legacy Eval sample floors still hold", () => {
    const value = rrsiEvaluationFixture();
    const gate = value.context.suites.gate;
    const shortened = suiteWith(
      gate,
      gate.tasks.filter((task) => task.id !== "gate-test-task-39"),
    );
    const context = {
      ...value.context,
      suites: { ...value.context.suites, gate: shortened },
    };
    expect(() => buildRrsiEvaluationMapping(context)).toThrow(
      /frozen pool denominator/,
    );
  });

  it("rejects incompatible repetitions, sample floors and changed frozen mapping fields", () => {
    const value = rrsiEvaluationFixture();
    const changedPolicy = policyWith(value.context.policies.audit, {
      seeds: [44, 55, 66],
    });
    expect(() =>
      buildRrsiEvaluationMapping({
        ...value.context,
        policies: { ...value.context.policies, audit: changedPolicy },
      }),
    ).toThrow(/repeats differ/);
    const tasks = value.context.suites.audit.tasks.filter(
      (task) => task.split !== "test" || task.id === "audit-task-20",
    );
    const short = suiteWith(value.context.suites.audit, tasks);
    expect(() =>
      buildRrsiEvaluationMapping({
        ...value.context,
        suites: { ...value.context.suites, audit: short },
      }),
    ).toThrow(/sample floors/);
    const copied = structuredClone(value.mapping);
    copied.sourceProvenanceVerified = true;
    expect(() => verifyRrsiEvaluationMapping(copied, value.context)).toThrow(
      /frozen sources or policy/,
    );
  });

  it("never accepts an unchecked verifier callback or invokes accessors", async () => {
    const fake = { verify: vi.fn(() => true) };
    await expect(collectRrsiEvalRowEvidence(fake, {})).rejects.toThrow(
      /branded Eval verifier/,
    );
    expect(fake.verify).not.toHaveBeenCalled();
    const value = rrsiEvaluationFixture();
    const context = { ...value.context };
    const getter = vi.fn(() => value.context.suites);
    Object.defineProperty(context, "suites", { enumerable: true, get: getter });
    expect(() => buildRrsiEvaluationMapping(context)).toThrow(/accessor/);
    expect(getter).not.toHaveBeenCalled();
  });
});
