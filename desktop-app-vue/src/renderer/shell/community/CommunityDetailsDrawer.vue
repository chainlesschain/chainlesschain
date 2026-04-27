<template>
  <a-drawer
    :open="store.viewingCommunityId !== null"
    :width="720"
    :mask-closable="true"
    :body-style="{ paddingBottom: '64px' }"
    :title="drawerTitle"
    placement="right"
    @close="store.closeDetails()"
  >
    <a-spin :spinning="store.detailsLoading">
      <div v-if="community" class="details-body">
        <a-descriptions bordered :column="1" size="small">
          <a-descriptions-item label="社区名称">
            {{ community.name }}
          </a-descriptions-item>

          <a-descriptions-item label="社区 ID">
            <a-typography-paragraph
              :copyable="{ text: String(community.id) }"
              style="margin: 0; word-break: break-all"
            >
              <code>{{ community.id }}</code>
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="简介">
            {{ community.description || "无" }}
          </a-descriptions-item>

          <a-descriptions-item label="创建者">
            <a-typography-paragraph
              v-if="community.creator_did"
              :copyable="{ text: String(community.creator_did) }"
              style="margin: 0; word-break: break-all"
            >
              <code>{{ community.creator_did }}</code>
            </a-typography-paragraph>
            <span v-else class="muted">—</span>
          </a-descriptions-item>

          <a-descriptions-item label="成员">
            {{ community.member_count ?? 0 }} /
            {{ community.member_limit ?? "∞" }}
          </a-descriptions-item>

          <a-descriptions-item label="状态">
            <a-tag :color="statusColor(community.status)">
              {{ statusLabel(community.status) }}
            </a-tag>
          </a-descriptions-item>

          <a-descriptions-item label="创建时间">
            {{ formatTime(community.created_at) }}
          </a-descriptions-item>

          <a-descriptions-item v-if="community.rules_md" label="社区规则">
            <pre class="rules-block">{{ community.rules_md }}</pre>
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          v-if="store.detailsError"
          class="details-error"
          :message="store.detailsError"
          type="error"
          show-icon
          closable
          @close="store.clearDetailsError()"
        />

        <a-tabs v-model:active-key="activeTab" class="details-tabs">
          <a-tab-pane key="members">
            <template #tab>
              成员
              <a-tag size="small" color="default">
                {{ store.viewingMembers.length }}
              </a-tag>
            </template>

            <a-table
              :data-source="store.viewingMembers"
              :columns="memberColumns"
              :pagination="false"
              size="small"
              row-key="id"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'role'">
                  <a-tag :color="roleColor(record.role)">
                    {{ roleLabel(record.role) }}
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'identity'">
                  <div class="member-identity">
                    <span class="member-nickname">
                      {{
                        record.contact_nickname ?? record.nickname ?? "(未命名)"
                      }}
                    </span>
                    <span class="member-did">{{
                      shortDid(record.member_did)
                    }}</span>
                  </div>
                </template>
                <template v-else-if="column.key === 'joined_at'">
                  <span class="muted">{{ formatTime(record.joined_at) }}</span>
                </template>
                <template v-else-if="column.key === 'actions'">
                  <a-space v-if="canManage && record.role !== 'owner'">
                    <a-dropdown v-if="record.role === 'member'">
                      <a-button
                        size="small"
                        type="link"
                        :loading="store.promotingDid === record.member_did"
                      >
                        提升 ▾
                      </a-button>
                      <template #overlay>
                        <a-menu @click="onPromote(record, $event.key)">
                          <a-menu-item key="moderator"> 为版主 </a-menu-item>
                          <a-menu-item key="admin"> 为管理员 </a-menu-item>
                        </a-menu>
                      </template>
                    </a-dropdown>
                    <a-button
                      v-if="
                        record.role === 'admin' || record.role === 'moderator'
                      "
                      size="small"
                      type="link"
                      :loading="store.demotingDid === record.member_did"
                      @click="onDemote(record)"
                    >
                      降级
                    </a-button>
                    <a-button
                      size="small"
                      type="link"
                      danger
                      :loading="store.banningDid === record.member_did"
                      @click="onBan(record)"
                    >
                      封禁
                    </a-button>
                  </a-space>
                  <span v-else-if="record.role === 'owner'" class="muted">
                    所有者
                  </span>
                </template>
              </template>
            </a-table>
          </a-tab-pane>

          <a-tab-pane key="channels">
            <template #tab>
              频道
              <a-tag size="small" color="default">
                {{ store.viewingChannels.length }}
              </a-tag>
            </template>

            <!-- List view (no channel selected) -->
            <div v-if="!store.selectedChannelId" class="channels-list-view">
              <div v-if="canManage" class="channels-list-header">
                <a-button
                  size="small"
                  type="primary"
                  @click="onOpenCreateChannel"
                >
                  <PlusOutlined /> 新建频道
                </a-button>
              </div>

              <a-list
                :data-source="store.viewingChannels"
                :pagination="false"
                size="small"
                :locale="{ emptyText: '该社区还没有频道' }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <a class="channel-name" @click="onSelectChannel(item)">
                          {{ item.name }}
                        </a>
                        <a-tag :color="channelTypeColor(item.type)">
                          {{ channelTypeLabel(item.type) }}
                        </a-tag>
                      </template>
                      <template #description>
                        <span v-if="item.description">{{
                          item.description
                        }}</span>
                        <span v-else class="muted">无描述</span>
                        <span class="muted channel-time">
                          · 创建于 {{ formatTime(item.created_at) }}
                        </span>
                      </template>
                    </a-list-item-meta>
                    <template #actions>
                      <a-button
                        size="small"
                        type="link"
                        @click="onSelectChannel(item)"
                      >
                        进入
                      </a-button>
                      <a-button
                        v-if="canManage"
                        size="small"
                        type="link"
                        danger
                        :loading="store.deletingChannelId === item.id"
                        @click="onConfirmDeleteChannel(item)"
                      >
                        <DeleteOutlined />
                      </a-button>
                    </template>
                  </a-list-item>
                </template>
              </a-list>
            </div>

            <!-- Message view (channel selected) -->
            <div v-else class="channel-message-view">
              <div class="channel-message-header">
                <a-button
                  size="small"
                  type="link"
                  @click="store.clearSelectedChannel()"
                >
                  <ArrowLeftOutlined /> 返回频道列表
                </a-button>
                <span class="channel-active-name">
                  {{ activeChannel?.name ?? "(未命名频道)" }}
                </span>
                <a-tag
                  v-if="activeChannel?.type"
                  :color="channelTypeColor(activeChannel.type)"
                >
                  {{ channelTypeLabel(activeChannel.type) }}
                </a-tag>
              </div>

              <a-alert
                v-if="store.channelError"
                class="channel-error"
                :message="store.channelError"
                type="error"
                show-icon
                closable
                @close="store.clearChannelError()"
              />

              <a-spin :spinning="store.messagesLoading">
                <div class="message-stream">
                  <div
                    v-if="
                      !store.messagesLoading &&
                      store.channelMessages.length === 0
                    "
                    class="muted message-empty"
                  >
                    还没有消息，发送第一条消息开启对话。
                  </div>
                  <div
                    v-for="m in store.channelMessages"
                    :key="m.id"
                    class="message-row"
                    :class="{ 'message-pinned': m.is_pinned === 1 }"
                  >
                    <div class="message-meta">
                      <span class="message-sender">
                        {{ m.sender_nickname ?? shortDid(m.sender_did) }}
                      </span>
                      <span class="muted message-time">
                        {{ formatTime(m.created_at) }}
                      </span>
                      <a-tag v-if="m.is_pinned === 1" color="gold" size="small">
                        已置顶
                      </a-tag>
                      <span v-if="canManage" class="message-actions">
                        <a-button
                          size="small"
                          type="link"
                          :loading="store.pinningMessageId === m.id"
                          @click="store.pinMessage(m.id)"
                        >
                          {{ m.is_pinned === 1 ? "取消置顶" : "置顶" }}
                        </a-button>
                      </span>
                    </div>
                    <div
                      class="message-content"
                      :class="
                        m.message_type === 'system' ? 'message-system' : ''
                      "
                    >
                      {{ m.content }}
                    </div>
                  </div>
                </div>
              </a-spin>

              <div
                v-if="activeChannel?.type !== 'readonly' || canManage"
                class="message-composer"
              >
                <a-textarea
                  v-model:value="composerText"
                  placeholder="发送消息（Ctrl/⌘ + Enter）"
                  :rows="2"
                  :maxlength="4000"
                  @keydown="onComposerKeyDown"
                />
                <div class="composer-actions">
                  <span class="muted">
                    {{ composerText.trim().length }} / 4000
                  </span>
                  <a-button
                    type="primary"
                    :loading="store.sendingMessage"
                    :disabled="!composerText.trim()"
                    @click="onSend"
                  >
                    <SendOutlined /> 发送
                  </a-button>
                </div>
              </div>
              <div v-else class="muted message-readonly-hint">
                只读频道，仅管理员可发送消息。
              </div>
            </div>
          </a-tab-pane>
        </a-tabs>
      </div>
    </a-spin>
  </a-drawer>

  <!-- Create channel sub-modal -->
  <a-modal
    v-model:open="createChannelOpen"
    :width="520"
    :confirm-loading="store.creatingChannel"
    :mask-closable="!store.creatingChannel"
    title="新建频道"
    ok-text="创建"
    cancel-text="取消"
    @ok="onCreateChannel"
    @cancel="onCancelCreateChannel"
  >
    <a-form :model="channelForm" :label-col="{ span: 5 }">
      <a-form-item label="频道名称" required>
        <a-input
          v-model:value="channelForm.name"
          placeholder="例如：general"
          :maxlength="50"
          show-count
        />
      </a-form-item>
      <a-form-item label="简介">
        <a-input
          v-model:value="channelForm.description"
          placeholder="一句话描述（可选）"
          :maxlength="200"
        />
      </a-form-item>
      <a-form-item label="类型">
        <a-radio-group v-model:value="channelForm.type">
          <a-radio value="discussion"> 讨论 </a-radio>
          <a-radio value="announcement"> 公告 </a-radio>
          <a-radio value="readonly"> 只读 </a-radio>
          <a-radio value="subscription"> 订阅 </a-radio>
        </a-radio-group>
      </a-form-item>
    </a-form>
    <a-alert
      v-if="store.channelError"
      :message="store.channelError"
      type="error"
      show-icon
      closable
      @close="store.clearChannelError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SendOutlined,
} from "@ant-design/icons-vue";
import {
  useCommunityQuickStore,
  type CommunityChannel,
  type CommunityMember,
} from "../../stores/communityQuick";

