/**
 * WebRTC 数据通道管理器
 *
 * 基于 wrtc (node-webrtc) 实现 PC 端的 WebRTC 数据通道
 * 用于与 Android 客户端建立点对点连接
 *
 * @module p2p/webrtc-data-channel
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger");

// 动态导入 wrtc（如果安装）
let wrtc;
try {
  wrtc = require("wrtc");
  logger.info("[WebRTC] wrtc 模块已加载");
} catch (error) {
  logger.warn("[WebRTC] wrtc 模块未安装，将使用模拟模式");
}

/**
 * WebRTC 数据通道管理器
 */
class WebRTCDataChannelManager extends EventEmitter {
  constructor(signalServer, options = {}) {
    super();

    this.signalServer = signalServer;
    this.options = {
      iceServers: options.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      ...options,
    };

    // 活动的连接（peerId -> Connection）
    this.connections = new Map();

    // 待处理的 ICE candidates
    this.pendingIceCandidates = new Map();

    // 统计信息
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      failedConnections: 0,
    };
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    logger.info("[WebRTC] 初始化数据通道管理器...");

    try {
      // 检查 wrtc 是否可用
      if (!wrtc) {
        logger.warn("[WebRTC] 使用模拟模式（生产环境需要安装 wrtc）");
        this.useMockMode = true;
      }

      // 连接到信令服务器
      if (this.signalServer) {
        this.setupSignalingHandlers();
      }

      logger.info("[WebRTC] ✅ 数据通道管理器初始化完成");
    } catch (error) {
      logger.error("[WebRTC] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 设置信令处理器
   */
  setupSignalingHandlers() {
    // 监听来自 Android 客户端的 offer
    this.signalServer.on("webrtc:offer", async (data) => {
      await this.handleOffer(data);
    });

    // 监听 ICE candidate
    this.signalServer.on("webrtc:ice-candidate", async (data) => {
      await this.handleIceCandidate(data);
    });

    logger.info("[WebRTC] 信令处理器已设置");
  }

  /**
   * 创建对等连接
   */
  createPeerConnection(peerId) {
    logger.info(`[WebRTC] 创建对等连接: ${peerId}`);

    // 模拟模式
    if (this.useMockMode) {
      return this.createMockConnection(peerId);
    }

    // 真实模式
    const pc = new wrtc.RTCPeerConnection({
      iceServers: this.options.iceServers,
    });

    const connection = {
      peerId,
      pc,
      dataChannel: null,
      state: "connecting",
      createdAt: Date.now(),
    };

    // 监听 ICE candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        logger.debug(`[WebRTC] 生成 ICE candidate: ${peerId}`);
        this.sendIceCandidate(peerId, event.candidate);
      }
    };

    // 监听连接状态
    pc.onconnectionstatechange = () => {
      logger.info(`[WebRTC] 连接状态变更: ${peerId} -> ${pc.connectionState}`);
      connection.state = pc.connectionState;

      if (pc.connectionState === "connected") {
        this.stats.activeConnections++;
        this.emit("connection:established", peerId);
      } else if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        this.handleConnectionFailure(peerId);
      }
    };

    // 监听数据通道
    pc.ondatachannel = (event) => {
      logger.info(`[WebRTC] 接收到数据通道: ${peerId}`);
      this.setupDataChannel(peerId, event.channel);
    };

    this.connections.set(peerId, connection);
    this.stats.totalConnections++;

