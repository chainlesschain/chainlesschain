/**
 * Host-independent checkpoint / rewind timeline projection.
 *
 * The CLI owns the canonical turn bindings and every state-changing restore.
 * IDEs consume this bounded, versioned projection and submit the embedded
 * action envelope back to the CLI; they never infer coverage or synthesize a
 * broader restore locally.
 */

import { createHash } from "node:crypto";

export const CHECKPOINT_TIMELINE_SCHEMA = "cc-checkpoint-timeline/v1";
export const CHECKPOINT_TIMELINE_VERSION = 1;
export const CHECKPOINT_TIMELINE_ACTION_SCHEMA =
  "cc-checkpoint-timeline-action/v1";
export const CHECKPOINT_TIMELINE_ACTION_VERSION = 1;

export const CHECKPOINT_TIMELINE_COVERAGE = Object.freeze({
  FULL: "full",
  PARTIAL: "partial",
  NONE: "none",
});

export const CHECKPOINT_TIMELINE_MARKERS = Object.freeze({
  CHECKPOINT: "checkpoint",
  COMMIT: "commit",
  TOOL_SIDE_EFFECT: "tool-side-effect",
  ARTIFACT: "artifact",
  VERIFICATION: "verification",
});

export const CHECKPOINT_TIMELINE_ACTIONS = Object.freeze({
  RESTORE_CODE: "restore-code",
  RESTORE_CONVERSATION: "restore-conversation",
  RESTORE_BOTH: "restore-both",
  SUMMARY_FROM: "summary-from",
  SUMMARY_TO: "summary-to",
  BRANCH: "branch",
});

const MARKER_ORDER = Object.freeze(Object.values(CHECKPOINT_TIMELINE_MARKERS));
const ACTION_ORDER = Object.freeze(Object.values(CHECKPOINT_TIMELINE_ACTIONS));
const COVERAGES = new Set(Object.values(CHECKPOINT_TIMELINE_COVERAGE));
const MARKERS = new Set(MARKER_ORDER);
const MAX_TURNS = 1_000;
const MAX_MARKERS = 4_096;
const MAX_LIST_ITEMS = 256;

function boundedString(value, max = 512) {
  if (value == null) return null;
  const text = Array.from(String(value), (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? "" : character;
  })
    .join("")
    .trim();
  return text ? text.slice(0, max) : null;
}

function uniqueStrings(values, max = MAX_LIST_ITEMS) {
  const out = [];
  const seen = new Set();
  const source = Array.isArray(values) ? values.slice(0, max) : [];
  for (const value of source) {
    const text = boundedString(value, 1_024);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function jsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    return cloned && typeof cloned === "object" && !Array.isArray(cloned)
      ? cloned
      : {};
  } catch {
    return {};
  }
}

function canonicalValue(value, depth = 0) {
  if (depth > 32 || value == null) return value == null ? null : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_MARKERS)
      .map((item) => canonicalValue(item, depth + 1));
  }
  if (typeof value !== "object") return String(value);
  const out = {};
  for (const key of Object.keys(value).sort().slice(0, MAX_LIST_ITEMS)) {
    out[key] = canonicalValue(value[key], depth + 1);
  }
  return out;
}

