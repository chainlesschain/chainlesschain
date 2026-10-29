import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { agentLoop, chatWithTools } from "../helpers/test-model-egress.js";
import { IterationBudget } from "../../src/lib/iteration-budget.js";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const base = path.resolve(process.env.CC_TERMINATION_FIXTURE_BASE || tmpdir());
const fixture = fs.mkdtempSync(path.join(base, "cc-termination-integrity-"));
const observations = [];
afterAll(() => {
  if (process.env.CC_TERMINATION_REVIEW_REPORT)
    fs.writeFileSync(
      process.env.CC_TERMINATION_REVIEW_REPORT,
      JSON.stringify(observations, null, 2) + "\n",
    );
  if (
    path.dirname(path.resolve(fixture)) !== base ||
    !path.basename(fixture).startsWith("cc-termination-integrity-")
  )
    throw new Error("Unsafe fixture cleanup");
  fs.rmSync(fixture, { recursive: true, force: true });
});
const options = {
  provider: "deepseek",
  model: "termination-fixture",
  apiKey: "fixture",
  baseUrl: "http://127.0.0.1:1/v1",
  cwd: fixture,
};
const usage = { prompt_tokens: 12, completion_tokens: 8 };
const tool = {
  index: 0,
  id: "ambiguous-tool",
  type: "function",
  function: { name: "list_dir", arguments: '{"path":"."}' },
};
const jsonBody = (reason = "stop") => ({
  choices: [
    {
      index: 0,
      ...(reason == null ? {} : { finish_reason: reason }),
      message: { role: "assistant", content: "COMPLETE_FIXTURE" },
    },
  ],
  usage,
});
function mockResponse(body, sse = false) {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        globalThis.fetch.mock.calls.length === 1
          ? sse
            ? body
            : JSON.stringify(body)
          : JSON.stringify(jsonBody()),
        {
          headers: {
            "content-type":
              sse && globalThis.fetch.mock.calls.length === 1
                ? "text/event-stream"
                : "application/json",
          },
        },
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
    for await (const event of agentLoop(messages, {
      ...options,
      iterationBudget: new IterationBudget({ limit: 3 }),
      enabledToolNames: ["list_dir"],
      exactToolNames: true,
      ...extra,
    }))
      events.push(event);
  } catch (cause) {
    error = cause;
  }
  const summary = {
    providerCalls: globalThis.fetch.mock.calls.length,
    errorCode: error?.code ?? null,
    eventTypes: events.map((e) => e.type),
    final: events
      .filter((e) => e.type === "response-complete")
      .map((e) => e.content),
    assistantOrToolsPersisted: messages.some(
      (m) => m.role === "assistant" || m.tool_calls,
    ),
  };
  observations.push(summary);
  return { events, messages, error, summary };
}
function assertRejected(result) {
  expect(result.events.filter((e) => e.type === "token-usage")).toHaveLength(1);
  expect(result.error?.code).toBe("CC_MODEL_TERMINATION_INCOMPLETE");
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(
    result.events.some((e) =>
      [
        "tool-executing",
        "tool-result",
        "response-complete",
        "iteration-warning",
      ].includes(e.type),
    ),
  ).toBe(false);
  expect(result.summary.assistantOrToolsPersisted).toBe(false);
}
const data = (value) => `data: ${JSON.stringify(value)}`;
function sse(reason = "stop", kind = "valid", withTool = false) {
  const frames = [
    data({
      choices: [
        {
          index: 0,
          delta: {
            content: "PARTIAL_FIXTURE",
            ...(withTool ? { tool_calls: [tool] } : {}),
          },
          finish_reason: reason,
        },
      ],
    }),
  ];
  if (kind === "malformed") frames.push("data: {broken-json");
  if (kind === "conflicting")
    frames.push(
      data({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    );
  frames.push(data({ choices: [], usage }));
  if (kind !== "missing-done") frames.push("data: [DONE]");
  if (kind === "after-done")
    frames.push(
      data({
        choices: [
          { index: 0, delta: { content: "late" }, finish_reason: null },
        ],
      }),
    );
  return frames.join("\n\n") + "\n\n";
}
describe("explicitly incomplete OpenAI-compatible termination", () => {
  it("rejects JSON multiple choices after accounting instead of completing the first choice", async () => {
    const body = jsonBody();
    body.choices.push({ ...body.choices[0], index: 1 });
    mockResponse(body);
    expect(
      await chatWithTools([{ role: "user", content: "hi" }], options),
    ).toMatchObject({
      finishReason: "stop",
      providerTerminationComplete: false,
      usage: { output_tokens: 8 },
    });
    mockResponse(body);
    assertRejected(await collect());
  });
  it("rejects malformed, conflicting, missing-DONE and after-DONE stop streams", async () => {
    for (const kind of [
      "malformed",
      "conflicting",
      "missing-done",
      "after-done",
    ]) {
      const body = sse("stop", kind);
      mockResponse(body, true);
      expect(
        await chatWithTools([{ role: "user", content: "hi" }], {
          ...options,
          onToken: () => {},
        }),
      ).toMatchObject({
        providerTerminationComplete: false,
        usage: { output_tokens: 8 },
      });
      mockResponse(body, true);
      assertRejected(await collect({ onToken: () => {} }));
    }
  });
  it("never executes a complete tool JSON batch after an invalid SSE terminator", async () => {
    const body = sse("tool_calls", "after-done", true);
    mockResponse(body, true);
    const result = await chatWithTools([{ role: "user", content: "hi" }], {
      ...options,
      onToken: () => {},
    });
    expect(result).toMatchObject({
      finishReason: "tool_calls",
      providerTerminationComplete: false,
    });
    expect(result.message.tool_calls[0].function.arguments).toBe(
      '{"path":"."}',
    );
    mockResponse(body, true);
    assertRejected(await collect({ onToken: () => {} }));
  });
  it("preserves legacy JSON and SSE responses without a finish reason", async () => {
    for (const stream of [false, true]) {
      mockResponse(stream ? sse(null) : jsonBody(null), stream);
      const result = await collect(stream ? { onToken: () => {} } : {});
      expect(result.error).toBeUndefined();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(
        result.events.filter((e) => e.type === "response-complete"),
      ).toHaveLength(1);
    }
  });
});
