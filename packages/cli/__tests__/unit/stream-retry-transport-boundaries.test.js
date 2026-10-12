import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import { chatWithTools } from "../helpers/test-model-egress.js";
import { chatStream, streamOpenAI } from "../../src/lib/chat-core.js";

const messages = [{ role: "user", content: "Inspect the project." }];
const encoder = new TextEncoder();
const sse = (event) => `data: ${JSON.stringify(event)}\n`;
const drop = () =>
  Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
const protocols = [
  ["ollama", "llama3"],
  ["anthropic", "claude-sonnet-4-20250514"],
  ["openai", "gpt-4o"],
  ["openai", "gpt-6.1-sol"],
];

function opts(provider, model, extra = {}) {
  return {
    provider,
    model,
    apiKey: "test-key",
    baseUrl:
      provider === "anthropic"
        ? "https://api.anthropic.com/v1"
        : provider === "ollama"
          ? "http://localhost:11434"
          : "https://api.openai.com/v1",
    cwd: os.tmpdir(),
    contextMemorySkipPlanning: true,
    enabledToolNames: [],
    exactToolNames: true,
    onToken: vi.fn(),
    ...extra,
  };
}

function response(chunks, failure = drop(), headers = {}) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length)
            return { done: false, value: encoder.encode(chunks[index++]) };
          if (failure) throw failure;
          return { done: true };
        },
        cancel: vi.fn(),
      }),
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("production streaming retry boundaries", () => {
  it("preserves a completed Responses tool and usage after a transport drop", async () => {
    const terminal = {
      status: "completed",
      id: "resp_tool",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: '{"path":"README.md"}',
        },
      ],
      usage: { input_tokens: 8, output_tokens: 3 },
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response([sse({ type: "response.completed", response: terminal })]),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await chatWithTools(messages, opts("openai", "gpt-6.1-sol"));
    expect(result.message.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"README.md"}' },
      },
    ]);
    expect(result.message._truncated).toBeUndefined();
    expect(result.usage).toMatchObject({ input_tokens: 8, output_tokens: 3 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not turn a library AbortError after Responses completion into a tool result", async () => {
    const abort = Object.assign(new Error("cancelled by reader"), {
      name: "AbortError",
    });
    const fetch = vi.fn().mockResolvedValue(
      response(
        [
          sse({
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "function_call",
                  call_id: "call_1",
                  name: "read_file",
                  arguments: "{}",
                },
              ],
            },
          }),
        ],
        abort,
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      chatWithTools(messages, opts("openai", "gpt-6.1-sol")),
    ).rejects.toBe(abort);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("drops half a tool call while preserving visible reasoning", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response([
        sse({
          type: "response.reasoning_summary_text.delta",
          delta: "reason",
        }),
        sse({
          type: "response.output_item.added",
          item: {
            type: "function_call",
            name: "read_file",
            arguments: '{"path":',
          },
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await chatWithTools(
      messages,
      opts("openai", "gpt-6.1-sol", { onThinking: vi.fn(), thinking: true }),
    );
    expect(result.message).toMatchObject({
      _truncated: true,
      _openaiReasoningSummary: "reason",
    });
    expect(result.message.tool_calls).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves the branded backpressure error from a chat token sink", async () => {
    const failure = Object.assign(new Error("output timeout"), {
      isOutputBackpressureFailure: true,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response([sse({ choices: [{ delta: { content: "text" } }] })], null),
        ),
    );
    await expect(
      streamOpenAI(
        messages,
        "gpt-4o",
        "https://api.openai.com/v1",
        "test-key",
        () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });

  it.each(["ollama", "anthropic", "openai"])(
    "keeps %s chat HTTP timeouts terminal and preserves Retry-After",
    async (provider) => {
      const fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 504,
        statusText: "Gateway Timeout",
        headers: new Headers({ "Retry-After": "2" }),
      });
      vi.stubGlobal("fetch", fetch);
      const onStreamRetry = vi.fn();
      let failure;
      try {
        for await (const event of chatStream(
          messages,
          opts(provider, "test", { onStreamRetry }),
        ))
          void event;
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        status: 504,
        retryAfterAt: expect.any(Number),
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(onStreamRetry).not.toHaveBeenCalled();
    },
  );

  it.each(
    protocols.flatMap(([provider, model]) =>
      [true, false].map((streaming) => [provider, model, streaming]),
    ),
  )(
    "preserves %s/%s HTTP status and delay (streaming=%s) without replay",
    async (provider, model, streaming) => {
      const fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "3" }),
        text: async () =>
          JSON.stringify({ error: { message: "network error" } }),
      });
      vi.stubGlobal("fetch", fetch);
      await expect(
        chatWithTools(
          messages,
          opts(provider, model, { onToken: streaming ? vi.fn() : undefined }),
        ),
      ).rejects.toMatchObject({
        status: 429,
        retryAfterAt: expect.any(Number),
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a Responses failed verdict when the reader subsequently disconnects", async () => {
    vi.stubEnv("CC_MAX_RETRIES", "1");
    const fetch = vi.fn().mockImplementation(() =>
      response([
        sse({
          type: "response.failed",
          response: { status: "failed", error: { code: "request_timeout" } },
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      chatWithTools(messages, opts("openai", "gpt-6.1-sol")),
    ).rejects.toMatchObject({ code: "CC_OPENAI_RESPONSES_FAILED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["completed", "incomplete"])(
    "keeps an empty Responses %s verdict after disconnect",
    async (status) => {
      vi.stubEnv("CC_MAX_RETRIES", "1");
      const fetch = vi.fn().mockImplementation(() =>
        response([
          sse({
            type: `response.${status}`,
            response: { status, id: "resp_1", output: [] },
          }),
        ]),
      );
      vi.stubGlobal("fetch", fetch);
      const result = await chatWithTools(
        messages,
        opts("openai", "gpt-6.1-sol"),
      );
      expect(result.message.content).toBe("");
      expect(Boolean(result.message._truncated)).toBe(status === "incomplete");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  const whitespace = [
    ["ollama", "llama3", `${JSON.stringify({ message: { content: " " } })}\n`],
    [
      "anthropic",
      "claude-sonnet-4-20250514",
      sse({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      }) +
        sse({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " " },
        }),
    ],
    ["openai", "gpt-4o", sse({ choices: [{ delta: { content: " " } }] })],
    [
      "openai",
      "gpt-6.1-sol",
      sse({ type: "response.output_text.delta", delta: " " }),
    ],
  ];
  it.each(whitespace)(
    "preserves visible whitespace for %s/%s",
    async (provider, model, chunk) => {
      vi.stubEnv("CC_MAX_RETRIES", "1");
      const fetch = vi.fn().mockImplementation(() => response([chunk]));
      vi.stubGlobal("fetch", fetch);
      const onToken = vi.fn();
      const result = await chatWithTools(
        messages,
        opts(provider, model, { onToken }),
      );
      expect(result.message).toMatchObject({ content: " ", _truncated: true });
      expect(onToken).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      "anthropic",
      "claude-sonnet-4-20250514",
      sse({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking" },
      }) +
        sse({
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "reason" },
        }),
    ],
    [
      "openai",
      "gpt-6.1-sol",
      sse({ type: "response.reasoning_summary_text.delta", delta: "reason" }),
    ],
  ])(
    "does not replay thinking-only output for %s/%s",
    async (provider, model, chunk) => {
      vi.stubEnv("CC_MAX_RETRIES", "1");
      const fetch = vi.fn().mockImplementation(() => response([chunk]));
      vi.stubGlobal("fetch", fetch);
      const onThinking = vi.fn();
      const result = await chatWithTools(
        messages,
        opts(provider, model, { onThinking, thinking: true }),
      );
      expect(result.message._truncated).toBe(true);
      expect(onThinking).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      "ollama",
      "llama3",
      `${JSON.stringify({ message: { tool_calls: [{ function: { name: "read_file", arguments: {} } }] } })}\n`,
    ],
    [
      "anthropic",
      "claude-sonnet-4-20250514",
      sse({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tool_1", name: "read_file" },
      }),
    ],
    [
      "openai",
      "gpt-4o",
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "tool_1",
                  function: { name: "read_file", arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      }),
    ],
    [
      "openai",
      "gpt-6.1-sol",
      sse({
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          call_id: "tool_1",
          name: "read_file",
          arguments: '{"path":',
        },
      }),
    ],
  ])(
    "never replays or executes a partial tool stream for %s/%s",
    async (provider, model, chunk) => {
      vi.stubEnv("CC_MAX_RETRIES", "1");
      const fetch = vi.fn().mockImplementation(() => response([chunk]));
      vi.stubGlobal("fetch", fetch);
      await expect(
        chatWithTools(messages, opts(provider, model)),
      ).rejects.toMatchObject({ noReplay: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["agent", "chat"])(
    "honors a successful response's Retry-After before a zero-output %s retry",
    async (entry) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response([], drop(), { "Retry-After": "2" }))
        .mockResolvedValueOnce(
          response(
            [
              sse({ choices: [{ delta: { content: "done" } }] }),
              "data: [DONE]\n",
            ],
            null,
          ),
        );
      vi.stubGlobal("fetch", fetch);
      const options = opts("openai", "gpt-4o");
      const operation =
        entry === "agent"
          ? chatWithTools(messages, options)
          : (async () => {
              for await (const event of chatStream(messages, options))
                void event;
            })();
      const settled = operation.catch((error) => {
        throw error;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await settled;
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["agent", "chat"])(
    "cancels a %s Retry-After wait immediately without another request",
    async (entry) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const fetch = vi
        .fn()
        .mockResolvedValue(response([], drop(), { "Retry-After": "60" }));
      vi.stubGlobal("fetch", fetch);
      const options = opts("openai", "gpt-4o", { signal: controller.signal });
      const operation =
        entry === "agent"
          ? chatWithTools(messages, options)
          : (async () => {
              for await (const event of chatStream(messages, options))
                void event;
            })();
      const rejected = expect(operation).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      controller.abort();
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["agent", "chat"])(
    "returns the original %s failure when Retry-After exceeds its wait budget",
    async (entry) => {
      const failure = drop();
      const fetch = vi
        .fn()
        .mockResolvedValue(
          response([], failure, { "Retry-After": "99999999999999999999999" }),
        );
      vi.stubGlobal("fetch", fetch);
      const options = opts("openai", "gpt-4o");
      const operation =
        entry === "agent"
          ? chatWithTools(messages, options)
          : (async () => {
              for await (const event of chatStream(messages, options))
                void event;
            })();
      await expect(operation).rejects.toBe(failure);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
