<template>
  <div class="canonical-workflow-panel">
    <div class="panel-header">
      <div class="panel-title">
        <ApartmentOutlined />
        <span>Canonical Coding Workflow</span>
        <a-tag v-if="store.sessions.length" color="blue">
          {{ store.sessions.length }} sessions
        </a-tag>
      </div>
      <a-button size="small" :loading="store.loading" @click="handleRefresh">
        <ReloadOutlined />
        Refresh
      </a-button>
    </div>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-bottom: 12px"
      @close="store.error = null"
    />

    <a-empty
      v-if="!store.loading && store.sessions.length === 0"
      description="No canonical workflow sessions yet — start with $deep-interview"
    />

    <div v-else class="panel-body">
      <!-- Session list -->
      <a-list
        size="small"
        :data-source="store.sessions"
        :loading="store.loading"
        class="session-list"
      >
        <template #renderItem="{ item }">
          <a-list-item
            class="session-row"
            :class="{ active: item.sessionId === store.currentSessionId }"
            @click="handleSelect(item.sessionId)"
          >
            <div class="session-row-inner">
              <div class="session-id">
                {{ item.sessionId }}
              </div>
              <a-tag :color="stageColor(item.stage)">
                {{ item.stage || "(no stage)" }}
              </a-tag>
              <span v-if="item.retries" class="retries">
                retries {{ item.retries }}/{{ item.maxRetries || "?" }}
              </span>
              <span v-if="item.updatedAt" class="updated-at">
                {{ formatTime(item.updatedAt) }}
              </span>
            </div>
          </a-list-item>
        </template>
      </a-list>

      <!-- Session detail -->
      <div v-if="store.currentState" class="session-detail">
        <a-divider orientation="left">
          {{ store.currentState.sessionId }}
        </a-divider>

        <!-- Stage + readiness -->
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="Stage">
            <a-tag :color="stageColor(store.currentState.stage)">
              {{ store.currentState.stage || "(none)" }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="Plan Approved">
            <a-tag
              :color="store.currentState.plan?.approved ? 'green' : 'orange'"
            >
              {{ store.currentState.plan?.approved ? "yes" : "no" }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="Task Readiness">
            {{ store.taskReadiness.completed }}/{{ store.taskReadiness.total }}
            done
            <template v-if="store.taskReadiness.running">
              · {{ store.taskReadiness.running }} running
            </template>
            <template v-if="store.taskReadiness.failed">
              · {{ store.taskReadiness.failed }} failed
            </template>
          </a-descriptions-item>
          <a-descriptions-item label="Verify">
            <a-tag
              v-if="store.currentState.verify"
              :color="verifyColor(store.currentState.verify.status)"
            >
              {{ store.currentState.verify.status }}
            </a-tag>
            <span v-else>—</span>
          </a-descriptions-item>
          <a-descriptions-item
            v-if="routingHint"
            label="Routing Hint"
            :span="2"
          >
            <div class="routing-hint">
              <a-tag
                :color="routingHint.decision === 'team' ? 'purple' : 'cyan'"
              >
                ${{ routingHint.decision }}
              </a-tag>
              <a-tag color="default">
                {{ routingHint.complexity }} · confidence
                {{ routingHint.confidence }}
              </a-tag>
              <span v-if="routingHint.scopeCount" class="muted">
                {{ routingHint.scopeCount }} scope(s)
              </span>
              <span v-if="routingHint.recommendedConcurrency > 1" class="muted">
                · concurrency {{ routingHint.recommendedConcurrency }}
              </span>
              <div class="hint-reason muted">
                {{ routingHint.reason }}
              </div>
              <div v-if="routingHint.suggestedRoles?.length" class="hint-roles">
                <a-tag
                  v-for="role in routingHint.suggestedRoles"
                  :key="role"
                  color="blue"
                >
                  {{ role }}
                </a-tag>
              </div>
            </div>
          </a-descriptions-item>
        </a-descriptions>

        <!-- Tasks table -->
        <a-collapse
          v-if="store.currentState.tasks?.tasks?.length"
          ghost
          style="margin-top: 12px"
        >
          <a-collapse-panel
            key="tasks"
            :header="`Tasks (${store.currentState.tasks.tasks.length})`"
          >
            <a-table
              :data-source="store.currentState.tasks.tasks"
              :columns="taskColumns"
              :pagination="false"
              size="small"
              row-key="id"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'status'">
                  <a-tag :color="taskStatusColor(record.status)">
                    {{ record.status }}
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'scopePaths'">
                  <span v-if="record.scopePaths?.length">
                    {{ record.scopePaths.join(", ") }}
                  </span>
                  <span v-else class="muted"> — </span>
                </template>
              </template>
            </a-table>
          </a-collapse-panel>
        </a-collapse>

        <!-- Verify checks -->
        <a-collapse v-if="store.currentState.verify?.checks?.length" ghost>
          <a-collapse-panel
            key="verify"
            :header="`Verify checks (${store.currentState.verify.checks.length})`"
          >
            <a-list
              size="small"
              :data-source="store.currentState.verify.checks"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <div class="check-row">
                    <a-tag :color="verifyColor(item.status)">
                      {{ item.status }}
                    </a-tag>
                    <code>{{ item.command }}</code>
                    <span v-if="item.summary" class="muted">
                      {{ item.summary }}
                    </span>
                  </div>
                </a-list-item>
              </template>
            </a-list>
          </a-collapse-panel>
        </a-collapse>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ApartmentOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import { useWorkflowSessionStore } from "@/stores/workflow-session";

const store = useWorkflowSessionStore();

// Routing hint is persisted onto mode.json by $deep-interview.
// It's advisory only — never gates a stage transition.
const routingHint = computed(
  () => (store.currentState?.mode as any)?.routingHint || null,
);

const taskColumns = [
  { title: "ID", dataIndex: "id", key: "id", width: 160 },
  { title: "Title", dataIndex: "title", key: "title" },
  { title: "Owner", dataIndex: "ownerRole", key: "ownerRole", width: 140 },
  { title: "Scope", key: "scopePaths", width: 220 },
  { title: "Status", key: "status", width: 110 },
];

function stageColor(stage: string | null | undefined): string {
  switch (stage) {
    case "intake":
    case "intent":
      return "blue";
    case "plan":
      return "cyan";
    case "execute":
      return "geekblue";
    case "verify":
      return "purple";
    case "fix-loop":
      return "orange";
    case "complete":
    case "done":
      return "green";
    case "failed":
      return "red";
    default:
      return "default";
  }
}

function verifyColor(status: string): string {
  if (status === "passed") {
    return "green";
  }
  if (status === "failed") {
    return "red";
  }
  if (status === "partial") {
    return "orange";
  }
  return "default";
}

function taskStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "green";
    case "running":
      return "blue";
    case "failed":
      return "red";
    case "pending":
      return "default";
    default:
      return "default";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch (_e) {
    return iso;
  }
}

async function handleRefresh() {
  await store.refreshList();
}

async function handleSelect(sessionId: string) {
  await store.selectSession(sessionId);
}

onMounted(() => {
  store.refreshList();
});
</script>

<style scoped>
.canonical-workflow-panel {
  padding: 16px;
  background: var(--background-2, #fafafa);
  border: 1px solid var(--border-color, #e8e8e8);
  border-radius: 8px;
  margin-bottom: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
}

.session-list .session-row {
  cursor: pointer;
}

.session-list .session-row:hover {
  background: var(--background-3, #f0f0f0);
}

.session-list .session-row.active {
  background: var(--primary-1, #e6f4ff);
}

.session-row-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.session-id {
  font-family: monospace;
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.retries {
  font-size: 12px;
  color: var(--text-color-2, #8c8c8c);
}

.updated-at {
  font-size: 12px;
  color: var(--text-color-2, #8c8c8c);
}

.session-detail {
  margin-top: 16px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.check-row code {
  flex: 1;
  font-family: monospace;
  font-size: 12px;
}

.muted {
  color: var(--text-color-2, #8c8c8c);
  font-size: 12px;
}

.routing-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.routing-hint .hint-reason {
  width: 100%;
  margin-top: 4px;
}

.routing-hint .hint-roles {
  width: 100%;
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
