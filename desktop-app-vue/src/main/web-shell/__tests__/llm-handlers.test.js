/**
 * Phase 2 llm.chat — unit tests.
 *
 * The handler depends on `LLMManager.chatStream(messages, onChunk, options)`.
 * Tests inject a fake `llmManager` whose chatStream invokes the callback a
 * few times then resolves, so neither Ollama nor any cloud provider is
 * touched. We verify the async-generator bridge:
 *   1. yields one `{delta, content}` per onChunk call
 *   2. returns the final result so the dispatcher can wrap it as
 *      `<topic>.result`
 *   3. re-throws underlying errors so the dispatcher emits ok:false
 *   4. validates frame shape (messages required, role+content required)
 *   5. throws llm_unavailable when manager is null/missing chatStream
 *
 * The dispatcher integration (chunk frame format, end-of-stream marker)
 * is already covered in ws-cli-loader.test.js's streaming envelope cases.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createLlmChatHandler,
  streamFromCallback,
} from "../handlers/llm-handlers.js";

/**
 * Build a fake llmManager whose chatStream:
 *   - schedules onChunk calls via setImmediate so the bridge actually
 *     awaits between chunks (catches "all yields delivered in one tick"
 *     bugs in the queue/waker logic)
 *   - resolves with the requested final value
 *   - rejects with `failAt`th-chunk if `failAt` is set
 */
function makeFakeManager({
  deltas = ["He", "llo", " world"],
  finalResult = {
    message: { role: "assistant", content: "Hello world" },
    tokens: 3,
  },
  failAt = null,
} = {}) {
  return {
    chatStream: vi.fn(async (messages, onChunk, _options) => {
      let acc = "";
      for (let i = 0; i < deltas.length; i++) {
        await new Promise((r) => setImmediate(r));
        if (failAt === i) {
          throw new Error(`stream_failed_at_${i}`);
        }
        acc += deltas[i];
        onChunk(deltas[i], acc);
      }
      return finalResult;
    }),
  };
}

describe("streamFromCallback bridge", () => {
  it("yields one chunk per onChunk + returns final value", async () => {
    const fn = async (msgs, onChunk) => {
      onChunk("a", "a");
      await new Promise((r) => setImmediate(r));
      onChunk("b", "ab");
      return { ok: 1 };
    };
    const gen = streamFromCallback(fn, [], {});
    const collected = [];
    let final;
    for (;;) {
      const step = await gen.next();
      if (step.done) {
        final = step.value;
        break;
      }
      collected.push(step.value);
    }
    expect(collected).toEqual([
      { delta: "a", content: "a" },
      { delta: "b", content: "ab" },
    ]);
    expect(final).toEqual({ ok: 1 });
  });

  it("re-throws when the underlying promise rejects", async () => {
    const fn = async (_msgs, onChunk) => {
      onChunk("a", "a");
      await new Promise((r) => setImmediate(r));
      throw new Error("boom");
    };
    const gen = streamFromCallback(fn, [], {});
    const collected = [];
    let caught = null;
    try {
      for (;;) {
        const step = await gen.next();
        if (step.done) {
          break;
        }
        collected.push(step.value);
      }
    } catch (e) {
      caught = e;
    }
    expect(collected).toEqual([{ delta: "a", content: "a" }]);
    expect(caught?.message).toBe("boom");
  });

  it("handles a stream with zero callback invocations", async () => {
    const fn = async () => ({ tokens: 0 });
    const gen = streamFromCallback(fn, [], {});
    const collected = [];
    let final;
    for (;;) {
      const step = await gen.next();
      if (step.done) {
        final = step.value;
        break;
      }
      collected.push(step.value);
    }
    expect(collected).toEqual([]);
    expect(final).toEqual({ tokens: 0 });
  });

  it("does not lose chunks emitted synchronously before the consumer awaits", async () => {
    // Some providers fire many onChunk calls in the same tick. The bridge
    // queues them; this test makes sure none are dropped.
    const fn = async (_msgs, onChunk) => {
      for (let i = 0; i < 5; i++) {
        onChunk(`d${i}`, `d${i}`);
      }
      return { tokens: 5 };
    };
    const gen = streamFromCallback(fn, [], {});
    const collected = [];
    for await (const c of gen) {
      collected.push(c.delta);
    }
    expect(collected).toEqual(["d0", "d1", "d2", "d3", "d4"]);
  });
});

