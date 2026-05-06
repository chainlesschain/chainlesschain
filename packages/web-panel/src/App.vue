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
        message.info('通知设置在 web-panel 暂无对应页面')
      } else if (data === 'speech') {
        router.push('/speech-settings')
      } else if (data === 'providers' || data === 'llm') {
        router.push('/providers')
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
      message.info('通知中心在 web-panel 暂无对应面板')
      break
    case 'quick-action':
      switch (data) {
        case 'global-search':
          message.info('全局搜索在 web-panel 暂未接入')
          break
        case 'new-chat':
          router.push('/chat')
          break
        case 'new-note':
          router.push('/notes')
          break
        case 'screenshot-ocr':
        case 'clipboard-import':
          message.info('功能即将推出')
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
