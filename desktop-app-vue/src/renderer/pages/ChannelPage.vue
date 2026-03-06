<template>
  <div class="channel-page">
    <a-layout style="height: 100%; background: #fff">
      <!-- Left Sidebar: Channel List -->
      <a-layout-sider
        :width="240"
        theme="light"
        class="channel-sider"
        :style="{ borderRight: '1px solid #f0f0f0' }"
      >
        <div class="sider-header">
          <div
            class="community-badge"
            @click="navigateToCommunity"
          >
            <a-avatar
              :size="28"
              :src="store.currentCommunity?.icon_url"
            >
              {{ store.currentCommunity?.name?.charAt(0) || "C" }}
            </a-avatar>
            <span class="community-name-sm">
              {{ store.currentCommunity?.name || "Community" }}
            </span>
          </div>
        </div>

        <div class="channel-list">
          <div class="channel-list-header">
            <span class="channel-list-title">CHANNELS</span>
            <a-button
              v-if="store.isAdminOrOwner"
              type="text"
              size="small"
              @click="showCreateChannelModal = true"
            >
              <PlusOutlined />
            </a-button>
          </div>

          <a-menu
            v-model:selected-keys="selectedChannelKeys"
            mode="inline"
            class="channel-menu"
            @click="handleChannelSelect"
          >
            <a-menu-item
              v-for="channel in store.channels"
              :key="channel.id"
              class="channel-menu-item"
            >
              <div class="channel-item">
                <span class="channel-icon">
                  <SoundOutlined v-if="channel.type === 'announcement'" />
                  <LockOutlined v-else-if="channel.type === 'readonly'" />
                  <NumberOutlined v-else />
                </span>
                <span class="channel-name">{{ channel.name }}</span>
                <a-badge
                  v-if="channel.message_count"
                  :count="0"
                  :show-zero="false"
                  :dot="false"
                />
              </div>
            </a-menu-item>
          </a-menu>
        </div>

        <div class="sider-footer">
          <div class="member-info">
            <UserOutlined />
            <span>{{ store.members.length }} members</span>
          </div>
        </div>
      </a-layout-sider>

      <!-- Main Chat Area -->
      <a-layout style="background: #fff">
        <a-layout-content class="chat-content">
          <!-- No channel selected -->
          <div
            v-if="!store.currentChannel"
            class="empty-chat"
          >
            <a-empty description="Select a channel to start chatting" />
          </div>

          <!-- Channel Content -->
          <div
            v-else
            class="chat-area"
          >
            <!-- Channel Header -->
            <div class="chat-header">
              <div class="chat-header-info">
                <span class="chat-channel-name"># {{ store.currentChannel.name }}</span>
                <a-tag size="small">
                  {{ store.currentChannel.type }}
                </a-tag>
                <span
                  v-if="store.currentChannel.description"
                  class="chat-channel-desc"
                >
                  {{ store.currentChannel.description }}
                </span>
              </div>
              <div class="chat-header-actions">
                <a-tooltip title="Pinned Messages">
                  <a-button
                    type="text"
                    @click="showPinnedPanel = !showPinnedPanel"
                  >
                    <PushpinOutlined />
                    <span v-if="store.pinnedMessages.length">{{ store.pinnedMessages.length }}</span>
                  </a-button>
                </a-tooltip>
                <a-tooltip title="Members">
                  <a-button
                    type="text"
                    @click="showMemberPanel = !showMemberPanel"
                  >
                    <TeamOutlined />
                  </a-button>
                </a-tooltip>
              </div>
            </div>

            <!-- Message Area -->
            <div
              ref="messageContainerRef"
              class="message-container"
              @scroll="handleScroll"
            >
              <a-spin
                v-if="store.messagesLoading"
                class="messages-loading"
              />

              <div
                v-for="msg in store.channelMessages"
                :key="msg.id"
                class="message-item"
                :class="{
                  'system-message': msg.message_type === 'system',
                  'pinned-message': msg.is_pinned,
                }"
              >
                <!-- System message -->
                <div
                  v-if="msg.message_type === 'system'"
                  class="system-msg-content"
                >
                  <InfoCircleOutlined />
                  {{ msg.content }}
                </div>

                <!-- Regular message -->
                <template v-else>
                  <a-avatar
                    :size="36"
                    class="message-avatar"
                  >
                    {{ (msg.sender_nickname || msg.sender_did)?.charAt(0) || "U" }}
                  </a-avatar>
                  <div class="message-body">
                    <div class="message-header">
                      <span class="message-sender">
                        {{ msg.sender_nickname || formatDID(msg.sender_did) }}
                      </span>
                      <span class="message-time">
                        {{ formatTime(msg.created_at) }}
                      </span>
                      <PushpinOutlined
                        v-if="msg.is_pinned"
                        class="pin-indicator"
                      />
                    </div>

                    <!-- Reply reference -->
                    <div
                      v-if="msg.reply_to"
                      class="message-reply-ref"
                    >
                      <span class="reply-indicator">Replying to a message</span>
                    </div>

                    <div class="message-text">
                      {{ msg.content }}
                    </div>

                    <!-- Reactions -->
                    <div
                      v-if="Object.keys(msg.reactions || {}).length > 0"
                      class="message-reactions"
                    >
                      <a-button
                        v-for="(users, emoji) in msg.reactions"
                        :key="emoji"
                        size="small"
                        class="reaction-btn"
                        :type="isMyReaction(users) ? 'primary' : 'default'"
                        @click="toggleReaction(msg.id, emoji)"
                      >
                        {{ emoji }} {{ users.length }}
                      </a-button>
                    </div>

                    <!-- Message Actions (on hover) -->
                    <div class="message-actions">
                      <a-button
                        type="text"
                        size="small"
                        @click="handleReply(msg)"
                      >
                        <MessageOutlined />
                      </a-button>
                      <a-dropdown>
                        <a-button
                          type="text"
                          size="small"
                        >
                          <SmileOutlined />
                        </a-button>
                        <template #overlay>
                          <div class="emoji-picker">
                            <span
                              v-for="emoji in quickEmojis"
                              :key="emoji"
                              class="emoji-item"
                              @click="handleAddReaction(msg.id, emoji)"
                            >
                              {{ emoji }}
                            </span>
                          </div>
                        </template>
                      </a-dropdown>
                      <a-button
                        v-if="store.isModeratorOrAbove"
                        type="text"
                        size="small"
                        @click="handlePinToggle(msg)"
                      >
                        <PushpinOutlined />
                      </a-button>
                      <a-dropdown>
                        <a-button
                          type="text"
                          size="small"
                        >
                          <EllipsisOutlined />
                        </a-button>
                        <template #overlay>
                          <a-menu>
                            <a-menu-item @click="handleReportMessage(msg)">
                              Report
                            </a-menu-item>
                            <a-menu-item
                              v-if="canDeleteMessage(msg)"
                              danger
                              @click="handleDeleteMessage(msg.id)"
                            >
                              Delete
                            </a-menu-item>
                          </a-menu>
                        </template>
                      </a-dropdown>
                    </div>
                  </div>
                </template>
              </div>

              <div
                v-if="store.channelMessages.length === 0 && !store.messagesLoading"
                class="no-messages"
              >
                <MessageOutlined style="font-size: 32px; color: #d9d9d9" />
                <p>No messages yet. Start the conversation!</p>
              </div>
            </div>

            <!-- Reply Indicator -->
            <div
              v-if="replyingTo"
              class="reply-bar"
            >
              <span>Replying to {{ replyingTo.sender_nickname || formatDID(replyingTo.sender_did) }}</span>
              <a-button
                type="text"
                size="small"
                @click="replyingTo = null"
              >
                <CloseOutlined />
              </a-button>
            </div>

            <!-- Input Area -->
            <div class="input-area">
              <a-input
                v-model:value="messageInput"
                :placeholder="inputPlaceholder"
                :disabled="!canSendMessage"
                size="large"
                @press-enter="handleSendMessage"
              >
                <template #suffix>
                  <a-button
                    type="primary"
                    :disabled="!canSendMessage || !messageInput.trim()"
                    @click="handleSendMessage"
                  >
                    <SendOutlined />
                  </a-button>
                </template>
              </a-input>
            </div>
          </div>
        </a-layout-content>
      </a-layout>

      <!-- Right Sidebar: Pinned Messages / Members (toggleable) -->
      <a-layout-sider
        v-if="showPinnedPanel || showMemberPanel"
        :width="260"
        theme="light"
        class="right-sider"
        :style="{ borderLeft: '1px solid #f0f0f0' }"
      >
        <!-- Pinned Messages Panel -->
        <div
          v-if="showPinnedPanel"
          class="right-panel"
        >
          <div class="right-panel-header">
            <span>Pinned Messages</span>
            <a-button
              type="text"
              size="small"
              @click="showPinnedPanel = false"
            >
              <CloseOutlined />
            </a-button>
          </div>
          <div class="right-panel-content">
            <div
              v-for="msg in store.pinnedMessages"
              :key="msg.id"
              class="pinned-item"
            >
              <div class="pinned-sender">
                {{ msg.sender_nickname || formatDID(msg.sender_did) }}
              </div>
              <div class="pinned-text">
                {{ msg.content }}
              </div>
              <div class="pinned-time">
                {{ formatTime(msg.created_at) }}
              </div>
            </div>
            <a-empty
              v-if="store.pinnedMessages.length === 0"
              description="No pinned messages"
            />
          </div>
        </div>

        <!-- Members Panel -->
        <div
          v-if="showMemberPanel && !showPinnedPanel"
          class="right-panel"
        >
          <div class="right-panel-header">
            <span>Members ({{ store.members.length }})</span>
            <a-button
              type="text"
              size="small"
              @click="showMemberPanel = false"
            >
              <CloseOutlined />
            </a-button>
          </div>
          <div class="right-panel-content">
            <div
              v-for="member in store.members"
              :key="member.id"
              class="member-item"
            >
              <a-avatar :size="28">
                {{ (member.nickname || member.contact_nickname || member.member_did)?.charAt(0) || "U" }}
              </a-avatar>
              <div class="member-detail">
                <span class="member-name">
                  {{ member.nickname || member.contact_nickname || formatDID(member.member_did) }}
                </span>
                <a-tag
                  :color="roleColor(member.role)"
                  size="small"
                >
                  {{ member.role }}
                </a-tag>
              </div>
            </div>
          </div>
        </div>
      </a-layout-sider>
    </a-layout>

    <!-- Create Channel Modal -->
    <a-modal
      v-model:open="showCreateChannelModal"
      title="Create Channel"
      @ok="handleCreateChannel"
      @cancel="showCreateChannelModal = false"
    >
      <a-form
        :model="channelForm"
        layout="vertical"
      >
        <a-form-item
          label="Name"
          required
        >
          <a-input
            v-model:value="channelForm.name"
            placeholder="channel-name"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="channelForm.description"
            placeholder="What is this channel for?"
            :rows="2"
          />
        </a-form-item>
        <a-form-item label="Type">
          <a-select v-model:value="channelForm.type">
            <a-select-option value="discussion">
              Discussion
            </a-select-option>
            <a-select-option value="announcement">
              Announcement
            </a-select-option>
            <a-select-option value="readonly">
              Read-only
            </a-select-option>
            <a-select-option value="subscription">
              Subscription
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  UserOutlined,
  TeamOutlined,
  MessageOutlined,
  PushpinOutlined,
  CloseOutlined,
  SmileOutlined,
  EllipsisOutlined,
  SoundOutlined,
  LockOutlined,
  NumberOutlined,
  InfoCircleOutlined,
  SendOutlined,
} from "@ant-design/icons-vue";
import { useCommunityStore } from "@/stores/community";

