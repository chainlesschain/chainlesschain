<template>
  <div class="conversation-search-panel">
    <!-- 搜索头部 -->
    <div class="search-header">
      <h4 class="search-title">
        <SearchOutlined />
        搜索对话历史
      </h4>
      <a-button type="text" size="small" @click="$emit('close')">
        <CloseOutlined />
      </a-button>
    </div>

    <!-- 搜索输入框 -->
    <div class="search-input-container">
      <a-input
        v-model:value="searchQuery"
        placeholder="搜索消息内容..."
        size="large"
        allow-clear
        data-testid="conversation-search-input"
        @change="handleSearch"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input>
    </div>

    <!-- 过滤器 -->
    <div class="search-filters">
      <a-space>
        <a-select
          v-model:value="filterRole"
          style="width: 120px"
          size="small"
          placeholder="角色"
          @change="handleSearch"
        >
          <a-select-option value="all"> 全部 </a-select-option>
          <a-select-option value="user"> 用户 </a-select-option>
          <a-select-option value="assistant"> 助手 </a-select-option>
          <a-select-option value="system"> 系统 </a-select-option>
        </a-select>

        <a-select
          v-model:value="filterType"
          style="width: 140px"
          size="small"
          placeholder="消息类型"
          @change="handleSearch"
        >
          <a-select-option value="all"> 全部类型 </a-select-option>
          <a-select-option value="normal"> 普通对话 </a-select-option>
          <a-select-option value="task"> 任务计划 </a-select-option>
          <a-select-option value="interview"> 采访 </a-select-option>
          <a-select-option value="intent"> 意图识别 </a-select-option>
        </a-select>

        <a-select
          v-model:value="filterTime"
          style="width: 120px"
          size="small"
          placeholder="时间范围"
          @change="handleSearch"
        >
          <a-select-option value="all"> 全部时间 </a-select-option>
          <a-select-option value="today"> 今天 </a-select-option>
          <a-select-option value="week"> 本周 </a-select-option>
          <a-select-option value="month"> 本月 </a-select-option>
        </a-select>
      </a-space>
    </div>

    <!-- 搜索结果统计 -->
    <div v-if="searchQuery" class="search-stats">
      <span v-if="!isSearching">
        找到 <strong>{{ filteredResults.length }}</strong> 条结果
      </span>
      <span v-else> <LoadingOutlined spin /> 搜索中... </span>
    </div>

    <!-- 搜索结果列表 -->
    <div class="search-results">
      <div
        v-if="searchQuery && filteredResults.length === 0 && !isSearching"
        class="search-empty"
      >
        <InboxOutlined style="font-size: 48px; color: #d9d9d9" />
        <p>未找到匹配的消息</p>
        <p class="search-hint">尝试使用不同的关键词或调整过滤条件</p>
      </div>

      <div
        v-for="result in filteredResults"
        :key="result.id"
        :class="[
          'search-result-item',
          { active: selectedResultId === result.id },
        ]"
        @click="handleResultClick(result)"
      >
        <div class="result-header">
          <div class="result-role">
            <UserOutlined v-if="result.role === 'user'" />
            <RobotOutlined v-else-if="result.role === 'assistant'" />
            <ExclamationCircleOutlined v-else />
            <span>{{ getRoleName(result.role) }}</span>
          </div>
          <div class="result-time">
            {{ formatTime(result.timestamp) }}
          </div>
        </div>

        <!-- eslint-disable vue/no-v-html -- sanitized via safeHtml / renderMarkdown / DOMPurify; see docs/audits/AUDIT_2026-04-22.md §3 -->
        <div
          class="result-content"
          v-html="highlightText(result.content, searchQuery)"
        />
        <!-- eslint-enable vue/no-v-html -->

        <div v-if="result.type !== 'normal'" class="result-type-tag">
          <a-tag :color="getTypeColor(result.type)" size="small">
            {{ getTypeName(result.type) }}
          </a-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import {
  SearchOutlined,
  CloseOutlined,
  LoadingOutlined,
  InboxOutlined,
  UserOutlined,
  RobotOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons-vue";
import {
  calculateMatchScore,
  highlightText,
  getMessageCategory,
  getRoleName,
  getTypeName,
  getTypeColor,
  formatTime,
} from "./conversationSearchPanelUtils";

const props = defineProps({
  messages: {
    type: Array,
    required: true,
    default: () => [],
  },
});

const emit = defineEmits(["close", "result-click"]);

// 搜索状态
const searchQuery = ref("");
const filterRole = ref("all");
const filterType = ref("all");
const filterTime = ref("all");
const isSearching = ref(false);
const selectedResultId = ref(null);

// 搜索结果
const searchResults = ref([]);

// 执行搜索
const handleSearch = () => {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    return;
  }

  isSearching.value = true;

  // 模拟异步搜索（实际项目中可能需要后端搜索）
  setTimeout(() => {
    const query = searchQuery.value.toLowerCase().trim();

    searchResults.value = props.messages
      .filter((msg) => {
        // 内容匹配
        const contentMatch = msg.content.toLowerCase().includes(query);
        if (!contentMatch) {
          return false;
        }

        // 角色过滤
        if (filterRole.value !== "all" && msg.role !== filterRole.value) {
          return false;
        }

        // 类型过滤
        if (filterType.value !== "all") {
          const msgType = getMessageCategory(msg.type);
          if (msgType !== filterType.value) {
            return false;
          }
        }

        // 时间过滤
        if (filterTime.value !== "all") {
          const now = Date.now();
          const msgTime = msg.timestamp;

          switch (filterTime.value) {
            case "today": {
              const todayStart = new Date().setHours(0, 0, 0, 0);
              if (msgTime < todayStart) {
                return false;
              }
              break;
            }
            case "week": {
              const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
              if (msgTime < weekAgo) {
                return false;
              }
              break;
            }
            case "month": {
              const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
              if (msgTime < monthAgo) {
                return false;
              }
              break;
            }
          }
        }

        return true;
      })
      .map((msg) => ({
        ...msg,
        // 计算匹配度得分（可用于排序）
        score: calculateMatchScore(msg.content, query),
      }))
      .sort((a, b) => {
        // 按匹配度和时间排序
        if (a.score !== b.score) {
          return b.score - a.score; // 匹配度高的在前
        }
        return b.timestamp - a.timestamp; // 时间新的在前
      });

    isSearching.value = false;
  }, 100);
};

