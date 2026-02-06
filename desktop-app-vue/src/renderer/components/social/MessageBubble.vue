<template>
  <div
    class="message-bubble"
    :class="{ 'message-sent': isSent, 'message-received': !isSent }"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- 头像 -->
    <div
      v-if="!isSent"
      class="message-avatar"
    >
      <a-avatar :size="32">
        <template #icon>
          <UserOutlined />
        </template>
      </a-avatar>
    </div>

    <!-- 消息内容 -->
    <div class="message-wrapper">
      <!-- 发送者昵称（仅接收的消息显示） -->
      <div
        v-if="!isSent && showNickname"
        class="message-nickname"
      >
        {{ senderName }}
      </div>

      <!-- 消息气泡 -->
      <div
        class="message-content"
        :class="`type-${message.message_type || 'text'}`"
      >
        <!-- 转发标记 -->
        <div
          v-if="message.forwarded_from_id"
          class="forwarded-indicator"
        >
          <ShareAltOutlined /> 转发的消息
        </div>

        <!-- 文本消息 -->
        <div
          v-if="message.message_type === 'text' || !message.message_type"
          class="message-text"
        >
          {{ message.content }}
        </div>

        <!-- 图片消息 -->
        <div
          v-else-if="message.message_type === 'image'"
          class="message-image"
        >
          <a-image
            :src="message.file_path"
            :alt="message.content"
            :width="200"
            :preview="true"
          />
        </div>

        <!-- 文件消息 -->
        <div
          v-else-if="message.message_type === 'file'"
          class="message-file"
        >
          <div class="file-icon">
            <FileOutlined />
          </div>
          <div class="file-info">
            <div class="file-name">
              {{ message.content }}
            </div>
            <div class="file-size">
              {{ formatFileSize(message.file_size) }}
            </div>
            <!-- 传输进度 -->
            <div
              v-if="transferProgress && transferProgress.status !== 'completed'"
              class="transfer-progress"
            >
              <a-progress
                :percent="Math.round(transferProgress.progress * 100)"
                :status="transferProgress.status === 'failed' ? 'exception' : 'active'"
                size="small"
              />
              <div class="transfer-info">
                <span>{{ formatFileSize(transferProgress.bytesTransferred) }} / {{ formatFileSize(transferProgress.totalBytes) }}</span>
                <a-button
                  v-if="transferProgress.status === 'transferring'"
                  type="link"
                  size="small"
                  @click="handleCancelTransfer"
                >
                  取消
                </a-button>
              </div>
            </div>
          </div>
          <a-button
            v-if="!transferProgress || transferProgress.status === 'completed'"
            type="link"
            size="small"
            @click="handleDownload"
          >
            <DownloadOutlined />
          </a-button>
        </div>

        <!-- 语音消息 -->
        <div
          v-else-if="message.message_type === 'voice'"
          class="message-voice"
        >
          <a-button
            type="text"
            size="small"
            @click="toggleVoicePlay"
          >
            <SoundOutlined v-if="!isPlaying" />
            <PauseCircleOutlined v-else />
          </a-button>
          <div class="voice-duration">
            {{ message.duration || '0:00' }}
          </div>
        </div>

        <!-- 视频消息 -->
        <div
          v-else-if="message.message_type === 'video'"
          class="message-video"
        >
          <video
            :src="message.file_path"
            controls
            :style="{ maxWidth: '300px', maxHeight: '200px' }"
          />
        </div>

        <!-- 未知类型 -->
        <div
          v-else
          class="message-text"
        >
          {{ message.content }}
        </div>
      </div>

      <!-- 消息元数据 -->
      <div class="message-meta">
        <span class="message-time">{{ formatTime(message.timestamp) }}</span>

        <!-- 发送状态（仅发送的消息显示） -->
        <span
          v-if="isSent"
          class="message-status"
        >
          <CheckOutlined
            v-if="message.status === 'sent'"
            :style="{ color: '#8c8c8c' }"
          />
          <CheckCircleOutlined
            v-else-if="message.status === 'delivered'"
            :style="{ color: '#1890ff' }"
          />
          <CheckCircleFilled
            v-else-if="message.status === 'read'"
            :style="{ color: '#52c41a' }"
          />
          <CloseCircleOutlined
            v-else-if="message.status === 'failed'"
            :style="{ color: '#ff4d4f' }"
          />
        </span>
      </div>

      <!-- 表情回应区域 -->
      <div
        v-if="reactionStats && Object.keys(reactionStats).length > 0"
        class="message-reactions"
      >
        <div
          v-for="(stat, emoji) in reactionStats"
          :key="emoji"
          class="reaction-item"
          :class="{ 'reaction-active': hasUserReacted(emoji) }"
          @click="toggleReaction(emoji)"
        >
          <span class="reaction-emoji">{{ emoji }}</span>
          <span class="reaction-count">{{ stat.count }}</span>
        </div>
        <a-button
          type="text"
          size="small"
          class="add-reaction-btn"
          @click="showReactionPicker = true"
        >
          <SmileOutlined />
        </a-button>
      </div>

      <!-- 添加表情按钮（无表情时显示） -->
      <div
        v-else
        class="add-reaction-container"
      >
        <a-button
          type="text"
          size="small"
          class="add-reaction-btn-initial"
          @click="showReactionPicker = true"
        >
          <SmileOutlined /> 添加表情
        </a-button>
      </div>
    </div>

    <!-- 头像（发送的消息） -->
    <div
      v-if="isSent"
      class="message-avatar"
    >
      <a-avatar
        :size="32"
        :style="{ backgroundColor: '#1890ff' }"
      >
        <template #icon>
          <UserOutlined />
        </template>
      </a-avatar>
    </div>

    <!-- 右键菜单 -->
    <a-dropdown
      v-model:open="contextMenuVisible"
      :trigger="['contextmenu']"
      :get-popup-container="() => $el"
    >
      <div />
      <template #overlay>
        <a-menu @click="handleMenuClick">
          <a-menu-item key="forward">
            <ShareAltOutlined /> 转发
          </a-menu-item>
          <a-menu-item
            v-if="message.message_type === 'text' || !message.message_type"
            key="copy"
          >
            <CopyOutlined /> 复制
          </a-menu-item>
          <a-menu-item
            key="delete"
            danger
          >
            <DeleteOutlined /> 删除
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>

    <!-- 转发对话框 -->
    <a-modal
      v-model:open="forwardModalVisible"
      title="转发消息"
      ok-text="转发"
      cancel-text="取消"
      :confirm-loading="forwarding"
      @ok="handleForward"
    >
      <div class="forward-modal-content">
        <p>选择要转发到的会话：</p>
        <a-checkbox-group
          v-model:value="selectedSessions"
          style="width: 100%"
        >
          <div
            v-for="session in availableSessions"
            :key="session.id"
            class="session-item"
          >
            <a-checkbox :value="session.id">
              <div class="session-info">
                <a-avatar :size="32">
                  <template #icon>
                    <UserOutlined />
                  </template>
                </a-avatar>
                <span class="session-name">{{ session.friend_nickname || session.participant_did }}</span>
              </div>
            </a-checkbox>
          </div>
        </a-checkbox-group>
      </div>
    </a-modal>

    <!-- 表情选择器 -->
    <a-modal
      v-model:open="showReactionPicker"
      title="选择表情"
      :footer="null"
      width="400px"
    >
      <div class="reaction-picker">
        <div
          v-for="emoji in commonEmojis"
          :key="emoji"
          class="emoji-option"
          @click="addReaction(emoji)"
        >
          {{ emoji }}
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { message as antMessage, Modal } from 'ant-design-vue'
import {
  UserOutlined,
  FileOutlined,
  DownloadOutlined,
  SoundOutlined,
  PauseCircleOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  CloseCircleOutlined,
  ShareAltOutlined,
  CopyOutlined,
  DeleteOutlined,
  SmileOutlined
} from '@ant-design/icons-vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  currentUserDid: {
    type: String,
    required: true
  },
  senderName: {
    type: String,
    default: '未知用户'
  },
  showNickname: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['message-deleted', 'message-forwarded', 'reaction-updated'])

