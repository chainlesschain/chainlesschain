<template>
  <a-modal
    v-model:open="visible"
    :title="null"
    :footer="null"
    :width="700"
    :closable="false"
    class="global-search-modal"
    :body-style="{ padding: 0 }"
  >
    <!-- 搜索框 -->
    <div class="search-header">
      <SearchOutlined class="search-icon" />
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        placeholder="搜索笔记、文件、对话、项目..."
        class="search-input"
        @input="handleSearch"
        @keydown="handleKeyDown"
      >
      <a-spin
        v-if="isSearching"
        size="small"
      />
      <CloseOutlined
        v-else
        class="close-icon"
        @click="handleClose"
      />
    </div>

    <!-- 搜索类型过滤 -->
    <div class="search-filters">
      <a-radio-group
        v-model:value="searchType"
        button-style="solid"
        size="small"
      >
        <a-radio-button :value="SearchType.ALL">
          全部 ({{ totalResults }})
        </a-radio-button>
        <a-radio-button :value="SearchType.NOTES">
          <FileTextOutlined />
          笔记 ({{ getTypeCount(SearchType.NOTES) }})
        </a-radio-button>
        <a-radio-button :value="SearchType.FILES">
          <FileOutlined />
          文件 ({{ getTypeCount(SearchType.FILES) }})
        </a-radio-button>
        <a-radio-button :value="SearchType.CHATS">
          <MessageOutlined />
          对话 ({{ getTypeCount(SearchType.CHATS) }})
        </a-radio-button>
        <a-radio-button :value="SearchType.PROJECTS">
          <FolderOutlined />
          项目 ({{ getTypeCount(SearchType.PROJECTS) }})
        </a-radio-button>
      </a-radio-group>
    </div>

    <!-- 搜索建议 -->
    <div
      v-if="showSuggestions && suggestions.length > 0"
      class="search-suggestions"
    >
      <div class="suggestions-header">
        <HistoryOutlined />
        搜索历史
      </div>
      <div
        v-for="(suggestion, index) in suggestions"
        :key="index"
        class="suggestion-item"
        :class="{ active: index === selectedSuggestionIndex }"
        @click="applySuggestion(suggestion)"
        @mouseenter="selectedSuggestionIndex = index"
      >
        <ClockCircleOutlined />
        {{ suggestion }}
      </div>
    </div>

    <!-- 搜索结果 -->
    <div
      ref="resultsContainer"
      class="search-results"
    >
      <!-- 空状态 -->
      <a-empty
        v-if="!isSearching && searchQuery && filteredResults.length === 0"
        description="没有找到匹配的结果"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
      >
        <template #description>
          <div class="empty-tips">
            <p>没有找到 "{{ searchQuery }}" 的相关结果</p>
            <p class="empty-hint">
              试试其他关键词或检查拼写
            </p>
          </div>
        </template>
      </a-empty>

      <!-- 初始状态 -->
      <div
        v-else-if="!searchQuery"
        class="search-tips"
      >
        <div class="tips-icon">
          <SearchOutlined />
        </div>
        <h3>全局搜索</h3>
        <p>搜索笔记、文件、对话、项目等内容</p>
        <div class="tips-shortcuts">
          <div class="shortcut-item">
            <kbd>Ctrl</kbd> + <kbd>K</kbd> 打开搜索
          </div>
          <div class="shortcut-item">
            <kbd>↑</kbd> <kbd>↓</kbd> 选择结果
          </div>
          <div class="shortcut-item">
            <kbd>Enter</kbd> 打开
          </div>
          <div class="shortcut-item">
            <kbd>Esc</kbd> 关闭
          </div>
        </div>
      </div>

      <!-- 结果列表 -->
      <div
        v-else
        class="results-list"
      >
        <div
          v-for="(result, index) in filteredResults"
          :key="result.id"
          class="result-item"
          :class="{
            active: index === selectedResultIndex,
            [`result-type-${result.type}`]: true,
          }"
          @click="handleResultClick(result)"
          @mouseenter="selectedResultIndex = index"
        >
          <!-- 图标 -->
          <div class="result-icon">
            <component :is="getResultIcon(result.type)" />
          </div>

          <!-- 内容 -->
          <div class="result-content">
            <div class="result-title">
              <span v-html="highlightMatch(result.title)" />
              <a-tag
                size="small"
                :color="getTypeColor(result.type)"
              >
                {{ getTypeName(result.type) }}
              </a-tag>
            </div>
            <div
              v-if="result.description"
              class="result-description"
            >
              <span v-html="highlightMatch(result.description)" />
            </div>
            <div class="result-meta">
              <span
                v-if="result.path"
                class="result-path"
              >
                <FolderOutlined />
                {{ result.path }}
              </span>
              <span class="result-score">
                相关度: {{ Math.round(result.score) }}%
              </span>
            </div>
          </div>

          <!-- 操作 -->
          <div class="result-actions">
            <a-button
              type="text"
              size="small"
            >
              <EnterOutlined />
            </a-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="search-footer">
      <div class="footer-info">
        <span v-if="searchQuery">
          找到 {{ filteredResults.length }} 个结果
        </span>
        <span v-else>
          索引统计: {{ formatStatistics() }}
        </span>
      </div>
      <div class="footer-actions">
        <a-button
          type="link"
          size="small"
          @click="handleClearHistory"
        >
          清空历史
        </a-button>
        <a-button
          type="link"
          size="small"
          @click="handleRebuildIndex"
        >
          重建索引
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { message, Empty } from 'ant-design-vue';
import {
  SearchOutlined,
  CloseOutlined,
  FileTextOutlined,
  FileOutlined,
  MessageOutlined,
  FolderOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  EnterOutlined,
  BookOutlined,
  ProjectOutlined,
  UserOutlined,
} from '@ant-design/icons-vue';
import { useGlobalSearch, SearchType } from '@/utils/globalSearchManager';
import { useRouter } from 'vue-router';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const router = useRouter();

