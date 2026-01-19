<template>
  <div class="realtime-voice-input">
    <!-- 录音按钮 -->
    <div class="voice-button-container">
      <a-button
        v-if="!isRecording"
        type="primary"
        size="large"
        shape="circle"
        class="voice-button"
        :loading="isInitializing"
        @click="startRecording"
      >
        <template #icon>
          <AudioOutlined v-if="!isInitializing" />
        </template>
      </a-button>

      <div
        v-else
        class="recording-controls"
      >
        <!-- 录音中指示器 -->
        <div class="recording-indicator">
          <span class="pulse" />
          <span class="status-text">正在录音...</span>
        </div>

        <!-- 音量指示器 -->
        <div class="volume-indicator">
          <a-progress
            type="circle"
            :width="80"
            :percent="Math.round(volume * 100)"
            :stroke-color="{
              '0%': '#108ee9',
              '100%': '#87d068',
            }"
          >
            <template #format="percent">
              <span class="volume-text">{{ percent }}%</span>
            </template>
          </a-progress>
        </div>

        <!-- 控制按钮 -->
        <a-space>
          <a-button
            v-if="!isPaused"
            @click="pauseRecording"
          >
            <template #icon>
              <PauseOutlined />
            </template>
            暂停
          </a-button>

          <a-button
            v-else
            @click="resumeRecording"
          >
            <template #icon>
              <PlayCircleOutlined />
            </template>
            继续
          </a-button>

          <a-button
            type="primary"
            @click="stopRecording"
          >
            <template #icon>
              <CheckOutlined />
            </template>
            完成
          </a-button>

          <a-button
            danger
            @click="cancelRecording"
          >
            <template #icon>
              <CloseOutlined />
            </template>
            取消
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 转录结果 -->
    <div
      v-if="transcript"
      class="transcript-container"
    >
      <a-card
        title="转录结果"
        :bordered="false"
      >
        <!-- 部分结果（实时显示） -->
        <div
          v-if="partialTranscript"
          class="partial-transcript"
        >
          <a-typography-text
            type="secondary"
            class="typing-effect"
          >
            {{ partialTranscript }}
          </a-typography-text>
        </div>

        <!-- 最终结果 -->
        <div class="final-transcript">
          <a-typography-paragraph
            :editable="{ onChange: handleTranscriptEdit }"
            :copyable="{ text: finalTranscript }"
          >
            {{ finalTranscript }}
          </a-typography-paragraph>
        </div>

        <!-- 操作按钮 -->
        <template #actions>
          <a-space>
            <a-button @click="insertToEditor">
              <template #icon>
                <FileTextOutlined />
              </template>
              插入到编辑器
            </a-button>

            <a-button @click="saveAsNote">
              <template #icon>
                <SaveOutlined />
              </template>
              保存为笔记
            </a-button>

            <a-button @click="copyTranscript">
              <template #icon>
                <CopyOutlined />
              </template>
              复制文本
            </a-button>

            <a-button
              danger
              @click="clearTranscript"
            >
              <template #icon>
                <DeleteOutlined />
              </template>
              清空
            </a-button>
          </a-space>
        </template>
      </a-card>
    </div>

    <!-- 语音命令帮助 -->
    <a-modal
      v-model:open="showCommandHelp"
      title="语音命令帮助"
      width="600px"
      :footer="null"
    >
      <a-table
        :columns="commandColumns"
        :data-source="availableCommands"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'patterns'">
            <a-tag
              v-for="pattern in record.patterns"
              :key="pattern"
            >
              {{ pattern }}
            </a-tag>
          </template>
        </template>
      </a-table>
    </a-modal>

    <!-- 快捷键提示 -->
    <div class="shortcuts-hint">
      <a-typography-text type="secondary">
        快捷键: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>V</kbd> 开始/停止录音
        |
        <a @click="showCommandHelp = true">查看语音命令</a>
      </a-typography-text>
    </div>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  AudioOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  FileTextOutlined,
  SaveOutlined,
  CopyOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  autoInsert: {
    type: Boolean,
    default: false
  },
  enableCommands: {
    type: Boolean,
    default: true
  }
});

// Emits
const emit = defineEmits(['transcriptCompleted', 'commandRecognized', 'insert']);

// State
const isRecording = ref(false);
const isPaused = ref(false);
const isInitializing = ref(false);
const volume = ref(0);
const partialTranscript = ref('');
const finalTranscript = ref('');
const showCommandHelp = ref(false);

