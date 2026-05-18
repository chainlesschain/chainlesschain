<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="知识图谱"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <NodeIndexOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      将笔记、标签、语义相似度与时间线融合为可视化图谱，底层由 RAG 索引驱动。
      下方操作通过
      <code>useRagStore</code> 管理索引（完整面板请访问
      <code>/knowledge/graph</code>）。
    </p>

    <div v-if="store.hasLoaded && store.stats" class="stats-row">
      <div class="stat">
        <span class="stat-label">文档数</span>
        <span class="stat-value">{{ store.stats.totalDocuments ?? "—" }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">块数</span>
        <span class="stat-value">{{ store.stats.totalChunks ?? "—" }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">索引大小</span>
        <span class="stat-value">{{ fmtBytes(store.stats.indexSize) }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">上次重建</span>
        <span class="stat-value">{{
          fmtRelative(store.stats.lastRebuiltAt)
        }}</span>
      </div>
    </div>

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button
            size="small"
            :loading="busyId === action.id"
            :disabled="anyBusy && busyId !== action.id"
            @click="trigger(action)"
          >
            执行
          </a-button>
        </div>
        <p class="action-desc">
          {{ action.desc }}
        </p>
      </li>
    </ul>

    <a-alert
      v-if="store.error"
      class="error-alert"
      :message="store.error"
      type="error"
      show-icon
      closable
      @close="store.clearError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { NodeIndexOutlined } from "@ant-design/icons-vue";
import { useRagStore } from "../stores/rag";

interface GraphAction {
  id: "rebuild-all" | "rebuild-tags" | "refresh";
  label: string;
  desc: string;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useRagStore();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadStats();
    }
  },
);

const actions: GraphAction[] = [
  {
    id: "rebuild-all",
    label: "重建完整 RAG 索引",
    desc: "扫描所有知识，重新生成向量与语义块。耗时较长。",
  },
  {
    id: "rebuild-tags",
    label: "仅重建标签关系",
    desc: "快速重建基于标签的关联（需前往 /knowledge/graph 完成）。",
  },
  {
    id: "refresh",
    label: "刷新统计",
    desc: "重新计算 RAG 索引统计。",
  },
];

const busyId = computed<GraphAction["id"] | null>(() => {
  if (store.rebuilding) {
    return "rebuild-all";
  }
  if (store.loading) {
    return "refresh";
  }
  return null;
});

const anyBusy = computed(() => store.rebuilding || store.loading);

function fmtBytes(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return "—";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fmtRelative(ts: unknown): string {
  if (typeof ts !== "number" || ts <= 0) {
    return "—";
  }
  const delta = Date.now() - ts;
  if (delta < 60_000) {
    return "刚刚";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)} 分钟前`;
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)} 小时前`;
  }
  return `${Math.floor(delta / 86_400_000)} 天前`;
}

async function trigger(action: GraphAction): Promise<void> {
  if (action.id === "rebuild-all") {
    const ok = await store.rebuildIndex();
    if (ok) {
      antMessage.success("RAG 索引重建完成");
    }
    return;
  }
  if (action.id === "refresh") {
    await store.loadStats();
    if (!store.error) {
      antMessage.success("统计已刷新");
    }
    return;
  }
  antMessage.info(`${action.label}：请前往 /knowledge/graph 完成此操作`);
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
}

.panel-desc {
  margin: 0 0 16px 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  line-height: 1.6;
}

.panel-desc code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.stat {
  padding: 8px 10px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 11px;
  color: var(--cc-shell-muted, #595959);
}

.stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-variant-numeric: tabular-nums;
}

.action-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.action-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.action-title {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.action-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}

.error-alert {
  margin-top: 12px;
}
</style>
