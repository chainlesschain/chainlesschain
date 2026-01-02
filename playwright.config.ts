import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E测试配置
 * 用于测试Electron应用的IPC通信和UI交互
 */
export default defineConfig({
  testDir: './tests/e2e',

  // 测试超时
  timeout: 30000,

  // 全局设置超时
  expect: {
    timeout: 5000,
  },

  // 失败重试次数
  fullyParallel: false, // Electron不支持并行，避免SingletonLock冲突
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // 并行worker数量（Electron测试使用单worker）
  workers: 1, // Electron SingletonLock限制，必须顺序执行

  // 报告器配置
  reporter: [
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],

  // 全局配置
  use: {
    // 基础URL（如果有web界面）
    baseURL: 'http://localhost:5173',

    // 截图设置
    screenshot: 'only-on-failure',

    // 视频设置
    video: 'retain-on-failure',

    // 追踪设置
    trace: 'on-first-retry',
  },

  // 项目配置
  projects: [
    {
      name: 'electron-main',
      testMatch: /.*\.e2e\.test\.(js|ts)/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // Webserver配置（用于开发模式）
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev:renderer',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