describe("createLlmChatHandler — happy path", () => {
  it("yields a chunk per provider delta + returns the final result", async () => {
    const llmManager = makeFakeManager();
    const handler = createLlmChatHandler({ llmManager });
    const gen = handler({
      messages: [{ role: "user", content: "hi" }],
    });

    const chunks = [];
    let final;
    for (;;) {
      const step = await gen.next();
      if (step.done) {
        final = step.value;
        break;
      }
      chunks.push(step.value);
    }
    expect(chunks.map((c) => c.delta)).toEqual(["He", "llo", " world"]);
    expect(chunks[0]).toEqual({ delta: "He", content: "He" });
    expect(chunks[2]).toEqual({ delta: " world", content: "Hello world" });
    expect(final).toEqual({
      message: { role: "assistant", content: "Hello world" },
      tokens: 3,
    });
  });

  it("forwards options to llmManager.chatStream", async () => {
    const llmManager = makeFakeManager();
    const handler = createLlmChatHandler({ llmManager });
    const gen = handler({
      messages: [{ role: "user", content: "hi" }],
      options: { model: "qwen2.5", temperature: 0.2 },
    });
    // Drain
    for await (const _c of gen) {
      // discard
    }
    expect(llmManager.chatStream).toHaveBeenCalledTimes(1);
    const args = llmManager.chatStream.mock.calls[0];
    expect(args[0]).toEqual([{ role: "user", content: "hi" }]);
    expect(typeof args[1]).toBe("function");
    // The handler injects an AbortSignal alongside the user-supplied options
    // so cancellation can reach the underlying client. User options must
    // pass through verbatim.
    expect(args[2]).toMatchObject({ model: "qwen2.5", temperature: 0.2 });
    expect(args[2].signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults options to {} when frame.options is missing or non-object", async () => {
    const llmManager = makeFakeManager();
    const handler = createLlmChatHandler({ llmManager });
    const gen = handler({ messages: [{ role: "user", content: "hi" }] });
    for await (const _c of gen) {
      // discard
    }
    // Even with no user-supplied options, the handler still threads an
    // AbortSignal so generator unwind triggers cancellation downstream.
    const opts = llmManager.chatStream.mock.calls[0][2];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(opts).filter((k) => k !== "signal")).toEqual([]);
  });

  it("aborts the threaded signal when generator unwinds (cancellation)", async () => {
    const llmManager = makeFakeManager();
    const handler = createLlmChatHandler({ llmManager });
    const gen = handler({ messages: [{ role: "user", content: "hi" }] });
    // Pull one chunk so the handler is mid-stream, then return() to unwind.
    await gen.next();
    await gen.return();
    // The signal forwarded to chatStream must now be aborted — that's what
    // makes ollama/anthropic/openai client fetch() actually stop.
    const signal = llmManager.chatStream.mock.calls[0][2].signal;
    expect(signal.aborted).toBe(true);
  });
});

describe("createLlmChatHandler — frame validation", () => {
  it("throws messages_required when messages is missing", async () => {
    const handler = createLlmChatHandler({ llmManager: makeFakeManager() });
    const gen = handler({});
    await expect(gen.next()).rejects.toThrow("messages_required");
  });

  it("throws messages_required on non-array", async () => {
    const handler = createLlmChatHandler({ llmManager: makeFakeManager() });
    const gen = handler({ messages: "hi" });
    await expect(gen.next()).rejects.toThrow("messages_required");
  });

  it("throws messages_required on empty array", async () => {
    const handler = createLlmChatHandler({ llmManager: makeFakeManager() });
    const gen = handler({ messages: [] });
    await expect(gen.next()).rejects.toThrow("messages_required");
  });

  it("throws invalid_message_shape when an entry lacks role/content", async () => {
    const handler = createLlmChatHandler({ llmManager: makeFakeManager() });
    const gen = handler({ messages: [{ content: "no role" }] });
    await expect(gen.next()).rejects.toThrow("invalid_message_shape");
  });

  it("throws invalid_message_shape when content is not a string", async () => {
    const handler = createLlmChatHandler({ llmManager: makeFakeManager() });
    const gen = handler({ messages: [{ role: "user", content: 42 }] });
    await expect(gen.next()).rejects.toThrow("invalid_message_shape");
  });
});

describe("createLlmChatHandler — manager unavailable", () => {
  it("throws llm_unavailable when llmManager is null", async () => {
    const handler = createLlmChatHandler({ llmManager: null });
    const gen = handler({ messages: [{ role: "user", content: "x" }] });
    await expect(gen.next()).rejects.toThrow("llm_unavailable");
  });

  it("throws llm_unavailable when llmManager is missing chatStream", async () => {
    const handler = createLlmChatHandler({ llmManager: { foo: 1 } });
    const gen = handler({ messages: [{ role: "user", content: "x" }] });
    await expect(gen.next()).rejects.toThrow("llm_unavailable");
  });

  it("throws llm_unavailable when option is missing entirely", async () => {
    const handler = createLlmChatHandler();
    const gen = handler({ messages: [{ role: "user", content: "x" }] });
    await expect(gen.next()).rejects.toThrow("llm_unavailable");
  });
});

describe("createLlmChatHandler — error propagation", () => {
  it("re-throws if llmManager.chatStream rejects mid-stream", async () => {
    const llmManager = makeFakeManager({ failAt: 1 });
    const handler = createLlmChatHandler({ llmManager });
    const gen = handler({ messages: [{ role: "user", content: "x" }] });
    const got = [];
    let caught = null;
    try {
      for await (const c of gen) {
        got.push(c.delta);
      }
    } catch (e) {
      caught = e;
    }
    // Provider sent one chunk before the failure.
    expect(got).toEqual(["He"]);
    expect(caught?.message).toBe("stream_failed_at_1");
  });
});
