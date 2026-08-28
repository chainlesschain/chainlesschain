const MAX_DEBUG_NODES = 250;
const MAX_DEBUG_EVENTS = 1000;
const MAX_REPLAY_FRAMES = 200;

const STATUS_ALIASES = Object.freeze({
  succeeded: "completed",
  success: "completed",
  cancelled: "skipped",
  blocked: "failed",
  deadlocked: "failed",
  budget_exhausted: "failed",
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function boundedText(value, maxLength = 256) {
  const text = String(value ?? "");
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTimestamp(event, fallback) {
  return (
    timestampMs(
      event?.timestamp ??
        event?.createdAt ??
        event?.created_at ??
        event?.payload?.timestamp,
    ) ?? fallback
  );
}

function eventIdentifier(event, index) {
  return boundedText(
    event?.id ??
      event?.eventId ??
      event?.event_id ??
      event?.payload?.eventId ??
      `event-${index + 1}`,
    256,
  );
}

function normalizeStatus(value) {
  const status = String(value || "pending").toLowerCase();
  return STATUS_ALIASES[status] || status;
}

function normalizeNode(raw, fallbackId, orderIndex) {
  const id = boundedText(
    raw?.id ?? raw?.nodeId ?? raw?.node_id ?? fallbackId,
    256,
  );
  const rawMetadata =
    raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const startedAt = timestampMs(
    raw?.startedAt ?? raw?.started_at ?? rawMetadata.startedAt,
  );
  const completedAt = timestampMs(
    raw?.completedAt ?? raw?.completed_at ?? rawMetadata.completedAt,
  );
  const measuredDuration =
    startedAt !== null && completedAt !== null && completedAt >= startedAt
      ? completedAt - startedAt
      : null;
  const durationMs = Math.max(
    1,
    measuredDuration ??
      finiteNumber(
        raw?.durationMs ?? rawMetadata.durationMs ?? rawMetadata.duration_ms,
        1,
      ),
  );

  const dependencies = raw?.dependsOn ?? raw?.dependencies ?? [];
  return {
    id,
    title: boundedText(raw?.title ?? raw?.name ?? id, 512),
    description:
      typeof raw?.description === "string"
        ? boundedText(raw.description, 2048)
        : null,
    status: normalizeStatus(raw?.status),
    blockedRoot:
      raw?.blockedRoot === null || raw?.blockedRoot === undefined
        ? null
        : boundedText(raw.blockedRoot, 256),
    dependsOn: Array.isArray(dependencies)
      ? [
          ...new Set(
            dependencies
              .map((dependency) => boundedText(dependency, 256))
              .filter(Boolean),
          ),
        ]
      : [],
    metadata: {
      durationMs: rawMetadata.durationMs,
      duration_ms: rawMetadata.duration_ms,
      budget:
        rawMetadata.budget && typeof rawMetadata.budget === "object"
          ? {
              used: rawMetadata.budget.used,
              consumed: rawMetadata.budget.consumed,
              tokensUsed: rawMetadata.budget.tokensUsed,
              limit: rawMetadata.budget.limit,
              max: rawMetadata.budget.max,
              tokenLimit: rawMetadata.budget.tokenLimit,
            }
          : null,
      budgetUsed: rawMetadata.budgetUsed,
      tokensUsed: rawMetadata.tokensUsed,
      usedTokens: rawMetadata.usedTokens,
      budgetLimit: rawMetadata.budgetLimit,
      tokenBudget: rawMetadata.tokenBudget,
    },
    startedAt,
    completedAt,
    durationMs,
    orderIndex,
  };
}

function normalizeGraphNodes(graph) {
  const rawNodes = graph?.taskGraph?.nodes ?? graph?.nodes;
  const byId = new Map();
  const rawEntries = Array.isArray(rawNodes)
    ? rawNodes.map((node, index) => [`node-${index + 1}`, node])
    : rawNodes && typeof rawNodes === "object"
      ? Object.entries(rawNodes)
      : [];
  const rawIds = rawEntries.map(([fallbackId, node]) =>
    boundedText(node?.id ?? node?.nodeId ?? node?.node_id ?? fallbackId, 256),
  );
  const retainedRawIds = new Set(rawIds);
  const edgeDependencies = new Map(rawIds.map((id) => [id, []]));
  const rawEdges = [
    ...(Array.isArray(graph?.taskGraph?.edges) ? graph.taskGraph.edges : []),
    ...(Array.isArray(graph?.edges) ? graph.edges : []),
  ];
  for (const edge of rawEdges) {
    const from = boundedText(edge?.from ?? edge?.source ?? "", 256);
    const to = boundedText(edge?.to ?? edge?.target ?? "", 256);
    if (retainedRawIds.has(from) && retainedRawIds.has(to)) {
      edgeDependencies.get(to).push(from);
    }
  }
  const attemptsByNode = new Map();
  for (const attempt of Array.isArray(graph?.attempts) ? graph.attempts : []) {
    const nodeId = boundedText(
      attempt?.nodeId ?? attempt?.node_id ?? attempt?.taskId ?? "",
      256,
    );
    if (!nodeId) {
      continue;
    }
    const attempts = attemptsByNode.get(nodeId) || [];
    attempts.push(attempt);
    attemptsByNode.set(nodeId, attempts);
  }

  rawEntries.forEach(([fallbackId, rawNode], index) => {
    const node = rawNode && typeof rawNode === "object" ? rawNode : {};
    const nodeId = rawIds[index];
    const nodeAttempts = attemptsByNode.get(nodeId) || [];
    const attemptDurationMs = nodeAttempts.reduce((total, attempt) => {
      const startedAt = timestampMs(
        attempt?.startedAt ?? attempt?.createdAt ?? attempt?.created_at,
      );
      const completedAt = timestampMs(
        attempt?.completedAt ?? attempt?.updatedAt ?? attempt?.updated_at,
      );
      return (
        total +
        (startedAt !== null && completedAt !== null && completedAt >= startedAt
          ? completedAt - startedAt
          : 0)
      );
    }, 0);
    const tokensUsed = nodeAttempts.reduce(
      (total, attempt) =>
        total +
        finiteNumber(
          attempt?.usage?.tokens ??
            attempt?.usage?.tokensUsed ??
            (Number(attempt?.usage?.input_tokens) || 0) +
              (Number(attempt?.usage?.output_tokens) || 0),
          0,
        ),
      0,
    );
    const dependencies = [
      ...(Array.isArray(node.dependsOn)
        ? node.dependsOn
        : Array.isArray(node.dependencies)
          ? node.dependencies
          : []),
      ...(edgeDependencies.get(nodeId) || []),
    ];
    const normalized = normalizeNode(
      {
        ...node,
        dependsOn: dependencies,
        metadata: {
          ...(node.metadata && typeof node.metadata === "object"
            ? node.metadata
            : {}),
          ...(attemptDurationMs > 0 ? { durationMs: attemptDurationMs } : {}),
          ...(tokensUsed > 0 ? { tokensUsed } : {}),
        },
      },
      fallbackId,
      index,
    );
    byId.set(normalized.id, normalized);
  });

  const preferredOrder = Array.isArray(graph?.order)
    ? [
        ...new Set(
          graph.order.map((id) => boundedText(id, 256)).filter(Boolean),
        ),
      ]
    : [];
  const orderedIds = [
    ...preferredOrder.filter((id) => byId.has(id)),
    ...[...byId.keys()].filter((id) => !preferredOrder.includes(id)),
  ];
  const retainedIds = new Set(orderedIds.slice(0, MAX_DEBUG_NODES));
  const nodes = orderedIds.slice(0, MAX_DEBUG_NODES).map((id, orderIndex) => ({
    ...byId.get(id),
    orderIndex,
    dependsOn: byId
      .get(id)
      .dependsOn.filter((dependency) => retainedIds.has(dependency)),
  }));

  return {
    nodes,
    totalNodes: byId.size,
    truncatedNodes: Math.max(0, byId.size - nodes.length),
  };
}

function topologicalProjection(graph) {
  const normalized = normalizeGraphNodes(graph);
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]));
  const successors = new Map(normalized.nodes.map((node) => [node.id, []]));
  const indegree = new Map(normalized.nodes.map((node) => [node.id, 0]));
  const edges = [];

  for (const node of normalized.nodes) {
    for (const dependency of node.dependsOn) {
      successors.get(dependency)?.push(node.id);
      indegree.set(node.id, (indegree.get(node.id) || 0) + 1);
      edges.push({
        id: `${dependency}->${node.id}`,
        from: dependency,
        to: node.id,
      });
    }
  }

  const queue = normalized.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((node) => node.id);
  const topo = [];
  while (queue.length > 0) {
    const id = queue.shift();
    topo.push(id);
    for (const child of successors.get(id) || []) {
      const next = (indegree.get(child) || 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        queue.push(child);
        queue.sort(
          (left, right) =>
            nodesById.get(left).orderIndex - nodesById.get(right).orderIndex,
        );
      }
    }
  }

  const cyclicIds = normalized.nodes
    .map((node) => node.id)
    .filter((id) => !topo.includes(id));
  topo.push(...cyclicIds);
  const cyclic = new Set(cyclicIds);
  const depth = new Map();
  const earliestStart = new Map();
  const earliestFinish = new Map();

  for (const id of topo) {
    const node = nodesById.get(id);
    const parentFinishes = node.dependsOn.map(
      (dependency) => earliestFinish.get(dependency) || 0,
    );
    const parentDepths = node.dependsOn.map(
      (dependency) => depth.get(dependency) || 0,
    );
    const start = parentFinishes.length ? Math.max(...parentFinishes) : 0;
    depth.set(id, parentDepths.length ? Math.max(...parentDepths) + 1 : 0);
    earliestStart.set(id, start);
    earliestFinish.set(id, start + node.durationMs);
  }

  const projectDuration = Math.max(0, ...earliestFinish.values());
  const latestFinish = new Map();
  const latestStart = new Map();
  for (const id of [...topo].reverse()) {
    const children = successors.get(id) || [];
    const finish = children.length
      ? Math.min(...children.map((child) => latestStart.get(child)))
      : projectDuration;
    latestFinish.set(id, finish);
    latestStart.set(id, finish - nodesById.get(id).durationMs);
  }

  const layers = new Map();
  const declaredCriticalPath = Array.isArray(graph?.criticalPath?.nodeIds)
    ? graph.criticalPath.nodeIds.map((id) => boundedText(id, 256))
    : [];
  const declaredCriticalIds = new Set(declaredCriticalPath);
  const projectedNodes = topo.map((id) => {
    const node = nodesById.get(id);
    const nodeDepth = depth.get(id) || 0;
    const layerIndex = layers.get(nodeDepth) || 0;
    layers.set(nodeDepth, layerIndex + 1);
    const slackMs = Math.max(
      0,
      (latestStart.get(id) || 0) - (earliestStart.get(id) || 0),
    );
    return {
      ...node,
      depth: nodeDepth,
      x: 32 + nodeDepth * 220,
      y: 32 + layerIndex * 92,
      earliestStartMs: earliestStart.get(id) || 0,
      earliestFinishMs: earliestFinish.get(id) || 0,
      slackMs,
      critical:
        !cyclic.has(id) &&
        (declaredCriticalIds.size > 0
          ? declaredCriticalIds.has(id)
          : slackMs < 0.5),
      cyclic: cyclic.has(id),
    };
  });
  const projectedById = new Map(projectedNodes.map((node) => [node.id, node]));
  const projectedEdges = edges.map((edge) => {
    const source = projectedById.get(edge.from);
    const target = projectedById.get(edge.to);
    return {
      ...edge,
      critical: Boolean(
        declaredCriticalIds.size > 0
          ? declaredCriticalPath.some(
              (id, index) =>
                id === edge.from && declaredCriticalPath[index + 1] === edge.to,
            )
          : source?.critical &&
              target?.critical &&
              Math.abs(source.earliestFinishMs - target.earliestStartMs) < 0.5,
      ),
    };
  });

  const blockedRootIds = projectedNodes
    .filter((node) => {
      if (node.blockedRoot) {
        return true;
      }
      if (node.status === "failed") {
        return true;
      }
      if (!["pending", "ready"].includes(node.status)) {
        return false;
      }
      return node.dependsOn.some(
        (dependency) => projectedById.get(dependency)?.status === "failed",
      );
    })
    .map((node) => node.id);

  return {
    ...normalized,
    nodes: projectedNodes,
    edges: projectedEdges,
    projectDurationMs: projectDuration,
    cyclicNodeIds: cyclicIds,
    blockedRootIds,
    width: Math.max(520, (Math.max(0, ...depth.values()) + 1) * 220 + 48),
    height: Math.max(220, Math.max(0, ...layers.values()) * 92 + 48),
  };
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
  }
  return null;
}

