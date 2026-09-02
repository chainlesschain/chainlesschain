import crypto from "node:crypto";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const { BaseSkill } = require("../base-skill.js");
const {
  SKILL_INVOCATION_RECEIPT_SCHEMA,
  buildSkillInvocationTraceProjection,
  startSkillInvocation,
  settleSkillInvocation,
  verifySkillInvocationReceipt,
} = require("../skill-invocation-receipt.js");
const { SkillMetricsCollector } = require("../skill-metrics-collector.js");
const { SkillRegistry } = require("../skill-registry.js");

const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;

function completeContext(overrides = {}) {
  return {
    skillLifecycleMode: "canary",
    evolutionRunId: "evolution-run:test",
    traceId: "trace:test",
    trajectorySegmentId: "segment:test:1",
    providerModelVersion: "provider:model@1",
    toolSetDigest: digest("tools:v1"),
    osSandboxPermissionPolicyDigest: digest("policy:v1"),
    taskCohort: "cohort:test",
    ...overrides,
  };
}

class ReceiptTestSkill extends BaseSkill {
  constructor() {
    super({ skillId: "receipt-test", version: "1.0.0" });
  }

  async execute() {
    return {
      ok: true,
      usage: { inputTokens: 7, outputTokens: 3, costUsd: 0.02 },
    };
  }
}

describe("SkillInvocationReceipt", () => {
  it("creates a digest-bound, content-free settled receipt", () => {
    const selected = digest("skill:v1");
    const started = startSkillInvocation(
      {
        ...completeContext(),
        attributionRequired: true,
        selectedSkillDigest: selected,
        routerCandidates: [
          { digest: selected, score: 0.9, reason: "best capability match" },
        ],
      },
      {
        clock: () => "2026-09-02T00:00:00.000Z",
        randomUUID: () => "receipt-1",
      },
    );
    const settled = settleSkillInvocation(
      started,
      {
        executionStatus: "completed",
        graderReceipts: [digest("grader:1")],
        tokensInput: 7,
        tokensOutput: 3,
        costUsd: 0.02,
        latencyMs: 12,
      },
      { clock: () => "2026-09-02T00:00:01.000Z" },
    );

    expect(settled).toMatchObject({
      schema: SKILL_INVOCATION_RECEIPT_SCHEMA,
      attributionStatus: "complete",
      attributionEligible: true,
      executionStatus: "completed",
      selectedSkillDigests: [selected],
      tokenCostLatency: {
        tokensInput: 7,
        tokensOutput: 3,
        costUsd: 0.02,
        latencyMs: 12,
      },
    });
    expect(settled.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(settled)).not.toContain("prompt");
    expect(Object.isFrozen(settled)).toBe(true);
    expect(verifySkillInvocationReceipt(settled)).toBe(settled);
    const projection = buildSkillInvocationTraceProjection(
      [settled],
      "trace:test",
    );
    expect(projection).toMatchObject({
      complete: true,
      receiptCount: 1,
      totals: { tokensInput: 7, tokensOutput: 3, costUsd: 0.02, latencyMs: 12 },
      invocations: [
        {
          selectedSkillDigests: [selected],
          executionStatus: "completed",
          graderReceipts: [digest("grader:1")],
        },
      ],
    });
    expect(() =>
      verifySkillInvocationReceipt({ ...settled, executionStatus: "failed" }),
    ).toThrow(/digest/u);
  });

  it("fails closed before automatic-candidate or canary execution when attribution is incomplete", async () => {
    const registry = new SkillRegistry({ autoLoad: false });
    const skill = new ReceiptTestSkill();
    registry.register(skill);

    await expect(
      registry.executeSkill(
        "receipt-test",
        {},
        { skillLifecycleMode: "canary" },
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_ATTRIBUTION_REQUIRED" });
    expect(skill.metrics.invocations).toBe(0);
  });

  it("joins selection, environment, outcome, grader, token, cost, and latency through the collector", async () => {
    const registry = new SkillRegistry({ autoLoad: false });
    const collector = new SkillMetricsCollector({
      skillRegistry: registry,
      flushInterval: 60_000,
    });
    const skill = new ReceiptTestSkill();
    registry.register(skill);
    collector.initialize();
    const recorded = new Promise((resolve) =>
      collector.once("invocation-receipt-recorded", resolve),
    );

    await registry.executeSkill("receipt-test", {}, completeContext());
    const receipt = await recorded;
    collector.destroy();

    expect(receipt).toMatchObject({
      evolutionRunId: "evolution-run:test",
      traceId: "trace:test",
      trajectorySegmentId: "segment:test:1",
      providerModelVersion: "provider:model@1",
      toolSetDigest: digest("tools:v1"),
      osSandboxPermissionPolicyDigest: digest("policy:v1"),
      taskCohort: "cohort:test",
      attributionEligible: true,
      executionStatus: "completed",
      tokenCostLatency: { tokensInput: 7, tokensOutput: 3, costUsd: 0.02 },
    });
    expect(receipt.routerCandidates[0].reason).toBe(
      "direct-registry-execution",
    );
    expect(collector.exportMetrics().buffer[0].contextJson).toContain(
      receipt.receiptDigest,
    );
  });
});
