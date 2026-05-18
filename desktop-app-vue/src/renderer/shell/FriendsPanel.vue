<template>
  <a-modal
    :open="open"
    :width="680"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="好友"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <TeamOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      P2P 好友列表。好友通过 DID 互加，消息走 Signal 协议端到端加密。 点击行末 ⋯
      编辑备注 / 移动分组 / 删除好友。
    </p>

    <div class="friends-toolbar">
      <a-input
        v-model:value="searchKeyword"
        placeholder="搜索昵称 / DID / 备注"
        size="small"
        allow-clear
        class="friends-search"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
      <a-tag v-if="hasLoaded" color="green">
        {{ onlineCount }} 在线 / {{ store.friends.length }}
      </a-tag>
      <a-button size="small" type="primary" @click="openAddModal">
        <UserAddOutlined />
        添加好友
      </a-button>
      <a-button
        size="small"
        type="link"
        :loading="store.friendsLoading"
        @click="refresh"
      >
        刷新
      </a-button>
    </div>

    <a-collapse
      v-if="pendingRequests.length"
      v-model:active-key="pendingExpanded"
      class="pending-collapse"
      :bordered="false"
    >
      <a-collapse-panel key="pending" class="pending-panel">
        <template #header>
          <span class="pending-header">
            <BellOutlined />
            待处理好友请求
            <a-tag color="orange">{{ pendingRequests.length }}</a-tag>
          </span>
        </template>
        <ul class="pending-list">
          <li v-for="req in pendingRequests" :key="req.id" class="pending-row">
            <div class="pending-meta">
              <div class="pending-line-1">
                <UserAddOutlined class="pending-icon" />
                <span class="pending-from">
                  {{ formatDID(req.from_did) }}
                </span>
                <span class="pending-time">
                  {{ formatRequestTime(req.created_at) }}
                </span>
              </div>
              <div v-if="req.message" class="pending-message">
                "{{ req.message }}"
              </div>
            </div>
            <div class="pending-actions">
              <a-button
                size="small"
                type="primary"
                :loading="actingRequestId === req.id && actingMode === 'accept'"
                :disabled="
                  actingRequestId === req.id && actingMode !== 'accept'
                "
                @click="accept(req.id)"
              >
                接受
              </a-button>
              <a-button
                size="small"
                danger
                :loading="actingRequestId === req.id && actingMode === 'reject'"
                :disabled="
                  actingRequestId === req.id && actingMode !== 'reject'
                "
                @click="reject(req.id)"
              >
                拒绝
              </a-button>
            </div>
          </li>
        </ul>
      </a-collapse-panel>
    </a-collapse>

    <a-tabs v-model:active-key="activeGroup" class="friends-tabs" size="small">
      <a-tab-pane key="all">
        <template #tab>
          <span
            >全部 <a-tag color="blue">{{ store.friends.length }}</a-tag></span
          >
        </template>
      </a-tab-pane>
      <a-tab-pane key="online">
        <template #tab>
          <span
            >在线 <a-tag color="green">{{ onlineCount }}</a-tag></span
          >
        </template>
      </a-tab-pane>
      <a-tab-pane v-for="group in groups" :key="group">
        <template #tab>
          <span>
            {{ group }}
            <a-tag color="default">{{ groupCount(group) }}</a-tag>
          </span>
        </template>
      </a-tab-pane>
    </a-tabs>

    <a-spin :spinning="store.friendsLoading && !hasLoaded">
      <ul v-if="visibleFriends.length" class="friend-list">
        <li
          v-for="friend in visibleFriends"
          :key="friend.friend_did"
          class="friend-row"
        >
          <a-badge
            :status="badgeStatus(friend)"
            :offset="[-4, 32]"
            class="friend-avatar-wrap"
          >
            <a-avatar :size="40" :src="friend.avatar">
              {{ avatarLetter(friend) }}
            </a-avatar>
          </a-badge>
          <div class="friend-meta">
            <div class="friend-line-1">
              <span class="friend-nickname">
                {{ friend.nickname || formatDID(friend.friend_did) }}
              </span>
              <a-tag :color="statusColor(friend)" class="friend-status-tag">
                {{ statusLabel(friend) }}
              </a-tag>
              <a-tag v-if="friend.group_name" color="default">
                {{ friend.group_name }}
              </a-tag>
            </div>
            <div class="friend-line-2">
              <span class="friend-did">{{ formatDID(friend.friend_did) }}</span>
              <span v-if="friend.notes" class="friend-notes">
                · {{ friend.notes }}
              </span>
            </div>
          </div>
          <div class="friend-actions">
            <a-dropdown
              :trigger="['click']"
              placement="bottomRight"
              :disabled="
                deletingDid === friend.friend_did ||
                updatingDid === friend.friend_did
              "
            >
              <a-button
                type="text"
                size="small"
                :loading="
                  deletingDid === friend.friend_did ||
                  updatingDid === friend.friend_did
                "
              >
                <EllipsisOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="({ key }) => onRowAction(key, friend)">
                  <a-menu-item key="edit">
                    <EditOutlined />
                    编辑备注
                  </a-menu-item>
                  <a-menu-item key="move">
                    <FolderOutlined />
                    移动分组
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="delete" danger>
                    <DeleteOutlined />
                    删除好友
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </li>
      </ul>
      <a-empty
        v-else-if="hasLoaded"
        :description="emptyText"
        class="friends-empty"
      />
    </a-spin>

    <a-modal
      v-model:open="addModalOpen"
      title="添加好友"
      :ok-text="adding ? '发送中...' : '发送请求'"
      cancel-text="取消"
      :ok-button-props="{ loading: adding, disabled: !addFormValid }"
      :mask-closable="!adding"
      :closable="!adding"
      @ok="submitAdd"
      @cancel="cancelAdd"
    >
      <a-form layout="vertical">
        <a-form-item
          label="好友 DID"
          required
          :validate-status="
            addDIDValidation.ok ? '' : addDidTouched ? 'error' : ''
          "
          :help="addDidTouched ? addDIDValidation.error : ''"
        >
          <a-input
            v-model:value="addForm.did"
            placeholder="did:cc:... 或对方 DID 短码"
            allow-clear
            @blur="addDidTouched = true"
          />
        </a-form-item>
        <a-form-item label="验证消息（可选）">
          <a-textarea
            v-model:value="addForm.message"
            placeholder="自我介绍 / 备注（对方会看到）"
            :rows="3"
            :maxlength="200"
            show-count
          />
        </a-form-item>
        <a-alert
          v-if="addError"
          type="error"
          :message="addError"
          show-icon
          class="add-error"
        />
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="editModalOpen"
      title="编辑好友信息"
      :ok-text="editing ? '保存中...' : '保存'"
      cancel-text="取消"
      :ok-button-props="{ loading: editing }"
      :mask-closable="!editing"
      :closable="!editing"
      @ok="submitEdit"
      @cancel="cancelEdit"
    >
      <a-form layout="vertical">
        <a-form-item label="好友 DID">
          <a-input
            :value="formatDID(editForm.friendDid)"
            disabled
            class="edit-did-display"
          />
        </a-form-item>
        <a-form-item label="备注名称（昵称）">
          <a-input
            v-model:value="editForm.nickname"
            placeholder="给好友起个备注名"
            :maxlength="50"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="备注（仅自己可见）">
          <a-textarea
            v-model:value="editForm.notes"
            placeholder="例如：同事 / 大学室友 / 客户 ..."
            :rows="3"
            :maxlength="200"
            show-count
          />
        </a-form-item>
        <a-alert v-if="editError" type="error" :message="editError" show-icon />
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="moveModalOpen"
      title="移动到分组"
      :ok-text="moving ? '保存中...' : '移动'"
      cancel-text="取消"
      :ok-button-props="{ loading: moving, disabled: !moveTargetGroup }"
      :mask-closable="!moving"
      :closable="!moving"
      @ok="submitMove"
      @cancel="cancelMove"
    >
      <p class="move-friend-tip">
        将
        <strong>{{ moveForm.friendName }}</strong>
        移动到：
      </p>
      <a-form layout="vertical">
        <a-form-item label="选择现有分组">
          <a-select
            v-model:value="moveForm.targetGroup"
            placeholder="选择分组"
            allow-clear
            :options="groups.map((g) => ({ value: g, label: g }))"
          />
        </a-form-item>
        <a-divider class="move-divider"> 或 </a-divider>
        <a-form-item label="创建新分组">
          <a-input
            v-model:value="moveForm.newGroupName"
            placeholder="输入新分组名称"
            :maxlength="20"
            allow-clear
          />
        </a-form-item>
        <a-alert v-if="moveError" type="error" :message="moveError" show-icon />
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Modal, message } from "ant-design-vue";
import {
  BellOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FolderOutlined,
  SearchOutlined,
  TeamOutlined,
  UserAddOutlined,
} from "@ant-design/icons-vue";
import { useSocialStore } from "../stores/social";
import {
  countOnlineFriends,
  filterFriendsByGroup,
  formatDID,
  formatRequestTime,
  friendStatusColor,
  friendStatusLabel,
  getFriendGroups,
  matchFriendKeyword,
  resolveFriendStatus,
  validateDID,
  type FriendLike,
} from "./helpers/friendsHelpers";

