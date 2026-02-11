/**
 * P2P 命令适配器 - 将命令协议适配到 P2P 网络
 *
 * 功能：
 * - 命令消息类型定义（REQUEST/RESPONSE/EVENT）
 * - 请求/响应匹配机制
 * - 超时处理和重试
 * - 与现有 P2P 网络集成
 *
 * @module remote/p2p-command-adapter
 */

const { logger } = require("../utils/logger");
const { EventEmitter } = require("events");
const crypto = require("crypto");

/**
 * 消息类型常量
 */
const MESSAGE_TYPES = {
  COMMAND_REQUEST: "chainlesschain:command:request",
  COMMAND_RESPONSE: "chainlesschain:command:response",
  EVENT_NOTIFICATION: "chainlesschain:event:notification",
  HEARTBEAT: "chainlesschain:heartbeat",
  COMMAND_CANCEL: "chainlesschain:command:cancel",
};

/**
 * 错误码
 */
const ERROR_CODES = {
  TIMEOUT: -32000,
  PERMISSION_DENIED: -32001,
  CANCELLED: -32002,
  NOT_FOUND: -32601,
  INTERNAL_ERROR: -32603,
  INVALID_REQUEST: -32600,
};

/**
 * P2P 命令适配器
 */
class P2PCommandAdapter extends EventEmitter {
  constructor(p2pManager, permissionGate, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.permissionGate = permissionGate;

    // 配置选项
    this.options = {
      requestTimeout: options.requestTimeout || 30000, // 默认 30 秒超时
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      enableHeartbeat: options.enableHeartbeat !== false,
      heartbeatInterval: options.heartbeatInterval || 30000, // 30 秒心跳
      ...options,
    };

    // 待处理请求（用于匹配响应）
    this.pendingRequests = new Map();

    // 运行中的命令（可取消）
    this.runningCommands = new Map();

    // 已注册的移动端设备
    this.registeredDevices = new Map();

    // 统计信息
    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      cancelledRequests: 0,
      totalEvents: 0,
      startTime: Date.now(),
    };

    // 心跳定时器
    this.heartbeatTimer = null;

    // 待处理请求清理定时器
    this.pendingCleanupTimer = null;
    this.pendingCleanupInterval = options.pendingCleanupInterval || 60000; // 每分钟清理

