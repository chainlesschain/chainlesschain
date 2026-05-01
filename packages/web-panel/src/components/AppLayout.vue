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
            <div class="banner-name">{{ cfg.projectName || $t('appLayout.scope.fallbackProject') }}</div>
            <div class="banner-sub">{{ $t('appLayout.scope.projectPanel') }}</div>
          </div>
        </div>
        <div v-else class="mode-banner global">
          <GlobalOutlined class="banner-icon" />
          <span class="banner-name">{{ $t('appLayout.scope.global') }}</span>
        </div>
      </template>
      <div v-else class="mode-icon-sm" :title="isProject ? cfg.projectName : $t('appLayout.scope.global')">
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
            <template #title><span class="group-label">{{ $t('appLayout.groups.overview') }}</span></template>
            <a-menu-item key="dashboard"><template #icon><DashboardOutlined /></template>{{ $t('appLayout.items.dashboard') }}</a-menu-item>
            <a-menu-item key="chat"><template #icon><MessageOutlined /></template>{{ $t('appLayout.items.chat') }}</a-menu-item>
            <a-menu-item key="quick-ask"><template #icon><ThunderboltOutlined /></template>{{ $t('appLayout.items.quickAsk') }}</a-menu-item>
            <a-menu-item key="cowork"><template #icon><RocketOutlined /></template>{{ $t('appLayout.items.cowork') }}</a-menu-item>
            <a-menu-item key="services"><template #icon><ControlOutlined /></template>{{ $t('appLayout.items.services') }}</a-menu-item>
            <a-menu-item key="aiops"><template #icon><AlertOutlined /></template>{{ $t('appLayout.items.aiops') }}</a-menu-item>
            <a-menu-item key="tokens"><template #icon><NumberOutlined /></template>{{ $t('appLayout.items.tokens') }}</a-menu-item>
            <a-menu-item key="logs"><template #icon><FileTextOutlined /></template>{{ $t('appLayout.items.logs') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-config">
            <template #title><span class="group-label">{{ $t('appLayout.groups.config') }}</span></template>
            <a-menu-item key="skills"><template #icon><AppstoreOutlined /></template>{{ $t('appLayout.items.skills') }}</a-menu-item>
            <a-menu-item key="providers"><template #icon><ApiOutlined /></template>{{ $t('appLayout.items.providers') }}</a-menu-item>
            <a-menu-item key="mcp"><template #icon><CloudServerOutlined /></template>{{ $t('appLayout.items.mcp') }}</a-menu-item>
            <a-menu-item key="project-settings"><template #icon><FolderOutlined /></template>{{ $t('appLayout.items.projectSettings') }}</a-menu-item>
            <a-menu-item key="speech-settings"><template #icon><SoundOutlined /></template>{{ $t('appLayout.items.speechSettings') }}</a-menu-item>
            <a-menu-item key="nlprog"><template #icon><BulbOutlined /></template>{{ $t('appLayout.items.nlprog') }}</a-menu-item>
            <a-menu-item key="codegen"><template #icon><CodeOutlined /></template>{{ $t('appLayout.items.codegen') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-data">
            <template #title><span class="group-label">{{ $t('appLayout.groups.data') }}</span></template>
            <a-menu-item key="notes"><template #icon><BookOutlined /></template>{{ $t('appLayout.items.notes') }}</a-menu-item>
            <a-menu-item key="search"><template #icon><SearchOutlined /></template>{{ $t('appLayout.items.search') }}</a-menu-item>
            <a-menu-item key="memory"><template #icon><BranchesOutlined /></template>{{ $t('appLayout.items.memory') }}</a-menu-item>
            <a-menu-item key="knowledge"><template #icon><ShareAltOutlined /></template>{{ $t('appLayout.items.knowledge') }}</a-menu-item>
            <a-menu-item key="marketplace"><template #icon><ShoppingOutlined /></template>{{ $t('appLayout.items.marketplace') }}</a-menu-item>
            <a-menu-item key="cron"><template #icon><ClockCircleOutlined /></template>{{ $t('appLayout.items.cron') }}</a-menu-item>
            <a-menu-item key="workflow"><template #icon><ApartmentOutlined /></template>{{ $t('appLayout.items.workflow') }}</a-menu-item>
            <a-menu-item key="pipeline"><template #icon><PartitionOutlined /></template>{{ $t('appLayout.items.pipeline') }}</a-menu-item>
            <a-menu-item key="tasks"><template #icon><ThunderboltOutlined /></template>{{ $t('appLayout.items.tasks') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-advanced">
            <template #title><span class="group-label">{{ $t('appLayout.groups.advanced') }}</span></template>
            <a-menu-item key="security"><template #icon><SafetyCertificateOutlined /></template>{{ $t('appLayout.items.security') }}</a-menu-item>
            <a-menu-item key="ukey-sign"><template #icon><KeyOutlined /></template>{{ $t('appLayout.items.ukeySign') }}</a-menu-item>
            <a-menu-item key="trust"><template #icon><SafetyOutlined /></template>{{ $t('appLayout.items.trust') }}</a-menu-item>
            <a-menu-item key="audit"><template #icon><FileSearchOutlined /></template>{{ $t('appLayout.items.audit') }}</a-menu-item>
            <a-menu-item key="mtc"><template #icon><SafetyOutlined /></template>{{ $t('appLayout.items.mtc') }}</a-menu-item>
            <a-menu-item key="did"><template #icon><IdcardOutlined /></template>{{ $t('appLayout.items.did') }}</a-menu-item>
            <a-menu-item key="permissions"><template #icon><LockOutlined /></template>{{ $t('appLayout.items.permissions') }}</a-menu-item>
            <a-menu-item key="p2p"><template #icon><WifiOutlined /></template>{{ $t('appLayout.items.p2p') }}</a-menu-item>
            <a-menu-item key="backup"><template #icon><CloudUploadOutlined /></template>{{ $t('appLayout.items.backup') }}</a-menu-item>
            <a-menu-item key="git"><template #icon><CodeOutlined /></template>{{ $t('appLayout.items.git') }}</a-menu-item>
            <a-menu-item key="projects"><template #icon><ProjectOutlined /></template>{{ $t('appLayout.items.projects') }}</a-menu-item>
            <a-menu-item key="crosschain"><template #icon><SwapOutlined /></template>{{ $t('appLayout.items.crosschain') }}</a-menu-item>
            <a-menu-item key="compliance"><template #icon><SafetyOutlined /></template>{{ $t('appLayout.items.compliance') }}</a-menu-item>
            <a-menu-item key="privacy"><template #icon><ExperimentOutlined /></template>{{ $t('appLayout.items.privacy') }}</a-menu-item>
            <a-menu-item key="inference"><template #icon><DeploymentUnitOutlined /></template>{{ $t('appLayout.items.inference') }}</a-menu-item>
            <a-menu-item key="federation"><template #icon><ClusterOutlined /></template>{{ $t('appLayout.items.federation') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-enterprise">
            <template #title><span class="group-label">{{ $t('appLayout.groups.enterprise') }}</span></template>
            <a-menu-item key="wallet"><template #icon><WalletOutlined /></template>{{ $t('appLayout.items.wallet') }}</a-menu-item>
            <a-menu-item key="organization"><template #icon><TeamOutlined /></template>{{ $t('appLayout.items.organization') }}</a-menu-item>
            <a-menu-item key="tenant"><template #icon><BankOutlined /></template>{{ $t('appLayout.items.tenant') }}</a-menu-item>
            <a-menu-item key="sla"><template #icon><DashboardOutlined /></template>{{ $t('appLayout.items.sla') }}</a-menu-item>
            <a-menu-item key="analytics"><template #icon><BarChartOutlined /></template>{{ $t('appLayout.items.analytics') }}</a-menu-item>
            <a-menu-item key="templates"><template #icon><BlockOutlined /></template>{{ $t('appLayout.items.templates') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-social">
            <template #title><span class="group-label">{{ $t('appLayout.groups.social') }}</span></template>
            <a-menu-item key="community"><template #icon><UsergroupAddOutlined /></template>{{ $t('appLayout.items.community') }}</a-menu-item>
            <a-menu-item key="governance"><template #icon><AuditOutlined /></template>{{ $t('appLayout.items.governance') }}</a-menu-item>
            <a-menu-item key="reputation"><template #icon><TrophyOutlined /></template>{{ $t('appLayout.items.reputation') }}</a-menu-item>
            <a-menu-item key="recommend"><template #icon><FireOutlined /></template>{{ $t('appLayout.items.recommend') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-media">
            <template #title><span class="group-label">{{ $t('appLayout.groups.media') }}</span></template>
            <a-menu-item key="video"><template #icon><VideoCameraOutlined /></template>{{ $t('appLayout.items.video') }}</a-menu-item>
          </a-sub-menu>
          <a-sub-menu key="g-extension">
            <template #title><span class="group-label">{{ $t('appLayout.groups.extension') }}</span></template>
            <a-menu-item key="rssfeed"><template #icon><ReadOutlined /></template>{{ $t('appLayout.items.rssfeed') }}</a-menu-item>
            <a-menu-item key="webauthn"><template #icon><KeyOutlined /></template>{{ $t('appLayout.items.webauthn') }}</a-menu-item>
          </a-sub-menu>
          <!-- Desktop-only group — only shown in the embedded web-shell. Each
               click opens a new BrowserWindow loading the V5/V6 desktop
               renderer (full electronAPI / UKey / FS / settings live there). -->
          <a-sub-menu v-if="shellMode.isEmbedded" key="g-desktop">
            <template #title><span class="group-label">{{ $t('appLayout.groups.desktop') }}</span></template>
            <a-menu-item key="desktop:hardware-wallet"><template #icon><SafetyCertificateOutlined /></template>{{ $t('appLayout.items.desktopHardware') }}</a-menu-item>
            <a-menu-item key="desktop:backup-dashboard"><template #icon><CloudUploadOutlined /></template>{{ $t('appLayout.items.desktopBackup') }}</a-menu-item>
            <a-menu-item key="desktop:llm-test-chat"><template #icon><ExperimentOutlined /></template>{{ $t('appLayout.items.desktopLlmTest') }}</a-menu-item>
            <a-menu-item key="desktop:settings"><template #icon><ControlOutlined /></template>{{ $t('appLayout.items.desktopSettings') }}</a-menu-item>
          </a-sub-menu>
        </template>
        <template v-else>
          <a-menu-item key="dashboard"><template #icon><DashboardOutlined /></template></a-menu-item>
          <a-menu-item key="chat"><template #icon><MessageOutlined /></template></a-menu-item>
          <a-menu-item key="quick-ask"><template #icon><ThunderboltOutlined /></template></a-menu-item>
          <a-menu-item key="cowork"><template #icon><RocketOutlined /></template></a-menu-item>
          <a-menu-item key="services"><template #icon><ControlOutlined /></template></a-menu-item>
          <a-menu-item key="aiops"><template #icon><AlertOutlined /></template></a-menu-item>
          <a-menu-item key="tokens"><template #icon><NumberOutlined /></template></a-menu-item>
          <a-menu-item key="logs"><template #icon><FileTextOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="skills"><template #icon><AppstoreOutlined /></template></a-menu-item>
          <a-menu-item key="providers"><template #icon><ApiOutlined /></template></a-menu-item>
          <a-menu-item key="mcp"><template #icon><CloudServerOutlined /></template></a-menu-item>
          <a-menu-item key="project-settings"><template #icon><FolderOutlined /></template></a-menu-item>
          <a-menu-item key="speech-settings"><template #icon><SoundOutlined /></template></a-menu-item>
          <a-menu-item key="nlprog"><template #icon><BulbOutlined /></template></a-menu-item>
          <a-menu-item key="codegen"><template #icon><CodeOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="notes"><template #icon><BookOutlined /></template></a-menu-item>
          <a-menu-item key="search"><template #icon><SearchOutlined /></template></a-menu-item>
          <a-menu-item key="memory"><template #icon><BranchesOutlined /></template></a-menu-item>
          <a-menu-item key="knowledge"><template #icon><ShareAltOutlined /></template></a-menu-item>
          <a-menu-item key="marketplace"><template #icon><ShoppingOutlined /></template></a-menu-item>
          <a-menu-item key="cron"><template #icon><ClockCircleOutlined /></template></a-menu-item>
          <a-menu-item key="workflow"><template #icon><ApartmentOutlined /></template></a-menu-item>
          <a-menu-item key="pipeline"><template #icon><PartitionOutlined /></template></a-menu-item>
          <a-menu-item key="tasks"><template #icon><ThunderboltOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="security"><template #icon><SafetyCertificateOutlined /></template></a-menu-item>
          <a-menu-item key="ukey-sign"><template #icon><KeyOutlined /></template></a-menu-item>
          <a-menu-item key="trust"><template #icon><SafetyOutlined /></template></a-menu-item>
          <a-menu-item key="audit"><template #icon><FileSearchOutlined /></template></a-menu-item>
          <a-menu-item key="mtc"><template #icon><SafetyOutlined /></template></a-menu-item>
          <a-menu-item key="did"><template #icon><IdcardOutlined /></template></a-menu-item>
          <a-menu-item key="permissions"><template #icon><LockOutlined /></template></a-menu-item>
          <a-menu-item key="p2p"><template #icon><WifiOutlined /></template></a-menu-item>
          <a-menu-item key="backup"><template #icon><CloudUploadOutlined /></template></a-menu-item>
          <a-menu-item key="git"><template #icon><CodeOutlined /></template></a-menu-item>
          <a-menu-item key="projects"><template #icon><ProjectOutlined /></template></a-menu-item>
          <a-menu-item key="crosschain"><template #icon><SwapOutlined /></template></a-menu-item>
          <a-menu-item key="compliance"><template #icon><SafetyOutlined /></template></a-menu-item>
          <a-menu-item key="privacy"><template #icon><ExperimentOutlined /></template></a-menu-item>
          <a-menu-item key="inference"><template #icon><DeploymentUnitOutlined /></template></a-menu-item>
          <a-menu-item key="federation"><template #icon><ClusterOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="wallet"><template #icon><WalletOutlined /></template></a-menu-item>
          <a-menu-item key="organization"><template #icon><TeamOutlined /></template></a-menu-item>
          <a-menu-item key="tenant"><template #icon><BankOutlined /></template></a-menu-item>
          <a-menu-item key="sla"><template #icon><DashboardOutlined /></template></a-menu-item>
          <a-menu-item key="analytics"><template #icon><BarChartOutlined /></template></a-menu-item>
          <a-menu-item key="templates"><template #icon><BlockOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="community"><template #icon><UsergroupAddOutlined /></template></a-menu-item>
          <a-menu-item key="governance"><template #icon><AuditOutlined /></template></a-menu-item>
          <a-menu-item key="reputation"><template #icon><TrophyOutlined /></template></a-menu-item>
          <a-menu-item key="recommend"><template #icon><FireOutlined /></template></a-menu-item>
          <a-menu-divider class="divider-sm" />
          <a-menu-item key="rssfeed"><template #icon><ReadOutlined /></template></a-menu-item>
          <a-menu-item key="webauthn"><template #icon><KeyOutlined /></template></a-menu-item>
          <template v-if="shellMode.isEmbedded">
            <a-menu-divider class="divider-sm" />
            <a-menu-item key="desktop:hardware-wallet"><template #icon><SafetyCertificateOutlined /></template></a-menu-item>
            <a-menu-item key="desktop:backup-dashboard"><template #icon><CloudUploadOutlined /></template></a-menu-item>
            <a-menu-item key="desktop:llm-test-chat"><template #icon><ExperimentOutlined /></template></a-menu-item>
            <a-menu-item key="desktop:settings"><template #icon><ControlOutlined /></template></a-menu-item>
          </template>
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
            <span>{{ isProject ? (cfg.projectName || $t('appLayout.scope.fallbackProject')) : $t('appLayout.scope.global') }}</span>
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

          <!-- Language switcher (incremental i18n; only owns its own
               labels + ErrorBoundary + common.* today). -->
          <a-tooltip :title="$t('language.label')">
            <button
              class="lang-switch-btn"
              :data-locale="locale"
              @click="toggleLocale"
            >
              <GlobalOutlined class="lang-switch-icon" />
              <span class="lang-switch-label">{{ $t('language.switch') }}</span>
            </button>
          </a-tooltip>

          <span class="version-tag">{{ PRODUCT_VERSION }}</span>
          <!-- Phase 1.6 symmetric switch: only inside the embedded
               desktop shell does this make sense (no-op in `cc serve`
               browser mode where there's no V5/V6 to fall back to). -->
          <a-tooltip
            v-if="shellMode.isEmbedded"
            :title="$t('appLayout.shellSwitch')"
          >
            <button
              type="button"
              class="shell-switch-btn"
              @click="switchToDesktopShell"
            >
              <DesktopOutlined />
            </button>
          </a-tooltip>
          <a-tag
            :color="wsStatus === 'connected' ? 'green' : wsStatus === 'connecting' ? 'orange' : 'red'"
            class="ws-tag"
          >
            {{ wsStatus === 'connected' ? $t('appLayout.wsStatus.connected') : wsStatus === 'connecting' ? $t('appLayout.wsStatus.connecting') : $t('appLayout.wsStatus.disconnected') }}
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
  ExperimentOutlined, DeploymentUnitOutlined, BulbOutlined, BankOutlined, PartitionOutlined,
  AuditOutlined, FileSearchOutlined, TrophyOutlined, FireOutlined, SearchOutlined,
  NumberOutlined, ClusterOutlined, SoundOutlined, DesktopOutlined,
} from '@ant-design/icons-vue'
import { message, Modal } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useThemeStore, THEMES } from '../stores/theme.js'
import logoSrc from '../assets/logo.png'
import { useShellMode } from '../composables/useShellMode.js'
import { useI18n } from 'vue-i18n'
import { useLocale } from '../plugins/i18n.js'

