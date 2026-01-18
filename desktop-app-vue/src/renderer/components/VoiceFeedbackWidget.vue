<template>
  <div class="voice-feedback-widget" :class="{ active: isActive, rtl: isRTL }">
    <!-- 主控制按钮 -->
    <a-tooltip :title="tooltipText">
      <a-button
        :type="buttonType"
        :danger="isRecording"
        :loading="isProcessing"
        @click="toggleRecording"
        class="voice-control-button"
        size="large"
        shape="circle"
      >
        <template #icon>
          <component :is="currentIcon" />
        </template>
      </a-button>
    </a-tooltip>

    <!-- 实时反馈面板 -->
    <a-card
      v-if="showFeedbackPanel"
      class="voice-feedback-panel"
      :bordered="false"
    >
      <!-- 语言指示器 -->
      <div class="language-indicator">
        <GlobalOutlined />
        <span>{{ currentLanguageName }}</span>
        <a-tag v-if="detectedLanguage" color="blue" size="small">
          自动检测: {{ detectedLanguage }}
        </a-tag>
      </div>

      <!-- 波形可视化 -->
      <div class="waveform-container">
        <canvas ref="waveformCanvas" class="waveform-canvas"></canvas>
        <div class="waveform-overlay">
          <div class="recording-indicator" v-if="isRecording">
            <span class="pulse-dot"></span>
            <span class="recording-text">{{ recordingTime }}</span>
          </div>
        </div>
      </div>

      <!-- 置信度指示器 -->
      <div class="confidence-indicator" v-if="currentConfidence > 0">
        <span class="confidence-label">识别置信度</span>
        <a-progress
          :percent="Math.round(currentConfidence * 100)"
          :status="confidenceStatus"
          :stroke-color="confidenceColor"
          size="small"
        />
      </div>

      <!-- 实时转录预览 -->
      <div class="transcription-preview" v-if="interimTranscript">
        <div class="preview-label">
          <SoundOutlined />
          <span>实时转录</span>
        </div>
        <div class="preview-text" :class="{ rtl: isRTL }">
          {{ interimTranscript }}
          <span class="cursor-blink">|</span>
        </div>
      </div>

      <!-- 命令提示 -->
      <div
        class="command-hints"
        v-if="showCommandHints && suggestedCommands.length > 0"
      >
        <div class="hints-label">
          <BulbOutlined />
          <span>推荐命令</span>
        </div>
        <div class="hints-list">
          <a-tag
            v-for="cmd in suggestedCommands"
            :key="cmd.name"
            color="processing"
            @click="executeCommand(cmd)"
            class="command-hint-tag"
          >
            {{ cmd.name }}
          </a-tag>
        </div>
      </div>

      <!-- 状态消息 -->
      <div class="status-message" v-if="statusMessage">
        <a-alert
          :message="statusMessage"
          :type="statusType"
          :show-icon="true"
          closable
          @close="statusMessage = ''"
        />
      </div>

      <!-- 控制按钮组 -->
      <div class="control-buttons">
        <a-space>
          <a-button
            v-if="isRecording"
            danger
            @click="cancelRecording"
            size="small"
          >
            <template #icon><CloseOutlined /></template>
            取消
          </a-button>
          <a-button
            v-if="isRecording"
            type="primary"
            @click="stopRecording"
            size="small"
          >
            <template #icon><CheckOutlined /></template>
            完成
          </a-button>
          <a-button
            v-if="!isRecording && !isProcessing"
            @click="openSettings"
            size="small"
          >
            <template #icon><SettingOutlined /></template>
            设置
          </a-button>
        </a-space>
      </div>
    </a-card>

    <!-- 语音设置抽屉 -->
    <a-drawer
      v-model:open="showSettingsDrawer"
      title="语音识别设置"
      placement="right"
      width="400"
    >
      <a-form layout="vertical">
        <!-- 语言选择 -->
        <a-form-item label="识别语言">
          <a-select
            v-model:value="selectedLanguage"
            @change="onLanguageChange"
            show-search
            :filter-option="filterLanguageOption"
          >
            <a-select-option
              v-for="lang in availableLanguages"
              :key="lang.code"
              :value="lang.code"
            >
              {{ lang.nativeName }} ({{ lang.name }})
            </a-select-option>
          </a-select>
        </a-form-item>

        <!-- 自动语言检测 -->
        <a-form-item>
          <a-checkbox v-model:checked="autoDetectLanguage">
            自动检测语言
          </a-checkbox>
        </a-form-item>

        <!-- 识别引擎 -->
        <a-form-item label="识别引擎">
          <a-radio-group v-model:value="selectedEngine">
            <a-radio value="whisper-api">Whisper API (云端)</a-radio>
            <a-radio value="whisper-local">Whisper Local (本地)</a-radio>
            <a-radio value="webspeech">Web Speech API</a-radio>
          </a-radio-group>
        </a-form-item>

        <!-- 显示选项 -->
        <a-form-item label="显示选项">
          <a-checkbox-group v-model:value="displayOptions">
            <a-checkbox value="waveform">波形可视化</a-checkbox>
            <a-checkbox value="confidence">置信度指示器</a-checkbox>
            <a-checkbox value="interim">实时转录</a-checkbox>
            <a-checkbox value="commands">命令提示</a-checkbox>
          </a-checkbox-group>
        </a-form-item>

        <!-- 学习统计 -->
        <a-form-item label="学习统计">
          <a-statistic-group>
            <a-statistic
              title="总转录次数"
              :value="learningStats.totalTranscriptions"
            />
            <a-statistic
              title="平均置信度"
              :value="(learningStats.averageConfidence * 100).toFixed(1)"
              suffix="%"
            />
            <a-statistic
              title="自定义词汇"
              :value="learningStats.vocabularySize"
            />
          </a-statistic-group>
        </a-form-item>

        <!-- 操作按钮 -->
        <a-form-item>
          <a-space direction="vertical" style="width: 100%">
            <a-button block @click="exportVoiceData">
              <template #icon><ExportOutlined /></template>
              导出语音数据
            </a-button>
            <a-button block @click="importVoiceData">
              <template #icon><ImportOutlined /></template>
              导入语音数据
            </a-button>
            <a-button block danger @click="resetVoiceData">
              <template #icon><DeleteOutlined /></template>
              重置语音数据
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { message } from "ant-design-vue";
import {
  AudioOutlined,
  AudioMutedOutlined,
  LoadingOutlined,
  GlobalOutlined,
  SoundOutlined,
  BulbOutlined,
  CloseOutlined,
  CheckOutlined,
  SettingOutlined,
  ExportOutlined,
  ImportOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  autoStart: {
    type: Boolean,
    default: false,
  },
  showPanel: {
    type: Boolean,
    default: true,
  },
  enableCommandHints: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["result", "error", "interim", "command"]);

