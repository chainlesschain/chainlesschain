<template>
  <a-layout-header class="layout-header">
    <div class="header-left">
      <a-button
        v-if="showSidebar"
        type="text"
        class="trigger-btn"
        @click="toggleSidebar"
      >
        <MenuFoldOutlined v-if="!sidebarCollapsed" />
        <MenuUnfoldOutlined v-else />
      </a-button>
      <div v-else class="page-title">
        <a-button type="text" class="back-btn" @click="handleBackToHome">
          <ArrowLeftOutlined />
          返回首页
        </a-button>
      </div>

      <HeaderBreadcrumbs :icon-resolver="iconResolver" />
    </div>

    <div class="header-right">
      <a-space :size="16">
        <a-tooltip title="搜索菜单 (Ctrl+K)">
          <a-button
            type="text"
            class="search-btn"
            @click="emit('show-command-palette')"
          >
            <SearchOutlined />
          </a-button>
        </a-tooltip>

        <SyncStatusButton />

        <DatabaseEncryptionStatus />

        <a-tooltip title="AI对话">
          <a-button type="text" @click="toggleChat">
            <MessageOutlined />
          </a-button>
        </a-tooltip>

        <LanguageSwitcher />

        <DIDInvitationNotifier />

        <a-badge :count="socialStore.totalUnreadCount" :overflow-count="99">
          <a-tooltip title="通知中心">
            <a-button type="text" @click="toggleNotificationPanel">
              <BellOutlined />
            </a-button>
          </a-tooltip>
        </a-badge>

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
</template>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ArrowLeftOutlined,
  SearchOutlined,
  MessageOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
} from "@ant-design/icons-vue";
import { useAppStore } from "../../stores/app";
import { useSocialStore } from "../../stores/social";
import HeaderBreadcrumbs from "./HeaderBreadcrumbs.vue";
import SyncStatusButton from "./SyncStatusButton.vue";
import DatabaseEncryptionStatus from "../DatabaseEncryptionStatus.vue";
import LanguageSwitcher from "../LanguageSwitcher.vue";
import DIDInvitationNotifier from "../DIDInvitationNotifier.vue";

defineProps({
  iconResolver: { type: Function, required: true },
});

const emit = defineEmits(["show-command-palette"]);

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const socialStore = useSocialStore();

const showSidebar = computed(() => route.path === "/");

const sidebarCollapsed = computed({
  get: () => store.sidebarCollapsed,
  set: (val) => store.setSidebarCollapsed(val),
});

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function handleBackToHome() {
  router.push("/");
}

function toggleChat() {
  store.setChatPanelVisible(!store.chatPanelVisible);
}

function toggleNotificationPanel() {
  socialStore.toggleNotificationPanel();
}

function handleLogout() {
  store.logout();
  router.push("/login");
  message.success("已退出登录");
}
</script>

<style scoped>
.layout-header {
  background: #fff;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f0f0f0;
  height: 56px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  -webkit-app-region: drag;
}

.header-left {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.trigger-btn {
  font-size: 18px;
  padding: 0 16px;
  height: 56px;
}

.trigger-btn:hover {
  background: rgba(0, 0, 0, 0.025);
}

.page-title {
  display: flex;
  align-items: center;
}

.back-btn {
  font-size: 14px;
  padding: 0 16px;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #667eea;
  font-weight: 500;
}

.back-btn:hover {
  background: rgba(102, 126, 234, 0.1);
  color: #764ba2;
}

.header-right {
  display: flex;
  align-items: center;
  padding-right: 140px;
  -webkit-app-region: no-drag;
}

.search-btn {
  font-size: 16px;
  color: #667eea;
  transition: all 0.3s;
}

.search-btn:hover {
  color: #764ba2;
  transform: scale(1.1);
}
</style>
