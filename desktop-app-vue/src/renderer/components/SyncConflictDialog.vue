<template>
  <a-modal
    v-model:open="visible"
    title="数据同步冲突"
    width="900px"
    :footer="null"
    :mask-closable="false"
  >
    <div class="conflict-container">
      <a-alert
        message="检测到数据冲突"
        description="本地数据和云端数据都已修改，请选择保留哪个版本"
        type="warning"
        show-icon
        style="margin-bottom: 20px"
      />

      <div
        v-for="(conflict, index) in conflicts"
        :key="conflict.id"
        class="conflict-item"
      >
        <div class="conflict-header">
          <h4>冲突 {{ index + 1 }} / {{ conflicts.length }}</h4>
          <a-tag color="blue">
            {{ conflict.table }}
          </a-tag>
          <a-tag color="geekblue">
            ID: {{ conflict.id }}
          </a-tag>
        </div>

        <a-row :gutter="16">
          <a-col :span="12">
            <div class="version-card local">
              <div class="version-header">
                <h5>📱 本地版本</h5>
                <div class="version-time">
                  <ClockCircleOutlined style="margin-right: 4px" />
                  {{ formatTime(conflict.localUpdatedAt) }}
                </div>
              </div>

              <div class="version-content">
                <pre>{{ formatRecord(conflict.localRecord) }}</pre>
              </div>

              <a-button
                type="primary"
                block
                :loading="resolving === conflict.id"
                @click="resolveConflict(conflict.id, 'local')"
              >
                使用本地版本
              </a-button>
            </div>
          </a-col>

          <a-col :span="12">
            <div class="version-card remote">
              <div class="version-header">
                <h5>☁️ 云端版本</h5>
                <div class="version-time">
                  <ClockCircleOutlined style="margin-right: 4px" />
                  {{ formatTime(conflict.remoteUpdatedAt) }}
                </div>
              </div>

              <div class="version-content">
                <pre>{{ formatRecord(conflict.remoteRecord) }}</pre>
              </div>

              <a-button
                type="primary"
                block
                :loading="resolving === conflict.id"
                @click="resolveConflict(conflict.id, 'remote')"
              >
                使用云端版本
              </a-button>
            </div>
          </a-col>
        </a-row>

        <a-divider v-if="index < conflicts.length - 1" />
      </div>

      <div
        v-if="conflicts.length === 0"
        class="empty-state"
      >
        <a-empty description="所有冲突已解决" />
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import { ClockCircleOutlined } from "@ant-design/icons-vue";

const visible = ref(false);
const conflicts = ref([]);
const resolving = ref(null);

// 监听同步冲突事件
const removeListener = null;

onMounted(() => {
  if (window.electronAPI && window.electronAPI.sync) {
    window.electronAPI.sync.onShowConflicts((data) => {
      logger.info("[SyncConflictDialog] 收到冲突数据:", data);
      conflicts.value = data;
      visible.value = true;
    });
  }
});

onUnmounted(() => {
  if (removeListener) {
    removeListener();
  }
});

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {
    return "未知时间";
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// 格式化记录（美化显示）
const formatRecord = (record) => {
  if (!record) {
    return "无数据";
  }

  // 过滤掉不需要显示的字段
  const filtered = {};
  const excludeKeys = [
    "id",
    "created_at",
    "updated_at",
    "synced_at",
    "sync_status",
    "deleted",
  ];

  for (const key in record) {
    if (
      !excludeKeys.includes(key) &&
      record[key] !== null &&
      record[key] !== undefined
    ) {
      filtered[key] = record[key];
    }
  }

  return JSON.stringify(filtered, null, 2);
};

// 解决冲突
const resolveConflict = async (conflictId, resolution) => {
  try {
    resolving.value = conflictId;

    logger.info("[SyncConflictDialog] 解决冲突:", conflictId, resolution);

    const result = await window.electronAPI.sync.resolveConflict(
      conflictId,
      resolution,
    );

    if (result.success) {
      message.success("冲突已解决");

      // 从列表中移除已解决的冲突
      conflicts.value = conflicts.value.filter((c) => c.id !== conflictId);

      // 如果所有冲突都已解决，关闭对话框
      if (conflicts.value.length === 0) {
        visible.value = false;
        message.success("所有冲突已解决，数据同步完成");
      }
    } else {
      message.error("解决冲突失败: " + result.error);
    }
  } catch (error) {
    logger.error("[SyncConflictDialog] 解决冲突失败:", error);
    message.error("解决冲突失败: " + error.message);
  } finally {
    resolving.value = null;
  }
};
</script>

<style scoped>
.conflict-container {
  max-height: 70vh;
  overflow-y: auto;
}

.conflict-item {
  margin-bottom: 24px;
}

.conflict-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.conflict-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.version-card {
  padding: 16px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fafafa;
}

.version-card.local {
  background: linear-gradient(135deg, #e6f7ff 0%, #f0f9ff 100%);
  border-color: #91d5ff;
}

.version-card.remote {
  background: linear-gradient(135deg, #fff7e6 0%, #fffbf0 100%);
  border-color: #ffc069;
}

.version-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.version-header h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #262626;
}

.version-time {
  font-size: 12px;
  color: #8c8c8c;
  display: flex;
  align-items: center;
}

.version-content {
  margin-bottom: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.version-content pre {
  background: #fff;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  border: 1px solid #e8e8e8;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.empty-state {
  padding: 40px;
  text-align: center;
}

/* 滚动条样式 */
.conflict-container::-webkit-scrollbar,
.version-content::-webkit-scrollbar {
  width: 6px;
}

.conflict-container::-webkit-scrollbar-thumb,
.version-content::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}

.conflict-container::-webkit-scrollbar-thumb:hover,
.version-content::-webkit-scrollbar-thumb:hover {
  background: #bfbfbf;
}
</style>