// 状态
const isRecording = ref(false);
const isProcessing = ref(false);
const isActive = ref(false);
const showFeedbackPanel = ref(false);
const showSettingsDrawer = ref(false);

// 转录相关
const interimTranscript = ref("");
const finalTranscript = ref("");
const currentConfidence = ref(0);
const detectedLanguage = ref("");

// 语言相关
const selectedLanguage = ref("zh-CN");
const autoDetectLanguage = ref(true);
const availableLanguages = ref([]);
const isRTL = ref(false);

// 引擎相关
const selectedEngine = ref("whisper-api");

// 显示选项
const displayOptions = ref(["waveform", "confidence", "interim", "commands"]);

// 命令提示
const showCommandHints = ref(true);
const suggestedCommands = ref([]);

// 状态消息
const statusMessage = ref("");
const statusType = ref("info");

// 录音时间
const recordingTime = ref("00:00");
const recordingStartTime = ref(null);
const recordingTimer = ref(null);

// 波形相关
const waveformCanvas = ref(null);
const audioContext = ref(null);
const analyser = ref(null);
const animationFrame = ref(null);

// 学习统计
const learningStats = ref({
  totalTranscriptions: 0,
  averageConfidence: 0,
  vocabularySize: 0,
});

// 计算属性
const currentIcon = computed(() => {
  if (isProcessing.value) return LoadingOutlined;
  if (isRecording.value) return AudioMutedOutlined;
  return AudioOutlined;
});

const buttonType = computed(() => {
  if (isRecording.value) return "primary";
  if (isActive.value) return "primary";
  return "default";
});

