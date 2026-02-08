/**
 * P2P连接健康监控和自动重连管理器
 *
 * 功能：
 * - 连接健康检查
 * - 自动重连机制
 * - 网络质量监控
 * - 连接降级策略
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

class P2PConnectionHealthManager extends EventEmitter {
  constructor(p2pManager, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.options = {
      healthCheckInterval: options.healthCheckInterval || 30000, // 30秒
      pingTimeout: options.pingTimeout || 5000, // 5秒
      maxReconnectAttempts: options.maxReconnectAttempts || 5,
      reconnectDelay: options.reconnectDelay || 2000, // 2秒
      reconnectBackoffMultiplier: options.reconnectBackoffMultiplier || 1.5,
      maxReconnectDelay: options.maxReconnectDelay || 30000, // 30秒
      connectionTimeout: options.connectionTimeout || 30000, // 30秒
      ...options,
    };

    // 连接状态跟踪
    this.peerHealth = new Map(); // peerId -> health info
    this.reconnectAttempts = new Map(); // peerId -> attempt count
    this.reconnectTimers = new Map(); // peerId -> timer

    // 健康检查定时器
    this.healthCheckTimer = null;

    // 网络状态
    this.networkQuality = "good"; // good, fair, poor, offline
    this.lastNetworkCheck = Date.now();

    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    logger.info("[P2PConnectionHealth] 初始化连接健康管理器...");

    // 监听P2P事件
    this._setupEventListeners();

    // 启动健康检查
    this._startHealthCheck();

    // 监听网络状态变化
    this._setupNetworkMonitoring();

    this.initialized = true;
    logger.info("[P2PConnectionHealth] 连接健康管理器初始化完成");
  }

  /**
   * 设置事件监听
   */
  _setupEventListeners() {
    // 监听连接建立
    this.p2pManager.on("peer:connected", (peerId) => {
      this._onPeerConnected(peerId);
    });

    // 监听连接断开
    this.p2pManager.on("peer:disconnected", (peerId) => {
      this._onPeerDisconnected(peerId);
    });

    // 监听连接错误
    this.p2pManager.on("peer:error", ({ peerId, error }) => {
      this._onPeerError(peerId, error);
    });
  }

  /**
   * 设置网络监控
   */
  _setupNetworkMonitoring() {
    // 监听在线/离线事件
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        logger.info("[P2PConnectionHealth] 网络已恢复");
        this.networkQuality = "good";
        this._handleNetworkRestore();
      });

      window.addEventListener("offline", () => {
        logger.info("[P2PConnectionHealth] 网络已断开");
        this.networkQuality = "offline";
        this._handleNetworkLoss();
      });
    }
  }

  /**
   * 启动健康检查
   */
  _startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this._performHealthCheck();
    }, this.options.healthCheckInterval);

    logger.info("[P2PConnectionHealth] 健康检查已启动");
  }

  /**
   * 执行健康检查
   */
  async _performHealthCheck() {
    const now = Date.now();

    for (const [peerId, health] of this.peerHealth.entries()) {
      try {
        // 检查连接是否活跃
        const isActive = await this._checkPeerConnection(peerId);

        if (isActive) {
          // 更新健康状态
          health.lastSeen = now;
          health.consecutiveFailures = 0;
          health.status = "healthy";

          // 测量延迟
          const latency = await this._measureLatency(peerId);
          health.latency = latency;

          // 评估连接质量
          this._evaluateConnectionQuality(peerId, health);
        } else {
          // 连接不活跃
          health.consecutiveFailures++;
          health.status = "unhealthy";

          logger.warn(
            `[P2PConnectionHealth] 对等方 ${peerId} 连接不健康 (失败次数: ${health.consecutiveFailures})`,
          );

          // 触发重连
          if (health.consecutiveFailures >= 3) {
            this._triggerReconnect(peerId);
          }
        }

        this.emit("health-check", { peerId, health });
      } catch (error) {
        logger.error(`[P2PConnectionHealth] 健康检查失败 (${peerId}):`, error);
      }
    }
  }

  /**
   * 检查对等方连接
   */
  async _checkPeerConnection(peerId) {
    try {
      // 发送ping消息
      const pingStart = Date.now();
      await this.p2pManager.sendMessage(peerId, {
        type: "ping",
        timestamp: pingStart,
      });

      // 等待pong响应
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, this.options.pingTimeout);

        const handler = (data) => {
          if (data.type === "pong" && data.peerId === peerId) {
            clearTimeout(timeout);
            this.p2pManager.off("message", handler);
            resolve(true);
          }
        };

        this.p2pManager.on("message", handler);
      });
    } catch (error) {
      logger.error(`[P2PConnectionHealth] Ping失败 (${peerId}):`, error);
      return false;
    }
  }

  /**
   * 测量延迟
   */
  async _measureLatency(peerId) {
    try {
      const start = Date.now();
      await this._checkPeerConnection(peerId);
      return Date.now() - start;
    } catch (error) {
      return -1;
    }
  }

  /**
   * 评估连接质量
   */
  _evaluateConnectionQuality(peerId, health) {
    const { latency } = health;

    if (latency < 100) {
      health.quality = "excellent";
    } else if (latency < 200) {
      health.quality = "good";
    } else if (latency < 500) {
      health.quality = "fair";
    } else {
      health.quality = "poor";
    }

    // 触发质量变化事件
    if (health.previousQuality !== health.quality) {
      this.emit("quality-changed", {
        peerId,
        quality: health.quality,
        latency,
      });
      health.previousQuality = health.quality;
    }
  }

  /**
   * 触发重连
   */
  async _triggerReconnect(peerId) {
    // 检查是否已经在重连
    if (this.reconnectTimers.has(peerId)) {
      return;
    }

    const attempts = this.reconnectAttempts.get(peerId) || 0;

    if (attempts >= this.options.maxReconnectAttempts) {
      logger.error(`[P2PConnectionHealth] 对等方 ${peerId} 重连次数已达上限`);
      this.emit("reconnect-failed", { peerId, attempts });
      return;
    }

    // 计算重连延迟（指数退避）
    const delay = Math.min(
      this.options.reconnectDelay *
        Math.pow(this.options.reconnectBackoffMultiplier, attempts),
      this.options.maxReconnectDelay,
    );

    logger.info(
      `[P2PConnectionHealth] 将在 ${delay}ms 后重连对等方 ${peerId} (尝试 ${attempts + 1}/${this.options.maxReconnectAttempts})`,
    );

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(peerId);

      try {
        logger.info(`[P2PConnectionHealth] 正在重连对等方 ${peerId}...`);
        await this.p2pManager.connectToPeer(peerId);

        // 重连成功
        this.reconnectAttempts.set(peerId, 0);
        this.emit("reconnect-success", { peerId, attempts: attempts + 1 });
      } catch (error) {
        logger.error(`[P2PConnectionHealth] 重连失败 (${peerId}):`, error);
        this.reconnectAttempts.set(peerId, attempts + 1);
        this.emit("reconnect-attempt-failed", {
          peerId,
          attempts: attempts + 1,
          error,
        });

        // 继续尝试重连
        this._triggerReconnect(peerId);
      }
    }, delay);

    this.reconnectTimers.set(peerId, timer);
    this.reconnectAttempts.set(peerId, attempts + 1);
  }

  /**
   * 处理对等方连接
   */
  _onPeerConnected(peerId) {
    logger.info(`[P2PConnectionHealth] 对等方已连接: ${peerId}`);

    // 初始化健康信息
    this.peerHealth.set(peerId, {
      peerId,
      status: "healthy",
      quality: "good",
      lastSeen: Date.now(),
      consecutiveFailures: 0,
      latency: 0,
    });

    // 重置重连计数
    this.reconnectAttempts.set(peerId, 0);

    // 清除重连定时器
    if (this.reconnectTimers.has(peerId)) {
      clearTimeout(this.reconnectTimers.get(peerId));
      this.reconnectTimers.delete(peerId);
    }

    this.emit("peer-healthy", { peerId });
  }

  /**
   * 处理对等方断开
   */
  _onPeerDisconnected(peerId) {
    logger.info(`[P2PConnectionHealth] 对等方已断开: ${peerId}`);

    const health = this.peerHealth.get(peerId);
    if (health) {
      health.status = "disconnected";
      this.emit("peer-disconnected", { peerId, health });
    }

    // 触发自动重连
    this._triggerReconnect(peerId);
  }

  /**
   * 处理对等方错误
   */
  _onPeerError(peerId, error) {
    logger.error(`[P2PConnectionHealth] 对等方错误 (${peerId}):`, error);

    const health = this.peerHealth.get(peerId);
    if (health) {
      health.consecutiveFailures++;
      health.lastError = error.message;
      this.emit("peer-error", { peerId, error, health });
    }
  }

  /**
   * 处理网络恢复
   */
  async _handleNetworkRestore() {
    logger.info("[P2PConnectionHealth] 处理网络恢复...");

    // 重连所有断开的对等方
    for (const [peerId, health] of this.peerHealth.entries()) {
      if (health.status === "disconnected" || health.status === "unhealthy") {
        this._triggerReconnect(peerId);
      }
    }

    this.emit("network-restored");
  }

  /**
   * 处理网络丢失
   */
  _handleNetworkLoss() {
    logger.info("[P2PConnectionHealth] 处理网络丢失...");

    // 标记所有连接为不健康
    for (const [peerId, health] of this.peerHealth.entries()) {
      health.status = "network-lost";
    }

    this.emit("network-lost");
  }

  /**
   * 获取对等方健康状态
   */
  getPeerHealth(peerId) {
    return this.peerHealth.get(peerId);
  }

  /**
   * 获取所有健康状态
   */
  getAllPeerHealth() {
    return Array.from(this.peerHealth.values());
  }

  /**
   * 获取网络质量
   */
  getNetworkQuality() {
    return this.networkQuality;
  }

  /**
   * 清理资源
   */
  cleanup() {
    logger.info("[P2PConnectionHealth] 清理资源...");

    // 停止健康检查
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // 清除所有重连定时器
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // 清空状态
    this.peerHealth.clear();
    this.reconnectAttempts.clear();

    this.initialized = false;
    logger.info("[P2PConnectionHealth] 资源清理完成");
  }
}

module.exports = P2PConnectionHealthManager;
