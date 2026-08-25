import { createHash } from "node:crypto";

export const TEAM_GRAPH_PROJECTION_SCHEMA =
  "chainlesschain.team-graph-projection/v1";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const CANONICAL_MESSAGE_STATUSES = new Set([
  "admitted",
  "delivered",
  "read",
  "processed",
  "dead_letter",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function teamGraphDigest(value, domain = "cc.team.graph/v1") {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value))}`, "utf8")
    .digest("hex")}`;
}

function safeIdentifier(value, prefix) {
  const candidate = String(value ?? "").trim();
  if (SAFE_IDENTIFIER.test(candidate)) return candidate;
  return `${prefix}:${teamGraphDigest(
    candidate,
    `cc.team.id/${prefix}/v1`,
  ).slice(7)}`;
}

function optionalIdentifier(value, prefix) {
  return value == null || String(value).trim().length === 0
    ? null
    : safeIdentifier(value, prefix);
}

function isoTimestamp(value) {
  const milliseconds = Number(value);
  return new Date(
    Number.isFinite(milliseconds) ? milliseconds : 0,
  ).toISOString();
}

function registryTasks(registry) {
  if (registry && typeof registry.list === "function") return registry.list();
  return Array.isArray(registry) ? registry : [];
}

function declaredTask(task) {
  const metadata = cloneJson(task?.metadata || {});
  for (const key of [
    "lease",
    "custodyHandoffs",
    "attempts",
    "result",
    "lastError",
    "adjudication",
  ]) {
    delete metadata[key];
  }
  return {
    key: task?.key,
    title: task?.title,
    priority: task?.priority || "normal",
    dependsOn: [...(task?.dependsOn || [])].sort(),
    metadata,
  };
}

export function computeTeamGraphRevisionDigest(registry) {
  const tasks = registryTasks(registry)
    .map(declaredTask)
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
  return teamGraphDigest(
    { schema: "chainlesschain.team-definition/v1", tasks },
    "cc.team.revision/v1",
  );
}

export function computeTeamGraphAuthorityDigest(authority = {}) {
  return teamGraphDigest(
    { schema: "chainlesschain.team-authority/v1", authority },
    "cc.team.authority/v1",
  );
}

function attemptIdentifier(attempt = {}, fallbackHolder = "coordinator") {
  const explicit = attempt?.attemptId || attempt?.id;
  if (explicit) return safeIdentifier(explicit, "team-attempt");
  const binding = {
    holder: attempt?.holder || fallbackHolder,
    taskKey: attempt?.taskKey || null,
    leaseId: attempt?.leaseId || null,
    fencingToken: attempt?.fencingToken ?? attempt?.fromFence ?? null,
  };
  return `team-attempt:${teamGraphDigest(binding, "cc.team.attempt/v1").slice(
    7,
  )}`;
}

function mailboxSnapshot(mailbox) {
  if (mailbox && typeof mailbox.snapshot === "function") {
    return mailbox.snapshot();
  }
  return mailbox && typeof mailbox === "object" ? cloneJson(mailbox) : {};
}

function canonicalRecipients(message, registeredRecipients) {
  if (message.to !== "*") return [String(message.to)];
  return [...registeredRecipients]
    .filter((recipient) => recipient !== message.from)
    .sort((left, right) => left.localeCompare(right));
}

function canonicalMessageStatus(message, recipient, receipts, delivered) {
  const receipt = receipts.get(`${recipient}\0${message.id}`);
  if (receipt && CANONICAL_MESSAGE_STATUSES.has(receipt.status)) {
    return receipt.status;
  }
  return Number(delivered.get(recipient) || 0) >= Number(message.id)
    ? "delivered"
    : "admitted";
}

