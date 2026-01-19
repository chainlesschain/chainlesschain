/**
 * 系统健康检查模块
 * 定期检查各个服务和组件的健康状态,并尝试自动修复问题
 */

const { logger, createLogger } = require('../utils/logger.js');
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { app } = require("electron");

class HealthCheckService {
  constructor() {
    this.checks = {};
    this.checkInterval = 60000; // 1分钟检查一次
    this.intervalId = null;
    this.lastResults = {};
    this.setupChecks();
  }

  /**
   * 设置所有健康检查
   */
  setupChecks() {
    this.checks = {
      database: this.checkDatabase.bind(this),
      ollama: this.checkOllama.bind(this),
      qdrant: this.checkQdrant.bind(this),
      projectService: this.checkProjectService.bind(this),
      aiService: this.checkAIService.bind(this),
      diskSpace: this.checkDiskSpace.bind(this),
      memory: this.checkMemory.bind(this),
      ukey: this.checkUKey.bind(this),
      network: this.checkNetwork.bind(this),
    };
  }

  /**
   * 启动健康检查
   */
  start() {
    if (this.intervalId) {
      return;
    }

    logger.info("[Health Check] Starting health check service...");
    this.runChecks(); // 立即执行一次

    this.intervalId = setInterval(() => {
      this.runChecks();
    }, this.checkInterval);
  }

  /**
   * 停止健康检查
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("[Health Check] Health check service stopped");
    }
  }

  /**
   * 运行所有检查
   */
  async runChecks() {
    logger.info("[Health Check] Running health checks...");
    const results = {};
    const timestamp = new Date().toISOString();

    for (const [name, checkFn] of Object.entries(this.checks)) {
      try {
        const result = await checkFn();
        results[name] = {
          status: result.healthy ? "PASS" : "FAIL",
          healthy: result.healthy,
          message: result.message,
          details: result.details || {},
          timestamp,
        };

        // 如果检查失败,尝试自动修复
        if (!result.healthy && result.autoFix) {
          logger.info(`[Health Check] Attempting to auto-fix ${name}...`);
          const fixResult = await result.autoFix();
          results[name].autoFixAttempted = true;
          results[name].autoFixResult = fixResult;
        }
      } catch (error) {
        results[name] = {
          status: "ERROR",
          healthy: false,
          message: `Check failed: ${error.message}`,
          error: error.stack,
          timestamp,
        };
      }
    }

    this.lastResults = results;
    this.logResults(results);

    return results;
  }

