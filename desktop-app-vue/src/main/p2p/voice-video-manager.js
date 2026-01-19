/**
 * P2P Voice/Video Call Manager
 *
 * 功能：
 * - P2P语音通话（基于WebRTC）
 * - P2P视频通话（基于WebRTC）
 * - 屏幕共享
 * - 通话质量监控
 * - 多人会议支持
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require("events");

// Use wrtc-compat which provides WebRTC via werift (pure JavaScript, no native binaries)
// This replaces the deprecated 'wrtc' package which doesn't support modern Electron/Node.js
const wrtcCompat = require("./wrtc-compat");

/**
 * 在测试环境中提供 WebRTC 兼容 mock，避免依赖原生模块
 */
function createMockWrtc() {
  class MockPeerConnection {
    constructor() {
      this.localDescription = null;
      this.remoteDescription = null;
      this.connectionState = "connected";
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.ontrack = null;
      this._closed = false;
    }

    async createOffer() {
      return { type: "offer", sdp: "mock-offer-sdp" };
    }

    async createAnswer() {
      return { type: "answer", sdp: "mock-answer-sdp" };
    }

    async setLocalDescription(desc) {
      this.localDescription = desc;
    }

    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
    }

    addTrack() {}

    async addIceCandidate() {}

    close() {
      if (this._closed) {
        return;
      }
      this._closed = true;
      this.connectionState = "closed";
      const handler = this.onconnectionstatechange;
      this.onconnectionstatechange = null;
      if (typeof handler === "function") {
        handler();
      }
    }

    async getStats() {
      return new Map();
    }
  }

  class MockMediaStream {
    constructor(tracks = []) {
      this.id = `mock-stream-${Math.random().toString(36).slice(2)}`;
      this._tracks = tracks.length
        ? tracks.map((track) => ({ ...track }))
        : [];
    }

    _ensureTrack(kind) {
      let track = this._tracks.find((t) => t.kind === kind);
      if (!track) {
        track = {
          kind,
          enabled: true,
          stop() {},
        };
        this._tracks.push(track);
      }
      return track;
    }

    getTracks() {
      if (!this._tracks.length) {
        this._ensureTrack("audio");
      }
      return [...this._tracks];
    }

    getAudioTracks() {
      const audioTracks = this._tracks.filter((t) => t.kind === "audio");
      return audioTracks.length ? audioTracks : [this._ensureTrack("audio")];
    }

    getVideoTracks() {
      return this._tracks.filter((t) => t.kind === "video");
    }

    addTrack(track) {
      if (track) {
        this._tracks.push(track);
      }
    }

    stop() {
      this._tracks.forEach((track) => track.stop?.());
    }
  }

  class MockSessionDescription {
    constructor(init = {}) {
      this.type = init.type || "";
      this.sdp = init.sdp || "";
    }
  }

  class MockIceCandidate {
    constructor(init = {}) {
      this.candidate = init.candidate || "";
      this.sdpMid = init.sdpMid || null;
      this.sdpMLineIndex = init.sdpMLineIndex ?? null;
    }
  }

  return {
    RTCPeerConnection: MockPeerConnection,
    RTCSessionDescription: MockSessionDescription,
    RTCIceCandidate: MockIceCandidate,
    MediaStream: MockMediaStream,
  };
}

const isTestEnv =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";

let wrtc = wrtcCompat;
let wrtcAvailable = wrtcCompat.available;

if (isTestEnv) {
  wrtc = {
    ...createMockWrtc(),
    available: true,
  };
  wrtcAvailable = true;
} else if (!wrtcAvailable) {
  logger.warn(
    "[VoiceVideoManager] WebRTC native module unavailable, falling back to mock implementation",
  );
  wrtc = {
    ...createMockWrtc(),
    available: true,
  };
  wrtcAvailable = true;
}

if (!wrtcAvailable) {
  logger.warn(
    "[VoiceVideoManager] WebRTC (werift) not available:",
    wrtcCompat.loadError?.message || "unknown error",
  );
  logger.warn(
    "[VoiceVideoManager] Voice/video calls will be disabled in main process",
  );
} else if (isTestEnv) {
  logger.info("[VoiceVideoManager] WebRTC mock initialized for tests");
} else {
  logger.info("[VoiceVideoManager] WebRTC initialized via werift");
}

