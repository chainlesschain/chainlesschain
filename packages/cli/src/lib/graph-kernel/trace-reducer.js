import { graphDigest } from "./compiler.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function latestState(events, throughSeq = Number.MAX_SAFE_INTEGER) {
  return [...events]
    .filter(
      (event) =>
        Number(event.seq) <= throughSeq && event.payload?.state?.version === 1,
    )
    .sort((left, right) => left.seq - right.seq)
    .at(-1)?.payload?.state;
}

function mapFromEntries(entries) {
  return new Map(entries || []);
}

function durationMs(attempt) {
  const start = Date.parse(attempt.createdAt);
  const end = Date.parse(attempt.updatedAt || attempt.createdAt);
  return Math.max(0, end - start);
}

function criticalPath(definition, attempts) {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const duration = new Map(
    definition.nodes.map((node) => [
      node.id,
      Math.max(
        0,
        ...attempts
          .filter((attempt) => attempt.nodeId === node.id)
          .map(durationMs),
      ),
    ]),
  );
  const dependencies = new Map(
    definition.nodes.map((node) => [node.id, new Set(node.dependsOn)]),
  );
  for (const edge of definition.edges) {
    if (
      edge.kind !== "compensation" &&
      nodes.has(edge.to) &&
      nodes.has(edge.from)
    ) {
      dependencies.get(edge.to).add(edge.from);
    }
  }
  const remaining = new Set(nodes.keys());
  const order = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) =>
        [...dependencies.get(id)].every((parent) => order.includes(parent)),
      )
      .sort();
    if (!ready.length) break;
    for (const id of ready) {
      remaining.delete(id);
      order.push(id);
    }
  }
  const longest = new Map();
  const predecessor = new Map();
  for (const id of order) {
    let bestParent = null;
    let best = 0;
    for (const parent of dependencies.get(id)) {
      if ((longest.get(parent) || 0) > best) {
        best = longest.get(parent) || 0;
        bestParent = parent;
      }
    }
    longest.set(id, best + (duration.get(id) || 0));
    predecessor.set(id, bestParent);
  }
  const end = [...longest.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  const path = [];
  let cursor = end?.[0] || null;
  while (cursor) {
    path.unshift(cursor);
    cursor = predecessor.get(cursor) || null;
  }
  return Object.freeze({
    nodeIds: Object.freeze(path),
    durationMs: end?.[1] || 0,
    nodeDurations: Object.freeze(Object.fromEntries(duration)),
  });
}

function redactState(state, includeContent) {
  const output = clone(state);
  if (includeContent) return output;
  output.messages = (output.messages || []).map(([id, message]) => [
    id,
    {
      ...message,
      payload: undefined,
      payloadRef: message.payloadDigest,
    },
  ]);
  output.humanTasks = (output.humanTasks || []).map(([id, task]) => [
    id,
    {
      ...task,
      operation: undefined,
      operationRef: task.operationDigest,
    },
  ]);
  return output;
}

