<template>
  <div class="skill-tool-selector">
    <a-collapse
      v-model:active-key="activeKeys"
      :bordered="false"
    >
      <!-- 技能选择 -->
      <a-collapse-panel
        key="skills"
        header="选择可用技能"
      >
        <template #extra>
          <a-badge
            :count="selectedSkills.length"
            :number-style="{ backgroundColor: '#52c41a' }"
          />
        </template>

        <div class="selector-content">
          <div class="search-bar">
            <a-input-search
              v-model:value="skillSearchKeyword"
              placeholder="搜索技能..."
              style="margin-bottom: 12px"
            >
              <template #prefix>
                <SearchOutlined />
              </template>
            </a-input-search>

            <a-select
              v-model:value="skillCategoryFilter"
              placeholder="分类筛选"
              style="width: 200px; margin-bottom: 12px"
              allow-clear
            >
              <a-select-option value="">
                全部分类
              </a-select-option>
              <a-select-option
                v-for="category in skillCategories"
                :key="category.value"
                :value="category.value"
              >
                {{ category.label }}
              </a-select-option>
            </a-select>
          </div>

          <div class="item-list">
            <a-checkbox-group
              v-model:value="selectedSkills"
              style="width: 100%"
            >
              <a-row :gutter="[12, 12]">
                <a-col
                  v-for="skill in filteredSkills"
                  :key="skill.id"
                  :span="12"
                >
                  <div
                    class="item-card"
                    :class="{ selected: selectedSkills.includes(skill.id) }"
                  >
                    <a-checkbox :value="skill.id">
                      <div class="item-info">
                        <div class="item-header">
                          <span class="item-name">
                            {{ skill.display_name || skill.name }}
                          </span>
                          <a-tag
                            :color="getCategoryColor(skill.category)"
                            size="small"
                          >
                            {{ getCategoryLabel(skill.category, skillCategories) }}
                          </a-tag>
                        </div>
                        <div class="item-description">
                          {{ skill.description || '暂无描述' }}
                        </div>
                      </div>
                    </a-checkbox>
                  </div>
                </a-col>
              </a-row>
            </a-checkbox-group>

            <a-empty
              v-if="filteredSkills.length === 0"
              description="没有找到匹配的技能"
              :image="simpleImage"
            />
          </div>
        </div>
      </a-collapse-panel>

      <!-- 工具选择 -->
      <a-collapse-panel
        key="tools"
        header="选择可用工具"
      >
        <template #extra>
          <a-badge
            :count="selectedTools.length"
            :number-style="{ backgroundColor: '#1890ff' }"
          />
        </template>

        <div class="selector-content">
          <div class="search-bar">
            <a-input-search
              v-model:value="toolSearchKeyword"
              placeholder="搜索工具..."
              style="margin-bottom: 12px"
            >
              <template #prefix>
                <SearchOutlined />
              </template>
            </a-input-search>

            <a-select
              v-model:value="toolCategoryFilter"
              placeholder="分类筛选"
              style="width: 200px; margin-bottom: 12px"
              allow-clear
            >
              <a-select-option value="">
                全部分类
              </a-select-option>
              <a-select-option
                v-for="category in toolCategories"
                :key="category.value"
                :value="category.value"
              >
                {{ category.label }}
              </a-select-option>
            </a-select>
          </div>

          <div class="item-list">
            <a-checkbox-group
              v-model:value="selectedTools"
              style="width: 100%"
            >
              <a-row :gutter="[12, 12]">
                <a-col
                  v-for="tool in filteredTools"
                  :key="tool.id"
                  :span="12"
                >
                  <div
                    class="item-card"
                    :class="{ selected: selectedTools.includes(tool.id) }"
                  >
                    <a-checkbox :value="tool.id">
                      <div class="item-info">
                        <div class="item-header">
                          <span class="item-name">
                            {{ tool.display_name || tool.name }}
                          </span>
                          <a-tag
                            :color="getCategoryColor(tool.category)"
                            size="small"
                          >
                            {{ getCategoryLabel(tool.category, toolCategories) }}
                          </a-tag>
                        </div>
                        <div class="item-description">
                          {{ tool.description || '暂无描述' }}
                        </div>
                        <div
                          v-if="tool.risk_level"
                          class="item-meta"
                        >
                          <a-tag
                            :color="getRiskColor(tool.risk_level)"
                            size="small"
                          >
                            风险等级: {{ tool.risk_level }}
                          </a-tag>
                        </div>
                      </div>
                    </a-checkbox>
                  </div>
                </a-col>
              </a-row>
            </a-checkbox-group>

            <a-empty
              v-if="filteredTools.length === 0"
              description="没有找到匹配的工具"
              :image="simpleImage"
            />
          </div>
        </div>
      </a-collapse-panel>
    </a-collapse>

    <!-- 底部统计 -->
    <div class="selector-footer">
      <div class="selection-summary">
        <span>已选择技能: <strong>{{ selectedSkills.length }}</strong></span>
        <a-divider type="vertical" />
        <span>已选择工具: <strong>{{ selectedTools.length }}</strong></span>
      </div>
      <a-space>
        <a-button
          size="small"
          @click="clearAll"
        >
          清空全部
        </a-button>
        <a-button
          type="primary"
          size="small"
          @click="selectRecommended"
        >
          使用推荐
        </a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useSkillStore } from '@/stores/skill';
