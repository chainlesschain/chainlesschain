<template>
  <div class="federated-network-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>去中心化代理网络</h2>
        <span class="subtitle">Federated Agent Network</span>
      </div>
      <div class="header-right">
        <a-button :loading="store.loading" @click="handleDiscover">
          <template #icon>
            <SearchOutlined />
          </template>
          发现代理
        </a-button>
        <a-button type="primary" @click="handleRegister">
          <template #icon>
            <PlusOutlined />
          </template>
          注册代理
        </a-button>
      </div>
    </div>

    <!-- 统计区域 -->
    <a-row :gutter="[16, 16]" class="stats-section">
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="在线节点"
            :value="store.networkStats?.onlineNodes ?? 0"
            :value-style="{ color: '#52c41a' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="总技能数"
            :value="store.networkStats?.totalSkills ?? 0"
            :value-style="{ color: '#1890ff' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="我的信誉"
            :value="store.myReputation"
            :precision="1"
            :value-style="{ color: '#722ed1' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="活跃任务"
            :value="store.networkStats?.activeTasks ?? 0"
            :value-style="{ color: '#faad14' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Tab 切换 -->
    <a-tabs v-model:active-key="activeTab">
      <!-- Tab 1: 网络总览 -->
      <a-tab-pane key="overview" tab="网络总览">
        <a-row :gutter="16">
          <a-col :lg="12" :md="24">
            <a-card title="我的 DID" size="small">
              <template v-if="store.myDID">
                <a-descriptions :column="1" size="small">
                  <a-descriptions-item label="DID">
                    <code>{{ store.myDID.did }}</code>
                  </a-descriptions-item>
                  <a-descriptions-item label="状态">
                    <a-tag
                      :color="store.myDID.status === 'active' ? 'green' : 'red'"
                    >
                      {{ store.myDID.status }}
                    </a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item label="技能">
                    <a-tag v-for="skill in store.myDID.skills" :key="skill">
                      {{ skill }}
                    </a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item label="创建时间">
                    {{ store.myDID.createdAt }}
                  </a-descriptions-item>
                </a-descriptions>
              </template>
              <a-empty v-else description="尚未创建 DID">
                <a-button type="primary" @click="handleCreateDID">
                  创建 DID
                </a-button>
              </a-empty>
            </a-card>
          </a-col>
          <a-col :lg="12" :md="24">
            <a-card title="网络统计" size="small">
              <a-descriptions
                v-if="store.networkStats"
                :column="1"
                size="small"
              >
                <a-descriptions-item label="总节点数">
                  {{ store.networkStats.totalNodes }}
                </a-descriptions-item>
                <a-descriptions-item label="在线节点">
                  {{ store.networkStats.onlineNodes }}
                </a-descriptions-item>
                <a-descriptions-item label="总技能数">
                  {{ store.networkStats.totalSkills }}
                </a-descriptions-item>
                <a-descriptions-item label="活跃任务">
                  {{ store.networkStats.activeTasks }}
                </a-descriptions-item>
                <a-descriptions-item label="平均信誉">
                  {{ store.networkStats.avgReputation?.toFixed(1) }}
                </a-descriptions-item>
              </a-descriptions>
              <a-empty v-else description="暂无网络数据" />
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <!-- Tab 2: 代理发现 -->
      <a-tab-pane key="discover" tab="代理发现">
        <div class="search-bar">
          <a-input-search
            v-model:value="skillSearch"
            placeholder="按技能搜索代理..."
            enter-button="搜索"
            :loading="store.loading"
            @search="handleSkillSearch"
          />
        </div>
        <a-list :data-source="store.discoveredAgents" :loading="store.loading">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <span>{{
                    item.name || item.did.substring(0, 20) + "..."
                  }}</span>
                  <a-tag
                    v-if="item.online"
                    color="green"
                    style="margin-left: 8px"
                  >
                    在线
                  </a-tag>
                  <a-tag v-else color="default" style="margin-left: 8px">
                    离线
                  </a-tag>
                </template>
                <template #description>
                  <div>
                    <span>信誉: {{ item.reputation?.toFixed(1) }}</span>
                    <span v-if="item.organization" style="margin-left: 16px"
                      >组织: {{ item.organization }}</span
                    >
                  </div>
                  <div style="margin-top: 4px">
                    <a-tag
                      v-for="skill in item.skills"
                      :key="skill"
                      size="small"
                    >
                      {{ skill }}
                    </a-tag>
                  </div>
                </template>
              </a-list-item-meta>
              <template #actions>
                <a-button
                  size="small"
                  type="primary"
                  @click="openRouteTaskModal(item)"
                >
                  委派任务
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <!-- Tab 3: 跨组织任务 -->
      <a-tab-pane key="tasks" tab="跨组织任务">
        <a-table
          :columns="taskColumns"
          :data-source="store.remoteTasks"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-tag :color="taskStatusColor(record.status)">
                {{ record.status }}
              </a-tag>
            </template>
            <template v-if="column.key === 'sla'">
              {{ record.sla?.priority || "-" }}
            </template>
            <template v-if="column.key === 'actions'">
              <a-space size="small">
                <a-button
                  type="link"
                  size="small"
                  @click="handleViewTask(record.id)"
                >
                  详情
                </a-button>
                <a-button
                  v-if="
                    record.status === 'pending' || record.status === 'running'
                  "
                  type="link"
                  size="small"
                  danger
                  @click="handleCancelTask(record.id)"
                >
                  取消
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Tab 4: 信誉排行 -->
      <a-tab-pane key="reputation" tab="信誉排行">
        <a-table
          :columns="reputationColumns"
          :data-source="store.reputationScores"
          :loading="store.loading"
          row-key="did"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'did'">
              <code>{{ record.did.substring(0, 24) }}...</code>
            </template>
            <template v-if="column.key === 'score'">
              <a-progress
                :percent="Math.round(record.score * 10)"
                size="small"
                :show-info="false"
              />
              <span style="margin-left: 8px">{{
                record.score.toFixed(1)
              }}</span>
            </template>
            <template v-if="column.key === 'successRate'">
              {{ (record.successRate * 100).toFixed(0) }}%
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- 委派任务弹窗 -->
    <a-modal
      v-model:open="showRouteTaskModal"
      title="委派任务"
      :confirm-loading="store.loading"
      @ok="handleRouteTask"
      @cancel="showRouteTaskModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="目标代理">
          <a-input
            :value="routeTaskTarget?.name || routeTaskTarget?.did"
            disabled
          />
        </a-form-item>
        <a-form-item label="任务类型">
          <a-input
            v-model:value="routeTaskForm.type"
            placeholder="例如: code-review, translate"
          />
        </a-form-item>
        <a-form-item label="任务描述">
          <a-textarea
            v-model:value="routeTaskForm.input"
            placeholder="描述任务内容..."
            :rows="4"
          />
        </a-form-item>
        <a-form-item label="优先级">
          <a-select
            v-model:value="routeTaskForm.priority"
            placeholder="选择优先级"
          >
            <a-select-option value="high"> 高 </a-select-option>
            <a-select-option value="normal"> 普通 </a-select-option>
            <a-select-option value="low"> 低 </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { SearchOutlined, PlusOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useAgentNetworkStore } from "../stores/agentNetwork";