/** Deterministic authority revision over the persisted session/checkpoint view. */
export function deriveCheckpointTimelineRevision({
  sessionId,
  turns = [],
  checkpoints = [],
  markers = [],
  headHash = null,
} = {}) {
  const sourceTurns =
    turns && typeof turns.list === "function" ? turns.list() : turns;
  const material = canonicalValue({
    sessionId: boundedString(sessionId, 256) || "default",
    headHash: boundedString(headHash, 256),
    turns: Array.isArray(sourceTurns) ? sourceTurns.slice(0, MAX_TURNS) : [],
    checkpoints: Array.isArray(checkpoints)
      ? checkpoints.slice(0, MAX_MARKERS)
      : [],
    markers: Array.isArray(markers) ? markers.slice(0, MAX_MARKERS) : [],
  });
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(material))
    .digest("hex")}`;
}

function timestampString(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 128);
  }
  if (Number.isFinite(Number(value)) && value != null) {
    try {
      return new Date(Number(value)).toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeCoverage(value) {
  return COVERAGES.has(value) ? value : CHECKPOINT_TIMELINE_COVERAGE.NONE;
}

function normalizeConversationOffset(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeCheckpointIdentity(value) {
  const identity = boundedString(value, 256);
  return /^(?:git:(?:[a-f0-9]{40}|[a-f0-9]{64})|sha256:[a-f0-9]{64})$/.test(
    identity || "",
  )
    ? identity
    : null;
}

function normalizeMarker(marker, index) {
  if (!marker || typeof marker !== "object" || !MARKERS.has(marker.kind)) {
    return null;
  }
  const turnId = boundedString(marker.turnId, 256);
  const referenceId = boundedString(
    marker.referenceId ?? marker.checkpointId ?? marker.commitId ?? marker.id,
    512,
  );
  const id =
    boundedString(marker.id, 512) ||
    `${marker.kind}:${turnId || "unbound"}:${referenceId || index}`;
  return {
    kind: marker.kind,
    id,
    turnId,
    referenceId,
    label: boundedString(marker.label, 512),
    status: boundedString(marker.status, 128) || "recorded",
    reversible:
      typeof marker.reversible === "boolean"
        ? marker.reversible
        : marker.kind === CHECKPOINT_TIMELINE_MARKERS.CHECKPOINT ||
          marker.kind === CHECKPOINT_TIMELINE_MARKERS.COMMIT ||
          marker.kind === CHECKPOINT_TIMELINE_MARKERS.VERIFICATION,
    timestamp: timestampString(marker.timestamp ?? marker.createdAt),
    metadata: jsonObject(marker.metadata),
  };
}

function checkpointMarker(checkpoint, turnId = null) {
  const id = boundedString(checkpoint?.id, 512);
  if (!id) return null;
  const metadata = {};
  if (Number.isFinite(Number(checkpoint.fileCount))) {
    metadata.fileCount = Number(checkpoint.fileCount);
  }
  const commit = boundedString(checkpoint.commit, 128);
  if (commit) metadata.commit = commit;
  const identity = normalizeCheckpointIdentity(checkpoint.identity);
  if (identity) metadata.identity = identity;
  return normalizeMarker(
    {
      kind: CHECKPOINT_TIMELINE_MARKERS.CHECKPOINT,
      id: `checkpoint:${id}`,
      turnId,
      referenceId: id,
      label: checkpoint.label || id,
      status: "available",
      reversible: true,
      timestamp: checkpoint.createdAt,
      metadata,
    },
    0,
  );
}

function markerSort(left, right) {
  const kind =
    MARKER_ORDER.indexOf(left.kind) - MARKER_ORDER.indexOf(right.kind);
  if (kind !== 0) return kind;
  const timestamp = String(left.timestamp || "").localeCompare(
    String(right.timestamp || ""),
  );
  if (timestamp !== 0) return timestamp;
  return left.id.localeCompare(right.id);
}

function dedupeMarkers(markers) {
  const out = [];
  const seen = new Set();
  for (const marker of markers.sort(markerSort)) {
    const key = `${marker.kind}\u0000${marker.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(marker);
  }
  return out;
}

function actionAvailability(
  action,
  hasCheckpoint,
  hasCheckpointIdentity,
  hasConversation,
) {
  if (action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_CODE) {
    if (!hasCheckpoint) {
      return { enabled: false, reason: "checkpoint-unavailable" };
    }
    return hasCheckpointIdentity
      ? { enabled: true, reason: null }
      : { enabled: false, reason: "checkpoint-identity-unavailable" };
  }
  if (action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_BOTH) {
    if (!hasCheckpoint || !hasConversation) {
      return {
        enabled: false,
        reason: "checkpoint-and-conversation-required",
      };
    }
    return hasCheckpointIdentity
      ? { enabled: true, reason: null }
      : { enabled: false, reason: "checkpoint-identity-unavailable" };
  }
  return hasConversation
    ? { enabled: true, reason: null }
    : { enabled: false, reason: "conversation-offset-unavailable" };
}

function buildActions({
  sessionId,
  revision,
  turnId,
  checkpointId,
  checkpointIdentity,
  conversationOffset,
}) {
  const hasCheckpoint = Boolean(checkpointId);
  const hasCheckpointIdentity = Boolean(checkpointIdentity);
  const hasConversation = conversationOffset != null;
  return ACTION_ORDER.map((action) => {
    const availability = actionAvailability(
      action,
      hasCheckpoint,
      hasCheckpointIdentity,
      hasConversation,
    );
    return {
      action,
      enabled: availability.enabled,
      reason: availability.reason,
      submission: availability.enabled
        ? {
            schema: CHECKPOINT_TIMELINE_ACTION_SCHEMA,
            version: CHECKPOINT_TIMELINE_ACTION_VERSION,
            authority: "cli",
            revision,
            action,
            sessionId,
            turnId,
            checkpointId: checkpointId || null,
            ...((action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_CODE ||
              action === CHECKPOINT_TIMELINE_ACTIONS.RESTORE_BOTH) &&
            checkpointIdentity
              ? { checkpointIdentity }
              : {}),
            conversationOffset,
          }
        : null,
    };
  });
}

