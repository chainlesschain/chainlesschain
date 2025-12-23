<template>
  <div class="voice-input">
    <a-tooltip :title="tooltipText">
      <a-button
        :type="isRecording ? 'primary' : 'default'"
        :danger="isRecording"
        :icon="isRecording ? h(AudioMutedOutlined) : h(AudioOutlined)"
        :loading="isProcessing"
        @click="toggleRecording"
        class="voice-button"
      >
        {{ buttonText }}
      </a-button>
    </a-tooltip>

    <!-- 录音状态显示 -->
    <a-modal
      v-model:open="showRecordingModal"
      title="语音输入"
      :footer="null"
      :closable="false"
      :maskClosable="false"
      width="400px"
    >
      <div class="recording-modal-content">
        <div class="recording-animation">
          <div class="wave-circle" :class="{ active: isRecording }"></div>
          <div class="wave-circle" :class="{ active: isRecording }"></div>
          <div class="wave-circle" :class="{ active: isRecording }"></div>
          <AudioOutlined class="microphone-icon" />
        </div>

        <div class="recording-status">
          <p class="status-text">{{ statusText }}</p>
          <p class="recording-time">{{ recordingTime }}</p>
        </div>

        <div class="recording-actions">
          <a-button danger @click="cancelRecording">
            取消
          </a-button>
          <a-button type="primary" @click="stopRecording">
            完成
          </a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, h } from 'vue';
import { message } from 'ant-design-vue';
import { AudioOutlined, AudioMutedOutlined } from '@ant-design/icons-vue';

const emit = defineEmits(['result', 'error']);

// 状态
const isRecording = ref(false);
const isProcessing = ref(false);
const showRecordingModal = ref(false);
const recordingTime = ref('00:00');
const statusText = ref('准备中...');

// Web Speech API
let recognition = null;
let recordingStartTime = null;
let recordingTimer = null;

// 计算属性
const buttonText = computed(() => {
  if (isProcessing.value) return '处理中...';
  if (isRecording.value) return '录音中';
  return '';
});

const tooltipText = computed(() => {
  if (isRecording.value) return '点击停止录音';
  return '点击开始语音输入';
});

// 初始化Web Speech API
onMounted(() => {
  initSpeechRecognition();
});

onUnmounted(() => {
  cleanup();
});

// 初始化语音识别
const initSpeechRecognition = () => {
  // 检查浏览器支持
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    message.error('您的浏览器不支持语音识别功能');
    return false;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN'; // 设置语言为中文
    recognition.continuous = true; // 连续识别
    recognition.interimResults = true; // 返回中间结果
    recognition.maxAlternatives = 1;

    // 识别结果
    recognition.onresult = handleRecognitionResult;

    // 识别错误
    recognition.onerror = handleRecognitionError;

    // 识别结束
    recognition.onend = handleRecognitionEnd;

    // 识别开始
    recognition.onstart = () => {
      statusText.value = '正在录音...';
      startRecordingTimer();
    };

    return true;
  } catch (error) {
    console.error('初始化语音识别失败:', error);
    message.error('初始化语音识别失败');
    return false;
  }
};

// 处理识别结果
const handleRecognitionResult = (event) => {
  let interimTranscript = '';
  let finalTranscript = '';

  for (let i = event.resultIndex; i < event.results.length; i++) {
    const transcript = event.results[i][0].transcript;
    if (event.results[i].isFinal) {
      finalTranscript += transcript;
    } else {
      interimTranscript += transcript;
    }
  }

  // 显示临时结果
  if (interimTranscript) {
    statusText.value = `识别中: ${interimTranscript}`;
  }

  // 发送最终结果
  if (finalTranscript) {
    emit('result', finalTranscript);
  }
};

// 处理识别错误
const handleRecognitionError = (event) => {
  console.error('语音识别错误:', event.error);

  let errorMessage = '语音识别失败';
  switch (event.error) {
    case 'no-speech':
      errorMessage = '未检测到语音';
      break;
    case 'audio-capture':
      errorMessage = '无法访问麦克风';
      break;
    case 'not-allowed':
      errorMessage = '请允许麦克风权限';
      break;
    case 'network':
      errorMessage = '网络错误';
      break;
    default:
      errorMessage = `语音识别失败: ${event.error}`;
  }

  message.error(errorMessage);
  emit('error', event.error);

  stopRecording();
};

// 处理识别结束
const handleRecognitionEnd = () => {
  if (isRecording.value) {
    // 如果还在录音状态，重新启动识别（连续识别）
    try {
      recognition.start();
    } catch (error) {
      console.error('重启识别失败:', error);
    }
  }
};

// 开始/停止录音
const toggleRecording = () => {
  if (isRecording.value) {
    stopRecording();
  } else {
    startRecording();
  }
};

// 开始录音
const startRecording = () => {
  if (!recognition) {
    if (!initSpeechRecognition()) {
      return;
    }
  }

  try {
    isRecording.value = true;
    showRecordingModal.value = true;
    statusText.value = '准备录音...';
    recordingTime.value = '00:00';

    recognition.start();
    recordingStartTime = Date.now();
  } catch (error) {
    console.error('启动录音失败:', error);
    message.error('启动录音失败');
    isRecording.value = false;
    showRecordingModal.value = false;
  }
};

// 停止录音
const stopRecording = () => {
  try {
    if (recognition && isRecording.value) {
      recognition.stop();
    }

    isRecording.value = false;
    showRecordingModal.value = false;
    statusText.value = '准备中...';
    recordingTime.value = '00:00';
    stopRecordingTimer();
  } catch (error) {
    console.error('停止录音失败:', error);
  }
};

// 取消录音
const cancelRecording = () => {
  stopRecording();
  message.info('已取消录音');
};

// 启动录音计时器
const startRecordingTimer = () => {
  recordingTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    recordingTime.value = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, 1000);
};

// 停止录音计时器
const stopRecordingTimer = () => {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
};

// 清理资源
const cleanup = () => {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  stopRecordingTimer();
};
</script>

<style scoped lang="scss">
.voice-input {
  display: inline-block;
}

.voice-button {
  &.ant-btn-primary {
    animation: pulse 1.5s infinite;
  }
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

.recording-modal-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
}

.recording-animation {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;

  .wave-circle {
    position: absolute;
    width: 100%;
    height: 100%;
    border: 2px solid #1677ff;
    border-radius: 50%;
    opacity: 0;

    &.active {
      animation: wave 2s infinite;
    }

    &:nth-child(1) {
      animation-delay: 0s;
    }

    &:nth-child(2) {
      animation-delay: 0.5s;
    }

    &:nth-child(3) {
      animation-delay: 1s;
    }
  }

  .microphone-icon {
    font-size: 48px;
    color: #1677ff;
    z-index: 10;
  }
}

@keyframes wave {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

.recording-status {
  text-align: center;
  margin-bottom: 24px;

  .status-text {
    font-size: 16px;
    color: #333;
    margin-bottom: 8px;
  }

  .recording-time {
    font-size: 24px;
    font-weight: 600;
    color: #1677ff;
    font-family: 'Monaco', 'Courier New', monospace;
  }
}

.recording-actions {
  display: flex;
  gap: 12px;

  .ant-btn {
    min-width: 80px;
  }
}
</style>
