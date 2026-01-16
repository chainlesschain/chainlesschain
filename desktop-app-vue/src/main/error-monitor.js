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

    console.log("[ErrorMonitor] 初始化完成", {
      AI诊断: this.enableAIDiagnosis && this.llmManager ? "已启用" : "未启用",
      历史查询: this.database ? "已启用" : "未启用",
    });
  }

  /**
   * 设置全局错误处理器
   */
  setupGlobalErrorHandlers() {
    // 捕获未处理的异常
    process.on("uncaughtException", (error) => {
      // 忽略 EPIPE 错误（管道已关闭，通常发生在应用关闭时）
      if (error.code === "EPIPE") {
        console.log("[ErrorMonitor] Ignoring EPIPE error (broken pipe)");
        return;
      }

      console.error("Uncaught Exception:", error);
      this.captureError("UNCAUGHT_EXCEPTION", error);
    });

    // 捕获未处理的Promise拒绝
    process.on("unhandledRejection", (reason, promise) => {
      console.error("Unhandled Rejection at:", promise, "reason:", reason);
      this.captureError("UNHANDLED_REJECTION", reason);
    });

    // 捕获警告
    process.on("warning", (warning) => {
      console.warn("Warning:", warning);
      this.captureError("WARNING", warning);
    });
  }

  /**
   * 初始化错误模式识别
   */
  initErrorPatterns() {
    return {
      DATABASE_LOCKED: /SQLITE_BUSY|database is locked/i,
      CONNECTION_REFUSED: /ECONNREFUSED|connect ECONNREFUSED/i,
      TIMEOUT: /ETIMEDOUT|timeout/i,
      PERMISSION_DENIED: /EACCES|EPERM|permission denied/i,
      FILE_NOT_FOUND: /ENOENT|no such file/i,
      PORT_IN_USE: /EADDRINUSE|address already in use/i,
      MEMORY_LEAK: /heap out of memory|allocation failed/i,
      NETWORK_ERROR: /network error|socket hang up/i,
      INVALID_JSON: /unexpected token|invalid json/i,
      GPU_ERROR: /GPU process|OpenGL/i,
    };
  }

  /**
   * 初始化自动修复策略
   */
  initFixStrategies() {
    return {
      SQLITE_BUSY: async (error, context = {}) => {
        console.log("[Auto-Fix] Attempting to fix database lock...");
        // 指数退避重试策略
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
        console.log("[Auto-Fix] Attempting to fix database lock (generic)...");
        // 与 SQLITE_BUSY 相同的策略
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
        console.log("[Auto-Fix] Attempting to reconnect to service...");
        const service = this.identifyService(error);

        // 先尝试直接重连（可能是临时网络问题）
        const reconnectResult = await this.retryWithExponentialBackoff(
          context.retryFn,
          {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            factor: 2,
          },
          "ECONNREFUSED",
        );

        if (reconnectResult.success) {
          return reconnectResult;
        }

        // 重连失败，尝试启动服务
        if (service === "ollama") {
          return await this.restartOllamaService();
        } else if (service === "qdrant") {
          return await this.restartQdrantService();
        } else if (service === "postgres") {
          return await this.restartPostgresService();
        } else if (service === "redis") {
          return await this.restartRedisService();
        }

        return {
          success: false,
          message: `Could not identify or restart service (port: ${this.extractPort(error) || "unknown"})`,
        };
      },

      CONNECTION_REFUSED: async (error, context = {}) => {
        // 别名，调用 ECONNREFUSED 策略
        return await this.fixStrategies.ECONNREFUSED(error, context);
      },

      ETIMEDOUT: async (error, context = {}) => {
        console.log("[Auto-Fix] Retrying operation after timeout...");
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
        console.log("[Auto-Fix] Attempting to fix permission issue...");
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
        console.log("[Auto-Fix] Creating missing file/directory...");
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
        console.log("[Auto-Fix] Attempting to free up port...");
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
        console.log("[Auto-Fix] Clearing caches to free memory...");
        return await this.clearCaches();
      },

      NETWORK_ERROR: async (error, context = {}) => {
        console.log("[Auto-Fix] Attempting to recover from network error...");
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
        console.log("[Auto-Fix] Handling invalid JSON response...");
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
        console.log(
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
        console.log(
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
      console.log("[Error Monitor] Auto-fix result:", fixResult);
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
        console.log(`[Error Monitor] Detected error type: ${errorType}`);

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
            console.error(`[Error Monitor] Fix strategy failed:`, fixError);
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
    if (message.includes("11434")) return "ollama";
    if (message.includes("6333")) return "qdrant";
    if (message.includes("5432")) return "postgres";
    if (message.includes("6379")) return "redis";
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
              console.log(`[Auto-Fix] Killed process ${pid} on port ${port}`);
            } catch (killError) {
              console.warn(
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
              console.log(`[Auto-Fix] Killed process ${pid} on port ${port}`);
            } catch (killError) {
              console.warn(
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
        console.warn(
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
        console.warn(
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
      console.error("Failed to save error log:", error);
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

      console.log(
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
          console.log("[ErrorMonitor] AI 诊断完成");
        } catch (aiError) {
          console.warn("[ErrorMonitor] AI 诊断失败:", aiError.message);
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
          console.log(
            "[ErrorMonitor] 找到",
            analysis.relatedIssues.length,
            "个相关历史问题",
          );
        } catch (dbError) {
          console.warn("[ErrorMonitor] 历史查询失败:", dbError.message);
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
      console.error("[ErrorMonitor] analyzeError 失败:", error);
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

      // 使用本地 Ollama 模型（免费）
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
          provider: "ollama", // 使用本地免费模型
          model: "qwen2:7b", // 或其他可用的本地模型
          temperature: 0.1, // 低温度，更确定性的输出
          stream: false,
        },
      );

      // 解析 LLM 响应
      const analysis = this.parseLLMResponse(response.content);

      return {
        available: true,
        rawResponse: response.content,
        analysis,
        model: "ollama/qwen2:7b",
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[ErrorMonitor] getSuggestedFixes 失败:", error);
      return {
        available: false,
        error: error.message,
      };
    }
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
      console.warn("[ErrorMonitor] 解析 LLM 响应失败:", error);
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
        if (timestamp < thirtyDaysAgo) return false;

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
      console.error("[ErrorMonitor] findRelatedIssues 失败:", error);
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
   * @param {Error} error - 错误对象
   * @returns {string} 错误分类
   */
  classifyError(error) {
    const message = (error?.message || String(error)).toLowerCase();
    const code = error?.code;

    if (code === "SQLITE_BUSY" || message.includes("database"))
      return "DATABASE";
    if (code === "ECONNREFUSED" || message.includes("connection"))
      return "NETWORK";
    if (code === "ENOENT" || message.includes("no such file"))
      return "FILESYSTEM";
    if (code === "EPERM" || code === "EACCES") return "PERMISSION";
    if (message.includes("timeout")) return "TIMEOUT";
    if (message.includes("memory") || message.includes("heap")) return "MEMORY";
    if (error?.name === "TypeError") return "TYPE_ERROR";
    if (error?.name === "ReferenceError") return "REFERENCE_ERROR";
    if (error?.name === "SyntaxError") return "SYNTAX_ERROR";

    return "UNKNOWN";
  }

  /**
   * 评估错误严重程度
   * @param {Error} error - 错误对象
   * @returns {string} 严重程度 (low/medium/high/critical)
   */
  assessSeverity(error) {
    const message = (error?.message || String(error)).toLowerCase();
    const code = error?.code;

    // Critical: 影响核心功能
    if (message.includes("database") && message.includes("corrupt"))
      return "critical";
    if (message.includes("heap out of memory")) return "critical";
    if (code === "ENOSPC") return "critical"; // 磁盘空间不足

    // High: 影响重要功能
    if (code === "SQLITE_BUSY") return "high";
    if (code === "ECONNREFUSED") return "high";
    if (message.includes("uncaught exception")) return "high";

    // Medium: 影响部分功能
    if (code === "ENOENT") return "medium";
    if (code === "ETIMEDOUT") return "medium";
    if (error?.name === "TypeError") return "medium";

    // Low: 不影响核心功能
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
   * @returns {Promise<void>}
   */
  async saveErrorAnalysis(analysis) {
    if (!this.database) return;

    try {
      // 这里假设有一个 error_analysis 表
      // 实际实现需要根据数据库架构调整
      const stmt = this.database.prepare(`
        INSERT INTO error_analysis (
          id, error_message, error_type, classification, severity,
          auto_fix_attempted, auto_fix_success,
          ai_diagnosis, recommendations, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const { v4: uuidv4 } = require("uuid");

      stmt.run(
        uuidv4(),
        analysis.error.message,
        analysis.error.name,
        analysis.classification,
        analysis.severity,
        analysis.autoFixResult?.attempted ? 1 : 0,
        analysis.autoFixResult?.success ? 1 : 0,
        JSON.stringify(analysis.aiDiagnosis),
        JSON.stringify(analysis.recommendations),
        Date.now(),
      );

      console.log("[ErrorMonitor] 错误分析已保存到数据库");
    } catch (error) {
      console.error("[ErrorMonitor] saveErrorAnalysis 失败:", error);
    }
  }

  /**
   * 生成诊断报告
   * @param {Error} error - 错误对象
   * @returns {Promise<string>} Markdown 格式的报告
   */
  async generateDiagnosisReport(error) {
    const analysis = await this.analyzeError(error);

    let report = `# 错误诊断报告\n\n`;
    report += `**生成时间**: ${new Date().toLocaleString()}\n\n`;
    report += `---\n\n`;

    // 1. 错误信息
    report += `## 错误信息\n\n`;
    report += `- **类型**: ${analysis.error.name}\n`;
    report += `- **消息**: ${analysis.error.message}\n`;
    report += `- **分类**: ${analysis.classification}\n`;
    report += `- **严重程度**: ${analysis.severity}\n\n`;

    // 2. 自动修复结果
    if (analysis.autoFixResult?.attempted) {
      report += `## 自动修复\n\n`;
      report += `- **状态**: ${analysis.autoFixResult.success ? "✅ 成功" : "❌ 失败"}\n`;
      report += `- **描述**: ${analysis.autoFixResult.message}\n\n`;
    }

    // 3. AI 诊断
    if (analysis.aiDiagnosis?.available) {
      report += `## AI 智能诊断\n\n`;
      report += `${analysis.aiDiagnosis.rawResponse}\n\n`;
    }

    // 4. 相关历史问题
    if (analysis.relatedIssues && analysis.relatedIssues.length > 0) {
      report += `## 相关历史问题\n\n`;
      analysis.relatedIssues.forEach((issue, index) => {
        report += `${index + 1}. **${new Date(issue.timestamp).toLocaleString()}**: ${issue.message}\n`;
      });
      report += `\n`;
    }

    // 5. 推荐操作
    if (analysis.recommendations.length > 0) {
      report += `## 推荐操作\n\n`;
      analysis.recommendations.forEach((rec, index) => {
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

    return report;
  }

  /**
   * 从数据库获取分析记录
   * @param {string} analysisId - 分析记录 ID
   * @returns {Promise<Object|null>} 分析记录对象
   */
  async getAnalysisById(analysisId) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    try {
      const stmt = this.database.db.prepare(`
        SELECT * FROM error_analysis WHERE id = ?
      `);

      const record = stmt.get(analysisId);

      if (!record) {
        return null;
      }

      // 解析 JSON 字段
      return {
        ...record,
        context: record.context ? JSON.parse(record.context) : null,
        keywords: record.keywords ? JSON.parse(record.keywords) : [],
        auto_fix_result: record.auto_fix_result
          ? JSON.parse(record.auto_fix_result)
          : null,
        ai_diagnosis: record.ai_diagnosis
          ? JSON.parse(record.ai_diagnosis)
          : null,
        ai_fix_suggestions: record.ai_fix_suggestions
          ? JSON.parse(record.ai_fix_suggestions)
          : [],
        ai_related_docs: record.ai_related_docs
          ? JSON.parse(record.ai_related_docs)
          : [],
        related_issues: record.related_issues
          ? JSON.parse(record.related_issues)
          : [],
      };
    } catch (error) {
      console.error("[ErrorMonitor] getAnalysisById 失败:", error);
      throw error;
    }
  }

  /**
   * 获取错误统计信息
   * @param {Object} options - 统计选项
   * @param {number} options.days - 统计天数（默认 7 天）
   * @returns {Promise<Object>} 统计信息
   */
  async getErrorStats(options = {}) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    const days = options.days || 7;
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      // 总体统计
      const totalStmt = this.database.db.prepare(`
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

      const total = totalStmt.get(cutoffTime);

      // 按分类统计
      const byClassification = await this.getClassificationStats(days);

      // 按严重程度统计
      const bySeverity = await this.getSeverityStats(days);

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
      console.error("[ErrorMonitor] getErrorStats 失败:", error);
      throw error;
    }
  }

  /**
   * 获取分析历史记录
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 返回数量限制
   * @param {number} options.offset - 偏移量
   * @param {string} options.classification - 按分类筛选
   * @param {string} options.severity - 按严重程度筛选
   * @returns {Promise<Array>} 分析记录列表
   */
  async getAnalysisHistory(options = {}) {
    if (!this.database) {
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

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const stmt = this.database.db.prepare(query);
      const records = stmt.all(...params);

      return records.map((record) => ({
        ...record,
        context: record.context ? JSON.parse(record.context) : null,
        keywords: record.keywords ? JSON.parse(record.keywords) : [],
        auto_fix_result: record.auto_fix_result
          ? JSON.parse(record.auto_fix_result)
          : null,
        ai_diagnosis: record.ai_diagnosis
          ? JSON.parse(record.ai_diagnosis)
          : null,
        ai_fix_suggestions: record.ai_fix_suggestions
          ? JSON.parse(record.ai_fix_suggestions)
          : [],
        related_issues: record.related_issues
          ? JSON.parse(record.related_issues)
          : [],
      }));
    } catch (error) {
      console.error("[ErrorMonitor] getAnalysisHistory 失败:", error);
      throw error;
    }
  }

  /**
   * 删除分析记录
   * @param {string} analysisId - 分析记录 ID
   */
  async deleteAnalysis(analysisId) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    try {
      const stmt = this.database.db.prepare(`
        DELETE FROM error_analysis WHERE id = ?
      `);

      stmt.run(analysisId);
      console.log(`[ErrorMonitor] 已删除分析记录: ${analysisId}`);
    } catch (error) {
      console.error("[ErrorMonitor] deleteAnalysis 失败:", error);
      throw error;
    }
  }

  /**
   * 清理旧的分析记录
   * @param {number} daysToKeep - 保留天数
   * @returns {Promise<number>} 删除的记录数
   */
  async cleanupOldAnalyses(daysToKeep = 30) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    try {
      // 先查询要删除的记录数
      const countStmt = this.database.db.prepare(`
        SELECT COUNT(*) as count FROM error_analysis WHERE created_at < ?
      `);
      const { count } = countStmt.get(cutoffTime);

      // 执行删除
      const deleteStmt = this.database.db.prepare(`
        DELETE FROM error_analysis WHERE created_at < ?
      `);
      deleteStmt.run(cutoffTime);

      console.log(
        `[ErrorMonitor] 已清理 ${count} 条旧分析记录（保留 ${daysToKeep} 天）`,
      );

      return count;
    } catch (error) {
      console.error("[ErrorMonitor] cleanupOldAnalyses 失败:", error);
      throw error;
    }
  }

  /**
   * 获取错误分类统计
   * @param {number} days - 统计天数
   * @returns {Promise<Array>} 分类统计列表
   */
  async getClassificationStats(days = 7) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      const stmt = this.database.db.prepare(`
        SELECT
          classification,
          COUNT(*) as count,
          SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
          SUM(CASE WHEN auto_fix_success = 1 THEN 1 ELSE 0 END) as auto_fixed_count,
          MAX(created_at) as last_occurrence
        FROM error_analysis
        WHERE created_at >= ?
        GROUP BY classification
        ORDER BY count DESC
      `);

      return stmt.all(cutoffTime);
    } catch (error) {
      console.error("[ErrorMonitor] getClassificationStats 失败:", error);
      throw error;
    }
  }

  /**
   * 获取错误严重程度统计
   * @param {number} days - 统计天数
   * @returns {Promise<Array>} 严重程度统计列表
   */
  async getSeverityStats(days = 7) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      const stmt = this.database.db.prepare(`
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
      console.error("[ErrorMonitor] getSeverityStats 失败:", error);
      throw error;
    }
  }

  /**
   * 从数据库获取错误记录
   * @param {string} errorId - 错误 ID
   * @returns {Promise<Object|null>} 错误对象
   */
  async getErrorById(errorId) {
    if (!this.database) {
      throw new Error("数据库未初始化");
    }

    try {
      const stmt = this.database.db.prepare(`
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
      console.error("[ErrorMonitor] getErrorById 失败:", error);
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
