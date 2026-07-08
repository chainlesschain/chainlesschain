<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '72vh', overflowY: 'auto' }"
    title="内容推荐"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BulbOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="rc-toolbar">
      <a-space size="large">
        <a-statistic title="推荐总数" :value="store.recommendations.length" />
        <a-statistic title="未读" :value="store.unviewedCount" />
      </a-space>
      <a-space>
        <a-button size="small" :loading="store.loading" @click="reload">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button
          type="primary"
          size="small"
          :loading="store.loading"
          @click="handleGenerate"
        >
          <template #icon><BulbOutlined /></template>
          生成推荐
        </a-button>
      </a-space>
    </div>

    <a-alert
      v-if="store.error"
      class="rc-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.error = null"
    />

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="feed" tab="推荐流">
        <a-spin :spinning="store.loading">
          <a-empty
            v-if="store.recommendations.length === 0"
            description="暂无推荐，点击“生成推荐”开始"
          />
          <ul v-else class="rc-list">
            <li
              v-for="item in store.recommendations"
              :key="item.id"
              class="rc-item"
              :class="{
                'rc-item-acted': item.status && item.status !== 'active',
              }"
            >
              <div class="rc-meta">
                <div class="rc-line-1">
                  <a-tag
                    :color="typeColor(item.content_type)"
                    :bordered="false"
                  >
                    {{ item.content_type }}
                  </a-tag>
                  <span class="rc-cid">{{ item.content_id }}</span>
                  <a-tag
                    v-if="item.status && item.status !== 'active'"
                    color="default"
                    :bordered="false"
                  >
                    {{ statusText(item.status) }}
                  </a-tag>
                </div>
                <div class="rc-line-2">
                  <span class="rc-reason">{{ item.reason }}</span>
                  <span class="rc-dot">·</span>
                  <span class="rc-score"
                    >匹配度 {{ scorePct(item.score) }}%</span
                  >
                </div>
              </div>
              <div class="rc-actions">
                <a-button
                  type="text"
                  size="small"
                  @click="handleFeedback(item.id, 'liked')"
                >
                  <template #icon><LikeOutlined /></template>
                </a-button>
                <a-button
                  type="text"
                  size="small"
                  @click="handleFeedback(item.id, 'saved')"
                >
                  <template #icon><StarOutlined /></template>
                </a-button>
                <a-button
                  type="text"
                  size="small"
                  @click="handleFeedback(item.id, 'dismissed')"
                >
                  <template #icon><CloseOutlined /></template>
                </a-button>
              </div>
            </li>
          </ul>
        </a-spin>
      </a-tab-pane>

      <a-tab-pane key="profile" tab="兴趣画像">
        <a-card v-if="store.profile" size="small">
          <a-descriptions :column="1" size="small" title="你的兴趣画像">
            <a-descriptions-item label="最近更新">
              {{ formatDate(store.profile.last_updated) }}
            </a-descriptions-item>
            <a-descriptions-item label="更新次数">
              {{ store.profile.update_count }}
            </a-descriptions-item>
          </a-descriptions>
          <a-divider>话题权重</a-divider>
          <a-empty
            v-if="topicEntries.length === 0"
            description="暂无话题权重"
          />
          <div
            v-for="[topic, weight] in topicEntries"
            :key="topic"
            class="rc-topic"
          >
            <span class="rc-topic-name">{{ topic }}</span>
            <a-progress
              :percent="Math.round(Number(weight) * 100)"
              size="small"
            />
          </div>
        </a-card>
        <a-empty v-else description="尚未生成兴趣画像" />
      </a-tab-pane>
    </a-tabs>

    <p class="panel-desc">
      基于本地 AI 的个性化内容推荐（斜杠命令
      <code>/recommendations</code>）。点赞 / 收藏 / 忽略会用于优化后续推荐。
    </p>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  BulbOutlined,
  ReloadOutlined,
  LikeOutlined,
  StarOutlined,
  CloseOutlined,
} from "@ant-design/icons-vue";
import { useRecommendationStore } from "../stores/recommendation";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useRecommendationStore();
const activeTab = ref("feed");
const userId = "default-user";

// Load once whenever the panel is opened.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      void store.fetchRecommendations(userId);
      void store.fetchProfile(userId);
    }
  },
  { immediate: true },
);

const topicEntries = computed<[string, number][]>(() => {
  const topics = store.profile?.topics;
  return topics ? (Object.entries(topics) as [string, number][]) : [];
});

function reload(): void {
  void store.fetchRecommendations(userId);
  void store.fetchProfile(userId);
}

async function handleGenerate(): Promise<void> {
  const result = await store.generate(userId);
  if (result?.success) {
    message.success("已生成推荐");
  } else {
    message.error(result?.error || "生成失败");
  }
}

async function handleFeedback(id: string, feedback: string): Promise<void> {
  const result = await store.provideFeedback(id, feedback);
  if (result?.success === false) {
    message.error(result.error || "操作失败");
    return;
  }
  message.success(`已标记为${statusText(feedback)}`);
}

function scorePct(score: number): number {
  return Math.round((Number(score) || 0) * 100);
}

function typeColor(type?: string): string {
  return (
    { post: "blue", article: "green", note: "orange", knowledge: "purple" }[
      type ?? ""
    ] ?? "default"
  );
}

function statusText(status?: string): string {
  return (
    { liked: "赞", saved: "收藏", dismissed: "忽略" }[status ?? ""] ??
    status ??
    ""
  );
}

function formatDate(ts?: number): string {
  if (!ts) {
    return "—";
  }
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString();
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
.rc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.rc-error {
  margin-bottom: 12px;
}
.rc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rc-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.rc-item-acted {
  opacity: 0.55;
}
.rc-meta {
  flex: 1;
  min-width: 0;
}
.rc-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rc-cid {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rc-line-2 {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
.rc-dot {
  margin: 0 6px;
}
.rc-actions {
  flex: none;
  display: flex;
  gap: 2px;
}
.rc-topic {
  margin-bottom: 8px;
}
.rc-topic-name {
  font-size: 13px;
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
