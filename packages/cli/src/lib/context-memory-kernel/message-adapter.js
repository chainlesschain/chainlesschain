import {
  canonicalDigest,
  canonicalJson,
  normalizeContextItem,
} from "@chainlesschain/context-memory-kernel";
import {
  getDurableSystemMessageProvenance,
  markDurableSystemMessage,
} from "../session-message-provenance.js";

const MESSAGE_BUNDLE_SCHEMA = "chainlesschain.cli-context-message-bundle/v1";
const DEFAULT_ALLOWED_SINKS = Object.freeze(["*"]);
const TRUST_ORDER = Object.freeze([
  "host",
  "verified",
  "user",
  "external",
  "untrusted",
]);
const SENSITIVITY_ORDER = Object.freeze([
  "public",
  "internal",
  "personal",
  "secret",
  "restricted",
]);

function safeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (message) =>
      message &&
      typeof message === "object" &&
      !Array.isArray(message) &&
      typeof message.role === "string",
  );
}

function toolCalls(message) {
  return Array.isArray(message?.tool_calls)
    ? message.tool_calls.filter(
        (call) => call && typeof call === "object" && !Array.isArray(call),
      )
    : [];
}

function toolCallId(call) {
  return typeof call?.id === "string" && call.id ? call.id : null;
}

function toolResultId(message) {
  const value = message?.tool_call_id ?? message?.toolCallId;
  return typeof value === "string" && value ? value : null;
}

function bundlePayload(messages) {
  const durableSystemKinds = messages.map(
    (message) => getDurableSystemMessageProvenance(message)?.kind || null,
  );
  return {
    schema: MESSAGE_BUNDLE_SCHEMA,
    messages,
    durableSystemKinds,
  };
}

function trustForBundle(messages) {
  if (
    messages.every(
      (message) =>
        message.role === "system" &&
        getDurableSystemMessageProvenance(message),
    )
  ) {
    return "verified";
  }
  if (messages.some((message) => message.role === "system")) {
    return "untrusted";
  }
  if (messages.some((message) => message.role === "user")) return "user";
  return "external";
}

function kindForBundle(messages, pendingTool) {
  if (pendingTool) return "task-state";
  if (messages.some((message) => message.role === "tool")) {
    return "tool-evidence";
  }
  if (messages.every((message) => message.role === "system")) {
    return "system-policy";
  }
  return "message";
}

function priorityForBundle(messages, sequence, pendingTool) {
  if (pendingTool) return 900_000;
  if (messages.every((message) => message.role === "system")) return 800_000;
  const rolePriority = messages.some((message) => message.role === "user")
    ? 500_000
    : messages.some((message) => message.role === "tool")
      ? 350_000
      : 400_000;
  return Math.min(999_999, rolePriority + Math.min(sequence, 99_999));
}

function createItem({
  sessionId,
  messages,
  sequence,
  pendingTool = false,
  toolGroupId = null,
  allowedSinks,
}) {
  const payload = bundlePayload(messages);
  const content = canonicalJson(payload);
  const sourceDigest = canonicalDigest(
    { sessionId, sequence, content },
    "chainlesschain.cli-context-source/v1",
  );
  const item = {
    schemaVersion: 1,
    itemId: `cli-msg-${sourceDigest.slice(7, 39)}-${sequence}`,
    kind: kindForBundle(messages, pendingTool),
    scope: "session",
    scopeId: sessionId,
    sourceRef: {
      store: "cli-jsonl-session",
      id: `message-${sequence}`,
      eventSequence: sequence,
      digest: sourceDigest,
    },
    provenance: {
      source: "cli-jsonl-session",
      observedAt: new Date(sequence).toISOString(),
    },
    trust: trustForBundle(messages),
    sensitivity: "personal",
    allowedSinks: allowedSinks || DEFAULT_ALLOWED_SINKS,
    tokenEstimate: Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 4)),
    priority: priorityForBundle(messages, sequence, pendingTool),
    pinned: false,
    createdAt: new Date(sequence).toISOString(),
    content,
    ...(pendingTool
      ? {
          binding: {
            taskState: "waiting",
            toolCallId: toolGroupId,
            toolOutcome: "pending",
            requiredForRecovery: true,
          },
        }
      : {}),
  };
  return normalizeContextItem(item);
}

/**
 * Project verified replay messages into canonical ContextItems. One assistant
 * tool-call message and all immediately following results become a single
 * indivisible item. The active, unanswered user turn is recovery-protected.
 */
