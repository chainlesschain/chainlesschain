import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  _openAIResponsesReasoningParams,
  agentLoop,
  chatWithTools,
} from "../helpers/test-model-egress.js";
import {
  accumulateOpenAIResponsesStream,
  normalizeOpenAIResponsesResponse,
  toOpenAIResponsesInput,
} from "../../src/lib/openai-responses.js";

const responseOutput = [
  {
    type: "reasoning",
    id: "rs_1",
    encrypted_content: "encrypted-reasoning",
    status: "completed",
    summary: [{ type: "summary_text", text: "Checked the repository." }],
  },
  {
    type: "function_call",
    id: "fc_1",
    call_id: "call_read",
    name: "read_file",
    arguments: '{"path":"README.md"}',
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAI Responses adapter", () => {
  it("replays reasoning, function calls, and bound function outputs", () => {
    const normalized = normalizeOpenAIResponsesResponse({
      id: "resp_1",
      status: "completed",
      output: responseOutput,
      usage: {
        input_tokens: 120,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 30,
        output_tokens_details: { reasoning_tokens: 12 },
      },
    });
    expect(normalized.message.tool_calls).toEqual([
      {
        id: "call_read",
        type: "function",
        function: {
          name: "read_file",
          arguments: '{"path":"README.md"}',
        },
      },
    ]);
    expect(normalized.message._openaiReasoningSummary).toBe(
      "Checked the repository.",
    );
    expect(normalized.usage).toEqual({
      input_tokens: 100,
      output_tokens: 30,
      cache_read_input_tokens: 20,
      reasoning_tokens: 12,
    });

    const input = toOpenAIResponsesInput([
      { role: "user", content: "Inspect it." },
      normalized.message,
      {
        role: "tool",
        tool_call_id: "call_read",
        content: "contents",
      },
    ]);
    expect(input).toEqual([
      { role: "user", content: "Inspect it." },
      {
        type: "reasoning",
        id: "rs_1",
        encrypted_content: "encrypted-reasoning",
        status: "completed",
        summary: [{ type: "summary_text", text: "Checked the repository." }],
      },
      {
        type: "function_call",
        call_id: "call_read",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call_read",
        output: "contents",
      },
    ]);
  });

  it("normalizes streamed text, reasoning summaries, tools, and usage", () => {
    const tokens = [];
    const thinking = [];
    const completed = {
      id: "resp_stream",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello" }],
        },
        ...responseOutput,
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens: 7,
        output_tokens_details: { reasoning_tokens: 5 },
      },
    };
    const lines = [
      {
        type: "response.reasoning_summary_text.delta",
        response_id: "resp_stream",
        delta: "Checked ",
      },
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
      { type: "response.completed", response: completed },
    ].map((event) => `data: ${JSON.stringify(event)}`);

    const normalized = accumulateOpenAIResponsesStream(
      lines,
      (token) => tokens.push(token),
      (token) => thinking.push(token),
    );
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(thinking).toEqual(["Checked "]);
    expect(normalized.message.content).toBe("Hello");
    expect(normalized.message.tool_calls[0].id).toBe("call_read");
    expect(normalized.usage).toEqual({
      input_tokens: 6,
      output_tokens: 7,
      cache_read_input_tokens: 4,
      reasoning_tokens: 5,
    });
  });

  it("fails closed on malformed or impossible reasoning token usage", () => {
    const response = (reasoningTokens) =>
      normalizeOpenAIResponsesResponse({
        id: "resp_usage",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 4,
          output_tokens: 3,
          output_tokens_details: { reasoning_tokens: reasoningTokens },
        },
      });

    expect(response(-1).usage).toBeUndefined();
    expect(response(4).usage).toBeUndefined();
    expect(response(1.5).usage).toBeUndefined();
  });

  it("drops incomplete tool calls and marks partial output truncated", () => {
    const normalized = normalizeOpenAIResponsesResponse({
      id: "resp_incomplete",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "partial" }],
        },
        ...responseOutput,
      ],
    });
    expect(normalized.message).toMatchObject({
      content: "partial",
      _truncated: true,
    });
    expect(normalized.message.tool_calls).toBeUndefined();
    expect(normalized.message._openaiReasoningItems).toBeUndefined();
  });

  it("fails closed on a provider terminal failure", () => {
    expect(() =>
      normalizeOpenAIResponsesResponse({
        id: "resp_failed",
        status: "failed",
        error: { code: "server_error", message: "sensitive detail" },
      }),
    ).toThrow(expect.objectContaining({ code: "CC_OPENAI_RESPONSES_FAILED" }));
  });

  it("maps opt-in thinking to Responses reasoning without changing defaults", () => {
    expect(_openAIResponsesReasoningParams({})).toBeNull();
    expect(_openAIResponsesReasoningParams({ thinking: "hard" })).toEqual({
      effort: "high",
      summary: "auto",
    });
    expect(
      _openAIResponsesReasoningParams({
        thinking: true,
        thinkingEffort: "low",
      }),
    ).toEqual({ effort: "low", summary: "auto" });
  });

  it("selects /responses only for an exact documented official target", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      headers: {
        get: (name) =>
          name.toLowerCase() === "x-request-id" ? "req_provider" : null,
      },
      json: async () => ({
        id: "resp_http",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "done" }],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    }));
    vi.stubGlobal("fetch", fetch);

    const output = await chatWithTools(
      [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Read the file." },
      ],
      {
        provider: "openai",
        model: "gpt-6-astra",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        cwd: os.tmpdir(),
        contextMemorySkipPlanning: true,
        enabledToolNames: ["read_file"],
        exactToolNames: true,
        thinking: "hard",
        maxOutputTokens: 2048,
        providerRequestId: "logical-request",
      },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers["X-Client-Request-Id"]).toBe("logical-request");
    expect(body).toMatchObject({
      model: "gpt-6-astra",
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 2048,
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(body).not.toHaveProperty("messages");
    expect(body.tools[0]).toMatchObject({
      type: "function",
      name: "read_file",
      parameters: expect.any(Object),
    });
    expect(body.tools[0]).not.toHaveProperty("function");
    expect(output).toMatchObject({
      message: { role: "assistant", content: "done" },
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        cache_read_input_tokens: 0,
      },
      providerReceipt: {
        provider: "openai",
        clientRequestId: "logical-request",
        requestId: "req_provider",
        responseId: "resp_http",
      },
    });
  });

  it("streams Responses text and reasoning through the existing callbacks", async () => {
    const completed = {
      id: "resp_stream_http",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "streamed" }],
        },
      ],
      usage: { input_tokens: 8, output_tokens: 3 },
    };
    const chunks = [
      `data: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "reason" })}\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "stream" })}\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ed" })}\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: completed })}\n`,
      "data: [DONE]\n",
    ];
    const encoder = new TextEncoder();
    let index = 0;
    const fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: encoder.encode(chunks[index++]) }
              : { done: true, value: undefined },
        }),
      },
    }));
    vi.stubGlobal("fetch", fetch);
    const tokens = [];
    const thinking = [];

    const output = await chatWithTools([{ role: "user", content: "stream" }], {
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      cwd: os.tmpdir(),
      contextMemorySkipPlanning: true,
      enabledToolNames: [],
      exactToolNames: true,
      thinking: true,
      onToken: (token) => tokens.push(token),
      onThinking: (token) => thinking.push(token),
    });

    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true);
    expect(tokens).toEqual(["stream", "ed"]);
    expect(thinking).toEqual(["reason"]);
    expect(output).toMatchObject({
      message: { content: "streamed" },
      usage: {
        input_tokens: 8,
        output_tokens: 3,
        cache_read_input_tokens: 0,
      },
    });
  });

  it("preserves safe partial Responses text after a connection drop", async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const error = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              if (reads++ === 0) {
                return {
                  done: false,
                  value: encoder.encode(
                    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n`,
                  ),
                };
              }
              throw error;
            },
          }),
        },
      })),
    );

    const output = await chatWithTools([{ role: "user", content: "stream" }], {
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      cwd: os.tmpdir(),
      contextMemorySkipPlanning: true,
      enabledToolNames: [],
      exactToolNames: true,
      onToken: () => {},
    });

    expect(output.message).toMatchObject({
      content: "partial",
      _truncated: true,
    });
    expect(output.message.tool_calls).toBeUndefined();
  });

  it("propagates a user abort instead of converting it to partial success", async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const abortError = new Error("interrupted");
    abortError.name = "AbortError";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              if (reads++ === 0) {
                return {
                  done: false,
                  value: encoder.encode(
                    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n`,
                  ),
                };
              }
              throw abortError;
            },
          }),
        },
      })),
    );

    await expect(
      chatWithTools([{ role: "user", content: "stream" }], {
        provider: "openai",
        model: "gpt-6-astra",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        cwd: os.tmpdir(),
        contextMemorySkipPlanning: true,
        enabledToolNames: [],
        exactToolNames: true,
        onToken: () => {},
      }),
    ).rejects.toBe(abortError);
  });

  it("keeps a custom OpenAI-compatible endpoint on Chat Completions", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "gateway" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetch);
    await chatWithTools([{ role: "user", content: "hello" }], {
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl: "https://gateway.example/v1",
      apiKey: "test-key",
      cwd: os.tmpdir(),
      contextMemorySkipPlanning: true,
      enabledToolNames: [],
      exactToolNames: true,
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "https://gateway.example/v1/chat/completions",
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toHaveProperty("messages");
  });

  it("completes a stateless Responses reasoning and tool round-trip", async () => {
    const directory = mkdtempSync(join(os.tmpdir(), "cc-openai-responses-"));
    writeFileSync(join(directory, "fixture.txt"), "trusted fixture", "utf8");
    const requests = [];
    const payloads = [
      {
        id: "resp_tool",
        status: "completed",
        output: [
          {
            type: "reasoning",
            id: "rs_tool",
            encrypted_content: "opaque-continuity",
            summary: [{ type: "summary_text", text: "Need the file." }],
          },
          {
            type: "function_call",
            id: "fc_tool",
            call_id: "call_fixture",
            name: "read_file",
            arguments: '{"path":"fixture.txt"}',
          },
        ],
      },
      {
        id: "resp_final",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "finished" }],
          },
        ],
      },
    ];
    const fetch = vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => payloads.shift(),
      };
    });
    vi.stubGlobal("fetch", fetch);

    try {
      const events = [];
      for await (const event of agentLoop(
        [{ role: "user", content: "Read fixture.txt, then finish." }],
        {
          provider: "openai",
          model: "gpt-6-astra",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "test-key",
          cwd: directory,
          contextMemorySkipPlanning: true,
          enabledToolNames: ["read_file"],
          exactToolNames: true,
          thinking: "hard",
          maxTurns: 3,
        },
      )) {
        events.push(event);
      }

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "response-complete",
          content: "finished",
        }),
      );
      expect(requests[1].input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "reasoning",
            id: "rs_tool",
            encrypted_content: "opaque-continuity",
          }),
          expect.objectContaining({
            type: "function_call",
            call_id: "call_fixture",
            name: "read_file",
          }),
          expect.objectContaining({
            type: "function_call_output",
            call_id: "call_fixture",
          }),
        ]),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
