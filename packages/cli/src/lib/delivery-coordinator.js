/**
 * Host-neutral, resumable delivery coordinator.
 *
 * The state machine separates requesting an external effect from settling its
 * result. Restoring a snapshot with a pending effect never replays it. A host
 * must explicitly settle/adjudicate that effect, preventing duplicate fixes,
 * PR creation, merge, publication or archive operations after a crash.
 */

import crypto from "node:crypto";
import { buildEvidenceArtifact } from "./app-preview.js";
import { buildReviewReport } from "./review-pipeline.js";
import { strictAutoMergeDecision } from "./pr-automation-policy.js";
import { selectImpactedGates } from "./impacted-gate-selector.js";
import {
  assessDeliveryEvidence,
  canonicalDeliveryJson,
  createDeliveryEvidenceRecord,
} from "./delivery-evidence.js";

export const DELIVERY_FLOW_SCHEMA = "chainlesschain.delivery-flow-state";
export const DELIVERY_FLOW_VERSION = 1;
export const DELIVERY_FLOW_PROJECTION_SCHEMA =
  "chainlesschain.delivery-flow-projection";
export const DELIVERY_ACTION_SCHEMA = "chainlesschain.delivery-action";
export const DELIVERY_ACTION_VERSION = 1;
export const DELIVERY_ACTION_RESULT_SCHEMA =
  "chainlesschain.delivery-action-result";

export const DELIVERY_PHASE = Object.freeze({
  GATES: "gates",
  PREVIEW: "preview",
  REVIEW: "review",
  FIX: "fix",
  PR: "pr",
  CI: "ci",
  EVIDENCE: "evidence",
  MERGE: "merge",
  ARCHIVE: "archive",
  COMPLETED: "completed",
});

export const DELIVERY_ACTION = Object.freeze({
  RUN_GATES: "run_gates",
  RUN_PREVIEW: "run_preview",
  RUN_REVIEW: "run_review",
  APPLY_FIX: "apply_fix",
  CREATE_PR: "create_pr",
  REFRESH_CI: "refresh_ci",
  PUBLISH_EVIDENCE: "publish_evidence",
  MERGE: "merge",
  ARCHIVE: "archive",
});

const ACTION_TO_METHOD = Object.freeze({
  [DELIVERY_ACTION.RUN_GATES]: "runGates",
  [DELIVERY_ACTION.RUN_PREVIEW]: "runPreview",
  [DELIVERY_ACTION.RUN_REVIEW]: "runReview",
  [DELIVERY_ACTION.APPLY_FIX]: "applyFix",
  [DELIVERY_ACTION.CREATE_PR]: "createPr",
  [DELIVERY_ACTION.REFRESH_CI]: "refreshCi",
  [DELIVERY_ACTION.PUBLISH_EVIDENCE]: "publishEvidence",
  [DELIVERY_ACTION.MERGE]: "merge",
  [DELIVERY_ACTION.ARCHIVE]: "archive",
});

const EXACT_COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/i;
const DEFAULT_BLOCKING_SEVERITIES = Object.freeze(["Critical", "High"]);

