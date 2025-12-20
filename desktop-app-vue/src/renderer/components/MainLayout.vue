<template>
  <a-layout class="main-layout">
    <!-- 侧边栏 -->
    <a-layout-sider
      v-model:collapsed="sidebarCollapsed"
      :trigger="null"
      collapsible
      :width="240"
      class="layout-sider"
    >
      <!-- Logo -->
      <div class="app-logo">
        <div class="logo-icon">
          <ApiOutlined :style="{ fontSize: '28px' }" />
        </div>
        <h2 v-if="!sidebarCollapsed">ChainlessChain</h2>
      </div>

      <!-- 菜单 -->
      <a-menu
        v-model:selectedKeys="selectedMenuKeys"
        theme="dark"
        mode="inline"
        class="main-menu"
        @click="handleMenuClick"
      >
        <!-- 项目管理 ⭐核心模块 -->
        <a-sub-menu key="project-management">
          <template #icon><FolderOutlined /></template>
          <template #title>
            <span>项目管理</span>
            <a-badge count="核心" :number-style="{ backgroundColor: '#52c41a', fontSize: '10px', padding: '0 4px' }" style="margin-left: 8px" />
          </template>
          <a-menu-item key="projects">
            <template #icon><FolderOpenOutlined /></template>
            我的项目
          </a-menu-item>
          <a-menu-item key="project-new">
            <template #icon><PlusCircleOutlined /></template>
            新建项目
          </a-menu-item>
          <a-menu-item key="project-templates">
            <template #icon><FileTextOutlined /></template>
            项目模板
          </a-menu-item>
          <a-menu-item key="project-market">
            <template #icon><ShopOutlined /></template>
            项目市场
          </a-menu-item>
          <a-menu-item key="project-collaboration">
            <template #icon><TeamOutlined /></template>
            协作项目
          </a-menu-item>
          <a-menu-item key="project-archived">
            <template #icon><InboxOutlined /></template>
            已归档项目
          </a-menu-item>
        </a-sub-menu>

        <!-- 知识与AI -->
        <a-sub-menu key="knowledge">
          <template #icon><FileTextOutlined /></template>
          <template #title>知识与AI</template>
          <a-menu-item key="home">
            <template #icon><HomeOutlined /></template>
            知识首页
          </a-menu-item>
          <a-menu-item key="knowledge-list">
            <template #icon><FileTextOutlined /></template>
            我的知识
          </a-menu-item>
          <a-menu-item key="file-import">
            <template #icon><CloudUploadOutlined /></template>
            文件导入
          </a-menu-item>
          <a-menu-item key="image-upload">
            <template #icon><FileImageOutlined /></template>
            图片上传
          </a-menu-item>
          <a-menu-item key="prompt-templates">
            <template #icon><TagsOutlined /></template>
            提示词模板
          </a-menu-item>
          <a-menu-item key="ai-chat">
            <template #icon><RobotOutlined /></template>
            AI对话
          </a-menu-item>
          <a-menu-item key="knowledge-store">
            <template #icon><ShopOutlined /></template>
            知识付费
          </a-menu-item>
          <a-menu-item key="my-purchases">
            <template #icon><ShoppingCartOutlined /></template>
            我的购买
          </a-menu-item>
        </a-sub-menu>

        <!-- 身份与社交 -->
        <a-sub-menu key="social">
          <template #icon><TeamOutlined /></template>
          <template #title>身份与社交</template>
          <a-menu-item key="did">
            <template #icon><IdcardOutlined /></template>
            DID身份
          </a-menu-item>
          <a-menu-item key="credentials">
            <template #icon><SafetyCertificateOutlined /></template>
            可验证凭证
          </a-menu-item>
          <a-menu-item key="contacts">
            <template #icon><TeamOutlined /></template>
            联系人
          </a-menu-item>
          <a-menu-item key="friends">
            <template #icon><UserOutlined /></template>
            好友管理
          </a-menu-item>
          <a-menu-item key="posts">
            <template #icon><CommentOutlined /></template>
            动态广场
          </a-menu-item>
          <a-menu-item key="p2p-messaging">
            <template #icon><MessageOutlined /></template>
            P2P加密消息
          </a-menu-item>
        </a-sub-menu>

        <!-- 交易系统 -->
        <a-sub-menu key="trade">
          <template #icon><ShopOutlined /></template>
          <template #title>交易系统</template>
          <a-menu-item key="marketplace">
            <template #icon><ShopOutlined /></template>
            交易市场
          </a-menu-item>
          <a-menu-item key="contracts">
            <template #icon><AuditOutlined /></template>
            智能合约
          </a-menu-item>
          <a-menu-item key="credit-score">
            <template #icon><StarOutlined /></template>
            信用评分
          </a-menu-item>
        </a-sub-menu>

        <!-- 系统设置 -->
        <a-sub-menu key="system">
          <template #icon><SettingOutlined /></template>
          <template #title>系统设置</template>
          <a-menu-item key="settings">
            <template #icon><SettingOutlined /></template>
            通用设置
          </a-menu-item>
          <a-menu-item key="llm-settings">
            <template #icon><ApiOutlined /></template>
            LLM配置
          </a-menu-item>
          <a-menu-item key="git-settings">
            <template #icon><SyncOutlined /></template>
            Git同步
          </a-menu-item>
          <a-menu-item key="rag-settings">
            <template #icon><DatabaseOutlined /></template>
            RAG配置
          </a-menu-item>
          <a-menu-item key="ukey-settings">
            <template #icon><SafetyOutlined /></template>
            UKey安全
          </a-menu-item>
        </a-sub-menu>
      </a-menu>
    </a-layout-sider>

    <!-- 主内容区 -->
    <a-layout>
      <!-- 顶部栏 -->
      <a-layout-header class="layout-header">
        <div class="header-left">
          <a-button type="text" @click="toggleSidebar" class="trigger-btn">
            <MenuFoldOutlined v-if="!sidebarCollapsed" />
            <MenuUnfoldOutlined v-else />
          </a-button>
        </div>

        <div class="header-right">
          <a-space :size="16">
            <!-- 同步状态 -->
            <a-tooltip title="同步状态">
              <a-badge status="success" text="已同步" />
            </a-tooltip>

            <!-- AI对话 -->
            <a-tooltip title="AI对话">
              <a-button type="text" @click="toggleChat">
                <MessageOutlined />
              </a-button>
            </a-tooltip>

            <!-- 用户菜单 -->
            <a-dropdown>
              <a-button type="text">
                <UserOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item key="profile">
                    <UserOutlined />
                    个人资料
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="logout" @click="handleLogout">
                    <LogoutOutlined />
                    退出登录
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </div>
      </a-layout-header>

      <!-- 标签页栏 -->
      <div class="tabs-bar">
        <a-tabs
          v-model:activeKey="store.activeTabKey"
          type="editable-card"
          hide-add
          @edit="handleTabEdit"
          @change="handleTabChange"
        >
          <a-tab-pane
            v-for="tab in store.tabs"
            :key="tab.key"
            :tab="tab.title"
            :closable="tab.closable"
          >
          </a-tab-pane>

          <template #rightExtra>
            <a-dropdown :trigger="['click']">
              <a-button type="text" size="small">
                <DownOutlined />
              </a-button>
              <template #overlay>
                <a-menu @click="handleTabDropdown">
                  <a-menu-item key="close-others">
                    关闭其他
                  </a-menu-item>
                  <a-menu-item key="close-all">
                    关闭所有
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>
        </a-tabs>
      </div>

      <!-- 内容区和聊天面板 -->
      <a-layout class="content-layout">
        <!-- 内容区 -->
        <a-layout-content
          class="layout-content"
          :style="{ marginRight: chatPanelVisible ? '400px' : '0' }"
        >
          <router-view v-slot="{ Component }">
            <keep-alive>
              <component :is="Component" :key="$route.fullPath" />
            </keep-alive>
          </router-view>
        </a-layout-content>

        <!-- 聊天面板 -->
        <div
          class="chat-panel-container"
          :style="{ width: chatPanelVisible ? '400px' : '0' }"
        >
          <ChatPanel :visible="chatPanelVisible" @toggle="toggleChat" />
        </div>
      </a-layout>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FileTextOutlined,
  TeamOutlined,
  ShopOutlined,
  SettingOutlined,
  HomeOutlined,
  CloudUploadOutlined,
  FileImageOutlined,
  TagsOutlined,
  ShoppingCartOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  CommentOutlined,
  MessageOutlined,
  AuditOutlined,
  StarOutlined,
  ApiOutlined,
  SyncOutlined,
  DatabaseOutlined,
  SafetyOutlined,
  LogoutOutlined,
  DownOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusCircleOutlined,
  InboxOutlined,
  RobotOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import ChatPanel from './ChatPanel.vue';

