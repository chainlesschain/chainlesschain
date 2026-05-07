<template>
  <a-modal
    v-model:open="open"
    title="截图识别"
    :width="780"
    :ok-text="loading ? '保存中…' : '保存到知识库'"
    cancel-text="取消"
    :ok-button-props="{ loading, disabled: !canSave }"
    @ok="handleSave"
    @cancel="handleCancel"
  >
    <div v-if="screenshot.unsupported" style="margin-bottom: 16px;">
      <a-alert
        type="warning"
        show-icon
        message="浏览器模式不支持截图"
        description="screenshot-desktop 需要 OS 原生 API,请用桌面壳 (cc desktop) 打开本面板。"
      />
    </div>

    <div v-else-if="captureError" class="ss-error">
      <a-alert type="error" show-icon :message="captureError" />
    </div>

    <div v-else>
      <div class="ss-actions">
        <a-button size="small" :loading="capturing" @click="handleRecapture">
          <template #icon><CameraOutlined /></template>
          重新截图
        </a-button>
        <a-button
          size="small"
          :loading="ocrLoading"
          :disabled="!shot || ocrLoading"
          @click="handleRerunOcr"
        >
          <template #icon><ScanOutlined /></template>
          重跑 OCR
        </a-button>
        <a-tag v-if="ocrConfidence !== null">
          OCR 置信度 {{ ocrConfidence }}%
        </a-tag>
      </div>

      <div v-if="shot?.dataUrl" class="ss-preview">
        <img :src="shot.dataUrl" alt="screenshot" />
      </div>

      <a-form layout="vertical" :model="formState">
        <a-form-item label="标题">
          <a-input
            v-model:value="formState.title"
            placeholder="导入条目的标题"
            allow-clear
          />
        </a-form-item>

        <a-form-item>
          <template #label>
            <span>识别文本</span>
            <a-spin v-if="ocrLoading" size="small" style="margin-left: 8px;" />
          </template>
          <a-textarea
            v-model:value="formState.content"
            :placeholder="ocrLoading ? '正在识别…' : '识别结果,可手动编辑'"
            :auto-size="{ minRows: 8, maxRows: 16 }"
            show-count
          />
        </a-form-item>

        <a-form-item label="标签 (逗号分隔, 可选)">
          <a-input
            v-model:value="formState.tagsRaw"
            placeholder="例如: 截图, 参考"
            allow-clear
          />
        </a-form-item>
      </a-form>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CameraOutlined, ScanOutlined } from '@ant-design/icons-vue'
import { useScreenshot } from '../composables/useScreenshot.js'
import { useKnowledge } from '../composables/useKnowledge.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const screenshot = useScreenshot()
const knowledge = useKnowledge()

const open = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const loading = ref(false)
const capturing = ref(false)
const ocrLoading = ref(false)
const captureError = ref('')
const ocrConfidence = ref(null)
const shot = ref(null)

const formState = reactive({
  title: '',
  content: '',
  tagsRaw: '',
})

const canSave = computed(
  () => !!shot.value && (formState.content.trim() || '').length > 0,
)

const defaultTitle = () => `截图识别 - ${new Date().toLocaleString()}`

function resetState() {
  formState.title = defaultTitle()
  formState.content = ''
  formState.tagsRaw = ''
  captureError.value = ''
  ocrConfidence.value = null
  shot.value = null
}

async function cleanupShot() {
  if (shot.value?.path) {
    await screenshot.cleanup(shot.value.path)
  }
}

async function runCapture() {
  if (screenshot.unsupported) {
    captureError.value = '浏览器模式不支持截图,请用桌面壳'
    return null
  }
  capturing.value = true
  try {
    const result = await screenshot.capture({})
    return result
  } catch (err) {
    captureError.value = err?.message || String(err)
    return null
  } finally {
    capturing.value = false
  }
}

async function runOcr(path) {
  if (!path) return
  ocrLoading.value = true
  try {
    const result = await screenshot.ocr(path)
    formState.content = result.text || ''
    ocrConfidence.value =
      typeof result.confidence === 'number' ? result.confidence : null
    if (!result.text) {
      message.info('OCR 未识别到文本,可手动输入')
    }
  } catch (err) {
    message.warning('OCR 失败: ' + (err?.message || String(err)))
  } finally {
    ocrLoading.value = false
  }
}

async function handleRecapture() {
  await cleanupShot()
  resetState()
  const result = await runCapture()
  if (result) {
    shot.value = result
    await runOcr(result.path)
  }
}

async function handleRerunOcr() {
  if (shot.value?.path) {
    await runOcr(shot.value.path)
  }
}

watch(
  () => props.modelValue,
  async (val) => {
    if (val) {
      resetState()
      const result = await runCapture()
      if (result) {
        shot.value = result
        await runOcr(result.path)
      }
    } else {
      await cleanupShot()
      shot.value = null
    }
  },
  { immediate: true },
)

async function handleSave() {
  if (!canSave.value) {
    message.warning('识别文本为空,无法保存')
    return
  }
  loading.value = true
  try {
    const tags = formState.tagsRaw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    const item = await knowledge.addItem({
      title: formState.title.trim() || defaultTitle(),
      content: formState.content,
      tags,
      type: 'note',
    })
    message.success('已保存到知识库')
    emit('saved', item)
    await cleanupShot()
    open.value = false
  } catch (err) {
    message.error('保存失败: ' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function handleCancel() {
  await cleanupShot()
  open.value = false
}
</script>

<style scoped>
.ss-error {
  margin-bottom: 12px;
}
.ss-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.ss-preview {
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border-color, #f0f0f0);
  border-radius: 4px;
  margin-bottom: 12px;
  background: var(--bg-base, #fafafa);
}
.ss-preview img {
  display: block;
  max-width: 100%;
  height: auto;
}
</style>
