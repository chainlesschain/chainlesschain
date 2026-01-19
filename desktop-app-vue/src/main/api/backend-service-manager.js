/**
 * Backend Service Manager
 * 管理桌面应用的后端服务（PostgreSQL, Redis, Qdrant, Project Service）
 * 仅在生产环境（打包后）自动启动和管理这些服务
 */

const { logger, createLogger } = require('../utils/logger.js');
const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const net = require("net");

class BackendServiceManager {
  constructor() {
    this.services = new Map();
    this.isProduction = process.env.NODE_ENV === "production" || app.isPackaged;
    this.appPath = this.isProduction ? process.resourcesPath : app.getAppPath();
    this.backendDir = path.join(this.appPath, "backend");
    this.dataDir = path.join(path.dirname(this.appPath), "data");
    this.logsDir = path.join(this.dataDir, "logs");
    this.startupScript = path.join(
      this.appPath,
      "scripts",
      "start-backend-services.bat",
    );
    this.stopScript = path.join(
      this.appPath,
      "scripts",
      "stop-backend-services.bat",
    );

    // 确保目录存在
    this.ensureDirectories();
  }

  /**
   * 确保必要的目录存在
   */
  ensureDirectories() {
    const dirs = [
      this.dataDir,
      this.logsDir,
      path.join(this.dataDir, "postgres"),
      path.join(this.dataDir, "redis"),
      path.join(this.dataDir, "qdrant"),
    ];

    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 检查端口是否被占用
   */
  async isPortInUse(port) {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close();
        resolve(false);
      });