const router = useRouter();
const route = useRoute();
const store = useAppStore();

const sidebarCollapsed = computed({
  get: () => store.sidebarCollapsed,
  set: (val) => store.setSidebarCollapsed(val),
});

const chatPanelVisible = computed({
  get: () => store.chatPanelVisible,
  set: (val) => store.setChatPanelVisible(val),
});

const selectedMenuKeys = ref(['home']);

// 菜单配置
const menuConfig = {
  // 项目管理模块
  projects: { path: '/projects', title: '我的项目' },
  'project-new': { path: '/projects/new', title: '新建项目' },
  'project-templates': { path: '/projects/templates', title: '项目模板' },
  'project-market': { path: '/projects/market', title: '项目市场' },
  'project-collaboration': { path: '/projects/collaboration', title: '协作项目' },
  'project-archived': { path: '/projects/archived', title: '已归档项目' },

  // 知识与AI模块
  home: { path: '/', title: '知识首页', closable: false },
  'knowledge-list': { path: '/knowledge/list', title: '我的知识' },
  'file-import': { path: '/file-import', title: '文件导入' },
  'image-upload': { path: '/image-upload', title: '图片上传' },
  'prompt-templates': { path: '/prompt-templates', title: '提示词模板' },
  'ai-chat': { path: '/ai/chat', title: 'AI对话' },
  'knowledge-store': { path: '/knowledge-store', title: '知识付费' },
  'my-purchases': { path: '/my-purchases', title: '我的购买' },

  // 身份与社交模块
  did: { path: '/did', title: 'DID身份' },
  credentials: { path: '/credentials', title: '可验证凭证' },
  contacts: { path: '/contacts', title: '联系人' },
  friends: { path: '/friends', title: '好友管理' },
  posts: { path: '/posts', title: '动态广场' },
  'p2p-messaging': { path: '/p2p-messaging', title: 'P2P加密消息' },

  // 交易系统模块
  marketplace: { path: '/marketplace', title: '交易市场' },
  contracts: { path: '/contracts', title: '智能合约' },
  'credit-score': { path: '/credit-score', title: '信用评分' },
  settings: { path: '/settings', title: '通用设置', query: { tab: 'general' } },
  'llm-settings': { path: '/settings', title: 'LLM配置', query: { tab: 'llm' } },
  'git-settings': { path: '/settings', title: 'Git同步', query: { tab: 'git' } },
  'rag-settings': { path: '/settings', title: 'RAG配置', query: { tab: 'rag' } },
  'ukey-settings': { path: '/settings', title: 'UKey安全', query: { tab: 'ukey' } },
};

