/**
 * 错误监控和自动修复系统
 * 监控应用运行时错误并尝试自动修复常见问题
 *
 * v2.0 增强版：集成 LLM 智能诊断
 * - 使用本地 Ollama 模型分析错误
 * - 提供修复建议和最佳实践
 * - 查找相关历史问题
 *
 * @version 2.0.0
 * @since 2026-01-16
 */

const { logger } = require("../utils/logger.js");
const SqlSecurity = require("../database/sql-security.js");
const fs = require("fs").promises;
const path = require("path");
const { app } = require("electron");
const { EventEmitter } = require("events");

class ErrorMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.errors = [];
    this.maxErrors = 1000;
    this.logPath = path.join(app.getPath("userData"), "error-logs");

    // 🔥 新增：LLM 智能诊断支持
    this.llmManager = options.llmManager || null;
    this.database = options.database || null;
    this.enableAIDiagnosis = options.enableAIDiagnosis !== false;

    this.setupGlobalErrorHandlers();
    this.fixStrategies = this.initFixStrategies();
    this.errorPatterns = this.initErrorPatterns();

    logger.info("[ErrorMonitor] 初始化完成", {
      AI诊断: this.enableAIDiagnosis && this.llmManager ? "已启用" : "未启用",
      历史查询: this.database ? "已启用" : "未启用",
    });
  }

  /**
   * 获取数据库连接实例
   * 统一处理不同数据库适配器的差异
   * @returns {Object|null} 数据库连接对象
   * @private
   */
  _getDbConnection() {
    if (!this.database) {
      return null;
    }
    // 支持 DatabaseManager (有 .db 属性) 或直接的数据库实例
    return this.database.db || this.database;
  }

  /**
   * 准备 SQL 语句
   * @param {string} sql - SQL 语句
   * @returns {Object} 准备好的语句对象
   * @private
   */
  _prepareStatement(sql) {
    const db = this._getDbConnection();
    if (!db) {
      throw new Error("数据库未初始化");
    }
    return db.prepare(sql);
  }

  /**
   * 设置全局错误处理器
   */
  setupGlobalErrorHandlers() {
    // 捕获未处理的异常
    process.on("uncaughtException", (error) => {
      // 忽略 EPIPE 错误（管道已关闭，通常发生在应用关闭时）
      if (error.code === "EPIPE") {
        logger.info("[ErrorMonitor] Ignoring EPIPE error (broken pipe)");
        return;
      }

      logger.error("Uncaught Exception:", error);
      this.captureError("UNCAUGHT_EXCEPTION", error);
    });

    // 捕获未处理的Promise拒绝
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      this.captureError("UNHANDLED_REJECTION", reason);
    });

    // 捕获警告
    process.on("warning", (warning) => {
      logger.warn("Warning:", warning);
      this.captureError("WARNING", warning);
    });
  }

  /**
   * 初始化错误模式识别
   */
  initErrorPatterns() {
    return {
      // 数据库相关
      DATABASE_LOCKED: /SQLITE_BUSY|database is locked/i,
      DATABASE_CORRUPT:
        /database disk image is malformed|file is not a database/i,
      DATABASE_READONLY: /attempt to write a readonly database/i,

      // 网络相关
      CONNECTION_REFUSED: /ECONNREFUSED|connect ECONNREFUSED/i,
      CONNECTION_RESET: /ECONNRESET|connection reset/i,
      TIMEOUT: /ETIMEDOUT|timeout|request timed out/i,
      DNS_ERROR: /ENOTFOUND|getaddrinfo|DNS lookup failed/i,
      NETWORK_ERROR: /network error|socket hang up|ENETUNREACH/i,
      SSL_ERROR: /CERT_|SSL_|certificate|UNABLE_TO_VERIFY_LEAF/i,

      // 文件系统相关
      PERMISSION_DENIED: /EACCES|EPERM|permission denied/i,
      FILE_NOT_FOUND: /ENOENT|no such file|does not exist/i,
      DISK_FULL: /ENOSPC|no space left|disk full/i,
      FILE_LOCKED: /EBUSY|resource busy|locked/i,
      PATH_TOO_LONG: /ENAMETOOLONG|path too long/i,

      // 端口和进程相关
      PORT_IN_USE: /EADDRINUSE|address already in use/i,
      PROCESS_KILLED: /SIGKILL|SIGTERM|process terminated/i,

      // 内存相关
      MEMORY_LEAK: /heap out of memory|allocation failed|JavaScript heap/i,
      STACK_OVERFLOW: /Maximum call stack size exceeded|stack overflow/i,

      // JSON 和数据格式
      INVALID_JSON: /unexpected token|invalid json|JSON\.parse|SyntaxError/i,
      INVALID_INPUT: /invalid|malformed|corrupt|unexpected/i,

      // API 和服务相关
      RATE_LIMIT: /rate limit|too many requests|429/i,
      AUTH_ERROR: /unauthorized|forbidden|401|403|authentication/i,
      SERVER_ERROR: /500|502|503|504|internal server error/i,

      // Electron 相关
      GPU_ERROR: /GPU process|OpenGL|WebGL|graphics/i,
      IPC_ERROR: /ipc|channel|renderer process/i,
      WINDOW_ERROR: /BrowserWindow|window is destroyed/i,

      // LLM 相关
      LLM_CONTEXT_LENGTH: /context length|token limit|maximum.*tokens/i,
      LLM_MODEL_ERROR: /model not found|model loading|GGML/i,
      LLM_API_ERROR: /ollama|openai|anthropic|API error/i,
    };
  }

  /**
   * 初始化自动修复策略
   */
  initFixStrategies() {
    return {
      SQLITE_BUSY: async (error, context = {}) => {
        logger.info("[Auto-Fix] Attempting to fix database lock...");

        // 1. 尝试设置 WAL 模式和增加超时（如果有数据库实例）
        if (context.database || this.database) {
          const db = context.database || this.database;
          try {
            await this.optimizeSQLiteForConcurrency(db);
          } catch (walError) {
            logger.warn(
              "[Auto-Fix] Could not optimize SQLite settings:",
              walError.message,
            );
          }
        }

        // 2. 指数退避重试策略
        return await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 5,
            baseDelay: 100,
            maxDelay: 5000,
            factor: 2,
          },
          "SQLITE_BUSY",
        );
      },

      DATABASE_LOCKED: async (error, context = {}) => {
        logger.info("[Auto-Fix] Attempting to fix database lock (generic)...");

        // 1. 检查并释放可能的数据库锁
        if (context.database || this.database) {
          const db = context.database || this.database;
          try {
            await this.releaseDatabaseLock(db);
          } catch (releaseError) {
            logger.warn(
              "[Auto-Fix] Could not release database lock:",
              releaseError.message,
            );
          }
        }

        // 2. 指数退避重试
        return await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 5,
            baseDelay: 100,
            maxDelay: 5000,
            factor: 2,
          },
          "DATABASE_LOCKED",
        );
      },

      ECONNREFUSED: async (error, context = {}) => {
        logger.info("[Auto-Fix] Attempting to reconnect to service...");
        const service = this.identifyService(error);

        // 1. 使用新的智能重连方法（包含健康检查和自动重启）
        if (service !== "unknown") {
          const reconnectResult =
            await this.attemptServiceReconnection(service);
          if (reconnectResult.success) {
            // 服务恢复后，如果有重试函数则执行
            if (context.retryFn) {
              try {
                const result = await context.retryFn();
                return {
                  success: true,
                  message: `${service} reconnected and operation succeeded`,
                  serviceRecovery: reconnectResult,
                  result,
                };
              } catch (retryError) {
                return {
                  success: false,
                  message: `${service} reconnected but operation failed: ${retryError.message}`,
                  serviceRecovery: reconnectResult,
                };
              }
            }
            return reconnectResult;
          }
        }

        // 2. 未知服务或智能重连失败，使用传统重试
        const retryResult = await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            factor: 2,
          },
          "ECONNREFUSED",
        );

        if (retryResult.success) {
          return retryResult;
        }

        // 3. 最后尝试：直接启动服务容器
        if (service !== "unknown") {
          const startResult = await this.restartService(service);
          return {
            ...startResult,
            retryAttempted: true,
            port: this.extractPort(error),
          };
        }

        return {
          success: false,
          message: `Could not identify or restart service (port: ${this.extractPort(error) || "unknown"})`,
          suggestion: "Check if the service is installed and Docker is running",
        };
      },

      CONNECTION_REFUSED: async (error, context = {}) => {
        // 别名，调用 ECONNREFUSED 策略
        return await this.fixStrategies.ECONNREFUSED(error, context);
      },

      ETIMEDOUT: async (error, context = {}) => {
        logger.info("[Auto-Fix] Retrying operation after timeout...");
        // 使用更长的超时时间重试
        return await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 3,
            baseDelay: 2000,
            maxDelay: 30000,
            factor: 2,
            timeoutMultiplier: 2, // 每次重试超时时间翻倍
          },
          "ETIMEDOUT",
        );
      },

      TIMEOUT: async (error, context = {}) => {
        // 别名，调用 ETIMEDOUT 策略
        return await this.fixStrategies.ETIMEDOUT(error, context);
      },

      EACCES: async (error) => {
        logger.info("[Auto-Fix] Attempting to fix permission issue...");
        const filePath = this.extractFilePath(error);
        if (filePath) {
          return await this.fixFilePermissions(filePath);
        }
        return { success: false, message: "Could not extract file path" };
      },

      EPERM: async (error) => {
        // 别名，调用 EACCES 策略
        return await this.fixStrategies.EACCES(error);
      },

      ENOENT: async (error) => {
        logger.info("[Auto-Fix] Creating missing file/directory...");
        const filePath = this.extractFilePath(error);
        if (filePath) {
          return await this.createMissingPath(filePath);
        }
        return { success: false, message: "Could not extract file path" };
      },

      FILE_NOT_FOUND: async (error) => {
        // 别名，调用 ENOENT 策略
        return await this.fixStrategies.ENOENT(error);
      },

      EADDRINUSE: async (error) => {
        logger.info("[Auto-Fix] Attempting to free up port...");
        const port = this.extractPort(error);
        if (port) {
          return await this.killProcessOnPort(port);
        }
        return { success: false, message: "Could not extract port number" };
      },

      PORT_IN_USE: async (error) => {
        // 别名，调用 EADDRINUSE 策略
        return await this.fixStrategies.EADDRINUSE(error);
      },

      MEMORY_LEAK: async (error) => {
        logger.info("[Auto-Fix] Clearing caches to free memory...");
        return await this.clearCaches();
      },

      NETWORK_ERROR: async (error, context = {}) => {
        logger.info("[Auto-Fix] Attempting to recover from network error...");
        // 网络错误：等待后重试
        return await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 15000,
            factor: 2,
          },
          "NETWORK_ERROR",
        );
      },

      INVALID_JSON: async (error, context = {}) => {
        logger.info("[Auto-Fix] Handling invalid JSON response...");
        // JSON 解析错误：可能是截断响应，重试
        return await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 2,
            baseDelay: 500,
            maxDelay: 2000,
            factor: 2,
          },
          "INVALID_JSON",
        );
      },
    };
  }

  /**
   * 指数退避重试策略
   * @param {Function} retryFn - 要重试的函数
   * @param {Object} options - 重试选项
   * @param {string} errorType - 错误类型（用于日志）
   * @returns {Promise<Object>} 重试结果
   */
  async retryWithExponentialBackoff(retryFn, options = {}, errorType = "") {
    const {
      maxRetries = 3,
      baseDelay = 100,
      maxDelay = 10000,
      factor = 2,
      timeoutMultiplier = 1,
    } = options;

    if (!retryFn || typeof retryFn !== "function") {
      // 如果没有提供重试函数，只执行延迟等待
      const delay = Math.min(baseDelay * factor, maxDelay);
      await this.sleep(delay);
      return {
        success: true,
        message: `Waited ${delay}ms for ${errorType} recovery (no retry function provided)`,
        retries: 0,
        finalDelay: delay,
      };
    }

    let lastError = null;
    let currentDelay = baseDelay;
    let currentTimeout = options.initialTimeout || 30000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `[Auto-Fix] ${errorType} retry attempt ${attempt}/${maxRetries}, delay: ${currentDelay}ms`,
        );

        // 等待延迟
        await this.sleep(currentDelay);

        // 执行重试函数
        const result = await Promise.race([
          retryFn({ timeout: currentTimeout }),
          this.sleep(currentTimeout).then(() => {
            throw new Error("Retry timeout");
          }),
        ]);

        return {
          success: true,
          message: `${errorType} resolved after ${attempt} ${attempt === 1 ? "retry" : "retries"}`,
          retries: attempt,
          result,
        };
      } catch (error) {
        lastError = error;
        logger.info(
          `[Auto-Fix] ${errorType} retry ${attempt} failed:`,
          error.message,
        );

        // 计算下一次延迟
        currentDelay = Math.min(currentDelay * factor, maxDelay);
        currentTimeout = currentTimeout * timeoutMultiplier;
      }
    }

    return {
      success: false,
      message: `${errorType} could not be resolved after ${maxRetries} retries: ${lastError?.message}`,
      retries: maxRetries,
      lastError: lastError?.message,
    };
  }

  /**
   * 捕获错误
   */
  async captureError(type, error) {
    const errorReport = {
      type,
      message: error?.message || String(error),
      stack: error?.stack || "",
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memory: process.memoryUsage(),
      platform: process.platform,
    };

    // 添加到内存缓存
    this.errors.push(errorReport);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // 保存到日志文件
    await this.saveErrorLog(errorReport);

    // 尝试自动修复
    const fixResult = await this.analyzeAndFix(errorReport);

    if (fixResult.attempted) {
      errorReport.autoFixResult = fixResult;
      logger.info("[Error Monitor] Auto-fix result:", fixResult);
    }

    return errorReport;
  }

  /**
   * 分析错误并尝试修复
   */
  async analyzeAndFix(errorReport) {
    const errorMessage = errorReport.message + " " + errorReport.stack;

    // 识别错误类型
    for (const [errorType, pattern] of Object.entries(this.errorPatterns)) {
      if (pattern.test(errorMessage)) {
        logger.info(`[Error Monitor] Detected error type: ${errorType}`);

        // 执行对应的修复策略
        const fixStrategy = this.fixStrategies[errorType];
        if (fixStrategy) {
          try {
            const result = await fixStrategy(errorReport);
            return {
              attempted: true,
              errorType,
              success: result.success,
              message: result.message,
            };
          } catch (fixError) {
            logger.error(`[Error Monitor] Fix strategy failed:`, fixError);
            return {
              attempted: true,
              errorType,
              success: false,
              message: `Fix strategy failed: ${fixError.message}`,
            };
          }
        }
      }
    }

    return {
      attempted: false,
      message: "No fix strategy found for this error type",
    };
  }

  /**
   * 识别服务
   */
  identifyService(error) {
    const message = error.message || "";
    if (message.includes("11434")) {
      return "ollama";
    }
    if (message.includes("6333")) {
      return "qdrant";
    }
    if (message.includes("5432")) {
      return "postgres";
    }
    if (message.includes("6379")) {
      return "redis";
    }
    return "unknown";
  }

  /**
   * 重启Ollama服务
   */
  async restartOllamaService() {
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      // 尝试启动Docker容器
      await execPromise("docker start chainlesschain-ollama");
      await this.sleep(5000); // 等待服务启动

      return { success: true, message: "Ollama service restarted" };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart Ollama: ${error.message}`,
      };
    }
  }

  /**
   * 重启Qdrant服务
   */
  async restartQdrantService() {
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      await execPromise("docker start chainlesschain-qdrant");
      await this.sleep(5000);

      return { success: true, message: "Qdrant service restarted" };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart Qdrant: ${error.message}`,
      };
    }
  }

  /**
   * 修复文件权限
   */
  async fixFilePermissions(filePath) {
    try {
      await fs.chmod(filePath, 0o644);
      return { success: true, message: `Fixed permissions for ${filePath}` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to fix permissions: ${error.message}`,
      };
    }
  }

  /**
   * 创建缺失的路径
   */
  async createMissingPath(filePath) {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      return { success: true, message: `Created directory: ${dir}` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create directory: ${error.message}`,
      };
    }
  }

  /**
   * 杀掉占用端口的进程
   */
  async killProcessOnPort(port) {
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      if (process.platform === "win32") {
        // Windows: 使用 netstat 找到 PID，然后 taskkill
        try {
          const { stdout } = await execPromise(
            `netstat -ano | findstr :${port} | findstr LISTENING`,
          );
          const lines = stdout.trim().split("\n");
          const pids = new Set();

          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== "0" && /^\d+$/.test(pid)) {
              pids.add(pid);
            }
          }

          if (pids.size === 0) {
            return {
              success: true,
              message: `Port ${port} is not in use`,
            };
          }

          // 杀掉所有占用端口的进程
          for (const pid of pids) {
            try {
              await execPromise(`taskkill /PID ${pid} /F`);
              logger.info(`[Auto-Fix] Killed process ${pid} on port ${port}`);
            } catch (killError) {
              logger.warn(
                `[Auto-Fix] Could not kill process ${pid}:`,
                killError.message,
              );
            }
          }

          // 等待端口释放
          await this.sleep(1000);

          return {
            success: true,
            message: `Freed port ${port} (killed ${pids.size} process(es))`,
          };
        } catch (netstatError) {
          // netstat 没找到进程，端口可能已经空闲
          return {
            success: true,
            message: `Port ${port} appears to be free`,
          };
        }
      } else {
        // Unix/macOS
        try {
          const { stdout } = await execPromise(`lsof -ti:${port}`);
          const pids = stdout.trim().split("\n").filter(Boolean);

          if (pids.length === 0) {
            return {
              success: true,
              message: `Port ${port} is not in use`,
            };
          }

          for (const pid of pids) {
            try {
              await execPromise(`kill -9 ${pid}`);
              logger.info(`[Auto-Fix] Killed process ${pid} on port ${port}`);
            } catch (killError) {
              logger.warn(
                `[Auto-Fix] Could not kill process ${pid}:`,
                killError.message,
              );
            }
          }

          await this.sleep(1000);

          return {
            success: true,
            message: `Freed port ${port} (killed ${pids.length} process(es))`,
          };
        } catch (lsofError) {
          return {
            success: true,
            message: `Port ${port} appears to be free`,
          };
        }
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to free port: ${error.message}`,
      };
    }
  }

  /**
   * 清理缓存
   */
  async clearCaches() {
    try {
      const clearedItems = [];

      // 1. 触发垃圾回收
      if (global.gc) {
        global.gc();
        clearedItems.push("GC");
      }

      // 2. 清理应用级缓存（如果存在）
      try {
        // 清理 QueryCache
        if (global.queryCache) {
          global.queryCache.clear();
          clearedItems.push("QueryCache");
        }

        // 清理 SessionManager 缓存
        if (global.sessionManager?.sessionCache) {
          global.sessionManager.sessionCache.clear();
          clearedItems.push("SessionCache");
        }

        // 清理 Embeddings 缓存
        if (global.embeddingsCache) {
          global.embeddingsCache.clear();
          clearedItems.push("EmbeddingsCache");
        }
      } catch (cacheError) {
        logger.warn(
          "[Auto-Fix] Could not clear app caches:",
          cacheError.message,
        );
      }

      // 3. 清理 .chainlesschain/cache 目录中的临时文件
      try {
        const cacheDir = path.join(
          app.getPath("userData"),
          "..",
          ".chainlesschain",
          "cache",
        );

        if (fs.existsSync && (await fs.stat(cacheDir).catch(() => null))) {
          const cacheSubdirs = ["query-results", "model-outputs"];
          for (const subdir of cacheSubdirs) {
            const subdirPath = path.join(cacheDir, subdir);
            try {
              const files = await fs.readdir(subdirPath);
              // 删除超过 1 小时的缓存文件
              const oneHourAgo = Date.now() - 60 * 60 * 1000;
              for (const file of files) {
                const filePath = path.join(subdirPath, file);
                const stat = await fs.stat(filePath);
                if (stat.mtimeMs < oneHourAgo) {
                  await fs.unlink(filePath);
                }
              }
              clearedItems.push(subdir);
            } catch (subdirError) {
              // 子目录可能不存在，忽略
            }
          }
        }
      } catch (fsCacheError) {
        logger.warn(
          "[Auto-Fix] Could not clear file caches:",
          fsCacheError.message,
        );
      }

      // 4. 记录内存使用情况
      const memoryAfter = process.memoryUsage();
      const heapUsedMB = Math.round(memoryAfter.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memoryAfter.heapTotal / 1024 / 1024);

      return {
        success: true,
        message: `Caches cleared (${clearedItems.join(", ") || "GC only"}), memory: ${heapUsedMB}MB / ${heapTotalMB}MB`,
        clearedItems,
        memoryAfter: {
          heapUsed: heapUsedMB,
          heapTotal: heapTotalMB,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to clear caches: ${error.message}`,
      };
    }
  }

  /**
   * 重启 PostgreSQL 服务
   */
  async restartPostgresService() {
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      // 尝试启动 Docker 容器
      await execPromise("docker start chainlesschain-postgres");
      await this.sleep(5000); // 等待服务启动

      // 验证连接
      try {
        await execPromise(
          "docker exec chainlesschain-postgres pg_isready -U chainlesschain",
        );
        return {
          success: true,
          message: "PostgreSQL service restarted and ready",
        };
      } catch (checkError) {
        return {
          success: true,
          message: "PostgreSQL service started (connection not verified)",
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart PostgreSQL: ${error.message}`,
      };
    }
  }

  /**
   * 重启 Redis 服务
   */
  async restartRedisService() {
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      // 尝试启动 Docker 容器
      await execPromise("docker start chainlesschain-redis");
      await this.sleep(3000); // Redis 启动较快

      // 验证连接
      try {
        await execPromise("docker exec chainlesschain-redis redis-cli ping");
        return { success: true, message: "Redis service restarted and ready" };
      } catch (checkError) {
        return {
          success: true,
          message: "Redis service started (connection not verified)",
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to restart Redis: ${error.message}`,
      };
    }
  }

  /**
   * 从错误中提取文件路径
   */
  extractFilePath(error) {
    const message = error.message || "";
    const match = message.match(/['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  }

  /**
   * 从错误中提取端口号
   */
  extractPort(error) {
    const message = error.message || "";
    const match = message.match(/:(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * 保存错误日志
   */
  async saveErrorLog(errorReport) {
    try {
      await fs.mkdir(this.logPath, { recursive: true });

      const filename = `error-${new Date().toISOString().split("T")[0]}.log`;
      const logFile = path.join(this.logPath, filename);

      const logEntry = JSON.stringify(errorReport, null, 2) + "\n---\n";
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      logger.error("Failed to save error log:", error);
    }
  }

  /**
   * 获取基础错误统计（内存中）
   */
  getBasicErrorStats() {
    const stats = {
      total: this.errors.length,
      byType: {},
      recentErrors: this.errors.slice(-10),
    };

    this.errors.forEach((error) => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
    });

    return stats;
  }

  /**
   * 清除错误日志
   */
  clearErrors() {
    this.errors = [];
  }

  /**
   * 工具函数: 睡眠
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // 🔧 SQLite 锁修复方法
  // ============================================================

  /**
   * 优化 SQLite 并发性能
   * @param {Object} db - 数据库实例
   * @returns {Promise<Object>} 优化结果
   */
  async optimizeSQLiteForConcurrency(db) {
    const results = {
      walMode: false,
      busyTimeout: false,
      synchronous: false,
    };

    try {
      // 检查是否有 db.db（better-sqlite3 包装）
      const sqliteDb = db.db || db;

      // 1. 设置 WAL 模式（Write-Ahead Logging）- 提高并发性能
      try {
        if (typeof sqliteDb.pragma === "function") {
          const currentMode = sqliteDb.pragma("journal_mode", {
            simple: true,
          });
          if (currentMode !== "wal") {
            sqliteDb.pragma("journal_mode = WAL");
            logger.info("[Auto-Fix] SQLite: Enabled WAL mode");
          }
          results.walMode = true;
        } else if (typeof sqliteDb.exec === "function") {
          sqliteDb.exec("PRAGMA journal_mode = WAL;");
          results.walMode = true;
        }
      } catch (walError) {
        logger.warn("[Auto-Fix] Could not set WAL mode:", walError.message);
      }

      // 2. 设置 busy_timeout（等待锁的最大时间，单位毫秒）
      try {
        if (typeof sqliteDb.pragma === "function") {
          sqliteDb.pragma("busy_timeout = 30000"); // 30 秒
          results.busyTimeout = true;
        } else if (typeof sqliteDb.exec === "function") {
          sqliteDb.exec("PRAGMA busy_timeout = 30000;");
          results.busyTimeout = true;
        }
        logger.info("[Auto-Fix] SQLite: Set busy_timeout to 30s");
      } catch (timeoutError) {
        logger.warn(
          "[Auto-Fix] Could not set busy_timeout:",
          timeoutError.message,
        );
      }

      // 3. 设置 synchronous 为 NORMAL（平衡性能和安全性）
      try {
        if (typeof sqliteDb.pragma === "function") {
          sqliteDb.pragma("synchronous = NORMAL");
          results.synchronous = true;
        } else if (typeof sqliteDb.exec === "function") {
          sqliteDb.exec("PRAGMA synchronous = NORMAL;");
          results.synchronous = true;
        }
      } catch (syncError) {
        // 不是关键错误，忽略
      }

      return {
        success: true,
        message: "SQLite optimized for concurrency",
        details: results,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to optimize SQLite: ${error.message}`,
        details: results,
      };
    }
  }

  /**
   * 尝试释放数据库锁
   * @param {Object} db - 数据库实例
   * @returns {Promise<Object>} 释放结果
   */
  async releaseDatabaseLock(db) {
    try {
      const sqliteDb = db.db || db;

      // 1. 执行 checkpoint 强制 WAL 文件写入主数据库
      try {
        if (typeof sqliteDb.pragma === "function") {
          sqliteDb.pragma("wal_checkpoint(TRUNCATE)");
          logger.info("[Auto-Fix] SQLite: Executed WAL checkpoint");
        } else if (typeof sqliteDb.exec === "function") {
          sqliteDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        }
      } catch (checkpointError) {
        // checkpoint 失败不是致命错误
        logger.warn(
          "[Auto-Fix] WAL checkpoint failed:",
          checkpointError.message,
        );
      }

      // 2. 等待短暂时间让其他事务完成
      await this.sleep(100);

      // 3. 检查锁状态（通过尝试开始一个事务）
      try {
        if (typeof sqliteDb.exec === "function") {
          sqliteDb.exec("BEGIN IMMEDIATE; COMMIT;");
          logger.info("[Auto-Fix] SQLite: Database lock released");
          return {
            success: true,
            message: "Database lock released successfully",
          };
        }
      } catch (lockTestError) {
        // 如果仍然锁定，返回等待建议
        return {
          success: false,
          message: `Database still locked: ${lockTestError.message}`,
          suggestion: "Wait and retry",
        };
      }

      return {
        success: true,
        message: "Lock release attempted",
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to release lock: ${error.message}`,
      };
    }
  }

  // ============================================================
  // 🔧 网络重连修复方法
  // ============================================================

  /**
   * 验证网络服务连接
   * @param {string} service - 服务名称
   * @param {string} host - 主机地址
   * @param {number} port - 端口号
   * @returns {Promise<Object>} 连接验证结果
   */
  async validateServiceConnection(service, host = "localhost", port) {
    const net = require("net");

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000;

      socket.setTimeout(timeout);

      socket.on("connect", () => {
        socket.destroy();
        resolve({
          success: true,
          message: `${service} is reachable at ${host}:${port}`,
          latency: Date.now() - startTime,
        });
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve({
          success: false,
          message: `${service} connection timeout at ${host}:${port}`,
        });
      });

      socket.on("error", (err) => {
        socket.destroy();
        resolve({
          success: false,
          message: `${service} connection error: ${err.message}`,
          error: err.code,
        });
      });

      const startTime = Date.now();
      socket.connect(port, host);
    });
  }

  /**
   * 尝试健康检查并重连服务
   * @param {string} service - 服务名称
   * @param {Object} options - 重连选项
   * @returns {Promise<Object>} 重连结果
   */
  async attemptServiceReconnection(service, options = {}) {
    const serviceConfig = {
      ollama: { port: 11434, healthPath: "/api/tags" },
      qdrant: { port: 6333, healthPath: "/readyz" },
      postgres: { port: 5432, healthPath: null },
      redis: { port: 6379, healthPath: null },
    };

    const config = serviceConfig[service];
    if (!config) {
      return { success: false, message: `Unknown service: ${service}` };
    }

    // 1. 首先检查端口是否可达
    logger.info(
      `[Auto-Fix] Checking ${service} connectivity on port ${config.port}...`,
    );
    const portCheck = await this.validateServiceConnection(
      service,
      "localhost",
      config.port,
    );

    if (portCheck.success) {
      // 端口可达，尝试 HTTP 健康检查（如果支持）
      if (config.healthPath) {
        try {
          const http = require("http");
          const healthResult = await new Promise((resolve) => {
            const req = http.get(
              `http://localhost:${config.port}${config.healthPath}`,
              { timeout: 3000 },
              (res) => {
                resolve({
                  success: res.statusCode >= 200 && res.statusCode < 400,
                  statusCode: res.statusCode,
                });
              },
            );
            req.on("error", (err) => {
              resolve({ success: false, error: err.message });
            });
            req.on("timeout", () => {
              req.destroy();
              resolve({ success: false, error: "Health check timeout" });
            });
          });

          if (healthResult.success) {
            return {
              success: true,
              message: `${service} is healthy and responding`,
              port: config.port,
            };
          }
        } catch (healthError) {
          logger.warn(
            `[Auto-Fix] ${service} health check failed:`,
            healthError.message,
          );
        }
      } else {
        // 无健康检查端点，端口可达即认为成功
        return {
          success: true,
          message: `${service} port is reachable`,
          port: config.port,
        };
      }
    }

    // 2. 端口不可达或健康检查失败，尝试重启服务
    logger.info(`[Auto-Fix] ${service} not responding, attempting restart...`);
    const restartResult = await this.restartService(service);

    if (restartResult.success) {
      // 等待服务启动后再次验证
      await this.sleep(3000);
      const recheck = await this.validateServiceConnection(
        service,
        "localhost",
        config.port,
      );
      return {
        success: recheck.success,
        message: recheck.success
          ? `${service} restarted and responding`
          : `${service} restarted but not responding yet`,
        restarted: true,
      };
    }

    return restartResult;
  }

  /**
   * 通用服务重启方法
   * @param {string} service - 服务名称
   * @returns {Promise<Object>} 重启结果
   */
  async restartService(service) {
    const { exec } = require("child_process");
    const util = require("util");
    const execPromise = util.promisify(exec);

    const containerNames = {
      ollama: "chainlesschain-ollama",
      qdrant: "chainlesschain-qdrant",
      postgres: "chainlesschain-postgres",
      redis: "chainlesschain-redis",
    };

    const containerName = containerNames[service];
    if (!containerName) {
      return { success: false, message: `No container mapping for ${service}` };
    }

    try {
      // 尝试启动 Docker 容器
      await execPromise(`docker start ${containerName}`);
      logger.info(`[Auto-Fix] Started Docker container: ${containerName}`);
      return {
        success: true,
        message: `${service} container started`,
        container: containerName,
      };
    } catch (dockerError) {
      // Docker 失败，可能容器不存在或 Docker 未运行
      return {
        success: false,
        message: `Failed to start ${service}: ${dockerError.message}`,
        suggestion: "Check if Docker is running and container exists",
      };
    }
  }

  // ============================================================
  // 🔥 智能诊断功能（v2.0新增）
  // ============================================================

  /**
   * 分析错误并提供详细诊断
   * @param {Error} error - 错误对象
   * @returns {Promise<Object>} 诊断结果
   */
  async analyzeError(error) {
    try {
      const errorInfo = {
        name: error?.name || "Unknown Error",
        message: error?.message || String(error),
        stack: error?.stack || "",
        code: error?.code || null,
        timestamp: Date.now(),
      };

      logger.info(
        "[ErrorMonitor] 开始智能诊断:",
        errorInfo.message.substring(0, 100),
      );

      const analysis = {
        error: errorInfo,
        classification: this.classifyError(error),
        severity: this.assessSeverity(error),
        context: this.gatherContext(error),
        autoFixResult: null,
        aiDiagnosis: null,
        relatedIssues: null,
        recommendations: [],
      };

      // 1. 尝试自动修复
      const errorReport = {
        type: "RUNTIME_ERROR",
        message: errorInfo.message,
        stack: errorInfo.stack,
      };
      analysis.autoFixResult = await this.analyzeAndFix(errorReport);

      // 2. AI 智能诊断（使用本地 Ollama，免费）
      if (this.enableAIDiagnosis && this.llmManager) {
        try {
          analysis.aiDiagnosis = await this.getSuggestedFixes(error);
          logger.info("[ErrorMonitor] AI 诊断完成");
        } catch (aiError) {
          logger.warn("[ErrorMonitor] AI 诊断失败:", aiError.message);
          analysis.aiDiagnosis = {
            error: "AI 诊断服务不可用",
            fallback: true,
          };
        }
      }

      // 3. 查找相关历史问题
      if (this.database) {
        try {
          analysis.relatedIssues = await this.findRelatedIssues(error);
          logger.info(
            "[ErrorMonitor] 找到",
            analysis.relatedIssues.length,
            "个相关历史问题",
          );
        } catch (dbError) {
          logger.warn("[ErrorMonitor] 历史查询失败:", dbError.message);
        }
      }

      // 4. 生成推荐操作
      analysis.recommendations = this.generateRecommendations(analysis);

      // 5. 保存到数据库
      if (this.database) {
        await this.saveErrorAnalysis(analysis);
      }

      // 6. 发出诊断完成事件
      this.emit("diagnosis-complete", analysis);

      return analysis;
    } catch (error) {
      logger.error("[ErrorMonitor] analyzeError 失败:", error);
      return {
        error: {
          message: "诊断过程失败",
          details: error.message,
        },
      };
    }
  }

  /**
   * 使用 LLM 分析错误并提供修复建议
   * @param {Error} error - 错误对象
   * @returns {Promise<Object>} AI 分析结果
   */
  async getSuggestedFixes(error) {
    if (!this.llmManager) {
      return {
        available: false,
        message: "LLM 服务未初始化",
      };
    }

    try {
      // 构建 Prompt
      const prompt = this.buildDiagnosisPrompt(error);

      const { provider, model } = await this._resolveDiagnosisLLMOptions();

      const response = await this.llmManager.chat(
        [
          {
            role: "system",
            content:
              "你是一个专业的 JavaScript/Electron 错误诊断专家。请分析错误并提供实用的修复建议。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        {
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          temperature: 0.1,
          stream: false,
        },
      );

      // 解析 LLM 响应
      const analysis = this.parseLLMResponse(response.content);

      return {
        available: true,
        rawResponse: response.content,
        analysis,
        model: provider && model ? `${provider}/${model}` : model || provider,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error("[ErrorMonitor] getSuggestedFixes 失败:", error);
      return {
        available: false,
        error: error.message,
      };
    }
  }

  /**
   * 解析当前配置，挑选可用的诊断模型，若配置模型不可用则自动回退
   * @returns {Promise<{provider: string|null, model: string|null}>}
   * @private
   */
  async _resolveDiagnosisLLMOptions() {
    const provider =
      this.llmManager.provider || this.llmManager.config?.provider || "ollama";

    let model =
      this.llmManager.config?.model ||
      (provider === "ollama" ? "qwen2:7b" : null);

    if (model) {
      model = await this._pickAvailableModel(model);
    } else if (provider === "ollama") {
      model = await this._pickAvailableModel("qwen2:7b");
    }

    return { provider, model };
  }

  /**
   * 检查模型是否存在，不存在则返回第一个可用模型
   * @param {string} preferred - 期望模型
   * @returns {Promise<string|null>}
   * @private
   */
  async _pickAvailableModel(preferred) {
    try {
      const models = await this.llmManager.listModels();
      if (!models || models.length === 0) {
        return preferred;
      }

      const normalizedPreferred = preferred;
      const hintedModels = models.map((item) => this._extractModelName(item));

      if (normalizedPreferred && hintedModels.includes(normalizedPreferred)) {
        return normalizedPreferred;
      }

      const fallback = hintedModels.find(Boolean);
      if (fallback && normalizedPreferred && fallback !== normalizedPreferred) {
        logger.warn(
          `[ErrorMonitor] 模型 ${normalizedPreferred} 不可用，回退到 ${fallback}`,
        );
      }

      return fallback || normalizedPreferred;
    } catch (error) {
      logger.warn("[ErrorMonitor] 检查诊断模型可用性失败:", error.message);
      return preferred;
    }
  }

  /**
   * 从模型描述中提取名称
   * @param {any} modelInfo - 模型对象或字符串
   * @returns {string|null}
   * @private
   */
  _extractModelName(modelInfo) {
    if (!modelInfo) {
      return null;
    }

    if (typeof modelInfo === "string") {
      return modelInfo;
    }

    if (typeof modelInfo === "object") {
      return modelInfo.name || modelInfo.id || modelInfo.model || null;
    }

    return null;
  }

  /**
   * 构建错误诊断 Prompt
   * @param {Error} error - 错误对象
   * @returns {string} Prompt 文本
   */
  buildDiagnosisPrompt(error) {
    const context = this.gatherContext(error);

    return `请分析以下 JavaScript 错误并提供修复建议：

**错误信息**:
类型: ${error?.name || "Unknown"}
消息: ${error?.message || String(error)}
代码: ${error?.code || "N/A"}

**堆栈跟踪**:
\`\`\`
${error?.stack || "无堆栈信息"}
\`\`\`

**运行环境**:
- 平台: ${context.platform}
- Node 版本: ${context.nodeVersion}
- 内存使用: ${Math.round(context.memory.heapUsed / 1024 / 1024)}MB / ${Math.round(context.memory.heapTotal / 1024 / 1024)}MB
- 运行时长: ${context.uptime}秒

请提供：
1. **错误根本原因**：简要说明为什么会发生这个错误
2. **修复方案**：提供 2-3 种具体的修复方法，包括代码示例
3. **最佳实践**：如何预防此类错误
4. **相关文档**：可能有帮助的文档链接（如果适用）

请用简洁的中文回答，使用 Markdown 格式。`;
  }

  /**
   * 解析 LLM 响应
   * @param {string} response - LLM 原始响应
   * @returns {Object} 解析后的分析结果
   */
  parseLLMResponse(response) {
    try {
      // 尝试提取结构化信息
      const sections = {
        rootCause: this.extractSection(response, [
          "错误根本原因",
          "根本原因",
          "原因",
        ]),
        fixes: this.extractSection(response, [
          "修复方案",
          "解决方法",
          "修复方法",
        ]),
        bestPractices: this.extractSection(response, [
          "最佳实践",
          "预防措施",
          "建议",
        ]),
        documentation: this.extractSection(response, [
          "相关文档",
          "参考文档",
          "文档",
        ]),
      };

      return {
        structured: sections,
        full: response,
      };
    } catch (error) {
      logger.warn("[ErrorMonitor] 解析 LLM 响应失败:", error);
      return {
        structured: null,
        full: response,
      };
    }
  }

  /**
   * 从文本中提取章节内容
   * @param {string} text - 文本
   * @param {Array<string>} headings - 可能的标题列表
   * @returns {string} 提取的内容
   */
  extractSection(text, headings) {
    for (const heading of headings) {
      const patterns = [
        new RegExp(`##?\\s*\\*?\\*?${heading}\\*?\\*?[：:](.*?)(?=##|$)`, "s"),
        new RegExp(
          `\\*?\\*?\\d+\\.?\\s*${heading}\\*?\\*?[：:](.*?)(?=\\*?\\*?\\d+\\.|$)`,
          "s",
        ),
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }
    }

    return "";
  }

  /**
   * 从数据库查找相关历史问题
   * @param {Error} error - 错误对象
   * @returns {Promise<Array>} 相关问题列表
   */
  async findRelatedIssues(error) {
    if (!this.database) {
      return [];
    }

    try {
      const errorMessage = error?.message || String(error);
      const errorType = error?.name || "Unknown";

      // 提取关键词
      const keywords = this.extractKeywords(errorMessage);

      // 查询相似错误（最近 30 天）
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      // 这里假设我们有一个错误日志表
      // 实际实现可能需要根据数据库架构调整
      const relatedErrors = this.errors.filter((e) => {
        const timestamp = new Date(e.timestamp).getTime();
        if (timestamp < thirtyDaysAgo) {
          return false;
        }

        // 检查是否包含相同关键词
        const hasKeyword = keywords.some((kw) =>
          e.message.toLowerCase().includes(kw.toLowerCase()),
        );

        return hasKeyword || e.type === errorType;
      });

      return relatedErrors.slice(0, 5).map((e) => ({
        timestamp: e.timestamp,
        message: e.message,
        type: e.type,
        autoFixResult: e.autoFixResult,
      }));
    } catch (error) {
      logger.error("[ErrorMonitor] findRelatedIssues 失败:", error);
      return [];
    }
  }

  /**
   * 从错误消息中提取关键词
   * @param {string} message - 错误消息
   * @returns {Array<string>} 关键词列表
   */
  extractKeywords(message) {
    // 移除常见词汇
    const stopWords = [
      "error",
      "failed",
      "cannot",
      "unable",
      "the",
      "a",
      "an",
      "at",
      "in",
      "on",
    ];

    // 提取单词
    const words = message.toLowerCase().match(/\w+/g) || [];

    // 过滤停用词，保留长度 > 3 的词
    const keywords = words.filter(
      (w) => w.length > 3 && !stopWords.includes(w),
    );

    // 返回前 5 个关键词
    return [...new Set(keywords)].slice(0, 5);
  }

  /**
   * 分类错误
   * 支持 30+ 种错误类型的智能分类
   * @param {Error} error - 错误对象
   * @returns {string} 错误分类
   */
  classifyError(error) {
    const message = (error?.message || String(error)).toLowerCase();
    const code = error?.code;
    const name = error?.name;

    // ============================================================
    // 数据库错误 (DATABASE)
    // ============================================================
    if (code === "SQLITE_BUSY" || message.includes("database is locked")) {
      return "DATABASE_LOCKED";
    }
    if (
      message.includes("database disk image is malformed") ||
      message.includes("database corrupt")
    ) {
      return "DATABASE_CORRUPT";
    }
    if (
      code === "SQLITE_READONLY" ||
      message.includes("attempt to write a readonly database")
    ) {
      return "DATABASE_READONLY";
    }
    if (message.includes("database") || message.includes("sqlite")) {
      return "DATABASE";
    }

    // ============================================================
    // 网络错误 (NETWORK)
    // ============================================================
    if (code === "ECONNREFUSED" || message.includes("connection refused")) {
      return "CONNECTION_REFUSED";
    }
    if (code === "ECONNRESET" || message.includes("connection reset")) {
      return "CONNECTION_RESET";
    }
    if (
      code === "ETIMEDOUT" ||
      code === "ESOCKETTIMEDOUT" ||
      message.includes("timeout")
    ) {
      return "TIMEOUT";
    }
    if (
      code === "ENOTFOUND" ||
      message.includes("getaddrinfo") ||
      message.includes("dns")
    ) {
      return "DNS_ERROR";
    }
    if (
      message.includes("ssl") ||
      message.includes("certificate") ||
      message.includes("tls")
    ) {
      return "SSL_ERROR";
    }
    if (
      code === "ECONNABORTED" ||
      code === "ENETUNREACH" ||
      message.includes("network")
    ) {
      return "NETWORK_ERROR";
    }

    // ============================================================
    // 文件系统错误 (FILESYSTEM)
    // ============================================================
    if (
      code === "ENOENT" ||
      message.includes("no such file") ||
      message.includes("file not found")
    ) {
      return "FILE_NOT_FOUND";
    }
    if (code === "EPERM" || code === "EACCES") {
      return "PERMISSION_DENIED";
    }
    if (code === "ENOSPC" || message.includes("no space left")) {
      return "DISK_FULL";
    }
    if (code === "EBUSY" || message.includes("file is locked")) {
      return "FILE_LOCKED";
    }
    if (code === "ENAMETOOLONG" || message.includes("path too long")) {
      return "PATH_TOO_LONG";
    }

    // ============================================================
    // 内存错误 (MEMORY)
    // ============================================================
    if (message.includes("heap out of memory") || message.includes("oom")) {
      return "MEMORY_LEAK";
    }
    if (message.includes("maximum call stack")) {
      return "STACK_OVERFLOW";
    }
    if (message.includes("memory") || message.includes("heap")) {
      return "MEMORY";
    }

    // ============================================================
    // API/HTTP 错误
    // ============================================================
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("429")
    ) {
      return "RATE_LIMIT";
    }
    if (
      message.includes("unauthorized") ||
      message.includes("authentication") ||
      message.includes("401") ||
      message.includes("403")
    ) {
      return "AUTH_ERROR";
    }
    if (
      message.includes("internal server error") ||
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503")
    ) {
      return "SERVER_ERROR";
    }

    // ============================================================
    // Electron 特有错误
    // ============================================================
    if (message.includes("gpu") || message.includes("webgl")) {
      return "GPU_ERROR";
    }
    if (message.includes("ipc") || message.includes("electron")) {
      return "IPC_ERROR";
    }
    if (message.includes("browserwindow") || message.includes("renderer")) {
      return "WINDOW_ERROR";
    }

    // ============================================================
    // LLM/AI 错误
    // ============================================================
    if (
      message.includes("context length") ||
      message.includes("token limit") ||
      message.includes("maximum context")
    ) {
      return "LLM_CONTEXT_LENGTH";
    }
    if (message.includes("model not found") || message.includes("model load")) {
      return "LLM_MODEL_ERROR";
    }
    if (message.includes("ollama") || message.includes("llm")) {
      return "LLM_API_ERROR";
    }

    // ============================================================
    // 验证错误 (VALIDATION)
    // ============================================================
    if (
      message.includes("invalid") ||
      message.includes("validation") ||
      message.includes("required")
    ) {
      return "VALIDATION";
    }

    // ============================================================
    // JavaScript 运行时错误
    // ============================================================
    if (name === "TypeError") {
      return "TYPE_ERROR";
    }
    if (name === "ReferenceError") {
      return "REFERENCE_ERROR";
    }
    if (name === "SyntaxError") {
      return "SYNTAX_ERROR";
    }
    if (name === "RangeError") {
      return "RANGE_ERROR";
    }

    return "UNKNOWN";
  }

  /**
   * 评估错误严重程度
   * 四级评估系统：critical > high > medium > low
   * @param {Error} error - 错误对象
   * @returns {string} 严重程度 (low/medium/high/critical)
   */
  assessSeverity(error) {
    const message = (error?.message || String(error)).toLowerCase();
    const code = error?.code;
    const classification = this.classifyError(error);

    // ============================================================
    // Critical: 导致应用崩溃或核心功能不可用
    // ============================================================
    if (classification === "DATABASE_CORRUPT") {
      return "critical";
    }
    if (classification === "MEMORY_LEAK") {
      return "critical";
    }
    if (classification === "STACK_OVERFLOW") {
      return "critical";
    }
    if (classification === "DISK_FULL") {
      return "critical";
    }
    if (code === "ENOSPC") {
      return "critical";
    }
    if (message.includes("heap out of memory")) {
      return "critical";
    }
    if (message.includes("uncaught exception")) {
      return "critical";
    }

    // ============================================================
    // High: 严重影响用户体验或数据完整性
    // ============================================================
    if (classification === "DATABASE_LOCKED") {
      return "high";
    }
    if (classification === "DATABASE_READONLY") {
      return "high";
    }
    if (classification === "CONNECTION_REFUSED") {
      return "high";
    }
    if (classification === "AUTH_ERROR") {
      return "high";
    }
    if (classification === "SSL_ERROR") {
      return "high";
    }
    if (classification === "LLM_MODEL_ERROR") {
      return "high";
    }
    if (code === "SQLITE_BUSY") {
      return "high";
    }
    if (code === "ECONNREFUSED") {
      return "high";
    }

    // ============================================================
    // Medium: 影响部分功能但有降级方案
    // ============================================================
    if (classification === "FILE_NOT_FOUND") {
      return "medium";
    }
    if (classification === "PERMISSION_DENIED") {
      return "medium";
    }
    if (classification === "TIMEOUT") {
      return "medium";
    }
    if (classification === "CONNECTION_RESET") {
      return "medium";
    }
    if (classification === "DNS_ERROR") {
      return "medium";
    }
    if (classification === "RATE_LIMIT") {
      return "medium";
    }
    if (classification === "SERVER_ERROR") {
      return "medium";
    }
    if (classification === "LLM_CONTEXT_LENGTH") {
      return "medium";
    }
    if (classification === "LLM_API_ERROR") {
      return "medium";
    }
    if (classification === "VALIDATION") {
      return "medium";
    }
    if (classification === "TYPE_ERROR") {
      return "medium";
    }
    if (code === "ENOENT") {
      return "medium";
    }
    if (code === "ETIMEDOUT") {
      return "medium";
    }

    // ============================================================
    // Low: 轻微问题，不影响主要功能
    // ============================================================
    if (classification === "FILE_LOCKED") {
      return "low";
    }
    if (classification === "PATH_TOO_LONG") {
      return "low";
    }
    if (classification === "NETWORK_ERROR") {
      return "low";
    }
    if (classification === "GPU_ERROR") {
      return "low";
    }
    if (classification === "IPC_ERROR") {
      return "low";
    }
    if (classification === "WINDOW_ERROR") {
      return "low";
    }
    if (classification === "REFERENCE_ERROR") {
      return "low";
    }
    if (classification === "SYNTAX_ERROR") {
      return "low";
    }
    if (classification === "RANGE_ERROR") {
      return "low";
    }

    return "low";
  }

  /**
   * 收集错误上下文
   * @param {Error} error - 错误对象
   * @returns {Object} 上下文信息
   */
  gatherContext(error) {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      cwd: process.cwd(),
      errorCode: error?.code || null,
      errorName: error?.name || null,
    };
  }

  /**
   * 生成推荐操作
   * @param {Object} analysis - 分析结果
   * @returns {Array<Object>} 推荐操作列表
   */
  generateRecommendations(analysis) {
    const recommendations = [];

    // 1. 自动修复建议
    if (analysis.autoFixResult?.attempted && analysis.autoFixResult.success) {
      recommendations.push({
        priority: "high",
        category: "auto-fix",
        title: "自动修复已执行",
        description: analysis.autoFixResult.message,
        action: null,
      });
    } else if (
      analysis.autoFixResult?.attempted &&
      !analysis.autoFixResult.success
    ) {
      recommendations.push({
        priority: "high",
        category: "manual-fix",
        title: "需要手动修复",
        description: "自动修复失败，请查看 AI 建议",
        action: "view-ai-diagnosis",
      });
    }

    // 2. 严重程度相关建议
    if (analysis.severity === "critical") {
      recommendations.push({
        priority: "critical",
        category: "alert",
        title: "严重错误！",
        description: "建议立即重启应用或联系技术支持",
        action: "restart-app",
      });
    }

    // 3. 相关历史问题
    if (analysis.relatedIssues && analysis.relatedIssues.length > 0) {
      recommendations.push({
        priority: "medium",
        category: "history",
        title: "发现相似历史问题",
        description: `过去 30 天内出现过 ${analysis.relatedIssues.length} 次类似错误`,
        action: "view-related-issues",
      });
    }

    // 4. AI 诊断建议
    if (analysis.aiDiagnosis?.available) {
      recommendations.push({
        priority: "high",
        category: "ai-diagnosis",
        title: "AI 智能诊断可用",
        description: "查看 AI 提供的详细修复建议",
        action: "view-ai-diagnosis",
      });
    }

    return recommendations;
  }

  /**
   * 保存错误分析到数据库
   * @param {Object} analysis - 分析结果
   * @returns {Promise<string|null>} 保存的记录 ID 或 null
   */
  async saveErrorAnalysis(analysis) {
    if (!this._getDbConnection()) {
      return null;
    }

    try {
      const { v4: uuidv4 } = require("uuid");
      const now = Date.now();
      const id = uuidv4();
      const errorId = uuidv4(); // 用于后续重新分析

      const stmt = this._prepareStatement(`
        INSERT INTO error_analysis (
          id, error_id, error_message, error_stack, error_type,
          classification, severity, context, keywords,
          auto_fix_attempted, auto_fix_success, auto_fix_strategy, auto_fix_result,
          ai_diagnosis_enabled, ai_diagnosis, ai_root_cause, ai_fix_suggestions,
          ai_best_practices, ai_related_docs,
          related_issues, related_issues_count, status,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?
        )
      `);

      // 提取 AI 诊断信息
      const aiDiagnosis = analysis.aiDiagnosis || {};
      const aiAnalysis = aiDiagnosis.analysis?.structured || {};

      stmt.run(
        id,
        errorId,
        analysis.error?.message || "",
        analysis.error?.stack || "",
        analysis.error?.name || "Unknown",
        analysis.classification || "UNKNOWN",
        analysis.severity || "low",
        JSON.stringify(analysis.context || {}),
        JSON.stringify(this.extractKeywords(analysis.error?.message || "")),
        analysis.autoFixResult?.attempted ? 1 : 0,
        analysis.autoFixResult?.success ? 1 : 0,
        analysis.autoFixResult?.errorType || null,
        JSON.stringify(analysis.autoFixResult || {}),
        this.enableAIDiagnosis ? 1 : 0,
        JSON.stringify(aiDiagnosis),
        aiAnalysis.rootCause || null,
        JSON.stringify(aiAnalysis.fixes ? [aiAnalysis.fixes] : []),
        aiAnalysis.bestPractices || null,
        JSON.stringify(
          aiAnalysis.documentation ? [aiAnalysis.documentation] : [],
        ),
        JSON.stringify(analysis.relatedIssues || []),
        (analysis.relatedIssues || []).length,
        "analyzed",
        now,
        now,
      );

      logger.info("[ErrorMonitor] 错误分析已保存到数据库, ID:", id);
      return id;
    } catch (error) {
      logger.error("[ErrorMonitor] saveErrorAnalysis 失败:", error);
      return null;
    }
  }

  /**
   * 生成诊断报告
   * @param {Error|Object} errorOrAnalysis - 错误对象或已有的分析结果
   * @returns {Promise<string>} Markdown 格式的报告
   */
  async generateDiagnosisReport(errorOrAnalysis) {
    let analysis;

    // 判断传入的是错误对象还是分析结果
    if (
      errorOrAnalysis &&
      errorOrAnalysis.classification &&
      errorOrAnalysis.severity
    ) {
      // 已有的分析结果
      analysis = errorOrAnalysis;
    } else {
      // 错误对象，需要先分析
      analysis = await this.analyzeError(errorOrAnalysis);
    }

    return this._formatDiagnosisReport(analysis);
  }

  /**
   * 格式化诊断报告
   * @param {Object} analysis - 分析结果
   * @returns {string} Markdown 格式的报告
   * @private
   */
  _formatDiagnosisReport(analysis) {
    const severityIcon = {
      critical: "🚨",
      high: "⚠️",
      medium: "🔶",
      low: "ℹ️",
    };

    const classificationLabels = {
      // 数据库错误
      DATABASE: "数据库",
      DATABASE_LOCKED: "数据库锁定",
      DATABASE_CORRUPT: "数据库损坏",
      DATABASE_READONLY: "数据库只读",
      // 网络错误
      NETWORK: "网络",
      NETWORK_ERROR: "网络错误",
      CONNECTION_REFUSED: "连接被拒绝",
      CONNECTION_RESET: "连接重置",
      TIMEOUT: "超时",
      DNS_ERROR: "DNS解析失败",
      SSL_ERROR: "SSL/TLS错误",
      // 文件系统错误
      FILESYSTEM: "文件系统",
      FILE_NOT_FOUND: "文件未找到",
      PERMISSION_DENIED: "权限拒绝",
      DISK_FULL: "磁盘已满",
      FILE_LOCKED: "文件锁定",
      PATH_TOO_LONG: "路径过长",
      // 内存错误
      MEMORY: "内存",
      MEMORY_LEAK: "内存泄漏",
      STACK_OVERFLOW: "栈溢出",
      // API/HTTP 错误
      RATE_LIMIT: "速率限制",
      AUTH_ERROR: "认证错误",
      SERVER_ERROR: "服务器错误",
      // Electron 错误
      GPU_ERROR: "GPU错误",
      IPC_ERROR: "IPC通信错误",
      WINDOW_ERROR: "窗口错误",
      // LLM/AI 错误
      LLM_CONTEXT_LENGTH: "上下文长度超限",
      LLM_MODEL_ERROR: "模型错误",
      LLM_API_ERROR: "LLM API错误",
      // 验证错误
      VALIDATION: "验证错误",
      // JavaScript 错误
      TYPE_ERROR: "类型错误",
      REFERENCE_ERROR: "引用错误",
      SYNTAX_ERROR: "语法错误",
      RANGE_ERROR: "范围错误",
      PERMISSION: "权限",
      UNKNOWN: "未知",
    };

    let report = `# 错误诊断报告\n\n`;
    report += `**生成时间**: ${new Date().toLocaleString()}\n`;
    report += `**分析 ID**: ${analysis.id || "N/A"}\n\n`;
    report += `---\n\n`;

    // 1. 错误信息
    const errorInfo = analysis.error || {};
    report += `## 错误信息\n\n`;
    report += `| 属性 | 值 |\n`;
    report += `|------|----|\n`;
    report += `| **类型** | ${errorInfo.name || analysis.error_type || "Unknown"} |\n`;
    report += `| **消息** | ${errorInfo.message || analysis.error_message || "N/A"} |\n`;
    report += `| **分类** | ${classificationLabels[analysis.classification] || analysis.classification} |\n`;
    report += `| **严重程度** | ${severityIcon[analysis.severity] || ""} ${analysis.severity} |\n`;
    report += `| **状态** | ${analysis.status || "analyzed"} |\n\n`;

    // 2. 堆栈跟踪
    const stack = errorInfo.stack || analysis.error_stack;
    if (stack) {
      report += `## 堆栈跟踪\n\n`;
      report += `\`\`\`\n${stack}\n\`\`\`\n\n`;
    }

    // 3. 自动修复结果
    const autoFixResult = analysis.autoFixResult || analysis.auto_fix_result;
    if (autoFixResult?.attempted || analysis.auto_fix_attempted) {
      report += `## 自动修复\n\n`;
      const success = autoFixResult?.success ?? analysis.auto_fix_success;
      report += `- **状态**: ${success ? "✅ 成功" : "❌ 失败"}\n`;
      report += `- **策略**: ${autoFixResult?.errorType || analysis.auto_fix_strategy || "N/A"}\n`;
      report += `- **描述**: ${autoFixResult?.message || "N/A"}\n\n`;
    }

    // 4. AI 诊断
    const aiDiagnosis = analysis.aiDiagnosis || analysis.ai_diagnosis;
    if (aiDiagnosis?.available || aiDiagnosis?.rawResponse) {
      report += `## AI 智能诊断\n\n`;
      if (aiDiagnosis.rawResponse) {
        report += `${aiDiagnosis.rawResponse}\n\n`;
      } else if (aiDiagnosis.analysis?.full) {
        report += `${aiDiagnosis.analysis.full}\n\n`;
      }
    }

    // AI 根本原因
    const rootCause = analysis.ai_root_cause;
    if (rootCause) {
      report += `### 根本原因\n\n${rootCause}\n\n`;
    }

    // AI 修复建议
    const fixSuggestions = analysis.ai_fix_suggestions;
    if (Array.isArray(fixSuggestions) && fixSuggestions.length > 0) {
      report += `### 修复建议\n\n`;
      fixSuggestions.forEach((suggestion, index) => {
        report += `${index + 1}. ${suggestion}\n`;
      });
      report += `\n`;
    }

    // 5. 相关历史问题
    const relatedIssues = analysis.relatedIssues || analysis.related_issues;
    if (Array.isArray(relatedIssues) && relatedIssues.length > 0) {
      report += `## 相关历史问题 (${relatedIssues.length})\n\n`;
      relatedIssues.forEach((issue, index) => {
        const timestamp = issue.timestamp || issue.created_at;
        const date = timestamp
          ? new Date(timestamp).toLocaleString()
          : "Unknown";
        report += `${index + 1}. **${date}**: ${issue.message || issue.error_message}\n`;
      });
      report += `\n`;
    }

    // 6. 推荐操作
    const recommendations = analysis.recommendations || [];
    if (recommendations.length > 0) {
      report += `## 推荐操作\n\n`;
      recommendations.forEach((rec, index) => {
        const icon =
          rec.priority === "critical"
            ? "🚨"
            : rec.priority === "high"
              ? "⚠️"
              : "ℹ️";
        report += `${index + 1}. ${icon} **${rec.title}**: ${rec.description}\n`;
      });
      report += `\n`;
    }

    // 7. 上下文信息
    const context = analysis.context;
    if (context && typeof context === "object") {
      report += `## 运行环境\n\n`;
      report += `- **平台**: ${context.platform || "N/A"}\n`;
      report += `- **Node 版本**: ${context.nodeVersion || "N/A"}\n`;
      if (context.memory) {
        const heapUsed = Math.round(
          (context.memory.heapUsed || 0) / 1024 / 1024,
        );
        const heapTotal = Math.round(
          (context.memory.heapTotal || 0) / 1024 / 1024,
        );
        report += `- **内存使用**: ${heapUsed}MB / ${heapTotal}MB\n`;
      }
      report += `- **运行时长**: ${context.uptime || "N/A"} 秒\n\n`;
    }

    report += `---\n\n`;
    report += `*此报告由 ErrorMonitor AI 诊断系统自动生成*\n`;

    return report;
  }

  /**
   * 从数据库获取分析记录
   * @param {string} analysisId - 分析记录 ID
   * @returns {Promise<Object|null>} 分析记录对象
   */
  async getAnalysisById(analysisId) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    try {
      const stmt = this._prepareStatement(`
        SELECT * FROM error_analysis WHERE id = ?
      `);

      const record = stmt.get(analysisId);

      if (!record) {
        return null;
      }

      // 解析 JSON 字段并返回规范化的结构
      return this._parseAnalysisRecord(record);
    } catch (error) {
      logger.error("[ErrorMonitor] getAnalysisById 失败:", error);
      throw error;
    }
  }

  /**
   * 解析数据库中的分析记录
   * @param {Object} record - 数据库记录
   * @returns {Object} 解析后的记录
   * @private
   */
  _parseAnalysisRecord(record) {
    const safeJsonParse = (str, defaultVal = null) => {
      if (!str) {
        return defaultVal;
      }
      try {
        return JSON.parse(str);
      } catch {
        return defaultVal;
      }
    };

    return {
      ...record,
      context: safeJsonParse(record.context, {}),
      keywords: safeJsonParse(record.keywords, []),
      auto_fix_result: safeJsonParse(record.auto_fix_result, null),
      ai_diagnosis: safeJsonParse(record.ai_diagnosis, null),
      ai_fix_suggestions: safeJsonParse(record.ai_fix_suggestions, []),
      ai_related_docs: safeJsonParse(record.ai_related_docs, []),
      related_issues: safeJsonParse(record.related_issues, []),
    };
  }

  /**
   * 获取错误统计信息
   * @param {Object} options - 统计选项
   * @param {number} options.days - 统计天数（默认 7 天）
   * @returns {Promise<Object>} 统计信息
   */
  async getErrorStats(options = {}) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    const days = options.days || 7;
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      // 总体统计
      const totalStmt = this._prepareStatement(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low,
          SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed,
          SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as resolved
        FROM error_analysis
        WHERE created_at >= ?
      `);

      const total = totalStmt.get(cutoffTime) || {};

      // 按分类统计
      const byClassification = await this.getClassificationStats(days);

      // 按严重程度统计
      const bySeverity = await this.getSeverityStats(days);

      // 每日趋势（最近 7 天）
      const dailyTrend = await this.getDailyTrend(Math.min(days, 30));

      return {
        period: `${days} days`,
        total: total.total || 0,
        bySeverity: {
          critical: total.critical || 0,
          high: total.high || 0,
          medium: total.medium || 0,
          low: total.low || 0,
        },
        byClassification,
        bySeverityList: bySeverity,
        dailyTrend,
        autoFixed: total.auto_fixed || 0,
        resolved: total.resolved || 0,
        autoFixRate:
          total.total > 0
            ? ((total.auto_fixed / total.total) * 100).toFixed(2)
            : "0.00",
        resolutionRate:
          total.total > 0
            ? ((total.resolved / total.total) * 100).toFixed(2)
            : "0.00",
      };
    } catch (error) {
      logger.error("[ErrorMonitor] getErrorStats 失败:", error);
      throw error;
    }
  }

  /**
   * 获取每日错误趋势
   * @param {number} days - 天数
   * @returns {Promise<Array>} 每日趋势数据
   */
  async getDailyTrend(days = 7) {
    if (!this._getDbConnection()) {
      return [];
    }

    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      const stmt = this._prepareStatement(`
        SELECT
          DATE(created_at / 1000, 'unixepoch') as date,
          COUNT(*) as total,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed
        FROM error_analysis
        WHERE created_at >= ?
        GROUP BY date
        ORDER BY date DESC
        LIMIT ?
      `);

      return stmt.all(cutoffTime, days);
    } catch (error) {
      logger.error("[ErrorMonitor] getDailyTrend 失败:", error);
      return [];
    }
  }

  /**
   * 获取分析历史记录
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 返回数量限制
   * @param {number} options.offset - 偏移量
   * @param {string} options.classification - 按分类筛选
   * @param {string} options.severity - 按严重程度筛选
   * @param {string} options.status - 按状态筛选
   * @param {string} options.search - 搜索关键词
   * @returns {Promise<Array>} 分析记录列表
   */
  async getAnalysisHistory(options = {}) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    try {
      let query = `
        SELECT * FROM error_analysis
        WHERE 1=1
      `;
      const params = [];

      if (options.classification) {
        query += ` AND classification = ?`;
        params.push(options.classification);
      }

      if (options.severity) {
        query += ` AND severity = ?`;
        params.push(options.severity);
      }

      if (options.status) {
        query += ` AND status = ?`;
        params.push(options.status);
      }

      if (options.search) {
        query += ` AND (error_message LIKE ? ESCAPE '\\' OR ai_root_cause LIKE ? ESCAPE '\\')`;
        const searchPattern = SqlSecurity.likeContains(options.search);
        params.push(searchPattern, searchPattern);
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const stmt = this._prepareStatement(query);
      const records = stmt.all(...params);

      return records.map((record) => this._parseAnalysisRecord(record));
    } catch (error) {
      logger.error("[ErrorMonitor] getAnalysisHistory 失败:", error);
      throw error;
    }
  }

  /**
   * 删除分析记录
   * @param {string} analysisId - 分析记录 ID
   * @returns {Promise<boolean>} 删除是否成功
   */
  async deleteAnalysis(analysisId) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    try {
      const stmt = this._prepareStatement(`
        DELETE FROM error_analysis WHERE id = ?
      `);

      const result = stmt.run(analysisId);
      logger.info(`[ErrorMonitor] 已删除分析记录: ${analysisId}`);
      return result.changes > 0;
    } catch (error) {
      logger.error("[ErrorMonitor] deleteAnalysis 失败:", error);
      throw error;
    }
  }

  /**
   * 清理旧的分析记录
   * @param {number} daysToKeep - 保留天数
   * @returns {Promise<number>} 删除的记录数
   */
  async cleanupOldAnalyses(daysToKeep = 30) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    try {
      // 先查询要删除的记录数
      const countStmt = this._prepareStatement(`
        SELECT COUNT(*) as count FROM error_analysis WHERE created_at < ?
      `);
      const { count } = countStmt.get(cutoffTime) || { count: 0 };

      // 执行删除
      const deleteStmt = this._prepareStatement(`
        DELETE FROM error_analysis WHERE created_at < ?
      `);
      deleteStmt.run(cutoffTime);

      logger.info(
        `[ErrorMonitor] 已清理 ${count} 条旧分析记录（保留 ${daysToKeep} 天）`,
      );

      return count;
    } catch (error) {
      logger.error("[ErrorMonitor] cleanupOldAnalyses 失败:", error);
      throw error;
    }
  }

  /**
   * 获取错误分类统计
   * @param {number} days - 统计天数
   * @returns {Promise<Array>} 分类统计列表
   */
  async getClassificationStats(days = 7) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      const stmt = this._prepareStatement(`
        SELECT
          classification,
          COUNT(*) as count,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
          SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_count,
          SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed_count,
          SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as resolved_count,
          MAX(created_at) as last_occurrence
        FROM error_analysis
        WHERE created_at >= ?
        GROUP BY classification
        ORDER BY count DESC
      `);

      return stmt.all(cutoffTime);
    } catch (error) {
      logger.error("[ErrorMonitor] getClassificationStats 失败:", error);
      throw error;
    }
  }

  /**
   * 获取错误严重程度统计
   * @param {number} days - 统计天数
   * @returns {Promise<Array>} 严重程度统计列表
   */
  async getSeverityStats(days = 7) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      const stmt = this._prepareStatement(`
        SELECT
          severity,
          COUNT(*) as count,
          SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed_count,
          SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as resolved_count,
          MAX(created_at) as last_occurrence
        FROM error_analysis
        WHERE created_at >= ?
        GROUP BY severity
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
            ELSE 5
          END
      `);

      return stmt.all(cutoffTime);
    } catch (error) {
      logger.error("[ErrorMonitor] getSeverityStats 失败:", error);
      throw error;
    }
  }

  /**
   * 从数据库获取错误记录
   * @param {string} errorId - 错误 ID
   * @returns {Promise<Object|null>} 错误对象
   */
  async getErrorById(errorId) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    try {
      const stmt = this._prepareStatement(`
        SELECT * FROM error_analysis WHERE error_id = ? ORDER BY created_at DESC LIMIT 1
      `);

      const record = stmt.get(errorId);

      if (!record) {
        return null;
      }

      // 重构为 Error 对象
      const error = new Error(record.error_message);
      error.name = record.error_type || "Error";
      error.stack = record.error_stack || "";

      return error;
    } catch (error) {
      logger.error("[ErrorMonitor] getErrorById 失败:", error);
      throw error;
    }
  }

  /**
   * 更新错误分析状态
   * @param {string} analysisId - 分析记录 ID
   * @param {string} status - 新状态 (new, analyzing, analyzed, fixing, fixed, ignored)
   * @param {string} [resolution] - 解决方案描述
   * @returns {Promise<boolean>} 更新是否成功
   */
  async updateAnalysisStatus(analysisId, status, resolution = null) {
    if (!this._getDbConnection()) {
      throw new Error("数据库未初始化");
    }

    const validStatuses = [
      "new",
      "analyzing",
      "analyzed",
      "fixing",
      "fixed",
      "ignored",
    ];
    if (!validStatuses.includes(status)) {
      throw new Error(`无效的状态: ${status}`);
    }

    try {
      const now = Date.now();
      let stmt;

      if (status === "fixed" || status === "ignored") {
        stmt = this._prepareStatement(`
          UPDATE error_analysis
          SET status = ?, resolution = ?, resolved_at = ?, updated_at = ?
          WHERE id = ?
        `);
        stmt.run(status, resolution, now, now, analysisId);
      } else {
        stmt = this._prepareStatement(`
          UPDATE error_analysis
          SET status = ?, updated_at = ?
          WHERE id = ?
        `);
        stmt.run(status, now, analysisId);
      }

      logger.info(`[ErrorMonitor] 更新分析状态: ${analysisId} -> ${status}`);
      return true;
    } catch (error) {
      logger.error("[ErrorMonitor] updateAnalysisStatus 失败:", error);
      throw error;
    }
  }

  /**
   * 获取诊断配置
   * @returns {Promise<Object>} 配置对象
   */
  async getDiagnosisConfig() {
    if (!this._getDbConnection()) {
      return {
        enable_ai_diagnosis: this.enableAIDiagnosis,
        llm_provider: "ollama",
        llm_model: "qwen2:7b",
      };
    }

    try {
      const stmt = this._prepareStatement(`
        SELECT * FROM error_diagnosis_config WHERE id = 'default'
      `);
      const config = stmt.get();

      if (config) {
        return {
          ...config,
          auto_fix_strategies: config.auto_fix_strategies
            ? JSON.parse(config.auto_fix_strategies)
            : [],
        };
      }

      return {
        enable_ai_diagnosis: this.enableAIDiagnosis,
        llm_provider: "ollama",
        llm_model: "qwen2:7b",
      };
    } catch (error) {
      logger.error("[ErrorMonitor] getDiagnosisConfig 失败:", error);
      return {
        enable_ai_diagnosis: this.enableAIDiagnosis,
        llm_provider: "ollama",
        llm_model: "qwen2:7b",
      };
    }
  }

  /**
   * 更新诊断配置
   * @param {Object} updates - 要更新的配置项
   * @returns {Promise<boolean>} 更新是否成功
   */
  async updateDiagnosisConfig(updates) {
    if (!this._getDbConnection()) {
      // 更新内存配置
      if (updates.enable_ai_diagnosis !== undefined) {
        this.enableAIDiagnosis = updates.enable_ai_diagnosis;
      }
      return true;
    }

    try {
      const allowedFields = [
        "enable_ai_diagnosis",
        "llm_provider",
        "llm_model",
        "llm_temperature",
        "enable_auto_fix",
        "auto_fix_strategies",
        "analysis_depth",
        "include_context",
        "include_related_issues",
        "related_issues_limit",
        "retention_days",
        "auto_cleanup",
      ];

      const setClauses = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          setClauses.push(`${key} = ?`);
          values.push(
            key === "auto_fix_strategies" ? JSON.stringify(value) : value,
          );
        }
      }

      if (setClauses.length === 0) {
        return false;
      }

      setClauses.push("updated_at = ?");
      values.push(Date.now());
      values.push("default");

      const stmt = this._prepareStatement(`
        UPDATE error_diagnosis_config
        SET ${setClauses.join(", ")}
        WHERE id = ?
      `);
      stmt.run(...values);

      // 同步更新内存配置
      if (updates.enable_ai_diagnosis !== undefined) {
        this.enableAIDiagnosis = updates.enable_ai_diagnosis;
      }

      logger.info("[ErrorMonitor] 诊断配置已更新");
      return true;
    } catch (error) {
      logger.error("[ErrorMonitor] updateDiagnosisConfig 失败:", error);
      throw error;
    }
  }
}

// 创建单例
let errorMonitorInstance = null;

function getErrorMonitor() {
  if (!errorMonitorInstance) {
    errorMonitorInstance = new ErrorMonitor();
  }
  return errorMonitorInstance;
}

module.exports = {
  ErrorMonitor,
  getErrorMonitor,
};
