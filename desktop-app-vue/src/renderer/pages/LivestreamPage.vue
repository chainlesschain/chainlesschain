<template>
  <div class="livestream-page">
    <a-page-header
      title="Decentralized Livestream"
      sub-title="P2P encrypted live streaming with danmaku overlay"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-space>
          <a-badge
            :status="livestreamStore.isStreaming ? 'processing' : 'default'"
            :text="livestreamStore.isStreaming ? 'Streaming' : 'Offline'"
          />
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
            <template #icon>
              <VideoCameraAddOutlined />
            </template>
            Create Stream
          </a-button>
          <a-button @click="handleRefresh">
            <template #icon>
              <ReloadOutlined />
            </template>
            Refresh
          </a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-layout class="livestream-layout">
      <!-- Main content area -->
      <a-layout-content class="livestream-main">
        <!-- Current stream view -->
        <div
          v-if="livestreamStore.currentStream"
          class="stream-view"
        >
          <!-- Stream header -->
          <div class="stream-header">
            <div class="stream-title-row">
              <h2 class="stream-title">
                {{ livestreamStore.currentStream.title }}
              </h2>
              <a-space>
                <a-badge
                  :count="livestreamStore.viewerCount"
                  :overflow-count="9999"
                  :number-style="{ backgroundColor: '#1890ff' }"
                >
                  <a-tag color="blue">
                    <EyeOutlined />
                    Viewers
                  </a-tag>
                </a-badge>
                <a-tag
                  :color="livestreamStore.currentStream.status === 'live' ? 'red' : 'default'"
                >
                  {{ livestreamStore.currentStream.status === 'live' ? 'LIVE' : livestreamStore.currentStream.status.toUpperCase() }}
                </a-tag>
              </a-space>
            </div>
          </div>

          <!-- Video area with danmaku overlay -->
          <div class="video-container">
            <div class="video-placeholder">
              <div
                v-if="!livestreamStore.isCurrentStreamLive"
                class="video-offline"
              >
                <VideoCameraOutlined style="font-size: 64px; color: #8c8c8c" />
                <p>Stream is {{ livestreamStore.currentStream.status }}</p>
              </div>
              <div
                v-else
                class="video-live-indicator"
              >
                <div class="live-pulse" />
                <span>Live Stream Active</span>
              </div>
            </div>

            <!-- Danmaku overlay -->
            <DanmakuOverlay
              :messages="livestreamStore.danmakuQueue"
              :enabled="danmakuEnabled"
            />
          </div>

          <!-- Stream controls -->
          <div class="stream-controls">
            <a-space>
              <!-- Streamer controls -->
              <template v-if="isStreamer">
                <a-button
                  v-if="livestreamStore.currentStream.status === 'scheduled'"
                  type="primary"
                  danger
                  @click="handleStartStream"
                >
                  <template #icon>
                    <PlayCircleOutlined />
                  </template>
                  Go Live
                </a-button>
                <a-button
                  v-if="livestreamStore.currentStream.status === 'live'"
                  danger
                  @click="handleEndStream"
                >
                  <template #icon>
                    <StopOutlined />
                  </template>
                  End Stream
                </a-button>
                <a-button @click="handleShareScreen">
                  <template #icon>
                    <DesktopOutlined />
                  </template>
                  Share Screen
                </a-button>
                <a-button @click="toggleCamera">
                  <template #icon>
                    <component :is="cameraEnabled ? 'VideoCameraOutlined' : 'VideoCameraOutlined'" />
                  </template>
                  {{ cameraEnabled ? 'Camera On' : 'Camera Off' }}
                </a-button>
                <a-button @click="toggleMic">
                  <template #icon>
                    <AudioOutlined />
                  </template>
                  {{ micEnabled ? 'Mic On' : 'Mic Off' }}
                </a-button>
              </template>

              <!-- Viewer controls -->
              <template v-else>
                <a-button
                  danger
                  @click="handleLeaveStream"
                >
                  <template #icon>
                    <LogoutOutlined />
                  </template>
                  Leave Stream
                </a-button>
              </template>

              <!-- Common controls -->
              <a-switch
                v-model:checked="danmakuEnabled"
                checked-children="Danmaku ON"
                un-checked-children="Danmaku OFF"
              />
              <a-button
                type="text"
                @click="showSettings = true"
              >
                <template #icon>
                  <SettingOutlined />
                </template>
              </a-button>
            </a-space>
          </div>

          <!-- Stream description -->
          <a-descriptions
            v-if="livestreamStore.currentStream.description"
            :column="1"
            bordered
            size="small"
            class="stream-description"
          >
            <a-descriptions-item label="Description">
              {{ livestreamStore.currentStream.description }}
            </a-descriptions-item>
            <a-descriptions-item label="Streamer">
              {{ shortenDid(livestreamStore.currentStream.streamer_did) }}
            </a-descriptions-item>
            <a-descriptions-item label="Access">
              <a-tag>{{ livestreamStore.currentStream.access_type }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="livestreamStore.currentStream.started_at"
              label="Started"
            >
              {{ formatTime(livestreamStore.currentStream.started_at) }}
            </a-descriptions-item>
          </a-descriptions>
        </div>

        <!-- No stream selected - show discovery -->
        <div
          v-else
          class="stream-discovery"
        >
          <a-tabs v-model:active-key="activeTab">
            <a-tab-pane
              key="active"
              tab="Live Now"
            >
              <a-spin :spinning="livestreamStore.loading">
                <a-list
                  :data-source="livestreamStore.activeStreams"
                  :locale="{ emptyText: 'No active streams' }"
                  :grid="{ gutter: 16, column: 3 }"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-card
                        hoverable
                        class="stream-card"
                        @click="handleJoinStream(item)"
                      >
                        <template #cover>
                          <div class="stream-card-cover">
                            <VideoCameraOutlined style="font-size: 48px; color: #8c8c8c" />
                            <a-tag
                              color="red"
                              class="live-tag"
                            >
                              LIVE
                            </a-tag>
                          </div>
                        </template>
                        <a-card-meta :title="item.title">
                          <template #description>
                            <div class="stream-card-meta">
                              <span>
                                <EyeOutlined />
                                {{ item.viewer_count }} viewers
                              </span>
                              <a-tag size="small">
                                {{ item.access_type }}
                              </a-tag>
                            </div>
                          </template>
                        </a-card-meta>
                      </a-card>
                    </a-list-item>
                  </template>
                </a-list>
              </a-spin>
            </a-tab-pane>

            <a-tab-pane
              key="my"
              tab="My Streams"
            >
              <a-spin :spinning="livestreamStore.loading">
                <a-list
                  :data-source="livestreamStore.myStreams"
                  :locale="{ emptyText: 'No streams created yet' }"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-list-item-meta
                        :title="item.title"
                        :description="item.description"
                      >
                        <template #avatar>
                          <a-avatar :style="{ backgroundColor: getStatusColor(item.status) }">
                            <template #icon>
                              <VideoCameraOutlined />
                            </template>
                          </a-avatar>
                        </template>
                      </a-list-item-meta>
                      <template #actions>
                        <a-tag :color="getStatusColor(item.status)">
                          {{ item.status }}
                        </a-tag>
                        <span>
                          <EyeOutlined />
                          {{ item.viewer_count }}
                        </span>
                        <a-button
                          v-if="item.status === 'scheduled'"
                          type="link"
                          size="small"
                          @click="handleSelectMyStream(item)"
                        >
                          Manage
                        </a-button>
                        <a-button
                          v-if="item.status === 'live'"
                          type="link"
                          size="small"
                          @click="handleSelectMyStream(item)"
                        >
                          View
                        </a-button>
                      </template>
                    </a-list-item>
                  </template>
                </a-list>
              </a-spin>
            </a-tab-pane>
          </a-tabs>
        </div>
      </a-layout-content>

      <!-- Right sidebar: Chat / Danmaku panel -->
      <a-layout-sider
        v-if="livestreamStore.currentStream"
        :width="320"
        theme="light"
        class="chat-sider"
      >
        <div class="chat-panel">
          <div class="chat-panel-header">
            <h3>Live Chat</h3>
            <a-badge
              :count="livestreamStore.danmakuCount"
              :overflow-count="99"
            />
          </div>

          <!-- Danmaku message list -->
          <div
            ref="chatListRef"
            class="chat-message-list"
          >
            <div
              v-for="msg in livestreamStore.danmakuQueue"
              :key="msg.id"
              class="chat-message-item"
            >
              <span
                class="chat-sender"
                :style="{ color: msg.color || '#1890ff' }"
              >
                {{ shortenDid(msg.sender_did) }}:
              </span>
              <span class="chat-content">{{ msg.content }}</span>
            </div>
            <div
              v-if="livestreamStore.danmakuQueue.length === 0"
              class="chat-empty"
            >
              <a-empty
                description="No messages yet"
                :image-style="{ height: '40px' }"
              />
            </div>
          </div>

          <!-- Danmaku input -->
          <div class="chat-input-area">
            <a-input
              v-model:value="danmakuInput"
              placeholder="Send a message..."
              :maxlength="100"
              @press-enter="handleSendDanmaku"
            >
              <template #addonAfter>
                <a-button
                  type="text"
                  size="small"
                  :disabled="!danmakuInput.trim()"
                  @click="handleSendDanmaku"
                >
                  Send
                </a-button>
              </template>
            </a-input>
            <div class="danmaku-options">
              <a-popover
                trigger="click"
                placement="topLeft"
              >
                <template #content>
                  <div class="color-picker">
                    <div
                      v-for="color in danmakuColors"
                      :key="color"
                      class="color-swatch"
                      :style="{ backgroundColor: color }"
                      :class="{ active: selectedColor === color }"
                      @click="selectedColor = color"
                    />
                  </div>
                </template>
                <a-button
                  type="text"
                  size="small"
                >
                  <BgColorsOutlined />
                </a-button>
              </a-popover>
            </div>
          </div>
        </div>
      </a-layout-sider>
    </a-layout>

    <!-- Create Stream Modal -->
    <a-modal
      v-model:open="showCreateModal"
      title="Create Livestream"
      @ok="handleCreateStream"
      @cancel="resetCreateForm"
    >
      <a-form layout="vertical">
        <a-form-item
          label="Title"
          required
        >
          <a-input
            v-model:value="createForm.title"
            placeholder="Enter stream title"
            :maxlength="200"
          />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="createForm.description"
            placeholder="Describe your stream"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="Access Type">
          <a-select v-model:value="createForm.accessType">
            <a-select-option value="public">
              Public
            </a-select-option>
            <a-select-option value="friends">
              Friends Only
            </a-select-option>
            <a-select-option value="password">
              Password Protected
            </a-select-option>
            <a-select-option value="invite">
              Invite Only
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="createForm.accessType === 'password'"
          label="Access Code"
        >
          <a-input-password
            v-model:value="createForm.accessCode"
            placeholder="Set access code"
          />
        </a-form-item>
        <a-form-item label="Max Viewers">
          <a-input-number
            v-model:value="createForm.maxViewers"
            :min="1"
            :max="10000"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- Join Password Modal -->
    <a-modal
      v-model:open="showPasswordModal"
      title="Enter Access Code"
      @ok="handlePasswordSubmit"
    >
      <a-input-password
        v-model:value="joinAccessCode"
        placeholder="Enter the stream access code"
        @press-enter="handlePasswordSubmit"
      />
    </a-modal>

    <!-- Settings Drawer -->
    <a-drawer
      v-model:open="showSettings"
      title="Stream Settings"
      placement="right"
      :width="360"
    >
      <a-form layout="vertical">
        <a-form-item label="Danmaku Display">
          <a-switch v-model:checked="danmakuEnabled" />
        </a-form-item>
        <a-form-item label="Danmaku Font Size">
          <a-slider
            v-model:value="danmakuFontSize"
            :min="12"
            :max="48"
          />
        </a-form-item>
        <a-form-item label="Danmaku Opacity">
          <a-slider
            v-model:value="danmakuOpacity"
            :min="0"
            :max="100"
          />
        </a-form-item>
      </a-form>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  VideoCameraOutlined,
  VideoCameraAddOutlined,
  ReloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  StopOutlined,
  DesktopOutlined,
  AudioOutlined,
  LogoutOutlined,
  SettingOutlined,
  BgColorsOutlined,
} from '@ant-design/icons-vue';
import { useLivestreamStore } from '@/stores/livestream';
import DanmakuOverlay from '@/components/social/DanmakuOverlay.vue';

