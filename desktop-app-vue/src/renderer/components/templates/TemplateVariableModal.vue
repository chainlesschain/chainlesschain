<template>
  <a-modal
    v-model:open="isVisible"
    :title="modalTitle"
    width="1100px"
    :confirm-loading="creating"
    ok-text="创建项目"
    cancel-text="取消"
    @ok="handleSubmit"
    @cancel="handleCancel"
  >
    <div class="modal-content-wrapper">
      <!-- 左侧：变量表单 -->
      <div class="variable-form-container">
      <!-- 模板描述 -->
      <div v-if="template?.description" class="template-description">
        <p>{{ template.description }}</p>
      </div>

      <!-- 动态表单 -->
      <a-form
        ref="formRef"
        :model="formData"
        layout="vertical"
        :rules="formRules"
      >
        <template v-for="variable in variablesSchema" :key="variable.name">
          <!-- String 类型 -->
          <a-form-item
            v-if="variable.type === 'string'"
            :label="variable.label"
            :name="variable.name"
            :required="variable.required"
          >
            <a-input
              v-model:value="formData[variable.name]"
              :placeholder="variable.placeholder || `请输入${variable.label}`"
              allow-clear
            />
          </a-form-item>

          <!-- Number 类型 -->
          <a-form-item
            v-if="variable.type === 'number'"
            :label="variable.label"
            :name="variable.name"
            :required="variable.required"
          >
            <a-input-number
              v-model:value="formData[variable.name]"
              :min="variable.min"
              :max="variable.max"
              :placeholder="variable.placeholder || `请输入${variable.label}`"
              style="width: 100%"
            />
          </a-form-item>

          <!-- Select 类型 -->
          <a-form-item
            v-if="variable.type === 'select'"
            :label="variable.label"
            :name="variable.name"
            :required="variable.required"
          >
            <a-select
              v-model:value="formData[variable.name]"
              :placeholder="variable.placeholder || `请选择${variable.label}`"
              allow-clear
            >
              <a-select-option
                v-for="option in variable.options"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </a-select-option>
            </a-select>
          </a-form-item>

          <!-- Array 类型 (使用 tags 模式) -->
          <a-form-item
            v-if="variable.type === 'array'"
            :label="variable.label"
            :name="variable.name"
            :required="variable.required"
          >
            <a-select
              v-model:value="formData[variable.name]"
              mode="tags"
              :placeholder="variable.placeholder || `请输入${variable.label}（回车分隔）`"
              allow-clear
            />
          </a-form-item>

          <!-- Boolean 类型 -->
          <a-form-item
            v-if="variable.type === 'boolean'"
            :label="variable.label"
            :name="variable.name"
          >
            <a-switch v-model:checked="formData[variable.name]" />
            <span v-if="variable.placeholder" class="hint-text">
              {{ variable.placeholder }}
            </span>
          </a-form-item>
        </template>
      </a-form>

      <!-- 变量数量提示 -->
      <div v-if="variablesSchema.length === 0" class="no-variables-hint">
        <InfoCircleOutlined />
        此模板无需填写额外参数，点击"创建项目"即可开始
      </div>
      </div>

      <!-- 右侧：实时预览 -->
      <div class="preview-panel">
        <div class="preview-header">
          <EyeOutlined />
          <span>实时预览</span>
        </div>

        <div class="preview-content">
          <!-- 加载状态 -->
          <div v-if="renderingPreview" class="preview-loading">
            <a-spin size="small" />
            <span>渲染中...</span>
          </div>

          <!-- 渲染成功 -->
          <div v-else-if="renderedPrompt && !renderError" class="preview-text">
            <pre>{{ renderedPrompt }}</pre>
          </div>

          <!-- 渲染错误 -->
          <div v-else-if="renderError" class="preview-error">
            <ExclamationCircleOutlined />
            <span>渲染失败: {{ renderError }}</span>
          </div>

          <!-- 初始状态 -->
          <div v-else class="preview-placeholder">
            <FileTextOutlined />
            <p>填写变量后，这里将实时显示渲染后的提示词</p>
          </div>
        </div>

        <!-- 统计信息 -->
        <div v-if="renderedPrompt" class="preview-stats">
          <span>字符数: {{ renderedPrompt.length }}</span>
          <span>•</span>
          <span>行数: {{ renderedPrompt.split('\n').length }}</span>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { message } from 'ant-design-vue'
import {
  InfoCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons-vue'
import { useTemplateStore } from '@/stores/template'
import { useProjectStore } from '@/stores/project'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  template: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'success', 'cancel'])

const router = useRouter()
const templateStore = useTemplateStore()
const projectStore = useProjectStore()
const authStore = useAuthStore()