function budgetProjection(nodes, graph = null) {
  const items = nodes.map((node) => {
    const budget =
      node.metadata?.budget && typeof node.metadata.budget === "object"
        ? node.metadata.budget
        : {};
    const used = firstFinite(
      budget.used,
      budget.consumed,
      budget.tokensUsed,
      node.metadata?.budgetUsed,
      node.metadata?.tokensUsed,
      node.metadata?.usedTokens,
    );
    const limit = firstFinite(
      budget.limit,
      budget.max,
      budget.tokenLimit,
      node.metadata?.budgetLimit,
      node.metadata?.tokenBudget,
    );
    const ratio = limit && used !== null ? used / limit : null;
    const heat =
      ratio === null
        ? "unknown"
        : ratio >= 1
          ? "exhausted"
          : ratio >= 0.8
            ? "high"
            : ratio >= 0.5
              ? "medium"
              : "low";
    return { nodeId: node.id, title: node.title, used, limit, ratio, heat };
  });
  const known = items.filter(
    (item) => item.used !== null && item.limit !== null && item.limit > 0,
  );
  const totalUsed = known.reduce((sum, item) => sum + item.used, 0);
  const totalLimit = known.reduce((sum, item) => sum + item.limit, 0);
  const runBudget = graph?.budget || {};
  const runBudgetUsed = graph?.budgetUsed || graph?.usage || {};
  const dimensions = ["tokens", "turns", "costUsd", "wallMs"]
    .map((field) => ({
      field,
      used: firstFinite(runBudgetUsed[field]),
      limit: firstFinite(runBudget[field]),
    }))
    .filter((item) => item.used !== null || item.limit !== null);
  return {
    items,
    knownCount: known.length,
    totalUsed,
    totalLimit,
    ratio: totalLimit > 0 ? totalUsed / totalLimit : null,
    dimensions,
  };
}

