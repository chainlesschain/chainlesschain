/**
 * 浏览器扩展 WebSocket 服务器
 *
 * 提供 WebSocket 服务，让浏览器扩展可以连接并执行命令
 *
 * 功能：
 * - 接收扩展连接
 * - 向扩展发送命令
 * - 接收扩展事件
 * - 管理多个扩展连接
 *
 * @module remote/browser-extension-server
 */

const { logger } = require("../utils/logger");
const { EventEmitter } = require("events");
const WebSocket = require("ws");

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  port: 18790,
  host: "127.0.0.1",
  maxConnections: 10,
  heartbeatInterval: 30000,
  commandTimeout: 30000,
};

/**
 * 浏览器扩展服务器类
 */
class BrowserExtensionServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULT_CONFIG, ...options };

    // WebSocket 服务器
    this.wss = null;

    // 连接的客户端
    this.clients = new Map(); // clientId -> { ws, info, connectedAt }

    // 请求跟踪
    this.requestId = 0;
    this.pendingRequests = new Map();

    // 统计
    this.stats = {
      startTime: null,
      totalConnections: 0,
      currentConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      commandsExecuted: 0,
    };

    // 心跳定时器
    this.heartbeatTimer = null;

    logger.info("[BrowserExtensionServer] 服务器已创建");
  }

  /**
   * 启动服务器
   */
  async start() {
    if (this.wss) {
      logger.warn("[BrowserExtensionServer] 服务器已运行");
      return;
    }

    logger.info(
      `[BrowserExtensionServer] 启动服务器 ${this.options.host}:${this.options.port}...`,
    );

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocket.Server({
          host: this.options.host,
          port: this.options.port,
        });

        this.wss.on("listening", () => {
          logger.info(
            `[BrowserExtensionServer] ✅ 服务器启动成功 ws://${this.options.host}:${this.options.port}`,
          );
          this.stats.startTime = Date.now();
          this.startHeartbeat();
          this.emit("started");
          resolve();
        });

        this.wss.on("connection", (ws, req) => {
          this.handleConnection(ws, req);
        });

        this.wss.on("error", (error) => {
          logger.error("[BrowserExtensionServer] 服务器错误:", error);
          this.emit("error", error);
          reject(error);
        });
      } catch (error) {
        logger.error("[BrowserExtensionServer] 启动失败:", error);
        reject(error);
      }
    });
  }

  /**
   * 处理新连接
   */
  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    const clientIp = req.socket.remoteAddress;

    logger.info(
      `[BrowserExtensionServer] 新连接: ${clientId} from ${clientIp}`,
    );

    // 检查连接限制
    if (this.clients.size >= this.options.maxConnections) {
      logger.warn("[BrowserExtensionServer] 达到最大连接数，拒绝连接");
      ws.close(1013, "Max connections reached");
      return;
    }

    // 保存客户端信息
    const clientInfo = {
      ws,
      id: clientId,
      ip: clientIp,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      info: null, // 等待注册消息
    };

    this.clients.set(clientId, clientInfo);
    this.stats.totalConnections++;
    this.stats.currentConnections = this.clients.size;

    // 设置消息处理
    ws.on("message", (data) => {
      this.handleMessage(clientId, data);
    });

    ws.on("close", () => {
      this.handleDisconnect(clientId);
    });

    ws.on("error", (error) => {
      logger.error(`[BrowserExtensionServer] 客户端错误 ${clientId}:`, error);
    });

    ws.on("pong", () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastActivity = Date.now();
      }
    });

    this.emit("connection", { clientId, ip: clientIp });
  }

  /**
   * 处理消息
   */
  handleMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    client.lastActivity = Date.now();
    this.stats.messagesReceived++;

    try {
      const message = JSON.parse(data.toString());

      // 处理注册消息
      if (message.type === "register") {
        client.info = message.data;
        logger.info(
          `[BrowserExtensionServer] 客户端注册: ${clientId}`,
          message.data,
        );
        this.emit("registered", { clientId, info: message.data });
        return;
      }

      // 处理响应
      if (message.id && this.pendingRequests.has(message.id)) {
        const { resolve, reject } = this.pendingRequests.get(message.id);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
        return;
      }

      // 处理事件
      if (message.type === "event") {
        this.emit("browserEvent", {
          clientId,
          event: message.event,
          data: message.data,
        });
        return;
      }

      // 未知消息类型
      logger.debug(`[BrowserExtensionServer] 未知消息类型: ${message.type}`);
    } catch (error) {
      logger.error(`[BrowserExtensionServer] 解析消息失败 ${clientId}:`, error);
    }
  }

  /**
   * 处理断开连接
   */
  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    logger.info(`[BrowserExtensionServer] 客户端断开: ${clientId}`);

    this.clients.delete(clientId);
    this.stats.currentConnections = this.clients.size;

    this.emit("disconnection", { clientId });
  }

  /**
   * 向扩展发送命令
   */
  async sendCommand(clientId, method, params = {}) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Client not connected: ${clientId}`);
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command timeout: ${method}`));
      }, this.options.commandTimeout);

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          this.stats.commandsExecuted++;
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      client.ws.send(JSON.stringify({ id, method, params }));
      this.stats.messagesSent++;
    });
  }

  /**
   * 向所有扩展广播命令
   */
  async broadcastCommand(method, params = {}) {
    const results = [];

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          const result = await this.sendCommand(clientId, method, params);
          results.push({ clientId, success: true, result });
        } catch (error) {
          results.push({ clientId, success: false, error: error.message });
        }
      }
    }

    return results;
  }

  /**
   * 获取第一个连接的客户端 ID
   */
  getFirstClientId() {
    const [clientId] = this.clients.keys();
    return clientId || null;
  }

  /**
   * 获取所有客户端
   */
  getClients() {
    return Array.from(this.clients.entries()).map(([id, client]) => ({
      id,
      ip: client.ip,
      connectedAt: client.connectedAt,
      lastActivity: client.lastActivity,
      info: client.info,
    }));
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          // 检查是否超时
          if (now - client.lastActivity > this.options.heartbeatInterval * 2) {
            logger.warn(`[BrowserExtensionServer] 客户端心跳超时: ${clientId}`);
            client.ws.terminate();
            continue;
          }

          // 发送 ping
          client.ws.ping();
        }
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * 停止服务器
   */
  async stop() {
    logger.info("[BrowserExtensionServer] 停止服务器...");

    // 停止心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 关闭所有连接
    for (const [_clientId, client] of this.clients) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();

    // 关闭服务器
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss.close(() => {
          this.wss = null;
          logger.info("[BrowserExtensionServer] ✅ 服务器已停止");
          this.emit("stopped");
          resolve();
        });
      });
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
    };
  }

  /**
   * 生成客户端 ID
   */
  generateClientId() {
    return `ext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 检查是否运行中
   */
  isRunning() {
    return this.wss !== null;
  }
}

// ==================== 便捷方法 ====================

/**
 * 扩展浏览器处理器 - 基于扩展服务器的浏览器操作
 */
class ExtensionBrowserHandler extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
  }

  /**
   * 处理命令
   */
  async handle(action, params, _context) {
    const clientId = params.clientId || this.server.getFirstClientId();

    if (!clientId) {
      throw new Error(
        "No browser extension connected. Please install and connect the ChainlessChain Browser Extension.",
      );
    }

    switch (action) {
      // 标签页操作
      case "listTabs":
        return await this.server.sendCommand(clientId, "tabs.list", params);
      case "getTab":
        return await this.server.sendCommand(clientId, "tabs.get", params);
      case "createTab":
        return await this.server.sendCommand(clientId, "tabs.create", params);
      case "closeTab":
        return await this.server.sendCommand(clientId, "tabs.close", params);
      case "focusTab":
        return await this.server.sendCommand(clientId, "tabs.focus", params);
      case "navigate":
        return await this.server.sendCommand(clientId, "tabs.navigate", params);
      case "reload":
        return await this.server.sendCommand(clientId, "tabs.reload", params);
      case "goBack":
        return await this.server.sendCommand(clientId, "tabs.goBack", params);
      case "goForward":
        return await this.server.sendCommand(
          clientId,
          "tabs.goForward",
          params,
        );

      // 页面操作
      case "getPageContent":
        return await this.server.sendCommand(
          clientId,
          "page.getContent",
          params,
        );
      case "executeScript":
        return await this.server.sendCommand(
          clientId,
          "page.executeScript",
          params,
        );
      case "screenshot":
        return await this.server.sendCommand(
          clientId,
          "page.screenshot",
          params,
        );

      // 书签
      case "getBookmarks":
        return await this.server.sendCommand(
          clientId,
          "bookmarks.getTree",
          params,
        );
      case "searchBookmarks":
        return await this.server.sendCommand(
          clientId,
          "bookmarks.search",
          params,
        );
      case "createBookmark":
        return await this.server.sendCommand(
          clientId,
          "bookmarks.create",
          params,
        );
      case "removeBookmark":
        return await this.server.sendCommand(
          clientId,
          "bookmarks.remove",
          params,
        );

      // 历史
      case "getHistory":
        return await this.server.sendCommand(
          clientId,
          "history.search",
          params,
        );
      case "deleteHistory":
        return await this.server.sendCommand(
          clientId,
          "history.delete",
          params,
        );

      // 剪贴板
      case "readClipboard":
        return await this.server.sendCommand(
          clientId,
          "clipboard.read",
          params,
        );
      case "writeClipboard":
        return await this.server.sendCommand(
          clientId,
          "clipboard.write",
          params,
        );

      // 通知
      case "showNotification":
        return await this.server.sendCommand(
          clientId,
          "notification.show",
          params,
        );

      // 状态
      case "getStatus":
        return await this.server.sendCommand(clientId, "status.get", params);

      // Cookie 管理
      case "getCookies":
        return await this.server.sendCommand(
          clientId,
          "cookies.getAll",
          params,
        );
      case "getCookie":
        return await this.server.sendCommand(clientId, "cookies.get", params);
      case "setCookie":
        return await this.server.sendCommand(clientId, "cookies.set", params);
      case "removeCookie":
        return await this.server.sendCommand(
          clientId,
          "cookies.remove",
          params,
        );
      case "clearCookies":
        return await this.server.sendCommand(clientId, "cookies.clear", params);

      // 下载管理
      case "listDownloads":
        return await this.server.sendCommand(
          clientId,
          "downloads.list",
          params,
        );
      case "download":
        return await this.server.sendCommand(
          clientId,
          "downloads.download",
          params,
        );
      case "cancelDownload":
        return await this.server.sendCommand(
          clientId,
          "downloads.cancel",
          params,
        );
      case "pauseDownload":
        return await this.server.sendCommand(
          clientId,
          "downloads.pause",
          params,
        );
      case "resumeDownload":
        return await this.server.sendCommand(
          clientId,
          "downloads.resume",
          params,
        );
      case "openDownload":
        return await this.server.sendCommand(
          clientId,
          "downloads.open",
          params,
        );
      case "showDownload":
        return await this.server.sendCommand(
          clientId,
          "downloads.show",
          params,
        );
      case "eraseDownloads":
        return await this.server.sendCommand(
          clientId,
          "downloads.erase",
          params,
        );

      // 窗口管理
      case "getAllWindows":
        return await this.server.sendCommand(
          clientId,
          "windows.getAll",
          params,
        );
      case "getWindow":
        return await this.server.sendCommand(clientId, "windows.get", params);
      case "createWindow":
        return await this.server.sendCommand(
          clientId,
          "windows.create",
          params,
        );
      case "updateWindow":
        return await this.server.sendCommand(
          clientId,
          "windows.update",
          params,
        );
      case "removeWindow":
        return await this.server.sendCommand(
          clientId,
          "windows.remove",
          params,
        );
      case "getCurrentWindow":
        return await this.server.sendCommand(
          clientId,
          "windows.getCurrent",
          params,
        );

      // 存储访问
      case "getLocalStorage":
        return await this.server.sendCommand(
          clientId,
          "storage.getLocal",
          params,
        );
      case "setLocalStorage":
        return await this.server.sendCommand(
          clientId,
          "storage.setLocal",
          params,
        );
      case "getSessionStorage":
        return await this.server.sendCommand(
          clientId,
          "storage.getSession",
          params,
        );
      case "setSessionStorage":
        return await this.server.sendCommand(
          clientId,
          "storage.setSession",
          params,
        );
      case "clearLocalStorage":
        return await this.server.sendCommand(
          clientId,
          "storage.clearLocal",
          params,
        );
      case "clearSessionStorage":
        return await this.server.sendCommand(
          clientId,
          "storage.clearSession",
          params,
        );

      // 元素交互
      case "hoverElement":
        return await this.server.sendCommand(clientId, "element.hover", params);
      case "focusElement":
        return await this.server.sendCommand(clientId, "element.focus", params);
      case "blurElement":
        return await this.server.sendCommand(clientId, "element.blur", params);
      case "selectText":
        return await this.server.sendCommand(
          clientId,
          "element.select",
          params,
        );
      case "getAttribute":
        return await this.server.sendCommand(
          clientId,
          "element.getAttribute",
          params,
        );
      case "setAttribute":
        return await this.server.sendCommand(
          clientId,
          "element.setAttribute",
          params,
        );
      case "getBoundingRect":
        return await this.server.sendCommand(
          clientId,
          "element.getBoundingRect",
          params,
        );
      case "isVisible":
        return await this.server.sendCommand(
          clientId,
          "element.isVisible",
          params,
        );
      case "waitForSelector":
        return await this.server.sendCommand(
          clientId,
          "element.waitForSelector",
          params,
        );
      case "dragDrop":
        return await this.server.sendCommand(
          clientId,
          "element.dragDrop",
          params,
        );

      // 页面操作
      case "printPage":
        return await this.server.sendCommand(clientId, "page.print", params);
      case "saveToPdf":
        return await this.server.sendCommand(clientId, "page.pdf", params);
      case "getConsoleLogs":
        return await this.server.sendCommand(
          clientId,
          "page.getConsole",
          params,
        );
      case "setViewport":
        return await this.server.sendCommand(
          clientId,
          "page.setViewport",
          params,
        );
      case "emulateDevice":
        return await this.server.sendCommand(
          clientId,
          "page.emulateDevice",
          params,
        );
      case "setGeolocation":
        return await this.server.sendCommand(
          clientId,
          "page.setGeolocation",
          params,
        );

      // 浏览数据
      case "clearBrowsingData":
        return await this.server.sendCommand(
          clientId,
          "browsingData.clear",
          params,
        );

      // 网络拦截
      case "enableNetworkInterception":
        return await this.server.sendCommand(
          clientId,
          "network.enableInterception",
          params,
        );
      case "disableNetworkInterception":
        return await this.server.sendCommand(
          clientId,
          "network.disableInterception",
          params,
        );
      case "setRequestBlocking":
        return await this.server.sendCommand(
          clientId,
          "network.setRequestBlocking",
          params,
        );
      case "clearRequestBlocking":
        return await this.server.sendCommand(
          clientId,
          "network.clearRequestBlocking",
          params,
        );
      case "getNetworkRequests":
        return await this.server.sendCommand(
          clientId,
          "network.getRequests",
          params,
        );
      case "mockResponse":
        return await this.server.sendCommand(
          clientId,
          "network.mockResponse",
          params,
        );

      // 控制台捕获
      case "enableConsoleCapture":
        return await this.server.sendCommand(
          clientId,
          "console.enable",
          params,
        );
      case "disableConsoleCapture":
        return await this.server.sendCommand(
          clientId,
          "console.disable",
          params,
        );
      case "getConsoleLogs":
        return await this.server.sendCommand(
          clientId,
          "console.getLogs",
          params,
        );
      case "clearConsoleLogs":
        return await this.server.sendCommand(
          clientId,
          "console.clear",
          params,
        );

      // IndexedDB
      case "getIndexedDBDatabases":
        return await this.server.sendCommand(
          clientId,
          "indexedDB.getDatabases",
          params,
        );
      case "getIndexedDBData":
        return await this.server.sendCommand(
          clientId,
          "indexedDB.getData",
          params,
        );
      case "setIndexedDBData":
        return await this.server.sendCommand(
          clientId,
          "indexedDB.setData",
          params,
        );
      case "deleteIndexedDBData":
        return await this.server.sendCommand(
          clientId,
          "indexedDB.deleteData",
          params,
        );
      case "clearIndexedDBStore":
        return await this.server.sendCommand(
          clientId,
          "indexedDB.clearStore",
          params,
        );

      // 性能
      case "getPerformanceMetrics":
        return await this.server.sendCommand(
          clientId,
          "performance.getMetrics",
          params,
        );
      case "getPerformanceEntries":
        return await this.server.sendCommand(
          clientId,
          "performance.getEntries",
          params,
        );
      case "startPerformanceTrace":
        return await this.server.sendCommand(
          clientId,
          "performance.startTrace",
          params,
        );
      case "stopPerformanceTrace":
        return await this.server.sendCommand(
          clientId,
          "performance.stopTrace",
          params,
        );

      // CSS 注入
      case "injectCSS":
        return await this.server.sendCommand(clientId, "css.inject", params);
      case "removeCSS":
        return await this.server.sendCommand(clientId, "css.remove", params);

      // 无障碍
      case "getAccessibilityTree":
        return await this.server.sendCommand(
          clientId,
          "accessibility.getTree",
          params,
        );
      case "getElementRole":
        return await this.server.sendCommand(
          clientId,
          "accessibility.getRole",
          params,
        );

      // 框架管理
      case "listFrames":
        return await this.server.sendCommand(clientId, "frames.list", params);
      case "executeScriptInFrame":
        return await this.server.sendCommand(
          clientId,
          "frames.executeScript",
          params,
        );

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}

module.exports = {
  BrowserExtensionServer,
  ExtensionBrowserHandler,
};
