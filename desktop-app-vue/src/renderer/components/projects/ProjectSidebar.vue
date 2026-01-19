<template>
  <div class="project-sidebar">
    <!-- 侧边栏头部 -->
    <div class="sidebar-header">
      <div class="app-logo">
        <img
          v-if="logoSrc"
          :src="logoSrc"
          alt="ChainlessChain"
          class="logo-img"
        >
        <span
          v-else
          class="logo-text"
        >🔗 ChainlessChain</span>
      </div>

      <!-- 折叠按钮(移动端) -->
      <a-button
        v-if="collapsible"
        type="text"
        class="collapse-btn"
        @click="toggleCollapse"
      >
        <MenuFoldOutlined v-if="!isCollapsed" />
        <MenuUnfoldOutlined v-else />
      </a-button>
    </div>

    <!-- 新建按钮 -->
    <div class="sidebar-action">
      <a-button
        type="primary"
        size="large"
        block
        class="new-conversation-btn"
        @click="handleNewConversation"
      >
        <PlusOutlined />
        {{ isCollapsed ? '' : '新对话' }}
      </a-button>
    </div>

    <!-- 导航分类 -->
    <div class="sidebar-nav">
      <!-- 收藏夹分类 -->
      <div class="nav-section">
        <div
          v-if="!isCollapsed"
          class="section-title"
        >
          <FolderOutlined />
          收藏夹
        </div>
        <div
          v-for="item in favoriteItems"
          :key="item.id"
          class="nav-item"
          :class="{ 'is-active': activeItem === item.id }"
          @click="handleNavClick(item)"
        >
          <span class="item-icon">{{ item.icon }}</span>
          <span
            v-if="!isCollapsed"
            class="item-label"
          >{{ item.label }}</span>
          <a-badge
            v-if="!isCollapsed && item.badge"
            :count="item.badge"
            :number-style="{ backgroundColor: '#52C41A' }"
          />
        </div>
      </div>

      <!-- AI专家分类 -->
      <div class="nav-section">
        <div
          v-if="!isCollapsed"
          class="section-title"
        >
          <RobotOutlined />
          AI专家
        </div>
        <div
          v-for="item in aiExpertItems"
          :key="item.id"
          class="nav-item"
          :class="{ 'is-active': activeItem === item.id }"
          @click="handleNavClick(item)"
        >
          <span class="item-icon">{{ item.icon }}</span>
          <span
            v-if="!isCollapsed"
            class="item-label"
          >{{ item.label }}</span>
        </div>
      </div>

      <!-- 项目分类 -->
      <div class="nav-section">
        <div
          v-if="!isCollapsed"
          class="section-title"
        >
          <FolderOpenOutlined />
          扣子编程
        </div>
        <div
          v-for="item in projectItems"
          :key="item.id"
          class="nav-item"
          :class="{ 'is-active': activeItem === item.id }"
          @click="handleNavClick(item)"
        >
          <span class="item-icon">{{ item.icon }}</span>
          <span
            v-if="!isCollapsed"
            class="item-label"
          >{{ item.label }}</span>
        </div>
      </div>
    </div>

    <!-- 历史对话列表 -->
    <div class="sidebar-history">
      <div
        v-if="!isCollapsed"
        class="section-title"
      >
        <HistoryOutlined />
        历史对话
      </div>

      <!-- 搜索框 -->
      <div
        v-if="!isCollapsed && showSearch"
        class="history-search"
      >
        <a-input
          v-model:value="searchKeyword"
          placeholder="搜索对话..."
          size="small"
          allow-clear
        >
          <template #prefix>
            <SearchOutlined />
          </template>
        </a-input>
      </div>

      <!-- 对话列表 -->
      <div class="history-list">
        <div
          v-for="conversation in filteredConversations"
          :key="conversation.id"
          class="conversation-item"
          :class="{ 'is-active': activeConversation === conversation.id }"
          @click="handleConversationClick(conversation)"
        >
          <div class="conversation-icon">
            <MessageOutlined />
          </div>
          <div
            v-if="!isCollapsed"
            class="conversation-info"
          >
            <div class="conversation-title">
              {{ conversation.title || '未命名对话' }}
            </div>
            <div class="conversation-time">
              {{ formatTime(conversation.updated_at) }}
            </div>
          </div>
          <div
            v-if="!isCollapsed"
            class="conversation-actions"
          >
            <a-dropdown
              :trigger="['click']"
              placement="bottomRight"
            >
              <a-button
                type="text"
                size="small"
                class="action-btn"
                @click.stop
              >
                <EllipsisOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="handleConversationAction($event, conversation)">
                  <a-menu-item key="rename">
                    <EditOutlined />
                    重命名
                  </a-menu-item>
                  <a-menu-item key="star">
                    <StarOutlined />
                    {{ conversation.is_starred ? '取消收藏' : '收藏' }}
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="delete"
                    danger
                  >
                    <DeleteOutlined />
                    删除
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </div>
        </div>
      </div>

      <!-- 加载更多 -->
      <div
        v-if="hasMore && !isCollapsed"
        class="load-more"
      >
        <a-button
          type="text"
          size="small"
          block
          @click="loadMore"
        >
          加载更多...
        </a-button>
      </div>
    </div>

    <!-- 侧边栏底部 -->
    <div class="sidebar-footer">
      <!-- 用户信息 -->
      <div class="user-info">
        <a-dropdown
          :trigger="['click']"
          placement="topRight"
        >
          <div class="user-profile">
            <a-avatar
              :size="isCollapsed ? 32 : 40"
              :src="userAvatar"
            >
              <template #icon>
                <UserOutlined />
              </template>
            </a-avatar>
            <div
              v-if="!isCollapsed"
              class="user-name"
            >
              {{ userName || '未登录' }}
            </div>
          </div>
          <template #overlay>
            <a-menu @click="handleUserAction">
              <a-menu-item key="profile">
                <UserOutlined />
                个人资料
              </a-menu-item>
              <a-menu-item key="settings">
                <SettingOutlined />
                设置
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item key="logout">
                <LogoutOutlined />
                退出登录
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  PlusOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  HistoryOutlined,
  MessageOutlined,
  SearchOutlined,
  EllipsisOutlined,
  EditOutlined,
  StarOutlined,
  DeleteOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  // 是否可折叠
  collapsible: {
    type: Boolean,
    default: false,
  },
  // 默认是否折叠
  defaultCollapsed: {
    type: Boolean,
    default: false,
  },
  // LOGO图片
  logoSrc: {
    type: String,
    default: '',
  },
  // 用户信息
  userName: {
    type: String,
    default: '',
  },
  userAvatar: {
    type: String,
    default: '',
  },
  // 对话列表
  conversations: {
    type: Array,
    default: () => [],
  },
  // 活动对话ID
  activeConversation: {
    type: String,
    default: '',
  },
  // 活动导航项ID
  activeItem: {
    type: String,
    default: '',
  },
  // 是否显示搜索框
  showSearch: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits([
  'new-conversation',
  'conversation-click',
  'conversation-action',
  'nav-click',
  'user-action',
  'load-more',
  'collapse',
]);