const store = useCommunityStore();

// Refs
const messageContainerRef = ref(null);
const messageInput = ref("");
const selectedChannelKeys = ref([]);
const showPinnedPanel = ref(false);
const showMemberPanel = ref(false);
const showCreateChannelModal = ref(false);
const replyingTo = ref(null);

const channelForm = ref({
  name: "",
  description: "",
  type: "discussion",
});

// Quick emoji reactions
const quickEmojis = ["thumbsup", "heart", "laughing", "fire", "eyes", "100"];

// Computed
const canSendMessage = computed(() => {
  if (!store.currentChannel) {return false;}
  if (store.currentChannel.type === "readonly") {return false;}
  if (store.currentChannel.type === "announcement" && !store.isModeratorOrAbove) {return false;}
  return true;
});

const inputPlaceholder = computed(() => {
  if (!store.currentChannel) {return "";}
  if (store.currentChannel.type === "readonly") {return "This channel is read-only";}
  if (store.currentChannel.type === "announcement" && !store.isModeratorOrAbove) {
    return "Only admins can post in announcement channels";
  }
  return `Message #${store.currentChannel.name}`;
});

// Methods
function formatDID(did) {
  if (!did) {return "";}
  if (did.length <= 20) {return did;}
  return `${did.slice(0, 10)}...${did.slice(-10)}`;
}

