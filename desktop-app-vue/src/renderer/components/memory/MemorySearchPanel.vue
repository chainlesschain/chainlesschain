<template>
  <div class="memory-search-panel">
    <!-- 搜索栏 -->
    <div class="search-bar">
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索记忆（支持语义搜索和关键词匹配）"
        size="large"
        enter-button="搜索"
        :loading="loading.search"
        @search="handleSearch"
        @keyup.enter="handleSearch"
      />
    </div>

    <!-- 搜索选项 -->
    <a-collapse v-model:activeKey="optionsPanelKey" ghost>
      <a-collapse-panel key="options" header="搜索选项">
        <div class="search-options">
          <div class="option-row">
            <span class="option-label">搜索范围：</span>
            <a-checkbox-group v-model:value="searchScope">
              <a-checkbox value="daily">Daily Notes</a-checkbox>
              <a-checkbox value="memory">MEMORY.md</a-checkbox>
            </a-checkbox-group>
          </div>

          <div class="option-row">
            <span class="option-label">搜索权重：</span>
            <div class="weight-sliders">
              <div class="weight-item">
                <span>语义搜索 (Vector)：{{ (vectorWeight * 100).toFixed(0) }}%</span>
                <a-slider
                  v-model:value="vectorWeight"
                  :min="0"
                  :max="1"
                  :step="0.1"
                  @change="handleWeightChange"
                />
              </div>
              <div class="weight-item">
                <span>关键词匹配 (BM25)：{{ (textWeight * 100).toFixed(0) }}%</span>
                <a-slider
                  v-model:value="textWeight"
                  :min="0"
                  :max="1"
                  :step="0.1"
                  @change="handleWeightChange"
                />
              </div>
            </div>
          </div>

          <div class="option-row">
            <span class="option-label">返回结果数：</span>
            <a-input-number v-model:value="resultLimit" :min="1" :max="50" />
          </div>
        </div>
      </a-collapse-panel>
    </a-collapse>

    <!-- 搜索结果 -->
    <div class="search-results">
      <a-spin :spinning="loading.search">
        <div v-if="searchResults.length > 0" class="results-list">
          <div class="results-header">
            <span>找到 {{ searchResults.length }} 条结果</span>
            <a-button type="text" size="small" @click="clearSearch">
              清除
            </a-button>
          </div>

          <a-list
            :data-source="searchResults"
            item-layout="vertical"
          >
            <template #renderItem="{ item, index }">
              <a-list-item class="result-item">
                <template #extra>
                  <a-tag :color="getSourceColor(item.source)">
                    {{ getSourceLabel(item.source) }}
                  </a-tag>
                  <a-tag>{{ (item.score * 100).toFixed(1) }}%</a-tag>
                </template>

                <a-list-item-meta>
                  <template #title>
                    <span class="result-title">
                      {{ getResultTitle(item) }}
                    </span>
                  </template>
                  <template #description>
                    <div class="result-meta">
                      <FileTextOutlined />
                      {{ item.document?.metadata?.type || 'unknown' }}
                      <template v-if="item.document?.metadata?.date">
                        | {{ item.document.metadata.date }}
                      </template>
                    </div>
                  </template>
                </a-list-item-meta>

                <div class="result-content">
                  {{ getResultSnippet(item) }}
                </div>

                <template #actions>
                  <a-button type="link" size="small" @click="viewDetail(item)">
                    查看详情
                  </a-button>
                  <a-button type="link" size="small" @click="copyResult(item)">
                    复制
                  </a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </div>

        <div v-else-if="searchQuery && !loading.search" class="no-results">
          <a-empty description="未找到匹配的记忆">
            <template #extra>
              <a-typography-text type="secondary">
                尝试使用不同的关键词或调整搜索权重
              </a-typography-text>
            </template>
          </a-empty>
        </div>

        <div v-else class="search-tips">
          <a-typography-title :level="5">搜索提示</a-typography-title>
          <ul>
            <li><strong>语义搜索</strong>：理解查询意图，找到语义相关的内容</li>
            <li><strong>关键词搜索</strong>：精确匹配关键词，适合技术术语查询</li>
            <li><strong>权重调整</strong>：增加 BM25 权重可提高关键词匹配准确性</li>
          </ul>

          <a-typography-title :level="5">示例查询</a-typography-title>
          <a-space wrap>
            <a-tag
              v-for="example in exampleQueries"
              :key="example"
              color="blue"
              class="example-tag"
              @click="useExample(example)"
            >
              {{ example }}
            </a-tag>
          </a-space>
        </div>
      </a-spin>
    </div>

    <!-- 详情 Modal -->
    <a-modal
      v-model:open="showDetailModal"
      title="记忆详情"
      width="800px"
      :footer="null"
    >
      <div v-if="selectedResult" class="detail-content">
        <a-descriptions bordered :column="1" size="small">
          <a-descriptions-item label="来源">
            {{ getSourceLabel(selectedResult.source) }}
          </a-descriptions-item>
          <a-descriptions-item label="类型">
            {{ selectedResult.document?.metadata?.type }}
          </a-descriptions-item>
          <a-descriptions-item v-if="selectedResult.document?.metadata?.date" label="日期">
            {{ selectedResult.document.metadata.date }}
          </a-descriptions-item>
          <a-descriptions-item label="相关度">
            {{ (selectedResult.score * 100).toFixed(2) }}%
          </a-descriptions-item>
        </a-descriptions>

        <a-divider>内容</a-divider>

        <div class="detail-markdown">
          <MarkdownViewer :content="selectedResult.document?.content || ''" />
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { message } from 'ant-design-vue';
import { FileTextOutlined } from '@ant-design/icons-vue';
import { useMemoryStore } from '@/stores/memory';
import MarkdownViewer from '@/components/common/MarkdownViewer.vue';

