/**
 * Unit tests for real streaming in chatWithTools — the SSE reducers that turn
 * anthropic / OpenAI-compatible streamed responses into the standard
 * {message, usage} shape (with tool_calls reassembled) and fire onToken live.
 *
 * Pure reducers (no HTTP), so the delta-reassembly logic is exercised directly.
 */

import { describe, it, expect } from "vitest";
import {
  _accumulateAnthropicStream,
  _accumulateOpenAIStream,
} from "../../src/runtime/agent-core.js";

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}`);

describe("_accumulateAnthropicStream", () => {
  it("streams text deltas live and joins the final content", () => {
    const tokens = [];
    const out = _accumulateAnthropicStream(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hel" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "lo" },
        },
        { type: "message_delta", usage: { output_tokens: 7 } },
      ]),
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(out.message).toEqual({ role: "assistant", content: "Hello" });
    expect(out.usage).toEqual({
      input_tokens: 10,
      output_tokens: 7,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });

  it("reassembles a tool_use block from input_json_delta fragments", () => {
    const out = _accumulateAnthropicStream(
      sse([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_1", name: "get_weather" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"city":' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"NYC"}' },
        },
      ]),
      null,
    );
    expect(out.message.content).toBe("");
    expect(out.message.tool_calls).toHaveLength(1);
    expect(out.message.tool_calls[0]).toMatchObject({
      id: "tu_1",
      type: "function",
      function: { name: "get_weather" },
    });
    expect(JSON.parse(out.message.tool_calls[0].function.arguments)).toEqual({
      city: "NYC",
    });
  });

  it("tolerates malformed lines and omits usage when none seen", () => {
    const out = _accumulateAnthropicStream(
      [
        "data: {bad",
        "event: ping",
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}',
      ],
      null,
    );
    expect(out.message.content).toBe("x");
    expect(out.usage).toBeUndefined();
  });
});

describe("_accumulateOpenAIStream", () => {
  it("streams content deltas and assembles fragmented tool_calls + usage", () => {
    const tokens = [];
    const out = _accumulateOpenAIStream(
      [
        ...sse([
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: { name: "get_weather", arguments: "" },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '{"city":' } },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '"NYC"}' } }],
                },
              },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          },
        ]),
        "data: [DONE]",
      ],
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(out.message.content).toBe("Hello");
    expect(out.message.tool_calls).toHaveLength(1);
    expect(out.message.tool_calls[0]).toMatchObject({
      id: "call_1",
      function: { name: "get_weather" },
    });
    expect(JSON.parse(out.message.tool_calls[0].function.arguments)).toEqual({
      city: "NYC",
    });
    expect(out.usage).toEqual({
      input_tokens: 5,
      output_tokens: 3,
      cache_read_input_tokens: 0,
    });
  });

  it("handles a text-only response with no tool calls", () => {
    const out = _accumulateOpenAIStream(
      sse([{ choices: [{ delta: { content: "hi there" } }] }]),
      null,
    );
    expect(out.message).toEqual({ role: "assistant", content: "hi there" });
    expect(out.message.tool_calls).toBeUndefined();
  });

  it("synthesizes an id when a tool_call delta omits one", () => {
    const out = _accumulateOpenAIStream(
      sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { name: "ping", arguments: "{}" } },
                ],
              },
            },
          ],
        },
      ]),
      null,
    );
    expect(out.message.tool_calls[0].id).toBe("call_ping");
    expect(out.message.tool_calls[0].function.arguments).toBe("{}");
  });
});

describe("_accumulateOpenAIStream — cached prompt tokens (OpenAI/DeepSeek/volcengine)", () => {
  it("splits OpenAI prompt_tokens_details.cached_tokens out of input", () => {
    const out = _accumulateOpenAIStream(
      [
        ...sse([
          { choices: [{ delta: { content: "hi" } }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 10,
              prompt_tokens_details: { cached_tokens: 800 },
            },
          },
        ]),
        "data: [DONE]",
      ],
      null,
    );
    // prompt_tokens includes cached → input is the uncached remainder.
    expect(out.usage).toEqual({
      input_tokens: 200,
      output_tokens: 10,
      cache_read_input_tokens: 800,
    });
  });

  it("reads DeepSeek prompt_cache_hit_tokens as the cached count", () => {
    const out = _accumulateOpenAIStream(
      [
        ...sse([
          { choices: [{ delta: { content: "ok" } }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 5,
              prompt_cache_hit_tokens: 450,
              prompt_cache_miss_tokens: 50,
            },
          },
        ]),
        "data: [DONE]",
      ],
      null,
    );
    expect(out.usage).toEqual({
      input_tokens: 50,
      output_tokens: 5,
      cache_read_input_tokens: 450,
    });
  });

  it("leaves input unchanged when no cached tokens (volcengine cached_tokens:0)", () => {
    const out = _accumulateOpenAIStream(
      [
        ...sse([
          { choices: [{ delta: { content: "x" } }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 3306,
              completion_tokens: 93,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        ]),
        "data: [DONE]",
      ],
      null,
    );
    expect(out.usage).toEqual({
      input_tokens: 3306,
      output_tokens: 93,
      cache_read_input_tokens: 0,
    });
  });
});