function eventCategory(type) {
  const value = String(type || "unknown").toLowerCase();
  if (value.includes("approval") || value.includes("question")) {
    return "approval";
  }
  if (value.includes("message") || value.includes("handoff")) {
    return "message";
  }
  if (value.includes("effect") || value.includes("tool")) {
    return "effect";
  }
  if (value.includes("artifact") || value.includes("commit")) {
    return "artifact";
  }
  if (value.includes("lease") || value.includes("worktree")) {
    return "lease";
  }
  if (value.includes("agent")) {
    return "agent";
  }
  return "task";
}

function eventProjection(events) {
  const retained = (Array.isArray(events) ? events : []).slice(
    -MAX_DEBUG_EVENTS,
  );
  return retained
    .map((event, index) => {
      const payload =
        event?.payload && typeof event.payload === "object"
          ? event.payload
          : {};
      const details =
        event?.details && typeof event.details === "object"
          ? event.details
          : {};
      const rawNodeId =
        payload.nodeId ??
        payload.node_id ??
        payload.taskId ??
        payload.task_id ??
        details.nodeId ??
        details.node_id ??
        details.taskId ??
        event?.nodeId ??
        null;
      const rawCausationId =
        event?.causationId ??
        event?.causation_id ??
        payload.causationId ??
        payload.causation_id ??
        payload.parentEventId ??
        details.causationId ??
        details.parentEventId ??
        null;
      return {
        id:
          event?.seq === null || event?.seq === undefined
            ? eventIdentifier(event, index)
            : boundedText(`seq-${event.seq}`, 256),
        type: boundedText(event?.type || "unknown", 160),
        category: eventCategory(event?.type),
        timestamp: eventTimestamp(event, index),
        nodeId: rawNodeId === null ? null : boundedText(rawNodeId, 256),
        causationId:
          rawCausationId === null ? null : boundedText(rawCausationId, 256),
        requestId:
          (event?.requestId ?? payload.requestId ?? details.requestId)
            ? boundedText(
                event?.requestId ?? payload.requestId ?? details.requestId,
                256,
              )
            : null,
        status:
          (event?.status ??
          payload.status ??
          payload.decision ??
          payload.outcome ??
          details.status ??
          details.outcome)
            ? boundedText(
                event?.status ??
                  payload.status ??
                  payload.decision ??
                  payload.outcome ??
                  details.status ??
                  details.outcome,
                160,
              )
            : null,
      };
    })
    .sort((left, right) => left.timestamp - right.timestamp);
}

