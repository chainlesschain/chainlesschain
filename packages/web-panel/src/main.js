import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { message } from 'ant-design-vue'
import router from './router/index.js'
import App from './App.vue'
import { registerAntd } from './plugins/antd.js'
import { i18n } from './plugins/i18n.js'
import 'ant-design-vue/dist/reset.css'
import './style.css'

const faviconHref = new URL('../../../assets/favicon.ico', import.meta.url).href
let faviconEl = document.querySelector('link[rel="icon"]')
if (!faviconEl) {
  faviconEl = document.createElement('link')
  faviconEl.rel = 'icon'
  document.head.appendChild(faviconEl)
}
faviconEl.href = faviconHref

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
registerAntd(app)

// Global error sink — Vue render/setup errors that escape ErrorBoundary
// (e.g. inside event handlers or async setup) land here. ErrorBoundary
// returns false from errorCaptured for view-level errors so they do
// not reach this handler twice.
app.config.errorHandler = (err, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[Vue errorHandler]', info, err)
  try {
    const t = i18n.global.t
    message.error(`${t('error.runtime')}: ${err?.message || err}`, 5)
  } catch { /* toast may not be ready */ }
}

// Catch native errors that Vue does not see — bare promise rejections
// from fetch/WebSocket callbacks, errors thrown in setTimeout/RAF, etc.
window.addEventListener('error', (event) => {
  // eslint-disable-next-line no-console
  console.error('[window.error]', event.error || event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledrejection]', event.reason)
})

app.mount('#app')
