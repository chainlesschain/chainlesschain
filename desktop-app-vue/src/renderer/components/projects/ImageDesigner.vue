<template>
  <div class="image-designer">
    <a-card title="图像设计" :bordered="false">
      <a-tabs v-model:activeKey="activeTab">
        <!-- AI文生图 -->
        <a-tab-pane key="generate" tab="AI文生图">
          <a-form :model="generateForm" layout="vertical">
            <a-form-item label="图片描述">
              <a-textarea
                v-model:value="generateForm.prompt"
                :rows="4"
                placeholder="描述你想要生成的图片,例如: 一只可爱的猫咪在阳光下玩耍"
              />
            </a-form-item>

            <a-form-item label="尺寸">
              <a-select v-model:value="generateForm.size">
                <a-select-option value="square_sm">512x512 (小)</a-select-option>
                <a-select-option value="square_md">1024x1024 (中)</a-select-option>
                <a-select-option value="landscape">1024x768 (横向)</a-select-option>
                <a-select-option value="portrait">768x1024 (纵向)</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="风格">
              <a-select v-model:value="generateForm.style">
                <a-select-option value="realistic">写实</a-select-option>
                <a-select-option value="anime">动漫</a-select-option>
                <a-select-option value="oil_painting">油画</a-select-option>
                <a-select-option value="sketch">素描</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleGenerate" :loading="processing">
                <picture-outlined /> 生成图片
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>

        <!-- 图片编辑 -->
        <a-tab-pane key="edit" tab="图片编辑">
          <a-form :model="editForm" layout="vertical">
            <a-form-item label="输入图片">
              <a-input
                v-model:value="editForm.inputPath"
                placeholder="选择图片文件"
                readonly
              >
                <template #addonAfter>
                  <a-button @click="selectInputImage">
                    <folder-open-outlined />
                  </a-button>
                </template>
              </a-input>
            </a-form-item>

            <a-form-item label="操作类型">
              <a-select v-model:value="editForm.operation">
                <a-select-option value="removeBackground">移除背景</a-select-option>
                <a-select-option value="upscale">超分辨率 (2x)</a-select-option>
                <a-select-option value="enhance">增强</a-select-option>
                <a-select-option value="resize">调整大小</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item v-if="editForm.operation === 'resize'" label="目标尺寸">
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-input-number
                    v-model:value="editForm.width"
                    placeholder="宽度"
                    :min="1"
                    style="width: 100%"
                  />
                </a-col>
                <a-col :span="12">
                  <a-input-number
                    v-model:value="editForm.height"
                    placeholder="高度"
                    :min="1"
                    style="width: 100%"
                  />
                </a-col>
              </a-row>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleEdit" :loading="processing">
                <edit-outlined /> 开始处理
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>

        <!-- 批量处理 -->
        <a-tab-pane key="batch" tab="批量处理">
          <a-form :model="batchForm" layout="vertical">
            <a-form-item label="输入图片">
              <a-button @click="selectMultipleImages" style="width: 100%">
                <folder-open-outlined /> 选择多个图片
              </a-button>
              <div v-if="batchForm.imageList.length > 0" class="file-list">
                <a-tag
                  v-for="(file, index) in batchForm.imageList"
                  :key="index"
                  closable
                  @close="removeImageFromBatch(index)"
                  style="margin: 4px"
                >
                  {{ file.split('\\').pop() }}
                </a-tag>
              </div>
            </a-form-item>

            <a-form-item label="批量操作">
              <a-select v-model:value="batchForm.operation">
                <a-select-option value="resize">调整大小</a-select-option>
                <a-select-option value="enhance">增强</a-select-option>
                <a-select-option value="convertFormat">格式转换</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item v-if="batchForm.operation === 'resize'" label="目标尺寸">
              <a-row :gutter="16">
                <a-col :span="12">
                  <a-input-number
                    v-model:value="batchForm.width"
                    placeholder="宽度"
                    :min="1"
                    style="width: 100%"
                  />
                </a-col>
                <a-col :span="12">
                  <a-input-number
                    v-model:value="batchForm.height"
                    placeholder="高度"
                    :min="1"
                    style="width: 100%"
                  />
                </a-col>
              </a-row>
            </a-form-item>

            <a-form-item v-if="batchForm.operation === 'convertFormat'" label="目标格式">
              <a-select v-model:value="batchForm.format">
                <a-select-option value="png">PNG</a-select-option>
                <a-select-option value="jpg">JPG</a-select-option>
                <a-select-option value="webp">WebP</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleBatch" :loading="processing">
                <appstore-outlined /> 批量处理
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

      <!-- 结果预览 -->
      <div v-if="resultImage" class="result-preview">
        <h4>生成结果:</h4>
        <img :src="resultImage" alt="Generated Image" class="preview-image" />
      </div>

      <!-- 结果消息 -->
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
  PictureOutlined,
  EditOutlined,
  AppstoreOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'

const activeTab = ref('generate')
const processing = ref(false)
const progress = ref(0)
const progressStatus = ref('active')
const progressMessage = ref('')
const result = ref(null)
const resultImage = ref(null)

const generateForm = reactive({
  prompt: '',
  size: 'square_md',
  style: 'realistic'
})

const editForm = reactive({
  inputPath: '',
  operation: 'removeBackground',
  width: 1024,
  height: 768
})

