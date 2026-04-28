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
                        {{
                          Array.isArray(item.steps) ? item.steps.length : 0
                        }}
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

      <a-tab-pane key="preferences" tab="用户偏好" disabled>
        <a-empty
          description="Phase 3 — 用户偏好 / 会话 / 行为洞察 tab 即将接入"
        />
      </a-tab-pane>
      <a-tab-pane key="storage" tab="存储管理" disabled>
        <a-empty description="Phase 4 — 存储管理 / 自动摘要 即将接入" />
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  BulbOutlined,
  DatabaseOutlined,
  MessageOutlined,
  ReloadOutlined,
  RiseOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import { useMemoryBankStore } from "../stores/memoryBank";
import {
  classificationColor,
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
</style>
