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
      <ul v-if="store.communities.length" class="community-list">
        <li v-for="c in store.communities" :key="c.id" class="community-row">
          <div class="community-meta">
            <div class="community-line-1">
              <span class="community-name">{{ c.name ?? "(未命名)" }}</span>
              <a-tag v-if="c.my_role" :color="roleColor(c.my_role)">
                {{ roleLabel(c.my_role) }}
              </a-tag>
              <a-tag v-if="typeof c.member_count === 'number'" color="default">
                {{ c.member_count }} / {{ c.member_limit ?? "∞" }} 人
              </a-tag>
              <a-tag v-if="c.status && c.status !== 'active'" color="orange">
                {{ c.status === "archived" ? "已归档" : c.status }}
              </a-tag>
            </div>
            <div class="community-line-2">
              <span class="community-id">{{ shortId(c.id) }}</span>
              <span v-if="c.description" class="community-desc">
                · {{ c.description }}
              </span>
            </div>
          </div>
          <div class="community-actions">
            <a-button size="small" type="link" @click="store.openDetails(c.id)">
              <EyeOutlined />
            </a-button>
            <a-button
              v-if="c.my_role !== 'owner'"
              size="small"
              type="link"
              :loading="store.leavingId === c.id"
              @click="confirmLeave(c)"
            >
              退出
            </a-button>
            <a-tooltip v-else title="所有者不能退出，只能删除社区">
              <a-button size="small" type="link" disabled> 退出 </a-button>
            </a-tooltip>
            <a-button
              v-if="c.my_role === 'owner'"
              size="small"
              type="link"
              danger
              :loading="store.deletingId === c.id"
              @click="confirmDelete(c)"
            >
              <DeleteOutlined />
            </a-button>
          </div>
        </li>
      </ul>
      <div v-else-if="store.hasLoaded" class="empty-hint">
        暂无已加入的社区，点击下方"创建社区"开始，或前往
        <code>/community</code> 搜索公开社区。
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

  <CreateCommunityWizard />
  <CommunityDetailsDrawer />
</template>

<script setup lang="ts">
import { watch } from "vue";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  TeamOutlined,
  DeleteOutlined,
  EyeOutlined,
} from "@ant-design/icons-vue";
import {
  useCommunityQuickStore,
  type CommunitySummary,
} from "../stores/communityQuick";
import CreateCommunityWizard from "./community/CreateCommunityWizard.vue";
import CommunityDetailsDrawer from "./community/CommunityDetailsDrawer.vue";

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
    desc: "新建一个社区，自动以默认 DID 身份成为 owner。",
    cta: "开始",
    primary: true,
  },
  {
    id: "search",
    label: "搜索社区",
    desc: "按名称查找公开社区并加入（Phase 4 内嵌）。",
    cta: "前往",
  },
];

function confirmLeave(c: CommunitySummary): void {
  Modal.confirm({
    title: "退出社区",
    content: `确定退出 ${c.name ?? c.id}？退出后将无法接收该社区的频道消息。`,
    okText: "退出",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const ok = await store.leaveCommunity(c.id);
      if (ok) {
        antMessage.success(`已退出 ${c.name ?? "社区"}`);
      }
    },
  });
}

function confirmDelete(c: CommunitySummary): void {
  Modal.confirm({
    title: "删除社区",
    content: `确定删除 ${c.name ?? c.id}？此操作不可撤销，仅社区所有者可以执行。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const ok = await store.deleteCommunity(c.id);
      if (ok) {
        antMessage.success(`已删除 ${c.name ?? "社区"}`);
      }
    },
  });
}

function shortId(id?: string): string {
  if (!id) {
    return "—";
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const ROLE_COLORS: Record<string, string> = {
  owner: "gold",
  admin: "geekblue",
  member: "green",
};
const ROLE_LABELS: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
};
function roleColor(role?: string): string {
  if (!role) {
    return "default";
  }
  return ROLE_COLORS[role] || "default";
}
function roleLabel(role?: string): string {
  if (!role) {
    return "";
  }
  return ROLE_LABELS[role] || role;
}

function run(action: CommunityAction): void {
  if (action.id === "create") {
    store.openCreateForm();
    return;
  }
  antMessage.info(
    `${action.label}：当前在 /community 完成，下一阶段将内嵌到此面板`,
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
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
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
  gap: 2px;
}

.community-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.community-line-2 {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
  overflow: hidden;
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

.community-desc {
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 380px;
}

.community-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
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