// 状态
const isPlaying = ref(false)
const contextMenuVisible = ref(false)
const forwardModalVisible = ref(false)
const forwarding = ref(false)
const selectedSessions = ref([])
const availableSessions = ref([])
const transferProgress = ref(null)
const showReactionPicker = ref(false)
const reactionStats = ref({})
let progressInterval = null
let audioElement = null

// 常用表情列表
const commonEmojis = [
  '👍', '❤️', '😂', '😮', '😢', '😡',
  '🎉', '🔥', '👏', '💯', '✨', '🙏',
  '😊', '😍', '🤔', '😎', '🥳', '😭'
]

// 计算属性
const isSent = computed(() => {
  return props.message.sender_did === props.currentUserDid
})

// 加载表情回应统计
const loadReactionStats = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('chat:get-reaction-stats', props.message.id)
    if (result.success) {
      reactionStats.value = result.stats
    }
  } catch (error) {
    logger.error('加载表情回应失败:', error)
  }
}

// 检查当前用户是否对某个表情做出了回应
const hasUserReacted = (emoji) => {
  const stat = reactionStats.value[emoji]
  return stat && stat.users.includes(props.currentUserDid)
}

// 切换表情回应
const toggleReaction = async (emoji) => {
  try {
    if (hasUserReacted(emoji)) {
      // 移除表情
      const result = await window.electron.ipcRenderer.invoke('chat:remove-reaction', {
        messageId: props.message.id,
        userDid: props.currentUserDid,
        emoji
      })
      if (result.success) {
        await loadReactionStats()
        emit('reaction-updated')
      }
    } else {
      // 添加表情
      const result = await window.electron.ipcRenderer.invoke('chat:add-reaction', {
        messageId: props.message.id,
        userDid: props.currentUserDid,
        emoji
      })
      if (result.success) {
        await loadReactionStats()
        emit('reaction-updated')
      }
    }
  } catch (error) {
    logger.error('切换表情回应失败:', error)
    antMessage.error('操作失败')
  }
}