function managedCheckpointMarkers(turn, turnId) {
  const markers = [];
  const checkpoints = Array.isArray(turn?.managedCheckpoints)
    ? turn.managedCheckpoints.slice(0, MAX_LIST_ITEMS)
    : [];
  for (const checkpoint of checkpoints) {
    const checkpointId = boundedString(checkpoint?.checkpointId, 512);
    if (checkpointId) {
      const marker = normalizeMarker(
        {
          kind: CHECKPOINT_TIMELINE_MARKERS.CHECKPOINT,
          id: `managed-checkpoint:${checkpointId}`,
          turnId,
          referenceId: checkpointId,
          label: checkpoint.tool || checkpointId,
          status: checkpoint.phase || "recorded",
          reversible: checkpoint.fileCoverage !== "none",
          metadata: {
            managed: true,
            transactionId: checkpoint.transactionId || null,
            evidenceDigest: checkpoint.evidenceDigest || null,
            coverage: normalizeCoverage(checkpoint.coverage),
            fileCoverage: normalizeCoverage(checkpoint.fileCoverage),
          },
        },
        markers.length,
      );
      if (marker) markers.push(marker);
    }
    if (normalizeCoverage(checkpoint?.coverage) !== "full") {
      const marker = normalizeMarker(
        {
          kind: CHECKPOINT_TIMELINE_MARKERS.TOOL_SIDE_EFFECT,
          id: `managed-side-effect:${checkpoint?.transactionId || checkpoint?.toolUseId || markers.length}`,
          turnId,
          referenceId: checkpoint?.toolUseId || checkpoint?.transactionId,
          label: checkpoint?.tool || "managed tool side effect",
          status: checkpoint?.phase || "recorded",
          reversible: false,
          metadata: {
            transactionId: checkpoint?.transactionId || null,
            coverage: normalizeCoverage(checkpoint?.coverage),
          },
        },
        markers.length,
      );
      if (marker) markers.push(marker);
    }
  }
  return markers;
}

function turnPaths(turn) {
  const values = [];
  const append = (source) => {
    for (const value of Array.isArray(source) ? source : []) {
      if (values.length >= MAX_LIST_ITEMS) return;
      values.push(value);
    }
  };
  append(turn?.excludedPaths);
  append(turn?.uncoveredPaths);
  const checkpoints = Array.isArray(turn?.managedCheckpoints)
    ? turn.managedCheckpoints.slice(0, MAX_LIST_ITEMS)
    : [];
  for (const checkpoint of checkpoints) {
    append(checkpoint?.excludedPaths);
    append(checkpoint?.exclusions);
    append(checkpoint?.uncoveredPaths);
    if (values.length >= MAX_LIST_ITEMS) break;
  }
  return uniqueStrings(values);
}

function turnIrreversibleEffects(turn, coverage, markers) {
  const values = Array.isArray(turn?.irreversibleSideEffects)
    ? turn.irreversibleSideEffects.slice(0, MAX_LIST_ITEMS)
    : [];
  for (const marker of markers) {
    if (
      (marker.kind === CHECKPOINT_TIMELINE_MARKERS.TOOL_SIDE_EFFECT ||
        marker.kind === CHECKPOINT_TIMELINE_MARKERS.ARTIFACT) &&
      marker.reversible === false
    ) {
      values.push(marker.label || marker.referenceId || marker.id);
    }
  }
  if (
    coverage === CHECKPOINT_TIMELINE_COVERAGE.PARTIAL &&
    values.length === 0
  ) {
    values.push("untracked-external-side-effect");
  }
  if (coverage === CHECKPOINT_TIMELINE_COVERAGE.NONE && values.length === 0) {
    values.push("unrestorable-workspace-side-effect");
  }
  return uniqueStrings(values);
}

