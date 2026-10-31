import { describe, expect, it, vi } from "vitest";
import { PromptCompressor } from "../../src/harness/prompt-compressor.js";
import { createProviderResponseError } from "../../src/lib/provider-http-error.js";

const history = [
  { role: "system", content: "Preserve the task." },
  { role: "user", content: "Fix the checkout race without widening access." },
  { role: "assistant", content: "Decision: use revision CAS." },
  { role: "assistant", content: "Changed src/store.js." },
  { role: "assistant", content: "Tests passed with Vitest." },
  { role: "user", content: "Continue with verification." },
];

async function compressFailure(error) {
  const llmQuery = vi.fn().mockRejectedValue(error);
  const compressor = new PromptCompressor({
    maxMessages: 4,
    maxTokens: 10,
    llmQuery,
  });
  const { stats } = await compressor.compress(history);
  expect(llmQuery).toHaveBeenCalledOnce();
  expect(stats).toMatchObject({
    degraded: true,
    summaryUsageUnknown: true,
    summaryUsageUnknownReason: "provider_transport_outcome_unknown",
  });
  expect(stats.summaryUsage).toBeUndefined();
  return stats.summaryProviderError;
}

describe("compaction provider diagnostics", () => {
  it.each([
    [401, "authentication"],
    [403, "access_denied"],
    [429, "rate_limit"],
    [503, "server_error"],
    [400, "http_error"],
  ])(
    "preserves HTTP %i without changing unknown usage",
    async (status, category) => {
      const error = await createProviderResponseError(
        "test-provider",
        new Response(
          JSON.stringify({ error: { message: "PRIVATE_BODY network error" } }),
          {
            status,
          },
        ),
      );
      error.code = "PRIVATE_CODE";
      expect(await compressFailure(error)).toEqual({
        category,
        httpStatus: status,
      });
    },
  );

  it("preserves an allowlisted nested network code without private request details", async () => {
    const error = new TypeError(
      "fetch failed: https://private.example/PRIVATE_TOKEN",
      {
        cause: Object.assign(new Error("PRIVATE_CAUSE"), {
          code: "ECONNRESET",
        }),
      },
    );
    expect(await compressFailure(error)).toEqual({
      category: "network",
      code: "ECONNRESET",
    });
  });

  it.each([
    new SyntaxError("PRIVATE_RESPONSE is invalid JSON"),
    new TypeError("Invalid API response: PRIVATE_RESPONSE"),
  ])(
    "classifies response decoding failures without the raw response",
    async (error) => {
      expect(await compressFailure(error)).toEqual({
        category: "invalid_response",
      });
    },
  );

  it("does not project arbitrary error codes or malformed status values", async () => {
    const error = Object.assign(new Error("PRIVATE_BODY"), {
      code: "PRIVATE_CODE",
      status: "401 PRIVATE_TOKEN",
    });
    expect(await compressFailure(error)).toEqual({ category: "unknown" });
  });

  it("keeps missing usage distinct from a failed provider call", async () => {
    const compressor = new PromptCompressor({
      maxMessages: 4,
      maxTokens: 10,
      llmQuery: async () => ({ summary: "invalid summary", usage: null }),
    });
    const { stats } = await compressor.compress(history);
    expect(stats.summaryUsageUnknownReason).toBe("provider_usage_not_reported");
    expect(stats.summaryProviderError).toBeUndefined();
  });
});
