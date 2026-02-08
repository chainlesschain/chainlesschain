<template>
  <div class="knowledge-version-history">
    <!-- 头部 -->
    <div class="history-header">
      <h3>
        <HistoryOutlined />
        版本历史
      </h3>
      <a-space>
        <a-button size="small" @click="emit('close')"> 关闭 </a-button>
        <a-button
          type="primary"
          size="small"
          :loading="loading"
          @click="handleRefresh"
        >
          <ReloadOutlined />
          刷新
        </a-button>
      </a-space>
    </div>

    <!-- 版本列表 -->
    <div class="version-list">
      <a-spin :spinning="loading">
        <a-timeline v-if="versions.length > 0">
          <a-timeline-item
            v-for="(version, index) in versions"
            :key="version.id"
            :color="getVersionColor(version, index)"
          >
            <template #dot>
              <component
                :is="getVersionIcon(version, index)"
                style="font-size: 16px"
              />
            </template>

            <a-card size="small" class="version-card">
              <!-- 版本头部 -->
              <div class="version-header">
                <div class="version-info">
                  <a-tag :color="index === 0 ? 'blue' : 'default'">
                    {{ index === 0 ? "当前版本" : `v${version.version}` }}
                  </a-tag>
                  <span class="version-time">
                    {{ formatDate(version.updated_at) }}
                  </span>
                </div>
                <a-dropdown v-if="index > 0">
                  <a-button size="small">
                    操作
                    <DownOutlined />
                  </a-button>
                  <template #overlay>
                    <a-menu>
                      <a-menu-item
                        key="view"
                        @click="handleViewVersion(version)"
                      >
                        <EyeOutlined />
                        查看此版本
                      </a-menu-item>
                      <a-menu-item
                        key="compare"
                        @click="handleCompareVersion(version)"
                      >
                        <DiffOutlined />
                        与当前版本对比
                      </a-menu-item>
                      <a-menu-divider />
                      <a-menu-item
                        key="restore"
                        style="color: #ff4d4f"
                        @click="handleRestoreVersion(version)"
                      >
                        <RollbackOutlined />
                        恢复到此版本
                      </a-menu-item>
                    </a-menu>
                  </template>
                </a-dropdown>
              </div>

              <!-- 版本详情 -->
              <div class="version-details">
                <div class="detail-item">
                  <UserOutlined />
                  <span>更新者：{{ getUserName(version.updated_by) }}</span>
                </div>
                <div v-if="version.git_commit_hash" class="detail-item">
                  <BranchesOutlined />
                  <span>提交：{{ shortenHash(version.git_commit_hash) }}</span>
                </div>
                <div v-if="version.cid" class="detail-item">
                  <LinkOutlined />
                  <span>CID：{{ shortenCID(version.cid) }}</span>
                  <a-tooltip title="复制CID">
                    <CopyOutlined
                      style="margin-left: 8px; cursor: pointer"
                      @click="copyToClipboard(version.cid)"
                    />
                  </a-tooltip>
                </div>
              </div>

              <!-- 内容预览 -->
              <div
                v-if="expandedVersions.includes(version.id)"
                class="version-content"
              >
                <a-divider style="margin: 12px 0" />
                <div class="content-preview">
                  <h4>内容预览：</h4>
                  <div class="preview-text">
                    {{ getContentPreview(version.content) }}
                  </div>
                </div>
              </div>

              <!-- 展开/收起按钮 -->
              <a-button
                type="link"
                size="small"
                style="margin-top: 8px; padding: 0"
                @click="toggleVersionExpand(version.id)"
              >
                {{
                  expandedVersions.includes(version.id)
                    ? "收起"
                    : "展开内容预览"
                }}
                <component
                  :is="
                    expandedVersions.includes(version.id)
                      ? UpOutlined
                      : DownOutlined
                  "
                />
              </a-button>
            </a-card>
          </a-timeline-item>
        </a-timeline>

        <a-empty v-else description="暂无版本历史" />
      </a-spin>
    </div>

    <!-- 版本对比模态框 -->
    <a-modal
      v-model:open="showCompareModal"
      title="版本对比"
      width="900px"
      :footer="null"
    >
      <version-diff
        v-if="compareVersions.current && compareVersions.target"
        :current-version="compareVersions.current"
        :target-version="compareVersions.target"
      />
    </a-modal>

    <!-- 版本查看模态框 -->
    <a-modal
      v-model:open="showViewModal"
      :title="`查看版本 v${viewVersion?.version}`"
      width="800px"
      :footer="null"
    >
      <div v-if="viewVersion" class="version-view">
        <a-descriptions :column="1" bordered>
          <a-descriptions-item label="版本号">
            v{{ viewVersion.version }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatDate(viewVersion.updated_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="更新者">
            {{ getUserName(viewVersion.updated_by) }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="viewVersion.git_commit_hash"
            label="Git提交"
          >
            {{ viewVersion.git_commit_hash }}
          </a-descriptions-item>
          <a-descriptions-item v-if="viewVersion.cid" label="CID">
            {{ viewVersion.cid }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider>内容</a-divider>

        <div class="version-content-full">
          {{ viewVersion.content }}
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useIdentityStore } from "@/stores/identityStore";
import {
  HistoryOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  UserOutlined,
  BranchesOutlined,
  LinkOutlined,
  CopyOutlined,
  DownOutlined,
  UpOutlined,
  EyeOutlined,
  DiffOutlined,
  RollbackOutlined,
} from "@ant-design/icons-vue";
import VersionDiff from "./VersionDiff.vue";

// ==================== Props & Emits ====================
const props = defineProps({
  knowledgeId: {
    type: String,
    required: true,
  },
  orgId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(["close", "restore"]);

// ==================== State ====================
const loading = ref(false);
const versions = ref([]);
const expandedVersions = ref([]);

const showCompareModal = ref(false);
const compareVersions = ref({
  current: null,
  target: null,
});

const showViewModal = ref(false);
const viewVersion = ref(null);

// ==================== Methods ====================

/**
 * 加载版本历史
 */
async function loadVersionHistory() {
  try {
    loading.value = true;

    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:get-version-history",
      {
        knowledgeId: props.knowledgeId,
        orgId: props.orgId,
      },
    );

    if (result.success) {
      versions.value = result.versions || [];
    } else {
      message.error(result.error || "加载版本历史失败");
    }
  } catch (error) {
    logger.error("加载版本历史失败:", error);
    message.error("加载版本历史失败");
  } finally {
    loading.value = false;
  }
}

/**
 * 刷新
 */
async function handleRefresh() {
  await loadVersionHistory();
}

/**
 * 查看版本
 */
function handleViewVersion(version) {
  viewVersion.value = version;
  showViewModal.value = true;
}

/**
 * 对比版本
 */
function handleCompareVersion(version) {
  compareVersions.value = {
    current: versions.value[0], // 当前版本
    target: version,
  };
  showCompareModal.value = true;
}

/**
 * 恢复版本
 */
async function handleRestoreVersion(version) {
  try {
    // 获取当前用户DID（需要从identityStore获取）
    const identityStore = useIdentityStore ? useIdentityStore() : null;
    const restoredBy = identityStore?.currentUserDID || "system";

    const result = await window.electron.ipcRenderer.invoke(
      "knowledge:restore-version",
      {
        knowledgeId: props.knowledgeId,
        versionId: version.id,
        restoredBy,
      },
    );

    if (result.success) {
      message.success("版本恢复成功");
      emit("restore", version);
      await loadVersionHistory();
    } else {
      message.error(result.error || "版本恢复失败");
    }
  } catch (error) {
    logger.error("版本恢复失败:", error);
    message.error("版本恢复失败");
  }
}

/**
 * 切换版本展开状态
 */
function toggleVersionExpand(versionId) {
  const index = expandedVersions.value.indexOf(versionId);
  if (index > -1) {
    expandedVersions.value.splice(index, 1);
  } else {
    expandedVersions.value.push(versionId);
  }
}

/**
 * 获取版本颜色
 */
function getVersionColor(version, index) {
  if (index === 0) {
    return "blue";
  } // 当前版本
  return "gray";
}

/**
 * 获取版本图标
 */
function getVersionIcon(version, index) {
  if (index === 0) {
    return CheckCircleOutlined;
  } // 当前版本
  return ClockCircleOutlined;
}

/**
 * 获取用户名
 */
function getUserName(did) {
  if (!did) {
    return "未知";
  }
  // 缩短DID显示
  if (did.length > 20) {
    return `${did.slice(0, 10)}...${did.slice(-6)}`;
  }
  return did;
}

/**
 * 缩短哈希值
 */
function shortenHash(hash) {
  if (!hash) {
    return "";
  }
  return hash.length > 12 ? `${hash.slice(0, 12)}...` : hash;
}

/**
 * 缩短CID
 */
function shortenCID(cid) {
  if (!cid) {
    return "";
  }
  return cid.length > 20 ? `${cid.slice(0, 10)}...${cid.slice(-10)}` : cid;
}

/**
 * 获取内容预览
 */
function getContentPreview(content) {
  if (!content) {
    return "暂无内容";
  }
  const text = content.replace(/<[^>]*>/g, "").trim();
  return text.length > 200 ? text.substring(0, 200) + "..." : text;
}

/**
 * 复制到剪贴板
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  message.success("已复制到剪贴板");
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ==================== Lifecycle ====================
onMounted(async () => {
  await loadVersionHistory();
});
</script>

<style scoped lang="less">
.knowledge-version-history {
  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #f0f0f0;

    h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;

      :deep(.anticon) {
        color: #1890ff;
      }
    }
  }

  .version-list {
    max-height: 600px;
    overflow-y: auto;

    .version-card {
      .version-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;

        .version-info {
          display: flex;
          align-items: center;
          gap: 12px;

          .version-time {
            color: #666;
            font-size: 13px;
          }
        }
      }

      .version-details {
        .detail-item {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          color: #666;
          font-size: 13px;

          :deep(.anticon) {
            color: #999;
          }
        }
      }

      .version-content {
        .content-preview {
          h4 {
            margin: 0 0 8px;
            font-size: 14px;
            font-weight: 600;
          }

          .preview-text {
            padding: 12px;
            background-color: #f5f5f5;
            border-radius: 4px;
            font-size: 13px;
            line-height: 1.6;
            color: #333;
            white-space: pre-wrap;
            word-break: break-word;
          }
        }
      }
    }
  }

  .version-view {
    .version-content-full {
      padding: 16px;
      background-color: #f5f5f5;
      border-radius: 4px;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      max-height: 400px;
      overflow-y: auto;
    }
  }
}
</style>