const store = useCommunityQuickStore();
const activeTab = ref<"members" | "channels">("members");
const composerText = ref("");
const createChannelOpen = ref(false);
const channelForm = reactive({
  name: "",
  description: "",
  type: "discussion" as
    | "discussion"
    | "announcement"
    | "readonly"
    | "subscription",
});

const activeChannel = computed<CommunityChannel | undefined>(() => {
  if (!store.selectedChannelId) {
    return undefined;
  }
  return store.viewingChannels.find((c) => c.id === store.selectedChannelId);
});

const community = computed(() => store.viewingCommunity);

const drawerTitle = computed(() => {
  if (!community.value) {
    return "社区详情";
  }
  return `${community.value.name ?? "(未命名)"} · 社区详情`;
});

const myRole = computed<string | undefined>(() => {
  // The list view's row already carries my_role; the drawer row from
  // get-by-id may not. Cross-reference by id from the list cache.
  const id = store.viewingCommunityId;
  if (!id) {
    return undefined;
  }
  const cached = store.communities.find((c) => c.id === id);
  return cached?.my_role as string | undefined;
});

const canManage = computed(
  () => myRole.value === "owner" || myRole.value === "admin",
);

const memberColumns = [
  { title: "角色", key: "role", width: 90 },
  { title: "成员", key: "identity" },
  { title: "加入时间", key: "joined_at", width: 160 },
  { title: "操作", key: "actions", width: 200 },
];

