// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 测试配置
 * 用于测试 uni-app H5 模式
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // 测试目录
  testDir: './e2e',

  // 测试文件匹配模式
  testMatch: '**/*.e2e.js',

  // 完全并行运行测试
  fullyParallel: true,

  // CI 环境下禁止 .only
  forbidOnly: !!process.env.CI,

  // 失败重试次数
  retries: process.env.CI ? 2 : 0,

  // 并行工作进程数
  workers: process.env.CI ? 1 : undefined,

  // 测试报告
  reporter: [
    ['html', { outputFolder: 'e2e-report' }],
    ['list'],
  ],

  // 全局设置
  use: {
    // 基础 URL（H5 开发服务器）
    baseURL: 'http://localhost:8080',

    // 失败时截图
    screenshot: 'only-on-failure',

    // 失败时录制视频
    video: 'retain-on-failure',

    // 追踪
    trace: 'on-first-retry',

    // 操作超时
    actionTimeout: 10000,

    // 导航超时
    navigationTimeout: 30000,
  },

  // 测试项目配置（模拟移动端设备）
  projects: [
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
      },
    },
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 12'],
      },
    },
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // 开发服务器配置
  webServer: {
    command: 'npm run dev:h5',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // 全局超时
  timeout: 60000,

  // 期望超时
  expect: {
    timeout: 10000,
  },
});
