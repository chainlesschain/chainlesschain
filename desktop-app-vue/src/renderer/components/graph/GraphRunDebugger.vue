<template>
  <section class="graph-run-debugger" data-testid="graph-run-debugger">
    <header class="debugger-header">
      <div>
        <div class="debugger-eyebrow">Graph Run Debugger</div>
        <h3>
          {{
            activeGraph?.title ||
            activeGraph?.graphId ||
            activeGraph?.runId ||
            activeGraph?.id ||
            activeGraph?.definitionId ||
            "Task graph"
          }}
        </h3>
        <p>
          Persistent-event topology, critical path, budget and causal replay.
        </p>
      </div>
      <div class="debugger-summary">
        <span>{{ projection.topology.nodes.length }} nodes</span>
        <span>{{ projection.topology.edges.length }} edges</span>
        <span>{{ projection.timeline.length }} events</span>
      </div>
    </header>

    <section
      v-if="pendingHumanTasks.length"
      class="human-task-review"
      data-testid="graph-human-task-review"
    >
      <div class="human-task-heading">
        <div>
          <strong>Human review required</strong>
          <p>Decisions are bound to this exact graph revision and operation.</p>
        </div>
        <span>{{ pendingHumanTasks.length }} pending</span>
      </div>
      <article
        v-for="task in pendingHumanTasks"
        :key="`${task.id}:${task.decisions?.length || 0}`"
        class="human-task-card"
      >
        <div class="human-task-metadata">
          <strong>{{ task.nodeId }}</strong>
          <span>
            {{ acceptedDecisionCount(task) }}/{{ task.quorum || 1 }} approvals
          </span>
          <span v-if="task.separationOfDuties">distinct reviewers</span>
        </div>
        <pre>{{ formatHumanOperation(task.operation) }}</pre>
        <dl>
          <div>
            <dt>Revision</dt>
            <dd>{{ task.revisionDigest }}</dd>
          </div>
          <div>
            <dt>Operation</dt>
            <dd>{{ task.operationDigest }}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{{ task.expiresAt || "--" }}</dd>
          </div>
        </dl>
        <div class="human-task-actions">
          <button
            type="button"
            :disabled="settlingHumanTaskId === task.id"
            @click="settleHumanTask(task, 'acceptOnce')"
          >
            Approve exact operation
          </button>
          <button
            type="button"
            class="secondary"
            :disabled="settlingHumanTaskId === task.id"
            @click="settleHumanTask(task, 'decline')"
          >
            Decline
          </button>
          <button
            type="button"
            class="danger"
            :disabled="settlingHumanTaskId === task.id"
            @click="settleHumanTask(task, 'cancel')"
          >
            Cancel run
          </button>
        </div>
      </article>
      <p v-if="humanTaskError" class="human-task-error" role="alert">
        {{ humanTaskError }}
      </p>
    </section>

    <div class="debugger-toolbar" role="tablist" aria-label="Graph views">
      <button
        v-for="view in views"
        :key="view.key"
        type="button"
        :class="{ active: activeView === view.key }"
        :data-testid="`graph-view-${view.key}`"
        @click="activeView = view.key"
      >
        {{ view.label }}
      </button>
    </div>

    <div
      v-if="frames.length > 1"
      class="replay-toolbar"
      data-testid="graph-replay-toolbar"
    >
      <label for="graph-replay-cursor">Time travel</label>
      <input
        id="graph-replay-cursor"
        v-model.number="replayIndex"
        data-testid="graph-replay-cursor"
        type="range"
        min="0"
        :max="frames.length - 1"
        step="1"
      />
      <span>{{ frameLabel }}</span>
      <button type="button" @click="replayIndex = frames.length - 1">
        Live
      </button>
    </div>

    <div v-if="hasDiff" class="revision-diff" data-testid="graph-revision-diff">
      <strong>Revision diff</strong>
      <span v-if="frameDiff.added.length">+{{ frameDiff.added.length }}</span>
      <span v-if="frameDiff.removed.length"
        >-{{ frameDiff.removed.length }}</span
      >
      <span v-if="frameDiff.statusChanged.length">
        {{ frameDiff.statusChanged.length }} status change(s)
      </span>
    </div>

    <div
      v-if="projection.topology.truncatedNodes"
      class="debugger-warning"
      role="status"
    >
      Rendering the first {{ projection.topology.nodes.length }} of
      {{ projection.topology.totalNodes }} nodes.
    </div>

    <div v-if="activeView === 'topology'" class="topology-layout">
      <div class="topology-scroll" data-testid="graph-topology">
        <svg
          :viewBox="`0 0 ${projection.topology.width} ${projection.topology.height}`"
          :width="projection.topology.width"
          :height="projection.topology.height"
          role="img"
          aria-label="Task graph topology"
        >
          <defs>
            <marker
              id="graph-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
            </marker>
          </defs>
          <line
            v-for="edge in projection.topology.edges"
            :key="edge.id"
            :x1="edgeCoordinates(edge).x1"
            :y1="edgeCoordinates(edge).y1"
            :x2="edgeCoordinates(edge).x2"
            :y2="edgeCoordinates(edge).y2"
            :class="['topology-edge', { critical: edge.critical }]"
            marker-end="url(#graph-arrow)"
          />
          <g
            v-for="node in projection.topology.nodes"
            :key="node.id"
            :transform="`translate(${node.x}, ${node.y})`"
            :class="[
              'topology-node',
              `status-${node.status}`,
              { selected: selectedNodeId === node.id, critical: node.critical },
            ]"
            role="button"
            tabindex="0"
            :aria-label="`${node.title}, ${node.status}`"
            :data-node-id="node.id"
            @click="selectedNodeId = node.id"
            @keydown.enter.prevent="selectedNodeId = node.id"
          >
            <rect width="172" height="58" rx="9" />
            <text x="12" y="23" class="node-title">
              {{ truncate(node.title, 22) }}
            </text>
            <text x="12" y="43" class="node-meta">
              {{ node.status }} · slack {{ formatMs(node.slackMs) }}
            </text>
          </g>
        </svg>
      </div>

      <aside
        v-if="selectedNode"
        class="node-inspector"
        data-testid="node-inspector"
      >
        <div class="inspector-title-row">
          <strong>{{ selectedNode.title }}</strong>
          <span :class="`status-pill status-${selectedNode.status}`">
            {{ selectedNode.status }}
          </span>
        </div>
        <dl>
          <div>
            <dt>Node</dt>
            <dd>{{ selectedNode.id }}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{{ formatMs(selectedNode.durationMs) }}</dd>
          </div>
          <div>
            <dt>Slack</dt>
            <dd>{{ formatMs(selectedNode.slackMs) }}</dd>
          </div>
          <div>
            <dt>Critical</dt>
            <dd>{{ selectedNode.critical ? "yes" : "no" }}</dd>
          </div>
          <div>
            <dt>Dependencies</dt>
            <dd>{{ selectedNode.dependsOn.join(", ") || "root" }}</dd>
          </div>
          <div v-if="selectedNode.blockedRoot">
            <dt>Blocked root</dt>
            <dd>{{ selectedNode.blockedRoot }}</dd>
          </div>
          <div v-if="selectedAttempts.length">
            <dt>Attempt custody</dt>
            <dd>
              {{ selectedAttempts.length }} attempt(s),
              {{ selectedAttempts.filter((attempt) => attempt.leaseId).length }}
              lease(s)
            </dd>
          </div>
        </dl>
        <button type="button" @click="activeView = 'causality'">
          Drill into causes
        </button>
      </aside>
    </div>

    <div
      v-else-if="activeView === 'timeline'"
      class="timeline-view"
      data-testid="graph-timeline"
    >
      <ol v-if="projection.timeline.length">
        <li v-for="event in projection.timeline" :key="event.id">
          <time>{{ formatTimestamp(event.timestamp) }}</time>
          <span :class="`event-category category-${event.category}`">
            {{ event.category }}
          </span>
          <strong>{{ event.type }}</strong>
          <button
            v-if="event.nodeId && nodeById.has(String(event.nodeId))"
            type="button"
            @click="selectEventNode(event.nodeId)"
          >
            {{ event.nodeId }}
          </button>
        </li>
      </ol>
      <p v-else class="empty-state">No persistent events are available.</p>
    </div>

    <div
      v-else-if="activeView === 'budget'"
      class="budget-view"
      data-testid="graph-budget-heatmap"
    >
      <div class="budget-overview">
        <strong>Known node budgets: {{ projection.budget.knownCount }}</strong>
        <span v-if="projection.budget.ratio !== null">
          {{ formatPercent(projection.budget.ratio) }} aggregate use
        </span>
        <span v-else>No budget telemetry in this revision</span>
      </div>
      <div v-if="projection.budget.dimensions.length" class="run-budgets">
        <span
          v-for="dimension in projection.budget.dimensions"
          :key="dimension.field"
        >
          {{ dimension.field }}: {{ dimension.used ?? "?" }}/{{
            dimension.limit ?? "?"
          }}
        </span>
      </div>
      <div class="budget-grid">
        <button
          v-for="item in projection.budget.items"
          :key="item.nodeId"
          type="button"
          :class="['budget-cell', `heat-${item.heat}`]"
          :aria-label="`${item.title} budget ${budgetLabel(item)}`"
          @click="selectBudgetNode(item.nodeId)"
        >
          <strong>{{ truncate(item.title, 28) }}</strong>
          <span>{{ budgetLabel(item) }}</span>
        </button>
      </div>
    </div>

    <div
      v-else-if="activeView === 'trace'"
      class="trace-view"
      data-testid="graph-trace-overlay"
    >
      <div class="trace-focus">
        <label for="trace-node-select">Trace focus</label>
        <select id="trace-node-select" v-model="selectedNodeId">
          <option value="">Whole run</option>
          <option
            v-for="node in projection.topology.nodes"
            :key="node.id"
            :value="node.id"
          >
            {{ node.title }}
          </option>
        </select>
      </div>

      <section class="trace-section">
        <h4>Agent tree</h4>
        <div v-if="projection.evidence.agents.length" class="trace-grid">
          <article
            v-for="agent in projection.evidence.agents"
            :key="agent.id"
            class="trace-card"
          >
            <strong>{{ agent.id }}</strong>
            <span>
              {{ agent.status }} · {{ agent.assignments.length }} assignment(s)
            </span>
            <small v-if="agent.capacity !== null">
              capacity {{ agent.capacity }} · resident
              {{ agent.resident ? "yes" : "no" }}
            </small>
          </article>
        </div>
        <p v-else class="empty-state">No agent projection is available.</p>
      </section>

      <section class="trace-section">
        <h4>Attempts, leases, worktrees and commits</h4>
        <div v-if="traceAttempts.length" class="trace-list">
          <article
            v-for="attempt in traceAttempts"
            :key="attempt.id"
            class="trace-row"
          >
            <div>
              <strong>{{ attempt.id }}</strong>
              <span>
                {{ attempt.status }} · node {{ attempt.nodeId || "--" }}
              </span>
            </div>
            <small>
              agent {{ attempt.agentId || "--" }} · lease
              {{ attempt.leaseId || "--" }} · fence {{ attempt.fence ?? "--" }}
            </small>
            <small v-if="attempt.workspaceRef">
              worktree/workspace {{ attempt.workspaceRef }}
            </small>
            <small v-if="attempt.commit">commit {{ attempt.commit }}</small>
            <small v-else-if="attempt.outputDigest">
              output {{ attempt.outputDigest }}
            </small>
          </article>
        </div>
        <p v-else class="empty-state">No attempt custody binds this focus.</p>
      </section>

      <section class="trace-section">
        <h4>Artifact and effect lineage</h4>
        <div
          v-if="traceArtifacts.length || traceEffects.length"
          class="trace-list"
        >
          <article
            v-for="artifact in traceArtifacts"
            :key="`artifact:${artifact.id}`"
            class="trace-row"
          >
            <strong>artifact {{ artifact.id }}</strong>
            <small>
              producer {{ artifact.producerNodeId || "--" }} · digest
              {{ artifact.digest || "--" }}
            </small>
          </article>
          <article
            v-for="effect in traceEffects"
            :key="`effect:${effect.id}`"
            class="trace-row"
          >
            <strong>effect {{ effect.id }}</strong>
            <small>
              {{ effect.status }} · node {{ effect.nodeId || "--" }} · attempt
              {{ effect.attemptId || "--" }}
            </small>
          </article>
        </div>
        <p v-else class="empty-state">
          No artifact or effect metadata binds this focus.
        </p>
      </section>

      <p class="content-safety-note">
        Trace projection exposes identifiers, custody and digest references
        only; artifact, tool and message bodies remain outside the renderer
        overlay.
      </p>
    </div>

    <div v-else class="causality-view" data-testid="graph-causality">
      <div class="causality-header">
        <label for="causal-node-select">Causal focus</label>
        <select id="causal-node-select" v-model="selectedNodeId">
          <option value="">All graph events</option>
          <option
            v-for="node in projection.topology.nodes"
            :key="node.id"
            :value="node.id"
          >
            {{ node.title }}
          </option>
        </select>
        <span>{{ selectedCausalEvents.length }} event(s)</span>
      </div>
      <ol v-if="selectedCausalEvents.length" class="causality-list">
        <li v-for="event in selectedCausalEvents" :key="event.id">
          <div>
            <span :class="`event-category category-${event.category}`">
              {{ event.category }}
            </span>
            <strong>{{ event.type }}</strong>
            <span v-if="event.status">{{ event.status }}</span>
          </div>
          <small>
            {{ event.id }}
            <template v-if="event.causationId">
              ← caused by {{ event.causationId }}
            </template>
          </small>
        </li>
      </ol>
      <p v-else class="empty-state">
        No message, approval, artifact, lease or task events bind this node.
      </p>
      <p class="content-safety-note">
        Causal projection is metadata-only; message and artifact bodies are not
        exposed to the renderer overlay.
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  buildReplayFrames,
  createGraphDebuggerProjection,
  diffGraphs,
} from "./graphRunDebuggerUtils.js";

