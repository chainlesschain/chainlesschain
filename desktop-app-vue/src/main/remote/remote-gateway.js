/**
 * 远程网关 - 统一的远程命令处理入口
 *
 * 功能：
 * - 集成 P2P 命令适配器
 * - 集成权限验证器
 * - 集成命令路由器
 * - 统一的命令处理流程
 * - 事件广播
 * - 统计监控
 *
 * @module remote/remote-gateway
 */

const { logger } = require("../utils/logger");
const { EventEmitter } = require("events");
const { P2PCommandAdapter } = require("./p2p-command-adapter");
const { PermissionGate } = require("./permission-gate");
const { CommandRouter } = require("./command-router");

// 导入命令处理器
const AICommandHandler = require("./handlers/ai-handler");
const SystemCommandHandler = require("./handlers/system-handler");
const { FileTransferHandler } = require("./handlers/file-transfer-handler");
const { RemoteDesktopHandler } = require("./handlers/remote-desktop-handler");
const KnowledgeHandler = require("./handlers/knowledge-handler");
const CommandHistoryHandler = require("./handlers/command-history-handler");
const { DeviceManagerHandler } = require("./handlers/device-manager-handler");
const { ClipboardHandler } = require("./handlers/clipboard-handler");
const { NotificationHandler } = require("./handlers/notification-handler");
const { WorkflowHandler } = require("./handlers/workflow-handler");
const { BrowserHandler } = require("./handlers/browser-handler");
const { PowerHandler } = require("./handlers/power-handler");
const { ProcessHandler } = require("./handlers/process-handler");
const { MediaHandler } = require("./handlers/media-handler");
const { NetworkHandler } = require("./handlers/network-handler");
const { StorageHandler } = require("./handlers/storage-handler");
const { DisplayHandler } = require("./handlers/display-handler");
const { InputHandler } = require("./handlers/input-handler");
const { ApplicationHandler } = require("./handlers/application-handler");
const { SystemInfoHandler } = require("./handlers/system-info-handler");
const { SecurityHandler } = require("./handlers/security-handler");
const { UserBrowserHandler } = require("./handlers/user-browser-handler");
const {
  BrowserExtensionServer,
  ExtensionBrowserHandler,
} = require("./browser-extension-server");

/**
 * 远程网关类
 */
class RemoteGateway extends EventEmitter {
  constructor(dependencies, options = {}) {
    super();

    // 依赖注入
    this.p2pManager = dependencies.p2pManager;
    this.didManager = dependencies.didManager;
    this.ukeyManager = dependencies.ukeyManager;
    this.database = dependencies.database;
    this.mainWindow = dependencies.mainWindow;
    this.aiEngine = dependencies.aiEngine;
    this.ragManager = dependencies.ragManager;

    // 配置选项
    this.options = {
      enableP2P: options.enableP2P !== false,
      enableWebSocket: options.enableWebSocket !== false,
      wsPort: options.wsPort || 18789,
      wsHost: options.wsHost || "127.0.0.1",
      ...options,
    };

    // 核心组件
    this.p2pCommandAdapter = null;
    this.permissionGate = null;
    this.commandRouter = null;

    // 命令处理器
    this.handlers = {};

    // 状态
    this.initialized = false;
    this.running = false;

    // 统计信息
    this.stats = {
      startTime: null,
      totalCommands: 0,
      successCommands: 0,
      failedCommands: 0,
      permissionDenied: 0,
      connectedDevices: 0,
    };
  }