function canonicalEventCandidates(graph) {
  if (!graph || typeof graph !== "object") {
    return [];
  }
  const candidates = Array.isArray(graph.timeline) ? [...graph.timeline] : [];
  const attempts = Array.isArray(graph.attempts) ? graph.attempts : [];
  const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  for (const attempt of attempts) {
    candidates.push({
      id: `lease:${attempt.id}`,
      type: `lease.${attempt.status || "observed"}`,
      timestamp:
        attempt.updatedAt ?? attempt.completedAt ?? attempt.createdAt ?? null,
      nodeId: attempt.nodeId ?? null,
      status: attempt.status ?? null,
    });
  }
  for (const message of graph?.messageGraph?.messages || []) {
    const attempt = attemptById.get(message.fromAttemptId);
    candidates.push({
      id: message.id,
      type: `message.${message.status || "observed"}`,
      timestamp: message.updatedAt ?? message.createdAt ?? null,
      nodeId: attempt?.nodeId ?? message.nodeId ?? null,
      causationId: message.causationId ?? null,
      status: message.status ?? null,
    });
  }
  for (const task of graph.humanTasks || []) {
    candidates.push({
      id: task.id,
      type: `approval.${task.status || "observed"}`,
      timestamp: task.updatedAt ?? task.createdAt ?? null,
      nodeId: task.nodeId ?? null,
      causationId: task.causationId ?? null,
      status: task.status ?? null,
    });
  }
  for (const artifact of graph?.artifactGraph?.artifacts || []) {
    candidates.push({
      id: artifact.id,
      type: "artifact.registered",
      timestamp: artifact.createdAt ?? null,
      nodeId: artifact.producerNodeId ?? null,
      status: artifact.status ?? "registered",
    });
  }
  for (const effect of graph.effects || []) {
    candidates.push({
      id: effect.id,
      type: `effect.${effect.status || "observed"}`,
      timestamp: effect.updatedAt ?? effect.createdAt ?? null,
      nodeId: effect.nodeId ?? null,
      causationId: effect.attemptId ?? null,
      status: effect.status ?? null,
    });
  }
  return candidates;
}