const router  = useRouter()
const route   = useRoute()
const ws      = useWsStore()
const themeStore = useThemeStore()
const { t } = useI18n()
// useShellMode reads window.__CC_CONFIG__ on each call; the host injects it
// once at boot, so a single snapshot at setup time is fine for the sidebar's
// "show 桌面专属 group only when embedded" check.
const shellMode = useShellMode()

const collapsed = ref(false)
const cfg = window.__CC_CONFIG__ || {}
const isProject = computed(() => cfg.mode === 'project')
const PRODUCT_VERSION = typeof __PRODUCT_VERSION__ !== 'undefined' ? __PRODUCT_VERSION__ : 'vDev'

const currentTheme = computed(() => themeStore.current)
const menuTheme    = computed(() => themeStore.config.vars['--menu-mode'])

const selectedKeys = computed(() => {
  const name = route.name?.toLowerCase() || 'dashboard'
  return [{ mcptools: 'mcp', quickask: 'quick-ask', ukeysign: 'ukey-sign' }[name] || name]
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
const statusText  = computed(() => {
  const key = `appLayout.footerStatus.${ws.status}`
  const v = t(key)
  return v === key ? t('appLayout.footerStatus.unknown') : v
})

function setTheme(key) { themeStore.setTheme(key) }

// Language switcher — toggles between zh-CN and en. Cycle, not modal,
// because we only ship two locales today and a one-tap toggle reads
// faster than a dropdown for a binary choice.
const { current: locale, supported: SUPPORTED_LOCALES, setLocale } = useLocale()
function toggleLocale() {
  const next = SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(locale.value) + 1) % SUPPORTED_LOCALES.length]
  setLocale(next)
}

