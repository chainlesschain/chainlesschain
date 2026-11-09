import { describe, expect, it } from "vitest";
import { resolveContinuationProbeEstimate } from "../../scripts/lib/model-continuation-probe-admission.mjs";
import { estimateCost } from "../../src/lib/llm-pricing.js";

const native = {
  provider: "volcengine",
  model: "deepseek-v4-1-flash-economy-261017",
  inputBytes: 10000,
  outputTokens: 256,
};

describe("bounded continuation diagnostic estimates", () => {
  it("keeps published peak CNY separate from unmatched application USD", () => {
    expect(
      estimateCost({ ...native, inputTokens: native.inputBytes }).matched,
    ).toBe(false);
    expect(resolveContinuationProbeEstimate(native)).toMatchObject({
      currency: "CNY",
      amount: 0.0176384,
      inputPerMillion: 1.6,
      outputPerMillion: 6.4,
      financialCeilingVerified: false,
      accountBillingVerified: false,
      paidReady: false,
    });
  });
  it("rejects unknown identities, unsafe bounds and the native estimate stop", () => {
    for (const change of [
      { model: "deepseek-v4-1-flash-economy-unknown" },
      { provider: "custom" },
      { inputBytes: NaN },
      { inputBytes: 0 },
      { inputBytes: 128 * 1024 + 1 },
      { outputTokens: 257 },
      { outputTokens: 0 },
      { outputTokens: Infinity },
      { inputBytes: 100000 },
    ])
      expect(() =>
        resolveContinuationProbeEstimate({ ...native, ...change }),
      ).toThrow();
  });
  it("retains existing matched USD estimates and their separate stop", () => {
    const request = { ...native, provider: "openai", model: "gpt-4o-mini" };
    expect(resolveContinuationProbeEstimate(request)).toMatchObject({
      currency: "USD",
      financialCeilingVerified: false,
    });
    expect(() =>
      resolveContinuationProbeEstimate({ ...request, model: "gpt-4" }),
    ).toThrow(/USD/);
  });
});
