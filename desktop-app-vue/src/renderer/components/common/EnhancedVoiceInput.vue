<template>
  <div class="enhanced-voice-input">
    <!-- 语音输入按钮 -->
    <a-tooltip :title="tooltipText">
      <a-button
        :type="isRecording ? 'primary' : 'default'"
        :danger="isRecording"
        :loading="isProcessing"
        class="voice-button"
        :class="{ recording: isRecording }"
        @click="toggleRecording"
      >
        <template #icon>
          <AudioOutlined v-if="!isRecording" />
          <AudioMutedOutlined v-else />
        </template>
        {{ buttonText }}
      </a-button>
    </a-tooltip>

    <!-- 录音状态模态框 -->
    <a-modal
      v-model:open="showRecordingModal"
      title="语音输入"
      :footer="null"
      :closable="false"
      :mask-closable="false"
      width="450px"
      centered
    >
      <div class="recording-modal-content">
        <!-- 录音动画 -->
        <div class="recording-animation">
          <div class="wave-circle" :class="{ active: isRecording }" />
          <div class="wave-circle" :class="{ active: isRecording }" />
          <div class="wave-circle" :class="{ active: isRecording }" />
          <AudioOutlined class="microphone-icon" />
        </div>

        <!-- 录音状态 -->
        <div class="recording-status">
          <p class="status-text">
            {{ statusText }}
          </p>
          <p class="recording-time">
            {{ recordingTime }}
          </p>

          <!-- 音量指示器 -->
          <div class="volume-indicator">
            <div class="volume-bar" :style="{ width: volumeLevel + '%' }" />
          </div>
        </div>

        <!-- 实时转录文本 -->
        <div v-if="partialText" class="partial-transcript">
          <a-typography-paragraph :ellipsis="{ rows: 3, expandable: true }">
            {{ partialText }}
          </a-typography-paragraph>
        </div>

        <!-- 操作按钮 -->
        <div class="recording-actions">
          <a-space>
            <a-button danger @click="cancelRecording">
              <template #icon>
                <CloseOutlined />
              </template>
              取消
            </a-button>
            <a-button v-if="isRecording && !isPaused" @click="pauseRecording">
              <template #icon>
                <PauseCircleOutlined />
              </template>
              暂停
            </a-button>
            <a-button v-if="isPaused" type="default" @click="resumeRecording">
              <template #icon>
                <PlayCircleOutlined />
              </template>
              继续
            </a-button>
            <a-button type="primary" @click="stopRecording">
              <template #icon>
                <CheckOutlined />
              </template>
              完成
            </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import {
  AudioOutlined,
  AudioMutedOutlined,
  CloseOutlined,
  CheckOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons-vue";

const emit = defineEmits(["result", "error", "partial"]);

// 状态
const isRecording = ref(false);
const isPaused = ref(false);
const isProcessing = ref(false);
const showRecordingModal = ref(false);
const recordingTime = ref("00:00");
const statusText = ref("准备中...");
const partialText = ref("");
const volumeLevel = ref(0);

// Web Speech API
let recognition = null;
let recordingStartTime = null;
let recordingTimer = null;
let pauseStartTime = null;
let totalPausedTime = 0;

// 计算属性
const buttonText = computed(() => {
  if (isProcessing.value) {
    return "处理中...";
  }
  if (isRecording.value) {
    return "录音中";
  }
  return "";
});

const tooltipText = computed(() => {
  if (isRecording.value) {
    return "点击停止录音";
  }
  return "点击开始语音输入";
});

// 初始化
onMounted(() => {
  initSpeechRecognition();
});

onUnmounted(() => {
  cleanup();
});

// 初始化语音识别
const initSpeechRecognition = () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    message.error("您的浏览器不支持语音识别功能");
    return false;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = handleRecognitionResult;
    recognition.onerror = handleRecognitionError;
    recognition.onend = handleRecognitionEnd;
    recognition.onstart = () => {
      statusText.value = "正在录音...";
      startRecordingTimer();
    };

    return true;
  } catch (error) {
    logger.error("初始化语音识别失败:", error);
    message.error("初始化语音识别失败");
    return false;
  }
};

// 处理识别结果
const handleRecognitionResult = (event) => {
  let interimTranscript = "";
  let finalTranscript = "";

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
    partialText.value = interimTranscript;
    statusText.value = "识别中...";
    emit("partial", interimTranscript);
  }

  // 发送最终结果
  if (finalTranscript) {
    partialText.value = finalTranscript;
    emit("result", finalTranscript);
  }

  // 模拟音量变化
  animateVolume();
};

