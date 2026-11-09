import { estimateCost, mergePricing } from "../../src/lib/llm-pricing.js";

// Diagnostic estimates only, never account-attested settlement or a financial
// ceiling. Keep native CNY separate from the application's unmatched USD rate.
export function resolveContinuationProbeEstimate({
  provider,
  model,
  inputBytes,
  outputTokens,
  pricing,
}) {
  if (
    !Number.isSafeInteger(inputBytes) ||
    inputBytes < 1 ||
    inputBytes > 128 * 1024
  )
    throw new Error("Invalid diagnostic request byte bound");
  if (
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 1 ||
    outputTokens > 256
  )
    throw new Error("Invalid diagnostic output bound");
  const quote = estimateCost({
    provider,
    model,
    inputTokens: inputBytes,
    outputTokens,
    table: mergePricing(pricing),
  });
  let estimate;
  if (quote.matched) {
    estimate = {
      currency: "USD",
      amount: quote.totalCost,
      source: "existing CLI diagnostic estimator",
    };
  } else if (
    provider === "volcengine" &&
    model === "deepseek-v4-1-flash-economy-261017"
  ) {
    // Official Ark pricing rechecked 2026-11-09: economy peak 1.60/6.40
    // CNY per million input/output tokens. Use peak, no cache discount, for
    // both windows; completion-time window and account terms remain unverified.
    estimate = {
      currency: "CNY",
      amount: (inputBytes * 16 + outputTokens * 64) / 10_000_000,
      inputPerMillion: 1.6,
      outputPerMillion: 6.4,
      source:
        "https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1",
      verifiedAt: "2026-11-09",
      windowAssumption: "maximum published peak rate; no cache discount",
    };
  } else {
    throw new Error("Unpriced diagnostic model");
  }
  if (
    !Number.isFinite(estimate.amount) ||
    estimate.amount < 0 ||
    estimate.amount > 0.05
  )
    throw new Error(`Diagnostic estimate stop reached (${estimate.currency})`);
  return {
    ...estimate,
    inputBasis: "UTF-8 request bytes as conservative token proxy",
    requestedMaxOutputTokens: outputTokens,
    maximumDiagnosticEstimate: 0.05,
    accountBillingVerified: false,
    financialCeilingVerified: false,
    paidReady: false,
  };
}
