<template>
  <div class="group-chat-window">
    <!-- 左侧：群聊列表 -->
    <div class="group-sidebar">
      <div class="group-sidebar-header">
        <h3>群聊</h3>
        <a-button type="primary" size="small" @click="showCreateGroupModal = true">
          <template #icon><PlusOutlined /></template>
          创建群聊
        </a-button>
      </div>

      <a-list
        :data-source="groups"
        :loading="loading"
        class="group-list"
      >
        <template #renderItem="{ item }">
          <a-list-item
            :class="['group-item', { active: currentGroup?.id === item.id }]"
            @click="selectGroup(item)"
          >
            <a-list-item-meta>
              <template #avatar>
                <a-badge :count="item.unread_count || 0">
                  <a-avatar :size="40">
                    <template #icon><TeamOutlined /></template>
                  </a-avatar>
                </a-badge>
              </template>
              <template #title>
                <div class="group-name">{{ item.name }}</div>
              </template>
              <template #description>
                <div class="group-info">
                  <span>{{ item.member_count }} 人</span>
                  <span v-if="item.group_type === 'encrypted'" class="encrypted-badge">
                    <LockOutlined /> 加密
                  </span>
                </div>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </div>

    <!-- 右侧：群聊区域 -->
    <div class="group-main">
      <div v-if="!currentGroup" class="group-empty">
        <a-empty description="选择一个群聊开始对话" />
      </div>

      <div v-else class="group-container">
        <!-- 群聊头部 -->
        <div class="group-header">
          <div class="group-header-info">
            <a-avatar :size="36">
              <template #icon><TeamOutlined /></template>
            </a-avatar>
            <div class="group-header-text">
              <div class="group-header-name">
                {{ currentGroup.name }}
                <LockOutlined v-if="currentGroup.group_type === 'encrypted'" class="encrypted-icon" />
              </div>
              <div class="group-header-members">{{ currentGroup.member_count }} 名成员</div>
            </div>
          </div>

          <div class="group-header-actions">
            <a-tooltip title="群成员">
              <a-button type="text" @click="showMembersDrawer = true">
                <TeamOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="群设置">
              <a-button type="text" @click="showSettingsDrawer = true">
                <SettingOutlined />
              </a-button>
            </a-tooltip>
            <a-dropdown>
              <a-button type="text">
                <MoreOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item key="invite" @click="showInviteModal = true">
                    <UserAddOutlined /> 邀请成员
                  </a-menu-item>
                  <a-menu-item key="leave" danger @click="handleLeaveGroup">
                    <LogoutOutlined /> 退出群聊
                  </a-menu-item>
                  <a-menu-item
                    v-if="isOwner"
                    key="dismiss"
                    danger
                    @click="handleDismissGroup"
                  >
                    <DeleteOutlined /> 解散群聊
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </div>

        <!-- 群消息区域 -->
        <div ref="messagesContainer" class="group-messages" @scroll="handleScroll">
          <!-- 加载更多 -->
          <div v-if="hasMore" class="load-more">
            <a-button type="link" :loading="loadingMore" @click="loadMoreMessages">
              加载更多消息
            </a-button>
          </div>

          <!-- 消息列表 -->
          <div
            v-for="message in messages"
            :key="message.id"
            :class="['message-item', { 'message-self': message.sender_did === currentUserDid }]"
          >
            <div v-if="message.message_type === 'system'" class="system-message">
              {{ message.content }}
            </div>
            <div v-else class="message-bubble">
              <a-avatar :size="32" class="message-avatar">
                <template #icon><UserOutlined /></template>
              </a-avatar>
              <div class="message-content-wrapper">
                <div class="message-sender">{{ message.sender_nickname || shortenDid(message.sender_did) }}</div>
                <div class="message-content">
                  <div v-if="message.message_type === 'text'" class="message-text">
                    {{ message.content }}
                  </div>
                  <div v-else-if="message.message_type === 'image'" class="message-image">
                    <img :src="message.file_path" alt="图片" />
                  </div>
                  <div v-else class="message-file">
                    <FileOutlined /> {{ message.file_path }}
                  </div>
                </div>
                <div class="message-time">{{ formatTime(message.timestamp) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="group-input-area">
          <div class="group-input-toolbar">
            <a-space>
              <a-tooltip title="表情">
                <a-button type="text" size="small">
                  <SmileOutlined />
                </a-button>
              </a-tooltip>
              <a-tooltip title="图片">
                <a-button type="text" size="small" @click="handleSelectImage">
                  <PictureOutlined />
                </a-button>
              </a-tooltip>
              <a-tooltip title="文件">
                <a-button type="text" size="small" @click="handleSelectFile">
                  <FileOutlined />
                </a-button>
              </a-tooltip>
            </a-space>
          </div>

          <a-textarea
            v-model:value="inputMessage"
            :rows="3"
            placeholder="输入消息..."
            :maxlength="5000"
            @keydown.enter.exact="handleSendMessage"
          />

          <div class="group-input-actions">
            <span class="input-hint">按 Enter 发送，Shift+Enter 换行</span>
            <a-button type="primary" :loading="sending" @click="handleSendMessage">
              发送
            </a-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建群聊对话框 -->
    <a-modal
      v-model:visible="showCreateGroupModal"
      title="创建群聊"
      @ok="handleCreateGroup"
      @cancel="showCreateGroupModal = false"
    >
      <a-form :model="createGroupForm" layout="vertical">
        <a-form-item label="群聊名称" required>
          <a-input v-model:value="createGroupForm.name" placeholder="请输入群聊名称" />
        </a-form-item>
        <a-form-item label="群聊描述">
          <a-textarea v-model:value="createGroupForm.description" :rows="3" placeholder="请输入群聊描述" />
        </a-form-item>
        <a-form-item label="选择成员">
          <a-select
            v-model:value="createGroupForm.memberDids"
            mode="multiple"
            placeholder="选择要邀请的好友"
            :options="friendOptions"
          />
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="createGroupForm.encrypted">
            启用端到端加密
          </a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 群成员抽屉 -->
    <a-drawer
      v-model:visible="showMembersDrawer"
      title="群成员"
      placement="right"
      :width="400"
    >
      <a-list :data-source="groupMembers" :loading="loadingMembers">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #avatar>
                <a-avatar>
                  <template #icon><UserOutlined /></template>
                </a-avatar>
              </template>
              <template #title>
                {{ item.nickname || shortenDid(item.member_did) }}
              </template>
              <template #description>
                <a-tag v-if="item.role === 'owner'" color="red">群主</a-tag>
                <a-tag v-else-if="item.role === 'admin'" color="orange">管理员</a-tag>
                <a-tag v-else>成员</a-tag>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-dropdown v-if="canManageMembers && item.role !== 'owner'">
                <a-button type="text" size="small">
                  <MoreOutlined />
                </a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item key="remove" danger @click="handleRemoveMember(item.member_did)">
                      移出群聊
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-drawer>

    <!-- 邀请成员对话框 -->
    <a-modal
      v-model:visible="showInviteModal"
      title="邀请成员"
      @ok="handleInviteMembers"
      @cancel="showInviteModal = false"
    >
      <a-form layout="vertical">
        <a-form-item label="选择好友">
          <a-select
            v-model:value="inviteMemberDids"
            mode="multiple"
            placeholder="选择要邀请的好友"
            :options="friendOptions"
          />
        </a-form-item>
        <a-form-item label="邀请消息">
          <a-textarea v-model:value="inviteMessage" :rows="3" placeholder="输入邀请消息（可选）" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  PlusOutlined,
  TeamOutlined,
  LockOutlined,
  SettingOutlined,
  MoreOutlined,
  UserAddOutlined,
  LogoutOutlined,
  DeleteOutlined,
  UserOutlined,
  SmileOutlined,
  PictureOutlined,
  FileOutlined
} from '@ant-design/icons-vue';

const { ipcRenderer } = window.require('electron');

// 状态
const loading = ref(false);
const groups = ref([]);
const currentGroup = ref(null);
const messages = ref([]);
const inputMessage = ref('');
const sending = ref(false);
const hasMore = ref(false);
const loadingMore = ref(false);
const currentUserDid = ref('');

// 对话框状态
const showCreateGroupModal = ref(false);
const showMembersDrawer = ref(false);
const showSettingsDrawer = ref(false);
const showInviteModal = ref(false);

// 表单数据
const createGroupForm = ref({
  name: '',
  description: '',
  memberDids: [],
  encrypted: true
});

const inviteMemberDids = ref([]);
const inviteMessage = ref('');

// 群成员
const groupMembers = ref([]);
const loadingMembers = ref(false);

// 好友选项
const friendOptions = ref([]);

// 计算属性
const isOwner = computed(() => {
  if (!currentGroup.value) return false;
  const member = groupMembers.value.find(m => m.member_did === currentUserDid.value);
  return member?.role === 'owner';
});

const canManageMembers = computed(() => {
  if (!currentGroup.value) return false;
  const member = groupMembers.value.find(m => m.member_did === currentUserDid.value);
  return member?.role === 'owner' || member?.role === 'admin';
});

// 方法
const loadGroups = async () => {
  loading.value = true;
  try {
    groups.value = await ipcRenderer.invoke('group:get-list');
  } catch (error) {
    console.error('加载群聊列表失败:', error);
    antMessage.error('加载群聊列表失败');
  } finally {
    loading.value = false;
  }
};

const selectGroup = async (group) => {
  currentGroup.value = group;
  await loadGroupMessages(group.id);
  await loadGroupMembers(group.id);
};

const loadGroupMessages = async (groupId, offset = 0) => {
  try {
    const msgs = await ipcRenderer.invoke('group:get-messages', groupId, 50, offset);
    if (offset === 0) {
      messages.value = msgs.reverse();
    } else {
      messages.value = [...msgs.reverse(), ...messages.value];
    }
    hasMore.value = msgs.length === 50;
    await nextTick();
    scrollToBottom();
  } catch (error) {
    console.error('加载群消息失败:', error);
    antMessage.error('加载群消息失败');
  }
};

const loadGroupMembers = async (groupId) => {
  loadingMembers.value = true;
  try {
    const details = await ipcRenderer.invoke('group:get-details', groupId);
    groupMembers.value = details.members || [];
  } catch (error) {
    console.error('加载群成员失败:', error);
  } finally {
    loadingMembers.value = false;
  }
};

const loadMoreMessages = async () => {
  if (!currentGroup.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    await loadGroupMessages(currentGroup.value.id, messages.value.length);
  } finally {
    loadingMore.value = false;
  }
};

const handleSendMessage = async (e) => {
  if (e.shiftKey) return;
  e.preventDefault();

  if (!inputMessage.value.trim() || !currentGroup.value) return;

  sending.value = true;
  try {
    await ipcRenderer.invoke('group:send-message', currentGroup.value.id, inputMessage.value, {
      messageType: 'text'
    });
    inputMessage.value = '';
    await loadGroupMessages(currentGroup.value.id);
  } catch (error) {
    console.error('发送消息失败:', error);
    antMessage.error('发送消息失败');
  } finally {
    sending.value = false;
  }
};

const handleCreateGroup = async () => {
  if (!createGroupForm.value.name.trim()) {
    antMessage.warning('请输入群聊名称');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('group:create', createGroupForm.value);
    if (result.success) {
      antMessage.success('群聊创建成功');
      showCreateGroupModal.value = false;
      createGroupForm.value = {
        name: '',
        description: '',
        memberDids: [],
        encrypted: true
      };
      await loadGroups();
    }
  } catch (error) {
    console.error('创建群聊失败:', error);
    antMessage.error('创建群聊失败');
  }
};

const handleLeaveGroup = async () => {
  if (!currentGroup.value) return;

  try {
    await ipcRenderer.invoke('group:leave', currentGroup.value.id);
    antMessage.success('已退出群聊');
    currentGroup.value = null;
    await loadGroups();
  } catch (error) {
    console.error('退出群聊失败:', error);
    antMessage.error(error.message || '退出群聊失败');
  }
};

const handleDismissGroup = async () => {
  if (!currentGroup.value) return;

  try {
    await ipcRenderer.invoke('group:dismiss', currentGroup.value.id);
    antMessage.success('群聊已解散');
    currentGroup.value = null;
    await loadGroups();
  } catch (error) {
    console.error('解散群聊失败:', error);
    antMessage.error(error.message || '解散群聊失败');
  }
};

const handleInviteMembers = async () => {
  if (!currentGroup.value || inviteMemberDids.value.length === 0) {
    antMessage.warning('请选择要邀请的好友');
    return;
  }

  try {
    for (const did of inviteMemberDids.value) {
      await ipcRenderer.invoke('group:invite-member', currentGroup.value.id, did, inviteMessage.value);
    }
    antMessage.success('邀请已发送');
    showInviteModal.value = false;
    inviteMemberDids.value = [];
    inviteMessage.value = '';
  } catch (error) {
    console.error('邀请成员失败:', error);
    antMessage.error('邀请成员失败');
  }
};

const handleRemoveMember = async (memberDid) => {
  if (!currentGroup.value) return;

  try {
    await ipcRenderer.invoke('group:remove-member', currentGroup.value.id, memberDid);
    antMessage.success('成员已移除');
    await loadGroupMembers(currentGroup.value.id);
  } catch (error) {
    console.error('移除成员失败:', error);
    antMessage.error(error.message || '移除成员失败');
  }
};

const handleSelectImage = () => {
  // TODO: 实现图片选择
  antMessage.info('图片发送功能开发中');
};

const handleSelectFile = () => {
  // TODO: 实现文件选择
  antMessage.info('文件发送功能开发中');
};

const handleScroll = () => {
  // TODO: 实现滚动加载
};

const scrollToBottom = () => {
  const container = messagesContainer.value;
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
};

const shortenDid = (did) => {
  if (!did) return '';
  if (did.length <= 16) return did;
  return `${did.substring(0, 8)}...${did.substring(did.length - 8)}`;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const messagesContainer = ref(null);

// 生命周期
onMounted(async () => {
  // 获取当前用户DID
  try {
    const identity = await ipcRenderer.invoke('did:get-current-identity');
    if (identity) {
      currentUserDid.value = identity.did;
    }
  } catch (error) {
    console.error('获取当前用户DID失败:', error);
  }

  // 加载群聊列表
  await loadGroups();

  // 加载好友列表（用于创建群聊和邀请）
  try {
    const friends = await ipcRenderer.invoke('friend:get-friends');
    friendOptions.value = friends.map(f => ({
      label: f.nickname || shortenDid(f.friend_did),
      value: f.friend_did
    }));
  } catch (error) {
    console.error('加载好友列表失败:', error);
  }

  // 监听群消息
  ipcRenderer.on('group:message-received', async (event, data) => {
    if (currentGroup.value && data.groupId === currentGroup.value.id) {
      await loadGroupMessages(currentGroup.value.id);
    }
    await loadGroups(); // 更新群聊列表
  });
});
</script>

<style scoped lang="scss">
.group-chat-window {
  display: flex;
  height: 100%;
  background: #f5f5f5;
}

.group-sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid #e8e8e8;
  display: flex;
  flex-direction: column;

  &-header {
    padding: 16px;
    border-bottom: 1px solid #e8e8e8;
    display: flex;
    justify-content: space-between;
    align-items: center;

    h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
  }
}

.group-list {
  flex: 1;
  overflow-y: auto;
}

.group-item {
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #f5f5f5;
  }

  &.active {
    background: #e6f7ff;
  }
}