function projectMessages(runId, snapshot, extraRecipients = []) {
  const registeredRecipients = new Set([
    ...(snapshot.recipients || []),
    ...extraRecipients,
  ]);
  const receipts = new Map(snapshot.receipts || []);
  const delivered = new Map(snapshot.delivered || []);
  const messages = [...(snapshot.log || [])]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .flatMap((message) =>
      canonicalRecipients(message, registeredRecipients).map((recipient) => {
        const toAgentId = safeIdentifier(recipient, "team-agent");
        const mode = message.mode === "followup" ? "followup" : "send";
        const payload = {
          subject: cloneJson(message.subject ?? null),
          body: cloneJson(message.body ?? null),
        };
        return {
          id: safeIdentifier(
            `team-message:${message.id}:${toAgentId}`,
            "team-message",
          ),
          runId,
          fromAttemptId: attemptIdentifier(
            message.senderAttempt,
            message.from || "coordinator",
          ),
          toAgentId,
          causationId: optionalIdentifier(message.causationId, "causation"),
          correlationId: optionalIdentifier(
            message.correlationId,
            "correlation",
          ),
          mode,
          status: canonicalMessageStatus(
            message,
            recipient,
            receipts,
            delivered,
          ),
          payload,
          payloadDigest: teamGraphDigest(
            {
              toAgentId,
              mode,
              payload,
              causationId: message.causationId ?? null,
              correlationId: message.correlationId ?? null,
            },
            "cc.team.message/v1",
          ),
          dataPolicy: {
            origin: `team-mailbox:${String(message.from || "coordinator").slice(
              0,
              220,
            )}`,
            trust: "untrusted_content",
            sensitivity: "internal",
            allowedSinks: [`agent:${toAgentId}`],
          },
          createdAt: isoTimestamp(message.ts),
        };
      }),
    );
  const edges = messages
    .filter((message) => ["read", "processed"].includes(message.status))
    .map((message) => ({
      from: message.fromAttemptId,
      to: `agent:${message.toAgentId}`,
      kind: "model_visible_message",
      messageId: message.id,
      causationId: message.causationId,
      correlationId: message.correlationId,
      status: message.status,
    }));
  return { messages, edges };
}

function projectHandoffs(runId, registry) {
  const handoffs = registryTasks(registry)
    .flatMap((task) =>
      (task?.metadata?.custodyHandoffs || []).map((handoff) => ({
        id: safeIdentifier(handoff.id, "team-handoff"),
        runId,
        nodeId: safeIdentifier(task.key, "team-node"),
        fromAttemptId: attemptIdentifier(
          {
            holder: handoff.fromHolder,
            taskKey: task.key,
            leaseId: handoff.fromLeaseId,
            fencingToken: handoff.fromFence,
          },
          handoff.fromHolder,
        ),
        toAgentId: safeIdentifier(handoff.toHolder, "team-agent"),
        revisionDigest: handoff.revisionDigest,
        authorityDigest: handoff.authorityDigest,
        artifactIds: [...(handoff.artifactIds || [])].map((artifactId) =>
          safeIdentifier(artifactId, "team-artifact"),
        ),
        status: handoff.status,
        expiresAt: isoTimestamp(handoff.expiresAtMs),
      })),
    )
    .sort(
      (left, right) =>
        left.expiresAt.localeCompare(right.expiresAt) ||
        left.id.localeCompare(right.id),
    );
  const edges = handoffs.map((handoff) => ({
    from: handoff.fromAttemptId,
    to: `agent:${handoff.toAgentId}`,
    kind: "custody_handoff",
    handoffId: handoff.id,
    nodeId: handoff.nodeId,
    status: handoff.status,
  }));
  return { handoffs, edges };
}

/**
 * Deterministically project Team's durable mailbox and task custody journal
 * into the canonical protocol Message/Handoff vocabulary. This is read-only:
 * TeamMailbox and TaskLeaseRegistry remain the authoritative writers.
 */
export function projectTeamGraphCollaboration({
  runId,
  mailbox,
  registry,
  recipients = [],
  revisionDigest = null,
  authorityDigest = null,
} = {}) {
  const canonicalRunId = safeIdentifier(runId, "team-run");
  const snapshot = mailboxSnapshot(mailbox);
  const messageGraph = projectMessages(canonicalRunId, snapshot, recipients);
  const handoffGraph = projectHandoffs(canonicalRunId, registry);
  const base = {
    schema: TEAM_GRAPH_PROJECTION_SCHEMA,
    runId: canonicalRunId,
    revisionDigest: revisionDigest || computeTeamGraphRevisionDigest(registry),
    authorityDigest:
      authorityDigest || computeTeamGraphAuthorityDigest({ recipients }),
    messageGraph,
    handoffs: handoffGraph.handoffs,
    custodyEdges: handoffGraph.edges,
  };
  const sourceDigest = teamGraphDigest(
    {
      mailbox: snapshot,
      handoffs: registryTasks(registry).map((task) => ({
        key: task.key,
        custodyHandoffs: task?.metadata?.custodyHandoffs || [],
      })),
    },
    "cc.team.projection-source/v1",
  );
  return {
    ...base,
    sourceDigest,
    projectionDigest: teamGraphDigest(
      { ...base, sourceDigest },
      "cc.team.projection/v1",
    ),
  };
}
