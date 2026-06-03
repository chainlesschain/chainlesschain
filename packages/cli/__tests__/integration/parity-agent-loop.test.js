/**
 * Parity Harness — agent loop deterministic playback
 *
 * First of the Phase 7 parity tests. Drives `agentLoop` with the mock LLM
 * provider (`src/harness/mock-llm-provider.js`) to assert that a fixed
 * mock input produces a fixed, byte-for-byte event stream — the baseline
 * for golden-transcript parity.
 *
 * Test matrix covered here:
 *   - Plain assistant reply (no tools) → single response-complete event
 *   - Tool call → tool execution → follow-up reply → two-iteration event stream
 *   - Script exhaustion raises a descriptive error
 *   - Mock records every call for downstream assertions
 *
 * The real tool (`read_file`) is exercised end-to-end against a temp file so
 * the test covers the LLM → tool executor → messages-append → LLM round-trip
 * path. Only the LLM itself is mocked.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  createMockLLMProvider,
  mockToolCallMessage,
  mockTextMessage,
} from "../../src/harness/mock-llm-provider.js";

/**
 * Drain an async generator into an array so tests can make whole-stream
 * assertions. agentLoop yields a bounded stream per call, so this is safe.
 */
async function drain(iterable) {
  const out = [];
  for await (const event of iterable) {
    if (event.type === "run-started" || event.type === "run-ended") continue;
    out.push(event);
  }
  return out;
}

describe("Phase 7 parity: agent loop with mock LLM provider", () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "parity-agent-loop-"));
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("plain assistant reply yields a single response-complete event", async () => {
    const mock = createMockLLMProvider([
      { response: { message: mockTextMessage("hello world") } },
    ]);

    const messages = [{ role: "user", content: "hi" }];

    const events = await drain(
      agentLoop(messages, {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    expect(events).toEqual([
      { type: "response-complete", content: "hello world" },
    ]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.remaining()).toBe(0);
    mock.assertDrained();
  });

  it("tool call + follow-up produces a deterministic tool-executing/tool-result/response-complete stream", async () => {
    // Set up a real file the mocked tool-call will read.
    const filePath = join(workDir, "note.txt");
    writeFileSync(filePath, "parity golden content", "utf8");

    const mock = createMockLLMProvider([
      {
        // First LLM call: the "model" decides to invoke read_file.
        response: {
          message: mockToolCallMessage(
            "read_file",
            { path: filePath },
            "call_parity_1",
          ),
        },
      },
      {
        // Second LLM call: expect the tool result is now in the message stream.
        expect: (messages) =>
          messages.some(
            (m) =>
              m.role === "tool" &&
              typeof m.content === "string" &&
              m.content.includes("parity golden content"),
          ),
        response: {
          message: mockTextMessage("Read the file successfully."),
        },
      },
    ]);

    const messages = [{ role: "user", content: `Read ${filePath}` }];

    const events = await drain(
      agentLoop(messages, {
        provider: "mock",
        model: "mock-1",
        cwd: workDir,
        chatFn: mock.chatFn,
      }),
    );

    // Event stream parity: exactly 3 events in this order.
    expect(events).toHaveLength(3);

    expect(events[0]).toMatchObject({
      type: "tool-executing",
      tool: "read_file",
      args: { path: filePath },
    });

    expect(events[1]).toMatchObject({
      type: "tool-result",
      tool: "read_file",
      error: null,
    });
    // The real read_file executor was invoked — result must carry the content.
    expect(JSON.stringify(events[1].result)).toContain("parity golden content");

    expect(events[2]).toEqual({
      type: "response-complete",
      content: "Read the file successfully.",
    });

    // Messages were mutated in place: user + assistant(tool_call) + tool result
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].tool_calls).toBeDefined();
    expect(messages[2].role).toBe("tool");
    expect(messages[2].tool_call_id).toBe("call_parity_1");

    mock.assertDrained();
  });

  it("script exhaustion throws a descriptive error", async () => {
    // Only 1 response, but the model "calls" a tool so the loop would want a 2nd.
    const mock = createMockLLMProvider([
      {
        response: {
          message: mockToolCallMessage(
            "read_file",
            { path: join(workDir, "missing.txt") },
            "call_exhaust",
          ),
        },
      },
    ]);

    const messages = [{ role: "user", content: "read something" }];

    await expect(
      drain(
        agentLoop(messages, {
          provider: "mock",
          model: "mock-1",
          cwd: workDir,
          chatFn: mock.chatFn,
        }),
      ),
    ).rejects.toThrow(/Mock LLM script exhausted/);
  });

  it("expect predicate failures throw before returning a response", async () => {
    const mock = createMockLLMProvider([
      {
        // Predicate that can never be true on the first call.
        expect: (messages) => messages.some((m) => m.role === "tool"),
        response: { message: mockTextMessage("unreachable") },
      },
    ]);

    await expect(
      drain(
        agentLoop([{ role: "user", content: "hi" }], {
          provider: "mock",
          model: "mock-1",
          cwd: workDir,
          chatFn: mock.chatFn,
        }),
      ),
    ).rejects.toThrow(/step 0 expectation failed/);
  });
});
