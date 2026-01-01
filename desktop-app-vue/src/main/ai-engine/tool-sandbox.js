/**
 * 工具执行沙箱 (Tool Sandbox)
 * 为工具调用提供安全执行环境
 *
 * 核心功能:
 * 1. 超时保护 (Timeout Protection)
 * 2. 自动重试 (Auto Retry with Exponential Backoff)
 * 3. 结果校验 (Result Validation)
 * 4. 快照回滚 (Snapshot & Rollback)
 * 5. 错误日志记录
 */

const fs = require('fs').promises;
const path = require('path');

class ToolSandbox {
  constructor(functionCaller, database = null) {
    this.functionCaller = functionCaller;
    this.database = database;

    // 默认配置
    this.defaultConfig = {
      timeout: 30000,        // 30秒超时
      retries: 2,            // 重试2次
      retryDelay: 1000,      // 重试延迟1秒
      enableValidation: true, // 启用结果校验
      enableSnapshot: true    // 启用快照回滚
    };

    // 工具特定的校验规则
    this.validators = {
      'html_generator': (result) => {
        return result && result.html && result.html.includes('<!DOCTYPE');
      },
      'css_generator': (result) => {
        return result && result.css && result.css.length > 0;
      },
      'js_generator': (result) => {
        return result && result.js && result.js.length > 0;
      },
      'file_writer': (result) => {
        return result && result.success && result.filePath;
      },
      'file_reader': (result) => {
        return result && result.success && result.content !== undefined;
      },
      'word_generator': (result) => {
        return result && result.filePath && result.filePath.endsWith('.docx');
      },
      'excel_generator': (result) => {
        return result && result.filePath && result.filePath.endsWith('.xlsx');
      },
      'pdf_generator': (result) => {
        return result && result.filePath && result.filePath.endsWith('.pdf');
      }
    };

    // 可重试的错误类型
    this.retryableErrors = [
      'ECONNREFUSED',   // 连接被拒绝
      'ETIMEDOUT',      // 超时
      'ENOTFOUND',      // 未找到
      'ECONNRESET',     // 连接重置
      'EPIPE',          // 管道破裂
      'EAI_AGAIN',      // DNS查询失败
      'EBUSY'           // 资源忙
    ];
  }

  /**
   * 安全执行工具
   * @param {string} toolName - 工具名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 执行结果
   */
  async executeSafely(toolName, params = {}, context = {}, options = {}) {
    const config = { ...this.defaultConfig, ...options };
    const startTime = Date.now();

    console.log(`[ToolSandbox] 开始执行工具: ${toolName}`);
    console.log(`[ToolSandbox] 配置:`, config);

    // 创建快照（如果启用）
    let snapshot = null;
    if (config.enableSnapshot) {
      snapshot = await this.createSnapshot(toolName, params, context);
    }

    try {
      // 限制超时执行
      const result = await Promise.race([
        this.executeWithRetries(toolName, params, context, config),
        this.timeoutPromise(config.timeout, toolName)
      ]);

      // 校验结果（如果启用）
      if (config.enableValidation) {
        const validation = await this.validateResult(result, toolName);

        if (!validation.valid) {
          throw new Error(`结果校验失败: ${validation.reason}`);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[ToolSandbox] ✅ 工具执行成功: ${toolName}, 耗时: ${duration}ms`);

      // 记录成功日志
      await this.logExecution(toolName, params, true, duration, null);

      return {
        success: true,
        result,
        duration,
        toolName,
        retried: false
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[ToolSandbox] ❌ 工具执行失败: ${toolName}`, error.message);

      // 回滚到快照（如果启用且有快照）
      if (snapshot && config.enableSnapshot) {
        await this.rollback(snapshot);
      }

      // 记录错误日志
      await this.logExecution(toolName, params, false, duration, error);

      // 重新抛出错误
      throw new Error(`[${toolName}] 执行失败: ${error.message}`);
    }
  }

  /**
   * 带重试的执行
   * @private
   */
  async executeWithRetries(toolName, params, context, config) {
    let lastError = null;

    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = config.retryDelay * Math.pow(2, attempt - 1); // 指数退避
          console.log(`[ToolSandbox] 🔄 重试 ${attempt}/${config.retries}: ${toolName}, 延迟: ${delay}ms`);
          await this.sleep(delay);
        }

        // 调用工具
        const result = await this.functionCaller.call(toolName, params, context);

        if (attempt > 0) {
          console.log(`[ToolSandbox] ✅ 重试成功: ${toolName}`);
        }

        return result;

      } catch (error) {
        lastError = error;

        // 检查是否为可重试错误
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === config.retries) {
          // 不可重试或已达最大重试次数
          throw error;
        }