const props = defineProps<{
  open: boolean;
  prefillText?: string;
}>();

defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const store = useSocialStore();
const activeGroup = ref<string>("all");
const searchKeyword = ref<string>("");
const hasLoaded = ref(false);

const groups = computed(() => getFriendGroups(store.friends as FriendLike[]));

const onlineCount = computed(() =>
  countOnlineFriends(store.friends as FriendLike[], store.onlineStatus),
);

function groupCount(group: string): number {
  return (store.friends as FriendLike[]).filter((f) => f.group_name === group)
    .length;
}

const visibleFriends = computed<FriendLike[]>(() => {
  const filtered = filterFriendsByGroup(
    store.friends as FriendLike[],
    activeGroup.value,
    store.onlineStatus,
  );
  return matchFriendKeyword(filtered, searchKeyword.value);
});

const emptyText = computed(() => {
  if (searchKeyword.value.trim()) {
    return "没有匹配的好友";
  }
  if (activeGroup.value === "online") {
    return "暂无在线好友";
  }
  if (activeGroup.value !== "all") {
    return `分组「${activeGroup.value}」暂无好友`;
  }
  return "暂无好友，点击「添加好友」开始";
});

// ============= Phase 3: pending requests + add-friend modal =============

interface PendingRequestRow {
  id: string;
  from_did: string;
  message?: string;
  status: string;
  created_at?: number;
  [key: string]: unknown;
}

