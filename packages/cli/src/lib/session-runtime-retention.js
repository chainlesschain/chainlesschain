/** Bounded live-state retention for long-running agent conversations. */

import { createHash } from "node:crypto";

export const SESSION_RUNTIME_RETENTION_LIMITS = Object.freeze({
  recentResults: 32,
  retainedResultChars: 512,
  markerHeadChars: 128,
  markerTailChars: 128,
});

export const SESSION_RUNTIME_RELEASE_MARKER = "…[live result released:";
const BACKGROUND_RESULT_PREFIX = '[Background sub-agent "';

function normalizedLimit(value, fallback, minimum = 0) {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.floor(value))
    : fallback;
}

function resultContent(message) {
  if (!message || typeof message.content !== "string") return null;
  if (message.role === "tool") return message.content;
  if (
    message.role === "user" &&
    message.content.startsWith(BACKGROUND_RESULT_PREFIX)
  ) {
    return message.content;
  }
  return null;
}

// V8 may represent `slice()` as a view that keeps the entire source string's
// backing store alive. Joining individual UTF-16 code units forces a small,
// independent flat string while preserving even unpaired surrogate units.
function detachedSlice(content, start, end) {
  const length = Math.max(0, end - start);
  const units = new Array(length);
  for (let index = 0; index < length; index += 1) {
    units[index] = content.charAt(start + index);
  }
  return units.join("");
}

function releaseProjection(content, options) {
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  const marker =
    `${SESSION_RUNTIME_RELEASE_MARKER} ${content.length} chars; sha256:${digest}; ` +
    "full evidence remains in the durable transcript]";
  const maxChars = options.retainedResultChars;
  if (marker.length >= maxChars) {
    return { content: marker.slice(0, maxChars), digest };
  }
  const remaining = maxChars - marker.length - 2;
  const headChars = Math.min(
    options.markerHeadChars,
    Math.max(0, Math.floor(remaining / 2)),
  );
  const tailChars = Math.min(
    options.markerTailChars,
    Math.max(0, remaining - headChars),
  );
  const head = detachedSlice(content, 0, headChars);
  const tail =
    tailChars > 0
      ? detachedSlice(content, content.length - tailChars, content.length)
      : "";
  return {
    content: `${head}\n${marker}\n${tail}`.slice(0, maxChars),
    digest,
  };
}

/**
 * Replace old live tool/subagent result bodies with a bounded head/tail,
 * digest, and durable-transcript locator. The message and pairing structure is
 * retained; only old result content is released. The returned array is new and
 * the input is never mutated.
 */
export function releaseOldLiveSessionResults(messages, configured = {}) {
  if (!Array.isArray(messages)) {
    return {
      messages,
      stats: {
        strategy: "session-runtime-retention",
        released: 0,
        savedChars: 0,
        recentResults: 0,
        durableReferences: [],
      },
    };
  }
  const options = {
    recentResults: normalizedLimit(
      configured.recentResults,
      SESSION_RUNTIME_RETENTION_LIMITS.recentResults,
    ),
    retainedResultChars: normalizedLimit(
      configured.retainedResultChars,
      SESSION_RUNTIME_RETENTION_LIMITS.retainedResultChars,
      256,
    ),
    markerHeadChars: normalizedLimit(
      configured.markerHeadChars,
      SESSION_RUNTIME_RETENTION_LIMITS.markerHeadChars,
    ),
    markerTailChars: normalizedLimit(
      configured.markerTailChars,
      SESSION_RUNTIME_RETENTION_LIMITS.markerTailChars,
    ),
  };
  const resultIndexes = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (resultContent(messages[index]) != null) resultIndexes.push(index);
  }
  const releaseCount = Math.max(
    0,
    resultIndexes.length - options.recentResults,
  );
  const releaseIndexes = new Set(resultIndexes.slice(0, releaseCount));
  let released = 0;
  let savedChars = 0;
  const durableReferences = [];
  const output = messages.map((message, index) => {
    if (!releaseIndexes.has(index)) return message;
    const content = resultContent(message);
    if (content.length <= options.retainedResultChars) {
      return message;
    }
    const projection = releaseProjection(content, options);
    released += 1;
    savedChars += content.length - projection.content.length;
    durableReferences.push({
      messageIndex: index,
      digest: `sha256:${projection.digest}`,
      originalChars: content.length,
      retainedChars: projection.content.length,
    });
    return { ...message, content: projection.content };
  });
  return {
    messages: output,
    stats: {
      strategy: "session-runtime-retention",
      released,
      savedChars,
      saved: savedChars,
      recentResults: Math.min(options.recentResults, resultIndexes.length),
      retainedResultChars: options.retainedResultChars,
      originalMessages: messages.length,
      compressedMessages: output.length,
      durableReferences,
    },
  };
}
