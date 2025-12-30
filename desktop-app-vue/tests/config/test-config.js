/**
 * 测试配置
 *
 * 统一管理所有测试相关的配置，包括：
 * 1. 测试环境配置 - 数据库、文件系统、网络
 * 2. Mock配置 - LLM、P2P、HTTP等服务的Mock设置
 * 3. 超时配置 - 不同类型测试的超时时间
 * 4. 路径配置 - 测试数据、临时文件等路径
 */

import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 测试环境配置
 */
export const testEnv = {
  // 是否在CI环境中运行
  isCI: process.env.CI === 'true',

  // 是否启用详细日志
  verbose: process.env.TEST_VERBOSE === 'true',

  // 测试运行模式
  mode: process.env.NODE_ENV || 'test',

  // 平台信息
  platform: os.platform(),
  architecture: os.arch(),
  nodeVersion: process.version
};

/**
 * 路径配置
 */
export const paths = {
  // 测试根目录
  testRoot: path.join(__dirname, '..'),

  // 项目根目录
  projectRoot: path.join(__dirname, '..', '..'),

  // 测试工具目录
  utils: path.join(__dirname, '..', 'utils'),

  // 测试fixtures目录
  fixtures: path.join(__dirname, '..', 'fixtures'),

  // 临时文件目录
  tmp: path.join(__dirname, '..', '.tmp'),

  // 测试数据库目录
  testDbs: path.join(__dirname, '..', '.tmp', 'test-dbs'),

  // 测试覆盖率输出
  coverage: path.join(__dirname, '..', '..', 'coverage'),

  // 源代码目录
  src: {
    main: path.join(__dirname, '..', '..', 'src', 'main'),
    renderer: path.join(__dirname, '..', '..', 'src', 'renderer')
  }
};

/**
 * 超时配置（毫秒）
 */
export const timeouts = {
  // 单元测试默认超时
  unit: 5000,

  // 集成测试默认超时
  integration: 10000,

  // E2E测试默认超时
  e2e: 30000,

  // 性能测试默认超时
  performance: 60000,

  // 数据库操作超时
  database: 3000,

  // 文件系统操作超时
  filesystem: 5000,

  // LLM调用超时
  llm: {
    simple: 30000,      // 简单提示30s
    complex: 120000,    // 复杂提示120s
    max: 600000         // 最大超时600s (10分钟)
  },

  // 网络请求超时
  network: {
    default: 5000,
    upload: 30000,
    download: 30000
  }
};

/**
 * Mock配置
 */
export const mockConfig = {
  // 是否使用Mock LLM服务
  useMockLLM: process.env.MOCK_LLM !== 'false',

  // 是否使用Mock数据库
  useMockDatabase: process.env.MOCK_DB === 'true',

  // 是否使用Mock文件系统
  useMockFileSystem: process.env.MOCK_FS === 'true',

  // 是否使用Mock P2P网络
  useMockP2P: process.env.MOCK_P2P !== 'false',

  // 是否使用Mock HTTP客户端
  useMockHTTP: process.env.MOCK_HTTP !== 'false',

  // LLM Mock响应时间（毫秒）
  llmResponseTime: parseInt(process.env.MOCK_LLM_RESPONSE_TIME || '100', 10),

  // LLM Mock默认响应
  llmDefaultResponse: 'This is a mock LLM response for testing purposes.',

  // 数据库Mock配置
  database: {
    inMemory: true,           // 使用内存数据库
    autoCleanup: true,        // 自动清理
    seedData: false           // 是否自动seed数据
  },

  // P2P Mock配置
  p2p: {
    simulateLatency: true,    // 模拟网络延迟
    latencyMs: 50,           // 延迟时间
    simulateFailures: false,  // 模拟失败
    failureRate: 0.1         // 失败率
  },

  // HTTP Mock配置
  http: {
    simulateLatency: true,
    latencyMs: 100,
    simulateErrors: false,
    errorRate: 0.05
  }
};

/**
 * 数据库配置
 */
export const database = {
  // 数据库类型
  type: 'sqlite',

  // 测试数据库配置
  test: {
    // 使用内存数据库
    memory: mockConfig.database.inMemory,

    // 数据库文件路径（非内存模式）
    path: path.join(paths.testDbs, 'test.db'),

    // 是否启用WAL模式
    walMode: false,

    // 是否启用外键约束
    foreignKeys: true,

    // 同步模式
    synchronous: 'OFF',

    // 日志级别
    logging: testEnv.verbose
  },

  // Seed数据配置
  seed: {
    notes: 10,
    projects: 5,
    templates: 5,
    conversations: 3,
    users: 5
  }
};

/**
 * LLM服务配置
 */
