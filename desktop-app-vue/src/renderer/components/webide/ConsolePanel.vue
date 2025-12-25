<template>
  <div class="console-panel">
    <!-- 控制台头部 -->
    <div class="console-header">
      <a-space size="small">
        <span class="header-title">
          <BugOutlined />
          控制台
        </span>
        <a-divider type="vertical" />
        <a-select
          v-model:value="logFilter"
          size="small"
          style="width: 100px"
        >
          <a-select-option value="all">全部</a-select-option>
          <a-select-option value="log">Log</a-select-option>
          <a-select-option value="error">Error</a-select-option>
          <a-select-option value="warn">Warn</a-select-option>
          <a-select-option value="info">Info</a-select-option>
        </a-select>
        <a-tooltip title="清空控制台">
          <a-button size="small" @click="handleClear">
            <DeleteOutlined />
          </a-button>
        </a-tooltip>
      </a-space>
    </div>

    <!-- 控制台内容 -->
    <div ref="consoleContainerRef" class="console-content">
      <div
        v-for="log in filteredLogs"
        :key="log.id"
        :class="['log-item', `log-${log.method}`]"
      >
        <span class="log-time">{{ log.timestamp }}</span>
        <span class="log-method">
          <component :is="getLogIcon(log.method)" />
        </span>
        <span class="log-args">{{ formatLogArgs(log.args) }}</span>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredLogs.length === 0" class="empty-state">
        <InfoCircleOutlined />
        <p>暂无日志</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import {
  BugOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleFilled,
} from '@ant-design/icons-vue';

const props = defineProps({
  logs: {
    type: Array,
    default: () => [],
  },
});

// 状态
const consoleContainerRef = ref(null);
const logFilter = ref('all');

// 过滤后的日志
const filteredLogs = computed(() => {
  if (logFilter.value === 'all') {
    return props.logs;
  }
  return props.logs.filter((log) => log.method === logFilter.value);
});

// 获取日志图标
const getLogIcon = (method) => {
  const iconMap = {
    log: CheckCircleOutlined,
    error: CloseCircleOutlined,
    warn: WarningOutlined,
    info: InfoCircleFilled,
  };
  return iconMap[method] || InfoCircleOutlined;
};

// 格式化日志参数
const formatLogArgs = (args) => {
  if (!args || args.length === 0) return '';
  return args.join(' ');
};

// 清空控制台
const handleClear = () => {
  // 通知父组件清空
};

// 自动滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (consoleContainerRef.value) {
      consoleContainerRef.value.scrollTop = consoleContainerRef.value.scrollHeight;
    }
  });
};

// 监听日志变化
watch(
  () => props.logs,
  () => {
    scrollToBottom();
  },
  { deep: true }
);

// 暴露方法
defineExpose({
  clear: () => {
    handleClear();
  },
});
</script>

<style scoped>
.console-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}

/* 控制台头部 */
.console-header {
  padding: 8px 12px;
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
  flex-shrink: 0;
}

.header-title {
  color: #cccccc;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 控制台内容 */
.console-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 20px;
}

/* 日志项 */
.log-item {
  display: flex;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid #2a2a2a;
  align-items: flex-start;
}

.log-item:hover {
  background: #2d2d30;
}

.log-time {
  color: #858585;
  min-width: 70px;
  flex-shrink: 0;
  font-size: 11px;
}

.log-method {
  min-width: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.log-args {
  flex: 1;
  word-break: break-all;
  white-space: pre-wrap;
}

/* 日志类型颜色 */
.log-log {
  color: #d4d4d4;
}

.log-log .log-method {
  color: #4ec9b0;
}

.log-error {
  color: #f48771;
  background: #3a1515;
}

.log-error .log-method {
  color: #f48771;
}

.log-warn {
  color: #dcdcaa;
  background: #3a3a1a;
}

.log-warn .log-method {
  color: #dcdcaa;
}

.log-info {
  color: #4fc1ff;
}

.log-info .log-method {
  color: #4fc1ff;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #858585;
  gap: 12px;
  font-size: 14px;
}

.empty-state p {
  margin: 0;
}

/* 滚动条样式 */
.console-content::-webkit-scrollbar {
  width: 8px;
}

.console-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.console-content::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 4px;
}

.console-content::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
</style>