const {
  isSearching,
  searchHistory,
  search,
  clearHistory,
  getSuggestions,
  getStatistics,
  rebuildIndex,
} = useGlobalSearch();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const searchInput = ref(null);
const resultsContainer = ref(null);
const searchQuery = ref('');
const searchType = ref(SearchType.ALL);
const searchResults = ref([]);
const selectedResultIndex = ref(0);
const selectedSuggestionIndex = ref(0);
const searchTimer = ref(null);

// 搜索建议
const suggestions = computed(() => {
  if (!searchQuery.value) {return searchHistory.value.slice(0, 5).map(h => h.query);}
  return getSuggestions(searchQuery.value, 5);
});

const showSuggestions = computed(() => {
  return !searchQuery.value || (searchQuery.value.length > 0 && searchQuery.value.length < 3);
});

// 过滤后的结果
const filteredResults = computed(() => {
  if (searchType.value === SearchType.ALL) {
    return searchResults.value;
  }
  return searchResults.value.filter(r => r.type === searchType.value);
});

// 总结果数
const totalResults = computed(() => searchResults.value.length);

// 获取类型数量
const getTypeCount = (type) => {
  return searchResults.value.filter(r => r.type === type).length;
};

// 获取结果图标
const getResultIcon = (type) => {
  const iconMap = {
    [SearchType.NOTES]: FileTextOutlined,
    [SearchType.FILES]: FileOutlined,
    [SearchType.CHATS]: MessageOutlined,
    [SearchType.PROJECTS]: FolderOutlined,
    [SearchType.CONTACTS]: UserOutlined,
    [SearchType.COMMANDS]: BookOutlined,
  };
  return iconMap[type] || FileOutlined;
};

// 获取类型颜色
const getTypeColor = (type) => {
  const colorMap = {
    [SearchType.NOTES]: 'blue',
    [SearchType.FILES]: 'green',
    [SearchType.CHATS]: 'purple',
    [SearchType.PROJECTS]: 'orange',
    [SearchType.CONTACTS]: 'cyan',
    [SearchType.COMMANDS]: 'magenta',
  };
  return colorMap[type] || 'default';
};

