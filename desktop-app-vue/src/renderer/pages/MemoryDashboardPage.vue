<template>
  <div class="memory-dashboard-page">
    <div class="page-header">
      <h1>
        <DatabaseOutlined />
        Memory Bank
      </h1>
      <p class="page-description">管理学习模式、用户偏好、使用报告和行为洞察</p>
      <div class="header-actions">
        <a-button @click="refreshAll" :loading="loading">
          <ReloadOutlined /> 刷新
        </a-button>
        <a-dropdown>
          <a-button type="primary">
            <ExportOutlined /> 导出
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleExport">
              <a-menu-item key="all">导出全部数据</a-menu-item>
              <a-menu-item key="patterns">导出学习模式</a-menu-item>
              <a-menu-item key="preferences">导出用户偏好</a-menu-item>
              <a-menu-item key="sessions">导出会话摘要</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <!-- Stats Overview -->
    <a-row :gutter="[16, 16]" class="stats-row">
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="学习模式"
            :value="stats.totalPatterns"
            :loading="loading"
          >
            <template #prefix><BulbOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="用户偏好"
            :value="stats.totalPreferences"
            :loading="loading"
          >
            <template #prefix><SettingOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="会话记录"
            :value="stats.totalSessions"
            :loading="loading"
          >
            <template #prefix><MessageOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-card class="stat-card">
          <a-statistic
            title="行为洞察"
            :value="stats.totalInsights"
            :loading="loading"
          >
            <template #prefix><RiseOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Main Content Tabs -->
    <a-card class="main-content">
      <a-tabs v-model:activeKey="activeTab">
        <!-- Learned Patterns Tab -->
        <a-tab-pane key="patterns" tab="学习模式">
          <div class="tab-content">
            <a-row :gutter="[16, 16]">
              <!-- Prompt Patterns -->
              <a-col :xs="24" :lg="12">
                <a-card title="Prompt 模式" size="small" class="pattern-card">
                  <template #extra>
                    <a-tag color="blue">{{ promptPatterns.length }}</a-tag>
                  </template>
                  <a-empty
                    v-if="promptPatterns.length === 0"
                    description="暂无 Prompt 模式"
                  />
                  <a-list
                    v-else
                    :data-source="promptPatterns.slice(0, 5)"
                    size="small"
                  >
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>
                            {{ item.category || "通用" }}
                          </template>
                          <template #description>
                            {{ truncate(item.template, 80) }}
                          </template>
                        </a-list-item-meta>
                        <template #actions>
                          <a-tag>使用 {{ item.use_count }} 次</a-tag>
                        </template>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-card>
              </a-col>

              <!-- Error Fix Patterns -->
              <a-col :xs="24" :lg="12">
                <a-card title="错误修复模式" size="small" class="pattern-card">
                  <template #extra>
                    <a-tag color="orange">{{ errorFixPatterns.length }}</a-tag>
                  </template>
                  <a-empty
                    v-if="errorFixPatterns.length === 0"
                    description="暂无错误修复模式"
                  />
                  <a-list
                    v-else
                    :data-source="errorFixPatterns.slice(0, 5)"
                    size="small"
                  >
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>
                            <a-tag
                              :color="
                                getClassificationColor(
                                  item.error_classification,
                                )
                              "
                            >
                              {{ item.error_classification }}
                            </a-tag>
                          </template>
                          <template #description>
                            {{ truncate(item.fix_strategy, 60) }}
                          </template>
                        </a-list-item-meta>
                        <template #actions>
                          <span class="success-rate">
                            {{ getSuccessRate(item) }}% 成功率
                          </span>
                        </template>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-card>
              </a-col>

              <!-- Code Snippets -->
              <a-col :xs="24" :lg="12">
                <a-card title="代码片段" size="small" class="pattern-card">
                  <template #extra>
                    <a-tag color="green">{{ codeSnippets.length }}</a-tag>
                  </template>
                  <a-empty
                    v-if="codeSnippets.length === 0"
                    description="暂无代码片段"
                  />
                  <a-list
                    v-else
                    :data-source="codeSnippets.slice(0, 5)"
                    size="small"
                  >
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>
                            {{ item.name }}
                            <a-tag size="small">{{ item.language }}</a-tag>
                          </template>
                          <template #description>
                            {{ item.description || "无描述" }}
                          </template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-card>
              </a-col>

              <!-- Workflow Patterns -->
              <a-col :xs="24" :lg="12">
                <a-card title="工作流模式" size="small" class="pattern-card">
                  <template #extra>
                    <a-tag color="purple">{{ workflowPatterns.length }}</a-tag>
                  </template>
                  <a-empty
                    v-if="workflowPatterns.length === 0"
                    description="暂无工作流模式"
                  />
                  <a-list
                    v-else
                    :data-source="workflowPatterns.slice(0, 5)"
                    size="small"
                  >
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>{{ item.name }}</template>
                          <template #description>
                            {{ item.steps?.length || 0 }} 步骤
                          </template>
                        </a-list-item-meta>
                        <template #actions>
                          <a-tag>执行 {{ item.execution_count }} 次</a-tag>
                        </template>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-card>
              </a-col>
            </a-row>
          </div>
        </a-tab-pane>

        <!-- Preferences Tab -->
        <a-tab-pane key="preferences" tab="用户偏好">
          <div class="tab-content">
            <a-table
              :columns="preferenceColumns"
              :data-source="preferences"
              :loading="loading"
              :pagination="{ pageSize: 10 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'value'">
                  <a-typography-text
                    :ellipsis="{ tooltip: record.value }"
                    style="max-width: 300px"
                  >
                    {{ formatValue(record.value) }}
                  </a-typography-text>
                </template>
                <template v-else-if="column.key === 'updated_at'">
                  {{ formatDate(record.updated_at) }}
                </template>
              </template>
            </a-table>
          </div>
        </a-tab-pane>

        <!-- Sessions Tab -->
        <a-tab-pane key="sessions" tab="会话摘要">
          <div class="tab-content">
            <div class="session-actions">
              <a-button
                type="primary"
                @click="generateSessionSummaries"
                :loading="generatingSummaries"
              >
                <FileTextOutlined /> 生成会话摘要文件
              </a-button>
              <a-button @click="openSessionsFolder">
                <FolderOpenOutlined /> 打开摘要目录
              </a-button>
            </div>
            <a-list
              :data-source="recentSessions"
              :loading="loading"
              :pagination="{ pageSize: 10 }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      {{ item.title || "未命名会话" }}
                    </template>
                    <template #description>
                      <a-space>
                        <span>
                          <MessageOutlined /> {{ item.message_count }} 消息
                        </span>
                        <span>
                          <ClockCircleOutlined />
                          {{ formatDate(item.updated_at) }}
                        </span>
                        <a-tag
                          v-for="tag in (item.tags || []).slice(0, 3)"
                          :key="tag"
                          size="small"
                        >
                          {{ tag }}
                        </a-tag>
                      </a-space>
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button
                      size="small"
                      @click="exportSessionSummary(item.id)"
                    >
                      导出摘要
                    </a-button>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </div>
        </a-tab-pane>

        <!-- Behavior Insights Tab -->
        <a-tab-pane key="insights" tab="行为洞察">
          <div class="tab-content">
            <a-row :gutter="[16, 16]">
              <a-col :xs="24" :lg="12">
                <a-card title="使用习惯" size="small">
                  <a-descriptions :column="1" size="small">
                    <a-descriptions-item label="最常用模型">
                      {{ behaviorInsights.mostUsedModel || "-" }}
                    </a-descriptions-item>
                    <a-descriptions-item label="活跃时段">
                      {{ behaviorInsights.activeHours || "-" }}
                    </a-descriptions-item>
                    <a-descriptions-item label="平均会话时长">
                      {{ behaviorInsights.avgSessionDuration || "-" }}
                    </a-descriptions-item>
                    <a-descriptions-item label="常用功能">
                      <a-tag
                        v-for="feature in (
                          behaviorInsights.topFeatures || []
                        ).slice(0, 3)"
                        :key="feature"
                        size="small"
                      >
                        {{ feature }}
                      </a-tag>
                      <span v-if="!behaviorInsights.topFeatures?.length"
                        >-</span
                      >
                    </a-descriptions-item>
                  </a-descriptions>
                </a-card>
              </a-col>
              <a-col :xs="24" :lg="12">
                <a-card title="优化建议" size="small">
                  <a-empty
                    v-if="!recommendations.length"
                    description="暂无优化建议"
                  />
                  <a-list v-else :data-source="recommendations" size="small">
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #avatar>
                            <a-avatar
                              :style="{
                                backgroundColor: getRecommendationColor(
                                  item.type,
                                ),
                              }"
                              size="small"
                            >
                              <template #icon>
                                <BulbOutlined />
                              </template>
                            </a-avatar>
                          </template>
                          <template #title>{{ item.title }}</template>
                          <template #description>{{
                            item.description
                          }}</template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-card>
              </a-col>
            </a-row>
          </div>
        </a-tab-pane>

        <!-- Storage Tab -->
        <a-tab-pane key="storage" tab="存储管理">
          <div class="tab-content">
            <a-descriptions :column="2" bordered>
              <a-descriptions-item label="Memory 目录">
                {{ memoryPath }}
              </a-descriptions-item>
              <a-descriptions-item label="总文件数">
                {{ storageStats.totalFiles }}
              </a-descriptions-item>
              <a-descriptions-item label="占用空间">
                {{ formatSize(storageStats.totalSize) }}
              </a-descriptions-item>
              <a-descriptions-item label="最后备份">
                {{
                  storageStats.lastBackup
                    ? formatDate(storageStats.lastBackup)
                    : "从未"
                }}
              </a-descriptions-item>
            </a-descriptions>

            <a-divider />

            <a-space>
              <a-button @click="openMemoryFolder">
                <FolderOpenOutlined /> 打开 Memory 目录
              </a-button>
              <a-button @click="createBackup" :loading="creatingBackup">
                <SaveOutlined /> 创建备份
              </a-button>
              <a-popconfirm
                title="确定清理过期数据？此操作不可恢复。"
                @confirm="cleanupExpired"
              >
                <a-button danger :loading="cleaningUp">
                  <DeleteOutlined /> 清理过期数据
                </a-button>
              </a-popconfirm>
            </a-space>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from "vue";