const batchForm = reactive({
  imageList: [],
  operation: 'resize',
  width: 800,
  height: 600,
  format: 'png'
})

// 选择输入图片
const selectInputImage = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('dialog:openFile', {
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      editForm.inputPath = result.filePaths[0]
    }
  } catch (error) {
    message.error('选择文件失败: ' + error.message)
  }
}

// 选择多个图片
const selectMultipleImages = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('dialog:openFile', {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      batchForm.imageList = result.filePaths
    }
  } catch (error) {
    message.error('选择文件失败: ' + error.message)
  }
}

// 从批量列表中移除图片
const removeImageFromBatch = (index) => {
  batchForm.imageList.splice(index, 1)
}

// AI文生图
const handleGenerate = async () => {
  if (!generateForm.prompt.trim()) {
    message.warning('请输入图片描述')
    return
  }

  processing.value = true
  progress.value = 0
  progressMessage.value = '正在生成图片...'
  resultImage.value = null

  try {
    // 生成输出路径
    const timestamp = Date.now()
    const outputPath = `generated_${timestamp}.png`

    const response = await window.electron.ipcRenderer.invoke('image:generateFromText', {
      prompt: generateForm.prompt,
      outputPath: outputPath,
      size: generateForm.size,
      style: generateForm.style,
      service: 'stable-diffusion'
    })

    if (response.success) {
      progress.value = 100
      progressStatus.value = 'success'
      result.value = {
        type: 'success',
        message: `图片生成成功！文件: ${response.outputPath}`
      }

      // 显示生成的图片
      resultImage.value = `file://${response.outputPath}`
    }
  } catch (error) {
    progressStatus.value = 'exception'
    result.value = {
      type: 'error',
      message: 'AI图片生成失败: ' + error.message
    }
  } finally {
    processing.value = false
  }
}

// 图片编辑
const handleEdit = async () => {
  if (!editForm.inputPath) {
    message.warning('请先选择输入图片')
    return
  }

  processing.value = true
  progress.value = 0
  progressMessage.value = '正在处理图片...'
  resultImage.value = null

  try {
    const suffix = editForm.operation === 'removeBackground' ? '_nobg' : `_${editForm.operation}`
    const outputPath = editForm.inputPath.replace(/\.[^.]+$/, `${suffix}.png`)

    let response

    switch (editForm.operation) {
      case 'removeBackground':
        response = await window.electron.ipcRenderer.invoke('image:removeBackground', {
          inputPath: editForm.inputPath,
          outputPath: outputPath
        })
        break

      case 'upscale':
        response = await window.electron.ipcRenderer.invoke('image:upscale', {
          inputPath: editForm.inputPath,
          outputPath: outputPath,
          scale: 2
        })
        break

      case 'enhance':
        response = await window.electron.ipcRenderer.invoke('image:enhance', {
          inputPath: editForm.inputPath,
          outputPath: outputPath,
          brightness: 1.1,
          contrast: 1.1,
          sharpen: true
        })
        break

      case 'resize':
        response = await window.electron.ipcRenderer.invoke('image:resize', {
          inputPath: editForm.inputPath,
          outputPath: outputPath,
          width: editForm.width,
          height: editForm.height
        })
        break
    }

    if (response.success) {
      progress.value = 100
      progressStatus.value = 'success'
      result.value = {
        type: 'success',
        message: `图片处理成功！输出文件: ${response.outputPath}`
      }

      resultImage.value = `file://${response.outputPath}`
    }
  } catch (error) {
    progressStatus.value = 'exception'
    result.value = {
      type: 'error',
      message: '图片处理失败: ' + error.message
    }
  } finally {
    processing.value = false
  }
}

// 批量处理
const handleBatch = async () => {
  if (batchForm.imageList.length === 0) {
    message.warning('请先选择要处理的图片')
    return
  }

  processing.value = true
  progress.value = 0
  progressMessage.value = `正在批量处理 ${batchForm.imageList.length} 张图片...`

  try {
    // 创建输出目录
    const outputDir = batchForm.imageList[0].substring(0, batchForm.imageList[0].lastIndexOf('\\')) + '\\batch_output'

    const options = {
      operation: batchForm.operation
    }

    if (batchForm.operation === 'resize') {
      options.width = batchForm.width
      options.height = batchForm.height
    } else if (batchForm.operation === 'convertFormat') {
      options.format = batchForm.format
    }

    const response = await window.electron.ipcRenderer.invoke('image:batchProcess', {
      imageList: batchForm.imageList,
      outputDir: outputDir,
      ...options
    })

    if (response.success) {
      progress.value = 100
      progressStatus.value = 'success'
      result.value = {
        type: 'success',
        message: `批量处理完成！成功: ${response.successCount}, 失败: ${response.errorCount}`
      }
    }
  } catch (error) {
    progressStatus.value = 'exception'
    result.value = {
      type: 'error',
      message: '批量处理失败: ' + error.message
    }
  } finally {
    processing.value = false
  }
}
</script>

<style scoped>
.image-designer {
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

.result-preview {
  margin-top: 24px;
  text-align: center;
}

.preview-image {
  max-width: 100%;
  max-height: 500px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  margin-top: 8px;
}

.file-list {
  margin-top: 8px;
  padding: 8px;
  background: #fafafa;
  border: 1px dashed #d9d9d9;
  border-radius: 4px;
  min-height: 50px;
}
</style>
