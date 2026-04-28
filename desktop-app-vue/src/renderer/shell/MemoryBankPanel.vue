<template>
  <a-modal
    :open="open"
    :width="860"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="记忆库"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <DatabaseOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      AI 学习记忆系统：Prompt
      模式、错误修复经验、代码片段、工作流模式以及用户偏好的本地存储与回顾。
      Phase 3-4 将接入会话/行为洞察 tab 与存储管理 / 自动摘要操作。
    </p>

    <a-row :gutter="[12, 12]" class="stats-row">
      <a-col :span="6">
        <a-statistic
          title="学习模式"
          :value="store.totalPatterns"
          :loading="store.loading && !store.hasLoaded"
        >
          <template #prefix>
            <BulbOutlined />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="用户偏好"
          :value="store.totalPreferences"
          :loading="store.loading && !store.hasLoaded"
        >
          <template #prefix>
            <SettingOutlined />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="会话记录"
          :value="store.totalSessions"
          :loading="store.loading && !store.hasLoaded"
        >
          <template #prefix>
            <MessageOutlined />
          </template>
        </a-statistic>
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="行为洞察"
          :value="store.totalInsights"
          :loading="store.loading && !store.hasLoaded"
        >
          <template #prefix>
            <RiseOutlined />
          </template>
        </a-statistic>
      </a-col>
    </a-row>

    <div class="toolbar">
      <a-button size="small" :loading="store.loading" @click="refresh">
        <ReloadOutlined />
        刷新
      </a-button>
      <span
        v-if="store.memoryPath"
        class="memory-path-hint"
        :title="store.memoryPath"
      >
        路径：{{ truncate(store.memoryPath, 56) }}
      </span>
    </div>

    <a-tabs v-model:active-key="activeTab" class="memory-tabs" size="small">
      <a-tab-pane key="patterns" tab="学习模式">
        <a-row :gutter="[12, 12]">
          <a-col :xs="24" :lg="12">
            <a-card size="small" class="pattern-card">
              <template #title>
                Prompt 模式
                <a-tag color="blue">
                  {{ store.promptPatterns.length }}
                </a-tag>
              </template>
              <a-empty
                v-if="store.promptPatterns.length === 0"
                description="暂无 Prompt 模式"
                :image-style="{ height: '40px' }"
              />
              <ul v-else class="pattern-list">
                <li
                  v-for="(item, i) in store.promptPatterns.slice(0, 5)"
                  :key="(item.id as string) ?? i"
                  class="pattern-row"
                >
                  <div class="pattern-meta">
                    <div class="pattern-line-1">
                      <span class="pattern-title">
                        {{ item.category || "通用" }}
                      </span>
                      <a-tag size="small">
                        使用 {{ item.use_count ?? 0 }} 次
                      </a-tag>
                    </div>
                    <div class="pattern-desc">
                      {{ truncate(item.template ?? "", 80) }}
                    </div>
                  </div>
                </li>
              </ul>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card size="small" class="pattern-card">
              <template #title>
                错误修复模式
                <a-tag color="orange">
                  {{ store.errorFixPatterns.length }}
                </a-tag>
              </template>
              <a-empty
                v-if="store.errorFixPatterns.length === 0"
                description="暂无错误修复模式"
                :image-style="{ height: '40px' }"
              />
              <ul v-else class="pattern-list">
                <li
                  v-for="(item, i) in store.errorFixPatterns.slice(0, 5)"
                  :key="(item.id as string) ?? i"
                  class="pattern-row"
                >
                  <div class="pattern-meta">
                    <div class="pattern-line-1">
                      <a-tag
                        :color="classificationColor(item.error_classification)"
                      >
                        {{ item.error_classification ?? "UNKNOWN" }}
                      </a-tag>
                      <span class="pattern-success">
                        {{ successRatePercent(item) }}% 成功率
                      </span>
                    </div>
                    <div class="pattern-desc">
                      {{ truncate(item.fix_strategy ?? "", 60) }}
                    </div>
                  </div>
                </li>
              </ul>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card size="small" class="pattern-card">
              <template #title>
                代码片段
                <a-tag color="green">
                  {{ store.codeSnippets.length }}
                </a-tag>
              </template>
              <a-empty
                v-if="store.codeSnippets.length === 0"
                description="暂无代码片段"
                :image-style="{ height: '40px' }"
              />
              <ul v-else class="pattern-list">
                <li
                  v-for="(item, i) in store.codeSnippets.slice(0, 5)"
                  :key="(item.id as string) ?? i"
                  class="pattern-row"
                >
                  <div class="pattern-meta">
                    <div class="pattern-line-1">
                      <span class="pattern-title">{{ item.name }}</span>
                      <a-tag size="small">
                        {{ item.language || "text" }}
                      </a-tag>
                    </div>
                    <div class="pattern-desc">
                      {{ truncate(item.description ?? "无描述", 80) }}
                    </div>
                  </div>
                </li>
              </ul>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card size="small" class="pattern-card">
              <template #title>
                工作流模式
                <a-tag color="purple">
                  {{ store.workflowPatterns.length }}
                </a-tag>
              </template>
              <a-empty
                v-if="store.workflowPatterns.length === 0"
                description="暂无工作流模式"
                :image-style="{ height: '40px' }"
              />
              <ul v-else class="pattern-list">
                <li
                  v-for="(item, i) in store.workflowPatterns.slice(0, 5)"
                  :key="(item.id as string) ?? i"
                  class="pattern-row"
                >
                  <div class="pattern-meta">
                    <div class="pattern-line-1">
                      <span class="pattern-title">{{ item.name }}</span>
                      <a-tag size="small">
                        {{ Array.isArray(item.steps) ? item.steps.length : 0 }}
                        步骤
                      </a-tag>
                    </div>
                    <div class="pattern-desc">
                      执行 {{ item.execution_count ?? 0 }} 次
                    </div>
                  </div>
                </li>
              </ul>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <a-tab-pane key="preferences" tab="用户偏好">
        <a-table
          :columns="preferenceColumns"
          :data-source="store.preferences"
          :loading="store.loading && !store.hasLoaded"
          :pagination="{ pageSize: 8, size: 'small' }"
          :row-key="
            (row: UserPreference) => `${row.category ?? ''}.${row.key ?? ''}`
          "
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'value'">
              <a-typography-text
                :ellipsis="{ tooltip: formatPreferenceValue(record.value) }"
                style="max-width: 320px"
              >
                {{ formatPreferenceValue(record.value) }}
              </a-typography-text>
            </template>
            <template v-else-if="column.key === 'updated_at'">
              {{ formatMemDate(record.updated_at) }}
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="sessions" tab="会话记录">
        <a-empty
          v-if="!store.recentSessions.length && store.hasLoaded"
          description="暂无最近会话"
        />
        <a-list
          v-else
          :data-source="store.recentSessions"
          :loading="store.loading && !store.hasLoaded"
          :pagination="{ pageSize: 8, size: 'small' }"
          size="small"
          class="session-list"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <span class="session-title">
                    {{ item.title || "未命名会话" }}
                  </span>
                  <a-tag
                    v-if="item.has_summary"
                    color="green"
                    size="small"
                    class="session-summary-tag"
                  >
                    已摘要
                  </a-tag>
                </template>
                <template #description>
                  <a-space size="small" wrap>
                    <span class="session-meta">
                      <MessageOutlined />
                      {{ sessionMessageCount(item) }} 条消息
                    </span>
                    <span class="session-meta">
                      <ClockCircleOutlined />
                      {{ formatMemDate(item.updated_at) }}
                    </span>
                  </a-space>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>

      <a-tab-pane key="insights" tab="行为洞察">
        <a-row :gutter="[12, 12]">
          <a-col :xs="24" :lg="12">
            <a-card title="使用习惯" size="small">
              <a-descriptions :column="1" size="small">
                <a-descriptions-item label="最常用模型">
                  {{ insightString("mostUsedModel") }}
                </a-descriptions-item>
                <a-descriptions-item label="活跃时段">
                  {{ insightString("activeHours") }}
                </a-descriptions-item>
                <a-descriptions-item label="平均会话时长">
                  {{ insightString("avgSessionDuration") }}
                </a-descriptions-item>
                <a-descriptions-item label="常用功能">
                  <template v-if="topFeatures.length">
                    <a-tag
                      v-for="feature in topFeatures"
                      :key="feature"
                      size="small"
                    >
                      {{ feature }}
                    </a-tag>
                  </template>
                  <span v-else>-</span>
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>
          <a-col :xs="24" :lg="12">
            <a-card title="优化建议" size="small">
              <a-empty
                v-if="!store.recommendations.length"
                description="暂无优化建议"
                :image-style="{ height: '40px' }"
              />
              <a-list
                v-else
                :data-source="store.recommendations"
                size="small"
                class="recommendation-list"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #avatar>
                        <a-avatar
                          :style="{
                            backgroundColor: recommendationColor(item.type),
                          }"
                          size="small"
                        >
                          <template #icon>
                            <BulbOutlined />
                          </template>
                        </a-avatar>
                      </template>
                      <template #title>
                        <span class="recommendation-title">
                          {{ item.title || "建议" }}
                        </span>
                      </template>
                      <template #description>
                        <span class="recommendation-desc">
                          {{ item.description ?? "" }}
                        </span>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <a-tab-pane key="storage" tab="存储管理">
        <a-descriptions :column="2" bordered size="small">
          <a-descriptions-item label="Memory 目录">
            <a-typography-text
              :ellipsis="{ tooltip: store.memoryPath }"
              copyable
              style="max-width: 240px"
            >
              {{ store.memoryPath || "-" }}
            </a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="占用空间">
            {{ formatBytes(store.storageStats.totalSize) }}
          </a-descriptions-item>
          <a-descriptions-item label="总文件数">
            {{ store.storageStats.totalFiles }}
          </a-descriptions-item>
          <a-descriptions-item label="上次备份">
            {{ formatMemDate(store.storageStats.lastBackup) }}
          </a-descriptions-item>
        </a-descriptions>

        <div class="storage-actions">
          <a-dropdown :disabled="store.exporting">
            <a-button type="primary" :loading="store.exporting">
              <ExportOutlined />
              导出数据
              <DownOutlined />
            </a-button>
            <template #overlay>
              <a-menu @click="handleExport">
                <a-menu-item key="all"> 导出全部数据 </a-menu-item>
                <a-menu-item key="patterns"> 导出学习模式 </a-menu-item>
                <a-menu-item key="preferences"> 导出用户偏好 </a-menu-item>
                <a-menu-item key="sessions"> 导出会话摘要 </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button :loading="store.backingUp" @click="handleBackup">
            <SaveOutlined />
            创建备份
          </a-button>
          <a-popconfirm
            title="确认清理过期数据？"
            description="这会移除已超过保留期的会话和模式数据，且不可恢复。"
            ok-text="确认清理"
            cancel-text="取消"
            ok-type="danger"
            @confirm="handleCleanup"
          >
            <a-button danger :loading="store.cleaningUp">
              <DeleteOutlined />
              清理过期
            </a-button>
          </a-popconfirm>
          <a-button
            :disabled="!store.memoryPath"
            @click="store.openMemoryFolder()"
          >
            <FolderOpenOutlined />
            打开目录
          </a-button>
        </div>
      </a-tab-pane>

      <a-tab-pane key="auto-summary" tab="自动摘要">
        <a-descriptions :column="2" bordered size="small">
          <a-descriptions-item label="状态">
            <a-tag
              :color="store.autoSummaryConfig.enabled ? 'green' : 'default'"
            >
              {{ store.autoSummaryConfig.enabled ? "已启用" : "未启用" }}
            </a-tag>
            <a-tag v-if="store.autoSummaryConfig.isRunning" color="processing">
              运行中
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="后台模式">
            <a-tag
              :color="
                store.autoSummaryConfig.backgroundEnabled ? 'blue' : 'default'
              "
            >
              {{ store.autoSummaryConfig.backgroundEnabled ? "开启" : "关闭" }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="触发阈值（消息数）">
            {{ store.autoSummaryConfig.threshold }}
          </a-descriptions-item>
          <a-descriptions-item label="检查间隔">
            {{ Math.round(store.autoSummaryConfig.interval / 1000) }} 秒
          </a-descriptions-item>
          <a-descriptions-item label="队列长度">
            {{ store.autoSummaryConfig.queueLength }}
          </a-descriptions-item>
          <a-descriptions-item label="覆盖率">
            {{ Math.round(store.autoSummaryStats.coverage * 100) || 0 }}% ({{
              store.autoSummaryStats.withSummary
            }}
            / {{ store.autoSummaryStats.totalSessions }})
          </a-descriptions-item>
        </a-descriptions>

        <div class="storage-actions">
          <a-button
            type="primary"
            :loading="store.triggeringBulk"
            :disabled="store.autoSummaryStats.withoutSummary === 0"
            @click="handleBulkSummary"
          >
            <RobotOutlined />
            批量生成（待生成 {{ store.autoSummaryStats.withoutSummary }}）
          </a-button>
          <a-button
            :loading="store.loadingAutoSummary"
            @click="store.loadAutoSummaryInfo()"
          >
            <ReloadOutlined />
            刷新状态
          </a-button>
        </div>
        <a-alert
          message="高级配置（启停 / 阈值 / 间隔 / 后台开关）请在 V5 设置页 → 自动摘要 内调整。"
          type="info"
          show-icon
          class="auto-summary-hint"
        />
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  BulbOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  ReloadOutlined,
  RiseOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import {
  useMemoryBankStore,
  type RecentSession,
  type UserPreference,
} from "../stores/memoryBank";
import {
  classificationColor,
  formatBytes,
  formatMemDate,
  formatPreferenceValue,
  recommendationColor,
  successRatePercent,
  truncate,
} from "./helpers/memoryBankHelpers";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();

defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const store = useMemoryBankStore();
const activeTab = ref<string>("patterns");

const preferenceColumns = [
  { title: "分类", dataIndex: "category", key: "category", width: 110 },
  { title: "键", dataIndex: "key", key: "key", width: 160 },
  { title: "值", dataIndex: "value", key: "value" },
  {
    title: "更新时间",
    dataIndex: "updated_at",
    key: "updated_at",
    width: 130,
  },
];

function insightString(key: string): string {
  const v = store.behaviorInsights?.[key];
  if (v === undefined || v === null || v === "") {
    return "-";
  }
  return String(v);
}

const topFeatures = computed<string[]>(() => {
  const raw = (store.behaviorInsights as { topFeatures?: unknown }).topFeatures;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((f): f is string => typeof f === "string").slice(0, 5);
});

function sessionMessageCount(item: RecentSession): number {
  const a = item.messageCount;
  const b = (item as Record<string, unknown>).message_count;
  if (typeof a === "number") {
    return a;
  }
  if (typeof b === "number") {
    return b;
  }
  return 0;
}

// ========== Phase 4: storage + auto-summary handlers ==========

async function handleExport({
  key,
}: {
  key: "all" | "patterns" | "preferences" | "sessions";
}): Promise<void> {
  const hide = message.loading("正在导出...", 0);
  const result = await store.exportData(key);
  hide();
  if (result.success) {
    message.success(`已导出到 ${result.filePath ?? "本地文件"}`);
  } else {
    message.error(result.error ?? "导出失败");
  }
}

async function handleBackup(): Promise<void> {
  const result = await store.createBackup();
  if (result.success) {
    message.success(
      result.backupPath ? `备份成功：${result.backupPath}` : "备份成功",
    );
  } else {
    message.error(result.error ?? "备份失败");
  }
}

async function handleCleanup(): Promise<void> {
  const result = await store.cleanupExpired();
  if (result.success) {
    message.success(`清理完成，移除 ${result.removed ?? 0} 项`);
  } else {
    message.error(result.error ?? "清理失败");
  }
}

async function handleBulkSummary(): Promise<void> {
  const result = await store.triggerBulkSummary({
    limit: 20,
    overwrite: false,
  });
  if (result.success) {
    message.success(`已触发批量生成，处理 ${result.processed ?? 0} 个会话`);
  } else {
    message.error(result.error ?? "批量生成失败");
  }
}

function applyPrefill(): void {
  const a = props.prefillText?.trim();
  if (a === "preferences" || a === "storage") {
    activeTab.value = a;
  } else {
    activeTab.value = "patterns";
  }
}

async function refresh(): Promise<void> {
  await store.refreshAll();
}

watch(
  () => props.open,
  (next) => {
    if (next) {
      applyPrefill();
      void refresh();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-radius: 6px;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.prefill-text {
  font-family: var(--cc-mono, monospace);
}

.panel-desc {
  margin: 0 0 12px;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.6;
}

.stats-row {
  margin-bottom: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.memory-path-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
  font-family: var(--cc-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-tabs {
  margin-bottom: 8px;
}

.pattern-card :deep(.ant-card-head-title) {
  font-size: 13px;
  font-weight: 500;
}

.pattern-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pattern-row {
  padding: 6px 0;
  border-bottom: 1px solid var(--cc-shell-border, #f5f5f5);
}

.pattern-row:last-child {
  border-bottom: none;
}

.pattern-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pattern-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.pattern-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pattern-success {
  margin-inline-start: auto;
  font-size: 12px;
  color: var(--cc-shell-accent, #52c41a);
}

.pattern-desc {
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
  line-height: 1.5;
}

.session-list :deep(.ant-list-item) {
  padding: 8px 12px;
}

.session-title {
  font-weight: 500;
  margin-inline-end: 6px;
}

.session-summary-tag {
  font-size: 11px;
}

.session-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
}

.recommendation-list :deep(.ant-list-item) {
  padding: 8px 0;
}

.recommendation-title {
  font-size: 13px;
  font-weight: 500;
}

.recommendation-desc {
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
  line-height: 1.5;
}

.storage-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.auto-summary-hint {
  margin-top: 12px;
}
</style>
