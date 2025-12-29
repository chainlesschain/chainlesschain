<template>
  <div class="tool-card" :class="{ disabled: !tool.enabled, deprecated: tool.deprecated }">
    <div class="card-header">
      <div class="title-row">
        <h3 class="tool-name">
          {{ tool.display_name || tool.name }}
          <a-tag v-if="tool.deprecated" color="orange" size="small">已废弃</a-tag>
        </h3>
        <a-switch
          :checked="tool.enabled === 1"
          :loading="switching"
          :disabled="tool.deprecated === 1"
          @change="handleToggle"
          size="small"
        />
      </div>
      <a-space>
        <a-tag :color="getCategoryColor(tool.category)">
          {{ getCategoryName(tool.category) }}
        </a-tag>
        <a-tag :color="getRiskLevelColor(tool.risk_level)">
          风险等级: {{ tool.risk_level || 1 }}
        </a-tag>
      </a-space>
    </div>

    <div class="card-body">
      <p class="description">{{ tool.description || '暂无描述' }}</p>

      <div class="tool-type">
        <span class="label">类型:</span>
        <a-tag size="small">{{ getToolTypeName(tool.tool_type) }}</a-tag>
      </div>

      <div class="stats">
        <div class="stat-item">
          <span class="label">调用次数</span>
          <span class="value">{{ tool.usage_count || 0 }}</span>
        </div>
        <div class="stat-item">
          <span class="label">成功率</span>
          <span class="value">{{ successRate }}%</span>
        </div>
        <div class="stat-item">
          <span class="label">平均耗时</span>
          <span class="value">{{ avgTime }}ms</span>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <a-space>
        <a-button type="link" size="small" @click="$emit('view-details', tool)">
          <template #icon><EyeOutlined /></template>
          详情
        </a-button>
        <a-button type="link" size="small" @click="$emit('test-tool', tool)">
          <template #icon><ExperimentOutlined /></template>
          测试
        </a-button>
        <a-button type="link" size="small" @click="$emit('view-doc', tool)">
          <template #icon><FileTextOutlined /></template>
          文档
        </a-button>
      </a-space>

      <div class="meta-info">
        <a-tag v-if="tool.is_builtin" color="blue" size="small">内置</a-tag>
        <a-tag v-else-if="tool.plugin_id" color="purple" size="small">插件</a-tag>
        <a-tag v-else color="green" size="small">自定义</a-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { EyeOutlined, FileTextOutlined, ExperimentOutlined } from '@ant-design/icons-vue';

const props = defineProps({
  tool: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['view-details', 'toggle-enabled', 'view-doc', 'test-tool']);

const switching = ref(false);

// 计算成功率
const successRate = computed(() => {
  const { usage_count, success_count } = props.tool;
  if (!usage_count || usage_count === 0) return 0;
  return ((success_count / usage_count) * 100).toFixed(1);
});

// 平均执行时间
const avgTime = computed(() => {
  const time = props.tool.avg_execution_time || 0;
  return time.toFixed(2);
});

// 切换启用状态
const handleToggle = async (checked) => {
  switching.value = true;
  try {
    await emit('toggle-enabled', props.tool.id, checked);
  } finally {
    switching.value = false;
  }
};

// 获取分类颜色
const getCategoryColor = (category) => {
  const colorMap = {
    file: 'blue',
    code: 'cyan',
    data: 'green',
    network: 'orange',
    system: 'red',
    ai: 'purple',
    format: 'geekblue',
    'version-control': 'magenta',
    web: 'lime',
    project: 'volcano',
  };
  return colorMap[category] || 'default';
};

// 获取分类名称
const getCategoryName = (category) => {
  const nameMap = {
    file: '文件操作',
    code: '代码处理',
    data: '数据处理',
    network: '网络请求',
    system: '系统操作',
    ai: 'AI功能',
    format: '格式化',
    'version-control': '版本控制',
    web: 'Web开发',
    project: '项目管理',
  };
  return nameMap[category] || category;
};

// 获取工具类型名称
const getToolTypeName = (type) => {
  const nameMap = {
    function: '函数',
    api: 'API',
    command: '命令',
    script: '脚本',
  };
  return nameMap[type] || type;
};

// 获取风险等级颜色
const getRiskLevelColor = (level) => {
  if (level <= 1) return 'green';
  if (level === 2) return 'blue';
  if (level === 3) return 'orange';
  return 'red';
};
</script>

<style scoped>
.tool-card {
  background: white;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.tool-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.tool-card.disabled {
  opacity: 0.6;
  background: #f5f5f5;
}

.tool-card.deprecated {
  border-color: #ff7875;
  background: #fff1f0;
}

.card-header {
  margin-bottom: 12px;
}

.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.tool-name {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-body {
  margin-bottom: 12px;
}

.description {
  color: #595959;
  font-size: 14px;
  margin-bottom: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tool-type {
  margin-bottom: 12px;
  font-size: 13px;
}

.tool-type .label {
  color: #8c8c8c;
  margin-right: 6px;
}

.stats {
  display: flex;
  gap: 16px;
  padding: 8px 0;
  border-top: 1px dashed #e8e8e8;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-item .label {
  font-size: 12px;
  color: #8c8c8c;
}

.stat-item .value {
  font-size: 14px;
  font-weight: 600;
  color: #262626;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.meta-info {
  display: flex;
  gap: 4px;
}
</style>