.group-name {
  font-weight: 500;
}

.group-info {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: #999;
}

.encrypted-badge {
  color: #52c41a;
}

.group-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
}

.group-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.group-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.group-header {
  padding: 16px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;

  &-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  &-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &-name {
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &-members {
    font-size: 12px;
    color: #999;
  }

  &-actions {
    display: flex;
    gap: 8px;
  }
}

.encrypted-icon {
  color: #52c41a;
  font-size: 14px;
}

.group-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.load-more {
  text-align: center;
  padding: 8px 0;
}

.message-item {
  display: flex;
  flex-direction: column;

  &.message-self {
    align-items: flex-end;

    .message-bubble {
      flex-direction: row-reverse;

      .message-content-wrapper {
        align-items: flex-end;
      }
    }
  }
}

.system-message {
  text-align: center;
  color: #999;
  font-size: 12px;
  padding: 8px 0;
}

.message-bubble {
  display: flex;
  gap: 8px;
  max-width: 70%;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-sender {
  font-size: 12px;
  color: #666;
}

.message-content {
  background: #f0f0f0;
  padding: 8px 12px;
  border-radius: 8px;
}

.message-self .message-content {
  background: #1890ff;
  color: white;
}

.message-text {
  word-break: break-word;
}

.message-image img {
  max-width: 200px;
  border-radius: 4px;
}

.message-time {
  font-size: 11px;
  color: #999;
}

.group-input-area {
  border-top: 1px solid #e8e8e8;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-input-toolbar {
  display: flex;
  gap: 8px;
}

.group-input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.input-hint {
  font-size: 12px;
  color: #999;
}
</style>
