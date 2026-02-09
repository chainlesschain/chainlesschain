<template>
  <div class="sync-conflicts-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <h2>同步冲突</h2>
      <p class="subtitle">解决数据同步过程中的冲突</p>
    </div>

    <!-- 冲突列表 -->
    <a-spin :spinning="loading">
      <div v-if="conflicts.length === 0" class="empty-state">
        <a-empty description="没有未解决的冲突">
          <a-button type="primary" @click="goBack"> 返回 </a-button>
        </a-empty>
      </div>

      <div v-else class="conflicts-list">
        <a-card
          v-for="conflict in conflicts"
          :key="conflict.id"
          class="conflict-card"
        >
          <template #title>
            <div class="conflict-title">
              <a-tag color="red"> 冲突 </a-tag>
              <span>{{ getResourceTypeName(conflict.resource_type) }}</span>
            </div>
          </template>

          <a-descriptions bordered :column="1">
            <a-descriptions-item label="资源ID">
              {{ conflict.resource_id }}
            </a-descriptions-item>
            <a-descriptions-item label="本地版本">
              v{{ conflict.local_version }}
            </a-descriptions-item>
            <a-descriptions-item label="远程版本">
              v{{ conflict.remote_version }}
            </a-descriptions-item>
            <a-descriptions-item label="发生时间">
              {{ formatTime(conflict.created_at) }}
            </a-descriptions-item>
          </a-descriptions>

          <!-- 数据对比 -->
          <div class="data-comparison">
            <div class="data-column">
              <h4>本地数据</h4>
              <a-textarea
                :value="JSON.stringify(conflict.local_data, null, 2)"
                :rows="10"
                readonly
              />
            </div>

            <div class="data-column">
              <h4>远程数据</h4>
              <a-textarea
                :value="JSON.stringify(conflict.remote_data, null, 2)"
                :rows="10"
                readonly
              />
            </div>
          </div>

          <!-- 解决方案选择 -->
          <div class="resolution-actions">
            <a-space>
              <a-button
                type="primary"
                @click="handleResolve(conflict, 'local_wins')"
              >
                <CheckOutlined /> 使用本地版本
              </a-button>

              <a-button
                type="primary"
                @click="handleResolve(conflict, 'remote_wins')"
              >
                <CloudDownloadOutlined /> 使用远程版本
              </a-button>

              <a-button @click="showManualMerge(conflict)">
                <BranchesOutlined /> 手动合并
              </a-button>
            </a-space>
          </div>
        </a-card>
      </div>
    </a-spin>

    <!-- 手动合并对话框 -->
    <a-modal
      v-model:open="mergeModalVisible"
      title="手动合并数据"
      width="800px"
      @ok="handleManualMergeOk"
    >
      <div v-if="currentConflict">
        <p>请编辑合并后的数据（JSON格式）：</p>
        <a-textarea
          v-model:value="mergedData"
          :rows="15"
          placeholder="输入合并后的JSON数据"
        />

        <a-alert
          v-if="mergeError"
          :message="mergeError"
          type="error"
          show-icon
          closable
          style="margin-top: 12px"
        />
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  CheckOutlined,
  CloudDownloadOutlined,
  BranchesOutlined,
} from "@ant-design/icons-vue";
import { useIdentityStore } from "../stores/identity";
import { useRouter } from "vue-router";

const { ipcRenderer } = window.electron || {};

const router = useRouter();
const identityStore = useIdentityStore();

const loading = ref(false);
const conflicts = ref([]);
const mergeModalVisible = ref(false);
const currentConflict = ref(null);
const mergedData = ref("");
const mergeError = ref("");

/**
 * 加载冲突列表
 */
async function loadConflicts() {
  loading.value = true;

  try {
    const orgId = identityStore.currentOrgId;
    if (!orgId) {
      message.error("未选择组织");
      return;
    }

    const result = await ipcRenderer.invoke("sync:get-conflicts", orgId);
    conflicts.value = result || [];
  } catch (error) {
    logger.error("加载冲突列表失败:", error);
    message.error("加载冲突列表失败");
  } finally {
    loading.value = false;
  }
}

/**
 * 解决冲突
 */
async function handleResolve(conflict, strategy) {
  try {
    await ipcRenderer.invoke("sync:resolve-conflict", conflict.id, {
      strategy,
    });

    message.success("冲突已解决");

    // 移除已解决的冲突
    conflicts.value = conflicts.value.filter((c) => c.id !== conflict.id);
  } catch (error) {
    logger.error("解决冲突失败:", error);
    message.error(error.message || "解决冲突失败");
  }
}

/**
 * 显示手动合并对话框
 */
function showManualMerge(conflict) {
  currentConflict.value = conflict;
  mergedData.value = JSON.stringify(conflict.local_data, null, 2);
  mergeError.value = "";
  mergeModalVisible.value = true;
}

/**
 * 手动合并确认
 */
async function handleManualMergeOk() {
  mergeError.value = "";

  try {
    // 验证JSON格式
    const data = JSON.parse(mergedData.value);

    // 解决冲突
    await ipcRenderer.invoke(
      "sync:resolve-conflict",
      currentConflict.value.id,
      {
        strategy: "manual",
        data,
      },
    );

    message.success("冲突已解决");

    // 移除已解决的冲突
    conflicts.value = conflicts.value.filter(
      (c) => c.id !== currentConflict.value.id,
    );

    mergeModalVisible.value = false;
  } catch (error) {
    if (error instanceof SyntaxError) {
      mergeError.value = "JSON格式错误: " + error.message;
    } else {
      logger.error("解决冲突失败:", error);
      message.error(error.message || "解决冲突失败");
    }
  }
}

/**
 * 获取资源类型显示名称
 */
function getResourceTypeName(type) {
  const names = {
    knowledge: "知识库",
    project: "项目",
    member: "成员",
    role: "角色",
    settings: "设置",
  };
  return names[type] || type;
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

/**
 * 返回
 */
function goBack() {
  router.back();
}

onMounted(() => {
  loadConflicts();
});

// 暴露给测试使用
defineExpose({
  loading,
  conflicts,
  mergeModalVisible,
  currentConflict,
  mergedData,
  mergeError,
  loadConflicts,
  handleResolve,
  showManualMerge,
  handleManualMergeOk,
  getResourceTypeName,
  formatTime,
  goBack,
});
</script>

<style scoped>
.sync-conflicts-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.subtitle {
  margin: 4px 0 0 0;
  color: #8c8c8c;
  font-size: 14px;
}

.empty-state {
  padding: 48px 0;
  text-align: center;
}

.conflicts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.conflict-card {
  border: 2px solid #ff4d4f;
}

.conflict-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.data-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 24px 0;
}

.data-column h4 {
  margin-bottom: 8px;
}

.resolution-actions {
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: flex-end;
}
</style>
