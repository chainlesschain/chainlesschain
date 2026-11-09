/**
 * Full extended-thinking feature (RUNTIME-UNVERIFIED — no Anthropic key here to
 * E2E the live signature replay; these are pure-shape unit tests):
 *   - _toAnthropicMessages: internal OpenAI-shaped messages -> Anthropic content
 *     blocks (the prerequisite that fixes the latent multi-turn tool-use 400),
 *     incl. thinking-block replay ordering.
 *   - _normalizeAnthropicResponse + _accumulateAnthropicStream: preserve thinking
 *     blocks (with signature) verbatim.
 *   - _anthropicThinkingParams: model-aware, opt-in, off by default.
 */
import os from "node:os";
import { afterEach, describe, it, expect, vi } from "vitest";
import { chatWithTools } from "../helpers/test-model-egress.js";
import {
  _toAnthropicMessages,
  _anthropicThinkingParams,
  _normalizeAnthropicResponse,
  _accumulateAnthropicStream,
} from "../../src/runtime/agent-core.js";

afterEach(() => vi.unstubAllGlobals());

describe.each([false, true])(
  "Anthropic output cap admission (stream=%s)",
  (stream) => {
    const messages = [{ role: "user", content: "Reply with one word." }];
    const options = (overrides = {}) => ({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "unit-test-only",
      cwd: os.tmpdir(),
      thinking: true,
      ...(stream ? { onToken: vi.fn() } : {}),
      ...overrides,
    });

    it.each([37, 1024])(
      "rejects manual thinking with cap %s before provider accounting or fetch",
      async (maxOutputTokens) => {
        const fetch = vi.fn(() => {
          throw new Error("unexpected dispatch");
        });
        vi.stubGlobal("fetch", fetch);
        const onProviderCallStart = vi.fn();
        await expect(
          chatWithTools(
            messages,
            options({ maxOutputTokens, onProviderCallStart }),
          ),
        ).rejects.toMatchObject({
          name: "RangeError",
          code: "CC_ANTHROPIC_THINKING_OUTPUT_CAP_INVALID",
          message: expect.stringContaining("greater than 1024"),
        });
        expect(onProviderCallStart).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        "manual minimum",
        { maxOutputTokens: 1025 },
        { type: "enabled", budget_tokens: 1024 },
      ],
      [
        "thinking disabled",
        { maxOutputTokens: 37, thinking: false },
        undefined,
      ],
      [
        "adaptive",
        { maxOutputTokens: 37, model: "claude-sonnet-4-6" },
        { type: "adaptive" },
      ],
    ])(
      "preserves the physical cap and thinking intent for %s",
      async (_label, overrides, thinking) => {
        const fetch = vi.fn(async () =>
          stream
            ? new Response(
                [
                  {
                    type: "message_start",
                    message: { usage: { input_tokens: 2 } },
                  },
                  {
                    type: "content_block_start",
                    index: 0,
                    content_block: { type: "text", text: "" },
                  },
                  {
                    type: "content_block_delta",
                    index: 0,
                    delta: { type: "text_delta", text: "ok" },
                  },
                  { type: "content_block_stop", index: 0 },
                  {
                    type: "message_delta",
                    delta: { stop_reason: "end_turn" },
                    usage: { output_tokens: 1 },
                  },
                  { type: "message_stop" },
                ]
                  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                  .join(""),
                { headers: { "Content-Type": "text/event-stream" } },
              )
            : new Response(
                JSON.stringify({
                  content: [{ type: "text", text: "ok" }],
                  usage: { input_tokens: 2, output_tokens: 1 },
                  stop_reason: "end_turn",
                }),
                { headers: { "Content-Type": "application/json" } },
              ),
        );
        vi.stubGlobal("fetch", fetch);
        const onProviderCallStart = vi.fn();
        await chatWithTools(
          messages,
          options({ ...overrides, onProviderCallStart }),
        );
        expect(fetch).toHaveBeenCalledOnce();
        expect(onProviderCallStart).toHaveBeenCalledOnce();
        const init = fetch.mock.calls[0][1];
        const body = JSON.parse(init.body);
        expect(body.max_tokens).toBe(overrides.maxOutputTokens);
        expect(body.thinking).toEqual(thinking);
        // The transport does not opt into the interleaved-thinking budget exception.
        expect(new Headers(init.headers).has("anthropic-beta")).toBe(false);
      },
    );
  },
);

