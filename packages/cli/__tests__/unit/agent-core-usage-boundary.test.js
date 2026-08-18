import { describe, expect, it, vi } from "vitest";
import {
  _retryStreamingChat,
  agentLoop,
  chatWithTools,
} from "../../src/runtime/agent-core.js";

async function nextEvent(generator, type) {
  for (;;) {
    const step = await generator.next();
    if (step.done) throw new Error(`agent loop ended before ${type}`);
    if (step.value?.type === type) return step.value;
  }
}

async function drain(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

async function drainFailure(generator) {
  const events = [];
  try {
    for await (const event of generator) events.push(event);
  } catch (error) {
    return { error, events };
  }
  throw new Error("expected agent loop to reject");
}

function loopOptions(chatFn, extra = {}) {
  return {
    provider: "ollama",
    model: "unit-model",
    chatFn,
    runnableProviderFallback: false,
    autoCompact: false,
    ...extra,
  };
}

function largeHistory() {
  const messages = [{ role: "system", content: "system" }];
  for (let index = 0; index < 45; index += 1) {
    messages.push({ role: "user", content: `question ${index}` });
    messages.push({ role: "assistant", content: `answer ${index}` });
  }
  messages.push({ role: "user", content: "finish" });
  return messages;
}

const structuredSummary = JSON.stringify({
  objective: "finish",
  constraints: [],
  keyDecisions: [],
  changedFiles: [],
  tests: [],
  unresolvedSideEffects: [],
  checkpoints: [],
  blockers: [],
  nextSteps: [],
});

describe("agentLoop model usage boundaries", () => {
  it("yields a bounded secret-free start before invoking the model and settles known usage with the same id", async () => {
    const chatFn = vi.fn(async () => ({
      message: { role: "assistant", content: "done" },
      usage: { input_tokens: 3, output_tokens: 2 },
    }));
    const generator = agentLoop(
      [{ role: "user", content: "hello" }],
      loopOptions(chatFn, { runId: "user-secret-run-id" }),
    );

    const started = await nextEvent(generator, "model-usage-started");
    expect(chatFn).not.toHaveBeenCalled();
    expect(started).toMatchObject({
      provider: "ollama",
      model: "unit-model",
      source: "model",
    });
    expect(started.callId).toMatch(/^mdl-[0-9a-f-]{36}$/);
    expect(started.callId.length).toBeLessThanOrEqual(128);
    expect(started.callId).not.toContain("user-secret-run-id");

    const usage = await nextEvent(generator, "token-usage");
    expect(chatFn).toHaveBeenCalledOnce();
    expect(usage).toMatchObject({
      callId: started.callId,
      provider: "ollama",
      model: "unit-model",
      usage: { input_tokens: 3, output_tokens: 2 },
    });
    await drain(generator);
  });

  it("settles a successful response without provider usage as unknown", async () => {
    const generator = agentLoop(
      [{ role: "user", content: "hello" }],
      loopOptions(async () => ({
        message: { role: "assistant", content: "done" },
      })),
    );

    const started = await nextEvent(generator, "model-usage-started");
    const unknown = await nextEvent(generator, "model-usage-unknown");
    expect(unknown).toEqual({
      type: "model-usage-unknown",
      callId: started.callId,
      provider: "ollama",
      model: "unit-model",
      source: "model",
      code: "provider_usage_missing",
    });
    await drain(generator);
  });

  it.each([
    ["empty object", {}],
    ["one-sided totals", { input_tokens: 3 }],
    ["coerced totals", { input_tokens: "3", output_tokens: 2 }],
    [
      "conflicting aliases",
      {
        input_tokens: 3,
        prompt_tokens: 4,
        output_tokens: 2,
        completion_tokens: 2,
      },
    ],
    [
      "invalid optional cache total",
      {
        input_tokens: 3,
        output_tokens: 2,
        cache_read_input_tokens: "0",
      },
    ],
    [
      "conflicting optional cache aliases",
      {
        input_tokens: 3,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_read_tokens: 1,
      },
    ],
  ])("settles %s usage as unknown", async (_label, usage) => {
    const generator = agentLoop(
      [{ role: "user", content: "hello" }],
      loopOptions(async () => ({
        message: { role: "assistant", content: "done" },
        usage,
      })),
    );

    const started = await nextEvent(generator, "model-usage-started");
    const unknown = await nextEvent(generator, "model-usage-unknown");
    expect(unknown).toMatchObject({
      callId: started.callId,
      code: "provider_usage_missing",
    });
    await drain(generator);
  });

  it("keeps explicit zero aliases as known usage", async () => {
    const generator = agentLoop(
      [{ role: "user", content: "hello" }],
      loopOptions(async () => ({
        message: { role: "assistant", content: "done" },
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
      })),
    );

    const started = await nextEvent(generator, "model-usage-started");
    const usage = await nextEvent(generator, "token-usage");
    expect(usage).toMatchObject({
      callId: started.callId,
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    await drain(generator);
  });

  it("settles a successful provider response before honoring a raced abort", async () => {
    const controller = new AbortController();
    const generator = agentLoop(
      [{ role: "user", content: "hello" }],
      loopOptions(
        async () => {
          controller.abort();
          return {
            message: { role: "assistant", content: "done" },
            usage: { input_tokens: 2, output_tokens: 1 },
          };
        },
        { signal: controller.signal },
      ),
    );

    const started = await nextEvent(generator, "model-usage-started");
    const usage = await nextEvent(generator, "token-usage");
    expect(usage.callId).toBe(started.callId);
    await expect(generator.next()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("drops malformed OpenAI cache metadata instead of manufacturing zero", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "done" } }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: "0" },
        },
      }),
    });
    try {
      const result = await chatWithTools([{ role: "user", content: "hello" }], {
        provider: "openai",
        model: "unit-model",
        baseUrl: "https://provider.invalid/v1",
        apiKey: "test-key",
      });
      expect(result.usage).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("yields a closed unknown settlement before rethrowing a provider error", async () => {
    const providerError = new Error("secret provider response body");
    const generator = agentLoop(
      [{ role: "user", content: "hello" }],
      loopOptions(async () => {
        throw providerError;
      }),
    );

    const started = await nextEvent(generator, "model-usage-started");
    const unknown = await generator.next();
    expect(unknown.value).toEqual({
      type: "model-usage-unknown",
      callId: started.callId,
      provider: "ollama",
      model: "unit-model",
      source: "model",
      code: "provider_call_failed",
    });
    expect(JSON.stringify(unknown.value)).not.toContain("secret provider");
    await expect(generator.next()).rejects.toBe(providerError);
  });

  it("disables hidden runnable-provider fallback attempts in strict mode", async () => {
    const chatFn = vi.fn(async (_messages, options) => ({
      message: { role: "assistant", content: options.provider },
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const onProviderFallback = vi.fn();

    await drain(
      agentLoop([{ role: "user", content: "hello" }], {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "configured-key",
        chatFn,
        autoCompact: false,
        strictUsageTelemetry: true,
        onProviderFallback,
      }),
    );

    expect(chatFn).toHaveBeenCalledOnce();
    expect(chatFn.mock.calls[0][1].provider).toBe("anthropic");
    expect(onProviderFallback).not.toHaveBeenCalled();
  });
});

describe("automatic semantic-compaction usage boundaries", () => {
  it("notifies the host synchronously before the provider query and binds known usage", async () => {
    const query = vi.fn(async () => ({
      summary: structuredSummary,
      usage: { input_tokens: 11, output_tokens: 7 },
      provider: "summary-provider",
      model: "summary-model",
    }));
    let boundary = null;
    const onUsageBoundary = vi.fn((event) => {
      expect(query).not.toHaveBeenCalled();
      boundary = event;
    });

    const events = await drain(
      agentLoop(largeHistory(), {
        ...loopOptions(async () => ({
          message: { role: "assistant", content: "done" },
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
        provider: "summary-provider",
        model: "summary-model",
        autoCompact: true,
        autoMicroCompact: false,
        compactionLlmQuery: query,
        onUsageBoundary,
      }),
    );

    expect(onUsageBoundary).toHaveBeenCalledOnce();
    expect(boundary).toMatchObject({
      type: "model-usage-started",
      source: "semantic-compaction",
    });
    expect(boundary.callId).toMatch(/^cmp-[0-9a-f-]{36}$/);
    const usage = events.find(
      (event) =>
        event.type === "token-usage" && event.source === "semantic-compaction",
    );
    expect(usage).toMatchObject({
      callId: boundary.callId,
      provider: "summary-provider",
      model: "summary-model",
      usage: {
        input_tokens: 11,
        output_tokens: 7,
      },
    });
  });

  it("binds semantic compaction to a stable per-effect request id and returned receipt", async () => {
    const workflowEffectId = `sha256:${"9".repeat(64)}`;
    const run = async () => {
      let requestBinding = null;
      let boundary = null;
      const query = vi.fn(async (_prompt, binding) => {
        requestBinding = binding;
        return {
          summary: structuredSummary,
          usage: { input_tokens: 11, output_tokens: 7 },
          provider: "openai",
          model: "summary-model",
          providerReceipt: {
            protocol: "cc-provider-request-receipt/v1",
            provider: "openai",
            clientRequestId: binding.providerRequestId,
            requestId: "req_compaction_1",
            responseId: "chatcmpl_compaction_1",
            requestIdentitySemantics: "trace-only",
            independentlyReadable: false,
          },
        };
      });
      const mainChat = vi.fn(async () => ({
        message: { role: "assistant", content: "done" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const events = await drain(
        agentLoop(largeHistory(), {
          ...loopOptions(mainChat),
          provider: "openai",
          workflowEffectId,
          autoCompact: true,
          autoMicroCompact: false,
          compactionLlmQuery: query,
          onUsageBoundary: (event) => {
            boundary = event;
          },
        }),
      );
      return { boundary, events, mainChat, requestBinding };
    };

    const first = await run();
    const second = await run();
    expect(first.requestBinding).toEqual({
      workflowEffectId,
      callSequence: 1,
      source: "semantic-compaction",
      providerRequestId: expect.stringMatching(/^ccwf_[a-f0-9]{64}$/),
      requestIdentitySemantics: "trace-only",
    });
    expect(Object.isFrozen(first.requestBinding)).toBe(true);
    expect(second.requestBinding.providerRequestId).toBe(
      first.requestBinding.providerRequestId,
    );
    expect(first.boundary).toMatchObject({
      workflowEffectId,
      callSequence: 1,
      source: "semantic-compaction",
      providerRequestId: first.requestBinding.providerRequestId,
      requestIdentitySemantics: "trace-only",
    });
    const receipt = first.events.find(
      (event) =>
        event.type === "provider-request-receipt" &&
        event.source === "semantic-compaction",
    );
    expect(receipt).toMatchObject({
      workflowEffectId,
      callId: first.boundary.callId,
      callSequence: 1,
      clientRequestId: first.requestBinding.providerRequestId,
      requestId: "req_compaction_1",
      responseId: "chatcmpl_compaction_1",
      requestIdentitySemantics: "trace-only",
      independentlyReadable: false,
    });
    const receiptIndex = first.events.indexOf(receipt);
    const usageIndex = first.events.findIndex(
      (event) =>
        event.type === "token-usage" && event.source === "semantic-compaction",
    );
    expect(receiptIndex).toBeGreaterThanOrEqual(0);
    expect(receiptIndex).toBeLessThan(usageIndex);
    expect(first.mainChat.mock.calls[0][1].providerRequestId).not.toBe(
      first.requestBinding.providerRequestId,
    );
  });

  it.each([
    {
      name: "provider failure",
      expectedCode: "CC_WORKFLOW_COMPACTION_PROVIDER_OUTCOME_UNKNOWN",
      expectedReceipts: 0,
      query: async () => {
        throw new Error("connection reset after upload");
      },
    },
    {
      name: "missing provider usage",
      expectedCode: "CC_WORKFLOW_COMPACTION_USAGE_UNKNOWN",
      expectedReceipts: 1,
      query: async (_prompt, binding) => ({
        summary: structuredSummary,
        provider: "openai",
        model: "summary-model",
        providerReceipt: {
          protocol: "cc-provider-request-receipt/v1",
          provider: "openai",
          clientRequestId: binding.providerRequestId,
          requestId: "req_compaction_usage_unknown",
          responseId: null,
          requestIdentitySemantics: "trace-only",
          independentlyReadable: false,
        },
      }),
    },
    {
      name: "mismatched provider receipt",
      expectedCode: "CC_WORKFLOW_COMPACTION_PROVIDER_OUTCOME_UNKNOWN",
      expectedReceipts: 0,
      query: async (_prompt, binding) => ({
        summary: structuredSummary,
        usage: { input_tokens: 11, output_tokens: 7 },
        provider: "openai",
        model: "summary-model",
        providerReceipt: {
          protocol: "cc-provider-request-receipt/v1",
          provider: "anthropic",
          clientRequestId: binding.providerRequestId,
          requestId: "req_wrong_binding",
          responseId: null,
          requestIdentitySemantics: "trace-only",
          independentlyReadable: false,
        },
      }),
    },
  ])(
    "propagates workflow-bound $name after one unknown settlement",
    async ({ expectedCode, expectedReceipts, query }) => {
      const mainChat = vi.fn();
      const outcome = await drainFailure(
        agentLoop(largeHistory(), {
          ...loopOptions(mainChat),
          provider: "openai",
          workflowEffectId: `sha256:${"8".repeat(64)}`,
          autoCompact: true,
          autoMicroCompact: false,
          compactionLlmQuery: query,
        }),
      );

      expect(outcome.error).toMatchObject({ code: expectedCode });
      expect(
        outcome.events.filter(
          (event) => event.type === "compaction-usage-unknown",
        ),
      ).toHaveLength(1);
      expect(
        outcome.events.filter(
          (event) => event.type === "provider-request-receipt",
        ),
      ).toHaveLength(expectedReceipts);
      expect(mainChat).not.toHaveBeenCalled();
    },
  );

  it("prevents the provider call when the synchronous boundary observer fails", async () => {
    const observerError = new Error("ledger unavailable");
    const query = vi.fn(async () => ({
      summary: structuredSummary,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));

    await expect(
      drain(
        agentLoop(largeHistory(), {
          ...loopOptions(async () => ({
            message: { role: "assistant", content: "unreachable" },
            usage: { input_tokens: 1, output_tokens: 1 },
          })),
          provider: "summary-provider",
          model: "summary-model",
          autoCompact: true,
          autoMicroCompact: false,
          compactionLlmQuery: query,
          onUsageBoundary: () => {
            throw observerError;
          },
        }),
      ),
    ).rejects.toBe(observerError);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an async boundary observer before the provider call", async () => {
    const query = vi.fn(async () => ({
      summary: structuredSummary,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));

    await expect(
      drain(
        agentLoop(largeHistory(), {
          ...loopOptions(async () => ({
            message: { role: "assistant", content: "unreachable" },
            usage: { input_tokens: 1, output_tokens: 1 },
          })),
          provider: "summary-provider",
          model: "summary-model",
          autoCompact: true,
          autoMicroCompact: false,
          compactionLlmQuery: query,
          onUsageBoundary: async () => {},
        }),
      ),
    ).rejects.toMatchObject({ code: "CC_USAGE_BOUNDARY_OBSERVER_ASYNC" });
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed before a frozen compactor can make a provider call", async () => {
    const query = vi.fn(async () => ({
      summary: structuredSummary,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const mainChat = vi.fn();
    const frozenCompactor = Object.freeze({
      llmQuery: query,
      shouldAutoCompact: () => true,
      compress: vi.fn(),
    });

    await expect(
      drain(
        agentLoop(largeHistory(), {
          ...loopOptions(mainChat),
          autoCompact: true,
          strictUsageTelemetry: true,
          onUsageBoundary: vi.fn(),
          onUsageSettlement: vi.fn(),
          _autoCompactor: frozenCompactor,
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_COMPACTION_USAGE_INSTRUMENTATION_REQUIRED",
      runtimeLedgerPersistence: true,
    });
    expect(query).not.toHaveBeenCalled();
    expect(mainChat).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing usage",
      query: async () => ({ summary: structuredSummary }),
      code: "provider_usage_missing",
    },
    {
      name: "invalid usage",
      query: async () => ({
        summary: structuredSummary,
        usage: { input_tokens: "11", output_tokens: 7 },
      }),
      code: "provider_usage_missing",
    },
    {
      name: "provider failure",
      query: async () => {
        throw new Error("secret transport details");
      },
      code: "provider_call_failed",
    },
  ])(
    "settles $name with the started call id and stops",
    async ({ query, code }) => {
      let boundary = null;
      const mainChat = vi.fn(async () => ({
        message: { role: "assistant", content: "must not run" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const events = await drain(
        agentLoop(largeHistory(), {
          ...loopOptions(mainChat),
          provider: "summary-provider",
          model: "summary-model",
          autoCompact: true,
          autoMicroCompact: false,
          compactionLlmQuery: query,
          onUsageBoundary: (event) => {
            boundary = event;
          },
        }),
      );

      const unknown = events.find(
        (event) => event.type === "compaction-usage-unknown",
      );
      expect(unknown).toMatchObject({
        callId: boundary.callId,
        source: "semantic-compaction",
        code,
      });
      expect(JSON.stringify(events)).not.toContain("secret transport");
      expect(mainChat).not.toHaveBeenCalled();
    },
  );
});

describe("strict streaming retry observer", () => {
  it("fails closed when the strict retry observer is missing", async () => {
    const drop = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const streamFn = vi.fn(async () => {
      throw drop;
    });

    await expect(
      _retryStreamingChat(streamFn, {
        retries: 1,
        sleep: async () => {},
        strictRetryObserver: true,
      }),
    ).rejects.toMatchObject({
      code: "CC_RETRY_OBSERVER_REQUIRED",
      runtimeLedgerPersistence: true,
    });
    expect(streamFn).toHaveBeenCalledOnce();
  });

  it("rethrows any strict observer failure before another transport attempt", async () => {
    const drop = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const observerError = new Error("transcript identity mismatch");
    const streamFn = vi.fn(async () => {
      throw drop;
    });
    const sleep = vi.fn(async () => {});

    await expect(
      _retryStreamingChat(streamFn, {
        retries: 2,
        sleep,
        strictRetryObserver: true,
        onRetry: () => {
          throw observerError;
        },
      }),
    ).rejects.toBe(observerError);
    expect(streamFn).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps legacy observer failures best-effort", async () => {
    const drop = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const streamFn = vi
      .fn()
      .mockRejectedValueOnce(drop)
      .mockResolvedValueOnce("ok");

    await expect(
      _retryStreamingChat(streamFn, {
        retries: 1,
        sleep: async () => {},
        onRetry: () => {
          throw new Error("ignored observer failure");
        },
      }),
    ).resolves.toBe("ok");
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  it("rejects an async strict observer before retrying", async () => {
    const drop = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const streamFn = vi.fn(async () => {
      throw drop;
    });

    await expect(
      _retryStreamingChat(streamFn, {
        retries: 1,
        sleep: async () => {},
        strictRetryObserver: true,
        onRetry: async () => {},
      }),
    ).rejects.toMatchObject({ code: "CC_RETRY_OBSERVER_ASYNC" });
    expect(streamFn).toHaveBeenCalledOnce();
  });
});