// ==================== Store ====================

const livestreamStore = useLivestreamStore();

// ==================== Refs ====================

const chatListRef = ref(null);
const activeTab = ref('active');

// Create modal
const showCreateModal = ref(false);
const createForm = ref({
  title: '',
  description: '',
  accessType: 'public',
  accessCode: '',
  maxViewers: 100,
});

// Password modal for joining protected streams
const showPasswordModal = ref(false);
const joinAccessCode = ref('');
const pendingJoinStreamId = ref('');

// Settings
const showSettings = ref(false);
const danmakuEnabled = ref(true);
const danmakuFontSize = ref(24);
const danmakuOpacity = ref(80);

// Controls
const cameraEnabled = ref(false);
const micEnabled = ref(false);

// Danmaku input
const danmakuInput = ref('');
const selectedColor = ref('#FFFFFF');
const danmakuColors = [
  '#FFFFFF', '#FF0000', '#FF6600', '#FFFF00',
  '#00FF00', '#00FFFF', '#0000FF', '#FF00FF',
  '#FFC0CB', '#FFD700', '#7CFC00', '#1890FF',
];

// ==================== Computed ====================

const isStreamer = computed(() => {
  if (!livestreamStore.currentStream) {return false;}
  // This would normally compare against the current user's DID
  // For now we check if we're in streaming mode
  return livestreamStore.isStreaming;
});

