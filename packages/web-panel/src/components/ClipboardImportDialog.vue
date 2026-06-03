<template>
  <a-modal
    v-model:open="open"
    title="剪贴板导入"
    :width="640"
    :ok-text="loading ? '保存中…' : '保存到知识库'"
    cancel-text="取消"
    :ok-button-props="{ loading, disabled: !formState.content.trim() }"
    @ok="handleSave"
    @cancel="handleCancel"
  >
    <div v-if="readError" style="margin-bottom: 16px;">
      <a-alert
        type="warning"
        show-icon
        :message="readError"
        description="请确认浏览器/系统已授予剪贴板读取权限，或手动粘贴到下方输入框。"
      />
    </div>

    <a-form layout="vertical" :model="formState">
      <a-form-item label="标题">
        <a-input
          v-model:value="formState.title"
          placeholder="导入条目的标题"
          allow-clear
        />
      </a-form-item>

      <a-form-item label="内容">
        <a-textarea
          v-model:value="formState.content"
          placeholder="粘贴或编辑要保存的内容…"
          :auto-size="{ minRows: 10, maxRows: 20 }"
          show-count
        />
      </a-form-item>

      <a-form-item label="标签（逗号分隔，可选）">
        <a-input
          v-model:value="formState.tagsRaw"
          placeholder="例如：素材, 链接"
          allow-clear
        />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { useKnowledge } from '../composables/useKnowledge.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const knowledge = useKnowledge()

const open = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const loading = ref(false)
const readError = ref('')

const formState = reactive({
  title: '',
  content: '',
  tagsRaw: '',
})

const defaultTitle = () => `剪贴板导入 - ${new Date().toLocaleString()}`

function resetForm() {
  formState.title = defaultTitle()
  formState.content = ''
  formState.tagsRaw = ''
  readError.value = ''
}

async function readClipboard() {
  readError.value = ''
  if (!navigator.clipboard?.readText) {
    readError.value = '当前环境不支持剪贴板读取 API'
    return
  }
  try {
    const text = await navigator.clipboard.readText()
    formState.content = text || ''
    if (!text) {
      readError.value = '剪贴板为空'
    }
  } catch (err) {
    readError.value = '读取剪贴板失败：' + (err?.message || String(err))
  }
}

watch(
  () => props.modelValue,
  async (val) => {
    if (val) {
      resetForm()
      await readClipboard()
    }
  },
  { immediate: true },
)

async function handleSave() {
  if (!formState.content.trim()) {
    message.warning('内容为空，无法保存')
    return
  }
  loading.value = true
  try {
    const tags = formState.tagsRaw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const item = await knowledge.addItem({
      title: formState.title.trim() || defaultTitle(),
      content: formState.content,
      tags,
      type: 'note',
    })
    message.success('已保存到知识库')
    emit('saved', item)
    open.value = false
  } catch (err) {
    message.error('保存失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

function handleCancel() {
  open.value = false
}
</script>