const formRef = ref(null)
const formData = ref({})
const creating = ref(false)

// 预览相关状态
const renderingPreview = ref(false)
const renderedPrompt = ref('')
const renderError = ref('')
let renderDebounceTimer = null

const isVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const modalTitle = computed(() => {
  return `使用模板：${props.template?.display_name || '新建项目'}`
})

const variablesSchema = computed(() => {
  return props.template?.variables_schema || []
})

const formRules = computed(() => {
  const rules = {}
  variablesSchema.value.forEach(variable => {
    if (variable.required) {
      rules[variable.name] = [
        {
          required: true,
          message: `请输入${variable.label}`,
          trigger: variable.type === 'select' ? 'change' : 'blur'
        }
      ]
    }

    // 数字类型的 min/max 验证
    if (variable.type === 'number') {
      const numberRules = []
      if (variable.min !== undefined) {
        numberRules.push({
          type: 'number',
          min: variable.min,
          message: `${variable.label}不能小于${variable.min}`
        })
      }
      if (variable.max !== undefined) {
        numberRules.push({
          type: 'number',
          max: variable.max,
          message: `${variable.label}不能大于${variable.max}`
        })
      }
      if (numberRules.length > 0) {
        rules[variable.name] = [...(rules[variable.name] || []), ...numberRules]
      }
    }

    // 字符串的 pattern 验证
    if (variable.type === 'string' && variable.pattern) {
      rules[variable.name] = [
        ...(rules[variable.name] || []),
        {
          pattern: new RegExp(variable.pattern),
          message: variable.patternMessage || `${variable.label}格式不正确`
        }
      ]
    }
  })
  return rules
})

// 监听 template 变化，初始化表单数据
watch(
  () => props.template,
  (newTemplate) => {
    if (newTemplate) {
      initFormData()
    }
  },
  { immediate: true }
)

// 监听 visible 变化，重置表单
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      nextTick(() => {
        formRef.value?.resetFields()
        initFormData()
        // 初次打开时渲染预览
        renderPreview()
      })
    } else {
      // 关闭时清空预览
      renderedPrompt.value = ''
      renderError.value = ''
    }
  }
)

// 监听 formData 变化，实时渲染预览（带防抖）
watch(
  formData,
  () => {
    // 清除之前的定时器
    if (renderDebounceTimer) {
      clearTimeout(renderDebounceTimer)
    }
    // 300ms 防抖
    renderDebounceTimer = setTimeout(() => {
      renderPreview()
    }, 300)
  },
  { deep: true }
)

function initFormData() {
  const data = {}
  variablesSchema.value.forEach(variable => {
    if (variable.default !== undefined) {
      data[variable.name] = variable.default
    } else if (variable.type === 'array') {
      data[variable.name] = []
    } else if (variable.type === 'boolean') {
      data[variable.name] = false
    } else if (variable.type === 'number') {
      data[variable.name] = variable.min || 0
    } else {
      data[variable.name] = ''
    }
  })
  formData.value = data
  console.log('[TemplateVariableModal] 初始化表单数据:', formData.value)
}

// 渲染预览
async function renderPreview() {
  if (!props.template || !props.template.id) {
    return
  }

  try {
    renderingPreview.value = true
    renderError.value = ''

    // 调用 API 渲染 prompt
    const prompt = await templateStore.renderPrompt(
      props.template.id,
      formData.value
    )

    renderedPrompt.value = prompt
    console.log('[TemplateVariableModal] 预览渲染成功, 长度:', prompt.length)
  } catch (error) {
    console.error('[TemplateVariableModal] 预览渲染失败:', error)
    renderError.value = error.message || '渲染失败'
    renderedPrompt.value = ''
  } finally {
    renderingPreview.value = false
  }
}

