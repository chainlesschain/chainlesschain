/**
 * IPC测试：初始设置IPC处理器
 * 测试文件：src/main/initial-setup-ipc.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('InitialSetupIPC - IPC通道测试', () => {
  let ipcMain;
  let mockApp;
  let mockDatabase;
  let mockAppConfig;
  let mockLlmConfig;
  let InitialSetupIPC;
  let ipcInstance;
  let ipcHandlers = {};

  beforeEach(async () => {
    // Mock ipcMain
    ipcHandlers = {};
    ipcMain = {
      handle: vi.fn((channel, handler) => {
        ipcHandlers[channel] = handler;
      }),
    };

    // Mock electron模块
    vi.doMock('electron', () => ({
      ipcMain,
    }));

    // Mock依赖
    mockApp = {
      getPath: vi.fn((name) => {
        if (name === 'userData') return 'C:\\test\\userData';
        return 'C:\\test';
      }),
    };

    mockDatabase = {
      setSetting: vi.fn().mockResolvedValue(true),
      getSetting: vi.fn().mockResolvedValue(null),
    };

    mockAppConfig = {
      set: vi.fn(),
      save: vi.fn(),
      setDatabasePath: vi.fn(),
    };

    mockLlmConfig = {
      set: vi.fn(),
      save: vi.fn(),
    };

    // 动态导入模块
    const module = await import('../../src/main/initial-setup-ipc.js');
    InitialSetupIPC = module.default || module.InitialSetupIPC;

    // 创建实例
    ipcInstance = new InitialSetupIPC(mockApp, mockDatabase, mockAppConfig, mockLlmConfig);
  });

  describe('IPC通道注册', () => {
    it('应注册所有必需的IPC通道', () => {
      expect(ipcHandlers).toHaveProperty('initial-setup:get-status');
      expect(ipcHandlers).toHaveProperty('initial-setup:get-config');
      expect(ipcHandlers).toHaveProperty('initial-setup:save-config');
      expect(ipcHandlers).toHaveProperty('initial-setup:complete');
      expect(ipcHandlers).toHaveProperty('initial-setup:reset');
      expect(ipcHandlers).toHaveProperty('initial-setup:export-config');
      expect(ipcHandlers).toHaveProperty('initial-setup:import-config');
    });
  });

  describe('initial-setup:get-status', () => {
    it('应返回首次设置状态', async () => {
      const handler = ipcHandlers['initial-setup:get-status'];
      const result = await handler();

      expect(result).toHaveProperty('completed');
      expect(result).toHaveProperty('completedAt');
      expect(result).toHaveProperty('edition');
      expect(result.completed).toBe(false); // 首次启动
    });

    it('完成设置后应返回 completed: true', async () => {
      // 先完成设置
      const completeHandler = ipcHandlers['initial-setup:complete'];
      await completeHandler(null, {
        edition: 'personal',
        paths: {
          projectRoot: 'C:\\test\\projects',
          database: 'C:\\test\\db.sqlite'
        },
        llm: null
      });

      // 再查询状态
      const statusHandler = ipcHandlers['initial-setup:get-status'];
      const result = await statusHandler();

      expect(result.completed).toBe(true);
      expect(result.completedAt).toBeTruthy();
    });
  });

  describe('initial-setup:get-config', () => {
    it('应返回完整的配置对象', async () => {
      const handler = ipcHandlers['initial-setup:get-config'];
      const config = await handler();

      expect(config).toHaveProperty('setupCompleted');
      expect(config).toHaveProperty('edition');
      expect(config).toHaveProperty('paths');
      expect(config).toHaveProperty('llm');
      expect(config).toHaveProperty('enterprise');
    });
  });

  describe('initial-setup:save-config', () => {
    it('应保存配置但不标记完成', async () => {
      const handler = ipcHandlers['initial-setup:save-config'];
      const testConfig = {
        edition: 'personal',
        paths: {
          projectRoot: 'C:\\custom\\path'
        }
      };

      const result = await handler(null, testConfig);

      expect(result.success).toBe(true);

      // 验证未标记完成
      const statusHandler = ipcHandlers['initial-setup:get-status'];
      const status = await statusHandler();
      expect(status.completed).toBe(false);
    });
  });

  describe('initial-setup:complete', () => {
    it('应完成设置并应用配置', async () => {
      const handler = ipcHandlers['initial-setup:complete'];
      const config = {
        edition: 'personal',
        paths: {
          projectRoot: 'C:\\projects',
          database: 'C:\\db\\data.sqlite'
        },
        llm: {
          provider: 'ollama',
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          model: 'qwen2:7b'
        }
      };

      const result = await handler(null, config);

      expect(result.success).toBe(true);

      // 验证配置已应用
      expect(mockAppConfig.set).toHaveBeenCalledWith('app.edition', 'personal');
      expect(mockAppConfig.setDatabasePath).toHaveBeenCalledWith('C:\\db\\data.sqlite');
      expect(mockDatabase.setSetting).toHaveBeenCalledWith('project.rootPath', 'C:\\projects');

      // 验证已标记完成
      const statusHandler = ipcHandlers['initial-setup:get-status'];
      const status = await statusHandler();
      expect(status.completed).toBe(true);
    });

    it('应处理企业版配置', async () => {
      const handler = ipcHandlers['initial-setup:complete'];
      const config = {
        edition: 'enterprise',
        paths: {
          projectRoot: '',
          database: ''
        },
        llm: null,
        enterprise: {
          serverUrl: 'https://enterprise.example.com',
          tenantId: 'tenant-123',
          apiKey: 'ent-key-456'
        }
      };

      const result = await handler(null, config);

      expect(result.success).toBe(true);
      expect(mockDatabase.setSetting).toHaveBeenCalledWith('enterprise.serverUrl', 'https://enterprise.example.com');
      expect(mockDatabase.setSetting).toHaveBeenCalledWith('enterprise.tenantId', 'tenant-123');
      expect(mockDatabase.setSetting).toHaveBeenCalledWith('enterprise.apiKey', 'ent-key-456');
    });

    it('应处理错误情况', async () => {
      // Mock数据库错误
      mockDatabase.setSetting.mockRejectedValueOnce(new Error('Database error'));

      const handler = ipcHandlers['initial-setup:complete'];
      const config = {
        edition: 'personal',
        paths: {
          projectRoot: 'C:\\projects'
        }
      };

      const result = await handler(null, config);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('initial-setup:reset', () => {
    it('应重置配置为默认值', async () => {
      // 先设置一些配置
      const saveHandler = ipcHandlers['initial-setup:save-config'];
      await saveHandler(null, {
        edition: 'enterprise',
        paths: { projectRoot: 'C:\\custom' }
      });

      // 重置
      const resetHandler = ipcHandlers['initial-setup:reset'];
      const result = await resetHandler();

      expect(result.success).toBe(true);

      // 验证已重置
      const configHandler = ipcHandlers['initial-setup:get-config'];
      const config = await configHandler();
      expect(config.edition).toBe('personal');
      expect(config.paths.projectRoot).toBe('');
    });
  });

  describe('initial-setup:export-config', () => {
    it('应导出配置并过滤敏感信息', async () => {
      // 设置包含敏感信息的配置
      const saveHandler = ipcHandlers['initial-setup:save-config'];
      await saveHandler(null, {
        edition: 'enterprise',
        llm: {
          provider: 'openai',
          apiKey: 'sk-secret-key-123'
        },
        enterprise: {
          serverUrl: 'https://ent.com',
          tenantId: 'tenant-123',
          apiKey: 'ent-secret-456'
        }
      });

      const exportHandler = ipcHandlers['initial-setup:export-config'];
      const result = await exportHandler();

      expect(result.success).toBe(true);
      expect(result.filePath).toBeTruthy();

      // 验证敏感信息已过滤
      const exportedConfig = JSON.parse(result.data);
      expect(exportedConfig.llm?.apiKey).toBeUndefined();
      expect(exportedConfig.enterprise?.apiKey).toBeUndefined();
    });
  });

  describe('initial-setup:import-config', () => {
    it('应导入配置并忽略设置完成标记', async () => {
      const importHandler = ipcHandlers['initial-setup:import-config'];
      const importData = {
        setupCompleted: true, // 应被忽略
        completedAt: '2025-12-30T10:00:00.000Z', // 应被忽略
        edition: 'personal',
        paths: {
          projectRoot: 'C:\\imported\\path'
        }
      };

      const result = await importHandler(null, importData);

      expect(result.success).toBe(true);

      // 验证配置已导入
      const configHandler = ipcHandlers['initial-setup:get-config'];
      const config = await configHandler();
      expect(config.edition).toBe('personal');
      expect(config.paths.projectRoot).toBe('C:\\imported\\path');

      // 验证设置完成标记未被导入
      expect(config.setupCompleted).toBe(false);
    });
  });
});

console.log('✅ IPC测试脚本已创建');
