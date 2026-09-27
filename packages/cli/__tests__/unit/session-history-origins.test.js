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
import {
  HISTORY_SUMMARY_SCHEMA,
  projectCheckpointSummary,
} from "../../src/lib/checkpoint-summary-projection.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  encodePersistedMessage,
  markDurableSystemMessage,
} from "../../src/lib/session-message-provenance.js";

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

describe("display history origins", () => {
  it.each(["summary-from", "summary-to"])(
    "carries %s system-summary ancestry into a subsequent rewind",
    (action) => {
      const messages = [
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second" },
        { role: "assistant", content: "answer" },
      ];
      const origins = createSessionHistoryOrigins();
      origins.snapshot(messages);
      const summarized = summaryEvent(messages, action, 0);
      expect(origins.summarize(summarized)).toBe(true);
      const later = { role: "user", content: "later" };
      origins.appendPersisted(later, 4);
      const output = [...summarized.data.messages, later];
      expect(origins.rewind(event(output, 1), 5)).toBe(4);
    },
  );

  it("rejects invalid summary certificates and output without changing the source mapping", () => {
    const messages = [
      { role: "user", content: "same" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "same" },
      { role: "assistant", content: "answer" },
    ];
    const changes = [
      (value) => {
        delete value.data.historySummary;
      },
      (value) => {
        value.data.historySummary.schema += "-unknown";
      },
      (value) => {
        value.data.historySummary.sourceHead = "b".repeat(64);
      },
      (value) => {
        value.data.historySummary.sourceMessageCount -= 1;
      },
      (value) => {
        value.data.historySummary.start = 1;
      },
      (value) => {
        value.data.historySummary.end = 3;
      },
      (value) => {
        value.data.historySummary.start = -1;
      },
      (value) => {
        value.data.historySummary.end = 4.5;
      },
      (value) => {
        value.data.action = "restore-conversation";
      },
      (value) => {
        value.data.turnId = "other";
      },
      (value) => {
        value.data.messages[0].content = "different";
      },
      (value) => {
        value.data.messages.at(-1).content += "\nextra";
      },
      (value) => {
        delete value.data.messages.at(-1)._cc_replay;
      },
      (value) => {
        value.data.messages.at(-1).role = "assistant";
      },
    ];
    for (const change of changes) {
      const origins = createSessionHistoryOrigins();
      origins.snapshot(messages);
      const summarized = summaryEvent(messages, "summary-from", 2);
      change(summarized);
      expect(origins.summarize(summarized)).toBe(false);
      expect(origins.rewind(event(messages, 2), 4)).toBe(2);
    }
  });

  it.each([0, 2])(
    "rejects a derived system spanning the rewind point at position %i",
    (position) => {
      const origins = createSessionHistoryOrigins();
      const derived = encodePersistedMessage(
        markDurableSystemMessage(
          { role: "system", content: "derived from both sides" },
          DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
        ),
      );
      const messages = [
        { role: "assistant", content: "first" },
        { role: "user", content: "cut" },
      ];
      messages.splice(position, 0, derived);
      messages.forEach((message) =>
        origins.appendMappedPersisted(
          message,
          message.role === "system"
            ? { first: 0, last: 2 }
            : message.role === "user"
              ? { first: 2, last: 2 }
              : { first: 0, last: 0 },
        ),
      );
      expect(
        origins.rewind(
          event(
            messages,
            messages.findIndex((m) => m.role === "user"),
          ),
          3,
        ),
      ).toBeNull();
    },
  );

  it("does not lose a system summary dependency during another Kernel summary", () => {
    const origins = createSessionHistoryOrigins();
    const derived = markDurableSystemMessage(
      { role: "system", content: "earlier derived context" },
      DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
    );
    const selected = { role: "user", content: "cut" };
    origins.appendMappedPersisted(encodePersistedMessage(derived), {
      first: 0,
      last: 3,
    });
    origins.appendPersisted(selected, 2);
    const items = messagesToContextItems([derived, selected], {
      sessionId: "session",
    });
    const summary = createSummaryContextItem({
      messages: [{ role: "assistant", content: "summary of system summary" }],
      parents: items.slice(0, 1),
      operationId: "system-summary",
      now: "2026-09-27T00:00:00.000Z",
    });
    const outputItems = [summary, items[1]];
    const messages = contextItemsToMessages(outputItems);
    origins.compact({
      messages,
      canonical: { sessionId: "session", outputItems },
    });
    expect(origins.rewind(event(messages, 1), 4)).toBeNull();
  });

  it("leaves ancestry unknown when a summary includes an unmapped derived system", () => {
    const derived = markDurableSystemMessage(
      { role: "system", content: "unknown earlier summary" },
      DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
    );
    const source = [{ role: "user", content: "first" }, derived];
    const origins = createSessionHistoryOrigins();
    origins.snapshot(source.map(encodePersistedMessage));
    const summarized = summaryEvent(source, "summary-from", 0);
    expect(origins.summarize(summarized)).toBe(true);
    const later = { role: "user", content: "later" };
    origins.appendPersisted(later, 1);
    expect(
      origins.rewind(event([...summarized.data.messages, later], 1), 2),
    ).toBeNull();
  });

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
    expect(origins.summarize(summaryEvent(messages, "summary-from", 0))).toBe(
      false,
    );
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
