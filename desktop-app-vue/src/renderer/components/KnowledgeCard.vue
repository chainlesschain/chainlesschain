<template>
  <a-card
    hoverable
    class="knowledge-card"
    @click="emit('view', item)"
  >
    <!-- 封面 -->
    <template #cover>
      <div
        class="card-cover"
        :style="{ background: getCoverGradient(item.type) }"
      >
        <component
          :is="getTypeIcon(item.type)"
          style="font-size: 48px; color: white"
        />
      </div>
    </template>

    <!-- 内容 -->
    <a-card-meta>
      <template #title>
        <div class="card-title">
          {{ item.title }}
          <a-tag
            v-if="item.share_scope"
            :color="getScopeColor(item.share_scope)"
            size="small"
          >
            {{ getScopeLabel(item.share_scope) }}
          </a-tag>
        </div>
      </template>

      <template #description>
        <div class="card-description">
          <p class="content-preview">
            {{ getContentPreview(item.content) }}
          </p>
          <div class="card-meta">
            <a-space>
              <a-tooltip title="创建者">
                <span class="meta-item">
                  <UserOutlined />
                  {{ getCreatorName(item.created_by) }}
                </span>
              </a-tooltip>
              <a-tooltip :title="formatDate(item.created_at)">
                <span class="meta-item">
                  <ClockCircleOutlined />
                  {{ formatRelativeTime(item.created_at) }}
                </span>
              </a-tooltip>
              <a-tooltip
                v-if="item.version > 1"
                :title="`版本 ${item.version}`"
              >
                <span class="meta-item">
                  <HistoryOutlined />
                  v{{ item.version }}
                </span>
              </a-tooltip>
            </a-space>
          </div>
        </div>
      </template>

      <template #avatar>
        <a-avatar :style="{ backgroundColor: getAvatarColor(item.type) }">
          {{ item.title.charAt(0) }}
        </a-avatar>
      </template>
    </a-card-meta>

    <!-- 操作按钮 -->
    <template #actions>
      <a-tooltip title="查看">
        <EyeOutlined
          key="view"
          @click.stop="emit('view', item)"
        />
      </a-tooltip>
      <a-tooltip
        v-if="canEdit"
        title="编辑"
      >
        <EditOutlined
          key="edit"
          @click.stop="emit('edit', item)"
        />
      </a-tooltip>
      <a-tooltip title="分享">
        <ShareAltOutlined
          key="share"
          @click.stop="emit('share', item)"
        />
      </a-tooltip>
      <a-popconfirm
        v-if="canDelete"
        title="确定要删除这条知识吗？"
        ok-text="确定"
        cancel-text="取消"
        @confirm.stop="emit('delete', item)"
      >
        <a-tooltip title="删除">
          <DeleteOutlined
            key="delete"
            @click.stop
          />
        </a-tooltip>
      </a-popconfirm>
    </template>
  </a-card>
</template>

<script setup>
import { computed } from 'vue';
import {
  FileTextOutlined,
  FileWordOutlined,
  MessageOutlined,
  LinkOutlined,
  UserOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  EyeOutlined,
  EditOutlined,
  ShareAltOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue';

// ==================== Props & Emits ====================
const props = defineProps({
  item: {
    type: Object,
    required: true
  },
  currentUserDid: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['view', 'edit', 'delete', 'share']);

// ==================== Computed ====================
const canEdit = computed(() => {
  // 创建者或管理员可以编辑
  return props.item.created_by === props.currentUserDid;
});

const canDelete = computed(() => {
  // 创建者或管理员可以删除
  return props.item.created_by === props.currentUserDid;
});

// ==================== Methods ====================

/**
 * 获取类型图标
 */
function getTypeIcon(type) {
  const icons = {
    note: FileTextOutlined,
    document: FileWordOutlined,
    conversation: MessageOutlined,
    web_clip: LinkOutlined
  };
  return icons[type] || FileTextOutlined;
}

/**
 * 获取封面渐变色
 */
function getCoverGradient(type) {
  const gradients = {
    note: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    document: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    conversation: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    web_clip: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'
  };
  return gradients[type] || gradients.note;
}

/**
 * 获取头像颜色
 */
function getAvatarColor(type) {
  const colors = {
    note: '#667eea',
    document: '#f093fb',
    conversation: '#4facfe',
    web_clip: '#43e97b'
  };
  return colors[type] || '#667eea';
}

/**
 * 获取共享范围颜色
 */
function getScopeColor(scope) {
  const colors = {
    private: 'default',
    team: 'blue',
    org: 'green',
    public: 'orange'
  };
  return colors[scope] || 'default';
}

/**
 * 获取共享范围标签
 */
function getScopeLabel(scope) {
  const labels = {
    private: '私有',
    team: '团队',
    org: '组织',
    public: '公开'
  };
  return labels[scope] || scope;
}

/**
 * 获取内容预览
 */
function getContentPreview(content) {
  if (!content) {return '暂无内容';}
  const text = content.replace(/<[^>]*>/g, '').trim();
  return text.length > 100 ? text.substring(0, 100) + '...' : text;
}

/**
 * 获取创建者名称
 */
function getCreatorName(did) {
  if (!did) {return '未知';}
  // 缩短DID显示
  if (did.length > 20) {
    return `${did.slice(0, 10)}...${did.slice(-6)}`;
  }
  return did;
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  if (!timestamp) {return '-';}
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

/**
 * 格式化相对时间
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) {return '-';}

  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diff < minute) {
    return '刚刚';
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)}小时前`;
  } else if (diff < week) {
    return `${Math.floor(diff / day)}天前`;
  } else {
    return formatDate(timestamp);
  }
}
</script>

<style scoped lang="less">
.knowledge-card {
  .card-cover {
    height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;

    :deep(.ant-tag) {
      margin: 0;
    }
  }

  .card-description {
    .content-preview {
      margin: 0 0 12px;
      color: #666;
      font-size: 14px;
      line-height: 1.6;
      min-height: 45px;
    }

    .card-meta {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #f0f0f0;

      .meta-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: #999;
        font-size: 12px;

        :deep(.anticon) {
          font-size: 14px;
        }
      }
    }
  }

  :deep(.ant-card-actions) {
    > li {
      cursor: pointer;

      &:hover {
        color: #1890ff;
      }
    }
  }
}
</style>