function evidenceProjection(graph) {
  const attempts = (Array.isArray(graph?.attempts) ? graph.attempts : [])
    .slice(-MAX_DEBUG_EVENTS)
    .map((attempt) => ({
      id: boundedText(attempt?.id ?? "unknown-attempt", 256),
      nodeId:
        attempt?.nodeId === null || attempt?.nodeId === undefined
          ? null
          : boundedText(attempt.nodeId, 256),
      agentId:
        attempt?.agentId === null || attempt?.agentId === undefined
          ? null
          : boundedText(attempt.agentId, 256),
      status: boundedText(attempt?.status ?? "unknown", 160),
      leaseId:
        attempt?.leaseId === null || attempt?.leaseId === undefined
          ? null
          : boundedText(attempt.leaseId, 256),
      fence: Number.isFinite(Number(attempt?.fence))
        ? Number(attempt.fence)
        : null,
      workspaceRef:
        (attempt?.worktreeId ?? attempt?.workspaceId ?? attempt?.workspace)
          ? boundedText(
              attempt.worktreeId ?? attempt.workspaceId ?? attempt.workspace,
              512,
            )
          : null,
      commit:
        attempt?.terminalEvidence?.commit === null ||
        attempt?.terminalEvidence?.commit === undefined
          ? null
          : boundedText(attempt.terminalEvidence.commit, 256),
      outputDigest:
        attempt?.terminalEvidence?.outputDigest === null ||
        attempt?.terminalEvidence?.outputDigest === undefined
          ? null
          : boundedText(attempt.terminalEvidence.outputDigest, 256),
      artifactIds: Array.isArray(attempt?.terminalEvidence?.artifactIds)
        ? attempt.terminalEvidence.artifactIds
            .slice(0, 100)
            .map((id) => boundedText(id, 256))
        : [],
      testReceiptIds: Array.isArray(attempt?.terminalEvidence?.testReceiptIds)
        ? attempt.terminalEvidence.testReceiptIds
            .slice(0, 100)
            .map((id) => boundedText(id, 256))
        : [],
    }));
  const directAgents = Array.isArray(graph?.agentTree) ? graph.agentTree : [];
  const agents = directAgents.length
    ? directAgents.slice(0, MAX_DEBUG_NODES).map((agent) => ({
        id: boundedText(agent?.id ?? "unknown-agent", 256),
        status: boundedText(agent?.status ?? "unknown", 160),
        resident: agent?.resident === true,
        capacity: firstFinite(agent?.capacity),
        assignments: Array.isArray(agent?.assignments)
          ? agent.assignments.slice(0, 100).map((id) => boundedText(id, 256))
          : [],
      }))
    : [...new Set(attempts.map((attempt) => attempt.agentId).filter(Boolean))]
        .slice(0, MAX_DEBUG_NODES)
        .map((agentId) => ({
          id: agentId,
          status: "observed",
          resident: false,
          capacity: null,
          assignments: attempts
            .filter((attempt) => attempt.agentId === agentId)
            .map((attempt) => attempt.id),
        }));
  const artifacts = (graph?.artifactGraph?.artifacts || [])
    .slice(0, MAX_DEBUG_EVENTS)
    .map((artifact) => ({
      id: boundedText(artifact?.id ?? "unknown-artifact", 256),
      producerNodeId:
        artifact?.producerNodeId === null ||
        artifact?.producerNodeId === undefined
          ? null
          : boundedText(artifact.producerNodeId, 256),
      digest:
        artifact?.digest === null || artifact?.digest === undefined
          ? null
          : boundedText(artifact.digest, 256),
      consumerNodeIds: Array.isArray(artifact?.consumerNodeIds)
        ? artifact.consumerNodeIds
            .slice(0, 100)
            .map((id) => boundedText(id, 256))
        : [],
    }));
  const effects = (Array.isArray(graph?.effects) ? graph.effects : [])
    .slice(0, MAX_DEBUG_EVENTS)
    .map((effect) => ({
      id: boundedText(effect?.id ?? "unknown-effect", 256),
      nodeId:
        effect?.nodeId === null || effect?.nodeId === undefined
          ? null
          : boundedText(effect.nodeId, 256),
      status: boundedText(effect?.status ?? "unknown", 160),
      attemptId:
        effect?.attemptId === null || effect?.attemptId === undefined
          ? null
          : boundedText(effect.attemptId, 256),
    }));
  return { agents, attempts, artifacts, effects };
}

