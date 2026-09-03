import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SKILL_REGISTRY_CANDIDATE_CREATED_RESOLUTION_SCHEMA,
  SKILL_REGISTRY_EVAL_COMPLETED_RESOLUTION_SCHEMA,
  SKILL_REGISTRY_HUMAN_TASK_SETTLED_RESOLUTION_SCHEMA,
  SKILL_REGISTRY_TRANSITION_SOURCE_INVALID_CODE,
  captureSkillRegistryTransitionSource,
  createSkillRegistryTransitionSource,
} from "../../src/lib/evolution/skill-registry-transition-source.js";

const TENANT_ID = "tenant-transition-source";
const CANDIDATE_ID = `sha256:${"c".repeat(64)}`;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fixture({ mismatch = false, reversed = false } = {}) {
  const refs = {
    candidateCreatedRef: "candidate-event://candidate-1",
    evalCompletedRef: "eval-event://candidate-1",
    humanTaskSettledRef: "human-task://candidate-1",
  };
  const times = reversed
    ? ["2026-09-03T01:00:00.000Z", "2026-09-03T00:59:00.000Z"]
    : ["2026-09-03T01:00:00.000Z", "2026-09-03T01:01:00.000Z"];
  const calls = [];
  const source = createSkillRegistryTransitionSource({
    tenantId: TENANT_ID,
    candidateCreatedResolver: {
      resolve(request) {
        calls.push(request);
        return {
          schema: SKILL_REGISTRY_CANDIDATE_CREATED_RESOLUTION_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: TENANT_ID,
          ref: request.ref,
          candidateId: CANDIDATE_ID,
          skillName: "repair-unit-tests",
          candidateReceipt: "candidate:signed:one",
          actorReceipt: "actor:signed:one",
          parentReceipt: "parent:signed:one",
          targetReceipt: "target:signed:one",
          effectiveAt: "2026-09-03T00:58:00.000Z",
          receiptDigest: digest("candidate-created"),
        };
      },
    },
    evalCompletedResolver: {
      resolve(request) {
        calls.push(request);
        return {
          schema: SKILL_REGISTRY_EVAL_COMPLETED_RESOLUTION_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: TENANT_ID,
          ref: request.ref,
          candidateId: mismatch ? digest("another-candidate") : CANDIDATE_ID,
          skillName: "repair-unit-tests",
          matrixContext: {
            baselineId: digest("baseline"),
            matrixAuthorityRoot: digest("matrix-authority"),
            matrixEvalId: "matrix-eval-1",
            planDigest: digest("plan"),
          },
          evalReceipt: "eval:signed:one",
          effectiveAt: times[0],
          receiptDigest: digest("eval-completed"),
        };
      },
    },
    humanTaskSettledResolver: {
      resolve(request) {
        calls.push(request);
        return {
          schema: SKILL_REGISTRY_HUMAN_TASK_SETTLED_RESOLUTION_SCHEMA,
          authenticated: true,
          durable: true,
          tenantId: TENANT_ID,
          ref: request.ref,
          candidateId: CANDIDATE_ID,
          skillName: "repair-unit-tests",
          policyReceipt: "policy:signed:one",
          effectiveAt: times[1],
          receiptDigest: digest("human-task-settled"),
        };
      },
    },
  });
  return { calls, refs, source };
}

describe("Skill Registry transition source", () => {
  it("joins three independently durable event resolutions", async () => {
    const { calls, refs, source } = fixture();
    await expect(source.verify(refs)).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      tenantId: TENANT_ID,
      candidateId: CANDIDATE_ID,
      skillName: "repair-unit-tests",
      ...refs,
      receipts: {
        candidateReceipt: "candidate:signed:one",
        evalReceipt: "eval:signed:one",
        policyReceipt: "policy:signed:one",
        actorReceipt: "actor:signed:one",
        parentReceipt: "parent:signed:one",
        targetReceipt: "target:signed:one",
      },
      effectiveAt: "2026-09-03T01:01:00.000Z",
    });
    expect(calls).toHaveLength(3);
    expect(calls.map((request) => request.ref).sort()).toEqual(
      Object.values(refs).sort(),
    );
    expect(captureSkillRegistryTransitionSource(source)).toBe(source);
  });

  it("rejects candidate substitution across event authorities", async () => {
    const { refs, source } = fixture({ mismatch: true });
    await expect(source.verify(refs)).rejects.toMatchObject({
      code: SKILL_REGISTRY_TRANSITION_SOURCE_INVALID_CODE,
    });
  });

  it("rejects an EvalCompleted event after its HumanTask settlement", async () => {
    const { refs, source } = fixture({ reversed: true });
    await expect(source.verify(refs)).rejects.toThrow(/bindings or order/u);
  });

  it("does not accept an unbranded source", () => {
    expect(() =>
      captureSkillRegistryTransitionSource({ verify: async () => ({}) }),
    ).toThrow(/branded/u);
  });
});
