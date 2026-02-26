<template>
  <div class="autonomous-ops-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>自主运维</h2>
        <span class="subtitle">Autonomous Operations</span>
      </div>
      <div class="header-right">
        <a-button @click="showAlertConfigModal = true">
          <template #icon>
            <SettingOutlined />
          </template>
          告警配置
        </a-button>
        <a-button :loading="store.loading" @click="handleRefresh">
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </a-button>
      </div>
    </div>

    <!-- 统计区域 -->
    <a-row :gutter="[16, 16]" class="stats-section">
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="活跃事故"
            :value="store.activeIncidents.length"
            :value-style="{ color: '#ff4d4f' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="待确认告警"
            :value="store.alertCount"
            :value-style="{ color: '#faad14' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="自动修复率"
            :value="autoFixRate"
            suffix="%"
            :value-style="{ color: '#52c41a' }"
          />
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="平均 MTTR"
            :value="avgMTTR"
            suffix="min"
            :value-style="{ color: '#1890ff' }"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Tab 切换 -->
    <a-tabs v-model:active-key="activeTab">
      <!-- Tab 1: 事故列表 -->
      <a-tab-pane key="incidents" tab="事故列表">
        <a-table
          :columns="incidentColumns"
          :data-source="store.incidents"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'priority'">
              <a-tag :color="priorityColor(record.priority)">
                {{ record.priority }}
              </a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="incidentStatusColor(record.status)">
                {{ record.status }}
              </a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <a-space size="small">
                <a-button
                  v-if="record.status === 'open'"
                  type="link"
                  size="small"
                  @click="handleAcknowledge(record.id)"
                >
                  确认
                </a-button>
                <a-button
                  v-if="
                    record.status === 'acknowledged' ||
                    record.status === 'resolving'
                  "
                  type="link"
                  size="small"
                  @click="openRemediationModal(record)"
                >
                  修复
                </a-button>
                <a-button
                  v-if="record.status === 'resolving'"
                  type="link"
                  size="small"
                  danger
                  @click="handleRollback(record.id)"
                >
                  回滚
                </a-button>
                <a-button
                  type="link"
                  size="small"
                  @click="handleGeneratePostmortem(record.id)"
                >
                  报告
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Tab 2: Playbook 管理 -->
      <a-tab-pane key="playbooks" tab="Playbook 管理">
        <div style="margin-bottom: 16px">
          <a-button type="primary" @click="showPlaybookModal = true">
            <template #icon>
              <PlusOutlined />
            </template>
            新建 Playbook
          </a-button>
        </div>
        <a-table
          :columns="playbookColumns"
          :data-source="store.playbooks"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'enabled'">
              <a-tag :color="record.enabled ? 'green' : 'default'">
                {{ record.enabled ? "启用" : "禁用" }}
              </a-tag>
            </template>
            <template v-if="column.key === 'successRate'">
              <a-progress
                :percent="Math.round(record.successRate * 100)"
                size="small"
              />
            </template>
            <template v-if="column.key === 'steps'">
              {{ record.steps?.length || 0 }} 步
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- Tab 3: 事故报告 -->
      <a-tab-pane key="postmortems" tab="事故报告">
        <a-list :data-source="store.postmortems" :loading="store.loading">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card
                :title="`事故报告 #${item.incidentId}`"
                size="small"
                style="width: 100%"
              >
                <a-descriptions :column="1" size="small">
                  <a-descriptions-item label="根因分析">
                    {{ item.rootCause }}
                  </a-descriptions-item>
                  <a-descriptions-item label="影响范围">
                    {{ item.impact }}
                  </a-descriptions-item>
                  <a-descriptions-item label="SLA">
                    <span>目标 MTTR: {{ item.slaMetrics?.targetMTTR }}min</span>
                    <span style="margin-left: 16px"
                      >实际 MTTR: {{ item.slaMetrics?.actualMTTR }}min</span
                    >
                    <a-tag
                      :color="item.slaMetrics?.met ? 'green' : 'red'"
                      style="margin-left: 8px"
                    >
                      {{ item.slaMetrics?.met ? "达标" : "未达标" }}
                    </a-tag>
                  </a-descriptions-item>
                  <a-descriptions-item label="改进建议">
                    <ul style="margin: 0; padding-left: 16px">
                      <li v-for="(imp, idx) in item.improvements" :key="idx">
                        {{ imp }}
                      </li>
                    </ul>
                  </a-descriptions-item>
                </a-descriptions>
                <h4 style="margin-top: 12px">时间线</h4>
                <a-timeline style="margin-top: 8px">
                  <a-timeline-item
                    v-for="(entry, idx) in item.timeline"
                    :key="idx"
                  >
                    <span
                      style="color: rgba(0, 0, 0, 0.45); margin-right: 8px"
                      >{{ entry.time }}</span
                    >
                    {{ entry.event }}
                  </a-timeline-item>
                </a-timeline>
              </a-card>
            </a-list-item>
          </template>
        </a-list>
        <a-empty
          v-if="store.postmortems.length === 0"
          description="暂无事故报告"
        />
      </a-tab-pane>
    </a-tabs>

    <!-- 修复弹窗 -->
    <a-modal
      v-model:open="showRemediationModal"
      title="触发修复"
      :confirm-loading="store.loading"
      @ok="handleTriggerRemediation"
      @cancel="showRemediationModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="事故">
          <a-input :value="(remediationIncident as any)?.title" disabled />
        </a-form-item>
        <a-form-item label="选择 Playbook">
          <a-select
            v-model:value="selectedPlaybookId"
            placeholder="选择修复策略"
          >
            <a-select-option
              v-for="pb in store.playbooks"
              :key="pb.id"
              :value="pb.id"
            >
              {{ pb.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 新建 Playbook 弹窗 -->
    <a-modal
      v-model:open="showPlaybookModal"
      title="新建 Playbook"
      :confirm-loading="store.loading"
      @ok="handleCreatePlaybook"
      @cancel="showPlaybookModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input
            v-model:value="playbookForm.name"
            placeholder="Playbook 名称"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="playbookForm.description"
            placeholder="描述修复策略"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="触发条件">
          <a-input
            v-model:value="playbookForm.triggerCondition"
            placeholder="例如: cpu > 90%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 告警配置弹窗 -->
    <a-modal
      v-model:open="showAlertConfigModal"
      title="告警配置"
      @ok="handleConfigureAlerts"
      @cancel="showAlertConfigModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="CPU 阈值 (%)">
          <a-input-number
            v-model:value="alertConfig.cpuThreshold"
            :min="0"
            :max="100"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="内存阈值 (%)">
          <a-input-number
            v-model:value="alertConfig.memoryThreshold"
            :min="0"
            :max="100"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="错误率阈值 (%)">
          <a-input-number
            v-model:value="alertConfig.errorRateThreshold"
            :min="0"
            :max="100"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  SettingOutlined,
  ReloadOutlined,
  PlusOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useAutonomousOpsStore } from "../stores/autonomousOps";

const store = useAutonomousOpsStore();

const activeTab = ref("incidents");
const showRemediationModal = ref(false);
const showPlaybookModal = ref(false);
const showAlertConfigModal = ref(false);
const remediationIncident = ref<Record<string, unknown> | null>(null);
const selectedPlaybookId = ref("");
const playbookForm = ref({ name: "", description: "", triggerCondition: "" });
const alertConfig = ref({
  cpuThreshold: 80,
  memoryThreshold: 85,
  errorRateThreshold: 5,
});

const autoFixRate = computed(() => {
  const resolved = store.incidents.filter(
    (i) => i.status === "resolved" || i.status === "closed",
  );
  if (resolved.length === 0) {
    return 0;
  }
  const autoFixed = resolved.filter((i) => i.resolution?.includes("auto"));
  return Math.round((autoFixed.length / resolved.length) * 100);
});

const avgMTTR = computed(() => {
  const resolved = store.incidents.filter((i) => i.mttr != null);
  if (resolved.length === 0) {
    return 0;
  }
  const total = resolved.reduce((sum, i) => sum + (i.mttr || 0), 0);
  return Math.round(total / resolved.length / 60000);
});

const incidentColumns = [
  { title: "优先级", key: "priority", width: 80 },
  { title: "标题", dataIndex: "title", key: "title", ellipsis: true },
  { title: "状态", key: "status", width: 100 },
  { title: "来源", dataIndex: "source", key: "source", width: 100 },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 180 },
  { title: "操作", key: "actions", width: 220 },
];

