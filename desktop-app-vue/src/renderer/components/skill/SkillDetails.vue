<template>
  <div class="skill-details">
    <a-descriptions :column="1" bordered>
      <a-descriptions-item label="技能ID">
        {{ skill.id }}
      </a-descriptions-item>

      <a-descriptions-item label="技能名称">
        <a-input
          v-if="editing"
          v-model:value="editForm.name"
          placeholder="输入技能名称"
        />
        <span v-else>{{ skill.name }}</span>
      </a-descriptions-item>

      <a-descriptions-item label="显示名称">
        <a-input
          v-if="editing"
          v-model:value="editForm.display_name"
          placeholder="输入显示名称"
        />
        <span v-else>{{ skill.display_name || '-' }}</span>
      </a-descriptions-item>

      <a-descriptions-item label="描述">
        <a-textarea
          v-if="editing"
          v-model:value="editForm.description"
          :rows="3"
          placeholder="输入描述"
        />
        <span v-else>{{ skill.description || '-' }}</span>
      </a-descriptions-item>

      <a-descriptions-item label="分类">
        <a-select
          v-if="editing"
          v-model:value="editForm.category"
          style="width: 200px"
        >
          <a-select-option value="code">代码开发</a-select-option>
          <a-select-option value="web">Web开发</a-select-option>
          <a-select-option value="data">数据处理</a-select-option>
          <a-select-option value="content">内容创作</a-select-option>
          <a-select-option value="document">文档处理</a-select-option>
          <a-select-option value="media">媒体处理</a-select-option>
          <a-select-option value="ai">AI功能</a-select-option>
          <a-select-option value="system">系统操作</a-select-option>
          <a-select-option value="network">网络请求</a-select-option>
          <a-select-option value="automation">自动化</a-select-option>
          <a-select-option value="project">项目管理</a-select-option>
          <a-select-option value="template">模板应用</a-select-option>
        </a-select>
        <a-tag v-else :color="getCategoryColor(skill.category)">
          {{ getCategoryName(skill.category) }}
        </a-tag>
      </a-descriptions-item>

      <a-descriptions-item label="标签">
        <a-select
          v-if="editing"
          v-model:value="editForm.tags"
          mode="tags"
          style="width: 100%"
          placeholder="输入标签"
        />
        <div v-else>
          <a-tag v-for="tag in parsedTags" :key="tag">{{ tag }}</a-tag>
          <span v-if="!parsedTags.length">-</span>
        </div>
      </a-descriptions-item>

      <a-descriptions-item label="状态">
        <a-badge :status="skill.enabled ? 'success' : 'default'" />
        <span style="margin-left: 8px">
          {{ skill.enabled ? '已启用' : '已禁用' }}
        </span>
      </a-descriptions-item>

      <a-descriptions-item label="类型">
        <a-tag v-if="skill.is_builtin" color="blue">内置</a-tag>
        <a-tag v-else-if="skill.plugin_id" color="purple">
          插件 ({{ skill.plugin_id }})
        </a-tag>
        <a-tag v-else>自定义</a-tag>
      </a-descriptions-item>
    </a-descriptions>

    <!-- 包含的工具 -->
    <a-divider>包含的工具</a-divider>

    <a-spin :spinning="loadingTools">
      <a-list
        v-if="tools.length > 0"
        :data-source="tools"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                {{ item.display_name || item.name }}
              </template>
              <template #description>
                <div style="display: flex; gap: 8px; align-items: center">
                  <a-tag size="small" :color="item.role === 'primary' ? 'blue' : 'default'">
                    {{ item.role }}
                  </a-tag>
                  <span>{{ item.description }}</span>
                </div>
              </template>
            </a-list-item-meta>
            <template #actions>
              <span>优先级: {{ item.priority || 0 }}</span>
            </template>
          </a-list-item>
        </template>
      </a-list>
      <a-empty v-else description="暂无关联工具" :image="simpleImage" />
    </a-spin>

    <!-- 文档 -->
    <a-divider>文档</a-divider>

    <ErrorBoundary>
      <MarkdownViewer
        v-if="skill.doc_path"
        :doc-path="skill.id"
        :enable-link-navigation="true"
        @skill-link-click="handleSkillLinkClick"
        @tool-link-click="handleToolLinkClick"
      />
      <a-empty v-else description="暂无文档" :image="simpleImage" />
    </ErrorBoundary>

    <!-- 配置 -->
    <a-divider>配置</a-divider>

    <a-textarea
      v-model:value="configText"
      :rows="6"
      :disabled="!editing"
      placeholder="JSON 配置"
      @blur="validateConfig"
    />
    <div v-if="configError" style="color: #ff4d4f; margin-top: 8px; font-size: 12px">
      {{ configError }}
    </div>

    <!-- 统计信息 -->
    <a-divider>统计信息</a-divider>

    <a-row :gutter="16">
      <a-col :span="8">
        <a-statistic title="使用次数" :value="skill.usage_count || 0" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="成功次数" :value="skill.success_count || 0" />
      </a-col>
      <a-col :span="8">
        <a-statistic
          title="成功率"
          :value="successRate"
          suffix="%"
          :value-style="{ color: successRate >= 80 ? '#3f8600' : '#cf1322' }"
        />
      </a-col>
    </a-row>

    <!-- 操作按钮 -->
    <div class="actions">
      <a-space>
        <a-button v-if="!editing" @click="startEdit">编辑</a-button>
        <a-button v-if="editing" type="primary" @click="saveEdit" :loading="saving">保存</a-button>
        <a-button v-if="editing" @click="cancelEdit">取消</a-button>
        <a-button @click="$emit('close')">关闭</a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { message, Empty } from 'ant-design-vue';