const ROLE_COLORS: Record<string, string> = {
  owner: "gold",
  admin: "geekblue",
  moderator: "blue",
  member: "green",
};
const ROLE_LABELS: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  moderator: "版主",
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

const STATUS_COLORS: Record<string, string> = {
  active: "green",
  archived: "orange",
  banned: "red",
};
function statusColor(status?: string): string {
  if (!status) {
    return "default";
  }
  return STATUS_COLORS[status] || "default";
}
function statusLabel(status?: string): string {
  if (status === "active") {
    return "活跃";
  }
  if (status === "archived") {
    return "已归档";
  }
  if (status === "banned") {
    return "已封禁";
  }
  return status ?? "—";
}

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  announcement: "公告",
  discussion: "讨论",
  readonly: "只读",
  subscription: "订阅",
};
const CHANNEL_TYPE_COLORS: Record<string, string> = {
  announcement: "red",
  discussion: "blue",
  readonly: "default",
  subscription: "purple",
};
function channelTypeLabel(type?: string): string {
  if (!type) {
    return "—";
  }
  return CHANNEL_TYPE_LABELS[type] || type;
}
function channelTypeColor(type?: string): string {
  if (!type) {
    return "default";
  }
  return CHANNEL_TYPE_COLORS[type] || "default";
}

