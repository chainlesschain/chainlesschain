import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router/index.js'
import App from './App.vue'
import { registerAntd } from './plugins/antd.js'
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
registerAntd(app)
app.mount('#app')