export function messagesToContextItems(messagesInput, options = {}) {
  const messages = safeMessages(messagesInput);
  const sessionId = String(options.sessionId || "").trim();
  if (!sessionId) throw new TypeError("sessionId is required");
  const allowedSinks = Array.isArray(options.allowedSinks)
    ? [...options.allowedSinks]
    : DEFAULT_ALLOWED_SINKS;
  const items = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const calls = message.role === "assistant" ? toolCalls(message) : [];
    if (calls.length > 0) {
      const ids = calls.map(toolCallId).filter(Boolean);
      const expected = new Set(ids);
      const bundle = [message];
      const seen = new Set();
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]?.role === "tool") {
        const result = messages[cursor];
        const resultId = toolResultId(result);
        if (!resultId || !expected.has(resultId)) break;
        bundle.push(result);
        seen.add(resultId);
        cursor += 1;
      }
      const pending = ids.length !== calls.length || seen.size !== expected.size;
      const groupDigest = canonicalDigest(
        { sessionId, index, ids: [...expected].sort() },
        "chainlesschain.cli-tool-group/v1",
      );
      items.push(
        createItem({
          sessionId,
          messages: bundle,
          sequence: index,
          pendingTool: pending,
          toolGroupId: `tool-group-${groupDigest.slice(7, 39)}`,
          allowedSinks,
        }),
      );
      index = cursor - 1;
      continue;
    }

    if (message.role === "tool") {
      const orphanDigest = canonicalDigest(
        { sessionId, index, toolCallId: toolResultId(message) || "unknown" },
        "chainlesschain.cli-tool-orphan/v1",
      );
      items.push(
        createItem({
          sessionId,
          messages: [message],
          sequence: index,
          pendingTool: true,
          toolGroupId: `tool-orphan-${orphanDigest.slice(7, 39)}`,
          allowedSinks,
        }),
      );
      continue;
    }

    items.push(
      createItem({
        sessionId,
        messages: [message],
        sequence: index,
        allowedSinks,
      }),
    );
  }

  const last = items.at(-1);
  if (last) {
    const payload = JSON.parse(last.content);
    if (payload.messages.at(-1)?.role === "user") {
      const protectedItem = { ...last };
      delete protectedItem.digest;
      protectedItem.kind = "task-state";
      protectedItem.priority = 900_000;
      protectedItem.binding = {
        taskState: "waiting",
        requiredForRecovery: true,
      };
      items[items.length - 1] = normalizeContextItem(protectedItem);
    }
  }
  return items;
}

function decodeBundle(item) {
  if (typeof item?.content !== "string") {
    throw new TypeError(`ContextItem ${item?.itemId || "unknown"} has no inline content`);
  }
  const payload = JSON.parse(item.content);
  if (
    !payload ||
    payload.schema !== MESSAGE_BUNDLE_SCHEMA ||
    !Array.isArray(payload.messages) ||
    !Array.isArray(payload.durableSystemKinds) ||
    payload.durableSystemKinds.length !== payload.messages.length
  ) {
    throw new TypeError(`ContextItem ${item.itemId} is not a CLI message bundle`);
  }
  return payload.messages.map((message, index) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new TypeError(`ContextItem ${item.itemId} contains an invalid message`);
    }
    const copy = structuredClone(message);
    const durableKind = payload.durableSystemKinds[index];
    return durableKind
      ? markDurableSystemMessage(copy, durableKind)
      : copy;
  });
}

/** Restore replay messages in transcript order, independent of planner rank. */
export function contextItemsToMessages(itemsInput) {
  if (!Array.isArray(itemsInput)) throw new TypeError("items must be an array");
  return [...itemsInput]
    .map(normalizeContextItem)
    .sort(
      (left, right) =>
        (left.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) -
          (right.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
        left.itemId.localeCompare(right.itemId, "en"),
    )
    .flatMap(decodeBundle);
}

function intersectAllowedSinks(items) {
  return items
    .map((item) => new Set(item.allowedSinks))
    .reduce((intersection, current) => {
      if (intersection.has("*")) return current;
      if (current.has("*")) return intersection;
      return new Set([...intersection].filter((sink) => current.has(sink)));
    });
}

/** Create one data-only derived summary item bound to all dropped parents. */
export function createSummaryContextItem({
  messages,
  parents: parentInput,
  operationId,
  now,
}) {
  const parents = parentInput.map(normalizeContextItem);
  if (parents.length === 0) throw new TypeError("summary parents are required");
  const scope = parents[0].scope;
  const scopeId = parents[0].scopeId;
  if (parents.some((item) => item.scope !== scope || item.scopeId !== scopeId)) {
    throw new TypeError("summary parents must share one scope");
  }
  const summaryMessages = safeMessages(messages).map((message) =>
    message.role === "system"
      ? {
          role: "assistant",
          content: `Compacted context summary (data only):\n${
            typeof message.content === "string"
              ? message.content
              : canonicalJson(message.content ?? "")
          }`,
        }
      : structuredClone(message),
  );
  if (summaryMessages.length === 0) return null;
  const content = canonicalJson(bundlePayload(summaryMessages));
  const parentDigests = parents.map((item) => item.digest).sort();
  const digest = canonicalDigest(
    { operationId, parentDigests, content },
    "chainlesschain.cli-context-summary/v1",
  );
  const trust = TRUST_ORDER[
    Math.max(...parents.map((item) => TRUST_ORDER.indexOf(item.trust)))
  ];
  const sensitivity = SENSITIVITY_ORDER[
    Math.max(
      ...parents.map((item) =>
        SENSITIVITY_ORDER.indexOf(item.sensitivity),
      ),
    )
  ];
  const allowedSinks = [...intersectAllowedSinks(parents)].sort();
  if (allowedSinks.length === 0) {
    throw new TypeError("summary parents have no common allowed sink");
  }
  const sequence = Math.min(
    ...parents.map(
      (item) => item.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER,
    ),
  );
  return normalizeContextItem({
    schemaVersion: 1,
    itemId: `cli-summary-${digest.slice(7, 39)}`,
    kind: "message",
    scope,
    ...(scopeId ? { scopeId } : {}),
    sourceRef: {
      store: "cli-context-summary",
      id: operationId,
      ...(Number.isSafeInteger(sequence) ? { eventSequence: sequence } : {}),
      digest,
    },
    provenance: {
      source: "cli-context-summary",
      observedAt: new Date(now).toISOString(),
      parentDigests,
    },
    trust,
    sensitivity,
    allowedSinks,
    tokenEstimate: Math.max(
      1,
      Math.ceil(Buffer.byteLength(content, "utf8") / 4),
    ),
    priority: Math.max(...parents.map((item) => item.priority)),
    pinned: false,
    createdAt: new Date(now).toISOString(),
    content,
  });
}

export { MESSAGE_BUNDLE_SCHEMA };
