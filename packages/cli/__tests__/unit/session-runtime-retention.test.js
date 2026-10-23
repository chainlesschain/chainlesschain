import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "../helpers/test-model-egress.js";
import {
  releaseOldLiveSessionResults,
  SESSION_RUNTIME_RELEASE_MARKER,
  SESSION_RUNTIME_RETENTION_LIMITS,
} from "../../src/lib/session-runtime-retention.js";
import {
  isRuntimeOnlySessionMessage,
  markRuntimeOnlySessionMessage,
  projectCanonicalResumeMessages,
} from "../../src/lib/session-message-provenance.js";

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

  it("preserves private runtime-only authority across retention without granting it by text", () => {
    const content = `[Background sub-agent "worker" completed]\n${largeResult(0)}`;
    const runtime = markRuntimeOnlySessionMessage({ role: "user", content });
    const user = { role: "user", content };
    const retained = releaseOldLiveSessionResults([runtime, user], {
      recentResults: 0,
    });

    expect(retained.stats.released).toBe(2);
    expect(retained.messages[0]).not.toBe(runtime);
    expect(isRuntimeOnlySessionMessage(retained.messages[0])).toBe(true);
    expect(isRuntimeOnlySessionMessage(retained.messages[1])).toBe(false);
    expect(
      projectCanonicalResumeMessages(retained.messages, { strict: true }),
    ).toEqual([retained.messages[1]]);
    expect(
      projectCanonicalResumeMessages([{ ...retained.messages[0] }], {
        strict: true,
      }),
    ).toHaveLength(1);
  });

  it("takes the retention candidate and compare snapshot after the host settles pending tools", async () => {
    const messages = Array.from({ length: 34 }, (_, index) => ({
      role: "tool",
      tool_call_id: `call-${index}`,
      content: largeResult(index),
    }));
    const concurrentInput = {
      role: "user",
      content: "New input admitted by host",
    };
    const onBeforeCompaction = vi.fn(() => messages.push(concurrentInput));
    const onCompaction = vi.fn((_stats, compacted, settlement) => {
      expect(settlement.expectedMessages.at(-1)).toBe(concurrentInput);
      expect(compacted.at(-1)).toBe(concurrentInput);
      expect(onBeforeCompaction).toHaveBeenCalledOnce();
    });
    await drain(
      agentLoop(messages, {
        autoCompact: false,
        onBeforeCompaction,
        onCompaction,
        chatFn: async () => ({
          message: { role: "assistant", content: "done" },
        }),
      }),
    );
    expect(onBeforeCompaction).toHaveBeenCalledOnce();
    expect(onCompaction).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toBe(concurrentInput);
  });

  it("stops before provider admission when pre-retention tool settlement fails", async () => {
    const messages = Array.from({ length: 34 }, (_, index) => ({
      role: "tool",
      tool_call_id: `call-${index}`,
      content: largeResult(index),
    }));
    const original = [...messages];
    const failure = Object.assign(
      new Error("pending tool persistence failed"),
      {
        runtimeLedgerPersistence: true,
      },
    );
    const chatFn = vi.fn();
    await expect(
      drain(
        agentLoop(messages, {
          autoCompact: false,
          onBeforeCompaction: () => {
            throw failure;
          },
          onCompaction: vi.fn(),
          chatFn,
        }),
      ),
    ).rejects.toBe(failure);
    expect(chatFn).not.toHaveBeenCalled();
    expect(messages).toEqual(original);
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