// 处理识别错误
const handleRecognitionError = (event) => {
  logger.error("语音识别错误:", event.error);

  let errorMessage = "语音识别失败";
  switch (event.error) {
    case "no-speech":
      errorMessage = "未检测到语音";
      break;
    case "audio-capture":
      errorMessage = "无法访问麦克风";
      break;
    case "not-allowed":
      errorMessage = "请允许麦克风权限";
      break;
    case "network":
      errorMessage = "网络错误";
      break;
    default:
      errorMessage = `语音识别失败: ${event.error}`;
  }

  message.error(errorMessage);
  emit("error", event.error);
  stopRecording();
};

// 处理识别结束
const handleRecognitionEnd = () => {
  if (isRecording.value && !isPaused.value) {
    try {
      recognition.start();
    } catch (error) {
      logger.error("重启识别失败:", error);
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
    isPaused.value = false;
    showRecordingModal.value = true;
    statusText.value = "准备录音...";
    recordingTime.value = "00:00";
    partialText.value = "";
    totalPausedTime = 0;

    recognition.start();
    recordingStartTime = Date.now();
  } catch (error) {
    logger.error("启动录音失败:", error);
    message.error("启动录音失败");
    isRecording.value = false;
    showRecordingModal.value = false;
  }
};

// 暂停录音
const pauseRecording = () => {
  if (recognition && isRecording.value) {
    try {
      recognition.stop();
      isPaused.value = true;
      pauseStartTime = Date.now();
      statusText.value = "已暂停";
      stopRecordingTimer();
    } catch (error) {
      logger.error("暂停录音失败:", error);
    }
  }
};

// 恢复录音
const resumeRecording = () => {
  if (recognition && isPaused.value) {
    try {
      totalPausedTime += Date.now() - pauseStartTime;
      isPaused.value = false;
      recognition.start();
      statusText.value = "正在录音...";
      startRecordingTimer();
    } catch (error) {
      logger.error("恢复录音失败:", error);
    }
  }
};

// 停止录音
const stopRecording = () => {
  try {
    if (recognition && isRecording.value) {
      recognition.stop();
    }

    isRecording.value = false;
    isPaused.value = false;
    showRecordingModal.value = false;
    statusText.value = "准备中...";
    recordingTime.value = "00:00";
    partialText.value = "";
    volumeLevel.value = 0;
    stopRecordingTimer();
  } catch (error) {
    logger.error("停止录音失败:", error);
  }
};

// 取消录音
const cancelRecording = () => {
  stopRecording();
  message.info("已取消录音");
};

// 启动录音计时器
const startRecordingTimer = () => {
  recordingTimer = setInterval(() => {
    const elapsed = Math.floor(
      (Date.now() - recordingStartTime - totalPausedTime) / 1000,
    );
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    recordingTime.value = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, 1000);
};

// 停止录音计时器
const stopRecordingTimer = () => {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
};

// 模拟音量动画
const animateVolume = () => {
  volumeLevel.value = Math.random() * 60 + 40; // 40-100%
  setTimeout(() => {
    volumeLevel.value = Math.random() * 40 + 20; // 20-60%
  }, 100);
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
.enhanced-voice-input {
  display: inline-block;
}

.voice-button {
  transition: all 0.3s ease;

  &.recording {
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
  padding: 24px;
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
  width: 100%;

  .status-text {
    font-size: 16px;
    color: #333;
    margin-bottom: 8px;
  }

  .recording-time {
    font-size: 28px;
    font-weight: 600;
    color: #1677ff;
    font-family: "Monaco", "Courier New", monospace;
    margin-bottom: 16px;
  }

  .volume-indicator {
    width: 100%;
    height: 6px;
    background: #f0f0f0;
    border-radius: 3px;
    overflow: hidden;

    .volume-bar {
      height: 100%;
      background: linear-gradient(90deg, #52c41a, #1677ff);
      transition: width 0.1s ease;
      border-radius: 3px;
    }
  }
}

.partial-transcript {
  width: 100%;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 24px;
  min-height: 60px;
  max-height: 120px;
  overflow-y: auto;

  :deep(.ant-typography) {
    margin-bottom: 0;
    color: #666;
    font-size: 14px;
    line-height: 1.6;
  }
}

.recording-actions {
  width: 100%;
  display: flex;
  justify-content: center;

  .ant-space {
    width: 100%;
    justify-content: center;
  }

  .ant-btn {
    min-width: 90px;
  }
}
</style>
