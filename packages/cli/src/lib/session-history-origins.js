import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  contextItemsToMessages,
  messagesToContextItems,
} from "./context-memory-kernel/message-adapter.js";
import {
  decodeVerifiedPersistedMessage,
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
const fingerprint = (messages) =>
  canonicalDigest(messages.map(encodePersistedMessage));

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
        decodeVerifiedPersistedMessage(message),
        displayable(message) ? { first: ordinal, last: ordinal } : null,
      );
    },
    appendMappedPersisted(message, origin) {
      append(decodeVerifiedPersistedMessage(message), origin);
    },
    branchPrefix(messages, head, count) {
      if (!context) return null;
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
          message: decodeVerifiedPersistedMessage(message),
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
          const originals = messagesToContextItems(
            context.map((entry) => entry.message),
            { sessionId: canonical.sessionId },
          );
          const byDigest = new Map(
            originals.map((item) => [item.digest, item]),
          );
          const bySequence = new Map(
            originals.map((item) => [item.sourceRef.eventSequence, item]),
          );
          const itemEntries = (item) =>
            context.slice(
              item.sourceRef.eventSequence,
              item.sourceRef.eventSequence +
                contextItemsToMessages([item]).length,
            );
          entries = [...canonical.outputItems]
            .sort(
              (left, right) =>
                (left.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) -
                  (right.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
                left.itemId.localeCompare(right.itemId, "en"),
            )
            .flatMap((item) => {
              const messages = contextItemsToMessages([item]);
              const source = bySequence.get(item.sourceRef.eventSequence);
              if (
                item.sourceRef.store === "cli-jsonl-session" &&
                source?.sourceRef.digest === item.sourceRef.digest &&
                source.content === item.content
              ) {
                return itemEntries(source);
              }
              let origin = null;
              if (
                item.sourceRef.store === "cli-context-summary" &&
                item.provenance?.parentDigests?.length > 0
              ) {
                const digests = item.provenance.parentDigests;
                if (
                  digests.length <= originals.length &&
                  new Set(digests).size === digests.length
                ) {
                  const parents = digests.map((digest) => byDigest.get(digest));
                  if (parents.every(Boolean))
                    origin = span(parents.flatMap(itemEntries));
                }
              }
              return messages.map((message) => ({ message, origin }));
            });
          const persisted = data.messages.map(decodeVerifiedPersistedMessage);
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
            message: decodeVerifiedPersistedMessage(message),
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
        if (
          fingerprint(projected.map((entry) => entry.message)) !==
          fingerprint(data.messages.map(decodeVerifiedPersistedMessage))
        )
          return false;
        const entries = projected.map(({ message, sourceIndexes }) => ({
          message,
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
