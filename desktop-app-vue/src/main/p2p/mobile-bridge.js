/**
 * Mobile Bridge - PC端libp2p与移动端WebRTC桥接层
 *
 * 功能：
 * - 连接到信令服务器（WebSocket客户端）
 * - 处理移动端WebRTC信令（Offer/Answer/ICE）
 * - WebRTC DataChannel与libp2p Stream桥接
 * - 消息转发和协议转换
 */

const WebSocket = require("ws");
const EventEmitter = require("events");

// Use wrtc-compat which provides WebRTC via werift (pure JavaScript, no native binaries)
// This replaces the deprecated 'wrtc' package which doesn't support modern Electron/Node.js
const wrtcCompat = require("./wrtc-compat");
const wrtc = wrtcCompat;
const wrtcAvailable = wrtcCompat.available;

if (!wrtcAvailable) {
  console.warn(
    "[MobileBridge] WebRTC (werift) not available:",
    wrtcCompat.loadError?.message || "unknown error",
  );
  console.warn("[MobileBridge] Mobile bridging via WebRTC will be disabled");
} else {
  console.log("[MobileBridge] WebRTC initialized via werift");
}

class MobileBridge extends EventEmitter {
  constructor(p2pManager, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.wrtcAvailable = wrtcAvailable;
    this.options = {
      signalingUrl: options.signalingUrl || "ws://localhost:9001",
      reconnectInterval: options.reconnectInterval || 5000,
      enableAutoReconnect: options.enableAutoReconnect !== false,
      iceServers: options.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    };

    // WebSocket连接
    this.signalingSocket = null;
    this.isConnected = false;
    this.reconnectTimer = null;

    // WebRTC连接管理
    this.peerConnections = new Map(); // mobilePeerId -> RTCPeerConnection
    this.dataChannels = new Map(); // mobilePeerId -> RTCDataChannel
    this.connectionStates = new Map(); // mobilePeerId -> state

    // 连接池管理
    this.maxConnections = options.maxConnections || 50;
    this.connectionTimeout = options.connectionTimeout || 30000;
    this.connectionTimers = new Map(); // mobilePeerId -> timer

    // ICE候选批量处理
    this.pendingIceCandidates = new Map(); // mobilePeerId -> candidate[]
    this.iceFlushTimers = new Map(); // mobilePeerId -> timer

    // 错误处理
    this.errorCounts = new Map(); // mobilePeerId -> count
    this.maxErrors = options.maxErrors || 5;
    this.errorResetInterval = options.errorResetInterval || 60000;

    // 重连管理
    this.reconnectAttempts = new Map(); // mobilePeerId -> attempts
    this.maxReconnectAttempts = options.maxReconnectAttempts || 3;

    // 统计信息
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesForwarded: 0,
      bytesTransferred: 0,
      errors: 0,
      reconnects: 0,
    };
  }

  /**
   * 连接到信令服务器
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log(
        "[MobileBridge] 连接到信令服务器:",
        this.options.signalingUrl,
      );

      try {
        this.signalingSocket = new WebSocket(this.options.signalingUrl);

        this.signalingSocket.on("open", () => {
          console.log("[MobileBridge] 信令服务器连接成功");
          this.isConnected = true;

          // 注册PC端身份
          this.register();

          resolve();
        });

        this.signalingSocket.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleSignalingMessage(message);
          } catch (error) {
            console.error("[MobileBridge] 信令消息解析失败:", error);
          }
        });

        this.signalingSocket.on("close", () => {
          console.log("[MobileBridge] 信令服务器连接关闭");
          this.isConnected = false;

          // 自动重连
          if (this.options.enableAutoReconnect) {
            this.scheduleReconnect();
          }
        });

        this.signalingSocket.on("error", (error) => {
          console.error("[MobileBridge] WebSocket错误:", error);
          reject(error);
        });
      } catch (error) {
        console.error("[MobileBridge] 创建WebSocket失败:", error);
        reject(error);
      }
    });
  }

  /**
   * 注册PC端身份到信令服务器
   */
  register() {
    if (!this.isConnected || !this.signalingSocket) {
      return;
    }

    const peerId = this.p2pManager.peerId
      ? this.p2pManager.peerId.toString()
      : "unknown";

    this.send({
      type: "register",
      peerId,
      deviceType: "desktop",
      deviceInfo: {
        name: require("os").hostname(),
        platform: process.platform,
        version: process.env.npm_package_version || "0.16.0",
      },
    });
  }

  /**
   * 处理信令消息
   */
  async handleSignalingMessage(message) {
    const { type } = message;

    switch (type) {
      case "registered":
        console.log("[MobileBridge] 注册成功:", message.peerId);
        this.emit("registered", message);
        break;

      case "offer":
        await this.handleOffer(message);
        break;

      case "answer":
        await this.handleAnswer(message);
        break;

      case "ice-candidate":
        await this.handleICECandidate(message);
        break;

      case "ice-candidates":
        await this.handleICECandidates(message);
        break;

      case "peer-status":
        this.handlePeerStatus(message);
        break;

      case "offline-message":
        this.handleOfflineMessage(message);
        break;

      case "message":
        await this.handleP2PMessage(message);
        break;

      case "error":
        console.error("[MobileBridge] 服务器错误:", message.error);
        break;

      default:
        console.warn("[MobileBridge] 未知消息类型:", type);
    }
  }

  /**
   * 处理移动端的WebRTC Offer
   */
  async handleOffer(message) {
    const { from, offer, iceRestart } = message;

    console.log(
      "[MobileBridge] 收到移动端Offer:",
      from,
      iceRestart ? "(ICE重启)" : "",
    );

    // 检查wrtc是否可用
    if (!wrtc) {
      console.error(
        "[MobileBridge] wrtc not available, cannot handle WebRTC offer",
      );
      this.send({
        type: "error",
        to: from,
        error: "WebRTC not available on this platform",
      });
      return;
    }

    try {
      // 检查连接池限制
      if (
        !this.peerConnections.has(from) &&
        this.peerConnections.size >= this.maxConnections
      ) {
        console.error("[MobileBridge] 连接池已满，拒绝新连接:", from);
        this.send({
          type: "error",
          to: from,
          error: "Connection pool full",
        });
        return;
      }

      // 检查错误计数
      if (this.shouldBlockPeer(from)) {
        console.error("[MobileBridge] 节点错误过多，暂时阻止:", from);
        return;
      }

      // 如果是ICE重启，关闭旧连接
      if (iceRestart && this.peerConnections.has(from)) {
        console.log("[MobileBridge] ICE重启，关闭旧连接:", from);
        this.closePeerConnection(from);
      }

      // 创建WebRTC PeerConnection
      const pc = new wrtc.RTCPeerConnection({
        iceServers: this.options.iceServers,
      });

      // 设置连接超时
      this.setConnectionTimeout(from);

      // 监听ICE候选 - 批量发送
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.queueIceCandidate(from, event.candidate);
        } else {
          // ICE收集完成，立即发送剩余候选
          this.flushIceCandidates(from);
        }
      };

      // 监听连接状态
      pc.onconnectionstatechange = () => {
        console.log(
          `[MobileBridge] WebRTC连接状态 (${from}):`,
          pc.connectionState,
        );
        this.connectionStates.set(from, pc.connectionState);

        if (pc.connectionState === "connected") {
          this.clearConnectionTimeout(from);
          this.stats.activeConnections++;
          this.reconnectAttempts.delete(from); // 重置重连计数
          this.emit("peer-connected", { peerId: from, type: "mobile" });
        } else if (pc.connectionState === "disconnected") {
          this.handleDisconnection(from);
        } else if (pc.connectionState === "failed") {
          this.handleConnectionFailed(from);
        }
      };

      // 监听ICE连接状态
      pc.oniceconnectionstatechange = () => {
        console.log(
          `[MobileBridge] ICE连接状态 (${from}):`,
          pc.iceConnectionState,
        );

        if (pc.iceConnectionState === "failed") {
          this.handleConnectionFailed(from);
        }
      };

      // 监听数据通道
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        console.log("[MobileBridge] 数据通道已建立:", from);

        this.dataChannels.set(from, channel);

        channel.onopen = () => {
          console.log("[MobileBridge] 数据通道已打开:", from);
        };

        channel.onmessage = async (event) => {
          try {
            await this.bridgeToLibp2p(from, event.data);
          } catch (error) {
            this.handleError(from, "桥接消息失败", error);
          }
        };

        channel.onerror = (error) => {
          this.handleError(from, "DataChannel错误", error);
        };

        channel.onclose = () => {
          console.log("[MobileBridge] 数据通道已关闭:", from);
          this.dataChannels.delete(from);
        };
      };

      // 设置远程描述（Offer）
      await pc.setRemoteDescription(new wrtc.RTCSessionDescription(offer));

      // 创建Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 发送Answer到移动端
      this.send({
        type: "answer",
        to: from,
        answer: pc.localDescription.toJSON(),
      });

      // 保存PeerConnection
      this.peerConnections.set(from, pc);
      this.stats.totalConnections++;

      console.log("[MobileBridge] Answer已发送:", from);
    } catch (error) {
      this.handleError(from, "处理Offer失败", error);
    }
  }

  /**
   * 处理Answer（如果PC端主动发起连接，当前暂未实现）
   */
  async handleAnswer(message) {
    const { from, answer } = message;
    const pc = this.peerConnections.get(from);

    if (!pc) {
      console.warn("[MobileBridge] 未找到对应的PeerConnection:", from);
      return;
    }

    if (!wrtc) {
      console.error("[MobileBridge] wrtc not available, cannot apply answer");
      return;
    }

    try {
      await pc.setRemoteDescription(new wrtc.RTCSessionDescription(answer));
      console.log("[MobileBridge] Answer已应用:", from);
    } catch (error) {
      console.error("[MobileBridge] 应用Answer失败:", error);
    }
  }

  /**
   * 处理ICE候选
   */
  async handleICECandidate(message) {
    const { from, candidate } = message;
    const pc = this.peerConnections.get(from);

    if (!pc) {
      console.warn("[MobileBridge] 未找到对应的PeerConnection:", from);
      return;
    }

    if (!wrtc) {
      console.error(
        "[MobileBridge] wrtc not available, cannot add ICE candidate",
      );
      return;
    }

    try {
      await pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    } catch (error) {
      this.handleError(from, "添加ICE候选失败", error);
    }
  }

  /**
   * 处理批量ICE候选
   */
  async handleICECandidates(message) {
    const { from, candidates } = message;

    if (!candidates || candidates.length === 0) {return;}

    console.log(`[MobileBridge] 处理批量ICE候选: ${candidates.length}个`, from);

    const pc = this.peerConnections.get(from);
    if (!pc) {
      console.warn("[MobileBridge] 未找到对应的PeerConnection:", from);
      return;
    }

    if (!wrtc) {
      console.error(
        "[MobileBridge] wrtc not available, cannot add ICE candidates",
      );
      return;
    }

    try {
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
        } catch (error) {
          console.error("[MobileBridge] 添加单个ICE候选失败:", error);
        }
      }
      console.log(`[MobileBridge] ✅ 已添加 ${candidates.length} 个ICE候选`);
    } catch (error) {
      this.handleError(from, "处理批量ICE候选失败", error);
    }
  }

  /**
   * 队列ICE候选（批量发送）
   */
  queueIceCandidate(peerId, candidate) {
    if (!this.pendingIceCandidates.has(peerId)) {
      this.pendingIceCandidates.set(peerId, []);
    }

    this.pendingIceCandidates.get(peerId).push(candidate.toJSON());

    // 清除旧的定时器
    if (this.iceFlushTimers.has(peerId)) {
      clearTimeout(this.iceFlushTimers.get(peerId));
    }

    // 设置新的定时器（100ms后发送）
    const timer = setTimeout(() => {
      this.flushIceCandidates(peerId);
    }, 100);

    this.iceFlushTimers.set(peerId, timer);
  }

  /**
   * 批量发送ICE候选
   */
  flushIceCandidates(peerId) {
    const candidates = this.pendingIceCandidates.get(peerId);
    if (!candidates || candidates.length === 0) {return;}

    console.log(
      `[MobileBridge] 批量发送 ${candidates.length} 个ICE候选:`,
      peerId,
    );

    this.send({
      type: "ice-candidates",
      to: peerId,
      candidates: candidates,
    });

    // 清空队列和定时器
    this.pendingIceCandidates.set(peerId, []);
    if (this.iceFlushTimers.has(peerId)) {
      clearTimeout(this.iceFlushTimers.get(peerId));
      this.iceFlushTimers.delete(peerId);
    }
  }

  /**
   * 设置连接超时
   */
  setConnectionTimeout(peerId) {
    const timer = setTimeout(() => {
      console.error("[MobileBridge] 连接超时:", peerId);
      this.handleConnectionFailed(peerId);
    }, this.connectionTimeout);

    this.connectionTimers.set(peerId, timer);
  }

  /**
   * 清除连接超时
   */
  clearConnectionTimeout(peerId) {
    if (this.connectionTimers.has(peerId)) {
      clearTimeout(this.connectionTimers.get(peerId));
      this.connectionTimers.delete(peerId);
    }
  }

  /**
   * 处理错误
   */
  handleError(peerId, context, error) {
    console.error(`[MobileBridge] ${context}:`, peerId, error);

    this.stats.errors++;

    // 增加错误计数
    const count = (this.errorCounts.get(peerId) || 0) + 1;
    this.errorCounts.set(peerId, count);

    // 设置错误计数重置定时器
    setTimeout(() => {
      this.errorCounts.delete(peerId);
    }, this.errorResetInterval);

    // 如果错误过多，断开连接
    if (count >= this.maxErrors) {
      console.error("[MobileBridge] 错误次数过多，断开连接:", peerId);
      this.closePeerConnection(peerId);
    }

    this.emit("error", { peerId, context, error, count });
  }

  /**
   * 检查是否应该阻止节点
   */
  shouldBlockPeer(peerId) {
    const errorCount = this.errorCounts.get(peerId) || 0;
    return errorCount >= this.maxErrors;
  }

  /**
   * 处理断开连接
   */
  handleDisconnection(peerId) {
    console.warn("[MobileBridge] 连接断开:", peerId);

    this.stats.activeConnections = Math.max(
      0,
      this.stats.activeConnections - 1,
    );
    this.emit("peer-disconnected", { peerId });

    // 尝试重连
    const attempts = this.reconnectAttempts.get(peerId) || 0;
    if (attempts < this.maxReconnectAttempts) {
      console.log(
        `[MobileBridge] 将尝试重连 (${attempts + 1}/${this.maxReconnectAttempts})`,
      );
      this.reconnectAttempts.set(peerId, attempts + 1);
      this.stats.reconnects++;
      // 注意：实际重连需要移动端重新发起Offer
    } else {
      console.log("[MobileBridge] 达到最大重连次数，放弃重连");
      this.closePeerConnection(peerId);
    }
  }

  /**
   * 处理连接失败
   */
  handleConnectionFailed(peerId) {
    console.error("[MobileBridge] 连接失败:", peerId);

    this.clearConnectionTimeout(peerId);
    this.stats.activeConnections = Math.max(
      0,
      this.stats.activeConnections - 1,
    );

    this.emit("connection-failed", { peerId });

    // 清理连接
    this.closePeerConnection(peerId);
  }

  /**
   * 处理节点状态变更
   */
  handlePeerStatus(message) {
    const { peerId, status } = message;

    console.log(`[MobileBridge] 节点状态变更: ${peerId} -> ${status}`);

    if (status === "offline") {
      // 清理连接
      this.closePeerConnection(peerId);
    }

    this.emit("peer-status", message);
  }

  /**
   * 处理离线消息
   */
  handleOfflineMessage(message) {
    const { originalMessage, storedAt, deliveredAt } = message;
    console.log("[MobileBridge] 收到离线消息:", originalMessage);

    // 转发到libp2p层
    this.emit("offline-message", { originalMessage, storedAt, deliveredAt });
  }

  /**
   * 处理P2P业务消息
   */
  async handleP2PMessage(message) {
    const { from, payload } = message;

    console.log("[MobileBridge] 收到P2P消息:", from);

    // 桥接到libp2p网络
    await this.bridgeToLibp2p(from, JSON.stringify(payload));
  }

  /**
   * 桥接消息到libp2p网络
   */
  async bridgeToLibp2p(mobilePeerId, data) {
    try {
      // 解析消息
      const message = typeof data === "string" ? JSON.parse(data) : data;

      this.stats.messagesForwarded++;
      this.stats.bytesTransferred += JSON.stringify(message).length;

      // 触发事件，让P2PManager处理
      this.emit("message-from-mobile", {
        mobilePeerId,
        message,
      });

      console.log("[MobileBridge] 消息已桥接到libp2p:", mobilePeerId);
    } catch (error) {
      console.error("[MobileBridge] 桥接消息失败:", error);
    }
  }

  /**
   * 发送消息到移动端
   */
  async sendToMobile(mobilePeerId, message) {
    const channel = this.dataChannels.get(mobilePeerId);

    if (!channel || channel.readyState !== "open") {
      console.warn("[MobileBridge] 数据通道未就绪，使用信令服务器转发");

      // 通过信令服务器转发
      this.send({
        type: "message",
        to: mobilePeerId,
        payload: message,
      });

      return;
    }

    try {
      // 通过DataChannel直接发送
      channel.send(JSON.stringify(message));
      this.stats.messagesForwarded++;
      this.stats.bytesTransferred += JSON.stringify(message).length;

      console.log("[MobileBridge] 消息已发送到移动端:", mobilePeerId);
    } catch (error) {
      console.error("[MobileBridge] 发送消息失败:", error);
      throw error;
    }
  }

  /**
   * 发送信令消息
   */
  send(message) {
    if (!this.isConnected || !this.signalingSocket) {
      console.warn("[MobileBridge] 信令服务器未连接，无法发送消息");
      return;
    }

    try {
      this.signalingSocket.send(JSON.stringify(message));
    } catch (error) {
      console.error("[MobileBridge] 发送信令消息失败:", error);
    }
  }

  /**
   * 关闭与指定节点的连接
   */
  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch (error) {
        console.error("[MobileBridge] 关闭PeerConnection失败:", error);
      }
      this.peerConnections.delete(peerId);
    }

    const channel = this.dataChannels.get(peerId);
    if (channel) {
      try {
        channel.close();
      } catch (error) {
        console.error("[MobileBridge] 关闭DataChannel失败:", error);
      }
      this.dataChannels.delete(peerId);
    }

    this.connectionStates.delete(peerId);
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      console.log("[MobileBridge] 尝试重新连接...");
      try {
        await this.connect();
      } catch (error) {
        console.error("[MobileBridge] 重连失败:", error);
      }
    }, this.options.reconnectInterval);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      isConnected: this.isConnected,
      peerConnectionsCount: this.peerConnections.size,
      dataChannelsCount: this.dataChannels.size,
    };
  }

  /**
   * 断开连接
   */
  async disconnect() {
    console.log("[MobileBridge] 断开连接...");

    // 清除所有定时器
    for (const timer of this.connectionTimers.values()) {
      clearTimeout(timer);
    }
    this.connectionTimers.clear();

    for (const timer of this.iceFlushTimers.values()) {
      clearTimeout(timer);
    }
    this.iceFlushTimers.clear();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 关闭所有WebRTC连接
    for (const [peerId, pc] of this.peerConnections.entries()) {
      try {
        pc.close();
      } catch (error) {
        console.error("[MobileBridge] 关闭PeerConnection失败:", error);
      }
    }

    this.peerConnections.clear();
    this.dataChannels.clear();
    this.connectionStates.clear();
    this.pendingIceCandidates.clear();
    this.errorCounts.clear();
    this.reconnectAttempts.clear();

    // 关闭WebSocket连接
    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    this.isConnected = false;
  }
}

module.exports = MobileBridge;
