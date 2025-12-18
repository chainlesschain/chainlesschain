<template>
  <a-layout class="main-layout">
    <!-- 侧边栏 -->
    <a-layout-sider
      v-model:collapsed="sidebarCollapsed"
      :trigger="null"
      collapsible
      :width="250"
      class="layout-sider"
    >
      <div class="app-logo">
        <h2 v-if="!sidebarCollapsed">ChainlessChain</h2>
        <h2 v-else>CC</h2>
      </div>

      <!-- 搜索框 -->
      <div class="search-box">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="搜索知识库..."
          @search="handleSearch"
        />
      </div>

      <!-- 新建按钮 -->
      <div class="action-buttons">
        <a-button type="primary" block @click="showNewItemModal = true">
          <template #icon><PlusOutlined /></template>
          <span v-if="!sidebarCollapsed">新建笔记</span>
        </a-button>
      </div>

      <!-- 知识库列表 -->
      <a-menu
        v-model:selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
        class="knowledge-menu"
      >
        <a-menu-item
          v-for="item in filteredItems"
          :key="item.id"
          @click="selectItem(item)"
        >
          <template #icon>
            <FileTextOutlined v-if="item.type === 'note'" />
            <FileOutlined v-else-if="item.type === 'document'" />
            <CommentOutlined v-else-if="item.type === 'conversation'" />
            <GlobalOutlined v-else />
          </template>
          <span>{{ item.title }}</span>
        </a-menu-item>
      </a-menu>
    </a-layout-sider>

    <!-- 主内容区 -->
    <a-layout>
      <!-- 顶部栏 -->
      <a-layout-header class="layout-header">
        <div class="header-left">
          <a-button type="text" @click="toggleSidebar">
            <MenuFoldOutlined v-if="!sidebarCollapsed" />
            <MenuUnfoldOutlined v-else />
          </a-button>
        </div>

        <div class="header-right">
          <a-space>
            <a-tooltip title="AI对话">
              <a-button type="text" @click="toggleChat">
                <MessageOutlined />
              </a-button>
            </a-tooltip>

            <a-tooltip title="同步状态">
              <a-badge status="success">
                <SyncOutlined />
              </a-badge>
            </a-tooltip>

            <a-tooltip title="图片上传">
              <a-button type="text" @click="router.push('/image-upload')">
                <FileImageOutlined />
              </a-button>
            </a-tooltip>

            <a-tooltip title="提示词模板">
              <a-button type="text" @click="router.push('/prompt-templates')">
                <FileTextOutlined />
              </a-button>
            </a-tooltip>

            <a-tooltip title="DID身份">
              <a-button type="text" @click="router.push('/did')">
                <IdcardOutlined />
              </a-button>
            </a-tooltip>

            <a-tooltip title="联系人">
              <a-button type="text" @click="router.push('/contacts')">
                <team-outlined />
              </a-button>
            </a-tooltip>

            <a-tooltip title="可验证凭证">
              <a-button type="text" @click="router.push('/credentials')">
                <safety-certificate-outlined />
              </a-button>
            </a-tooltip>

            <a-tooltip title="设置">
              <a-button type="text" @click="router.push('/settings')">
                <SettingOutlined />
              </a-button>
            </a-tooltip>

            <a-dropdown>
              <a-button type="text">
                <UserOutlined />
              </a-button>
              <template #overlay>
                <a-menu>
                  <a-menu-item @click="handleLogout">
                    <LogoutOutlined /> 退出登录
                  </a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </a-space>
        </div>
      </a-layout-header>

      <!-- 内容区和聊天面板 -->
      <a-layout style="position: relative">
        <!-- 内容区 -->
        <a-layout-content class="layout-content" :style="{ marginRight: chatPanelVisible ? '400px' : '0' }">
          <router-view />
        </a-layout-content>

        <!-- 聊天面板 -->
        <div class="chat-panel-container" :style="{ width: chatPanelVisible ? '400px' : '0' }">
          <ChatPanel :visible="chatPanelVisible" @toggle="toggleChat" />
        </div>
      </a-layout>
    </a-layout>

    <!-- 新建笔记对话框 -->
    <a-modal
      v-model:open="showNewItemModal"
      title="新建笔记"
      @ok="handleCreateItem"
      @cancel="showNewItemModal = false"
    >
      <a-form :model="newItem" layout="vertical">
        <a-form-item label="标题" required>
          <a-input v-model:value="newItem.title" placeholder="输入标题" />
        </a-form-item>

        <a-form-item label="类型">
          <a-select v-model:value="newItem.type">
            <a-select-option value="note">笔记</a-select-option>
            <a-select-option value="document">文档</a-select-option>
            <a-select-option value="conversation">对话</a-select-option>
            <a-select-option value="web_clip">网页剪藏</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="内容">
          <a-textarea
            v-model:value="newItem.content"
            placeholder="输入内容..."
            :rows="4"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-layout>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  FileTextOutlined,
  FileOutlined,
  CommentOutlined,
  GlobalOutlined,
  SyncOutlined,
  SettingOutlined,
  IdcardOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  LogoutOutlined,
  MessageOutlined,
  FileImageOutlined,
} from '@ant-design/icons-vue';
import { useAppStore } from '../stores/app';
import { dbAPI } from '../utils/ipc';
import ChatPanel from './ChatPanel.vue';

