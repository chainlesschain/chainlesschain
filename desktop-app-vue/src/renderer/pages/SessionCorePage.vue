<template>
  <div class="session-core-page">
    <div class="page-header">
      <h1>Session Core · Managed Agents</h1>
      <p class="desc">
        Session policy / lifecycle / scoped memory / beta flags — 与 CLI 共享
        <code>~/.chainlesschain/</code> 下的 file-backed singletons。
      </p>
    </div>

    <a-tabs v-model:active-key="activeTab">
      <!-- Sessions -->
      <a-tab-pane key="sessions" tab="Sessions">
        <a-space style="margin-bottom: 12px">
          <a-input
            v-model:value="newAgentId"
            placeholder="agentId (新会话)"
            style="width: 200px"
          />
          <a-select
            v-model:value="newPolicy"
            style="width: 140px"
            :options="POLICY_OPTIONS"
          />
          <a-button type="primary" @click="handleCreate"> 创建会话 </a-button>
          <a-button @click="refresh"> 刷新 </a-button>
        </a-space>

        <a-table
          :columns="SESSION_COLS"
          :data-source="store.sessions"
          :row-key="(r: any) => r.sessionId"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'actions'">
              <a-space>
                <a-button size="small" @click="handlePark(record.sessionId)">
                  Park
                </a-button>
                <a-button size="small" @click="handleResume(record.sessionId)">
                  Resume
                </a-button>
                <a-popconfirm
                  title="关闭并 consolidate?"
                  @confirm="handleClose(record.sessionId)"
                >
                  <a-button size="small" danger> Close </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Policy -->
      <a-tab-pane key="policy" tab="Policy">
        <a-space style="margin-bottom: 12px">
          <a-input
            v-model:value="policySessionId"
            placeholder="sessionId"
            style="width: 220px"
          />
          <a-button @click="handleGetPolicy"> Get </a-button>
          <a-select
            v-model:value="policyValue"
            style="width: 140px"
            :options="POLICY_OPTIONS"
          />
          <a-button type="primary" @click="handleSetPolicy"> Set </a-button>
          <a-button danger @click="handleClearPolicy"> Clear </a-button>
        </a-space>
        <pre v-if="policyResult">{{
          JSON.stringify(policyResult, null, 2)
        }}</pre>
      </a-tab-pane>

      <!-- Memory -->
      <a-tab-pane key="memory" tab="Memory">
        <a-space style="margin-bottom: 12px">
          <a-input
            v-model:value="memoryQuery"
            placeholder="query (BM25)"
            style="width: 220px"
          />
          <a-select
            v-model:value="memoryScope"
            style="width: 140px"
            :options="SCOPE_OPTIONS"
          />
          <a-input
            v-model:value="memoryScopeId"
            placeholder="scopeId (可选)"
            style="width: 180px"
          />
          <a-button type="primary" @click="handleRecall"> Recall </a-button>
        </a-space>
        <a-table
          :columns="MEMORY_COLS"
          :data-source="store.memories"
          :row-key="(r: any) => r.id"
          size="small"
        />
      </a-tab-pane>

      <!-- Usage -->
      <a-tab-pane key="usage" tab="Usage">
        <a-space style="margin-bottom: 12px">
          <a-button type="primary" @click="handleRefreshUsage">
            刷新用量
          </a-button>
        </a-space>
        <template v-if="store.usageSummary">
          <a-descriptions
            title="Global"
            bordered
            size="small"
            :column="3"
            style="margin-bottom: 16px"
          >
            <a-descriptions-item label="Sessions">
              {{ store.usageSummary.total.sessionCount }}
            </a-descriptions-item>
            <a-descriptions-item label="Active">
              {{ store.usageSummary.total.activeCount }}
            </a-descriptions-item>
            <a-descriptions-item label="Session Hours">
              {{ store.usageSummary.total.sessionHours.toFixed(2) }}
            </a-descriptions-item>
            <a-descriptions-item label="Runtime (ms)">
              {{ store.usageSummary.total.runtimeMs }}
            </a-descriptions-item>
            <a-descriptions-item label="Idle (ms)">
              {{ store.usageSummary.total.idleMs }}
            </a-descriptions-item>
          </a-descriptions>
          <a-table
            :columns="USAGE_COLS"
            :data-source="store.usageSummary.byAgent"
            :row-key="(r: any) => r.agentId"
            size="small"
          />
        </template>
        <a-empty v-else description="点击刷新加载用量数据" />
      </a-tab-pane>

      <!-- Beta -->
      <a-tab-pane key="beta" tab="Beta Flags">
        <a-space style="margin-bottom: 12px">
          <a-input
            v-model:value="newBetaFlag"
            placeholder="feature-YYYY-MM-DD"
            style="width: 260px"
          />
          <a-button type="primary" @click="handleEnableBeta"> Enable </a-button>
          <a-button @click="store.refreshBetaFlags"> 刷新 </a-button>
        </a-space>
        <a-list :data-source="store.betaFlags" size="small">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-space>
                <a-tag :color="item.enabled ? 'green' : 'default'">
                  {{ item.enabled ? "ON" : "OFF" }}
                </a-tag>
                <code>{{ item.flag }}</code>
                <a-button
                  size="small"
                  @click="
                    item.enabled
                      ? store.disableBeta(item.flag)
                      : store.enableBeta(item.flag)
                  "
                >
                  Toggle
                </a-button>
              </a-space>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>
    </a-tabs>

    <a-alert
      v-if="store.lastError"
      type="error"
      :message="store.lastError"
      closable
      style="margin-top: 12px"
      @close="store.lastError = null"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  useSessionCoreStore,
  type ApprovalPolicy,
  type MemoryScope,
} from "@/stores/sessionCore";