function hash(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonicalDeliveryJson(value))
    .digest("hex")}`;
}

function jsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch (error) {
    throw new Error(`delivery flow state must be JSON data: ${error.message}`);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function isoNow(now) {
  const raw = typeof now === "function" ? now() : now;
  const date = raw == null ? new Date() : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid flow time");
  return date.toISOString();
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function stateMaterial(state) {
  const material = jsonClone(state);
  delete material.stateDigest;
  return material;
}

function finalize(state) {
  const material = stateMaterial(state);
  return deepFreeze({ ...material, stateDigest: hash(material) });
}

function appendLineage(state, type, details, now) {
  const at = isoNow(now);
  const previous = state.lineage.at(-1)?.eventDigest || null;
  state.revision += 1;
  state.updatedAt = at;
  const eventMaterial = {
    seq: state.lineage.length + 1,
    revision: state.revision,
    at,
    type,
    details: jsonClone(details || {}),
    prevDigest: previous,
  };
  state.lineage.push({ ...eventMaterial, eventDigest: hash(eventMaterial) });
}

function transition(snapshot, type, details, mutate, now) {
  const state = stateMaterial(snapshot);
  mutate(state);
  appendLineage(state, type, details, now);
  return finalize(state);
}

function normalizeGateDefinitions(requiredGates) {
  if (!Array.isArray(requiredGates)) return [];
  return requiredGates.map((gate) =>
    typeof gate === "string"
      ? { id: gate, matrix: [] }
      : {
          ...jsonClone(gate),
          id: String(gate?.id || ""),
          matrix: Array.isArray(gate?.matrix) ? gate.matrix.map(String) : null,
        },
  );
}

function appendResultSideEffects(state, action, effectId, result) {
  if (!Array.isArray(state.sideEffects)) state.sideEffects = [];
  if (!Array.isArray(result?.sideEffects)) {
    state.sideEffects.push({
      id: effectId,
      action,
      status: "unknown",
      reason: "adapter-side-effect-ledger-missing",
    });
    return;
  }
  for (const effect of result.sideEffects) {
    state.sideEffects.push({ action, ...jsonClone(effect) });
  }
}

export function mapDeliveryFailures(source, failures = []) {
  const list = Array.isArray(failures) ? failures : [failures];
  return list.filter(Boolean).map((failure, index) => ({
    id: String(failure.id || `${source}-${index + 1}`),
    source,
    gateId: failure.gateId == null ? null : String(failure.gateId),
    test: failure.test == null ? null : String(failure.test),
    file: failure.file == null ? null : String(failure.file),
    line: Number.isFinite(Number(failure.line)) ? Number(failure.line) : null,
    hunk: failure.hunk == null ? null : String(failure.hunk),
    turnId: failure.turnId == null ? null : String(failure.turnId),
    toolCallId: failure.toolCallId == null ? null : String(failure.toolCallId),
    message: String(failure.message || failure.error || "unknown failure"),
  }));
}

function routeFailure(state, failures, reason) {
  state.failures = failures;
  if (state.round >= state.policy.maxRounds) {
    state.status = "stopped";
    state.stopReason = "max-rounds-reached";
    state.phase = DELIVERY_PHASE.EVIDENCE;
    return;
  }
  state.status = "active";
  state.stopReason = reason || null;
  state.phase = DELIVERY_PHASE.FIX;
}

function requiredGateResultFailures(state, results) {
  const failures = [];
  const definitions = new Map(
    state.requiredGates.map((gate) => [String(gate.id), gate]),
  );
  for (const id of state.gateSelection.selectedGateIds || []) {
    const matches = results.filter((result) => String(result?.id || "") === id);
    if (matches.length !== 1) {
      failures.push({
        gateId: id,
        message:
          matches.length === 0
            ? "required gate result missing"
            : "required gate result ambiguous",
      });
      continue;
    }
    const result = matches[0];
    if (String(result.status || "").toLowerCase() !== "passed") {
      failures.push({
        ...result,
        gateId: id,
        message: result.message || "required gate did not pass",
      });
    }
    if (String(result.commitSha || "") !== state.commitSha) {
      failures.push({
        gateId: id,
        message: "gate result targets another commit",
      });
    }
    const requiredMatrix = definitions.get(id)?.matrix;
    if (!Array.isArray(requiredMatrix)) {
      failures.push({ gateId: id, message: "required matrix is unverified" });
      continue;
    }
    const matrix = Array.isArray(result.matrix) ? result.matrix : [];
    for (const cellId of requiredMatrix) {
      const cells = matrix.filter(
        (cell) => String(cell?.id || "") === String(cellId),
      );
      if (
        cells.length !== 1 ||
        String(cells[0]?.status || "").toLowerCase() !== "passed" ||
        String(cells[0]?.commitSha || "") !== state.commitSha
      ) {
        failures.push({
          gateId: id,
          test: String(cellId),
          message: "required matrix cell missing, stale or not passed",
        });
      }
    }
  }
  return mapDeliveryFailures("gate", failures);
}

function normalizePreviewArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((artifact) => {
      if (!artifact || typeof artifact !== "object") return null;
      return buildEvidenceArtifact(
        artifact.kind,
        artifact.data && typeof artifact.data === "object"
          ? artifact.data
          : artifact,
      );
    })
    .filter(Boolean);
}

function buildEvidenceInput(state) {
  return {
    commit: { sha: state.commitSha },
    diff: state.diff,
    environment: state.environment,
    gates: {
      selection: state.gateSelection,
      required: state.requiredGates.map((gate) => ({
        id: gate.id,
        matrix: gate.matrix,
      })),
      results: state.gateResults,
    },
    review: state.review
      ? {
          status: state.review.status,
          commitSha: state.review.commitSha,
          evidenceDigest: state.review.evidenceDigest,
          findingsCount: state.review.report?.summary?.total ?? null,
        }
      : { status: "unverified", commitSha: state.commitSha },
    unverified: state.unverified,
    sideEffects: state.sideEffects,
    pr: state.pr
      ? {
          ...state.pr,
          autoMergeEnabled: state.policy.autoMergeEnabled,
        }
      : null,
    artifacts: state.previewArtifacts,
  };
}

function actionForPhase(state) {
  if (state.pendingEffect) return [];
  if (state.status === "completed") return [];
  if (state.status === "stopped" || state.status === "blocked") {
    if (!state.evidence) return [DELIVERY_ACTION.PUBLISH_EVIDENCE];
    if (!state.archive) return [DELIVERY_ACTION.ARCHIVE];
    return [];
  }
  switch (state.phase) {
    case DELIVERY_PHASE.GATES:
      return [DELIVERY_ACTION.RUN_GATES];
    case DELIVERY_PHASE.PREVIEW:
      return [DELIVERY_ACTION.RUN_PREVIEW];
    case DELIVERY_PHASE.REVIEW:
      return [DELIVERY_ACTION.RUN_REVIEW];
    case DELIVERY_PHASE.FIX:
      return [DELIVERY_ACTION.APPLY_FIX];
    case DELIVERY_PHASE.PR:
      return [DELIVERY_ACTION.CREATE_PR];
    case DELIVERY_PHASE.CI:
      return [DELIVERY_ACTION.REFRESH_CI];
    case DELIVERY_PHASE.EVIDENCE:
      return [DELIVERY_ACTION.PUBLISH_EVIDENCE];
    case DELIVERY_PHASE.MERGE:
      return [DELIVERY_ACTION.MERGE];
    case DELIVERY_PHASE.ARCHIVE:
      return [DELIVERY_ACTION.ARCHIVE];
    default:
      return [];
  }
}

export function validateDeliveryFlowProjection(projection) {
  const unmet = [];
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection)
  ) {
    return {
      valid: false,
      reason: "projection-invalid",
      unmet: ["projection-invalid"],
    };
  }
  if (projection.schema !== DELIVERY_FLOW_PROJECTION_SCHEMA)
    unmet.push("schema-unsupported");
  if (projection.version !== DELIVERY_FLOW_VERSION)
    unmet.push("version-unsupported");
  if (projection.valid !== true) unmet.push("projection-not-valid");
  if (!String(projection.flowId || "")) unmet.push("flow-id-missing");
  if (!Number.isInteger(Number(projection.revision)))
    unmet.push("revision-invalid");
  if (!SHA256_RE.test(String(projection.stateDigest || "")))
    unmet.push("state-digest-invalid");
  if (
    !new Set(["active", "blocked", "stopped", "completed"]).has(
      projection.status,
    )
  )
    unmet.push("status-unsupported");
  if (!Object.values(DELIVERY_PHASE).includes(projection.phase))
    unmet.push("phase-unsupported");
  if (!Array.isArray(projection.availableActions)) {
    unmet.push("available-actions-invalid");
  } else if (
    projection.availableActions.some(
      (action) => !Object.values(DELIVERY_ACTION).includes(action),
    )
  ) {
    unmet.push("available-action-unsupported");
  }
  if (projection.pendingEffect != null) {
    if (
      typeof projection.pendingEffect !== "object" ||
      !SHA256_RE.test(String(projection.pendingEffect.id || "")) ||
      !Object.values(DELIVERY_ACTION).includes(projection.pendingEffect.action)
    ) {
      unmet.push("pending-effect-invalid");
    }
    if (
      Array.isArray(projection.availableActions) &&
      projection.availableActions.length > 0
    ) {
      unmet.push("pending-effect-replay-action-exposed");
    }
  }
  return {
    valid: unmet.length === 0,
    reason: unmet[0] || "ok",
    unmet,
  };
}

export function validateDeliveryActionRequest(request) {
  const unmet = [];
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return {
      valid: false,
      reason: "action-invalid",
      unmet: ["action-invalid"],
    };
  }
  if (request.schema !== DELIVERY_ACTION_SCHEMA)
    unmet.push("schema-unsupported");
  if (request.version !== DELIVERY_ACTION_VERSION)
    unmet.push("version-unsupported");
  if (!String(request.flowId || "")) unmet.push("flow-id-missing");
  if (!Number.isInteger(Number(request.expectedRevision)))
    unmet.push("revision-invalid");
  if (!SHA256_RE.test(String(request.expectedStateDigest || "")))
    unmet.push("state-digest-invalid");
  if (!Object.values(DELIVERY_ACTION).includes(request.action))
    unmet.push("action-unsupported");
  if (
    !request.payload ||
    typeof request.payload !== "object" ||
    Array.isArray(request.payload)
  ) {
    unmet.push("payload-invalid");
  }
  return {
    valid: unmet.length === 0,
    reason: unmet[0] || "ok",
    unmet,
  };
}

export function createDeliveryActionResult(effectId, result) {
  const envelope = {
    schema: DELIVERY_ACTION_RESULT_SCHEMA,
    version: DELIVERY_ACTION_VERSION,
    effectId: String(effectId || ""),
    result: jsonClone(result),
  };
  const validation = validateDeliveryActionResult(envelope);
  if (!validation.valid) {
    throw new Error(`invalid delivery action result: ${validation.reason}`);
  }
  return deepFreeze(envelope);
}

export function validateDeliveryActionResult(envelope) {
  const unmet = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return {
      valid: false,
      reason: "result-invalid",
      unmet: ["result-invalid"],
    };
  }
  if (envelope.schema !== DELIVERY_ACTION_RESULT_SCHEMA)
    unmet.push("schema-unsupported");
  if (envelope.version !== DELIVERY_ACTION_VERSION)
    unmet.push("version-unsupported");
  if (!SHA256_RE.test(String(envelope.effectId || "")))
    unmet.push("effect-id-invalid");
  if (
    !envelope.result ||
    typeof envelope.result !== "object" ||
    Array.isArray(envelope.result)
  ) {
    unmet.push("result-payload-invalid");
  }
  return {
    valid: unmet.length === 0,
    reason: unmet[0] || "ok",
    unmet,
  };
}

export function projectDeliveryFlow(state) {
  const verification = verifyDeliveryFlowState(state);
  if (!verification.valid) {
    return deepFreeze({
      schema: DELIVERY_FLOW_PROJECTION_SCHEMA,
      version: DELIVERY_FLOW_VERSION,
      valid: false,
      reason: verification.reason,
      availableActions: [],
    });
  }
  return deepFreeze({
    schema: DELIVERY_FLOW_PROJECTION_SCHEMA,
    version: DELIVERY_FLOW_VERSION,
    valid: true,
    flowId: state.flowId,
    revision: state.revision,
    stateDigest: state.stateDigest,
    status: state.status,
    phase: state.phase,
    round: state.round,
    maxRounds: state.policy.maxRounds,
    noProgressRounds: state.noProgressRounds,
    maxNoProgressRounds: state.policy.maxNoProgressRounds,
    availableActions: actionForPhase(state),
    pendingEffect: state.pendingEffect
      ? {
          id: state.pendingEffect.id,
          action: state.pendingEffect.action,
          requestedAt: state.pendingEffect.requestedAt,
        }
      : null,
    stopReason: state.stopReason,
    failures: state.failures,
    pr: state.pr
      ? {
          number: state.pr.number,
          headCommitSha: state.pr.headCommitSha,
          ciCommitSha: state.pr.ciCommitSha || null,
          mergeAllowed: state.mergeDecision?.allow === true,
        }
      : null,
    evidence: state.evidence
      ? {
          recordDigest: state.evidence.record.recordDigest,
          ready: state.evidence.readiness.ready,
          artifactId: state.evidence.artifact?.id || null,
        }
      : null,
  });
}

export function verifyDeliveryFlowState(snapshot) {
  const unmet = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { valid: false, reason: "state-invalid", unmet: ["state-invalid"] };
  }
  if (snapshot.schema !== DELIVERY_FLOW_SCHEMA)
    unmet.push("schema-unsupported");
  if (snapshot.version !== DELIVERY_FLOW_VERSION)
    unmet.push("version-unsupported");
  const actualDigest = String(snapshot.stateDigest || "");
  const expectedDigest = hash(stateMaterial(snapshot));
  if (!actualDigest || actualDigest !== expectedDigest) {
    unmet.push("state-digest-mismatch");
  }
  if (!Array.isArray(snapshot.lineage)) {
    unmet.push("lineage-missing");
  } else {
    let previous = null;
    snapshot.lineage.forEach((event, index) => {
      const material = jsonClone(event);
      const actualEventDigest = String(material.eventDigest || "");
      delete material.eventDigest;
      if (
        event.seq !== index + 1 ||
        event.prevDigest !== previous ||
        actualEventDigest !== hash(material)
      ) {
        unmet.push(`lineage-invalid:${index + 1}`);
      }
      previous = actualEventDigest;
    });
    if (snapshot.revision !== snapshot.lineage.length) {
      unmet.push("revision-lineage-mismatch");
    }
  }
  return {
    valid: unmet.length === 0,
    reason: unmet[0] || "ok",
    unmet: [...new Set(unmet)],
    expectedDigest,
    actualDigest: actualDigest || null,
  };
}

export function restoreDeliveryFlow(snapshot) {
  const state = jsonClone(snapshot);
  const verification = verifyDeliveryFlowState(state);
  if (!verification.valid) {
    throw new Error(`invalid delivery flow snapshot: ${verification.reason}`);
  }
  return deepFreeze(state);
}

export function createDeliveryFlow(config = {}, { now } = {}) {
  const createdAt = isoNow(now);
  const requiredGates = normalizeGateDefinitions(config.requiredGates);
  const gateSelection = selectImpactedGates({
    changedFiles: config.diff?.changedFiles || config.changedFiles,
    requiredGates: requiredGates.map((gate) => ({
      id: gate.id,
      always: gate.always,
      selectors: gate.selectors,
    })),
    analysis: config.analysis,
    confidenceThreshold: config.confidenceThreshold,
    supportedLanguages: config.supportedLanguages,
    supportedEcosystems: config.supportedEcosystems,
  });
  const preflightUnmet = [];
  const commitSha = String(config.commitSha || "");
  if (!EXACT_COMMIT_RE.test(commitSha))
    preflightUnmet.push("commit-sha-not-exact");
  if (!EXACT_COMMIT_RE.test(String(config.diff?.baseCommitSha || ""))) {
    preflightUnmet.push("diff-base-commit-not-exact");
  }
  if (String(config.diff?.headCommitSha || "") !== commitSha) {
    preflightUnmet.push("diff-head-commit-mismatch");
  }
  if (!SHA256_RE.test(String(config.diff?.digest || ""))) {
    preflightUnmet.push("diff-digest-unverified");
  }
  if (
    !Array.isArray(config.diff?.changedFiles) ||
    config.diff.changedFiles.length === 0
  ) {
    preflightUnmet.push("changed-files-unverified");
  }
  if (
    requiredGates.length === 0 ||
    requiredGates.some((gate) => !gate.id || !Array.isArray(gate.matrix))
  ) {
    preflightUnmet.push("required-matrix-unverified");
  }
  for (const key of ["os", "arch", "runtime", "runtimeVersion"]) {
    if (!String(config.environment?.[key] || "")) {
      preflightUnmet.push(`environment-${key}-unverified`);
    }
  }
  if (
    !SHA256_RE.test(
      String(
        config.environment?.dependencyDigest ||
          config.environment?.dependencyLockDigest ||
          config.environment?.imageDigest ||
          "",
      ),
    )
  ) {
    preflightUnmet.push("environment-dependency-digest-unverified");
  }
  if (!Array.isArray(config.sideEffects)) {
    preflightUnmet.push("initial-side-effect-ledger-missing");
  }
  const preflightReason =
    gateSelection.decision === "blocked"
      ? gateSelection.reason
      : preflightUnmet[0] || null;
  const preflightBlocked = preflightReason != null;
  const identityMaterial = {
    commitSha: config.commitSha,
    diff: config.diff,
    requiredGateIds: requiredGates.map((gate) => gate.id),
  };
  const state = {
    schema: DELIVERY_FLOW_SCHEMA,
    version: DELIVERY_FLOW_VERSION,
    flowId:
      String(config.flowId || "").trim() ||
      `delivery-${hash(identityMaterial).slice("sha256:".length, 18)}`,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    status: preflightBlocked ? "blocked" : "active",
    phase: preflightBlocked ? DELIVERY_PHASE.EVIDENCE : DELIVERY_PHASE.GATES,
    stopReason: preflightReason,
    preflightUnmet,
    commitSha,
    diff: jsonClone(config.diff || {}),
    environment: jsonClone(config.environment || {}),
    requiredGates,
    gateSelection,
    gateResults: [],
    previewArtifacts: [],
    review: null,
    pr: null,
    mergeDecision: null,
    merge: null,
    evidence: null,
    archive: null,
    failures: [],
    unverified: Array.isArray(config.unverified)
      ? jsonClone(config.unverified)
      : ["unverified-ledger-missing"],
    sideEffects: Array.isArray(config.sideEffects)
      ? jsonClone(config.sideEffects)
      : [
          {
            id: "initial-state",
            status: "unknown",
            reason: "initial-side-effect-ledger-missing",
          },
        ],
    round: 0,
    noProgressRounds: 0,
    progressDigest: hash({ commitSha: config.commitSha, diff: config.diff }),
    policy: {
      maxRounds: boundedInteger(config.policy?.maxRounds, 3, 1, 10),
      maxNoProgressRounds: boundedInteger(
        config.policy?.maxNoProgressRounds,
        1,
        1,
        3,
      ),
      autoMergeEnabled: config.policy?.autoMergeEnabled === true,
      blockingSeverities: Array.isArray(config.policy?.blockingSeverities)
        ? config.policy.blockingSeverities.map(String)
        : [...DEFAULT_BLOCKING_SEVERITIES],
    },
    pendingEffect: null,
    lineage: [],
  };
  appendLineage(
    state,
    "gates-selected",
    {
      selectionDigest: gateSelection.analysisDigest,
      mode: gateSelection.mode,
      selectedGateIds: gateSelection.selectedGateIds,
    },
    now,
  );
  return finalize(state);
}

function actionPayload(state, action, payload, now) {
  const callerPayload = jsonClone(payload || {});
  const common = {
    flowId: state.flowId,
    revision: state.revision,
    commitSha: state.commitSha,
    diffDigest: state.diff?.digest || null,
    baseCommitSha: state.diff?.baseCommitSha || null,
    changedFiles: jsonClone(state.diff?.changedFiles || []),
  };
  if (action === DELIVERY_ACTION.RUN_GATES) {
    return {
      ...callerPayload,
      ...common,
      gateSelection: state.gateSelection,
      requiredGates: state.requiredGates,
    };
  }
  if (action === DELIVERY_ACTION.RUN_PREVIEW) {
    return {
      ...callerPayload,
      ...common,
      changedFiles: state.diff?.changedFiles || [],
    };
  }
  if (action === DELIVERY_ACTION.APPLY_FIX) {
    return {
      ...callerPayload,
      ...common,
      round: state.round + 1,
      failures: state.failures,
      review: state.review?.report || null,
    };
  }
  if (action === DELIVERY_ACTION.PUBLISH_EVIDENCE) {
    const record = createDeliveryEvidenceRecord(buildEvidenceInput(state), {
      now: isoNow(now),
    });
    return {
      ...callerPayload,
      ...common,
      record,
      readiness: assessDeliveryEvidence(record),
    };
  }
  if (action === DELIVERY_ACTION.MERGE) {
    return {
      ...callerPayload,
      ...common,
      pr: jsonClone(state.pr),
      evidence: state.evidence
        ? {
            recordDigest: state.evidence.record?.recordDigest || null,
            artifact: jsonClone(state.evidence.artifact),
          }
        : null,
    };
  }
  return { ...callerPayload, ...common };
}

export function requestDeliveryAction(
  snapshot,
  action,
  payload = {},
  { now } = {},
) {
  const state = restoreDeliveryFlow(snapshot);
  const available = actionForPhase(state);
  if (!available.includes(action)) {
    throw new Error(
      `delivery action ${action} is not allowed in ${state.status}/${state.phase}`,
    );
  }
  const requestPayload = actionPayload(state, action, payload, now);
  const request = {
    schema: DELIVERY_ACTION_SCHEMA,
    version: DELIVERY_ACTION_VERSION,
    flowId: state.flowId,
    expectedRevision: state.revision,
    expectedStateDigest: state.stateDigest,
    action,
    payload: requestPayload,
  };
  const requestValidation = validateDeliveryActionRequest(request);
  if (!requestValidation.valid) {
    throw new Error(
      `invalid delivery action request: ${requestValidation.reason}`,
    );
  }
  const id = hash(request);
  const requestedAt = isoNow(now);
  return transition(
    state,
    "effect-requested",
    { effectId: id, action, requestDigest: hash(requestPayload) },
    (next) => {
      next.pendingEffect = { id, requestedAt, ...request };
    },
    now,
  );
}

function settleGates(state, result) {
  if (String(result.commitSha || "") !== state.commitSha) {
    state.status = "stopped";
    state.stopReason = "gate-commit-mismatch";
    state.phase = DELIVERY_PHASE.EVIDENCE;
    return;
  }
  const results = Array.isArray(result.results)
    ? jsonClone(result.results)
    : [];
  state.gateResults = results;
  const failures = [
    ...requiredGateResultFailures(state, results),
    ...mapDeliveryFailures("gate", result.failures || []),
  ];
  if (failures.length > 0) {
    routeFailure(state, failures, "gate-failed");
    return;
  }
  state.failures = [];
  state.stopReason = null;
  state.phase = DELIVERY_PHASE.PREVIEW;
}

function settlePreview(state, result) {
  if (String(result.commitSha || "") !== state.commitSha) {
    state.status = "stopped";
    state.stopReason = "preview-commit-mismatch";
    state.phase = DELIVERY_PHASE.EVIDENCE;
    return;
  }
  const artifacts = normalizePreviewArtifacts(result.artifacts);
  state.previewArtifacts = artifacts;
  if (result.passed !== true || artifacts.length === 0) {
    const failures = mapDeliveryFailures(
      "preview",
      result.failures?.length
        ? result.failures
        : [{ message: "preview failed or produced no recognized evidence" }],
    );
    routeFailure(state, failures, "preview-failed");
    return;
  }
  state.failures = [];
  state.stopReason = null;
  state.phase = DELIVERY_PHASE.REVIEW;
}

function settleReview(state, result) {
  if (String(result.commitSha || "") !== state.commitSha) {
    state.status = "stopped";
    state.stopReason = "review-commit-mismatch";
    state.phase = DELIVERY_PHASE.EVIDENCE;
    return;
  }
  if (!Array.isArray(result.rawFindings)) {
    routeFailure(
      state,
      mapDeliveryFailures("review", [{ message: "review findings missing" }]),
      "review-unverified",
    );
    return;
  }
  const report = buildReviewReport(result.rawFindings, {
    verdicts: result.verdicts || {},
    minConfidence: result.minConfidence || 0,
    fileContents: result.fileContents || null,
  });
  const evidenceDigest = hash(report);
  const blocking = report.findings.filter((finding) =>
    state.policy.blockingSeverities.includes(finding.severity),
  );
  state.review = {
    status: blocking.length === 0 ? "approved" : "changes_requested",
    commitSha: state.commitSha,
    evidenceDigest,
    report,
  };
  if (blocking.length > 0) {
    routeFailure(
      state,
      mapDeliveryFailures(
        "review",
        blocking.map((finding, index) => ({
          id: `review-${index + 1}`,
          file: finding.path,
          line: finding.line,
          message: finding.failure_scenario || finding.evidence,
        })),
      ),
      "review-blocking-findings",
    );
    return;
  }
  state.failures = [];
  state.stopReason = null;
  state.phase =
    state.pr?.hasOpenPr === true ? DELIVERY_PHASE.CI : DELIVERY_PHASE.PR;
}

function settleFix(state, result) {
  state.round += 1;
  const nextCommit = String(result.commitSha || "");
  const nextDiffDigest = String(result.diffDigest || "");
  const progressDigest = String(
    result.progressDigest ||
      hash({ commitSha: nextCommit, diffDigest: nextDiffDigest }),
  );
  const progressed =
    result.changed === true &&
    EXACT_COMMIT_RE.test(nextCommit) &&
    nextCommit !== state.commitSha &&
    SHA256_RE.test(nextDiffDigest) &&
    progressDigest !== state.progressDigest;
  if (!progressed) {
    state.noProgressRounds += 1;
    if (state.noProgressRounds >= state.policy.maxNoProgressRounds) {
      state.status = "stopped";
      state.stopReason = "no-progress";
      state.phase = DELIVERY_PHASE.EVIDENCE;
    } else {
      state.phase = DELIVERY_PHASE.FIX;
    }
    return;
  }
  state.noProgressRounds = 0;
  state.progressDigest = progressDigest;
  state.commitSha = nextCommit;
  state.diff = {
    ...state.diff,
    headCommitSha: nextCommit,
    digest: nextDiffDigest,
    changedFiles: Array.isArray(result.changedFiles)
      ? jsonClone(result.changedFiles)
      : state.diff.changedFiles,
  };
  // A fixer can touch files outside the original analyzer corpus. Until a new
  // complete impact analysis is supplied, reruns conservatively expand to the
  // authoritative full required-gate matrix instead of reusing stale impact
  // selection evidence.
  state.gateSelection = selectImpactedGates({
    changedFiles: state.diff.changedFiles,
    requiredGates: state.requiredGates,
    analysis: {},
  });
  state.gateResults = [];
  state.previewArtifacts = [];
  state.review = null;
  if (state.pr?.hasOpenPr === true) {
    state.pr = {
      ...state.pr,
      headCommitSha: nextCommit,
      ciCommitSha: null,
      reviewApproved: undefined,
      checks: [],
    };
  } else {
    state.pr = null;
  }
  state.mergeDecision = null;
  state.merge = null;
  state.evidence = null;
  state.failures = [];
  state.stopReason = null;
  state.status = "active";
  state.phase = DELIVERY_PHASE.GATES;
}

function settlePr(state, result) {
  const number = Number(result.number);
  if (
    !Number.isInteger(number) ||
    number <= 0 ||
    result.hasOpenPr !== true ||
    String(result.headCommitSha || "") !== state.commitSha
  ) {
    state.status = "stopped";
    state.stopReason = "pr-head-unverified";
    state.phase = DELIVERY_PHASE.EVIDENCE;
    return;
  }
  state.pr = {
    ...jsonClone(result),
    number,
    headCommitSha: state.commitSha,
  };
  state.stopReason = null;
  state.phase = DELIVERY_PHASE.CI;
}

function settleCi(state, result) {
  state.pr = { ...state.pr, ...jsonClone(result) };
  const decision = strictAutoMergeDecision({
    enabled: state.policy.autoMergeEnabled,
    hasOpenPr: state.pr?.hasOpenPr,
    branchProtectionSatisfied: state.pr?.branchProtectionSatisfied,
    reviewApproved: state.pr?.reviewApproved,
    pendingApprovals: state.pr?.pendingApprovals,
    requiredChecks: state.pr?.requiredChecks,
    requiredMatrixComplete: state.pr?.requiredMatrixComplete,
    checks: state.pr?.checks,
    headCommitSha: state.pr?.headCommitSha,
    ciCommitSha: state.pr?.ciCommitSha,
    sideEffects: state.sideEffects,
  });
  state.mergeDecision = decision;
  const checkFailure = decision.unmet.some(
    (reason) =>
      reason === "checks-failing" ||
      reason.startsWith("required-check-not-passed:") ||
      reason.startsWith("required-check-missing:"),
  );
  if (checkFailure) {
    const failedChecks = (
      Array.isArray(state.pr?.checks) ? state.pr.checks : []
    )
      .filter((check) =>
        ["failure", "failed", "error", "timed_out"].includes(
          String(check?.state || check?.conclusion || "").toLowerCase(),
        ),
      )
      .map((check) => ({
        id: `ci:${check.name}`,
        gateId: check.name,
        file: check.file,
        test: check.test,
        message: check.message || "CI check failed",
      }));
    routeFailure(
      state,
      mapDeliveryFailures(
        "ci",
        failedChecks.length
          ? failedChecks
          : [{ message: "required CI matrix incomplete or failed" }],
      ),
      "ci-failed",
    );
    return;
  }
  if (decision.unmet.includes("checks-pending")) {
    state.phase = DELIVERY_PHASE.CI;
    state.stopReason = "ci-pending";
    return;
  }
  state.phase = DELIVERY_PHASE.EVIDENCE;
  if (decision.allow) {
    state.status = "active";
    state.stopReason = null;
  } else {
    state.status = "blocked";
    state.stopReason = `merge-policy:${decision.reason}`;
  }
}

function settleEvidence(state, result, pendingPayload) {
  const record = pendingPayload.record;
  const readiness = pendingPayload.readiness;
  if (
    !result.artifact ||
    result.artifact.immutable !== true ||
    result.artifact.recordDigest !== record.recordDigest
  ) {
    state.status = "blocked";
    state.stopReason = "immutable-evidence-publication-unverified";
    state.phase = DELIVERY_PHASE.EVIDENCE;
    return;
  }
  state.evidence = {
    record,
    readiness,
    artifact: jsonClone(result.artifact),
  };
  if (readiness.ready && state.mergeDecision?.allow === true) {
    state.status = "active";
    state.stopReason = null;
    state.phase = DELIVERY_PHASE.MERGE;
  } else {
    state.status = "active";
    state.stopReason = readiness.reason || state.stopReason;
    state.phase = DELIVERY_PHASE.ARCHIVE;
  }
}

function settleMerge(state, result) {
  if (
    state.evidence?.readiness?.ready !== true ||
    state.mergeDecision?.allow !== true ||
    result.merged !== true ||
    String(result.headCommitSha || "") !== state.commitSha
  ) {
    state.status = "stopped";
    state.stopReason = "merge-result-unverified";
    state.phase = DELIVERY_PHASE.ARCHIVE;
    return;
  }
  state.merge = jsonClone(result);
  state.stopReason = null;
  state.phase = DELIVERY_PHASE.ARCHIVE;
}

function settleArchive(state, result) {
  if (
    result.archived !== true ||
    result.preservedUncommitted !== true ||
    result.preservedUnpushed !== true
  ) {
    state.status = "stopped";
    state.stopReason = "archive-safety-unverified";
    state.phase = DELIVERY_PHASE.ARCHIVE;
    return;
  }
  state.archive = jsonClone(result);
  state.phase = DELIVERY_PHASE.COMPLETED;
  if (state.merge?.merged === true) {
    state.status = "completed";
    state.stopReason = null;
  } else {
    state.status = "stopped";
    state.stopReason ||= "archived-without-merge";
  }
}

export function settleDeliveryAction(snapshot, effectId, result, { now } = {}) {
  const state = restoreDeliveryFlow(snapshot);
  const pending = state.pendingEffect;
  if (!pending || pending.id !== effectId) {
    throw new Error("delivery effect id does not match the pending effect");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("delivery effect result must be an object");
  }
  const resultDigest = hash(result);
  return transition(
    state,
    "effect-settled",
    { effectId, action: pending.action, resultDigest },
    (next) => {
      next.pendingEffect = null;
      appendResultSideEffects(next, pending.action, effectId, result);
      if (result.ok === false || result.error) {
        next.status = "stopped";
        next.stopReason = `adapter-error:${pending.action}`;
        next.phase = DELIVERY_PHASE.EVIDENCE;
        return;
      }
      switch (pending.action) {
        case DELIVERY_ACTION.RUN_GATES:
          settleGates(next, result);
          break;
        case DELIVERY_ACTION.RUN_PREVIEW:
          settlePreview(next, result);
          break;
        case DELIVERY_ACTION.RUN_REVIEW:
          settleReview(next, result);
          break;
        case DELIVERY_ACTION.APPLY_FIX:
          settleFix(next, result);
          break;
        case DELIVERY_ACTION.CREATE_PR:
          settlePr(next, result);
          break;
        case DELIVERY_ACTION.REFRESH_CI:
          settleCi(next, result);
          break;
        case DELIVERY_ACTION.PUBLISH_EVIDENCE:
          settleEvidence(next, result, pending.payload);
          break;
        case DELIVERY_ACTION.MERGE:
          settleMerge(next, result);
          break;
        case DELIVERY_ACTION.ARCHIVE:
          settleArchive(next, result);
          break;
        default:
          throw new Error(`unsupported delivery action: ${pending.action}`);
      }
    },
    now,
  );
}

/** Stateful convenience wrapper. External effects run only via execute(). */
export class DeliveryCoordinator {
  constructor({ state, config, adapter = null, now } = {}) {
    this._now = now;
    this.adapter = adapter;
    this.state = state
      ? restoreDeliveryFlow(state)
      : createDeliveryFlow(config || {}, { now: this._now });
  }

  snapshot() {
    return this.state;
  }

  projection() {
    return projectDeliveryFlow(this.state);
  }

  request(action, payload = {}) {
    this.state = requestDeliveryAction(this.state, action, payload, {
      now: this._now,
    });
    return this.state.pendingEffect;
  }

  settle(effectId, result) {
    this.state = settleDeliveryAction(this.state, effectId, result, {
      now: this._now,
    });
    return this.state;
  }

  async execute(action, payload = {}) {
    const effect = this.request(action, payload);
    const method = ACTION_TO_METHOD[action];
    const fn = this.adapter?.[method];
    if (typeof fn !== "function") {
      throw new Error(
        `delivery adapter does not implement ${method}; pending effect was preserved`,
      );
    }
    try {
      const result = await fn(effect.payload, {
        effect: jsonClone(effect),
        state: this.projection(),
      });
      return this.settle(effect.id, result);
    } catch (error) {
      error.deliveryState = this.state;
      error.pendingEffect = effect;
      throw error;
    }
  }
}