// 过滤后的结果
const filteredResults = computed(() => searchResults.value);

// 点击搜索结果
const handleResultClick = (result) => {
  selectedResultId.value = result.id;
  emit("result-click", result);
};

// 监听搜索查询变化
watch(searchQuery, () => {
  if (searchQuery.value.trim()) {
    handleSearch();
  } else {
    searchResults.value = [];
  }
});
</script>

<style scoped>
.conversation-search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
  border-left: 1px solid #e8e8e8;
}

.search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.search-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-input-container {
  padding: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.search-filters {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.search-stats {
  padding: 8px 16px;
  font-size: 13px;
  color: #666;
  background: #f5f5f5;
  border-bottom: 1px solid #e8e8e8;
}

.search-stats strong {
  color: #1890ff;
  font-weight: 600;
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.search-results::-webkit-scrollbar {
  width: 6px;
}

.search-results::-webkit-scrollbar-thumb {
  background: #d9d9d9;
  border-radius: 3px;
}

.search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #999;
}

.search-empty p {
  margin: 12px 0 4px;
  font-size: 14px;
}

.search-hint {
  font-size: 12px;
  color: #bbb;
}

.search-result-item {
  padding: 12px;
  margin-bottom: 8px;
  background: white;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.search-result-item:hover {
  border-color: #1890ff;
  box-shadow: 0 2px 8px rgba(24, 144, 255, 0.1);
}

.search-result-item.active {
  border-color: #1890ff;
  background: #e6f7ff;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.result-role {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.result-time {
  font-size: 12px;
  color: #999;
}

.result-content {
  font-size: 14px;
  line-height: 1.6;
  color: #555;
  margin-bottom: 8px;
  max-height: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.result-content :deep(mark.search-highlight) {
  background: #fff566;
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: 600;
  color: #000;
}

.result-type-tag {
  display: flex;
  justify-content: flex-end;
}
</style>