// 添加新表情
const addReaction = async (emoji) => {
  showReactionPicker.value = false
  await toggleReaction(emoji)
}

// 组件挂载时加载表情统计
onMounted(() => {
  loadReactionStats()

  // 如果有文件传输，开始监听进度
  if (props.message.transfer_id) {
    startProgressMonitoring()
  }
})

// 组件卸载时清理定时器
onUnmounted(() => {
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }
})

// 监听文件传输进度
const startProgressMonitoring = () => {
  if (!props.message.transfer_id) {return}

  progressInterval = setInterval(async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('chat:get-transfer-progress', {
        transferId: props.message.transfer_id
      })

      if (result.success) {
        transferProgress.value = result.progress

        // 如果传输完成或失败，停止监听
        if (result.progress.status === 'completed' || result.progress.status === 'failed') {
          clearInterval(progressInterval)
          progressInterval = null
        }
      }
    } catch (error) {
      logger.error('获取传输进度失败:', error)
    }
  }, 1000) // 每秒更新一次
}

// 取消文件传输
const handleCancelTransfer = async () => {
  if (!props.message.transfer_id) {return}

  try {
    const result = await window.electron.ipcRenderer.invoke('chat:cancel-transfer', {
      transferId: props.message.transfer_id
    })

    if (result.success) {
      antMessage.success('已取消传输')
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }
    }
  } catch (error) {
    logger.error('取消传输失败:', error)
    antMessage.error('取消传输失败')
  }
}

