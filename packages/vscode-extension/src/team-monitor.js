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
const TEAM_MAILBOX_SNAPSHOT_VERSION = 3;
const MAX_TEAM_MAILBOX_MESSAGES = 1000;
const MAX_TEAM_MAILBOX_RECEIPTS = 5000;
// CLI allows 64 active teammates; reserve room for coordinator/system cursors.
const MAX_TEAM_MAILBOX_RECIPIENTS = 128;
const TEAM_MAILBOX_RECEIPT_STATUSES = new Set([
  "delivered",
  "read",
  "processed",
  "dead_letter",
]);
const TEAM_GRAPH_PROJECTION_SCHEMA = "chainlesschain.team-graph-projection/v1";
const MAX_TEAM_GRAPH_MESSAGES = 5000;
const MAX_TEAM_GRAPH_HANDOFFS = 1000;
const GRAPH_DEBUG_HISTORY_SCHEMA = "chainlesschain.graph-debug-history/v1";
const GRAPH_TRACE_PROJECTION_SCHEMA =
  "chainlesschain.graph-trace-projection/v1";
const MAX_GRAPH_DEBUG_SNAPSHOTS = 200;
const MAX_GRAPH_DEBUG_NODES = 250;
const TEAM_GRAPH_MESSAGE_STATUSES = new Set([
  "admitted",
  "delivered",
  "read",
  "processed",
  "dead_letter",
]);
const TEAM_GRAPH_HANDOFF_STATUSES = new Set([
  "offered",
  "accepted",
  "rejected",
  "committed",
  "revoked",
  "expired",
]);

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

function unavailableMailbox(error) {
  return { available: false, error };
}

/**
 * Project a CLI TeamMailbox v3 snapshot into bounded, content-free health
 * metadata. Message subjects, bodies, digests, consumer keys, reasons and
 * attempt bindings deliberately never cross into the IDE view.
 */
