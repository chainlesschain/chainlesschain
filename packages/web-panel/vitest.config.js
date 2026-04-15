import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(process.cwd(), 'src') },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 30000,
    hookTimeout: 120000,
    reporters: ['verbose'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/main.js', 'src/router/**'],
    },
  },
})
