import { createHash, randomUUID } from "node:crypto";
import {
  compileGraphDefinition,
  graphDigest,
} from "../graph-kernel/compiler.js";
import { GraphEventStore } from "../graph-kernel/event-store.js";
import { GraphKernel } from "../graph-kernel/runtime.js";
import { createGraphAuthorityBinding } from "../graph-kernel/authority.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "TeamGraphRuntimeAdapterError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeIdentifier(value, prefix) {
  const candidate = String(value || "").trim();
  if (IDENTIFIER.test(candidate)) return candidate;
  return `${prefix}-${createHash("sha256")
    .update(candidate, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function priorityValue(value) {
  if (value === "high") return 100;
  if (value === "low") return -100;
  return 0;
}

function teamBudget(input = {}) {
  const output = {};
  for (const [source, target] of [
    ["maxTasks", "turns"],
    ["maxTokens", "tokens"],
    ["maxUsd", "costUsd"],
    ["maxWallMs", "wallMs"],
  ]) {
    const value = Number(input[source]);
    if (Number.isFinite(value) && value >= 0) output[target] = value;
  }
  return output;
}

export function compileTeamGraphDefinition(
  registry,
  {
    definitionId = "cli-team",
    revision = 1,
    executionMode = "agent",
    worktree = false,
    budget = {},
  } = {},
) {
  if (!registry || typeof registry.list !== "function") {
    throw new TypeError("compileTeamGraphDefinition requires a task registry");
  }
  const tasks = registry.list();
  if (tasks.length === 0) {
    throw adapterError(
      "CC_TEAM_GRAPH_EMPTY",
      "canonical Team Graph requires at least one task",
    );
  }
  const taskToNode = new Map(
    tasks.map((task) => [task.key, safeIdentifier(task.key, "team-node")]),
  );
  if (new Set(taskToNode.values()).size !== taskToNode.size) {
    throw adapterError(
      "CC_TEAM_GRAPH_NODE_COLLISION",
      "team task keys collide after canonical identifier normalization",
    );
  }
  const effectful = executionMode !== "dry-run";
  const nodes = tasks.map((task) => {
    const scopePaths = Array.isArray(task.metadata?.scopePaths)
      ? task.metadata.scopePaths.map(String).filter(Boolean)
      : [];
    const node = {
      id: taskToNode.get(task.key),
      kind: "task",
      dependsOn: (task.dependsOn || []).map((key) => {
        const dependency = taskToNode.get(key);
        if (!dependency) {
          throw adapterError(
            "CC_TEAM_GRAPH_DEPENDENCY_UNKNOWN",
            `team task ${task.key} depends on unknown task ${key}`,
          );
        }
        return dependency;
      }),
      inputs: [],
      outputs: [],
      effectClass: effectful ? "workspace_write" : "none",
      priority: priorityValue(task.priority),
      retryLimit: Math.max(0, Number(registry.maxAttempts || 1) - 1),
    };
    if (effectful) {
      node.idempotencyKey =
        task.metadata?.idempotencyKey ||
        graphDigest(
          { taskKey: task.key, title: task.title, scopePaths },
          "cc.team.effect/v1",
        );
      node.workspaceIsolation = worktree ? "worktree" : "declared_scope";
      if (!worktree) node.writeSet = scopePaths.length ? scopePaths : ["**"];
    }
    return node;
  });
  const definition = {
    schemaVersion: 1,
    id: safeIdentifier(definitionId, "team-definition"),
    revision: Math.max(1, Number(revision) || 1),
    nodes,
    edges: [],
    loops: [],
    subgraphCalls: [],
    budget: teamBudget(budget),
    allowedCapabilities: [],
    metadata: {
      originSurface: "cli_team",
      executionMode,
      taskKeyByNodeId: Object.fromEntries(
        [...taskToNode].map(([taskKey, nodeId]) => [nodeId, taskKey]),
      ),
    },
  };
  return Object.freeze({
    compiled: compileGraphDefinition(definition),
    taskToNode,
    nodeToTask: new Map(
      [...taskToNode].map(([taskKey, nodeId]) => [nodeId, taskKey]),
    ),
  });
}

function terminalEvidence(result) {
  const source = result?.terminalEvidence || result || {};
  const evidence = {};
  if (DIGEST.test(String(source.outputDigest || ""))) {
    evidence.outputDigest = source.outputDigest;
  }
  if (source.commit) evidence.commit = String(source.commit);
  if (Array.isArray(source.artifactIds) && source.artifactIds.length) {
    evidence.artifactIds = [...source.artifactIds];
  }
  if (Array.isArray(source.testReceiptIds) && source.testReceiptIds.length) {
    evidence.testReceiptIds = [...source.testReceiptIds];
  }
  if (Object.keys(evidence).length === 0) {
    throw adapterError(
      "CC_TEAM_GRAPH_TERMINAL_EVIDENCE_REQUIRED",
      "canonical Team task success requires immutable output, artifact, commit, or test evidence",
    );
  }
  return evidence;
}

function graphUsage(source) {
  const usage = source?.usage || {};
  const tokens = [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ].reduce((total, key) => total + Math.max(0, Number(usage[key]) || 0), 0);
  return { turns: 1, tokens };
}

export class TeamGraphRuntimeAdapter {
  constructor({
    eventStore = new GraphEventStore(),
    now = Date.now,
    writerLeaseTtlMs = 24 * 60 * 60 * 1000,
    createId = randomUUID,
  } = {}) {
    this.eventStore = eventStore;
    this.now = now;
    this.writerLeaseTtlMs = writerLeaseTtlMs;
    this.createId = createId;
    this.kernel = null;
    this.runId = null;
    this.compiled = null;
    this.taskToNode = null;
    this.attempts = new Map();
    this.authorityMode = null;
  }

  runtimeClaims() {
    return Object.freeze({
      originSurface: "cli_team",
      surface: "cli_team",
      execution: "real",
      persistence: "durable",
      isolated: true,
      terminalEvidence: true,
      authorityModes: Object.freeze(["shadow", "canonical"]),
      featureGated: true,
    });
  }

  open({
    registry,
    runId,
    executionMode,
    worktree = false,
    teammates = 1,
    budget = {},
    authorityMode = "canonical",
  }) {
    if (!["shadow", "canonical"].includes(authorityMode)) {
      throw adapterError(
        "CC_TEAM_GRAPH_AUTHORITY_MODE_INVALID",
        "Team Graph adapter authorityMode must be shadow or canonical",
      );
    }
    this.authorityMode = authorityMode;
    this.runId = safeIdentifier(runId, "team-run");
    const graph = compileTeamGraphDefinition(registry, {
      definitionId: `team-definition:${this.runId}`,
      executionMode,
      worktree,
      budget,
    });
    this.compiled = graph.compiled;
    this.taskToNode = graph.taskToNode;
    let events = [];
    try {
      events = this.eventStore.read(this.runId);
    } catch (error) {
      if (error?.code !== "CC_ROLLOUT_THREAD_NOT_FOUND") throw error;
    }
    const latest = events.at(-1) || null;
    const previousAuthority =
      latest?.payload?.authority || latest?.payload?.state?.authority || null;
    if (
      previousAuthority &&
      previousAuthority.authorityMode !== authorityMode
    ) {
      throw adapterError(
        "CC_GRAPH_MIGRATION_REQUIRED",
        "Team Graph authority mode changed without a migration saga",
      );
    }
    const generation = previousAuthority
      ? Number(previousAuthority.authorityGeneration) + 1
      : 1;
    const writerId = safeIdentifier(
      `cli-team:${this.runId}:writer:${process.pid}:${generation}`,
      "team-writer",
    );
    const writerLeaseId = safeIdentifier(
      `cli-team:${this.runId}:lease:${this.createId()}`,
      "team-writer-lease",
    );
    this.kernel = new GraphKernel({
      eventStore: this.eventStore,
      now: this.now,
      writerId,
      writerLeaseId,
      authoritySource:
        authorityMode === "shadow" ? "graph_kernel_shadow" : "graph_kernel",
      authorityGeneration: generation,
      writerLeaseTtlMs: this.writerLeaseTtlMs,
    });
    let projection;
    if (!latest) {
      projection = this.kernel.startRun(this.compiled, {
        runId: this.runId,
        originSurface: "cli_team",
      });
    } else {
      const authority = createGraphAuthorityBinding({
        logicalRunId: this.runId,
        originSurface: "cli_team",
        authorityMode,
        authoritySource:
          authorityMode === "shadow" ? "graph_kernel_shadow" : "graph_kernel",
        authorityGeneration: generation,
        writerId,
        writerLeaseId,
        writerLeaseExpiresAt: new Date(
          this.now() + this.writerLeaseTtlMs,
        ).toISOString(),
        eventHead: latest.hash,
        projectionVersion: 1,
      });
      projection = this.kernel.recoverRun(this.runId, { authority });
      if (projection.revisionDigest !== this.compiled.revisionDigest) {
        throw adapterError(
          "CC_TEAM_GRAPH_REVISION_CONFLICT",
          "persisted canonical Team Graph does not match the resumed task definition",
        );
      }
    }
    if (projection.status === "reconciliation_required") {
      throw adapterError(
        "CC_GRAPH_RECONCILIATION_REQUIRED",
        "Team Graph contains an unknown effect requiring audited reconciliation",
        { runId: this.runId },
      );
    }
    if (projection.phase === "open") {
      for (let index = 0; index < Math.max(1, teammates); index += 1) {
        this.kernel.registerAgent(this.runId, {
          agentId: `teammate-${index + 1}`,
          capacity: 1,
          resident: true,
        });
      }
      projection = this.kernel.sealRun(this.runId);
    }
    return projection;
  }

  beforeTask({ key, holder, lease, task }) {
    if (!this.kernel) {
      throw adapterError(
        "CC_TEAM_GRAPH_NOT_OPEN",
        "canonical Team Graph adapter is not open",
      );
    }
    const nodeId = this.taskToNode.get(key);
    if (!nodeId) {
      throw adapterError(
        "CC_TEAM_GRAPH_TASK_UNKNOWN",
        `canonical Team Graph has no task ${key}`,
      );
    }
    const attemptId = safeIdentifier(
      `team-attempt:${graphDigest(
        {
          runId: this.runId,
          key,
          holder,
          legacyLeaseId: lease?.leaseId || null,
          legacyFence: lease?.fencingToken ?? null,
        },
        "cc.team.assignment/v1",
      ).slice(7, 39)}`,
      "team-attempt",
    );
    const attempt = this.kernel.assignNode(this.runId, nodeId, holder, {
      attemptId,
      leaseId: safeIdentifier(
        `graph-lease:${lease?.leaseId || this.createId()}`,
        "graph-lease",
      ),
      ttlMs: this.writerLeaseTtlMs,
      role: "executor",
      grant: {
        legacyLeaseId: lease?.leaseId || null,
        legacyFence: lease?.fencingToken ?? null,
      },
    });
    let effect = null;
    if (attempt.effectIdempotencyKey) {
      effect = this.kernel.beginEffect(this.runId, {
        effectId: safeIdentifier(`team-effect:${attempt.id}`, "team-effect"),
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        idempotencyKey: attempt.effectIdempotencyKey,
        operationDigest: graphDigest(
          {
            taskKey: key,
            nodeId,
            title: task?.title || key,
            scopePaths: task?.metadata?.scopePaths || [],
          },
          "cc.team.operation/v1",
        ),
      });
    }
    this.attempts.set(key, { attempt, effect });
    return attempt;
  }

  settleTask({ key, task, status, result = null, error = null }) {
    const active = this.attempts.get(key);
    if (!active) {
      throw adapterError(
        "CC_TEAM_GRAPH_ATTEMPT_MISSING",
        `canonical Team Graph has no active attempt for ${key}`,
      );
    }
    const { attempt, effect } = active;
    if (status === "completed") {
      const evidence = terminalEvidence(result);
      if (effect) {
        const receiptDigest =
          evidence.outputDigest ||
          graphDigest(evidence, "cc.team.effect-receipt/v1");
        this.kernel.settleEffect(this.runId, {
          effectId: effect.id,
          attemptId: attempt.id,
          leaseId: attempt.leaseId,
          fence: attempt.fence,
          outcome: "committed",
          receipt: { receiptDigest },
        });
      }
      const settled = this.kernel.settleAttempt(this.runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "succeeded",
        evidence,
        usage: graphUsage(result),
      });
      this.attempts.delete(key);
      return settled;
    }
    if (effect) {
      const retrySafe = task?.metadata?.retrySafe === true;
      this.kernel.settleEffect(this.runId, {
        effectId: effect.id,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: retrySafe ? "failed" : "unknown",
      });
      if (!retrySafe) {
        this.attempts.delete(key);
        return this.kernel.getRun(this.runId);
      }
    }
    const settled = this.kernel.settleAttempt(this.runId, {
      attemptId: attempt.id,
      leaseId: attempt.leaseId,
      fence: attempt.fence,
      outcome: "failed",
      usage: graphUsage(error),
      error: error?.message || String(error || "team task failed"),
    });
    this.attempts.delete(key);
    return settled;
  }

  abandonTask(key, error = null) {
    const active = this.attempts.get(key);
    if (!active) return this.status();
    const { attempt, effect } = active;
    if (effect) {
      this.kernel.settleEffect(this.runId, {
        effectId: effect.id,
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "unknown",
      });
    } else {
      this.kernel.settleAttempt(this.runId, {
        attemptId: attempt.id,
        leaseId: attempt.leaseId,
        fence: attempt.fence,
        outcome: "cancelled",
        error: error?.message || String(error || "legacy projection failed"),
      });
    }
    this.attempts.delete(key);
    return this.status();
  }

  status() {
    if (!this.kernel || !this.runId) return null;
    return this.kernel.getRun(this.runId);
  }

  events(options = {}) {
    if (!this.kernel || !this.runId) return [];
    return this.kernel.events(this.runId, options);
  }

  async cancel(reason = "team run cancelled") {
    if (!this.kernel || !this.runId) return null;
    return this.kernel.cancelRun(this.runId, { reason });
  }
}
