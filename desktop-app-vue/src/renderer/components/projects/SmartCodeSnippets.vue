<template>
  <div class="smart-code-snippets-panel">
    <!-- 头部 -->
    <div class="snippets-header">
      <h4 class="snippets-title">
        <CodeOutlined />
        智能代码片段
      </h4>
      <a-button type="text" size="small" @click="$emit('close')">
        <CloseOutlined />
      </a-button>
    </div>

    <!-- 搜索框 -->
    <div class="snippets-search">
      <a-input
        v-model:value="searchQuery"
        placeholder="搜索代码片段..."
        allow-clear
        @change="handleSearch"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
    </div>

    <!-- 分类标签 -->
    <div class="snippets-categories">
      <a-space wrap>
        <a-tag
          v-for="category in categories"
          :key="category.key"
          :color="selectedCategory === category.key ? 'blue' : 'default'"
          style="cursor: pointer"
          @click="handleCategoryClick(category.key)"
        >
          {{ category.label }}
        </a-tag>
      </a-space>
    </div>

    <!-- 代码片段列表 -->
    <div class="snippets-list">
      <div v-if="filteredSnippets.length === 0" class="snippets-empty">
        <InboxOutlined style="font-size: 48px; color: #d9d9d9" />
        <p>未找到匹配的代码片段</p>
      </div>

      <div
        v-for="snippet in filteredSnippets"
        :key="snippet.id"
        class="snippet-item"
        @click="handleSnippetClick(snippet)"
      >
        <div class="snippet-header">
          <div class="snippet-title">
            <component :is="getLanguageIcon(snippet.language)" />
            <span>{{ snippet.title }}</span>
          </div>
          <a-space>
            <a-tag :color="getCategoryColor(snippet.category)" size="small">
              {{ getCategoryLabel(snippet.category) }}
            </a-tag>
            <a-tooltip title="复制代码">
              <a-button
                type="text"
                size="small"
                @click.stop="handleCopySnippet(snippet)"
              >
                <CopyOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="插入代码">
              <a-button
                type="text"
                size="small"
                @click.stop="handleInsertSnippet(snippet)"
              >
                <PlusCircleOutlined />
              </a-button>
            </a-tooltip>
          </a-space>
        </div>

        <div class="snippet-description">
          {{ snippet.description }}
        </div>

        <div class="snippet-code">
          <pre><code>{{ snippet.code }}</code></pre>
        </div>

        <div class="snippet-meta">
          <a-space>
            <span class="snippet-language">{{ snippet.language }}</span>
            <span class="snippet-usage">使用 {{ snippet.usageCount }} 次</span>
            <a-rate
              v-model:value="snippet.rating"
              :count="5"
              size="small"
              disabled
              style="font-size: 12px"
            />
          </a-space>
        </div>
      </div>
    </div>

    <!-- 添加自定义片段按钮 -->
    <div class="snippets-actions">
      <a-button type="dashed" block @click="handleAddSnippet">
        <PlusOutlined />
        添加自定义片段
      </a-button>
    </div>

    <!-- 添加/编辑片段对话框 -->
    <a-modal
      v-model:open="showSnippetModal"
      title="添加代码片段"
      width="600px"
      @ok="handleSaveSnippet"
      @cancel="handleCancelSnippet"
    >
      <a-form :model="snippetForm" layout="vertical">
        <a-form-item label="标题" required>
          <a-input v-model:value="snippetForm.title" placeholder="输入片段标题" />
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea
            v-model:value="snippetForm.description"
            placeholder="输入片段描述"
            :rows="2"
          />
        </a-form-item>

        <a-form-item label="分类" required>
          <a-select v-model:value="snippetForm.category" placeholder="选择分类">
            <a-select-option
              v-for="category in categories"
              :key="category.key"
              :value="category.key"
            >
              {{ category.label }}
            </a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="语言" required>
          <a-select v-model:value="snippetForm.language" placeholder="选择语言">
            <a-select-option value="javascript">JavaScript</a-select-option>
            <a-select-option value="typescript">TypeScript</a-select-option>
            <a-select-option value="vue">Vue</a-select-option>
            <a-select-option value="python">Python</a-select-option>
            <a-select-option value="java">Java</a-select-option>
            <a-select-option value="css">CSS</a-select-option>
            <a-select-option value="html">HTML</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="代码" required>
          <a-textarea
            v-model:value="snippetForm.code"
            placeholder="输入代码"
            :rows="8"
            style="font-family: monospace"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, onMounted } from 'vue';
