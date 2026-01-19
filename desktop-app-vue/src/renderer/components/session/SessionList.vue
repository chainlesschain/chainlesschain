<template>
  <div class="session-list">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="left">
        <a-input-search
          ref="searchInputRef"
          v-model:value="searchQuery"
          placeholder="搜索会话标题或内容..."
          style="width: 300px"
          allow-clear
          @search="handleSearch"
          @change="handleSearchChange"
        />
        <a-select
          v-model:value="selectedTagsLocal"
          mode="multiple"
          placeholder="按标签筛选"
          style="width: 200px"
          allow-clear
          @change="handleTagFilterChange"
        >
          <a-select-option
            v-for="tag in allTags"
            :key="tag.tag"
            :value="tag.tag"
          >
            {{ tag.tag }} ({{ tag.count }})
          </a-select-option>
        </a-select>
        <a-button
          v-if="hasActiveFilters"
          type="link"
          @click="clearFilters"
        >
          清空筛选
        </a-button>
      </div>
      <div class="right">
        <a-dropdown>
          <a-button>
            <SortAscendingOutlined />
            排序
            <DownOutlined />
          </a-button>
          <template #overlay>
            <a-menu @click="handleSortMenuClick">
              <a-menu-item key="updated_at-desc">
                <ClockCircleOutlined /> 最近更新
              </a-menu-item>
              <a-menu-item key="updated_at-asc">
                <ClockCircleOutlined /> 最早更新
              </a-menu-item>
              <a-menu-item key="title-asc">
                <SortAscendingOutlined /> 标题 A-Z
              </a-menu-item>
              <a-menu-item key="title-desc">
                <SortDescendingOutlined /> 标题 Z-A
              </a-menu-item>
              <a-menu-item key="message_count-desc">
                <MessageOutlined /> 消息数最多
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <!-- 会话表格 -->
    <a-table
      :columns="columns"
      :data-source="sessions"
      :loading="loading"
      :pagination="pagination"
      :row-selection="rowSelection"
      :row-key="(record) => record.id"
      size="middle"
      @change="handleTableChange"
    >
      <!-- 标题列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <div class="session-title">
            <a-popover
              placement="right"
              trigger="hover"
              :mouse-enter-delay="0.5"
              :mouse-leave-delay="0.1"
              @open-change="(visible) => handlePreviewOpen(visible, record)"
            >
              <template #content>
                <SessionPreviewCard
                  :session="previewSession || record"
                  :loading="previewLoading"
                />
              </template>
              <a @click="$emit('view', record.id)">
                {{ record.title || "未命名会话" }}
              </a>
            </a-popover>
            <div class="session-meta">
              <span class="message-count">
                <MessageOutlined /> {{ record.message_count || 0 }} 条消息
              </span>
            </div>
          </div>
        </template>

        <!-- 标签列 -->
        <template v-else-if="column.key === 'tags'">
          <div class="tags-cell">
            <a-tag
              v-for="tag in (record.tags || []).slice(0, 3)"
              :key="tag"
              color="blue"
            >
              {{ tag }}
            </a-tag>
            <a-tag
              v-if="(record.tags || []).length > 3"
              color="default"
            >
              +{{ record.tags.length - 3 }}
            </a-tag>
            <span
              v-if="!record.tags || record.tags.length === 0"
              class="no-tags"
            >
              无标签
            </span>
          </div>
        </template>

        <!-- 更新时间列 -->
        <template v-else-if="column.key === 'updated_at'">
          <a-tooltip :title="formatFullDate(record.updated_at)">
            {{ formatRelativeTime(record.updated_at) }}
          </a-tooltip>
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-tooltip title="查看详情">
              <a-button
                type="text"
                size="small"
                @click="$emit('view', record.id)"
              >
                <EyeOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="复制会话">
              <a-button
                type="text"
                size="small"
                @click="$emit('duplicate', record.id)"
              >
                <CopyOutlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="删除">
              <a-button
                type="text"
                size="small"
                danger
                @click="$emit('delete', record.id)"
              >
                <DeleteOutlined />
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>

      <!-- 空状态 -->
      <template #emptyText>
        <a-empty description="暂无会话">
          <template #image>
            <MessageOutlined style="font-size: 64px; color: #d9d9d9" />
          </template>
        </a-empty>
      </template>
    </a-table>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import {
  SortAscendingOutlined,
  SortDescendingOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  DownOutlined,
  EyeOutlined,
  DeleteOutlined,
  CopyOutlined,
} from "@ant-design/icons-vue";
import SessionPreviewCard from "./SessionPreviewCard.vue";