// Computed
const transcript = computed(() => partialTranscript.value || finalTranscript.value);

// 命令表格列
const commandColumns = [
  { title: '命令', dataIndex: 'name', key: 'name' },
  { title: '触发词', dataIndex: 'patterns', key: 'patterns' },
  { title: '说明', dataIndex: 'description', key: 'description' }
];

// 可用命令
const availableCommands = ref([]);

/**
 * 开始录音
 */
const startRecording = async () => {
  try {
    isInitializing.value = true;

    // 请求麦克风权限
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // 通知主进程开始录音
    const result = await window.electronAPI.speech.startRealtimeRecording({
      sampleRate: 16000,
      channels: 1,
      language: 'zh'
    });

    if (result.success) {
      isRecording.value = true;
      isInitializing.value = false;

      // 开始处理音频流
      processAudioStream(stream);

      message.success('开始录音');
    } else {
      throw new Error(result.error || '启动录音失败');
    }

  } catch (error) {
    logger.error('开始录音失败:', error);
    message.error(`开始录音失败: ${error.message}`);
    isInitializing.value = false;
  }
};

/**
 * 处理音频流
 */
const processAudioStream = (stream) => {
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    if (!isRecording.value || isPaused.value) {
      return;
    }

    const inputData = e.inputBuffer.getChannelData(0);

    // 计算音量
    let sum = 0;
    for (let i = 0; i < inputData.length; i++) {
      sum += inputData[i] * inputData[i];
    }
    const rms = Math.sqrt(sum / inputData.length);
    volume.value = Math.min(1, rms * 5);

    // 转换为PCM并发送
    const pcmData = floatTo16BitPCM(inputData);

    window.electronAPI.speech.sendAudioData(pcmData);
  };

  // 保存引用以便清理
  window._audioContext = audioContext;
  window._audioProcessor = processor;
  window._mediaStream = stream;
};

/**
 * 浮点转16位PCM
 */
const floatTo16BitPCM = (float32Array) => {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return Buffer.from(buffer);
};

/**
 * 暂停录音
 */
const pauseRecording = async () => {
  try {
    const result = await window.electronAPI.speech.pauseRealtimeRecording();
    if (result.success) {
      isPaused.value = true;
      message.info('录音已暂停');
    }
  } catch (error) {
    logger.error('暂停录音失败:', error);
    message.error('暂停录音失败');
  }
};

/**
 * 恢复录音
 */
const resumeRecording = async () => {
  try {
    const result = await window.electronAPI.speech.resumeRealtimeRecording();
    if (result.success) {
      isPaused.value = false;
      message.info('录音已恢复');
    }
  } catch (error) {
    logger.error('恢复录音失败:', error);
    message.error('恢复录音失败');
  }
};

/**
 * 停止录音
 */
const stopRecording = async () => {
  try {
    const result = await window.electronAPI.speech.stopRealtimeRecording();

    if (result.success && result.data) {
      finalTranscript.value = result.data.transcript;
      partialTranscript.value = '';

      emit('transcriptCompleted', result.data);

      message.success('录音已完成');

      // 自动插入
      if (props.autoInsert && finalTranscript.value) {
        insertToEditor();
      }
    }

    // 清理音频资源
    cleanupAudioResources();

    isRecording.value = false;
    isPaused.value = false;
    volume.value = 0;

  } catch (error) {
    logger.error('停止录音失败:', error);
    message.error('停止录音失败');
  }
};

/**
 * 取消录音
 */
const cancelRecording = async () => {
  try {
    await window.electronAPI.speech.cancelRealtimeRecording();

    partialTranscript.value = '';
    finalTranscript.value = '';

    cleanupAudioResources();

    isRecording.value = false;
    isPaused.value = false;
    volume.value = 0;

    message.info('录音已取消');

  } catch (error) {
    logger.error('取消录音失败:', error);
  }
};

/**
 * 清理音频资源
 */
const cleanupAudioResources = () => {
  if (window._audioContext) {
    window._audioContext.close();
    delete window._audioContext;
  }

  if (window._audioProcessor) {
    window._audioProcessor.disconnect();
    delete window._audioProcessor;
  }

  if (window._mediaStream) {
    window._mediaStream.getTracks().forEach(track => track.stop());
    delete window._mediaStream;
  }
};

/**
 * 编辑转录文本
 */
const handleTranscriptEdit = (newText) => {
  finalTranscript.value = newText;
};

