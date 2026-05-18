<template>
  <view class="voice-input-container">
    <!-- 语音输入按钮 -->
    <view
      class="voice-button"
      :class="{ 'recording': isRecording, 'disabled': disabled }"
      @touchstart="handleTouchStart"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchCancel"
    >
      <view class="button-content">
        <text class="voice-icon">{{ isRecording ? '🎙️' : '🎤' }}</text>
        <text class="voice-text">{{ buttonText }}</text>
      </view>

      <!-- 录音动画 -->
      <view v-if="isRecording" class="recording-animation">
        <view class="wave wave-1"></view>
        <view class="wave wave-2"></view>
        <view class="wave wave-3"></view>
      </view>
    </view>

    <!-- 录音提示 -->
    <view v-if="isRecording" class="recording-tip">
      <text class="tip-text">{{ recordingTip }}</text>
      <text class="tip-duration">{{ formatDuration(recordDuration) }}</text>
    </view>

    <!-- 录音模态框 -->
    <view v-if="showModal" class="voice-modal" @click="closeModal">
      <view class="modal-content" @click.stop>
        <view class="modal-header">
          <text class="modal-title">语音输入</text>
          <view class="close-btn" @click="closeModal">
            <text>✕</text>
          </view>
        </view>

        <view class="modal-body">
          <!-- 录音状态 -->
          <view v-if="isRecording" class="recording-status">
            <view class="recording-icon">🎙️</view>
            <text class="recording-text">正在录音...</text>
            <text class="duration-text">{{ formatDuration(recordDuration) }}</text>
          </view>

          <!-- 处理状态 -->
          <view v-else-if="isProcessing" class="processing-status">
            <view class="loading-icon">⏳</view>
            <text class="processing-text">{{ processingText }}</text>
          </view>

          <!-- 结果显示 -->
          <view v-else-if="recognizedText" class="result-display">
            <text class="result-label">识别结果：</text>
            <view class="result-text">{{ recognizedText }}</view>
          </view>
        </view>

        <view class="modal-footer">
          <view v-if="isRecording" class="action-buttons">
            <view class="action-btn cancel" @click="cancelRecording">
              <text>取消</text>
            </view>
            <view class="action-btn confirm" @click="stopRecording">
              <text>完成</text>
            </view>
          </view>
          <view v-else-if="recognizedText" class="action-buttons">
            <view class="action-btn cancel" @click="retryRecording">
              <text>重录</text>
            </view>
            <view class="action-btn confirm" @click="confirmText">
              <text>确认</text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import voiceService from '@/services/voice'

