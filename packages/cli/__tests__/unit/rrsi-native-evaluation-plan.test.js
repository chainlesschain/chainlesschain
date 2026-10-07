import { beforeAll, describe, expect, it, vi } from "vitest";
import { rrsiNativeEvaluationFixture } from "../fixtures/rrsi-native-evaluation.js";
import {
  buildRrsiNativeEvaluationPlan,
  verifyRrsiNativeEvaluationPlan,
} from "../../src/lib/evolution/rrsi-native-evaluation-plan.js";
import { buildSkillTargetMatrixEvalPlan } from "../../src/lib/evolution/skill-target-matrix-eval.js";

function planWith(plan, changes) {
  const input = { ...plan, ...changes };
  delete input.schema;
  delete input.planDigest;
  return buildSkillTargetMatrixEvalPlan(input);
}

describe("RRSI complete native evaluation measurement plan", () => {
  let input;
  beforeAll(() => {
    input = rrsiNativeEvaluationFixture();
  }, 60000);
  it("freezes the whole triangle, all pools and variants without replacing native plan identities", () => {
    const plan = buildRrsiNativeEvaluationPlan(input);
    expect(plan.cases).toHaveLength(24);
    expect(plan.plannedActorObservationsByArm).toEqual({
      baseline: 2880,
      rsi: 2880,
      rrsi: 2880,
    });
    expect(plan.hypothesisCount).toBe(24);
    expect(
      plan.cases.filter((entry) => !entry.isRegisteredContrast),
    ).toHaveLength(8);
    for (const entry of plan.cases)
      for (const slot of entry.slots) {
        expect(slot.expectedContext.planDigest).toBe(
          entry.nativePlan.planDigest,
        );
        expect(slot.expectedContext.planDigest).not.toBe(
          plan.nativeEvaluationPlanDigest,
        );
        expect(slot.expectedContext.planDigest).not.toBe(
          plan.evaluationMappingDigest,
        );
        expect(slot.request).not.toHaveProperty("runId");
        expect(slot.request).not.toHaveProperty("runNonce");
      }
    expect(plan).toMatchObject({
      fullRequestCostGraphVerified: false,
      billingComplete: false,
      admissionInventoryVerified: false,
      statisticalProtocolValidated: false,
      qualifiesForPromotion: false,
    });
    expect(JSON.stringify(plan)).not.toMatch(
      /privateExpected|alternate instruction|TEST ONLY private/,
    );
    expect(verifyRrsiNativeEvaluationPlan(plan, input)).toEqual(plan);
  }, 60000);

  it("rejects the old clean-only final budget before authorizing any actor", () => {
    const constrained = rrsiNativeEvaluationFixture({ fullBudget: false });
    expect(() => buildRrsiNativeEvaluationPlan(constrained)).toThrow(
      /complete native actor observations/,
    );
  }, 60000);

  it.each(["missing-pair", "duplicate-pair", "missing-variant"])(
    "cannot drop %s to obtain a smaller denominator",
    (mode) => {
      const changed = { ...input, nativeCases: [...input.nativeCases] };
      if (mode === "missing-pair") changed.nativeCases.pop();
      if (mode === "duplicate-pair")
        changed.nativeCases[0] = changed.nativeCases[1];
      if (mode === "missing-variant")
        changed.variants = input.variants.slice(1);
      expect(() => buildRrsiNativeEvaluationPlan(changed)).toThrow(
        /denominator|duplicated|all frozen variants/,
      );
    },
    60000,
  );

  it.each(["artifact", "suite", "parent", "invocation"])(
    "rejects changed %s in a valid independently rehashed native plan",
    (mode) => {
      const cases = [...input.nativeCases];
      const original = cases[0].plan;
      let changes;
      if (mode === "artifact")
        changes = { candidateId: input.context.versions.baseline };
      if (mode === "suite")
        changes = {
          cells: original.cells.map((cell) => ({
            ...cell,
            suiteDigest: input.context.suites.selection.suiteDigest,
          })),
        };
      if (mode === "parent") changes = { expectedActiveRevision: 2 };
      if (mode === "invocation")
        changes = {
          cells: original.cells.map((cell) => ({
            ...cell,
            invocationId: cases[1].plan.cells[0].invocationId,
          })),
        };
      cases[0] = { ...cases[0], plan: planWith(original, changes) };
      expect(() =>
        buildRrsiNativeEvaluationPlan({ ...input, nativeCases: cases }),
      ).toThrow(/arm artifact|variant Suite|parent|invocation identity/);
    },
    60000,
  );

  it("rejects source accessors before invoking them", () => {
    const accessed = { ...input },
      getter = vi.fn(() => input.variants);
    Object.defineProperty(accessed, "variants", {
      enumerable: true,
      get: getter,
    });
    expect(() => buildRrsiNativeEvaluationPlan(accessed)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects stage coercion without evaluating caller code", () => {
    const coerce = vi.fn(() => "generalization");
    expect(() =>
      buildRrsiNativeEvaluationPlan({
        ...input,
        stage: { [Symbol.toPrimitive]: coerce },
      }),
    ).toThrow(/unknown native evaluation stage/);
    expect(coerce).not.toHaveBeenCalled();
  });

  it("requires the entire typed target matrix even when all cases drop the same cell", () => {
    const twoTargets = rrsiNativeEvaluationFixture({ targetCount: 2 });
    const plan = buildRrsiNativeEvaluationPlan(twoTargets);
    expect(plan.cases.flatMap((entry) => entry.slots)).toHaveLength(48);
    expect(plan.hypothesisCount).toBe(48);
    expect(plan.plannedActorObservationsByArm).toEqual({
      baseline: 5760,
      rsi: 5760,
      rrsi: 5760,
    });
    const reduced = {
      ...twoTargets,
      nativeCases: twoTargets.nativeCases.map((entry) => ({
        ...entry,
        plan: planWith(entry.plan, { cells: entry.plan.cells.slice(1) }),
      })),
    };
    expect(() => buildRrsiNativeEvaluationPlan(reduced)).toThrow(
      /complete declared target matrix/,
    );
  }, 60000);

  it("rejects an oversized generated graph rather than returning an unverifiable artifact", () => {
    const oversized = rrsiNativeEvaluationFixture({ targetCount: 40 });
    expect(() => buildRrsiNativeEvaluationPlan(oversized)).toThrow(
      /exceeds byte limit/,
    );
  }, 60000);
});