function shortDid(did?: string): string {
  if (!did) {
    return "—";
  }
  if (did.length <= 24) {
    return did;
  }
  return `${did.slice(0, 16)}…${did.slice(-6)}`;
}

function formatTime(value: unknown): string {
  if (value === undefined || value === null) {
    return "—";
  }
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleString("zh-CN");
}

async function onPromote(member: CommunityMember, role: string): Promise<void> {
  if (!store.viewingCommunityId) {
    return;
  }
  if (role !== "admin" && role !== "moderator") {
    return;
  }
  const ok = await store.promoteMember(
    store.viewingCommunityId,
    member.member_did,
    role,
  );
  if (ok) {
    antMessage.success(`已将 ${displayName(member)} 提升为${roleLabel(role)}`);
  }
}

function onDemote(member: CommunityMember): void {
  if (!store.viewingCommunityId) {
    return;
  }
  Modal.confirm({
    title: "降级成员",
    content: `确定将 ${displayName(member)} 从${roleLabel(member.role)}降级为成员？`,
    okText: "降级",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const ok = await store.demoteMember(
        store.viewingCommunityId!,
        member.member_did,
      );
      if (ok) {
        antMessage.success(`已降级 ${displayName(member)}`);
      }
    },
  });
}

function onBan(member: CommunityMember): void {
  if (!store.viewingCommunityId) {
    return;
  }
  Modal.confirm({
    title: "封禁成员",
    content: `确定封禁 ${displayName(member)}？被封禁的成员将无法再访问该社区，且不可撤销。`,
    okText: "封禁",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const ok = await store.banMember(
        store.viewingCommunityId!,
        member.member_did,
      );
      if (ok) {
        antMessage.success(`已封禁 ${displayName(member)}`);
      }
    },
  });
}

function displayName(member: CommunityMember): string {
  return (
    (member.contact_nickname as string) ||
    (member.nickname as string) ||
    shortDid(member.member_did)
  );
}