const pendingRequests = computed<PendingRequestRow[]>(() =>
  (store.friendRequests as PendingRequestRow[]).filter(
    (r) => r.status === "pending",
  ),
);

const pendingExpanded = ref<string[]>(["pending"]);
const actingRequestId = ref<string | null>(null);
const actingMode = ref<"accept" | "reject" | null>(null);

async function accept(requestId: string): Promise<void> {
  actingRequestId.value = requestId;
  actingMode.value = "accept";
  try {
    await store.acceptFriendRequest(requestId);
    message.success("已接受好友请求");
  } catch (err: unknown) {
    message.error(
      `接受失败：${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    actingRequestId.value = null;
    actingMode.value = null;
  }
}

async function reject(requestId: string): Promise<void> {
  actingRequestId.value = requestId;
  actingMode.value = "reject";
  try {
    await store.rejectFriendRequest(requestId);
    message.success("已拒绝好友请求");
  } catch (err: unknown) {
    message.error(
      `拒绝失败：${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    actingRequestId.value = null;
    actingMode.value = null;
  }
}

const addModalOpen = ref(false);
const adding = ref(false);
const addError = ref<string | null>(null);
const addDidTouched = ref(false);
const addForm = reactive<{ did: string; message: string }>({
  did: "",
  message: "",
});

const addDIDValidation = computed(() => validateDID(addForm.did));
const addFormValid = computed(() => addDIDValidation.value.ok);

function openAddModal(): void {
  addForm.did = "";
  addForm.message = "";
  addError.value = null;
  addDidTouched.value = false;
  addModalOpen.value = true;
}

function cancelAdd(): void {
  if (adding.value) {
    return;
  }
  addModalOpen.value = false;
}

async function submitAdd(): Promise<void> {
  addDidTouched.value = true;
  const v = addDIDValidation.value;
  if (!v.ok) {
    addError.value = v.error ?? "DID 校验失败";
    return;
  }
  adding.value = true;
  addError.value = null;
  try {
    await store.sendFriendRequest(addForm.did.trim(), addForm.message.trim());
    message.success("好友请求已发送");
    addModalOpen.value = false;
    // requests list won't update locally (other side has to accept) — but
    // refresh anyway in case the IPC handler also seeded a self-side row
    await store.loadFriendRequests();
  } catch (err: unknown) {
    addError.value = err instanceof Error ? err.message : String(err);
  } finally {
    adding.value = false;
  }
}

// ============= Phase 4: row dropdown — edit / move group / delete =============

const deletingDid = ref<string | null>(null);
const updatingDid = ref<string | null>(null);

const editModalOpen = ref(false);
const editing = ref(false);
const editError = ref<string | null>(null);
const editForm = reactive<{
  friendDid: string;
  nickname: string;
  notes: string;
}>({
  friendDid: "",
  nickname: "",
  notes: "",
});

const moveModalOpen = ref(false);
const moving = ref(false);
const moveError = ref<string | null>(null);
const moveForm = reactive<{
  friendDid: string;
  friendName: string;
  currentGroup: string;
  targetGroup: string;
  newGroupName: string;
}>({
  friendDid: "",
  friendName: "",
  currentGroup: "",
  targetGroup: "",
  newGroupName: "",
});

const moveTargetGroup = computed(() => {
  const fresh = moveForm.newGroupName.trim();
  if (fresh) {
    return fresh;
  }
  return moveForm.targetGroup || "";
});

function onRowAction(key: unknown, friend: FriendLike): void {
  const k = String(key);
  if (k === "edit") {
    openEdit(friend);
  } else if (k === "move") {
    openMove(friend);
  } else if (k === "delete") {
    confirmDelete(friend);
  }
}

function openEdit(friend: FriendLike): void {
  editForm.friendDid = friend.friend_did;
  editForm.nickname = friend.nickname ?? "";
  editForm.notes = (
    typeof friend.notes === "string" ? friend.notes : ""
  ) as string;
  editError.value = null;
  editModalOpen.value = true;
}

function cancelEdit(): void {
  if (editing.value) {
    return;
  }
  editModalOpen.value = false;
}

async function submitEdit(): Promise<void> {
  if (!editForm.friendDid) {
    return;
  }
  editing.value = true;
  editError.value = null;
  updatingDid.value = editForm.friendDid;
  try {
    await store.updateFriendInfo(editForm.friendDid, {
      nickname: editForm.nickname.trim(),
      notes: editForm.notes.trim(),
    });
    message.success("已更新好友信息");
    editModalOpen.value = false;
  } catch (err: unknown) {
    editError.value = err instanceof Error ? err.message : String(err);
  } finally {
    editing.value = false;
    updatingDid.value = null;
  }
}

function openMove(friend: FriendLike): void {
  moveForm.friendDid = friend.friend_did;
  moveForm.friendName = friend.nickname || formatDID(friend.friend_did);
  moveForm.currentGroup = (friend.group_name as string) ?? "";
  moveForm.targetGroup = "";
  moveForm.newGroupName = "";
  moveError.value = null;
  moveModalOpen.value = true;
}

function cancelMove(): void {
  if (moving.value) {
    return;
  }
  moveModalOpen.value = false;
}

async function submitMove(): Promise<void> {
  const target = moveTargetGroup.value;
  if (!target) {
    moveError.value = "请选择或输入分组名称";
    return;
  }
  if (target === moveForm.currentGroup) {
    moveError.value = "已经在该分组";
    return;
  }
  moving.value = true;
  moveError.value = null;
  updatingDid.value = moveForm.friendDid;
  try {
    await store.updateFriendInfo(moveForm.friendDid, { groupName: target });
    message.success(`已移动到分组「${target}」`);
    moveModalOpen.value = false;
  } catch (err: unknown) {
    moveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    moving.value = false;
    updatingDid.value = null;
  }
}

function confirmDelete(friend: FriendLike): void {
  const name = friend.nickname || formatDID(friend.friend_did);
  Modal.confirm({
    title: "删除好友",
    content: `确定要删除好友「${name}」吗？删除后将无法恢复聊天记录。`,
    okText: "确认删除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      deletingDid.value = friend.friend_did;
      try {
        await store.removeFriend(friend.friend_did);
        message.success("好友已删除");
      } catch (err: unknown) {
        message.error(
          `删除失败：${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        deletingDid.value = null;
      }
    },
  });
}

function avatarLetter(friend: FriendLike): string {
  const name = friend.nickname || friend.friend_did || "U";
  return name.charAt(0).toUpperCase();
}

function statusLabel(friend: FriendLike): string {
  return friendStatusLabel(resolveFriendStatus(friend, store.onlineStatus));
}

function statusColor(friend: FriendLike): string {
  return friendStatusColor(resolveFriendStatus(friend, store.onlineStatus));
}

function badgeStatus(friend: FriendLike): "success" | "warning" | "default" {
  const s = resolveFriendStatus(friend, store.onlineStatus);
  if (s === "online") {
    return "success";
  }
  if (s === "away") {
    return "warning";
  }
  return "default";
}

async function refresh(): Promise<void> {
  await Promise.allSettled([store.loadFriends(), store.loadFriendRequests()]);
  hasLoaded.value = true;
}

// Apply prefill arg as initial tab on open
function applyPrefill(): void {
  const a = props.prefillText?.trim();
  if (a === "online" || a === "requests") {
    activeGroup.value = a === "requests" ? "all" : "online";
  } else {
    activeGroup.value = "all";
  }
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

.friends-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.friends-search {
  flex: 1;
  max-width: 280px;
}

.friends-tabs {
  margin-bottom: 8px;
}

.pending-collapse {
  margin-bottom: 12px;
  background: var(--cc-shell-card, #fffaf2);
  border: 1px solid var(--cc-shell-border, #ffe4b8);
  border-radius: 8px;
  overflow: hidden;
}

.pending-panel :deep(.ant-collapse-header) {
  padding-block: 6px;
  font-size: 13px;
}

.pending-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.pending-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pending-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  background: var(--cc-shell-bg, #fff);
  border: 1px solid var(--cc-shell-border, #f0e0c8);
  border-radius: 6px;
}

.pending-meta {
  flex: 1;
  min-width: 0;
}

.pending-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.pending-icon {
  color: var(--cc-shell-accent, #fa8c16);
}

.pending-from {
  font-family: var(--cc-mono, monospace);
}

.pending-time {
  margin-inline-start: auto;
  font-size: 11px;
  color: var(--cc-shell-muted, #8c8c8c);
}

.pending-message {
  margin-top: 4px;
  font-size: 12px;
  color: var(--cc-shell-muted, #595959);
  font-style: italic;
}

.pending-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.add-error {
  margin-top: 12px;
}

.friend-actions {
  flex-shrink: 0;
}

.edit-did-display {
  font-family: var(--cc-mono, monospace);
  background: var(--cc-shell-hover, #f5f5f5) !important;
}

.move-friend-tip {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--cc-shell-text, #1f1f1f);
}

.move-divider {
  margin-block: 12px;
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
}

.friend-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.friend-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
  transition: background 120ms ease;
}

.friend-row:hover {
  background: var(--cc-shell-hover, #fafafa);
}

.friend-avatar-wrap {
  flex: 0 0 auto;
}

.friend-meta {
  flex: 1;
  min-width: 0;
}

.friend-line-1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--cc-shell-text, #1f1f1f);
}

.friend-nickname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.friend-status-tag {
  margin-inline-start: 4px;
}

.friend-line-2 {
  margin-top: 2px;
  font-size: 12px;
  color: var(--cc-shell-muted, #8c8c8c);
  display: flex;
  gap: 4px;
  align-items: center;
}

.friend-did {
  font-family: var(--cc-mono, monospace);
}

.friend-notes {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.friends-empty {
  margin-top: 16px;
}
</style>