// 方法
const handleContextMenu = (e) => {
  contextMenuVisible.value = true
}

const handleMenuClick = async ({ key }) => {
  contextMenuVisible.value = false

  switch (key) {
    case 'forward':
      await loadAvailableSessions()
      forwardModalVisible.value = true
      break
    case 'copy':
      if (props.message.content) {
        try {
          await navigator.clipboard.writeText(props.message.content)
          antMessage.success('已复制到剪贴板')
        } catch (error) {
          logger.error('复制失败:', error)
          antMessage.error('复制失败')
        }
      }
      break
    case 'delete':
      // 确认删除消息
      Modal.confirm({
        title: '删除消息',
        content: '确定要删除这条消息吗？此操作不可恢复。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            // 调用IPC删除消息
            await window.electron.ipcRenderer.invoke('chat:delete-message', props.message.id);
            // 通知父组件消息已删除
            emit('message-deleted', props.message.id);
            antMessage.success('消息已删除');
          } catch (error) {
            logger.error('删除消息失败:', error);
            antMessage.error('删除失败');
          }
        }
      });
      break
  }
}

const loadAvailableSessions = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('chat:get-sessions')
    // 过滤掉当前会话
    availableSessions.value = result.filter(s => s.id !== props.message.session_id)
  } catch (error) {
    logger.error('加载会话列表失败:', error)
    antMessage.error('加载会话列表失败')
  }
}

