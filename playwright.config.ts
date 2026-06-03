import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E测试配置
 * 用于测试Electron应用的IPC通信和UI交互
 *
 * 运行方式:
 *   npx playwright test                    # 运行所有E2E测试
 *   npx playwright test tests/e2e/         # 运行指定目录
 *   npx playwright test --ui               # 使用UI模式
 */
export default defineConfig({
  // 测试目录
  testDir: './tests/e2e',

  // 测试超时 (增加到60秒以适应LLM API响应时间)
  timeout: 60000,

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
    ['html', { outputFolder: 'playwright-report' }],
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
      // 只匹配 *.e2e.test.ts 和 *.e2e.test.js 文件
      // 排除其他测试框架的文件（如 Mocha, Vitest, Jest）
      testMatch: /.*\.e2e\.test\.(js|ts)$/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // 明确忽略不兼容的测试文件
  testIgnore: [
    // Browser extension tests (use Jest/Puppeteer)
    '**/browser-extension/**',
    // Desktop-app-vue tests are handled by that project's own config
    '**/desktop-app-vue/**',
  ],

  // E2E测试不需要webserver（直接测试Electron应用）
  webServer: undefined,
});
