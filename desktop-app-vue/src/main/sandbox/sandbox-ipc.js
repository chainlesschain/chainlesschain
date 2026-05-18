/**
 * Sandbox IPC 处理器
 *
 * 负责处理代码执行沙箱相关的前后端通信
 *
 * @module sandbox-ipc
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');
const defaultIpcGuard = require('../ipc/ipc-guard');

/**
 * 注册 Sandbox IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.pythonSandbox - Python 沙箱实例
 * @param {Object} [dependencies.mainWindow] - 主窗口实例
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象
 * @param {Object} [dependencies.ipcGuard] - IPC 守卫
 */
function registerSandboxIPC({
  pythonSandbox,
  mainWindow,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
}) {
  const ipcGuard = injectedIpcGuard || defaultIpcGuard;

  // 防止重复注册
  if (ipcGuard.isModuleRegistered('sandbox-ipc')) {
    logger.info('[Sandbox IPC] Handlers already registered, skipping...');
    return;
  }

  const electron = require('electron');
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info('[Sandbox IPC] Registering Sandbox IPC handlers...');

  // 创建可变引用
  const sandboxRef = { current: pythonSandbox };

  // ============================================================
  // 服务状态
  // ============================================================

  /**
   * 检查沙箱状态
   * Channel: 'sandbox:check-status'
   */
  ipcMain.handle('sandbox:check-status', async () => {
    try {
      if (!sandboxRef.current) {
        return {
          available: false,
          error: '沙箱服务未初始化',
        };
      }

      return await sandboxRef.current.checkStatus();
    } catch (error) {
      logger.error('[Sandbox IPC] 检查状态失败:', error);
      return {
        available: false,
        error: error.message,
      };
    }
  });

  /**
   * 初始化沙箱
   * Channel: 'sandbox:initialize'
   */
  ipcMain.handle('sandbox:initialize', async () => {
    try {
      if (!sandboxRef.current) {
        return { success: false, error: '沙箱服务未配置' };
      }

      await sandboxRef.current.initialize();

      return { success: true };
    } catch (error) {
      logger.error('[Sandbox IPC] 初始化失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 代码执行
  // ============================================================

  /**
   * 执行 Python 代码
   * Channel: 'sandbox:execute-python'
   * @param {Object} params - 执行参数
   * @param {string} params.code - Python 代码
   * @param {number} [params.timeout] - 超时时间 (ms)
   * @param {Object} [params.inputData] - 输入数据
   * @param {string} [params.memoryLimit] - 内存限制
   */
  ipcMain.handle('sandbox:execute-python', async (event, params) => {
    try {
      if (!sandboxRef.current) {
        throw new Error('沙箱服务未初始化');
      }

      const { code, timeout, inputData, memoryLimit } = params;

      if (!code || typeof code !== 'string') {
        throw new Error('请提供有效的 Python 代码');
      }

      // 安全检查：禁止危险操作
      const securityCheck = checkCodeSecurity(code);
      if (!securityCheck.safe) {
        return {
          success: false,
          error: `安全检查失败: ${securityCheck.reason}`,
        };
      }

      const result = await sandboxRef.current.execute(code, {
        timeout,
        inputData,
        memoryLimit,
      });

      return {
        success: result.status === 'completed',
        data: result,
      };
    } catch (error) {
      logger.error('[Sandbox IPC] 执行代码失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 终止执行
   * Channel: 'sandbox:kill-execution'
   */
  ipcMain.handle('sandbox:kill-execution', async (event, executionId) => {
    try {
      if (!sandboxRef.current) {
        throw new Error('沙箱服务未初始化');
      }

      const killed = await sandboxRef.current.killExecution(executionId);

      return {
        success: killed,
        message: killed ? '执行已终止' : '未找到执行任务',
      };
    } catch (error) {
      logger.error('[Sandbox IPC] 终止执行失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 统计与配置
  // ============================================================

  /**
   * 获取统计数据
   * Channel: 'sandbox:get-stats'
   */
  ipcMain.handle('sandbox:get-stats', async () => {
    try {
      if (!sandboxRef.current) {
        return { success: false, error: '沙箱服务未初始化' };
      }

      return {
        success: true,
        data: sandboxRef.current.getStats(),
      };
    } catch (error) {
      logger.error('[Sandbox IPC] 获取统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 更新配置
   * Channel: 'sandbox:update-config'
   */
  ipcMain.handle('sandbox:update-config', async (event, config) => {
    try {
      if (!sandboxRef.current) {
        return { success: false, error: '沙箱服务未初始化' };
      }

      // 验证配置
      const validatedConfig = validateConfig(config);
      sandboxRef.current.updateConfig(validatedConfig);

      return {
        success: true,
        message: '配置已更新',
      };
    } catch (error) {
      logger.error('[Sandbox IPC] 更新配置失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 标记为已注册
  ipcGuard.markModuleRegistered('sandbox-ipc');
  logger.info('[Sandbox IPC] All handlers registered successfully');
}

/**
 * 代码安全检查
 * @param {string} code - Python 代码
 * @returns {Object} 检查结果
 */
function checkCodeSecurity(code) {
  // 禁止的操作模式
  const forbiddenPatterns = [
    // 系统命令执行
    { pattern: /os\.system\s*\(/, reason: '禁止执行系统命令 (os.system)' },
    { pattern: /subprocess\.(call|run|Popen)/, reason: '禁止使用 subprocess' },
    { pattern: /commands\.(getoutput|getstatusoutput)/, reason: '禁止使用 commands 模块' },

    // 文件系统危险操作
    { pattern: /shutil\.rmtree/, reason: '禁止递归删除目录' },
    { pattern: /os\.(remove|unlink|rmdir)/, reason: '禁止删除文件/目录' },

    // 网络操作（虽然网络已禁用，但预防万一）
    { pattern: /socket\.socket/, reason: '禁止创建原始 socket' },

    // 动态代码执行
    { pattern: /exec\s*\(.*__/, reason: '禁止使用 exec 执行动态代码' },
    { pattern: /eval\s*\(.*__/, reason: '禁止使用 eval 执行动态代码' },

    // 敏感模块
    { pattern: /import\s+ctypes/, reason: '禁止导入 ctypes' },
    { pattern: /from\s+ctypes/, reason: '禁止导入 ctypes' },
    { pattern: /import\s+pty/, reason: '禁止导入 pty' },

    // 环境变量访问
    { pattern: /os\.environ/, reason: '禁止访问环境变量' },
  ];

  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(code)) {
      return { safe: false, reason };
    }
  }

  return { safe: true };
}

/**
 * 验证配置
 * @param {Object} config - 配置对象
 * @returns {Object} 验证后的配置
 */
function validateConfig(config) {
  const validated = {};

  // 超时时间限制 (5s - 5min)
  if (config.timeout !== undefined) {
    const timeout = parseInt(config.timeout);
    if (timeout >= 5000 && timeout <= 300000) {
      validated.timeout = timeout;
    }
  }

  // 内存限制 (128m - 2g)
  if (config.memoryLimit !== undefined) {
    const match = config.memoryLimit.match(/^(\d+)(m|g)$/i);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      const mb = unit === 'g' ? value * 1024 : value;
      if (mb >= 128 && mb <= 2048) {
        validated.memoryLimit = config.memoryLimit;
      }
    }
  }

  // CPU 限制 (0.1 - 4)
  if (config.cpuLimit !== undefined) {
    const cpuLimit = parseFloat(config.cpuLimit);
    if (cpuLimit >= 0.1 && cpuLimit <= 4) {
      validated.cpuLimit = String(cpuLimit);
    }
  }

  return validated;
}

module.exports = {
  registerSandboxIPC,
  checkCodeSecurity,
  validateConfig,
};
