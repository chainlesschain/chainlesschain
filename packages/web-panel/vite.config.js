import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  base: './',
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