import { useSkillStore } from '../../stores/skill';
import { useRouter } from 'vue-router';
import MarkdownViewer from '../common/MarkdownViewer.vue';
import ErrorBoundary from '../common/ErrorBoundary.vue';

const props = defineProps({
  skill: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['update', 'close']);

const skillStore = useSkillStore();
const router = useRouter();
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

const editing = ref(false);
const saving = ref(false);
const loadingTools = ref(false);
const tools = ref([]);

const editForm = ref({});
const configText = ref('');
const configError = ref('');

// 解析标签
const parsedTags = computed(() => {
  if (Array.isArray(props.skill.tags)) {
    return props.skill.tags;
  }
  if (typeof props.skill.tags === 'string') {
    try {
      return JSON.parse(props.skill.tags);
    } catch {
      return [];
    }
  }
  return [];
});

// 计算成功率
const successRate = computed(() => {
  const { usage_count, success_count } = props.skill;
  if (!usage_count || usage_count === 0) return 0;
  return ((success_count / usage_count) * 100).toFixed(1);
});

// 获取分类相关
const getCategoryColor = (category) => {
  const colorMap = {
    code: 'blue',
    web: 'cyan',
    data: 'green',
    content: 'orange',
    document: 'geekblue',
    media: 'purple',
    ai: 'magenta',
    system: 'volcano',
    network: 'lime',
    automation: 'gold',
    project: 'red',
    template: 'pink',
  };
  return colorMap[category] || 'default';
};

const getCategoryName = (category) => {
  const nameMap = {
    code: '代码开发',
    web: 'Web开发',
    data: '数据处理',
    content: '内容创作',
    document: '文档处理',
    media: '媒体处理',
    ai: 'AI功能',
    system: '系统操作',
    network: '网络请求',
    automation: '自动化',
    project: '项目管理',
    template: '模板应用',
  };
  return nameMap[category] || category;
};

// 加载工具
const loadTools = async () => {
  loadingTools.value = true;
  try {
    tools.value = await skillStore.fetchTools(props.skill.id);
  } catch (error) {
    console.error(error);
    message.error('加载工具失败');
  } finally {
    loadingTools.value = false;
  }
};

// 初始化配置文本
const initConfigText = () => {
  try {
    const config = typeof props.skill.config === 'string'
      ? JSON.parse(props.skill.config)
      : (props.skill.config || {});
    configText.value = JSON.stringify(config, null, 2);
  } catch {
    configText.value = '{}';
  }
};

// 验证配置
const validateConfig = () => {
  try {
    JSON.parse(configText.value);
    configError.value = '';
  } catch (error) {
    configError.value = '无效的 JSON 格式';
  }
};

// 开始编辑
const startEdit = () => {
  editForm.value = {
    name: props.skill.name,
    display_name: props.skill.display_name,
    description: props.skill.description,
    category: props.skill.category,
    tags: parsedTags.value,
  };
  editing.value = true;
};

// 保存编辑
const saveEdit = async () => {
  // 验证配置
  validateConfig();
  if (configError.value) {
    message.error('配置格式错误');
    return;
  }

  saving.value = true;
  try {
    const updates = {
      ...editForm.value,
      tags: JSON.stringify(editForm.value.tags),
      config: configText.value,
    };

    await emit('update', props.skill.id, updates);
    editing.value = false;
  } catch (error) {
    console.error(error);
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
};

// 取消编辑
const cancelEdit = () => {
  editing.value = false;
  initConfigText();
};

// 处理技能链接点击
const handleSkillLinkClick = (skillId) => {
  console.log('Navigate to skill:', skillId);
  router.push({ name: 'SkillManagement', query: { skillId } });
};

// 处理工具链接点击
const handleToolLinkClick = (toolId) => {
  console.log('Navigate to tool:', toolId);
  router.push({ name: 'ToolManagement', query: { toolId } });
};

// 监听技能变化
watch(() => props.skill, () => {
  initConfigText();
  loadTools();
}, { immediate: true });

onMounted(() => {
  loadTools();
  initConfigText();
});
</script>

<style scoped lang="scss">
.skill-details {
  .actions {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: flex-end;
  }
}
</style>
