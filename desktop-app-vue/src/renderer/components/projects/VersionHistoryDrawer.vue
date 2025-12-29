<template>
  <a-drawer
    v-model:open="modalVisible"
    title="版本历史"
    :width="400"
    placement="right"
    class="version-history-drawer"
    @close="handleClose"
  >
    <!-- 顶部操作栏 -->
    <div class="drawer-header">
      <a-input-search
        v-model:value="searchKeyword"
        placeholder="搜索版本..."
        allow-clear
        @search="handleSearch"
      />
    </div>

    <!-- 版本列表 -->
    <div class="version-list">
      <div
        v-for="version in filteredVersions"
        :key="version.id"
        class="version-item"
        :class="{
          'is-active': version.id === currentVersionId,
          'is-selected': selectedVersionId === version.id
        }"
        @click="handleVersionClick(version)"
      >
        <!-- 版本头部 -->
        <div class="version-header">
          <div class="version-number">
            <HistoryOutlined class="version-icon" />
            <span class="version-text">#{{ version.number }}</span>
            <a-tag v-if="version.id === currentVersionId" color="green" size="small">
              当前版本
            </a-tag>
          </div>
          <div class="version-time">{{ formatTime(version.createdAt) }}</div>
        </div>

        <!-- 版本标题 -->
        <div class="version-title">{{ version.title }}</div>

        <!-- 版本描述 -->
        <div v-if="version.description" class="version-description">
          {{ version.description }}
        </div>

        <!-- 变更统计 -->
        <div class="version-stats">
          <span class="stat-item stat-add">
            <PlusOutlined />
            {{ version.stats.added }} 行
          </span>
          <span class="stat-item stat-delete">
            <MinusOutlined />
            {{ version.stats.deleted }} 行
          </span>
          <span class="stat-item stat-modify">
            <EditOutlined />
            {{ version.stats.modified }} 文件
          </span>
        </div>

        <!-- 操作按钮 -->
        <div class="version-actions">
          <a-button
            v-if="version.id !== currentVersionId"
            type="link"
            size="small"
            @click.stop="handleRestore(version)"
          >
            恢复此版本
          </a-button>
          <a-button
            type="link"
            size="small"
            @click.stop="handleCompare(version)"
          >
            对比
          </a-button>
          <a-button
            type="link"
            size="small"
            @click.stop="handleViewDetails(version)"
          >
            详情
          </a-button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredVersions.length === 0" class="empty-state">
        <InboxOutlined class="empty-icon" />
        <div class="empty-text">
          {{ searchKeyword ? '未找到相关版本' : '暂无版本历史' }}
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <template #footer>
      <div class="drawer-footer">
        <a-button @click="handleClose">关闭</a-button>
        <a-button
          v-if="selectedVersionId && selectedVersionId !== currentVersionId"
          type="primary"
          @click="handleRestoreSelected"
        >
          恢复选中版本
        </a-button>
      </div>
    </template>
  </a-drawer>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  HistoryOutlined,
  PlusOutlined,
  MinusOutlined,
  EditOutlined,
  InboxOutlined
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  versions: {
    type: Array,
    default: () => []
  },
  currentVersionId: {
    type: String,
    default: ''
  }
});

// Emits
const emit = defineEmits(['update:open', 'restore', 'compare', 'view-details']);

// State
const visible = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val)
});

const searchKeyword = ref('');
const selectedVersionId = ref('');

// Computed
const filteredVersions = computed(() => {
  if (!searchKeyword.value) {
    return props.versions;
  }
  const keyword = searchKeyword.value.toLowerCase();
  return props.versions.filter(version => {
    return (
      version.title.toLowerCase().includes(keyword) ||
      version.description?.toLowerCase().includes(keyword) ||
      `#${version.number}`.includes(keyword)
    );
  });
});

// Methods
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚';
  }
  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前`;
  }
  // 小于24小时
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前`;
  }
  // 小于7天
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} 天前`;
  }
  // 格式化为日期时间
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const handleVersionClick = (version) => {
  selectedVersionId.value = version.id;
};

const handleRestore = (version) => {
  emit('restore', version);
};

const handleRestoreSelected = () => {
  const version = props.versions.find(v => v.id === selectedVersionId.value);
  if (version) {
    emit('restore', version);
  }
};

const handleCompare = (version) => {
  emit('compare', version);
};

const handleViewDetails = (version) => {
  emit('view-details', version);
};

const handleSearch = () => {
  // 搜索逻辑已在 computed 中处理
};

const handleClose = () => {
  visible.value = false;
  selectedVersionId.value = '';
};
</script>

<style lang="scss" scoped>
.version-history-drawer {
  .drawer-header {
    padding: 16px 24px;
    border-bottom: 1px solid #f0f0f0;
  }

  .version-list {
    height: calc(100vh - 200px);
    overflow-y: auto;
    padding: 16px 24px;

    .version-item {
      padding: 16px;
      margin-bottom: 12px;
      background: #ffffff;
      border: 1px solid #f0f0f0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        border-color: #1677FF;
        background: #f5f9ff;
      }

      &.is-active {
        background: #e6fffb;
        border-color: #52c41a;
      }

      &.is-selected {
        background: #e6f4ff;
        border-color: #1677FF;
      }

      .version-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;

        .version-number {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
          color: #333;

          .version-icon {
            color: #1677FF;
          }

          .version-text {
            font-size: 14px;
          }
        }

        .version-time {
          font-size: 12px;
          color: #999;
        }
      }

      .version-title {
        font-size: 14px;
        font-weight: 500;
        color: #333;
        margin-bottom: 6px;
      }

      .version-description {
        font-size: 12px;
        color: #666;
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .version-stats {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
        padding-top: 12px;
        border-top: 1px solid #f0f0f0;

        .stat-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;

          &.stat-add {
            color: #52c41a;
          }

          &.stat-delete {
            color: #ff4d4f;
          }

          &.stat-modify {
            color: #1677FF;
          }
        }
      }

      .version-actions {
        display: flex;
        gap: 8px;

        .ant-btn-link {
          padding: 0;
          height: auto;
          font-size: 12px;
        }
      }
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;

      .empty-icon {
        font-size: 64px;
        color: #d9d9d9;
        margin-bottom: 16px;
      }

      .empty-text {
        font-size: 14px;
        color: #999;
      }
    }
  }

  .drawer-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
}
</style>
