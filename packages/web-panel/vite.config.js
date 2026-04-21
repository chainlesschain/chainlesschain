import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const rootPkg = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../package.json'), 'utf-8')
)

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
        manualChunks: {
          'vendor': ['vue', 'vue-router', 'pinia'],
          'antd': ['ant-design-vue', '@ant-design/icons-vue'],
          'markdown': ['marked', 'highlight.js']
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src')
    }
  }
})