const playbookColumns = [
  { title: "名称", dataIndex: "name", key: "name", ellipsis: true },
  {
    title: "描述",
    dataIndex: "description",
    key: "description",
    ellipsis: true,
  },
  { title: "状态", key: "enabled", width: 80 },
  { title: "步骤", key: "steps", width: 80 },
  { title: "成功率", key: "successRate", width: 150 },
];

function priorityColor(priority: string): string {
  const map: Record<string, string> = {
    P0: "red",
    P1: "orange",
    P2: "blue",
    P3: "default",
  };
  return map[priority] || "default";
}

function incidentStatusColor(status: string): string {
  const map: Record<string, string> = {
    open: "error",
    acknowledged: "warning",
    resolving: "processing",
    resolved: "success",
    closed: "default",
  };
  return map[status] || "default";
}

async function handleRefresh() {
  await Promise.all([
    store.getIncidents(),
    store.getAlerts(),
    store.getPlaybooks(),
  ]);
}

async function handleAcknowledge(id: string) {
  const result = await store.acknowledge(id);
  if (result.success) {
    message.success("事故已确认");
  }
}

function openRemediationModal(incident: Record<string, unknown>) {
  remediationIncident.value = incident;
  selectedPlaybookId.value = "";
  showRemediationModal.value = true;
}

