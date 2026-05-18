import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const rootPkg = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../package.json'), 'utf-8')
)

function manualChunks(id) {
  const normalizedId = id.replace(/\\/g, '/')

  if (!normalizedId.includes('/node_modules/')) return

  if (
    normalizedId.includes('/vue/') ||
    normalizedId.includes('/vue-router/') ||
    normalizedId.includes('/pinia/')
  ) {
    return 'vendor'
  }

  if (
    normalizedId.includes('/marked/') ||
    normalizedId.includes('/dompurify/') ||
    normalizedId.includes('/highlight.js/')
  ) {
    return 'markdown'
  }

  if (
    normalizedId.includes('/@ant-design/icons-vue/') ||
    normalizedId.includes('/@ant-design/icons-svg/')
  ) {
    return 'icons'
  }

  // Echarts is only consumed by KnowledgeGraph today, but bundling it
  // inline blew that route's chunk past Vite's 500 kB warning. Splitting
  // it out keeps the visited route lean and lets the browser cache the
  // (large, rarely-changing) charting bundle independently.
  if (
    normalizedId.includes('/echarts/') ||
    normalizedId.includes('/vue-echarts/') ||
    normalizedId.includes('/zrender/') ||
    normalizedId.includes('/tslib/')
  ) {
    return 'echarts'
  }
}

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: {
    __PRODUCT_VERSION__: JSON.stringify(rootPkg.productVersion)
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
      // Shared i18n catalog (M1 of the i18n migration). web-panel is
      // not a workspace member, so we thread the seed in via alias
      // rather than a node_modules link. desktop-app-vue will mirror
      // this alias when it adopts the catalog.
      '@chainlesschain/locales': resolve(process.cwd(), '../locales/seed/index.js'),
      '@chainlesschain/locales/zh-CN': resolve(process.cwd(), '../locales/seed/zh-CN.json'),
      '@chainlesschain/locales/en': resolve(process.cwd(), '../locales/seed/en.json'),
    }
  }
})
