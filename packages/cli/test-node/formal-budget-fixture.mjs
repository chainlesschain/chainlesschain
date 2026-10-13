import { evidenceDigest } from "../src/lib/formal-budget-contract.js";
export const NOW = 1_800_000_000_000;
export const body = {
  model: "fixture-model",
  messages: [{ role: "user", content: "synthetic task" }],
};
export function response(overrides = {}) {
  return {
    id: "fixture-response",
    model: "fixture-model",
    service_tier: "default",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: "fixture" },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens_details: { reasoning_tokens: 4 },
    },
    ...overrides,
  };
}
export function config() {
  const plan = {
    lineageId: "fixture-original-lineage",
    digest: "a".repeat(64),
    limitUsdMicros: 99_000_000,
    tasks: Array.from({ length: 45 }, (_, index) => ({
      id: `task-${index}`,
      kind: index < 36 ? "task" : "soak",
      capUsdMicros: index < 36 ? 2_000_000 : 3_000_000,
      contractId:
        index >= 18 && index < 36 ? "fixture-openai" : "fixture-contract",
    })),
  };
  const contracts = [
    {
      id: "fixture-contract",
      provider: "volcengine",
      model: "fixture-model",
      endpoint: "https://fixture.invalid/v1/chat/completions",
      protocol: "openai-chat",
      currency: "CNY",
      validFrom: NOW - 1000,
      validUntil: NOW + 100_000,
      maxInputTokens: 1000,
      maxAnswerTokens: 1000,
      maxReasoningTokens: 1000,
      inputEnvelope: {
        kind: "json-utf8-byte-ceiling/v1",
        requestSchema: "text-function-chat/v1",
        maximumRequestBytes: 4096,
        inclusivePromptTokenUpperBound: 1000,
        includesMessagesToolsAndProviderFraming: true,
        includesAllBilledInputAndImplicitSystemOverhead: true,
      },
      inputMicrosPerMillion: 1_000_000,
      cachedMicrosPerMillion: 100_000,
      outputMicrosPerMillion: 1_000_000,
      fixedFeeMicros: 0,
      defaultThinkingPreserved: true,
      allBilledDimensionsBounded: true,
      responseTiers: ["default"],
    },
  ];
  contracts.push({ ...contracts[0], id: "fixture-openai", provider: "openai" });
  const fx = [
    {
      currency: "CNY",
      numerator: 1,
      denominator: 2,
      includesSettlementFees: true,
      validFrom: NOW - 1000,
      validUntil: NOW + 100_000,
    },
  ];
  const history = {
    lineageId: plan.lineageId,
    planDigest: plan.digest,
    complete: true,
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      spentUsdMicros: 0,
      reservedUsdMicros: 0,
      runsUsed: 0,
      unknown: false,
    })),
  };
  return attest({ plan, contracts, fx, history });
}
export function attest(value) {
  const receipt = (subject) => ({
    id: "OFFLINE-FIXTURE-NOT-ACCOUNT-EVIDENCE",
    sha256: evidenceDigest(subject),
  });
  value.evidence = {
    plan: receipt(value.plan),
    history: receipt(value.history),
    contracts: Object.fromEntries(
      value.contracts.map((c) => [c.id, receipt(c)]),
    ),
    fx: Object.fromEntries(value.fx.map((c) => [c.currency, receipt(c)])),
  };
  return value;
}
// This verifier is test-only. It is never exported by shipped production modules.
export const verifyFixtureEvidence = ({ subjectDigest, receipt }) =>
  receipt.id === "OFFLINE-FIXTURE-NOT-ACCOUNT-EVIDENCE" &&
  receipt.sha256 === subjectDigest;
