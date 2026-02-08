const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const getPort = require("get-port");
const { shell } = require("electron");

/**
 * 预览管理器
 * 负责项目预览功能（静态服务器、开发服务器、文件管理器）
 */
class PreviewManager extends EventEmitter {
  constructor(mainWindow) {
    super();
    this.mainWindow = mainWindow;
    this.staticServers = new Map(); // projectId → { server, port, url }
    this.devServers = new Map(); // projectId → { process, port, url }
    this.maxServers = 3; // 最多同时运行3个服务器
  }

  /**
   * 启动静态文件服务器
   * @param {string} projectId - 项目ID
   * @param {string} rootPath - 项目根路径
   * @param {Object} options - 选项
   * @returns {Object} { url, port }
   */
  async startStaticServer(projectId, rootPath, options = {}) {
    // 如果已经有服务器在运行，先停止
    if (this.staticServers.has(projectId)) {
      await this.stopStaticServer(projectId);
    }

    // LRU 淘汰策略：如果服务器数量超过限制，关闭最老的
    if (this.staticServers.size >= this.maxServers) {
      const oldestProjectId = this.staticServers.keys().next().value;
      await this.stopStaticServer(oldestProjectId);
      logger.info(`[PreviewManager] 淘汰旧服务器: ${oldestProjectId}`);
    }

    try {
      // 动态分配端口
      const port = await getPort({ port: getPort.makeRange(3000, 3100) });

      // 创建 Express 应用
      const app = express();

      // 静态文件服务
      app.use(express.static(rootPath));

      // 处理 SPA 路由（可选）
      if (options.spa) {
        app.get("*", (req, res) => {
          res.sendFile(path.join(rootPath, "index.html"));
        });
      }

      // 启动服务器
      const server = app.listen(port);

      const url = `http://localhost:${port}`;

      this.staticServers.set(projectId, {
        server,
        port,
        url,
        rootPath,
      });

      logger.info(`[PreviewManager] 静态服务器已启动: ${url}`);

      this.emit("static-server-started", { projectId, url, port });

      return { url, port };
    } catch (error) {
      logger.error("[PreviewManager] 启动静态服务器失败:", error);
      throw error;
    }
  }

  /**
   * 停止静态文件服务器
   * @param {string} projectId - 项目ID
   */
  async stopStaticServer(projectId) {
    const serverInfo = this.staticServers.get(projectId);

    if (!serverInfo) {
      logger.info(`[PreviewManager] 没有运行的静态服务器: ${projectId}`);
      return;
    }

    return new Promise((resolve) => {
      serverInfo.server.close(() => {
        this.staticServers.delete(projectId);
        logger.info(`[PreviewManager] 静态服务器已停止: ${projectId}`);
        this.emit("static-server-stopped", { projectId });
        resolve();
      });
    });
  }

  /**
   * 启动开发服务器（npm run dev）
   * @param {string} projectId - 项目ID
   * @param {string} rootPath - 项目根路径
   * @param {string} command - 启动命令（默认 'npm run dev'）
   * @returns {Object} { url, port, process }
   */
  async startDevServer(projectId, rootPath, command = "npm run dev") {
    // 如果已经有服务器在运行，先停止
    if (this.devServers.has(projectId)) {
      await this.stopDevServer(projectId);
    }

    // LRU 淘汰策略
    if (this.devServers.size >= this.maxServers) {
      const oldestProjectId = this.devServers.keys().next().value;
      await this.stopDevServer(oldestProjectId);
      logger.info(`[PreviewManager] 淘汰旧开发服务器: ${oldestProjectId}`);
    }

    try {
      logger.info(`[PreviewManager] 启动开发服务器: ${command} in ${rootPath}`);

      // 解析命令
      const [cmd, ...args] = command.split(" ");

      // 启动子进程
      const proc = spawn(cmd, args, {
        cwd: rootPath,
        shell: true,
        env: { ...process.env },
      });

      let url = null;
      let port = null;

      // 监听输出，尝试解析端口和URL
      proc.stdout.on("data", (data) => {
        const output = data.toString();
        logger.info(`[DevServer] ${output}`);

        // 尝试匹配常见的开发服务器输出格式
        // 例如：http://localhost:5173, http://127.0.0.1:3000
        const urlMatch = output.match(
          /https?:\/\/(localhost|127\.0\.0\.1):(\d+)/,
        );
        if (urlMatch && !url) {
          port = parseInt(urlMatch[2]);
          url = urlMatch[0];

          this.devServers.set(projectId, {
            process: proc,
            port,
            url,
            rootPath,
          });

          logger.info(`[PreviewManager] 开发服务器已启动: ${url}`);

          this.emit("dev-server-started", { projectId, url, port });

          // 通知前端
          if (this.mainWindow) {
            this.mainWindow.webContents.send("preview:dev-server-ready", {
              projectId,
              url,
              port,
            });
          }
        }
      });

      proc.stderr.on("data", (data) => {
        logger.error(`[DevServer Error] ${data.toString()}`);
      });

      proc.on("close", (code) => {
        logger.info(`[PreviewManager] 开发服务器已关闭，代码: ${code}`);
        this.devServers.delete(projectId);
        this.emit("dev-server-stopped", { projectId, code });
      });

      // 等待一段时间让服务器启动
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 如果2秒后还没有检测到URL，返回一个默认值
      if (!url) {
        // 尝试常见的默认端口
        const commonPorts = [5173, 3000, 8080, 4200];
        for (const testPort of commonPorts) {
          const testUrl = `http://localhost:${testPort}`;
          // 这里可以添加端口检测逻辑
          // 暂时返回第一个端口
          url = testUrl;
          port = testPort;
          break;
        }

        this.devServers.set(projectId, {
          process: proc,
          port,
          url,
          rootPath,
        });
      }

      return { url, port, process: proc };
    } catch (error) {
      logger.error("[PreviewManager] 启动开发服务器失败:", error);
      throw error;
    }
  }

