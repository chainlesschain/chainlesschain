<template>
  <a-modal
    :open="open"
    :width="1000"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="智能代理中心"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <RobotOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="ad-toolbar">
      <span class="ad-subtitle">管理代理模板、实例、任务和性能分析</span>
      <a-space size="small">
        <a-button size="small" :loading="store.loading" @click="handleRefresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" size="small" @click="showOrchestrateModal">
          <template #icon><ThunderboltOutlined /></template>
          编排任务
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[16, 16]" class="ad-stats">
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="代理模板"
          :value="store.totalTemplates"
          :value-style="{ color: '#1890ff' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="活跃实例"
          :value="store.activeInstances.length"
          :value-style="{ color: '#52c41a' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="已完成任务"
          :value="store.completedTaskCount"
          :value-style="{ color: '#722ed1' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="成功率"
          :value="store.overallSuccessRate"
          suffix="%"
          :precision="1"
          :value-style="{
            color: store.overallSuccessRate >= 80 ? '#52c41a' : '#faad14',
          }"
        />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="templates" tab="代理模板">
        <a-row v-if="store.templates.length > 0" :gutter="[16, 16]">
          <a-col
            v-for="template in store.templates"
            :key="template.id"
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card class="template-card" hoverable size="small">
              <div class="template-header">
                <a-avatar
                  :style="{ backgroundColor: getTypeColor(template.type) }"
                  shape="square"
                  :size="40"
                >
                  {{ template.type.charAt(0).toUpperCase() }}
                </a-avatar>
                <div class="template-title">
                  <h3>{{ template.name }}</h3>
                  <a-tag :color="getTypeColor(template.type)">
                    {{ template.type }}
                  </a-tag>
                </div>
              </div>
              <p class="template-desc">
                {{ template.description || "暂无描述" }}
              </p>
              <div class="template-footer">
                <span class="template-version">v{{ template.version }}</span>
                <a-switch
                  :checked="template.enabled"
                  checked-children="启用"
                  un-checked-children="禁用"
                  @change="
                    (checked) =>
                      handleToggleTemplate(template, checked as boolean)
                  "
                />
              </div>
              <div class="template-actions">
                <a-button
                  type="primary"
                  size="small"
                  :disabled="!template.enabled"
                  @click="handleDeployTemplate(template)"
                >
                  <template #icon><RocketOutlined /></template>
                  部署
                </a-button>
                <a-button
                  size="small"
                  danger
                  @click="handleDeleteTemplate(template)"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>
        <a-empty v-else-if="!store.loading" description="暂无代理模板" />
      </a-tab-pane>

      <a-tab-pane key="instances" tab="运行实例">
        <a-table
          :columns="instanceColumns"
          :data-source="store.instances"
          :loading="store.loading"
          row-key="id"
          size="small"
          :pagination="{ pageSize: 8 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-tag :color="getStatusColor(record.status)">
                {{ getStatusLabel(record.status) }}
              </a-tag>
            </template>
            <template v-if="column.key === 'templateType'">
              <a-tag :color="getTypeColor(record.templateType)">
                {{ record.templateType }}
              </a-tag>
            </template>
            <template v-if="column.key === 'currentTask'">
              <span v-if="record.currentTask">
                {{ truncateText(record.currentTask, 40) }}
              </span>
              <span v-else style="color: #bfbfbf">--</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              {{ formatTime(record.createdAt) }}
            </template>
            <template v-if="column.key === 'actions'">
              <a-space size="small">
                <a-button
                  type="link"
                  size="small"
                  @click="handleViewStatus(record as AgentInstance)"
                >
                  查看
                </a-button>
                <a-popconfirm
                  title="确定要终止此代理实例吗?"
                  ok-text="确定"
                  cancel-text="取消"
                  @confirm="handleTerminate(record as AgentInstance)"
                >
                  <a-button type="link" danger size="small">终止</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无运行中的实例" />
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="history" tab="任务历史">
        <a-table
          :columns="historyColumns"
          :data-source="store.taskHistory"
          :loading="store.loading"
          row-key="id"
          size="small"
          :pagination="{ pageSize: 8 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'template_type'">
              <a-tag :color="getTypeColor(record.template_type)">
                {{ record.template_type }}
              </a-tag>
            </template>
            <template v-if="column.key === 'task_description'">
              <span v-if="record.task_description">
                {{ truncateText(record.task_description, 50) }}
              </span>
              <span v-else style="color: #bfbfbf">--</span>
            </template>
            <template v-if="column.key === 'success'">
              <a-tag v-if="record.success === true" color="success">成功</a-tag>
              <a-tag v-else-if="record.success === false" color="error">
                失败
              </a-tag>
              <a-tag v-else color="default">未知</a-tag>
            </template>
            <template v-if="column.key === 'duration'">
              {{ formatDuration(record.started_at, record.completed_at) }}
            </template>
            <template v-if="column.key === 'tokens_used'">
              <span v-if="record.tokens_used">
                {{ record.tokens_used.toLocaleString() }}
              </span>
              <span v-else style="color: #bfbfbf">--</span>
            </template>
            <template v-if="column.key === 'started_at'">
              {{ formatTime(record.started_at) }}
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无任务历史记录" />
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="performance" tab="性能分析">
        <a-table
          v-if="store.performance.length > 0"
          :columns="performanceColumns"
          :data-source="store.performance"
          :loading="store.loading"
          row-key="templateType"
          size="small"
          :pagination="false"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'templateType'">
              <a-tag :color="getTypeColor(record.templateType)">
                {{ record.templateType }}
              </a-tag>
            </template>
            <template v-if="column.key === 'successRate'">
              <a-progress
                :percent="record.successRate"
                :status="
                  record.successRate >= 80
                    ? 'success'
                    : record.successRate >= 50
                      ? 'normal'
                      : 'exception'
                "
                :stroke-width="8"
                style="width: 120px"
              />
            </template>
            <template v-if="column.key === 'avgDuration'">
              {{ (record.avgDuration / 1000).toFixed(1) }}s
            </template>
            <template v-if="column.key === 'totalTokens'">
              {{ record.totalTokens.toLocaleString() }}
            </template>
          </template>
        </a-table>
        <a-empty
          v-else-if="!store.loading"
          description="暂无性能数据，运行代理任务后将显示分析结果"
        />
      </a-tab-pane>
    </a-tabs>

    <a-modal
      v-model:open="orchestrateModalVisible"
      title="编排任务"
      :confirm-loading="orchestrating"
      width="600px"
      ok-text="开始编排"
      cancel-text="取消"
      @ok="handleOrchestrate"
    >
      <a-form layout="vertical">
        <a-form-item label="任务描述" required>
          <a-textarea
            v-model:value="orchestrateForm.taskDescription"
            placeholder="请详细描述要编排的任务，系统将自动分析并分配给合适的代理..."
            :rows="6"
            :maxlength="2000"
            show-count
          />
        </a-form-item>
        <a-alert
          message="编排引擎会分析任务描述，自动选择合适的代理模板并生成执行计划"
          type="info"
          show-icon
        />
      </a-form>

      <div v-if="orchestrationResult" class="orchestration-result">
        <a-divider>编排结果</a-divider>
        <a-timeline>
          <a-timeline-item
            v-for="(step, index) in orchestrationResult.steps || []"
            :key="index"
            :color="
              step.status === 'completed'
                ? 'green'
                : step.status === 'running'
                  ? 'blue'
                  : 'gray'
            "
          >
            <strong>{{ step.agentType }}</strong
            >: {{ step.action }}
            <template v-if="step.dependencies && step.dependencies.length > 0">
              <br />
              <span style="color: #8c8c8c; font-size: 12px">
                依赖: {{ step.dependencies.join(", ") }}
              </span>
            </template>
          </a-timeline-item>
        </a-timeline>
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch, h } from "vue";
import { message, Modal } from "ant-design-vue";
import type { TableColumnType } from "ant-design-vue";
import {
  RobotOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons-vue";
import { useAgentsStore } from "../stores/agents";
import type {
  AgentTemplate,
  AgentInstance,
  OrchestrationPlan,
} from "../stores/agents";
import { createLogger } from "@/utils/logger";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const agentLogger = createLogger("agent-dashboard-panel");
const store = useAgentsStore();

const activeTab = ref("templates");
const orchestrateModalVisible = ref(false);
const orchestrating = ref(false);
const orchestrationResult = ref<OrchestrationPlan | null>(null);
const orchestrateForm = ref({ taskDescription: "" });

const instanceColumns: TableColumnType[] = [
  { title: "ID", dataIndex: "id", key: "id", width: 120, ellipsis: true },
  {
    title: "代理类型",
    dataIndex: "templateType",
    key: "templateType",
    width: 110,
  },
  { title: "状态", dataIndex: "status", key: "status", width: 90 },
  {
    title: "当前任务",
    dataIndex: "currentTask",
    key: "currentTask",
    ellipsis: true,
  },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 160 },
  { title: "操作", key: "actions", width: 130 },
];

