<template>
  <div class="chat-window">
    <!-- 来电通知 -->
    <CallNotification />

    <!-- 通话窗口 -->
    <CallWindow v-if="activeCall" />

    <!-- 屏幕共享选择器 -->
    <ScreenSharePicker
      v-model:visible="showScreenSharePicker"
      @select="handleScreenSourceSelect"
    />

    <!-- 左侧：会话列表 -->
    <div class="chat-sidebar">
      <ConversationList
        :sessions="socialStore.chatSessions"
        :current-session-id="currentSession?.id"
        :loading="socialStore.messagesLoading"
        @session-click="handleSessionClick"
        @pin-session="handlePinSession"
        @mark-read="handleMarkRead"
        @delete-session="handleDeleteSession"
      />
    </div>

    <!-- 右侧：聊天区域 -->
    <div class="chat-main">
      <div v-if="!currentSession" class="chat-empty">
        <a-empty description="选择一个会话开始聊天" />
      </div>

      <div v-else class="chat-container">
        <!-- 聊天头部 -->
        <div class="chat-header">
          <div class="chat-header-info">
            <a-avatar :size="36">
              <template #icon><UserOutlined /></template>
            </a-avatar>
            <div class="chat-header-text">
              <div class="chat-header-name">{{ currentSession.friend_nickname || shortenDid(currentSession.participant_did) }}</div>
              <div class="chat-header-status">{{ getOnlineStatus(currentSession.participant_did) }}</div>
            </div>
          </div>

          <div class="chat-header-actions">
            <a-tooltip title="语音通话">
              <a-button type="text" @click="handleVoiceCall">
                <PhoneOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="视频通话">
              <a-button type="text" @click="handleVideoCall">
                <VideoCameraOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="屏幕共享">
              <a-button type="text" @click="handleScreenShare">
                <DesktopOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="更多">
              <a-button type="text">
                <MoreOutlined />
              </a-button>
            </a-tooltip>
          </div>
        </div>

        <!-- 聊天消息区域 -->
        <div ref="messagesContainer" class="chat-messages" @scroll="handleScroll">
          <!-- 加载更多 -->
          <div v-if="hasMore" class="load-more">
            <a-button type="link" :loading="loadingMore" @click="loadMoreMessages">
              加载更多消息
            </a-button>
          </div>

          <!-- 消息列表 -->
          <MessageBubble
            v-for="message in messages"
            :key="message.id"
            :message="message"
            :current-user-did="currentUserDid"
            :sender-name="getSenderName(message.sender_did)"
          />

          <!-- 正在输入提示 -->
          <div v-if="isTyping" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <div class="chat-input-toolbar">
            <a-space>
              <a-tooltip title="表情">
                <a-button type="text" size="small">
                  <SmileOutlined />
                </a-button>
              </a-tooltip>
              <a-tooltip title="图片">
                <a-button type="text" size="small" @click="handleSendImage">
                  <PictureOutlined />
                </a-button>
              </a-tooltip>
              <a-tooltip title="文件">
                <a-button type="text" size="small" @click="handleSendFile">
                  <FileOutlined />
                </a-button>
              </a-tooltip>
            </a-space>
          </div>

          <div class="chat-input-wrapper">
            <a-textarea
              v-model:value="inputMessage"
              :auto-size="{ minRows: 1, maxRows: 4 }"
              placeholder="输入消息..."
              @keydown.enter.exact.prevent="handleSend"
              @keydown.shift.enter.exact="handleNewLine"
            />
            <a-button
              type="primary"
              :loading="sending"
              :disabled="!inputMessage.trim()"
              @click="handleSend"
            >
              发送
            </a-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useSocialStore } from '../../stores/social'
import { useP2PCall } from '../../composables/useP2PCall'
import ConversationList from './ConversationList.vue'
import MessageBubble from './MessageBubble.vue'
import CallNotification from '../call/CallNotification.vue'
import CallWindow from '../call/CallWindow.vue'
import ScreenSharePicker from '../call/ScreenSharePicker.vue'
import {
  UserOutlined,
  PhoneOutlined,
  VideoCameraOutlined,
  DesktopOutlined,
  MoreOutlined,
  SmileOutlined,
  PictureOutlined,
  FileOutlined
} from '@ant-design/icons-vue'

const socialStore = useSocialStore()
const { startAudioCall, startVideoCall, startScreenShare, activeCall } = useP2PCall()

// 状态
const showScreenSharePicker = ref(false)

// 状态
const currentSession = computed(() => socialStore.currentChatSession)
const messages = computed(() => socialStore.currentMessages)
const currentUserDid = ref('')
const inputMessage = ref('')
const sending = ref(false)
const isTyping = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)
const messagesContainer = ref(null)

// 方法
const handleSessionClick = async (session) => {
  try {
    // 查找对应的好友
    const friend = socialStore.friends.find(f => f.friend_did === session.participant_did)
    if (friend) {
      await socialStore.openChatWithFriend(friend)
      scrollToBottom()
    }
  } catch (error) {
    console.error('打开会话失败:', error)
    message.error('打开会话失败')
  }
}

const handleSend = async () => {
  if (!inputMessage.value.trim() || sending.value) return

  try {
    sending.value = true
    await socialStore.sendMessage({
      content: inputMessage.value.trim(),
      type: 'text'
    })

    inputMessage.value = ''
    await nextTick()
    scrollToBottom()
  } catch (error) {
    console.error('发送消息失败:', error)
    message.error('发送失败')
  } finally {
    sending.value = false
  }
}

