import { describe, expect, it, vi } from "vitest";
import { rrsiEvaluationFixture } from "../fixtures/rrsi-evaluation.js";
import { rrsiFixtureDigest } from "../fixtures/rrsi-shadow-fixture.js";
import {
  buildEvolutionEvalSuite,
  buildEvolutionEvalTask,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import {
  buildRrsiEvaluationVariantMapping,
  verifyRrsiEvaluationVariantMapping,
  projectRrsiVariantTrainingView,
  RRSI_IDENTITY_RECIPE_DIGEST,
  assertRrsiVariantSetInputIsolation,
} from "../../src/lib/evolution/rrsi-evaluation-variants.js";

function variantFixture(variant = "paraphrase", mutate = () => {}) {
  const original = rrsiEvaluationFixture();
  const suites = Object.fromEntries(
    Object.entries(original.context.suites).map(([role, suite]) => {
      const tasks = suite.tasks.map((task) => {
        const value = structuredClone(task);
        delete value.taskDigest;
        delete value.schema;
        if (variant === "paraphrase" && value.split !== "training")
          value.publicInput.prompt = `TEST equivalent rewrite: ${value.publicInput.prompt}`;
        mutate(value, role);
        return buildEvolutionEvalTask(value);
      });
      return [
        role,
        buildEvolutionEvalSuite({
          suiteId:
            variant === "paraphrase"
              ? `${suite.suiteId}-${variant}`
              : suite.suiteId,
          datasetVersion: suite.datasetVersion,
          tasks,
        }),
      ];
    }),
  );
  const input = {
    ...original,
    variant,
    recipeDigest:
      variant === "clean"
        ? RRSI_IDENTITY_RECIPE_DIGEST
        : rrsiFixtureDigest(`TEST ONLY ${variant} recipe`),
    suites,
  };
  delete input.pools;
  return { original, input };
}

describe("RRSI five-pool variant derivation", () => {
  it("preserves every original source, task and hidden objective while binding changed native digests", () => {
    const { input } = variantFixture();
    const mapping = buildRrsiEvaluationVariantMapping(input);
    expect(verifyRrsiEvaluationVariantMapping(mapping, input)).toEqual(mapping);
    for (const role of mapping.roles) {
      expect(role.pmTrainingPartitionDigest).not.toBe(
        role.basePmTrainingPartitionDigest,
      );
      expect(role.changedPublicInputs).toBe(
        role.splitCounts.validation + role.splitCounts.test,
      );
      for (const row of role.mappings) {
        expect(row.groups).toEqual(
          input.context.campaign.dataset.tasks.find(
            (task) => task.id === row.rrsiTaskId,
          ).groups,
        );
        expect(row.pmTaskDigest === row.basePmTaskDigest).toBe(
          row.split === "training",
        );
      }
    }
    expect(mapping).toMatchObject({
      hiddenObjectivesUnchanged: true,
      semanticEquivalenceVerified: false,
      recipeExecutionVerified: false,
      derivationAuthenticated: false,
      qualifiesForPromotion: false,
    });
    expect(JSON.stringify(mapping)).not.toMatch(
      /privateExpected|equivalent rewrite|project-state|private instruction/,
    );
  });

  it.each(["clean", "tool-order", "tool-delay"])(
    "retains native task digests for %s without certifying recipe execution",
    (variant) => {
      const { input } = variantFixture(variant);
      const mapping = buildRrsiEvaluationVariantMapping(input);
      expect(
        mapping.roles.every(
          (role) =>
            role.changedPublicInputs === 0 &&
            role.mappings.every(
              (row) => row.pmTaskDigest === row.basePmTaskDigest,
            ),
        ),
      ).toBe(true);
      expect(mapping.recipeExecutionVerified).toBe(false);
    },
  );

  it("returns only original training references and rejects serialized capabilities", () => {
    const { input } = variantFixture();
    const mapping = buildRrsiEvaluationVariantMapping(input);
    const projection = projectRrsiVariantTrainingView(mapping);
    expect(projection.tasks).toHaveLength(60);
    expect(JSON.stringify(projection)).not.toMatch(
      /select|gate-test|audit|variantMappingDigest|recipe/,
    );
    expect(() =>
      projectRrsiVariantTrainingView(structuredClone(mapping)),
    ).toThrow(/verified live/);
  });

  it.each([
    "privateExpected",
    "graderId",
    "groupKeys",
    "training-input",
    "task-id",
  ])(
    "rejects changed %s without reassigning the frozen denominator",
    (field) => {
      const { input } = variantFixture("paraphrase", (task, role) => {
        if (
          role !== "gate" ||
          task.id !==
            (field === "training-input" ? "train-task-0" : "gate-test-task-0")
        )
          return;
        if (field === "privateExpected")
          task.privateExpected.name = "different hidden objective";
        if (field === "graderId") task.graderId = "weakened-grader";
        if (field === "groupKeys")
          task.groupKeys[0] = `template-${"a".repeat(64)}`;
        if (field === "training-input")
          task.publicInput.prompt = "new training instruction";
        if (field === "task-id") task.id = "replacement-task";
      });
      expect(() => buildRrsiEvaluationVariantMapping(input)).toThrow(
        /changes task identity|modifies training/,
      );
    },
  );

  it("rejects an incomplete pool, no-op paraphrase, identity-tagged perturbation and tampered result", () => {
    const { input } = variantFixture();
    const mapping = buildRrsiEvaluationVariantMapping(input);
    const changed = structuredClone(mapping);
    changed.semanticEquivalenceVerified = true;
    expect(() => verifyRrsiEvaluationVariantMapping(changed, input)).toThrow(
      /differs from frozen/,
    );
    expect(() =>
      buildRrsiEvaluationVariantMapping({
        ...input,
        suites: input.context.suites,
      }),
    ).toThrow(/no transformed/);
    expect(() =>
      buildRrsiEvaluationVariantMapping({
        ...input,
        recipeDigest: RRSI_IDENTITY_RECIPE_DIGEST,
      }),
    ).toThrow(/clean identity/);
    const suite = input.suites.audit;
    const short = buildEvolutionEvalSuite({
      suiteId: suite.suiteId,
      datasetVersion: suite.datasetVersion,
      tasks: suite.tasks.slice(1),
    });
    expect(() =>
      buildRrsiEvaluationVariantMapping({
        ...input,
        suites: { ...input.suites, audit: short },
      }),
    ).toThrow(/denominator/);
    const accessed = { ...input };
    const getter = vi.fn(() => input.suites);
    Object.defineProperty(accessed, "suites", {
      enumerable: true,
      get: getter,
    });
    expect(() => buildRrsiEvaluationVariantMapping(accessed)).toThrow(
      /accessor/,
    );
    expect(getter).not.toHaveBeenCalled();
    const suiteMeta = input.suites.gate;
    const changedVersion = buildEvolutionEvalSuite({
      suiteId: suiteMeta.suiteId,
      datasetVersion: "post-hoc-version",
      tasks: suiteMeta.tasks,
    });
    expect(() =>
      buildRrsiEvaluationVariantMapping({
        ...input,
        suites: { ...input.suites, gate: changedVersion },
      }),
    ).toThrow(/dataset version/);
  });

  it("rejects exact prompt exposure across different native suites and frozen pools", () => {
    const { input } = variantFixture();
    const source = input.context.suites.selection.tasks.find(
      (task) => task.split === "test",
    ).publicInput;
    const suite = input.suites.gate;
    const tasks = suite.tasks.map((task) => {
      if (task.id !== "gate-test-task-0") return task;
      const value = { ...task, publicInput: source };
      delete value.taskDigest;
      delete value.schema;
      return buildEvolutionEvalTask(value);
    });
    const changed = {
      ...input,
      suites: {
        ...input.suites,
        gate: buildEvolutionEvalSuite({
          suiteId: suite.suiteId,
          datasetVersion: suite.datasetVersion,
          tasks,
        }),
      },
    };
    expect(() => buildRrsiEvaluationVariantMapping(changed)).toThrow(
      /another frozen pool/,
    );
  });

  it("checks exact collisions across multiple recipes before launch aggregation", () => {
    const { input } = variantFixture();
    const other = structuredClone(input);
    other.recipeDigest = rrsiFixtureDigest("TEST second paraphrase recipe");
    const otherGate = other.suites.gate;
    other.suites.gate = buildEvolutionEvalSuite({
      suiteId: `${otherGate.suiteId}-second`,
      datasetVersion: otherGate.datasetVersion,
      tasks: otherGate.tasks.map((task) => {
        if (task.split === "training") return task;
        const value = {
          ...task,
          publicInput: { prompt: `SECOND RECIPE ${task.publicInput.prompt}` },
        };
        delete value.taskDigest;
        delete value.schema;
        return buildEvolutionEvalTask(value);
      }),
    });
    const suite = other.suites.audit;
    const source = input.suites.gate.tasks.find(
      (task) => task.id === "gate-test-task-0",
    ).publicInput;
    const tasks = suite.tasks.map((task) => {
      if (task.id !== "audit-task-20") return task;
      const value = { ...task, publicInput: source };
      delete value.taskDigest;
      delete value.schema;
      return buildEvolutionEvalTask(value);
    });
    other.suites.audit = buildEvolutionEvalSuite({
      suiteId: suite.suiteId,
      datasetVersion: suite.datasetVersion,
      tasks,
    });
    // Each variant alone is structurally valid; together they expose one pool to another.
    expect(
      buildRrsiEvaluationVariantMapping(other).hiddenObjectivesUnchanged,
    ).toBe(true);
    expect(() => assertRrsiVariantSetInputIsolation([input, other])).toThrow(
      /another frozen pool/,
    );
  });
});
