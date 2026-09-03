import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";

const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;

const sha256 = (character) => `sha256:${character.repeat(64)}`;

export function settledSkillInvocationReceipt(overrides = {}) {
  const started = startSkillInvocation(
    {
      receiptId: overrides.receiptId || "skill-invocation:test-receipt",
      selectedSkillDigest: sha256("a"),
      routerCandidates: [
        { digest: sha256("a"), score: 1, reason: "exact test candidate" },
      ],
      evolutionRunId: "evolution-run:test",
      traceId: "trace:test",
      trajectorySegmentId: "trajectory:test",
      providerModelVersion: "test-provider/test-model@1",
      toolSetDigest: sha256("b"),
      osSandboxPermissionPolicyDigest: sha256("c"),
      taskCohort: "test",
      attributionRequired: true,
    },
    {
      clock: () => "2026-09-03T00:00:00.000Z",
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    },
  );
  return settleSkillInvocation(
    started,
    {
      executionStatus: overrides.executionStatus || "completed",
      graderReceipts: [],
      userCorrectionRef: overrides.userCorrectionRef || null,
      tokensInput: 12,
      tokensOutput: 3,
      costUsd: 0.001,
      latencyMs: 25,
    },
    { clock: () => "2026-09-03T00:00:01.000Z" },
  );
}
