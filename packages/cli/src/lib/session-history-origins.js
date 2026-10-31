import {
  canonicalDigest,
  canonicalJson,
} from "@chainlesschain/context-memory-kernel";
import {
  contextItemsToMessages,
  messagesToContextItems,
} from "./context-memory-kernel/message-adapter.js";
import {
  decodeVerifiedPersistedMessage,
  decodeVerifiedRawPersistedMessage,
  encodePersistedMessage,
  getDurableSystemMessageProvenance,
  DURABLE_SYSTEM_MESSAGE_KINDS,
} from "./session-message-provenance.js";
import {
  HISTORY_SUMMARY_SCHEMA,
  projectCheckpointSummary,
} from "./checkpoint-summary-projection.js";

export const HISTORY_PREFIX_SCHEMA = "chainlesschain.session-history-prefix/v1";
const MAX_CONTEXT_BYTES = 8 * 1024 * 1024;
const MAX_CONTEXT_MESSAGES = 32768;
const displayable = (message) =>
  ["user", "assistant", "tool"].includes(message?.role);
const derivedSystemKinds = new Set([
  DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_SUMMARY,
  DURABLE_SYSTEM_MESSAGE_KINDS.COMPACT_TOOL_COLLAPSE,
  DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
  DURABLE_SYSTEM_MESSAGE_KINDS.MIGRATION_SUMMARY,
]);
const historyBearing = (entry) =>
  displayable(entry.message) ||
  Boolean(entry.origin) ||
  derivedSystemKinds.has(
    getDurableSystemMessageProvenance(entry.message)?.kind,
  );
// Compare conversation identity without dropping system messages, their private
// provenance, or unknown metadata. Raw receipt fields remain available below
// for authenticating historical ContextItem source digests.
const conversationMessages = (messages) =>
  messages.map((message) =>
    decodeVerifiedPersistedMessage(encodePersistedMessage(message)),
  );
const fingerprint = (messages) =>
  canonicalDigest(conversationMessages(messages).map(encodePersistedMessage));
const sameContextItemContent = (left, right) => {
  if (typeof left?.content === "string" || typeof right?.content === "string") {
    return (
      typeof left?.content === "string" &&
      typeof right?.content === "string" &&
      left.content === right.content
    );
  }
  if (left?.contentRef === undefined || right?.contentRef === undefined) {
    return false;
  }
  return canonicalJson(left.contentRef) === canonicalJson(right.contentRef);
};

/**
 * Origins belong to positions in the current display history, never to equal
 * text. Only indexed, digest-checked compaction sources can carry them forward.
 * The optional mapping is bounded independently of the display page; losing it
 * forces a later rewind to use its explicit snapshot.
 */
