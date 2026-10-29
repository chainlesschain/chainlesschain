import { getDurableSystemMessageProvenance } from "../lib/session-message-provenance.js";
import { markCompactionHostBase } from "../lib/compaction-host-provenance.js";

export const COMPACTION_CONTEXT_REFRESH_ERROR =
  "CC_COMPACTION_CONTEXT_REFRESH_FAILED";

/** Refresh only the base system message owned by this live host. */
export function createCompactionHostContextRefresher({
  messages,
  render,
  onUpdated,
}) {
  return (candidate = messages) => {
    const current = messages[0];
    if (
      !current ||
      current.role !== "system" ||
      getDurableSystemMessageProvenance(current)
    )
      throw new Error("Live host base context is unavailable");
    if (!Array.isArray(candidate) || !candidate.includes(current))
      throw new Error(
        "Compaction candidate does not contain the live host base context",
      );
    const content = render();
    if (content && typeof content.then === "function") {
      Promise.resolve(content).catch(() => {});
      throw new TypeError("Host context rendering must be synchronous");
    }
    if (typeof content !== "string" || !content.trim())
      throw new TypeError(
        "Host context rendering must return a non-empty string",
      );
    if (messages[0] !== current)
      throw new Error("Host base context changed during rendering");
    if (content === current.content) {
      markCompactionHostBase(current);
      return candidate;
    }
    const replacement = markCompactionHostBase({ ...current, content });
    const projected = candidate.map((message) =>
      message === current ? replacement : message,
    );
    messages[0] = replacement;
    onUpdated?.(replacement);
    return candidate === messages ? messages : projected;
  };
}

/** A failed refresh must not fall through to a model with obsolete rules. */
export function refreshCompactionHostContext(refresh, messages) {
  if (refresh == null) return messages;
  try {
    if (typeof refresh !== "function")
      throw new TypeError("Invalid host context refresher");
    const result = refresh(messages);
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
      throw new TypeError("Host context refresh must be synchronous");
    }
    if (!Array.isArray(result))
      throw new TypeError("Host context refresh must return messages");
    return result;
  } catch (cause) {
    const error = new Error(
      "Current project context could not be refreshed before continuing",
      { cause },
    );
    error.code = COMPACTION_CONTEXT_REFRESH_ERROR;
    throw error;
  }
}