function warningCodes(coverage, excludedPaths, irreversibleSideEffects) {
  const warnings = [];
  if (coverage === CHECKPOINT_TIMELINE_COVERAGE.PARTIAL) {
    warnings.push("partial-coverage");
  } else if (coverage === CHECKPOINT_TIMELINE_COVERAGE.NONE) {
    warnings.push("no-restore-coverage");
  }
  if (excludedPaths.length > 0) warnings.push("excluded-paths");
  if (irreversibleSideEffects.length > 0) {
    warnings.push("irreversible-side-effects");
  }
  return warnings;
}

/**
 * Build the canonical projection from a turn-binding log (or turn array), file
 * checkpoint rows, and optional marker records produced by other CLI systems.
 */
export function buildCheckpointTimeline({
  sessionId,
  turns = [],
  checkpoints = [],
  markers = [],
  revision = null,
  headHash = null,
} = {}) {
  const normalizedSessionId = boundedString(sessionId, 256) || "default";
  const sourceTurns =
    turns && typeof turns.list === "function" ? turns.list() : turns;
  const turnList = (Array.isArray(sourceTurns) ? sourceTurns : [])
    .filter((turn) => turn && turn.turnId != null)
    .slice(0, MAX_TURNS);
  const checkpointSource = (
    Array.isArray(checkpoints) ? checkpoints : []
  ).filter((checkpoint) => boundedString(checkpoint?.id, 512));
  const checkpointList = checkpointSource.slice(0, MAX_MARKERS);
  const referencedCheckpointIds = new Set(
    turnList
      .map((turn) => boundedString(turn?.fileCheckpointId, 512))
      .filter(Boolean),
  );
  const checkpointById = new Map();
  // Keep the bounded projection, but also retain the exact rows referenced by
  // the bounded turn list. Manual checkpoint history is intentionally
  // unbounded, so a referenced target can sit beyond MAX_MARKERS and still
  // needs its immutable identity embedded in the action envelope.
  for (let index = 0; index < checkpointSource.length; index += 1) {
    const checkpoint = checkpointSource[index];
    const checkpointId = String(checkpoint.id);
    if (
      !checkpointById.has(checkpointId) &&
      (index < MAX_MARKERS || referencedCheckpointIds.has(checkpointId))
    ) {
      checkpointById.set(checkpointId, checkpoint);
    }
  }
  const usedCheckpointIds = new Set();

  const normalizedMarkers = (Array.isArray(markers) ? markers : [])
    .slice(0, MAX_MARKERS)
    .map((marker, index) => normalizeMarker(marker, index))
    .filter(Boolean);
  const timelineRevision =
    boundedString(revision, 256) ||
    deriveCheckpointTimelineRevision({
      sessionId: normalizedSessionId,
      turns: turnList,
      checkpoints: checkpointList,
      markers: normalizedMarkers,
      headHash,
    });
  const markerByTurn = new Map();
  const unboundMarkers = [];
  for (const marker of normalizedMarkers) {
    if (!marker.turnId) {
      unboundMarkers.push(marker);
      continue;
    }
    if (!markerByTurn.has(marker.turnId)) markerByTurn.set(marker.turnId, []);
    markerByTurn.get(marker.turnId).push(marker);
  }

  const entries = turnList.map((turn, ordinal) => {
    const turnId = boundedString(turn.turnId, 256);
    const conversationOffset = normalizeConversationOffset(
      turn.conversationOffset,
    );
    const checkpointId = boundedString(turn.fileCheckpointId, 512);
    const checkpointIdentity = normalizeCheckpointIdentity(
      checkpointById.get(checkpointId)?.identity,
    );
    const coverage = normalizeCoverage(turn.coverage);
    const turnMarkers = [...(markerByTurn.get(turnId) || [])];
    if (checkpointId) {
      usedCheckpointIds.add(checkpointId);
      const marker = checkpointMarker(
        checkpointById.get(checkpointId) || { id: checkpointId },
        turnId,
      );
      if (marker) turnMarkers.push(marker);
    }
    turnMarkers.push(...managedCheckpointMarkers(turn, turnId));
    if (
      coverage !== CHECKPOINT_TIMELINE_COVERAGE.FULL &&
      !turnMarkers.some(
        (marker) =>
          marker.kind === CHECKPOINT_TIMELINE_MARKERS.TOOL_SIDE_EFFECT,
      )
    ) {
      const marker = normalizeMarker(
        {
          kind: CHECKPOINT_TIMELINE_MARKERS.TOOL_SIDE_EFFECT,
          id: `coverage-side-effect:${turnId}`,
          turnId,
          label:
            coverage === CHECKPOINT_TIMELINE_COVERAGE.NONE
              ? "workspace mutation without a restorable checkpoint"
              : "irreversible or excluded side effect",
          status: "unverified",
          reversible: false,
          metadata: { synthesizedFromCoverage: true },
        },
        turnMarkers.length,
      );
      if (marker) turnMarkers.push(marker);
    }
    const orderedMarkers = dedupeMarkers(turnMarkers);
    const excludedPaths = turnPaths(turn);
    const irreversibleSideEffects = turnIrreversibleEffects(
      turn,
      coverage,
      orderedMarkers,
    );
    return {
      turnId,
      ordinal,
      conversationOffset,
      coverage,
      excludedPaths,
      irreversibleSideEffects,
      warnings: warningCodes(coverage, excludedPaths, irreversibleSideEffects),
      markers: orderedMarkers,
      actions: buildActions({
        sessionId: normalizedSessionId,
        revision: timelineRevision,
        turnId,
        checkpointId,
        checkpointIdentity,
        conversationOffset,
      }),
    };
  });

  const knownTurnIds = new Set(entries.map((entry) => entry.turnId));
  for (const [turnId, turnMarkers] of markerByTurn) {
    if (!knownTurnIds.has(turnId)) unboundMarkers.push(...turnMarkers);
  }
  for (const checkpoint of checkpointList) {
    const checkpointId = String(checkpoint.id);
    if (usedCheckpointIds.has(checkpointId)) continue;
    const marker = checkpointMarker(checkpoint);
    if (marker) unboundMarkers.push(marker);
  }

  return {
    schema: CHECKPOINT_TIMELINE_SCHEMA,
    version: CHECKPOINT_TIMELINE_VERSION,
    authority: "cli",
    actionSchema: CHECKPOINT_TIMELINE_ACTION_SCHEMA,
    sessionId: normalizedSessionId,
    revision: timelineRevision,
    entries,
    unboundMarkers: dedupeMarkers(unboundMarkers).slice(0, MAX_MARKERS),
  };
}