// ---- Phase 5: channel selection + composer + create/delete --------------

async function onSelectChannel(channel: CommunityChannel): Promise<void> {
  await store.selectChannel(channel.id);
}

async function onSend(): Promise<void> {
  const ok = await store.sendMessage(composerText.value);
  if (ok) {
    composerText.value = "";
  }
}

function onComposerKeyDown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!store.sendingMessage && composerText.value.trim()) {
      onSend();
    }
  }
}

function onConfirmDeleteChannel(channel: CommunityChannel): void {
  if (!store.viewingCommunityId) {
    return;
  }
  Modal.confirm({
    title: "删除频道",
    content: `确定删除频道「${channel.name}」？此操作不可撤销，频道内所有消息会一同清除。`,
    okText: "删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const ok = await store.deleteChannel(
        channel.id,
        store.viewingCommunityId!,
      );
      if (ok) {
        antMessage.success(`已删除频道 ${channel.name}`);
      }
    },
  });
}

function onOpenCreateChannel(): void {
  channelForm.name = "";
  channelForm.description = "";
  channelForm.type = "discussion";
  store.clearChannelError();
  createChannelOpen.value = true;
}

async function onCreateChannel(): Promise<void> {
  if (!store.viewingCommunityId) {
    return;
  }
  const result = await store.createChannel({
    communityId: store.viewingCommunityId,
    name: channelForm.name,
    description: channelForm.description,
    type: channelForm.type,
  });
  if (result) {
    antMessage.success(`频道「${result.name}」已创建`);
    createChannelOpen.value = false;
  }
}

function onCancelCreateChannel(): void {
  if (!store.creatingChannel) {
    createChannelOpen.value = false;
  }
}
</script>

<style scoped>
.details-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.details-error {
  margin-top: 8px;
}

.details-tabs {
  margin-top: 4px;
}

.muted {
  color: var(--cc-shell-muted, #999);
  font-size: 12px;
}

.rules-block {
  background: var(--cc-shell-sider-bg, #fafafa);
  border: 1px solid var(--cc-shell-border, #e8e8e8);
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  margin: 0;
  max-height: 240px;
  overflow: auto;
}

.member-identity {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.member-nickname {
  font-weight: 500;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.member-did {
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-size: 11px;
  color: var(--cc-shell-muted, #999);
}

.channel-name {
  font-weight: 500;
  margin-right: 8px;
}

.channel-time {
  margin-left: 6px;
}

.hint {
  margin-top: 8px;
}

/* Phase 5: channel page-replace + message stream + composer */

.channels-list-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.channels-list-header {
  display: flex;
  justify-content: flex-end;
}

.channel-name {
  font-weight: 500;
  margin-right: 8px;
  cursor: pointer;
}

.channel-message-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.channel-message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--cc-shell-border, #eee);
}

.channel-active-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--cc-shell-text, #1f1f1f);
  margin-left: 4px;
}

.channel-error {
  margin: 0;
}

.message-stream {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
  padding: 8px 4px 12px;
}

.message-empty {
  text-align: center;
  padding: 24px 0;
}

.message-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 6px;
}

.message-pinned {
  border-left: 3px solid #faad14;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.message-sender {
  font-weight: 500;
  font-size: 12px;
  color: var(--cc-shell-text, #1f1f1f);
}

.message-time {
  font-size: 11px;
}

.message-actions {
  margin-left: auto;
}

.message-content {
  font-size: 13px;
  line-height: 1.5;
  color: var(--cc-shell-text, #1f1f1f);
  white-space: pre-wrap;
  word-break: break-word;
}

.message-system {
  font-style: italic;
  color: var(--cc-shell-muted, #595959);
}

.message-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--cc-shell-border, #eee);
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.message-readonly-hint {
  text-align: center;
  padding: 12px 0;
  border-top: 1px solid var(--cc-shell-border, #eee);
}
</style>
