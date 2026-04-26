<template>
  <a-layout class="app-root">
    <!-- ── Sidebar ─────────────────────────────────────────────────── -->
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      :collapsed-width="56"
      :width="216"
      class="sidebar"
    >
      <!-- Logo -->
      <div class="logo" :class="{ collapsed }">
        <img :src="logoSrc" alt="ChainlessChain" class="logo-icon" />
        <span v-if="!collapsed" class="logo-text">ChainlessChain</span>
      </div>

      <!-- Mode banner -->
      <template v-if="!collapsed">
        <div v-if="isProject" class="mode-banner project">
          <FolderOutlined class="banner-icon" />
          <div class="banner-info">
            <div class="banner-name">{{ cfg.projectName || '项目' }}</div>
            <div class="banner-sub">项目级面板</div>
          </div>
        </div>
        <div v-else class="mode-banner global">
          <GlobalOutlined class="banner-icon" />
          <span class="banner-name">全局模式</span>
        </div>
      </template>
      <div v-else class="mode-icon-sm" :title="isProject ? cfg.projectName : '全局模式'">
        <FolderOutlined v-if="isProject" style="color: #1677ff;" />
        <GlobalOutlined v-else style="color: #722ed1;" />
      </div>

      <!-- Navigation -->
      <a-menu
        v-model:selectedKeys="selectedKeys"
        v-model:openKeys="openKeys"
        :theme="menuTheme"
        mode="inline"
        :inline-collapsed="collapsed"
        class="side-menu"
        @click="onMenuClick"
      >
        <template v-if="!collapsed">
          <a-sub-menu key="g-overview">
            <template #title><span class="group-label">概 览</span></template>
            <a-menu-item key="dashboard"><template #icon><DashboardOutlined /></template>仪表板</a-menu-item>
            <a-menu-item key="chat"><template #icon><MessageOutlined /></template>AI 对话</a-menu-item>
            <a-menu-item key="cowork"><template #icon><RocketOutlined /></template>日常协作</a-menu-item>
            <a-menu-item key="services"><template #icon><ControlOutlined /></template>服务管理</a-menu-item>
            <a-menu-item key="aiops"><template #icon><AlertOutlined /></template>AIOps</a-menu-item>
            <a-menu-item key="logs"><template #icon><FileTextOutlined /></template>日志查看</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-config">
            <template #title><span class="group-label">配 置</span></template>
            <a-menu-item key="skills"><template #icon><AppstoreOutlined /></template>技能管理</a-menu-item>
            <a-menu-item key="providers"><template #icon><ApiOutlined /></template>LLM 配置</a-menu-item>
            <a-menu-item key="mcp"><template #icon><CloudServerOutlined /></template>MCP 工具</a-menu-item>
            <a-menu-item key="project-settings"><template #icon><FolderOutlined /></template>项目存储</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-data">
            <template #title><span class="group-label">数 据</span></template>
            <a-menu-item key="notes"><template #icon><BookOutlined /></template>笔记管理</a-menu-item>
            <a-menu-item key="memory"><template #icon><BranchesOutlined /></template>记忆文件</a-menu-item>
            <a-menu-item key="knowledge"><template #icon><ShareAltOutlined /></template>知识图谱</a-menu-item>
            <a-menu-item key="marketplace"><template #icon><ShoppingOutlined /></template>技能市场</a-menu-item>
            <a-menu-item key="cron"><template #icon><ClockCircleOutlined /></template>定时任务</a-menu-item>
            <a-menu-item key="workflow"><template #icon><ApartmentOutlined /></template>工作流编辑</a-menu-item>
            <a-menu-item key="tasks"><template #icon><ThunderboltOutlined /></template>后台任务</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-advanced">
            <template #title><span class="group-label">高 级</span></template>
            <a-menu-item key="security"><template #icon><SafetyCertificateOutlined /></template>安全中心</a-menu-item>
            <a-menu-item key="did"><template #icon><IdcardOutlined /></template>DID 身份</a-menu-item>
            <a-menu-item key="permissions"><template #icon><LockOutlined /></template>权限管理</a-menu-item>
            <a-menu-item key="p2p"><template #icon><WifiOutlined /></template>P2P 网络</a-menu-item>
            <a-menu-item key="backup"><template #icon><CloudUploadOutlined /></template>备份同步</a-menu-item>
            <a-menu-item key="git"><template #icon><CodeOutlined /></template>Git 与数据</a-menu-item>
            <a-menu-item key="projects"><template #icon><ProjectOutlined /></template>项目管理</a-menu-item>
            <a-menu-item key="crosschain"><template #icon><SwapOutlined /></template>跨链桥</a-menu-item>
            <a-menu-item key="compliance"><template #icon><SafetyOutlined /></template>合规与情报</a-menu-item>
            <a-menu-item key="privacy"><template #icon><ExperimentOutlined /></template>隐私计算</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-enterprise">
            <template #title><span class="group-label">企 业</span></template>
            <a-menu-item key="wallet"><template #icon><WalletOutlined /></template>钱包管理</a-menu-item>
            <a-menu-item key="organization"><template #icon><TeamOutlined /></template>组织管理</a-menu-item>
            <a-menu-item key="analytics"><template #icon><BarChartOutlined /></template>使用分析</a-menu-item>
            <a-menu-item key="templates"><template #icon><BlockOutlined /></template>模板中心</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-social">
            <template #title><span class="group-label">社 交</span></template>
            <a-menu-item key="community"><template #icon><UsergroupAddOutlined /></template>社区</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-media">
            <template #title><span class="group-label">媒 体</span></template>
            <a-menu-item key="video"><template #icon><VideoCameraOutlined /></template>视频剪辑</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-extension">
            <template #title><span class="group-label">扩 展</span></template>
            <a-menu-item key="rssfeed"><template #icon><ReadOutlined /></template>RSS 订阅</a-menu-item>
            <a-menu-item key="webauthn"><template #icon><KeyOutlined /></template>身份认证</a-menu-item>
          </a-sub-menu>
        </template>
        <template v-else>
          <a-menu-item key="dashboard"><template #icon><DashboardOutlined /></template></a-menu-item>
          <a-menu-item key="chat"><template #icon><MessageOutlined /></template></a-menu-item>
          <a-menu-item key="cowork"><template #icon><RocketOutlined /></template></a-menu-item>
          <a-menu-item key="services"><template #icon><ControlOutlined /></template></a-menu-item>
          <a-menu-item key="aiops"><template #icon><AlertOutlined /></template></a-menu-item>
          <a-menu-item key="logs"><template #icon><FileTextOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="skills"><template #icon><AppstoreOutlined /></template></a-menu-item>
          <a-menu-item key="providers"><template #icon><ApiOutlined /></template></a-menu-item>
          <a-menu-item key="mcp"><template #icon><CloudServerOutlined /></template></a-menu-item>
          <a-menu-item key="project-settings"><template #icon><FolderOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="notes"><template #icon><BookOutlined /></template></a-menu-item>
          <a-menu-item key="memory"><template #icon><BranchesOutlined /></template></a-menu-item>
          <a-menu-item key="knowledge"><template #icon><ShareAltOutlined /></template></a-menu-item>
          <a-menu-item key="marketplace"><template #icon><ShoppingOutlined /></template></a-menu-item>
          <a-menu-item key="cron"><template #icon><ClockCircleOutlined /></template></a-menu-item>
          <a-menu-item key="workflow"><template #icon><ApartmentOutlined /></template></a-menu-item>
          <a-menu-item key="tasks"><template #icon><ThunderboltOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="security"><template #icon><SafetyCertificateOutlined /></template></a-menu-item>
          <a-menu-item key="did"><template #icon><IdcardOutlined /></template></a-menu-item>
          <a-menu-item key="permissions"><template #icon><LockOutlined /></template></a-menu-item>
          <a-menu-item key="p2p"><template #icon><WifiOutlined /></template></a-menu-item>
          <a-menu-item key="backup"><template #icon><CloudUploadOutlined /></template></a-menu-item>
          <a-menu-item key="git"><template #icon><CodeOutlined /></template></a-menu-item>
          <a-menu-item key="projects"><template #icon><ProjectOutlined /></template></a-menu-item>
          <a-menu-item key="crosschain"><template #icon><SwapOutlined /></template></a-menu-item>
          <a-menu-item key="compliance"><template #icon><SafetyOutlined /></template></a-menu-item>
          <a-menu-item key="privacy"><template #icon><ExperimentOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="wallet"><template #icon><WalletOutlined /></template></a-menu-item>
          <a-menu-item key="organization"><template #icon><TeamOutlined /></template></a-menu-item>
          <a-menu-item key="analytics"><template #icon><BarChartOutlined /></template></a-menu-item>
          <a-menu-item key="templates"><template #icon><BlockOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="community"><template #icon><UsergroupAddOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="rssfeed"><template #icon><ReadOutlined /></template></a-menu-item>
          <a-menu-item key="webauthn"><template #icon><KeyOutlined /></template></a-menu-item>
        </template>
      </a-menu>

      <!-- Connection status -->
      <div class="sidebar-footer" :class="{ collapsed }">
        <a-badge :status="statusBadge" />
        <span v-if="!collapsed" class="footer-text">{{ statusText }}</span>
      </div>
    </a-layout-sider>

    <!-- ── Main area ───────────────────────────────────────────────── -->
    <a-layout class="main-area">
      <!-- Header -->
      <a-layout-header class="app-header">
        <div class="header-left">
          <div :class="['scope-tag', isProject ? 'project' : 'global']">
            <component :is="isProject ? FolderOutlined : GlobalOutlined" />
            <span>{{ isProject ? (cfg.projectName || '项目') : '全局模式' }}</span>
            <a-tooltip v-if="isProject && cfg.projectRoot" :title="cfg.projectRoot">
              <InfoCircleOutlined class="info-icon" />
            </a-tooltip>
          </div>
        </div>

        <div class="header-right">
          <!-- Theme switcher -->
          <div class="theme-switcher">
            <a-tooltip v-for="(t, key) in THEMES" :key="key" :title="t.label">
              <button
                :class="['theme-btn', { active: currentTheme === key }]"
                :data-theme-key="key"
                @click="setTheme(key)"
              >{{ t.icon }}</button>
            </a-tooltip>
          </div>

          <span class="version-tag">{{ PRODUCT_VERSION }}</span>
          <a-tag
            :color="wsStatus === 'connected' ? 'green' : wsStatus === 'connecting' ? 'orange' : 'red'"
            class="ws-tag"
          >
            {{ wsStatus === 'connected' ? '已连接' : wsStatus === 'connecting' ? '连接中' : '断开' }}
          </a-tag>
        </div>
      </a-layout-header>

      <!-- Content -->
      <a-layout-content class="page-content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  DashboardOutlined, MessageOutlined, RocketOutlined, AppstoreOutlined, ApiOutlined,
  FolderOutlined, GlobalOutlined, InfoCircleOutlined,
  ControlOutlined, FileTextOutlined, CloudServerOutlined,
  BookOutlined, BranchesOutlined, ClockCircleOutlined, ThunderboltOutlined, ApartmentOutlined,
  SafetyCertificateOutlined, LockOutlined, WifiOutlined, CodeOutlined, ProjectOutlined,
  WalletOutlined, TeamOutlined, BarChartOutlined, BlockOutlined, CloudUploadOutlined,
  ReadOutlined, KeyOutlined, VideoCameraOutlined, ShareAltOutlined, IdcardOutlined,
  UsergroupAddOutlined, ShoppingOutlined, SwapOutlined, AlertOutlined, SafetyOutlined,
  ExperimentOutlined,
} from '@ant-design/icons-vue'
import { useWsStore } from '../stores/ws.js'
import { useThemeStore, THEMES } from '../stores/theme.js'