function graphFingerprint(graph) {
  const { nodes } = normalizeGraphNodes(graph);
  return JSON.stringify({
    id: graph?.graphId ?? graph?.runId ?? graph?.id ?? null,
    revision: graph?.revision ?? graph?.projectionVersion ?? null,
    status: graph?.status ?? null,
    nodes: nodes.map((node) => [node.id, node.status]),
  });
}

function buildReplayFrames(graph, events) {
  const candidates = [];
  for (const [index, event] of (Array.isArray(events)
    ? events
    : []
  ).entries()) {
    const snapshot = event?.payload?.graph ?? event?.graph ?? null;
    if (!snapshot || typeof snapshot !== "object") {
      continue;
    }
    candidates.push({
      id: eventIdentifier(event, index),
      type: boundedText(event?.type || "graph.snapshot", 160),
      timestamp: eventTimestamp(event, index),
      graph: snapshot,
    });
  }
  if (graph && typeof graph === "object") {
    candidates.push({
      id: "current",
      type: "current",
      timestamp:
        timestampMs(graph.updatedAt ?? graph.updated_at) ??
        (candidates.at(-1)?.timestamp ?? 0) + 1,
      graph,
    });
  }
  candidates.sort((left, right) => left.timestamp - right.timestamp);

  const deduplicated = [];
  let previousFingerprint = null;
  for (const candidate of candidates) {
    const fingerprint = graphFingerprint(candidate.graph);
    if (fingerprint === previousFingerprint) {
      continue;
    }
    deduplicated.push({ ...candidate, fingerprint });
    previousFingerprint = fingerprint;
  }
  return deduplicated.slice(-MAX_REPLAY_FRAMES);
}