// 监听路由变化，更新选中的菜单项
watch(
  () => route.path,
  (newPath) => {
    // 查找匹配的菜单项
    const menuKey = Object.keys(menuConfig).find((key) => {
      const config = menuConfig[key];
      return config.path === newPath;
    });

    if (menuKey) {
      selectedMenuKeys.value = [menuKey];
    }
  },
  { immediate: true }
);

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};

const toggleChat = () => {
  chatPanelVisible.value = !chatPanelVisible.value;
};

const handleMenuClick = ({ key }) => {
  const config = menuConfig[key];
  if (!config) return;

  // 添加标签页
  store.addTab({
    key,
    title: config.title,
    path: config.path,
    query: config.query,
    closable: config.closable !== false,
  });

  // 路由跳转
  if (config.query) {
    router.push({ path: config.path, query: config.query });
  } else {
    router.push(config.path);
  }
};

const handleTabChange = (activeKey) => {
  const tab = store.tabs.find((t) => t.key === activeKey);
  if (tab) {
    if (tab.query) {
      router.push({ path: tab.path, query: tab.query });
    } else {
      router.push(tab.path);
    }
  }
};

const handleTabEdit = (targetKey, action) => {
  if (action === 'remove') {
    store.removeTab(targetKey);

    // 路由跳转到当前激活的标签页
    const activeTab = store.tabs.find((t) => t.key === store.activeTabKey);
    if (activeTab) {
      router.push(activeTab.path);
    }
  }
};

const handleTabDropdown = ({ key }) => {
  if (key === 'close-others') {
    store.closeOtherTabs(store.activeTabKey);
  } else if (key === 'close-all') {
    store.closeAllTabs();
    router.push('/');
  }
};

const handleLogout = () => {
  store.logout();
  router.push('/login');
  message.success('已退出登录');
};
</script>

<style scoped>
.main-layout {
  height: 100vh;
  overflow: hidden;
}

.layout-sider {
  background: #001529;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
}

.app-logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: white;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
}

.app-logo h2 {
  margin: 0;
  color: white;
  font-size: 18px;
  font-weight: 600;
}

.main-menu {
  border-right: 0;
  padding: 8px 0;
}

.main-menu :deep(.ant-menu-sub) {
  background: transparent;
}

.main-menu :deep(.ant-menu-submenu-title) {
  height: 44px;
  line-height: 44px;
  margin: 4px 0;
}

.main-menu :deep(.ant-menu-item) {
  height: 40px;
  line-height: 40px;
  margin: 2px 0;
}

.layout-header {
  background: #fff;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f0f0f0;
  height: 56px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.header-left {
  display: flex;
  align-items: center;
}

.trigger-btn {
  font-size: 18px;
  padding: 0 16px;
  height: 56px;
}

.trigger-btn:hover {
  background: rgba(0, 0, 0, 0.025);
}

.header-right {
  display: flex;
  align-items: center;
}

.tabs-bar {
  background: #fff;
  padding: 0 16px;
  border-bottom: 1px solid #f0f0f0;
}

.tabs-bar :deep(.ant-tabs) {
  margin-bottom: -1px;
}

.tabs-bar :deep(.ant-tabs-nav) {
  margin: 0;
}

.tabs-bar :deep(.ant-tabs-tab) {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.3s;
}

.tabs-bar :deep(.ant-tabs-tab-active) {
  background: #f5f5f5;
  border-color: #f0f0f0;
  border-bottom-color: #fff;
}

.tabs-bar :deep(.ant-tabs-tab:hover) {
  color: #1890ff;
}

.content-layout {
  position: relative;
  overflow: hidden;
}

.layout-content {
  margin: 16px;
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  overflow-y: auto;
  transition: margin-right 0.3s;
}

.chat-panel-container {
  position: fixed;
  right: 0;
  top: 56px;
  bottom: 0;
  overflow: hidden;
  transition: width 0.3s;
  z-index: 100;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
}
</style>
