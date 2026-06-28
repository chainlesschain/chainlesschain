/**
 * Unit tests for `--include-partial-messages` (Claude-Code parity).
 *
 * Three layers:
 *   1. _accumulateOllamaStream — the NDJSON reducer that turns an Ollama
 *      streaming response into the {message, usage} shape + fires onToken live.
 *   2. runAgentHeadless (single-turn) — emits `stream_event` deltas when the
 *      flag is set and output is stream-json; stays silent otherwise.
 *   3. runAgentHeadlessStream (multi-turn) — same, over NDJSON stdin.
 *
 * The agent loop / chatFn are injected, so no real model or HTTP is involved.
 */

import { describe, it, expect, vi } from "vitest";
import { _accumulateOllamaStream } from "../../src/runtime/agent-core.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";
import { runAgentHeadlessStream } from "../../src/runtime/headless-stream.js";

const parseLines = (chunks) =>
  chunks
    .join("")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("_accumulateOllamaStream", () => {
  it("fires onToken per content chunk and joins the full message", () => {
    const tokens = [];
    const data = _accumulateOllamaStream(
      [
        '{"message":{"role":"assistant","content":"He"}}',
        '{"message":{"role":"assistant","content":"llo"}}',
        '{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":5,"eval_count":3}',
      ],
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(["He", "llo"]);
    expect(data.message).toEqual({ role: "assistant", content: "Hello" });
    expect(data.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
  });

  it("accumulates tool_calls and does not emit them as text tokens", () => {
    const tokens = [];
    const data = _accumulateOllamaStream(
      [
        '{"message":{"role":"assistant","content":"ok"}}',
        '{"message":{"role":"assistant","tool_calls":[{"function":{"name":"read_file","arguments":{"path":"a"}}}]},"done":true,"eval_count":2}',
      ],
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(["ok"]);
    expect(data.message.content).toBe("ok");
    expect(data.message.tool_calls).toHaveLength(1);
    expect(data.message.tool_calls[0].function.name).toBe("read_file");
    expect(data.usage).toEqual({ input_tokens: 0, output_tokens: 2 });
  });

  it("tolerates blank and non-JSON lines mid-stream", () => {
    const data = _accumulateOllamaStream(
      ["", "not json", '{"message":{"content":"x"}}'],
      null,
    );
    expect(data.message.content).toBe("x");
  });

  it("omits usage when no eval counts were seen", () => {
    const data = _accumulateOllamaStream(
      ['{"message":{"content":"hi"}}'],
      null,
    );
    expect(data.usage).toBeUndefined();
  });
});

describe("runAgentHeadless — --include-partial-messages", () => {
  const makeDeps = (chatFn) => {
    const out = [];
    return {
      out,
      deps: {
        bootstrap: async () => ({ db: null }),
        getApprovalGate: async () => null,
        writeOut: (s) => out.push(s),
        writeErr: () => {},
        // DB-free session seam so the test never touches disk.
        sessionExists: () => false,
        startSession: () => {},
        appendUserMessage: () => {},
        appendAssistantMessage: () => {},
        appendTokenUsage: () => {},
        getLastSessionId: () => null,
        chatFn,
      },
    };
  };

  // A fake llmCall that streams `chunks` via options.onToken, then returns the
  // final assistant message — exactly what the agent loop threads through.
  const streamingChatFn = (chunks, content) =>
    vi.fn(async (_messages, options) => {
      for (const c of chunks) options.onToken?.(c);
      return {
        message: { role: "assistant", content },
        usage: { input_tokens: 1, output_tokens: 2 },
      };
    });

  it("emits a stream_event per delta before the result envelope", async () => {
    const { out, deps } = makeDeps(streamingChatFn(["He", "llo"], "Hello"));
    await runAgentHeadless(
      {
        prompt: "hi",
        sessionId: "s-partial",
        outputFormat: "stream-json",
        includePartialMessages: true,
        expandFileRefs: false,
      },
      deps,
    );
    const events = parseLines(out);
    const deltas = events.filter((e) => e.type === "stream_event");
    expect(deltas.map((e) => e.event.delta.text)).toEqual(["He", "llo"]);
    expect(deltas[0].event.type).toBe("content_block_delta");
    expect(deltas[0].event.delta.type).toBe("text_delta");
    // Deltas precede the terminal result envelope.
    const resultIdx = events.findIndex((e) => e.type === "result");
    const lastDeltaIdx = events.map((e) => e.type).lastIndexOf("stream_event");
    expect(lastDeltaIdx).toBeLessThan(resultIdx);
  });

  it("stays silent when the flag is off", async () => {
    const { out, deps } = makeDeps(streamingChatFn(["a", "b"], "ab"));
    await runAgentHeadless(
      {
        prompt: "hi",
        sessionId: "s-nopartial",
        outputFormat: "stream-json",
        expandFileRefs: false,
      },
      deps,
    );
    const events = parseLines(out);
    expect(events.some((e) => e.type === "stream_event")).toBe(false);
  });

  it("does not emit deltas for non-stream output formats", async () => {
    const { out, deps } = makeDeps(streamingChatFn(["a"], "a"));
    await runAgentHeadless(
      {
        prompt: "hi",
        sessionId: "s-json",
        outputFormat: "json",
        includePartialMessages: true,
        expandFileRefs: false,
      },
      deps,
    );
    // json mode writes a single envelope; no NDJSON stream_event lines.
    expect(out.join("")).not.toContain("stream_event");
  });
});

describe("runAgentHeadlessStream — --include-partial-messages", () => {
  const baseDeps = (over = {}) => {
    const lines = [];
    return {
      bootstrap: async () => ({ db: null }),
      getApprovalGate: async () => null,
      writeOut: (s) => lines.push(s),
      writeErr: () => {},
      _lines: lines,
      ...over,
    };
  };
  async function* input(...objs) {
    yield objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
  }

  it("emits stream_event deltas across turns when enabled", async () => {
    const agentLoop = async function* (_messages, opts) {
      opts.onToken?.("Hel");
      opts.onToken?.("lo");
      yield { type: "response-complete", content: "Hello" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({ agentLoop, input: input({ text: "hi" }) });
    await runAgentHeadlessStream(
      // streamCoalesceMs:0 keeps the legacy per-token emit so we can assert one
      // stream_event per onToken; the default-on coalescing (which would batch
      // "Hel"+"lo" into "Hello") is covered by headless-stream-coalesce.test.js.
      {
        expandFileRefs: false,
        includePartialMessages: true,
        streamCoalesceMs: 0,
      },
      deps,
    );
    const events = parseLines(deps._lines);
    const deltas = events.filter((e) => e.type === "stream_event");
    expect(deltas.map((e) => e.event.delta.text)).toEqual(["Hel", "lo"]);
  });

  it("passes no onToken to the loop when disabled", async () => {
    let receivedOnToken = "unset";
    const agentLoop = async function* (_messages, opts) {
      receivedOnToken = typeof opts.onToken;
      yield { type: "response-complete", content: "ok" };
      yield { type: "run-ended", reason: "complete" };
    };
    const deps = baseDeps({ agentLoop, input: input({ text: "hi" }) });
    await runAgentHeadlessStream({ expandFileRefs: false }, deps);
    expect(receivedOnToken).toBe("undefined");
    const events = parseLines(deps._lines);
    expect(events.some((e) => e.type === "stream_event")).toBe(false);
  });
});