export function createSessionHistoryOrigins() {
  let context = [];
  let bytes = 0;

  function replace(entries) {
    context = [];
    bytes = 0;
    for (const entry of entries) {
      append(entry.message, entry.origin);
      if (!context) break;
    }
  }
  function append(message, origin) {
    if (!context || typeof message?.role !== "string") return;
    bytes += Buffer.byteLength(JSON.stringify(message));
    if (bytes > MAX_CONTEXT_BYTES || context.length >= MAX_CONTEXT_MESSAGES) {
      context = null;
      return;
    }
    context.push({ message, origin });
  }
  function span(entries) {
    const visible = entries.filter(historyBearing);
    if (visible.length === 0) return null;
    if (visible.some((entry) => !entry.origin)) return null;
    return {
      first: Math.min(...visible.map((entry) => entry.origin.first)),
      last: Math.max(...visible.map((entry) => entry.origin.last)),
    };
  }

  const api = {
    appendPersisted(message, ordinal) {
      if (!context) return;
      append(
        decodeVerifiedRawPersistedMessage(message),
        displayable(message) ? { first: ordinal, last: ordinal } : null,
      );
    },
    appendMappedPersisted(message, origin) {
      append(decodeVerifiedRawPersistedMessage(message), origin);
    },
    branchPrefix(messages, head, count) {
      if (!context) return null;
      // A branch may retain the complete verified context. A rewind must remove
      // something, so its strict-prefix admission cannot decide this case.
      if (messages.length === context.length) {
        if (
          !/^[a-f0-9]{64}$/u.test(head) ||
          !Number.isSafeInteger(count) ||
          count < 0 ||
          context.some(
            (entry) =>
              historyBearing(entry) &&
              (!entry.origin ||
                !Number.isSafeInteger(entry.origin.first) ||
                !Number.isSafeInteger(entry.origin.last) ||
                entry.origin.first < 0 ||
                entry.origin.last < entry.origin.first ||
                entry.origin.last >= count),
          )
        )
          return null;
        try {
          if (
            fingerprint(context.map((entry) => entry.message)) !==
            fingerprint(messages)
          )
            return null;
        } catch {
          return null;
        }
        return {
          cutoff: count,
          entries: context.map((entry) => ({
            message: entry.message,
            origin: entry.origin ? { ...entry.origin } : null,
          })),
        };
      }
      const cutoff = api.rewind(
        {
          prevHash: head,
          data: {
            action: "restore-conversation",
            messages: messages.map(encodePersistedMessage),
            historyPrefix: {
              schema: HISTORY_PREFIX_SCHEMA,
              sourceHead: head,
              sourceMessageCount: context.length,
              retainedMessageCount: messages.length,
            },
          },
        },
        count,
      );
      return cutoff === null
        ? null
        : {
            cutoff,
            entries: context.map((entry) => ({
              message: entry.message,
              origin: entry.origin ? { ...entry.origin } : null,
            })),
          };
    },
    snapshot(messages) {
      let ordinal = 0;
      replace(
        messages.map((message) => ({
          message: decodeVerifiedRawPersistedMessage(message),
          origin: displayable(message)
            ? { first: ordinal, last: ordinal++ }
            : null,
        })),
      );
    },
    compact(data) {
      const canonical = data.canonical;
      let entries = null;
      try {
        if (context) {
          const rawMessages = context.map((entry) => entry.message);
          // Old compactions hashed raw receipt-bearing bundles; new ones hash
          // conversation projections. Derive exactly these two representations
          // from the same bounded verified context, never from output claims.
          const representations = [rawMessages];
          if (
            rawMessages.some(
              (message) =>
                message.role === "user" &&
                (Object.hasOwn(message, "clientMessageId") ||
                  Object.hasOwn(message, "inputDigest")),
            )
          ) {
            representations.push(conversationMessages(rawMessages));
          }
          const sources = representations.map((messages) => {
            const items = messagesToContextItems(messages, {
              sessionId: canonical.sessionId,
              allowExternalization: true,
            });
            return {
              items,
              byDigest: new Map(items.map((item) => [item.digest, item])),
              bySequence: new Map(
                items.map((item) => [item.sourceRef.eventSequence, item]),
              ),
            };
          });
          const itemEntries = (item) =>
            context.slice(
              item.sourceRef.eventSequence,
              item.sourceRef.eventSequence +
                contextItemsToMessages([item], {
                  sessionId: canonical.sessionId,
                }).length,
            );
          entries = [...canonical.outputItems]
            .sort(
              (left, right) =>
                (left.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) -
                  (right.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
                left.itemId.localeCompare(right.itemId, "en"),
            )
            .flatMap((item) => {
              const messages = contextItemsToMessages([item], {
                sessionId: canonical.sessionId,
              });
              const source = sources
                .map(({ bySequence }) =>
                  bySequence.get(item.sourceRef.eventSequence),
                )
                .find(
                  (candidate) =>
                    candidate?.sourceRef.digest === item.sourceRef.digest &&
                    sameContextItemContent(candidate, item),
                );
              if (item.sourceRef.store === "cli-jsonl-session" && source) {
                return itemEntries(source);
              }
              let origin = null;
              if (
                item.sourceRef.store === "cli-context-summary" &&
                item.provenance?.parentDigests?.length > 0
              ) {
                const digests = item.provenance.parentDigests;
                if (new Set(digests).size === digests.length) {
                  // A summary must name one complete representation. Mixing
                  // raw and projected aliases cannot manufacture extra parents.
                  for (const { items, byDigest } of sources) {
                    if (digests.length > items.length) continue;
                    const parents = digests.map((digest) =>
                      byDigest.get(digest),
                    );
                    if (parents.every(Boolean)) {
                      origin = span(parents.flatMap(itemEntries));
                      break;
                    }
                  }
                }
              }
              return messages.map((message) => ({ message, origin }));
            });
          const persisted = data.messages.map(
            decodeVerifiedRawPersistedMessage,
          );
          if (
            fingerprint(entries.map((entry) => entry.message)) !==
            fingerprint(persisted)
          )
            entries = null;
        }
      } catch {
        entries = null;
      }
      replace(
        entries ||
          data.messages.map((message) => ({
            message: decodeVerifiedRawPersistedMessage(message),
            origin: null,
          })),
      );
    },
    summarize(event) {
      const data = event.data;
      const certificate = data.historySummary;
      if (
        !context ||
        certificate?.schema !== HISTORY_SUMMARY_SCHEMA ||
        !/^[a-f0-9]{64}$/u.test(certificate.sourceHead) ||
        certificate.sourceHead !== event.prevHash ||
        certificate.sourceMessageCount !== context.length
      )
        return false;
      try {
        const projected = projectCheckpointSummary({
          messages: context.map((entry) => entry.message),
          action: data.action,
          turnId: data.turnId,
          start: certificate.start,
          end: certificate.end,
        });
        const persisted = data.messages.map(decodeVerifiedRawPersistedMessage);
        if (
          fingerprint(projected.map((entry) => entry.message)) !==
          fingerprint(persisted)
        )
          return false;
        const entries = projected.map(({ sourceIndexes }, index) => ({
          message: persisted[index],
          origin: span(sourceIndexes.map((index) => context[index])),
        }));
        replace(entries);
        return true;
      } catch {
        return false;
      }
    },
    rewind(event, count) {
      const data = event.data;
      const prefix = data.historyPrefix;
      if (
        !context ||
        prefix?.schema !== HISTORY_PREFIX_SCHEMA ||
        !/^[a-f0-9]{64}$/u.test(prefix.sourceHead) ||
        prefix.sourceHead !== event.prevHash ||
        prefix.sourceMessageCount !== context.length ||
        !["restore-conversation", "restore-both"].includes(data.action) ||
        !Number.isSafeInteger(prefix.retainedMessageCount) ||
        prefix.retainedMessageCount < 0 ||
        prefix.retainedMessageCount >= context.length
      )
        return null;
      const retained = context.slice(0, prefix.retainedMessageCount);
      const removed = context.slice(prefix.retainedMessageCount);
      const anchor = removed[0];
      if (
        anchor.message.role !== "user" ||
        !anchor.origin ||
        anchor.origin.first !== anchor.origin.last
      )
        return null;
      const cutoff = anchor.origin.first;
      if (
        cutoff < 0 ||
        cutoff > count ||
        retained.some(
          (entry) =>
            historyBearing(entry) &&
            (!entry.origin || entry.origin.last >= cutoff),
        ) ||
        removed.some(
          (entry) =>
            historyBearing(entry) &&
            (!entry.origin || entry.origin.first < cutoff),
        )
      )
        return null;
      try {
        if (
          fingerprint(retained.map((entry) => entry.message)) !==
          fingerprint(data.messages.map(decodeVerifiedPersistedMessage))
        )
          return null;
      } catch {
        return null;
      }
      replace(retained);
      return cutoff;
    },
  };
  return api;
}
