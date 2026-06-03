/**
 * Unit tests for the Phase 7 parity-harness mock LLM provider.
 * Covers the provider in isolation (no agent-core involvement).
 */

import { describe, it, expect } from "vitest";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

describe("createMockLLMProvider", () => {
  it("rejects a non-array script at construction time", () => {
    expect(() => createMockLLMProvider(null)).toThrow(TypeError);
    expect(() => createMockLLMProvider({})).toThrow(TypeError);
  });

  it("returns scripted responses in order and records calls", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("one") } },
      { response: { message: mockTextMessage("two") } },
    ]);

    const r1 = await mock.chatFn([{ role: "user", content: "hi" }], {});
    const r2 = await mock.chatFn([{ role: "user", content: "again" }], {});

    expect(r1.message.content).toBe("one");
    expect(r2.message.content).toBe("two");
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0].messages[0].content).toBe("hi");
    expect(mock.calls[1].messages[0].content).toBe("again");
    expect(mock.remaining()).toBe(0);
    mock.assertDrained();
  });

  it("snapshots messages so later mutation does not affect recorded calls", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("ok") } },
    ]);

    const live = [{ role: "user", content: "original" }];
    await mock.chatFn(live, {});

    // Mutate the live array after the mock has returned
    live[0].content = "mutated";
    live.push({ role: "user", content: "added" });

    // The recorded snapshot must remain untouched
    expect(mock.calls[0].messages).toHaveLength(1);
    expect(mock.calls[0].messages[0].content).toBe("original");
  });

  it("throws a descriptive error when the script is exhausted", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("only one") } },
    ]);

    await mock.chatFn([], {});

    await expect(mock.chatFn([], {})).rejects.toThrow(
      /script exhausted after 1 call/,
    );
  });

  it("runs the optional expect predicate against the passed messages", async () => {
    const mock = createMockLLMProvider([
      {
        expect: (messages) => messages.some((m) => m.role === "user"),
        response: { message: mockTextMessage("allowed") },
      },
      {
        expect: (messages) => messages.some((m) => m.role === "tool"),
        response: { message: mockTextMessage("should fail") },
      },
    ]);

    // First call satisfies the predicate
    const r1 = await mock.chatFn([{ role: "user", content: "hi" }], {});
    expect(r1.message.content).toBe("allowed");

    // Second call's predicate wants a tool message, but there isn't one
    await expect(
      mock.chatFn([{ role: "user", content: "hi" }], {}),
    ).rejects.toThrow(/step 1 expectation failed/);
  });

  it("assertDrained throws when the script was not fully consumed", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("one") } },
      { response: { message: mockTextMessage("two") } },
    ]);

    await mock.chatFn([], {});

    expect(() => mock.assertDrained()).toThrow(/1\/2 steps called/);
  });

  it("rejects script steps missing response.message", async () => {
    const mock = createMockLLMProvider([{ response: {} }]);

    await expect(mock.chatFn([], {})).rejects.toThrow(
      /missing response\.message/,
    );
  });

  it("deep-clones the response so tests can reuse script objects", async () => {
    const sharedMessage = mockTextMessage("shared");
    const mock = createMockLLMProvider([
      { response: { message: sharedMessage } },
      { response: { message: sharedMessage } },
    ]);

    const r1 = await mock.chatFn([], {});
    r1.message.content = "mutated by consumer";

    const r2 = await mock.chatFn([], {});
    expect(r2.message.content).toBe("shared");
  });
});

describe("mockToolCallMessage / mockTextMessage helpers", () => {
  it("mockToolCallMessage produces a valid chatWithTools-shaped assistant msg", () => {
    const msg = mockToolCallMessage("read_file", { path: "a.txt" }, "call_x");

    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("");
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0]).toEqual({
      id: "call_x",
      type: "function",
      function: {
        name: "read_file",
        arguments: JSON.stringify({ path: "a.txt" }),
      },
    });
  });

  it("mockToolCallMessage defaults the call id when omitted", () => {
    const msg = mockToolCallMessage("list_dir", { path: "." });
    expect(msg.tool_calls[0].id).toBe("call_1");
  });

  it("mockTextMessage produces a plain assistant reply", () => {
    const msg = mockTextMessage("hello");
    expect(msg).toEqual({ role: "assistant", content: "hello" });
  });
});
