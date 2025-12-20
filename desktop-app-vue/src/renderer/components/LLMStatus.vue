<template>
  <div class="llm-status">
    <a-card title="LLM 服务状态" size="small">
      <!-- 状态概览 -->
      <div class="status-overview">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="服务状态">
            <a-space>
              <a-badge :status="status.available ? 'success' : 'error'" />
              <span>{{ status.available ? '运行中' : '不可用' }}</span>
            </a-space>
          </a-descriptions-item>

          <a-descriptions-item label="当前提供商">
            <a-tag :color="getProviderColor(status.provider)">
              {{ getProviderName(status.provider) }}
            </a-tag>
          </a-descriptions-item>

          <a-descriptions-item
            label="当前模型"
            v-if="showCurrentModel"
            :span="modelStatSpan"
          >
            {{ currentModel }}
          </a-descriptions-item>

          <a-descriptions-item
            label="可用模型"
            v-if="showModelCount"
            :span="modelStatSpan"
          >
            {{ status.models.length }} 个
          </a-descriptions-item>

          <a-descriptions-item label="最后检查时间" :span="2">
            {{ formatDate(lastCheckTime) }}
          </a-descriptions-item>

          <a-descriptions-item label="错误信息" :span="2" v-if="status.error">
            <a-typography-text type="danger">
              {{ status.error }}
            </a-typography-text>
          </a-descriptions-item>
        </a-descriptions>
      </div>

      <!-- 可用模型列表 -->
      <div v-if="showModelCount" class="models-section">
        <a-divider>可用模型</a-divider>
        <a-list
          :data-source="status.models.slice(0, showAllModels ? status.models.length : 5)"
          size="small"
          :bordered="false"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <a-space>
                    <api-outlined />
                    <span>{{ item.name || item }}</span>
                    <a-tag v-if="item.name === currentModel" color="blue" size="small">
                      当前使用
                    </a-tag>
                  </a-space>
                </template>
                <template #description v-if="item.size">
                  大小: {{ formatSize(item.size) }}
                  <span v-if="item.modified_at" style="margin-left: 16px">
                    修改时间: {{ formatModelDate(item.modified_at) }}
                  </span>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <div
          v-if="status.models.length > 5 && !showAllModels"
          class="show-more"
        >
          <a-button type="link" size="small" @click="showAllModels = true">
            显示全部 {{ status.models.length }} 个模型
          </a-button>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="actions">
        <a-space>
          <a-button
            type="primary"
            size="small"
            @click="handleRefresh"
            :loading="refreshing"
          >
            <template #icon><reload-outlined /></template>
            刷新状态
          </a-button>

          <a-button
            size="small"
            @click="$emit('open-settings')"
          >
            <template #icon><setting-outlined /></template>
            服务设置
          </a-button>

          <a-button
            v-if="status.available"
            size="small"
            @click="handleTest"
            :loading="testing"
          >
            <template #icon><experiment-outlined /></template>
            测试服务
          </a-button>
        </a-space>
      </div>

      <!-- 测试结果 -->
      <div v-if="testResult" class="test-result">
        <a-divider>测试结果</a-divider>
        <a-alert
          :type="testResult.success ? 'success' : 'error'"
          :message="testResult.message"
          show-icon
          closable
          @close="testResult = null"
        >
          <template #description v-if="testResult.response">
            <div class="test-response">
              {{ testResult.response }}
            </div>
            <div class="test-meta" v-if="testResult.tokens">
              Token数: {{ testResult.tokens }} | 耗时: {{ testResult.duration }}ms
            </div>
          </template>
        </a-alert>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  ApiOutlined,
  ReloadOutlined,
  SettingOutlined,
  ExperimentOutlined,
} from '@ant-design/icons-vue';

// 事件
const emit = defineEmits(['open-settings']);

// 状态
const status = ref({
  available: false,
  provider: '',
  models: [],
  error: null,
});