async function handleTriggerRemediation() {
  if (!remediationIncident.value || !selectedPlaybookId.value) {
    message.warning("请选择 Playbook");
    return;
  }
  const result = await store.triggerRemediation(
    (remediationIncident.value as any).id,
    selectedPlaybookId.value,
  );
  if (result.success) {
    message.success("修复已触发");
    showRemediationModal.value = false;
  }
}

async function handleRollback(incidentId: string) {
  const result = await store.rollback(incidentId);
  if (result.success) {
    message.success("已回滚");
  }
}

async function handleGeneratePostmortem(incidentId: string) {
  const result = await store.generatePostmortem(incidentId);
  if (result.success) {
    message.success("事故报告已生成");
    activeTab.value = "postmortems";
  }
}

async function handleCreatePlaybook() {
  if (!playbookForm.value.name) {
    message.warning("请输入名称");
    return;
  }
  const result = await store.createPlaybook({
    name: playbookForm.value.name,
    description: playbookForm.value.description,
    triggerConditions: [playbookForm.value.triggerCondition],
    steps: [],
    enabled: true,
  });
  if (result.success) {
    message.success("Playbook 已创建");
    showPlaybookModal.value = false;
    playbookForm.value = { name: "", description: "", triggerCondition: "" };
  }
}

async function handleConfigureAlerts() {
  const result = await store.configureAlerts(alertConfig.value);
  if (result.success) {
    message.success("告警配置已更新");
    showAlertConfigModal.value = false;
  }
}

onMounted(async () => {
  await Promise.all([
    store.getIncidents(),
    store.getPlaybooks(),
    store.getAlerts(),
    store.getBaseline(),
  ]);
});
</script>

<style lang="less" scoped>
.autonomous-ops-page {
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
</style>
