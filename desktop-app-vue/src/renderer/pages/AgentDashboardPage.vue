<template>
  <div class="agent-dashboard-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <RobotOutlined />
          智能代理中心
        </h1>
        <p class="page-description">管理代理模板、实例、任务和性能分析</p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button :loading="store.loading" @click="handleRefresh">
            <ReloadOutlined />
            刷新
          </a-button>
          <a-button type="primary" @click="showOrchestrateModal">
            <ThunderboltOutlined />
            编排任务
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-section">
      <a-row :gutter="16">
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="代理模板"
              :value="store.totalTemplates"
              :prefix="h(AppstoreOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="活跃实例"
              :value="store.activeInstances.length"
              :prefix="h(PlayCircleOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="已完成任务"
              :value="store.completedTaskCount"
              :prefix="h(CheckCircleOutlined)"
              :value-style="{ color: '#722ed1' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="12" :md="6">
          <a-card :loading="store.loading">
            <a-statistic
              title="成功率"
              :value="store.overallSuccessRate"
              suffix="%"
              :precision="1"
              :prefix="h(TrophyOutlined)"
              :value-style="{
                color: store.overallSuccessRate >= 80 ? '#52c41a' : '#faad14',
              }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 标签页 -->
    <a-card :bordered="false" class="main-card">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 代理模板标签页 -->
        <a-tab-pane key="templates">
          <template #tab>
            <AppstoreOutlined />
            代理模板
          </template>

          <div class="tab-content">
            <div v-if="store.templates.length > 0" class="templates-grid">
              <a-row :gutter="[16, 16]">
                <a-col
                  v-for="template in store.templates"
                  :key="template.id"
                  :xs="24"
                  :sm="12"
                  :md="8"
                  :lg="6"
                >
                  <a-card class="template-card" hoverable>
                    <div class="template-header">
                      <a-avatar
                        :style="{ backgroundColor: getTypeColor(template.type) }"
                        shape="square"
                        :size="48"
                      >
                        {{ template.type.charAt(0).toUpperCase() }}
                      </a-avatar>
                      <div class="template-title">
                        <h3>{{ template.name }}</h3>
                        <a-tag :color="getTypeColor(template.type)">{{ template.type }}</a-tag>
                      </div>
                    </div>

                    <p class="template-desc">
                      {{ template.description || '暂无描述' }}
                    </p>

                    <div class="template-capabilities">
                      <strong>能力:</strong>
                      <span>{{ truncateText(template.capabilities, 60) }}</span>
                    </div>

                    <div class="template-footer">
                      <span class="template-version">v{{ template.version }}</span>
                      <a-switch
                        :checked="template.enabled"
                        checked-children="启用"
                        un-checked-children="禁用"
                        @change="(checked: boolean) => handleToggleTemplate(template, checked)"
                      />
                    </div>

                    <div class="template-actions">
                      <a-button
                        type="primary"
                        size="small"
                        :disabled="!template.enabled"
                        @click="handleDeployTemplate(template)"
                      >
                        <RocketOutlined />
                        部署
                      </a-button>
                      <a-button
                        size="small"
                        danger
                        @click="handleDeleteTemplate(template)"
                      >
                        <DeleteOutlined />
                      </a-button>
                    </div>
                  </a-card>
                </a-col>
              </a-row>
            </div>

            <a-empty
              v-else-if="!store.loading"
              description="暂无代理模板"
              style="margin-top: 60px"
            />

            <div v-if="store.loading" class="loading-container">
              <a-spin size="large" tip="加载代理模板..." />
            </div>
          </div>
        </a-tab-pane>

        <!-- 运行实例标签页 -->
        <a-tab-pane key="instances">
          <template #tab>
            <PlayCircleOutlined />
            运行实例
            <a-badge
              :count="store.runningInstanceCount"
              :number-style="{ backgroundColor: '#52c41a' }"
              style="margin-left: 8px"
            />
          </template>

          <div class="tab-content">
            <a-table
              :columns="instanceColumns"
              :data-source="store.instances"
              :loading="store.loading"
              row-key="id"
              :pagination="{ pageSize: 10 }"
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
                  <a-space>
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
                      <a-button type="link" danger size="small">
                        终止
                      </a-button>
                    </a-popconfirm>
                  </a-space>
                </template>
              </template>

              <template #emptyText>
                <a-empty description="暂无运行中的实例" />
              </template>
            </a-table>
          </div>
        </a-tab-pane>

        <!-- 任务历史标签页 -->
        <a-tab-pane key="history">
          <template #tab>
            <HistoryOutlined />
            任务历史
          </template>

          <div class="tab-content">
            <a-table
              :columns="historyColumns"
              :data-source="store.taskHistory"
              :loading="store.loading"
              row-key="id"
              :pagination="{ pageSize: 10 }"
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
                  <a-tag v-if="record.success === true" color="success">
                    <CheckCircleOutlined />
                    成功
                  </a-tag>
                  <a-tag v-else-if="record.success === false" color="error">
                    <CloseCircleOutlined />
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
          </div>
        </a-tab-pane>

        <!-- 性能分析标签页 -->
        <a-tab-pane key="performance">
          <template #tab>
            <BarChartOutlined />
            性能分析
          </template>

          <div class="tab-content">
            <div v-if="store.performance.length > 0" class="performance-section">
              <!-- 性能总览表格 -->
              <a-table
                :columns="performanceColumns"
                :data-source="store.performance"
                :loading="store.loading"
                row-key="templateType"
                :pagination="false"
                style="margin-bottom: 24px"
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
                      :status="record.successRate >= 80 ? 'success' : record.successRate >= 50 ? 'normal' : 'exception'"
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

              <!-- ECharts 性能图表占位 -->
              <a-row :gutter="16">
                <a-col :xs="24" :md="12">
                  <a-card title="任务完成趋势" :bordered="false">
                    <div ref="taskTrendChart" class="chart-placeholder">
                      <BarChartOutlined style="font-size: 48px; color: #d9d9d9" />
                      <p>ECharts 图表区域</p>
                    </div>
                  </a-card>
                </a-col>
                <a-col :xs="24" :md="12">
                  <a-card title="Token 消耗分布" :bordered="false">
                    <div ref="tokenDistChart" class="chart-placeholder">
                      <PieChartOutlined style="font-size: 48px; color: #d9d9d9" />
                      <p>ECharts 图表区域</p>
                    </div>
                  </a-card>
                </a-col>
              </a-row>
            </div>

            <a-empty
              v-else-if="!store.loading"
              description="暂无性能数据，运行代理任务后将显示分析结果"
              style="margin-top: 60px"
            />

            <div v-if="store.loading" class="loading-container">
              <a-spin size="large" tip="加载性能数据..." />
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <!-- 编排任务模态框 -->
    <a-modal
      v-model:open="orchestrateModalVisible"
      title="编排任务"
      :confirm-loading="orchestrating"
      width="600px"
      ok-text="开始编排"
      cancel-text="取消"
      @ok="handleOrchestrate"
    >
      <a-form :label-col="{ span: 4 }" :wrapper-col="{ span: 20 }">
        <a-form-item label="任务描述" required>
          <a-textarea
            v-model:value="orchestrateForm.taskDescription"
            placeholder="请详细描述要编排的任务，系统将自动分析并分配给合适的代理..."
            :rows="6"
            :maxlength="2000"
            show-count
          />
        </a-form-item>
        <a-form-item label="说明">
          <a-alert
            message="编排引擎会分析任务描述，自动选择合适的代理模板并生成执行计划"
            type="info"
            show-icon
          />
        </a-form-item>
      </a-form>

      <!-- 编排结果展示 -->
      <div v-if="orchestrationResult" class="orchestration-result">
        <a-divider>编排结果</a-divider>
        <a-timeline>
          <a-timeline-item
            v-for="(step, index) in (orchestrationResult.steps || [])"
            :key="index"
            :color="step.status === 'completed' ? 'green' : step.status === 'running' ? 'blue' : 'gray'"
          >
            <strong>{{ step.agentType }}</strong>: {{ step.action }}
            <template v-if="step.dependencies && step.dependencies.length > 0">
              <br />
              <span style="color: #8c8c8c; font-size: 12px">
                依赖: {{ step.dependencies.join(', ') }}
              </span>
            </template>
          </a-timeline-item>
        </a-timeline>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h } from 'vue';