const currentModel = ref('');
const lastCheckTime = ref(null);
const refreshing = ref(false);
const testing = ref(false);
const showAllModels = ref(false);
const testResult = ref(null);

const showCurrentModel = computed(() => Boolean(currentModel.value));
const showModelCount = computed(
  () => Array.isArray(status.value.models) && status.value.models.length > 0
);
const modelStatSpan = computed(() =>
  showCurrentModel.value && showModelCount.value ? 1 : 2
);

// 定时器
let statusCheckInterval = null;

// 检查服务状态
const checkStatus = async () => {
  try {
    const result = await window.electronAPI.llm.checkStatus();
    status.value = result;
    lastCheckTime.value = Date.now();

    // 获取当前配置的模型
    const config = await window.electronAPI.llm.getConfig();
    if (config) {
      switch (config.provider) {
        case 'ollama':
          currentModel.value = config.ollama?.model || '';
          break;
        case 'openai':
          currentModel.value = config.openai?.model || '';
          break;
        case 'deepseek':
          currentModel.value = config.deepseek?.model || '';
          break;
        case 'custom':
          currentModel.value = config.custom?.model || '';
          break;
      }
    }
  } catch (error) {
    console.error('检查状态失败:', error);
  }
};

// 刷新状态
const handleRefresh = async () => {
  refreshing.value = true;
  try {
    await checkStatus();
    message.success('状态已刷新');
  } catch (error) {
    message.error('刷新失败: ' + error.message);
  } finally {
    refreshing.value = false;
  }
};

// 测试服务
const handleTest = async () => {
  testing.value = true;
  testResult.value = null;

  const startTime = Date.now();

  try {
    const response = await window.electronAPI.llm.query(
      'Hello! Please respond with a brief greeting.',
      { max_tokens: 50 }
    );

    const duration = Date.now() - startTime;

    testResult.value = {
      success: true,
      message: '服务测试成功',
      response: response.text,
      tokens: response.tokens,
      duration: duration,
    };

    message.success('服务测试成功');
  } catch (error) {
    testResult.value = {
      success: false,
      message: '服务测试失败: ' + error.message,
    };
    message.error('测试失败: ' + error.message);
  } finally {
    testing.value = false;
  }
};

// 获取提供商名称
const getProviderName = (provider) => {
  const names = {
    ollama: 'Ollama',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    custom: '自定义',
  };
  return names[provider] || provider || '未知';
};

// 获取提供商颜色
const getProviderColor = (provider) => {
  const colors = {
    ollama: 'blue',
    openai: 'green',
    deepseek: 'purple',
    custom: 'orange',
  };
  return colors[provider] || 'default';
};

// 格式化日期
const formatDate = (timestamp) => {
  if (!timestamp) return '从未';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚';
  }

  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}分钟前`;
  }

  // 小于1天
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}小时前`;
  }

  // 超过1天
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// 格式化模型日期
const formatModelDate = (dateStr) => {
  if (!dateStr) return '';

  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (error) {
    return dateStr;
  }
};

// 格式化大小
const formatSize = (bytes) => {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
};

// 组件挂载时
onMounted(() => {
  checkStatus();

  // 定时检查状态（每30秒）
  statusCheckInterval = setInterval(() => {
    checkStatus();
  }, 30000);
});

// 组件卸载时
onUnmounted(() => {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }
});
</script>

<style scoped>
.llm-status {
  height: 100%;
}

.status-overview {
  margin-bottom: 16px;
}

.models-section {
  margin-top: 16px;
}

.models-section :deep(.ant-list-item) {
  padding: 8px 0;
}

.show-more {
  text-align: center;
  margin-top: 8px;
}

.actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.test-result {
  margin-top: 16px;
}

.test-response {
  padding: 8px;
  background-color: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 8px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.test-meta {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

:deep(.ant-descriptions-item-label) {
  font-weight: 500;
}
</style>