const historyColumns: TableColumnType[] = [
  {
    title: "代理类型",
    dataIndex: "template_type",
    key: "template_type",
    width: 110,
  },
  {
    title: "任务描述",
    dataIndex: "task_description",
    key: "task_description",
    ellipsis: true,
  },
  { title: "结果", dataIndex: "success", key: "success", width: 90 },
  { title: "耗时", key: "duration", width: 90 },
  { title: "Tokens", dataIndex: "tokens_used", key: "tokens_used", width: 90 },
  { title: "开始时间", dataIndex: "started_at", key: "started_at", width: 160 },
];

const performanceColumns: TableColumnType[] = [
  {
    title: "代理类型",
    dataIndex: "templateType",
    key: "templateType",
    width: 140,
  },
  { title: "总任务数", dataIndex: "totalTasks", key: "totalTasks", width: 100 },
  { title: "成功率", dataIndex: "successRate", key: "successRate", width: 180 },
  {
    title: "平均耗时",
    dataIndex: "avgDuration",
    key: "avgDuration",
    width: 110,
  },
  {
    title: "总 Tokens",
    dataIndex: "totalTokens",
    key: "totalTokens",
    width: 110,
  },
];

async function loadInitialData() {
  try {
    await Promise.all([
      store.fetchTemplates(),
      store.fetchInstances(),
      store.fetchPerformance(),
    ]);
  } catch (error) {
    agentLogger.error("初始数据加载失败:", error);
    message.error("数据加载失败，请刷新重试");
  }
}