const store = useSessionCoreStore();
const activeTab = ref("sessions");

const POLICY_OPTIONS = [
  { label: "strict", value: "strict" },
  { label: "trusted", value: "trusted" },
  { label: "autopilot", value: "autopilot" },
];
const SCOPE_OPTIONS = [
  { label: "global", value: "global" },
  { label: "user", value: "user" },
  { label: "agent", value: "agent" },
  { label: "session", value: "session" },
];

const SESSION_COLS = [
  { title: "sessionId", dataIndex: "sessionId", key: "sessionId" },
  { title: "agentId", dataIndex: "agentId", key: "agentId" },
  { title: "status", dataIndex: "status", key: "status" },
  { title: "actions", key: "actions" },
];
const MEMORY_COLS = [
  { title: "scope", dataIndex: "scope", key: "scope" },
  { title: "category", dataIndex: "category", key: "category" },
  { title: "content", dataIndex: "content", key: "content" },
];
const USAGE_COLS = [
  { title: "Agent", dataIndex: "agentId", key: "agentId" },
  { title: "Sessions", dataIndex: "sessionCount", key: "sessionCount" },
  { title: "Active", dataIndex: "activeCount", key: "activeCount" },
  { title: "Runtime (ms)", dataIndex: "runtimeMs", key: "runtimeMs" },
  { title: "Idle (ms)", dataIndex: "idleMs", key: "idleMs" },
  { title: "Session Hours", dataIndex: "sessionHours", key: "sessionHours" },
];

const newAgentId = ref("");
const newPolicy = ref<ApprovalPolicy>("strict");
const policySessionId = ref("");
const policyValue = ref<ApprovalPolicy>("strict");
const policyResult = ref<unknown>(null);
const memoryQuery = ref("");
const memoryScope = ref<MemoryScope>("global");
const memoryScopeId = ref("");
const newBetaFlag = ref("");

function refresh() {
  store.refreshSessions();
}

async function handleCreate() {
  if (!newAgentId.value) {
    return;
  }
  await store.createSession({
    agentId: newAgentId.value,
    approvalPolicy: newPolicy.value,
  });
  newAgentId.value = "";
  refresh();
}
async function handlePark(id: string) {
  await store.parkSession(id);
  refresh();
}
async function handleResume(id: string) {
  await store.resumeSession(id);
  refresh();
}
async function handleClose(id: string) {
  await store.closeSession(id);
  refresh();
}

async function handleGetPolicy() {
  policyResult.value = await store.getPolicy(policySessionId.value);
}
async function handleSetPolicy() {
  policyResult.value = await store.setPolicy(
    policySessionId.value,
    policyValue.value,
  );
}
async function handleClearPolicy() {
  policyResult.value = await store.clearPolicy(policySessionId.value);
}

async function handleRecall() {
  await store.recallMemory({
    query: memoryQuery.value,
    scope: memoryScope.value,
    scopeId: memoryScopeId.value || undefined,
    limit: 50,
  });
}

async function handleRefreshUsage() {
  await store.refreshUsage();
}

async function handleEnableBeta() {
  if (!newBetaFlag.value) {
    return;
  }
  await store.enableBeta(newBetaFlag.value);
  newBetaFlag.value = "";
}

onMounted(() => {
  store.refreshSessions();
  store.refreshBetaFlags();
});
</script>

<style scoped>
.session-core-page {
  padding: 16px;
}
.page-header h1 {
  margin: 0;
  font-size: 20px;
}
.desc {
  color: #888;
  font-size: 12px;
}
pre {
  background: #f6f8fa;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
