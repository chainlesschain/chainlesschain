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
      P2P 好友列表。好友通过 DID 互加，消息走 Signal 协议端到端加密。
      下方显示已加入的好友（添加 / 编辑 / 删除将在后续阶段接入）。
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
      <a-tag v-if="store.pendingRequestsCount > 0" color="orange">
        {{ store.pendingRequestsCount }} 待处理请求
      </a-tag>
      <a-button
        size="small"
        type="link"
        :loading="store.friendsLoading"
        @click="refresh"
      >
        刷新
      </a-button>
    </div>

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
        </li>
      </ul>
      <a-empty
        v-else-if="hasLoaded"
        :description="emptyText"
        class="friends-empty"
      />
    </a-spin>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SearchOutlined, TeamOutlined } from "@ant-design/icons-vue";
import { useSocialStore } from "../stores/social";
import {
  countOnlineFriends,
  filterFriendsByGroup,
  formatDID,
  friendStatusColor,
  friendStatusLabel,
  getFriendGroups,
  matchFriendKeyword,
  resolveFriendStatus,
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
  return "暂无好友 — 添加好友请使用 V5 路径（Phase 3 即将接入 V6）";
});

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