const store = useAgentNetworkStore();

const activeTab = ref("overview");
const skillSearch = ref("");
const showRouteTaskModal = ref(false);
const routeTaskTarget = ref<any>(null);
const routeTaskForm = ref({ type: "", input: "", priority: "normal" });

const taskColumns = [
  { title: "类型", dataIndex: "type", key: "type", width: 120 },
  {
    title: "目标代理",
    dataIndex: "targetAgent",
    key: "targetAgent",
    ellipsis: true,
  },
  { title: "状态", key: "status", width: 100 },
  { title: "SLA", key: "sla", width: 80 },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 140 },
];

const reputationColumns = [
  { title: "排名", dataIndex: "rank", key: "rank", width: 60 },
  { title: "DID", key: "did" },
  { title: "信誉分", key: "score", width: 200 },
  { title: "任务数", dataIndex: "taskCount", key: "taskCount", width: 80 },
  { title: "成功率", key: "successRate", width: 80 },
];

function taskStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: "default",
    routing: "processing",
    running: "processing",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return map[status] || "default";
}

async function handleDiscover() {
  await store.discoverAgents();
}

async function handleRegister() {
  const result = await store.registerAgent({});
  if (result.success) {
    message.success("代理已注册到联邦网络");
  } else {
    message.error(result.error || "注册失败");
  }
}

async function handleCreateDID() {
  const result = await store.createDID();
  if (result.success) {
    message.success("DID 创建成功");
  } else {
    message.error(result.error || "DID 创建失败");
  }
}

async function handleSkillSearch(value: string) {
  if (value) {
    await store.querySkills({ skill: value });
  } else {
    await store.discoverAgents();
  }
}

function openRouteTaskModal(agent: any) {
  routeTaskTarget.value = agent;
  routeTaskForm.value = { type: "", input: "", priority: "normal" };
  showRouteTaskModal.value = true;
}

async function handleRouteTask() {
  if (!routeTaskTarget.value) {
    return;
  }
  const result = await store.routeTask({
    targetAgent: routeTaskTarget.value.did,
    type: routeTaskForm.value.type,
    input: routeTaskForm.value.input,
    sla: { priority: routeTaskForm.value.priority },
  });
  if (result.success) {
    message.success("任务已委派");
    showRouteTaskModal.value = false;
  } else {
    message.error(result.error || "委派失败");
  }
}

async function handleViewTask(id: string) {
  await store.getTaskStatus(id);
}

async function handleCancelTask(id: string) {
  const result = await store.cancelTask(id);
  if (result.success) {
    message.success("任务已取消");
  }
}

onMounted(async () => {
  store.initEventListeners();
  await Promise.all([
    store.getAllDIDs(),
    store.getNetworkStats(),
    store.getTaskLog(),
    store.getRanking(),
  ]);
  if (store.allDIDs.length > 0) {
    store.myDID = store.allDIDs[0];
  }
});
</script>

<style lang="less" scoped>
.federated-network-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  .header-left {
    h2 {
      margin: 0;
    }
    .subtitle {
      color: rgba(0, 0, 0, 0.45);
      font-size: 14px;
    }
  }

  .header-right {
    display: flex;
    gap: 8px;
  }
}

.stats-section {
  margin-bottom: 24px;
}

.stat-card {
  text-align: center;
}

.search-bar {
  margin-bottom: 16px;
  max-width: 500px;
}
</style>