const router = useRouter();

// 响应式状态
const isCollapsed = ref(props.defaultCollapsed);
const searchKeyword = ref('');
const hasMore = ref(true);

// 收藏夹导航项
const favoriteItems = ref([
  { id: 'favorites', icon: '⭐', label: '收藏夹', badge: 0 },
  { id: 'recent', icon: '🕐', label: '最近使用', badge: 0 },
]);

// AI专家导航项
const aiExpertItems = ref([
  { id: 'ai-code', icon: '💻', label: '代码助手' },
  { id: 'ai-write', icon: '✍️', label: '写作助手' },
  { id: 'ai-design', icon: '🎨', label: '设计助手' },
  { id: 'ai-data', icon: '📊', label: '数据分析' },
]);

// 项目分类导航项
const projectItems = ref([
  { id: 'proj-web', icon: '🌐', label: 'Web开发' },
  { id: 'proj-doc', icon: '📄', label: '文档处理' },
  { id: 'proj-excel', icon: '📊', label: '数据分析' },
  { id: 'proj-ppt', icon: '📽️', label: '演示文稿' },
  { id: 'proj-video', icon: '🎬', label: '视频制作' },
  { id: 'proj-design', icon: '🎨', label: '图像设计' },
  { id: 'proj-code', icon: '💻', label: '代码项目' },
]);

