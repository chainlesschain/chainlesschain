/**
 * ChainlessChain WebSocket Signaling Server
 *
 * 功能：
 * - WebRTC信令转发（Offer/Answer/ICE候选）
 * - 节点注册与发现
 * - 离线消息暂存（最多保留24小时）
 * - 移动端与PC端（libp2p）桥接
 */

const defaultHttpModule = require('http');
const defaultWebSocketModule = require('ws');
const { v4: uuidv4 } = require('uuid');

class SignalingServer {
  constructor(options = {}) {
    this.port = options.port || 9001;
    this.healthPort = options.healthPort || 9002;
    this.wss = null;
    this.httpServer = null;
    this.healthServer = null;
    this.heartbeatInterval = null;
    this.cleanupInterval = null;
    this.WebSocket = options.websocketModule || defaultWebSocketModule;
    this.httpModule = options.httpModule || defaultHttpModule;

    // 连接管理
    this.clients = new Map(); // peerId -> { ws, deviceInfo, connectedAt }
    this.deviceTypes = new Map(); // peerId -> 'mobile' | 'desktop'

    // 离线消息队列（按目标peerId存储）
    this.offlineMessages = new Map(); // targetPeerId -> Message[]
    this.offlineMessageTTL = 24 * 60 * 60 * 1000; // 24小时

    // 统计信息
    this.stats = {
      totalConnections: 0,
      currentConnections: 0,
      messagesForwarded: 0,
      offlineMessagesStored: 0,
      startTime: Date.now()
    };

    // 定期清理过期离线消息
    this.startCleanupTimer();
  }