async function openDesktopWindow(role) {
  // Spawns a new Electron BrowserWindow loading the V5/V6 desktop renderer
  // at the matching hash route (HardwareWalletPage / BackupDashboard /
  // LLMTestChatPage / SystemSettings). Those pages need the full
  // electronAPI surface (UKey hardware, native FS, settings IPC) which the
  // web-shell's minimal preload doesn't expose; the new window uses the
  // FULL desktop preload instead. See window-open-handler.js for details.
  try {
    const reply = await ws.sendRaw({ type: 'window.open', role }, 10000)
    if (reply?.ok === false) {
      message.error(`打开失败：${reply.error || '未知'}`)
      return
    }
    const r = reply?.result ?? reply
    if (r?.reason === 'role_reserved') {
      message.warning('该窗口角色被保留')
    } else if (r?.reason === 'already_open') {
      // No-op — the existing window was focused by the handler.
    }
  } catch (e) {
    message.error(`打开桌面窗口失败：${e.message || e}`)
  }
}

// Phase 1.6 symmetric switch — mirror of V6 shell's "切换到 Web Shell"
// button. The web-shell preload is intentionally empty (no electronAPI),
// so we route through the `shell.switch` WS topic instead. The handler
// in desktop-app-vue/src/main/web-shell/handlers/shell-switch-handler.js
// persists ui.useWebShellExperimental=false via AppConfigManager and
// then schedules app.relaunch() + app.exit(0) ~100ms later so the WS
// reply can flush before the renderer dies.
async function switchToDesktopShell() {
  Modal.confirm({
    title: '切换到桌面壳？',
    content:
      '回到 V5/V6 桌面壳。完整 electronAPI 表面（UKey 硬件 / 原生对话框 / ' +
      '系统设置等）会重新可用，但失去 web-panel 的 SPA 体验。' +
      '保存后需要重启应用才生效。',
    okText: '切换并重启',
    cancelText: '取消',
    centered: true,
    async onOk() {
      try {
        const reply = await ws.sendRaw(
          { type: 'shell.switch', target: 'desktop' },
          5000,
        )
        if (reply?.ok === false) {
          throw new Error(reply.error || 'shell.switch returned failure')
        }
        // The handler relaunches ~100ms later — show a brief toast so
        // the user sees something happen before the window dies.
        message.loading({ content: '正在重启…', duration: 0 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        message.error('切换失败：' + msg)
      }
    },
  })
}

function onMenuClick({ key }) {
  if (typeof key === 'string' && key.startsWith('desktop:')) {
    openDesktopWindow(key)
    return
  }
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

.lang-switch-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s,
    transform 0.15s;
}
.lang-switch-btn:hover {
  background: var(--bg-card-hover);
  color: #1677ff;
  border-color: #1677ff;
  transform: scale(1.04);
}
.lang-switch-icon {
  font-size: 14px;
}
.lang-switch-label {
  line-height: 1;
}

.shell-switch-btn {
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
  color: var(--text-secondary);
  transition: background 0.15s, transform 0.15s, color 0.15s;
  opacity: 0.6;
}
.shell-switch-btn:hover {
  opacity: 1;
  transform: scale(1.15);
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

/* ── Content ──────────────────────────────────────────────────────────── */
.page-content {
  padding: 24px;
  overflow: auto;
  background: var(--bg-base);
  flex: 1;
  min-height: 0; /* allow flex child to scroll instead of growing */
}
</style>
