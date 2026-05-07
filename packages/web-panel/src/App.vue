<template>
  <a-config-provider :theme="themeStore.antdTheme" :locale="antdLocale">
    <ErrorBoundary>
      <router-view />
    </ErrorBoundary>
  </a-config-provider>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { useThemeStore } from './stores/theme.js'
import { useWsStore } from './stores/ws.js'
import { useLocale } from './plugins/i18n.js'
import ErrorBoundary from './components/ErrorBoundary.vue'

const themeStore = useThemeStore()
const ws = useWsStore()
const router = useRouter()
const { antdLocale } = useLocale()

// v5.0.3.34 — desktop tray menu items broadcast `tray:action` frames over
// the embedded ws-server when web-panel is the loaded renderer (the V5/V6
// `tray:action` IPC channel has no listener here — preload is empty by
// design). Map each tray action type to web-panel's own routes; unmapped
// types fall through to a toast so the user sees feedback instead of a
// silent no-op (the V5/V6 path used to do the same with router warnings).
function routeTrayAction(payload) {
  const { type, payload: data } = payload || {}
  switch (type) {
    case 'open-settings':
      // V5/V6 has /settings/system + sub-tabs. Web-panel splits settings
      // by domain (project / speech / providers / mcp …) — no single
      // /settings root. Closest match: project-settings for the catch-all,
      // sub-domains route to dedicated pages.
      if (data === 'notifications') {
        // Phase 3c.7 — web-panel 自带 NotificationSettings 视图,直接路由
        // (notification-settings.* WS topic 后端持久化进 appConfig)。
        router.push('/notification-settings')
      } else if (data === 'speech') {
        router.push('/speech-settings')
      } else if (data === 'providers' || data === 'llm') {
        router.push('/providers')
      } else if (data === 'sync') {
        // Phase 3b 桌面 V5/V6 的 /settings/sync 在 web-panel 这边落到 /sync-settings。
        // CLI 桥接版本只覆盖 status / push / pull / 冲突；多 provider 详细
        // 配置（WebDAV 等）仍只在 V5/V6 shell 提供，详见 SyncSettings.vue 顶部 banner。
        router.push('/sync-settings')
      } else {
        router.push('/project-settings')
      }
      break
    case 'show-performance':
      // V5/V6 routes to /performance/dashboard; web-panel surfaces perf
      // info on the main dashboard.
      router.push('/dashboard')
      break
    case 'show-notifications':
      // Phase 3c.6 NotificationBell drawer is mounted in AppLayout header;
      // dispatch a window CustomEvent so the bell opens itself regardless
      // of which route is active.
      window.dispatchEvent(new CustomEvent('cc:open-notification-drawer'))
      break
    case 'quick-action':
      switch (data) {
        case 'global-search':
          router.push('/search')
          break
        case 'new-chat':
          router.push('/chat')
          break
        case 'new-note':
          router.push('/notes')
          break
        case 'clipboard-import':
          // Notes.vue 监听 route.query.clipboardImport,自动打开
          // ClipboardImportDialog. 用 timestamp 让重复点击都触发 watch.
          router.push(`/notes?clipboardImport=${Date.now()}`)
          break
        case 'screenshot-ocr':
          // Phase 3c.7 — Notes.vue 监听 route.query.screenshotOcr,自动打开
          // ScreenshotImportDialog (screenshot.* WS topic 在 web-shell 落地)。
          router.push(`/notes?screenshotOcr=${Date.now()}`)
          break
        default:
          message.info('未识别的快速操作')
      }
      break
    case 'sync': {
      const { mode, value } = data || {}
      if (mode === 'now') message.info('立即同步功能即将推出')
      else if (mode === 'toggle-auto') message.info(`自动同步：${value ? '已开启' : '已关闭'}（待接入）`)
      break
    }
    default:
      message.info(`未识别的托盘操作: ${type}`)
  }
}

let unsubscribe = null
onMounted(() => {
  themeStore.init()
  unsubscribe = ws.onMessage((msg) => {
    if (msg && msg.type === 'tray:action') {
      routeTrayAction(msg.payload)
    }
  })
})
onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>