async function handleRefresh() {
  await loadInitialData();
  message.success("刷新成功");
}

function showOrchestrateModal() {
  orchestrateForm.value.taskDescription = "";
  orchestrationResult.value = null;
  orchestrateModalVisible.value = true;
}

async function handleOrchestrate() {
  const desc = orchestrateForm.value.taskDescription.trim();
  if (!desc) {
    message.error("请输入任务描述");
    return;
  }
  orchestrating.value = true;
  try {
    const plan = await store.orchestrate(desc);
    if (plan) {
      orchestrationResult.value = plan;
      message.success("编排计划生成成功");
    } else {
      message.error(store.error || "编排失败");
    }
  } catch (error) {
    agentLogger.error("编排任务失败:", error);
    message.error("编排失败: " + (error as Error).message);
  } finally {
    orchestrating.value = false;
  }
}

async function handleToggleTemplate(template: AgentTemplate, checked: boolean) {
  const success = await store.updateTemplate(template.id, { enabled: checked });
  if (success) {
    message.success(`模板 "${template.name}" 已${checked ? "启用" : "禁用"}`);
  } else {
    message.error(store.error || "操作失败");
  }
}

async function handleDeployTemplate(template: AgentTemplate) {
  const instance = await store.deployAgent(template.id);
  if (instance) {
    message.success(`代理 "${template.name}" 部署成功`);
    activeTab.value = "instances";
  } else {
    message.error(store.error || "部署失败");
  }
}

function handleDeleteTemplate(template: AgentTemplate) {
  Modal.confirm({
    title: "确认删除",
    content: `确定要删除代理模板 "${template.name}" 吗？此操作不可撤销。`,
    icon: h(ExclamationCircleOutlined),
    okText: "确认删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const success = await store.deleteTemplate(template.id);
      if (success) {
        message.success(`模板 "${template.name}" 已删除`);
      } else {
        message.error(store.error || "删除失败");
      }
    },
  });
}

async function handleViewStatus(instance: AgentInstance) {
  const status = await store.getStatus(instance.id);
  if (status) {
    Modal.info({
      title: `实例状态: ${instance.id}`,
      content: h(
        "pre",
        { style: "max-height: 400px; overflow: auto" },
        JSON.stringify(status, null, 2),
      ),
      width: 600,
    });
  }
}

async function handleTerminate(instance: AgentInstance) {
  const success = await store.terminateAgent(instance.id, "用户主动终止");
  if (success) {
    message.success("实例已终止");
  } else {
    message.error(store.error || "终止失败");
  }
}

function getTypeColor(type: string): string {
  const colorMap: Record<string, string> = {
    coder: "#1890ff",
    researcher: "#52c41a",
    analyst: "#722ed1",
    writer: "#fa8c16",
    reviewer: "#13c2c2",
    planner: "#eb2f96",
    tester: "#faad14",
    deployer: "#2f54eb",
  };
  return colorMap[type] || "#8c8c8c";
}

function getStatusColor(status: string): string {
  const statusColorMap: Record<string, string> = {
    idle: "default",
    running: "processing",
    completed: "success",
    failed: "error",
  };
  return statusColorMap[status] || "default";
}

function getStatusLabel(status: string): string {
  const statusLabelMap: Record<string, string> = {
    idle: "空闲",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
  };
  return statusLabelMap[status] || status;
}

function truncateText(text: string, maxLen: number): string {
  if (!text) {
    return "";
  }
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return "--";
  }
  return new Date(timestamp).toLocaleString("zh-CN");
}

function formatDuration(
  startedAt: number | undefined,
  completedAt: number | undefined,
): string {
  if (!startedAt || !completedAt) {
    return "--";
  }
  const duration = completedAt - startedAt;
  if (duration < 1000) {
    return duration + "ms";
  }
  if (duration < 60000) {
    return (duration / 1000).toFixed(1) + "s";
  }
  return (duration / 60000).toFixed(1) + "min";
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadInitialData();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.ad-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.ad-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.ad-stats {
  margin-bottom: 8px;
  text-align: center;
}
.template-card {
  height: 100%;
}
.template-header {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.template-title {
  flex: 1;
}
.template-title h3 {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 600;
}
.template-desc {
  color: #8c8c8c;
  font-size: 13px;
  margin-bottom: 12px;
  min-height: 36px;
}
.template-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.template-version {
  color: #bfbfbf;
  font-size: 12px;
}
.template-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.orchestration-result {
  margin-top: 16px;
}
</style>
