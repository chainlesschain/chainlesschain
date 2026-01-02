/**
 * Vitest测试环境设置
 * 为IPC API单元测试提供全局配置
 */

import { vi } from 'vitest';

// 设置测试环境变量
process.env.NODE_ENV = 'test';

// 全局测试超时时间
vi.setConfig({ testTimeout: 10000 });

// 清理每个测试后的状态
afterEach(() => {
  vi.clearAllMocks();
});