function formatTime(timestamp) {
  if (!timestamp) {return "";}
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function roleColor(role) {
  const colors = { owner: "gold", admin: "red", moderator: "blue", member: "default" };
  return colors[role] || "default";
}

function isMyReaction(users) {
  // Check if current user DID is in the reaction users list
  // This would need the current user DID from somewhere
  return false;
}

function canDeleteMessage(msg) {
  // Allow sender or moderator+ to delete
  return store.isModeratorOrAbove;
}

async function handleChannelSelect({ key }) {
  selectedChannelKeys.value = [key];
  await store.selectChannel(key);
  await nextTick();
  scrollToBottom();
}

async function handleSendMessage() {
  const content = messageInput.value.trim();
  if (!content || !store.currentChannel) {return;}

  try {
    await store.sendMessage(content, "text", replyingTo.value?.id || null);
    messageInput.value = "";
    replyingTo.value = null;
    await nextTick();
    scrollToBottom();
  } catch (error) {
    message.error("Failed to send message: " + error.message);
  }
}

function handleReply(msg) {
  replyingTo.value = msg;
}

async function handleAddReaction(messageId, emoji) {
  try {
    const { ipcRenderer } = window.electron || {};
    await ipcRenderer.invoke("channel:add-reaction", messageId, emoji);
    // Reload messages to reflect changes
    await store.loadMessages();
  } catch (error) {
    message.error("Failed to add reaction");
  }
}

async function toggleReaction(messageId, emoji) {
  await handleAddReaction(messageId, emoji);
}

async function handlePinToggle(msg) {
  try {
    const { ipcRenderer } = window.electron || {};
    if (msg.is_pinned) {
      await ipcRenderer.invoke("channel:unpin-message", msg.id);
      message.success("Message unpinned");
    } else {
      await ipcRenderer.invoke("channel:pin-message", msg.id);
      message.success("Message pinned");
    }
    await store.loadMessages();
  } catch (error) {
    message.error("Failed to toggle pin: " + error.message);
  }
}

async function handleDeleteMessage(messageId) {
  try {
    const { ipcRenderer } = window.electron || {};
    await ipcRenderer.invoke("channel:delete-message", messageId);
    store.channelMessages = store.channelMessages.filter((m) => m.id !== messageId);
    message.success("Message deleted");
  } catch (error) {
    message.error("Failed to delete message: " + error.message);
  }
}

function handleReportMessage(msg) {
  if (!store.currentCommunity) {return;}
  store.reportContent({
    communityId: store.currentCommunity.id,
    contentId: msg.id,
    contentType: "message",
    reason: "Reported by user",
    contentText: msg.content,
  }).then(() => {
    message.success("Content reported");
  }).catch((error) => {
    message.error("Failed to report: " + error.message);
  });
}

async function handleCreateChannel() {
  if (!channelForm.value.name?.trim()) {
    message.warning("Please enter a channel name");
    return;
  }
  if (!store.currentCommunity) {return;}
  try {
    const { ipcRenderer } = window.electron || {};
    await ipcRenderer.invoke("channel:create", {
      communityId: store.currentCommunity.id,
      ...channelForm.value,
    });
    message.success("Channel created");
    showCreateChannelModal.value = false;
    channelForm.value = { name: "", description: "", type: "discussion" };
    await store.loadChannels();
  } catch (error) {
    message.error("Failed to create channel: " + error.message);
  }
}

function navigateToCommunity() {
  window.location.hash = "#/community";
}

function scrollToBottom() {
  if (messageContainerRef.value) {
    messageContainerRef.value.scrollTop = messageContainerRef.value.scrollHeight;
  }
}

function handleScroll() {
  // Could implement infinite scroll / load more messages here
}

// Watch for message changes to auto-scroll
watch(
  () => store.channelMessages.length,
  () => {
    nextTick(() => scrollToBottom());
  },
);

// Lifecycle
onMounted(async () => {
  // If community was already loaded, initialize channels
  if (store.currentCommunity) {
    await store.loadChannels();
    await store.loadMembers();

    // Auto-select first channel
    if (store.channels.length > 0 && !store.currentChannel) {
      selectedChannelKeys.value = [store.channels[0].id];
      await store.selectChannel(store.channels[0].id);
      await nextTick();
      scrollToBottom();
    }
  }
});

onUnmounted(() => {
  // Clean up if needed
});
</script>

<style scoped>
.channel-page {
  height: 100%;
  overflow: hidden;
}

.channel-sider {
  display: flex;
  flex-direction: column;
}

.sider-header {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.community-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: background 0.2s;
}

.community-badge:hover {
  background: #f5f5f5;
}

.community-name-sm {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-list {
  flex: 1;
  overflow-y: auto;
}

.channel-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px 4px;
}

.channel-list-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.45);
  letter-spacing: 0.5px;
}