/**
 * 插入到编辑器
 */
const insertToEditor = () => {
  if (!finalTranscript.value) {
    return;
  }

  emit('insert', finalTranscript.value);
  message.success('已插入到编辑器');
};

/**
 * 保存为笔记
 */
const saveAsNote = async () => {
  if (!finalTranscript.value) {
    return;
  }

  try {
    const result = await window.electronAPI.notes.create({
      title: '语音录入 - ' + new Date().toLocaleString(),
      content: finalTranscript.value,
      tags: ['语音录入']
    });

    if (result.success) {
      message.success('已保存为笔记');
    }
  } catch (error) {
    logger.error('保存笔记失败:', error);
    message.error('保存笔记失败');
  }
};

/**
 * 复制转录文本
 */
const copyTranscript = () => {
  if (!finalTranscript.value) {
    return;
  }

  navigator.clipboard.writeText(finalTranscript.value);
  message.success('已复制到剪贴板');
};

/**
 * 清空转录文本
 */
const clearTranscript = () => {
  partialTranscript.value = '';
  finalTranscript.value = '';
  message.info('已清空');
};

/**
 * 监听转录事件
 */
const setupEventListeners = () => {
  // 部分结果
  window.electronAPI.speech.onTranscriptPartial((data) => {
    partialTranscript.value = data.text;
  });

  // 音量变化
  window.electronAPI.speech.onVolumeChange((data) => {
    volume.value = data.volume;
  });

  // 命令识别
  if (props.enableCommands) {
    window.electronAPI.speech.onCommandRecognized((data) => {
      emit('commandRecognized', data);
      message.info(`识别到命令: ${data.command}`);
    });
  }
};

/**
 * 加载可用命令
 */
const loadAvailableCommands = async () => {
  try {
    const result = await window.electronAPI.speech.getAvailableCommands();
    if (result.success) {
      availableCommands.value = result.data;
    }
  } catch (error) {
    logger.error('加载命令失败:', error);
  }
};

/**
 * 注册快捷键
 */
const registerHotkeys = () => {
  const handleHotkey = (e) => {
    // Ctrl+Shift+V
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();

      if (isRecording.value) {
        stopRecording();
      } else {
        startRecording();
      }
    }

    // Esc - 取消
    if (e.key === 'Escape' && isRecording.value) {
      e.preventDefault();
      cancelRecording();
    }
  };

  document.addEventListener('keydown', handleHotkey);

  // 保存引用以便清理
  window._hotkeyHandler = handleHotkey;
};

/**
 * 移除快捷键
 */
const unregisterHotkeys = () => {
  if (window._hotkeyHandler) {
    document.removeEventListener('keydown', window._hotkeyHandler);
    delete window._hotkeyHandler;
  }
};

// 生命周期
onMounted(() => {
  setupEventListeners();
  loadAvailableCommands();
  registerHotkeys();
});

onUnmounted(() => {
  cleanupAudioResources();
  unregisterHotkeys();
});
</script>

<style scoped lang="less">
.realtime-voice-input {
  padding: 24px;

  .voice-button-container {
    text-align: center;
    margin-bottom: 24px;

    .voice-button {
      width: 80px;
      height: 80px;
      font-size: 32px;
      box-shadow: 0 4px 12px rgba(24, 144, 255, 0.3);
      transition: all 0.3s;

      &:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(24, 144, 255, 0.4);
      }
    }

    .recording-controls {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;

      .recording-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        color: #1890ff;

        .pulse {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #ff4d4f;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(1.2);
          }
        }
      }

      .volume-indicator {
        margin: 8px 0;

        .volume-text {
          font-size: 16px;
          font-weight: 500;
        }
      }
    }
  }

  .transcript-container {
    margin-top: 24px;

    .partial-transcript {
      padding: 12px;
      background: #f0f2f5;
      border-radius: 4px;
      margin-bottom: 12px;
      min-height: 60px;

      .typing-effect {
        font-size: 14px;
        line-height: 1.8;
        animation: typing 0.5s steps(30);
      }
    }

    .final-transcript {
      font-size: 16px;
      line-height: 2;
      min-height: 100px;
    }
  }

  .shortcuts-hint {
    margin-top: 16px;
    text-align: center;

    kbd {
      padding: 2px 6px;
      background: #f5f5f5;
      border: 1px solid #d9d9d9;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
    }
  }
}
</style>
