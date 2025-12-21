<template>
  <div class="template-selector">
    <div class="selector-container">
      <!-- 说明 -->
      <div class="selector-header">
        <h2>
          <FileTextOutlined />
          选择项目模板
        </h2>
        <p>基于预置模板快速创建项目，节省配置时间</p>
      </div>

      <!-- 筛选栏 -->
      <div class="filter-bar">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="搜索模板..."
          style="width: 300px"
          @search="handleSearch"
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input-search>

        <a-select
          v-model:value="selectedType"
          placeholder="项目类型"
          style="width: 150px"
          @change="handleTypeChange"
        >
          <a-select-option value="">全部类型</a-select-option>
          <a-select-option value="web">Web开发</a-select-option>
          <a-select-option value="document">文档处理</a-select-option>
          <a-select-option value="data">数据分析</a-select-option>
          <a-select-option value="app">应用开发</a-select-option>
        </a-select>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-container">
        <a-spin size="large" tip="加载模板中..." />
      </div>

      <!-- 模板列表 -->
      <div v-else-if="filteredTemplates.length > 0" class="templates-grid">
        <div
          v-for="template in filteredTemplates"
          :key="template.id"
          class="template-card"
          @click="handleSelectTemplate(template)"
        >
          <div class="card-header">
            <div class="template-icon">
              <component :is="getTypeIcon(template.project_type)" />
            </div>
            <div v-if="template.is_builtin" class="builtin-badge">
              内置模板
            </div>
          </div>

          <div class="card-content">
            <h3>{{ template.name }}</h3>
            <p class="template-description">{{ template.description }}</p>

            <div class="template-meta">
              <div class="meta-item">
                <FileOutlined />
                <span>{{ getFileCount(template) }} 文件</span>
              </div>
              <div class="meta-item">
                <ThunderboltOutlined />
                <span>使用 {{ template.usage_count || 0 }} 次</span>
              </div>
            </div>

            <a-button type="primary" block>
              使用此模板
            </a-button>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <div class="empty-icon">
          <FileTextOutlined />
        </div>
        <h3>{{ searchKeyword || selectedType ? '没有找到匹配的模板' : '暂无可用模板' }}</h3>
        <p>{{ searchKeyword || selectedType ? '尝试调整筛选条件' : '请稍后再试' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
  SearchOutlined,
  CodeOutlined,
  BarChartOutlined,
  AppstoreOutlined,
  FileOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue';

const emit = defineEmits(['select']);

// 响应式状态
const loading = ref(false);
const templates = ref([]);
const searchKeyword = ref('');
const selectedType = ref('');

// 项目类型图标映射
const typeIcons = {
  web: CodeOutlined,
  document: FileTextOutlined,
  data: BarChartOutlined,
  app: AppstoreOutlined,
};

// 计算属性
const filteredTemplates = computed(() => {
  let result = templates.value;

  // 类型筛选
  if (selectedType.value) {
    result = result.filter(t => t.project_type === selectedType.value);
  }

  // 关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(t =>
      t.name.toLowerCase().includes(keyword) ||
      (t.description && t.description.toLowerCase().includes(keyword))
    );
  }

  return result;
});

// 获取类型图标
const getTypeIcon = (type) => {
  return typeIcons[type] || CodeOutlined;
};

// 获取文件数量
const getFileCount = (template) => {
  try {
    const structure = JSON.parse(template.file_structure || '[]');
    return Array.isArray(structure) ? structure.length : 0;
  } catch {
    return 0;
  }
};

// 处理搜索
const handleSearch = () => {
  // 搜索逻辑已在computed中实现
};

// 处理类型筛选
const handleTypeChange = () => {
  // 筛选逻辑已在computed中实现
};

// 处理选择模板
const handleSelectTemplate = (template) => {
  emit('select', template);
};

// 加载模板
const loadTemplates = async () => {
  loading.value = true;

  try {
    // 从API加载模板
    const result = await window.electronAPI.project.getTemplates();

    templates.value = result || [];

    // 如果没有模板，添加一些示例模板
    if (templates.value.length === 0) {
      templates.value = getDefaultTemplates();
    }
  } catch (error) {
    console.error('Load templates failed:', error);
    message.error('加载模板失败：' + error.message);

    // 加载失败时使用默认模板
    templates.value = getDefaultTemplates();
  } finally {
    loading.value = false;
  }
};

