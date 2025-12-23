<template>
  <div class="video-processor">
    <a-card title="视频处理" :bordered="false">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 视频转换 -->
        <a-tab-pane key="convert" tab="格式转换">
          <a-form :model="convertForm" layout="vertical">
            <a-form-item label="输入视频">
              <a-input
                v-model:value="convertForm.inputPath"
                placeholder="选择视频文件"
                readonly
              >
                <template #addonAfter>
                  <a-button @click="selectInputVideo('convert')">
                    <folder-open-outlined />
                  </a-button>
                </template>
              </a-input>
            </a-form-item>

            <a-form-item label="输出格式">
              <a-select v-model:value="convertForm.format">
                <a-select-option value="mp4">MP4</a-select-option>
                <a-select-option value="avi">AVI</a-select-option>
                <a-select-option value="mov">MOV</a-select-option>
                <a-select-option value="mkv">MKV</a-select-option>
                <a-select-option value="webm">WebM</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="质量">
              <a-slider
                v-model:value="convertForm.quality"
                :min="1"
                :max="10"
                :marks="{ 1: '低', 5: '中', 10: '高' }"
              />
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleConvert" :loading="processing">
                <video-camera-outlined /> 开始转换
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>

        <!-- 视频剪辑 -->
        <a-tab-pane key="trim" tab="视频剪辑">
          <a-form :model="trimForm" layout="vertical">
            <a-form-item label="输入视频">
              <a-input
                v-model:value="trimForm.inputPath"
                placeholder="选择视频文件"
                readonly
              >
                <template #addonAfter>
                  <a-button @click="selectInputVideo('trim')">
                    <folder-open-outlined />
                  </a-button>
                </template>
              </a-input>
            </a-form-item>

            <a-form-item label="开始时间 (秒)">
              <a-input-number
                v-model:value="trimForm.startTime"
                :min="0"
                style="width: 100%"
              />
            </a-form-item>

            <a-form-item label="时长 (秒)">
              <a-input-number
                v-model:value="trimForm.duration"
                :min="1"
                style="width: 100%"
              />
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleTrim" :loading="processing">
                <scissor-outlined /> 开始剪辑
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>

        <!-- AI字幕生成 -->
        <a-tab-pane key="subtitle" tab="AI字幕">
          <a-form :model="subtitleForm" layout="vertical">
            <a-form-item label="输入视频">
              <a-input
                v-model:value="subtitleForm.inputPath"
                placeholder="选择视频文件"
                readonly
              >
                <template #addonAfter>
                  <a-button @click="selectInputVideo('subtitle')">
                    <folder-open-outlined />
                  </a-button>
                </template>
              </a-input>
            </a-form-item>

            <a-form-item label="语言">
              <a-select v-model:value="subtitleForm.language">
                <a-select-option value="zh">中文</a-select-option>
                <a-select-option value="en">English</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleGenerateSubtitle" :loading="processing">
                <file-text-outlined /> 生成字幕
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
      </a-tabs>

      <!-- 进度条 -->
      <div v-if="processing" class="progress-section">
        <a-progress :percent="progress" :status="progressStatus" />
        <p class="progress-message">{{ progressMessage }}</p>
      </div>

      <!-- 结果展示 -->
      <a-alert
        v-if="result"
        :message="result.message"
        :type="result.type"
        show-icon
        closable
        @close="result = null"
        style="margin-top: 16px"
      />
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import {
  FolderOpenOutlined,
  VideoCameraOutlined,
  ScissorOutlined,
  FileTextOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'

const activeTab = ref('convert')
const processing = ref(false)
const progress = ref(0)
const progressStatus = ref('active')
const progressMessage = ref('')
const result = ref(null)

const convertForm = reactive({
  inputPath: '',
  format: 'mp4',
  quality: 7
})

const trimForm = reactive({
  inputPath: '',
  startTime: 0,
  duration: 10
})

const subtitleForm = reactive({
  inputPath: '',
  language: 'zh'
})

// 选择输入视频
const selectInputVideo = async (type) => {
  try {
    const result = await window.electron.ipcRenderer.invoke('dialog:openFile', {
      filters: [
        { name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm', 'wmv'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const inputPath = result.filePaths[0]
      if (type === 'convert') {
        convertForm.inputPath = inputPath
      } else if (type === 'trim') {
        trimForm.inputPath = inputPath
      } else if (type === 'subtitle') {
        subtitleForm.inputPath = inputPath
      }
    }
  } catch (error) {
    message.error('选择文件失败: ' + error.message)
  }
}

// 格式转换
const handleConvert = async () => {
  if (!convertForm.inputPath) {
    message.warning('请先选择输入视频')
    return
  }

  processing.value = true
  progress.value = 0
  progressMessage.value = '正在转换视频...'

  try {
    // 生成输出路径
    const outputPath = convertForm.inputPath.replace(/\.[^.]+$/, `_converted.${convertForm.format}`)

    // 计算视频比特率
    const bitrateMap = {
      1: '500k', 3: '1000k', 5: '2000k', 7: '3000k', 10: '5000k'
    }
    const videoBitrate = bitrateMap[convertForm.quality] || '2000k'

    const response = await window.electron.ipcRenderer.invoke('video:convert', {
      inputPath: convertForm.inputPath,
      outputPath: outputPath,
      outputFormat: convertForm.format,
      videoBitrate: videoBitrate
    })

    if (response.success) {
      progress.value = 100
      progressStatus.value = 'success'
      result.value = {
        type: 'success',
        message: `视频转换成功！输出文件: ${response.outputPath}`
      }
    }
  } catch (error) {
    progressStatus.value = 'exception'
    result.value = {
      type: 'error',
      message: '视频转换失败: ' + error.message
    }
  } finally {
    processing.value = false
  }
}

// 视频剪辑
const handleTrim = async () => {
  if (!trimForm.inputPath) {
    message.warning('请先选择输入视频')
    return
  }

  processing.value = true
  progress.value = 0
  progressMessage.value = '正在剪辑视频...'

  try {
    const outputPath = trimForm.inputPath.replace(/\.[^.]+$/, '_trimmed.mp4')

    // 将秒转换为时间格式
    const formatTime = (seconds) => {
      const h = Math.floor(seconds / 3600).toString().padStart(2, '0')
      const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
      const s = Math.floor(seconds % 60).toString().padStart(2, '0')
      return `${h}:${m}:${s}`
    }

    const response = await window.electron.ipcRenderer.invoke('video:trim', {
      inputPath: trimForm.inputPath,
      outputPath: outputPath,
      startTime: formatTime(trimForm.startTime),
      duration: trimForm.duration
    })

    if (response.success) {
      progress.value = 100
      progressStatus.value = 'success'
      result.value = {
        type: 'success',
        message: `视频剪辑成功！输出文件: ${response.outputPath}`
      }
    }
  } catch (error) {
    progressStatus.value = 'exception'
    result.value = {
      type: 'error',
      message: '视频剪辑失败: ' + error.message
    }
  } finally {
    processing.value = false
  }
}

// 生成字幕
const handleGenerateSubtitle = async () => {
  if (!subtitleForm.inputPath) {
    message.warning('请先选择输入视频')
    return
  }

  processing.value = true
  progress.value = 0
  progressMessage.value = '正在生成字幕...'

  try {
    const outputPath = subtitleForm.inputPath.replace(/\.[^.]+$/, '.srt')

    const response = await window.electron.ipcRenderer.invoke('video:generateSubtitles', {
      videoPath: subtitleForm.inputPath,
      outputPath: outputPath,
      language: subtitleForm.language
    })

    if (response.success) {
      progress.value = 100
      progressStatus.value = 'success'
      result.value = {
        type: 'success',
        message: `字幕生成成功！输出文件: ${response.outputPath}`
      }
    }
  } catch (error) {
    progressStatus.value = 'exception'
    result.value = {
      type: 'error',
      message: '字幕生成失败: ' + error.message
    }
  } finally {
    processing.value = false
  }
}
</script>

<style scoped>
.video-processor {
  padding: 16px;
}

.progress-section {
  margin-top: 24px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}

.progress-message {
  margin-top: 8px;
  text-align: center;
  color: #666;
}
</style>
