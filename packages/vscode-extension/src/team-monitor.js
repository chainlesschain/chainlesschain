/**
 * Pure parsing and summary helpers for legacy `cc team run --state` snapshots
 * and schema-v1 `cc team queue` distributed queue state.
 *
 * The IDE treats the CLI state as read-only authority. Legacy version 6 uses
 * stateId/digest CAS. Distributed queues use queueId + authorityDigest and the
 * exact lease fence or adjudication evidence accepted by `cc team queue`.
 */

const crypto = require("crypto");

const TEAM_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "blocked",
];
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const AUTHORITY_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const DISTRIBUTED_QUEUE_SCHEMA_VERSION = 1;
const DISTRIBUTED_QUEUE_KIND = "distributed-queue";
const LEGACY_TEAM_KIND = "legacy-team";

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("unsupported value");
}

function digest(domain, value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
}

function normalizeAttemptString(value, maxLength = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw new Error("invalid attempt identity");
  }
  return value;
}

function normalizeFencingToken(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string") return normalizeAttemptString(value);
  throw new Error("invalid fencing token");
}

/**
 * Mirrors team-control-store's public binding digest without importing CLI
 * implementation code into the extension. Invalid snapshot data returns null
 * so human control remains unavailable instead of weakening the binding.
 */
function computeTeamControlAttemptDigest({
  holder,
  leaseId,
  fencingToken,
} = {}) {
  try {
    return digest("cc-team-control-attempt-v1", {
      holder: normalizeAttemptString(holder, 256),
      leaseId: normalizeAttemptString(leaseId),
      fencingToken: normalizeFencingToken(fencingToken),
    });
  } catch {
    return null;
  }
}

