<template>
  <a-drawer
    v-model:open="visible"
    title="任务详情"
    width="800"
    :body-style="{ padding: 0 }"
    @close="handleClose"
  >
    <template #extra>
      <a-space>
        <a-button @click="handleEdit">
          <edit-outlined /> 编辑
        </a-button>
        <a-button
          danger
          @click="handleDelete"
        >
          <delete-outlined /> 删除
        </a-button>
      </a-space>
    </template>

    <div
      v-if="task"
      class="task-detail-content"
    >
      <a-tabs
        v-model:active-key="activeTab"
        class="task-tabs"
      >
        <!-- 详情标签页 -->
        <a-tab-pane
          key="detail"
          tab="详情"
        >
          <div class="detail-panel">
            <!-- 任务标题 -->
            <div class="task-header">
              <h2 class="task-title">
                {{ task.title }}
              </h2>
              <a-space>
                <a-tag :color="getStatusColor(task.status)">
                  {{ getStatusLabel(task.status) }}
                </a-tag>
                <a-tag :color="getPriorityColor(task.priority)">
                  {{ getPriorityLabel(task.priority) }}
                </a-tag>
              </a-space>
            </div>

            <!-- 任务描述 -->
            <div class="task-section">
              <h4 class="section-title">
                描述
              </h4>
              <div
                v-if="task.description"
                class="task-description"
              >
                {{ task.description }}
              </div>
              <a-empty
                v-else
                description="暂无描述"
                :image="Empty.PRESENTED_IMAGE_SIMPLE"
              />
            </div>

            <!-- 任务详细信息 -->
            <a-row
              :gutter="[16, 16]"
              class="task-info"
            >
              <a-col :span="12">
                <div class="info-item">
                  <label>分配给</label>
                  <div class="info-value">
                    <a-select
                      v-if="editing"
                      v-model:value="editForm.assigned_to"
                      placeholder="选择负责人"
                      style="width: 100%"
                    >
                      <a-select-option
                        v-for="member in workspaceMembers"
                        :key="member.did"
                        :value="member.did"
                      >
                        {{ member.name }}
                      </a-select-option>
                    </a-select>
                    <template v-else>
                      <a-avatar
                        v-if="task.assigned_to"
                        :size="24"
                        :style="{ backgroundColor: getAvatarColor(task.assigned_to) }"
                      >
                        {{ getAvatarText(task.assigned_to) }}
                      </a-avatar>
                      <span>{{ task.assigned_to || '未分配' }}</span>
                    </template>
                  </div>
                </div>
              </a-col>

              <a-col :span="12">
                <div class="info-item">
                  <label>截止日期</label>
                  <div class="info-value">
                    <a-date-picker
                      v-if="editing"
                      v-model:value="editForm.due_date"
                      show-time
                      style="width: 100%"
                    />
                    <template v-else>
                      <calendar-outlined />
                      <span :class="{ 'is-overdue': isOverdue }">
                        {{ task.due_date ? formatDateTime(task.due_date) : '未设置' }}
                      </span>
                    </template>
                  </div>
                </div>
              </a-col>

              <a-col :span="12">
                <div class="info-item">
                  <label>预估工时</label>
                  <div class="info-value">
                    <a-input-number
                      v-if="editing"
                      v-model:value="editForm.estimate_hours"
                      :min="0"
                      :step="0.5"
                      style="width: 100%"
                    />
                    <span v-else>{{ task.estimate_hours || 0 }} 小时</span>
                  </div>
                </div>
              </a-col>

              <a-col :span="12">
                <div class="info-item">
                  <label>实际工时</label>
                  <div class="info-value">
                    <span>{{ task.actual_hours || 0 }} 小时</span>
                  </div>
                </div>
              </a-col>

              <a-col :span="24">
                <div class="info-item">
                  <label>标签</label>
                  <div class="info-value">
                    <a-select
                      v-if="editing"
                      v-model:value="editForm.labels"
                      mode="tags"
                      placeholder="添加标签"
                      style="width: 100%"
                    />
                    <a-space
                      v-else
                      wrap
                    >
                      <a-tag
                        v-for="(label, index) in task.labels"
                        :key="index"
                        :color="getLabelColor(label)"
                      >
                        {{ label }}
                      </a-tag>
                      <span
                        v-if="!task.labels || task.labels.length === 0"
                        class="empty-text"
                      >无标签</span>
                    </a-space>
                  </div>
                </div>
              </a-col>

              <a-col :span="24">
                <div class="info-item">
                  <label>协作者</label>
                  <div class="info-value">
                    <a-select
                      v-if="editing"
                      v-model:value="editForm.collaborators"
                      mode="multiple"
                      placeholder="选择协作者"
                      style="width: 100%"
                    >
                      <a-select-option
                        v-for="member in workspaceMembers"
                        :key="member.did"
                        :value="member.did"
                      >
                        {{ member.name }}
                      </a-select-option>
                    </a-select>
                    <a-avatar-group
                      v-else
                      :max-count="5"
                    >
                      <a-tooltip
                        v-for="(collaborator, index) in task.collaborators"
                        :key="index"
                        :title="collaborator"
                      >
                        <a-avatar :style="{ backgroundColor: getAvatarColor(collaborator) }">
                          {{ getAvatarText(collaborator) }}
                        </a-avatar>
                      </a-tooltip>
                    </a-avatar-group>
                    <span
                      v-if="!task.collaborators || task.collaborators.length === 0"
                      class="empty-text"
                    >无协作者</span>
                  </div>
                </div>
              </a-col>
            </a-row>

            <!-- 任务时间线 -->
            <div class="task-section">
              <h4 class="section-title">
                时间线
              </h4>
              <div class="task-timeline">
                <div class="timeline-item">
                  <span class="label">创建时间：</span>
                  <span>{{ formatDateTime(task.created_at) }}</span>
                </div>
                <div class="timeline-item">
                  <span class="label">更新时间：</span>
                  <span>{{ formatDateTime(task.updated_at) }}</span>
                </div>
                <div
                  v-if="task.completed_at"
                  class="timeline-item"
                >
                  <span class="label">完成时间：</span>
                  <span>{{ formatDateTime(task.completed_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </a-tab-pane>

        <!-- 评论标签页 -->
        <a-tab-pane key="comments">
          <template #tab>
            评论
            <a-badge
              :count="taskStore.currentTaskComments.length"
              :number-style="{ backgroundColor: '#52c41a' }"
            />
          </template>
          <task-comments
            :task-id="task.id"
            :comments="taskStore.currentTaskComments"
            :workspace-members="workspaceMembers"
          />
        </a-tab-pane>

        <!-- 变更历史标签页 -->
        <a-tab-pane key="history">
          <template #tab>
            历史记录
            <a-badge :count="taskStore.currentTaskChanges.length" />
          </template>
          <div class="history-panel">
            <a-timeline>
              <a-timeline-item
                v-for="change in sortedChanges"
                :key="change.id"
                :color="getChangeColor(change.change_type)"
              >
                <div class="change-item">
                  <div class="change-header">
                    <a-avatar
                      :size="24"
                      :style="{ backgroundColor: getAvatarColor(change.changed_by) }"
                    >
                      {{ getAvatarText(change.changed_by) }}
                    </a-avatar>
                    <span class="changer-name">{{ change.changed_by }}</span>
                    <span class="change-action">{{ getChangeLabel(change.change_type) }}</span>
                    <span class="change-time">{{ formatDateTime(change.changed_at) }}</span>
                  </div>
                  <div
                    v-if="change.old_value || change.new_value"
                    class="change-detail"
                  >
                    <span
                      v-if="change.old_value"
                      class="old-value"
                    >{{ change.old_value }}</span>
                    <arrow-right-outlined />
                    <span
                      v-if="change.new_value"
                      class="new-value"
                    >{{ change.new_value }}</span>
                  </div>
                </div>
              </a-timeline-item>
            </a-timeline>

            <a-empty
              v-if="taskStore.currentTaskChanges.length === 0"
              description="暂无变更历史"
            />
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>
  </a-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Modal, Empty } from 'ant-design-vue';
import {
  EditOutlined,
  DeleteOutlined,
  CalendarOutlined,
  ArrowRightOutlined
} from '@ant-design/icons-vue';
import TaskComments from './TaskComments.vue';
import { useTaskStore } from '../../stores/task';
import { useWorkspaceStore } from '../../stores/workspace';

// Stores
const taskStore = useTaskStore();
const workspaceStore = useWorkspaceStore();

// State
const visible = computed({
  get: () => taskStore.taskDetailVisible,
  set: (val) => { taskStore.taskDetailVisible = val; }
});

const task = computed(() => taskStore.currentTask);
const activeTab = ref('detail');
const editing = ref(false);
const editForm = ref({});
const workspaceMembers = ref([]); // TODO: Load from workspace store

// Computed
const isOverdue = computed(() => {
  if (!task.value?.due_date || task.value.status === 'completed') {return false;}
  return task.value.due_date < Date.now();
});

const sortedChanges = computed(() => {
  return [...taskStore.currentTaskChanges].sort((a, b) => b.changed_at - a.changed_at);
});

// Methods
function getStatusLabel(status) {
  const labels = {
    pending: '待处理',
    in_progress: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  };
  return labels[status] || status;
}

function getStatusColor(status) {
  const colors = {
    pending: 'default',
    in_progress: 'processing',
    completed: 'success',
    cancelled: 'error'
  };
  return colors[status] || 'default';
}

function getPriorityLabel(priority) {
  const labels = {
    urgent: '紧急',
    high: '高',
    medium: '中',
    low: '低'
  };
  return labels[priority] || priority;
}

function getPriorityColor(priority) {
  const colors = {
    urgent: 'red',
    high: 'orange',
    medium: 'blue',
    low: 'green'
  };
  return colors[priority] || 'default';
}

function getLabelColor(label) {
  const colors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta'];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getAvatarColor(did) {
  const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2'];
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = did.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getAvatarText(did) {
  return did.substring(0, 2).toUpperCase();
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function getChangeLabel(changeType) {
  const labels = {
    create: '创建了任务',
    title: '修改了标题',
    description: '修改了描述',
    status: '变更了状态',
    priority: '调整了优先级',
    assigned_to: '分配给',
    due_date: '修改了截止日期'
  };
  return labels[changeType] || changeType;
}

function getChangeColor(changeType) {
  if (changeType === 'create') {return 'green';}
  if (changeType === 'status') {return 'blue';}
  return 'gray';
}

function handleEdit() {
  editing.value = true;
  editForm.value = {
    ...task.value,
    due_date: task.value.due_date ? new Date(task.value.due_date) : null
  };
}

async function handleDelete() {
  Modal.confirm({
    title: '确认删除',
    content: `确定要删除任务"${task.value.title}"吗？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      const success = await taskStore.deleteTask(task.value.id);
      if (success) {
        handleClose();
      }
    }
  });
}

function handleClose() {
  taskStore.closeTaskDetail();
  editing.value = false;
  activeTab.value = 'detail';
}

// Watch task changes
watch(
  () => task.value,
  (newTask) => {
    if (newTask) {
      // Reset active tab when task changes
      activeTab.value = 'detail';
    }
  }
);
</script>

<style scoped lang="less">
.task-detail-content {
  height: 100%;

  .task-tabs {
    height: 100%;

    :deep(.ant-tabs-content) {
      height: calc(100% - 46px);
    }

    :deep(.ant-tabs-tabpane) {
      height: 100%;
      overflow-y: auto;
    }
  }

  .detail-panel {
    padding: 24px;

    .task-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 24px;

      .task-title {
        flex: 1;
        margin: 0;
        font-size: 24px;
        font-weight: 600;
        color: #262626;
      }
    }

    .task-section {
      margin-bottom: 24px;

      .section-title {
        font-size: 16px;
        font-weight: 600;
        color: #262626;
        margin-bottom: 12px;
      }

      .task-description {
        font-size: 14px;
        color: #595959;
        line-height: 1.6;
        white-space: pre-wrap;
      }
    }

    .task-info {
      .info-item {
        label {
          display: block;
          font-size: 13px;
          color: #8c8c8c;
          margin-bottom: 8px;
        }

        .info-value {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          color: #262626;

          .is-overdue {
            color: #f5222d;
          }

          .empty-text {
            color: #8c8c8c;
          }
        }
      }
    }

    .task-timeline {
      .timeline-item {
        margin-bottom: 8px;
        font-size: 14px;

        .label {
          color: #8c8c8c;
          margin-right: 8px;
        }
      }
    }
  }

  .history-panel {
    padding: 24px;

    .change-item {
      .change-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;

        .changer-name {
          font-weight: 500;
        }

        .change-action {
          color: #8c8c8c;
        }

        .change-time {
          color: #bfbfbf;
          font-size: 12px;
          margin-left: auto;
        }
      }

      .change-detail {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: 32px;
        font-size: 13px;

        .old-value {
          color: #8c8c8c;
          text-decoration: line-through;
        }

        .new-value {
          color: #262626;
          font-weight: 500;
        }
      }
    }
  }
}
</style>
