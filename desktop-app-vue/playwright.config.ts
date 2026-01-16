import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright配置 - Electron E2E测试
 *
 * 文档: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // 测试目录
  testDir: './tests/e2e',

  // 测试超时时间（提升到120秒以支持AI相关的长时间测试）
  timeout: 120000,

  // 全局超时（10分钟）
  globalTimeout: 600000,

  // 期望超时（提升到15秒以支持较慢的断言）
  expect: {
    timeout: 15000,
  },

  // 并发测试
  fullyParallel: false,
  workers: 1,

  // 失败重试次数
  retries: process.env.CI ? 2 : 0,

  // 报告器
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'],
  ],

  // 全局配置
  use: {
    // 截图设置
    screenshot: 'only-on-failure',

    // 视频录制
    video: 'retain-on-failure',

    // 追踪
    trace: 'retain-on-failure',

    // 操作超时（提升到30秒，支持慢速操作）
    actionTimeout: 30000,

    // 导航超时（提升到60秒，支持慢速页面加载）
    navigationTimeout: 60000,

    // 基础URL (如果需要)
    // baseURL: 'http://localhost:5173',
  },

  // 项目配置
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.test.ts',
    },
  ],

  // 明确忽略不兼容的测试文件
  testIgnore: [
    // Browser extension tests (use Jest/Puppeteer)
    '**/browser-extension/**',
    // Tests with incorrect syntax or using other frameworks
    '**/project-workflow.test.ts',
  ],

  // 输出目录
  outputDir: 'test-results',
});
