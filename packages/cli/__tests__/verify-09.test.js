import { normalizeContextItem } from "@chainlesschain/context-memory-kernel";
import {
  messagesToContextItems,
  contextItemsToMessages,
} from "../src/lib/context-memory-kernel/message-adapter.js";
import { describe, expect, it } from "vitest";
import {
  createSessionHistoryOrigins,
  HISTORY_PREFIX_SCHEMA,
} from "../src/lib/session-history-origins.js";
import {
  HISTORY_SUMMARY_SCHEMA,
  projectCheckpointSummary,
} from "../src/lib/checkpoint-summary-projection.js";
import { encodePersistedMessage } from "../src/lib/session-message-provenance.js";

const head = "a".repeat(64);

// A rewind event whose prefix is bound to the current session head and to the
// exact source message count. Each tampering case overrides one binding and
// leaves every other prerequisite valid, so the mismatch is what is observed.
function prefixEvent(messages, retainedMessageCount, overrides = {}) {
  const {
    prevHash = head,
    sourceHead = head,
    sourceMessageCount = messages.length,
    ...rest
  } = overrides;
  return {
    prevHash,
    data: {
      action: "restore-conversation",
      messages: structuredClone(messages.slice(0, retainedMessageCount)),
      historyPrefix: {
        schema: HISTORY_PREFIX_SCHEMA,
        sourceHead,
        sourceMessageCount,
        retainedMessageCount,
        ...rest,
      },
    },
  };
}

function summaryEvent(messages, action, start, end = messages.length) {
  return {
    prevHash: head,
    data: {
      action,
      turnId: "selected",
      historySummary: {
        schema: HISTORY_SUMMARY_SCHEMA,
        sourceHead: head,
        sourceMessageCount: messages.length,
        start,
        end,
      },
      messages: projectCheckpointSummary({
        messages,
        action,
        start,
        end,
        turnId: "selected",
      }).map(({ message }) => encodePersistedMessage(message)),
    },
  };
}

describe("historical source tampering rejection", () => {
  it("accepts a rewind bound to the correct source and returns the readable cutoff", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    expect(origins.rewind(prefixEvent(messages, 0), 2)).toBe(0);
  });

  it("rejects a prefix that names a different session source head, then still reads the correct source", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    expect(
      origins.rewind(
        prefixEvent(messages, 0, { sourceHead: "b".repeat(64) }),
        2,
      ),
    ).toBeNull();
    expect(origins.rewind(prefixEvent(messages, 0), 2)).toBe(0);
  });

  it("rejects a prefix bound to the wrong source message count", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    expect(
      origins.rewind(prefixEvent(messages, 0, { sourceMessageCount: 7 }), 2),
    ).toBeNull();
  });

  it("rejects a prefix whose session identity (prevHash) does not match its declared source", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    expect(
      origins.rewind(prefixEvent(messages, 0, { prevHash: "b".repeat(64) }), 2),
    ).toBeNull();
  });

  it("rejects a prefix whose retained content no longer matches the source, while the genuine source reads back", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "second" },
    ];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    const tampered = prefixEvent(messages, 2);
    tampered.data.messages[0].content = "tampered";
    expect(origins.rewind(tampered, 3)).toBeNull();
    expect(origins.rewind(prefixEvent(messages, 2), 3)).toBe(2);

    // Keep valid content and sequence, changing only the claimed source digest.
    const item = messagesToContextItems(messages, {
      sessionId: "source-test",
    })[0];
    const forged = normalizeContextItem({
      ...item,
      digest: undefined,
      sourceRef: { ...item.sourceRef, digest: "sha256:" + "b".repeat(64) },
    });
    const output = contextItemsToMessages([item]);
    expect(contextItemsToMessages([forged])).toEqual(output);
    const compactOrigins = createSessionHistoryOrigins();
    compactOrigins.snapshot(messages);
    compactOrigins.compact({
      messages: output,
      canonical: { sessionId: "source-test", outputItems: [forged] },
    });
    expect(compactOrigins.rewind(prefixEvent(output, 0), 3)).toBeNull();
    compactOrigins.snapshot(messages);
    compactOrigins.compact({
      messages: output,
      canonical: { sessionId: "source-test", outputItems: [item] },
    });
    expect(compactOrigins.rewind(prefixEvent(output, 0), 3)).toBe(0);
  });

  it("reads a correct verified summary source and its ancestry through a later rewind", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(messages);
    const summarized = summaryEvent(messages, "summary-from", 0);
    expect(origins.summarize(summarized)).toBe(true);
    const later = { role: "user", content: "later" };
    origins.appendPersisted(later, 2);
    const output = [...summarized.data.messages, later];
    expect(origins.rewind(prefixEvent(output, 1), 3)).toBe(2);
  });
});
