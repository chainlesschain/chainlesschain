<template>
  <div class="rag-status-indicator">
    <a-space>
      <!-- 索引状态显示 -->
      <a-tooltip title="点击查看索引详情">
        <a-badge
          :count="indexedFiles"
          :total="totalFiles"
          show-zero
        >
          <a-button
            size="small"
            :loading="indexing"
            @click="showDetails = !showDetails"
          >
            <template #icon>
              <CloudSyncOutlined v-if="!indexing" />
              <LoadingOutlined v-else />
            </template>
            RAG索引
          </a-button>
        </a-badge>
      </a-tooltip>

      <!-- 重新索引按钮 -->
      <a-tooltip title="重新索引项目文件">
        <a-button
          size="small"
          :loading="indexing"
          :disabled="!projectId"
          @click="reindex"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
        </a-button>
      </a-tooltip>
    </a-space>

    <!-- 详情面板 -->
    <a-card
      v-if="showDetails"
      size="small"
      class="details-card"
      title="RAG索引状态"
    >
      <template #extra>
        <a-button
          type="text"
          size="small"
          @click="showDetails = false"
        >
          <CloseOutlined />
        </a-button>
      </template>

      <!-- 统计信息 -->
      <a-descriptions
        size="small"
        :column="1"
      >
        <a-descriptions-item label="总文件数">
          {{ totalFiles }}
        </a-descriptions-item>
        <a-descriptions-item label="已索引">
          <a-tag :color="indexedPercentage >= 100 ? 'success' : 'processing'">
            {{ indexedFiles }} / {{ totalFiles }} ({{ indexedPercentage }}%)
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="上次索引">
          {{ lastIndexTime ? formatTime(lastIndexTime) : '从未索引' }}
        </a-descriptions-item>
        <a-descriptions-item label="索引状态">
          <a-tag
            v-if="indexing"
            color="processing"
          >
            <LoadingOutlined /> 索引中...
          </a-tag>
          <a-tag
            v-else-if="indexedPercentage >= 100"
            color="success"
          >
            <CheckCircleOutlined /> 已完成
          </a-tag>
          <a-tag
            v-else
            color="warning"
          >
            <ExclamationCircleOutlined /> 未完成
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 索引进度 -->
      <a-progress
        v-if="indexing"
        :percent="indexProgress"
        :status="indexProgress >= 100 ? 'success' : 'active'"
        :show-info="true"
      />

      <!-- 索引日志 -->
      <div
        v-if="indexing && currentFile"
        class="indexing-info"
      >
        <a-typography-text
          type="secondary"
          style="font-size: 12px;"
        >
          正在索引: {{ currentFile }}
        </a-typography-text>
      </div>

      <!-- 操作按钮 -->
      <a-space style="margin-top: 12px;">
        <a-button
          type="primary"
          size="small"
          :loading="indexing"
          @click="reindex"
        >
          <ReloadOutlined /> 重新索引
        </a-button>
        <a-button
          size="small"
          :loading="indexingConversations"
          @click="indexConversations"
        >
          <MessageOutlined /> 索引对话历史
        </a-button>
      </a-space>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, watch } from 'vue';
import {
  CloudSyncOutlined,
  LoadingOutlined,
  ReloadOutlined,
  CloseOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  MessageOutlined
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true
  }
});

// 状态
const showDetails = ref(false);
const indexing = ref(false);
const indexingConversations = ref(false);
const totalFiles = ref(0);
const indexedFiles = ref(0);
const lastIndexTime = ref(null);
const indexProgress = ref(0);
const currentFile = ref('');

// 计算属性
const indexedPercentage = computed(() => {
  if (totalFiles.value === 0) {return 0;}
  return Math.round((indexedFiles.value / totalFiles.value) * 100);
});

// 加载索引统计
const loadStats = async () => {
  if (!props.projectId) {return;}

  try {
    const stats = await window.electronAPI.project.getIndexStats(props.projectId);

    totalFiles.value = stats.totalFiles;
    indexedFiles.value = stats.indexedFiles;

    logger.info('[RAGStatusIndicator] 索引统计加载完成:', stats);
  } catch (error) {
    logger.error('[RAGStatusIndicator] 加载索引统计失败:', error);
  }
};

// 重新索引
const reindex = async () => {
  if (!props.projectId) {
    message.warning('未选择项目');
    return;
  }

  indexing.value = true;
  indexProgress.value = 0;
  currentFile.value = '';

  try {
    message.loading({ content: '开始索引项目文件...', key: 'indexing' });

    const result = await window.electronAPI.project.indexFiles(
      props.projectId,
      {
        forceReindex: true,
        enableWatcher: true
      }
    );

    indexProgress.value = 100;

    message.success({
      content: `索引完成! 已索引 ${result.indexedCount} 个文件`,
      key: 'indexing',
      duration: 3
    });

    // 更新统计
    await loadStats();

    lastIndexTime.value = Date.now();
  } catch (error) {
    logger.error('[RAGStatusIndicator] 索引失败:', error);
    message.error({
      content: `索引失败: ${error.message}`,
      key: 'indexing',
      duration: 5
    });
  } finally {
    indexing.value = false;
    currentFile.value = '';
  }
};

// 索引对话历史
const indexConversations = async () => {
  if (!props.projectId) {
    message.warning('未选择项目');
    return;
  }

  indexingConversations.value = true;

  try {
    message.loading({ content: '开始索引对话历史...', key: 'conv-indexing' });

    const result = await window.electronAPI.project.indexConversations(
      props.projectId,
      { limit: 100 }
    );

    message.success({
      content: `对话历史索引完成! 已索引 ${result.indexedCount} 条对话`,
      key: 'conv-indexing',
      duration: 3
    });
  } catch (error) {
    logger.error('[RAGStatusIndicator] 索引对话历史失败:', error);
    message.error({
      content: `索引失败: ${error.message}`,
      key: 'conv-indexing',
      duration: 5
    });
  } finally {
    indexingConversations.value = false;
  }
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '';}

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60 * 1000) {
    return '刚刚';
  }

  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  }

  // 小于24小时
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  }

  // 显示日期
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// 监听项目变化
watch(
  () => props.projectId,
  (newProjectId) => {
    if (newProjectId) {
      loadStats();
    }
  },
  { immediate: true }
);

// 组件挂载时加载统计
onMounted(() => {
  loadStats();
});
</script>

<style scoped>
.rag-status-indicator {
  position: relative;
}

.details-card {
  position: absolute;
  top: 40px;
  right: 0;
  width: 320px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.indexing-info {
  margin-top: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

:deep(.ant-badge-count) {
  background-color: #52c41a;
}

:deep(.ant-badge) {
  display: inline-flex;
  align-items: center;
}
</style>
