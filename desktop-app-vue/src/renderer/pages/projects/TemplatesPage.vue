<template>
  <div class="templates-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <h1>
            <FileTextOutlined />
            项目模板
          </h1>
          <p>选择合适的模板快速创建项目，支持自定义模板和社区分享</p>
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-left">
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

        <a-radio-group v-model:value="templateSource" button-style="solid">
          <a-radio-button value="all">全部</a-radio-button>
          <a-radio-button value="builtin">内置</a-radio-button>
          <a-radio-button value="custom">自定义</a-radio-button>
        </a-radio-group>
      </div>

      <div class="filter-right">
        <a-button @click="handleRefresh">
          <ReloadOutlined :spin="loading" />
          刷新
        </a-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div class="stats-bar">
      <div class="stat-item">
        <div class="stat-value">{{ filteredTemplates.length }}</div>
        <div class="stat-label">可用模板</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ builtinCount }}</div>
        <div class="stat-label">内置模板</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{ customCount }}</div>
        <div class="stat-label">自定义模板</div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="加载模板中..." />
    </div>

    <!-- 模板列表 -->
    <div v-else-if="filteredTemplates.length > 0" class="templates-container">
      <div class="templates-grid">
        <TemplateCard
          v-for="template in filteredTemplates"
          :key="template.id"
          :template="template"
          @use="handleUseTemplate"
        />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <FileTextOutlined />
      </div>
      <h3>{{ searchKeyword || selectedType !== '' ? '没有找到匹配的模板' : '暂无可用模板' }}</h3>
      <p>{{ searchKeyword || selectedType !== '' ? '尝试调整筛选条件' : '请稍后再试' }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import TemplateCard from '@/components/projects/TemplateCard.vue';

const router = useRouter();

// 响应式状态
const loading = ref(false);
const templates = ref([]);
const searchKeyword = ref('');
const selectedType = ref('');
const templateSource = ref('all');

// 计算属性
const filteredTemplates = computed(() => {
  let result = templates.value;

  // 类型筛选
  if (selectedType.value) {
    result = result.filter(t => t.project_type === selectedType.value);
  }

  // 来源筛选
  if (templateSource.value === 'builtin') {
    result = result.filter(t => t.is_builtin);
  } else if (templateSource.value === 'custom') {
    result = result.filter(t => !t.is_builtin);
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

const builtinCount = computed(() => {
  return templates.value.filter(t => t.is_builtin).length;
});

const customCount = computed(() => {
  return templates.value.filter(t => !t.is_builtin).length;
});

// 处理搜索
const handleSearch = () => {
  // 搜索逻辑已在computed中实现
};

// 处理类型筛选
const handleTypeChange = () => {
  // 筛选逻辑已在computed中实现
};

// 刷新模板列表
const handleRefresh = async () => {
  await loadTemplates();
  message.success('模板列表已刷新');
};

// 使用模板
const handleUseTemplate = (template) => {
  // 跳转到新建项目页面，并预选模板
  router.push({
    path: '/projects/new',
    query: {
      tab: 'template',
      templateId: template.id,
    },
  });
};

// 加载模板
const loadTemplates = async () => {
  loading.value = true;

  try {
    const result = await window.electronAPI.project.getTemplates();
    templates.value = result || [];

    // 如果没有模板，添加默认模板
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
      description: '基于Vue3 + Vite + TypeScript的现代Web应用模板，包含路由、状态管理、UI组件库等完整配置',
      project_type: 'web',
      is_builtin: true,
      usage_count: 156,
      cover_image_url: null,
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
      description: '基于React 18 + Vite + TypeScript的Web应用模板，集成React Router和常用hooks',
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
      description: '支持Markdown编写的静态博客模板，包含代码高亮、文章分类、标签管理等功能',
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
      description: '数据可视化看板模板，集成ECharts图表库，支持多种图表类型和数据源对接',
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
      description: 'Electron + Vue3桌面应用模板，包含主进程、渲染进程和预加载脚本的完整结构',
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
      description: 'Express + TypeScript的后端API服务模板，包含路由、控制器、中间件的MVC架构',
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
    {
      id: 'template-python-ml',
      name: 'Python机器学习项目',
      description: 'Python机器学习项目模板，包含Jupyter Notebook、数据预处理、模型训练等基础结构',
      project_type: 'data',
      is_builtin: true,
      usage_count: 45,
      file_structure: JSON.stringify([
        'notebooks/explore.ipynb',
        'src/data_preprocessing.py',
        'src/model.py',
        'requirements.txt',
        'README.md',
      ]),
    },
    {
      id: 'template-landing-page',
      name: '落地页模板',
      description: '响应式网站落地页模板，适用于产品展示、活动宣传等场景',
      project_type: 'web',
      is_builtin: true,
      usage_count: 92,
      file_structure: JSON.stringify([
        'index.html',
        'css/styles.css',
        'js/main.js',
        'images/.gitkeep',
        'README.md',
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
.templates-page {
  padding: 24px;
  min-height: calc(100vh - 120px);
  background: #f5f7fa;
}

.page-header {
  background: white;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #1f2937;
}

.header-left p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

/* 筛选栏 */
.filter-bar {
  background: white;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.filter-left {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* 统计栏 */
.stats-bar {
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  gap: 48px;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #667eea;
  line-height: 1;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #6b7280;
}

/* 加载状态 */
.loading-container {
  background: white;
  border-radius: 8px;
  padding: 80px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* 模板容器 */
.templates-container {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

/* 空状态 */
.empty-state {
  background: white;
  border-radius: 8px;
  padding: 80px 40px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
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
