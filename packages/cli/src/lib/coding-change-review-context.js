import { isDeepStrictEqual } from "node:util";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  SESSION_MESSAGE_PROVENANCE_FIELD,
  encodePersistedMessage,
  getDurableSystemMessageProvenance,
  isRuntimeOnlySessionMessage,
} from "./session-message-provenance.js";

function snapshot(message) {
  const copy = encodePersistedMessage(message);
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) {
    throw new TypeError("Review context requires plain message objects");
  }
  return copy;
}

function hasContent(message) {
  return (
    (typeof message.content === "string" &&
      message.content.trim().length > 0) ||
    (Array.isArray(message.content) && message.content.length > 0)
  );
}

function mergeAdjacentUsers(messages) {
  const projected = [];
  for (const message of messages) {
    const previous = projected.at(-1);
    if (previous?.role !== "user" || message.role !== "user") {
      projected.push(message);
      continue;
    }
    // Message-level metadata can have provider-specific scope. Dropping it or
    // attaching it to a larger user turn could change meaning or authority.
    if (
      [previous, message].some((entry) =>
        Object.keys(entry).some((key) => !["role", "content"].includes(key)),
      )
    ) {
      throw new TypeError("Cannot safely merge review user message metadata");
    }
    const left = previous.content;
    const right = message.content;
    if (
      ![left, right].every(
        (content) => typeof content === "string" || Array.isArray(content),
      )
    ) {
      throw new TypeError("Cannot safely merge review user message content");
    }
    const blocks = (content) =>
      Array.isArray(content) ? content : [{ type: "text", text: content }];
    previous.content =
      typeof left === "string" && typeof right === "string"
        ? `${left}\n\n${right}`
        : [...blocks(left), ...blocks(right)];
  }
  return projected;
}

function contentSegments(content) {
  const blocks =
    typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(blocks))
    throw new TypeError("Invalid review requirement content");
  const segments = [];
  for (const block of blocks) {
    // Blocks with provider metadata are not interchangeable with plain text.
    if (
      block?.type === "text" &&
      typeof block.text === "string" &&
      Object.keys(block).every((key) => ["type", "text"].includes(key))
    ) {
      if (typeof segments.at(-1) === "string")
        segments[segments.length - 1] += block.text;
      else segments.push(block.text);
    } else segments.push(block);
  }
  return segments;
}

function preservesContent(expected, actual, allowSuffix) {
  const required = contentSegments(expected);
  const supplied = contentSegments(actual);
  if (
    supplied.length < required.length ||
    (!allowSuffix && supplied.length !== required.length)
  )
    return false;
  return required.every((segment, index) => {
    if (
      allowSuffix &&
      index === required.length - 1 &&
      typeof segment === "string"
    ) {
      return (
        typeof supplied[index] === "string" &&
        supplied[index].startsWith(segment)
      );
    }
    return isDeepStrictEqual(segment, supplied[index]);
  });
}

function pendingCalls(messages) {
  const pending = new Set();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!pending.delete(message.tool_call_id)) {
        throw new TypeError("Review tool result has no pending call");
      }
      continue;
    }
    if (pending.size) {
      throw new TypeError("Review tool call group is incomplete");
    }
    if (message.tool_calls !== undefined) {
      if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) {
        throw new TypeError("Invalid review tool calls");
      }
      // Provider IDs are scoped to a tool batch, matching agentLoop. A fully
      // settled later batch may reuse an ID without making its result orphaned.
      const seen = new Set();
      for (const call of message.tool_calls) {
        if (typeof call?.id !== "string" || !call.id || seen.has(call.id)) {
          throw new TypeError("Review tool call IDs must be unique strings");
        }
        seen.add(call.id);
        pending.add(call.id);
      }
    }
  }
  return pending;
}

/**
 * Request-only context for one independent review within the existing loop.
 * The caller supplies pristine host-built task messages before compaction;
 * unmarked system messages must already be trusted host instructions.
 * This journal neither replaces durable history nor grants any authority.
 */
export class CodingChangeReviewContext {
  #initial;
  #journal = [];
  #active = false;

  constructor(initialMessages) {
    // Validate the entire input without invoking accessors before inspecting it.
    const validated = snapshot({ messages: initialMessages }).messages;
    if (!Array.isArray(validated)) {
      throw new TypeError("Review context requires initial task messages");
    }
    this.#initial = [];
    for (const message of initialMessages) {
      const copy = snapshot(message);
      if (isRuntimeOnlySessionMessage(message)) continue;
      const provenance = getDurableSystemMessageProvenance(message);
      if (provenance) {
        if (provenance.kind === DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE) {
          continue;
        }
        throw new TypeError(
          "Review requires original requirements before summarization",
        );
      }
      if (Object.hasOwn(message, SESSION_MESSAGE_PROVENANCE_FIELD)) {
        throw new TypeError(
          "Review context cannot trust serialized provenance",
        );
      }
      if (!["system", "user"].includes(copy.role)) continue;
      if (!hasContent(copy) || copy.tool_calls || copy.tool_call_id) {
        throw new TypeError("Review requirements must have valid content");
      }
      this.#initial.push(copy);
    }
    if (!this.#initial.some((message) => message.role === "user")) {
      throw new TypeError("Review requires original user requirements");
    }
  }

  get active() {
    return this.#active;
  }

  activate(reviewPromptMessage) {
    if (this.#active) return false;
    const prompt = snapshot(reviewPromptMessage);
    if (
      prompt.role !== "user" ||
      !hasContent(prompt) ||
      prompt.tool_calls ||
      prompt.tool_call_id
    ) {
      throw new TypeError("Review prompt must be a user-role instruction");
    }
    this.#journal = [prompt];
    this.#active = true;
    return true;
  }

  record(...messages) {
    if (!this.#active) return;
    const copies = messages.map((message) => {
      const copy = snapshot(message);
      if (
        !["assistant", "tool"].includes(copy.role) &&
        !(copy.role === "user" && isRuntimeOnlySessionMessage(message))
      ) {
        throw new TypeError(
          "Review journal accepts only review responses and runtime nudges",
        );
      }
      return copy;
    });
    const next = [...this.#journal, ...copies];
    pendingCalls(next);
    this.#journal = next;
  }

  /** Fail closed if request normalization or context planning dropped scope. */
  assertRequirementsPreserved(projectedMessages) {
    if (!this.#active) throw new TypeError("Review context is not active");
    const supplied = snapshot({ messages: projectedMessages }).messages;
    if (!Array.isArray(supplied))
      throw new TypeError("Invalid review provider messages");
    const required = mergeAdjacentUsers(this.#initial.map(snapshot));
    for (let index = 0; index < required.length; index++) {
      const expected = required[index];
      const actual = supplied[index];
      if (
        !actual ||
        actual.role !== expected.role ||
        !preservesContent(
          expected.content,
          actual.content,
          expected.role === "user",
        )
      ) {
        throw new TypeError(
          "Review provider context did not preserve original requirements",
        );
      }
    }
    return true;
  }

  project() {
    if (!this.#active) throw new TypeError("Review context is not active");
    if (pendingCalls(this.#journal).size) {
      throw new TypeError("Review tool call group is incomplete");
    }
    return mergeAdjacentUsers(
      [...this.#initial, ...this.#journal].map(snapshot),
    );
  }
}
