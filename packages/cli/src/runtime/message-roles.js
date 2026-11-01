import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "@chainlesschain/context-memory-kernel";

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
 * Roles that may be folded together. ONLY `user` and `assistant` — a `tool`
 * message carries a `tool_call_id` that must stay paired with its originating
 * `assistant` tool-call, so consecutive tool results (a multi-tool turn) must
 * NEVER merge; `system` turns (base prompt + injected context) stay distinct.
 */
const MERGEABLE_ROLES = new Set(["user", "assistant"]);

/**
 * Does this message carry tool calls? An assistant turn with `tool_calls` is a
 * STRUCTURED turn whose calls must stay paired with their `tool` results —
 * folding it loses one side's tool_calls (orphaning results / unanswered calls)
 * and the strict-API 400s. Such turns are never merged (left to alternate; the
 * tool-pair fix lives in sanitizeToolPairs, not here).
 */
function hasToolCalls(msg) {
  return Array.isArray(msg && msg.tool_calls) && msg.tool_calls.length > 0;
}

/**
 * Merge consecutive same-role messages so the conversation alternates roles for
 * the provider. Only `user`/`assistant` turns fold; `tool` and `system` turns
 * are passed through untouched and never participate in a merge. Falsy /
 * role-less entries are passed through verbatim rather than dropped.
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
      MERGEABLE_ROLES.has(msg.role) &&
      prev.role === msg.role &&
      !hasToolCalls(prev) && // never fold a structured tool-call turn — merging
      !hasToolCalls(msg) //     drops one side's tool_calls and breaks pairing
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

/**
 * Capture only the adjacent plain-role pairs present at resume. Reapply their
 * provider normalization on later requests without mutating canonical history
 * or folding newly added interrupt/feedback turns. Canonical fingerprints also
 * recognize the same retained messages after compaction recreates objects.
 */
const RESUME_ROLE_PROJECTIONS = new WeakMap();

export function createResumeRoleProjection(messages) {
  const pairs = new Map();
  const pairKey = (left, right) => canonicalJson([left, right]);
  for (let index = 1; index < messages.length; index++) {
    const left = messages[index - 1];
    const right = messages[index];
    if (
      left &&
      right &&
      MERGEABLE_ROLES.has(left.role) &&
      left.role === right.role &&
      !hasToolCalls(left) &&
      !hasToolCalls(right)
    ) {
      const key = pairKey(left, right);
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  const project = (requestMessages) => {
    const remaining = new Map(pairs);
    const projected = [];
    const sources = [];
    for (let index = 0; index < requestMessages.length; index++) {
      const message = requestMessages[index];
      const key =
        index > 0 ? pairKey(requestMessages[index - 1], message) : null;
      if (key && remaining.get(key) > 0) {
        const previous = projected.pop();
        const previousSources = sources.pop();
        projected.push(...mergeConsecutiveMessages([previous, message]));
        sources.push([...previousSources, index]);
        remaining.set(key, remaining.get(key) - 1);
      } else {
        projected.push(message);
        sources.push([index]);
      }
    }
    return { messages: projected, sources };
  };
  const projection = (requestMessages) => project(requestMessages).messages;
  RESUME_ROLE_PROJECTIONS.set(projection, project);
  return projection;
}

/** Capture the original user sources needed by an owned resume merge. */
export function getTaskCompactionBindings(projection, input, taskBinding) {
  if (!taskBinding) return [];
  const owned = RESUME_ROLE_PROJECTIONS.get(projection);
  const capture = (binding) => ({
    ...binding,
    matchCount: input.filter((message) =>
      isDeepStrictEqual(message, binding.message),
    ).length,
  });
  if (!owned) return [capture(taskBinding)];
  const sourceIndex = input.indexOf(taskBinding.original);
  const group = owned(input).sources.find((indices) =>
    indices.includes(sourceIndex),
  );
  return (group || [sourceIndex]).map((index) => {
    if (index === sourceIndex) return capture(taskBinding);
    const original = input[index];
    return capture({
      original,
      message: JSON.parse(canonicalJson(original)),
      allowContentRelocation:
        input.filter((message) => isDeepStrictEqual(message, original))
          .length === 1,
    });
  });
}

/**
 * Preserve a bound task through this module's exact, captured resume merges.
 * Arbitrary callbacks, wrappers and forged properties never receive lineage.
 */
export function projectMessagesWithTaskBinding(projection, input, taskBinding) {
  const owned = RESUME_ROLE_PROJECTIONS.get(projection);
  if (!owned) {
    return { messages: projection(input), taskBinding };
  }
  const projected = owned(input);
  if (!taskBinding) return { messages: projected.messages, taskBinding };
  const identities = input.flatMap((message, index) =>
    message === taskBinding.original ? [index] : [],
  );
  const candidates = identities.length
    ? identities
    : taskBinding.allowContentRelocation === true
      ? input.map((_, index) => index)
      : [];
  const matches = candidates.filter(
    (index) =>
      input[index]?.role === "user" &&
      isDeepStrictEqual(input[index], taskBinding.message),
  );
  // Leave invalid bindings intact so canonical admission rejects them normally.
  if (matches.length !== 1 || identities.length > 1)
    return { messages: projected.messages, taskBinding };
  const sourceIndex = matches[0];
  const targetIndex = projected.sources.findIndex((group) =>
    group.includes(sourceIndex),
  );
  const target = projected.messages[targetIndex];
  if (target === input[sourceIndex])
    return { messages: projected.messages, taskBinding };
  // A merge may discard right-message metadata. Only bare user content has a
  // complete preservation proof under the established joinContent contract.
  if (
    Object.keys(taskBinding.message).some(
      (key) => !["role", "content"].includes(key),
    )
  )
    return { messages: projected.messages, taskBinding };
  return {
    messages: projected.messages,
    taskBinding: {
      message: JSON.parse(canonicalJson(target)),
      original: target,
      allowContentRelocation: false,
    },
  };
}

/**
 * In-place variant: collapse consecutive mergeable-role turns by mutating the
 * given array (same reference is kept, so closures over it stay valid). Used by
 * the interactive REPL, whose `messages` array is the persistent conversation
 * and is handed straight to a mutating `coreAgentLoop` — collapsing a copy would
 * leave the degenerate pair in the persistent history and re-break later turns.
 * Only fire it on a still tool-free transcript (the first turn after a
 * degenerate resume); see callers.
 *
 * @param {Array<object>} messages
 * @returns {boolean} whether anything was collapsed
 */
export function collapseConsecutiveMessagesInPlace(messages) {
  if (!Array.isArray(messages)) return false;
  const merged = mergeConsecutiveMessages(messages);
  if (merged.length === messages.length) return false;
  messages.splice(0, messages.length, ...merged);
  return true;
}

export const _internal = { toBlocks, joinContent, MERGEABLE_ROLES };
