import { describe, expect, it } from "vitest";
import {
  createSessionHistoryOrigins,
  HISTORY_PREFIX_SCHEMA,
} from "../../src/lib/session-history-origins.js";
import {
  messagesToContextItems,
  contextItemsToMessages,
  createSummaryContextItem,
} from "../../src/lib/context-memory-kernel/message-adapter.js";

const head = "a".repeat(64);
function event(messages, retainedMessageCount) {
  return {
    prevHash: head,
    data: {
      action: "restore-conversation",
      messages: messages.slice(0, retainedMessageCount),
      historyPrefix: {
        schema: HISTORY_PREFIX_SCHEMA,
        sourceHead: head,
        sourceMessageCount: messages.length,
        retainedMessageCount,
      },
    },
  };
}

describe("display history origins", () => {
  it("drops optional origin tracking at the byte limit, and recovers only from a later explicit snapshot", () => {
    const origins = createSessionHistoryOrigins();
    const messages = Array.from({ length: 70 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(128 * 1024),
    }));
    messages.forEach((message, index) =>
      origins.appendPersisted(message, index),
    );
    expect(origins.rewind(event(messages, 2), messages.length)).toBeNull();
    origins.snapshot(messages.slice(0, 4));
    expect(origins.rewind(event(messages.slice(0, 4), 2), 4)).toBe(2);
  });

  it("does not infer an origin from equal text at a different indexed source", () => {
    const origins = createSessionHistoryOrigins();
    const persisted = [
      { role: "user", content: "same" },
      { role: "assistant", content: "answer" },
    ];
    persisted.forEach((message, index) =>
      origins.appendPersisted(message, index),
    );
    const otherSource = [{ role: "assistant", content: "other" }, ...persisted];
    const item = messagesToContextItems(otherSource, {
      sessionId: "session",
    })[1];
    const messages = contextItemsToMessages([item]);
    origins.compact({
      messages,
      canonical: { sessionId: "session", outputItems: [item] },
    });
    expect(origins.rewind(event(messages, 0), 2)).toBeNull();
  });

  it("requires every summary parent and refuses a prefix that crosses the selected origin", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "selected" },
    ];
    const items = messagesToContextItems(messages, { sessionId: "session" });
    const origins = createSessionHistoryOrigins();
    messages.forEach((message, index) =>
      origins.appendPersisted(message, index),
    );
    const summary = createSummaryContextItem({
      messages: [{ role: "assistant", content: "spanning summary" }],
      parents: items,
      operationId: "crossing",
      now: "2026-09-27T00:00:00.000Z",
    });
    const outputItems = [summary, items[2]];
    const output = contextItemsToMessages(outputItems);
    origins.compact({
      messages: output,
      canonical: { sessionId: "session", outputItems },
    });
    expect(origins.rewind(event(output, 1), 3)).toBeNull();

    const differentSource = messagesToContextItems(
      [{ role: "assistant", content: "unrecorded" }],
      { sessionId: "session" },
    );
    const unknownSummary = createSummaryContextItem({
      messages: [{ role: "assistant", content: "unknown parent" }],
      parents: differentSource,
      operationId: "unknown",
      now: "2026-09-27T00:00:00.000Z",
    });
    origins.snapshot(messages);
    const unknownItems = [unknownSummary, items[2]];
    const unknownOutput = contextItemsToMessages(unknownItems);
    origins.compact({
      messages: unknownOutput,
      canonical: { sessionId: "session", outputItems: unknownItems },
    });
    expect(origins.rewind(event(unknownOutput, 1), 3)).toBeNull();
  });

  it("does not treat changed replacement content or a summary action as a retained prefix", () => {
    const origins = createSessionHistoryOrigins();
    const messages = [
      { role: "user", content: "one" },
      { role: "user", content: "two" },
    ];
    origins.snapshot(messages);
    const changed = event(messages, 1);
    changed.data.messages[0] = { role: "user", content: "replacement" };
    expect(origins.rewind(changed, 2)).toBeNull();
    const summary = event(messages, 1);
    summary.data.action = "summary-to";
    expect(origins.rewind(summary, 2)).toBeNull();
    expect(origins.rewind(event(messages, 0), 2)).toBe(0);
  });
});