async function handleSubmit() {
  try {
    // 1. 验证表单
    await formRef.value?.validate()

    // 2. 渲染 prompt
    creating.value = true
    console.log('[TemplateVariableModal] 渲染 prompt...', {
      templateId: props.template.id,
      variables: formData.value
    })

    const renderedPrompt = await templateStore.renderPrompt(
      props.template.id,
      formData.value
    )

    console.log('[TemplateVariableModal] Prompt 渲染成功')

    // 3. 获取项目名称（使用第一个变量的值或模板名称）
    const firstVariable = variablesSchema.value[0]
    let projectName = props.template.display_name
    if (firstVariable && formData.value[firstVariable.name]) {
      projectName = String(formData.value[firstVariable.name]).substring(0, 50)
    }

    // 4. 创建项目
    console.log('[TemplateVariableModal] 创建项目...', { projectName })

    const project = await projectStore.createProjectStream({
      name: projectName,
      type: props.template.project_type || 'document',
      userPrompt: renderedPrompt,
      onProgress: (stage) => {
        console.log('[TemplateVariableModal] 进度:', stage)
      },
      onContent: (content) => {
        console.log('[TemplateVariableModal] 内容更新:', content.substring(0, 100))
      },
      onComplete: async (result) => {
        console.log('[TemplateVariableModal] 项目创建完成:', result)

        // 5. 记录模板使用
        try {
          await templateStore.recordUsage(
            props.template.id,
            authStore.userId,
            result.projectId,
            formData.value
          )
        } catch (error) {
          console.error('[TemplateVariableModal] 记录使用失败:', error)
        }

        // 6. 重置 creating 状态
        creating.value = false

        // 7. 成功提示并关闭对话框
        message.success('项目创建成功！')
        isVisible.value = false
        emit('success', result)

        // 8. 跳转到项目页面
        router.push(`/projects/${result.projectId}`)
      },
      onError: (error) => {
        console.error('[TemplateVariableModal] 创建失败:', error)
        message.error('创建失败: ' + error.message)
        creating.value = false
      }
    })

  } catch (error) {
    if (error.errorFields) {
      // 表单验证错误
      message.warning('请填写必填项')
    } else {
      console.error('[TemplateVariableModal] 提交失败:', error)
      message.error('创建失败: ' + (error.message || '未知错误'))
    }
    creating.value = false
  }
}

function handleCancel() {
  if (!creating.value) {
    isVisible.value = false
    emit('cancel')
  }
}
</script>

<style lang="scss" scoped>
.modal-content-wrapper {
  display: flex;
  gap: 24px;
  max-height: 65vh;
  overflow: hidden;
}

.variable-form-container {
  flex: 1;
  max-height: 65vh;
  overflow-y: auto;
  padding: 8px 16px 8px 0;

  .template-description {
    margin-bottom: 24px;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
    border-left: 3px solid #667eea;
    border-radius: 4px;

    p {
      margin: 0;
      color: #6e6e73;
      font-size: 14px;
      line-height: 1.6;
    }
  }

  .hint-text {
    margin-left: 12px;
    color: #86868b;
    font-size: 13px;
  }

  .no-variables-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px;
    background: #f5f5f7;
    border-radius: 8px;
    color: #6e6e73;
    font-size: 14px;

    :deep(.anticon) {
      font-size: 16px;
      color: #667eea;
    }
  }

  :deep(.ant-form-item) {
    margin-bottom: 20px;

    .ant-form-item-label {
      label {
        font-weight: 500;
        color: #1d1d1f;

        &::before {
          color: #ff3b30 !important;
        }
      }
    }

    .ant-input,
    .ant-input-number,
    .ant-select {
      border-radius: 8px;

      &:focus,
      &:hover {
        border-color: #667eea;
      }
    }

    .ant-switch {
      &.ant-switch-checked {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }
    }
  }

  // 滚动条样式
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: #f5f5f7;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d1d1d6;
    border-radius: 3px;

    &:hover {
      background: #b8b8bd;
    }
  }
}

// 预览面板样式
.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid #e5e5ea;
  border-radius: 12px;
  background: #fafafa;
  overflow: hidden;

  .preview-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
    border-bottom: 1px solid #e5e5ea;
    font-weight: 600;
    color: #667eea;

    :deep(.anticon) {
      font-size: 16px;
    }
  }

  .preview-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: white;

    .preview-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 200px;
      color: #86868b;

      span {
        font-size: 14px;
      }
    }

    .preview-text {
      pre {
        margin: 0;
        padding: 0;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;
        color: #1d1d1f;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    }

    .preview-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px;
      background: #fff5f5;
      border: 1px solid #ffd1d1;
      border-radius: 8px;
      color: #ff3b30;

      :deep(.anticon) {
        font-size: 18px;
      }
    }

    .preview-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      min-height: 300px;
      color: #d1d1d6;

      :deep(.anticon) {
        font-size: 48px;
      }

      p {
        margin: 0;
        font-size: 14px;
        color: #86868b;
        text-align: center;
      }
    }

    // 滚动条样式
    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-track {
      background: #f5f5f7;
      border-radius: 3px;
    }

    &::-webkit-scrollbar-thumb {
      background: #d1d1d6;
      border-radius: 3px;

      &:hover {
        background: #b8b8bd;
      }
    }
  }

  .preview-stats {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: #f5f5f7;
    border-top: 1px solid #e5e5ea;
    font-size: 12px;
    color: #86868b;
  }
}

:deep(.ant-modal-footer) {
  .ant-btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 8px;

    &:hover:not(:disabled) {
      background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
    }
  }

  .ant-btn-default {
    border-radius: 8px;
  }
}
</style>