const tooltipText = computed(() => {
  if (isRecording.value) return "点击停止录音";
  if (isProcessing.value) return "正在处理...";
  return "点击开始语音输入";
});

const currentLanguageName = computed(() => {
  const lang = availableLanguages.value.find(
    (l) => l.code === selectedLanguage.value,
  );
  return lang ? lang.nativeName : "未知语言";
});

const confidenceStatus = computed(() => {
  if (currentConfidence.value >= 0.8) return "success";
  if (currentConfidence.value >= 0.6) return "normal";
  return "exception";
});

const confidenceColor = computed(() => {
  if (currentConfidence.value >= 0.8) return "#52c41a";
  if (currentConfidence.value >= 0.6) return "#1890ff";
  return "#ff4d4f";
});

// 生命周期
onMounted(async () => {
  await initializeVoiceSystem();
  if (props.autoStart) {
    startRecording();
  }
});

onUnmounted(() => {
  cleanup();
});

// 监听语言变化
watch(selectedLanguage, (newLang) => {
  const lang = availableLanguages.value.find((l) => l.code === newLang);
  isRTL.value = lang?.rtl || false;
});

// 初始化语音系统
const initializeVoiceSystem = async () => {
  try {
    // 加载可用语言
    const languages = await window.electron.ipcRenderer.invoke(
      "speech:getLanguages",
    );
    availableLanguages.value = languages;

    // 加载学习统计
    const stats = await window.electron.ipcRenderer.invoke(
      "speech:getLearningStats",
    );
    learningStats.value = stats;

    // 加载命令建议
    const commands = await window.electron.ipcRenderer.invoke(
      "speech:getCommandSuggestions",
    );
    suggestedCommands.value = commands;

    console.log("[VoiceFeedback] 语音系统已初始化");
  } catch (error) {
    console.error("[VoiceFeedback] 初始化失败:", error);
    message.error("语音系统初始化失败");
  }
};

// 切换录音
const toggleRecording = () => {
  if (isRecording.value) {
    stopRecording();
  } else {
    startRecording();
  }
};

// 开始录音
const startRecording = async () => {
  try {
    isRecording.value = true;
    isActive.value = true;
    showFeedbackPanel.value = props.showPanel;
    recordingStartTime.value = Date.now();

    // 启动录音计时器
    startRecordingTimer();

    // 初始化音频可视化
    await initAudioVisualization();

    // 开始录音
    await window.electron.ipcRenderer.invoke("speech:startRecording", {
      language: selectedLanguage.value,
      engine: selectedEngine.value,
      autoDetect: autoDetectLanguage.value,
    });

    statusMessage.value = "正在录音...";
    statusType.value = "info";

    console.log("[VoiceFeedback] 开始录音");
  } catch (error) {
    console.error("[VoiceFeedback] 开始录音失败:", error);
    message.error("开始录音失败: " + error.message);
    isRecording.value = false;
    isActive.value = false;
  }
};

// 停止录音
const stopRecording = async () => {
  try {
    isRecording.value = false;
    isProcessing.value = true;
    stopRecordingTimer();
    stopAudioVisualization();

    statusMessage.value = "正在处理...";
    statusType.value = "info";

    // 停止录音并获取结果
    const result = await window.electron.ipcRenderer.invoke(
      "speech:stopRecording",
    );

    if (result.success) {
      finalTranscript.value = result.text;
      currentConfidence.value = result.confidence;
      detectedLanguage.value = result.language;

      emit("result", result);

      statusMessage.value = "识别完成";
      statusType.value = "success";

      // 更新学习统计
      await updateLearningStats();
    } else {
      throw new Error(result.error || "识别失败");
    }
  } catch (error) {
    console.error("[VoiceFeedback] 停止录音失败:", error);
    message.error("识别失败: " + error.message);
    emit("error", error);

    statusMessage.value = "识别失败";
    statusType.value = "error";
  } finally {
    isProcessing.value = false;
    setTimeout(() => {
      isActive.value = false;
      showFeedbackPanel.value = false;
    }, 2000);
  }
};