/** Fail-closed lookup used by hosts before they submit an embedded action. */
export function resolveCheckpointTimelineAction(timeline, turnId, action) {
  if (
    !timeline ||
    timeline.schema !== CHECKPOINT_TIMELINE_SCHEMA ||
    timeline.version !== CHECKPOINT_TIMELINE_VERSION ||
    timeline.authority !== "cli" ||
    timeline.actionSchema !== CHECKPOINT_TIMELINE_ACTION_SCHEMA ||
    typeof timeline.revision !== "string" ||
    !timeline.revision
  ) {
    return { ok: false, code: "TIMELINE_SCHEMA_UNSUPPORTED" };
  }
  const entry = (timeline.entries || []).find(
    (candidate) => candidate?.turnId === String(turnId),
  );
  if (!entry) return { ok: false, code: "TIMELINE_TURN_NOT_FOUND" };
  const projected = (entry.actions || []).find(
    (candidate) => candidate?.action === action,
  );
  if (!projected) return { ok: false, code: "TIMELINE_ACTION_UNKNOWN" };
  if (projected.enabled !== true || !projected.submission) {
    return {
      ok: false,
      code: "TIMELINE_ACTION_UNAVAILABLE",
      reason: projected.reason || null,
    };
  }
  if (projected.submission.revision !== timeline.revision) {
    return { ok: false, code: "TIMELINE_SUBMISSION_REVISION_INVALID" };
  }
  return {
    ok: true,
    submission: JSON.parse(JSON.stringify(projected.submission)),
  };
}

/** Small cross-host comparison projection used by shared conformance fixtures. */
export function projectCheckpointTimeline(timeline) {
  return {
    sessionId: timeline?.sessionId || null,
    revision: timeline?.revision || null,
    entries: (timeline?.entries || []).map((entry) => ({
      turnId: entry.turnId,
      coverage: entry.coverage,
      markerKinds: (entry.markers || []).map((marker) => marker.kind),
      enabledActions: (entry.actions || [])
        .filter((action) => action.enabled === true)
        .map((action) => action.action),
      excludedPaths: [...(entry.excludedPaths || [])],
      irreversibleSideEffects: [...(entry.irreversibleSideEffects || [])],
    })),
  };
}
