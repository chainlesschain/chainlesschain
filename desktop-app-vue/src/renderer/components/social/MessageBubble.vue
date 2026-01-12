<template>
  <div
    class="message-bubble"
    :class="{ 'message-sent': isSent, 'message-received': !isSent }"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- 头像 -->
    <div v-if="!isSent" class="message-avatar">
      <a-avatar :size="32">
        <template #icon><UserOutlined /></template>
      </a-avatar>
    </div>

    <!-- 消息内容 -->
    <div class="message-wrapper">
      <!-- 发送者昵称（仅接收的消息显示） -->
      <div v-if="!isSent && showNickname" class="message-nickname">
        {{ senderName }}
      </div>

      <!-- 消息气泡 -->
      <div class="message-content" :class="`type-${message.message_type || 'text'}`">
        <!-- 转发标记 -->
        <div v-if="message.forwarded_from_id" class="forwarded-indicator">
          <ShareAltOutlined /> 转发的消息
        </div>

        <!-- 文本消息 -->
        <div v-if="message.message_type === 'text' || !message.message_type" class="message-text">
          {{ message.content }}
        </div>

        <!-- 图片消息 -->
        <div v-else-if="message.message_type === 'image'" class="message-image">
          <a-image
            :src="message.file_path"
            :alt="message.content"
            :width="200"
            :preview="true"
          />
        </div>

        <!-- 文件消息 -->
        <div v-else-if="message.message_type === 'file'" class="message-file">
          <div class="file-icon">
            <FileOutlined />
          </div>
          <div class="file-info">
            <div class="file-name">{{ message.content }}</div>
            <div class="file-size">{{ formatFileSize(message.file_size) }}</div>
          </div>
          <a-button type="link" size="small" @click="handleDownload">
            <DownloadOutlined />
          </a-button>
        </div>

        <!-- 语音消息 -->
        <div v-else-if="message.message_type === 'voice'" class="message-voice">
          <a-button type="text" size="small" @click="toggleVoicePlay">
            <SoundOutlined v-if="!isPlaying" />
            <PauseCircleOutlined v-else />
          </a-button>
          <div class="voice-duration">{{ message.duration || '0:00' }}</div>
        </div>

        <!-- 视频消息 -->
        <div v-else-if="message.message_type === 'video'" class="message-video">
          <video
            :src="message.file_path"
            controls
            :style="{ maxWidth: '300px', maxHeight: '200px' }"
          />
        </div>

        <!-- 未知类型 -->
        <div v-else class="message-text">
          {{ message.content }}
        </div>
      </div>

      <!-- 消息元数据 -->
      <div class="message-meta">
        <span class="message-time">{{ formatTime(message.timestamp) }}</span>

        <!-- 发送状态（仅发送的消息显示） -->
        <span v-if="isSent" class="message-status">
          <CheckOutlined v-if="message.status === 'sent'" :style="{ color: '#8c8c8c' }" />
          <CheckCircleOutlined v-else-if="message.status === 'delivered'" :style="{ color: '#1890ff' }" />
          <CheckCircleFilled v-else-if="message.status === 'read'" :style="{ color: '#52c41a' }" />
          <CloseCircleOutlined v-else-if="message.status === 'failed'" :style="{ color: '#ff4d4f' }" />
        </span>
      </div>
    </div>

    <!-- 头像（发送的消息） -->
    <div v-if="isSent" class="message-avatar">
      <a-avatar :size="32" :style="{ backgroundColor: '#1890ff' }">
        <template #icon><UserOutlined /></template>
      </a-avatar>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  UserOutlined,
  FileOutlined,
  DownloadOutlined,
  SoundOutlined,
  PauseCircleOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  CheckCircleFilled,
  CloseCircleOutlined
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

// 状态
const isPlaying = ref(false)

// 计算属性
const isSent = computed(() => {
  return props.message.sender_did === props.currentUserDid
})

// 方法
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
  if (!bytes) return '未知大小'
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
        console.log('文件已保存到:', result.filePath)
      }
    } catch (error) {
      console.error('下载文件失败:', error)
    }
  }
}

const toggleVoicePlay = () => {
  isPlaying.value = !isPlaying.value
  // TODO: 实现语音播放逻辑
}
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
</style>