import { useToolStore } from '@/stores/tool';
import { SearchOutlined } from '@ant-design/icons-vue';
import { Empty } from 'ant-design-vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({ skills: [], tools: [] }),
  },
  projectType: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue']);

const skillStore = useSkillStore();
const toolStore = useToolStore();
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

// 状态
const activeKeys = ref(['skills', 'tools']);
const selectedSkills = ref([]);
const selectedTools = ref([]);
const skillSearchKeyword = ref('');
const toolSearchKeyword = ref('');
const skillCategoryFilter = ref('');
const toolCategoryFilter = ref('');

// 技能分类
const skillCategories = [
  { label: '代码', value: 'code' },
  { label: 'Web', value: 'web' },
  { label: '数据', value: 'data' },
  { label: '内容', value: 'content' },
  { label: '文档', value: 'document' },
  { label: '媒体', value: 'media' },
  { label: 'AI', value: 'ai' },
  { label: '系统', value: 'system' },
  { label: '网络', value: 'network' },
  { label: '自动化', value: 'automation' },
  { label: '项目', value: 'project' },
  { label: '模板', value: 'template' },
];

// 工具分类
const toolCategories = [
  { label: '文件操作', value: 'file' },
  { label: '代码生成', value: 'code-generation' },
  { label: '项目管理', value: 'project' },
  { label: '系统操作', value: 'system' },
  { label: '输出格式化', value: 'output' },
  { label: '通用', value: 'general' },
];

// 过滤后的技能
const filteredSkills = computed(() => {
  let result = skillStore.enabledSkills;

  // 按搜索关键词过滤
  if (skillSearchKeyword.value) {
    const keyword = skillSearchKeyword.value.toLowerCase();
    result = result.filter(
      (s) =>
        s.name?.toLowerCase().includes(keyword) ||
        s.display_name?.toLowerCase().includes(keyword) ||
        s.description?.toLowerCase().includes(keyword)
    );
  }

  // 按分类过滤
  if (skillCategoryFilter.value) {
    result = result.filter((s) => s.category === skillCategoryFilter.value);
  }

  return result;
});

// 过滤后的工具
const filteredTools = computed(() => {
  let result = toolStore.tools.filter((t) => t.enabled);

  // 按搜索关键词过滤
  if (toolSearchKeyword.value) {
    const keyword = toolSearchKeyword.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.name?.toLowerCase().includes(keyword) ||
        t.display_name?.toLowerCase().includes(keyword) ||
        t.description?.toLowerCase().includes(keyword)
    );
  }

  // 按分类过滤
  if (toolCategoryFilter.value) {
    result = result.filter((t) => t.category === toolCategoryFilter.value);
  }

  return result;
});

// 获取分类颜色
const getCategoryColor = (category) => {
  const colors = [
    'blue',
    'green',
    'orange',
    'purple',
    'cyan',
    'magenta',
    'volcano',
    'gold',
    'lime',
  ];
  const hash = category?.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
  return colors[hash % colors.length];
};

// 获取分类标签
const getCategoryLabel = (category, categories) => {
  const categoryObj = categories.find((c) => c.value === category);
  return categoryObj ? categoryObj.label : category;
};

// 获取风险等级颜色
const getRiskColor = (level) => {
  if (level <= 2) {return 'green';}
  if (level <= 3) {return 'orange';}
  return 'red';
};

