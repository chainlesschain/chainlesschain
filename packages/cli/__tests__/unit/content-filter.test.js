import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { agentLoop, chatWithTools } from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
import { _accumulateOpenAIStream } from "../../src/runtime/provider-stream-state.js";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const fixtureBase = path.resolve(
  process.env.CC_CONTENT_FILTER_FIXTURE_BASE || tmpdir(),
);
const fixture = fs.mkdtempSync(path.join(fixtureBase, "cc-content-filter-"));
const observations = [];
afterAll(() => {
  if (process.env.CC_CONTENT_FILTER_REVIEW_REPORT)
    fs.writeFileSync(
      process.env.CC_CONTENT_FILTER_REVIEW_REPORT,
      JSON.stringify(observations, null, 2) + "\n",
    );
  if (
    path.dirname(path.resolve(fixture)) !== fixtureBase ||
    !path.basename(fixture).startsWith("cc-content-filter-")
  )
    throw new Error("Unsafe fixture cleanup");
  fs.rmSync(fixture, { recursive: true, force: true });
});
const options = {
  provider: "deepseek",
  model: "filter-fixture",
  apiKey: "fixture-only",
  baseUrl: "http://127.0.0.1:1/v1",
  cwd: fixture,
};
const usage = { prompt_tokens: 12, completion_tokens: 8 };
const tool = {
  id: "filtered-call",
  type: "function",
  function: { name: "list_dir", arguments: JSON.stringify({ path: "." }) },
};
function body(reason = "content_filter", calls = null, tokens = usage) {
  return {
    choices: [
      {
        index: 0,
        finish_reason: reason,
        message: {
          role: "assistant",
          content: reason === "stop" ? "complete" : "FILTERED_PARTIAL",
          ...(calls ? { tool_calls: calls } : {}),
        },
      },
    ],
    ...(tokens ? { usage: tokens } : {}),
  };
}
function mockJson(first) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          globalThis.fetch.mock.calls.length === 1 ? first : body("stop"),
        ),
        { headers: { "content-type": "application/json" } },
      ),
  );
}
async function collect(extra = {}) {
  const events = [],
    messages = [
      { role: "user", content: "Give a short answer without changing files." },
    ];
  let error;
  try {
    for await (const e of agentLoop(messages, {
      ...options,
      iterationBudget: new IterationBudget({ limit: 3 }),
      enabledToolNames: ["list_dir"],
      exactToolNames: true,
      ...extra,
    }))
      events.push(e);
  } catch (e) {
    error = e;
  }
  observations.push({
    errorCode: error?.code ?? null,
    providerCalls: globalThis.fetch.mock.calls.length,
    eventTypes: events.map((e) => e.type),
    final: events
      .filter((e) => e.type === "response-complete")
      .map((e) => e.content),
    assistantOrToolMessagesPersisted: messages.some(
      (m) => m.role === "assistant" || m.tool_calls,
    ),
  });
  return { events, messages, error };
}
const filteredSse = (conflict = false) => [
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "FILTERED_PARTIAL", tool_calls: [{ index: 0, ...tool }] }, finish_reason: "content_filter" }] })}`,
  ...(conflict
    ? [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      ]
    : []),
  `data: ${JSON.stringify({ choices: [], usage })}`,
  "data: [DONE]",
];
describe("provider content_filter is terminal without recovery", () => {
  it("preserves the explicit JSON filter reason at the real adapter", async () => {
    mockJson(body());
    expect(
      await chatWithTools([{ role: "user", content: "hi" }], options),
    ).toMatchObject({
      finishReason: "content_filter",
      usage: { output_tokens: 8 },
    });
  });
  it.each([null, [tool]])(
    "settles and rejects the complete filtered round (%j)",
    async (calls) => {
      mockJson(body("content_filter", calls));
      const { events, messages, error } = await collect();
      expect(events.filter((e) => e.type === "token-usage")).toHaveLength(1);
      expect(error?.code).toBe("CC_MODEL_CONTENT_FILTER");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(
        events.some((e) =>
          [
            "tool-executing",
            "tool-result",
            "response-complete",
            "iteration-warning",
          ].includes(e.type),
        ),
      ).toBe(false);
      expect(messages.some((m) => m.role === "assistant" || m.tool_calls)).toBe(
        false,
      );
    },
  );
  it("never recovers a filtered response with missing usage", async () => {
    mockJson(body("content_filter", [tool], null));
    const { events, error } = await collect();
    expect(error?.code).toBe("CC_MODEL_CONTENT_FILTER");
    expect(events.filter((e) => e.type === "model-usage-unknown")).toHaveLength(
      1,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (e) => e.type === "tool-executing" || e.type === "response-complete",
      ),
    ).toBe(false);
  });
  it.each([false, true])(
    "rejects SSE filtering even with later conflicting stop (%s)",
    async (conflict) => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(filteredSse(conflict).join("\n\n") + "\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      );
      const { events, error } = await collect({ onToken: () => {} });
      expect(error?.code).toBe("CC_MODEL_CONTENT_FILTER");
      expect(events.filter((e) => e.type === "token-usage")).toHaveLength(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(
        events.some((e) =>
          ["tool-executing", "response-complete", "iteration-warning"].includes(
            e.type,
          ),
        ),
      ).toBe(false);
    },
  );
  it("keeps content_filter sticky across conflicting stop and length frames", () => {
    for (const reasons of [
      ["content_filter", "stop"],
      ["content_filter", "length"],
      ["length", "content_filter"],
    ]) {
      const lines = reasons.map(
        (finish_reason) =>
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason }] })}`,
      );
      lines.push(
        `data: ${JSON.stringify({ choices: [], usage })}`,
        "data: [DONE]",
      );
      expect(_accumulateOpenAIStream(lines)).toMatchObject({
        finishReason: "content_filter",
        providerTerminationComplete: false,
      });
    }
  });
  it("retains ordinary successful stop behavior", async () => {
    mockJson(body("stop"));
    const { events, error } = await collect();
    expect(error).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(
      events
        .filter((e) => e.type === "response-complete")
        .map((e) => e.content),
    ).toEqual(["complete"]);
  });
});