// 获取默认模板
const getDefaultTemplates = () => {
  return [
    {
      id: 'template-vue3',
      name: 'Vue3 Web应用',
      description: '基于Vue3 + Vite + TypeScript的现代Web应用模板，包含路由、状态管理、UI组件库等',
      project_type: 'web',
      is_builtin: true,
      usage_count: 156,
      file_structure: JSON.stringify([
        'src/main.ts',
        'src/App.vue',
        'src/router/index.ts',
        'src/stores/index.ts',
        'src/components/HelloWorld.vue',
        'index.html',
        'package.json',
        'vite.config.ts',
        'tsconfig.json',
      ]),
    },
    {
      id: 'template-react',
      name: 'React Web应用',
      description: '基于React 18 + Vite + TypeScript的Web应用模板',
      project_type: 'web',
      is_builtin: true,
      usage_count: 142,
      file_structure: JSON.stringify([
        'src/main.tsx',
        'src/App.tsx',
        'src/components/Counter.tsx',
        'index.html',
        'package.json',
        'vite.config.ts',
        'tsconfig.json',
      ]),
    },
    {
      id: 'template-markdown-blog',
      name: 'Markdown博客',
      description: '支持Markdown编写的静态博客模板，包含代码高亮、文章分类等功能',
      project_type: 'document',
      is_builtin: true,
      usage_count: 89,
      file_structure: JSON.stringify([
        'posts/hello-world.md',
        'posts/about.md',
        'config.json',
        'index.html',
        'styles/main.css',
      ]),
    },
    {
      id: 'template-data-dashboard',
      name: '数据看板',
      description: '数据可视化看板模板，集成ECharts图表库',
      project_type: 'data',
      is_builtin: true,
      usage_count: 67,
      file_structure: JSON.stringify([
        'src/main.js',
        'src/charts/line.js',
        'src/charts/bar.js',
        'src/charts/pie.js',
        'src/utils/data.js',
        'index.html',
        'package.json',
      ]),
    },
    {
      id: 'template-electron-app',
      name: 'Electron桌面应用',
      description: 'Electron + Vue3桌面应用模板',
      project_type: 'app',
      is_builtin: true,
      usage_count: 54,
      file_structure: JSON.stringify([
        'src/main/index.js',
        'src/renderer/App.vue',
        'src/preload/index.js',
        'package.json',
        'electron-builder.json',
      ]),
    },
    {
      id: 'template-node-api',
      name: 'Node.js API服务',
      description: 'Express + TypeScript的后端API服务模板',
      project_type: 'web',
      is_builtin: true,
      usage_count: 78,
      file_structure: JSON.stringify([
        'src/index.ts',
        'src/routes/index.ts',
        'src/controllers/user.ts',
        'src/models/user.ts',
        'package.json',
        'tsconfig.json',
      ]),
    },
  ];
};

// 组件挂载时加载模板
onMounted(() => {
  loadTemplates();
});
</script>

<style scoped>
.template-selector {
  max-width: 1200px;
  margin: 0 auto;
}

.selector-container {
  padding: 20px 0;
}

/* 头部 */
.selector-header {
  margin-bottom: 32px;
  text-align: center;
}

.selector-header h2 {
  font-size: 28px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 12px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.selector-header h2 :deep(.anticon) {
  font-size: 32px;
  color: #667eea;
}

.selector-header p {
  font-size: 16px;
  color: #6b7280;
  margin: 0;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
  justify-content: center;
}

/* 加载状态 */
.loading-container {
  padding: 80px;
  text-align: center;
}

/* 模板网格 */
.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

/* 模板卡片 */
.template-card {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s;
  cursor: pointer;
  border: 2px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.template-card:hover {
  border-color: #667eea;
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
  transform: translateY(-4px);
}

.card-header {
  position: relative;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.template-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.template-icon :deep(.anticon) {
  font-size: 32px;
  color: white;
}

.builtin-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.9);
  color: #667eea;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.card-content {
  padding: 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-content h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.template-description {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.6;
  margin: 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-meta {
  display: flex;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
}

.meta-item :deep(.anticon) {
  font-size: 14px;
}

/* 空状态 */
.empty-state {
  padding: 80px 40px;
  text-align: center;
}

.empty-icon {
  font-size: 80px;
  color: #d1d5db;
  margin-bottom: 24px;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}
</style>