export default {
  name: 'VoiceInput',

  props: {
    // 是否禁用
    disabled: {
      type: Boolean,
      default: false
    },
    // 最长录音时长（秒）
    maxDuration: {
      type: Number,
      default: 60
    },
    // 是否自动识别
    autoRecognize: {
      type: Boolean,
      default: true
    },
    // 是否显示模态框
    useModal: {
      type: Boolean,
      default: false
    }
  },

  data() {
    return {
      isRecording: false,
      isProcessing: false,
      showModal: false,
      recordDuration: 0,
      recognizedText: '',
      processingText: '正在识别...',
      audioPath: '',
      timer: null
    }
  },

  computed: {
    buttonText() {
      if (this.isRecording) {
        return '松开发送'
      }
      return '按住说话'
    },

    recordingTip() {
      if (this.recordDuration >= this.maxDuration - 5) {
        return '即将结束'
      }
      return '上滑取消'
    }
  },

  methods: {
    /**
     * 触摸开始
     */
    async handleTouchStart(e) {
      if (this.disabled || this.isRecording) return

      // 震动反馈
      uni.vibrateShort()

      // 显示模态框
      if (this.useModal) {
        this.showModal = true
      }

      // 开始录音
      await this.startRecording()
    },

    /**
     * 触摸结束
     */
    async handleTouchEnd(e) {
      if (!this.isRecording) return

      // 检查是否上滑取消
      const touch = e.changedTouches[0]
      const startY = e.currentTarget.offsetTop
      const endY = touch.pageY

      if (startY - endY > 50) {
        // 上滑取消
        this.cancelRecording()
      } else {
        // 正常结束
        await this.stopRecording()
      }
    },

    /**
     * 触摸取消
     */
    handleTouchCancel() {
      if (this.isRecording) {
        this.cancelRecording()
      }
    },

    /**
     * 开始录音
     */
    async startRecording() {
      try {
        const success = await voiceService.startRecording()

        if (success) {
          this.isRecording = true
          this.recordDuration = 0

          // 开始计时
          this.startTimer()

          this.$emit('start')
        }
      } catch (error) {
        console.error('开始录音失败:', error)
        uni.showToast({
          title: '录音失败',
          icon: 'none'
        })
      }
    },

    /**
     * 停止录音
     */
    async stopRecording() {
      try {
        this.stopTimer()

        const audioPath = await voiceService.stopRecording()
        this.audioPath = audioPath
        this.isRecording = false

        this.$emit('stop', { audioPath, duration: this.recordDuration })

        // 自动识别
        if (this.autoRecognize) {
          await this.recognizeAudio(audioPath)
        }
      } catch (error) {
        console.error('停止录音失败:', error)
        uni.showToast({
          title: '录音失败',
          icon: 'none'
        })
      }
    },

    /**
     * 取消录音
     */
    cancelRecording() {
      this.stopTimer()
      voiceService.cancelRecording()
      this.isRecording = false
      this.recordDuration = 0

      if (this.useModal) {
        this.closeModal()
      }

      this.$emit('cancel')

      uni.showToast({
        title: '已取消',
        icon: 'none'
      })
    },

    /**
     * 识别音频
     */
    async recognizeAudio(audioPath) {
      this.isProcessing = true
      this.processingText = '正在识别...'

      try {
        const text = await voiceService.speechToText(audioPath)
        this.recognizedText = text
        this.isProcessing = false

        this.$emit('recognize', { text, audioPath })

        // 如果不使用模态框，直接确认
        if (!this.useModal) {
          this.confirmText()
        }
      } catch (error) {
        console.error('语音识别失败:', error)
        this.isProcessing = false

        uni.showModal({
          title: '识别失败',
          content: error.message || '语音识别失败，请重试',
          showCancel: true,
          confirmText: '重试',
          success: (res) => {
            if (res.confirm) {
              this.retryRecording()
            } else {
              this.closeModal()
            }
          }
        })
      }
    },

    /**
     * 确认文本
     */
    confirmText() {
      this.$emit('confirm', {
        text: this.recognizedText,
        audioPath: this.audioPath
      })

      this.closeModal()
      this.reset()
    },

    /**
     * 重新录音
     */
    retryRecording() {
      this.reset()
      this.startRecording()
    },

    /**
     * 关闭模态框
     */
    closeModal() {
      this.showModal = false
      this.reset()
    },

    /**
     * 重置状态
     */
    reset() {
      this.isRecording = false
      this.isProcessing = false
      this.recordDuration = 0
      this.recognizedText = ''
      this.audioPath = ''
      this.stopTimer()
    },

    /**
     * 开始计时
     */
    startTimer() {
      this.timer = setInterval(() => {
        this.recordDuration++

        // 达到最大时长自动停止
        if (this.recordDuration >= this.maxDuration) {
          this.stopRecording()
        }
      }, 1000)
    },

    /**
     * 停止计时
     */
    stopTimer() {
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    },

    /**
     * 格式化时长
     */
    formatDuration(seconds) {
      const mins = Math.floor(seconds / 60)
      const secs = seconds % 60
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
  },

  beforeDestroy() {
    this.stopTimer()
    if (this.isRecording) {
      voiceService.cancelRecording()
    }
  }
}
</script>

<style scoped>
.voice-input-container {
  position: relative;
}

/* 语音按钮 */
.voice-button {
  position: relative;
  width: 100%;
  height: 48px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: all 0.3s;
}

.voice-button.recording {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  transform: scale(1.05);
}

.voice-button.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.button-content {
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1;
}

.voice-icon {
  font-size: 24px;
}

.voice-text {
  font-size: 15px;
  font-weight: 600;
  color: white;
}

/* 录音动画 */
.recording-animation {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.wave {
  width: 4px;
  height: 16px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 2px;
  animation: wave 1s ease-in-out infinite;
}

.wave-1 {
  animation-delay: 0s;
}

.wave-2 {
  animation-delay: 0.2s;
}

.wave-3 {
  animation-delay: 0.4s;
}

@keyframes wave {
  0%, 100% {
    height: 16px;
  }
  50% {
    height: 32px;
  }
}

/* 录音提示 */
.recording-tip {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  padding: 8px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
}

.tip-text {
  font-size: 13px;
  color: white;
}

.tip-duration {
  font-size: 13px;
  color: #f5576c;
  font-weight: 600;
}

/* 模态框 */
.voice-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-content {
  width: 80%;
  max-width: 400px;
  background: white;
  border-radius: 16px;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.modal-title {
  font-size: 17px;
  font-weight: 600;
  color: #1a1a1a;
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #f5f5f5;
  font-size: 18px;
  color: #666;
}

.modal-body {
  padding: 32px 20px;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 录音状态 */
.recording-status,
.processing-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.recording-icon,
.loading-icon {
  font-size: 64px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

.recording-text,
.processing-text {
  font-size: 16px;
  color: #666;
}

.duration-text {
  font-size: 24px;
  font-weight: 600;
  color: #667eea;
}

/* 结果显示 */
.result-display {
  width: 100%;
}

.result-label {
  display: block;
  font-size: 14px;
  color: #999;
  margin-bottom: 12px;
}

.result-text {
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.6;
  color: #1a1a1a;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid #f0f0f0;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.action-btn {
  flex: 1;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
}

.action-btn.cancel {
  background: #f5f5f5;
  color: #666;
}

.action-btn.confirm {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}
</style>
