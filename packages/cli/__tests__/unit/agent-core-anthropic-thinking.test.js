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
import { describe, it, expect } from "vitest";
import {
  _toAnthropicMessages,
  _anthropicThinkingParams,
  _normalizeAnthropicResponse,
  _accumulateAnthropicStream,
} from "../../src/runtime/agent-core.js";

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
          { id: "t1", function: { name: "read_file", arguments: '{"path":"a"}' } },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "read_file", input: { path: "a" } },
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
        tool_calls: [{ id: "t1", function: { name: "read", arguments: '{"p":"a"}' } }],
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
    ).toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(
      _anthropicThinkingParams("claude-opus-4-8", { thinking: true }).output_config
        .effort,
    ).toBe("high");
    expect(
      _anthropicThinkingParams("claude-opus-4-8", { thinking: "ultra" }).output_config
        .effort,
    ).toBe("xhigh");
  });

  it("adaptive for Sonnet 4.6", () => {
    expect(
      _anthropicThinkingParams("claude-sonnet-4-6", { thinking: true }).thinking.type,
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
});