  /**
   * 启动HTTP健康检查服务器
   */
  startHealthServer() {
    this.healthServer = this.httpModule.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        // 健康检查端点
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        const health = {
          status: 'healthy',
          service: 'signaling-server',
          version: '0.1.0',
          uptime: uptime,
          connections: {
            current: this.stats.currentConnections,
            total: this.stats.totalConnections
          },
          messages: {
            forwarded: this.stats.messagesForwarded,
            offlineQueued: Array.from(this.offlineMessages.values())
              .reduce((sum, queue) => sum + queue.length, 0)
          },
          timestamp: new Date().toISOString()
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
      } else if (req.url === '/stats') {
        // 统计信息端点
        const stats = this.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    this.healthServer.listen(this.healthPort, () => {
      console.log(`[SignalingServer] HTTP健康检查服务器启动在端口 ${this.healthPort}`);
      console.log(`[SignalingServer] 健康检查端点: http://localhost:${this.healthPort}/health`);
      console.log(`[SignalingServer] 统计信息端点: http://localhost:${this.healthPort}/stats`);
    });

    this.healthServer.on('error', (error) => {
      console.error('[SignalingServer] HTTP服务器错误:', error);
    });
  }

  /**
   * 启动WebSocket服务器
   */
  start() {
    // 先启动健康检查服务器
    this.startHealthServer();

    // 启动WebSocket服务器
    this.wss = new this.WebSocket.Server({ port: this.port });

    this.wss.on('connection', (ws, req) => {
      const connectionId = uuidv4();
      console.log(`[SignalingServer] 新连接: ${connectionId} from ${req.socket.remoteAddress}`);

      // 连接临时标识（在注册前使用）
      ws.connectionId = connectionId;
      ws.isAlive = true;
      ws.peerId = null;

      // 心跳检测
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // 消息处理
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('[SignalingServer] 消息解析失败:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      // 连接关闭
      ws.on('close', () => {
        if (ws.peerId) {
          console.log(`[SignalingServer] 节点断开: ${ws.peerId}`);
          this.clients.delete(ws.peerId);
          this.stats.currentConnections--;

          // 通知其他节点
          this.broadcastPeerStatus(ws.peerId, 'offline');
        } else {
          console.log(`[SignalingServer] 未注册连接断开: ${connectionId}`);
        }
      });

      // 错误处理
      ws.on('error', (error) => {
        console.error(`[SignalingServer] WebSocket错误:`, error);
      });

      this.stats.totalConnections++;
      this.stats.currentConnections++;
    });

    // 心跳检测定时器
    this.startHeartbeat();

    console.log(`[SignalingServer] WebSocket服务器启动在端口 ${this.port}`);
    console.log(`[SignalingServer] 等待客户端连接...`);
  }

  /**
   * 处理客户端消息
   */
  handleMessage(ws, message) {
    const { type } = message;

    switch (type) {
      case 'register':
        this.handleRegister(ws, message);
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'ice-candidates':
        this.handleSignaling(ws, message);
        break;

      case 'pairing:request':
      case 'pairing:confirmation':
      case 'pairing:reject':
        this.handleSignaling(ws, message);
        break;

      case 'message':
        this.handleP2PMessage(ws, message);
        break;

      case 'get-peers':
        this.handleGetPeers(ws);
        break;

      case 'ping':
        this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        console.warn(`[SignalingServer] 未知消息类型: ${type}`);
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  /**
   * 处理节点注册
   */
  handleRegister(ws, message) {
    const { peerId, deviceInfo, deviceType } = message;

    if (!peerId) {
      this.sendError(ws, 'peerId is required');
      return;
    }

    // 检查peerId是否已存在
    if (this.clients.has(peerId)) {
      const existingClient = this.clients.get(peerId);

      // 关闭旧连接（可能是重连或多设备登录）
      console.log(`[SignalingServer] 节点 ${peerId} 重新连接，关闭旧连接`);
      try {
        existingClient.ws.close();
      } catch (error) {
        console.error('[SignalingServer] 关闭旧连接失败:', error);
      }
    }

    // 注册新连接
    ws.peerId = peerId;
    this.clients.set(peerId, {
      ws,
      deviceInfo: deviceInfo || {},
      deviceType: deviceType || 'unknown',
      connectedAt: Date.now()
    });

    this.deviceTypes.set(peerId, deviceType || 'unknown');

    console.log(`[SignalingServer] 节点注册成功: ${peerId} (${deviceType})`);

    // 发送注册成功响应
    this.sendMessage(ws, {
      type: 'registered',
      peerId,
      serverTime: Date.now()
    });

    // 发送离线消息（如果有）
    this.deliverOfflineMessages(peerId);

    // 通知其他节点
    this.broadcastPeerStatus(peerId, 'online', { deviceType, deviceInfo });
  }

  /**
   * 处理WebRTC信令消息（Offer/Answer/ICE候选）
   */
  handleSignaling(ws, message) {
    const { to, from } = message;

    if (!to) {
      this.sendError(ws, 'Missing "to" field');
      return;
    }

    // 自动填充from字段
    if (!from) {
      message.from = ws.peerId;
    }

    const targetClient = this.clients.get(to);

    if (targetClient && targetClient.ws.readyState === this.WebSocket.OPEN) {
      // 目标在线，直接转发
      this.sendMessage(targetClient.ws, message);
      this.stats.messagesForwarded++;

      console.log(`[SignalingServer] 转发${message.type}: ${message.from} -> ${to}`);
    } else {
      // 目标离线，存储到离线队列
      this.storeOfflineMessage(to, message);

      // 通知发送方目标离线
      this.sendMessage(ws, {
        type: 'peer-offline',
        peerId: to,
        messageId: message.id || uuidv4()
      });

      console.log(`[SignalingServer] 目标离线，消息已暂存: ${message.from} -> ${to}`);
    }
  }

  /**
   * 处理P2P业务消息
   */
  handleP2PMessage(ws, message) {
    const { to, payload } = message;

    console.log(`[SignalingServer] 收到P2P消息: from=${ws.peerId}, to=${to}, payload type=${payload?.type}`);

    if (!to || !payload) {
      this.sendError(ws, 'Missing "to" or "payload" field');
      return;
    }

    const targetClient = this.clients.get(to);

    if (targetClient && targetClient.ws.readyState === this.WebSocket.OPEN) {
      // 转发消息
      this.sendMessage(targetClient.ws, {
        type: 'message',
        from: ws.peerId,
        payload,
        timestamp: Date.now()
      });

      this.stats.messagesForwarded++;
      console.log(`[SignalingServer] ✅ 消息已转发: ${ws.peerId} -> ${to} (${payload?.type})`);
    } else {
      // 存储离线消息
      this.storeOfflineMessage(to, {
        type: 'message',
        from: ws.peerId,
        payload,
        timestamp: Date.now()
      });
      console.log(`[SignalingServer] ⚠️  目标离线，消息已存储: ${to}`);

      // 通知发送方目标处于离线状态
      this.sendMessage(ws, {
        type: 'peer-offline',
        peerId: to,
        messageId: uuidv4()
      });
    }
  }

  /**
   * 处理获取在线节点列表请求
   */
  handleGetPeers(ws) {
    const peers = [];

    for (const [peerId, client] of this.clients.entries()) {
      if (peerId !== ws.peerId) {
        peers.push({
          peerId,
          deviceType: client.deviceType,
          deviceInfo: client.deviceInfo,
          connectedAt: client.connectedAt
        });
      }
    }

    this.sendMessage(ws, {
      type: 'peers-list',
      peers,
      count: peers.length
    });
  }

  /**
   * 存储离线消息
   */
  storeOfflineMessage(targetPeerId, message) {
    if (!this.offlineMessages.has(targetPeerId)) {
      this.offlineMessages.set(targetPeerId, []);
    }

    const queue = this.offlineMessages.get(targetPeerId);

    queue.push({
      message,
      storedAt: Date.now()
    });

    this.stats.offlineMessagesStored++;

    // 限制队列大小（最多100条）
    if (queue.length > 100) {
      queue.shift(); // 删除最旧的消息
    }
  }

  /**
   * 投递离线消息
   */
  deliverOfflineMessages(peerId) {
    const queue = this.offlineMessages.get(peerId);

    if (!queue || queue.length === 0) {
      return;
    }

    const client = this.clients.get(peerId);
    if (!client || client.ws.readyState !== this.WebSocket.OPEN) {
      return;
    }

    console.log(`[SignalingServer] 投递 ${queue.length} 条离线消息给 ${peerId}`);

    for (const item of queue) {
      this.sendMessage(client.ws, {
        type: 'offline-message',
        originalMessage: item.message,
        storedAt: item.storedAt,
        deliveredAt: Date.now()
      });
    }

    // 清空离线队列
    this.offlineMessages.delete(peerId);
  }

  /**
   * 广播节点状态变更
   */
  broadcastPeerStatus(peerId, status, metadata = {}) {
    const message = {
      type: 'peer-status',
      peerId,
      status, // 'online' | 'offline'
      ...metadata,
      timestamp: Date.now()
    };

    // 广播给所有其他在线节点
    for (const [clientPeerId, client] of this.clients.entries()) {
      if (clientPeerId !== peerId && client.ws.readyState === this.WebSocket.OPEN) {
        this.sendMessage(client.ws, message);
      }
    }
  }

  /**
   * 发送消息到客户端
   */
  sendMessage(ws, message) {
    if (ws.readyState === this.WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[SignalingServer] 发送消息失败:', error);
      }
    }
  }

  /**
   * 发送错误消息
   */
  sendError(ws, errorMessage) {
    this.sendMessage(ws, {
      type: 'error',
      error: errorMessage,
      timestamp: Date.now()
    });
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          console.log(`[SignalingServer] 心跳超时，关闭连接: ${ws.peerId || ws.connectionId}`);
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30秒
  }

  /**
   * 启动离线消息清理定时器
   */
  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [peerId, queue] of this.offlineMessages.entries()) {
        const filtered = queue.filter(item => {
          return now - item.storedAt < this.offlineMessageTTL;
        });

        const removed = queue.length - filtered.length;
        if (removed > 0) {
          cleanedCount += removed;

          if (filtered.length === 0) {
            this.offlineMessages.delete(peerId);
          } else {
            this.offlineMessages.set(peerId, filtered);
          }
        }
      }

      if (cleanedCount > 0) {
        console.log(`[SignalingServer] 清理 ${cleanedCount} 条过期离线消息`);
      }
    }, 60 * 60 * 1000); // 每小时清理一次
  }

  /**
   * 获取服务器统计信息
   */
  getStats() {
    return {
      ...this.stats,
      offlineMessagesQueued: Array.from(this.offlineMessages.values())
        .reduce((sum, queue) => sum + queue.length, 0)
    };
  }

  /**
   * 停止服务器
   */
  stop() {
    console.log('[SignalingServer] 正在关闭服务器...');

    // 关闭所有WebSocket连接
    if (this.wss) {
      this.wss.clients.forEach((ws) => {
        ws.close();
      });

      // 关闭WebSocket服务器
      this.wss.close(() => {
        console.log('[SignalingServer] WebSocket服务器已关闭');
      });
    }

    // 停止定时器
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // 关闭HTTP健康检查服务器
    if (this.healthServer) {
      this.healthServer.close(() => {
        console.log('[SignalingServer] HTTP健康检查服务器已关闭');
      });
    }
  }
}

// 主程序入口
if (require.main === module) {
  const server = new SignalingServer({ port: 9001 });
  server.start();

  // 定期打印统计信息
  setInterval(() => {
    const stats = server.getStats();
    console.log(`[Stats] 连接数: ${stats.currentConnections}, 总连接: ${stats.totalConnections}, 转发消息: ${stats.messagesForwarded}, 离线消息: ${stats.offlineMessagesQueued}`);
  }, 5 * 60 * 1000); // 每5分钟

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[SignalingServer] 收到SIGINT信号');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[SignalingServer] 收到SIGTERM信号');
    server.stop();
    process.exit(0);
  });
}

module.exports = SignalingServer;
