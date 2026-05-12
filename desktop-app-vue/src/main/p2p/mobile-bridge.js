/**
 * Mobile Bridge - PC端libp2p与移动端WebRTC桥接层
 *
 * 功能：
 * - 连接到信令服务器（WebSocket客户端）
 * - 处理移动端WebRTC信令（Offer/Answer/ICE）
 * - WebRTC DataChannel与libp2p Stream桥接
 * - 消息转发和协议转换
 */

const { logger } = require("../utils/logger.js");
const WebSocket = require("ws");
const EventEmitter = require("events");

// wrtc-compat now wraps node-datachannel/polyfill (W3C-standard RTCPeerConnection
// via libdatachannel C++ binding, N-API v8). Replaces werift in v5.0.3.46+.
const wrtcCompat = require("./wrtc-compat");
const wrtc = wrtcCompat;
const wrtcAvailable = wrtcCompat.available;

if (!wrtcAvailable) {
  logger.warn(
    "[MobileBridge] WebRTC (node-datachannel) not available:",
    wrtcCompat.loadError?.message || "unknown error",
  );
  logger.warn("[MobileBridge] Mobile bridging via WebRTC will be disabled");
} else {
  logger.info("[MobileBridge] WebRTC initialized via node-datachannel");
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

    // 反向 RPC：桌面发起 sign.request 等指令时记录 pending request,
    // 收到匹配 id 的 response 时 resolve（M5 ADR-6 接通 MobileSignClient 的 transport 抽象）
    this.pendingReverseRpc = new Map(); // requestId -> {resolve, reject, timer, peerId, method, sentAt}

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
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;

    // 指数退避重连配置
    this.signalingReconnectAttempts = 0;
    this.maxSignalingReconnectAttempts =
      options.maxSignalingReconnectAttempts || 10;
    this.baseReconnectDelay = options.baseReconnectDelay || 1000; // 1秒基础延迟
    this.maxReconnectDelay = options.maxReconnectDelay || 60000; // 最大60秒延迟
    this.reconnectBackoffFactor = options.reconnectBackoffFactor || 2;

    // 心跳检测
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30秒心跳
    this.heartbeatTimer = null;
    this.lastPong = Date.now();
    this.heartbeatTimeout = options.heartbeatTimeout || 90000; // 3个心跳周期

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
      logger.info(
        "[MobileBridge] 连接到信令服务器:",
        this.options.signalingUrl,
      );

      try {
        this.signalingSocket = new WebSocket(this.options.signalingUrl);

        this.signalingSocket.on("open", () => {
          logger.info("[MobileBridge] ✓ 信令服务器 WebSocket 连接成功");
          this.isConnected = true;

          // 注册PC端身份
          logger.info("[MobileBridge] 开始注册PC端身份...");
          this.register();

          resolve();
        });

        this.signalingSocket.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString("utf8"));
            this.handleSignalingMessage(message);
          } catch (error) {
            logger.error("[MobileBridge] 信令消息解析失败:", error);
          }
        });

        this.signalingSocket.on("close", () => {
          logger.info("[MobileBridge] 信令服务器连接关闭");
          this.isConnected = false;

          // 自动重连
          if (this.options.enableAutoReconnect) {
            this.scheduleReconnect();
          }
        });

        this.signalingSocket.on("error", (error) => {
          logger.error("[MobileBridge] WebSocket错误:", error);
          reject(error);
        });
      } catch (error) {
        logger.error("[MobileBridge] 创建WebSocket失败:", error);
        reject(error);
      }
    });
  }

  /**
   * 注册PC端身份到信令服务器
   * 使用与 signaling-server registerLocal 相同的 deviceId，
   * 这样 Android 发送 offer 到该 ID 时可以正确转发到 MobileBridge
   */
  register() {
    if (!this.isConnected || !this.signalingSocket) {
      logger.warn("[MobileBridge] register() 调用但未连接，跳过");
      return;
    }

    logger.info("[MobileBridge] ========================================");
    logger.info("[MobileBridge] 开始注册到信令服务器");
    logger.info("[MobileBridge] p2pManager存在: " + !!this.p2pManager);
    logger.info(
      "[MobileBridge] deviceManager存在: " + !!this.p2pManager?.deviceManager,
    );

    // 优先使用 deviceManager 中的 deviceId（与 signaling-server 的 registerLocal 保持一致）
    let peerId = "unknown";
    if (this.p2pManager.deviceManager) {
      const currentDevice = this.p2pManager.deviceManager.getCurrentDevice();
      logger.info(
        "[MobileBridge] currentDevice: " + JSON.stringify(currentDevice || {}),
      );
      if (currentDevice && currentDevice.deviceId) {
        peerId = currentDevice.deviceId;
        logger.info("[MobileBridge] ✓ 使用 deviceManager deviceId:", peerId);
      } else {
        logger.warn("[MobileBridge] ✗ deviceManager 存在但无有效 deviceId");
      }
    }
    // 如果没有 deviceManager，回退到 p2pManager.peerId
    if (peerId === "unknown" && this.p2pManager.peerId) {
      peerId = this.p2pManager.peerId.toString();
      logger.warn("[MobileBridge] ⚠ 回退使用 p2pManager.peerId:", peerId);
    }

    if (peerId === "unknown") {
      logger.error("[MobileBridge] ✗ 无法获取有效的 peerId！");
    }

    logger.info("[MobileBridge] 最终注册 peerId:", peerId);
    logger.info("[MobileBridge] ========================================");

    // v1.1 W3.7 Flow B: expose 已注册的 peerId on instance 让 desktop-pair
    // WS topic 能填入 QR payload pcPeerId 字段。否则 phone scan 后 ack 到
    // "desktop-unknown" 信令服务器找不到 forward 目标。
    this.peerId = peerId;

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
        logger.info("[MobileBridge] 注册成功:", message.peerId);
        // 重置重连计数
        this.signalingReconnectAttempts = 0;
        // 启动心跳检测
        this.startHeartbeat();
        this.emit("registered", message);
        break;

      case "pong":
        // 收到心跳响应
        this.lastPong = Date.now();
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
        logger.error("[MobileBridge] 服务器错误:", message.error);
        break;

      default:
        logger.warn("[MobileBridge] 未知消息类型:", type);
    }
  }

  /**
   * 处理移动端的WebRTC Offer
   */
  async handleOffer(message) {
    const { from, offer, iceRestart } = message;

    logger.info("========================================");
    logger.info("[MobileBridge] 收到移动端Offer");
    logger.info("[MobileBridge] 发送方: " + from);
    logger.info("[MobileBridge] ICE重启: " + (iceRestart ? "是" : "否"));
    logger.info("[MobileBridge] Offer类型: " + (offer?.type || "未知"));
    logger.info("[MobileBridge] SDP长度: " + (offer?.sdp?.length || 0));
    // Base64 encode SDP for safe logging
    const sdpB64 = Buffer.from(offer?.sdp || "").toString("base64");
    logger.info("[MobileBridge] SDP内容(Base64):\n" + sdpB64);
    // Also show first 200 chars escaped
    const sdpEscaped = JSON.stringify(offer?.sdp || "").substring(0, 500);
    logger.info("[MobileBridge] SDP前500字符(JSON转义): " + sdpEscaped);
    logger.info("========================================");

    // 检查 wrtc 是否可用 —— wrtc-compat 总是导出 module 对象，所以必须查
    // wrtcAvailable / RTCPeerConnection 而非 truthy of module（v5.0.3.46+ 修
    // 此前 if(!wrtc) 永远 false 的 silent-broken 谬）。
    if (!wrtcAvailable || !wrtc.RTCPeerConnection) {
      logger.error("========================================");
      logger.error("[MobileBridge] wrtc (node-datachannel) 不可用!");
      logger.error("[MobileBridge] 无法处理 WebRTC 连接");
      logger.error(
        "[MobileBridge] loadError: " + (wrtcCompat.loadError?.message || "无"),
      );
      logger.error("========================================");
      this.send({
        type: "error",
        to: from,
        error: "WebRTC not available on this platform",
      });
      return;
    }
    logger.info("[MobileBridge] ✓ node-datachannel WebRTC 可用");

    try {
      // 检查连接池限制
      if (
        !this.peerConnections.has(from) &&
        this.peerConnections.size >= this.maxConnections
      ) {
        logger.error("[MobileBridge] 连接池已满，拒绝新连接:", from);
        this.send({
          type: "error",
          to: from,
          error: "Connection pool full",
        });
        return;
      }

      // 检查错误计数
      if (this.shouldBlockPeer(from)) {
        logger.error("[MobileBridge] 节点错误过多，暂时阻止:", from);
        return;
      }

      // 如果是ICE重启，关闭旧连接
      if (iceRestart && this.peerConnections.has(from)) {
        logger.info("[MobileBridge] ICE重启，关闭旧连接:", from);
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
        logger.info(
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
        logger.info(
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
        logger.info("[MobileBridge] ========================================");
        logger.info("[MobileBridge] 数据通道已建立:", from);
        logger.info("[MobileBridge] 通道标签:", channel.label);
        logger.info("[MobileBridge] 通道状态:", channel.readyState);
        logger.info("[MobileBridge] ========================================");

        this.dataChannels.set(from, channel);

        channel.onopen = () => {
          logger.info(
            "[MobileBridge] 数据通道已打开:",
            from,
            "状态:",
            channel.readyState,
          );
        };

        channel.onmessage = async (event) => {
          logger.info(
            "[MobileBridge] ========================================",
          );
          logger.info("[MobileBridge] 收到DataChannel消息:", from);
          const msgData =
            typeof event.data === "string"
              ? event.data
              : event.data instanceof ArrayBuffer
                ? new TextDecoder().decode(event.data)
                : event.data?.toString
                  ? event.data.toString("utf8")
                  : JSON.stringify(event.data);
          logger.info("[MobileBridge] 消息内容:", msgData.slice(0, 200));
          logger.info(
            "[MobileBridge] ========================================",
          );
          try {
            await this.bridgeToLibp2p(from, msgData);
          } catch (error) {
            logger.error("[MobileBridge] 桥接消息失败:", error);
            this.handleError(from, "桥接消息失败", error);
          }
        };

        channel.onerror = (error) => {
          logger.error("[MobileBridge] DataChannel错误:", from, error);
          this.handleError(from, "DataChannel错误", error);
        };

        channel.onclose = () => {
          logger.info("[MobileBridge] 数据通道已关闭:", from);
          this.dataChannels.delete(from);
        };

        // 如果通道已经打开，立即触发
        if (channel.readyState === "open") {
          logger.info("[MobileBridge] 通道已经处于打开状态:", from);
        }
      };

      // 设置远程描述（Offer）
      logger.info("[MobileBridge] 准备设置远程描述:");
      logger.info("[MobileBridge]   offer对象类型: " + typeof offer);
      logger.info("[MobileBridge]   offer.type: " + offer?.type);
      logger.info("[MobileBridge]   offer.sdp类型: " + typeof offer?.sdp);
      logger.info(
        "[MobileBridge]   offer.sdp长度: " + (offer?.sdp?.length || 0),
      );
      logger.info(
        "[MobileBridge]   offer对象结构: " +
          JSON.stringify(Object.keys(offer || {})),
      );

      const sdpToUse = {
        type: offer?.type || "offer",
        sdp: offer?.sdp || "",
      };
      logger.info("[MobileBridge]   规范化后的SDP长度: " + sdpToUse.sdp.length);
      logger.info("[MobileBridge]   sdpToUse.type: " + sdpToUse.type);
      logger.info("[MobileBridge]   sdpToUse.sdp存在: " + !!sdpToUse.sdp);

      // Pass plain object directly - werift accepts RTCSessionDescriptionInit
      // Don't use RTCSessionDescription wrapper as werift has non-standard constructor
      await pc.setRemoteDescription(sdpToUse);

      // 创建Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 发送Answer到移动端
      // werift's localDescription doesn't have toJSON(), so we manually construct the object
      const localDesc = pc.localDescription;
      const answerData = {
        type: localDesc.type,
        sdp: localDesc.sdp,
      };
      logger.info("[MobileBridge] 准备发送Answer:");
      logger.info("[MobileBridge]   类型: " + answerData.type);
      logger.info("[MobileBridge]   SDP长度: " + (answerData.sdp?.length || 0));

      this.send({
        type: "answer",
        to: from,
        answer: answerData,
      });

      // 保存PeerConnection
      this.peerConnections.set(from, pc);
      this.stats.totalConnections++;

      logger.info("========================================");
      logger.info("[MobileBridge] ✓ Answer已发送到: " + from);
      logger.info("[MobileBridge] 等待ICE连接建立...");
      logger.info("========================================");
    } catch (error) {
      logger.error("========================================");
      logger.error("[MobileBridge] 处理Offer失败!");
      logger.error("[MobileBridge] 错误: " + error.message);
      logger.error("[MobileBridge] 堆栈: " + error.stack);
      logger.error("========================================");
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
      logger.warn("[MobileBridge] 未找到对应的PeerConnection:", from);
      return;
    }

    if (!wrtc) {
      logger.error("[MobileBridge] wrtc not available, cannot apply answer");
      return;
    }

    try {
      await pc.setRemoteDescription(new wrtc.RTCSessionDescription(answer));
      logger.info("[MobileBridge] Answer已应用:", from);
    } catch (error) {
      logger.error("[MobileBridge] 应用Answer失败:", error);
    }
  }

  /**
   * 处理ICE候选
   */
  async handleICECandidate(message) {
    const { from, candidate } = message;
    const pc = this.peerConnections.get(from);

    if (!pc) {
      logger.warn("[MobileBridge] 未找到对应的PeerConnection:", from);
      return;
    }

    if (!wrtc) {
      logger.error(
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

    if (!candidates || candidates.length === 0) {
      return;
    }

    logger.info(`[MobileBridge] 处理批量ICE候选: ${candidates.length}个`, from);

    const pc = this.peerConnections.get(from);
    if (!pc) {
      logger.warn("[MobileBridge] 未找到对应的PeerConnection:", from);
      return;
    }

    if (!wrtc) {
      logger.error(
        "[MobileBridge] wrtc not available, cannot add ICE candidates",
      );
      return;
    }

    try {
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
        } catch (error) {
          logger.error("[MobileBridge] 添加单个ICE候选失败:", error);
        }
      }
      logger.info(`[MobileBridge] ✅ 已添加 ${candidates.length} 个ICE候选`);
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
    if (!candidates || candidates.length === 0) {
      return;
    }

    logger.info(
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
      logger.error("[MobileBridge] 连接超时:", peerId);
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
    logger.error(`[MobileBridge] ${context}:`, peerId, error);

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
      logger.error("[MobileBridge] 错误次数过多，断开连接:", peerId);
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
    logger.warn("[MobileBridge] 连接断开:", peerId);

    this.stats.activeConnections = Math.max(
      0,
      this.stats.activeConnections - 1,
    );
    this.emit("peer-disconnected", { peerId });

    // 尝试重连
    const attempts = this.reconnectAttempts.get(peerId) || 0;
    if (attempts < this.maxReconnectAttempts) {
      logger.info(
        `[MobileBridge] 将尝试重连 (${attempts + 1}/${this.maxReconnectAttempts})`,
      );
      this.reconnectAttempts.set(peerId, attempts + 1);
      this.stats.reconnects++;
      // 注意：实际重连需要移动端重新发起Offer
    } else {
      logger.info("[MobileBridge] 达到最大重连次数，放弃重连");
      this.closePeerConnection(peerId);
    }
  }

  /**
   * 处理连接失败
   */
  handleConnectionFailed(peerId) {
    logger.error("[MobileBridge] 连接失败:", peerId);

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
   *
   * Phase 3d v1.3 fix: signaling WebSocket 与 datachannel 是两条独立通道。移动端
   * 在 datachannel 建立后通常会主动断开 signaling WS 省电，这条信令"offline"
   * 通知**不应**触发 datachannel 关闭——否则连上 5s 就被踢，sync 跑不起来。
   * 只在 datachannel 不存在或已 closed 时才清理 PC 端连接。
   */
  handlePeerStatus(message) {
    const { peerId, status } = message;

    logger.info(`[MobileBridge] 节点状态变更: ${peerId} -> ${status}`);

    if (status === "offline") {
      const channel = this.dataChannels.get(peerId);
      const channelOpen =
        channel &&
        (channel.readyState === "open" || channel.readyState === "connecting");
      if (channelOpen) {
        logger.info(
          `[MobileBridge] 忽略 signaling offline (${peerId}): datachannel 仍 ${channel.readyState}`,
        );
      } else {
        this.closePeerConnection(peerId);
      }
    }

    this.emit("peer-status", message);
  }

  /**
   * 处理离线消息
   * 包括在 MobileBridge 连接前入队的 offer 等消息
   */
  async handleOfflineMessage(message) {
    const { originalMessage, storedAt, deliveredAt } = message;
    logger.info(
      "[MobileBridge] 收到离线消息:",
      JSON.stringify(originalMessage).slice(0, 200),
    );

    // 检查原始消息类型，如果是 offer，需要特殊处理
    if (originalMessage && originalMessage.type === "offer") {
      logger.info("[MobileBridge] 离线消息是 Offer，处理中...");
      await this.handleOffer(originalMessage);
      return;
    }

    if (originalMessage && originalMessage.type === "ice-candidate") {
      logger.info("[MobileBridge] 离线消息是 ICE候选，处理中...");
      await this.handleICECandidate(originalMessage);
      return;
    }

    if (originalMessage && originalMessage.type === "ice-candidates") {
      logger.info("[MobileBridge] 离线消息是批量ICE候选，处理中...");
      await this.handleICECandidates(originalMessage);
      return;
    }

    // 转发到libp2p层
    this.emit("offline-message", { originalMessage, storedAt, deliveredAt });
  }

  /**
   * 处理P2P业务消息
   */
  async handleP2PMessage(message) {
    const { from, payload } = message;

    logger.info("[MobileBridge] 收到P2P消息:", from);

    // v1.1 W3.7 Flow B (issue #19): pair-ack 拦截 — mobile 扫桌面 QR 完成后
    // 经信令发 {type:"pair-ack"} 到 desktop 的 pcPeerId。捕获后调
    // desktop-pair-handlers.recordPairAck 让 Vue poll 看到 acked 状态。
    // 不 bridgeToLibp2p，pair-ack 是 desktop-pairing 协议专用，不走 libp2p。
    if (payload && payload.type === "pair-ack") {
      try {
        const {
          recordPairAck,
        } = require("../web-shell/handlers/desktop-pair-handlers");
        const matched = recordPairAck(payload);
        if (!matched) {
          logger.warn(
            "[MobileBridge] pair-ack 无活跃 session 或 code 不匹配，丢弃",
          );
        } else {
          logger.info("[MobileBridge] ✓ pair-ack 已记录 desktop session");
        }
      } catch (e) {
        logger.error("[MobileBridge] recordPairAck 调用失败:", e?.message);
      }
      return;
    }

    // 桥接到libp2p网络
    await this.bridgeToLibp2p(from, JSON.stringify(payload));
  }

  /**
   * 桥接消息到libp2p网络
   */
  async bridgeToLibp2p(mobilePeerId, data) {
    try {
      logger.info("[MobileBridge] ========================================");
      logger.info("[MobileBridge] bridgeToLibp2p 被调用");
      logger.info("[MobileBridge] mobilePeerId:", mobilePeerId);
      logger.info("[MobileBridge] data类型:", typeof data);
      logger.info("[MobileBridge] data长度:", data?.length || 0);

      // 解析消息
      const message = typeof data === "string" ? JSON.parse(data) : data;

      logger.info("[MobileBridge] 解析后的消息类型:", message?.type);
      logger.info(
        "[MobileBridge] 解析后的消息payload存在:",
        !!message?.payload,
      );

      this.stats.messagesForwarded++;
      this.stats.bytesTransferred += JSON.stringify(message).length;

      // 反向 RPC 响应拦截：若 message 是 JSON-RPC 2.0 response (jsonrpc + id + result|error)
      // 且 id 在 pendingReverseRpc 中，resolve pending Promise，不再 emit 给一般 P2P 流程。
      if (
        message &&
        message.jsonrpc === "2.0" &&
        typeof message.id === "string" &&
        this.pendingReverseRpc.has(message.id) &&
        (message.result !== undefined || message.error !== undefined)
      ) {
        const pending = this.pendingReverseRpc.get(message.id);
        this.pendingReverseRpc.delete(message.id);
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        const latencyMs = Date.now() - pending.sentAt;
        logger.info(
          "[MobileBridge] 反向 RPC response 收到: id=%s method=%s latency=%dms",
          message.id,
          pending.method,
          latencyMs,
        );
        pending.resolve(message);
        return; // 不 emit
      }

      // 触发事件，让P2PManager处理
      this.emit("message-from-mobile", {
        mobilePeerId,
        message,
      });

      logger.info("[MobileBridge] ✓ message-from-mobile 事件已触发");
      logger.info("[MobileBridge] ========================================");
    } catch (error) {
      logger.error("[MobileBridge] ========================================");
      logger.error("[MobileBridge] 桥接消息失败!");
      logger.error("[MobileBridge] 错误:", error.message);
      logger.error("[MobileBridge] 原始数据:", data?.slice?.(0, 200) || data);
      logger.error("[MobileBridge] ========================================");
    }
  }

  /**
   * 发送消息到移动端
   */
  async sendToMobile(mobilePeerId, message) {
    logger.info("[MobileBridge] ========================================");
    logger.info("[MobileBridge] 准备发送消息到移动端:", mobilePeerId);

    const channel = this.dataChannels.get(mobilePeerId);

    logger.info("[MobileBridge] DataChannel存在:", !!channel);
    if (channel) {
      logger.info("[MobileBridge] DataChannel状态:", channel.readyState);
      logger.info(
        "[MobileBridge] DataChannel状态类型:",
        typeof channel.readyState,
      );
    }
    logger.info(
      "[MobileBridge] 当前所有DataChannels:",
      Array.from(this.dataChannels.keys()),
    );

    // werift 可能使用不同的状态值，支持 "open", "Open", 1 等
    const isChannelOpen =
      channel &&
      (channel.readyState === "open" ||
        channel.readyState === "Open" ||
        channel.readyState === 1 ||
        channel.readyState === "OPEN");

    if (!isChannelOpen) {
      logger.warn("[MobileBridge] 数据通道未就绪，使用信令服务器转发");
      logger.warn("[MobileBridge]   channel存在:", !!channel);
      logger.warn("[MobileBridge]   readyState:", channel?.readyState);

      // 通过信令服务器转发
      this.send({
        type: "message",
        to: mobilePeerId,
        payload: message,
      });
      logger.info("[MobileBridge] ========================================");
      return;
    }

    try {
      // 通过DataChannel直接发送
      const msgStr = JSON.stringify(message);
      channel.send(msgStr);
      this.stats.messagesForwarded++;
      this.stats.bytesTransferred += msgStr.length;

      logger.info(
        "[MobileBridge] ✓ 消息已通过DataChannel发送到移动端:",
        mobilePeerId,
      );
      logger.info("[MobileBridge]   消息长度:", msgStr.length);
      logger.info("[MobileBridge] ========================================");
    } catch (error) {
      logger.error("[MobileBridge] ✗ 发送消息失败:", error);
      logger.info("[MobileBridge] ========================================");
      throw error;
    }
  }

  /**
   * 反向 JSON-RPC 请求（桌面 → Android）。
   *
   * 设计文档 M5 ADR-6 + MobileSignClient transport 抽象的真实接通：
   *  1. request.id 唯一 → 存 pendingReverseRpc map
   *  2. 通过 [sendToMobile] 推到 Android（DataChannel 或 signaling fallback）
   *  3. timeoutMs 后未收到响应 → reject with timeout
   *  4. Android 端 RemoteCommandClient 收到 sign.request 等 method → 路由
   *     SignAsService → 返回 JSON-RPC response with matching id
   *  5. response 经 channel.onmessage → bridgeToLibp2p → 拦截分支 resolve
   *     本 Promise
   *
   * @param {string} mobilePeerId 目标 Android 设备 ID
   * @param {Object} request JSON-RPC 2.0 request（含 jsonrpc:"2.0" + id + method + params）
   * @param {number} [timeoutMs=60000] 超时（默认 60s 覆盖慢用户 BiometricPrompt）
   * @returns {Promise<Object>} Android 端的 JSON-RPC response
   */
  async sendReverseRpcRequest(mobilePeerId, request, timeoutMs = 60000) {
    if (
      !request ||
      request.jsonrpc !== "2.0" ||
      !request.id ||
      !request.method
    ) {
      throw new Error(
        "sendReverseRpcRequest requires valid JSON-RPC 2.0 request with id + method",
      );
    }
    if (this.pendingReverseRpc.has(request.id)) {
      throw new Error(`Duplicate reverse RPC request id: ${request.id}`);
    }

    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingReverseRpc.has(request.id)) {
          this.pendingReverseRpc.delete(request.id);
          logger.warn(
            "[MobileBridge] 反向 RPC 超时: id=%s method=%s after %dms",
            request.id,
            request.method,
            timeoutMs,
          );
          reject(
            new Error(
              `Reverse RPC timed out after ${timeoutMs}ms (method=${request.method}, peerId=${mobilePeerId})`,
            ),
          );
        }
      }, timeoutMs);

      this.pendingReverseRpc.set(request.id, {
        resolve,
        reject,
        timer,
        peerId: mobilePeerId,
        method: request.method,
        sentAt: Date.now(),
      });
    });

    // 同步启动 send；失败立刻 reject pending Promise（不等 timeout）。
    // 拆开避免 ESLint no-async-promise-executor。
    this.sendToMobile(mobilePeerId, request).then(
      () => {
        logger.info(
          "[MobileBridge] 反向 RPC 已送出: id=%s method=%s peerId=%s",
          request.id,
          request.method,
          mobilePeerId,
        );
      },
      (err) => {
        const pending = this.pendingReverseRpc.get(request.id);
        if (pending) {
          this.pendingReverseRpc.delete(request.id);
          clearTimeout(pending.timer);
          pending.reject(err);
        }
      },
    );

    return resultPromise;
  }

  /**
   * 返回符合 [MobileSignClient] 期望的 transport 适配器：`{send(peerId, req) → Promise<resp>}`.
   * 真接通 M5 反向 sign.request 路径。
   */
  asMobileSignTransport() {
    return {
      send: (peerId, request) => this.sendReverseRpcRequest(peerId, request),
    };
  }

  /**
   * 发送信令消息
   */
  send(message) {
    if (!this.isConnected || !this.signalingSocket) {
      logger.warn("[MobileBridge] 信令服务器未连接，无法发送消息");
      return;
    }

    try {
      this.signalingSocket.send(JSON.stringify(message));
    } catch (error) {
      logger.error("[MobileBridge] 发送信令消息失败:", error);
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
        logger.error("[MobileBridge] 关闭PeerConnection失败:", error);
      }
      this.peerConnections.delete(peerId);
    }

    const channel = this.dataChannels.get(peerId);
    if (channel) {
      try {
        channel.close();
      } catch (error) {
        logger.error("[MobileBridge] 关闭DataChannel失败:", error);
      }
      this.dataChannels.delete(peerId);
    }

    this.connectionStates.delete(peerId);
  }

  /**
   * 安排重连（指数退避策略）
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // 检查是否超过最大重试次数
    if (this.signalingReconnectAttempts >= this.maxSignalingReconnectAttempts) {
      logger.error(
        `[MobileBridge] 达到最大重连次数 (${this.maxSignalingReconnectAttempts})，停止重连`,
      );
      this.emit("reconnect-failed", {
        attempts: this.signalingReconnectAttempts,
        maxAttempts: this.maxSignalingReconnectAttempts,
      });
      return;
    }

    // 计算指数退避延迟
    const delay = Math.min(
      this.baseReconnectDelay *
        Math.pow(this.reconnectBackoffFactor, this.signalingReconnectAttempts),
      this.maxReconnectDelay,
    );

    this.signalingReconnectAttempts++;

    logger.info(
      `[MobileBridge] 将在 ${delay}ms 后重连 (${this.signalingReconnectAttempts}/${this.maxSignalingReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      logger.info(
        `[MobileBridge] 尝试重新连接... (${this.signalingReconnectAttempts}/${this.maxSignalingReconnectAttempts})`,
      );
      try {
        await this.connect();
        // 连接成功，重置重试计数
        this.signalingReconnectAttempts = 0;
        logger.info("[MobileBridge] ✅ 重连成功");
      } catch (error) {
        logger.error("[MobileBridge] 重连失败:", error);
        // 继续尝试重连
        if (this.options.enableAutoReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * 重置重连计数（手动调用时）
   */
  resetReconnectAttempts() {
    this.signalingReconnectAttempts = 0;
    logger.info("[MobileBridge] 重连计数已重置");
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    // 清除旧的心跳定时器
    this.stopHeartbeat();

    this.lastPong = Date.now();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);

    logger.info(
      `[MobileBridge] 心跳检测已启动 (间隔: ${this.heartbeatInterval}ms)`,
    );
  }

  /**
   * 发送心跳
   */
  sendHeartbeat() {
    // 检查心跳超时
    const timeSinceLastPong = Date.now() - this.lastPong;
    if (timeSinceLastPong > this.heartbeatTimeout) {
      logger.warn(
        `[MobileBridge] 心跳超时 (${timeSinceLastPong}ms > ${this.heartbeatTimeout}ms)`,
      );
      this.handleHeartbeatTimeout();
      return;
    }

    // 发送 ping
    if (this.isConnected && this.signalingSocket) {
      this.send({ type: "ping", timestamp: Date.now() });
    }
  }

  /**
   * 处理心跳超时
   */
  handleHeartbeatTimeout() {
    logger.error("[MobileBridge] 心跳超时，连接可能已断开");

    this.stopHeartbeat();
    this.isConnected = false;

    // 关闭 WebSocket
    if (this.signalingSocket) {
      try {
        this.signalingSocket.close();
      } catch (e) {
        // 忽略关闭错误
      }
      this.signalingSocket = null;
    }

    this.emit("heartbeat-timeout");

    // 尝试重连
    if (this.options.enableAutoReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      logger.info("[MobileBridge] 心跳检测已停止");
    }
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
    logger.info("[MobileBridge] 断开连接...");

    // 停止心跳
    this.stopHeartbeat();

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
        logger.error("[MobileBridge] 关闭PeerConnection失败:", error);
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