function normalizeTeamMailbox(value) {
  if (value == null) return null;
  if (!plainObject(value)) {
    return unavailableMailbox("invalid mailbox snapshot");
  }
  if (optionalSafeInteger(value.version, { positive: true }) !== 3) {
    return unavailableMailbox("unsupported mailbox snapshot version");
  }

  const log = value.log;
  const rawRecipients = value.recipients;
  const rawDelivered = value.delivered;
  const rawReceipts = value.receipts;
  if (
    !Array.isArray(log) ||
    log.length > MAX_TEAM_MAILBOX_MESSAGES ||
    !Array.isArray(rawRecipients) ||
    rawRecipients.length > MAX_TEAM_MAILBOX_RECIPIENTS ||
    !Array.isArray(rawDelivered) ||
    rawDelivered.length > MAX_TEAM_MAILBOX_RECIPIENTS ||
    !Array.isArray(rawReceipts) ||
    rawReceipts.length > MAX_TEAM_MAILBOX_RECEIPTS
  ) {
    return unavailableMailbox("mailbox snapshot exceeds IDE projection bounds");
  }
  const sequence = optionalSafeInteger(value.seq);
  if (sequence == null) {
    return unavailableMailbox("invalid mailbox sequence metadata");
  }

  const recipients = rawRecipients.map((recipient) =>
    stableString(recipient, 256),
  );
  if (
    recipients.some((recipient) => recipient == null || recipient === "*") ||
    new Set(recipients).size !== recipients.length
  ) {
    return unavailableMailbox("invalid mailbox recipient metadata");
  }

  const delivered = new Map();
  for (const entry of rawDelivered) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return unavailableMailbox("invalid mailbox delivery metadata");
    }
    const recipient = stableString(entry[0], 256);
    const cursor = optionalSafeInteger(entry[1]);
    if (
      !recipient ||
      recipient === "*" ||
      cursor == null ||
      cursor > sequence ||
      delivered.has(recipient)
    ) {
      return unavailableMailbox("invalid mailbox delivery metadata");
    }
    delivered.set(recipient, cursor);
  }

  const receipts = new Map();
  const receiptCounts = {
    delivered: 0,
    read: 0,
    processed: 0,
    deadLettered: 0,
  };
  for (const entry of rawReceipts) {
    if (!Array.isArray(entry) || entry.length !== 2 || !plainObject(entry[1])) {
      return unavailableMailbox("invalid mailbox receipt metadata");
    }
    const [key, receipt] = entry;
    const recipient = stableString(receipt.recipient, 256);
    const messageId = optionalSafeInteger(receipt.messageId, {
      positive: true,
    });
    const status = optionalString(receipt.status);
    const expectedKey = `${recipient || ""}\0${messageId || ""}`;
    if (
      typeof key !== "string" ||
      key !== expectedKey ||
      !recipient ||
      messageId == null ||
      messageId > sequence ||
      receipts.has(key) ||
      !TEAM_MAILBOX_RECEIPT_STATUSES.has(status)
    ) {
      return unavailableMailbox("invalid mailbox receipt metadata");
    }
    receipts.set(key, status);
    if (status === "dead_letter") receiptCounts.deadLettered += 1;
    else receiptCounts[status] += 1;
  }

  const messages = [];
  let previousId = 0;
  let followups = 0;
  for (const message of log) {
    if (!plainObject(message)) {
      return unavailableMailbox("invalid mailbox message metadata");
    }
    const id = optionalSafeInteger(message.id, { positive: true });
    const from = stableString(message.from, 256);
    const to = stableString(message.to, 256);
    const mode = message.mode == null ? "send" : optionalString(message.mode);
    if (
      id == null ||
      id <= previousId ||
      id > sequence ||
      !from ||
      !to ||
      !["send", "followup"].includes(mode)
    ) {
      return unavailableMailbox("invalid mailbox message metadata");
    }
    previousId = id;
    if (mode === "followup") followups += 1;
    messages.push({ id, from, to });
  }

  let targetDeliveries = 0;
  let pendingDeliveries = 0;
  for (const message of messages) {
    const targets =
      message.to === "*"
        ? recipients.filter((recipient) => recipient !== message.from)
        : [message.to];
    for (const recipient of targets) {
      targetDeliveries += 1;
      const status = receipts.get(`${recipient}\0${message.id}`);
      const terminal = status === "processed" || status === "dead_letter";
      if (!terminal && Number(delivered.get(recipient) || 0) < message.id) {
        pendingDeliveries += 1;
      }
    }
  }

  const limits = plainObject(value.limits) ? value.limits : {};
  const maxMessages = optionalSafeInteger(limits.maxMessages, {
    positive: true,
  });
  const maxTotalBytes = optionalSafeInteger(limits.maxTotalBytes, {
    positive: true,
  });
  const totalBytes = optionalSafeInteger(value.totalBytes);
  if (maxMessages == null || maxTotalBytes == null || totalBytes == null) {
    return unavailableMailbox("invalid mailbox capacity metadata");
  }
  const pressureRatio = Math.max(
    log.length / maxMessages,
    totalBytes / maxTotalBytes,
  );
  const pressureLevel =
    pressureRatio >= 1
      ? "full"
      : pressureRatio >= 0.95
        ? "critical"
        : pressureRatio >= 0.8
          ? "high"
          : "normal";
  const counters = plainObject(value.counters) ? value.counters : {};
  for (const name of [
    "acceptedMessages",
    "rejectedMessages",
    "deliveryAttempts",
    "processedMessages",
    "deadLetteredMessages",
  ]) {
    if (
      Object.hasOwn(counters, name) &&
      optionalSafeInteger(counters[name]) == null
    ) {
      return unavailableMailbox("invalid mailbox counter metadata");
    }
  }
  const counter = (name, fallback = 0) =>
    optionalSafeInteger(counters[name]) ?? fallback;

  return {
    available: true,
    version: TEAM_MAILBOX_SNAPSHOT_VERSION,
    retainedMessages: log.length,
    acceptedMessages: counter("acceptedMessages", log.length),
    rejectedMessages: counter("rejectedMessages"),
    followups,
    recipients: recipients.length,
    targetDeliveries,
    pendingDeliveries,
    deliveryAttempts: counter("deliveryAttempts"),
    processedMessages: counter("processedMessages", receiptCounts.processed),
    deadLetteredMessages: counter(
      "deadLetteredMessages",
      receiptCounts.deadLettered,
    ),
    receiptCounts,
    totalBytes,
    maxMessages,
    maxTotalBytes,
    pressureRatio,
    pressureLevel,
  };
}

