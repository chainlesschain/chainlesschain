import { describe, expect, it } from "vitest";
import { normalizeContextItem } from "@chainlesschain/context-memory-kernel";
import {
  createSessionHistoryOrigins,
  HISTORY_PREFIX_SCHEMA,
} from "../../src/lib/session-history-origins.js";
import {
  contextItemsToMessages,
  createSummaryContextItem,
  messagesToContextItems,
} from "../../src/lib/context-memory-kernel/message-adapter.js";
import {
  decodeVerifiedPersistedMessage,
  encodePersistedMessage,
} from "../../src/lib/session-message-provenance.js";

const head = "c".repeat(64);
const sessionId = "receipt-history-compatibility";
const source = () => [
  {
    role: "user",
    content: "first",
    clientMessageId: "first",
    inputDigest: "a".repeat(64),
    metadata: { keep: true },
  },
  {
    role: "assistant",
    content: "reply",
    clientMessageId: "assistant-metadata",
  },
  {
    role: "user",
    content: "second",
    clientMessageId: "second",
    inputDigest: "b".repeat(64),
  },
];
const conversation = (messages) =>
  messages.map((message) =>
    decodeVerifiedPersistedMessage(encodePersistedMessage(message)),
  );
function fixture(representation) {
  const messages = source();
  const origins = createSessionHistoryOrigins();
  messages.forEach((message, index) => origins.appendPersisted(message, index));
  const outputItems = messagesToContextItems(
    representation === "legacy" ? messages : conversation(messages),
    { sessionId },
  );
  return { origins, outputItems };
}
function compact(
  origins,
  outputItems,
  messages = contextItemsToMessages(outputItems),
) {
  origins.compact({ canonical: { sessionId, outputItems }, messages });
  return conversation(messages);
}
function rewind(origins, messages, retainedMessageCount = 2) {
  return origins.rewind(
    {
      prevHash: head,
      data: {
        action: "restore-conversation",
        messages: messages
          .slice(0, retainedMessageCount)
          .map(encodePersistedMessage),
        historyPrefix: {
          schema: HISTORY_PREFIX_SCHEMA,
          sourceHead: head,
          sourceMessageCount: messages.length,
          retainedMessageCount,
        },
      },
    },
    3,
  );
}
describe("receipt metadata history compatibility", () => {
  it("retains origins across legacy and conversation compactions in sequence", () => {
    const { origins, outputItems } = fixture("legacy");
    const messages = compact(origins, outputItems);
    const normalized = messagesToContextItems(messages, { sessionId });
    compact(origins, normalized);
    expect(rewind(origins, compact(origins, outputItems))).toBe(2);
  });
  for (const representation of ["legacy", "conversation"]) {
    it(`${representation} compaction retains rewind origins`, () => {
      const { origins, outputItems } = fixture(representation);
      expect(rewind(origins, compact(origins, outputItems))).toBe(2);
    });
    it(`${representation} compaction retains branch origins`, () => {
      const { origins, outputItems } = fixture(representation);
      const messages = compact(origins, outputItems);
      expect(
        origins
          .branchPrefix(messages.slice(0, 2), head, 3)
          ?.entries.map((entry) => entry.origin),
      ).toEqual([
        { first: 0, last: 0 },
        { first: 1, last: 1 },
      ]);
    });
    it(`${representation} summary retains parent origins`, () => {
      const { origins, outputItems } = fixture(representation);
      const summary = createSummaryContextItem({
        messages: [{ role: "assistant", content: "summary" }],
        parents: outputItems.slice(0, 2),
        operationId: "compat-summary",
        now: "2026-10-24T00:00:00.000Z",
      });
      expect(
        rewind(origins, compact(origins, [summary, outputItems[2]]), 1),
      ).toBe(2);
    });
    for (const mutation of ["digest", "content", "sequence", "metadata"]) {
      it(`${representation} rejects altered ${mutation} ancestry`, () => {
        const { origins, outputItems } = fixture(representation);
        let messages = contextItemsToMessages(outputItems);
        if (mutation === "digest")
          outputItems[0].sourceRef.digest = `sha256:${"f".repeat(64)}`;
        if (mutation === "sequence") outputItems[0].sourceRef.eventSequence = 1;
        if (mutation === "content") {
          const payload = JSON.parse(outputItems[0].content);
          payload.messages[0].content = "changed";
          outputItems[0].content = JSON.stringify(payload);
        }
        if (mutation !== "metadata") {
          delete outputItems[0].digest;
          outputItems[0] = normalizeContextItem(outputItems[0]);
          messages = contextItemsToMessages(outputItems);
        }
        if (mutation === "metadata") messages[0].metadata.keep = false;
        expect(
          rewind(origins, compact(origins, outputItems, messages)),
        ).toBeNull();
      });
    }
  }
  it("rejects a summary combining raw and conversation parent digests", () => {
    const { origins, outputItems } = fixture("legacy");
    const normalized = messagesToContextItems(conversation(source()), {
      sessionId,
    });
    const summary = createSummaryContextItem({
      messages: [{ role: "assistant", content: "mixed" }],
      parents: [outputItems[0], normalized[2]],
      operationId: "mixed-summary",
      now: "2026-10-24T00:00:00.000Z",
    });
    const later = { role: "user", content: "later" };
    compact(origins, [summary]);
    origins.appendPersisted(later, 3);
    expect(
      origins.branchPrefix(contextItemsToMessages([summary]), head, 4),
    ).toBeNull();
  });
});