export const llm = {
  // 默认使用的模型
  defaultModel: 'mock-model',

  // Ollama配置
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: 'qwen2:7b'
  },

  // 云服务配置（测试时不使用真实API）
  cloud: {
    enabled: false,
    providers: []
  },

  // 测试时的默认参数
  defaultParams: {
    temperature: 0.7,
    maxTokens: 100,
    topP: 1.0
  }
};

/**
 * 文件系统配置
 */
export const filesystem = {
  // 临时文件前缀
  tempPrefix: 'chainlesschain-test-',

  // 是否自动清理临时文件
  autoCleanup: true,

  // 最大文件大小（字节）
  maxFileSize: 10 * 1024 * 1024, // 10MB

  // 允许的文件扩展名
  allowedExtensions: [
    '.txt', '.md', '.json', '.js', '.ts',
    '.pdf', '.docx', '.xlsx', '.pptx',
    '.jpg', '.png', '.gif', '.svg'
  ]
};

/**
 * P2P网络配置
 */
export const p2p = {
  // 是否启用P2P测试
  enabled: !testEnv.isCI, // CI环境中禁用真实P2P

  // 测试端口范围
  portRange: {
    min: 40000,
    max: 50000
  },

  // 超时配置
  timeouts: {
    connection: 5000,
    message: 3000,
    discovery: 10000
  },

  // Mock配置
  mock: mockConfig.p2p
};

/**
 * Git配置
 */
export const git = {
  // 测试仓库配置
  testRepo: {
    name: 'test-repo',
    author: {
      name: 'Test User',
      email: 'test@example.com'
    }
  },

  // Docker路径映射
  dockerMappings: {
    'C:/code/chainlesschain': '/app',
    'C:/data/projects': '/data/projects'
  }
};

/**
 * 测试数据配置
 */
export const testData = {
  // 默认测试数据量
  defaultCount: {
    small: 5,
    medium: 20,
    large: 100
  },

  // 是否使用真实数据
  useRealData: false,

  // Fixtures文件路径
  fixtures: {
    notes: path.join(paths.fixtures, 'sample-notes.json'),
    projects: path.join(paths.fixtures, 'sample-projects.json'),
    templates: path.join(paths.fixtures, 'sample-templates.json'),
    users: path.join(paths.fixtures, 'sample-users.json')
  }
};

/**
 * 性能测试配置
 */
export const performance = {
  // 基准测试迭代次数
  benchmarkIterations: 100,

  // 预热次数
  warmupIterations: 10,

  // 是否收集内存使用信息
  collectMemoryStats: true,

  // 是否生成性能报告
  generateReport: testEnv.isCI,

  // 性能阈值
  thresholds: {
    // 数据库查询（毫秒）
    databaseQuery: 100,

    // 文件读取（毫秒）
    fileRead: 50,

    // RAG检索（毫秒）
    ragRetrieval: 500,

    // 模板渲染（毫秒）
    templateRender: 100
  }
};

/**
 * 覆盖率配置
 */
export const coverage = {
  // 目标覆盖率
  thresholds: {
    lines: 70,
    functions: 70,
    branches: 70,
    statements: 70
  },

  // 排除的文件和目录
  exclude: [
    'node_modules/',
    'tests/',
    '**/*.test.{js,ts}',
    '**/*.spec.{js,ts}',
    '**/*.d.ts',
    '**/*.config.*',
    '**/mockData',
    '**/dist',
    '**/out'
  ],

  // 包含的文件
  include: ['src/**/*.{js,ts,vue}'],

  // 报告格式
  reporters: ['text', 'json', 'html', 'lcov']
};

/**
 * 日志配置
 */
export const logging = {
  // 日志级别
  level: testEnv.verbose ? 'debug' : 'error',

  // 是否输出到控制台
  console: true,

  // 是否保存日志文件
  file: false,

  // 日志文件路径
  filePath: path.join(paths.tmp, 'test.log')
};

/**
 * 获取环境变量（带默认值）
 */
export function getEnv(key, defaultValue = null) {
  return process.env[key] || defaultValue;
}

/**
 * 获取完整配置
 */
export function getConfig() {
  return {
    testEnv,
    paths,
    timeouts,
    mockConfig,
    database,
    llm,
    filesystem,
    p2p,
    git,
    testData,
    performance,
    coverage,
    logging
  };
}

/**
 * 打印配置信息（用于调试）
 */
export function printConfig() {
  if (testEnv.verbose) {
    console.log('=== Test Configuration ===');
    console.log(JSON.stringify(getConfig(), null, 2));
    console.log('===========================');
  }
}

/**
 * 导出默认配置
 */
export default {
  testEnv,
  paths,
  timeouts,
  mockConfig,
  database,
  llm,
  filesystem,
  p2p,
  git,
  testData,
  performance,
  coverage,
  logging,
  getEnv,
  getConfig,
  printConfig
};