import { message } from "ant-design-vue";
import {
  DatabaseOutlined,
  ReloadOutlined,
  ExportOutlined,
  DownOutlined,
  BulbOutlined,
  SettingOutlined,
  MessageOutlined,
  RiseOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ClockCircleOutlined,
  SaveOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";

// State
const loading = ref(false);
const activeTab = ref("patterns");
const generatingSummaries = ref(false);
const creatingBackup = ref(false);
const cleaningUp = ref(false);

// Stats
const stats = ref({
  totalPatterns: 0,
  totalPreferences: 0,
  totalSessions: 0,
  totalInsights: 0,
});

// Patterns
const promptPatterns = ref([]);
const errorFixPatterns = ref([]);
const codeSnippets = ref([]);
const workflowPatterns = ref([]);

// Preferences
const preferences = ref([]);
const preferenceColumns = [
  { title: "分类", dataIndex: "category", key: "category", width: 100 },
  { title: "键", dataIndex: "key", key: "key", width: 150 },
  { title: "值", dataIndex: "value", key: "value" },
  { title: "更新时间", dataIndex: "updated_at", key: "updated_at", width: 150 },
];

// Sessions
const recentSessions = ref([]);

// Behavior
const behaviorInsights = ref({});
const recommendations = ref([]);

// Storage
const memoryPath = ref("");
const storageStats = ref({
  totalFiles: 0,
  totalSize: 0,
  lastBackup: null,
});

// Load all data
const refreshAll = async () => {
  loading.value = true;
  try {
    await Promise.all([
      loadPatterns(),
      loadPreferences(),
      loadSessions(),
      loadBehaviorInsights(),
      loadStorageStats(),
    ]);
    message.success("数据已刷新");
  } catch (error) {
    console.error("刷新数据失败:", error);
    message.error("刷新数据失败");
  } finally {
    loading.value = false;
  }
};

// Load patterns
const loadPatterns = async () => {
  try {
    const result = await window.electronAPI.invoke("memory:get-all-patterns");
    if (result) {
      promptPatterns.value = result.promptPatterns || [];
      errorFixPatterns.value = result.errorFixPatterns || [];
      codeSnippets.value = result.codeSnippets || [];
      workflowPatterns.value = result.workflowPatterns || [];

      stats.value.totalPatterns =
        promptPatterns.value.length +
        errorFixPatterns.value.length +
        codeSnippets.value.length +
        workflowPatterns.value.length;
    }
  } catch (error) {
    console.warn("加载模式失败:", error);
  }
};

// Load preferences
const loadPreferences = async () => {
  try {
    const result = await window.electronAPI.invoke(
      "memory:get-all-preferences",
    );
    preferences.value = result || [];
    stats.value.totalPreferences = preferences.value.length;
  } catch (error) {
    console.warn("加载偏好失败:", error);
  }
};

// Load sessions
const loadSessions = async () => {
  try {
    const result = await window.electronAPI.invoke("session:get-recent", 20);
    recentSessions.value = result || [];
    stats.value.totalSessions = recentSessions.value.length;
  } catch (error) {
    console.warn("加载会话失败:", error);
  }
};

// Load behavior insights
const loadBehaviorInsights = async () => {
  try {
    const result = await window.electronAPI.invoke(
      "memory:get-behavior-insights",
    );
    behaviorInsights.value = result?.insights || {};
    recommendations.value = result?.recommendations || [];
    stats.value.totalInsights = recommendations.value.length;
  } catch (error) {
    console.warn("加载行为洞察失败:", error);
  }
};

// Load storage stats
const loadStorageStats = async () => {
  try {
    const result = await window.electronAPI.invoke("memory:get-storage-stats");
    if (result) {
      memoryPath.value = result.memoryPath || "";
      storageStats.value = {
        totalFiles: result.totalFiles || 0,
        totalSize: result.totalSize || 0,
        lastBackup: result.lastBackup,
      };
    }
  } catch (error) {
    console.warn("加载存储统计失败:", error);
  }
};

// Export data
const handleExport = async ({ key }) => {
  try {
    message.loading("正在导出...");
    const result = await window.electronAPI.invoke("memory:export-data", {
      type: key,
    });
    if (result?.success) {
      message.success(`已导出到 ${result.filePath}`);
    } else {
      message.error(result?.error || "导出失败");
    }
  } catch (error) {
    console.error("导出失败:", error);
    message.error("导出失败: " + error.message);
  }
};

// Generate session summaries
const generateSessionSummaries = async () => {
  generatingSummaries.value = true;
  try {
    const result = await window.electronAPI.invoke(
      "memory:generate-session-summaries",
    );
    if (result?.success) {
      message.success(`已生成 ${result.count} 个会话摘要文件`);
    } else {
      message.error(result?.error || "生成失败");
    }
  } catch (error) {
    console.error("生成会话摘要失败:", error);
    message.error("生成失败: " + error.message);
  } finally {
    generatingSummaries.value = false;
  }
};

// Export single session summary
const exportSessionSummary = async (sessionId) => {
  try {
    const result = await window.electronAPI.invoke(
      "memory:export-session-summary",
      sessionId,
    );
    if (result?.success) {
      message.success(`会话摘要已导出`);
    } else {
      message.error(result?.error || "导出失败");
    }
  } catch (error) {
    console.error("导出会话摘要失败:", error);
    message.error("导出失败: " + error.message);
  }
};

// Open folders
const openMemoryFolder = async () => {
  await window.electronAPI.invoke("shell:open-path", memoryPath.value);
};

const openSessionsFolder = async () => {
  await window.electronAPI.invoke(
    "shell:open-path",
    memoryPath.value + "/sessions",
  );
};

// Backup
const createBackup = async () => {
  creatingBackup.value = true;
  try {
    const result = await window.electronAPI.invoke("memory:create-backup");
    if (result?.success) {
      message.success("备份已创建");
      await loadStorageStats();
    } else {
      message.error(result?.error || "备份失败");
    }
  } catch (error) {
    console.error("创建备份失败:", error);
    message.error("创建备份失败: " + error.message);
  } finally {
    creatingBackup.value = false;
  }
};

// Cleanup
const cleanupExpired = async () => {
  cleaningUp.value = true;
  try {
    const result = await window.electronAPI.invoke("memory:cleanup-expired");
    if (result?.success) {
      message.success(`已清理 ${result.deletedCount} 条过期数据`);
      await refreshAll();
    } else {
      message.error(result?.error || "清理失败");
    }
  } catch (error) {
    console.error("清理失败:", error);
    message.error("清理失败: " + error.message);
  } finally {
    cleaningUp.value = false;
  }
};

// Helpers
const truncate = (text, length) => {
  if (!text) return "";
  return text.length > length ? text.substring(0, length) + "..." : text;
};

const formatValue = (value) => {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

const formatDate = (timestamp) => {
  if (!timestamp) return "-";
  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatSize = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return bytes.toFixed(1) + " " + units[i];
};

const getClassificationColor = (classification) => {
  const colors = {
    DATABASE: "orange",
    NETWORK: "blue",
    FILESYSTEM: "green",
    VALIDATION: "purple",
    AUTHENTICATION: "red",
    UNKNOWN: "default",
  };
  return colors[classification] || "default";
};

const getSuccessRate = (item) => {
  const total = (item.success_count || 0) + (item.failure_count || 0);
  if (total === 0) return 0;
  return Math.round((item.success_count / total) * 100);
};

const getRecommendationColor = (type) => {
  const colors = {
    performance: "#1890ff",
    cost: "#52c41a",
    usage: "#faad14",
    error: "#f5222d",
  };
  return colors[type] || "#8c8c8c";
};

// Lifecycle
onMounted(() => {
  refreshAll();
});
</script>

<style lang="less" scoped>
.memory-dashboard-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f7fa;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;

    h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a202c;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 4px;
    }

    .page-description {
      font-size: 14px;
      color: #718096;
      margin: 0;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }
  }

  .stats-row {
    margin-bottom: 24px;

    .stat-card {
      text-align: center;

      :deep(.ant-statistic-title) {
        font-size: 13px;
      }
    }
  }

  .main-content {
    .tab-content {
      min-height: 400px;
    }

    .pattern-card {
      height: 100%;
      min-height: 280px;
    }

    .session-actions {
      margin-bottom: 16px;
      display: flex;
      gap: 8px;
    }

    .success-rate {
      font-size: 12px;
      color: #52c41a;
    }
  }
}

@media (max-width: 768px) {
  .memory-dashboard-page {
    padding: 12px;

    .page-header {
      flex-direction: column;
      align-items: stretch;

      h1 {
        font-size: 22px;
      }

      .header-actions {
        justify-content: flex-end;
      }
    }
  }
}
</style>