const props = defineProps({
  graph: { type: Object, required: true },
  events: { type: Array, default: () => [] },
});

const views = [
  { key: "topology", label: "Topology" },
  { key: "timeline", label: "Timeline" },
  { key: "budget", label: "Budget heatmap" },
  { key: "trace", label: "Trace overlay" },
  { key: "causality", label: "Causality" },
];
const activeView = ref("topology");
const replayIndex = ref(0);
const selectedNodeId = ref("");
const humanTasks = ref([]);
const settlingHumanTaskId = ref("");
const humanTaskError = ref("");
let unsubscribeHumanTasks = null;
let unsubscribeHumanTaskSettlements = null;

const frames = computed(() => buildReplayFrames(props.graph, props.events));
watch(
  () => frames.value.length,
  (length) => {
    replayIndex.value = Math.max(0, length - 1);
  },
  { immediate: true },
);

const activeGraph = computed(
  () => frames.value[replayIndex.value]?.graph || props.graph,
);
const activeRunId = computed(() =>
  String(
    activeGraph.value?.runId ||
      activeGraph.value?.id ||
      activeGraph.value?.graphRunId ||
      "",
  ),
);
const pendingHumanTasks = computed(() =>
  humanTasks.value.filter(
    (task) =>
      task?.runId === activeRunId.value &&
      ["open", "claimed"].includes(task?.status),
  ),
);
const activeEvents = computed(() => {
  const frame = frames.value[replayIndex.value];
  if (!frame || frame.type === "current") {
    return props.events;
  }
  return props.events.filter((event, index) => {
    const raw =
      event?.timestamp ??
      event?.createdAt ??
      event?.created_at ??
      event?.payload?.timestamp;
    const timestamp =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Date.parse(raw)
          : index;
    return Number.isFinite(timestamp) && timestamp <= frame.timestamp;
  });
});
const projection = computed(() =>
  createGraphDebuggerProjection(activeGraph.value, activeEvents.value),
);
const nodeById = computed(
  () => new Map(projection.value.topology.nodes.map((node) => [node.id, node])),
);
const selectedNode = computed(
  () => nodeById.value.get(selectedNodeId.value) || null,
);
const selectedAttempts = computed(() =>
  projection.value.evidence.attempts.filter(
    (attempt) => String(attempt.nodeId || "") === selectedNodeId.value,
  ),
);
const traceAttempts = computed(() =>
  selectedNodeId.value
    ? selectedAttempts.value
    : projection.value.evidence.attempts,
);
const traceArtifacts = computed(() =>
  selectedNodeId.value
    ? projection.value.evidence.artifacts.filter(
        (artifact) => artifact.producerNodeId === selectedNodeId.value,
      )
    : projection.value.evidence.artifacts,
);
const traceEffects = computed(() =>
  selectedNodeId.value
    ? projection.value.evidence.effects.filter(
        (effect) => effect.nodeId === selectedNodeId.value,
      )
    : projection.value.evidence.effects,
);
watch(
  () => projection.value.topology.nodes.map((node) => node.id).join("\u0000"),
  () => {
    if (!nodeById.value.has(selectedNodeId.value)) {
      selectedNodeId.value = projection.value.topology.nodes[0]?.id || "";
    }
  },
  { immediate: true },
);

