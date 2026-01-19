<template>
  <div class="voice-message-recorder">
    <!-- 录音按钮 -->
    <a-tooltip
      v-if="!isRecording"
      title="语音消息"
    >
      <a-button
        type="text"
        size="small"
        :loading="isInitializing"
        @click="startRecording"
      >
        <AudioOutlined />
      </a-button>
    </a-tooltip>

    <!-- 录音中界面 -->
    <a-modal
      v-model:open="isRecording"
      title="录制语音消息"
      :closable="false"
      :mask-closable="false"
      width="400px"
      :footer="null"
    >
      <div class="recording-content">
        <!-- 录音指示器 -->
        <div class="recording-indicator">
          <div class="pulse-container">
            <span class="pulse" />
            <AudioOutlined class="mic-icon" />
          </div>
          <div class="status-text">
            {{ isPaused ? '已暂停' : '正在录音...' }}
          </div>
        </div>

        <!-- 录音时长 -->
        <div class="recording-duration">
          {{ formatDuration(recordingDuration) }}
        </div>

        <!-- 音量指示器 -->
        <div class="volume-indicator">
          <a-progress
            :percent="Math.round(volume * 100)"
            :show-info="false"
            :stroke-color="{
              '0%': '#108ee9',
              '100%': '#87d068',
            }"
          />
        </div>

        <!-- 控制按钮 -->
        <div class="recording-controls">
          <a-space size="large">
            <a-button
              shape="circle"
              size="large"
              @click="isPaused ? resumeRecording() : pauseRecording()"
            >
              <template #icon>
                <PlayCircleOutlined v-if="isPaused" />
                <PauseOutlined v-else />
              </template>
            </a-button>

            <a-button
              type="primary"
              shape="circle"
              size="large"
              @click="stopRecording"
            >
              <template #icon>
                <CheckOutlined />
              </template>
            </a-button>

            <a-button
              danger
              shape="circle"
              size="large"
              @click="cancelRecording"
            >
              <template #icon>
                <CloseOutlined />
              </template>
            </a-button>
          </a-space>
        </div>

        <div class="recording-hint">
          <a-typography-text type="secondary">
            点击 ✓ 发送，点击 ✕ 取消
          </a-typography-text>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  AudioOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  CheckOutlined,
  CloseOutlined
} from '@ant-design/icons-vue'

const emit = defineEmits(['voice-recorded'])

// 状态
const isRecording = ref(false)
const isPaused = ref(false)
const isInitializing = ref(false)
const volume = ref(0)
const recordingDuration = ref(0)
let recordingTimer = null
let volumeMonitor = null

// 开始录音
const startRecording = async () => {
  try {
    isInitializing.value = true

    // 调用主进程开始录音
    const result = await window.electron.ipcRenderer.invoke('speech:start-realtime-recording', {
      sampleRate: 16000,
      channels: 1
    })

    if (result.success) {
      isRecording.value = true
      recordingDuration.value = 0

      // 启动计时器
      recordingTimer = setInterval(() => {
        recordingDuration.value++
      }, 1000)

      // 启动音量监控
      startVolumeMonitoring()

      message.success('开始录音')
    } else {
      message.error(result.error || '启动录音失败')
    }
  } catch (error) {
    logger.error('启动录音失败:', error)
    message.error('启动录音失败')
  } finally {
    isInitializing.value = false
  }
}

// 暂停录音
const pauseRecording = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('speech:pause-realtime-recording')
    if (result.success) {
      isPaused.value = true
      clearInterval(recordingTimer)
      recordingTimer = null
    }
  } catch (error) {
    logger.error('暂停录音失败:', error)
    message.error('暂停失败')
  }
}

// 恢复录音
const resumeRecording = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('speech:resume-realtime-recording')
    if (result.success) {
      isPaused.value = false
      recordingTimer = setInterval(() => {
        recordingDuration.value++
      }, 1000)
    }
  } catch (error) {
    logger.error('恢复录音失败:', error)
    message.error('恢复失败')
  }
}

// 停止录音并发送
const stopRecording = async () => {
  try {
    // 停止录音
    const result = await window.electron.ipcRenderer.invoke('speech:stop-realtime-recording')

    if (result.success && result.audioFile) {
      // 清理状态
      cleanup()

      // 触发事件，传递录音文件信息
      emit('voice-recorded', {
        filePath: result.audioFile,
        duration: formatDuration(recordingDuration.value),
        durationSeconds: recordingDuration.value
      })

      message.success('语音消息已录制')
    } else {
      message.error(result.error || '录音失败')
      cleanup()
    }
  } catch (error) {
    logger.error('停止录音失败:', error)
    message.error('停止录音失败')
    cleanup()
  }
}

// 取消录音
const cancelRecording = async () => {
  try {
    await window.electron.ipcRenderer.invoke('speech:cancel-realtime-recording')
    cleanup()
    message.info('已取消录音')
  } catch (error) {
    logger.error('取消录音失败:', error)
    cleanup()
  }
}

// 音量监控
const startVolumeMonitoring = () => {
  volumeMonitor = setInterval(() => {
    // 模拟音量变化（实际应该从音频流获取）
    volume.value = Math.random() * 0.8 + 0.2
  }, 100)
}

// 格式化时长
const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 清理资源
const cleanup = () => {
  isRecording.value = false
  isPaused.value = false
  recordingDuration.value = 0
  volume.value = 0

  if (recordingTimer) {
    clearInterval(recordingTimer)
    recordingTimer = null
  }

  if (volumeMonitor) {
    clearInterval(volumeMonitor)
    volumeMonitor = null
  }
}

// 组件卸载时清理
onUnmounted(() => {
  cleanup()
})
</script>

<style scoped>
.voice-message-recorder {
  display: inline-block;
}

.recording-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
}

.recording-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.pulse-container {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse {
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background-color: #1890ff;
  opacity: 0.6;
  animation: pulse 1.5s ease-out infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0.8);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.4;
  }
  100% {
    transform: scale(0.8);
    opacity: 0.8;
  }
}

.mic-icon {
  font-size: 32px;
  color: #1890ff;
  z-index: 1;
}

.status-text {
  font-size: 16px;
  font-weight: 500;
  color: #262626;
}

.recording-duration {
  font-size: 32px;
  font-weight: 600;
  color: #1890ff;
  margin-bottom: 20px;
  font-family: 'Courier New', monospace;
}

.volume-indicator {
  width: 100%;
  margin-bottom: 30px;
}

.recording-controls {
  margin-bottom: 16px;
}

.recording-hint {
  text-align: center;
}
</style>