const handleNewLine = () => {
  inputMessage.value += '\n'
}

const handleSendImage = () => {
  message.info('图片发送功能即将开放')
}

const handleSendFile = () => {
  message.info('文件发送功能即将开放')
}

const handleVoiceCall = async () => {
  if (!currentSession.value) {
    message.warning('请先选择一个会话')
    return
  }

  try {
    const peerId = currentSession.value.participant_did
    await startAudioCall(peerId)
    message.success('正在发起语音通话...')
  } catch (error) {
    console.error('发起语音通话失败:', error)
    message.error('发起语音通话失败')
  }
}

const handleVideoCall = async () => {
  if (!currentSession.value) {
    message.warning('请先选择一个会话')
    return
  }

  try {
    const peerId = currentSession.value.participant_did
    await startVideoCall(peerId)
    message.success('正在发起视频通话...')
  } catch (error) {
    console.error('发起视频通话失败:', error)
    message.error('发起视频通话失败')
  }
}

const handleScreenShare = () => {
  if (!currentSession.value) {
    message.warning('请先选择一个会话')
    return
  }

  // 显示屏幕共享选择器
  showScreenSharePicker.value = true
}

const handleScreenSourceSelect = async (source) => {
  if (!currentSession.value) {
    message.warning('请先选择一个会话')
    return
  }

  try {
    const peerId = currentSession.value.participant_did
    await startScreenShare(peerId, source.id)
    message.success('正在发起屏幕共享...')
  } catch (error) {
    console.error('发起屏幕共享失败:', error)
    message.error('发起屏幕共享失败')
  }
}

const handlePinSession = async (session) => {
  try {
    // TODO: 实现置顶功能
    message.success(session.is_pinned ? '已取消置顶' : '已置顶')
  } catch (error) {
    message.error('操作失败')
  }
}

const handleMarkRead = async (session) => {
  try {
    await socialStore.markAsRead(session.id)
    message.success('已标记为已读')
  } catch (error) {
    message.error('操作失败')
  }
}

const handleDeleteSession = (session) => {
  // TODO: 实现删除会话
  message.info('删除会话功能即将实现')
}

const loadMoreMessages = async () => {
  if (!currentSession.value || loadingMore.value) return

  try {
    loadingMore.value = true
    const offset = messages.value.length
    await socialStore.loadMessages(currentSession.value.id, 50, offset)

    if (messages.value.length === offset) {
      hasMore.value = false
    }
  } catch (error) {
    console.error('加载更多消息失败:', error)
    message.error('加载失败')
  } finally {
    loadingMore.value = false
  }
}

const handleScroll = () => {
  if (!messagesContainer.value) return

  const { scrollTop } = messagesContainer.value
  if (scrollTop < 100 && hasMore.value && !loadingMore.value) {
    loadMoreMessages()
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

const shortenDid = (did) => {
  if (!did) return '未知用户'
  if (did.length <= 20) return did
  return `${did.substring(0, 10)}...${did.substring(did.length - 6)}`
}

const getOnlineStatus = (did) => {
  const status = socialStore.onlineStatus.get(did)
  return status === 'online' ? '在线' : '离线'
}

const getSenderName = (did) => {
  if (did === currentUserDid.value) return '我'
  const friend = socialStore.friends.find(f => f.friend_did === did)
  return friend?.nickname || shortenDid(did)
}

// 生命周期
onMounted(async () => {
  currentUserDid.value = await socialStore.getCurrentUserDid()
})

// 监听消息变化，自动滚动到底部
watch(() => messages.value.length, () => {
  scrollToBottom()
})
</script>

<style scoped>
.chat-window {
  display: flex;
  height: 100%;
  background-color: #f5f5f5;
}

.chat-sidebar {
  width: 300px;
  border-right: 1px solid #e8e8e8;
  background-color: #fff;
  flex-shrink: 0;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #fff;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #fff;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid #f0f0f0;
  background-color: #fafafa;
}

.chat-header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-header-name {
  font-size: 16px;
  font-weight: 500;
  color: #262626;
}

.chat-header-status {
  font-size: 12px;
  color: #8c8c8c;
}

.chat-header-actions {
  display: flex;
  gap: 8px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
  background-color: #f9f9f9;
}

.load-more {
  text-align: center;
  padding: 8px 0;
}

.typing-indicator {
  padding: 12px 16px;
  display: flex;
  gap: 4px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #1890ff;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: scale(1);
  }
  30% {
    opacity: 1;
    transform: scale(1.3);
  }
}

.chat-input-area {
  border-top: 1px solid #f0f0f0;
  background-color: #fff;
}

.chat-input-toolbar {
  padding: 8px 16px;
  border-bottom: 1px solid #f5f5f5;
}

.chat-input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 12px 16px;
}

.chat-input-wrapper :deep(.ant-input) {
  border: none;
  box-shadow: none;
  resize: none;
}

.chat-input-wrapper :deep(.ant-input:focus) {
  box-shadow: none;
}

/* 滚动条 */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-thumb {
  background-color: #d9d9d9;
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-track {
  background-color: transparent;
}

/* 响应式 */
@media (max-width: 768px) {
  .chat-sidebar {
    width: 100%;
    position: absolute;
    z-index: 10;
  }

  .chat-sidebar.has-session {
    display: none;
  }
}
</style>