const router  = useRouter()
const route   = useRoute()
const ws      = useWsStore()
const themeStore = useThemeStore()

const collapsed = ref(false)
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')
const PRODUCT_VERSION = typeof __PRODUCT_VERSION__ !== 'undefined' ? __PRODUCT_VERSION__ : 'vDev'
const logoSrc = new URL('../../../../assets/logo.png', import.meta.url).href

const currentTheme = computed(() => themeStore.current)
const menuTheme    = computed(() => themeStore.config.vars['--menu-mode'])

const selectedKeys = computed(() => {
  const name = route.name?.toLowerCase() || 'dashboard'
  return [{ mcptools: 'mcp' }[name] || name]
})

const ALL_GROUP_KEYS = [
  'g-overview', 'g-config', 'g-data', 'g-advanced',
  'g-enterprise', 'g-social', 'g-media', 'g-extension',
]
const OPEN_KEYS_LS = 'cc.web-panel.sidebar.openKeys'

function loadOpenKeys() {
  try {
    const raw = localStorage.getItem(OPEN_KEYS_LS)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(k => ALL_GROUP_KEYS.includes(k))
    }
  } catch { /* ignore corrupt */ }
  return [...ALL_GROUP_KEYS]
}

const openKeys = ref(loadOpenKeys())

