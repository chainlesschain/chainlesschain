import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEvolutionCompositionFactory } from "../helpers/test-model-egress.js";
import { executePmExplorationBudgetedOperation } from "../../src/lib/evolution/pm-exploration-budget-executor.js";
import {
  PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
  createPmExplorationVolcengineProvider,
  inspectPmExplorationVolcengineProvider,
  invokePmExplorationVolcengine,
} from "../../src/lib/evolution/pm-exploration-volcengine-provider.js";

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function evolutionIngress(runId) {
  const composition = await createTestEvolutionCompositionFactory()({ runId });
  return composition.evolutionIngress;
}

function response({ content = '{"answer":"ok"}', usage = true } = {}) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      ...(usage
        ? {
            usage: {
              prompt_tokens: 14,
              completion_tokens: 6,
              prompt_tokens_details: { cached_tokens: 4 },
            },
          }
        : {}),
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PM exploration Volcengine provider", () => {
  it("charges provider-reported usage and returns a priced durable settlement", async () => {
    const fetchMock = vi.fn(async (_url, request) => {
      expect(request.headers.Authorization).toBe("Bearer local-test-secret");
      expect(JSON.parse(request.body)).toMatchObject({
        model: "deepseek-v4-flash-ga-260731",
        max_tokens: 64,
      });
      return response();
    });
    vi.stubGlobal("fetch", fetchMock);
    const persisted = [];
    const provider = createPmExplorationVolcengineProvider({
      apiKey: "local-test-secret",
      model: "deepseek-v4-flash-ga-260731",
      maxOutputTokens: 128,
      timeoutMs: 1_000,
      evolutionIngress: await evolutionIngress("pm-volcengine-accounting"),
      persistSettlement: async (settlement) => {
        persisted.push(settlement);
        return {
          schema: PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
          settlementDigest: settlement.settlementDigest,
          persisted: true,
          durable: true,
          recordDigest: sha(settlement.settlementDigest),
        };
      },
    });

    const outcome = await executePmExplorationBudgetedOperation({
      limits: { maxTokens: 100, maxToolCalls: 0, maxWallClockMs: 5_000 },
      operation: (runtime) =>
        invokePmExplorationVolcengine(provider, {
          messages: [
            { role: "system", content: "Return strict JSON." },
            { role: "user", content: "Complete the bounded PM step." },
          ],
          runtime,
          maxOutputTokens: 64,
          operationId: "runner.round-one",
          executionRequestDigest: sha("execution-request-one"),
        }),
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.metrics.tokens).toBe(20);
    expect(outcome.value.content).toBe('{"answer":"ok"}');
    expect(outcome.value.settlement).toMatchObject({
      provider: "volcengine",
      model: "deepseek-v4-flash-ga-260731",
      operationId: "runner.round-one",
      usage: {
        inputTokens: 10,
        outputTokens: 6,
        cacheReadTokens: 4,
        cacheCreationTokens: 0,
        totalTokens: 20,
      },
      estimatedCost: {
        currency: "USD",
        rate: { in: 0.14, out: 0.28, pattern: "deepseek-v4-flash" },
      },
    });
    expect(outcome.value.settlement.estimatedCost.total).toBeCloseTo(
      0.000003136,
      12,
    );
    expect(outcome.value.persistence).toMatchObject({
      persisted: true,
      durable: true,
      settlementDigest: outcome.value.settlement.settlementDigest,
    });
    expect(persisted).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();

    const descriptor = inspectPmExplorationVolcengineProvider(provider);
    expect(descriptor).toMatchObject({
      provider: "volcengine",
      model: "deepseek-v4-flash-ga-260731",
      pricingPattern: "deepseek-v4-flash",
      settlementPersistenceRequired: true,
    });
    expect(JSON.stringify(descriptor)).not.toContain("local-test-secret");
    expect(JSON.stringify(outcome.value.settlement)).not.toContain(
      "Complete the bounded PM step",
    );
    expect(JSON.stringify(outcome.value.settlement)).not.toContain(
      '{"answer":"ok"}',
    );
  });

  it("fails closed when the provider omits usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ usage: false })),
    );
    const persistSettlement = vi.fn();
    const provider = createPmExplorationVolcengineProvider({
      apiKey: "local-test-secret",
      model: "deepseek-v4-flash-ga-260731",
      maxOutputTokens: 64,
      timeoutMs: 1_000,
      evolutionIngress: await evolutionIngress("pm-volcengine-missing-usage"),
      persistSettlement,
    });

    const outcome = await executePmExplorationBudgetedOperation({
      limits: { maxTokens: 100, maxToolCalls: 0, maxWallClockMs: 5_000 },
      operation: (runtime) =>
        invokePmExplorationVolcengine(provider, {
          messages: [{ role: "user", content: "Return JSON." }],
          runtime,
          maxOutputTokens: 32,
          operationId: "grader.round-one",
          executionRequestDigest: sha("execution-request-two"),
        }),
    });

    expect(outcome).toMatchObject({
      status: "failed",
      failureClass: "infrastructure",
      metrics: { tokens: 0 },
    });
    expect(persistSettlement).not.toHaveBeenCalled();
  });

  it("turns post-call usage above the host cap into a budget abort", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    const persistSettlement = vi.fn();
    const provider = createPmExplorationVolcengineProvider({
      apiKey: "local-test-secret",
      model: "deepseek-v4-flash-ga-260731",
      maxOutputTokens: 64,
      timeoutMs: 1_000,
      evolutionIngress: await evolutionIngress("pm-volcengine-budget"),
      persistSettlement,
    });

    const outcome = await executePmExplorationBudgetedOperation({
      limits: { maxTokens: 19, maxToolCalls: 0, maxWallClockMs: 5_000 },
      operation: (runtime) =>
        invokePmExplorationVolcengine(provider, {
          messages: [{ role: "user", content: "Return JSON." }],
          runtime,
          maxOutputTokens: 32,
          operationId: "runner.over-budget",
          executionRequestDigest: sha("execution-request-three"),
        }),
    });

    expect(outcome).toMatchObject({
      status: "aborted",
      failureClass: "budget",
      reason: "max-tokens",
      metrics: { tokens: 20 },
    });
    expect(persistSettlement).not.toHaveBeenCalled();
  });

  it("requires governed ingress, the pinned endpoint, and priced models", async () => {
    expect(() =>
      createPmExplorationVolcengineProvider({
        apiKey: "local-test-secret",
        model: "deepseek-v4-flash-ga-260731",
      }),
    ).toThrow("branded Agent evolution ingress");

    const ingress = await evolutionIngress("pm-volcengine-validation");
    expect(() =>
      createPmExplorationVolcengineProvider({
        apiKey: "local-test-secret",
        model: "deepseek-v4-flash-ga-260731",
        baseUrl: "https://example.test/api/v3",
        evolutionIngress: ingress,
      }),
    ).toThrow("built-in endpoint");
    expect(() =>
      createPmExplorationVolcengineProvider({
        apiKey: "local-test-secret",
        model: "unpriced-private-model",
        evolutionIngress: ingress,
      }),
    ).toThrow("unpriced");
  });

  it("rejects non-durable settlement acknowledgements", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    const provider = createPmExplorationVolcengineProvider({
      apiKey: "local-test-secret",
      model: "deepseek-v4-flash-ga-260731",
      maxOutputTokens: 64,
      timeoutMs: 1_000,
      evolutionIngress: await evolutionIngress("pm-volcengine-persistence"),
      persistSettlement: async (settlement) => ({
        schema: PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
        settlementDigest: settlement.settlementDigest,
        persisted: true,
        durable: false,
        recordDigest: sha("not-durable"),
      }),
    });

    const outcome = await executePmExplorationBudgetedOperation({
      limits: { maxTokens: 100, maxToolCalls: 0, maxWallClockMs: 5_000 },
      operation: (runtime) =>
        invokePmExplorationVolcengine(provider, {
          messages: [{ role: "user", content: "Return JSON." }],
          runtime,
          maxOutputTokens: 32,
          operationId: "evaluator.persistence",
          executionRequestDigest: sha("execution-request-four"),
        }),
    });

    expect(outcome).toMatchObject({
      status: "failed",
      failureClass: "infrastructure",
      metrics: { tokens: 20 },
    });
  });
});
