<template>
  <a-layout style="min-height: 100vh; background: #141414">
    <!-- Sidebar -->
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      :collapsed-width="64"
      :width="220"
      style="background: #1c1c1c; border-right: 1px solid #303030;"
    >
      <!-- Logo + Mode Banner -->
      <div class="logo" :class="{ collapsed }">
        <span class="logo-icon">⛓</span>
        <span v-if="!collapsed" class="logo-text">ChainlessChain</span>
      </div>

      <!-- Project Mode Banner (shown when in project mode) -->
      <div v-if="isProject && !collapsed" class="project-banner">
        <FolderOutlined style="color: #1677ff; font-size: 12px;" />
        <div class="project-info">
          <div class="project-name">{{ cfg.projectName || '项目' }}</div>
          <div class="project-scope">项目级面板</div>
        </div>
      </div>
      <div v-else-if="!isProject && !collapsed" class="global-banner">
        <GlobalOutlined style="color: #722ed1; font-size: 12px;" />
        <span class="global-label">全局模式</span>
      </div>
      <!-- Collapsed mode icon -->
      <div v-else-if="collapsed" class="mode-icon-collapsed" :title="isProject ? cfg.projectName : '全局模式'">
        <FolderOutlined v-if="isProject" style="color: #1677ff;" />
        <GlobalOutlined v-else style="color: #722ed1;" />
      </div>

      <!-- Navigation Menu -->
      <a-menu
        v-model:selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
        :inline-collapsed="collapsed"
        style="background: #1c1c1c; border: none; margin-top: 4px;"
        @click="onMenuClick"
      >
        <a-menu-item key="dashboard">
          <template #icon><DashboardOutlined /></template>
          <span>仪表板</span>
        </a-menu-item>
        <a-menu-item key="chat">
          <template #icon><MessageOutlined /></template>
          <span>AI 对话</span>
        </a-menu-item>
        <a-menu-item key="skills">
          <template #icon><AppstoreOutlined /></template>
          <span>技能管理</span>
        </a-menu-item>
        <a-menu-item key="providers">
          <template #icon><ApiOutlined /></template>
          <span>LLM 配置</span>
        </a-menu-item>
      </a-menu>

      <!-- Connection Status at Bottom -->
      <div class="sidebar-footer" :class="{ collapsed }">
        <a-badge :status="statusBadge" />
        <span v-if="!collapsed" class="status-text">{{ statusText }}</span>
      </div>
    </a-layout-sider>

    <!-- Main Content -->
    <a-layout style="background: #141414">
      <!-- Header -->
      <a-layout-header class="app-header">
        <div class="header-left">
          <!-- Breadcrumb / scope indicator -->
          <div v-if="isProject" class="scope-tag project">
            <FolderOutlined />
            <span>{{ cfg.projectName || '项目' }}</span>
            <a-tooltip v-if="cfg.projectRoot" :title="cfg.projectRoot">
              <InfoCircleOutlined style="opacity: 0.5; cursor: help;" />
            </a-tooltip>
          </div>
          <div v-else class="scope-tag global">
            <GlobalOutlined />
            <span>全局模式</span>
          </div>
        </div>
        <div class="header-right">
          <span style="color: #444; font-size: 11px;">v5.0.2.5</span>
          <a-tag
            :color="wsStatus === 'connected' ? 'green' : wsStatus === 'connecting' ? 'orange' : 'red'"
            style="margin: 0;"
          >
            {{ wsStatus === 'connected' ? '已连接' : wsStatus === 'connecting' ? '连接中' : '断开' }}
          </a-tag>
        </div>
      </a-layout-header>

      <!-- Page Content -->
      <a-layout-content style="padding: 24px; overflow: auto;">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  DashboardOutlined, MessageOutlined, AppstoreOutlined, ApiOutlined,
  FolderOutlined, GlobalOutlined, InfoCircleOutlined
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'

const router = useRouter()
const route = useRoute()
const ws = useWsStore()

const collapsed = ref(false)
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')

const selectedKeys = computed(() => {
  const name = route.name?.toLowerCase() || 'dashboard'
  return [name]
})

const wsStatus = computed(() => ws.status)
const statusBadge = computed(() => ({
  connected: 'success', connecting: 'processing', error: 'error', disconnected: 'default'
})[ws.status] || 'default')
const statusText = computed(() => ({
  connected: '已连接', connecting: '连接中...', error: '连接错误', disconnected: '未连接'
})[ws.status] || '未知')

function onMenuClick({ key }) {
  router.push(`/${key}`)
}

onMounted(() => { ws.connect() })
</script>

<style scoped>
.logo {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 10px;
  border-bottom: 1px solid #262626;
  overflow: hidden;
  white-space: nowrap;
}
.logo.collapsed { padding: 0; justify-content: center; }
.logo-icon { font-size: 22px; flex-shrink: 0; }
.logo-text { color: #fff; font-weight: 600; font-size: 15px; }

/* Project mode banner */
.project-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin: 6px 8px;
  background: #0d1b2e;
  border: 1px solid #1677ff30;
  border-radius: 6px;
  overflow: hidden;
}
.project-info { flex: 1; min-width: 0; }
.project-name {
  color: #91caff;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.project-scope { color: #1677ff; font-size: 10px; margin-top: 1px; }

/* Global mode banner */
.global-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  margin: 6px 8px;
  background: #1a0d2e;
  border: 1px solid #722ed130;
  border-radius: 6px;
}
.global-label { color: #c084fc; font-size: 12px; }

/* Collapsed mode icon */
.mode-icon-collapsed {
  display: flex;
  justify-content: center;
  padding: 8px 0;
  font-size: 14px;
}

.sidebar-footer {
  position: absolute;
  bottom: 48px;
  left: 0; right: 0;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid #222;
}
.sidebar-footer.collapsed { justify-content: center; padding: 10px 0; }
.status-text { color: #666; font-size: 11px; }

.app-header {
  background: #1c1c1c;
  padding: 0 20px;
  border-bottom: 1px solid #262626;
  height: 52px;
  line-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header-left { display: flex; align-items: center; }
.header-right { display: flex; align-items: center; gap: 12px; }

.scope-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}
.scope-tag.project { background: #0d1b2e; color: #91caff; border: 1px solid #1677ff25; }
.scope-tag.global { background: #1a0d2e; color: #c084fc; border: 1px solid #722ed125; }
</style>