import { message, Modal } from 'ant-design-vue';
import type { TableColumnType } from 'ant-design-vue';
import {
  RobotOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  TrophyOutlined,
  RocketOutlined,
  DeleteOutlined,
  HistoryOutlined,
  BarChartOutlined,
  PieChartOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons-vue';
import { useAgentsStore } from '../stores/agents';
import type { AgentTemplate, AgentInstance, OrchestrationPlan } from '../stores/agents';
import { logger, createLogger } from '@/utils/logger';

const agentLogger = createLogger('agent-dashboard');
const store = useAgentsStore();

// ==================== 状态 ====================

const activeTab = ref('templates');
const orchestrateModalVisible = ref(false);
const orchestrating = ref(false);
const orchestrationResult = ref<OrchestrationPlan | null>(null);

const orchestrateForm = ref({
  taskDescription: '',
});

// 图表引用占位
const taskTrendChart = ref<HTMLElement | null>(null);
const tokenDistChart = ref<HTMLElement | null>(null);

// ==================== 表格列定义 ====================

const instanceColumns: TableColumnType[] = [
  { title: 'ID', dataIndex: 'id', key: 'id', width: 120, ellipsis: true },
  { title: '代理类型', dataIndex: 'templateType', key: 'templateType', width: 120 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '当前任务', dataIndex: 'currentTask', key: 'currentTask', ellipsis: true },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
  { title: '操作', key: 'actions', width: 140, fixed: 'right' as const },
];

const historyColumns: TableColumnType[] = [
  { title: '代理类型', dataIndex: 'template_type', key: 'template_type', width: 120 },
  { title: '任务描述', dataIndex: 'task_description', key: 'task_description', ellipsis: true },
  { title: '结果', dataIndex: 'success', key: 'success', width: 100 },
  { title: '耗时', key: 'duration', width: 100 },
  { title: 'Tokens', dataIndex: 'tokens_used', key: 'tokens_used', width: 100 },
  { title: '开始时间', dataIndex: 'started_at', key: 'started_at', width: 160 },
];

const performanceColumns: TableColumnType[] = [
  { title: '代理类型', dataIndex: 'templateType', key: 'templateType', width: 140 },
  { title: '总任务数', dataIndex: 'totalTasks', key: 'totalTasks', width: 100 },
  { title: '成功率', dataIndex: 'successRate', key: 'successRate', width: 180 },
  { title: '平均耗时', dataIndex: 'avgDuration', key: 'avgDuration', width: 120 },
  { title: '总 Tokens', dataIndex: 'totalTokens', key: 'totalTokens', width: 120 },
];

// ==================== 方法 ====================

async function loadInitialData() {
  try {
    await Promise.all([
      store.fetchTemplates(),
      store.fetchInstances(),
      store.fetchPerformance(),
    ]);
    agentLogger.info('初始数据加载完成');
  } catch (error) {
    agentLogger.error('初始数据加载失败:', error);
    message.error('数据加载失败，请刷新页面重试');
  }
}

async function handleRefresh() {
  agentLogger.info('刷新数据');
  await loadInitialData();
  message.success('刷新成功');
}

function showOrchestrateModal() {
  orchestrateForm.value.taskDescription = '';
  orchestrationResult.value = null;
  orchestrateModalVisible.value = true;
}

async function handleOrchestrate() {
  const desc = orchestrateForm.value.taskDescription.trim();
  if (!desc) {
    message.error('请输入任务描述');
    return;
  }

  orchestrating.value = true;
  try {
    const plan = await store.orchestrate(desc);
    if (plan) {
      orchestrationResult.value = plan;
      message.success('编排计划生成成功');
    } else {
      message.error(store.error || '编排失败');
    }
  } catch (error) {
    agentLogger.error('编排任务失败:', error);
    message.error('编排失败: ' + (error as Error).message);
  } finally {
    orchestrating.value = false;
  }
}

async function handleToggleTemplate(template: AgentTemplate, checked: boolean) {
  try {
    const success = await store.updateTemplate(template.id, { enabled: checked });
    if (success) {
      message.success(`模板 "${template.name}" 已${checked ? '启用' : '禁用'}`);
    } else {
      message.error(store.error || '操作失败');
    }
  } catch (error) {
    agentLogger.error('切换模板状态失败:', error);
    message.error('操作失败: ' + (error as Error).message);
  }
}

async function handleDeployTemplate(template: AgentTemplate) {
  try {
    const instance = await store.deployAgent(template.id);
    if (instance) {
      message.success(`代理 "${template.name}" 部署成功`);
      activeTab.value = 'instances';
    } else {
      message.error(store.error || '部署失败');
    }
  } catch (error) {
    agentLogger.error('部署代理失败:', error);
    message.error('部署失败: ' + (error as Error).message);
  }
}

function handleDeleteTemplate(template: AgentTemplate) {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除代理模板 "${template.name}" 吗？此操作不可撤销。`,
    icon: h(ExclamationCircleOutlined),
    okText: '确认删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        const success = await store.deleteTemplate(template.id);
        if (success) {
          message.success(`模板 "${template.name}" 已删除`);
        } else {
          message.error(store.error || '删除失败');
        }
      } catch (error) {
        agentLogger.error('删除模板失败:', error);
        message.error('删除失败: ' + (error as Error).message);
      }
    },
  });
}

async function handleViewStatus(instance: AgentInstance) {
  try {
    const status = await store.getStatus(instance.id);
    if (status) {
      Modal.info({
        title: `实例状态: ${instance.id}`,
        content: h('pre', { style: 'max-height: 400px; overflow: auto' }, JSON.stringify(status, null, 2)),
        width: 600,
      });
    }
  } catch (error) {
    agentLogger.error('获取实例状态失败:', error);
    message.error('获取状态失败');
  }
}

async function handleTerminate(instance: AgentInstance) {
  try {
    const success = await store.terminateAgent(instance.id, '用户主动终止');
    if (success) {
      message.success('实例已终止');
    } else {
      message.error(store.error || '终止失败');
    }
  } catch (error) {
    agentLogger.error('终止实例失败:', error);
    message.error('终止失败: ' + (error as Error).message);
  }
}

// ==================== 工具函数 ====================

function getTypeColor(type: string): string {
  const colorMap: Record<string, string> = {
    coder: '#1890ff',
    researcher: '#52c41a',
    analyst: '#722ed1',
    writer: '#fa8c16',
    reviewer: '#13c2c2',
    planner: '#eb2f96',
    tester: '#faad14',
    deployer: '#2f54eb',
  };
  return colorMap[type] || '#8c8c8c';
}

function getStatusColor(status: string): string {
  const statusColorMap: Record<string, string> = {
    idle: 'default',
    running: 'processing',
    completed: 'success',
    failed: 'error',
  };
  return statusColorMap[status] || 'default';
}

function getStatusLabel(status: string): string {
  const statusLabelMap: Record<string, string> = {
    idle: '空闲',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
  };
  return statusLabelMap[status] || status;
}

function truncateText(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatDuration(startedAt: number | undefined, completedAt: number | undefined): string {
  if (!startedAt || !completedAt) return '--';
  const duration = completedAt - startedAt;
  if (duration < 1000) return duration + 'ms';
  if (duration < 60000) return (duration / 1000).toFixed(1) + 's';
  return (duration / 60000).toFixed(1) + 'min';
}

// ==================== 生命周期 ====================

onMounted(async () => {
  agentLogger.info('AgentDashboardPage 挂载');
  await loadInitialData();
});
</script>

<style scoped lang="scss">
.agent-dashboard-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #722ed1;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }

    .header-right {
      display: flex;
      gap: 12px;
    }
  }

  .stats-section {
    margin-bottom: 24px;

    .ant-card {
      border-radius: 8px;
    }
  }

  .main-card {
    border-radius: 8px;

    :deep(.ant-card-body) {
      padding: 0 24px 24px;
    }
  }

  .tab-content {
    min-height: 300px;
  }

  // 模板卡片
  .templates-grid {
    .template-card {
      border-radius: 8px;
      height: 100%;

      .template-header {
        display: flex;
        gap: 12px;
        margin-bottom: 12px;

        .template-title {
          flex: 1;

          h3 {
            margin: 0 0 4px 0;
            font-size: 15px;
            font-weight: 600;
          }
        }
      }

      .template-desc {
        color: #8c8c8c;
        font-size: 13px;
        margin-bottom: 12px;
        min-height: 36px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .template-capabilities {
        font-size: 13px;
        color: #595959;
        margin-bottom: 12px;

        strong {
          color: #262626;
          margin-right: 4px;
        }
      }

      .template-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;

        .template-version {
          color: #bfbfbf;
          font-size: 12px;
        }
      }

      .template-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
    }
  }

  // 性能分析
  .performance-section {
    .chart-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 280px;
      border: 1px dashed #d9d9d9;
      border-radius: 8px;
      background: #fafafa;
      color: #bfbfbf;

      p {
        margin-top: 12px;
        font-size: 14px;
      }
    }
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 80px 0;
  }
}

// 编排结果
.orchestration-result {
  margin-top: 16px;
}

// 响应式调整
@media (max-width: 768px) {
  .agent-dashboard-page {
    padding: 16px;

    .page-header {
      flex-direction: column;
      gap: 16px;

      .header-right {
        width: 100%;

        :deep(.ant-space) {
          width: 100%;
          justify-content: flex-end;
        }
      }
    }
  }
}
</style>
