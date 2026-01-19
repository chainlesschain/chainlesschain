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
        <div
          v-if="template?.description"
          class="template-description"
        >
          <p>{{ template.description }}</p>
        </div>

        <!-- 动态表单 -->
        <a-form
          ref="formRef"
          :model="formData"
          layout="vertical"
          :rules="formRules"
        >
          <template
            v-for="variable in variablesSchema"
            :key="variable.name"
          >
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
              <span
                v-if="variable.placeholder"
                class="hint-text"
              >
                {{ variable.placeholder }}
              </span>
            </a-form-item>
          </template>
        </a-form>

        <!-- 变量数量提示 -->
        <div
          v-if="variablesSchema.length === 0"
          class="no-variables-hint"
        >
          <InfoCircleOutlined />
          此模板无需填写额外参数，点击"创建项目"即可开始
        </div>
      </div>

      <!-- 右侧：实时预览/编辑 -->
      <div class="preview-panel">
        <div class="preview-header">
          <EyeOutlined v-if="!isEditMode" />
          <EditOutlined v-else />
          <span>{{ isEditMode ? '编辑内容' : '实时预览' }}</span>

          <!-- 切换编辑/预览模式按钮 -->
          <div class="header-actions">
            <a-tooltip :title="isEditMode ? '切换到预览模式' : '切换到编辑模式'">
              <a-button
                type="text"
                size="small"
                :disabled="!renderedPrompt || renderingPreview"
                @click="toggleEditMode"
              >
                <template #icon>
                  <EyeOutlined v-if="isEditMode" />
                  <EditOutlined v-else />
                </template>
              </a-button>
            </a-tooltip>

            <!-- 重置按钮（仅编辑模式显示） -->
            <a-tooltip
              v-if="isEditMode && hasEdited"
              title="重置为原始内容"
            >
              <a-button
                type="text"
                size="small"
                @click="resetEditedContent"
              >
                <template #icon>
                  <UndoOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </div>
        </div>

        <div class="preview-content">
          <!-- 加载状态 -->
          <div
            v-if="renderingPreview"
            class="preview-loading"
          >
            <a-spin size="small" />
            <span>渲染中...</span>
          </div>

          <!-- 编辑模式 -->
          <div
            v-else-if="isEditMode && renderedPrompt"
            class="preview-editor"
          >
            <a-textarea
              v-model:value="editedPrompt"
              :auto-size="{ minRows: 15, maxRows: 25 }"
              placeholder="在此编辑生成的内容..."
              class="editor-textarea"
              @change="handleContentEdit"
            />
          </div>

          <!-- 预览模式 - 渲染成功 -->
          <div
            v-else-if="renderedPrompt && !renderError"
            class="preview-text"
          >
            <pre>{{ displayPrompt }}</pre>
          </div>

          <!-- 渲染错误 -->
          <div
            v-else-if="renderError"
            class="preview-error"
          >
            <ExclamationCircleOutlined />
            <span>渲染失败: {{ renderError }}</span>
          </div>

          <!-- 初始状态/等待必填字段 -->
          <div
            v-else
            class="preview-placeholder"
          >
            <FileTextOutlined />
            <p v-if="variablesSchema.some(v => v.required)">
              请填写必填项后，这里将实时显示渲染后的提示词
            </p>
            <p v-else>
              填写变量后，这里将实时显示渲染后的提示词
            </p>
          </div>
        </div>

        <!-- 统计信息 -->
        <div
          v-if="displayPrompt"
          class="preview-stats"
        >
          <span>字符数: {{ displayPrompt.length }}</span>
          <span>•</span>
          <span>行数: {{ displayPrompt.split('\n').length }}</span>
          <span
            v-if="hasEdited"
            class="edited-badge"
          >
            <CheckCircleOutlined />
            已编辑
          </span>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, nextTick } from 'vue'
import { message } from 'ant-design-vue'
import {
  InfoCircleOutlined,
  EyeOutlined,
  EditOutlined,
  FileTextOutlined,
  ExclamationCircleOutlined,
  UndoOutlined,
  CheckCircleOutlined
} from '@ant-design/icons-vue'
import { useTemplateStore } from '@/stores/template'
import { useProjectStore } from '@/stores/project'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  template: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:open', 'success', 'cancel', 'start-create'])

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

// 编辑模式相关状态
const isEditMode = ref(false)
const editedPrompt = ref('')
const hasEdited = ref(false)

const isVisible = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val)
})

const modalTitle = computed(() => {
  return `使用模板：${props.template?.display_name || '新建项目'}`
})

const variablesSchema = computed(() => {
  return props.template?.variables_schema || []
})

