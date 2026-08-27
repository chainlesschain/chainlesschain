"use strict";

const { createHash } = require("node:crypto");
const { desktopGraphAuthorityMode } = require("./desktop-runtime-authority.js");

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TERMINAL_RUN = new Set([
  "succeeded",
  "failed",
  "partial",
  "cancelled",
  "blocked",
  "deadlocked",
  "budget_exhausted",
  "compensated",
  "compensation_failed",
]);

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "DesktopGraphExecutionAdapterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function graphIdentifier(value, prefix = "desktop-graph") {
  const text = String(value || "").trim();
  if (IDENTIFIER.test(text)) return text;
  return `${prefix}-${createHash("sha256")
    .update(text, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function boundedPrompt(value, maxBytes = 16 * 1024) {
  let text;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value ?? null);
    } catch {
      text = String(value ?? "");
    }
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  return `${bytes.subarray(0, maxBytes).toString("utf8")}\n[truncated]`;
}

function graphDefinition({ id, nodes, turns, metadata = {} }) {
  return {
    schemaVersion: 1,
    id: graphIdentifier(id, "desktop-definition"),
    revision: 1,
    nodes,
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: { turns: Math.max(1, Number(turns) || nodes.length || 1) },
    allowedCapabilities: [],
    metadata: { originSurface: "desktop", ...metadata },
  };
}

function buildSpecializedAgentsGraph(plan, sessionId, options = {}) {
  const subtasks = Array.isArray(plan?.subtasks) ? plan.subtasks : [];
  if (subtasks.length === 0) {
    throw adapterError(
      "CC_DESKTOP_GRAPH_DEFINITION_EMPTY",
      "Specialized Agent plan has no executable Graph nodes",
    );
  }
  const taskToNode = new Map(
    subtasks.map((subtask, index) => {
      const key = subtask.subtaskId || subtask.id || `subtask-${index + 1}`;
      return [key, graphIdentifier(key, "desktop-agent-node")];
    }),
  );
  const nodes = subtasks.map((subtask, index) => {
    const key = subtask.subtaskId || subtask.id || `subtask-${index + 1}`;
    const nodeId = taskToNode.get(key);
    return {
      id: nodeId,
      kind: "task",
      dependsOn: (subtask.dependencies || []).map((dependency) => {
        const target = taskToNode.get(dependency);
        if (!target) {
          throw adapterError(
            "CC_DESKTOP_GRAPH_DEPENDENCY_UNKNOWN",
            `Specialized Agent task ${key} depends on unknown task ${dependency}`,
          );
        }
        return target;
      }),
      inputs: [],
      outputs: [],
      effectClass: "workspace_write",
      idempotencyKey: `desktop-agents:${sessionId}:${nodeId}`,
      workspaceIsolation: "declared_scope",
      writeSet:
        Array.isArray(options.scopePaths) && options.scopePaths.length
          ? options.scopePaths.map(String)
          : ["**"],
      retryLimit: 0,
    };
  });
  const inputs = Object.fromEntries(
    subtasks.map((subtask, index) => {
      const key = subtask.subtaskId || subtask.id || `subtask-${index + 1}`;
      const role = subtask.agentType || "general-purpose";
      return [
        taskToNode.get(key),
        {
          prompt: [
            `Act as the approved Desktop specialized agent role: ${role}.`,
            boundedPrompt(subtask.subtask || subtask.description || key),
            "Return immutable output, artifact, commit, or test evidence.",
          ].join("\n"),
        },
      ];
    }),
  );
  return {
    definition: graphDefinition({
      id: `desktop-specialized-agents:${sessionId}`,
      nodes,
      turns: subtasks.length,
      metadata: { kind: "specialized_agents", sessionId },
    }),
    inputs,
    taskToNode,
  };
}

function buildWorkflowGraph(workflow, input) {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  if (stages.length === 0) {
    throw adapterError(
      "CC_DESKTOP_GRAPH_DEFINITION_EMPTY",
      "Desktop Workflow has no executable Graph stages",
    );
  }
  const stageToNode = new Map(
    stages.map((stage, index) => [
      stage.id || `stage-${index + 1}`,
      graphIdentifier(
        stage.id || `stage-${index + 1}`,
        "desktop-workflow-node",
      ),
    ]),
  );
  const nodes = stages.map((stage, index) => {
    const stageId = stage.id || `stage-${index + 1}`;
    const previous = index > 0 ? stages[index - 1] : null;
    return {
      id: stageToNode.get(stageId),
      kind: "task",
      dependsOn: previous
        ? [stageToNode.get(previous.id || `stage-${index}`)]
        : [],
      inputs: [],
      outputs: [],
      effectClass: "workspace_write",
      idempotencyKey: `desktop-workflow:${workflow.id}:${stageToNode.get(stageId)}`,
      workspaceIsolation: "declared_scope",
      writeSet: ["**"],
      retryLimit: 0,
    };
  });
  const workflowInput = boundedPrompt(input);
  const inputs = Object.fromEntries(
    stages.map((stage, index) => {
      const stageId = stage.id || `stage-${index + 1}`;
      return [
        stageToNode.get(stageId),
        {
          prompt: [
            `Execute approved Desktop workflow stage ${index + 1}/${stages.length}: ${stage.name || stageId}.`,
            workflow.description ? `Workflow: ${workflow.description}` : "",
            `Input: ${workflowInput}`,
            "Return immutable output, artifact, commit, or test evidence.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];
    }),
  );
  return {
    definition: graphDefinition({
      id: `desktop-workflow:${workflow.id}`,
      nodes,
      turns: stages.length,
      metadata: { kind: "workflow_manager", workflowId: workflow.id },
    }),
    inputs,
    stageToNode,
  };
}

function terminalAttempt(projection, nodeId) {
  return (projection.attempts || []).find(
    (attempt) =>
      attempt.nodeId === nodeId &&
      attempt.status === "accepted" &&
      validTerminalEvidence(attempt.terminalEvidence),
  );
}

function validTerminalEvidence(evidence) {
  return Boolean(
    evidence &&
    (DIGEST.test(String(evidence.outputDigest || "")) ||
      (typeof evidence.commit === "string" && evidence.commit.trim()) ||
      (Array.isArray(evidence.artifactIds) && evidence.artifactIds.length) ||
      (Array.isArray(evidence.testReceiptIds) &&
        evidence.testReceiptIds.length)),
  );
}

function projectGraphNodes(projection, entries) {
  const nodes = new Map(
    (projection.nodes || []).map((node) => [node.nodeId, node]),
  );
  return entries.map(({ key, nodeId, metadata = {} }) => {
    const node = nodes.get(nodeId);
    const attempt = terminalAttempt(projection, nodeId);
    const success = node?.status === "succeeded" && Boolean(attempt);
    return {
      key,
      nodeId,
      status: node?.status || "unknown",
      success,
      graphRunId: projection.id,
      graphAttemptId: attempt?.id || null,
      terminalEvidence: attempt?.terminalEvidence || null,
      error: success
        ? null
        : `canonical Graph node settled as ${node?.status || "unknown"}`,
      ...metadata,
    };
  });
}

class DesktopGraphExecutionAdapter {
  constructor(options = {}) {
    this.surface = graphIdentifier(
      options.surface || "desktop",
      "desktop-surface",
    );
    this.clientProvider =
      typeof options.clientProvider === "function"
        ? options.clientProvider
        : () => options.client || null;
    this.entryId =
      options.entryId ||
      ({
        desktop_specialized_agents: "desktop-specialized-agents",
        desktop_workflow_manager: "desktop-workflow-manager",
        desktop_team: "desktop-team",
      }[this.surface] ??
        null);
    this.authorityMode =
      typeof options.authorityMode === "function"
        ? options.authorityMode
        : ({ runKey, optIn } = {}) =>
            desktopGraphAuthorityMode(process.env, {
              entryId: this.entryId,
              runKey,
              optIn,
            });
  }

  mode(runKey = undefined, { optIn = false } = {}) {
    return this.authorityMode({
      entryId: this.entryId,
      runKey,
      optIn: optIn === true,
    });
  }

  _mode(runId, pinnedMode = undefined, optIn = false) {
    const mode = pinnedMode || this.mode(runId, { optIn });
    if (!["legacy", "shadow", "canonical"].includes(mode)) {
      throw adapterError(
        "CC_DESKTOP_GRAPH_AUTHORITY_INVALID",
        "Desktop Graph authority mode is invalid",
      );
    }
    return mode;
  }

  _client() {
    const client = this.clientProvider();
    if (!client || typeof client.graphRun !== "function") {
      throw adapterError(
        "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
        `${this.surface} requires the fixed main-process Graph App Server capability`,
      );
    }
    return client;
  }

  _validate(
    projection,
    { runId, mode, terminal = false, allowReconciliation = false } = {},
  ) {
    if (!projection || projection.id !== runId) {
      throw adapterError(
        "CC_DESKTOP_GRAPH_PROJECTION_MISMATCH",
        "Graph response is not bound to the requested Desktop run",
      );
    }
    const expectedSource =
      mode === "shadow" ? "graph_kernel_shadow" : "graph_kernel";
    if (
      projection.authorityMode !== mode ||
      projection.authoritySource !== expectedSource ||
      !Number.isSafeInteger(projection.authorityGeneration) ||
      projection.authorityGeneration < 1 ||
      typeof projection.writerId !== "string" ||
      !projection.writerId ||
      !DIGEST.test(String(projection.eventHead || "")) ||
      !Number.isSafeInteger(projection.projectionVersion) ||
      projection.projectionVersion < 1
    ) {
      throw adapterError(
        "CC_DESKTOP_GRAPH_AUTHORITY_INVALID",
        "Graph response is missing exact writer generation/head authority",
      );
    }
    if (mode === "shadow" && (projection.attempts || []).length > 0) {
      throw adapterError(
        "CC_DESKTOP_GRAPH_SHADOW_EFFECT_DETECTED",
        "Desktop shadow Graph must not dispatch an executor attempt",
      );
    }
    if (
      projection.status === "reconciliation_required" &&
      !allowReconciliation
    ) {
      throw adapterError(
        "CC_GRAPH_RECONCILIATION_REQUIRED",
        "Desktop Graph contains an unknown effect requiring reconciliation",
        { projection },
      );
    }
    if (terminal && !TERMINAL_RUN.has(projection.status)) {
      throw adapterError(
        "CC_DESKTOP_GRAPH_TERMINAL_REQUIRED",
        `canonical Desktop Graph did not reach terminal state: ${projection.status}`,
      );
    }
    return projection;
  }

  async run({
    definition,
    inputs,
    runId,
    waitForCompletion = true,
    authorityMode = undefined,
    optIn = false,
  }) {
    const mode = this._mode(runId, authorityMode, optIn);
    if (!["shadow", "canonical"].includes(mode)) {
      throw adapterError(
        "CC_DESKTOP_GRAPH_MODE_LEGACY",
        "Graph execution adapter cannot own a legacy Desktop run",
      );
    }
    const id = graphIdentifier(runId, "desktop-graph-run");
    const projection = await this._client().graphRun({
      definition,
      runId: id,
      inputs,
      originSurface: "desktop",
      authorityMode: mode,
      waitForCompletion: mode === "canonical" && waitForCompletion === true,
      idempotencyKey: `${this.surface}:${id}:${mode}`,
    });
    return this._validate(projection, {
      runId: id,
      mode,
      terminal: mode === "canonical" && waitForCompletion === true,
    });
  }

  async status(runId, { authorityMode = undefined } = {}) {
    const mode = this._mode(runId, authorityMode);
    const id = graphIdentifier(runId, "desktop-graph-run");
    const client = this._client();
    if (typeof client.graphStatus !== "function") {
      throw adapterError(
        "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
        "Graph App Server status capability is unavailable",
      );
    }
    return this._validate(await client.graphStatus({ runId: id }), {
      runId: id,
      mode,
      allowReconciliation: true,
    });
  }

  async resume(
    runId,
    { waitForCompletion = false, authorityMode = undefined } = {},
  ) {
    const mode = this._mode(runId, authorityMode);
    if (mode !== "canonical") {
      throw adapterError(
        "CC_DESKTOP_GRAPH_RESUME_UNSUPPORTED",
        "Desktop Graph resume is only available to the canonical writer",
      );
    }
    const id = graphIdentifier(runId, "desktop-graph-run");
    const projection = await this._client().graphRun({
      runId: id,
      resume: true,
      waitForCompletion: waitForCompletion === true,
      idempotencyKey: `${this.surface}:${id}:resume`,
    });
    return this._validate(projection, {
      runId: id,
      mode,
      terminal: waitForCompletion === true,
      allowReconciliation: true,
    });
  }

  async cancel(
    runId,
    reason = "cancelled by Desktop",
    { authorityMode = undefined } = {},
  ) {
    const mode = this._mode(runId, authorityMode);
    const id = graphIdentifier(runId, "desktop-graph-run");
    const client = this._client();
    if (typeof client.graphCancel !== "function") {
      throw adapterError(
        "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
        "Graph App Server cancel capability is unavailable",
      );
    }
    return this._validate(await client.graphCancel({ runId: id, reason }), {
      runId: id,
      mode,
      allowReconciliation: true,
    });
  }

  async reconcile(runId, reconciliation, { authorityMode = undefined } = {}) {
    const mode = this._mode(runId, authorityMode);
    if (mode !== "canonical") {
      throw adapterError(
        "CC_DESKTOP_GRAPH_RECONCILE_UNSUPPORTED",
        "Desktop Graph reconciliation is only available to the canonical writer",
      );
    }
    const id = graphIdentifier(runId, "desktop-graph-run");
    const client = this._client();
    if (typeof client.graphReconcile !== "function") {
      throw adapterError(
        "CC_DESKTOP_GRAPH_CAPABILITY_UNAVAILABLE",
        "Graph App Server reconcile capability is unavailable",
      );
    }
    return this._validate(
      await client.graphReconcile({ runId: id, reconciliation }),
      {
        runId: id,
        mode,
        allowReconciliation: true,
      },
    );
  }
}

module.exports = {
  DesktopGraphExecutionAdapter,
  buildSpecializedAgentsGraph,
  buildWorkflowGraph,
  graphIdentifier,
  projectGraphNodes,
};
