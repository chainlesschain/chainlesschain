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
      '@': resolve(process.cwd(), 'src')
    }
  }
})