function unavailableCollaboration(error) {
  return { available: false, error };
}

/**
 * Reduce CLI 0.166.3's canonical Message/Handoff graph to content-free health
 * counters. Message payloads, payload digests, attempt IDs, agent IDs,
 * artifact IDs and authority digests never cross the extension-host/Webview
 * boundary.
 */
function normalizeTeamGraphProjection(value) {
  if (value == null) return null;
  if (!plainObject(value) || value.schema !== TEAM_GRAPH_PROJECTION_SCHEMA) {
    return unavailableCollaboration("unsupported collaboration projection");
  }
  if (
    !stableString(value.runId, 256) ||
    !DIGEST_PATTERN.test(String(value.revisionDigest || "")) ||
    !DIGEST_PATTERN.test(String(value.authorityDigest || "")) ||
    !DIGEST_PATTERN.test(String(value.sourceDigest || "")) ||
    !DIGEST_PATTERN.test(String(value.projectionDigest || "")) ||
    !plainObject(value.messageGraph) ||
    !Array.isArray(value.messageGraph.messages) ||
    !Array.isArray(value.messageGraph.edges) ||
    !Array.isArray(value.handoffs) ||
    !Array.isArray(value.custodyEdges) ||
    value.messageGraph.messages.length > MAX_TEAM_GRAPH_MESSAGES ||
    value.messageGraph.edges.length > MAX_TEAM_GRAPH_MESSAGES ||
    value.handoffs.length > MAX_TEAM_GRAPH_HANDOFFS ||
    value.custodyEdges.length > MAX_TEAM_GRAPH_HANDOFFS
  ) {
    return unavailableCollaboration(
      "collaboration projection exceeds IDE bounds or has invalid authority metadata",
    );
  }

  const messageStatuses = Object.fromEntries(
    [...TEAM_GRAPH_MESSAGE_STATUSES].map((status) => [status, 0]),
  );
  let followups = 0;
  for (const message of value.messageGraph.messages) {
    if (
      !plainObject(message) ||
      !TEAM_GRAPH_MESSAGE_STATUSES.has(message.status) ||
      !["send", "followup"].includes(message.mode)
    ) {
      return unavailableCollaboration("invalid canonical message metadata");
    }
    messageStatuses[message.status] += 1;
    if (message.mode === "followup") followups += 1;
  }

  const handoffStatuses = Object.fromEntries(
    [...TEAM_GRAPH_HANDOFF_STATUSES].map((status) => [status, 0]),
  );
  for (const handoff of value.handoffs) {
    if (
      !plainObject(handoff) ||
      !TEAM_GRAPH_HANDOFF_STATUSES.has(handoff.status)
    ) {
      return unavailableCollaboration("invalid custody handoff metadata");
    }
    handoffStatuses[handoff.status] += 1;
  }
  for (const edge of value.custodyEdges) {
    if (
      !plainObject(edge) ||
      edge.kind !== "custody_handoff" ||
      !TEAM_GRAPH_HANDOFF_STATUSES.has(edge.status)
    ) {
      return unavailableCollaboration("invalid custody edge metadata");
    }
  }

  return {
    available: true,
    version: 1,
    messages: value.messageGraph.messages.length,
    followups,
    messageStatuses,
    handoffs: value.handoffs.length,
    activeHandoffs: handoffStatuses.offered + handoffStatuses.accepted,
    handoffStatuses,
    custodyEdges: value.custodyEdges.length,
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
      mailbox: null,
      collaboration: null,
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
    mailbox: normalizeTeamMailbox(snap.mailbox),
    collaboration: normalizeTeamGraphProjection(snap.graphProjection),
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

function graphDebugNodes(projection) {
  if (
    !plainObject(projection) ||
    projection.schema !== GRAPH_TRACE_PROJECTION_SCHEMA ||
    !plainObject(projection.taskGraph) ||
    !Array.isArray(projection.taskGraph.nodes) ||
    projection.taskGraph.nodes.length > MAX_GRAPH_DEBUG_NODES
  ) {
    throw new Error("invalid Graph debug projection");
  }
  return projection.taskGraph.nodes.map((node) => {
    if (!plainObject(node)) throw new Error("invalid Graph debug node");
    const id = stableString(node.id, 256);
    const status = stableString(node.status, 160);
    const blockedRoot =
      node.blockedRoot == null ? null : stableString(node.blockedRoot, 256);
    if (!id || !status || (node.blockedRoot != null && !blockedRoot)) {
      throw new Error("invalid Graph debug node identity");
    }
    return Object.freeze({ id, status, blockedRoot });
  });
}

function graphBlockedRoot(nodes, nodeId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let cursor = byId.get(nodeId) || null;
  const chain = [];
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor.id);
    if (!cursor.blockedRoot || cursor.blockedRoot === cursor.id) break;
    cursor = byId.get(cursor.blockedRoot) || null;
  }
  return Object.freeze({
    root: chain.at(-1) || null,
    chain: Object.freeze(chain),
  });
}

