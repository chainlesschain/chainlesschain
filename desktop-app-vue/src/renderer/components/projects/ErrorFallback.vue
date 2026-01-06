<template>
  <div class="error-fallback-panel">
    <!-- 头部 -->
    <div class="fallback-header">
      <h4 class="fallback-title">
        <WarningOutlined />
        错误降级策略
      </h4>
      <a-button type="text" size="small" @click="$emit('close')">
        <CloseOutlined />
      </a-button>
    </div>

    <!-- 错误监控状态 -->
    <div class="monitoring-status">
      <a-card size="small" title="监控状态" :bordered="false">
        <a-row :gutter="16">
          <a-col :span="8">
            <a-statistic
              title="错误数"
              :value="errorStats.total"
              :value-style="{ color: errorStats.total > 0 ? '#ff4d4f' : '#52c41a' }"
            >
              <template #prefix>
                <ExclamationCircleOutlined />
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="降级次数"
              :value="errorStats.fallbackCount"
              :value-style="{ color: '#faad14' }"
            >
              <template #prefix>
                <FallOutlined />
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="8">
            <a-statistic
              title="恢复次数"
              :value="errorStats.recoveryCount"
              :value-style="{ color: '#52c41a' }"
            >
              <template #prefix>
                <CheckCircleOutlined />
              </template>
            </a-statistic>
          </a-col>
        </a-row>
      </a-card>
    </div>

    <!-- 降级策略配置 -->
    <div class="fallback-config">
      <a-card size="small" title="降级策略配置" :bordered="false">
        <a-form layout="vertical">
          <a-form-item label="启用自动降级">
            <a-switch v-model:checked="config.autoFallback" />
            <span class="config-hint">当检测到错误时自动启用降级策略</span>
          </a-form-item>

          <a-form-item label="错误阈值">
            <a-slider
              v-model:value="config.errorThreshold"
              :min="1"
              :max="10"
              :marks="{ 1: '1', 5: '5', 10: '10' }"
            />
            <span class="config-hint">连续错误 {{ config.errorThreshold }} 次后触发降级</span>
          </a-form-item>

          <a-form-item label="降级级别">
            <a-radio-group v-model:value="config.fallbackLevel">
              <a-radio value="minimal">最小功能</a-radio>
              <a-radio value="basic">基础功能</a-radio>
              <a-radio value="full">完整功能</a-radio>
            </a-radio-group>
          </a-form-item>

          <a-form-item label="自动恢复">
            <a-switch v-model:checked="config.autoRecovery" />
            <span class="config-hint">错误消失后自动恢复正常功能</span>
          </a-form-item>

          <a-form-item label="恢复延迟（秒）">
            <a-input-number
              v-model:value="config.recoveryDelay"
              :min="0"
              :max="300"
              style="width: 100%"
            />
          </a-form-item>
        </a-form>

        <a-button type="primary" block @click="handleSaveConfig">
          保存配置
        </a-button>
      </a-card>
    </div>

    <!-- 错误日志 -->
    <div class="error-logs">
      <a-card size="small" :bordered="false">
        <template #title>
          <div style="display: flex; justify-content: space-between; align-items: center">
            <span>错误日志</span>
            <a-button type="link" size="small" @click="handleClearLogs">
              清空日志
            </a-button>
          </div>
        </template>

        <div v-if="errorLogs.length === 0" class="logs-empty">
          <CheckCircleOutlined style="font-size: 48px; color: #52c41a" />
          <p>暂无错误记录</p>
        </div>

        <a-timeline v-else>
          <a-timeline-item
            v-for="log in errorLogs"
            :key="log.id"
            :color="getLogColor(log.level)"
          >
            <div class="log-item">
              <div class="log-header">
                <a-tag :color="getLogColor(log.level)">
                  {{ getLogLevelText(log.level) }}
                </a-tag>
                <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              </div>
              <div class="log-message">{{ log.message }}</div>
              <div v-if="log.stack" class="log-stack">
                <a-collapse ghost>
                  <a-collapse-panel key="1" header="查看堆栈">
                    <pre>{{ log.stack }}</pre>
                  </a-collapse-panel>
                </a-collapse>
              </div>
              <div v-if="log.fallbackAction" class="log-action">
                <BulbOutlined />
                降级操作: {{ log.fallbackAction }}
              </div>
            </div>
          </a-timeline-item>
        </a-timeline>
      </a-card>
    </div>

    <!-- 降级功能列表 -->
    <div class="fallback-features">
      <a-card size="small" title="功能降级状态" :bordered="false">
        <a-list size="small" :data-source="features">
          <template #renderItem="{ item }">
            <a-list-item>
              <template #actions>
                <a-switch
                  v-model:checked="item.enabled"
                  :disabled="item.required"
                  @change="handleFeatureToggle(item)"
                />
              </template>
              <a-list-item-meta>
                <template #title>
                  <div style="display: flex; align-items: center; gap: 8px">
                    <component :is="item.icon" />
                    <span>{{ item.name }}</span>
                    <a-tag v-if="item.required" color="red" size="small">必需</a-tag>
                    <a-tag v-if="item.fallback" color="orange" size="small">已降级</a-tag>
                  </div>
                </template>
                <template #description>
                  {{ item.description }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-card>
    </div>

    <!-- 手动操作 -->
    <div class="manual-actions">
      <a-space style="width: 100%">
        <a-button type="primary" danger block @click="handleManualFallback">
          <FallOutlined />
          手动降级
        </a-button>
        <a-button type="primary" block @click="handleManualRecovery">
          <CheckCircleOutlined />
          手动恢复
        </a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import {
  WarningOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  FallOutlined,
  CheckCircleOutlined,
  BulbOutlined,
  ApiOutlined,
  DatabaseOutlined,
  CloudOutlined,
  FileTextOutlined,
  MessageOutlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close', 'fallback-triggered', 'recovery-triggered']);

// 错误统计
const errorStats = reactive({
  total: 0,
  fallbackCount: 0,
  recoveryCount: 0,
});

// 降级配置
const config = reactive({
  autoFallback: true,
  errorThreshold: 3,
  fallbackLevel: 'basic',
  autoRecovery: true,
  recoveryDelay: 30,
});

// 错误日志
const errorLogs = ref([]);

// 功能列表
const features = ref([
  {
    id: 'api',
    name: 'API 调用',
    description: '与后端服务的通信',
    icon: ApiOutlined,
    enabled: true,
    required: true,
    fallback: false,
  },
  {
    id: 'database',
    name: '数据库操作',
    description: '本地数据存储和查询',
    icon: DatabaseOutlined,
    enabled: true,
    required: true,
    fallback: false,
  },
  {
    id: 'cloud',
    name: '云端同步',
    description: '数据云端备份和同步',
    icon: CloudOutlined,
    enabled: true,
    required: false,
    fallback: false,
  },
  {
    id: 'file',
    name: '文件操作',
    description: '文件读写和管理',
    icon: FileTextOutlined,
    enabled: true,
    required: false,
    fallback: false,
  },
  {
    id: 'realtime',
    name: '实时通信',
    description: 'WebSocket 实时消息',
    icon: MessageOutlined,
    enabled: true,
    required: false,
    fallback: false,
  },
]);

// 错误监听器
let errorHandler = null;

// 初始化
onMounted(() => {
  setupErrorHandler();
  loadConfig();
  loadErrorLogs();
});

// 清理
onUnmounted(() => {
  if (errorHandler) {
    window.removeEventListener('error', errorHandler);
  }
});

// 设置错误处理器
const setupErrorHandler = () => {
  errorHandler = (event) => {
    handleError({
      message: event.message,
      stack: event.error?.stack,
      level: 'error',
    });
  };

  window.addEventListener('error', errorHandler);

  // 监听未捕获的 Promise 错误
  window.addEventListener('unhandledrejection', (event) => {
    handleError({
      message: event.reason?.message || 'Unhandled Promise Rejection',
      stack: event.reason?.stack,
      level: 'error',
    });
  });
};

// 处理错误
const handleError = (error) => {
  errorStats.total++;

  const log = {
    id: Date.now(),
    timestamp: Date.now(),
    level: error.level || 'error',
    message: error.message,
    stack: error.stack,
    fallbackAction: null,
  };

  errorLogs.value.unshift(log);

  // 限制日志数量
  if (errorLogs.value.length > 50) {
    errorLogs.value = errorLogs.value.slice(0, 50);
  }

  // 检查是否需要降级
  if (config.autoFallback && shouldTriggerFallback()) {
    triggerFallback(log);
  }
};

// 判断是否应该触发降级
const shouldTriggerFallback = () => {
  // 检查最近的错误数量
  const recentErrors = errorLogs.value.slice(0, config.errorThreshold);
  const recentTime = Date.now() - 60000; // 最近1分钟

  const recentErrorCount = recentErrors.filter(
    log => log.timestamp > recentTime && log.level === 'error'
  ).length;

  return recentErrorCount >= config.errorThreshold;
};

// 触发降级
const triggerFallback = (log) => {
  errorStats.fallbackCount++;

  // 根据降级级别禁用功能
  const fallbackActions = [];

  switch (config.fallbackLevel) {
    case 'minimal':
      // 只保留必需功能
      features.value.forEach(feature => {
        if (!feature.required) {
          feature.enabled = false;
          feature.fallback = true;
          fallbackActions.push(feature.name);
        }
      });
      break;

    case 'basic':
      // 禁用非核心功能
      const nonCoreFeatures = ['cloud', 'realtime'];
      features.value.forEach(feature => {
        if (nonCoreFeatures.includes(feature.id)) {
          feature.enabled = false;
          feature.fallback = true;
          fallbackActions.push(feature.name);
        }
      });
      break;

    case 'full':
      // 保持所有功能
      break;
  }

  if (fallbackActions.length > 0) {
    log.fallbackAction = `禁用: ${fallbackActions.join(', ')}`;
    message.warning(`系统已降级，禁用了部分功能: ${fallbackActions.join(', ')}`);
    emit('fallback-triggered', { level: config.fallbackLevel, features: fallbackActions });
  }

  // 自动恢复
  if (config.autoRecovery) {
    setTimeout(() => {
      attemptRecovery();
    }, config.recoveryDelay * 1000);
  }
};

// 尝试恢复
const attemptRecovery = () => {
  // 检查最近是否还有错误
  const recentTime = Date.now() - 60000;
  const recentErrors = errorLogs.value.filter(
    log => log.timestamp > recentTime && log.level === 'error'
  );

  if (recentErrors.length === 0) {
    // 恢复所有功能
    features.value.forEach(feature => {
      if (feature.fallback) {
        feature.enabled = true;
        feature.fallback = false;
      }
    });

    errorStats.recoveryCount++;
    message.success('系统已恢复正常');
    emit('recovery-triggered');
  }
};

// 手动降级
const handleManualFallback = () => {
  triggerFallback({
    id: Date.now(),
    timestamp: Date.now(),
    level: 'warning',
    message: '手动触发降级',
  });
};

// 手动恢复
const handleManualRecovery = () => {
  features.value.forEach(feature => {
    if (feature.fallback) {
      feature.enabled = true;
      feature.fallback = false;
    }
  });

  errorStats.recoveryCount++;
  message.success('系统已手动恢复');
  emit('recovery-triggered');
};

// 功能切换
const handleFeatureToggle = (feature) => {
  if (feature.enabled) {
    message.success(`已启用: ${feature.name}`);
  } else {
    message.warning(`已禁用: ${feature.name}`);
  }
};

// 保存配置
const handleSaveConfig = () => {
  // 实际项目中应该保存到本地存储或数据库
  localStorage.setItem('errorFallbackConfig', JSON.stringify(config));
  message.success('配置已保存');
};

// 加载配置
const loadConfig = () => {
  const saved = localStorage.getItem('errorFallbackConfig');
  if (saved) {
    Object.assign(config, JSON.parse(saved));
  }
};

// 加载错误日志
const loadErrorLogs = () => {
  const saved = localStorage.getItem('errorLogs');
  if (saved) {
    errorLogs.value = JSON.parse(saved);
  }
};

// 清空日志
const handleClearLogs = () => {
  errorLogs.value = [];
  errorStats.total = 0;
  localStorage.removeItem('errorLogs');
  message.success('日志已清空');
};

// 获取日志颜色
const getLogColor = (level) => {
  const colorMap = {
    error: 'red',
    warning: 'orange',
    info: 'blue',
  };
  return colorMap[level] || 'default';
};

// 获取日志级别文本
const getLogLevelText = (level) => {
  const textMap = {
    error: '错误',
    warning: '警告',
    info: '信息',
  };
  return textMap[level] || level;
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};
</script>

<style scoped>
.error-fallback-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  overflow-y: auto;
}

.fallback-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e8e8e8;
  position: sticky;
  top: 0;
  background: white;
  z-index: 10;
}

.fallback-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.monitoring-status,
.fallback-config,
.error-logs,
.fallback-features {
  padding: 16px;
}

.monitoring-status :deep(.ant-card),
.fallback-config :deep(.ant-card),
.error-logs :deep(.ant-card),
.fallback-features :deep(.ant-card) {
  margin-bottom: 16px;
}

.config-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #999;
}

.logs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: #999;
}

.log-item {
  padding: 8px 0;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.log-time {
  font-size: 12px;
  color: #999;
}

.log-message {
  font-size: 13px;
  color: #333;
  margin-bottom: 6px;
}

.log-stack {
  margin-top: 8px;
}

.log-stack pre {
  font-size: 11px;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 200px;
}

.log-action {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px;
  background: #fff7e6;
  border-radius: 4px;
  font-size: 12px;
  color: #fa8c16;
}

.manual-actions {
  padding: 16px;
  border-top: 1px solid #e8e8e8;
  position: sticky;
  bottom: 0;
  background: white;
}

.error-fallback-panel::-webkit-scrollbar {
  width: 6px;
}

.error-fallback-panel::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}
</style>