// ==================== Lifecycle ====================

onMounted(async () => {
  await livestreamStore.loadActiveStreams();
  await livestreamStore.loadMyStreams();
});

onUnmounted(() => {
  // Clean up: leave stream if viewing
  if (livestreamStore.currentStream && !livestreamStore.isStreaming) {
    livestreamStore.leaveStream(livestreamStore.currentStream.id).catch(() => {});
  }
});

// Auto-scroll chat to bottom when new messages arrive
watch(
  () => livestreamStore.danmakuQueue.length,
  () => {
    nextTick(() => {
      if (chatListRef.value) {
        chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
      }
    });
  },
);

// ==================== Methods ====================

function shortenDid(did) {
  if (!did) {return 'Unknown';}
  if (did.length <= 20) {return did;}
  return `${did.substring(0, 10)}...${did.substring(did.length - 6)}`;
}

function formatTime(timestamp) {
  if (!timestamp) {return '';}
  return new Date(timestamp).toLocaleString();
}

function getStatusColor(status) {
  const colors = {
    scheduled: 'blue',
    live: 'red',
    ended: 'default',
    cancelled: 'orange',
  };
  return colors[status] || 'default';
}

async function handleRefresh() {
  await livestreamStore.loadActiveStreams();
  await livestreamStore.loadMyStreams();
  message.success('Refreshed');
}