  /**
   * 检查数据库
   */
  async checkDatabase() {
    try {
      const { getDatabase } = require("./database");
      const db = getDatabase();

      // 执行简单查询测试连接
      await new Promise((resolve, reject) => {
        db.get("SELECT 1 as test", (err, row) => {
          if (err) {reject(err);}
          else {resolve(row);}
        });
      });

      return {
        healthy: true,
        message: "Database is healthy",
        details: {
          encrypted: db.encrypted || false,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Database check failed: ${error.message}`,
        autoFix: async () => {
          // 尝试重新初始化数据库
          try {
            const { initDatabase } = require("./database");
            await initDatabase();
            return { success: true, message: "Database reinitialized" };
          } catch (fixError) {
            return { success: false, message: fixError.message };
          }
        },
      };
    }
  }

  /**
   * 检查Ollama服务
   */
  async checkOllama() {
    try {
      const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
      const response = await axios.get(`${ollamaHost}/api/tags`, {
        timeout: 5000,
      });

      const models = response.data.models || [];
      return {
        healthy: true,
        message: "Ollama service is healthy",
        details: {
          modelCount: models.length,
          models: models.map((m) => m.name),
        },
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Ollama service unavailable: ${error.message}`,
        autoFix: async () => {
          try {
            const { exec } = require("child_process");
            const util = require("util");
            const execPromise = util.promisify(exec);

            // 尝试启动Docker容器
            await execPromise("docker start chainlesschain-ollama");
            await this.sleep(5000);

            // 验证服务是否启动
            await axios.get(
              `${process.env.OLLAMA_HOST || "http://localhost:11434"}/api/tags`,
            );

            return { success: true, message: "Ollama service started" };
          } catch (fixError) {
            return { success: false, message: fixError.message };
          }
        },
      };
    }
  }

  /**
   * 检查Qdrant服务
   */
  async checkQdrant() {
    try {
      const qdrantHost = process.env.QDRANT_HOST || "http://localhost:6333";
      const response = await axios.get(`${qdrantHost}/collections`, {
        timeout: 5000,
      });

      const collections = response.data.result?.collections || [];
      return {
        healthy: true,
        message: "Qdrant service is healthy",
        details: {
          collectionCount: collections.length,
          collections: collections.map((c) => c.name),
        },
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Qdrant service unavailable: ${error.message}`,
        autoFix: async () => {
          try {
            const { exec } = require("child_process");
            const util = require("util");
            const execPromise = util.promisify(exec);

            await execPromise("docker start chainlesschain-qdrant");
            await this.sleep(5000);

            await axios.get(
              `${process.env.QDRANT_HOST || "http://localhost:6333"}/collections`,
            );

            return { success: true, message: "Qdrant service started" };
          } catch (fixError) {
            return { success: false, message: fixError.message };
          }
        },
      };
    }
  }

  /**
   * 检查Project Service
   */
  async checkProjectService() {
    try {
      const serviceUrl =
        process.env.PROJECT_SERVICE_URL || "http://localhost:9090";
      const response = await axios.get(`${serviceUrl}/actuator/health`, {
        timeout: 5000,
      });

      return {
        healthy: response.data.status === "UP",
        message: "Project service is healthy",
        details: response.data,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Project service unavailable: ${error.message}`,
      };
    }
  }

  /**
   * 检查AI Service
   */
  async checkAIService() {
    try {
      const serviceUrl = process.env.AI_SERVICE_URL || "http://localhost:8001";
      const response = await axios.get(`${serviceUrl}/health`, {
        timeout: 5000,
      });

      return {
        healthy: response.data.status === "healthy",
        message: "AI service is healthy",
        details: response.data,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `AI service unavailable: ${error.message}`,
      };
    }
  }

  /**
   * 检查磁盘空间
   */
  async checkDiskSpace() {
    try {
      const userDataPath = app.getPath("userData");
      const stats = (await fs.statfs) ? fs.statfs(userDataPath) : null;

      if (!stats) {
        return {
          healthy: true,
          message: "Disk space check not available on this platform",
        };
      }

      const freeSpace = stats.bavail * stats.bsize;
      const totalSpace = stats.blocks * stats.bsize;
      const usedPercentage = ((totalSpace - freeSpace) / totalSpace) * 100;

      const isHealthy = usedPercentage < 90; // 警告阈值90%

      return {
        healthy: isHealthy,
        message: isHealthy ? "Disk space is healthy" : "Disk space is low",
        details: {
          freeSpaceGB: (freeSpace / 1024 / 1024 / 1024).toFixed(2),
          totalSpaceGB: (totalSpace / 1024 / 1024 / 1024).toFixed(2),
          usedPercentage: usedPercentage.toFixed(2),
        },
      };
    } catch (error) {
      return {
        healthy: true,
        message: `Disk space check skipped: ${error.message}`,
      };
    }
  }

  /**
   * 检查内存使用
   */
  async checkMemory() {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const usedPercentage = (heapUsedMB / heapTotalMB) * 100;

    const isHealthy = usedPercentage < 85; // 警告阈值85%

    return {
      healthy: isHealthy,
      message: isHealthy ? "Memory usage is healthy" : "Memory usage is high",
      details: {
        heapUsedMB: heapUsedMB.toFixed(2),
        heapTotalMB: heapTotalMB.toFixed(2),
        usedPercentage: usedPercentage.toFixed(2),
        rssMB: (usage.rss / 1024 / 1024).toFixed(2),
      },
      autoFix: !isHealthy
        ? async () => {
            // 触发垃圾回收
            if (global.gc) {
              global.gc();
              return { success: true, message: "Garbage collection triggered" };
            }
            return {
              success: false,
              message: "Garbage collection not available",
            };
          }
        : null,
    };
  }

  /**
   * 检查U-Key
   */
  async checkUKey() {
    try {
      // 只在Windows平台检查
      if (process.platform !== "win32") {
        return {
          healthy: true,
          message: "U-Key check skipped on non-Windows platform",
        };
      }

      const { detectUKey } = require("./ukey/ukey-manager");
      const detected = await detectUKey();

      return {
        healthy: true,
        message: detected
          ? "U-Key detected"
          : "U-Key not detected (simulation mode available)",
        details: {
          detected,
          platform: process.platform,
        },
      };
    } catch (error) {
      return {
        healthy: true,
        message: `U-Key check failed: ${error.message}`,
      };
    }
  }

  /**
   * 检查网络连接
   */
  async checkNetwork() {
    try {
      // 尝试连接到公共DNS服务器
      await axios.get("https://dns.google/resolve?name=example.com", {
        timeout: 5000,
      });

      return {
        healthy: true,
        message: "Network connectivity is healthy",
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Network connectivity issue: ${error.message}`,
      };
    }
  }

  /**
   * 获取最后的检查结果
   */
  getLastResults() {
    return this.lastResults;
  }

  /**
   * 获取健康状况摘要
   */
  getHealthSummary() {
    const results = this.lastResults;
    const summary = {
      overall: "HEALTHY",
      timestamp: new Date().toISOString(),
      checks: {
        total: Object.keys(results).length,
        passed: 0,
        failed: 0,
        errors: 0,
      },
      details: [],
    };

    for (const [name, result] of Object.entries(results)) {
      if (result.status === "PASS") {
        summary.checks.passed++;
      } else if (result.status === "FAIL") {
        summary.checks.failed++;
        summary.overall = "DEGRADED";
      } else if (result.status === "ERROR") {
        summary.checks.errors++;
        summary.overall = "UNHEALTHY";
      }

      summary.details.push({
        name,
        status: result.status,
        message: result.message,
      });
    }

    return summary;
  }

  /**
   * 记录结果到日志
   */
  async logResults(results) {
    try {
      const logPath = path.join(app.getPath("userData"), "health-logs");
      await fs.mkdir(logPath, { recursive: true });

      const filename = `health-${new Date().toISOString().split("T")[0]}.log`;
      const logFile = path.join(logPath, filename);

      const logEntry = `${new Date().toISOString()} - ${JSON.stringify(results, null, 2)}\n---\n`;
      await fs.appendFile(logFile, logEntry);
    } catch (error) {
      logger.error("Failed to save health check log:", error);
    }
  }

  /**
   * 工具函数: 睡眠
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 创建单例
let healthCheckInstance = null;

function getHealthCheckService() {
  if (!healthCheckInstance) {
    healthCheckInstance = new HealthCheckService();
  }
  return healthCheckInstance;
}

module.exports = {
  HealthCheckService,
  getHealthCheckService,
};
