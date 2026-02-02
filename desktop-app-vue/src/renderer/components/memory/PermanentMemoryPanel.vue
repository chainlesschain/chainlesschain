<template>
  <div class="permanent-memory-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <div class="header-left">
        <a-typography-title :level="4" class="panel-title">
          <BookOutlined /> 永久记忆
        </a-typography-title>
        <a-tag color="blue">{{ formattedStats.dailyNotes }}</a-tag>
        <a-tag color="green">{{ formattedStats.indexed }}</a-tag>
      </div>
      <div class="header-right">
        <a-button
          type="text"
          :loading="loading.stats"
          @click="refreshStats"
        >
          <template #icon><ReloadOutlined /></template>
        </a-button>
        <a-dropdown>
          <a-button type="text">
            <template #icon><SettingOutlined /></template>
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item key="rebuild" @click="handleRebuildIndex">
                <DatabaseOutlined /> 重建索引
              </a-menu-item>
              <a-menu-item key="clear-cache" @click="handleClearCache">
                <ClearOutlined /> 清空缓存
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <!-- 标签页 -->
    <a-tabs v-model:activeKey="activeTab" class="memory-tabs">
      <!-- Daily Notes 标签页 -->
      <a-tab-pane key="daily" tab="Daily Notes">
        <DailyNotesTimeline />
      </a-tab-pane>

      <!-- MEMORY.md 标签页 -->
      <a-tab-pane key="memory" tab="长期记忆">
        <MemoryEditor />
      </a-tab-pane>

      <!-- 搜索标签页 -->
      <a-tab-pane key="search" tab="智能搜索">
        <MemorySearchPanel />
      </a-tab-pane>

      <!-- 统计标签页 -->
      <a-tab-pane key="stats" tab="统计">
        <MemoryStatsPanel :stats="stats" :indexStats="indexStats" />
      </a-tab-pane>
    </a-tabs>

    <!-- 错误提示 -->
    <a-alert
      v-if="error"
      type="error"
      :message="error"
      closable
      @close="clearError"
      class="error-alert"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { message } from 'ant-design-vue';
import {
  BookOutlined,
  ReloadOutlined,
  SettingOutlined,
  DatabaseOutlined,
  ClearOutlined,
} from '@ant-design/icons-vue';
import { useMemoryStore } from '@/stores/memory';
import DailyNotesTimeline from './DailyNotesTimeline.vue';
import MemoryEditor from './MemoryEditor.vue';
import MemorySearchPanel from './MemorySearchPanel.vue';
import MemoryStatsPanel from './MemoryStatsPanel.vue';

const memoryStore = useMemoryStore();

const {
  stats,
  indexStats,
  loading,
  error,
  activeTab,
  formattedStats,
} = storeToRefs(memoryStore);

const { clearError, loadStats, loadIndexStats, rebuildIndex } = memoryStore;

// 刷新统计
const refreshStats = async () => {
  await Promise.all([
    loadStats(),
    loadIndexStats(),
  ]);
};

// 重建索引
const handleRebuildIndex = async () => {
  const result = await rebuildIndex();
  if (result) {
    message.success(`索引重建完成: ${result.indexed} 个文件已索引`);
  } else {
    message.error('索引重建失败');
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

// 监听标签页切换
watch(activeTab, (newTab) => {
  memoryStore.setActiveTab(newTab);
});

// 初始化
onMounted(async () => {
  await memoryStore.initialize();
});
</script>

<style scoped>
.permanent-memory-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  background: var(--bg-color, #fff);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-title {
  margin: 0 !important;
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-right {
  display: flex;
  gap: 4px;
}

.memory-tabs {
  flex: 1;
  overflow: hidden;
}

:deep(.ant-tabs-content) {
  height: 100%;
}

:deep(.ant-tabs-tabpane) {
  height: 100%;
  overflow: auto;
}

.error-alert {
  margin-top: 16px;
}
</style>
