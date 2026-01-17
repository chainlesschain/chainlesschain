import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.js',
      'tests/**/*.spec.js',
      'desktop-app-vue/tests/**/*.test.js',
      'desktop-app-vue/tests/**/*.spec.js',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.jest.test.js',  // Exclude Jest test files
      '**/blockchain/**',   // Exclude blockchain tests (use Mocha/Chai)
      '**/e2e/**',          // Exclude E2E tests (use Playwright)
      '**/*.e2e.test.{js,ts}',  // Exclude E2E test files by name
      '**/*.spec.{js,ts}',      // Exclude spec files (used by Playwright)
      '**/performance/**',  // Exclude performance tests (run separately)
      // Standalone script tests that use process.exit()
      '**/speech-manager-integration.test.js',
      '**/pkcs11-encryption.test.js',
      // Standalone test scripts (not vitest compatible)
      '**/test-*.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/vitest',
      include: [
        'desktop-app-vue/src/main/**/*.js',
        'src/main/**/*.js',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/*.test.js',
        '**/*.spec.js',
      ],
      // 覆盖率阈值
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
        // AI 引擎核心模块要求更高
        'desktop-app-vue/src/main/ai-engine/**/*.js': {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
    testTimeout: 10000,
    // 性能优化
    maxConcurrency: 5, // 每个测试文件最多同时运行 5 个测试
    isolate: true, // 隔离测试环境（提高可靠性）
    pool: 'threads', // 使用线程池（更快）
    poolOptions: {
      threads: {
        singleThread: false,
        useAtomics: true,
      },
    },
    server: {
      deps: {
        inline: ['electron'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './desktop-app-vue/src'),
      'electron': path.resolve(__dirname, './tests/__mocks__/electron.js'),
    },
  },
});