import {
  CodeOutlined,
  CloseOutlined,
  SearchOutlined,
  InboxOutlined,
  CopyOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  FileTextOutlined,
  Html5Outlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  currentFile: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['close', 'insert-snippet']);

// 搜索状态
const searchQuery = ref('');
const selectedCategory = ref('all');

// 分类定义
const categories = [
  { key: 'all', label: '全部' },
  { key: 'component', label: 'Vue 组件' },
  { key: 'composable', label: 'Composables' },
  { key: 'utility', label: '工具函数' },
  { key: 'api', label: 'API 调用' },
  { key: 'style', label: '样式' },
  { key: 'test', label: '测试' },
];

// 代码片段数据
const snippets = ref([
  {
    id: 1,
    title: 'Vue 3 Composition API 模板',
    description: '基础的 Vue 3 组件模板，使用 Composition API',
    category: 'component',
    language: 'vue',
    code: `<template>
  <div class="component">
    <h1>{{ title }}</h1>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const title = ref('Hello World');

onMounted(() => {
  logger.info('Component mounted');
});
<\/script>

<style scoped>
.component {
  padding: 20px;
}
<\/style>`,
    usageCount: 45,
    rating: 5,
  },
  {
    id: 2,
    title: 'useDebounce Composable',
    description: '防抖 Hook，用于优化搜索等场景',
    category: 'composable',
    language: 'javascript',
    code: `import { ref, watch } from 'vue';

export function useDebounce(value, delay = 300) {
  const debouncedValue = ref(value.value);
  let timeout;

  watch(value, (newValue) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      debouncedValue.value = newValue;
    }, delay);
  });

  return debouncedValue;
}`,
    usageCount: 32,
    rating: 4,
  },
  {
    id: 3,
    title: 'API 请求封装',
    description: '统一的 API 请求方法，包含错误处理',
    category: 'api',
    language: 'javascript',
    code: `export async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(\`HTTP error! status: \${response.status}\`);
    }

    return await response.json();
  } catch (error) {
    logger.error('API request failed:', error);
    throw error;
  }
}`,
    usageCount: 28,
    rating: 5,
  },
  {
    id: 4,
    title: '深拷贝函数',
    description: '深度克隆对象或数组',
    category: 'utility',
    language: 'javascript',
    code: `export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item));
  }

  if (obj instanceof Object) {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}`,
    usageCount: 56,
    rating: 5,
  },
  {
    id: 5,
    title: 'Flexbox 居中布局',
    description: '使用 Flexbox 实现水平垂直居中',
    category: 'style',
    language: 'css',
    code: `.container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}`,
    usageCount: 89,
    rating: 4,
  },
  {
    id: 6,
    title: 'Vue 组件单元测试',
    description: '使用 Vitest 测试 Vue 组件',
    category: 'test',
    language: 'javascript',
    code: `import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MyComponent from './MyComponent.vue';

describe('MyComponent', () => {
  it('renders properly', () => {
    const wrapper = mount(MyComponent, {
      props: { title: 'Hello' }
    });
    expect(wrapper.text()).toContain('Hello');
  });

  it('emits event on click', async () => {
    const wrapper = mount(MyComponent);
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted()).toHaveProperty('click');
  });
});`,
    usageCount: 23,
    rating: 4,
  },
]);

