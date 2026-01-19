<template>
  <div class="sync-status-monitor">
    <!-- 同步状态指示器 -->
    <a-button
      :type="syncButtonType"
      :loading="syncing"
      size="small"
      @click="showSyncDrawer = true"
    >
      <template #icon>
        <SyncOutlined :spin="syncing" />
      </template>
      {{ syncStatusText }}
    </a-button>

    <!-- 同步详情抽屉 -->
    <a-drawer
      v-model:open="showSyncDrawer"
      title="同步状态"
      placement="right"
      width="400"
    >
      <!-- 同步统计 -->
      <div class="sync-stats">
        <a-statistic
          title="总资源数"
          :value="stats.total || 0"
          class="stat-item"
        />
        <a-statistic
          title="已同步"
          :value="stats.synced || 0"
          :value-style="{ color: '#3f8600' }"
          class="stat-item"
        />
        <a-statistic
          title="待同步"
          :value="stats.pending || 0"
          :value-style="{ color: '#faad14' }"
          class="stat-item"
        />
        <a-statistic
          title="冲突"
          :value="stats.conflicts || 0"
          :value-style="{ color: '#ff4d4f' }"
          class="stat-item"
        />
      </div>

      <!-- 最后同步时间 -->
      <a-descriptions
        bordered
        :column="1"
        class="sync-info"
      >
        <a-descriptions-item label="最后同步">
          {{ formatTime(stats.last_sync_time) }}
        </a-descriptions-item>
        <a-descriptions-item label="离线队列">
          {{ stats.queue_size || 0 }} 项
        </a-descriptions-item>
      </a-descriptions>

      <!-- 操作按钮 -->
      <div class="sync-actions">
        <a-button
          type="primary"
          :loading="syncing"
          block
          @click="handleSyncNow"
        >
          <SyncOutlined /> 立即同步
        </a-button>

        <a-button
          v-if="stats.conflicts > 0"
          danger
          block
          style="margin-top: 8px"
          @click="handleShowConflicts"
        >
          <WarningOutlined /> 查看冲突 ({{ stats.conflicts }})
        </a-button>
      </div>
    </a-drawer>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import { SyncOutlined, WarningOutlined } from '@ant-design/icons-vue';
import { useIdentityStore } from '../stores/identity';
import { useRouter } from 'vue-router';

const { ipcRenderer } = window.electron || {};

const router = useRouter();
const identityStore = useIdentityStore();

const showSyncDrawer = ref(false);
const syncing = ref(false);
const stats = ref({
  total: 0,
  synced: 0,
  pending: 0,
  conflicts: 0,
  queue_size: 0,
  last_sync_time: null
});

let statsInterval = null;

// 计算属性
const syncButtonType = computed(() => {
  if (stats.value.conflicts > 0) {return 'danger';}
  if (stats.value.pending > 0) {return 'default';}
  return 'text';
});

const syncStatusText = computed(() => {
  if (stats.value.conflicts > 0) {return `${stats.value.conflicts} 冲突`;}
  if (stats.value.pending > 0) {return `${stats.value.pending} 待同步`;}
  return '已同步';
});

/**
 * 加载同步统计
 */
async function loadStats() {
  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId || !ipcRenderer) {return;}

    const result = await ipcRenderer.invoke('sync:get-stats', orgId);
    stats.value = result || stats.value;
  } catch (error) {
    logger.error('加载同步统计失败:', error);
  }
}

/**
 * 立即同步
 */
async function handleSyncNow() {
  syncing.value = true;

  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId) {
      message.error('未选择组织');
      return;
    }

    const result = await ipcRenderer.invoke('sync:sync-now', orgId);

    if (result.success) {
      message.success(`同步完成: 应用 ${result.applied} 项, 推送 ${result.pushed} 项`);

      if (result.conflicts > 0) {
        message.warn(`发现 ${result.conflicts} 个冲突，请处理`);
      }

      // 刷新统计
      await loadStats();
    }
  } catch (error) {
    logger.error('同步失败:', error);
    message.error(error.message || '同步失败');
  } finally {
    syncing.value = false;
  }
}

/**
 * 查看冲突
 */
function handleShowConflicts() {
  showSyncDrawer.value = false;
  router.push('/organization/sync-conflicts');
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  if (!timestamp) {return '从未同步';}

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {return '刚刚';}
  if (diff < 3600000) {return `${Math.floor(diff / 60000)} 分钟前`;}
  if (diff < 86400000) {return `${Math.floor(diff / 3600000)} 小时前`;}

  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

onMounted(async () => {
  // 初次加载
  await loadStats();

  // 定期刷新统计（每10秒）
  statsInterval = setInterval(loadStats, 10000);

  // 监听身份切换
  identityStore.$subscribe(async () => {
    if (identityStore.isOrganizationContext) {
      await loadStats();
    }
  });
});

onUnmounted(() => {
  if (statsInterval) {
    clearInterval(statsInterval);
  }
});
</script>

<style scoped>
.sync-status-monitor {
  display: inline-block;
}

.sync-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.stat-item {
  text-align: center;
}

.sync-info {
  margin-bottom: 24px;
}

.sync-actions {
  margin-top: 24px;
}
</style>