// 过滤后的对话列表
const filteredConversations = computed(() => {
  if (!searchKeyword.value) {
    return props.conversations;
  }
  return props.conversations.filter(conv =>
    (conv.title || '').toLowerCase().includes(searchKeyword.value.toLowerCase())
  );
});

// 切换折叠状态
const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
  emit('collapse', isCollapsed.value);
};

// 处理新对话
const handleNewConversation = () => {
  emit('new-conversation');
  router.push('/projects/new');
};

// 处理导航点击
const handleNavClick = (item) => {
  emit('nav-click', item);
};

// 处理对话点击
const handleConversationClick = (conversation) => {
  emit('conversation-click', conversation);
};

// 处理对话操作
const handleConversationAction = ({ key }, conversation) => {
  emit('conversation-action', { action: key, conversation });
};

// 处理用户操作
const handleUserAction = ({ key }) => {
  emit('user-action', key);
};

// 加载更多
const loadMore = () => {
  emit('load-more');
};

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '';}

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {return '刚刚';}
  if (diff < 3600000) {return `${Math.floor(diff / 60000)}分钟前`;}
  if (diff < 86400000) {return `${Math.floor(diff / 3600000)}小时前`;}
  if (diff < 604800000) {return `${Math.floor(diff / 86400000)}天前`;}

  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
};
</script>

<style scoped lang="scss">
.project-sidebar {
  width: 260px;
  height: 100vh;
  background: #2B2D31;
  display: flex;
  flex-direction: column;
  transition: width 0.3s;
  flex-shrink: 0;

  &.is-collapsed {
    width: 64px;
  }
}

.sidebar-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 12px;

  .logo-img {
    width: 32px;
    height: 32px;
    border-radius: 6px;
  }

  .logo-text {
    font-size: 16px;
    font-weight: 600;
    color: white;
  }
}

.collapse-btn {
  color: rgba(255, 255, 255, 0.7);

  &:hover {
    color: white;
    background: rgba(255, 255, 255, 0.1);
  }
}

.sidebar-action {
  padding: 16px;
}

.new-conversation-btn {
  background: linear-gradient(135deg, #667EEA 0%, #764BA2 100%);
  border: none;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.3s;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }
}

.sidebar-nav {
  flex: 0 0 auto;
  overflow-y: auto;
  padding: 8px 0;
}

.nav-section {
  margin-bottom: 16px;
}

.section-title {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-item {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.7);
  transition: all 0.2s;
  position: relative;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  &.is-active {
    background: rgba(102, 126, 234, 0.15);
    color: white;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: #667EEA;
    }
  }

  .item-icon {
    font-size: 18px;
    flex-shrink: 0;
  }

  .item-label {
    flex: 1;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.sidebar-history {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.history-search {
  padding: 8px 16px;
  margin-bottom: 8px;

  :deep(.ant-input) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
    color: white;

    &::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    &:focus {
      background: rgba(255, 255, 255, 0.12);
      border-color: #667EEA;
    }
  }

  :deep(.ant-input-prefix) {
    color: rgba(255, 255, 255, 0.4);
  }
}

.history-list {
  padding: 0 8px;
}

.conversation-item {
  padding: 10px 12px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.7);
  transition: all 0.2s;
  margin-bottom: 4px;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;

    .conversation-actions {
      opacity: 1;
    }
  }

  &.is-active {
    background: rgba(102, 126, 234, 0.15);
    color: white;
  }

  .conversation-icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .conversation-info {
    flex: 1;
    min-width: 0;
  }

  .conversation-title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-time {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 2px;
  }

  .conversation-actions {
    opacity: 0;
    transition: opacity 0.2s;

    .action-btn {
      color: rgba(255, 255, 255, 0.7);
      padding: 4px;

      &:hover {
        color: white;
        background: rgba(255, 255, 255, 0.1);
      }
    }
  }
}

.load-more {
  padding: 8px 16px;

  :deep(.ant-btn) {
    color: rgba(255, 255, 255, 0.6);

    &:hover {
      color: white;
      background: rgba(255, 255, 255, 0.08);
    }
  }
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .user-name {
    flex: 1;
    color: white;
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 滚动条样式 */
.sidebar-nav,
.sidebar-history {
  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;

    &:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  }
}
</style>
