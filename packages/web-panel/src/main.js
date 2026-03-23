import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import { theme } from 'ant-design-vue'
import router from './router/index.js'
import App from './App.vue'
import 'ant-design-vue/dist/reset.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(Antd)
app.mount('#app')
