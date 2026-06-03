<template>
  <div class="autonomous-agent-page">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <RocketOutlined />
          Autonomous Agent
        </h1>
        <p class="page-description">
          Submit goals and let AI agents execute them autonomously
        </p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button
            :loading="store.loading"
            @click="handleRefresh"
          >
            <ReloadOutlined />
            Refresh
          </a-button>
          <a-button
            v-if="store.activeGoalCount > 0"
            danger
            @click="handleBatchCancel"
          >
            <StopOutlined />
            Cancel All
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- Statistics Cards -->
    <div class="stats-section">
      <a-row :gutter="16">
        <a-col
          :xs="24"
          :sm="12"
          :md="6"
        >
          <a-card :loading="store.loading">
            <a-statistic
              title="Active Goals"
              :value="store.activeGoalCount"
              :prefix="h(ThunderboltOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
        <a-col
          :xs="24"
          :sm="12"
          :md="6"
        >
          <a-card :loading="store.loading">
            <a-statistic
              title="Running"
              :value="store.runningGoals.length"
              :prefix="h(SyncOutlined, { spin: store.runningGoals.length > 0 })"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
        <a-col
          :xs="24"
          :sm="12"
          :md="6"
        >
          <a-card :loading="store.loading">
            <a-statistic
              title="Completed"
              :value="store.stats?.completedGoals || 0"
              :prefix="h(CheckCircleOutlined)"
              :value-style="{ color: '#722ed1' }"
            />
          </a-card>
        </a-col>
        <a-col
          :xs="24"
          :sm="12"
          :md="6"
        >
          <a-card :loading="store.loading">
            <a-statistic
              title="Success Rate"
              :value="store.successRate"
              suffix="%"
              :precision="0"
              :prefix="h(TrophyOutlined)"
              :value-style="{ color: store.successRate >= 80 ? '#52c41a' : '#faad14' }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- Main Content -->
    <a-row :gutter="16">
      <!-- Left: Goals and Timeline -->
      <a-col
        :xs="24"
        :lg="18"
      >
        <!-- Goal Submission Form -->
        <a-card
          title="Submit New Goal"
          :bordered="false"
          class="form-card"
        >
          <GoalSubmissionForm
            :loading="store.loading"
            @submit="handleGoalSubmit"
          />
        </a-card>

        <!-- Active Goals -->
        <a-card
          title="Active Goals"
          :bordered="false"
          class="goals-card"
          :extra="store.activeGoalCount > 0 ? `${store.activeGoalCount} active` : ''"
        >
          <a-empty
            v-if="store.activeGoals.length === 0"
            description="No active goals"
          />

          <div
            v-else
            class="goals-list"
          >
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
                  <span class="goal-desc">{{ truncate(goal.description, 80) }}</span>
                </div>
              </template>

              <template #extra>
                <a-space size="small">
                  <a-button
                    v-if="goal.status === 'running'"
                    size="small"
                    @click.stop="store.pauseGoal(goal.id)"
                  >
                    <PauseOutlined />
                  </a-button>
                  <a-button
                    v-if="goal.status === 'paused'"
                    size="small"
                    type="primary"
                    @click.stop="store.resumeGoal(goal.id)"
                  >
                    <CaretRightOutlined />
                  </a-button>
                  <a-button
                    size="small"
                    danger
                    @click.stop="store.cancelGoal(goal.id)"
                  >
                    <CloseOutlined />
                  </a-button>
                </a-space>
              </template>

              <div class="goal-card-body">
                <div class="goal-meta">
                  <span>Priority: {{ goal.priority }}</span>
                  <span>Steps: {{ goal.stepCount }}</span>
                  <span>Tokens: {{ goal.tokensUsed }}</span>
                </div>

                <a-progress
                  v-if="goal.status === 'running'"
                  :percent="getGoalProgress(goal)"
                  :show-info="false"
                  size="small"
                  status="active"
                />

                <!-- Input Request Alert -->
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
                        v-if="goal.inputRequest.options && goal.inputRequest.options.length > 0"
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
                          placeholder="Type your response..."
                          size="small"
                          @press-enter="handleProvideInput(goal.id)"
                        />
                        <a-button
                          size="small"
                          type="primary"
                          @click.stop="handleProvideInput(goal.id)"
                        >
                          Send
                        </a-button>
                      </div>
                    </div>
                  </template>
                </a-alert>
              </div>
            </a-card>
          </div>
        </a-card>

        <!-- Execution Timeline (for selected goal) -->
        <a-card
          v-if="store.selectedGoalId"
          title="Execution Timeline"
          :bordered="false"
          class="timeline-card"
        >
          <template #extra>
            <a-button
              size="small"
              @click="store.selectGoal(null)"
            >
              <CloseOutlined />
              Close
            </a-button>
          </template>

          <a-empty
            v-if="store.currentGoalSteps.length === 0"
            description="No steps recorded yet"
          />

          <a-collapse
            v-else
            accordion
          >
            <a-collapse-panel
              v-for="step in store.currentGoalSteps"
              :key="step.id"
              :header="`Step ${step.stepNumber}: [${step.actionType}] ${step.success ? 'Success' : 'Failed'} (${step.durationMs}ms)`"
            >
              <template #extra>
                <a-tag
                  :color="step.success ? 'green' : 'red'"
                  size="small"
                >
                  {{ step.success ? 'OK' : 'ERR' }}
                </a-tag>
              </template>

              <div class="step-detail">
                <div
                  v-if="step.thought"
                  class="step-section"
                >
                  <strong>Reasoning:</strong>
                  <p>{{ step.thought }}</p>
                </div>
                <div class="step-section">
                  <strong>Action:</strong>
                  <p>{{ step.actionType }}: {{ JSON.stringify(step.actionParams) }}</p>
                </div>
                <div
                  v-if="step.result"
                  class="step-section"
                >
                  <strong>Result:</strong>
                  <pre class="step-result">{{ step.result }}</pre>
                </div>
                <div class="step-section step-meta-row">
                  <span>Tokens: {{ step.tokensUsed }}</span>
                  <span>Duration: {{ step.durationMs }}ms</span>
                  <span>{{ step.createdAt }}</span>
                </div>
              </div>
            </a-collapse-panel>
          </a-collapse>
        </a-card>

        <!-- Goal History -->
        <a-card
          title="Goal History"
          :bordered="false"
          class="history-card"
        >
          <template #extra>
            <a-button
              size="small"
              danger
              @click="handleClearHistory"
            >
              <DeleteOutlined />
              Clear Old
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
                  <a-button
                    size="small"
                    @click="handleViewGoal(record.id)"
                  >
                    View
                  </a-button>
                  <a-button
                    v-if="record.status === 'failed' || record.status === 'cancelled'"
                    size="small"
                    @click="store.retryGoal(record.id)"
                  >
                    Retry
                  </a-button>
                  <a-button
                    size="small"
                    @click="handleExportGoal(record.id)"
                  >
                    Export
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-col>

      <!-- Right: Queue Status -->
      <a-col
        :xs="24"
        :lg="6"
      >
        <a-card
          title="Queue Status"
          :bordered="false"
          class="queue-card"
        >
          <div
            v-if="store.queueStatus"
            class="queue-info"
          >
            <a-descriptions
              :column="1"
              size="small"
            >
              <a-descriptions-item label="Pending">
                {{ store.queueStatus.pending }}
              </a-descriptions-item>
              <a-descriptions-item label="Active">
                {{ store.queueStatus.active }}
              </a-descriptions-item>
              <a-descriptions-item label="Max Concurrent">
                {{ store.queueStatus.maxConcurrent }}
              </a-descriptions-item>
              <a-descriptions-item label="Can Accept">
                <a-tag :color="store.queueStatus.canAcceptMore ? 'green' : 'red'">
                  {{ store.queueStatus.canAcceptMore ? 'Yes' : 'Full' }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <a-divider style="margin: 12px 0" />

            <h4>Historical</h4>
            <a-descriptions
              :column="1"
              size="small"
            >
              <a-descriptions-item label="Processed">
                {{ store.queueStatus.historical.totalProcessed }}
              </a-descriptions-item>
              <a-descriptions-item label="Completed">
                {{ store.queueStatus.historical.totalCompleted }}
              </a-descriptions-item>
              <a-descriptions-item label="Failed">
                {{ store.queueStatus.historical.totalFailed }}
              </a-descriptions-item>
            </a-descriptions>

            <a-divider
              v-if="store.queueStatus.items.length > 0"
              style="margin: 12px 0"
            />

            <div v-if="store.queueStatus.items.length > 0">
              <h4>Queued Items</h4>
              <a-list
                size="small"
                :data-source="store.queueStatus.items"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <a-tag size="small">
                          P{{ item.priority }}
                        </a-tag>
                        {{ truncate(item.description, 40) }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </div>
          </div>

          <a-empty
            v-else
            description="No queue data"
          />
        </a-card>

        <!-- Configuration -->
        <a-card
          title="Configuration"
          :bordered="false"
          class="config-card"
        >
          <div v-if="store.config">
            <a-descriptions
              :column="1"
              size="small"
            >
              <a-descriptions-item label="Max Steps/Goal">
                {{ store.config.maxStepsPerGoal }}
              </a-descriptions-item>
              <a-descriptions-item label="Step Timeout">
                {{ Math.round(store.config.stepTimeoutMs / 1000) }}s
              </a-descriptions-item>
              <a-descriptions-item label="Max Concurrent">
                {{ store.config.maxConcurrentGoals }}
              </a-descriptions-item>
              <a-descriptions-item label="Token Budget">
                {{ store.config.tokenBudgetPerGoal.toLocaleString() }}
              </a-descriptions-item>
              <a-descriptions-item label="Max Replans">
                {{ store.config.maxReplanAttempts }}
              </a-descriptions-item>
            </a-descriptions>
          </div>
          <a-empty
            v-else
            description="Config not loaded"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- User Intervention Modal -->
    <a-modal
      v-model:open="interventionModalVisible"
      title="Agent Needs Your Input"
      :footer="null"
      :closable="true"
      @cancel="interventionModalVisible = false"
    >
      <div v-if="currentInterventionGoal">
        <a-alert
          :message="currentInterventionGoal.inputRequest?.question || 'The agent needs your input'"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />

        <p><strong>Goal:</strong> {{ truncate(currentInterventionGoal.description, 120) }}</p>

        <div
          v-if="currentInterventionGoal.inputRequest?.options?.length"
          style="margin-bottom: 16px"
        >
          <p>Select an option:</p>
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

        <a-divider>Or type a custom response</a-divider>

        <a-input
          v-model:value="modalInput"
          placeholder="Type your response..."
          @press-enter="handleModalInput(currentInterventionGoal.id, modalInput)"
        />
        <a-button
          type="primary"
          block
          style="margin-top: 12px"
          @click="handleModalInput(currentInterventionGoal.id, modalInput)"
        >
          Send Response
        </a-button>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, watch, reactive } from 'vue';
import {
  RocketOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  TrophyOutlined,
  PauseOutlined,
  CaretRightOutlined,
  CloseOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';
import { useAutonomousAgentStore } from '@/stores/autonomous-agent';
import type { GoalSpec, AutonomousGoal } from '@/stores/autonomous-agent';
import GoalSubmissionForm from '@/components/autonomous/GoalSubmissionForm.vue';

const store = useAutonomousAgentStore();

// Local state
const userInputs = reactive<Record<string, string>>({});
const interventionModalVisible = ref(false);
const modalInput = ref('');

// History table columns
const historyColumns = [
  { title: 'Status', dataIndex: 'status', key: 'status', width: 100 },
  { title: 'Description', dataIndex: 'description', key: 'description' },
  { title: 'Steps', dataIndex: 'stepCount', key: 'stepCount', width: 70 },
  { title: 'Tokens', dataIndex: 'tokensUsed', key: 'tokensUsed', width: 80 },
  { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
  { title: 'Actions', key: 'actions', width: 200 },
];

// Computed
const currentInterventionGoal = computed<AutonomousGoal | null>(() => {
  const waiting = store.waitingGoals;
  return waiting.length > 0 ? waiting[0] : null;
});

// Watch for input requests to show modal
watch(
  () => store.waitingGoals.length,
  (newVal) => {
    if (newVal > 0) {
      interventionModalVisible.value = true;
    }
  }
);

// Lifecycle
onMounted(async () => {
  store.initEventListeners();
  await store.refreshAll();
});

// Methods
function handleRefresh() {
  store.refreshAll();
}

async function handleGoalSubmit(goalSpec: GoalSpec) {
  const result = await store.submitGoal(goalSpec);
  if (result) {
    message.success(`Goal submitted: ${result.id.substring(0, 8)}...`);
  }
}

function handleBatchCancel() {
  const goalIds = store.activeGoals.map((g) => g.id);
  if (goalIds.length === 0) {return;}

  Modal.confirm({
    title: 'Cancel All Active Goals?',
    content: `This will cancel ${goalIds.length} active goal(s). This action cannot be undone.`,
    okText: 'Cancel All',
    okType: 'danger',
    async onOk() {
      const cancelled = await store.batchCancel(goalIds);
      message.info(`Cancelled ${cancelled} goal(s)`);
    },
  });
}

function handleProvideInput(goalId: string) {
  const input = userInputs[goalId];
  if (!input || !input.trim()) {
    message.warning('Please enter a response');
    return;
  }
  store.provideInput(goalId, input.trim());
  userInputs[goalId] = '';
}

function handleModalInput(goalId: string, input: string) {
  if (!input || !input.trim()) {
    message.warning('Please enter a response');
    return;
  }
  store.provideInput(goalId, input.trim());
  modalInput.value = '';
  interventionModalVisible.value = false;
}

function handleHistoryPageChange(page: number) {
  store.fetchGoalHistory(20, (page - 1) * 20);
}

function handleViewGoal(goalId: string) {
  store.selectGoal(goalId);
  // Scroll to timeline
  const el = document.querySelector('.timeline-card');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

async function handleExportGoal(goalId: string) {
  const data = await store.exportGoal(goalId);
  if (data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goal-${goalId.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('Goal exported');
  }
}

function handleClearHistory() {
  Modal.confirm({
    title: 'Clear Old History?',
    content: 'This will remove completed, failed, and cancelled goals older than 30 days.',
    okText: 'Clear',
    okType: 'danger',
    async onOk() {
      await store.clearHistory();
      message.success('History cleared');
    },
  });
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    queued: 'default',
    running: 'processing',
    paused: 'warning',
    waiting_input: 'orange',
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
  };
  return colors[status] || 'default';
}

function getGoalProgress(goal: AutonomousGoal): number {
  if (!goal.plan?.steps?.length) {return 0;}
  return Math.min(100, Math.round((goal.stepCount / goal.plan.steps.length) * 100));
}

function truncate(text: string, length: number): string {
  if (!text) {return '';}
  return text.length > length ? text.substring(0, length) + '...' : text;
}
</script>

<style scoped>
.autonomous-agent-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-description {
  margin: 4px 0 0;
  color: rgba(0, 0, 0, 0.45);
}

.stats-section {
  margin-bottom: 24px;
}

.form-card {
  margin-bottom: 16px;
}

.goals-card {
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
  font-size: 13px;
}

.goal-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.goal-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.input-alert {
  margin-top: 8px;
}

.input-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.input-custom {
  display: flex;
  gap: 8px;
}

.input-custom .ant-input {
  flex: 1;
}

.timeline-card {
  margin-bottom: 16px;
}

.step-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-section strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}

.step-section p {
  margin: 0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}

.step-result {
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.step-meta-row {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.history-card {
  margin-bottom: 16px;
}

.queue-card {
  margin-bottom: 16px;
}

.queue-info h4 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 8px;
}

.config-card {
  margin-bottom: 16px;
}
</style>
