<template>
  <a-modal
    :open="open"
    :width="1120"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="自主代理"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <RocketOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="aa-toolbar">
      <span class="aa-subtitle">提交目标，让 AI 代理自主执行</span>
      <a-space size="small">
        <a-button size="small" :loading="store.loading" @click="handleRefresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button
          v-if="store.activeGoalCount > 0"
          danger
          size="small"
          @click="handleBatchCancel"
        >
          <template #icon><StopOutlined /></template>
          全部取消
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[16, 16]" class="aa-stats">
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="活跃目标"
          :value="store.activeGoalCount"
          :value-style="{ color: '#1890ff' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="运行中"
          :value="store.runningGoals.length"
          :value-style="{ color: '#52c41a' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="已完成"
          :value="store.stats?.completedGoals || 0"
          :value-style="{ color: '#722ed1' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="成功率"
          :value="store.successRate"
          suffix="%"
          :precision="0"
          :value-style="{
            color: store.successRate >= 80 ? '#52c41a' : '#faad14',
          }"
        />
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :xs="24" :lg="16">
        <a-card title="提交新目标" size="small" class="aa-card">
          <GoalSubmissionForm
            :loading="store.loading"
            @submit="handleGoalSubmit"
          />
        </a-card>

        <a-card
          title="活跃目标"
          size="small"
          class="aa-card"
          :extra="
            store.activeGoalCount > 0 ? `${store.activeGoalCount} 个进行中` : ''
          "
        >
          <a-empty
            v-if="store.activeGoals.length === 0"
            description="暂无活跃目标"
          />
          <div v-else class="goals-list">
            <a-card
              v-for="goal in store.activeGoals"
              :key="goal.id"
              size="small"
              class="goal-card"
              :class="{ 'goal-selected': store.selectedGoalId === goal.id }"
              @click="store.selectGoal(goal.id)"
            >
              <template #title>
                <div class="goal-card-title">
                  <a-tag :color="getStatusColor(goal.status)">
                    {{ goal.status }}
                  </a-tag>
                  <span class="goal-desc">
                    {{ truncate(goal.description, 80) }}
                  </span>
                </div>
              </template>
              <template #extra>
                <a-space size="small">
                  <a-button
                    v-if="goal.status === 'running'"
                    size="small"
                    @click.stop="store.pauseGoal(goal.id)"
                  >
                    <template #icon><PauseOutlined /></template>
                  </a-button>
                  <a-button
                    v-if="goal.status === 'paused'"
                    size="small"
                    type="primary"
                    @click.stop="store.resumeGoal(goal.id)"
                  >
                    <template #icon><CaretRightOutlined /></template>
                  </a-button>
                  <a-button
                    size="small"
                    danger
                    @click.stop="store.cancelGoal(goal.id)"
                  >
                    <template #icon><CloseOutlined /></template>
                  </a-button>
                </a-space>
              </template>
              <div class="goal-card-body">
                <div class="goal-meta">
                  <span>优先级: {{ goal.priority }}</span>
                  <span>步骤: {{ goal.stepCount }}</span>
                  <span>Token: {{ goal.tokensUsed }}</span>
                </div>
                <a-progress
                  v-if="goal.status === 'running'"
                  :percent="getGoalProgress(goal)"
                  :show-info="false"
                  size="small"
                  status="active"
                />
                <a-alert
                  v-if="goal.status === 'waiting_input' && goal.inputRequest"
                  type="warning"
                  show-icon
                  class="input-alert"
                >
                  <template #message>
                    {{ goal.inputRequest.question }}
                  </template>
                  <template #description>
                    <div class="input-actions">
                      <a-space
                        v-if="
                          goal.inputRequest.options &&
                          goal.inputRequest.options.length > 0
                        "
                        wrap
                      >
                        <a-button
                          v-for="opt in goal.inputRequest.options"
                          :key="opt"
                          size="small"
                          @click.stop="store.provideInput(goal.id, opt)"
                        >
                          {{ opt }}
                        </a-button>
                      </a-space>
                      <div class="input-custom">
                        <a-input
                          v-model:value="userInputs[goal.id]"
                          placeholder="输入你的回复..."
                          size="small"
                          @press-enter="handleProvideInput(goal.id)"
                        />
                        <a-button
                          size="small"
                          type="primary"
                          @click.stop="handleProvideInput(goal.id)"
                        >
                          发送
                        </a-button>
                      </div>
                    </div>
                  </template>
                </a-alert>
              </div>
            </a-card>
          </div>
        </a-card>

        <a-card
          v-if="store.selectedGoalId"
          title="执行时间线"
          size="small"
          class="aa-card timeline-card"
        >
          <template #extra>
            <a-button size="small" @click="store.selectGoal(null)">
              <template #icon><CloseOutlined /></template>
              关闭
            </a-button>
          </template>
          <a-empty
            v-if="store.currentGoalSteps.length === 0"
            description="尚无步骤记录"
          />
          <a-collapse v-else accordion>
            <a-collapse-panel
              v-for="step in store.currentGoalSteps"
              :key="step.id"
              :header="`步骤 ${step.stepNumber}: [${step.actionType}] ${step.success ? '成功' : '失败'} (${step.durationMs}ms)`"
            >
              <template #extra>
                <a-tag :color="step.success ? 'green' : 'red'">
                  {{ step.success ? "OK" : "ERR" }}
                </a-tag>
              </template>
              <div class="step-detail">
                <div v-if="step.thought" class="step-section">
                  <strong>推理:</strong>
                  <p>{{ step.thought }}</p>
                </div>
                <div class="step-section">
                  <strong>动作:</strong>
                  <p>
                    {{ step.actionType }}:
                    {{ JSON.stringify(step.actionParams) }}
                  </p>
                </div>
                <div v-if="step.result" class="step-section">
                  <strong>结果:</strong>
                  <pre class="step-result">{{ step.result }}</pre>
                </div>
                <div class="step-section step-meta-row">
                  <span>Token: {{ step.tokensUsed }}</span>
                  <span>耗时: {{ step.durationMs }}ms</span>
                  <span>{{ step.createdAt }}</span>
                </div>
              </div>
            </a-collapse-panel>
          </a-collapse>
        </a-card>

        <a-card title="目标历史" size="small" class="aa-card">
          <template #extra>
            <a-button size="small" danger @click="handleClearHistory">
              <template #icon><DeleteOutlined /></template>
              清理旧记录
            </a-button>
          </template>
          <a-table
            :data-source="store.goalHistory"
            :columns="historyColumns"
            :pagination="{
              total: store.goalHistoryTotal,
              pageSize: 20,
              showSizeChanger: false,
              onChange: handleHistoryPageChange,
            }"
            :loading="store.loading"
            size="small"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <a-tag :color="getStatusColor(record.status)">
                  {{ record.status }}
                </a-tag>
              </template>
              <template v-if="column.key === 'description'">
                <span>{{ truncate(record.description, 60) }}</span>
              </template>
              <template v-if="column.key === 'actions'">
                <a-space size="small">
                  <a-button size="small" @click="handleViewGoal(record.id)">
                    查看
                  </a-button>
                  <a-button
                    v-if="
                      record.status === 'failed' ||
                      record.status === 'cancelled'
                    "
                    size="small"
                    @click="store.retryGoal(record.id)"
                  >
                    重试
                  </a-button>
                  <a-button size="small" @click="handleExportGoal(record.id)">
                    导出
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-col>

      <a-col :xs="24" :lg="8">
        <a-card title="队列状态" size="small" class="aa-card">
          <div v-if="store.queueStatus">
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="等待中">
                {{ store.queueStatus.pending }}
              </a-descriptions-item>
              <a-descriptions-item label="活跃">
                {{ store.queueStatus.active }}
              </a-descriptions-item>
              <a-descriptions-item label="最大并发">
                {{ store.queueStatus.maxConcurrent }}
              </a-descriptions-item>
              <a-descriptions-item label="可接受">
                <a-tag
                  :color="store.queueStatus.canAcceptMore ? 'green' : 'red'"
                >
                  {{ store.queueStatus.canAcceptMore ? "是" : "已满" }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>
            <a-divider style="margin: 12px 0" />
            <h4>历史</h4>
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="已处理">
                {{ store.queueStatus.historical.totalProcessed }}
              </a-descriptions-item>
              <a-descriptions-item label="已完成">
                {{ store.queueStatus.historical.totalCompleted }}
              </a-descriptions-item>
              <a-descriptions-item label="失败">
                {{ store.queueStatus.historical.totalFailed }}
              </a-descriptions-item>
            </a-descriptions>
            <template v-if="store.queueStatus.items.length > 0">
              <a-divider style="margin: 12px 0" />
              <h4>排队项</h4>
              <a-list size="small" :data-source="store.queueStatus.items">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <a-tag>P{{ item.priority }}</a-tag>
                        {{ truncate(item.description, 40) }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </template>
          </div>
          <a-empty v-else description="暂无队列数据" />
        </a-card>

        <a-card title="配置" size="small" class="aa-card">
          <a-descriptions v-if="store.config" :column="1" size="small">
            <a-descriptions-item label="每目标最大步骤">
              {{ store.config.maxStepsPerGoal }}
            </a-descriptions-item>
            <a-descriptions-item label="步骤超时">
              {{ Math.round(store.config.stepTimeoutMs / 1000) }}s
            </a-descriptions-item>
            <a-descriptions-item label="最大并发">
              {{ store.config.maxConcurrentGoals }}
            </a-descriptions-item>
            <a-descriptions-item label="Token 预算">
              {{ store.config.tokenBudgetPerGoal.toLocaleString() }}
            </a-descriptions-item>
            <a-descriptions-item label="最大重规划">
              {{ store.config.maxReplanAttempts }}
            </a-descriptions-item>
          </a-descriptions>
          <a-empty v-else description="配置未加载" />
        </a-card>
      </a-col>
    </a-row>

    <a-modal
      v-model:open="interventionModalVisible"
      title="代理需要你的输入"
      :footer="null"
      :closable="true"
      @cancel="interventionModalVisible = false"
    >
      <div v-if="currentInterventionGoal">
        <a-alert
          :message="
            currentInterventionGoal.inputRequest?.question || '代理需要你的输入'
          "
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />
        <p>
          <strong>目标:</strong>
          {{ truncate(currentInterventionGoal.description, 120) }}
        </p>
        <div
          v-if="currentInterventionGoal.inputRequest?.options?.length"
          style="margin-bottom: 16px"
        >
          <p>选择一个选项:</p>
          <a-space wrap>
            <a-button
              v-for="opt in currentInterventionGoal.inputRequest.options"
              :key="opt"
              @click="handleModalInput(currentInterventionGoal.id, opt)"
            >
              {{ opt }}
            </a-button>
          </a-space>
        </div>
        <a-divider>或输入自定义回复</a-divider>
        <a-input
          v-model:value="modalInput"
          placeholder="输入你的回复..."
          @press-enter="
            handleModalInput(currentInterventionGoal.id, modalInput)
          "
        />
        <a-button
          type="primary"
          block
          style="margin-top: 12px"
          @click="handleModalInput(currentInterventionGoal.id, modalInput)"
        >
          发送回复
        </a-button>
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive } from "vue";
import {
  RocketOutlined,
  ReloadOutlined,
  StopOutlined,
  PauseOutlined,
  CaretRightOutlined,
  CloseOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";
import { useAutonomousAgentStore } from "@/stores/autonomous-agent";
import type { GoalSpec, AutonomousGoal } from "@/stores/autonomous-agent";
import GoalSubmissionForm from "@/components/autonomous/GoalSubmissionForm.vue";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useAutonomousAgentStore();

const userInputs = reactive<Record<string, string>>({});
const interventionModalVisible = ref(false);
const modalInput = ref("");

const historyColumns = [
  { title: "状态", dataIndex: "status", key: "status", width: 100 },
  { title: "描述", dataIndex: "description", key: "description" },
  { title: "步骤", dataIndex: "stepCount", key: "stepCount", width: 70 },
  { title: "Token", dataIndex: "tokensUsed", key: "tokensUsed", width: 80 },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 160 },
  { title: "操作", key: "actions", width: 200 },
];

const currentInterventionGoal = computed<AutonomousGoal | null>(() => {
  const waiting = store.waitingGoals;
  return waiting.length > 0 ? waiting[0] : null;
});

watch(
  () => store.waitingGoals.length,
  (newVal) => {
    if (newVal > 0) {
      interventionModalVisible.value = true;
    }
  },
);

function handleRefresh() {
  store.refreshAll();
}

async function handleGoalSubmit(goalSpec: GoalSpec) {
  const result = await store.submitGoal(goalSpec);
  if (result) {
    message.success(`目标已提交: ${result.id.substring(0, 8)}...`);
  }
}

function handleBatchCancel() {
  const goalIds = store.activeGoals.map((g) => g.id);
  if (goalIds.length === 0) {
    return;
  }
  Modal.confirm({
    title: "取消所有活跃目标？",
    content: `将取消 ${goalIds.length} 个活跃目标。此操作不可撤销。`,
    okText: "全部取消",
    okType: "danger",
    async onOk() {
      const cancelled = await store.batchCancel(goalIds);
      message.info(`已取消 ${cancelled} 个目标`);
    },
  });
}

function handleProvideInput(goalId: string) {
  const input = userInputs[goalId];
  if (!input || !input.trim()) {
    message.warning("请输入回复");
    return;
  }
  store.provideInput(goalId, input.trim());
  userInputs[goalId] = "";
}

function handleModalInput(goalId: string, input: string) {
  if (!input || !input.trim()) {
    message.warning("请输入回复");
    return;
  }
  store.provideInput(goalId, input.trim());
  modalInput.value = "";
  interventionModalVisible.value = false;
}

function handleHistoryPageChange(page: number) {
  store.fetchGoalHistory(20, (page - 1) * 20);
}

function handleViewGoal(goalId: string) {
  store.selectGoal(goalId);
  const el = document.querySelector(".timeline-card");
  if (el) {
    el.scrollIntoView({ behavior: "smooth" });
  }
}

async function handleExportGoal(goalId: string) {
  const data = await store.exportGoal(goalId);
  if (data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goal-${goalId.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("目标已导出");
  }
}

function handleClearHistory() {
  Modal.confirm({
    title: "清理旧历史？",
    content: "将移除 30 天前已完成、失败和已取消的目标。",
    okText: "清理",
    okType: "danger",
    async onOk() {
      await store.clearHistory();
      message.success("历史已清理");
    },
  });
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    queued: "default",
    running: "processing",
    paused: "warning",
    waiting_input: "orange",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return colors[status] || "default";
}

function getGoalProgress(goal: AutonomousGoal): number {
  if (!goal.plan?.steps?.length) {
    return 0;
  }
  return Math.min(
    100,
    Math.round((goal.stepCount / goal.plan.steps.length) * 100),
  );
}

function truncate(text: string, length: number): string {
  if (!text) {
    return "";
  }
  return text.length > length ? text.substring(0, length) + "..." : text;
}

// Bind live event listeners (bind-once guarded in the store) + load all on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      store.initEventListeners();
      store.refreshAll();
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
.aa-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.aa-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.aa-stats {
  margin-bottom: 16px;
  text-align: center;
}
.aa-card {
  margin-bottom: 16px;
}
.goals-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.goal-card {
  cursor: pointer;
  transition: border-color 0.2s;
}
.goal-card:hover {
  border-color: #1890ff;
}
.goal-selected {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.1);
}
.goal-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.goal-desc {
  font-weight: normal;
}
.goal-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  margin-bottom: 8px;
}
.input-alert {
  margin-top: 8px;
}
.input-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-custom {
  display: flex;
  gap: 8px;
}
.step-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step-section p {
  margin: 4px 0 0;
}
.step-result {
  margin: 4px 0 0;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
  max-height: 200px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
}
.step-meta-row {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