async function handleCreateStream() {
  try {
    if (!createForm.value.title.trim()) {
      message.warning('Please enter a stream title');
      return;
    }

    const stream = await livestreamStore.createStream({
      title: createForm.value.title,
      description: createForm.value.description,
      accessType: createForm.value.accessType,
      accessCode: createForm.value.accessCode,
      maxViewers: createForm.value.maxViewers,
    });

    message.success('Stream created successfully');
    showCreateModal.value = false;
    resetCreateForm();

    // Select the newly created stream
    livestreamStore.currentStream = stream;
    livestreamStore.isStreaming = true;
  } catch (error) {
    message.error(`Failed to create stream: ${error.message}`);
  }
}

function resetCreateForm() {
  createForm.value = {
    title: '',
    description: '',
    accessType: 'public',
    accessCode: '',
    maxViewers: 100,
  };
}

async function handleStartStream() {
  try {
    await livestreamStore.startStream(livestreamStore.currentStream.id);
    message.success('Stream is now live!');
  } catch (error) {
    message.error(`Failed to start stream: ${error.message}`);
  }
}

async function handleEndStream() {
  try {
    await livestreamStore.endStream(livestreamStore.currentStream.id);
    message.info('Stream ended');
  } catch (error) {
    message.error(`Failed to end stream: ${error.message}`);
  }
}