const memoryStore = useMemoryStore();

const {
  searchQuery: storeSearchQuery,
  searchResults,
  searchOptions,
  loading,
} = storeToRefs(memoryStore);

// 本地状态
const searchQuery = ref(storeSearchQuery.value);
const vectorWeight = ref(searchOptions.value.vectorWeight);
const textWeight = ref(searchOptions.value.textWeight);
const resultLimit = ref(searchOptions.value.limit);
const optionsPanelKey = ref([]);
const showDetailModal = ref(false);
const selectedResult = ref(null);

// 搜索范围
const searchScope = ref(['daily', 'memory']);

// 示例查询
const exampleQueries = [
  '数据库优化',
  '如何解决内存泄漏',
  'WebRTC 连接问题',
  'LLM 提供商配置',
  '架构决策',
];

// 计算属性
const searchScopeOptions = computed(() => ({
  searchDailyNotes: searchScope.value.includes('daily'),
  searchMemory: searchScope.value.includes('memory'),
}));

// 执行搜索
const handleSearch = async () => {
  if (!searchQuery.value.trim()) {
    message.warning('请输入搜索关键词');
    return;
  }

  await memoryStore.search(searchQuery.value, {
    ...searchScopeOptions.value,
    vectorWeight: vectorWeight.value,
    textWeight: textWeight.value,
    limit: resultLimit.value,
  });
};

// 权重变化
const handleWeightChange = () => {
  // 确保权重总和为 1（可选）
  memoryStore.updateSearchWeights(vectorWeight.value, textWeight.value);
};

// 清除搜索
const clearSearch = () => {
  searchQuery.value = '';
  memoryStore.clearSearch();
};

// 使用示例
const useExample = (example) => {
  searchQuery.value = example;
  handleSearch();
};

// 获取来源颜色
const getSourceColor = (source) => {
  switch (source) {
    case 'vector': return 'blue';
    case 'bm25': return 'green';
    case 'hybrid': return 'purple';
    case 'simple': return 'gray';
    default: return 'default';
  }
};

// 获取来源标签
const getSourceLabel = (source) => {
  switch (source) {
    case 'vector': return '语义匹配';
    case 'bm25': return '关键词匹配';
    case 'hybrid': return '混合搜索';
    case 'simple': return '简单搜索';
    default: return source;
  }
};

// 获取结果标题
const getResultTitle = (item) => {
  const id = item.document?.id || '';
  if (id.startsWith('daily-')) {
    return `Daily Note: ${id.replace('daily-', '')}`;
  }
  if (id === 'memory') {
    return 'MEMORY.md';
  }
  return id;
};

// 获取结果摘要
const getResultSnippet = (item) => {
  const content = item.document?.content || '';
  // 取前 200 个字符
  return content.substring(0, 200) + (content.length > 200 ? '...' : '');
};

// 查看详情
const viewDetail = (item) => {
  selectedResult.value = item;
  showDetailModal.value = true;
};

// 复制结果
const copyResult = async (item) => {
  try {
    await navigator.clipboard.writeText(item.document?.content || '');
    message.success('已复制到剪贴板');
  } catch (err) {
    message.error('复制失败');
  }
};
</script>

<style scoped>
.memory-search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.search-bar {
  margin-bottom: 16px;
}

.search-options {
  padding: 8px 0;
}

.option-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 16px;
}

.option-label {
  width: 100px;
  flex-shrink: 0;
  font-weight: 500;
}

.weight-sliders {
  flex: 1;
  max-width: 400px;
}

.weight-item {
  margin-bottom: 8px;
}

.weight-item span {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.search-results {
  flex: 1;
  overflow-y: auto;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
}

.result-item {
  padding: 12px;
  margin-bottom: 8px;
  background: var(--bg-secondary, #fafafa);
  border-radius: 8px;
}

.result-title {
  font-weight: 500;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.result-content {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.no-results {
  padding: 40px 0;
}

.search-tips {
  padding: 20px;
  background: var(--bg-secondary, #fafafa);
  border-radius: 8px;
}

.search-tips ul {
  margin: 12px 0;
  padding-left: 20px;
}

.search-tips li {
  margin-bottom: 8px;
}

.example-tag {
  cursor: pointer;
}

.example-tag:hover {
  opacity: 0.8;
}

.detail-content {
  max-height: 60vh;
  overflow-y: auto;
}

.detail-markdown {
  padding: 16px;
  background: var(--code-bg, #f6f8fa);
  border-radius: 8px;
}
</style>
