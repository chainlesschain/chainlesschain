/**
 * Panel `/rewind` (checkpoint restore) — Claude-Code parity for rolling the
 * work tree back to an agent auto-checkpoint. Rather than re-implement the
 * shadow-commit engine in the extension, this defers to the CLI's source of
 * truth — `cc checkpoint list|restore` — scoped to THIS panel's session
 * (mirroring how /cost and /sessions defer to the CLI). Pure Node;
 * `deps.execFile` is injectable. chat-view.js drives the QuickPick around it.
 */
const { execFile } = require("child_process");
const { hardenedEnv } = require("../hardened-env");

const TIMELINE_SCHEMA = "cc-checkpoint-timeline/v1";
const TIMELINE_VERSION = 1;
const TIMELINE_ACTION_SCHEMA = "cc-checkpoint-timeline-action/v1";
const TIMELINE_ACTION_VERSION = 1;
const TIMELINE_RESULT_SCHEMA = "cc-checkpoint-timeline-result/v1";
const TIMELINE_RESULT_VERSION = 1;
const TIMELINE_COVERAGES = new Set(["full", "partial", "none"]);
const TIMELINE_MARKERS = new Set([
  "checkpoint",
  "commit",
  "tool-side-effect",
  "artifact",
  "verification",
]);
const TIMELINE_ACTIONS = new Set([
  "restore-code",
  "restore-conversation",
  "restore-both",
  "summary-from",
  "summary-to",
  "branch",
]);
const MAX_TIMELINE_ENTRIES = 1000;
const MAX_TIMELINE_LIST = 256;

/** `cc checkpoint list -s <session> --json` — newest-first snapshots. */
function buildListArgs(sessionId) {
  return ["checkpoint", "list", "-s", String(sessionId || "default"), "--json"];
}

/**
 * `cc checkpoint restore <id> -s <session> --force --json` — auto-snapshots
 * the current state first, then restores. `--force` skips the CLI's own
 * interactive confirm because the panel confirms via its QuickPick selection.
 */
function buildRestoreArgs(sessionId, id) {
  return [
    "checkpoint",
    "restore",
    String(id || ""),
    "-s",
    String(sessionId || "default"),
    "--force",
    "--json",
  ];
}

/**
 * `cc checkpoint show <id> --diff -s <session> --json` — the checkpoint's diff
 * vs the current work tree, for a PREVIEW before restoring. Full patch (not
 * --stat) so it opens as a readable diff in an editor tab.
 */
function buildShowDiffArgs(sessionId, id) {
  return [
    "checkpoint",
    "show",
    String(id || ""),
    "--diff",
    "-s",
    String(sessionId || "default"),
    "--json",
  ];
}

/** Canonical read-only projection; the CLI remains the only state authority. */
function buildTimelineArgs(sessionId) {
  return [
    "checkpoint",
    "timeline",
    "-s",
    String(sessionId || "default"),
    "--json",
  ];
}

function boundedStrings(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const value of values.slice(0, MAX_TIMELINE_LIST)) {
    if (typeof value !== "string" || !value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function validTimelineSubmission(submission, root, turnId, action) {
  if (
    !submission ||
    typeof submission !== "object" ||
    Array.isArray(submission) ||
    submission.schema !== TIMELINE_ACTION_SCHEMA ||
    submission.version !== TIMELINE_ACTION_VERSION ||
    submission.authority !== "cli" ||
    submission.revision !== root.revision ||
    submission.action !== action ||
    submission.sessionId !== root.sessionId ||
    submission.turnId !== turnId
  ) {
    return null;
  }
  if (
    submission.checkpointId !== null &&
    typeof submission.checkpointId !== "string"
  ) {
    return null;
  }
  const needsCheckpointIdentity =
    action === "restore-code" || action === "restore-both";
  if (
    (needsCheckpointIdentity &&
      typeof submission.checkpointIdentity !== "string") ||
    (submission.checkpointIdentity !== undefined &&
      submission.checkpointIdentity !== null &&
      (typeof submission.checkpointIdentity !== "string" ||
        !/^(?:git:(?:[a-f0-9]{40}|[a-f0-9]{64})|sha256:[a-f0-9]{64})$/.test(
          submission.checkpointIdentity,
        )))
  ) {
    return null;
  }
  if (
    submission.conversationOffset !== null &&
    (!Number.isSafeInteger(submission.conversationOffset) ||
      submission.conversationOffset < 0)
  ) {
    return null;
  }
  return JSON.parse(JSON.stringify(submission));
}

/**
 * Parse the versioned CLI projection fail-closed. Availability is never
 * recomputed in the IDE: only CLI-enabled actions with an exact embedded
 * submission envelope survive.
 */
function parseTimelineProjection(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.schema !== TIMELINE_SCHEMA ||
    data.version !== TIMELINE_VERSION ||
    data.authority !== "cli" ||
    data.actionSchema !== TIMELINE_ACTION_SCHEMA ||
    typeof data.sessionId !== "string" ||
    !data.sessionId ||
    typeof data.revision !== "string" ||
    !data.revision ||
    !Array.isArray(data.entries) ||
    data.entries.length > MAX_TIMELINE_ENTRIES
  ) {
    return null;
  }

  const entries = [];
  for (const source of data.entries) {
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      typeof source.turnId !== "string" ||
      !source.turnId ||
      !TIMELINE_COVERAGES.has(source.coverage) ||
      !Array.isArray(source.markers) ||
      !Array.isArray(source.actions)
    ) {
      return null;
    }
    const markers = source.markers
      .slice(0, MAX_TIMELINE_LIST)
      .filter(
        (marker) =>
          marker &&
          typeof marker === "object" &&
          TIMELINE_MARKERS.has(marker.kind),
      )
      .map((marker) => ({ kind: marker.kind }));
    const actions = [];
    for (const candidate of source.actions.slice(0, MAX_TIMELINE_LIST)) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        !TIMELINE_ACTIONS.has(candidate.action)
      ) {
        continue;
      }
      const submission =
        candidate.enabled === true
          ? validTimelineSubmission(
              candidate.submission,
              data,
              source.turnId,
              candidate.action,
            )
          : null;
      actions.push({
        action: candidate.action,
        enabled: candidate.enabled === true && submission !== null,
        submission,
      });
    }
    entries.push({
      turnId: source.turnId,
      coverage: source.coverage,
      markers,
      actions,
      excludedPaths: boundedStrings(source.excludedPaths),
      irreversibleSideEffects: boundedStrings(source.irreversibleSideEffects),
    });
  }
  return {
    schema: TIMELINE_SCHEMA,
    version: TIMELINE_VERSION,
    authority: "cli",
    actionSchema: TIMELINE_ACTION_SCHEMA,
    sessionId: data.sessionId,
    revision: data.revision,
    entries,
  };
}