// 清空全部选择
const clearAll = () => {
  selectedSkills.value = [];
  selectedTools.value = [];
};

// 根据项目类型推荐技能和工具
const selectRecommended = () => {
  const recommendedSkills = [];
  const recommendedTools = [];

  // 根据项目类型推荐
  switch (props.projectType) {
    case 'web':
      // Web项目推荐
      recommendedSkills.push(
        ...filteredSkills.value
          .filter((s) => ['web', 'code'].includes(s.category))
          .map((s) => s.id)
          .slice(0, 3)
      );
      recommendedTools.push(
        ...filteredTools.value
          .filter((t) => ['code-generation', 'file'].includes(t.category))
          .map((t) => t.id)
          .slice(0, 3)
      );
      break;
    case 'document':
      // 文档项目推荐
      recommendedSkills.push(
        ...filteredSkills.value
          .filter((s) => ['document', 'content'].includes(s.category))
          .map((s) => s.id)
          .slice(0, 3)
      );
      recommendedTools.push(
        ...filteredTools.value
          .filter((t) => ['file', 'output'].includes(t.category))
          .map((t) => t.id)
          .slice(0, 3)
      );
      break;
    case 'data':
      // 数据分析项目推荐
      recommendedSkills.push(
        ...filteredSkills.value
          .filter((s) => ['data', 'ai'].includes(s.category))
          .map((s) => s.id)
          .slice(0, 3)
      );
      recommendedTools.push(
        ...filteredTools.value
          .filter((t) => ['file', 'output'].includes(t.category))
          .map((t) => t.id)
          .slice(0, 3)
      );
      break;
    default:
      // 通用推荐：选择使用最多的
      recommendedSkills.push(
        ...filteredSkills.value.slice(0, 3).map((s) => s.id)
      );
      recommendedTools.push(
        ...filteredTools.value.slice(0, 3).map((t) => t.id)
      );
  }

  selectedSkills.value = [...new Set(recommendedSkills)];
  selectedTools.value = [...new Set(recommendedTools)];

  message.success('已应用推荐配置');
};

// 加载数据
const loadData = async () => {
  try {
    await Promise.all([skillStore.fetchAll(), toolStore.fetchAll()]);
  } catch (error) {
    console.error('加载技能和工具失败:', error);
  }
};

// 监听选择变化
watch(
  () => [selectedSkills.value, selectedTools.value],
  () => {
    emit('update:modelValue', {
      skills: selectedSkills.value,
      tools: selectedTools.value,
    });
  },
  { deep: true }
);

// 监听外部值变化
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal) {
      selectedSkills.value = newVal.skills || [];
      selectedTools.value = newVal.tools || [];
    }
  },
  { immediate: true }
);

// 组件挂载时加载数据
onMounted(() => {
  loadData();
});
</script>

<style scoped>
.skill-tool-selector {
  background: white;
  border-radius: 8px;
  border: 1px solid #f0f0f0;
}

.skill-tool-selector :deep(.ant-collapse) {
  background: transparent;
  border: none;
}

.skill-tool-selector :deep(.ant-collapse-header) {
  font-weight: 600;
  color: #1f2937;
  padding: 12px 16px !important;
}

.skill-tool-selector :deep(.ant-collapse-content) {
  border-top: 1px solid #f0f0f0;
}

.selector-content {
  padding: 16px;
}

.search-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.item-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 4px;
}

.item-card {
  background: #fafafa;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
  transition: all 0.3s;
  cursor: pointer;
}

.item-card:hover {
  background: white;
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.15);
}

.item-card.selected {
  background: #e6f7ff;
  border-color: #1890ff;
}

.item-card :deep(.ant-checkbox-wrapper) {
  width: 100%;
}

.item-info {
  margin-left: 8px;
  width: 100%;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.item-name {
  font-weight: 600;
  color: #1f2937;
  font-size: 14px;
}

.item-description {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
  margin-top: 4px;
}

.item-meta {
  margin-top: 8px;
}

.selector-footer {
  padding: 12px 16px;
  background: #fafafa;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 0 0 8px 8px;
}

.selection-summary {
  color: #666;
  font-size: 13px;
}

.selection-summary strong {
  color: #1890ff;
  font-size: 14px;
}
</style>