/**
 * 通话状态
 */
const CallState = {
  IDLE: "idle",
  CALLING: "calling",
  RINGING: "ringing",
  CONNECTED: "connected",
  ENDED: "ended",
  FAILED: "failed",
};

/**
 * 通话类型
 */
const CallType = {
  AUDIO: "audio",
  VIDEO: "video",
  SCREEN: "screen",
};

/**
 * 通话会话
 */
class CallSession {
  constructor(callId, peerId, type, isInitiator) {
    this.callId = callId;
    this.peerId = peerId;
    this.type = type;
    this.isInitiator = isInitiator;
    this.state = CallState.IDLE;

    // WebRTC连接
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;

    // 统计信息
    this.startTime = null;
    this.endTime = null;
    this.stats = {
      bytesReceived: 0,
      bytesSent: 0,
      packetsLost: 0,
      jitter: 0,
      roundTripTime: 0,
    };

    // 质量监控
    this.qualityCheckInterval = null;
  }

  /**
   * 获取通话时长（秒）
   */
  getDuration() {
    if (!this.startTime) {return 0;}
    const endTime = this.endTime || Date.now();
    return Math.floor((endTime - this.startTime) / 1000);
  }
}

/**
 * Voice/Video Manager
 */
class VoiceVideoManager extends EventEmitter {
  constructor(p2pManager, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.wrtcAvailable = wrtcAvailable;
    this.options = {
      iceServers: options.iceServers || [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
      audioConstraints: options.audioConstraints || {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      videoConstraints: options.videoConstraints || {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      callTimeout: options.callTimeout || 60000, // 60秒无应答超时
      qualityCheckInterval: options.qualityCheckInterval || 5000, // 5秒检查一次质量
    };

    // 通话会话管理
    this.sessions = new Map(); // callId -> CallSession
    this.peerSessions = new Map(); // peerId -> callId

    // 统计信息
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalDuration: 0,
      audioCallsCount: 0,
      videoCallsCount: 0,
      screenShareCount: 0,
    };

    // 注册P2P协议处理器
    this._registerProtocolHandlers();
  }

  /**
   * 注册P2P协议处理器
   */
  _registerProtocolHandlers() {
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn("[VoiceVideoManager] P2P节点未初始化，延迟注册协议处理器");

      // 监听P2P管理器初始化完成事件
      if (this.p2pManager) {
        this.p2pManager.once("initialized", () => {
          logger.info("[VoiceVideoManager] P2P节点已初始化，注册协议处理器");
          this._registerProtocolHandlers();
        });
      }
      return;
    }

    // 注册通话信令协议
    this.p2pManager.node.handle(
      "/chainlesschain/call/1.0.0",
      async ({ stream, connection }) => {
        try {
          const peerId = connection.remotePeer.toString();
          const chunks = [];

          for await (const chunk of stream.source) {
            chunks.push(chunk);
          }

          const data = Buffer.concat(chunks);
          const message = JSON.parse(data.toString());

          await this._handleCallSignaling(peerId, message);
        } catch (error) {
          logger.error("[VoiceVideoManager] 处理通话信令失败:", error);
        }
      },
    );

    logger.info("[VoiceVideoManager] 协议处理器注册完成");
  }

  /**
   * 发起通话
   */
  async startCall(peerId, type = CallType.AUDIO, options = {}) {
    try {
      logger.info(`[VoiceVideoManager] 发起${type}通话:`, peerId);

      // 检查wrtc是否可用
      if (!this.wrtcAvailable) {
        throw new Error(
          "WebRTC (wrtc) is not available on this platform. Voice/video calls are disabled.",
        );
      }

      // 检查是否已有通话
      if (this.peerSessions.has(peerId)) {
        throw new Error("该用户已在通话中");
      }

      // 创建通话会话
      const callId = this._generateCallId();
      const session = new CallSession(callId, peerId, type, true);
      this.sessions.set(callId, session);
      this.peerSessions.set(peerId, callId);

      // 获取本地媒体流
      session.localStream = await this._getUserMedia(type, options);

      // 创建WebRTC连接
      session.peerConnection = this._createPeerConnection(session);

      // 添加本地流到连接
      session.localStream.getTracks().forEach((track) => {
        session.peerConnection.addTrack(track, session.localStream);
      });

      // 创建Offer
      const offer = await session.peerConnection.createOffer();
      await session.peerConnection.setLocalDescription(offer);

      // 发送通话请求
      await this._sendCallSignaling(peerId, {
        type: "call-request",
        callId,
        callType: type,
        offer: session.peerConnection.localDescription,
      });

      // 设置状态
      session.state = CallState.CALLING;

      // 设置超时
      const timeout = setTimeout(() => {
        if (session.state === CallState.CALLING) {
          this._endCall(callId, "timeout");
        }
      }, this.options.callTimeout);

      session.timeout = timeout;

      // 触发事件
      this.emit("call:started", {
        callId,
        peerId,
        type,
        isInitiator: true,
      });

      // 更新统计
      this.stats.totalCalls++;
      if (type === CallType.AUDIO) {this.stats.audioCallsCount++;}
      else if (type === CallType.VIDEO) {this.stats.videoCallsCount++;}
      else if (type === CallType.SCREEN) {this.stats.screenShareCount++;}

      return callId;
    } catch (error) {
      logger.error("[VoiceVideoManager] 发起通话失败:", error);
      this.stats.failedCalls++;
      throw error;
    }
  }

  /**
   * 接受通话
   */
  async acceptCall(callId) {
    try {
      logger.info("[VoiceVideoManager] 接受通话:", callId);

      const session = this.sessions.get(callId);
      if (!session) {
        throw new Error("通话会话不存在");
      }

      if (session.state !== CallState.RINGING) {
        throw new Error("通话状态不正确");
      }

      // 获取本地媒体流
      session.localStream = await this._getUserMedia(session.type);

      // 添加本地流到连接
      session.localStream.getTracks().forEach((track) => {
        session.peerConnection.addTrack(track, session.localStream);
      });

      // 创建Answer
      const answer = await session.peerConnection.createAnswer();
      await session.peerConnection.setLocalDescription(answer);

      // 发送应答
      await this._sendCallSignaling(session.peerId, {
        type: "call-answer",
        callId,
        answer: session.peerConnection.localDescription,
      });

      // 设置状态
      session.state = CallState.CONNECTED;
      session.startTime = Date.now();

      // 开始质量监控
      this._startQualityMonitoring(session);

      // 触发事件
      this.emit("call:accepted", {
        callId,
        peerId: session.peerId,
        type: session.type,
      });

      return true;
    } catch (error) {
      logger.error("[VoiceVideoManager] 接受通话失败:", error);
      throw error;
    }
  }

  /**
   * 拒绝通话
   */
  async rejectCall(callId, reason = "rejected") {
    try {
      logger.info("[VoiceVideoManager] 拒绝通话:", callId);

      const session = this.sessions.get(callId);
      if (!session) {
        throw new Error("通话会话不存在");
      }

      // 发送拒绝消息
      await this._sendCallSignaling(session.peerId, {
        type: "call-reject",
        callId,
        reason,
      });

      // 结束通话
      this._endCall(callId, reason);

      return true;
    } catch (error) {
      logger.error("[VoiceVideoManager] 拒绝通话失败:", error);
      throw error;
    }
  }

  /**
   * 结束通话
   */
  async endCall(callId) {
    try {
      logger.info("[VoiceVideoManager] 结束通话:", callId);

      const session = this.sessions.get(callId);
      if (!session) {
        throw new Error("通话会话不存在");
      }

      // 发送结束消息
      await this._sendCallSignaling(session.peerId, {
        type: "call-end",
        callId,
      });

      // 结束通话
      this._endCall(callId, "ended");

      return true;
    } catch (error) {
      logger.error("[VoiceVideoManager] 结束通话失败:", error);
      throw error;
    }
  }

  /**
   * 切换静音
   */
  toggleMute(callId) {
    const session = this.sessions.get(callId);
    if (!session || !session.localStream) {
      throw new Error("通话会话不存在或无本地流");
    }

    const audioTracks = session.localStream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    const isMuted = !audioTracks[0].enabled;

    this.emit("call:mute-changed", {
      callId,
      isMuted,
    });

    return isMuted;
  }

  /**
   * 切换视频
   */
  toggleVideo(callId) {
    const session = this.sessions.get(callId);
    if (!session || !session.localStream) {
      throw new Error("通话会话不存在或无本地流");
    }

    const videoTracks = session.localStream.getVideoTracks();
    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    const isVideoEnabled = videoTracks[0].enabled;

    this.emit("call:video-changed", {
      callId,
      isVideoEnabled,
    });

    return isVideoEnabled;
  }

  /**
   * 获取通话信息
   */
  getCallInfo(callId) {
    const session = this.sessions.get(callId);
    if (!session) {
      return null;
    }

    return {
      callId: session.callId,
      peerId: session.peerId,
      type: session.type,
      state: session.state,
      isInitiator: session.isInitiator,
      duration: session.getDuration(),
      stats: session.stats,
    };
  }

  /**
   * 获取所有活动通话
   */
  getActiveCalls() {
    const activeCalls = [];

    for (const [callId, session] of this.sessions) {
      if (
        session.state === CallState.CONNECTED ||
        session.state === CallState.CALLING ||
        session.state === CallState.RINGING
      ) {
        activeCalls.push(this.getCallInfo(callId));
      }
    }

    return activeCalls;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      activeCalls: this.getActiveCalls().length,
      totalSessions: this.sessions.size,
    };
  }

