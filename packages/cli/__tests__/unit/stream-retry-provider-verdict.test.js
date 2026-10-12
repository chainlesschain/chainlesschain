import { describe, expect, it, vi } from "vitest";
import { _retryStreamingChat } from "../helpers/test-model-egress.js";
import { isRetryableStreamError } from "../../src/lib/stream-retry.js";
import { formatProviderHttpError } from "../../src/lib/provider-http-error.js";
import { normalizeOpenAIResponsesResponse } from "../../src/lib/openai-responses.js";

async function expectSingleAttempt(error) {
  const request = vi.fn().mockRejectedValue(error);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const onRetry = vi.fn();
  await expect(
    _retryStreamingChat(request, { retries: 2, sleep, onRetry }),
  ).rejects.toBe(error);
  expect(request).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(onRetry).not.toHaveBeenCalled();
}

describe("provider verdicts cannot become connection retries", () => {
  const httpCases = [400, 401, 403, 429, 500, 503].flatMap((status) =>
    ["network error", "request timed out", "fetch failed"].map((message) => [
      status,
      message,
    ]),
  );

  it.each(httpCases)(
    "makes one attempt for HTTP %s containing %s",
    async (status, message) => {
      const error = new Error(
        formatProviderHttpError("openai", status, {
          error: { code: "network_error", message },
        }),
      );
      expect(isRetryableStreamError(error)).toBe(false);
      await expectSingleAttempt(error);
    },
  );

  it.each(["request_timeout", "network_error", "econnreset"])(
    "does not replay a failed Responses verdict named %s",
    async (code) => {
      let error;
      try {
        normalizeOpenAIResponsesResponse({
          status: "failed",
          error: { code },
        });
      } catch (failure) {
        error = failure;
      }
      expect(error?.code).toBe("CC_OPENAI_RESPONSES_FAILED");
      expect(isRetryableStreamError(error)).toBe(false);
      await expectSingleAttempt(error);
    },
  );

  it.each([
    { status: 429 },
    { statusCode: 503 },
    { status: 403, code: "ECONNRESET" },
    { statusCode: 500, cause: { code: "UND_ERR_SOCKET" } },
  ])("gives HTTP failure metadata precedence: %j", async (metadata) => {
    const error = Object.assign(new Error("network error"), metadata);
    expect(isRetryableStreamError(error)).toBe(false);
    await expectSingleAttempt(error);
  });

  it.each([
    new TypeError("fetch failed"),
    Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    Object.assign(new Error("request timed out"), { status: 200 }),
    Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_SOCKET" },
    }),
  ])("keeps genuine transport retries for %s", async (error) => {
    const result = { message: { role: "assistant", content: "recovered" } };
    const request = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(result);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    expect(isRetryableStreamError(error)).toBe(true);
    await expect(
      _retryStreamingChat(request, { retries: 2, sleep, onRetry }),
    ).resolves.toBe(result);
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
