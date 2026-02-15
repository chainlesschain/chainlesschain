<template>
  <div class="agent-template-editor-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <RobotOutlined />
          {{ isEditing ? '编辑代理模板' : '创建代理模板' }}
        </h1>
        <p class="page-description">
          {{ isEditing ? '修改现有代理模板的配置和行为' : '定义新的代理模板，配置能力和工具' }}
        </p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button @click="handleCancel">取消</a-button>
          <a-button type="primary" :loading="saving" @click="handleSave">
            <SaveOutlined />
            {{ isEditing ? '保存修改' : '创建模板' }}
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 表单 -->
    <a-spin :spinning="loadingTemplate">
      <div class="form-container">
        <a-form
          ref="formRef"
          :model="formState"
          :rules="formRules"
          layout="vertical"
          class="template-form"
        >
          <a-row :gutter="24">
            <!-- 左栏 -->
            <a-col :span="12">
              <a-form-item label="模板名称" name="name">
                <a-input
                  v-model:value="formState.name"
                  placeholder="请输入代理模板名称"
                  :maxlength="100"
                  show-count
                />
              </a-form-item>

              <a-form-item label="代理类型" name="type">
                <a-select
                  v-model:value="formState.type"
                  placeholder="请选择代理类型"
                >
                  <a-select-option
                    v-for="agentType in agentTypes"
                    :key="agentType.value"
                    :value="agentType.value"
                  >
                    {{ agentType.label }}
                  </a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="版本号" name="version">
                <a-input
                  v-model:value="formState.version"
                  placeholder="例如 1.0.0"
                />
              </a-form-item>

              <a-form-item label="启用状态" name="enabled">
                <a-switch v-model:checked="formState.enabled" />
                <span class="switch-label">
                  {{ formState.enabled ? '已启用' : '已禁用' }}
                </span>
              </a-form-item>
            </a-col>

            <!-- 右栏 -->
            <a-col :span="12">
              <a-form-item label="描述" name="description">
                <a-textarea
                  v-model:value="formState.description"
                  placeholder="简要描述该代理模板的功能和用途"
                  :rows="4"
                  :maxlength="500"
                  show-count
                />
              </a-form-item>

              <a-form-item label="能力标签" name="capabilities">
                <a-select
                  v-model:value="capabilitiesList"
                  mode="tags"
                  placeholder="输入能力标签后按回车添加"
                  :token-separators="[',']"
                >
                  <a-select-option
                    v-for="cap in suggestedCapabilities"
                    :key="cap"
                    :value="cap"
                  >
                    {{ cap }}
                  </a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="工具列表" name="tools">
                <a-select
                  v-model:value="toolsList"
                  mode="tags"
                  placeholder="输入工具名称后按回车添加"
                  :token-separators="[',']"
                >
                  <a-select-option
                    v-for="tool in suggestedTools"
                    :key="tool"
                    :value="tool"
                  >
                    {{ tool }}
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>

          <!-- 系统提示词 - 全宽 -->
          <a-form-item label="系统提示词" name="system_prompt">
            <a-textarea
              v-model:value="formState.system_prompt"
              placeholder="定义代理的系统提示词，指导其行为和回复方式..."
              :rows="10"
              :maxlength="5000"
              show-count
              class="system-prompt-input"
            />
          </a-form-item>
        </a-form>
      </div>
    </a-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import type { FormInstance, Rule } from 'ant-design-vue/es/form';