.channel-menu {
  border: none !important;
}

.channel-menu-item {
  height: 36px !important;
  line-height: 36px !important;
}

.channel-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.channel-icon {
  color: rgba(0, 0, 0, 0.45);
  font-size: 14px;
}

.channel-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sider-footer {
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}

.member-info {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.chat-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.empty-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.chat-area {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.chat-header-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-channel-name {
  font-size: 16px;
  font-weight: 600;
}

.chat-channel-desc {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
  margin-left: 8px;
  border-left: 1px solid #f0f0f0;
  padding-left: 8px;
}

.chat-header-actions {
  display: flex;
  gap: 4px;
}

.message-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.messages-loading {
  display: flex;
  justify-content: center;
  padding: 20px;
}

.message-item {
  display: flex;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  position: relative;
}

.message-item:hover {
  background: #fafafa;
}

.message-item:hover .message-actions {
  opacity: 1;
}

.system-message {
  justify-content: center;
  padding: 4px 0;
}

.system-msg-content {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.pinned-message {
  background: #fffbe6;
  border-left: 3px solid #faad14;
}

.message-avatar {
  flex-shrink: 0;
  margin-top: 2px;
}

.message-body {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.message-sender {
  font-weight: 600;
  font-size: 14px;
}

.message-time {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
}

.pin-indicator {
  color: #faad14;
  font-size: 12px;
}

.message-reply-ref {
  margin-bottom: 4px;
  padding: 4px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  border-left: 2px solid #1890ff;
}

.reply-indicator {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  font-style: italic;
}

.message-text {
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.message-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.reaction-btn {
  font-size: 12px;
  border-radius: 12px;
}

.message-actions {
  position: absolute;
  right: 8px;
  top: -8px;
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  gap: 2px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 0 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.no-messages {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: rgba(0, 0, 0, 0.35);
}

.reply-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 20px;
  background: #f5f5f5;
  border-top: 1px solid #f0f0f0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}

.input-area {
  padding: 12px 20px 16px;
  border-top: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.emoji-picker {
  display: flex;
  gap: 4px;
  padding: 8px;
  background: #fff;
  border-radius: 8px;
}

.emoji-item {
  cursor: pointer;
  font-size: 18px;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.emoji-item:hover {
  background: #f5f5f5;
}

/* Right sidebar */
.right-sider {
  display: flex;
  flex-direction: column;
}

.right-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.right-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 600;
}

.right-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.pinned-item {
  padding: 8px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 8px;
}

.pinned-sender {
  font-weight: 500;
  font-size: 13px;
  margin-bottom: 2px;
}

.pinned-text {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.75);
  margin-bottom: 2px;
}

.pinned-time {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
}

.member-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
}

.member-detail {
  display: flex;
  align-items: center;
  gap: 6px;
}

.member-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
