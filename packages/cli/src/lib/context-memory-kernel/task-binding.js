import { isDeepStrictEqual } from "node:util";

const committedMatchCounts = new WeakMap();
export function taskBindingMatchCount(binding) {
  return committedMatchCounts.get(binding) ?? binding.matchCount ?? 1;
}
export function advanceTaskBinding(binding, messages) {
  committedMatchCounts.set(
    binding,
    messages.filter((message) => isDeepStrictEqual(message, binding.message))
      .length,
  );
}

// A compaction may recreate objects, but may never reconstruct the user's task
// from a generated summary. Only an exact, unambiguous snapshot can relocate.
export function resolveTaskBinding(messages, binding) {
  if (!binding) return null;
  const identities = messages.flatMap((message, index) =>
    message === binding.original ? [index] : [],
  );
  const matches = messages.flatMap((message, index) =>
    message?.role === "user" && isDeepStrictEqual(message, binding.message)
      ? [index]
      : [],
  );
  if (
    matches.length !== taskBindingMatchCount(binding) ||
    identities.length > 1 ||
    (identities.length === 1 && !matches.includes(identities[0])) ||
    (!identities.length &&
      (binding.allowContentRelocation !== true || matches.length !== 1))
  ) {
    const error = new Error(
      "The current user task was lost, changed or duplicated in compaction context",
    );
    error.code = "CC_AGENT_TASK_CONTEXT_LOST";
    throw error;
  }
  return { index: identities[0] ?? matches[0], message: binding.message };
}