/** Small host projection used by both IDE conformance tests and renderers. */
function projectTimeline(data) {
  const timeline = parseTimelineProjection(data);
  if (!timeline) return null;
  return {
    sessionId: timeline.sessionId,
    revision: timeline.revision,
    entries: timeline.entries.map((entry) => ({
      turnId: entry.turnId,
      coverage: entry.coverage,
      markerKinds: entry.markers.map((marker) => marker.kind),
      enabledActions: entry.actions
        .filter((action) => action.enabled)
        .map((action) => action.action),
      excludedPaths: entry.excludedPaths,
      irreversibleSideEffects: entry.irreversibleSideEffects,
    })),
  };
}

/** Return the CLI-authored envelope verbatim; never synthesize an IDE action. */
function timelineActionSubmission(data, turnId, action) {
  const timeline = parseTimelineProjection(data);
  if (!timeline) return null;
  const entry = timeline.entries.find((row) => row.turnId === turnId);
  const candidate = entry?.actions.find((row) => row.action === action);
  return candidate?.enabled && candidate.submission
    ? JSON.parse(JSON.stringify(candidate.submission))
    : null;
}

/** Serialize an exact CLI-authored envelope; no authority fields are added. */
function buildTimelineActionArgs(submission, { preview, confirm } = {}) {
  if (
    !submission ||
    typeof submission !== "object" ||
    Array.isArray(submission) ||
    typeof submission.sessionId !== "string" ||
    preview === confirm
  ) {
    return [];
  }
  return [
    "checkpoint",
    "action",
    "-s",
    submission.sessionId,
    "--submission",
    JSON.stringify(submission),
    preview ? "--preview" : "--confirm",
    "--json",
  ];
}

const ACTION_LABELS = Object.freeze({
  "restore-code": "Restore code",
  "restore-conversation": "Restore conversation",
  "restore-both": "Restore code + conversation",
  "summary-from": "Summarize from here",
  "summary-to": "Summarize up to here",
  branch: "Branch from here",
});

