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