const handleForward = async () => {
  if (selectedSessions.value.length === 0) {
    antMessage.warning('请选择至少一个会话')
    return
  }

  try {
    forwarding.value = true
    const result = await window.electron.ipcRenderer.invoke('chat:forward-message', {
      messageId: props.message.id,
      targetSessionIds: selectedSessions.value
    })

    if (result.success) {
      antMessage.success(`消息已转发到 ${result.count} 个会话`)
      forwardModalVisible.value = false
      selectedSessions.value = []
      emit('message-forwarded', result)
    } else {
      antMessage.error(result.error || '转发失败')
    }
  } catch (error) {
    logger.error('转发消息失败:', error)
    antMessage.error('转发失败')
  } finally {
    forwarding.value = false
  }
}
const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  // 今天：显示时间
  if (diff < 24 * 60 * 60 * 1000 && now.getDate() === date.getDate()) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  // 昨天
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.getDate() === date.getDate()) {
    return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  // 一周内：显示星期
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${weekdays[date.getDay()]} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  // 更早：显示日期
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

const formatFileSize = (bytes) => {
  if (!bytes) {return '未知大小'}
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

const handleDownload = async () => {
  if (props.message.file_path) {
    try {
      // 如果文件在本地，直接打开文件选择对话框保存
      const result = await window.electron.ipcRenderer.invoke('chat:download-file', {
        messageId: props.message.id
      })

      if (result.success) {
        // 可以添加成功提示
        logger.info('文件已保存到:', result.filePath)
      }
    } catch (error) {
      logger.error('下载文件失败:', error)
    }
  }
}

const toggleVoicePlay = async () => {
  try {
    if (isPlaying.value) {
      // 停止播放
      if (audioElement) {
        audioElement.pause()
        audioElement.currentTime = 0
        audioElement = null
      }
      isPlaying.value = false
    } else {
      // 开始播放
      const result = await window.electron.ipcRenderer.invoke('chat:play-voice-message', {
        messageId: props.message.id
      })

      if (result.success) {
        // 创建音频元素并播放
        audioElement = new Audio(`file://${result.filePath}`)

        audioElement.onended = () => {
          isPlaying.value = false
          audioElement = null
        }

        audioElement.onerror = (error) => {
          logger.error('音频播放失败:', error)
          antMessage.error('语音播放失败')
          isPlaying.value = false
          audioElement = null
        }

        await audioElement.play()
        isPlaying.value = true
      } else {
        antMessage.error(result.error || '无法播放语音消息')
      }
    }
  } catch (error) {
    logger.error('播放语音消息失败:', error)
    antMessage.error('播放失败')
    isPlaying.value = false
    if (audioElement) {
      audioElement = null
    }
  }
}

// 生命周期
onMounted(() => {
  // 如果消息有transfer_id，开始监听传输进度
  if (props.message.transfer_id) {
    startProgressMonitoring()
  }
})

onUnmounted(() => {
  // 清理定时器
  if (progressInterval) {
    clearInterval(progressInterval)
    progressInterval = null
  }

  // 清理音频元素
  if (audioElement) {
    audioElement.pause()
    audioElement = null
  }
})
</script>

<style scoped>
.message-bubble {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  padding: 0 16px;
}

.message-bubble.message-sent {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
}

.message-wrapper {
  max-width: 60%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-sent .message-wrapper {
  align-items: flex-end;
}

.message-received .message-wrapper {
  align-items: flex-start;
}

.message-nickname {
  font-size: 12px;
  color: #8c8c8c;
  padding: 0 12px;
}

.message-content {
  border-radius: 8px;
  padding: 10px 14px;
  word-wrap: break-word;
  word-break: break-word;
  position: relative;
}

.message-sent .message-content {
  background-color: #1890ff;
  color: #fff;
}

.message-received .message-content {
  background-color: #f0f0f0;
  color: #262626;
}

.message-text {
  line-height: 1.5;
  white-space: pre-wrap;
}

.message-image {
  max-width: 100%;
}

.message-file {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.message-sent .message-file {
  background-color: rgba(255, 255, 255, 0.2);
}

.message-received .message-file {
  background-color: rgba(0, 0, 0, 0.05);
}

.file-icon {
  font-size: 24px;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 2px;
}

.transfer-progress {
  margin-top: 8px;
}

.transfer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.8;
}

.message-voice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}

.voice-duration {
  font-size: 12px;
}

.message-video {
  max-width: 100%;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
}

.message-sent .message-meta {
  flex-direction: row-reverse;
}

.message-time {
  font-size: 11px;
  color: #8c8c8c;
}

.message-status {
  font-size: 12px;
  display: flex;
  align-items: center;
}

/* 进入动画 */
.message-bubble {
  animation: messageSlideIn 0.2s ease-out;
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式 */
@media (max-width: 768px) {
  .message-wrapper {
    max-width: 75%;
  }

  .message-bubble {
    padding: 0 12px;
  }
}

/* 转发标记 */
.forwarded-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 4px;
  padding: 4px 8px;
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

.message-sent .forwarded-indicator {
  background-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
}

/* 转发对话框样式 */
.forward-modal-content {
  max-height: 400px;
  overflow-y: auto;
}

.session-item {
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.session-item:last-child {
  border-bottom: none;
}

.session-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.session-name {
  font-size: 14px;
  color: #262626;
}

/* 表情回应样式 */
.message-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding: 0 4px;
}

.reaction-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background-color: #f0f0f0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.reaction-item:hover {
  background-color: #e6e6e6;
  transform: scale(1.05);
}

.reaction-item.reaction-active {
  background-color: #e6f7ff;
  border-color: #1890ff;
}

.reaction-emoji {
  font-size: 16px;
  line-height: 1;
}

.reaction-count {
  font-size: 12px;
  color: #595959;
  font-weight: 500;
}

.add-reaction-btn,
.add-reaction-btn-initial {
  padding: 4px 8px !important;
  height: auto !important;
  font-size: 14px;
}

.add-reaction-container {
  margin-top: 8px;
  padding: 0 4px;
}

/* 表情选择器样式 */
.reaction-picker {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  padding: 16px;
}

.emoji-option {
  font-size: 32px;
  text-align: center;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s;
}

.emoji-option:hover {
  background-color: #f0f0f0;
  transform: scale(1.2);
}
</style>