// Debounce utility function
const debounce = (fn, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

const props = defineProps({
  sessions: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  selectedIds: {
    type: Array,
    default: () => [],
  },
  allTags: {
    type: Array,
    default: () => [],
  },
  filters: {
    type: Object,
    default: () => ({
      searchQuery: "",
      selectedTags: [],
      sortBy: "updated_at",
      sortOrder: "desc",
    }),
  },
});

const emit = defineEmits([
  "select",
  "view",
  "delete",
  "duplicate",
  "search",
  "filter-tags",
  "clear-filters",
  "sort-change",
]);

// 本地状态
const searchQuery = ref(props.filters.searchQuery);
const selectedTagsLocal = ref([...props.filters.selectedTags]);
const searchInputRef = ref(null);

// 预览状态
const previewSession = ref(null);
const previewLoading = ref(false);
const previewSessionId = ref(null);

// 监听 props 变化
watch(
  () => props.filters.searchQuery,
  (val) => {
    searchQuery.value = val;
  },
);
watch(
  () => props.filters.selectedTags,
  (val) => {
    selectedTagsLocal.value = [...val];
  },
);

// 表格列定义
const columns = [
  {
    title: "会话标题",
    dataIndex: "title",
    key: "title",
    width: "35%",
  },
  {
    title: "标签",
    dataIndex: "tags",
    key: "tags",
    width: "25%",
  },
  {
    title: "更新时间",
    dataIndex: "updated_at",
    key: "updated_at",
    width: "20%",
    sorter: true,
  },
  {
    title: "操作",
    key: "actions",
    width: "20%",
    align: "center",
  },
];

// 分页配置
const pagination = computed(() => ({
  pageSize: 20,
  total: props.sessions.length,
  showSizeChanger: true,
  showQuickJumper: true,
  showTotal: (total) => `共 ${total} 条`,
}));

// 行选择配置
const rowSelection = computed(() => ({
  selectedRowKeys: props.selectedIds,
  onChange: (selectedRowKeys) => {
    // 计算新增和移除的项
    const currentSet = new Set(props.selectedIds);
    const newSet = new Set(selectedRowKeys);

    for (const id of selectedRowKeys) {
      if (!currentSet.has(id)) {
        emit("select", id, true);
      }
    }
    for (const id of props.selectedIds) {
      if (!newSet.has(id)) {
        emit("select", id, false);
      }
    }
  },
}));

// 是否有活跃的筛选条件
const hasActiveFilters = computed(() => {
  return searchQuery.value.trim() !== "" || selectedTagsLocal.value.length > 0;
});

// 搜索 - 按下回车或点击搜索按钮时立即搜索
const handleSearch = (value) => {
  emit("search", value);
};

// 防抖搜索 - 输入时延迟 300ms 自动搜索
const debouncedSearch = debounce((value) => {
  emit("search", value);
}, 300);

// 搜索框变化 - 使用防抖减少请求频率
const handleSearchChange = (e) => {
  const value = e.target.value;
  if (value === "") {
    // 清空时立即触发
    emit("search", "");
  } else {
    // 输入时使用防抖
    debouncedSearch(value);
  }
};

// 标签筛选变化
const handleTagFilterChange = (tags) => {
  emit("filter-tags", tags);
};

// 清空筛选
const clearFilters = () => {
  searchQuery.value = "";
  selectedTagsLocal.value = [];
  emit("clear-filters");
};

// 排序菜单点击
const handleSortMenuClick = ({ key }) => {
  const [sortBy, sortOrder] = key.split("-");
  emit("sort-change", sortBy, sortOrder);
};

// 表格变化
const handleTableChange = (pag, filters, sorter) => {
  if (sorter.field && sorter.order) {
    const sortOrder = sorter.order === "ascend" ? "asc" : "desc";
    emit("sort-change", sorter.field, sortOrder);
  }
};

// 处理预览打开
const handlePreviewOpen = async (visible, record) => {
  if (visible && record.id !== previewSessionId.value) {
    previewLoading.value = true;
    previewSessionId.value = record.id;
    previewSession.value = null;

    try {
      // 加载完整会话信息
      const fullSession = await window.electronAPI.invoke(
        "session:load",
        record.id,
      );
      previewSession.value = fullSession;
    } catch (error) {
      console.error("[SessionList] 加载预览会话失败:", error);
      // 使用基本信息作为回退
      previewSession.value = record;
    } finally {
      previewLoading.value = false;
    }
  } else if (!visible) {
    // 关闭时清空状态（延迟，避免闪烁）
    setTimeout(() => {
      if (!previewLoading.value) {
        previewSessionId.value = null;
      }
    }, 200);
  }
};

// 聚焦搜索框
const focusSearchInput = () => {
  if (searchInputRef.value) {
    searchInputRef.value.focus();
  }
};

// 暴露给父组件的方法
defineExpose({
  focusSearchInput,
});

// 格式化相对时间
const formatRelativeTime = (timestamp) => {
  if (!timestamp) {return "-";}

  const now = Date.now();
  const time =
    typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  const diff = now - time;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (diff < minute) {
    return "刚刚";
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)} 分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)} 小时前`;
  } else if (diff < week) {
    return `${Math.floor(diff / day)} 天前`;
  } else if (diff < month) {
    return `${Math.floor(diff / week)} 周前`;
  } else {
    return formatFullDate(timestamp);
  }
};

// 格式化完整日期
const formatFullDate = (timestamp) => {
  if (!timestamp) {return "-";}

  const date = new Date(typeof timestamp === "number" ? timestamp : timestamp);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
</script>

<style lang="less" scoped>
.session-list {
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;

    .left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .session-title {
    a {
      font-weight: 500;
      color: #1890ff;
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }

    .session-meta {
      margin-top: 4px;
      font-size: 12px;
      color: #8c8c8c;

      .message-count {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
    }
  }

  .tags-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;

    .no-tags {
      color: #bfbfbf;
      font-size: 12px;
    }
  }
}

// 响应式
@media (max-width: 768px) {
  .session-list {
    .toolbar {
      flex-direction: column;
      align-items: stretch;

      .left,
      .right {
        width: 100%;
      }

      .left :deep(.ant-input-search),
      .left :deep(.ant-select) {
        width: 100% !important;
      }
    }
  }
}
</style>
