import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import os from 'node:os'

const maxForks = Number(
  process.env.CC_VITEST_MAX_FORKS ||
    Math.min(4, Math.max(2, Math.floor((os.cpus()?.length || 2) / 2))),
)

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
      '@chainlesschain/locales': resolve(process.cwd(), '../locales/seed/index.js'),
      '@chainlesschain/locales/zh-CN': resolve(process.cwd(), '../locales/seed/zh-CN.json'),
      '@chainlesschain/locales/en': resolve(process.cwd(), '../locales/seed/en.json'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 30000,
    hookTimeout: 120000,
    reporters: ['verbose'],
    pool: 'forks',
    forks: { maxForks, minForks: 1 },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/main.js', 'src/router/**'],
    },
  },
})
