<template>
  <div class="progress-monitor">
    <div class="monitor-header">
      <h3>
        <span class="icon">📊</span>
        任务进度监控
      </h3>
      <div class="header-actions">
        <a-badge
          :count="activeTasks.length"
          :overflow-count="99"
        >
          <a-button
            size="small"
            @click="toggleExpand"
          >
            {{ isExpanded ? '收起' : '展开' }}
          </a-button>
        </a-badge>
        <a-button
          size="small"
          danger
          :disabled="completedTasks.length === 0"
          @click="clearCompleted"
        >
          清除已完成
        </a-button>
      </div>
    </div>

    <div
      v-show="isExpanded"
      class="monitor-body"
    >
      <!-- 活动任务 -->
      <div
        v-if="activeTasks.length > 0"
        class="task-section active-tasks"
      >
        <div class="section-title">
          <span class="badge active">{{ activeTasks.length }}</span>
          正在进行
        </div>
        <TransitionGroup
          name="task-list"
          tag="div"
          class="task-list"
        >
          <div
            v-for="task in activeTasks"
            :key="task.taskId"
            class="task-item"
            :class="[`stage-${task.stage}`, { pulsing: task.percent < 100 }]"
          >
            <div class="task-header">
              <div class="task-info">
                <span class="task-icon">{{ getStageIcon(task.stage) }}</span>
                <div class="task-details">
                  <div class="task-title">
                    {{ task.title }}
                  </div>
                  <div class="task-description">
                    {{ task.description }}
                  </div>
                </div>
              </div>
              <div class="task-percent">
                {{ task.percent }}%
              </div>
            </div>

            <a-progress
              :percent="task.percent"
              :status="getProgressStatus(task.stage)"
              :stroke-color="getProgressColor(task.stage)"
              :show-info="false"
            />

            <div class="task-footer">
              <div class="task-message">
                {{ task.message }}
              </div>
              <div class="task-time">
                <ClockCircleOutlined />
                {{ formatDuration(task.duration) }}
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- 已完成任务 -->
      <div
        v-if="completedTasks.length > 0"
        class="task-section completed-tasks"
      >
        <div class="section-title">
          <span class="badge completed">{{ completedTasks.length }}</span>
          最近完成
        </div>
        <TransitionGroup
          name="task-list"
          tag="div"
          class="task-list"
        >
          <div
            v-for="task in completedTasks.slice(0, 5)"
            :key="task.taskId"
            class="task-item completed"
          >
            <div class="task-header">
              <div class="task-info">
                <span class="task-icon">✅</span>
                <div class="task-details">
                  <div class="task-title">
                    {{ task.title }}
                  </div>
                  <div class="task-description">
                    {{ task.message }}
                  </div>
                </div>
              </div>
              <div class="task-time">
                {{ formatDuration(task.duration) }}
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- 失败任务 -->
      <div
        v-if="failedTasks.length > 0"
        class="task-section failed-tasks"
      >
        <div class="section-title">
          <span class="badge failed">{{ failedTasks.length }}</span>
          失败任务
        </div>
        <TransitionGroup
          name="task-list"
          tag="div"
          class="task-list"
        >
          <div
            v-for="task in failedTasks.slice(0, 3)"
            :key="task.taskId"
            class="task-item failed"
          >
            <div class="task-header">
              <div class="task-info">
                <span class="task-icon">❌</span>
                <div class="task-details">
                  <div class="task-title">
                    {{ task.title }}
                  </div>
                  <div class="task-description error">
                    {{ task.error || task.message }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <!-- 空状态 -->
      <div
        v-if="allTasks.length === 0"
        class="empty-state"
      >
        <InboxOutlined style="font-size: 48px; color: #ccc" />
        <p>暂无任务</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ClockCircleOutlined, InboxOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  maxCompletedTasks: {
    type: Number,
    default: 10,
  },
});

// 状态
const isExpanded = ref(true);
const tasks = ref(new Map());

// 计算属性
const allTasks = computed(() => Array.from(tasks.value.values()));

const activeTasks = computed(() =>
  allTasks.value.filter(
    (t) => !['completed', 'failed', 'cancelled'].includes(t.stage)
  )
);

const completedTasks = computed(() =>
  allTasks.value.filter((t) => t.stage === 'completed')
);

const failedTasks = computed(() =>
  allTasks.value.filter((t) => t.stage === 'failed')
);