function diffGraphs(previousGraph, currentGraph) {
  const previous = new Map(
    normalizeGraphNodes(previousGraph).nodes.map((node) => [node.id, node]),
  );
  const current = new Map(
    normalizeGraphNodes(currentGraph).nodes.map((node) => [node.id, node]),
  );
  const added = [...current.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  const statusChanged = [...current.values()]
    .filter(
      (node) =>
        previous.has(node.id) && previous.get(node.id).status !== node.status,
    )
    .map((node) => ({
      nodeId: node.id,
      from: previous.get(node.id).status,
      to: node.status,
    }));
  return { added, removed, statusChanged };
}

function createGraphDebuggerProjection(graph, events = []) {
  const topology = topologicalProjection(graph);
  const timeline = eventProjection([
    ...canonicalEventCandidates(graph),
    ...(Array.isArray(events) ? events : []),
  ]);
  const eventIds = new Set(timeline.map((event) => event.id));
  const causalLinks = timeline
    .filter(
      (event) => event.causationId && eventIds.has(String(event.causationId)),
    )
    .map((event) => ({
      from: String(event.causationId),
      to: event.id,
      nodeId: event.nodeId ? String(event.nodeId) : null,
    }));
  return {
    topology,
    timeline,
    causalLinks,
    budget: budgetProjection(topology.nodes, graph),
    evidence: evidenceProjection(graph),
  };
}

export {
  MAX_DEBUG_NODES,
  MAX_DEBUG_EVENTS,
  MAX_REPLAY_FRAMES,
  normalizeGraphNodes,
  topologicalProjection,
  budgetProjection,
  eventProjection,
  canonicalEventCandidates,
  evidenceProjection,
  buildReplayFrames,
  diffGraphs,
  createGraphDebuggerProjection,
};
