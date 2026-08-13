import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatFn } from "../../src/lib/cowork-adapter.js";
import { startDebate } from "../../src/lib/cowork/debate-review-cli.js";
import { compare } from "../../src/lib/cowork/ab-comparator-cli.js";
import { runReplMeteredModelCallWithLedger } from "../../src/repl/agent-repl.js";

function ollamaResponse(content, inputTokens, outputTokens) {
  return {
    message: { content },
    prompt_eval_count: inputTokens,
    eval_count: outputTokens,
  };
}

function installFetch(responses) {
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => responses[index++] || responses.at(-1),
  }));
  return () => {
    globalThis.fetch = original;
  };
}

function meteredWrapper(records, { initialStartBarrier = 0 } = {}) {
  let startsAtBarrier = 0;
  let releaseStartBarrier = null;
  const startBarrier = initialStartBarrier
    ? new Promise((resolve) => {
        releaseStartBarrier = resolve;
      })
    : null;

  return ({ call, provider, model }) =>
    runReplMeteredModelCallWithLedger({
      sessionId: "scoped-cowork-session",
      provider,
      model,
      source: "model",
      persist: async (type, data) => {
        records.push({ type, data });
        if (
          type === "model_usage_started" &&
          startsAtBarrier < initialStartBarrier
        ) {
          startsAtBarrier += 1;
          if (startsAtBarrier === initialStartBarrier) releaseStartBarrier();
          await startBarrier;
        }
      },
      call,
    }).then(({ result }) => result);
}

function failingMeteredWrapper(records, failType) {
  const failure = new Error(`${failType} persistence failed`);
  return ({ call, provider, model }) =>
    runReplMeteredModelCallWithLedger({
      sessionId: "scoped-cowork-session",
      provider,
      model,
      source: "model",
      persist: async (type, data) => {
        records.push({ type, data });
        if (type === failType) throw failure;
      },
      call,
    }).then(({ result }) => result);
}

function expectExactCallPairs(records, expectedCalls) {
  expect(records).toHaveLength(expectedCalls * 2);
  const started = records.filter(
    (record) => record.type === "model_usage_started",
  );
  const settled = records.filter((record) => record.type === "token_usage");
  expect(started).toHaveLength(expectedCalls);
  expect(settled).toHaveLength(expectedCalls);

  const startedByCallId = new Map(
    started.map((record) => [record.data.callId, record]),
  );
  expect(startedByCallId.size).toBe(expectedCalls);
  expect(new Set(settled.map((record) => record.data.callId)).size).toBe(
    expectedCalls,
  );

  for (const settlement of settled) {
    const matchingStart = startedByCallId.get(settlement.data.callId);
    expect(matchingStart).toBeDefined();
    expect(records.indexOf(matchingStart)).toBeLessThan(
      records.indexOf(settlement),
    );
    expect(settlement.data.source).toBe("model");
  }
}

describe("REPL Cowork direct-call usage boundaries", () => {
  let restoreFetch = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  it.each(["/btw", "autonomous", "interactive planner"])(
    "meters a real %s createChatFn provider call",
    async (surface) => {
      restoreFetch = installFetch([ollamaResponse("ok", 5, 2)]);
      const records = [];
      const chat = createChatFn({
        provider: "ollama",
        callWrapper: meteredWrapper(records),
      });

      await chat([{ role: "user", content: surface }]);

      expectExactCallPairs(records, 1);
    },
  );

  it("pairs concurrent reviewers by callId without requiring adjacent events", async () => {
    restoreFetch = installFetch([
      ollamaResponse("## Verdict\nAPPROVE", 8, 2),
      ollamaResponse("## Verdict\nAPPROVE", 9, 3),
      ollamaResponse("## Verdict\nAPPROVE", 10, 4),
      ollamaResponse("Final Verdict: APPROVE\nConsensus Score: 100", 12, 3),
    ]);
    const records = [];

    await startDebate({
      target: "test",
      code: "const ok = true;",
      perspectives: ["correctness", "security", "performance"],
      llmOptions: {
        provider: "ollama",
        callWrapper: meteredWrapper(records, { initialStartBarrier: 3 }),
      },
    });

    expect(records.slice(0, 3).map((record) => record.type)).toEqual([
      "model_usage_started",
      "model_usage_started",
      "model_usage_started",
    ]);
    expectExactCallPairs(records, 4);
  });

  it("pairs concurrent variants by callId without requiring adjacent events", async () => {
    restoreFetch = installFetch([
      ollamaResponse("A conservative solution", 7, 2),
      ollamaResponse("An innovative solution", 8, 3),
      ollamaResponse("A pragmatic solution", 9, 4),
      ollamaResponse(
        "SCORES:\nVariant 1 (conservative): quality=8, performance=7, readability=9\n" +
          "Variant 2 (innovative): quality=7, performance=8, readability=8\n" +
          "Variant 3 (pragmatic): quality=9, performance=9, readability=8\n" +
          "RANKING: pragmatic, conservative, innovative\nWINNER: pragmatic\nREASON: balanced",
        15,
        4,
      ),
    ]);
    const records = [];

    await compare({
      prompt: "solve",
      variants: 3,
      llmOptions: {
        provider: "ollama",
        callWrapper: meteredWrapper(records, { initialStartBarrier: 3 }),
      },
    });

    expect(records.slice(0, 3).map((record) => record.type)).toEqual([
      "model_usage_started",
      "model_usage_started",
      "model_usage_started",
    ]);
    expectExactCallPairs(records, 4);
  });

  it.each(["debate", "compare"])(
    "does not call the provider when %s started persistence fails",
    async (surface) => {
      restoreFetch = installFetch([ollamaResponse("must not run", 1, 1)]);
      const records = [];
      const llmOptions = {
        provider: "ollama",
        callWrapper: failingMeteredWrapper(records, "model_usage_started"),
      };
      const run =
        surface === "debate"
          ? startDebate({
              target: "test",
              code: "const ok = true;",
              perspectives: ["correctness"],
              llmOptions,
            })
          : compare({ prompt: "solve", variants: 1, llmOptions });

      await expect(run).rejects.toMatchObject({
        runtimeLedgerPersistence: true,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(records.map((record) => record.type)).toEqual([
        "model_usage_started",
      ]);
    },
  );

  it("does not continue to the moderator when reviewer settlement persistence fails", async () => {
    restoreFetch = installFetch([
      ollamaResponse("## Verdict\nAPPROVE", 8, 2),
      ollamaResponse("must not moderate", 12, 3),
    ]);
    const records = [];

    await expect(
      startDebate({
        target: "test",
        code: "const ok = true;",
        perspectives: ["correctness"],
        llmOptions: {
          provider: "ollama",
          callWrapper: failingMeteredWrapper(records, "token_usage"),
        },
      }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(records.map((record) => record.type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
  });

  it("does not continue to the judge when variant settlement persistence fails", async () => {
    restoreFetch = installFetch([
      ollamaResponse("A conservative solution", 7, 2),
      ollamaResponse("must not judge", 15, 4),
    ]);
    const records = [];

    await expect(
      compare({
        prompt: "solve",
        variants: 1,
        llmOptions: {
          provider: "ollama",
          callWrapper: failingMeteredWrapper(records, "token_usage"),
        },
      }),
    ).rejects.toMatchObject({ runtimeLedgerPersistence: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(records.map((record) => record.type)).toEqual([
      "model_usage_started",
      "token_usage",
    ]);
  });
});