/** Native QuickPick row for one canonical turn. */
function toTimelineQuickPickItem(entry) {
  const markerKinds = (entry?.markers || []).map((marker) => marker.kind);
  const excluded = entry?.excludedPaths || [];
  const irreversible = entry?.irreversibleSideEffects || [];
  return {
    turnId: entry?.turnId,
    label: `${entry?.coverage || "none"}  ${entry?.turnId || "?"}`,
    description: markerKinds.join(" · ") || "no markers",
    detail:
      [
        excluded.length ? `excluded: ${excluded.join(", ")}` : "",
        irreversible.length ? `irreversible: ${irreversible.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("  ·  ") || undefined,
  };
}

/** Action rows come only from CLI-enabled entries and carry their envelope. */
function timelineActionItems(entry) {
  return (entry?.actions || [])
    .filter((candidate) => candidate.enabled && candidate.submission)
    .map((candidate) => ({
      action: candidate.action,
      submission: JSON.parse(JSON.stringify(candidate.submission)),
      label: ACTION_LABELS[candidate.action] || candidate.action,
      description: candidate.action,
    }));
}

function parseTimelineActionResult(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.schema !== TIMELINE_RESULT_SCHEMA ||
    data.version !== TIMELINE_RESULT_VERSION ||
    typeof data.ok !== "boolean"
  ) {
    return null;
  }
  return JSON.parse(JSON.stringify(data));
}

/** Readable preview for a document/modal; all warnings remain visible. */
function formatTimelinePreview(data) {
  const result = parseTimelineActionResult(data);
  if (!result || !result.ok || result.mode !== "preview") return "";
  const lines = [
    `Checkpoint timeline action: ${result.action}`,
    `Turn: ${result.turnId}`,
    `Coverage: ${result.coverage}`,
    `Revision: ${result.revision}`,
  ];
  if (result.code) {
    lines.push(
      "",
      `Code checkpoint: ${result.code.checkpointId || "unavailable"}`,
      `Modified: ${(result.code.modified || []).join(", ") || "none"}`,
      `Added: ${(result.code.added || []).join(", ") || "none"}`,
      `Deleted: ${(result.code.deleted || []).join(", ") || "none"}`,
    );
  }
  if (result.conversation) {
    lines.push(
      "",
      `Conversation messages: ${result.conversation.beforeMessages} → ${result.conversation.afterMessages}`,
    );
  }
  if (result.branch) {
    lines.push("", `Branch session: ${result.branch.branchSessionId}`);
  }
  if ((result.excludedPaths || []).length) {
    lines.push("", `Excluded paths: ${result.excludedPaths.join(", ")}`);
  }
  if ((result.irreversibleSideEffects || []).length) {
    lines.push(
      "",
      `Irreversible side effects: ${result.irreversibleSideEffects.join(", ")}`,
    );
  }
  const warnings = [
    ...(result.warnings || []),
    ...(result.branch?.warnings || []),
  ];
  if (warnings.length)
    lines.push("", "Warnings:", ...warnings.map((w) => `- ${w}`));
  return lines.join("\n");
}

/**
 * Normalize a `checkpoint show --diff --json` payload into preview text. The
 * git engine returns `{ id, diff:"<patch>" }`; the copy-fallback engine has no
 * raw patch and returns a status object `{ modified, added, deleted }` — both
 * become a human-readable string. Returns "" when there's nothing to show.
 */
function formatDiffPreview(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.diff === "string") return data.diff.trim();
  const list = (label, arr) =>
    Array.isArray(arr) && arr.length
      ? `${label} (${arr.length}):\n` +
        arr
          .map((f) => `  ${typeof f === "string" ? f : f.rel || ""}`)
          .join("\n")
      : "";
  const parts = [
    list("modified", data.modified),
    list("added", data.added),
    list("deleted", data.deleted),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Run a CLI command and resolve `{ ok, data }` (stdout parsed as JSON) or
 * `{ ok:false, error }`. Never rejects — the caller renders a fallback.
 */
function runCliJson({
  command = "cc",
  args,
  cwd,
  env,
  timeoutMs = 30000,
  deps,
} = {}) {
  const run = (deps && deps.execFile) || execFile;
  return new Promise((resolve) => {
    run(
      command,
      args,
      {
        cwd,
        // Hardened so cmd.exe doesn't resolve a repo-local `cc.bat` before PATH.
        env: hardenedEnv(env),
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        // npm global shims on Windows are .cmd files — they need a shell.
        shell: process.platform === "win32",
      },
      (err, stdout, stderr) => {
        const out = String(stdout || "").trim();
        if (out) {
          try {
            return resolve({ ok: true, data: JSON.parse(out) });
          } catch {
            return resolve({ ok: false, error: out });
          }
        }
        resolve({
          ok: false,
          error: String(stderr || (err && err.message) || "no output").trim(),
        });
      },
    );
  });
}

/** A checkpoint row → a VS Code QuickPick item (carrying its id). */
function toQuickPickItem(c) {
  const files = c && c.fileCount != null ? `${c.fileCount} file(s)` : "";
  return {
    id: c && c.id,
    label: (c && c.id) || "?",
    description: [c && c.createdAt, files].filter(Boolean).join("  ·  "),
    detail: (c && c.label) || undefined,
  };
}

/** Restored-file count from a `checkpoint restore --json` payload (best-effort). */
function restoredCount(data) {
  if (!data || typeof data !== "object") return null;
  const n = data.restoredCount != null ? data.restoredCount : data.restored;
  return typeof n === "number" ? n : null;
}

module.exports = {
  TIMELINE_SCHEMA,
  TIMELINE_VERSION,
  TIMELINE_ACTION_SCHEMA,
  TIMELINE_ACTION_VERSION,
  TIMELINE_RESULT_SCHEMA,
  TIMELINE_RESULT_VERSION,
  buildListArgs,
  buildRestoreArgs,
  buildShowDiffArgs,
  buildTimelineArgs,
  parseTimelineProjection,
  projectTimeline,
  timelineActionSubmission,
  buildTimelineActionArgs,
  toTimelineQuickPickItem,
  timelineActionItems,
  parseTimelineActionResult,
  formatTimelinePreview,
  formatDiffPreview,
  runCliJson,
  toQuickPickItem,
  restoredCount,
};