const previousGraph = computed(() =>
  replayIndex.value > 0 ? frames.value[replayIndex.value - 1]?.graph : null,
);
const frameDiff = computed(() =>
  previousGraph.value
    ? diffGraphs(previousGraph.value, activeGraph.value)
    : { added: [], removed: [], statusChanged: [] },
);
const hasDiff = computed(
  () =>
    frameDiff.value.added.length > 0 ||
    frameDiff.value.removed.length > 0 ||
    frameDiff.value.statusChanged.length > 0,
);
const frameLabel = computed(() => {
  const frame = frames.value[replayIndex.value];
  if (!frame) {
    return "No revision";
  }
  if (frame.type === "current") {
    return "Current revision";
  }
  return `${replayIndex.value + 1}/${frames.value.length} · ${frame.type}`;
});
const selectedCausalEvents = computed(() => {
  if (!selectedNodeId.value) {
    return projection.value.timeline;
  }
  return projection.value.timeline.filter(
    (event) => String(event.nodeId || "") === selectedNodeId.value,
  );
});

function edgeCoordinates(edge) {
  const source = nodeById.value.get(edge.from);
  const target = nodeById.value.get(edge.to);
  return {
    x1: (source?.x || 0) + 172,
    y1: (source?.y || 0) + 29,
    x2: target?.x || 0,
    y2: (target?.y || 0) + 29,
  };
}