function computeTeamControlAdjudicationDigest({
  caseId = null,
  evidenceDigest,
} = {}) {
  try {
    if (!DIGEST_PATTERN.test(String(evidenceDigest || ""))) return null;
    if (caseId == null) return evidenceDigest;
    return digest("cc-team-control-adjudication-v1", {
      caseId: normalizeAttemptString(caseId),
      evidenceDigest,
    });
  } catch {
    return null;
  }
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalFiniteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalSafeInteger(value, { positive = false } = {}) {
  if (typeof value !== "number") return null;
  const number = value;
  if (!Number.isSafeInteger(number) || (positive ? number < 1 : number < 0)) {
    return null;
  }
  return number;
}

function stableString(value, maxLength = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    return null;
  }
  return value;
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeAdjudication(value) {
  if (!plainObject(value)) return null;
  const rawCase =
    value.case && typeof value.case === "object" && !Array.isArray(value.case)
      ? value.case
      : null;
  const rawDecision =
    value.decision &&
    typeof value.decision === "object" &&
    !Array.isArray(value.decision)
      ? value.decision
      : null;
  return {
    required: value.required === true,
    code: optionalString(value.code),
    reason: optionalString(value.reason),
    evidenceDigest: optionalString(value.evidenceDigest),
    requestedAt: optionalFiniteNumber(value.requestedAt),
    case: rawCase
      ? {
          caseId: optionalString(rawCase.caseId),
          registryDigest: optionalString(rawCase.registryDigest),
          sideEffectDigest: optionalString(rawCase.sideEffectDigest),
        }
      : null,
    decision: rawDecision
      ? {
          id: optionalString(rawDecision.id || rawDecision.decisionDigest),
          action: optionalString(rawDecision.action || rawDecision.value),
          actor: optionalString(rawDecision.actor || rawDecision.authority),
          reason: optionalString(rawDecision.reason),
          reasonDigest: optionalString(rawDecision.reasonDigest),
          evidenceDigest: optionalString(rawDecision.evidenceDigest),
          decisionDigest: optionalString(rawDecision.decisionDigest),
          decidedAt: optionalFiniteNumber(rawDecision.decidedAt),
        }
      : null,
  };
}

function normalizeInterruption(value) {
  if (!plainObject(value)) return null;
  return {
    requestId: optionalString(value.requestId),
    actor: optionalString(value.actor),
    reason: optionalString(value.reason),
    requestedAt: optionalFiniteNumber(value.requestedAt),
    evidenceDigest: DIGEST_PATTERN.test(String(value.evidenceDigest || ""))
      ? value.evidenceDigest
      : null,
  };
}

function normalizeWorkspaceExecution(value) {
  if (!plainObject(value)) return null;
  const checkpoint = plainObject(value.checkpoint) ? value.checkpoint : null;
  const worktree = plainObject(value.worktree) ? value.worktree : null;
  const phase = optionalString(value.phase);
  const checkpointState = optionalString(checkpoint?.state);
  return {
    phase,
    workerId: optionalString(value.workerId),
    worktree: worktree
      ? {
          branch: optionalString(worktree.branch),
          path: optionalString(worktree.path),
          baselineCommitOid: optionalString(worktree.baselineCommitOid),
          commitOid: optionalString(worktree.commitOid),
        }
      : null,
    checkpoint: checkpoint
      ? {
          transactionId: optionalString(checkpoint.transactionId),
          checkpointId: optionalString(checkpoint.checkpointId),
          state: checkpointState,
          coverage: optionalString(checkpoint.coverage),
          fileCoverage: optionalString(checkpoint.fileCoverage),
          recoveryRequired: checkpoint.recoveryRequired === true,
        }
      : null,
    recoveryRequired:
      phase === "rollback-recovery-required" ||
      checkpoint?.recoveryRequired === true,
  };
}

/**
 * Parse a state-file snapshot (string or object) into a normalized, flat task
 * list plus budget/members. Returns { ok:false, error } rather than throwing
 * on untrusted or incomplete input so the webview can fail closed.
 */
function parseTeamState(input) {
  let snap = input;
  if (typeof input === "string") {
    try {
      snap = JSON.parse(input);
    } catch {
      return { ok: false, error: "not JSON - is this a cc team --state file?" };
    }
  }
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
    return { ok: false, error: "empty or non-object state" };
  }
  const distributedCandidate =
    Object.hasOwn(snap, "schemaVersion") ||
    Object.hasOwn(snap, "queueId") ||
    Object.hasOwn(snap, "authorityDigest");
  let distributed = false;
  let distributedIdentity = null;
  if (distributedCandidate) {
    const schemaVersion = optionalSafeInteger(snap.schemaVersion, {
      positive: true,
    });
    const queueId = stableString(snap.queueId);
    const authorityDigest =
      typeof snap.authorityDigest === "string" &&
      AUTHORITY_DIGEST_PATTERN.test(snap.authorityDigest)
        ? snap.authorityDigest
        : null;
    const authority = plainObject(snap.authority) ? snap.authority : null;
    const repoRoot = stableString(authority?.repoRoot, 4096);
    const runId = stableString(authority?.runId);
    if (
      schemaVersion !== DISTRIBUTED_QUEUE_SCHEMA_VERSION ||
      !queueId ||
      !authorityDigest ||
      !repoRoot ||
      !runId
    ) {
      return {
        ok: false,
        error:
          "invalid distributed queue authority - schemaVersion, queueId, authority.repoRoot/runId, and authorityDigest are required.",
      };
    }
    distributed = true;
    distributedIdentity = {
      schemaVersion,
      queueId,
      authorityDigest,
      authority: {
        repoRoot,
        runId,
        mode: optionalString(authority.mode),
      },
      revision: optionalSafeInteger(snap.revision),
    };
  }

  const rawTasks = snap.registry?.tasks?.tasks;
  if (!Array.isArray(rawTasks)) {
    return {
      ok: false,
      error:
        "no task graph in this file - pass the path you gave `cc team run --state`.",
    };
  }
  const tasks = rawTasks.map((task) => {
    const metadata =
      task?.metadata &&
      typeof task.metadata === "object" &&
      !Array.isArray(task.metadata)
        ? task.metadata
        : {};
    const lease =
      metadata.lease &&
      typeof metadata.lease === "object" &&
      !Array.isArray(metadata.lease)
        ? metadata.lease
        : null;
    const status = String(task?.status || "pending");
    const holder = optionalString(lease?.holder);
    const leaseId = optionalString(lease?.leaseId);
    const fencingToken = distributed
      ? optionalSafeInteger(lease?.fencingToken, { positive: true })
      : (lease?.fencingToken ?? leaseId);
    const adjudication = normalizeAdjudication(metadata.adjudication);
    const evidenceDigest = DIGEST_PATTERN.test(
      String(adjudication?.evidenceDigest || ""),
    )
      ? adjudication.evidenceDigest
      : null;
    const workspaceExecution = normalizeWorkspaceExecution(
      metadata.workspaceExecution,
    );
    const attemptDigest =
      status === "in_progress"
        ? computeTeamControlAttemptDigest({
            holder,
            leaseId,
            fencingToken,
          })
        : null;
    const adjudicationDigest =
      adjudication?.required === true &&
      adjudication.case?.caseId &&
      adjudication.case?.sideEffectDigest
        ? computeTeamControlAdjudicationDigest({
            caseId: adjudication.case?.caseId,
            evidenceDigest: adjudication.case?.sideEffectDigest,
          })
        : null;
    return {
      id: String(task?.id || ""),
      title: String(task?.title || task?.id || "(untitled)"),
      status,
      key: metadata.key != null ? String(metadata.key) : null,
      dependsOn: Array.isArray(metadata.dependsOn)
        ? metadata.dependsOn.map(String)
        : [],
      holder,
      leaseId,
      fencingToken,
      leaseExpiresAt: optionalFiniteNumber(lease?.expiresAt),
      attemptDigest,
      attempts: Number(metadata.attempts) || 0,
      lastError: optionalString(metadata.lastError),
      adjudication,
      adjudicationDigest,
      evidenceDigest,
      interruption: normalizeInterruption(metadata.interruption),
      workspaceExecution,
      checkpointRecoveryRequired: workspaceExecution?.recoveryRequired === true,
    };
  });
  if (distributed) {
    return {
      ok: true,
      stateKind: DISTRIBUTED_QUEUE_KIND,
      distributed: true,
      version: null,
      stateId: null,
      ...distributedIdentity,
      tasks,
      members: [],
      budget: plainObject(snap.budget) ? snap.budget : null,
      finalization: plainObject(snap.finalization) ? snap.finalization : null,
    };
  }
  return {
    ok: true,
    stateKind: LEGACY_TEAM_KIND,
    distributed: false,
    version: Number(snap.version) || 1,
    stateId: optionalString(snap.stateId),
    tasks,
    members: Array.isArray(snap.members) ? snap.members : [],
    budget: snap.budget && typeof snap.budget === "object" ? snap.budget : null,
  };
}

