import {
  buildExtractiveHandoff,
  formatStructuredHandoff,
} from "../harness/structured-handoff.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
  projectCanonicalResumeMessages,
} from "./session-message-provenance.js";

export const HISTORY_SUMMARY_SCHEMA =
  "chainlesschain.session-history-summary/v1";

function summaryMessage(messages, action, turnId) {
  const handoff = buildExtractiveHandoff(messages, {
    maxFallbackSourceChars: 24_000,
  });
  return markDurableSystemMessage(
    {
      role: "system",
      content:
        `[Conversation Summary: ${action} ${turnId}]\n` +
        formatStructuredHandoff(handoff),
    },
    DURABLE_SYSTEM_MESSAGE_KINDS.CHECKPOINT_SUMMARY,
  );
}

/**
 * Deterministic v1 rewrite shared by the planner and verified history reader.
 * Source indexes describe the conservative dependency of each output, not a
 * claim that the bounded extractive summary quotes every source. Changes to
 * this transform/formatter require a new history schema or a v1 reader.
 */
export function projectCheckpointSummary({
  messages,
  action,
  turnId,
  start,
  end,
}) {
  if (
    !Array.isArray(messages) ||
    typeof turnId !== "string" ||
    !turnId ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > messages.length ||
    !["summary-from", "summary-to"].includes(action)
  )
    throw new TypeError("Invalid checkpoint summary source range");
  const copied = (begin, finish) =>
    messages.slice(begin, finish).map((message, index) => ({
      message,
      sourceIndexes: [begin + index],
    }));
  const summarized = (entries) => ({
    message: summaryMessage(
      entries.map((entry) => entry.message),
      action,
      turnId,
    ),
    sourceIndexes: entries.flatMap((entry) => entry.sourceIndexes),
  });
  if (action === "summary-from") {
    if (end !== messages.length || messages[start]?.role !== "user")
      throw new TypeError("Invalid checkpoint summary suffix");
    return [...copied(0, start), summarized(copied(start, end))];
  }
  if (
    start !== (messages[0]?.role === "system" ? 1 : 0) ||
    (end < messages.length && messages[end]?.role !== "user")
  )
    throw new TypeError("Invalid checkpoint summary prefix");

  const prefix = messages.slice(start, end);
  // Validate/sanitize before inspecting roles. Unmarked systems must neither
  // survive the rewrite nor be quoted into a newly authorized summary.
  const canonical = projectCanonicalResumeMessages(prefix, { strict: true });
  const indexes = prefix.flatMap((message, index) =>
    message.role !== "system" || getDurableSystemMessageProvenance(message)
      ? [start + index]
      : [],
  );
  const entries = canonical.map((message, index) => ({
    message,
    sourceIndexes: [indexes[index]],
  }));
  return [
    ...copied(0, start),
    ...entries.filter((entry) => entry.message.role === "system"),
    summarized(entries.filter((entry) => entry.message.role !== "system")),
    ...copied(end, messages.length),
  ];
}