// 方法
const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

const clearCompleted = () => {
  completedTasks.value.forEach((task) => {
    tasks.value.delete(task.taskId);
  });
};

const getStageIcon = (stage) => {
  const icons = {
    pending: '⏳',
    preparing: '🔧',
    processing: '⚙️',
    finalizing: '🏁',
    completed: '✅',
    failed: '❌',
    cancelled: '🚫',
  };
  return icons[stage] || '📋';
};

const getProgressStatus = (stage) => {
  if (stage === 'failed') {return 'exception';}
  if (stage === 'completed') {return 'success';}
  return 'active';
};

const getProgressColor = (stage) => {
  const colors = {
    pending: '#faad14',
    preparing: '#1890ff',
    processing: '#52c41a',
    finalizing: '#13c2c2',
    completed: '#52c41a',
    failed: '#f5222d',
    cancelled: '#d9d9d9',
  };
  return colors[stage] || '#1890ff';
};

const formatDuration = (ms) => {
  if (!ms || ms === 0) {return '0秒';}

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {return `${seconds}秒`;}

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {return `${minutes}分${remainingSeconds}秒`;}

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}时${remainingMinutes}分`;
};

const handleTaskProgress = (event, data) => {
  const task = tasks.value.get(data.taskId) || {};

  tasks.value.set(data.taskId, {
    ...task,
    ...data,
    duration: Date.now() - (data.startTime || Date.now()),
  });

  // 自动清理已完成任务（延迟10秒）
  if (data.stage === 'completed' && completedTasks.value.length > props.maxCompletedTasks) {
    setTimeout(() => {
      const oldestCompleted = completedTasks.value
        .sort((a, b) => a.startTime - b.startTime)
        .slice(0, completedTasks.value.length - props.maxCompletedTasks);

      oldestCompleted.forEach((t) => tasks.value.delete(t.taskId));
    }, 10000);
  }
};

// 生命周期
onMounted(() => {
  // 监听来自主进程的进度事件
  if (window.electronAPI) {
    window.electronAPI.on('task-progress', handleTaskProgress);
  }
});

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.off('task-progress', handleTaskProgress);
  }
});

// 导出方法供外部调用
defineExpose({
  addTask: (taskData) => {
    tasks.value.set(taskData.taskId, taskData);
  },
  updateTask: (taskId, updates) => {
    const task = tasks.value.get(taskId);
    if (task) {
      tasks.value.set(taskId, { ...task, ...updates });
    }
  },
  removeTask: (taskId) => {
    tasks.value.delete(taskId);
  },
  clearAll: () => {
    tasks.value.clear();
  },
  toggleExpand,
  clearCompleted,
});
</script>

<style scoped lang="scss">
.progress-monitor {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;

    .icon {
      font-size: 20px;
    }
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }
}

.monitor-body {
  max-height: 600px;
  overflow-y: auto;
  padding: 16px;
}

.task-section {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #595959;

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 10px;
    color: white;

    &.active {
      background: #1890ff;
    }

    &.completed {
      background: #52c41a;
    }

    &.failed {
      background: #f5222d;
    }
  }
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-item {
  background: #fafafa;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  padding: 12px;
  transition: all 0.3s ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
  }

  &.pulsing {
    animation: pulse 2s ease-in-out infinite;
  }

  &.completed {
    background: #f6ffed;
    border-color: #b7eb8f;
  }

  &.failed {
    background: #fff2f0;
    border-color: #ffccc7;
  }
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.task-info {
  display: flex;
  gap: 12px;
  flex: 1;
}

.task-icon {
  font-size: 24px;
  line-height: 1;
}

.task-details {
  flex: 1;
}

.task-title {
  font-size: 14px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 4px;
}

.task-description {
  font-size: 12px;
  color: #8c8c8c;

  &.error {
    color: #f5222d;
  }
}

.task-percent {
  font-size: 18px;
  font-weight: 700;
  color: #1890ff;
  min-width: 50px;
  text-align: right;
}

.task-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
  color: #8c8c8c;
}

.task-message {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-time {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #8c8c8c;

  p {
    margin-top: 16px;
    font-size: 14px;
  }
}

// 动画
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.85;
  }
}

.task-list-move,
.task-list-enter-active,
.task-list-leave-active {
  transition: all 0.5s ease;
}

.task-list-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.task-list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.task-list-leave-active {
  position: absolute;
}
</style>
