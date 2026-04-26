/**
 * Pure helpers for the worktree-review subsystem in AIChatPage.vue.
 * All inputs are primitives or plain objects; no Vue reactivity.
 *
 * The two predicates that previously lived alongside these helpers
 * (isWorktreePreviewRouteLoading / isWorktreeAutomationCandidateLoading)
 * stay in the SFC because they read reactive refs (worktreePreviewLoading,
 * worktreePreviewLoadingKey, codingAgentStore.worktreeLoading,
 * worktreeAutomationLoadingKey).
 */

export const formatWorktreePreviewRoute = (preview) => {
  if (!preview) {
    return "";
  }
  if (typeof preview === "string") {
    return preview;
  }
  const parts = [];
  if (preview.type) {
    parts.push(preview.type);
  }
  if (preview.branch) {
    parts.push(preview.branch);
  }
  if (preview.filePath) {
    parts.push(preview.filePath);
  }
  return parts.join(" | ");
};

export const getWorktreePreviewRouteKey = (preview) => {
  if (!preview) {
    return "";
  }
  if (typeof preview === "string") {
    return preview;
  }
  return [
    preview.type || "",
    preview.branch || "",
    preview.filePath || "",
  ].join("::");
};

export const formatPreviewRefreshTime = (value) => {
  if (!value) {
    return "";
  }
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
};

export const resolveWorktreePreviewSourceLabel = (source) => {
  switch (source) {
    case "host-file-diff":
      return "Host exact diff";
    case "conflict-snippet":
      return "Conflict snippet";
    case "cached-diff":
      return "Cached worktree diff";
    default:
      return "Current worktree diff";
  }
};

export const getWorktreeAutomationCandidateKey = (conflict, candidate) => {
  return [conflict?.path || conflict?.filePath || "", candidate?.id || ""].join(
    "::",
  );
};

export const canExecuteWorktreeAutomationCandidate = (candidate) => {
  return candidate?.executable === true;
};

const escapeRegExp = (value) => {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Pull the unified-diff hunk for a single file out of a multi-file diff.
 * Returns "" if the diff doesn't contain the file. Path is normalized to
 * forward slashes before regex matching so Windows-style backslash paths
 * still match against the canonical `diff --git a/<path> b/<path>` header.
 */
export const extractWorktreePatchForFile = (diffText, filePath) => {
  if (!diffText || !filePath) {
    return "";
  }
  const normalizedPath = String(filePath).replace(/\\/g, "/");
  const pattern = new RegExp(
    `^diff --git a/${escapeRegExp(normalizedPath)} b/${escapeRegExp(normalizedPath)}[\\s\\S]*?(?=^diff --git |\\Z)`,
    "m",
  );
  const match = String(diffText).match(pattern);
  return match?.[0] || "";
};

/**
 * Build the payload that the preview pane consumes. Caller passes the
 * current worktree diff text explicitly (was a closed-over reactive ref
 * in the SFC) so this stays pure.
 *
 * @param {Object|string|null} preview
 * @param {Object} [options]
 * @param {string} [options.filePath]
 * @param {string} [options.snippet]
 * @param {string} [options.source]
 * @param {string} [options.title]
 * @param {string} [options.refreshedAt]  ISO timestamp
 * @param {string} [options.currentDiffPatch]  full worktree diff used as
 *                                             fallback content
 */
export const buildWorktreePreviewPayload = (preview, options = {}) => {
  const route = preview || null;
  const filePath = options.filePath || route?.filePath || null;
  const refreshedAt = options.refreshedAt || new Date().toISOString();
  const currentDiffPatch = options.currentDiffPatch || "";
  const content =
    options.snippet ||
    extractWorktreePatchForFile(currentDiffPatch, filePath) ||
    (filePath ? "" : currentDiffPatch);
  const source =
    options.source || (options.snippet ? "conflict-snippet" : "cached-diff");

  return {
    route,
    filePath,
    title:
      options.title ||
      filePath ||
      (route?.branch ? `Preview: ${route.branch}` : "Focused preview"),
    content: content || "No preview content is available for this route yet.",
    source,
    sourceLabel: resolveWorktreePreviewSourceLabel(source),
    refreshedAt,
    refreshedAtLabel: formatPreviewRefreshTime(refreshedAt),
  };
};