// 获取类型名称
const getTypeName = (type) => {
  const nameMap = {
    [SearchType.NOTES]: '笔记',
    [SearchType.FILES]: '文件',
    [SearchType.CHATS]: '对话',
    [SearchType.PROJECTS]: '项目',
    [SearchType.CONTACTS]: '联系人',
    [SearchType.COMMANDS]: '命令',
  };
  return nameMap[type] || type;
};

// 高亮匹配文本
const highlightMatch = (text) => {
  if (!searchQuery.value || !text) {return text;}

  const regex = new RegExp(`(${searchQuery.value})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
};

// 格式化统计信息
const formatStatistics = () => {
  const stats = getStatistics();
  const parts = [];
  for (const [type, count] of Object.entries(stats)) {
    if (count > 0) {
      parts.push(`${getTypeName(type)} ${count}`);
    }
  }
  return parts.join(', ') || '暂无索引';
};

// 处理搜索
const handleSearch = () => {
  // 防抖
  if (searchTimer.value) {
    clearTimeout(searchTimer.value);
  }

  searchTimer.value = setTimeout(async () => {
    if (!searchQuery.value || searchQuery.value.trim().length === 0) {
      searchResults.value = [];
      return;
    }

    try {
      const results = await search(searchQuery.value, {
        type: searchType.value === SearchType.ALL ? null : searchType.value,
        limit: 50,
      });
      searchResults.value = results;
      selectedResultIndex.value = 0;
    } catch (error) {
      logger.error('[GlobalSearch] Search error:', error);
      message.error('搜索失败');
    }
  }, 300);
};

// 应用建议
const applySuggestion = (suggestion) => {
  searchQuery.value = suggestion;
  handleSearch();
};

// 处理结果点击
const handleResultClick = (result) => {
  if (result.action) {
    result.action();
  } else {
    // 默认操作：根据类型跳转
    switch (result.type) {
      case SearchType.NOTES:
        router.push(`/notes/${result.id}`);
        break;
      case SearchType.CHATS:
        router.push(`/chat/${result.id}`);
        break;
      case SearchType.PROJECTS:
        router.push(`/projects/${result.id}`);
        break;
      default:
        message.info(`打开: ${result.title}`);
    }
  }
  handleClose();
};

// 键盘导航
const handleKeyDown = (event) => {
  if (showSuggestions.value && suggestions.value.length > 0) {
    // 建议列表导航
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectedSuggestionIndex.value = Math.min(
          selectedSuggestionIndex.value + 1,
          suggestions.value.length - 1
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedSuggestionIndex.value = Math.max(selectedSuggestionIndex.value - 1, 0);
        break;
      case 'Enter':
        event.preventDefault();
        if (suggestions.value[selectedSuggestionIndex.value]) {
          applySuggestion(suggestions.value[selectedSuggestionIndex.value]);
        }
        break;
    }
  } else {
    // 结果列表导航
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectedResultIndex.value = Math.min(
          selectedResultIndex.value + 1,
          filteredResults.value.length - 1
        );
        scrollToSelected();
        break;
      case 'ArrowUp':
        event.preventDefault();
        selectedResultIndex.value = Math.max(selectedResultIndex.value - 1, 0);
        scrollToSelected();
        break;
      case 'Enter':
        event.preventDefault();
        if (filteredResults.value[selectedResultIndex.value]) {
          handleResultClick(filteredResults.value[selectedResultIndex.value]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        handleClose();
        break;
    }
  }
};

// 滚动到选中项
const scrollToSelected = () => {
  nextTick(() => {
    const selected = resultsContainer.value?.querySelector('.result-item.active');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
};

// 关闭搜索
const handleClose = () => {
  visible.value = false;
  searchQuery.value = '';
  searchResults.value = [];
  selectedResultIndex.value = 0;
};

// 清空历史
const handleClearHistory = () => {
  clearHistory();
  message.success('搜索历史已清空');
};

// 重建索引
const handleRebuildIndex = async () => {
  try {
    message.loading('正在重建索引...', 0);
    await Promise.all([
      rebuildIndex(SearchType.NOTES),
      rebuildIndex(SearchType.FILES),
      rebuildIndex(SearchType.CHATS),
      rebuildIndex(SearchType.PROJECTS),
    ]);
    message.destroy();
    message.success('索引重建完成');
  } catch (error) {
    message.destroy();
    message.error('索引重建失败');
  }
};

// 监听面板打开
watch(visible, (newValue) => {
  if (newValue) {
    nextTick(() => {
      searchInput.value?.focus();
    });
  }
});

// 监听搜索类型变化
watch(searchType, () => {
  selectedResultIndex.value = 0;
});

// 重置选中索引
watch(searchQuery, () => {
  selectedResultIndex.value = 0;
  selectedSuggestionIndex.value = 0;
});
</script>

<style scoped>
.global-search-modal :deep(.ant-modal-content) {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.2);
}

.search-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid #f0f0f0;
}

.search-icon {
  font-size: 20px;
  color: #8c8c8c;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 16px;
  color: #262626;
  background: transparent;
}

.search-input::placeholder {
  color: #bfbfbf;
}

.close-icon {
  font-size: 16px;
  color: #8c8c8c;
  cursor: pointer;
  transition: color 0.2s;
}

.close-icon:hover {
  color: #262626;
}

.search-filters {
  padding: 12px 24px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.search-suggestions {
  border-bottom: 1px solid #f0f0f0;
}

.suggestions-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  font-size: 12px;
  color: #8c8c8c;
  background: #fafafa;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.suggestion-item:hover,
.suggestion-item.active {
  background-color: #f5f5f5;
}

.search-results {
  max-height: 500px;
  overflow-y: auto;
}

.search-tips {
  padding: 60px 40px;
  text-align: center;
  color: #8c8c8c;
}

.tips-icon {
  font-size: 64px;
  margin-bottom: 24px;
  opacity: 0.5;
}

.search-tips h3 {
  font-size: 20px;
  color: #262626;
  margin-bottom: 8px;
}

.search-tips p {
  font-size: 14px;
  margin-bottom: 32px;
}

.tips-shortcuts {
  display: flex;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
}

.shortcut-item {
  font-size: 12px;
  color: #595959;
}

.shortcut-item kbd {
  display: inline-block;
  padding: 3px 8px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  background: #ffffff;
  border: 1px solid #d9d9d9;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.empty-tips p {
  margin: 4px 0;
}

.empty-hint {
  font-size: 12px;
  color: #bfbfbf;
}

.results-list {
  padding: 8px 0;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.result-item:hover,
.result-item.active {
  background-color: #f5f5f5;
  border-left-color: #1890ff;
}

.result-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.04);
}

.result-type-notes .result-icon {
  color: #1890ff;
  background: #e6f7ff;
}

.result-type-files .result-icon {
  color: #52c41a;
  background: #f6ffed;
}

.result-type-chats .result-icon {
  color: #722ed1;
  background: #f9f0ff;
}

.result-type-projects .result-icon {
  color: #fa8c16;
  background: #fff7e6;
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 4px;
}

.result-title :deep(mark) {
  background-color: #ffe58f;
  padding: 0 2px;
  border-radius: 2px;
}

.result-description {
  font-size: 13px;
  color: #595959;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-description :deep(mark) {
  background-color: #ffe58f;
  padding: 0 2px;
  border-radius: 2px;
}

.result-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #8c8c8c;
}

.result-path {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-actions {
  flex-shrink: 0;
}

.search-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
  font-size: 12px;
  color: #8c8c8c;
}

.footer-actions {
  display: flex;
  gap: 8px;
}

/* 滚动条样式 */
.search-results::-webkit-scrollbar {
  width: 6px;
}

.search-results::-webkit-scrollbar-track {
  background: transparent;
}

.search-results::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}

.search-results::-webkit-scrollbar-thumb:hover {
  background: #bfbfbf;
}
</style>
