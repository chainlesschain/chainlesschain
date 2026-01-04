/**
 * Jest configuration for IPC unit tests
 * 用于 IPC 单元测试的 Jest 配置
 */

module.exports = {
  // 测试环境
  testEnvironment: 'node',

  // 测试文件匹配模式
  testMatch: [
    '**/tests/unit/project/**/*.jest.test.js',
    '**/tests/unit/**/*.jest.test.js',
  ],

  // 转换配置 - 使用 babel-jest 处理 ES6 模块
  transform: {
    '^.+\\.js$': 'babel-jest',
  },

  // 模块文件扩展名
  moduleFileExtensions: ['js', 'json', 'node'],

  // 覆盖率收集
  collectCoverageFrom: [
    'desktop-app-vue/src/main/**/*.js',
    '!desktop-app-vue/src/main/**/*.test.js',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/out/**',
  ],

  // 覆盖率报告器
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json'],

  // 覆盖率输出目录
  coverageDirectory: '<rootDir>/coverage/jest',

  // 覆盖率阈值
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
    './desktop-app-vue/src/main/project/': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // 设置文件
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],

  // 模块名称映射
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/desktop-app-vue/src/$1',
  },

  // 清除 mock
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // 超时时间
  testTimeout: 10000,

  // 详细输出
  verbose: true,

  // 性能优化
  maxWorkers: '50%', // 使用 50% 的 CPU 核心并行执行
  maxConcurrency: 5, // 每个 worker 最多同时运行 5 个测试
  cache: true, // 启用缓存
  cacheDirectory: '<rootDir>/.jest-cache',

  // 忽略的路径
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/out/',
    '/tests/e2e/',
  ],

  // 转换忽略模式
  transformIgnorePatterns: [
    'node_modules/(?!(chalk|ansi-styles|supports-color)/)',
  ],
};