        console.log(`[ToolSandbox] ⚠️ 尝试 ${attempt + 1} 失败: ${error.message}, ${isRetryable ? '将重试' : '不可重试'}`);
      }
    }

    throw lastError;
  }

  /**
   * 判断错误是否可重试
   * @private
   */
  isRetryableError(error) {
    const errorMessage = error.message || '';
    const errorCode = error.code || '';

    // 检查错误码
    if (this.retryableErrors.includes(errorCode)) {
      return true;
    }

    // 检查错误消息
    const retryableMessages = [
      '超时',
      'timeout',
      '连接失败',
      'connection',
      '网络错误',
      'network',
      '暂时不可用',
      'temporarily unavailable',
      '资源忙',
      'EBUSY'
    ];

    for (const msg of retryableMessages) {
      if (errorMessage.toLowerCase().includes(msg.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * 创建超时Promise
   * @private
   */
  timeoutPromise(ms, toolName) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`工具执行超时 (${ms}ms): ${toolName}`));
      }, ms);
    });
  }

  /**
   * 校验结果
   * @private
   */
  async validateResult(result, toolName) {
    // 1. 基本校验：result不能为null/undefined
    if (result === null || result === undefined) {
      return { valid: false, reason: '结果为空' };
    }

    // 2. 如果result有success字段，检查它
    if (result.hasOwnProperty('success') && result.success === false) {
      return { valid: false, reason: 'result.success为false' };
    }

    // 3. 工具特定的校验规则
    const validator = this.validators[toolName];

    if (validator) {
      try {
        const isValid = validator(result);

        if (!isValid) {
          return { valid: false, reason: '未通过工具特定校验规则' };
        }
      } catch (error) {
        return { valid: false, reason: `校验函数执行失败: ${error.message}` };
      }
    }

    // 4. 通过所有校验
    return { valid: true, reason: '' };
  }

  /**
   * 创建快照
   * @private
   */
  async createSnapshot(toolName, params, context) {
    try {
      // 如果工具涉及文件操作，备份文件
      if (this.isFileOperationTool(toolName)) {
        const filePath = params.filePath || context.currentFile?.file_path;

        if (filePath) {
          // 解析绝对路径
          const resolvedPath = this.resolveFilePath(filePath, context);

          // 检查文件是否存在
          try {
            await fs.access(resolvedPath);

            // 文件存在，创建备份
            const backupPath = `${resolvedPath}.backup_${Date.now()}`;
            await fs.copyFile(resolvedPath, backupPath);

            console.log(`[ToolSandbox] 📸 创建快照: ${resolvedPath} -> ${backupPath}`);

            return {
              type: 'file',
              originalPath: resolvedPath,
              backupPath: backupPath,
              toolName: toolName
            };
          } catch (error) {
            // 文件不存在，不需要备份（可能是创建新文件）
            return {
              type: 'new_file',
              originalPath: resolvedPath,
              toolName: toolName
            };
          }
        }
      }

      return { type: 'none' };
    } catch (error) {
      console.error(`[ToolSandbox] 创建快照失败:`, error);
      return { type: 'none' };
    }
  }

  /**
   * 回滚快照
   * @private
   */
  async rollback(snapshot) {
    try {
      if (snapshot.type === 'file') {
        // 恢复文件备份
        await fs.copyFile(snapshot.backupPath, snapshot.originalPath);
        await fs.unlink(snapshot.backupPath); // 删除备份文件

        console.log(`[ToolSandbox] ⏪ 回滚成功: ${snapshot.originalPath}`);

      } else if (snapshot.type === 'new_file') {
        // 删除新创建的文件
        try {
          await fs.unlink(snapshot.originalPath);
          console.log(`[ToolSandbox] ⏪ 删除新文件: ${snapshot.originalPath}`);
        } catch (error) {
          // 文件可能不存在，忽略
        }
      }
    } catch (error) {
      console.error(`[ToolSandbox] ⚠️ 回滚失败:`, error);
    }
  }

  /**
   * 判断是否为文件操作工具
   * @private
   */
  isFileOperationTool(toolName) {
    const fileTools = [
      'file_writer',
      'file_editor',
      'html_generator',
      'css_generator',
      'js_generator',
      'word_generator',
      'excel_generator',
      'pdf_generator',
      'markdown_generator'
    ];

    return fileTools.includes(toolName);
  }

  /**
   * 解析文件路径
   * @private
   */
  resolveFilePath(filePath, context) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    if (context.projectPath) {
      return path.join(context.projectPath, filePath);
    }

    return path.resolve(filePath);
  }

  /**
   * 记录执行日志
   * @private
   */
  async logExecution(toolName, params, success, duration, error) {
    if (!this.database) return;

    try {
      const errorType = error ? this.classifyError(error) : null;
      const errorMessage = error ? error.message : null;

      await this.database.run(`
        INSERT INTO tool_execution_logs (
          tool_name, params, success, duration, error_type, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        toolName,
        JSON.stringify(params),
        success ? 1 : 0,
        duration,
        errorType,
        errorMessage,
        Date.now()
      ]);
    } catch (err) {
      console.error('[ToolSandbox] 记录日志失败:', err);
    }
  }

  /**
   * 错误分类
   * @private
   */
  classifyError(error) {
    const errorMessage = (error.message || '').toLowerCase();
    const errorCode = error.code || '';

    if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
      return 'timeout';
    }

    if (this.retryableErrors.includes(errorCode)) {
      return 'network';
    }

    if (errorMessage.includes('enoent') || errorMessage.includes('找不到')) {
      return 'file_not_found';
    }

    if (errorMessage.includes('eacces') || errorMessage.includes('权限')) {
      return 'permission';
    }

    if (errorMessage.includes('校验失败')) {
      return 'validation';
    }

    if (errorMessage.includes('invalid') || errorMessage.includes('无效')) {
      return 'invalid_params';
    }

    return 'unknown';
  }

  /**
   * 注册自定义校验器
   * @param {string} toolName - 工具名称
   * @param {Function} validator - 校验函数 (result) => boolean
   */
  registerValidator(toolName, validator) {
    this.validators[toolName] = validator;
    console.log(`[ToolSandbox] 注册校验器: ${toolName}`);
  }

  /**
   * 获取执行统计
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Object>} 统计数据
   */
  async getExecutionStats(timeRange = 24 * 60 * 60 * 1000) {
    if (!this.database) return null;

    try {
      const since = Date.now() - timeRange;

      const rows = await this.database.all(`
        SELECT
          tool_name,
          COUNT(*) as total_count,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
          AVG(CASE WHEN success = 1 THEN duration ELSE NULL END) as avg_duration,
          error_type
        FROM tool_execution_logs
        WHERE created_at > ?
        GROUP BY tool_name
        ORDER BY total_count DESC
      `, [since]);

      return {
        timeRange,
        tools: rows.map(row => ({
          toolName: row.tool_name,
          totalCalls: row.total_count,
          successRate: (row.success_count / row.total_count * 100).toFixed(1) + '%',
          avgDuration: Math.round(row.avg_duration) + 'ms',
          failureCount: row.total_count - row.success_count
        }))
      };
    } catch (error) {
      console.error('[ToolSandbox] 获取统计失败:', error);
      return null;
    }
  }

  /**
   * 睡眠函数
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ToolSandbox;