function parseGraphDebugHistory(history) {
  if (
    !plainObject(history) ||
    history.schema !== GRAPH_DEBUG_HISTORY_SCHEMA ||
    !stableString(history.runId, 256) ||
    !Array.isArray(history.snapshots) ||
    history.snapshots.length === 0 ||
    history.snapshots.length > MAX_GRAPH_DEBUG_SNAPSHOTS
  ) {
    throw new Error("invalid Graph debug history");
  }
  const snapshots = history.snapshots.map((snapshot) => {
    if (
      !plainObject(snapshot) ||
      !Number.isSafeInteger(snapshot.seq) ||
      snapshot.seq < 1
    ) {
      throw new Error("invalid Graph debug snapshot");
    }
    const projection = snapshot.projection;
    if (
      projection?.runId !== history.runId ||
      projection?.throughSeq !== snapshot.seq
    ) {
      throw new Error("Graph debug snapshot is not bound to its run/sequence");
    }
    return Object.freeze({
      seq: snapshot.seq,
      status: stableString(projection.status, 160) || "unknown",
      graphRevision: optionalSafeInteger(projection.graphRevision),
      revisionDigest: DIGEST_PATTERN.test(
        String(projection.revisionDigest || ""),
      )
        ? projection.revisionDigest
        : null,
      nodes: Object.freeze(graphDebugNodes(projection)),
    });
  });
  const current = snapshots.at(-1);
  const currentNodeIds = new Set(current.nodes.map((node) => node.id));
  const blockedRoots = Object.freeze(
    current.nodes
      .filter(
        (node) => node.blockedRoot && currentNodeIds.has(node.blockedRoot),
      )
      .map((node) =>
        Object.freeze({
          nodeId: node.id,
          ...graphBlockedRoot(current.nodes, node.id),
        }),
      ),
  );
  const revisions = Object.freeze(
    snapshots.slice(1).map((snapshot, index) => {
      const previous = new Map(
        snapshots[index].nodes.map((node) => [node.id, node.status]),
      );
      const currentStatuses = new Map(
        snapshot.nodes.map((node) => [node.id, node.status]),
      );
      const changedNodeIds = [
        ...new Set([...previous.keys(), ...currentStatuses.keys()]),
      ]
        .filter((id) => previous.get(id) !== currentStatuses.get(id))
        .sort();
      return Object.freeze({
        fromSeq: snapshots[index].seq,
        toSeq: snapshot.seq,
        changedNodeIds: Object.freeze(changedNodeIds),
      });
    }),
  );
  return Object.freeze({
    schema: GRAPH_DEBUG_HISTORY_SCHEMA,
    runId: history.runId,
    snapshots: Object.freeze(snapshots),
    current,
    revisions,
    blockedRoots,
  });
}

module.exports = {
  parseTeamState,
  summarizeTeam,
  normalizeAdjudication,
  normalizeTeamMailbox,
  normalizeTeamGraphProjection,
  parseGraphDebugHistory,
  computeTeamControlAttemptDigest,
  computeTeamControlAdjudicationDigest,
  TEAM_STATUSES,
  DISTRIBUTED_QUEUE_KIND,
  LEGACY_TEAM_KIND,
};
