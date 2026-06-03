<template>
  <a-tooltip :title="syncTooltip">
    <a-button type="text" :loading="isSyncing" @click="handleSyncClick">
      <template v-if="!isSyncing">
        <SyncOutlined
          v-if="syncStatus === 'synced'"
          :style="{ color: '#52c41a' }"
        />
        <ExclamationCircleOutlined
          v-else-if="syncStatus === 'error'"
          :style="{ color: '#ff4d4f' }"
        />
        <CloudSyncOutlined v-else :style="{ color: '#1890ff' }" />
      </template>
    </a-button>
  </a-tooltip>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  SyncOutlined,
  ExclamationCircleOutlined,
  CloudSyncOutlined,
} from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";

const isSyncing = ref(false);
// Start in "pending" so the button doesn't pre-claim "synced ✅" before
// we've actually asked the main process. onMounted resolves the real state.
const syncStatus = ref("pending");
const syncError = ref(null);

const syncTooltip = computed(() => {
  if (isSyncing.value) {
    return "正在同步...";
  }
  if (syncStatus.value === "error") {
    return "同步失败：" + (syncError.value || "未知错误");
  }
  if (syncStatus.value === "synced") {
    return "已同步";
  }
  return "等待同步";
});

async function handleSyncClick() {
  if (isSyncing.value) {
    return;
  }

  try {
    isSyncing.value = true;
    syncStatus.value = "pending";

    await window.electronAPI.sync.incremental();

    syncStatus.value = "synced";
    message.success("同步完成");
  } catch (error) {
    logger.error("[SyncStatusButton] 手动同步失败:", error);
    syncStatus.value = "error";
    syncError.value = error.message;
    message.error("同步失败：" + error.message);
  } finally {
    isSyncing.value = false;
  }
}

async function probeInitialStatus() {
  const api = window.electronAPI?.sync;
  if (!api?.getStatus) {
    return;
  }
  try {
    const result = await api.getStatus();
    if (result?.success) {
      syncStatus.value = "synced";
      syncError.value = null;
    } else {
      syncStatus.value = "error";
      syncError.value = result?.error || "同步管理器未初始化";
    }
  } catch (error) {
    syncStatus.value = "error";
    syncError.value = error?.message || "同步状态检查失败";
  }
}

onMounted(() => {
  if (window.electronAPI && window.electronAPI.sync) {
    window.electronAPI.sync.onSyncStarted(() => {
      isSyncing.value = true;
      syncStatus.value = "pending";
      syncError.value = null;
    });

    window.electronAPI.sync.onSyncCompleted(() => {
      isSyncing.value = false;
      syncStatus.value = "synced";
      syncError.value = null;
    });

    window.electronAPI.sync.onSyncError((data) => {
      isSyncing.value = false;
      syncStatus.value = "error";
      syncError.value = data.error || "同步失败";
    });

    // Resolve real initial state instead of trusting the default "synced"
    // — otherwise the button shows a green ✅ before any check happened.
    probeInitialStatus();
  }
});
</script>
