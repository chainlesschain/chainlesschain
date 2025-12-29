<template>
  <div class="skill-card" :class="{ disabled: !skill.enabled }">
    <div class="card-header">
      <div class="title-row">
        <h3 class="skill-name">{{ skill.display_name || skill.name }}</h3>
        <a-switch
          :checked="skill.enabled === 1"
          :loading="switching"
          @change="handleToggle"
          size="small"
        />
      </div>
      <a-tag :color="getCategoryColor(skill.category)">
        {{ getCategoryName(skill.category) }}
      </a-tag>
    </div>

    <div class="card-body">
      <p class="description">{{ skill.description || '暂无描述' }}</p>

      <div class="tags" v-if="parsedTags && parsedTags.length">
        <a-tag v-for="tag in parsedTags" :key="tag" size="small">
          {{ tag }}
        </a-tag>
      </div>

      <div class="stats">
        <div class="stat-item">
          <span class="label">使用次数</span>
          <span class="value">{{ skill.usage_count || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="label">成功率</span>
          <span class="value">{{ successRate }}%</span>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <a-space>
        <a-button type="link" size="small" @click="$emit('view-details', skill)">
          <template #icon><EyeOutlined /></template>
          详情
        </a-button>
        <a-button type="link" size="small" @click="$emit('view-doc', skill)">
          <template #icon><FileTextOutlined /></template>
          文档
        </a-button>
      </a-space>

      <div class="meta-info">
        <a-tag v-if="skill.is_builtin" color="blue" size="small">内置</a-tag>
        <a-tag v-else-if="skill.plugin_id" color="purple" size="small">插件</a-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { EyeOutlined, FileTextOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  skill: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['view-details', 'toggle-enabled', 'view-doc']);

const switching = ref(false);

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

// 获取分类颜色
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

// 获取分类名称
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

// 处理切换
const handleToggle = async () => {
  switching.value = true;
  try {
    await emit('toggle-enabled', props.skill);
  } finally {
    switching.value = false;
  }
};
</script>

<style scoped lang="scss">
.skill-card {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 2px 6px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
  border: 1px solid #f0f0f0;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
  }

  &.disabled {
    opacity: 0.6;
    background: #fafafa;
  }

  .card-header {
    margin-bottom: 12px;

    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;

      .skill-name {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #262626;
        flex: 1;
      }
    }
  }

  .card-body {
    .description {
      color: #595959;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 12px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .tags {
      margin-bottom: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .stats {
      display: flex;
      gap: 24px;
      padding: 12px 0;
      border-top: 1px solid #f0f0f0;
      border-bottom: 1px solid #f0f0f0;

      .stat-item {
        display: flex;
        flex-direction: column;
        gap: 4px;

        .label {
          font-size: 12px;
          color: #8c8c8c;
        }

        .value {
          font-size: 16px;
          font-weight: 600;
          color: #262626;
        }
      }
    }
  }

  .card-footer {
    margin-top: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;

    .meta-info {
      display: flex;
      gap: 4px;
    }
  }
}
</style>