      server.listen(port);
    });
  }

  /**
   * 检查服务是否正在运行
   */
  async checkService(name, port) {
    return await this.isPortInUse(port);
  }

  /**
   * 启动所有后端服务
   */
  async startServices() {
    // 开发环境下不启动后端服务（假设使用 Docker）
    if (!this.isProduction) {
      logger.info(
        "[Backend Services] Running in development mode, skipping backend service startup",
      );
      logger.info(
        "[Backend Services] Please ensure Docker services are running (docker-compose up)",
      );
      return;
    }

    logger.info("[Backend Services] Starting backend services...");
    logger.info("[Backend Services] App path:", this.appPath);
    logger.info("[Backend Services] Backend dir:", this.backendDir);
    logger.info("[Backend Services] Data dir:", this.dataDir);

    try {
      // 检查启动脚本是否存在
      if (!fs.existsSync(this.startupScript)) {
        logger.warn(
          `[Backend Services] Startup script not found: ${this.startupScript}`,
        );
        logger.warn(
          "[Backend Services] Attempting to start services individually...",
        );
        await this.startIndividualServices();
        return;
      }

      // 使用批处理脚本启动所有服务
      const startProcess = spawn("cmd.exe", ["/c", this.startupScript], {
        windowsHide: false,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      startProcess.stdout.on("data", (data) => {
        logger.info(`[Backend Services] ${data.toString().trim()}`);
      });

      startProcess.stderr.on("data", (data) => {
        const message = data.toString().trim();
        if (message) {
          logger.error(`[Backend Services Error] ${message}`);
        }
      });

      startProcess.on("error", (error) => {
        logger.error("[Backend Services] Failed to start services:", error);
      });

      startProcess.on("exit", (code) => {
        if (code === 0) {
          logger.info("[Backend Services] All services started successfully");
        } else {
          logger.error(
            `[Backend Services] Startup script exited with code ${code}`,
          );
        }
      });

      this.services.set("startup", startProcess);

      // 等待服务启动
      await this.waitForServices();
    } catch (error) {
      logger.error("[Backend Services] Error starting services:", error);
    }
  }

  /**
   * 单独启动各个服务（备用方案）
   */
  async startIndividualServices() {
    const services = [
      { name: "PostgreSQL", port: 5432, exe: "postgres.exe" },
      { name: "Redis", port: 6379, exe: "redis-server.exe" },
      { name: "Qdrant", port: 6333, exe: "qdrant.exe" },
      { name: "Project Service", port: 9090, exe: "java.exe" },
    ];

    for (const service of services) {
      const isRunning = await this.checkService(service.name, service.port);
      if (isRunning) {
        logger.info(
          `[Backend Services] ${service.name} is already running on port ${service.port}`,
        );
      } else {
        logger.info(
          `[Backend Services] ${service.name} is not running, may need manual start`,
        );
      }
    }
  }

  /**
   * 等待服务启动完成
   */
  async waitForServices() {
    const services = [
      { name: "PostgreSQL", port: 5432 },
      { name: "Redis", port: 6379 },
      { name: "Qdrant", port: 6333 },
      { name: "Project Service", port: 9090 },
    ];

    const maxRetries = 30; // 最多等待30秒
    const retryDelay = 1000; // 每次重试间隔1秒

    for (const service of services) {
      let retries = 0;
      let isRunning = false;

      while (retries < maxRetries && !isRunning) {
        isRunning = await this.checkService(service.name, service.port);
        if (!isRunning) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retries++;
        }
      }

      if (isRunning) {
        logger.info(
          `[Backend Services] ✓ ${service.name} is ready (port ${service.port})`,
        );
      } else {
        logger.warn(
          `[Backend Services] ✗ ${service.name} failed to start (port ${service.port})`,
        );
      }
    }
  }

  /**
   * 停止所有后端服务
   */
  async stopServices() {
    if (!this.isProduction) {
      logger.info(
        "[Backend Services] Running in development mode, skipping service shutdown",
      );
      return;
    }

    logger.info("[Backend Services] Stopping backend services...");

    try {
      if (fs.existsSync(this.stopScript)) {
        // 验证脚本路径安全性 - 必须在应用目录下
        const normalizedPath = path.normalize(this.stopScript);
        if (!normalizedPath.startsWith(this.appPath)) {
          throw new Error("Invalid script path");
        }
        // 使用 spawn 替代 execSync 避免 shell 注入
        const { spawnSync } = require("child_process");
        spawnSync("cmd", ["/c", normalizedPath], {
          windowsHide: true,
          timeout: 10000,
        });
        logger.info("[Backend Services] All services stopped successfully");
      } else {
        // 备用方案：直接杀进程
        await this.killServiceProcesses();
      }
    } catch (error) {
      logger.error("[Backend Services] Error stopping services:", error);
      // 强制杀进程
      await this.killServiceProcesses();
    }

    // 清理已保存的进程引用
    this.services.clear();
  }

  /**
   * 强制终止服务进程
   */
  async killServiceProcesses() {
    // 白名单 - 只允许终止这些进程
    const allowedProcesses = new Set([
      "java.exe",
      "qdrant.exe",
      "redis-server.exe",
      "postgres.exe",
    ]);

    for (const processName of allowedProcesses) {
      try {
        // 使用 spawnSync 替代 execSync 避免 shell 注入
        const { spawnSync } = require("child_process");
        spawnSync("taskkill", ["/F", "/IM", processName, "/T"], {
          windowsHide: true,
          timeout: 3000,
        });
        logger.info(`[Backend Services] Killed ${processName}`);
      } catch (error) {
        // 进程可能不存在，忽略错误
      }
    }
  }

  /**
   * 获取服务状态
   */
  async getServicesStatus() {
    const services = [
      { name: "PostgreSQL", port: 5432 },
      { name: "Redis", port: 6379 },
      { name: "Qdrant", port: 6333 },
      { name: "Project Service", port: 9090 },
    ];

    const status = {};

    for (const service of services) {
      const isRunning = await this.checkService(service.name, service.port);
      status[service.name] = {
        running: isRunning,
        port: service.port,
      };
    }

    return status;
  }

  /**
   * 重启服务
   */
  async restartServices() {
    logger.info("[Backend Services] Restarting services...");
    await this.stopServices();
    await new Promise((resolve) => setTimeout(resolve, 3000)); // 等待3秒
    await this.startServices();
  }
}

// 单例模式
let instance = null;

function getBackendServiceManager() {
  if (!instance) {
    instance = new BackendServiceManager();
  }
  return instance;
}

module.exports = { BackendServiceManager, getBackendServiceManager };
