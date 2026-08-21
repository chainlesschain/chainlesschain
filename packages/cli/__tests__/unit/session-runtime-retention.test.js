import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../../src/runtime/agent-core.js";
import {
  releaseOldLiveSessionResults,
  SESSION_RUNTIME_RELEASE_MARKER,
  SESSION_RUNTIME_RETENTION_LIMITS,
} from "../../src/lib/session-runtime-retention.js";

const largeResult = (index) => `${index}:`.padEnd(32 * 1024, "x");

async function drain(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("session runtime result retention", () => {
  it("releases only results outside the recent window without changing pairing", () => {
    const messages = [];
    for (let index = 0; index < 40; index += 1) {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `call-${index}`, function: { name: "probe", arguments: "{}" } },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: `call-${index}`,
        content: largeResult(index),
      });
    }
    const original = structuredClone(messages);

    const retained = releaseOldLiveSessionResults(messages);

    expect(retained.stats).toMatchObject({
      released: 8,
      recentResults: SESSION_RUNTIME_RETENTION_LIMITS.recentResults,
      originalMessages: messages.length,
      compressedMessages: messages.length,
    });
    expect(messages).toEqual(original);
    expect(retained.messages.map((message) => message.role)).toEqual(
      messages.map((message) => message.role),
    );
    expect(retained.messages[1].tool_call_id).toBe("call-0");
    expect(retained.messages[1].content).toContain(
      SESSION_RUNTIME_RELEASE_MARKER,
    );
    expect(retained.messages.at(-1).content).toBe(largeResult(39));

    const digest = createHash("sha256")
      .update(largeResult(0), "utf8")
      .digest("hex");
    expect(retained.messages[1].content).toContain(`sha256:${digest}`);
    expect(retained.messages[1].content).toContain("durable transcript");
    expect(retained.stats.durableReferences[0]).toMatchObject({
      messageIndex: 1,
      digest: `sha256:${digest}`,
      originalChars: 32 * 1024,
    });
  });

  it("recognizes background subagent results and is idempotent", () => {
    const messages = Array.from({ length: 4 }, (_, index) => ({
      role: "user",
      content: `[Background sub-agent "worker-${index}" completed]\n${largeResult(index)}`,
    }));
    const first = releaseOldLiveSessionResults(messages, { recentResults: 1 });
    const second = releaseOldLiveSessionResults(first.messages, {
      recentResults: 1,
    });

    expect(first.stats.released).toBe(3);
    expect(second.stats.released).toBe(0);
    expect(second.messages).toEqual(first.messages);
    expect(first.messages.at(-1).content).toBe(messages.at(-1).content);
  });

  it("settles retention independently of semantic auto-compaction", async () => {
    const messages = [{ role: "system", content: "system" }];
    for (let index = 0; index < 34; index += 1) {
      messages.push({
        role: "tool",
        tool_call_id: `call-${index}`,
        content: largeResult(index),
      });
    }
    messages.push({ role: "user", content: "finish" });
    const onCompaction = vi.fn();

    const events = await drain(
      agentLoop(messages, {
        autoCompact: false,
        chatFn: async () => ({
          message: { role: "assistant", content: "done" },
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        onCompaction,
      }),
    );

    expect(events.find((event) => event.type === "compaction")).toBeUndefined();
    expect(
      events.find((event) => event.type === "session-runtime-retention"),
    ).toMatchObject({ stats: { released: 2 } });
    expect(onCompaction).toHaveBeenCalledOnce();
    expect(onCompaction.mock.calls[0][2]).toMatchObject({
      trigger: "runtime-retention",
    });
    expect(messages[1].content).toContain(SESSION_RUNTIME_RELEASE_MARKER);
  });
});