const router = useRouter();
const store = useAppStore();

const sidebarCollapsed = ref(false);
const searchQuery = ref('');
const selectedKeys = ref([]);
const showNewItemModal = ref(false);
const chatPanelVisible = ref(false);

const newItem = ref({
  title: '',
  type: 'note',
  content: '',
});

const filteredItems = computed(() => {
  if (!searchQuery.value) {
    return store.knowledgeItems;
  }
  return store.knowledgeItems.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      (item.content && item.content.toLowerCase().includes(searchQuery.value.toLowerCase()))
  );
});

onMounted(async () => {
  // 加载知识库项目
  try {
    const items = await dbAPI.getKnowledgeItems();
    store.setKnowledgeItems(items || []);
  } catch (error) {
    console.error('加载知识库失败:', error);
    message.error('加载知识库失败');
  }
});

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};

const toggleChat = () => {
  chatPanelVisible.value = !chatPanelVisible.value;
};

const handleSearch = (value) => {
  searchQuery.value = value;
};

const selectItem = (item) => {
  store.setCurrentItem(item);
  router.push(`/knowledge/${item.id}`);
};

const handleCreateItem = async () => {
  if (!newItem.value.title) {
    message.warning('请输入标题');
    return;
  }

  try {
    const item = await dbAPI.addKnowledgeItem({
      title: newItem.value.title,
      type: newItem.value.type,
      content: newItem.value.content,
    });

    store.addKnowledgeItem(item);
    message.success('创建成功');

    // 重置表单
    newItem.value = {
      title: '',
      type: 'note',
      content: '',
    };
    showNewItemModal.value = false;

    // 跳转到新建的项目
    router.push(`/knowledge/${item.id}`);
  } catch (error) {
    console.error('创建失败:', error);
    message.error('创建失败');
  }
};

const handleLogout = () => {
  store.logout();
  router.push('/login');
};
</script>

<style scoped>
.main-layout {
  height: 100vh;
}

.layout-sider {
  background: #001529;
}

.app-logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.app-logo h2 {
  margin: 0;
  color: white;
}

.search-box {
  padding: 16px;
}

.action-buttons {
  padding: 0 16px 16px;
}

.knowledge-menu {
  border-right: 0;
}

.layout-header {
  background: #fff;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f0f0f0;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
}

.layout-content {
  margin: 24px;
  padding: 24px;
  background: #fff;
  min-height: 280px;
  border-radius: 8px;
  transition: margin-right 0.3s;
}

.chat-panel-container {
  position: fixed;
  right: 0;
  top: 64px;
  bottom: 0;
  overflow: hidden;
  transition: width 0.3s;
  z-index: 10;
}
</style>