describe("_toAnthropicMessages — OpenAI-shaped -> Anthropic content blocks", () => {
  it("passes a plain user message through as a string", () => {
    expect(_toAnthropicMessages([{ role: "user", content: "hi" }])).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("converts assistant tool_calls into tool_use blocks", () => {
    const out = _toAnthropicMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "t1",
            function: { name: "read_file", arguments: '{"path":"a"}' },
          },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "a" },
          },
        ],
      },
    ]);
  });

  it("keeps assistant text before tool_use", () => {
    const [msg] = _toAnthropicMessages([
      {
        role: "assistant",
        content: "let me check",
        tool_calls: [{ id: "t1", function: { name: "ls", arguments: "{}" } }],
      },
    ]);
    expect(msg.content[0]).toEqual({ type: "text", text: "let me check" });
    expect(msg.content[1].type).toBe("tool_use");
  });

  it("converts role:'tool' results into a tool_result inside a USER turn", () => {
    const out = _toAnthropicMessages([
      { role: "tool", tool_call_id: "t1", content: "file contents" },
    ]);
    expect(out).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "file contents" },
        ],
      },
    ]);
  });

  it("merges consecutive tool results into one user turn", () => {
    const out = _toAnthropicMessages([
      { role: "tool", tool_call_id: "t1", content: "r1" },
      { role: "tool", tool_call_id: "t2", content: "r2" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content.map((b) => b.tool_use_id)).toEqual(["t1", "t2"]);
  });

  it("replays preserved thinking blocks FIRST in the assistant turn", () => {
    const [msg] = _toAnthropicMessages([
      {
        role: "assistant",
        content: "answer",
        _thinkingBlocks: [
          { type: "thinking", thinking: "reasoning", signature: "sig" },
        ],
        tool_calls: [{ id: "t1", function: { name: "ls", arguments: "{}" } }],
      },
    ]);
    expect(msg.content[0]).toEqual({
      type: "thinking",
      thinking: "reasoning",
      signature: "sig",
    });
    expect(msg.content[1].type).toBe("text");
    expect(msg.content[2].type).toBe("tool_use");
  });

  it("round-trips a full assistant->tool->user turn sequence into valid shape", () => {
    const out = _toAnthropicMessages([
      { role: "user", content: "read a" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "t1", function: { name: "read", arguments: '{"p":"a"}' } },
        ],
      },
      { role: "tool", tool_call_id: "t1", content: "AAA" },
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[1].content[0].type).toBe("tool_use");
    expect(out[2].content[0].type).toBe("tool_result");
  });
});

describe("_normalizeAnthropicResponse — preserves thinking blocks", () => {
  it("attaches _thinkingBlocks verbatim (incl. signature)", () => {
    const { message } = _normalizeAnthropicResponse({
      content: [
        { type: "thinking", thinking: "hmm", signature: "S" },
        { type: "text", text: "done" },
        { type: "tool_use", id: "t1", name: "ls", input: {} },
      ],
    });
    expect(message._thinkingBlocks).toEqual([
      { type: "thinking", thinking: "hmm", signature: "S" },
    ]);
    expect(message.content).toBe("done");
    expect(message.tool_calls[0].function.name).toBe("ls");
  });

  it("omits _thinkingBlocks when there is no thinking", () => {
    const { message } = _normalizeAnthropicResponse({
      content: [{ type: "text", text: "hi" }],
    });
    expect(message._thinkingBlocks).toBeUndefined();
  });
});

describe("_anthropicThinkingParams — model-aware, opt-in", () => {
  it("is OFF by default (no options.thinking) -> null", () => {
    expect(_anthropicThinkingParams("claude-opus-4-8", {})).toBeNull();
  });

  it("adaptive + effort for Opus 4.8", () => {
    expect(
      _anthropicThinkingParams("claude-opus-4-8", { thinking: "think" }),
    ).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
    expect(
      _anthropicThinkingParams("claude-opus-4-8", { thinking: true })
        .output_config.effort,
    ).toBe("high");
    expect(
      _anthropicThinkingParams("claude-opus-4-8", { thinking: "ultra" })
        .output_config.effort,
    ).toBe("xhigh");
  });

  it("adaptive for Sonnet 4.6", () => {
    expect(
      _anthropicThinkingParams("claude-sonnet-4-6", { thinking: true }).thinking
        .type,
    ).toBe("adaptive");
  });

  it("legacy enabled+budget for Sonnet 4.5, budget < max_tokens", () => {
    expect(
      _anthropicThinkingParams("claude-sonnet-4-5", { thinking: true }, 16384),
    ).toEqual({ thinking: { type: "enabled", budget_tokens: 8000 } });
    // clamps below a small max_tokens
    const clamped = _anthropicThinkingParams(
      "claude-sonnet-4-5",
      { thinking: true },
      4096,
    );
    expect(clamped.thinking.budget_tokens).toBeLessThan(4096);
  });

  it("returns null for models without thinking support (Haiku)", () => {
    expect(
      _anthropicThinkingParams("claude-haiku-4-5", { thinking: true }),
    ).toBeNull();
  });
});

describe("_accumulateAnthropicStream — captures thinking blocks from SSE", () => {
  it("reassembles thinking text + signature and keeps tool_use", () => {
    const lines = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step1 "}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step2"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"SIG"}}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"ls"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}',
    ];
    const { message } = _accumulateAnthropicStream(lines);
    expect(message._thinkingBlocks).toEqual([
      { type: "thinking", thinking: "step1 step2", signature: "SIG" },
    ]);
    expect(message.tool_calls[0].function.name).toBe("ls");
  });

  it("forwards each thinking delta to the onThinking hook (live reasoning)", () => {
    const lines = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step1 "}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step2"}}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}',
    ];
    const thinks = [];
    const texts = [];
    _accumulateAnthropicStream(
      lines,
      (t) => texts.push(t),
      (t) => thinks.push(t),
    );
    // reasoning deltas reach onThinking; answer text stays on onToken (separate)
    expect(thinks).toEqual(["step1 ", "step2"]);
    expect(texts).toEqual(["answer"]);
  });
});