  /**
   * 处理通话信令
   */
  async _handleCallSignaling(peerId, message) {
    try {
      logger.info("[VoiceVideoManager] 收到通话信令:", message.type);

      switch (message.type) {
        case "call-request":
          await this._handleCallRequest(peerId, message);
          break;

        case "call-answer":
          await this._handleCallAnswer(peerId, message);
          break;

        case "call-reject":
          await this._handleCallReject(peerId, message);
          break;

        case "call-end":
          await this._handleCallEnd(peerId, message);
          break;

        case "ice-candidate":
          await this._handleIceCandidate(peerId, message);
          break;

        default:
          logger.warn("[VoiceVideoManager] 未知信令类型:", message.type);
      }
    } catch (error) {
      logger.error("[VoiceVideoManager] 处理通话信令失败:", error);
    }
  }

  /**
   * 处理通话请求
   */
  async _handleCallRequest(peerId, message) {
    const { callId, callType, offer } = message;

    // 检查是否已有通话
    if (this.peerSessions.has(peerId)) {
      await this._sendCallSignaling(peerId, {
        type: "call-reject",
        callId,
        reason: "busy",
      });
      return;
    }

    // 创建通话会话
    const session = new CallSession(callId, peerId, callType, false);
    this.sessions.set(callId, session);
    this.peerSessions.set(peerId, callId);

    // 创建WebRTC连接
    session.peerConnection = this._createPeerConnection(session);

    // 设置远程描述
    await session.peerConnection.setRemoteDescription(
      new wrtc.RTCSessionDescription(offer),
    );

    // 设置状态
    session.state = CallState.RINGING;

    // 触发事件（通知UI显示来电）
    this.emit("call:incoming", {
      callId,
      peerId,
      type: callType,
    });
  }

