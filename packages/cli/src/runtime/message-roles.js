/**
 * Conversation role sanitation shared by the headless runner and the
 * stream-json runtime.
 *
 * Providers that strictly enforce alternating roles — Anthropic, Bedrock, and
 * some OpenAI-compatible gateways — reject a payload with two consecutive
 * messages of the same non-system role ("messages: roles must alternate").
 *
 * A degenerate transcript reaches that state on `--resume` when the ORIGINAL
 * run produced NO assistant response (the model errored, the turn was
 * interrupted, or the provider was down): the persisted JSONL ends with a bare
 * `user` turn. Splicing the new resume prompt after it yields
 * `[…, {role:"user"}, {role:"user"}]` → the provider 400s and resume fails.
 *
 * `mergeConsecutiveMessages` folds adjacent same-role (non-system) turns into a
 * single message so the transcript always alternates, regardless of how it
 * degenerated. This mirrors Claude Code 2.1.187 ("Fixed --resume failing when
 * original run produced no model responses"). It is a no-op on a well-formed
 * alternating transcript, so healthy sessions are byte-for-byte unchanged.
 *
 * @module runtime/message-roles
 */

/**
 * Normalize a message `content` field to an array of content blocks. A plain
 * string becomes a single `text` block; an empty string contributes nothing;
 * an existing array is returned as-is; any other object is wrapped as a single
 * opaque block so unknown shapes survive a merge.
 * @param {*} content
 * @returns {Array}
 */
function toBlocks(content) {
  if (Array.isArray(content)) return content;
  if (content == null) return [];
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: "text", text: content }];
  }
  return [content];
}

/**
 * Join two message `content` values. When both are plain strings the result
 * stays a string (joined by a blank line) — the overwhelmingly common case, so
 * a text-only resume keeps a string payload. When either side is a multimodal
 * content array, both are normalized to block arrays and concatenated.
 * @param {*} a
 * @param {*} b
 * @returns {string|Array}
 */
function joinContent(a, b) {
  if (typeof a === "string" && typeof b === "string") {
    if (a === "") return b;
    if (b === "") return a;
    return `${a}\n\n${b}`;
  }
  return [...toBlocks(a), ...toBlocks(b)];
}

/**
 * Merge consecutive same-role, non-system messages so the conversation
 * alternates roles for the provider. System messages are passed through
 * untouched and never participate in a merge (a leading base + session-context
 * system pair stays distinct). Falsy / role-less entries are passed through
 * verbatim rather than dropped.
 *
 * Returns a NEW array; the input is not mutated.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
export function mergeConsecutiveMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  const out = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      msg &&
      typeof msg.role === "string" &&
      msg.role !== "system" &&
      prev.role === msg.role
    ) {
      out[out.length - 1] = {
        ...prev,
        content: joinContent(prev.content, msg.content),
      };
    } else {
      out.push(msg);
    }
  }
  return out;
}

export const _internal = { toBlocks, joinContent };
