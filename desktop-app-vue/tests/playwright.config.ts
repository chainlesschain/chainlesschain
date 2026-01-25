import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright配置文件 - E2E测试
 * 用于ChainlessChain Desktop Electron应用
 */
export default defineConfig({
  // 测试目录
  testDir: './tests/e2e',

  // 超时设置
  timeout: 60000, // 单个测试60秒超时
  expect: {
    timeout: 10000 // 断言10秒超时
  },

  // 失败时的行为
  fullyParallel: false, // 不完全并行（Electron应用）
  forbidOnly: !!process.env.CI, // CI中禁止.only
  retries: process.env.CI ? 2 : 0, // CI中重试2次
  workers: 1, // 单worker（避免Electron冲突）

  // 报告器
  reporter: [
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'] // 控制台输出
  ],

  // 全局设置
  use: {
    // 截图设置
    screenshot: 'only-on-failure',

    // 视频设置
    video: 'retain-on-failure',

    // Trace设置
    trace: 'on-first-retry',

    // 基础URL（对于Electron不适用）
    // baseURL: 'http://localhost:5173',
  },

  // 项目配置
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.test.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Electron特定配置
        // 实际配置在helpers/common.ts的launchElectronApp中
      },
    },
  ],

  // Web Server配置（Electron不需要）
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:5173',
  //   reuseExistingServer: !process.env.CI,
  // },

  // 输出目录
  outputDir: 'test-results/',
});
