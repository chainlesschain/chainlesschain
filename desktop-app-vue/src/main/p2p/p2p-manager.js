/**
 * P2P 网络管理器
 *
 * 基于 libp2p 实现去中心化的 P2P 通信网络
 * 功能：节点发现、DHT、消息传输、NAT穿透
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

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
   * 发送消息到对等节点
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
   * 关闭 P2P 节点
   */
  async close() {
    console.log('[P2PManager] 关闭 P2P 节点');

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
