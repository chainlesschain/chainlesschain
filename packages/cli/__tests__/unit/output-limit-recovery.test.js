import { describe, it, expect, vi, afterEach } from "vitest";
import { agentLoop, chatWithTools } from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
import { _accumulateOpenAIStream } from "../../src/runtime/provider-stream-state.js";
import { isProtected } from "@chainlesschain/context-memory-kernel";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const usage = { prompt_tokens: 12, completion_tokens: 8 };
const tool = {
  id: "blocked",
  type: "function",
  function: {
    name: "write_file",
    arguments: JSON.stringify({ path: "must-not-exist.txt", content: "bad" }),
  },
};
const response = (content, calls, reason = "length", tokens = usage) => ({
  id: "fixed-response",
  choices: [
    {
      index: 0,
      finish_reason: reason,
      message: {
        role: "assistant",
        content,
        ...(calls ? { tool_calls: calls } : {}),
      },
    },
  ],
  ...(tokens ? { usage: tokens } : {}),
});
const options = {
  provider: "deepseek",
  model: "test-fixture",
  apiKey: "fixture",
  baseUrl: "http://127.0.0.1:1/v1",
};
const lines = (done = true) => [
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}`,
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] })}`,
  `data: ${JSON.stringify({ choices: [], usage })}`,
  ...(done ? ["data: [DONE]"] : []),
];
async function collect(
  o = {},
  messages = [{ role: "user", content: "Make a short file." }],
  onEvent,
) {
  const events = [];
  let error;
  try {
    for await (const e of agentLoop(messages, { ...options, ...o })) {
      events.push(e);
      onEvent?.(e);
    }
  } catch (e) {
    error = e;
  }
  return { events, error, messages };
}
function mockResponses(...bodies) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(bodies.shift()), {
        headers: { "content-type": "application/json" },
      }),
  );
}
describe("output limit integrity and bounded recovery", () => {
  it.each([85, 100])(
    "preserves the real task under canonical input pressure (%s requirements)",
    async (requirements) => {
      const task =
        "TASK_SENTINEL: implement the requested specific behavior. " +
        "Concrete requirement. ".repeat(requirements);
      const messages = [
        { role: "system", content: "Follow the user's task." },
        { role: "user", content: task },
      ];
      const home = mkdtempSync(join(tmpdir(), "output-limit-canonical-"));
      mockResponses(
        response("partial", null),
        response("complete", null, "stop"),
      );
      try {
        const { events, error } = await collect(
          {
            iterationBudget: new IterationBudget({ limit: Infinity }),
            enabledToolNames: [],
            exactToolNames: true,
            contextMemoryEnv: {
              CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
            },
            contextMemoryFilePath: join(home, "memory.json"),
            contextMemoryRecall: false,
            contextMemoryModelWindowTokens: 1024,
            maxOutputTokens: 256,
          },
          messages,
        );
        expect(messages.filter((m) => m.role === "user")).toEqual([
          { role: "user", content: task },
        ]);
        expect(
          messages.some((m) =>
            m.content?.includes("None of its tool calls were executed"),
          ),
        ).toBe(false);
        if (requirements === 85) {
          expect(error).toBeUndefined();
          expect(globalThis.fetch).toHaveBeenCalledTimes(2);
          const second = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
          expect(
            second.messages.some(
              (m) => m.role === "user" && m.content === task,
            ),
          ).toBe(true);
          expect(
            second.messages.some(
              (m) =>
                m.role === "system" &&
                m.content.includes("None of its tool calls were executed"),
            ),
          ).toBe(true);
          const plan = events
            .filter((e) => e.type === "context.plan.created")
            .at(-1).plan;
          expect(
            isProtected(
              plan.selected.find((item) =>
                item.content.includes("TASK_SENTINEL"),
              ),
            ),
          ).toBe(true);
          expect(
            isProtected(
              plan.selected.find((item) =>
                item.content.includes("None of its tool calls were executed"),
              ),
            ),
          ).toBe(true);
        } else {
          // Both the task and recovery policy are mandatory: fail before another
          // model dispatch instead of evicting the actual user objective.
          expect(error?.code).toBe("context_over_budget");
          expect(error?.message).toContain(
            "protected context exceeds input budget",
          );
          expect(globalThis.fetch).toHaveBeenCalledTimes(1);
          expect(events.some((e) => e.type === "response-complete")).toBe(
            false,
          );
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
  it("preserves JSON termination with usage", async () => {
    mockResponses(response("partial", [tool]));
    expect(
      await chatWithTools([{ role: "user", content: "test" }], options),
    ).toMatchObject({
      finishReason: "length",
      providerTerminationComplete: true,
      usage: { output_tokens: 8 },
    });
  });
  it.each([true, false])(
    "SSE length requires DONE for recovery (%s)",
    (done) => {
      expect(_accumulateOpenAIStream(lines(done))).toMatchObject({
        finishReason: "length",
        providerTerminationComplete: done,
        usage: { output_tokens: 8 },
      });
    },
  );
  it("rejects a conflicting completion after length", () => {
    const frames = lines(false);
    frames.push(
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
    );
    expect(_accumulateOpenAIStream(frames)).toMatchObject({
      finishReason: "length",
      providerTerminationComplete: false,
    });
  });
  it.each([
    null,
    [tool],
    [
      tool,
      {
        ...tool,
        id: "second",
        function: { name: "write_file", arguments: '{"path":' },
      },
    ],
  ])("discards entire truncated text/tool round (%j)", async (calls) => {
    mockResponses(
      response("partial", calls),
      response("complete", null, "stop"),
    );
    const budget = new IterationBudget({ limit: 3 });
    const { events, messages, error } = await collect({
      iterationBudget: budget,
    });
    expect(error).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(budget.consumed).toBe(2);
    expect(events.filter((e) => e.type === "tool-executing")).toEqual([]);
    expect(
      events
        .filter((e) => e.type === "response-complete")
        .map((e) => e.content),
    ).toEqual(["complete"]);
    expect(events.filter((e) => e.type === "token-usage")).toHaveLength(2);
    expect(events.findIndex((e) => e.type === "token-usage")).toBeLessThan(
      events.findIndex((e) => e.type === "iteration-warning"),
    );
    expect(messages.some((m) => m.tool_calls || m.content === "partial")).toBe(
      false,
    );
    const second = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(
      second.messages.some((m) =>
        m.content?.includes("None of its tool calls were executed"),
      ),
    ).toBe(true);
  });
  it("uses at most one recovery even with a large remaining budget", async () => {
    mockResponses(
      response("partial", [tool]),
      response("partial-again", [tool]),
    );
    const { error, events } = await collect({
      iterationBudget: new IterationBudget({ limit: 20 }),
    });
    expect(error?.code).toBe("CC_MODEL_OUTPUT_LIMIT");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "token-usage")).toHaveLength(2);
    expect(
      events.some(
        (e) => e.type === "tool-executing" || e.type === "response-complete",
      ),
    ).toBe(false);
  });
  it.each(["missing-usage", "exhausted-budget", "abort-at-settlement"])(
    "does not recover %s",
    async (kind) => {
      mockResponses(
        response(
          "partial",
          [tool],
          "length",
          kind === "missing-usage" ? null : usage,
        ),
      );
      const controller = new AbortController();
      const { error, events } = await collect(
        {
          signal: controller.signal,
          iterationBudget: new IterationBudget({
            limit: kind === "exhausted-budget" ? 1 : 20,
          }),
        },
        undefined,
        (e) => {
          if (kind === "abort-at-settlement" && e.type === "token-usage")
            controller.abort();
        },
      );
      expect(error).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(
        events.some(
          (e) => e.type === "tool-executing" || e.type === "response-complete",
        ),
      ).toBe(false);
      if (kind === "abort-at-settlement") expect(error.name).toBe("AbortError");
    },
  );
  it("does not replay a failed request or interpret error text as a completion", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "Output reached length limit" } }),
          { status: 403 },
        ),
    );
    const { error, events } = await collect();
    expect(error).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "model-usage-unknown")).toBe(true);
    expect(events.some((e) => e.type === "token-usage")).toBe(false);
  });
  it("integrates SSE termination through the provider and loop", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n++;
      return new Response(
        n === 1
          ? lines().join("\n\n") + "\n\n"
          : [
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "complete" }, finish_reason: "stop" }] })}`,
              `data: ${JSON.stringify({ choices: [], usage })}`,
              "data: [DONE]",
              "",
            ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const { error, events } = await collect({ onToken: () => {} });
    expect(error).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(
      events
        .filter((e) => e.type === "response-complete")
        .map((e) => e.content),
    ).toEqual(["complete"]);
  });
});