import {
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons-vue';
import { useAgentsStore, type AgentTemplate } from '@/stores/agents';
import { logger, createLogger } from '@/utils/logger';

const pageLogger = createLogger('agent-template-editor');

const route = useRoute();
const router = useRouter();
const agentsStore = useAgentsStore();

// ==================== 状态 ====================

const formRef = ref<FormInstance>();
const saving = ref(false);
const loadingTemplate = ref(false);

const templateId = computed(() => route.params.id as string | undefined);
const isEditing = computed(() => !!templateId.value);

const formState = reactive({
  name: '',
  type: '',
  description: '',
  version: '1.0.0',
  system_prompt: '',
  enabled: true,
});

const capabilitiesList = ref<string[]>([]);
const toolsList = ref<string[]>([]);

// ==================== 配置 ====================

const agentTypes = [
  { value: 'code-review', label: '代码审查' },
  { value: 'code-generation', label: '代码生成' },
  { value: 'data-analysis', label: '数据分析' },
  { value: 'document-writer', label: '文档撰写' },
  { value: 'research', label: '调研分析' },
  { value: 'testing', label: '测试工程' },
  { value: 'devops', label: '运维部署' },
  { value: 'general', label: '通用代理' },
  { value: 'custom', label: '自定义' },
];

const suggestedCapabilities = [
  'code-analysis',
  'code-generation',
  'code-review',
  'testing',
  'documentation',
  'data-analysis',
  'web-search',
  'file-operations',
  'git-operations',
  'database-query',
  'api-integration',
  'natural-language',
];

const suggestedTools = [
  'read-file',
  'write-file',
  'search-code',
  'run-command',
  'git-commit',
  'git-diff',
  'database-query',
  'web-fetch',
  'analyze-code',
  'generate-test',
  'lint-code',
  'format-code',
];

const formRules: Record<string, Rule[]> = {
  name: [
    { required: true, message: '请输入模板名称', trigger: 'blur' },
    { min: 2, max: 100, message: '名称长度应在 2-100 个字符之间', trigger: 'blur' },
  ],
  type: [
    { required: true, message: '请选择代理类型', trigger: 'change' },
  ],
  version: [
    { required: true, message: '请输入版本号', trigger: 'blur' },
    { pattern: /^\d+\.\d+\.\d+$/, message: '版本号格式应为 x.y.z', trigger: 'blur' },
  ],
};

// ==================== 方法 ====================

async function loadTemplate() {
  if (!templateId.value) return;

  loadingTemplate.value = true;
  try {
    const template = await agentsStore.getTemplate(templateId.value);
    if (template) {
      formState.name = template.name;
      formState.type = template.type;
      formState.description = template.description || '';
      formState.version = template.version;
      formState.system_prompt = template.system_prompt || '';
      formState.enabled = template.enabled;

      // 解析 capabilities 和 tools (以 JSON 字符串或逗号分隔存储)
      try {
        capabilitiesList.value = template.capabilities
          ? JSON.parse(template.capabilities)
          : [];
      } catch {
        capabilitiesList.value = template.capabilities
          ? template.capabilities.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
      }

      try {
        toolsList.value = template.tools
          ? JSON.parse(template.tools)
          : [];
      } catch {
        toolsList.value = template.tools
          ? template.tools.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
      }

      pageLogger.info(`加载模板成功: ${template.name}`);
    } else {
      message.error('未找到指定的模板');
      router.back();
    }
  } catch (error) {
    pageLogger.error('加载模板失败:', error);
    message.error('加载模板失败: ' + (error as Error).message);
  } finally {
    loadingTemplate.value = false;
  }
}

async function handleSave() {
  try {
    await formRef.value?.validate();
  } catch {
    message.warning('请检查表单中的必填项');
    return;
  }

  saving.value = true;
  try {
    const templateData: Partial<AgentTemplate> = {
      name: formState.name,
      type: formState.type,
      description: formState.description,
      version: formState.version,
      system_prompt: formState.system_prompt,
      enabled: formState.enabled,
      capabilities: JSON.stringify(capabilitiesList.value),
      tools: JSON.stringify(toolsList.value),
    };

    if (isEditing.value && templateId.value) {
      const success = await agentsStore.updateTemplate(templateId.value, templateData);
      if (success) {
        message.success('模板更新成功');
        router.back();
      } else {
        message.error(agentsStore.error || '更新失败');
      }
    } else {
      const created = await agentsStore.createTemplate(templateData);
      if (created) {
        message.success('模板创建成功');
        router.back();
      } else {
        message.error(agentsStore.error || '创建失败');
      }
    }
  } catch (error) {
    pageLogger.error('保存模板失败:', error);
    message.error('保存失败: ' + (error as Error).message);
  } finally {
    saving.value = false;
  }
}

function handleCancel() {
  router.back();
}

// ==================== 生命周期 ====================

onMounted(async () => {
  pageLogger.info('AgentTemplateEditorPage 挂载', { templateId: templateId.value });
  if (isEditing.value) {
    await loadTemplate();
  }
});
</script>

<style scoped lang="scss">
.agent-template-editor-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }
  }

  .form-container {
    background: white;
    padding: 32px;
    border-radius: 8px;

    .template-form {
      max-width: 1200px;

      .switch-label {
        margin-left: 12px;
        color: #595959;
      }

      .system-prompt-input {
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 13px;
        line-height: 1.6;
      }
    }
  }
}
</style>