// 显示的内容（编辑后的或原始的）
const displayPrompt = computed(() => {
  return hasEdited.value ? editedPrompt.value : renderedPrompt.value
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
  () => props.open,
  (visible) => {
    if (visible) {
      nextTick(() => {
        formRef.value?.resetFields()
        initFormData()
        // 重置编辑状态
        isEditMode.value = false
        hasEdited.value = false
        editedPrompt.value = ''
        // 初次打开时渲染预览
        renderPreview()
      })
    } else {
      // 关闭时清空预览
      renderedPrompt.value = ''
      renderError.value = ''
      isEditMode.value = false
      hasEdited.value = false
      editedPrompt.value = ''
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

// 监听 renderedPrompt 变化，同步到 editedPrompt
watch(
  renderedPrompt,
  (newPrompt) => {
    if (newPrompt && !hasEdited.value) {
      editedPrompt.value = newPrompt
    }
  }
)

function getSelectInitialValue(variable) {
  const options = Array.isArray(variable.options) ? variable.options : []
  if (options.length === 0) {
    return variable.default ?? ''
  }

  // allow default to match option value or label
  const matchedOption =
    options.find(opt => opt.value === variable.default) ||
    options.find(opt => opt.label === variable.default)

  if (matchedOption) {
    return matchedOption.value
  }

  if (typeof variable.default === 'string') {
    const partialMatch = options.find(
      opt => typeof opt.label === 'string' && opt.label.includes(variable.default)
    )
    if (partialMatch) {
      return partialMatch.value
    }
  }

  // fallback to first option to keep select valid by default
  return options[0]?.value ?? ''
}

function initFormData() {
  const data = {}
  variablesSchema.value.forEach(variable => {
    if (variable.type === 'select') {
      data[variable.name] = getSelectInitialValue(variable)
    } else if (variable.default !== undefined) {
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
  logger.info('[TemplateVariableModal] 初始化表单数据:', formData.value)
}

// 检查所有必填字段是否已填写
function checkRequiredFields() {
  for (const variable of variablesSchema.value) {
    if (variable.required) {
      const value = formData.value[variable.name]
      // 检查值是否为空
      if (value === undefined || value === null || value === '' ||
          (Array.isArray(value) && value.length === 0)) {
        return false
      }
    }
  }
  return true
}

// 渲染预览
async function renderPreview() {
  if (!props.template || !props.template.id) {
    logger.warn('[TemplateVariableModal] 模板或模板ID为空')
    return
  }

  // 如果有必填字段未填写，清空预览并返回
  if (!checkRequiredFields()) {
    renderedPrompt.value = ''
    renderError.value = ''
    return
  }

  try {
    renderingPreview.value = true
    renderError.value = ''

    logger.info('[TemplateVariableModal] 开始渲染预览:', {
      templateId: props.template.id,
      templateName: props.template.display_name,
      variables: formData.value
    })

    // 调用 API 渲染 prompt（renderPrompt 内部会调用 getTemplateById 获取完整数据）
    const prompt = await templateStore.renderPrompt(
      props.template.id,
      formData.value
    )

    renderedPrompt.value = prompt
    logger.info('[TemplateVariableModal] 预览渲染成功, 长度:', prompt?.length || 0)
  } catch (error) {
    logger.error('[TemplateVariableModal] 预览渲染失败:', error)
    renderError.value = error.message || '渲染失败'
    renderedPrompt.value = ''
  } finally {
    renderingPreview.value = false
  }
}

// 切换编辑/预览模式
function toggleEditMode() {
  isEditMode.value = !isEditMode.value
  logger.info('[TemplateVariableModal] 切换编辑模式:', isEditMode.value)
}

// 处理内容编辑
function handleContentEdit() {
  hasEdited.value = true
  logger.info('[TemplateVariableModal] 内容已编辑')
}

// 重置编辑内容
function resetEditedContent() {
  editedPrompt.value = renderedPrompt.value
  hasEdited.value = false
  message.success('已重置为原始内容')
  logger.info('[TemplateVariableModal] 重置编辑内容')
}

async function handleSubmit() {
  try {
    // 1. 验证表单
    await formRef.value?.validate()

    // 2. 使用编辑后的内容或渲染的内容
    creating.value = true
    let finalPrompt = displayPrompt.value

    // 如果没有编辑过且没有渲染内容，则重新渲染
    if (!finalPrompt) {
      logger.info('[TemplateVariableModal] 渲染 prompt...', {
        templateId: props.template.id,
        variables: formData.value
      })

      finalPrompt = await templateStore.renderPrompt(
        props.template.id,
        formData.value
      )
    }

    logger.info('[TemplateVariableModal] 使用最终内容:', {
      length: finalPrompt?.length || 0,
      hasEdited: hasEdited.value
    })

    // 3. 获取项目名称（使用第一个变量的值或模板名称）
    const firstVariable = variablesSchema.value[0]
    let projectName = props.template.display_name
    if (firstVariable && formData.value[firstVariable.name]) {
      projectName = String(formData.value[firstVariable.name]).substring(0, 50)
    }

    // 4. Emit 创建事件，让父组件处理流式创建和进度展示
    logger.info('[TemplateVariableModal] Emit start-create 事件')
    emit('start-create', {
      templateId: props.template.id,
      projectName: projectName,
      projectType: props.template.project_type || 'document',
      renderedPrompt: finalPrompt,
      variables: formData.value,
      isEdited: hasEdited.value
    })

    // 5. 重置状态并关闭对话框
    creating.value = false
    isVisible.value = false

  } catch (error) {
    if (error.errorFields) {
      // 表单验证错误
      message.warning('请填写必填项')
    } else {
      logger.error('[TemplateVariableModal] 提交失败:', error)
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
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
    border-bottom: 1px solid #e5e5ea;
    font-weight: 600;
    color: #667eea;

    :deep(.anticon) {
      font-size: 16px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;

      .ant-btn-text {
        color: #667eea;

        &:hover:not(:disabled) {
          background: rgba(102, 126, 234, 0.1);
        }

        &:disabled {
          color: #d1d1d6;
        }
      }
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

    .preview-editor {
      .editor-textarea {
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;
        border-radius: 8px;
        border: 1px solid #e5e5ea;

        &:focus {
          border-color: #667eea;
          box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
        }

        :deep(textarea) {
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
        }
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

    .edited-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      padding: 2px 8px;
      background: rgba(102, 126, 234, 0.1);
      border-radius: 12px;
      color: #667eea;
      font-weight: 500;

      :deep(.anticon) {
        font-size: 12px;
      }
    }
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