  /**
   * 初始化网关
   */
  async initialize() {
    if (this.initialized) {
      logger.info("[RemoteGateway] 已经初始化");
      return;
    }

    logger.info("[RemoteGateway] 初始化远程网关...");

    try {
      // 1. 初始化权限验证器
      await this.initializePermissionGate();

      // 2. 初始化命令路由器
      await this.initializeCommandRouter();

      // 3. 初始化 P2P 命令适配器
      if (this.options.enableP2P && this.p2pManager) {
        await this.initializeP2PCommandAdapter();
      }

      // 4. 注册命令处理器
      await this.registerCommandHandlers();

      // 5. 设置事件监听
      this.setupEventHandlers();

      this.initialized = true;
      this.running = true;
      this.stats.startTime = Date.now();

      logger.info("[RemoteGateway] ✅ 远程网关初始化完成");

      this.emit("initialized");
    } catch (error) {
      logger.error("[RemoteGateway] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 初始化权限验证器
   */
  async initializePermissionGate() {
    logger.info("[RemoteGateway] 初始化权限验证器...");

    this.permissionGate = new PermissionGate(
      this.didManager,
      this.ukeyManager,
      this.database,
      this.options.permission || {},
    );

    await this.permissionGate.initialize();

    logger.info("[RemoteGateway] 权限验证器已初始化");
  }

  /**
   * 初始化命令路由器
   */
  async initializeCommandRouter() {
    logger.info("[RemoteGateway] 初始化命令路由器...");

    this.commandRouter = new CommandRouter({
      enableLogging: this.options.enableCommandLogging !== false,
      enableStats: this.options.enableCommandStats !== false,
    });

    logger.info("[RemoteGateway] 命令路由器已初始化");
  }

  /**
   * 初始化 P2P 命令适配器
   */
  async initializeP2PCommandAdapter() {
    logger.info("[RemoteGateway] 初始化 P2P 命令适配器...");

    this.p2pCommandAdapter = new P2PCommandAdapter(
      this.p2pManager,
      this.permissionGate,
      this.options.p2p || {},
    );

    await this.p2pCommandAdapter.initialize();

    logger.info("[RemoteGateway] P2P 命令适配器已初始化");
  }

  /**
   * 注册命令处理器
   */
  async registerCommandHandlers() {
    logger.info("[RemoteGateway] 注册命令处理器...");

    // 1. AI 命令处理器
    this.handlers.ai = new AICommandHandler(
      this.aiEngine,
      this.ragManager,
      this.database,
    );
    this.commandRouter.registerHandler("ai", this.handlers.ai);

    // 2. 系统命令处理器
    this.handlers.system = new SystemCommandHandler(this.mainWindow);
    this.commandRouter.registerHandler("system", this.handlers.system);

    // 3. 文件传输处理器
    this.handlers.file = new FileTransferHandler(
      this.database,
      this.options.fileTransfer || {},
    );
    this.commandRouter.registerHandler("file", this.handlers.file);

    // 4. 远程桌面处理器
    this.handlers.desktop = new RemoteDesktopHandler(
      this.database,
      this.options.remoteDesktop || {},
    );
    this.commandRouter.registerHandler("desktop", this.handlers.desktop);

    // 5. 知识库处理器
    this.handlers.knowledge = new KnowledgeHandler(
      this.database,
      this.ragManager,
    );
    this.commandRouter.registerHandler("knowledge", this.handlers.knowledge);

    // 6. 命令历史处理器
    this.handlers.history = new CommandHistoryHandler(
      this.database,
      this.options.commandHistory || {},
    );
    this.commandRouter.registerHandler("history", this.handlers.history);

    // 7. 设备管理处理器
    this.handlers.device = new DeviceManagerHandler(
      this.database,
      this.p2pManager,
      this.permissionGate,
      this.options.deviceManager || {},
    );
    this.commandRouter.registerHandler("device", this.handlers.device);

    // 8. 剪贴板同步处理器
    this.handlers.clipboard = new ClipboardHandler(
      this.database,
      this.options.clipboard || {},
    );
    // 设置事件发射器以便广播剪贴板变化
    this.handlers.clipboard.setEventEmitter(this);
    this.commandRouter.registerHandler("clipboard", this.handlers.clipboard);

    // 9. 通知同步处理器
    this.handlers.notification = new NotificationHandler(
      this.database,
      this.options.notification || {},
    );
    // 设置事件发射器以便发送通知到移动端
    this.handlers.notification.setEventEmitter(this);
    this.commandRouter.registerHandler(
      "notification",
      this.handlers.notification,
    );

    // 10. 工作流自动化处理器
    // 创建命令执行器函数
    const commandExecutor = async (method, params) => {
      // 在本地执行命令
      return await this.commandRouter.route(
        { method, params },
        { channel: "workflow", timestamp: Date.now() },
      );
    };

    this.handlers.workflow = new WorkflowHandler(
      this.database,
      commandExecutor,
      this.options.workflow || {},
    );
    this.handlers.workflow.setEventEmitter(this);
    this.commandRouter.registerHandler("workflow", this.handlers.workflow);

    // 11. 浏览器自动化处理器
    this.handlers.browser = new BrowserHandler(this.options.browser || {});
    this.commandRouter.registerHandler("browser", this.handlers.browser);

    // 12. 电源控制处理器
    this.handlers.power = new PowerHandler(this.options.power || {});
    this.commandRouter.registerHandler("power", this.handlers.power);

    // 13. 进程管理处理器
    this.handlers.process = new ProcessHandler(this.options.process || {});
    this.commandRouter.registerHandler("process", this.handlers.process);

    // 14. 媒体控制处理器
    this.handlers.media = new MediaHandler(this.options.media || {});
    this.commandRouter.registerHandler("media", this.handlers.media);

    // 15. 网络信息处理器
    this.handlers.network = new NetworkHandler(this.options.network || {});
    this.commandRouter.registerHandler("network", this.handlers.network);

    // 16. 存储信息处理器
    this.handlers.storage = new StorageHandler(this.options.storage || {});
    this.commandRouter.registerHandler("storage", this.handlers.storage);

    // 17. 显示器信息处理器
    this.handlers.display = new DisplayHandler(this.options.display || {});
    this.commandRouter.registerHandler("display", this.handlers.display);

    // 18. 输入控制处理器
    this.handlers.input = new InputHandler(this.options.input || {});
    this.commandRouter.registerHandler("input", this.handlers.input);

    // 19. 应用程序管理处理器
    this.handlers.app = new ApplicationHandler(this.options.app || {});
    this.commandRouter.registerHandler("app", this.handlers.app);

    // 20. 系统信息处理器
    this.handlers.sysinfo = new SystemInfoHandler(this.options.sysinfo || {});
    this.commandRouter.registerHandler("sysinfo", this.handlers.sysinfo);

    // 21. 安全操作处理器
    this.handlers.security = new SecurityHandler(this.options.security || {});
    this.commandRouter.registerHandler("security", this.handlers.security);

    // 22. 用户浏览器控制处理器 (通过 CDP)
    this.handlers.userBrowser = new UserBrowserHandler(
      this.options.userBrowser || {},
    );
    this.commandRouter.registerHandler(
      "userBrowser",
      this.handlers.userBrowser,
    );

    // 23. 浏览器扩展服务器和处理器
    this.browserExtensionServer = new BrowserExtensionServer(
      this.options.browserExtension || {},
    );
    this.handlers.extension = new ExtensionBrowserHandler(
      this.browserExtensionServer,
    );
    this.commandRouter.registerHandler("extension", this.handlers.extension);

    // 启动扩展服务器（异步）
    this.browserExtensionServer.start().catch((err) => {
      logger.warn("[RemoteGateway] 浏览器扩展服务器启动失败:", err.message);
    });

    // 监听扩展事件
    this.browserExtensionServer.on("connection", (data) => {
      logger.info("[RemoteGateway] 浏览器扩展已连接:", data.clientId);
      this.emit("extension:connected", data);
    });

    this.browserExtensionServer.on("disconnection", (data) => {
      logger.info("[RemoteGateway] 浏览器扩展已断开:", data.clientId);
      this.emit("extension:disconnected", data);
    });

    this.browserExtensionServer.on("browserEvent", (data) => {
      this.emit("browser:event", data);
    });

    // 未来扩展处理器（按需实现）:
    // - ChannelHandler: 多渠道消息处理器（微信、Telegram等）
    // 当需要这些功能时，创建相应的Handler类并在此注册

    logger.info(
      `[RemoteGateway] 已注册 ${Object.keys(this.handlers).length} 个命令处理器`,
    );
  }

  /**
   * 设置事件监听
   */
  setupEventHandlers() {
    // 监听 P2P 命令事件
    if (this.p2pCommandAdapter) {
      this.p2pCommandAdapter.on("command", async (data) => {
        await this.handleCommand(data);
      });

      this.p2pCommandAdapter.on("device:connected", (peerId) => {
        this.stats.connectedDevices++;
        this.emit("device:connected", peerId);
      });

      this.p2pCommandAdapter.on("device:disconnected", (peerId) => {
        this.stats.connectedDevices = Math.max(
          0,
          this.stats.connectedDevices - 1,
        );
        this.emit("device:disconnected", peerId);
      });

      this.p2pCommandAdapter.on("device:registered", (data) => {
        this.emit("device:registered", data);
      });
    }

    logger.info("[RemoteGateway] 事件监听已设置");
  }

  /**
   * 处理命令（核心方法）
   */
  async handleCommand(data) {
    const { peerId, request, sendResponse } = data;
    const { id, method, params, auth } = request;

    this.stats.totalCommands++;

    const startTime = Date.now();
    logger.info(`[RemoteGateway] 处理命令: ${method} from ${peerId}`);

    try {
      // 0. 验证 auth 对象存在且完整
      if (
        !auth ||
        !auth.did ||
        !auth.signature ||
        !auth.timestamp ||
        !auth.nonce
      ) {
        logger.warn(`[RemoteGateway] 认证信息不完整: ${method} from ${peerId}`);
        const errorResponse = {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32001,
            message: "Permission Denied",
            data: "Incomplete authentication information",
          },
        };
        sendResponse(errorResponse);
        this.stats.permissionDenied++;
        return;
      }

      // 1. 路由命令到处理器
      const response = await this.commandRouter.route(request, {
        peerId,
        did: auth.did,
        channel: "p2p",
        timestamp: Date.now(),
      });

      // 2. 发送响应
      sendResponse(response);

      // 3. 更新统计
      if (response.error) {
        this.stats.failedCommands++;
      } else {
        this.stats.successCommands++;
      }

      const duration = Date.now() - startTime;

      // 4. 记录命令历史
      if (this.handlers.history) {
        this.handlers.history
          .recordCommand({
            requestId: id,
            method,
            params,
            context: {
              peerId,
              did: auth.did,
              channel: "p2p",
            },
            result: response.result,
            error: response.error,
            duration,
            timestamp: startTime,
          })
          .catch((err) => {
            logger.warn("[RemoteGateway] 记录命令历史失败:", err);
          });
      }

      // 5. 触发事件
      this.emit("command:completed", {
        method,
        peerId,
        success: !response.error,
        duration,
      });
    } catch (error) {
      logger.error("[RemoteGateway] 处理命令失败:", error);

      const duration = Date.now() - startTime;

      // 发送错误响应
      const errorResponse = {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: "Internal Error",
          data: error.message,
        },
      };

      sendResponse(errorResponse);

      this.stats.failedCommands++;

      // 记录错误命令历史
      if (this.handlers.history) {
        this.handlers.history
          .recordCommand({
            requestId: id,
            method,
            params,
            context: {
              peerId,
              did: auth?.did,
              channel: "p2p",
            },
            result: null,
            error: errorResponse.error,
            duration,
            timestamp: startTime,
          })
          .catch((err) => {
            logger.warn("[RemoteGateway] 记录命令历史失败:", err);
          });
      }
    }
  }

  /**
   * 主动发送命令到设备（PC -> Android）
   */
  async sendCommand(peerId, method, params, options = {}) {
    if (!this.p2pCommandAdapter) {
      throw new Error("P2P Command Adapter not initialized");
    }

    logger.info(`[RemoteGateway] 发送命令: ${method} to ${peerId}`);

    try {
      const response = await this.p2pCommandAdapter.sendCommand(
        peerId,
        method,
        params,
        options,
      );

      return response;
    } catch (error) {
      logger.error("[RemoteGateway] 发送命令失败:", error);
      throw error;
    }
  }

  /**
   * 广播事件到所有设备
   */
  broadcastEvent(method, params, targetDevices = null) {
    if (!this.p2pCommandAdapter) {
      logger.warn(
        "[RemoteGateway] P2P Command Adapter not initialized, cannot broadcast",
      );
      return;
    }

    logger.info(`[RemoteGateway] 广播事件: ${method}`);

    this.p2pCommandAdapter.broadcastEvent(method, params, targetDevices);
  }

  /**
   * 获取已连接设备列表
   */
  getConnectedDevices() {
    if (!this.p2pCommandAdapter) {
      return [];
    }

    return this.p2pCommandAdapter.getConnectedDevices();
  }

  /**
   * 断开设备连接
   * @param {string} peerId - 设备的 Peer ID 或 DID
   * @returns {Promise<Object>} 断开结果
   */
  async disconnectDevice(peerId) {
    logger.info(`[RemoteGateway] 断开设备连接: ${peerId}`);

    try {
      // 1. 通过 P2P 适配器断开连接
      if (this.p2pCommandAdapter) {
        await this.p2pCommandAdapter.disconnectPeer(peerId);
      }

      // 2. 通过设备管理处理器更新状态
      if (this.handlers.device) {
        await this.handlers.device.disconnectDevice(
          { deviceDid: peerId },
          { channel: "local" },
        );
      }

      // 3. 更新统计
      this.stats.connectedDevices = Math.max(
        0,
        this.stats.connectedDevices - 1,
      );

      // 4. 触发事件
      this.emit("device:disconnected", peerId);

      logger.info(`[RemoteGateway] ✓ 设备已断开: ${peerId}`);

      return {
        success: true,
        peerId,
        message: "Device disconnected successfully",
      };
    } catch (error) {
      logger.error(`[RemoteGateway] 断开设备失败: ${peerId}`, error);
      throw error;
    }
  }

  /**
   * 设置设备权限
   */
  async setDevicePermission(did, level, options = {}) {
    if (!this.permissionGate) {
      throw new Error("Permission Gate not initialized");
    }

    return await this.permissionGate.setDevicePermissionLevel(
      did,
      level,
      options,
    );
  }

  /**
   * 获取设备权限
   */
  async getDevicePermission(did) {
    if (!this.permissionGate) {
      throw new Error("Permission Gate not initialized");
    }

    return await this.permissionGate.getDevicePermissionLevel(did);
  }

  /**
   * 获取审计日志
   */
  getAuditLogs(options = {}) {
    if (!this.permissionGate) {
      return [];
    }

    return this.permissionGate.getAuditLogs(options);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = {
      ...this.stats,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      successRate:
        this.stats.totalCommands > 0
          ? (
              (this.stats.successCommands / this.stats.totalCommands) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };

    // 添加路由器统计
    if (this.commandRouter) {
      stats.router = this.commandRouter.getStats();
    }

    // 添加 P2P 适配器统计
    if (this.p2pCommandAdapter) {
      stats.p2p = this.p2pCommandAdapter.getStats();
    }

    // 添加权限验证器统计
    if (this.permissionGate) {
      stats.permission = this.permissionGate.getStats();
    }

    return stats;
  }

  /**
   * 停止网关
   */
  async stop() {
    logger.info("[RemoteGateway] 停止远程网关...");

    this.running = false;

    // 停止 P2P 命令适配器
    if (this.p2pCommandAdapter) {
      await this.p2pCommandAdapter.cleanup();
    }

    // 停止权限验证器
    if (this.permissionGate) {
      this.permissionGate.stopCleanup();
    }

    // 停止浏览器扩展服务器
    if (this.browserExtensionServer) {
      await this.browserExtensionServer.stop();
    }

    // 断开用户浏览器连接
    if (this.handlers.userBrowser) {
      await this.handlers.userBrowser.cleanup();
    }

    logger.info("[RemoteGateway] 远程网关已停止");

    this.emit("stopped");
  }

  /**
   * 检查是否正在运行
   */
  isRunning() {
    return this.running;
  }
}

module.exports = RemoteGateway;