  /**
   * 停止开发服务器
   * @param {string} projectId - 项目ID
   */
  async stopDevServer(projectId) {
    const serverInfo = this.devServers.get(projectId);

    if (!serverInfo) {
      logger.info(`[PreviewManager] 没有运行的开发服务器: ${projectId}`);
      return;
    }

    return new Promise((resolve) => {
      serverInfo.process.on("close", () => {
        this.devServers.delete(projectId);
        logger.info(`[PreviewManager] 开发服务器已停止: ${projectId}`);
        resolve();
      });

      // Kill the process
      if (process.platform === "win32") {
        // Windows: 使用 taskkill
        spawn("taskkill", ["/pid", serverInfo.process.pid, "/f", "/t"]);
      } else {
        // Unix: 使用 SIGTERM
        serverInfo.process.kill("SIGTERM");
      }

      // 超时强制关闭
      setTimeout(() => {
        if (this.devServers.has(projectId)) {
          serverInfo.process.kill("SIGKILL");
          this.devServers.delete(projectId);
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * 在文件管理器中打开项目
   * @param {string} rootPath - 项目根路径
   */
  async openInExplorer(rootPath) {
    try {
      await shell.openPath(rootPath);
      logger.info(`[PreviewManager] 已在文件管理器中打开: ${rootPath}`);
      return { success: true };
    } catch (error) {
      logger.error("[PreviewManager] 打开文件管理器失败:", error);
      throw error;
    }
  }

  /**
   * 在外部浏览器中打开URL
   * @param {string} url - URL地址
   */
  async openInBrowser(url) {
    try {
      await shell.openExternal(url);
      logger.info(`[PreviewManager] 已在浏览器中打开: ${url}`);
      return { success: true };
    } catch (error) {
      logger.error("[PreviewManager] 打开浏览器失败:", error);
      throw error;
    }
  }

  /**
   * 获取运行中的服务器信息
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 服务器信息
   */
  getServerInfo(projectId) {
    const staticServer = this.staticServers.get(projectId);
    const devServer = this.devServers.get(projectId);

    if (staticServer) {
      return { type: "static", ...staticServer };
    }

    if (devServer) {
      return { type: "dev", ...devServer };
    }

    return null;
  }

  /**
   * 停止所有服务器
   */
  async stopAll() {
    logger.info("[PreviewManager] 停止所有服务器...");

    const stopPromises = [];

    // 停止所有静态服务器
    for (const projectId of this.staticServers.keys()) {
      stopPromises.push(this.stopStaticServer(projectId));
    }

    // 停止所有开发服务器
    for (const projectId of this.devServers.keys()) {
      stopPromises.push(this.stopDevServer(projectId));
    }

    await Promise.all(stopPromises);

    logger.info("[PreviewManager] 所有服务器已停止");
  }
}

module.exports = PreviewManager;