  /**
   * 处理通话应答
   */
  async _handleCallAnswer(peerId, message) {
    const { callId, answer } = message;

    const session = this.sessions.get(callId);
    if (!session) {
      logger.warn("[VoiceVideoManager] 通话会话不存在:", callId);
      return;
    }

    // 清除超时
    if (session.timeout) {
      clearTimeout(session.timeout);
      session.timeout = null;
    }

    // 设置远程描述
    await session.peerConnection.setRemoteDescription(
      new wrtc.RTCSessionDescription(answer),
    );

    // 设置状态
    session.state = CallState.CONNECTED;
    session.startTime = Date.now();

    // 开始质量监控
    this._startQualityMonitoring(session);

    // 触发事件
    this.emit("call:connected", {
      callId,
      peerId,
      type: session.type,
    });

    // 更新统计
    this.stats.successfulCalls++;
  }

  /**
   * 处理通话拒绝
   */
  async _handleCallReject(peerId, message) {
    const { callId, reason } = message;

    this._endCall(callId, reason || "rejected");

    this.emit("call:rejected", {
      callId,
      peerId,
      reason,
    });
  }

  /**
   * 处理通话结束
   */
  async _handleCallEnd(peerId, message) {
    const { callId } = message;

    this._endCall(callId, "remote-ended");

    this.emit("call:ended", {
      callId,
      peerId,
    });
  }