watch(openKeys, (keys) => {
  try {
    localStorage.setItem(OPEN_KEYS_LS, JSON.stringify(keys))
  } catch { /* quota / disabled — ignore */ }
}, { deep: true })

const wsStatus   = computed(() => ws.status)
const statusBadge = computed(() => ({ connected:'success', connecting:'processing', error:'error', disconnected:'default' })[ws.status] || 'default')
const statusText  = computed(() => ({ connected:'已连接', connecting:'连接中...', error:'连接错误', disconnected:'未连接' })[ws.status] || '未知')

function setTheme(key) { themeStore.setTheme(key) }
function onMenuClick({ key }) {
  router.push({ mcp: '/mcp' }[key] || `/${key}`)
}
onMounted(() => ws.connect())
</script>

<style scoped>
/* ── Layout shell ─────────────────────────────────────────────────────── */
.app-root {
  /* Lock viewport so the sidebar can scroll independently of the main
     content area; otherwise menu growth pushes the whole page taller and
     .side-menu's overflow-y never triggers. */
  height: 100vh;
  background: var(--bg-base);
  overflow: hidden;
}
.sidebar {
  background: var(--bg-sidebar) !important;
  border-right: 1px solid var(--border-color);
  transition: background 0.25s;
  height: 100vh;
}
:deep(.ant-layout-sider-children) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.main-area {
  background: var(--bg-base);
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Logo ─────────────────────────────────────────────────────────────── */
.logo {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  gap: 10px;
  border-bottom: 1px solid var(--border-color);
  overflow: hidden;
  white-space: nowrap;
  flex-shrink: 0;
}
.logo.collapsed { padding: 0; justify-content: center; }
.logo-icon  { width: 24px; height: 24px; flex-shrink: 0; object-fit: contain; }
.logo-text  { color: var(--logo-text); font-weight: 700; font-size: 14px; letter-spacing: 0.01em; }

/* ── Mode banner ──────────────────────────────────────────────────────── */
.mode-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin: 8px 8px 4px;
  border-radius: 7px;
  overflow: hidden;
}
.mode-banner.project { background: rgba(22,119,255,.1); border: 1px solid rgba(22,119,255,.2); }
.mode-banner.global  { background: rgba(114,46,209,.1); border: 1px solid rgba(114,46,209,.2); }
.banner-icon   { font-size: 13px; flex-shrink: 0; color: #1677ff; }
.mode-banner.global .banner-icon { color: #722ed1; }
.banner-info   { flex: 1; min-width: 0; }
.banner-name   { font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.banner-sub    { font-size: 10px; color: #1677ff; margin-top: 1px; }
.mode-banner.global .banner-name { color: #c084fc; }

.mode-icon-sm { display: flex; justify-content: center; padding: 8px 0; font-size: 14px; }

/* ── Menu ─────────────────────────────────────────────────────────────── */
.side-menu {
  border: none !important;
  margin-top: 2px;
  user-select: none;
  background: transparent !important;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.group-label {
  color: var(--group-title);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding-left: 6px;
}
:deep(.ant-menu-item-group-title) { padding: 8px 16px 2px !important; }
:deep(.ant-menu-item) {
  height: 38px !important;
  line-height: 38px !important;
  margin: 1px 4px !important;
  border-radius: 6px !important;
}
.divider-sm { margin: 4px 0 !important; }

/* ── Sidebar footer ───────────────────────────────────────────────────── */
.sidebar-footer {
  flex-shrink: 0;
  padding: 8px 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--border-color);
}
.sidebar-footer.collapsed { justify-content: center; padding: 8px 0; }
.footer-text { color: var(--text-secondary); font-size: 11px; }

/* ── Header ───────────────────────────────────────────────────────────── */
.app-header {
  background: var(--bg-header) !important;
  padding: 0 20px !important;
  border-bottom: 1px solid var(--border-color);
  height: 50px !important;
  line-height: 50px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.header-left, .header-right { display: flex; align-items: center; gap: 10px; }

.scope-tag {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
}
.scope-tag.project { background: rgba(22,119,255,.1); color: #1677ff; border: 1px solid rgba(22,119,255,.2); }
.scope-tag.global  { background: rgba(114,46,209,.1); color: #722ed1; border: 1px solid rgba(114,46,209,.2); }
.info-icon { opacity: 0.45; cursor: help; margin-left: 2px; }

/* ── Theme switcher ───────────────────────────────────────────────────── */
.theme-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 3px 6px;
}
.theme-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.15s;
  opacity: 0.55;
}
.theme-btn:hover  { opacity: 0.9;  transform: scale(1.15); background: var(--bg-card-hover); }
.theme-btn.active { opacity: 1.0;  transform: scale(1.1);  background: var(--bg-card-hover); outline: 2px solid var(--text-secondary); }

.version-tag { color: var(--text-muted); font-size: 11px; }
.ws-tag { margin: 0 !important; font-size: 11px; }

/* ── Content ──────────────────────────────────────────────────────────── */
.page-content {
  padding: 24px;
  overflow: auto;
  background: var(--bg-base);
  flex: 1;
  min-height: 0; /* allow flex child to scroll instead of growing */
}
</style>