export function reduceGraphTrace(
  events,
  { throughSeq = Number.MAX_SAFE_INTEGER, includeContent = false } = {},
) {
  const ordered = [...events]
    .filter((event) => Number(event.seq) <= throughSeq)
    .sort((left, right) => left.seq - right.seq);
  const rawState = latestState(ordered, throughSeq);
  if (!rawState) {
    const error = new Error("Graph trace contains no runtime state");
    error.code = "CC_GRAPH_TRACE_STATE_MISSING";
    throw error;
  }
  const state = redactState(rawState, includeContent);
  const nodeStates = mapFromEntries(state.nodeStates);
  const attempts = [...mapFromEntries(state.attempts).values()];
  const artifacts = [...mapFromEntries(state.artifacts).values()];
  const effects = [...mapFromEntries(state.effects).values()];
  const messages = [...mapFromEntries(state.messages).values()];
  const handoffs = [...mapFromEntries(state.handoffs).values()];
  const humanTasks = [...mapFromEntries(state.humanTasks).values()];
  const agents = [...mapFromEntries(state.agents).values()];
  const definition = state.definition;
  const taskNodes = definition.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    status: nodeStates.get(node.id)?.status || "unknown",
    blockedRoot: nodeStates.get(node.id)?.blockedRoot || null,
    acceptedAttemptId: nodeStates.get(node.id)?.acceptedAttemptId || null,
    attemptIds: nodeStates.get(node.id)?.attemptIds || [],
    writeSet: node.writeSet || [],
    workspaceIsolation: node.workspaceIsolation || null,
  }));
  const dependencyEdges = [
    ...definition.nodes.flatMap((node) =>
      node.dependsOn.map((parent) => ({
        id: `dependency:${parent}:${node.id}`,
        from: parent,
        to: node.id,
        kind: "control",
        when: "success",
      })),
    ),
    ...definition.edges,
  ];
  const artifactEdges = artifacts.flatMap((artifact) => [
    {
      from: artifact.producerNodeId,
      to: artifact.id,
      kind: "produced",
      digest: artifact.digest,
    },
    ...(artifact.consumerNodeIds || []).map((consumer) => ({
      from: artifact.id,
      to: consumer,
      kind: "consumed",
      digest: artifact.digest,
    })),
  ]);
  // A sender-side API return does not prove model-visible delivery. Only
  // read/processed messages become delivery edges in the semantic trace.
  const messageEdges = messages
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
  const agentTree = agents.map((agent) => ({
    id: agent.id,
    status: agent.status,
    resident: agent.resident,
    capacity: agent.capacity,
    assignments: attempts
      .filter((attempt) => attempt.agentId === agent.id)
      .map((attempt) => attempt.id),
  }));
  const timeline = ordered.map((event) => ({
    seq: event.seq,
    timestamp: event.timestamp,
    type: event.type,
    hash: event.hash,
    details: clone(event.payload?.details || null),
  }));
  const projection = {
    schema: "chainlesschain.graph-trace-projection/v1",
    runId: state.id,
    throughSeq: ordered.at(-1)?.seq || 0,
    eventHeadHash: ordered.at(-1)?.hash || null,
    definitionId: definition.id,
    graphRevision: state.graphRevision,
    revisionDigest: state.revisionDigest,
    phase: state.phase,
    status: state.status,
    agentTree,
    taskGraph: { nodes: taskNodes, edges: dependencyEdges },
    artifactGraph: { artifacts, edges: artifactEdges },
    effects,
    messageGraph: { messages, edges: messageEdges },
    attempts,
    handoffs,
    humanTasks,
    criticalPath: criticalPath(definition, attempts),
    timeline,
  };
  projection.projectionDigest = graphDigest(
    projection,
    "cc.graph.trace-projection/v1",
  );
  return Object.freeze(clone(projection));
}

export function timeTravelGraphTrace(events, throughSeq, options = {}) {
  return reduceGraphTrace(events, { ...options, throughSeq });
}

export function diffGraphTrace(left, right) {
  const leftNodes = new Map(
    left.taskGraph.nodes.map((node) => [node.id, node]),
  );
  const rightNodes = new Map(
    right.taskGraph.nodes.map((node) => [node.id, node]),
  );
  const nodeIds = [
    ...new Set([...leftNodes.keys(), ...rightNodes.keys()]),
  ].sort();
  const nodes = nodeIds
    .map((id) => {
      const before = leftNodes.get(id) || null;
      const after = rightNodes.get(id) || null;
      if (JSON.stringify(before) === JSON.stringify(after)) return null;
      return { id, before, after };
    })
    .filter(Boolean);
  const leftArtifacts = new Map(
    left.artifactGraph.artifacts.map((artifact) => [
      artifact.id,
      artifact.digest,
    ]),
  );
  const rightArtifacts = new Map(
    right.artifactGraph.artifacts.map((artifact) => [
      artifact.id,
      artifact.digest,
    ]),
  );
  const artifactIds = [
    ...new Set([...leftArtifacts.keys(), ...rightArtifacts.keys()]),
  ].sort();
  const artifacts = artifactIds
    .map((id) => {
      const before = leftArtifacts.get(id) || null;
      const after = rightArtifacts.get(id) || null;
      return before === after ? null : { id, before, after };
    })
    .filter(Boolean);
  return Object.freeze({
    schema: "chainlesschain.graph-trace-diff/v1",
    from: {
      runId: left.runId,
      throughSeq: left.throughSeq,
      projectionDigest: left.projectionDigest,
    },
    to: {
      runId: right.runId,
      throughSeq: right.throughSeq,
      projectionDigest: right.projectionDigest,
    },
    nodes: Object.freeze(nodes.map(Object.freeze)),
    artifacts: Object.freeze(artifacts.map(Object.freeze)),
  });
}

export function locateBlockedRoot(projection, nodeId) {
  const node = projection.taskGraph.nodes.find((entry) => entry.id === nodeId);
  if (!node) return null;
  const chain = [];
  let cursor = node;
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor.id);
    if (!cursor.blockedRoot || cursor.blockedRoot === cursor.id) break;
    const next = projection.taskGraph.nodes.find(
      (entry) => entry.id === cursor.blockedRoot,
    );
    if (!next) break;
    cursor = next;
  }
  return Object.freeze({
    root: chain.at(-1) || null,
    chain: Object.freeze(chain),
  });
}