function truncate(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function formatMs(value) {
  const number = Number(value) || 0;
  if (number < 1000) {
    return `${Math.round(number)}ms`;
  }
  return `${(number / 1000).toFixed(1)}s`;
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return new Date(value).toLocaleTimeString();
}

function formatPercent(value) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function budgetLabel(item) {
  if (item.ratio === null) {
    return "unknown";
  }
  return `${item.used}/${item.limit} · ${formatPercent(item.ratio)}`;
}

function selectEventNode(nodeId) {
  selectedNodeId.value = String(nodeId);
  activeView.value = "causality";
}

function selectBudgetNode(nodeId) {
  selectedNodeId.value = nodeId;
  activeView.value = "topology";
}

function upsertHumanTask(task) {
  if (!task || typeof task !== "object" || !task.id) {
    return;
  }
  const index = humanTasks.value.findIndex(
    (candidate) => candidate.id === task.id,
  );
  if (index >= 0) {
    humanTasks.value.splice(index, 1, task);
  } else {
    humanTasks.value.push(task);
  }
}

function acceptedDecisionCount(task) {
  return (task?.decisions || []).filter((entry) =>
    ["acceptOnce", "acceptForTurn", "acceptForSession"].includes(
      entry?.decision?.kind,
    ),
  ).length;
}

function formatHumanOperation(operation) {
  try {
    return JSON.stringify(operation ?? {}, null, 2);
  } catch {
    return "[operation is not serializable]";
  }
}

async function settleHumanTask(task, kind) {
  const api = window.electronAPI?.codingAgent;
  if (typeof api?.appServerHumanTaskDecide !== "function") {
    humanTaskError.value = "Desktop HumanTask authority is unavailable.";
    return;
  }
  const submittedDecisionCount = task.decisions?.length || 0;
  settlingHumanTaskId.value = task.id;
  humanTaskError.value = "";
  try {
    const result = await api.appServerHumanTaskDecide({
      humanTaskId: task.id,
      runId: task.runId,
      revisionDigest: task.revisionDigest,
      operationDigest: task.operationDigest,
      nonce: task.nonce,
      decision:
        kind === "acceptOnce"
          ? { kind }
          : { kind, reason: `Desktop reviewer selected ${kind}` },
    });
    if (!result?.success) {
      throw new Error(result?.error || "HumanTask decision was rejected");
    }
    humanTasks.value = humanTasks.value.filter(
      (candidate) =>
        candidate.id !== task.id ||
        (candidate.decisions?.length || 0) !== submittedDecisionCount,
    );
  } catch (error) {
    humanTaskError.value = error?.message || String(error);
  } finally {
    settlingHumanTaskId.value = "";
  }
}

onMounted(async () => {
  const api = window.electronAPI?.codingAgent;
  if (typeof api?.onAppServerHumanTask === "function") {
    unsubscribeHumanTasks = api.onAppServerHumanTask(upsertHumanTask);
  }
  if (typeof api?.onAppServerHumanTaskSettled === "function") {
    unsubscribeHumanTaskSettlements = api.onAppServerHumanTaskSettled(
      (settlement) => {
        humanTasks.value = humanTasks.value.filter(
          (task) => task.id !== settlement?.humanTaskId,
        );
      },
    );
  }
  if (typeof api?.appServerHumanTaskList === "function") {
    try {
      const result = await api.appServerHumanTaskList();
      if (result?.success && Array.isArray(result.result)) {
        result.result.forEach(upsertHumanTask);
      }
    } catch {
      // A disabled pilot simply leaves the review panel hidden.
    }
  }
});

onBeforeUnmount(() => {
  unsubscribeHumanTasks?.();
  unsubscribeHumanTasks = null;
  unsubscribeHumanTaskSettlements?.();
  unsubscribeHumanTaskSettlements = null;
});
</script>

<style scoped>
.graph-run-debugger {
  margin: 16px 0;
  padding: 16px;
  border: 1px solid #d9e2f1;
  border-radius: 12px;
  background: linear-gradient(145deg, #f8fbff, #ffffff);
  color: #1f2937;
}

.debugger-header,
.debugger-toolbar,
.replay-toolbar,
.revision-diff,
.causality-header,
.trace-focus,
.inspector-title-row,
.budget-overview {
  display: flex;
  align-items: center;
  gap: 10px;
}

.debugger-header {
  justify-content: space-between;
}

.debugger-header h3 {
  margin: 2px 0 3px;
}

.debugger-header p {
  margin: 0;
  color: #667085;
  font-size: 12px;
}

.human-task-review {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #f59e0b;
  border-radius: 10px;
  background: #fffbeb;
}

.human-task-heading,
.human-task-metadata,
.human-task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.human-task-heading {
  justify-content: space-between;
}

.human-task-heading p {
  margin: 2px 0 0;
  color: #92400e;
  font-size: 12px;
}

.human-task-heading > span,
.human-task-metadata span {
  padding: 2px 7px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 11px;
}

.human-task-card {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: white;
}

.human-task-card pre {
  max-height: 180px;
  margin: 10px 0;
  padding: 9px;
  overflow: auto;
  border-radius: 6px;
  background: #111827;
  color: #f9fafb;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.human-task-card dl {
  display: grid;
  gap: 5px;
  margin: 0 0 10px;
  font-size: 11px;
}

.human-task-card dl > div {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
}

.human-task-card dt {
  color: #6b7280;
}

.human-task-card dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.human-task-actions button {
  border: 0;
  border-radius: 6px;
  padding: 7px 10px;
  background: #2563eb;
  color: white;
  cursor: pointer;
}

.human-task-actions button.secondary {
  background: #475569;
}

.human-task-actions button.danger {
  background: #b91c1c;
}

.human-task-actions button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.human-task-error {
  margin: 9px 0 0;
  color: #b91c1c;
  font-size: 12px;
}

.debugger-eyebrow {
  color: #2563eb;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.debugger-summary {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 6px;
}

.debugger-summary span,
.revision-diff span {
  padding: 3px 8px;
  border-radius: 999px;
  background: #e8effc;
  font-size: 11px;
}

.debugger-toolbar {
  margin-top: 14px;
  border-bottom: 1px solid #e5e7eb;
}

button,
select,
input {
  font: inherit;
}

.debugger-toolbar button,
.replay-toolbar button,
.node-inspector button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  padding: 7px 10px;
  cursor: pointer;
}

.debugger-toolbar button.active,
.replay-toolbar button,
.node-inspector button {
  background: #2563eb;
  color: white;
}

.replay-toolbar {
  margin-top: 12px;
}

.replay-toolbar input {
  flex: 1;
}

.revision-diff,
.debugger-warning {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fff7e6;
  font-size: 12px;
}

.topology-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  gap: 12px;
  margin-top: 12px;
}

