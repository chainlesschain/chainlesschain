<template>
  <div class="tool-details">
    <a-descriptions :column="1" bordered>
      <a-descriptions-item label="工具ID">
        {{ tool.id }}
      </a-descriptions-item>

      <a-descriptions-item label="工具名称">
        <a-input
          v-if="editing"
          v-model:value="editForm.name"
          placeholder="输入工具名称"
          disabled
        />
        <span v-else>{{ tool.name }}</span>
      </a-descriptions-item>

      <a-descriptions-item label="显示名称">
        <a-input
          v-if="editing"
          v-model:value="editForm.display_name"
          placeholder="输入显示名称"
        />
        <span v-else>{{ tool.display_name || '-' }}</span>
      </a-descriptions-item>

      <a-descriptions-item label="描述">
        <a-textarea
          v-if="editing"
          v-model:value="editForm.description"
          :rows="3"
          placeholder="输入描述"
        />
        <span v-else>{{ tool.description || '-' }}</span>
      </a-descriptions-item>

      <a-descriptions-item label="分类">
        <a-select
          v-if="editing"
          v-model:value="editForm.category"
          style="width: 200px"
        >
          <a-select-option value="file">文件操作</a-select-option>
          <a-select-option value="code">代码生成</a-select-option>
          <a-select-option value="project">项目管理</a-select-option>
          <a-select-option value="system">系统操作</a-select-option>
          <a-select-option value="output">输出格式化</a-select-option>
          <a-select-option value="general">通用</a-select-option>
        </a-select>
        <a-tag v-else :color="getCategoryColor(tool.category)">
          {{ getCategoryName(tool.category) }}
        </a-tag>
      </a-descriptions-item>

      <a-descriptions-item label="工具类型">
        <a-tag>{{ tool.tool_type }}</a-tag>
      </a-descriptions-item>

      <a-descriptions-item label="风险等级">
        <a-tag :color="getRiskColor(tool.risk_level)">
          {{ getRiskLabel(tool.risk_level) }}
        </a-tag>
      </a-descriptions-item>

      <a-descriptions-item label="状态">
        <a-badge :status="tool.enabled ? 'success' : 'default'" />
        <span style="margin-left: 8px">
          {{ tool.enabled ? '已启用' : '已禁用' }}
        </span>
      </a-descriptions-item>

      <a-descriptions-item label="来源">
        <a-tag v-if="tool.is_builtin" color="blue">内置</a-tag>
        <a-tag v-else-if="tool.plugin_id" color="purple">
          插件 ({{ tool.plugin_id }})
        </a-tag>
        <a-tag v-else>自定义</a-tag>
      </a-descriptions-item>
    </a-descriptions>

    <!-- 参数Schema -->
    <a-divider>参数Schema</a-divider>

    <div v-if="parsedSchema && Object.keys(parsedSchema).length > 0">
      <a-table
        :columns="paramColumns"
        :data-source="paramDataSource"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'required'">
            <a-tag v-if="record.required" color="red">必填</a-tag>
            <a-tag v-else>可选</a-tag>
          </template>
        </template>
      </a-table>
    </div>
    <a-empty v-else description="无参数" :image="simpleImage" size="small" />

    <!-- 权限要求 -->
    <a-divider>权限要求</a-divider>

    <div v-if="parsedPermissions && parsedPermissions.length > 0">
      <a-tag v-for="perm in parsedPermissions" :key="perm" color="orange">
        {{ perm }}
      </a-tag>
    </div>
    <div v-else style="color: #8c8c8c">
      无特殊权限要求
    </div>

    <!-- 文档 -->
    <a-divider>文档</a-divider>

    <ErrorBoundary>
      <MarkdownViewer
        v-if="tool.doc_path"
        :doc-path="tool.doc_path"
        :enable-link-navigation="true"
        @skill-link-click="handleSkillLinkClick"
        @tool-link-click="handleToolLinkClick"
      />
      <a-empty v-else description="暂无文档" :image="simpleImage" />
    </ErrorBoundary>

    <!-- 统计信息 -->
    <a-divider>统计信息</a-divider>

    <a-row :gutter="16">
      <a-col :span="6">
        <a-statistic title="调用次数" :value="tool.usage_count || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="成功次数" :value="tool.success_count || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="成功率"
          :value="successRate"
          suffix="%"
          :value-style="{ color: successRate >= 80 ? '#3f8600' : '#cf1322' }"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="平均耗时"
          :value="tool.avg_execution_time || 0"
          suffix="ms"
          :precision="2"
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
import { ref, computed } from 'vue';
import { message, Empty } from 'ant-design-vue';
import { useRouter } from 'vue-router';
import MarkdownViewer from '../common/MarkdownViewer.vue';
import ErrorBoundary from '../common/ErrorBoundary.vue';

const props = defineProps({
  tool: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['update', 'close']);

const router = useRouter();
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

const editing = ref(false);
const saving = ref(false);
const editForm = ref({});

// 参数表格列
const paramColumns = [
  { title: '参数名', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '必填', key: 'required', width: 80 },
  { title: '描述', dataIndex: 'description', key: 'description' },
];

// 解析Schema
const parsedSchema = computed(() => {
  if (typeof props.tool.parameters_schema === 'string') {
    try {
      return JSON.parse(props.tool.parameters_schema);
    } catch {
      return {};
    }
  }
  return props.tool.parameters_schema || {};
});

// 参数数据源
const paramDataSource = computed(() => {
  const schema = parsedSchema.value;
  return Object.entries(schema).map(([name, param]) => ({
    name,
    type: param.type || 'any',
    required: param.required || false,
    description: param.description || '-',
  }));
});

// 解析权限
const parsedPermissions = computed(() => {
  if (typeof props.tool.required_permissions === 'string') {
    try {
      return JSON.parse(props.tool.required_permissions);
    } catch {
      return [];
    }
  }
  return props.tool.required_permissions || [];
});

// 计算成功率
const successRate = computed(() => {
  const { usage_count, success_count } = props.tool;
  if (!usage_count || usage_count === 0) return 0;
  return ((success_count / usage_count) * 100).toFixed(1);
});

// 分类相关
const getCategoryColor = (category) => {
  const colorMap = {
    file: 'blue',
    code: 'cyan',
    project: 'green',
    system: 'volcano',
    output: 'orange',
    general: 'default',
  };
  return colorMap[category] || 'default';
};

const getCategoryName = (category) => {
  const nameMap = {
    file: '文件操作',
    code: '代码生成',
    project: '项目管理',
    system: '系统操作',
    output: '输出格式化',
    general: '通用',
  };
  return nameMap[category] || category;
};

// 风险等级
const getRiskColor = (level) => {
  const colorMap = {
    1: 'success',
    2: 'warning',
    3: 'orange',
    4: 'error',
    5: 'red',
  };
  return colorMap[level] || 'default';
};

const getRiskLabel = (level) => {
  const labelMap = {
    1: '低风险',
    2: '中风险',
    3: '较高风险',
    4: '高风险',
    5: '极高风险',
  };
  return labelMap[level] || '未知';
};

// 开始编辑
const startEdit = () => {
  editForm.value = {
    name: props.tool.name,
    display_name: props.tool.display_name,
    description: props.tool.description,
    category: props.tool.category,
  };
  editing.value = true;
};

// 保存编辑
const saveEdit = async () => {
  saving.value = true;
  try {
    await emit('update', props.tool.id, editForm.value);
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
</script>

<style scoped lang="scss">
.tool-details {
  .actions {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    justify-content: flex-end;
  }
}
</style>
