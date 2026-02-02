<template>
  <div class="memory-stats-panel">
    <!-- 概览卡片 -->
    <a-row :gutter="16" class="stats-cards">
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="Daily Notes"
            :value="stats.dailyNotesCount"
            :prefix="h(FileTextOutlined)"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="记忆章节"
            :value="stats.memorySectionsCount"
            :prefix="h(BookOutlined)"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="Embedding 缓存"
            :value="stats.cachedEmbeddingsCount"
            :prefix="h(DatabaseOutlined)"
          />
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic
            title="已索引文件"
            :value="stats.indexedFilesCount"
            :prefix="h(FolderOpenOutlined)"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- Embedding 缓存统计 -->
    <a-card title="Embedding 缓存" class="section-card" v-if="indexStats.embeddingCache">
      <a-descriptions :column="3" size="small" bordered>
        <a-descriptions-item label="缓存条目">
          {{ indexStats.embeddingCache.count }} / {{ indexStats.embeddingCache.maxSize }}
        </a-descriptions-item>
        <a-descriptions-item label="缓存大小">
          {{ indexStats.embeddingCache.totalSizeMB }} MB
        </a-descriptions-item>
        <a-descriptions-item label="命中率">
          <a-tag :color="getHitRateColor(indexStats.embeddingCache.hitRateNumeric)">
            {{ indexStats.embeddingCache.hitRate }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="命中次数">
          {{ indexStats.embeddingCache.hits }}
        </a-descriptions-item>
        <a-descriptions-item label="未命中次数">
          {{ indexStats.embeddingCache.misses }}
        </a-descriptions-item>
        <a-descriptions-item label="写入次数">
          {{ indexStats.embeddingCache.inserts }}
        </a-descriptions-item>
        <a-descriptions-item label="驱逐次数">
          {{ indexStats.embeddingCache.evictions }}
        </a-descriptions-item>
        <a-descriptions-item label="过期时间">
          {{ indexStats.embeddingCache.cacheExpiration }}
        </a-descriptions-item>
        <a-descriptions-item label="自动清理">
          <a-tag :color="indexStats.embeddingCache.autoCleanupRunning ? 'green' : 'gray'">
            {{ indexStats.embeddingCache.autoCleanupRunning ? '运行中' : '未运行' }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>

      <!-- 按模型统计 -->
      <template v-if="indexStats.embeddingCache.byModel?.length > 0">
        <a-divider>按模型统计</a-divider>
        <a-table
          :data-source="indexStats.embeddingCache.byModel"
          :columns="modelColumns"
          :pagination="false"
          size="small"
        />
      </template>
    </a-card>

    <!-- 文件监听统计 -->
    <a-card title="文件监听器" class="section-card" v-if="indexStats.fileWatcher">
      <a-descriptions :column="3" size="small" bordered>
        <a-descriptions-item label="状态">
          <a-tag :color="indexStats.fileWatcher.isWatching ? 'green' : 'gray'">
            {{ indexStats.fileWatcher.isWatching ? '监听中' : '已停止' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="监听目录">
          {{ indexStats.fileWatcher.memoryDir }}
        </a-descriptions-item>
        <a-descriptions-item label="防抖延迟">
          {{ indexStats.fileWatcher.debounceMs }}ms
        </a-descriptions-item>
        <a-descriptions-item label="监听文件数">
          {{ indexStats.fileWatcher.filesWatched }}
        </a-descriptions-item>
        <a-descriptions-item label="检测变化数">
          {{ indexStats.fileWatcher.changesDetected }}
        </a-descriptions-item>
        <a-descriptions-item label="索引更新数">
          {{ indexStats.fileWatcher.indexesUpdated }}
        </a-descriptions-item>
        <a-descriptions-item label="错误数">
          <a-tag :color="indexStats.fileWatcher.errors > 0 ? 'red' : 'green'">
            {{ indexStats.fileWatcher.errors }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="待处理变更">
          {{ indexStats.fileWatcher.pendingChanges }}
        </a-descriptions-item>
        <a-descriptions-item label="运行时间">
          {{ indexStats.fileWatcher.runningTime || '-' }}
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- 操作按钮 -->
    <div class="actions">
      <a-space>
        <a-button @click="refreshStats" :loading="loading">
          <template #icon><ReloadOutlined /></template>
          刷新统计
        </a-button>
        <a-button @click="handleRebuildIndex" :loading="rebuildLoading">
          <template #icon><DatabaseOutlined /></template>
          重建索引
        </a-button>
        <a-popconfirm
          title="确定要清空所有 Embedding 缓存吗？"
          @confirm="handleClearCache"
        >
          <a-button danger>
            <template #icon><DeleteOutlined /></template>
            清空缓存
          </a-button>
        </a-popconfirm>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, h } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
  BookOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { useMemoryStore } from '@/stores/memory';

const props = defineProps({
  stats: {
    type: Object,
    default: () => ({
      dailyNotesCount: 0,
      memorySectionsCount: 0,
      cachedEmbeddingsCount: 0,
      indexedFilesCount: 0,
    }),
  },
  indexStats: {
    type: Object,
    default: () => ({
      embeddingCache: null,
      fileWatcher: null,
      indexedFiles: 0,
    }),
  },
});

const memoryStore = useMemoryStore();

const loading = ref(false);
const rebuildLoading = ref(false);

// 模型统计表格列
const modelColumns = [
  { title: '模型', dataIndex: 'model', key: 'model' },
  { title: '条目数', dataIndex: 'count', key: 'count' },
  { title: '大小 (MB)', dataIndex: 'sizeMB', key: 'sizeMB' },
];

// 获取命中率颜色
const getHitRateColor = (rate) => {
  if (rate >= 0.8) return 'green';
  if (rate >= 0.5) return 'orange';
  return 'red';
};

// 刷新统计
const refreshStats = async () => {
  loading.value = true;
  try {
    await Promise.all([
      memoryStore.loadStats(),
      memoryStore.loadIndexStats(),
    ]);
    message.success('统计已刷新');
  } catch (err) {
    message.error('刷新失败');
  } finally {
    loading.value = false;
  }
};

// 重建索引
const handleRebuildIndex = async () => {
  rebuildLoading.value = true;
  try {
    const result = await memoryStore.rebuildIndex();
    if (result) {
      message.success(`索引重建完成: ${result.indexed}/${result.total} 个文件已索引`);
    } else {
      message.error('索引重建失败');
    }
  } catch (err) {
    message.error(err.message);
  } finally {
    rebuildLoading.value = false;
  }
};

// 清空缓存
const handleClearCache = async () => {
  try {
    const result = await window.electronAPI.invoke('memory:clear-embedding-cache');
    if (result?.success) {
      message.success(`已清空 ${result.deleted} 条缓存`);
      await refreshStats();
    } else {
      message.error(result?.error || '清空缓存失败');
    }
  } catch (err) {
    message.error(err.message);
  }
};
</script>

<style scoped>
.memory-stats-panel {
  padding: 16px 0;
}

.stats-cards {
  margin-bottom: 24px;
}

.section-card {
  margin-bottom: 16px;
}

.actions {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, #f0f0f0);
}
</style>
