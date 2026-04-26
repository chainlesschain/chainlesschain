<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="社区"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <TeamOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      去中心化社区与频道。社区成员通过 DID 身份加入，频道消息走 P2P
      加密通道，治理走 DAO 投票。 下方显示社区列表（完整管理请访问
      <code>/community</code>）。
    </p>

    <div class="communities-summary">
      <div class="summary-header">
        <span class="summary-label">社区列表</span>
        <a-tag v-if="store.hasLoaded" color="magenta">
          {{ store.joinedCount }} 已加入 / {{ store.communities.length }}
        </a-tag>
        <a-button
          size="small"
          type="link"
          :loading="store.loading"
          @click="store.loadAll()"
        >
          刷新
        </a-button>
      </div>
      <ul v-if="store.recent.length" class="community-list">
        <li v-for="c in store.recent" :key="c.id" class="community-row">
          <div class="community-meta">
            <span class="community-name">{{ c.name ?? "(未命名)" }}</span>
            <span class="community-id">{{ shortId(c.id) }}</span>
          </div>
          <a-tag v-if="c.visibility" :color="visibilityColor(c.visibility)">
            {{
              c.visibility === "public"
                ? "公开"
                : c.visibility === "private"
                  ? "私密"
                  : c.visibility
            }}
          </a-tag>
          <a-tag v-if="typeof c.memberCount === 'number'" color="default">
            {{ c.memberCount }} 人
          </a-tag>
          <a-tag v-if="c.isJoined" color="green"> 已加入 </a-tag>
        </li>
      </ul>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        暂无社区，前往 <code>/community</code> 创建或搜索社区。
      </div>
    </div>

    <a-divider />

    <ul class="action-list">
      <li v-for="action in actions" :key="action.id" class="action-card">
        <div class="action-header">
          <span class="action-title">{{ action.label }}</span>
          <a-button
            size="small"
            :type="action.primary ? 'primary' : 'default'"
            :disabled="action.disabled"
            @click="run(action)"
          >
            {{ action.cta }}
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
import { watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { TeamOutlined } from "@ant-design/icons-vue";
import { useCommunityQuickStore } from "../stores/communityQuick";

interface CommunityAction {
  id: string;
  label: string;
  desc: string;
  cta: string;
  primary?: boolean;
  disabled?: boolean;
}

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useCommunityQuickStore();

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.hasLoaded) {
      store.loadAll();
    }
  },
);

const actions: CommunityAction[] = [
  {
    id: "create",
    label: "创建社区",
    desc: "新建公开或私密社区，可设置加入策略与治理规则。",
    cta: "前往",
    primary: true,
  },
  {
    id: "search",
    label: "搜索社区",
    desc: "按名称、标签或描述查找公开社区。",
    cta: "前往",
  },
  {
    id: "invite",
    label: "加入邀请",
    desc: "通过邀请码或邀请链接加入私密社区。",
    cta: "前往",
  },
  {
    id: "channels",
    label: "频道管理",
    desc: "在已加入的社区中创建、归档或置顶频道。",
    cta: "前往",
  },
];

function shortId(id?: string): string {
  if (!id) {
    return "—";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const VISIBILITY_COLORS: Record<string, string> = {
  public: "blue",
  private: "purple",
};
function visibilityColor(v?: string): string {
  if (!v) {
    return "default";
  }
  return VISIBILITY_COLORS[v] || "default";
}

function run(action: CommunityAction): void {
  antMessage.info(
    `${action.label}：请在 /community 完成该操作（快速面板仅展示概览）`,
  );
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

.communities-summary {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.summary-label {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.summary-header > .ant-btn-link {
  margin-left: auto;
}

.community-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.community-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px dashed var(--cc-shell-border, #eee);
}

.community-row:first-child {
  border-top: none;
  padding-top: 0;
}

.community-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.community-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.community-id {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.empty-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
}

.empty-hint code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
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