.topology-scroll {
  overflow: auto;
  min-height: 230px;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  background: #fbfdff;
}

.topology-edge {
  color: #a7b0c0;
  stroke: currentColor;
  stroke-width: 1.5;
}

.topology-edge.critical {
  color: #dc2626;
  stroke-width: 2.5;
}

.topology-node {
  cursor: pointer;
  outline: none;
}

.topology-node rect {
  fill: white;
  stroke: #94a3b8;
  stroke-width: 1.5;
}

.topology-node.selected rect {
  stroke: #2563eb;
  stroke-width: 3;
}

.topology-node.critical rect {
  fill: #fff7f7;
  stroke: #ef4444;
}

.topology-node.status-completed rect {
  fill: #f0fdf4;
}
.topology-node.status-running rect {
  fill: #eff6ff;
}
.topology-node.status-failed rect {
  fill: #fef2f2;
}
.topology-node.status-skipped rect {
  fill: #f8fafc;
}

.node-title {
  fill: #111827;
  font-size: 12px;
  font-weight: 700;
}

.node-meta {
  fill: #64748b;
  font-size: 10px;
}

.node-inspector {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  overflow: auto;
}

.inspector-title-row {
  justify-content: space-between;
}

.node-inspector dl > div {
  margin: 10px 0;
}