    // 初始化状态
    this.initialized = false;
  }

  /**
   * 初始化适配器
   */
  async initialize() {
    if (this.initialized) {
      logger.info("[P2PCommandAdapter] 已经初始化");
      return;
    }

    logger.info("[P2PCommandAdapter] 初始化 P2P 命令适配器...");

    try {
      // 1. 注册 P2P 消息处理器
      this.registerP2PHandlers();

      // 2. 启动心跳（如果启用）
      if (this.options.enableHeartbeat) {
        this.startHeartbeat();
      }

      // 3. 启动待处理请求清理
      this.startPendingCleanup();

      this.initialized = true;
      logger.info("[P2PCommandAdapter] ✅ 初始化完成");

      this.emit("initialized");
    } catch (error) {
      logger.error("[P2PCommandAdapter] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 注册 P2P 消息处理器
   */
  registerP2PHandlers() {
    // 监听 P2P 网络的原始消息
    this.p2pManager.on("message", async (peerId, rawMessage) => {
      await this.handleP2PMessage(peerId, rawMessage);
    });

    // 监听 P2P 连接事件
    this.p2pManager.on("peer:connected", (peerId) => {
      logger.info(`[P2PCommandAdapter] 节点连接: ${peerId}`);
      this.emit("device:connected", peerId);
    });

    this.p2pManager.on("peer:disconnected", (peerId) => {
      logger.info(`[P2PCommandAdapter] 节点断开: ${peerId}`);
      this.registeredDevices.delete(peerId);
      this.emit("device:disconnected", peerId);
    });

    logger.info("[P2PCommandAdapter] P2P 消息处理器注册完成");
  }

  /**
   * 处理 P2P 消息
   */
  async handleP2PMessage(peerId, rawMessage) {
    try {
      // 解析消息
      let message;
      try {
        message =
          typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
      } catch (e) {
        logger.warn("[P2PCommandAdapter] 无法解析消息，非 JSON 格式，忽略");
        return;
      }

      // 检查消息类型
      const { type, payload } = message;
      if (!type || !type.startsWith("chainlesschain:")) {
        // 不是命令协议消息，忽略
        return;
      }

      logger.debug(`[P2PCommandAdapter] 收到消息: ${type} from ${peerId}`);

      // 根据类型分发
      switch (type) {
        case MESSAGE_TYPES.COMMAND_REQUEST:
          await this.handleCommandRequest(peerId, payload);
          break;

        case MESSAGE_TYPES.COMMAND_RESPONSE:
          this.handleCommandResponse(payload);
          break;

        case MESSAGE_TYPES.COMMAND_CANCEL:
          this.handleCommandCancel(peerId, payload);
          break;

        case MESSAGE_TYPES.EVENT_NOTIFICATION:
          // 暂时忽略，PC 端作为服务端通常不接收事件
          break;

        case MESSAGE_TYPES.HEARTBEAT:
          this.handleHeartbeat(peerId, payload);
          break;

        default:
          logger.warn(`[P2PCommandAdapter] 未知消息类型: ${type}`);
      }
    } catch (error) {
      logger.error("[P2PCommandAdapter] 处理 P2P 消息失败:", error);
    }
  }

  /**
   * 处理命令请求（来自 Android）
   */
  async handleCommandRequest(peerId, request) {
    const { id, method, params, auth } = request;

    logger.info(`[P2PCommandAdapter] 收到命令: ${method} (id: ${id})`);
    this.stats.totalRequests++;

    try {
      // 0. 基础验证：检查 auth 对象完整性
      if (
        !auth ||
        !auth.did ||
        !auth.signature ||
        !auth.timestamp ||
        !auth.nonce
      ) {
        logger.warn(`[P2PCommandAdapter] 认证信息不完整: ${method}`);
        this.sendResponse(peerId, {
          jsonrpc: "2.0",
          id,
          error: {
            code: ERROR_CODES.INVALID_REQUEST,
            message: "Invalid Request",
            data: "Incomplete authentication: did, signature, timestamp, and nonce are required",
          },
        });
        this.stats.failedRequests++;
        return;
      }

      // 1. 验证权限（包含重放攻击防护）
      if (this.permissionGate) {
        const hasPermission = await this.permissionGate.verify(auth, method);
        if (!hasPermission) {
          logger.warn(`[P2PCommandAdapter] 权限验证失败: ${method}`);
          this.sendResponse(peerId, {
            jsonrpc: "2.0",
            id,
            error: {
              code: ERROR_CODES.PERMISSION_DENIED,
              message: "Permission Denied",
              data: `Method ${method} requires higher permission level or authentication failed`,
            },
          });
          this.stats.failedRequests++;
          return;
        }
      }

      // 2. 记录设备信息（验证通过后才记录）
      this.registerDevice(peerId, auth.did);

      // 3. 创建可取消的命令上下文
      const abortController = new AbortController();
      const commandContext = {
        id,
        method,
        peerId,
        startTime: Date.now(),
        abortController,
        signal: abortController.signal,
      };

      // 记录运行中的命令
      this.runningCommands.set(id, commandContext);

      // 4. 触发命令事件（由上层处理器处理）
      // 注意：此时不增加 successRequests，由上层处理结果决定
      this.emit("command", {
        peerId,
        request,
        signal: abortController.signal, // 传递取消信号给处理器
        sendResponse: (response) => {
          // 清理运行中命令记录
          this.runningCommands.delete(id);

          this.sendResponse(peerId, response);
          // 根据响应结果更新统计
          if (response.error) {
            if (response.error.code === ERROR_CODES.CANCELLED) {
              this.stats.cancelledRequests++;
            } else {
              this.stats.failedRequests++;
            }
          } else {
            this.stats.successRequests++;
          }
        },
      });
    } catch (error) {
      logger.error("[P2PCommandAdapter] 处理命令请求失败:", error);

      // 发送错误响应
      this.sendResponse(peerId, {
        jsonrpc: "2.0",
        id,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "Internal Error",
          data: error.message,
        },
      });

      this.stats.failedRequests++;
    }
  }

  /**
   * 处理命令响应（PC 主动发送命令后收到的响应）
   */
  handleCommandResponse(response) {
    const { id } = response;

    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timeoutTimer);
      pending.resolve(response);
      this.pendingRequests.delete(id);

      logger.debug(`[P2PCommandAdapter] 命令响应已匹配: ${id}`);
    } else {
      logger.warn(`[P2PCommandAdapter] 收到未匹配的响应: ${id}`);
    }
  }

  /**
   * 处理命令取消请求
   */
  handleCommandCancel(peerId, payload) {
    const { id, reason } = payload;

    logger.info(
      `[P2PCommandAdapter] 收到取消请求: ${id} (${reason || "no reason"})`,
    );

    const runningCommand = this.runningCommands.get(id);
    if (runningCommand) {
      // 验证请求来源（只有发起者可以取消）
      if (runningCommand.peerId !== peerId) {
        logger.warn(
          `[P2PCommandAdapter] 取消请求被拒绝: 不是命令发起者 (${peerId} != ${runningCommand.peerId})`,
        );
        return;
      }

      // 触发取消信号
      runningCommand.abortController.abort(reason || "Cancelled by client");

      // 发送取消确认响应
      this.sendResponse(peerId, {
        jsonrpc: "2.0",
        id,
        error: {
          code: ERROR_CODES.CANCELLED,
          message: "Command Cancelled",
          data: reason || "Cancelled by client request",
        },
      });

      // 清理
      this.runningCommands.delete(id);
      this.stats.cancelledRequests++;

      logger.info(`[P2PCommandAdapter] 命令已取消: ${id}`);
    } else {
      logger.warn(`[P2PCommandAdapter] 取消失败: 命令不存在或已完成 (${id})`);
    }
  }

  /**
   * 取消指定命令（PC 端主动取消）
   */
  cancelCommand(commandId, reason = "Cancelled by server") {
    const runningCommand = this.runningCommands.get(commandId);
    if (runningCommand) {
      runningCommand.abortController.abort(reason);
      this.runningCommands.delete(commandId);
      this.stats.cancelledRequests++;

      logger.info(`[P2PCommandAdapter] 服务端取消命令: ${commandId}`);
      return true;
    }
    return false;
  }

  /**
   * 获取运行中的命令列表
   */
  getRunningCommands() {
    const commands = [];
    const now = Date.now();

    for (const [id, cmd] of this.runningCommands.entries()) {
      commands.push({
        id,
        method: cmd.method,
        peerId: cmd.peerId,
        runningTime: now - cmd.startTime,
      });
    }

    return commands;
  }

  /**
   * 取消所有超时的命令
   */
  cancelLongRunningCommands(maxDuration = 60000) {
    const now = Date.now();
    let cancelledCount = 0;

    for (const [id, cmd] of this.runningCommands.entries()) {
      if (now - cmd.startTime > maxDuration) {
        this.cancelCommand(id, `Exceeded max duration (${maxDuration}ms)`);
        cancelledCount++;
      }
    }

    if (cancelledCount > 0) {
      logger.info(
        `[P2PCommandAdapter] 已取消 ${cancelledCount} 个超时命令 (>${maxDuration}ms)`,
      );
    }

    return cancelledCount;
  }

  /**
   * 处理心跳
   */
  handleHeartbeat(peerId, payload) {
    const device = this.registeredDevices.get(peerId);
    if (device) {
      device.lastHeartbeat = Date.now();
      logger.debug(`[P2PCommandAdapter] 心跳: ${peerId}`);
    }
  }

  /**
   * 发送命令（PC -> Android）
   */
  async sendCommand(peerId, method, params, options = {}) {
    const requestId = this.generateRequestId();
    const timeout = options.timeout || this.options.requestTimeout;
    const retries =
      options.retries !== undefined ? options.retries : this.options.maxRetries;

    const request = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params: params || {},
    };

    logger.info(`[P2PCommandAdapter] 发送命令: ${method} to ${peerId}`);

    // 执行发送（带重试）
    return await this.executeWithRetry(
      async () => {
        return new Promise((resolve, reject) => {
          // 设置超时
          const timeoutTimer = setTimeout(() => {
            this.pendingRequests.delete(requestId);
            this.stats.timeoutRequests++;
            reject(new Error("Request Timeout"));
          }, timeout);

          // 存储待处理请求
          this.pendingRequests.set(requestId, {
            resolve: (response) => {
              clearTimeout(timeoutTimer);
              resolve(response);
            },
            reject,
            timeoutTimer,
            timestamp: Date.now(),
            peerId, // 记录目标节点，用于断开连接时清理
            method, // 记录方法名，用于日志和调试
          });

          // 发送消息
          this.sendMessage(peerId, {
            type: MESSAGE_TYPES.COMMAND_REQUEST,
            payload: request,
          });
        });
      },
      retries,
      this.options.retryDelay,
    );
  }

  /**
   * 发送响应（PC -> Android）
   */
  sendResponse(peerId, response) {
    this.sendMessage(peerId, {
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      payload: response,
    });

    logger.debug(`[P2PCommandAdapter] 发送响应: ${response.id}`);
  }

  /**
   * 广播事件（PC -> All Android）
   */
  broadcastEvent(method, params, targetDevices = null) {
    const notification = {
      jsonrpc: "2.0",
      method,
      params: params || {},
    };

    const message = {
      type: MESSAGE_TYPES.EVENT_NOTIFICATION,
      payload: notification,
    };

    // 如果指定了目标设备，只发送给这些设备
    if (targetDevices && Array.isArray(targetDevices)) {
      for (const peerId of targetDevices) {
        if (this.registeredDevices.has(peerId)) {
          this.sendMessage(peerId, message);
        }
      }
    } else {
      // 广播到所有已注册设备
      for (const peerId of this.registeredDevices.keys()) {
        this.sendMessage(peerId, message);
      }
    }

    this.stats.totalEvents++;
    logger.debug(
      `[P2PCommandAdapter] 广播事件: ${method} to ${targetDevices ? targetDevices.length : this.registeredDevices.size} devices`,
    );
  }

  /**
   * 发送 P2P 消息（底层方法）
   */
  sendMessage(peerId, message) {
    try {
      const messageStr = JSON.stringify(message);
      this.p2pManager.sendMessage(peerId, messageStr);
    } catch (error) {
      logger.error(`[P2PCommandAdapter] 发送消息失败 to ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * 注册设备
   */
  registerDevice(peerId, did) {
    if (!this.registeredDevices.has(peerId)) {
      this.registeredDevices.set(peerId, {
        did,
        peerId,
        registeredAt: Date.now(),
        lastHeartbeat: Date.now(),
      });

      logger.info(`[P2PCommandAdapter] 设备已注册: ${peerId} (DID: ${did})`);
      this.emit("device:registered", { peerId, did });
    }
  }

  /**
   * 获取已连接设备列表
   */
  getConnectedDevices() {
    return Array.from(this.registeredDevices.values());
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.checkDeviceHealth();
    }, this.options.heartbeatInterval);

    logger.info("[P2PCommandAdapter] 心跳已启动");
  }

  /**
   * 检查设备健康状态
   */
  checkDeviceHealth() {
    const now = Date.now();
    const timeout = this.options.heartbeatInterval * 3; // 3 个心跳周期

    for (const [peerId, device] of this.registeredDevices.entries()) {
      if (now - device.lastHeartbeat > timeout) {
        logger.warn(`[P2PCommandAdapter] 设备心跳超时: ${peerId}`);
        this.registeredDevices.delete(peerId);
        this.emit("device:timeout", peerId);
      }
    }
  }

  /**
   * 停止心跳
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      logger.info("[P2PCommandAdapter] 心跳已停止");
    }
  }

  /**
   * 带重试的执行
   */
  async executeWithRetry(fn, retries, delay) {
    let lastError;

    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (i < retries) {
          logger.warn(
            `[P2PCommandAdapter] 执行失败，${delay}ms 后重试 (${i + 1}/${retries})`,
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * 睡眠函数
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 生成请求 ID
   */
  generateRequestId() {
    return `req-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      connectedDevices: this.registeredDevices.size,
      pendingRequests: this.pendingRequests.size,
      runningCommands: this.runningCommands.size,
      uptime: Date.now() - this.stats.startTime,
    };
  }

  /**
   * 启动待处理请求定期清理
   */
  startPendingCleanup() {
    if (this.pendingCleanupTimer) {
      return;
    }

    this.pendingCleanupTimer = setInterval(() => {
      this.cleanupStalePendingRequests();
    }, this.pendingCleanupInterval);

    logger.info(
      `[P2PCommandAdapter] 待处理请求清理已启动 (间隔: ${this.pendingCleanupInterval}ms)`,
    );
  }

  /**
   * 清理过期的待处理请求
   */
  cleanupStalePendingRequests() {
    const now = Date.now();
    const staleThreshold = this.options.requestTimeout * 2; // 超时时间的2倍视为过期
    let cleanedCount = 0;

    for (const [id, pending] of this.pendingRequests.entries()) {
      const age = now - pending.timestamp;
      if (age > staleThreshold) {
        // 清理超时定时器
        if (pending.timeoutTimer) {
          clearTimeout(pending.timeoutTimer);
        }
        // 拒绝请求
        pending.reject(new Error("Request stale cleanup"));
        // 从Map中删除
        this.pendingRequests.delete(id);
        cleanedCount++;
        this.stats.timeoutRequests++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(
        `[P2PCommandAdapter] 清理了 ${cleanedCount} 个过期的待处理请求`,
      );
    }
  }

  /**
   * 停止待处理请求清理
   */
  stopPendingCleanup() {
    if (this.pendingCleanupTimer) {
      clearInterval(this.pendingCleanupTimer);
      this.pendingCleanupTimer = null;
      logger.info("[P2PCommandAdapter] 待处理请求清理已停止");
    }
  }

  /**
   * 断开指定节点
   */
  async disconnectPeer(peerId) {
    logger.info(`[P2PCommandAdapter] 断开节点: ${peerId}`);

    // 清理该节点的待处理请求
    for (const [id, pending] of this.pendingRequests.entries()) {
      // 如果请求与该节点相关，取消它
      if (pending.peerId === peerId) {
        clearTimeout(pending.timeoutTimer);
        pending.reject(new Error("Peer disconnected"));
        this.pendingRequests.delete(id);
      }
    }

    // 从已注册设备中删除
    this.registeredDevices.delete(peerId);

    this.emit("device:disconnected", peerId);
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[P2PCommandAdapter] 清理资源...");

    // 停止心跳
    this.stopHeartbeat();

    // 停止待处理请求清理
    this.stopPendingCleanup();

    // 取消所有运行中的命令
    for (const [id, cmd] of this.runningCommands.entries()) {
      cmd.abortController.abort("Adapter cleanup");
    }
    this.runningCommands.clear();

    // 清理待处理请求
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timeoutTimer) {
        clearTimeout(pending.timeoutTimer);
      }
      pending.reject(new Error("Adapter Cleanup"));
    }
    this.pendingRequests.clear();

    // 清理设备注册
    this.registeredDevices.clear();

    this.initialized = false;
    logger.info("[P2PCommandAdapter] 清理完成");
  }
}

module.exports = {
  P2PCommandAdapter,
  MESSAGE_TYPES,
  ERROR_CODES,
};
