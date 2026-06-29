<template>
  <a-modal
    :open="open"
    :width="820"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="会话管理"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <HistoryOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="sm-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.error = null"
    />

    <a-row :gutter="16" class="sm-stats">
      <a-col :span="6">
        <a-statistic
          title="会话总数"
          :value="store.globalStats.totalSessions"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="消息总数"
          :value="store.globalStats.totalMessages"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="标签数" :value="store.globalStats.uniqueTags" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="模板数" :value="store.globalStats.totalTemplates" />
      </a-col>
    </a-row>

    <div class="sm-toolbar">
      <a-input-search
        v-model:value="searchInput"
        placeholder="搜索会话标题 / 内容…"
        allow-clear
        style="max-width: 360px"
        :loading="store.loading"
        @search="onSearch"
      />
      <a-button :loading="store.loading" @click="refresh">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-spin :spinning="store.loading">
      <a-empty v-if="store.sessions.length === 0" description="暂无会话" />
      <ul v-else class="sm-list">
        <li
          v-for="s in store.sessions"
          :key="s.id"
          class="sm-item"
          @click="openDetail(s.id)"
        >
          <div class="sm-meta">
            <div class="sm-line-1">
              <span class="sm-title">{{ s.title || "(未命名会话)" }}</span>
              <a-tag
                v-for="tag in (s.tags || []).slice(0, 3)"
                :key="tag"
                color="blue"
                :bordered="false"
              >
                {{ tag }}
              </a-tag>
            </div>
            <div class="sm-line-2">
              <span v-if="s.message_count != null"
                >{{ s.message_count }} 条消息</span
              >
              <span v-if="s.token_count != null" class="sm-dot">·</span>
              <span v-if="s.token_count != null"
                >{{ s.token_count }} tokens</span
              >
              <span class="sm-dot">·</span>
              <span>{{ formatTime(s.updated_at) }}</span>
            </div>
          </div>
          <a-space class="sm-actions" @click.stop>
            <a-button type="link" size="small" @click="resume(s.id)">
              恢复
            </a-button>
            <a-button type="link" size="small" @click="openRename(s)">
              重命名
            </a-button>
            <a-popconfirm
              title="确定删除该会话?"
              ok-text="删除"
              cancel-text="取消"
              @confirm="remove(s.id)"
            >
              <a-button type="link" size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </li>
      </ul>
    </a-spin>

    <p class="panel-desc">
      会话历史快速管理（恢复 / 重命名 / 删除 /
      搜索）。模板、标签管理、批量操作与导入导出仍在 V5 完整会话管理页，后续
      phase 迁入本面板。
    </p>

    <!-- detail drawer -->
    <a-drawer
      :open="detailOpen"
      title="会话详情"
      placement="right"
      :width="380"
      @close="detailOpen = false"
    >
      <a-spin :spinning="store.loadingDetail">
        <a-descriptions
          v-if="store.currentSession"
          :column="1"
          size="small"
          bordered
        >
          <a-descriptions-item label="标题">
            {{ store.currentSession.title || "(未命名)" }}
          </a-descriptions-item>
          <a-descriptions-item v-if="store.currentSession.summary" label="摘要">
            {{ store.currentSession.summary }}
          </a-descriptions-item>
          <a-descriptions-item label="消息数">
            {{ store.currentSession.message_count ?? "--" }}
          </a-descriptions-item>
          <a-descriptions-item label="Tokens">
            {{ store.currentSession.token_count ?? "--" }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="(store.currentSession.tags || []).length"
            label="标签"
          >
            <a-tag
              v-for="tag in store.currentSession.tags"
              :key="tag"
              color="blue"
            >
              {{ tag }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatTime(store.currentSession.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="更新时间">
            {{ formatTime(store.currentSession.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>
      </a-spin>
    </a-drawer>

    <!-- rename modal -->
    <a-modal
      v-model:open="renameOpen"
      title="重命名会话"
      :confirm-loading="renaming"
      @ok="confirmRename"
    >
      <a-input
        v-model:value="renameValue"
        placeholder="输入新标题"
        @press-enter="confirmRename"
      />
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { message } from "ant-design-vue";
import { HistoryOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import { useSessionStore, type Session } from "../stores/session";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useSessionStore();

const searchInput = ref("");
const detailOpen = ref(false);
const renameOpen = ref(false);
const renameValue = ref("");
const renaming = ref(false);
let renameTarget: string | null = null;

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      refresh();
    }
  },
  { immediate: true },
);

function refresh(): void {
  searchInput.value = "";
  store.loadSessions({ offset: 0 });
  store.loadGlobalStats();
}

async function onSearch(value: string): Promise<void> {
  const q = (value || "").trim();
  if (!q) {
    store.loadSessions({ offset: 0 });
    return;
  }
  await store.searchSessions(q);
}

async function openDetail(sessionId: string): Promise<void> {
  detailOpen.value = true;
  await store.loadSessionDetail(sessionId);
}

async function resume(sessionId: string): Promise<void> {
  try {
    await store.resumeSession(sessionId);
    message.success("会话已恢复");
  } catch {
    message.error("恢复失败");
  }
}

function openRename(s: Session): void {
  renameTarget = s.id;
  renameValue.value = s.title || "";
  renameOpen.value = true;
}

async function confirmRename(): Promise<void> {
  const title = renameValue.value.trim();
  if (!title || !renameTarget) {
    return;
  }
  renaming.value = true;
  try {
    await store.updateTitle(renameTarget, title);
    message.success("已重命名");
    renameOpen.value = false;
    await store.loadSessions({ offset: 0 });
  } catch {
    message.error("重命名失败");
  } finally {
    renaming.value = false;
  }
}

async function remove(sessionId: string): Promise<void> {
  try {
    const res = await store.deleteSession(sessionId);
    if (res?.success !== false) {
      message.success("已删除");
      await Promise.all([
        store.loadSessions({ offset: 0 }),
        store.loadGlobalStats(),
      ]);
    } else {
      message.error("删除失败");
    }
  } catch {
    message.error("删除失败");
  }
}

function formatTime(ts?: string | number): string {
  if (ts == null) {
    return "—";
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.sm-error {
  margin-bottom: 12px;
}
.sm-stats {
  margin-bottom: 16px;
}
.sm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.sm-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sm-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: background 0.15s;
}
.sm-item:hover {
  background: rgba(0, 0, 0, 0.03);
}
.sm-meta {
  flex: 1;
  min-width: 0;
}
.sm-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sm-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sm-line-2 {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.sm-dot {
  margin: 0 6px;
}
.sm-actions {
  flex: none;
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