// 取消录音
const cancelRecording = async () => {
  try {
    await window.electron.ipcRenderer.invoke("speech:cancelRecording");
    isRecording.value = false;
    isActive.value = false;
    showFeedbackPanel.value = false;
    stopRecordingTimer();
    stopAudioVisualization();

    statusMessage.value = "";
    interimTranscript.value = "";

    console.log("[VoiceFeedback] 已取消录音");
  } catch (error) {
    console.error("[VoiceFeedback] 取消录音失败:", error);
  }
};

// 录音计时器
const startRecordingTimer = () => {
  recordingTimer.value = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime.value;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    recordingTime.value = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, 1000);
};

const stopRecordingTimer = () => {
  if (recordingTimer.value) {
    clearInterval(recordingTimer.value);
    recordingTimer.value = null;
  }
  recordingTime.value = "00:00";
};

// 音频处理器引用
const audioProcessor = ref(null);
const mediaStream = ref(null);

/**
 * 浮点数组转16位PCM
 */
const floatTo16BitPCM = (float32Array) => {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
};

// 音频可视化和录音处理
const initAudioVisualization = async () => {
  try {
    await nextTick();

    // 创建音频上下文 (16kHz 采样率用于语音识别)
    audioContext.value = new (window.AudioContext || window.webkitAudioContext)(
      {
        sampleRate: 16000,
      },
    );
    analyser.value = audioContext.value.createAnalyser();
    analyser.value.fftSize = 256;

    // 获取麦克风流
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    mediaStream.value = stream;

    const source = audioContext.value.createMediaStreamSource(stream);
    source.connect(analyser.value);

    // 创建 ScriptProcessor 来捕获音频数据并发送到主进程
    audioProcessor.value = audioContext.value.createScriptProcessor(4096, 1, 1);
    source.connect(audioProcessor.value);
    audioProcessor.value.connect(audioContext.value.destination);

    audioProcessor.value.onaudioprocess = (e) => {
      if (!isRecording.value) {
        return;
      }

      const inputData = e.inputBuffer.getChannelData(0);

      // 转换为 PCM 并发送到主进程
      const pcmData = floatTo16BitPCM(inputData);

      // 发送音频数据到主进程进行识别
      window.electron.ipcRenderer.invoke(
        "speech:add-realtime-audio-data",
        pcmData,
      );
    };

    // 设置画布 (如果启用波形可视化)
    if (displayOptions.value.includes("waveform") && waveformCanvas.value) {
      const canvas = waveformCanvas.value;
      const ctx = canvas.getContext("2d");

      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      // 开始绘制波形
      drawWaveform(ctx, canvas);
    }
  } catch (error) {
    console.error("[VoiceFeedback] 初始化音频可视化失败:", error);
    message.error("无法访问麦克风: " + error.message);
  }
};

const drawWaveform = (ctx, canvas) => {
  if (!isRecording.value || !analyser.value) return;

  const bufferLength = analyser.value.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (!isRecording.value) return;

    animationFrame.value = requestAnimationFrame(draw);

    analyser.value.getByteTimeDomainData(dataArray);

    // 清空画布
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

    // 绘制波形
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1890ff";
    ctx.beginPath();

    const sliceWidth = canvas.offsetWidth / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.offsetHeight) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(canvas.offsetWidth, canvas.offsetHeight / 2);
    ctx.stroke();
  };

  draw();
};

const stopAudioVisualization = () => {
  if (animationFrame.value) {
    cancelAnimationFrame(animationFrame.value);
    animationFrame.value = null;
  }

  // 断开音频处理器
  if (audioProcessor.value) {
    audioProcessor.value.disconnect();
    audioProcessor.value = null;
  }

  // 停止麦克风流
  if (mediaStream.value) {
    mediaStream.value.getTracks().forEach((track) => track.stop());
    mediaStream.value = null;
  }

  if (audioContext.value) {
    audioContext.value.close();
    audioContext.value = null;
  }

  analyser.value = null;
};

// 执行命令
const executeCommand = (command) => {
  emit("command", command);
  message.success(`执行命令: ${command.name}`);
};

// 打开设置
const openSettings = () => {
  showSettingsDrawer.value = true;
};

// 语言变化
const onLanguageChange = (value) => {
  console.log("[VoiceFeedback] 切换语言:", value);
};