/**
 * Roll a parsed state up into counts + progress. `now` decides whether a lease
 * is still live. It also reports how many tasks need human adjudication.
 */
function summarizeTeam(state, { now = Date.now() } = {}) {
  const counts = Object.fromEntries(TEAM_STATUSES.map((status) => [status, 0]));
  let active = 0;
  let stale = 0;
  let adjudicationRequired = 0;
  const tasks = (state && state.tasks) || [];
  for (const task of tasks) {
    if (task.status in counts) counts[task.status] += 1;
    if (task.status === "in_progress" && task.holder) {
      if (
        task.leaseExpiresAt != null &&
        Number(task.leaseExpiresAt) <= Number(now)
      ) {
        stale += 1;
      } else {
        active += 1;
      }
    }
    if (task.adjudication?.required === true) adjudicationRequired += 1;
  }
  const total = tasks.length;
  const donePct = total ? Math.round((counts.completed / total) * 100) : 0;
  return {
    counts,
    active,
    stale,
    adjudicationRequired,
    total,
    donePct,
  };
}

module.exports = {
  parseTeamState,
  summarizeTeam,
  normalizeAdjudication,
  computeTeamControlAttemptDigest,
  computeTeamControlAdjudicationDigest,
  TEAM_STATUSES,
  DISTRIBUTED_QUEUE_KIND,
  LEGACY_TEAM_KIND,
};
