/**
 * P2P 网络管理器
 *
 * 基于 libp2p 实现去中心化的 P2P 通信网络
 * 功能：节点发现、DHT、消息传输、NAT穿透、端到端加密
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const SignalSessionManager = require('./signal-session-manager');
const DeviceManager = require('./device-manager');
const { DeviceSyncManager, MessageStatus, SyncMessageType } = require('./device-sync-manager');

// 动态导入 ESM 模块
let createLibp2p, tcp, noise, mplex, kadDHT, mdns, bootstrap, multiaddr;

/**
 * P2P 配置
 */
const DEFAULT_CONFIG = {
  port: 9000,
  bootstrapNodes: [
    // 公共引导节点（可配置）
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
    '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  ],
  enableMDNS: true,  // 本地网络发现
  enableDHT: true,   // DHT 网络
  dataPath: null,    // 数据存储路径
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
    this.peers = new Map(); // 连接的对等节点
    this.dht = null;
    this.signalManager = null; // Signal 加密会话管理器
    this.deviceManager = null; // 设备管理器
    this.syncManager = null;   // 设备同步管理器
    this.initialized = false;
  }

  /**
   * 初始化 P2P 节点
   */
  async initialize() {
    console.log('[P2PManager] 初始化 P2P 节点...');

    try {
      // 动态导入 ESM 模块
      if (!createLibp2p) {
        console.log('[P2PManager] 加载 libp2p 模块...');
        const libp2pModule = await import('libp2p');
        createLibp2p = libp2pModule.createLibp2p;

        const tcpModule = await import('@libp2p/tcp');
        tcp = tcpModule.tcp;

        const noiseModule = await import('@libp2p/noise');
        noise = noiseModule.noise;

        const mplexModule = await import('@libp2p/mplex');
        mplex = mplexModule.mplex;

        const kadDHTModule = await import('@libp2p/kad-dht');
        kadDHT = kadDHTModule.kadDHT;

        const mdnsModule = await import('@libp2p/mdns');
        mdns = mdnsModule.mdns;

        const bootstrapModule = await import('@libp2p/bootstrap');
        bootstrap = bootstrapModule.bootstrap;

        const multiaddrModule = await import('multiaddr');
        multiaddr = multiaddrModule.multiaddr;
      }

      // 加载或生成 PeerId
      this.peerId = await this.loadOrGeneratePeerId();

      // 创建 libp2p 节点
      this.node = await createLibp2p({
        peerId: this.peerId,
        addresses: {
          listen: [
            `/ip4/0.0.0.0/tcp/${this.config.port}`,
            `/ip4/127.0.0.1/tcp/${this.config.port}`,
          ],
        },
        transports: [tcp()],
        streamMuxers: [mplex()],
        connectionEncryption: [noise()],
        peerDiscovery: this.getPeerDiscoveryConfig(),
        dht: this.config.enableDHT ? kadDHT() : undefined,
      });

      // 设置事件监听
      this.setupEvents();

      // 启动节点
      await this.node.start();

      // 获取 DHT 实例
      if (this.config.enableDHT) {
        this.dht = this.node.services.dht;
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

      // 广播当前设备信息
      this.broadcastDeviceInfo();

      this.initialized = true;

      const addresses = this.node.getMultiaddrs();
      console.log('[P2PManager] P2P 节点已启动');
      console.log('[P2PManager] PeerId:', this.peerId.toString());
      console.log('[P2PManager] 监听地址:', addresses.map((a) => a.toString()));

      this.emit('initialized', {
        peerId: this.peerId.toString(),
        addresses: addresses.map((a) => a.toString()),
      });

      return true;
    } catch (error) {
      console.error('[P2PManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加载或生成 PeerId
   */
  async loadOrGeneratePeerId() {
    const { createFromJSON, createEd25519PeerId } = await import('@libp2p/peer-id-factory');

    if (!this.config.dataPath) {
      // 无数据路径，生成临时 PeerId
      console.log('[P2PManager] 生成临时 PeerId');
      return await createEd25519PeerId();
    }

    const peerIdPath = path.join(this.config.dataPath, 'peer-id.json');

    try {
      // 尝试加载现有 PeerId
      if (fs.existsSync(peerIdPath)) {
        const peerIdJSON = JSON.parse(fs.readFileSync(peerIdPath, 'utf8'));
        console.log('[P2PManager] 加载现有 PeerId');
        return await createFromJSON(peerIdJSON);
      }
    } catch (error) {
      console.warn('[P2PManager] 加载 PeerId 失败，将生成新的:', error.message);
    }

    // 生成新 PeerId 并保存
    console.log('[P2PManager] 生成新 PeerId');
    const peerId = await createEd25519PeerId();

    try {
      fs.mkdirSync(path.dirname(peerIdPath), { recursive: true });
      fs.writeFileSync(peerIdPath, JSON.stringify(peerId.toJSON(), null, 2));
      console.log('[P2PManager] PeerId 已保存到:', peerIdPath);
    } catch (error) {
      console.warn('[P2PManager] 保存 PeerId 失败:', error.message);
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
      discovery.push(mdns({
        interval: 20000, // 20 秒
      }));
    }

    // Bootstrap 节点
    if (this.config.bootstrapNodes && this.config.bootstrapNodes.length > 0) {
      discovery.push(bootstrap({
        list: this.config.bootstrapNodes,
      }));
    }

    return discovery;
  }

  /**
   * 设置事件监听
   */
  setupEvents() {
    // 对等节点连接
    this.node.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString();
      console.log('[P2PManager] 对等节点已连接:', peerId);

      this.peers.set(peerId, {
        peerId,
        connectedAt: Date.now(),
      });

      this.emit('peer:connected', { peerId });
    });

    // 对等节点断开
    this.node.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString();
      console.log('[P2PManager] 对等节点已断开:', peerId);

      this.peers.delete(peerId);

      this.emit('peer:disconnected', { peerId });
    });

    // 对等节点发现
    this.node.addEventListener('peer:discovery', (evt) => {
      const peer = evt.detail;
      console.log('[P2PManager] 发现对等节点:', peer.id.toString());

      this.emit('peer:discovered', {
        peerId: peer.id.toString(),
        multiaddrs: peer.multiaddrs.map((ma) => ma.toString()),
      });
    });

    // 自我地址更新
    this.node.addEventListener('self:peer:update', () => {
      const addresses = this.node.getMultiaddrs();
      console.log('[P2PManager] 节点地址已更新:', addresses.map((a) => a.toString()));

      this.emit('address:updated', {
        addresses: addresses.map((a) => a.toString()),
      });
    });
  }

  /**
   * 初始化设备管理器
   */
  async initializeDeviceManager() {
    console.log('[P2PManager] 初始化设备管理器...');

    try {
      this.deviceManager = new DeviceManager({
        userId: this.peerId.toString(),
        dataPath: this.config.dataPath,
        deviceName: this.config.deviceName,
      });

      await this.deviceManager.initialize();

      console.log('[P2PManager] 设备管理器已初始化');
      console.log('[P2PManager] 当前设备 ID:', this.deviceManager.getCurrentDevice().deviceId);
    } catch (error) {
      console.error('[P2PManager] 初始化设备管理器失败:', error);
      // 不抛出错误，允许 P2P 网络继续工作
      this.deviceManager = null;
    }
  }

  /**
   * 初始化 Signal 会话管理器
   */
  async initializeSignalManager() {
    console.log('[P2PManager] 初始化 Signal 会话管理器...');

    try {
      // 获取设备 ID
      const deviceId = this.deviceManager
        ? this.deviceManager.getCurrentDevice().deviceId
        : 'default-device';

      this.signalManager = new SignalSessionManager({
        userId: this.peerId.toString(),
        deviceId: deviceId,
        dataPath: this.config.dataPath,
      });

      await this.signalManager.initialize();

      console.log('[P2PManager] Signal 会话管理器已初始化');
    } catch (error) {
      console.error('[P2PManager] 初始化 Signal 会话管理器失败:', error);
      // 不抛出错误，允许 P2P 网络继续工作（无加密模式）
      this.signalManager = null;
    }
  }

  /**
   * 初始化设备同步管理器
   */
  async initializeSyncManager() {
    console.log('[P2PManager] 初始化设备同步管理器...');

    try {
      const deviceId = this.deviceManager
        ? this.deviceManager.getCurrentDevice().deviceId
        : 'default-device';

      this.syncManager = new DeviceSyncManager({
        userId: this.peerId.toString(),
        deviceId: deviceId,
        dataPath: this.config.dataPath,
      });

      await this.syncManager.initialize();

      // 监听同步事件
      this.syncManager.on('sync:message', async ({ deviceId, message }) => {
        // 尝试发送队列中的消息
        try {
          await this.sendEncryptedMessage(message.targetPeerId, message.content);
          await this.syncManager.markMessageDelivered(message.id);
          await this.syncManager.removeMessage(message.id);
        } catch (error) {
          console.error('[P2PManager] 发送同步消息失败:', error);
          await this.syncManager.markMessageFailed(message.id, error.message);
        }
      });

      console.log('[P2PManager] 设备同步管理器已初始化');
    } catch (error) {
      console.error('[P2PManager] 初始化设备同步管理器失败:', error);
      // 不抛出错误，允许 P2P 网络继续工作（无同步模式）
      this.syncManager = null;
    }
  }

  /**
   * 注册加密消息协议处理器
   */
  registerEncryptedMessageHandlers() {
    if (!this.signalManager) {
      console.warn('[P2PManager] Signal 未初始化，跳过加密消息处理器注册');
      return;
    }

    // 处理加密消息
    this.node.handle('/chainlesschain/encrypted-message/1.0.0', async ({ stream, connection }) => {
      try {
        const data = [];
        for await (const chunk of stream.source) {
          data.push(chunk.subarray());
        }

        const encryptedMessage = Buffer.concat(data);
        const senderId = connection.remotePeer.toString();

        console.log('[P2PManager] 收到加密消息:', senderId);

        // 解析加密消息
        const ciphertext = JSON.parse(encryptedMessage.toString());

        // 解密消息
        const plaintext = await this.signalManager.decryptMessage(senderId, 1, ciphertext);

        console.log('[P2PManager] 消息已解密');

        this.emit('encrypted-message:received', {
          from: senderId,
          message: plaintext,
        });
      } catch (error) {
        console.error('[P2PManager] 处理加密消息失败:', error);
      }
    });

    // 处理预密钥交换请求
    this.node.handle('/chainlesschain/key-exchange/1.0.0', async ({ stream, connection }) => {
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
          request = { requestDeviceId: 'default-device', targetDeviceId: null };
        }

        console.log('[P2PManager] 收到密钥交换请求:', requesterId, '请求设备:', request.requestDeviceId);

        // 获取预密钥包
        const preKeyBundle = await this.signalManager.getPreKeyBundle();

        // 获取当前设备ID
        const currentDeviceId = this.deviceManager?.getCurrentDevice()?.deviceId || 'default-device';

        // 发送预密钥包和设备ID
        const response = {
          preKeyBundle,
          deviceId: currentDeviceId,
        };

        const responseData = Buffer.from(JSON.stringify(response));
        await stream.write(responseData);
        await stream.close();

        console.log('[P2PManager] 已发送预密钥包，设备:', currentDeviceId);
      } catch (error) {
        console.error('[P2PManager] 处理密钥交换失败:', error);
      }
    });

    console.log('[P2PManager] 加密消息协议处理器已注册');
  }

  /**
   * 注册设备广播协议处理器
   */
  registerDeviceBroadcastHandlers() {
    if (!this.deviceManager) {
      console.warn('[P2PManager] 设备管理器未初始化，跳过设备广播处理器注册');
      return;
    }

    // 处理设备广播
    this.node.handle('/chainlesschain/device-broadcast/1.0.0', async ({ stream, connection }) => {
      try {
        const data = [];
        for await (const chunk of stream.source) {
          data.push(chunk.subarray());
        }

        const broadcastData = Buffer.concat(data);
        const broadcast = JSON.parse(broadcastData.toString());
        const peerId = connection.remotePeer.toString();

        console.log('[P2PManager] 收到设备广播:', peerId);

        // 处理设备广播
        await this.deviceManager.handleDeviceBroadcast(peerId, broadcast);

        // 发送确认响应
        await stream.write(Buffer.from(JSON.stringify({ success: true })));
        await stream.close();
      } catch (error) {
        console.error('[P2PManager] 处理设备广播失败:', error);
      }
    });

    console.log('[P2PManager] 设备广播协议处理器已注册');
  }

  /**
   * 注册设备同步协议处理器
   */
  registerDeviceSyncHandlers() {
    if (!this.syncManager) {
      console.warn('[P2PManager] 设备同步管理器未初始化，跳过同步处理器注册');
      return;
    }

    // 处理同步请求
    this.node.handle('/chainlesschain/device-sync/1.0.0', async ({ stream, connection }) => {
      try {
        const data = [];
        for await (const chunk of stream.source) {
          data.push(chunk.subarray());
        }

        const requestData = Buffer.concat(data);
        const request = JSON.parse(requestData.toString());
        const peerId = connection.remotePeer.toString();

        console.log('[P2PManager] 收到同步请求:', peerId, 'type:', request.type);

        let response = { success: false };

        switch (request.type) {
          case SyncMessageType.SYNC_REQUEST:
            // 对方请求同步，返回队列中的消息
            const deviceId = request.deviceId;
            const queue = this.syncManager.getDeviceQueue(deviceId);
            response = {
              success: true,
              type: SyncMessageType.SYNC_RESPONSE,
              messages: queue,
            };
            break;

          case SyncMessageType.MESSAGE_STATUS:
            // 对方报告消息状态
            const { messageId, status } = request;
            if (status === MessageStatus.DELIVERED) {
              await this.syncManager.markMessageDelivered(messageId);
            } else if (status === MessageStatus.READ) {
              await this.syncManager.markMessageRead(messageId);
            }
            response = { success: true };
            break;

          case SyncMessageType.DEVICE_STATUS:
            // 对方报告设备状态
            this.syncManager.updateDeviceStatus(request.deviceId, request.status);
            response = { success: true };
            break;

          default:
            console.warn('[P2PManager] 未知同步消息类型:', request.type);
        }

        // 发送响应
        await stream.write(Buffer.from(JSON.stringify(response)));
        await stream.close();
      } catch (error) {
        console.error('[P2PManager] 处理同步请求失败:', error);
      }
    });

    console.log('[P2PManager] 设备同步协议处理器已注册');
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

    console.log('[P2PManager] 广播设备信息到所有连接的节点');

    // 向所有连接的节点广播设备信息
    const connections = this.node.getConnections();

    for (const conn of connections) {
      try {
        const peerId = conn.remotePeer;
        const stream = await this.node.dialProtocol(peerId, '/chainlesschain/device-broadcast/1.0.0');

        const broadcastData = Buffer.from(JSON.stringify(broadcast));
        await stream.write(broadcastData);

        // 接收确认
        const responseData = [];
        for await (const chunk of stream.source) {
          responseData.push(chunk.subarray());
        }

        await stream.close();

        console.log('[P2PManager] 设备信息已广播到:', peerId.toString());
      } catch (error) {
        console.error('[P2PManager] 广播设备信息失败:', error);
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
      throw new Error('Signal 会话管理器未初始化');
    }

    try {
      console.log('[P2PManager] 发起密钥交换:', peerIdStr, 'deviceId:', targetDeviceId || '默认设备');

      const { peerIdFromString } = await import('@libp2p/peer-id');
      const peerId = peerIdFromString(peerIdStr);

      // 创建密钥交换流
      const stream = await this.node.dialProtocol(peerId, '/chainlesschain/key-exchange/1.0.0');

      // 发送请求，包含当前设备ID和目标设备ID
      const request = {
        requestDeviceId: this.deviceManager?.getCurrentDevice()?.deviceId || 'default-device',
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
      const remoteDeviceId = response.deviceId || targetDeviceId || 'default-device';

      // 处理预密钥包，建立会话
      await this.signalManager.processPreKeyBundle(peerIdStr, remoteDeviceId, preKeyBundle);

      console.log('[P2PManager] 密钥交换成功，设备:', remoteDeviceId);

      this.emit('key-exchange:success', { peerId: peerIdStr, deviceId: remoteDeviceId });

      return { success: true, deviceId: remoteDeviceId };
    } catch (error) {
      console.error('[P2PManager] 密钥交换失败:', error);
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
      console.log('[P2PManager] 连接到对等节点:', multiaddrStr);

      const ma = multiaddr(multiaddrStr);
      const connection = await this.node.dial(ma);

      console.log('[P2PManager] 连接成功:', connection.remotePeer.toString());

      return {
        success: true,
        peerId: connection.remotePeer.toString(),
      };
    } catch (error) {
      console.error('[P2PManager] 连接失败:', error);
      throw error;
    }
  }

  /**
   * 断开与对等节点的连接
   * @param {string} peerId - 对等节点 ID
   */
  async disconnectFromPeer(peerIdStr) {
    try {
      const { peerIdFromString } = await import('@libp2p/peer-id');
      const peerId = peerIdFromString(peerIdStr);

      await this.node.hangUp(peerId);

      console.log('[P2PManager] 已断开连接:', peerIdStr);

      return { success: true };
    } catch (error) {
      console.error('[P2PManager] 断开连接失败:', error);
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
      throw new Error('DHT 未启用');
    }

    try {
      console.log('[P2PManager] DHT PUT:', key);

      await this.dht.put(Buffer.from(key), value);

      console.log('[P2PManager] DHT PUT 成功');

      return { success: true };
    } catch (error) {
      console.error('[P2PManager] DHT PUT 失败:', error);
      throw error;
    }
  }

  /**
   * DHT: 获取数据
   * @param {string} key - 键
   */
  async dhtGet(key) {
    if (!this.dht) {
      throw new Error('DHT 未启用');
    }

    try {
      console.log('[P2PManager] DHT GET:', key);

      const value = await this.dht.get(Buffer.from(key));

      console.log('[P2PManager] DHT GET 成功');

      return value;
    } catch (error) {
      console.error('[P2PManager] DHT GET 失败:', error);
      throw error;
    }
  }

  /**
   * DHT: 查找提供者
   * @param {string} cid - CID
   */
  async dhtFindProviders(cid) {
    if (!this.dht) {
      throw new Error('DHT 未启用');
    }

    try {
      console.log('[P2PManager] DHT 查找提供者:', cid);

      const providers = [];
      for await (const provider of this.dht.findProviders(cid)) {
        providers.push({
          id: provider.id.toString(),
          multiaddrs: provider.multiaddrs.map((ma) => ma.toString()),
        });
      }

      console.log('[P2PManager] 找到', providers.length, '个提供者');

      return providers;
    } catch (error) {
      console.error('[P2PManager] DHT 查找提供者失败:', error);
      throw error;
    }
  }

  /**
   * 发送消息到对等节点 (明文)
   * @param {string} peerId - 对等节点 ID
   * @param {Buffer} data - 数据
   */
  async sendMessage(peerIdStr, data) {
    try {
      const { peerIdFromString } = await import('@libp2p/peer-id');
      const peerId = peerIdFromString(peerIdStr);

      // 创建流
      const stream = await this.node.dialProtocol(peerId, '/chainlesschain/message/1.0.0');

      // 发送数据
      await stream.write(data);
      await stream.close();

      console.log('[P2PManager] 消息已发送到:', peerIdStr);

      return { success: true };
    } catch (error) {
      console.error('[P2PManager] 发送消息失败:', error);
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
  async sendEncryptedMessage(peerIdStr, message, targetDeviceId = null, options = {}) {
    if (!this.signalManager) {
      throw new Error('Signal 会话管理器未初始化');
    }

    const autoQueue = options.autoQueue !== false; // 默认启用自动入队

    try {
      console.log('[P2PManager] 发送加密消息到:', peerIdStr, 'deviceId:', targetDeviceId || '默认设备');

      // 获取目标设备 ID (如果未指定，使用第一个可用设备)
      let deviceId = targetDeviceId;
      if (!deviceId && this.deviceManager) {
        const userDevices = this.deviceManager.getUserDevices(peerIdStr);
        if (userDevices && userDevices.length > 0) {
          deviceId = userDevices[0].deviceId;
          console.log('[P2PManager] 使用默认设备:', deviceId);
        }
      }
      if (!deviceId) {
        deviceId = 'default-device'; // 回退到默认设备 ID
      }

      // 检查是否已建立会话
      const hasSession = await this.signalManager.hasSession(peerIdStr, deviceId);

      if (!hasSession) {
        // 先发起密钥交换
        console.log('[P2PManager] 会话不存在，先发起密钥交换');
        await this.initiateKeyExchange(peerIdStr, deviceId);
      }

      // 加密消息
      const ciphertext = await this.signalManager.encryptMessage(peerIdStr, deviceId, message);

      // 发送加密消息
      const { peerIdFromString } = await import('@libp2p/peer-id');
      const peerId = peerIdFromString(peerIdStr);

      const stream = await this.node.dialProtocol(
        peerId,
        '/chainlesschain/encrypted-message/1.0.0'
      );

      const messagePayload = {
        ciphertext,
        targetDeviceId: deviceId,
        fromDeviceId: this.deviceManager?.getCurrentDevice()?.deviceId || 'default-device',
      };

      const encryptedData = Buffer.from(JSON.stringify(messagePayload));
      await stream.write(encryptedData);
      await stream.close();

      console.log('[P2PManager] 加密消息已发送');

      this.emit('encrypted-message:sent', {
        to: peerIdStr,
        targetDeviceId: deviceId,
        message,
      });

      return {
        success: true,
        status: 'sent',
        deviceId,
      };
    } catch (error) {
      console.error('[P2PManager] 发送加密消息失败:', error);

      // 如果启用自动入队且同步管理器可用，则将消息加入队列
      if (autoQueue && this.syncManager) {
        try {
          const deviceId = targetDeviceId || 'default-device';
          const messageId = await this.syncManager.queueMessage(deviceId, {
            targetPeerId: peerIdStr,
            content: message,
            encrypted: true,
          });

          console.log('[P2PManager] 消息已加入队列:', messageId);

          return {
            success: true,
            status: 'queued',
            messageId,
            deviceId,
            reason: error.message,
          };
        } catch (queueError) {
          console.error('[P2PManager] 消息入队失败:', queueError);
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
    this.node.handle('/chainlesschain/message/1.0.0', async ({ stream }) => {
      try {
        const data = [];

        for await (const chunk of stream.source) {
          data.push(chunk.subarray());
        }

        const message = Buffer.concat(data);

        console.log('[P2PManager] 收到消息:', message.length, '字节');

        // 调用处理函数
        if (handler) {
          await handler(message);
        }

        this.emit('message:received', { message });
      } catch (error) {
        console.error('[P2PManager] 处理消息失败:', error);
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
   * 关闭 P2P 节点
   */
  async close() {
    console.log('[P2PManager] 关闭 P2P 节点');

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

    this.emit('closed');
  }
}

module.exports = P2PManager;