// 添加/编辑片段
const showSnippetModal = ref(false);
const snippetForm = ref({
  title: '',
  description: '',
  category: '',
  language: '',
  code: '',
});

// 过滤后的片段
const filteredSnippets = computed(() => {
  let result = snippets.value;

  // 分类过滤
  if (selectedCategory.value !== 'all') {
    result = result.filter(s => s.category === selectedCategory.value);
  }

  // 搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(s =>
      s.title.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.code.toLowerCase().includes(query)
    );
  }

  return result;
});

// 处理搜索
const handleSearch = () => {
  // 搜索逻辑已在 computed 中处理
};

// 处理分类点击
const handleCategoryClick = (categoryKey) => {
  selectedCategory.value = categoryKey;
};

// 处理片段点击
const handleSnippetClick = (snippet) => {
  // 可以展开显示详情
  logger.info('Snippet clicked:', snippet);
};

// 复制代码片段
const handleCopySnippet = async (snippet) => {
  try {
    await navigator.clipboard.writeText(snippet.code);
    message.success('代码已复制到剪贴板');
    snippet.usageCount++;
  } catch (error) {
    message.error('复制失败');
  }
};

// 插入代码片段
const handleInsertSnippet = (snippet) => {
  emit('insert-snippet', snippet);
  message.success('代码片段已插入');
  snippet.usageCount++;
};

// 添加自定义片段
const handleAddSnippet = () => {
  snippetForm.value = {
    title: '',
    description: '',
    category: '',
    language: '',
    code: '',
  };
  showSnippetModal.value = true;
};

// 保存片段
const handleSaveSnippet = () => {
  if (!snippetForm.value.title || !snippetForm.value.code) {
    message.error('请填写标题和代码');
    return;
  }

  const newSnippet = {
    id: Date.now(),
    ...snippetForm.value,
    usageCount: 0,
    rating: 0,
  };

  snippets.value.unshift(newSnippet);
  showSnippetModal.value = false;
  message.success('代码片段已添加');
};

// 取消添加
const handleCancelSnippet = () => {
  showSnippetModal.value = false;
};

// 获取分类颜色
const getCategoryColor = (category) => {
  const colorMap = {
    component: 'blue',
    composable: 'green',
    utility: 'orange',
    api: 'purple',
    style: 'cyan',
    test: 'magenta',
  };
  return colorMap[category] || 'default';
};

// 获取分类标签
const getCategoryLabel = (category) => {
  const cat = categories.find(c => c.key === category);
  return cat ? cat.label : category;
};

// 获取语言图标
const getLanguageIcon = (language) => {
  const iconMap = {
    vue: CodeOutlined,
    javascript: CodeOutlined,
    typescript: CodeOutlined,
    python: CodeOutlined,
    java: CodeOutlined,
    css: Html5Outlined,
    html: Html5Outlined,
  };
  return iconMap[language] || FileTextOutlined;
};
</script>

<style scoped>
.smart-code-snippets-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
}

.snippets-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.snippets-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.snippets-search {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.snippets-categories {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.snippets-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.snippets-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #999;
}

.snippet-item {
  padding: 16px;
  margin-bottom: 16px;
  background: white;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.snippet-item:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.1);
}

.snippet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.snippet-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #333;
}

.snippet-description {
  font-size: 13px;
  color: #666;
  margin-bottom: 12px;
}

.snippet-code {
  background: #f5f5f5;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.snippet-code pre {
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #333;
}

.snippet-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
}

.snippet-language {
  padding: 2px 8px;
  background: #e6f7ff;
  color: #1890ff;
  border-radius: 4px;
  font-weight: 500;
}

.snippet-usage {
  color: #999;
}

.snippets-actions {
  padding: 16px;
  border-top: 1px solid #e8e8e8;
}

.snippets-list::-webkit-scrollbar {
  width: 6px;
}

.snippets-list::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}
</style>