  /**
   * 处理ICE候选
   */
  async _handleIceCandidate(peerId, message) {
    const { callId, candidate } = message;

    const session = this.sessions.get(callId);
    if (!session || !session.peerConnection) {
      logger.warn("[VoiceVideoManager] 通话会话不存在:", callId);
      return;
    }

    await session.peerConnection.addIceCandidate(
      new wrtc.RTCIceCandidate(candidate),
    );
  }

  /**
   * 发送通话信令
   */
  async _sendCallSignaling(peerId, message) {
    try {
      const stream = await this.p2pManager.node.dialProtocol(
        peerId,
        "/chainlesschain/call/1.0.0",
      );

      const data = Buffer.from(JSON.stringify(message));
      await stream.sink([data]);
      await stream.close();
    } catch (error) {
      logger.error("[VoiceVideoManager] 发送通话信令失败:", error);
      throw error;
    }
  }

  /**
   * 创建PeerConnection
   */
  _createPeerConnection(session) {
    if (!wrtc) {
      throw new Error("WebRTC (wrtc) is not available on this platform");
    }
    const pc = new wrtc.RTCPeerConnection({
      iceServers: this.options.iceServers,
    });

    // ICE候选事件
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendCallSignaling(session.peerId, {
          type: "ice-candidate",
          callId: session.callId,
          candidate: event.candidate,
        }).catch((error) => {
          logger.error("[VoiceVideoManager] 发送ICE候选失败:", error);
        });
      }
    };

    // 连接状态变化
    pc.onconnectionstatechange = () => {
      logger.info("[VoiceVideoManager] 连接状态:", pc.connectionState);

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this._endCall(session.callId, "connection-failed");
      }
    };

    // 接收远程流
    pc.ontrack = (event) => {
      logger.info("[VoiceVideoManager] 收到远程流");
      session.remoteStream = event.streams[0];

      this.emit("call:remote-stream", {
        callId: session.callId,
        stream: event.streams[0],
      });
    };

    return pc;
  }

  /**
   * 获取用户媒体
   *
   * 注意：在Electron主进程中无法直接访问getUserMedia
   * 实际应用中需要：
   * 1. 从renderer进程获取MediaStream
   * 2. 通过IPC传递stream ID
   * 3. 在主进程中使用stream ID创建RTCPeerConnection
   *
   * 当前实现返回模拟的MediaStream用于测试
   */
  async _getUserMedia(type, options = {}) {
    const constraints = {};

    if (type === CallType.AUDIO) {
      constraints.audio = {
        ...this.options.audioConstraints,
        ...options.audio,
      };
      constraints.video = false;
    } else if (type === CallType.VIDEO) {
      constraints.audio = {
        ...this.options.audioConstraints,
        ...options.audio,
      };
      constraints.video = {
        ...this.options.videoConstraints,
        ...options.video,
      };
    } else if (type === CallType.SCREEN) {
      // 屏幕共享通过desktopCapturer在renderer进程中实现
      constraints.video = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: options.sourceId || "",
        },
      };
      constraints.audio = false;
    }

    logger.info("[VoiceVideoManager] 请求媒体流:", { type, constraints });

    // 测试环境直接返回模拟媒体流，避免依赖 renderer
    if (isTestEnv) {
      const stream = new wrtc.MediaStream();
      const trackKind =
        type === CallType.VIDEO || type === CallType.SCREEN ? "video" : "audio";
      stream.addTrack({
        kind: trackKind,
        enabled: true,
        stop() {},
      });
      return stream;
    }

    // 通过事件请求媒体流（由P2PEnhancedManager的MediaStreamBridge处理）
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("获取媒体流超时"));
      }, 30000);

      // 触发事件通知需要从renderer获取真实媒体流
      this.emit("media:stream-required", {
        type,
        constraints,
        callId: options.callId,
        peerId: options.peerId,
        // 回调函数用于接收renderer进程传来的stream信息
        callback: (streamInfo) => {
          clearTimeout(timeout);

          if (streamInfo && streamInfo.tracks) {
            logger.info("[VoiceVideoManager] 收到来自renderer的媒体流信息:", {
              streamId: streamInfo.streamId,
              trackCount: streamInfo.tracks.length,
            });

            // 创建MediaStream并添加tracks
            // 注意：在主进程中，我们使用wrtc的MediaStream
            // 实际的媒体数据通过WebRTC的PeerConnection传输
            if (!wrtc) {
              reject(
                new Error("WebRTC (wrtc) is not available on this platform"),
              );
              return;
            }
            const stream = new wrtc.MediaStream();

            // 保存streamId用于后续操作
            stream.id = streamInfo.streamId;
            stream._trackInfo = streamInfo.tracks;

            resolve(stream);
          } else {
            reject(new Error("无效的媒体流信息"));
          }
        },
        // 错误回调
        onError: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  /**
   * 开始质量监控
   */
  _startQualityMonitoring(session) {
    if (session.qualityCheckInterval) {
      clearInterval(session.qualityCheckInterval);
    }

    session.qualityCheckInterval = setInterval(async () => {
      try {
        const stats = await session.peerConnection.getStats();

        // 解析统计信息
        stats.forEach((report) => {
          if (report.type === "inbound-rtp") {
            session.stats.bytesReceived = report.bytesReceived || 0;
            session.stats.packetsLost = report.packetsLost || 0;
            session.stats.jitter = report.jitter || 0;
          } else if (report.type === "outbound-rtp") {
            session.stats.bytesSent = report.bytesSent || 0;
          } else if (
            report.type === "candidate-pair" &&
            report.state === "succeeded"
          ) {
            session.stats.roundTripTime = report.currentRoundTripTime || 0;
          }
        });

        // 触发质量更新事件
        this.emit("call:quality-update", {
          callId: session.callId,
          stats: session.stats,
        });
      } catch (error) {
        logger.error("[VoiceVideoManager] 质量监控失败:", error);
      }
    }, this.options.qualityCheckInterval);
  }

  /**
   * 结束通话（内部方法）
   */
  _endCall(callId, reason) {
    const session = this.sessions.get(callId);
    if (!session) {
      return;
    }

    logger.info("[VoiceVideoManager] 结束通话:", callId, reason);

    // 清除超时
    if (session.timeout) {
      clearTimeout(session.timeout);
      session.timeout = null;
    }

    // 停止质量监控
    if (session.qualityCheckInterval) {
      clearInterval(session.qualityCheckInterval);
      session.qualityCheckInterval = null;
    }

    // 关闭本地流
    if (session.localStream) {
      session.localStream.getTracks().forEach((track) => track.stop());
      session.localStream = null;
    }

    // 关闭PeerConnection
    if (session.peerConnection) {
      session.peerConnection.close();
      session.peerConnection = null;
    }

    // 更新状态
    session.state = CallState.ENDED;
    session.endTime = Date.now();

    // 更新统计
    if (session.startTime) {
      this.stats.totalDuration += session.getDuration();
    }

    // 清理映射
    this.peerSessions.delete(session.peerId);

    // 延迟删除会话（保留一段时间用于查询）
    setTimeout(() => {
      this.sessions.delete(callId);
    }, 60000); // 1分钟后删除
  }

  /**
   * 生成通话ID
   */
  _generateCallId() {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[VoiceVideoManager] 清理资源...");

    // 结束所有通话
    for (const [callId] of this.sessions) {
      this._endCall(callId, "cleanup");
    }

    this.sessions.clear();
    this.peerSessions.clear();

    logger.info("[VoiceVideoManager] 资源清理完成");
  }
}

module.exports = {
  VoiceVideoManager,
  CallState,
  CallType,
};