.node-inspector dt {
  color: #64748b;
  font-size: 11px;
}

.node-inspector dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.status-pill,
.event-category {
  padding: 2px 6px;
  border-radius: 999px;
  background: #eef2ff;
  font-size: 10px;
}

.timeline-view,
.budget-view,
.trace-view,
.causality-view {
  margin-top: 12px;
}

.timeline-view ol,
.causality-list {
  max-height: 360px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.timeline-view li,
.causality-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid #edf0f5;
  font-size: 12px;
}

.timeline-view time {
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.timeline-view li button {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
}

.budget-overview {
  justify-content: space-between;
  margin-bottom: 10px;
}

.run-budgets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.run-budgets span {
  padding: 4px 7px;
  border-radius: 6px;
  background: #eef2ff;
  font-size: 11px;
}

.budget-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.budget-cell {
  min-height: 70px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px;
  text-align: left;
  cursor: pointer;
}

.budget-cell strong,
.budget-cell span {
  display: block;
}

.budget-cell span {
  margin-top: 7px;
  font-size: 11px;
}

.heat-unknown {
  background: #f1f5f9;
}
.heat-low {
  background: #dcfce7;
}
.heat-medium {
  background: #fef9c3;
}
.heat-high {
  background: #fed7aa;
}
.heat-exhausted {
  background: #fecaca;
}

.trace-focus {
  margin-bottom: 12px;
}

.trace-focus select {
  min-width: 180px;
  padding: 5px;
}

.trace-section {
  margin-top: 12px;
}

.trace-section h4 {
  margin: 0 0 7px;
  font-size: 12px;
}

.trace-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.trace-card,
.trace-row {
  padding: 9px;
  border: 1px solid #e5e7eb;
  border-radius: 7px;
  background: #ffffff;
  overflow-wrap: anywhere;
}

.trace-card strong,
.trace-card span,
.trace-card small,
.trace-row strong,
.trace-row small {
  display: block;
}

.trace-card span,
.trace-card small,
.trace-row small {
  margin-top: 4px;
  color: #64748b;
  font-size: 10px;
}

.trace-list {
  display: grid;
  gap: 6px;
  max-height: 300px;
  overflow: auto;
}

.trace-row > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trace-row > div span {
  font-size: 10px;
}

.causality-header select {
  min-width: 180px;
  padding: 5px;
}

.causality-list li {
  display: block;
}

.causality-list li > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.causality-list small {
  display: block;
  margin-top: 4px;
  color: #64748b;
  overflow-wrap: anywhere;
}

.content-safety-note,
.empty-state {
  color: #64748b;
  font-size: 11px;
}

@media (max-width: 900px) {
  .topology-layout {
    grid-template-columns: 1fr;
  }

  .debugger-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