    return connection;
  }

  /**
   * 处理 Offer（来自 Android）
   */
  async handleOffer(data) {
    const { peerId, offer } = data;

    logger.info(`[WebRTC] 收到 offer: ${peerId}`);

    try {
      // 验证 offer
      if (!offer || typeof offer !== "object") {
        throw new Error("Invalid offer");
      }

      // 创建对等连接
      const connection = this.createPeerConnection(peerId);

      if (this.useMockMode) {
        // Mock mode: simulate offer/answer exchange
        await connection.pc.setRemoteDescription(offer);
        const answer = await connection.pc.createAnswer();
        await connection.pc.setLocalDescription(answer);
        this.sendAnswer(peerId, answer);

        // 处理待处理的 ICE candidates (mock mode)
        const pending = this.pendingIceCandidates.get(peerId);
        if (pending) {
          this.pendingIceCandidates.delete(peerId);
        }
      } else {
        // Real mode: use wrtc
        // 设置远程描述
        await connection.pc.setRemoteDescription(
          new wrtc.RTCSessionDescription(offer),
        );

        // 创建 answer
        const answer = await connection.pc.createAnswer();
        await connection.pc.setLocalDescription(answer);

        // 发送 answer
        this.sendAnswer(peerId, answer);

        // 处理待处理的 ICE candidates
        const pending = this.pendingIceCandidates.get(peerId);
        if (pending) {
          for (const candidate of pending) {
            await connection.pc.addIceCandidate(
              new wrtc.RTCIceCandidate(candidate),
            );
          }
          this.pendingIceCandidates.delete(peerId);
        }
      }

      logger.info(`[WebRTC] answer 已发送: ${peerId}`);
    } catch (error) {
      logger.error(`[WebRTC] 处理 offer 失败: ${peerId}`, error);
      this.stats.failedConnections++;
      this.emit("connection:failed", peerId);
    }
  }

  /**
   * 处理 ICE Candidate
   */
  async handleIceCandidate(data) {
    const { peerId, candidate } = data;

    logger.debug(`[WebRTC] 收到 ICE candidate: ${peerId}`);

    const connection = this.connections.get(peerId);

    if (connection && connection.pc.remoteDescription) {
      try {
        if (this.useMockMode) {
          // Mock mode: simulate adding ICE candidate
          // No actual operation needed in mock mode
        } else {
          await connection.pc.addIceCandidate(
            new wrtc.RTCIceCandidate(candidate),
          );
        }
      } catch (error) {
        logger.error(`[WebRTC] 添加 ICE candidate 失败: ${peerId}`, error);
      }
    } else {
      // 暂存候选者
      if (!this.pendingIceCandidates.has(peerId)) {
        this.pendingIceCandidates.set(peerId, []);
      }
      this.pendingIceCandidates.get(peerId).push(candidate);
    }
  }

  /**
   * 设置数据通道
   */
  setupDataChannel(peerId, channel) {
    logger.info(`[WebRTC] 设置数据通道: ${peerId}, label: ${channel.label}`);

    const connection = this.connections.get(peerId);
    if (!connection) {
      logger.warn(`[WebRTC] 连接不存在: ${peerId}`);
      return;
    }

    connection.dataChannel = channel;

    // 监听消息
    channel.onmessage = (event) => {
      logger.debug(`[WebRTC] 收到消息: ${peerId}`);
      this.emit("message", peerId, event.data);
    };

    // 监听打开
    channel.onopen = () => {
      logger.info(`[WebRTC] 数据通道已打开: ${peerId}`);
      this.emit("channel:open", peerId);
    };

    // 监听关闭
    channel.onclose = () => {
      logger.info(`[WebRTC] 数据通道已关闭: ${peerId}`);
      this.emit("channel:close", peerId);
    };

    // 监听错误
    channel.onerror = (error) => {
      logger.error(`[WebRTC] 数据通道错误: ${peerId}`, error);
      this.emit("channel:error", peerId, error);
    };
  }

  /**
   * 发送消息
   */
  sendMessage(peerId, message) {
    const connection = this.connections.get(peerId);

    if (!connection || !connection.dataChannel) {
      throw new Error(`No data channel for peer: ${peerId}`);
    }

    if (connection.dataChannel.readyState !== "open") {
      throw new Error(`Data channel not open for peer: ${peerId}`);
    }

    connection.dataChannel.send(message);
    logger.debug(`[WebRTC] 消息已发送: ${peerId}`);
  }

  /**
   * 发送 Answer
   */
  sendAnswer(peerId, answer) {
    if (this.signalServer) {
      this.signalServer.send("webrtc:answer", { peerId, answer });
    }
  }

  /**
   * 发送 ICE Candidate
   */
  sendIceCandidate(peerId, candidate) {
    if (this.signalServer) {
      this.signalServer.send("webrtc:ice-candidate", { peerId, candidate });
    }
  }

  /**
   * 处理连接失败
   */
  handleConnectionFailure(peerId) {
    logger.warn(`[WebRTC] 连接失败: ${peerId}`);

    const connection = this.connections.get(peerId);
    if (connection) {
      if (connection.dataChannel) {
        connection.dataChannel.close();
      }
      if (connection.pc) {
        connection.pc.close();
      }
      this.connections.delete(peerId);
    }

    this.stats.activeConnections = Math.max(
      0,
      this.stats.activeConnections - 1,
    );
    this.stats.failedConnections++;

    this.emit("connection:failed", peerId);
  }

  /**
   * 断开连接
   */
  disconnect(peerId) {
    logger.info(`[WebRTC] 断开连接: ${peerId}`);

    const connection = this.connections.get(peerId);
    if (connection) {
      if (connection.dataChannel) {
        connection.dataChannel.close();
      }
      if (connection.pc) {
        connection.pc.close();
      }
      this.connections.delete(peerId);
      this.stats.activeConnections = Math.max(
        0,
        this.stats.activeConnections - 1,
      );
    }
  }

  /**
   * 获取连接状态
   */
  getConnectionState(peerId) {
    const connection = this.connections.get(peerId);
    return connection ? connection.state : "disconnected";
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      connections: this.connections.size,
    };
  }

  /**
   * 创建模拟连接（开发模式）
   */
  createMockConnection(peerId) {
    logger.info(`[WebRTC] 创建模拟连接: ${peerId}`);

    const mockPc = {
      connectionState: "connected",
      remoteDescription: null,
      setRemoteDescription: async (desc) => {
        mockPc.remoteDescription = desc;
      },
      createAnswer: async () => ({ type: "answer", sdp: "mock-sdp" }),
      setLocalDescription: async () => {},
      close: () => {},
    };

    const connection = {
      peerId,
      pc: mockPc,
      dataChannel: {
        readyState: "open",
        send: (data) => {
          logger.debug(`[WebRTC] [Mock] 发送消息: ${peerId}`);
          // 模拟接收回显
          setTimeout(() => {
            this.emit("message", peerId, data);
          }, 100);
        },
        close: () => {},
      },
      state: "connected",
      createdAt: Date.now(),
    };

    this.connections.set(peerId, connection);
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    // 模拟连接建立
    setTimeout(() => {
      this.emit("connection:established", peerId);
      this.emit("channel:open", peerId);
    }, 500);

    return connection;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[WebRTC] 清理资源...");

    for (const [peerId] of this.connections) {
      this.disconnect(peerId);
    }

    this.connections.clear();
    this.pendingIceCandidates.clear();

    logger.info("[WebRTC] 清理完成");
  }
}

module.exports = WebRTCDataChannelManager;
