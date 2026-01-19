/**
 * P2P 网络管理器
 *
 * 基于 libp2p 实现去中心化的 P2P 通信网络
 * 功能：节点发现、DHT、消息传输、NAT穿透、端到端加密
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const SignalSessionManager = require("./signal-session-manager");
const DeviceManager = require("./device-manager");
const {
  DeviceSyncManager,
  MessageStatus,
  SyncMessageType,
} = require("./device-sync-manager");
const NATDetector = require("./nat-detector");
const TransportDiagnostics = require("./transport-diagnostics");
const { ConnectionPool } = require("./connection-pool");
const { WebRTCQualityMonitor } = require("./webrtc-quality-monitor");

// 动态导入 ESM 模块
let createLibp2p, tcp, noise, mplex, kadDHT, mdns, bootstrap, multiaddr;
let webSockets, webRTC, yamux, circuitRelayTransport, dcutr, identify, ping;

/**
 * P2P 配置
 */
const DEFAULT_CONFIG = {
  port: 9000,
  bootstrapNodes: [
    // 公共引导节点（可配置）
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
  ],
  enableMDNS: true, // 本地网络发现
  enableDHT: true, // DHT 网络
  dataPath: null, // 数据存储路径
};

/**
 * P2P 管理器类
 */
class P2PManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.node = null;
    this.peerId = null;
    this.peers = new Map(); // 连接的对等节点（保留用于兼容性）
    this.dht = null;
    this.signalManager = null; // Signal 加密会话管理器
    this.deviceManager = null; // 设备管理器
    this.syncManager = null; // 设备同步管理器
    this.friendManager = null; // 好友管理器
    this.postProtocolsRegistered = false;
    this.pendingPostProtocolRegistration = false;
    this.initialized = false;

    // NAT穿透相关
    this.p2pConfig = null; // P2P配置（从数据库加载）
    this.natDetector = null; // NAT检测器
    this.natInfo = null; // NAT信息
    this.transportDiagnostics = null; // 传输诊断工具

    // 连接池（性能优化）
    this.connectionPool = null;

    // WebRTC质量监控
    this.webrtcQualityMonitor = null;
  }

  /**
   * 从数据库加载P2P配置
   */
  async loadP2PConfig() {
    try {
      // 从数据库加载P2P配置
      const { getDatabase } = require("../database");
      const db = getDatabase();
      const settings = await db.getAllSettings();

      return {
        transports: {
          webrtc: settings["p2p.transports.webrtc.enabled"] !== "false",
          websocket: settings["p2p.transports.websocket.enabled"] !== "false",
          tcp: settings["p2p.transports.tcp.enabled"] !== "false",
          autoSelect: settings["p2p.transports.autoSelect"] !== "false",
        },
        stun: {
          servers: settings["p2p.stun.servers"]
            ? JSON.parse(settings["p2p.stun.servers"])
            : [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
              ],
        },
        turn: {
          enabled: settings["p2p.turn.enabled"] === "true",
          servers: settings["p2p.turn.servers"]
            ? JSON.parse(settings["p2p.turn.servers"])
            : [],
        },
        relay: {
          enabled: settings["p2p.relay.enabled"] !== "false",
          maxReservations: parseInt(settings["p2p.relay.maxReservations"]) || 2,
          autoUpgrade: settings["p2p.relay.autoUpgrade"] !== "false",
        },
        nat: {
          autoDetect: settings["p2p.nat.autoDetect"] !== "false",
          detectionInterval:
            parseInt(settings["p2p.nat.detectionInterval"]) || 3600000,
        },
        connection: {
          dialTimeout:
            parseInt(settings["p2p.connection.dialTimeout"]) || 30000,
          maxRetries: parseInt(settings["p2p.connection.maxRetries"]) || 3,
          healthCheckInterval:
            parseInt(settings["p2p.connection.healthCheckInterval"]) || 60000,
        },
        websocket: {
          port: parseInt(settings["p2p.websocket.port"]) || 9003,
        },
        webrtc: {
          port: parseInt(settings["p2p.webrtc.port"]) || 9095,
          iceTransportPolicy:
            settings["p2p.webrtc.iceTransportPolicy"] || "all", // 'all' or 'relay'
          iceCandidatePoolSize:
            parseInt(settings["p2p.webrtc.iceCandidatePoolSize"]) || 10,
        },
        compatibility: {
          detectLegacy: settings["p2p.compatibility.detectLegacy"] !== "false",
        },
      };
    } catch (error) {
      logger.warn("[P2PManager] 加载P2P配置失败，使用默认值:", error);
      // 返回默认配置
      return {
        transports: {
          webrtc: true,
          websocket: true,
          tcp: true,
          autoSelect: true,
        },
        stun: {
          servers: [
            "stun:localhost:3478", // 本地coturn STUN服务器
            "stun:stun.l.google.com:19302", // 备用公共STUN服务器
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
          ],
        },
        turn: {
          enabled: true, // 启用TURN服务器
          servers: [
            {
              urls: "turn:localhost:3478",
              username: "chainlesschain",
              credential: "chainlesschain2024",
            },
          ],
        },
        relay: {
          enabled: true,
          maxReservations: 2,
          autoUpgrade: true,
        },
        nat: {
          autoDetect: true,
          detectionInterval: 3600000,
        },
        connection: {
          dialTimeout: 30000,
          maxRetries: 3,
          healthCheckInterval: 60000,
        },
        websocket: {
          port: 9003,
        },
        webrtc: {
          port: 9095,
          iceTransportPolicy: "all",
          iceCandidatePoolSize: 10,
        },
        compatibility: {
          detectLegacy: true,
        },
      };
    }
  }

  /**
   * 初始化 P2P 节点
   */
  async initialize() {
    logger.info("[P2PManager] 初始化 P2P 节点...");

    try {
      // 动态导入 ESM 模块
      if (!createLibp2p) {
        logger.info("[P2PManager] 加载 libp2p 模块...");
        const libp2pModule = await import("libp2p");
        createLibp2p = libp2pModule.createLibp2p;

        const tcpModule = await import("@libp2p/tcp");
        tcp = tcpModule.tcp;

        const noiseModule = await import("@libp2p/noise");
        noise = noiseModule.noise;

        const mplexModule = await import("@libp2p/mplex");
        mplex = mplexModule.mplex;

        const kadDHTModule = await import("@libp2p/kad-dht");
        kadDHT = kadDHTModule.kadDHT;

        const mdnsModule = await import("@libp2p/mdns");
        mdns = mdnsModule.mdns;

        const bootstrapModule = await import("@libp2p/bootstrap");
        bootstrap = bootstrapModule.bootstrap;

        const multiaddrModule = await import("multiaddr");
        multiaddr = multiaddrModule.multiaddr;

        // 新增传输层模块
        logger.info("[P2PManager] 加载新传输层模块...");
        const webSocketsModule = await import("@libp2p/websockets");
        webSockets = webSocketsModule.webSockets;

        // WebRTC is optional - node-datachannel native module may not be available in Electron
        try {
          const webRTCModule = await import("@libp2p/webrtc");
          webRTC = webRTCModule.webRTC;
          logger.info("[P2PManager] WebRTC传输模块加载成功");
        } catch (webrtcError) {
          logger.warn(
            "[P2PManager] WebRTC传输模块不可用 (node-datachannel native module未构建):",
            webrtcError.message,
          );
          logger.warn(
            "[P2PManager] P2P将使用WebSocket和TCP传输，WebRTC功能已禁用",
          );
          webRTC = null;
        }

        const yamuxModule = await import("@chainsafe/libp2p-yamux");
        yamux = yamuxModule.yamux;

        const circuitRelayModule = await import("@libp2p/circuit-relay-v2");
        circuitRelayTransport = circuitRelayModule.circuitRelayTransport;

        const dcutrModule = await import("@libp2p/dcutr");
        dcutr = dcutrModule.dcutr;

        const identifyModule = await import("@libp2p/identify");
        identify = identifyModule.identify;

        const pingModule = await import("@libp2p/ping");
        ping = pingModule.ping;
      }

      // 加载P2P配置
      this.p2pConfig = await this.loadP2PConfig();
      logger.info("[P2PManager] P2P配置已加载");

      // 初始化NAT检测器
      this.natDetector = new NATDetector();

      // NAT类型检测
      this.natInfo = null;
      if (this.p2pConfig.nat.autoDetect) {
        logger.info("[P2P] 正在检测NAT类型...");
        try {
          this.natInfo = await this.natDetector.detectNATType(
            this.p2pConfig.stun.servers,
          );
          logger.info(
            `[P2P] NAT类型: ${this.natInfo.type}, 公网IP: ${this.natInfo.publicIP || "未知"}`,
          );

          // 定期重新检测
          setInterval(() => {
            this.natDetector
              .detectNATType(this.p2pConfig.stun.servers)
              .then((info) => {
                this.natInfo = info;
                logger.info(`[P2P] NAT重新检测: ${this.natInfo.type}`);
              })
              .catch((err) => {
                logger.warn("[P2P] NAT重新检测失败:", err.message);
              });
          }, this.p2pConfig.nat.detectionInterval);
        } catch (error) {
          logger.warn("[P2P] NAT检测失败:", error.message);
        }
      }

      // 加载或生成 PeerId
      this.peerId = await this.loadOrGeneratePeerId();
      if (!this.peerId) {
        logger.warn("[P2PManager] PeerId 不可用，跳过 P2P 初始化");
        return false;
      }

      // 构建监听地址
      const listenAddresses = [
        `/ip4/0.0.0.0/tcp/${this.config.port}`,
        `/ip4/127.0.0.1/tcp/${this.config.port}`,
      ];

      // 如果启用WebSocket，添加WebSocket监听地址
      if (this.p2pConfig.transports.websocket) {
        listenAddresses.push(
          `/ip4/0.0.0.0/tcp/${this.p2pConfig.websocket.port}/ws`,
        );
        listenAddresses.push(
          `/ip4/127.0.0.1/tcp/${this.p2pConfig.websocket.port}/ws`,
        );
      }

      // 如果启用WebRTC且模块可用，添加WebRTC监听地址
      if (this.p2pConfig.transports.webrtc && webRTC) {
        const webrtcPort = this.p2pConfig.webrtc.port || 9095;
        listenAddresses.push(`/ip4/0.0.0.0/udp/${webrtcPort}/webrtc`);
        listenAddresses.push(`/ip4/127.0.0.1/udp/${webrtcPort}/webrtc`);
        logger.info(`[P2PManager] WebRTC监听端口: ${webrtcPort}`);
      } else if (this.p2pConfig.transports.webrtc && !webRTC) {
        logger.info(
          `[P2PManager] WebRTC已配置但模块不可用，跳过WebRTC监听地址`,
        );
      }

      // 根据配置和NAT类型智能选择传输层
      const transports = this.buildTransports({
        tcp,
        webSockets,
        webRTC,
        circuitRelayTransport,
        config: this.p2pConfig,
        natInfo: this.natInfo,
      });

      logger.info(`[P2PManager] 启用传输层: ${transports.length} 个`);

      // 创建 libp2p 节点
      this.node = await createLibp2p({
        peerId: this.peerId,
        addresses: {
          listen: listenAddresses,
        },
        transports: transports,
        streamMuxers: [mplex(), yamux()], // 支持mplex和yamux
        connectionEncryption: [noise()],
        peerDiscovery: this.getPeerDiscoveryConfig(),
        services: {
          identify: identify(), // 协议协商
          ping: ping(), // 心跳检测（DHT依赖）
          dcutr: dcutr(), // NAT打洞
          dht: this.config.enableDHT ? kadDHT() : undefined,
        },
        connectionManager: {
          maxConnections: 100,
          minConnections: 5,
          dialTimeout: this.p2pConfig.connection.dialTimeout,
          maxParallelDials: 5,
          maxDialsPerPeer: this.p2pConfig.connection.maxRetries,
        },
      });

      // 设置事件监听
      this.setupEvents();

      // 启动节点
      await this.node.start();

      // 获取 DHT 实例
      if (this.config.enableDHT) {
        this.dht = this.node.services.dht;
      }

      // 初始化传输诊断工具
      this.transportDiagnostics = new TransportDiagnostics(this);
      logger.info("[P2PManager] 传输诊断工具已初始化");

      // 可选：启动健康监控
      if (this.p2pConfig.connection.healthCheckInterval > 0) {
        this.transportDiagnostics.startHealthMonitoring(
          this.p2pConfig.connection.healthCheckInterval,
        );
      }

      // 初始化连接池
      logger.info("[P2PManager] 初始化连接池...");
      this.connectionPool = new ConnectionPool({
        maxConnections: parseInt(process.env.P2P_MAX_CONNECTIONS) || 100,
        minConnections: parseInt(process.env.P2P_MIN_CONNECTIONS) || 5,
        maxIdleTime:
          parseInt(process.env.P2P_CONNECTION_IDLE_TIMEOUT) || 300000, // 5分钟
        connectionTimeout: this.p2pConfig.connection.dialTimeout,
        maxRetries: this.p2pConfig.connection.maxRetries,
        healthCheckInterval: this.p2pConfig.connection.healthCheckInterval,
      });

      await this.connectionPool.initialize();

      // 监听连接池事件
      this.connectionPool.on("connection:created", ({ peerId }) => {
        logger.info(`[P2P Pool] 连接已创建: ${peerId}`);
      });

      this.connectionPool.on("connection:reused", ({ peerId, count }) => {
        logger.info(`[P2P Pool] 连接已复用: ${peerId}, 使用次数: ${count}`);
      });

      this.connectionPool.on("connection:closed", ({ peerId, reason }) => {
        logger.info(`[P2P Pool] 连接已关闭: ${peerId}, 原因: ${reason}`);
      });

      this.connectionPool.on("pool:full", () => {
        logger.warn("[P2P Pool] 连接池已满，正在清理空闲连接");
      });

      logger.info("[P2PManager] 连接池已初始化");

      // 初始化WebRTC质量监控器（如果启用WebRTC）
      if (this.p2pConfig.transports.webrtc) {
        logger.info("[P2PManager] 初始化WebRTC质量监控器...");
        this.webrtcQualityMonitor = new WebRTCQualityMonitor(this, {
          monitorInterval: 5000,
          statsRetention: 100,
          packetLossThreshold: 5,
          rttThreshold: 300,
          jitterThreshold: 50,
          bandwidthThreshold: 100000,
        });

        // 监听质量变化事件
        this.webrtcQualityMonitor.on(
          "quality:change",
          ({ peerId, previousQuality, currentQuality }) => {
            logger.info(
              `[WebRTC] ${peerId} 连接质量变化: ${previousQuality} -> ${currentQuality}`,
            );
            this.emit("webrtc:quality:change", {
              peerId,
              previousQuality,
              currentQuality,
            });
          },
        );

        // 监听告警事件
        this.webrtcQualityMonitor.on("alert", ({ peerId, alerts, metrics }) => {
          logger.warn(`[WebRTC] ${peerId} 连接告警:`, alerts);
          this.emit("webrtc:alert", { peerId, alerts, metrics });
        });

        // 启动监控
        this.webrtcQualityMonitor.start();
        logger.info("[P2PManager] WebRTC质量监控器已启动");
      }

      // 初始化设备管理器
      await this.initializeDeviceManager();

      // 初始化 Signal 会话管理器
      await this.initializeSignalManager();

      // 初始化设备同步管理器
      await this.initializeSyncManager();

      // 注册加密消息协议处理器
      this.registerEncryptedMessageHandlers();

      // 注册设备广播协议处理器
      this.registerDeviceBroadcastHandlers();

      // 注册设备同步协议处理器
      this.registerDeviceSyncHandlers();

      if (this.pendingPostProtocolRegistration || this.postManager) {
        this.registerPostProtocols();
      }

      // 广播当前设备信息
      this.broadcastDeviceInfo();

      this.initialized = true;

      const addresses = this.node.getMultiaddrs();
      logger.info("[P2PManager] P2P 节点已启动");
      logger.info("[P2PManager] PeerId:", this.peerId.toString());
      logger.info(
        "[P2PManager] 监听地址:",
        addresses.map((a) => a.toString()),
      );

      this.emit("initialized", {
        peerId: this.peerId.toString(),
        addresses: addresses.map((a) => a.toString()),
      });

      return true;
    } catch (error) {
      logger.error("[P2PManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 加载或生成 PeerId
   */
  async loadOrGeneratePeerId() {
    let peerFactory;
    try {
      peerFactory = await import("@libp2p/peer-id-factory");
    } catch (error) {
      logger.warn(
        "[P2PManager] 缺少 @libp2p/peer-id-factory，P2P 功能将被禁用:",
        error.message,
      );
      return null;
    }

    const { createFromJSON, createEd25519PeerId } = peerFactory;

    if (!this.config.dataPath) {
      // 无数据路径，生成临时 PeerId
      logger.info("[P2PManager] 生成临时 PeerId");
      return await createEd25519PeerId();
    }

    const peerIdPath = path.join(this.config.dataPath, "peer-id.json");

    try {
      // 尝试加载现有 PeerId
      if (fs.existsSync(peerIdPath)) {
        const peerIdJSON = JSON.parse(fs.readFileSync(peerIdPath, "utf8"));
        logger.info("[P2PManager] 加载现有 PeerId");
        return await createFromJSON(peerIdJSON);
      }
    } catch (error) {
      logger.warn("[P2PManager] 加载 PeerId 失败，将生成新的:", error.message);
    }

    // 生成新 PeerId 并保存
    logger.info("[P2PManager] 生成新 PeerId");
    const peerId = await createEd25519PeerId();

    try {
      fs.mkdirSync(path.dirname(peerIdPath), { recursive: true });
      fs.writeFileSync(peerIdPath, JSON.stringify(peerId.toJSON(), null, 2));
      logger.info("[P2PManager] PeerId 已保存到:", peerIdPath);
    } catch (error) {
      logger.warn("[P2PManager] 保存 PeerId 失败:", error.message);
    }

    return peerId;
  }

  /**
   * 获取对等节点发现配置
   */
  getPeerDiscoveryConfig() {
    const discovery = [];

    // mDNS（本地网络发现）
    if (this.config.enableMDNS) {
      discovery.push(
        mdns({
          interval: 20000, // 20 秒
        }),
      );
    }

    // Bootstrap 节点
    if (this.config.bootstrapNodes && this.config.bootstrapNodes.length > 0) {
      discovery.push(
        bootstrap({
          list: this.config.bootstrapNodes,
        }),
      );
    }

    return discovery;
  }

  /**
   * 设置事件监听
   */
  setupEvents() {
    // 对等节点连接
    this.node.addEventListener("peer:connect", (evt) => {
      const peerId = evt.detail.toString();
      logger.info("[P2PManager] 对等节点已连接:", peerId);

      this.peers.set(peerId, {
        peerId,
        connectedAt: Date.now(),
      });

      this.emit("peer:connected", { peerId });
    });

    // 对等节点断开
    this.node.addEventListener("peer:disconnect", (evt) => {
      const peerId = evt.detail.toString();
      logger.info("[P2PManager] 对等节点已断开:", peerId);

      this.peers.delete(peerId);

      this.emit("peer:disconnected", { peerId });
    });

    // 对等节点发现
    this.node.addEventListener("peer:discovery", (evt) => {
      const peer = evt.detail;
      logger.info("[P2PManager] 发现对等节点:", peer.id.toString());

      this.emit("peer:discovered", {
        peerId: peer.id.toString(),
        multiaddrs: peer.multiaddrs.map((ma) => ma.toString()),
      });
    });

    // 自我地址更新
    this.node.addEventListener("self:peer:update", () => {
      const addresses = this.node.getMultiaddrs();
      logger.info(
        "[P2PManager] 节点地址已更新:",
        addresses.map((a) => a.toString()),
      );

      this.emit("address:updated", {
        addresses: addresses.map((a) => a.toString()),
      });
    });
  }

  /**
   * 初始化设备管理器
   */
  async initializeDeviceManager() {
    logger.info("[P2PManager] 初始化设备管理器...");

    try {
      this.deviceManager = new DeviceManager({
        userId: this.peerId.toString(),
        dataPath: this.config.dataPath,
        deviceName: this.config.deviceName,
      });

      await this.deviceManager.initialize();

      logger.info("[P2PManager] 设备管理器已初始化");
      logger.info(
        "[P2PManager] 当前设备 ID:",
        this.deviceManager.getCurrentDevice().deviceId,
      );
    } catch (error) {
      logger.error("[P2PManager] 初始化设备管理器失败:", error);
      // 不抛出错误，允许 P2P 网络继续工作
      this.deviceManager = null;
    }
  }

  /**
   * 初始化 Signal 会话管理器
   */
  async initializeSignalManager() {
    logger.info("[P2PManager] 初始化 Signal 会话管理器...");

    try {
      // 获取设备 ID
      const deviceId = this.deviceManager
        ? this.deviceManager.getCurrentDevice().deviceId
        : "default-device";

      this.signalManager = new SignalSessionManager({
        userId: this.peerId.toString(),
        deviceId: deviceId,
        dataPath: this.config.dataPath,
      });

      await this.signalManager.initialize();

      logger.info("[P2PManager] Signal 会话管理器已初始化");
    } catch (error) {
      logger.error("[P2PManager] 初始化 Signal 会话管理器失败:", error);
      // 不抛出错误，允许 P2P 网络继续工作（无加密模式）
      this.signalManager = null;
    }
  }

  /**
   * 初始化设备同步管理器
   */
  async initializeSyncManager() {
    logger.info("[P2PManager] 初始化设备同步管理器...");

    try {
      const deviceId = this.deviceManager
        ? this.deviceManager.getCurrentDevice().deviceId
        : "default-device";

      this.syncManager = new DeviceSyncManager({
        userId: this.peerId.toString(),
        deviceId: deviceId,
        dataPath: this.config.dataPath,
      });

      await this.syncManager.initialize();

      // 监听同步事件
      this.syncManager.on("sync:message", async ({ deviceId, message }) => {
        // 尝试发送队列中的消息
        try {
          await this.sendEncryptedMessage(
            message.targetPeerId,
            message.content,
          );
          await this.syncManager.markMessageDelivered(message.id);
          await this.syncManager.removeMessage(message.id);
        } catch (error) {
          logger.error("[P2PManager] 发送同步消息失败:", error);
          await this.syncManager.markMessageFailed(message.id, error.message);
        }
      });

      logger.info("[P2PManager] 设备同步管理器已初始化");
    } catch (error) {
      logger.error("[P2PManager] 初始化设备同步管理器失败:", error);
      // 不抛出错误，允许 P2P 网络继续工作（无同步模式）
      this.syncManager = null;
    }
  }

  /**
   * 注册加密消息协议处理器
   */
  registerEncryptedMessageHandlers() {
    if (!this.signalManager) {
      logger.warn("[P2PManager] Signal 未初始化，跳过加密消息处理器注册");
      return;
    }

    // 处理加密消息
    this.node.handle(
      "/chainlesschain/encrypted-message/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const encryptedMessage = Buffer.concat(data);
          const senderId = connection.remotePeer.toString();

          logger.info("[P2PManager] 收到加密消息:", senderId);

          // 解析加密消息
          const ciphertext = JSON.parse(encryptedMessage.toString());

          // 解密消息
          const plaintext = await this.signalManager.decryptMessage(
            senderId,
            1,
            ciphertext,
          );

          logger.info("[P2PManager] 消息已解密");

          this.emit("encrypted-message:received", {
            from: senderId,
            message: plaintext,
          });
        } catch (error) {
          logger.error("[P2PManager] 处理加密消息失败:", error);
        }
      },
    );

    // 处理预密钥交换请求
    this.node.handle(
      "/chainlesschain/key-exchange/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const requestData = Buffer.concat(data);
          const requesterId = connection.remotePeer.toString();

          // 解析请求
          let request = {};
          try {
            request = JSON.parse(requestData.toString());
          } catch (e) {
            // 兼容旧版本的请求
            request = {
              requestDeviceId: "default-device",
              targetDeviceId: null,
            };
          }

          logger.info(
            "[P2PManager] 收到密钥交换请求:",
            requesterId,
            "请求设备:",
            request.requestDeviceId,
          );

          // 获取预密钥包
          const preKeyBundle = await this.signalManager.getPreKeyBundle();

          // 获取当前设备ID
          const currentDeviceId =
            this.deviceManager?.getCurrentDevice()?.deviceId ||
            "default-device";

          // 发送预密钥包和设备ID
          const response = {
            preKeyBundle,
            deviceId: currentDeviceId,
          };

          const responseData = Buffer.from(JSON.stringify(response));
          await stream.write(responseData);
          await stream.close();

          logger.info("[P2PManager] 已发送预密钥包，设备:", currentDeviceId);
        } catch (error) {
          logger.error("[P2PManager] 处理密钥交换失败:", error);
        }
      },
    );

    logger.info("[P2PManager] 加密消息协议处理器已注册");
  }

  /**
   * 注册设备广播协议处理器
   */
  registerDeviceBroadcastHandlers() {
    if (!this.deviceManager) {
      logger.warn("[P2PManager] 设备管理器未初始化，跳过设备广播处理器注册");
      return;
    }

    // 处理设备广播
    this.node.handle(
      "/chainlesschain/device-broadcast/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const broadcastData = Buffer.concat(data);
          const broadcast = JSON.parse(broadcastData.toString());
          const peerId = connection.remotePeer.toString();

          logger.info("[P2PManager] 收到设备广播:", peerId);

          // 处理设备广播
          await this.deviceManager.handleDeviceBroadcast(peerId, broadcast);

          // 发送确认响应
          await stream.write(Buffer.from(JSON.stringify({ success: true })));
          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理设备广播失败:", error);
        }
      },
    );

    logger.info("[P2PManager] 设备广播协议处理器已注册");
  }

  /**
   * 注册设备同步协议处理器
   */
  registerDeviceSyncHandlers() {
    if (!this.syncManager) {
      logger.warn("[P2PManager] 设备同步管理器未初始化，跳过同步处理器注册");
      return;
    }

    // 处理同步请求
    this.node.handle(
      "/chainlesschain/device-sync/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const requestData = Buffer.concat(data);
          const request = JSON.parse(requestData.toString());
          const peerId = connection.remotePeer.toString();

          logger.info(
            "[P2PManager] 收到同步请求:",
            peerId,
            "type:",
            request.type,
          );

          let response = { success: false };

          switch (request.type) {
            case SyncMessageType.SYNC_REQUEST: {
              // 对方请求同步，返回队列中的消息
              const syncDeviceId = request.deviceId;
              const queue = this.syncManager.getDeviceQueue(syncDeviceId);
              response = {
                success: true,
                type: SyncMessageType.SYNC_RESPONSE,
                messages: queue,
              };
              break;
            }

            case SyncMessageType.MESSAGE_STATUS: {
              // 对方报告消息状态
              const { messageId, status } = request;
              if (status === MessageStatus.DELIVERED) {
                await this.syncManager.markMessageDelivered(messageId);
              } else if (status === MessageStatus.READ) {
                await this.syncManager.markMessageRead(messageId);
              }
              response = { success: true };
              break;
            }

            case SyncMessageType.DEVICE_STATUS:
              // 对方报告设备状态
              this.syncManager.updateDeviceStatus(
                request.deviceId,
                request.status,
              );
              response = { success: true };
              break;

            default:
              logger.warn("[P2PManager] 未知同步消息类型:", request.type);
          }

          // 发送响应
          await stream.write(Buffer.from(JSON.stringify(response)));
          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理同步请求失败:", error);
        }
      },
    );

    logger.info("[P2PManager] 设备同步协议处理器已注册");
  }

  /**
   * 广播当前设备信息
   */
  async broadcastDeviceInfo() {
    if (!this.deviceManager) {
      return;
    }

    const broadcast = this.deviceManager.getDeviceBroadcast();

    if (!broadcast) {
      return;
    }

    logger.info("[P2PManager] 广播设备信息到所有连接的节点");

    // 向所有连接的节点广播设备信息
    const connections = this.node.getConnections();

    for (const conn of connections) {
      try {
        const peerId = conn.remotePeer;
        const stream = await this.node.dialProtocol(
          peerId,
          "/chainlesschain/device-broadcast/1.0.0",
        );

        const broadcastData = Buffer.from(JSON.stringify(broadcast));
        await stream.write(broadcastData);

        // 接收确认
        const responseData = [];
        for await (const chunk of stream.source) {
          responseData.push(chunk.subarray());
        }

        await stream.close();

        logger.info("[P2PManager] 设备信息已广播到:", peerId.toString());
      } catch (error) {
        logger.error("[P2PManager] 广播设备信息失败:", error);
      }
    }
  }

  /**
   * 发起密钥交换
   * @param {string} peerId - 对等节点 ID
   * @param {string} deviceId - 设备 ID (可选，默认使用对方的默认设备)
   */
  async initiateKeyExchange(peerIdStr, targetDeviceId = null) {
    if (!this.signalManager) {
      throw new Error("Signal 会话管理器未初始化");
    }

    try {
      logger.info(
        "[P2PManager] 发起密钥交换:",
        peerIdStr,
        "deviceId:",
        targetDeviceId || "默认设备",
      );

      const { peerIdFromString } = await import("@libp2p/peer-id");
      const peerId = peerIdFromString(peerIdStr);

      // 创建密钥交换流
      const stream = await this.node.dialProtocol(
        peerId,
        "/chainlesschain/key-exchange/1.0.0",
      );

      // 发送请求，包含当前设备ID和目标设备ID
      const request = {
        requestDeviceId:
          this.deviceManager?.getCurrentDevice()?.deviceId || "default-device",
        targetDeviceId: targetDeviceId,
      };
      await stream.write(Buffer.from(JSON.stringify(request)));

      // 接收预密钥包
      const data = [];
      for await (const chunk of stream.source) {
        data.push(chunk.subarray());
      }

      const responseData = Buffer.concat(data);
      const response = JSON.parse(responseData.toString());

      // 提取预密钥包和设备ID
      const preKeyBundle = response.preKeyBundle || response;
      const remoteDeviceId =
        response.deviceId || targetDeviceId || "default-device";

      // 处理预密钥包，建立会话
      await this.signalManager.processPreKeyBundle(
        peerIdStr,
        remoteDeviceId,
        preKeyBundle,
      );

      logger.info("[P2PManager] 密钥交换成功，设备:", remoteDeviceId);

      this.emit("key-exchange:success", {
        peerId: peerIdStr,
        deviceId: remoteDeviceId,
      });

      return { success: true, deviceId: remoteDeviceId };
    } catch (error) {
      logger.error("[P2PManager] 密钥交换失败:", error);
      throw error;
    }
  }

  /**
   * 检查是否已建立加密会话
   * @param {string} peerId - 对等节点 ID
   */
  async hasEncryptedSession(peerIdStr) {
    if (!this.signalManager) {
      return false;
    }

    return await this.signalManager.hasSession(peerIdStr, 1);
  }

  /**
   * 连接到对等节点
   * @param {string} multiaddr - 多地址字符串
   */
  async connectToPeer(multiaddrStr) {
    try {
      logger.info("[P2PManager] 连接到对等节点:", multiaddrStr);

      const ma = multiaddr(multiaddrStr);
      const connection = await this.node.dial(ma);

      logger.info("[P2PManager] 连接成功:", connection.remotePeer.toString());

      return {
        success: true,
        peerId: connection.remotePeer.toString(),
      };
    } catch (error) {
      logger.error("[P2PManager] 连接失败:", error);
      throw error;
    }
  }

  /**
   * 断开与对等节点的连接
   * @param {string} peerId - 对等节点 ID
   */
  async disconnectFromPeer(peerIdStr) {
    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      const peerId = peerIdFromString(peerIdStr);

      await this.node.hangUp(peerId);

      logger.info("[P2PManager] 已断开连接:", peerIdStr);

      return { success: true };
    } catch (error) {
      logger.error("[P2PManager] 断开连接失败:", error);
      throw error;
    }
  }

  /**
   * 获取连接的对等节点列表
   */
  getConnectedPeers() {
    const connections = this.node.getConnections();

    return connections.map((conn) => ({
      peerId: conn.remotePeer.toString(),
      remoteAddr: conn.remoteAddr.toString(),
      status: conn.status,
    }));
  }

  /**
   * 检查 P2P 节点是否已初始化
   * @returns {boolean} 是否已初始化
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * 获取节点信息
   */
  getNodeInfo() {
    if (!this.initialized) {
      return null;
    }

    return {
      peerId: this.peerId.toString(),
      addresses: this.node.getMultiaddrs().map((a) => a.toString()),
      connectedPeers: this.getConnectedPeers().length,
      peers: this.getConnectedPeers(),
    };
  }

  /**
   * DHT: 存储数据
   * @param {string} key - 键
   * @param {Buffer} value - 值
   */
  async dhtPut(key, value) {
    if (!this.dht) {
      throw new Error("DHT 未启用");
    }

    try {
      logger.info("[P2PManager] DHT PUT:", key);

      await this.dht.put(Buffer.from(key), value);

      logger.info("[P2PManager] DHT PUT 成功");

      return { success: true };
    } catch (error) {
      logger.error("[P2PManager] DHT PUT 失败:", error);
      throw error;
    }
  }

  /**
   * DHT: 获取数据
   * @param {string} key - 键
   */
  async dhtGet(key) {
    if (!this.dht) {
      throw new Error("DHT 未启用");
    }

    try {
      logger.info("[P2PManager] DHT GET:", key);

      const value = await this.dht.get(Buffer.from(key));

      logger.info("[P2PManager] DHT GET 成功");

      return value;
    } catch (error) {
      logger.error("[P2PManager] DHT GET 失败:", error);
      throw error;
    }
  }

  /**
   * DHT: 查找提供者
   * @param {string} cid - CID
   */
  async dhtFindProviders(cid) {
    if (!this.dht) {
      throw new Error("DHT 未启用");
    }

    try {
      logger.info("[P2PManager] DHT 查找提供者:", cid);

      const providers = [];
      for await (const provider of this.dht.findProviders(cid)) {
        providers.push({
          id: provider.id.toString(),
          multiaddrs: provider.multiaddrs.map((ma) => ma.toString()),
        });
      }

      logger.info("[P2PManager] 找到", providers.length, "个提供者");

      return providers;
    } catch (error) {
      logger.error("[P2PManager] DHT 查找提供者失败:", error);
      throw error;
    }
  }

  /**
   * 使用连接池获取连接
   * @param {string} peerIdStr - 对等节点 ID
   * @returns {Promise<Connection>} 连接对象
   */
  async acquireConnection(peerIdStr) {
    if (!this.connectionPool) {
      // 连接池未初始化，直接返回null让调用方使用传统方式
      return null;
    }

    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      const peerId = peerIdFromString(peerIdStr);

      // 使用连接池获取或创建连接
      const connection = await this.connectionPool.acquireConnection(
        peerIdStr,
        async (id) => {
          // 连接工厂函数 - 创建新连接
          logger.info(`[P2P Pool] 创建新连接: ${id}`);
          const conn = await this.node.dial(peerId);
          return conn;
        },
      );

      return connection;
    } catch (error) {
      logger.error("[P2PManager] 获取连接失败:", error);
      throw error;
    }
  }

  /**
   * 释放连接回连接池
   * @param {string} peerIdStr - 对等节点 ID
   */
  releaseConnection(peerIdStr) {
    if (this.connectionPool) {
      this.connectionPool.releaseConnection(peerIdStr);
    }
  }

  /**
   * 获取连接池统计信息
   * @returns {Object} 统计信息
   */
  getConnectionPoolStats() {
    if (!this.connectionPool) {
      return null;
    }
    return this.connectionPool.getStats();
  }

  /**
   * 发送消息到对等节点 (明文)
   * @param {string} peerId - 对等节点 ID
   * @param {Buffer} data - 数据
   */
  async sendMessage(peerIdStr, data) {
    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      const peerId = peerIdFromString(peerIdStr);

      // 创建流
      const stream = await this.node.dialProtocol(
        peerId,
        "/chainlesschain/message/1.0.0",
      );

      // 发送数据
      await stream.write(data);
      await stream.close();

      logger.info("[P2PManager] 消息已发送到:", peerIdStr);

      return { success: true };
    } catch (error) {
      logger.error("[P2PManager] 发送消息失败:", error);
      throw error;
    }
  }

  /**
   * 发送加密消息到对等节点
   * @param {string} peerId - 对等节点 ID
   * @param {string|Buffer} message - 消息内容
   * @param {string} targetDeviceId - 目标设备 ID (可选)
   * @param {Object} options - 发送选项 (可选)
   * @param {boolean} options.autoQueue - 发送失败时自动入队 (默认 true)
   */
  async sendEncryptedMessage(
    peerIdStr,
    message,
    targetDeviceId = null,
    options = {},
  ) {
    if (!this.signalManager) {
      throw new Error("Signal 会话管理器未初始化");
    }

    const autoQueue = options.autoQueue !== false; // 默认启用自动入队

    try {
      logger.info(
        "[P2PManager] 发送加密消息到:",
        peerIdStr,
        "deviceId:",
        targetDeviceId || "默认设备",
      );

      // 获取目标设备 ID (如果未指定，使用第一个可用设备)
      let deviceId = targetDeviceId;
      if (!deviceId && this.deviceManager) {
        const userDevices = this.deviceManager.getUserDevices(peerIdStr);
        if (userDevices && userDevices.length > 0) {
          deviceId = userDevices[0].deviceId;
          logger.info("[P2PManager] 使用默认设备:", deviceId);
        }
      }
      if (!deviceId) {
        deviceId = "default-device"; // 回退到默认设备 ID
      }

      // 检查是否已建立会话
      const hasSession = await this.signalManager.hasSession(
        peerIdStr,
        deviceId,
      );

      if (!hasSession) {
        // 先发起密钥交换
        logger.info("[P2PManager] 会话不存在，先发起密钥交换");
        await this.initiateKeyExchange(peerIdStr, deviceId);
      }

      // 加密消息
      const ciphertext = await this.signalManager.encryptMessage(
        peerIdStr,
        deviceId,
        message,
      );

      // 发送加密消息
      const { peerIdFromString } = await import("@libp2p/peer-id");
      const peerId = peerIdFromString(peerIdStr);

      const stream = await this.node.dialProtocol(
        peerId,
        "/chainlesschain/encrypted-message/1.0.0",
      );

      const messagePayload = {
        ciphertext,
        targetDeviceId: deviceId,
        fromDeviceId:
          this.deviceManager?.getCurrentDevice()?.deviceId || "default-device",
      };

      const encryptedData = Buffer.from(JSON.stringify(messagePayload));
      await stream.write(encryptedData);
      await stream.close();

      logger.info("[P2PManager] 加密消息已发送");

      this.emit("encrypted-message:sent", {
        to: peerIdStr,
        targetDeviceId: deviceId,
        message,
      });

      return {
        success: true,
        status: "sent",
        deviceId,
      };
    } catch (error) {
      logger.error("[P2PManager] 发送加密消息失败:", error);

      // 如果启用自动入队且同步管理器可用，则将消息加入队列
      if (autoQueue && this.syncManager) {
        try {
          const deviceId = targetDeviceId || "default-device";
          const messageId = await this.syncManager.queueMessage(deviceId, {
            targetPeerId: peerIdStr,
            content: message,
            encrypted: true,
          });

          logger.info("[P2PManager] 消息已加入队列:", messageId);

          return {
            success: true,
            status: "queued",
            messageId,
            deviceId,
            reason: error.message,
          };
        } catch (queueError) {
          logger.error("[P2PManager] 消息入队失败:", queueError);
          throw new Error(`发送失败且无法入队: ${error.message}`);
        }
      }

      // 如果不启用自动入队或入队失败，抛出原错误
      throw error;
    }
  }

  /**
   * 注册消息处理器
   * @param {Function} handler - 处理函数
   */
  registerMessageHandler(handler) {
    this.node.handle("/chainlesschain/message/1.0.0", async ({ stream }) => {
      try {
        const data = [];

        for await (const chunk of stream.source) {
          data.push(chunk.subarray());
        }

        const message = Buffer.concat(data);

        logger.info("[P2PManager] 收到消息:", message.length, "字节");

        // 调用处理函数
        if (handler) {
          await handler(message);
        }

        this.emit("message:received", { message });
      } catch (error) {
        logger.error("[P2PManager] 处理消息失败:", error);
      }
    });
  }

  /**
   * 获取用户的所有设备
   * @param {string} userId - 用户 ID (默认为当前用户)
   */
  getUserDevices(userId = null) {
    if (!this.deviceManager) {
      return [];
    }

    const targetUserId = userId || this.peerId.toString();
    return this.deviceManager.getUserDevices(targetUserId);
  }

  /**
   * 获取当前设备信息
   */
  getCurrentDevice() {
    if (!this.deviceManager) {
      return null;
    }

    return this.deviceManager.getCurrentDevice();
  }

  /**
   * 获取设备统计信息
   */
  getDeviceStatistics() {
    if (!this.deviceManager) {
      return {
        userCount: 0,
        totalDevices: 0,
        currentDevice: null,
      };
    }

    return this.deviceManager.getStatistics();
  }

  /**
   * 设置好友管理器
   * @param {FriendManager} friendManager - 好友管理器实例
   */
  setFriendManager(friendManager) {
    this.friendManager = friendManager;

    // 注册好友请求协议处理器
    this.registerFriendProtocols();

    logger.info("[P2PManager] 好友管理器已设置");
  }

  /**
   * 注册好友相关协议处理器
   */
  registerFriendProtocols() {
    if (!this.friendManager) {
      logger.warn("[P2PManager] 好友管理器未设置，跳过协议注册");
      return;
    }

    // 处理好友请求
    this.node.handle(
      "/chainlesschain/friend-request/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const requestData = Buffer.concat(data);
          const request = JSON.parse(requestData.toString());
          const senderId = connection.remotePeer.toString();

          logger.info("[P2PManager] 收到好友请求:", senderId);

          // 解密消息内容（如果已建立加密会话）
          let decryptedMessage = request.message;
          if (request.encrypted && this.signalManager) {
            try {
              decryptedMessage = await this.signalManager.decryptMessage(
                senderId,
                1,
                request.message,
              );
            } catch (error) {
              logger.warn(
                "[P2PManager] 解密好友请求失败，使用原始消息:",
                error,
              );
            }
          }

          // 转发给好友管理器处理
          await this.friendManager.handleFriendRequestReceived(
            request.from,
            decryptedMessage,
            request.timestamp,
          );

          // 发送确认响应
          await stream.write(Buffer.from(JSON.stringify({ success: true })));
          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理好友请求失败:", error);
        }
      },
    );

    // 处理好友请求接受通知
    this.node.handle(
      "/chainlesschain/friend-request-accepted/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const responseData = Buffer.concat(data);
          const response = JSON.parse(responseData.toString());
          const friendDid = connection.remotePeer.toString();

          logger.info("[P2PManager] 好友请求已被接受:", friendDid);

          // 触发事件通知 UI
          this.emit("friend-request:accepted", {
            friendDid: response.from,
            timestamp: response.timestamp,
          });

          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理好友请求接受通知失败:", error);
        }
      },
    );

    logger.info("[P2PManager] 好友协议处理器已注册");
  }

  /**
   * 设置动态管理器
   * @param {PostManager} postManager - 动态管理器实例
   */
  setPostManager(postManager) {
    this.postManager = postManager;

    // 注册动态协议处理器
    if (this.node) {
      this.registerPostProtocols();
    } else {
      this.pendingPostProtocolRegistration = true;
    }

    logger.info("[P2PManager] 动态管理器已设置");
  }

  /**
   * 注册动态相关协议处理器
   */
  registerPostProtocols() {
    if (!this.postManager) {
      logger.warn("[P2PManager] 动态管理器未设置，跳过协议注册");
      return;
    }
    if (!this.node) {
      logger.warn("[P2PManager] P2P 节点未初始化，跳过动态协议注册");
      this.pendingPostProtocolRegistration = true;
      return;
    }
    if (this.postProtocolsRegistered) {
      return;
    }

    // 处理动态同步
    this.node.handle(
      "/chainlesschain/post-sync/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const postData = Buffer.concat(data);
          const message = JSON.parse(postData.toString());
          const senderId = connection.remotePeer.toString();

          logger.info("[P2PManager] 收到动态同步:", message.post?.id);

          // 验证消息类型
          if (message.type === "post-sync" && message.post) {
            // 转发给动态管理器处理
            this.emit("post:received", { post: message.post });
          }

          // 发送确认响应
          await stream.write(Buffer.from(JSON.stringify({ success: true })));
          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理动态同步失败:", error);
        }
      },
    );

    // 处理点赞通知
    this.node.handle(
      "/chainlesschain/post-like/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const likeData = Buffer.concat(data);
          const message = JSON.parse(likeData.toString());
          const senderId = connection.remotePeer.toString();

          logger.info("[P2PManager] 收到点赞通知:", message.postId);

          // 验证消息类型
          if (message.type === "post-like") {
            this.emit("post-like:received", {
              postId: message.postId,
              userDid: message.userDid,
            });
          }

          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理点赞通知失败:", error);
        }
      },
    );

    // 处理评论通知
    this.node.handle(
      "/chainlesschain/post-comment/1.0.0",
      async ({ stream, connection }) => {
        try {
          const data = [];
          for await (const chunk of stream.source) {
            data.push(chunk.subarray());
          }

          const commentData = Buffer.concat(data);
          const message = JSON.parse(commentData.toString());
          const senderId = connection.remotePeer.toString();

          logger.info("[P2PManager] 收到评论通知:", message.comment?.id);

          // 验证消息类型
          if (message.type === "post-comment" && message.comment) {
            this.emit("post-comment:received", { comment: message.comment });
          }

          await stream.close();
        } catch (error) {
          logger.error("[P2PManager] 处理评论通知失败:", error);
        }
      },
    );

    this.postProtocolsRegistered = true;
    this.pendingPostProtocolRegistration = false;
    logger.info("[P2PManager] 动态协议处理器已注册");
  }

  /**
   * 关闭 P2P 节点
   */
  async close() {
    logger.info("[P2PManager] 关闭 P2P 节点");

    // 停止WebRTC质量监控器
    if (this.webrtcQualityMonitor) {
      this.webrtcQualityMonitor.stop();
      this.webrtcQualityMonitor = null;
      logger.info("[P2PManager] WebRTC质量监控器已停止");
    }

    if (this.syncManager) {
      await this.syncManager.close();
      this.syncManager = null;
    }

    if (this.deviceManager) {
      await this.deviceManager.close();
      this.deviceManager = null;
    }

    if (this.signalManager) {
      await this.signalManager.close();
      this.signalManager = null;
    }

    if (this.node) {
      await this.node.stop();
      this.node = null;
    }

    this.initialized = false;
    this.peers.clear();

    // 停止健康监控
    if (this.transportDiagnostics) {
      this.transportDiagnostics.stopHealthMonitoring();
    }

    this.emit("closed");
  }

  /**
   * 根据配置和NAT类型构建传输层数组
   */
  buildTransports({
    tcp,
    webSockets,
    webRTC,
    circuitRelayTransport,
    config,
    natInfo,
  }) {
    const transports = [];

    // Helper function to safely add WebRTC transport
    const addWebRTCTransport = (priority = "后备") => {
      // Skip if WebRTC module is not available (e.g., node-datachannel not built for Electron)
      if (!webRTC) {
        logger.info(`[P2PManager] 跳过WebRTC传输 - 模块不可用`);
        return false;
      }

      try {
        const webrtcConfig = {
          iceServers: this.buildICEServers(),
        };

        // 添加WebRTC特定配置
        if (config.webrtc) {
          if (config.webrtc.iceTransportPolicy) {
            webrtcConfig.iceTransportPolicy = config.webrtc.iceTransportPolicy;
          }
          if (config.webrtc.iceCandidatePoolSize) {
            webrtcConfig.iceCandidatePoolSize =
              config.webrtc.iceCandidatePoolSize;
          }
        }

        transports.push(webRTC(webrtcConfig));
        logger.info(`[P2PManager] 添加WebRTC传输（${priority}）`);
        logger.info(`[P2PManager] WebRTC配置:`, {
          iceServers: webrtcConfig.iceServers.length,
          iceTransportPolicy: webrtcConfig.iceTransportPolicy,
          iceCandidatePoolSize: webrtcConfig.iceCandidatePoolSize,
        });
        return true;
      } catch (error) {
        logger.warn("[P2PManager] WebRTC传输初始化失败，跳过:", error.message);
        // Note: WebRTC may not be fully supported in Node.js/Electron environments
        // Consider using @libp2p/webrtc-direct for peer-to-peer in Node.js
        return false;
      }
    };

    // 根据NAT类型和配置智能选择（优先顺序）
    if (config.transports.autoSelect && natInfo) {
      logger.info(`[P2PManager] 智能传输选择: NAT类型=${natInfo.type}`);

      // 基于NAT类型优化传输层顺序，但仍然启用所有配置的传输
      if (natInfo.type === "full-cone" || natInfo.type === "restricted") {
        // Full Cone/Restricted NAT: WebRTC优先，然后WebSocket，最后TCP
        if (config.transports.webrtc) {
          addWebRTCTransport("优先 - 适合Full Cone/Restricted NAT");
        }
        if (config.transports.websocket) {
          transports.push(webSockets());
          logger.info("[P2PManager] 添加WebSocket传输（后备）");
        }
        if (config.transports.tcp) {
          transports.push(tcp());
          logger.info("[P2PManager] 添加TCP传输（后备）");
        }
      } else if (natInfo.type === "symmetric") {
        // 对称NAT: WebSocket优先，然后WebRTC，最后TCP
        if (config.transports.websocket) {
          transports.push(webSockets());
          logger.info("[P2PManager] 添加WebSocket传输（优先 - 适合对称NAT）");
        }
        if (config.transports.webrtc) {
          addWebRTCTransport("后备");
        }
        if (config.transports.tcp) {
          transports.push(tcp());
          logger.info("[P2PManager] 添加TCP传输（后备）");
        }
      } else {
        // 本地网络或未知: TCP优先，然后WebSocket，最后WebRTC
        if (config.transports.tcp) {
          transports.push(tcp());
          logger.info("[P2PManager] 添加TCP传输（优先 - 无NAT或未知）");
        }
        if (config.transports.websocket) {
          transports.push(webSockets());
          logger.info("[P2PManager] 添加WebSocket传输（后备）");
        }
        if (config.transports.webrtc) {
          addWebRTCTransport("后备");
        }
      }
    } else {
      // 非智能模式：启用所有配置的传输层
      logger.info("[P2PManager] 标准模式：启用所有配置的传输");
      if (config.transports.tcp) {
        transports.push(tcp());
      }
      if (config.transports.websocket) {
        transports.push(webSockets());
      }
      if (config.transports.webrtc) {
        addWebRTCTransport();
      }
    }

    // Circuit Relay 作为通用后备（所有模式都启用）
    if (config.relay.enabled) {
      transports.push(
        circuitRelayTransport({
          discoverRelays: config.relay.maxReservations,
          reservationCompletionTimeout: 10000,
        }),
      );
      logger.info("[P2PManager] 添加Circuit Relay传输（通用后备）");
    }

    return transports;
  }

  /**
   * 构建ICE服务器配置（用于WebRTC）
   */
  /**
   * 构建ICE服务器配置（STUN + TURN）
   */
  buildICEServers() {
    const iceServers = [];

    // 添加STUN服务器
    if (this.p2pConfig && this.p2pConfig.stun && this.p2pConfig.stun.servers) {
      this.p2pConfig.stun.servers.forEach((server) => {
        iceServers.push({
          urls: server,
        });
      });
    }

    // 添加TURN服务器（如果配置）
    if (this.p2pConfig && this.p2pConfig.turn && this.p2pConfig.turn.enabled) {
      const turnServers = this.p2pConfig.turn.servers || [];
      turnServers.forEach((server) => {
        const turnConfig = {
          urls: server.urls,
        };

        // 添加认证信息（如果有）
        if (server.username && server.credential) {
          turnConfig.username = server.username;
          turnConfig.credential = server.credential;
        }

        iceServers.push(turnConfig);
      });
    }

    logger.info(`[P2PManager] ICE服务器配置: ${iceServers.length} 个服务器`);
    return iceServers;
  }

  /**
   * 获取WebRTC连接质量报告
   */
  getWebRTCQualityReport(peerId) {
    if (!this.webrtcQualityMonitor) {
      return null;
    }

    if (peerId) {
      return this.webrtcQualityMonitor.getQualityReport(peerId);
    } else {
      return this.webrtcQualityMonitor.getAllQualityReports();
    }
  }

  /**
   * 获取WebRTC优化建议
   */
  getWebRTCOptimizationSuggestions(peerId) {
    if (!this.webrtcQualityMonitor) {
      return [];
    }

    return this.webrtcQualityMonitor.getOptimizationSuggestions(peerId);
  }
}

module.exports = P2PManager;
