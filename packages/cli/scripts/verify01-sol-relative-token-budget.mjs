import { createHash } from "node:crypto";
import { OPENAI_BROKER } from "./verify01-openai-diagnostic-broker.mjs";

// Configured reference allowances, not historical spend or a provider invoice.
export const SOL_TOKEN_BUDGET_REFERENCE = Object.freeze({
  provider: "openai",
  model: OPENAI_BROKER.model,
  policyDigest:
    "sha256:" +
    createHash("sha256").update(JSON.stringify(OPENAI_BROKER)).digest("hex"),
  physicalRequests: OPENAI_BROKER.maximumRequestsPerTask,
  planningWindowTokens: 32768,
  outputTokensPerRequest: OPENAI_BROKER.maximumAnswerTokens,
  internalSummaryTokens: 2048,
});
const reference = SOL_TOKEN_BUDGET_REFERENCE;
export const VOLCENGINE_SOL_RELATIVE_TOKEN_BUDGETS = Object.freeze({
  solTokenBudgetMultiple: 2,
  outputTokens: reference.outputTokensPerRequest * 2,
  maximumTaskOutputTokens:
    reference.physicalRequests * reference.outputTokensPerRequest * 2,
  maximumTaskTokens:
    reference.physicalRequests *
    (reference.planningWindowTokens + reference.outputTokensPerRequest) *
    2,
  internalSummaryTokenMultiplier: 2,
  maximumInternalSummaryTokens: reference.internalSummaryTokens * 2,
});
