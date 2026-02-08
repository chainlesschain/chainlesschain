<template>
  <div class="friends-page">
    <a-card :bordered="false" class="friends-card">
      <!-- 头部操作栏 -->
      <template #title>
        <div class="page-header">
          <div class="header-left">
            <TeamOutlined class="header-icon" />
            <span class="header-title">好友列表</span>
            <a-badge
              :count="onlineFriendsCount"
              :number-style="{ backgroundColor: '#52c41a' }"
            />
          </div>
          <div class="header-right">
            <a-input-search
              v-model:value="searchKeyword"
              placeholder="搜索好友..."
              style="width: 200px; margin-right: 12px"
              @search="handleSearch"
            />
            <a-button type="primary" @click="showAddFriendModal = true">
              <template #icon>
                <UserAddOutlined />
              </template>
              添加好友
            </a-button>
          </div>
        </div>
      </template>

      <!-- 好友分组标签 -->
      <a-tabs v-model:active-key="activeGroup" @change="handleGroupChange">
        <a-tab-pane key="all" tab="全部好友">
          <template #tab>
            <span>
              全部好友
              <a-badge
                :count="allFriends.length"
                :number-style="{ backgroundColor: '#1890ff', fontSize: '10px' }"
              />
            </span>
          </template>
        </a-tab-pane>
        <a-tab-pane key="online" tab="在线好友">
          <template #tab>
            <span>
              在线好友
              <a-badge
                :count="onlineFriendsCount"
                :number-style="{ backgroundColor: '#52c41a', fontSize: '10px' }"
              />
            </span>
          </template>
        </a-tab-pane>
        <a-tab-pane v-for="group in friendGroups" :key="group" :tab="group">
          <template #tab>
            <span>
              {{ group }}
              <a-badge
                :count="getFriendsByGroup(group).length"
                :number-style="{ backgroundColor: '#8c8c8c', fontSize: '10px' }"
              />
            </span>
          </template>
        </a-tab-pane>
      </a-tabs>

      <!-- 好友列表 -->
      <a-spin :spinning="loading">
        <a-list
          :data-source="filteredFriends"
          :locale="{ emptyText: '暂无好友' }"
          class="friends-list"
        >
          <template #renderItem="{ item }">
            <a-list-item class="friend-item" @click="handleFriendClick(item)">
              <a-list-item-meta>
                <template #avatar>
                  <a-badge
                    :dot="item.onlineStatus?.status === 'online'"
                    :offset="[-5, 35]"
                  >
                    <a-avatar :size="48" :src="item.avatar">
                      {{ item.nickname?.charAt(0) || "U" }}
                    </a-avatar>
                  </a-badge>
                </template>
                <template #title>
                  <div class="friend-title">
                    <span class="friend-nickname">{{
                      item.nickname || item.friend_did
                    }}</span>
                    <OnlineStatusIndicator
                      :status="item.onlineStatus?.status || 'offline'"
                      :last-seen="item.onlineStatus?.lastSeen || 0"
                      :device-count="item.onlineStatus?.deviceCount || 0"
                      :show-device-count="item.onlineStatus?.deviceCount > 1"
                      size="small"
                    />
                  </div>
                </template>
                <template #description>
                  <div class="friend-description">
                    <div class="friend-did">
                      DID: {{ formatDID(item.friend_did) }}
                    </div>
                    <div v-if="item.notes" class="friend-notes">
                      {{ item.notes }}
                    </div>
                  </div>
                </template>
              </a-list-item-meta>

              <!-- 操作按钮 -->
              <template #actions>
                <a-tooltip title="发送消息">
                  <a-button type="text" @click.stop="handleSendMessage(item)">
                    <template #icon>
                      <MessageOutlined />
                    </template>
                  </a-button>
                </a-tooltip>
                <a-tooltip title="语音通话">
                  <a-button type="text" @click.stop="handleVoiceCall(item)">
                    <template #icon>
                      <PhoneOutlined />
                    </template>
                  </a-button>
                </a-tooltip>
                <a-tooltip title="视频通话">
                  <a-button type="text" @click.stop="handleVideoCall(item)">
                    <template #icon>
                      <VideoCameraOutlined />
                    </template>
                  </a-button>
                </a-tooltip>
                <a-dropdown>
                  <a-button type="text">
                    <template #icon>
                      <EllipsisOutlined />
                    </template>
                  </a-button>
                  <template #overlay>
                    <a-menu @click="({ key }) => handleMenuAction(key, item)">
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
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-spin>
    </a-card>

    <!-- 添加好友对话框 -->
    <a-modal
      v-model:open="showAddFriendModal"
      title="添加好友"
      @ok="handleAddFriend"
      @cancel="showAddFriendModal = false"
    >
      <a-form :model="addFriendForm" layout="vertical">
        <a-form-item label="好友DID" required>
          <a-input
            v-model:value="addFriendForm.did"
            placeholder="输入好友的DID地址"
          />
        </a-form-item>
        <a-form-item label="验证消息">
          <a-textarea
            v-model:value="addFriendForm.message"
            placeholder="请输入验证消息（可选）"
            :rows="3"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 编辑备注对话框 -->
    <a-modal
      v-model:open="showEditModal"
      title="编辑好友信息"
      @ok="handleSaveEdit"
      @cancel="showEditModal = false"
    >
      <a-form :model="editForm" layout="vertical">
        <a-form-item label="备注名称">
          <a-input
            v-model:value="editForm.nickname"
            placeholder="输入备注名称"
          />
        </a-form-item>
        <a-form-item label="分组">
          <a-select v-model:value="editForm.groupName" placeholder="选择分组">
            <a-select-option
              v-for="group in friendGroups"
              :key="group"
              :value="group"
            >
              {{ group }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea
            v-model:value="editForm.notes"
            placeholder="输入备注信息"
            :rows="3"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 移动分组对话框 -->
    <a-modal
      v-model:open="showMoveGroupModal"
      title="移动到分组"
      @ok="handleSaveMoveGroup"
      @cancel="showMoveGroupModal = false"
    >
      <p style="margin-bottom: 16px">
        将 <strong>{{ moveGroupForm.friendName }}</strong> 移动到：
      </p>
      <a-form layout="vertical">
        <a-form-item label="选择现有分组">
          <a-select
            v-model:value="moveGroupForm.targetGroup"
            placeholder="选择分组"
            style="width: 100%"
          >
            <a-select-option
              v-for="group in friendGroups"
              :key="group"
              :value="group"
            >
              {{ group }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-divider>或</a-divider>
        <a-form-item label="创建新分组">
          <a-input
            v-model:value="moveGroupForm.newGroupName"
            placeholder="输入新分组名称"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 删除确认对话框 -->
    <a-modal
      v-model:open="showDeleteConfirm"
      title="删除好友"
      ok-text="确认删除"
      cancel-text="取消"
      ok-type="danger"
      @ok="confirmDeleteFriend"
      @cancel="cancelDeleteFriend"
    >
      <p>
        确定要删除好友
        <strong>{{
          deletingFriend?.nickname || deletingFriend?.friend_did
        }}</strong>
        吗？
      </p>
      <p style="color: #ff4d4f">删除后将无法恢复聊天记录。</p>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import {
  TeamOutlined,
  UserAddOutlined,
  MessageOutlined,
  PhoneOutlined,
  VideoCameraOutlined,
  EllipsisOutlined,
  EditOutlined,
  FolderOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import OnlineStatusIndicator from "@/components/OnlineStatusIndicator.vue";

const { ipcRenderer } = window.electron || {};

// 状态
const loading = ref(false);
const allFriends = ref([]);
const activeGroup = ref("all");
const searchKeyword = ref("");
const showAddFriendModal = ref(false);
const showEditModal = ref(false);

// 表单
const addFriendForm = ref({
  did: "",
  message: "",
});

const editForm = ref({
  friendDid: "",
  nickname: "",
  groupName: "我的好友",
  notes: "",
});

// 移动分组相关
const showMoveGroupModal = ref(false);
const moveGroupForm = ref({
  friendDid: "",
  friendName: "",
  targetGroup: "",
  newGroupName: "",
});

// 删除好友相关
const showDeleteConfirm = ref(false);
const deletingFriend = ref(null);

// 计算属性
const friendGroups = computed(() => {
  const groups = new Set();
  allFriends.value.forEach((friend) => {
    if (friend.group_name) {
      groups.add(friend.group_name);
    }
  });
  return Array.from(groups);
});

const onlineFriendsCount = computed(() => {
  return allFriends.value.filter((f) => f.onlineStatus?.status === "online")
    .length;
});

const filteredFriends = computed(() => {
  let friends = allFriends.value;

  // 按分组过滤
  if (activeGroup.value === "online") {
    friends = friends.filter((f) => f.onlineStatus?.status === "online");
  } else if (activeGroup.value !== "all") {
    friends = friends.filter((f) => f.group_name === activeGroup.value);
  }

  // 按关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    friends = friends.filter(
      (f) =>
        f.nickname?.toLowerCase().includes(keyword) ||
        f.friend_did?.toLowerCase().includes(keyword) ||
        f.notes?.toLowerCase().includes(keyword),
    );
  }

  return friends;
});

// 方法
async function loadFriends() {
  loading.value = true;
  try {
    const result = await ipcRenderer.invoke("friend:get-list");
    if (result.success) {
      allFriends.value = result.friends || [];
    } else {
      message.error("加载好友列表失败: " + result.error);
    }
  } catch (error) {
    logger.error("加载好友列表失败:", error);
    message.error("加载好友列表失败: " + error.message);
  } finally {
    loading.value = false;
  }
}

function handleGroupChange(key) {
  activeGroup.value = key;
}

function handleSearch() {
  // 搜索逻辑已在 computed 中实现
}

function getFriendsByGroup(groupName) {
  return allFriends.value.filter((f) => f.group_name === groupName);
}

function formatDID(did) {
  if (!did) {
    return "";
  }
  if (did.length <= 20) {
    return did;
  }
  return `${did.slice(0, 10)}...${did.slice(-10)}`;
}

function handleFriendClick(friend) {
  // 点击好友，打开聊天窗口
  handleSendMessage(friend);
}

async function handleAddFriend() {
  if (!addFriendForm.value.did) {
    message.warning("请输入好友DID");
    return;
  }

  try {
    const result = await ipcRenderer.invoke("friend:send-request", {
      targetDid: addFriendForm.value.did,
      message: addFriendForm.value.message,
    });

    if (result.success) {
      message.success("好友请求已发送");
      showAddFriendModal.value = false;
      addFriendForm.value = { did: "", message: "" };
    } else {
      message.error("发送好友请求失败: " + result.error);
    }
  } catch (error) {
    logger.error("发送好友请求失败:", error);
    message.error("发送好友请求失败: " + error.message);
  }
}

function handleSendMessage(friend) {
  // 跳转到 P2P 聊天页面
  window.location.hash = `#/p2p/chat/${friend.friend_did}`;
}

function handleVoiceCall(friend) {
  message.info("语音通话功能开发中...");
}

function handleVideoCall(friend) {
  message.info("视频通话功能开发中...");
}

function handleMenuAction(action, friend) {
  switch (action) {
    case "edit":
      editForm.value = {
        friendDid: friend.friend_did,
        nickname: friend.nickname || "",
        groupName: friend.group_name || "我的好友",
        notes: friend.notes || "",
      };
      showEditModal.value = true;
      break;
    case "move":
      // 打开移动分组对话框
      moveGroupForm.value = {
        friendDid: friend.friend_did,
        friendName: friend.nickname || friend.friend_did,
        targetGroup: friend.group_name || "我的好友",
        newGroupName: "",
      };
      showMoveGroupModal.value = true;
      break;
    case "delete":
      handleDeleteFriend(friend);
      break;
  }
}

async function handleSaveEdit() {
  try {
    const result = await ipcRenderer.invoke("friend:update", {
      friendDid: editForm.value.friendDid,
      nickname: editForm.value.nickname,
      groupName: editForm.value.groupName,
      notes: editForm.value.notes,
    });

    if (result.success) {
      message.success("好友信息已更新");
      showEditModal.value = false;
      await loadFriends();
    } else {
      message.error("更新好友信息失败: " + result.error);
    }
  } catch (error) {
    logger.error("更新好友信息失败:", error);
    message.error("更新好友信息失败: " + error.message);
  }
}

async function handleDeleteFriend(friend) {
  // 显示删除确认对话框
  deletingFriend.value = friend;
  showDeleteConfirm.value = true;
}

// 确认删除好友
async function confirmDeleteFriend() {
  if (!deletingFriend.value) {
    return;
  }

  try {
    const result = await ipcRenderer.invoke("friend:remove", {
      friendDid: deletingFriend.value.friend_did,
    });

    if (result.success) {
      message.success("好友已删除");
      showDeleteConfirm.value = false;
      deletingFriend.value = null;
      await loadFriends();
    } else {
      message.error("删除好友失败: " + result.error);
    }
  } catch (error) {
    logger.error("删除好友失败:", error);
    message.error("删除好友失败: " + error.message);
  }
}

// 取消删除
function cancelDeleteFriend() {
  showDeleteConfirm.value = false;
  deletingFriend.value = null;
}

// 保存移动分组
async function handleSaveMoveGroup() {
  const targetGroup =
    moveGroupForm.value.newGroupName.trim() || moveGroupForm.value.targetGroup;

  if (!targetGroup) {
    message.warning("请选择或输入分组名称");
    return;
  }

  try {
    const result = await ipcRenderer.invoke("friend:update", {
      friendDid: moveGroupForm.value.friendDid,
      groupName: targetGroup,
    });

    if (result.success) {
      message.success("已移动到分组: " + targetGroup);
      showMoveGroupModal.value = false;
      moveGroupForm.value = {
        friendDid: "",
        friendName: "",
        targetGroup: "",
        newGroupName: "",
      };
      await loadFriends();
    } else {
      message.error("移动分组失败: " + result.error);
    }
  } catch (error) {
    logger.error("移动分组失败:", error);
    message.error("移动分组失败: " + error.message);
  }
}

// 监听在线状态变化事件
function handleFriendOnline(event, data) {
  const { friendDid } = data;
  const friend = allFriends.value.find((f) => f.friend_did === friendDid);
  if (friend) {
    friend.onlineStatus = {
      status: "online",
      lastSeen: Date.now(),
      deviceCount: friend.onlineStatus?.deviceCount || 1,
    };
  }
}

function handleFriendOffline(event, data) {
  const { friendDid } = data;
  const friend = allFriends.value.find((f) => f.friend_did === friendDid);
  if (friend) {
    friend.onlineStatus = {
      status: "offline",
      lastSeen: Date.now(),
      deviceCount: 0,
    };
  }
}

// 生命周期
onMounted(async () => {
  await loadFriends();

  // 监听好友在线状态变化
  ipcRenderer.on("friend:online", handleFriendOnline);
  ipcRenderer.on("friend:offline", handleFriendOffline);
});

onUnmounted(() => {
  // 移除事件监听
  ipcRenderer.removeListener("friend:online", handleFriendOnline);
  ipcRenderer.removeListener("friend:offline", handleFriendOffline);
});
</script>

<style scoped>
.friends-page {
  padding: 24px;
  height: 100%;
  overflow: auto;
}

.friends-card {
  height: 100%;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  font-size: 20px;
  color: #1890ff;
}

.header-title {
  font-size: 18px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
}

.friends-list {
  margin-top: 16px;
}

.friend-item {
  cursor: pointer;
  transition: background-color 0.2s;
  padding: 12px;
  border-radius: 8px;
}

.friend-item:hover {
  background-color: #f5f5f5;
}

.friend-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.friend-nickname {
  font-size: 16px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.85);
}

.friend-description {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.friend-did {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  font-family: monospace;
}

.friend-notes {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}
</style>