async function handleJoinStream(stream) {
  if (stream.access_type === 'password') {
    pendingJoinStreamId.value = stream.id;
    showPasswordModal.value = true;
    return;
  }

  try {
    await livestreamStore.joinStream(stream.id);
    await livestreamStore.loadDanmakuHistory(stream.id);
    message.success(`Joined: ${stream.title}`);
  } catch (error) {
    message.error(`Failed to join stream: ${error.message}`);
  }
}

async function handlePasswordSubmit() {
  try {
    await livestreamStore.joinStream(
      pendingJoinStreamId.value,
      joinAccessCode.value,
    );
    await livestreamStore.loadDanmakuHistory(pendingJoinStreamId.value);
    showPasswordModal.value = false;
    joinAccessCode.value = '';
    pendingJoinStreamId.value = '';
    message.success('Joined stream');
  } catch (error) {
    message.error(`Failed to join: ${error.message}`);
  }
}

async function handleLeaveStream() {
  try {
    const streamId = livestreamStore.currentStream?.id;
    if (streamId) {
      await livestreamStore.leaveStream(streamId);
      message.info('Left stream');
    }
  } catch (error) {
    message.error(`Failed to leave stream: ${error.message}`);
  }
}

function handleSelectMyStream(stream) {
  livestreamStore.currentStream = stream;
  if (stream.status === 'live') {
    livestreamStore.isStreaming = true;
    livestreamStore.loadDanmakuHistory(stream.id);
  }
}

async function handleSendDanmaku() {
  const content = danmakuInput.value.trim();
  if (!content) {return;}

  try {
    await livestreamStore.sendDanmaku({
      streamId: livestreamStore.currentStream.id,
      senderDid: 'self', // Actual DID resolved by backend
      content,
      options: {
        color: selectedColor.value,
        fontSize: danmakuFontSize.value,
      },
    });
    danmakuInput.value = '';
  } catch (error) {
    message.error(`Failed to send message: ${error.message}`);
  }
}

function handleShareScreen() {
  message.info('Screen sharing will use WebRTC P2P connection');
}

function toggleCamera() {
  cameraEnabled.value = !cameraEnabled.value;
  message.info(`Camera ${cameraEnabled.value ? 'enabled' : 'disabled'}`);
}

function toggleMic() {
  micEnabled.value = !micEnabled.value;
  message.info(`Microphone ${micEnabled.value ? 'enabled' : 'disabled'}`);
}
</script>

<style scoped>
.livestream-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
}

.livestream-layout {
  flex: 1;
  overflow: hidden;
}

.livestream-main {
  padding: 16px;
  overflow-y: auto;
}

/* Stream View */
.stream-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stream-header {
  padding: 8px 0;
}

.stream-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stream-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

/* Video container */
.video-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.video-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-offline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #8c8c8c;
}

.video-offline p {
  margin: 0;
  font-size: 16px;
}

.video-live-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #fff;
  font-size: 18px;
}

.live-pulse {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ff4d4f;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(255, 77, 79, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 77, 79, 0);
  }
}

/* Controls */
.stream-controls {
  padding: 8px 0;
  border-top: 1px solid #f0f0f0;
  border-bottom: 1px solid #f0f0f0;
}

.stream-description {
  margin-top: 8px;
}

/* Stream Discovery */
.stream-discovery {
  padding: 0;
}

.stream-card {
  height: 100%;
}

.stream-card-cover {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a2e;
  position: relative;
}

.live-tag {
  position: absolute;
  top: 8px;
  left: 8px;
}

.stream-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #8c8c8c;
}

/* Chat sider */
.chat-sider {
  border-left: 1px solid #f0f0f0;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.chat-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.chat-message-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.chat-message-item {
  padding: 4px 0;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.chat-sender {
  font-weight: 500;
  margin-right: 4px;
}

.chat-content {
  color: #333;
}

.chat-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
}

.chat-input-area {
  padding: 8px 12px;
  border-top: 1px solid #f0f0f0;
}

.danmaku-options {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.color-picker {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.color-swatch:hover {
  border-color: #1890ff;
}

.color-swatch.active {
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.3);
}
</style>