// 语言过滤
const filterLanguageOption = (input, option) => {
  return option.children[0].children
    .toLowerCase()
    .includes(input.toLowerCase());
};

// 更新学习统计
const updateLearningStats = async () => {
  try {
    const stats = await window.electron.ipcRenderer.invoke(
      "speech:getLearningStats",
    );
    learningStats.value = stats;
  } catch (error) {
    console.error("[VoiceFeedback] 更新学习统计失败:", error);
  }
};

// 导出语音数据
const exportVoiceData = async () => {
  try {
    await window.electron.ipcRenderer.invoke("speech:exportData");
    message.success("语音数据已导出");
  } catch (error) {
    console.error("[VoiceFeedback] 导出失败:", error);
    message.error("导出失败");
  }
};

// 导入语音数据
const importVoiceData = async () => {
  try {
    await window.electron.ipcRenderer.invoke("speech:importData");
    message.success("语音数据已导入");
    await updateLearningStats();
  } catch (error) {
    console.error("[VoiceFeedback] 导入失败:", error);
    message.error("导入失败");
  }
};

// 重置语音数据
const resetVoiceData = async () => {
  try {
    await window.electron.ipcRenderer.invoke("speech:resetData");
    message.success("语音数据已重置");
    await updateLearningStats();
  } catch (error) {
    console.error("[VoiceFeedback] 重置失败:", error);
    message.error("重置失败");
  }
};

// 清理
const cleanup = () => {
  stopRecordingTimer();
  stopAudioVisualization();
};
</script>

<style scoped lang="scss">
.voice-feedback-widget {
  position: relative;

  &.rtl {
    direction: rtl;
  }

  .voice-control-button {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.3s ease;

    &:hover {
      transform: scale(1.1);
    }

    &:active {
      transform: scale(0.95);
    }
  }

  .voice-feedback-panel {
    position: absolute;
    top: 60px;
    right: 0;
    width: 400px;
    max-height: 600px;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    animation: slideIn 0.3s ease;

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }

  .language-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding: 8px;
    background: #f0f2f5;
    border-radius: 4px;

    .anticon {
      font-size: 16px;
      color: #1890ff;
    }
  }

  .waveform-container {
    position: relative;
    height: 120px;
    margin-bottom: 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px;
    overflow: hidden;

    .waveform-canvas {
      width: 100%;
      height: 100%;
    }

    .waveform-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;

      .recording-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
        color: white;
        font-size: 18px;
        font-weight: 500;

        .pulse-dot {
          width: 12px;
          height: 12px;
          background: #ff4d4f;
          border-radius: 50%;
          animation: pulse 1.5s ease-in-out infinite;

          @keyframes pulse {
            0%,
            100% {
              transform: scale(1);
              opacity: 1;
            }
            50% {
              transform: scale(1.5);
              opacity: 0.5;
            }
          }
        }
      }
    }
  }

  .confidence-indicator {
    margin-bottom: 16px;

    .confidence-label {
      display: block;
      margin-bottom: 8px;
      font-size: 12px;
      color: #8c8c8c;
    }
  }

  .transcription-preview {
    margin-bottom: 16px;
    padding: 12px;
    background: #f9f9f9;
    border-radius: 4px;
    border-left: 3px solid #1890ff;

    .preview-label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #8c8c8c;

      .anticon {
        color: #1890ff;
      }
    }

    .preview-text {
      font-size: 14px;
      line-height: 1.6;
      color: #262626;

      &.rtl {
        text-align: right;
      }

      .cursor-blink {
        animation: blink 1s step-end infinite;

        @keyframes blink {
          50% {
            opacity: 0;
          }
        }
      }
    }
  }

  .command-hints {
    margin-bottom: 16px;

    .hints-label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      font-size: 12px;
      color: #8c8c8c;

      .anticon {
        color: #faad14;
      }
    }

    .hints-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;

      .command-hint-tag {
        cursor: pointer;
        transition: all 0.3s ease;

        &:hover {
          transform: translateY(-2px);
          box-shadow: 0 2px 8px rgba(24, 144, 255, 0.3);
        }
      }
    }
  }

  .status-message {
    margin-bottom: 16px;
  }

  .control-buttons {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
