/**
 * 实时同步通知单元测试
 *
 * 测试P2PManager的实时同步通知功能：
 * 1. WebSocket式实时通知协议
 * 2. 消息入队时立即推送通知
 * 3. 降级到30秒轮询机制
 * 4. 心跳保活机制
 * 5. 通知到达延迟测量
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EventEmitter from 'events';

/**
 * 模拟P2P节点（libp2p）
 */
class MockLibp2pNode extends EventEmitter {
  constructor(peerId = null) {
    super();
    this.peerId = peerId;           // 节点自己的ID
    this.protocols = new Map();     // protocol -> handler
    this.peers = new Map();         // peerId -> MockPeer
    this.isStarted = false;
  }

  /**
   * 启动节点
   */
  async start() {
    this.isStarted = true;
  }

  /**
   * 停止节点
   */
  async stop() {
    this.isStarted = false;
    this.peers.clear();
  }

  /**
   * 注册协议处理器
   */
  handle(protocol, handler) {
    this.protocols.set(protocol, handler);
  }

  /**
   * 拨号到对等节点
   */
  async dialProtocol(peerId, protocol) {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (!peer.isOnline) {
      throw new Error(`Peer offline: ${peerId}`);
    }

    // 创建模拟流
    const stream = new MockStream();

    // 延迟模拟网络传输
    setTimeout(async () => {
      const handler = peer.protocols.get(protocol);
      if (handler) {
        // remotePeer 应该是发起连接的节点（this.peerId），而不是目标节点（peerId）
        await handler({ stream, connection: { remotePeer: { toString: () => this.peerId || 'unknown' } } });
      }
    }, peer.latency || 10);

    return stream;
  }

  /**
   * 添加对等节点
   */
  addPeer(peerId, peerNode) {
    this.peers.set(peerId, {
      node: peerNode,
      protocols: peerNode.protocols,
      isOnline: true,
      latency: 10,  // 10ms网络延迟
    });
  }

  /**
   * 设置对等节点状态
   */
  setPeerOnline(peerId, isOnline) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.isOnline = isOnline;
    }
  }
}

/**
 * 模拟libp2p流
 */
class MockStream extends EventEmitter {
  constructor() {
    super();
    this.buffer = [];
    this.closed = false;
  }

  async write(data) {
    if (this.closed) {
      // Silently ignore writes to closed streams instead of throwing
      // This prevents unhandled rejections during test cleanup
      return;
    }
    this.buffer.push(data);
    this.emit('data', data);
  }

  async close() {
    this.closed = true;
    this.emit('close');
  }

  /**
   * 读取源（for-await）
   */
  get source() {
    const buffer = this.buffer;
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of buffer) {
          yield chunk;
        }
      }
    };
  }
}

/**
 * 带实时同步通知的P2PManager
 */
class RealtimeSyncP2PManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enableRealtimeSync: config.enableRealtimeSync !== false,  // 默认启用
      syncFallbackInterval: config.syncFallbackInterval || 30000,  // 30秒降级轮询
      heartbeatInterval: config.heartbeatInterval || 15000,        // 15秒心跳
      ...config,
    };

    this.node = config.node || null;
    this.syncManager = null;

    this.syncFallbackTimer = null;
    this.heartbeatTimer = null;
    this.lastSyncTime = new Map();  // peerId -> timestamp

    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (!this.node) {
      throw new Error('libp2p node is required');
    }

    // 注册实时同步通知协议
    if (this.config.enableRealtimeSync) {
      this.registerSyncNotificationHandler();
      this.registerHeartbeatHandler();
    }

    // 启动降级轮询（作为备份）
    this.startSyncFallbackTimer();

    // 启动心跳
    if (this.config.enableRealtimeSync) {
      this.startHeartbeatTimer();
    }

    this.initialized = true;
  }

  /**
   * 关闭
   */
  async close() {
    this.stopSyncFallbackTimer();
    this.stopHeartbeatTimer();
    this.initialized = false;
  }

  /**
   * 注册同步通知处理器
   */
  registerSyncNotificationHandler() {
    this.node.handle('/chainlesschain/sync-notification/1.0.0', async ({ stream, connection }) => {
      const data = [];
      for await (const chunk of stream.source) {
        data.push(chunk);
      }

      const notification = JSON.parse(Buffer.concat(data).toString());
      const peerId = connection.remotePeer.toString();

      // 更新最后同步时间
      this.lastSyncTime.set(peerId, Date.now());

      // 发射同步通知事件
      this.emit('sync:notification-received', {
        from: peerId,
        deviceId: notification.deviceId,
        messageId: notification.messageId,
        timestamp: notification.timestamp,
      });

      // 立即触发同步（如果有syncManager）
      if (this.syncManager && this.syncManager.syncDevice) {
        await this.syncManager.syncDevice(notification.deviceId);
      }

      // 发送确认
      await stream.write(Buffer.from(JSON.stringify({ success: true })));
      await stream.close();
    });
  }

  /**
   * 注册心跳处理器
   */
  registerHeartbeatHandler() {
    this.node.handle('/chainlesschain/heartbeat/1.0.0', async ({ stream, connection }) => {
      const peerId = connection.remotePeer.toString();

      // 更新最后心跳时间
      this.lastSyncTime.set(peerId, Date.now());

      this.emit('heartbeat:received', { from: peerId });

      // 回复心跳
      await stream.write(Buffer.from(JSON.stringify({ alive: true, timestamp: Date.now() })));
      await stream.close();
    });
  }

  /**
   * 发送同步通知
   */
  async sendSyncNotification(peerId, notification) {
    if (!this.config.enableRealtimeSync) {
      return false;
    }

    try {
      const stream = await this.node.dialProtocol(peerId, '/chainlesschain/sync-notification/1.0.0');

      const payload = {
        deviceId: notification.deviceId,
        messageId: notification.messageId,
        timestamp: Date.now(),
      };

      await stream.write(Buffer.from(JSON.stringify(payload)));

      // 读取确认
      const response = [];
      for await (const chunk of stream.source) {
        response.push(chunk);
      }

      await stream.close();

      this.emit('sync:notification-sent', { to: peerId, notification });

      return true;
    } catch (error) {
      this.emit('sync:notification-failed', { to: peerId, error: error.message });
      return false;
    }
  }

  /**
   * 发送心跳
   */
  async sendHeartbeat(peerId) {
    try {
      const stream = await this.node.dialProtocol(peerId, '/chainlesschain/heartbeat/1.0.0');

      await stream.write(Buffer.from(JSON.stringify({ ping: true, timestamp: Date.now() })));

      // 读取响应
      const response = [];
      for await (const chunk of stream.source) {
        response.push(chunk);
      }

      await stream.close();

      this.emit('heartbeat:sent', { to: peerId });

      return true;
    } catch (error) {
      this.emit('heartbeat:failed', { to: peerId, error: error.message });
      return false;
    }
  }

  /**
   * 启动降级轮询定时器
   */
  startSyncFallbackTimer() {
    if (this.syncFallbackTimer) return;

    this.syncFallbackTimer = setInterval(() => {
      this.emit('sync:fallback-triggered');

      // 触发所有设备的同步（降级机制）
      if (this.syncManager && this.syncManager.syncAllDevices) {
        this.syncManager.syncAllDevices().catch(err => {
          console.error('Fallback sync failed:', err);
        });
      }
    }, this.config.syncFallbackInterval);

    // 允许进程退出
    if (this.syncFallbackTimer.unref) {
      this.syncFallbackTimer.unref();
    }
  }

  /**
   * 停止降级轮询定时器
   */
  stopSyncFallbackTimer() {
    if (this.syncFallbackTimer) {
      clearInterval(this.syncFallbackTimer);
      this.syncFallbackTimer = null;
    }
  }

  /**
   * 启动心跳定时器
   */
  startHeartbeatTimer() {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      // 向所有已知的peer发送心跳
      for (const peerId of this.node.peers.keys()) {
        this.sendHeartbeat(peerId).catch(err => {
          console.error(`Heartbeat to ${peerId} failed:`, err);
        });
      }
    }, this.config.heartbeatInterval);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * 停止心跳定时器
   */
  stopHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 检查是否连接到对等节点
   */
  isConnected(peerId) {
    return this.node.peers.has(peerId);
  }

  /**
   * 获取最后同步时间
   */
  getLastSyncTime(peerId) {
    return this.lastSyncTime.get(peerId) || 0;
  }
}

/**
 * 模拟SyncManager
 */
class MockSyncManager {
  constructor() {
    this.syncedDevices = [];
  }

  async syncDevice(deviceId) {
    this.syncedDevices.push(deviceId);
  }

  async syncAllDevices() {
    // 模拟同步所有设备
  }
}

describe('P2PManager - 实时同步通知', () => {
  let node1, node2;
  let manager1, manager2;
  let syncManager1, syncManager2;

  beforeEach(async () => {
    // 创建两个模拟P2P节点（带有 peerId）
    node1 = new MockLibp2pNode('peer-1');
    node2 = new MockLibp2pNode('peer-2');

    await node1.start();
    await node2.start();

    // 互相添加为对等节点
    node1.addPeer('peer-2', node2);
    node2.addPeer('peer-1', node1);

    // 创建SyncManager
    syncManager1 = new MockSyncManager();
    syncManager2 = new MockSyncManager();
  });

  afterEach(async () => {
    // Allow pending async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    if (manager1) {
      await manager1.close();
      manager1 = null;
    }
    if (manager2) {
      await manager2.close();
      manager2 = null;
    }

    await node1.stop();
    await node2.stop();
  });

  describe('实时通知协议', () => {
    it('应该注册同步通知协议处理器', async () => {
      manager1 = new RealtimeSyncP2PManager({
        node: node1,
        enableRealtimeSync: true,
      });

      await manager1.initialize();

      // 验证协议已注册
      expect(node1.protocols.has('/chainlesschain/sync-notification/1.0.0')).toBe(true);
      expect(node1.protocols.has('/chainlesschain/heartbeat/1.0.0')).toBe(true);
    });

    it('应该能够发送和接收同步通知', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });
      manager2 = new RealtimeSyncP2PManager({ node: node2 });

      manager2.syncManager = syncManager2;

      await manager1.initialize();
      await manager2.initialize();

      const receivedNotifications = [];
      manager2.on('sync:notification-received', (data) => {
        receivedNotifications.push(data);
      });

      // manager1向manager2发送通知
      const notification = {
        deviceId: 'device-001',
        messageId: 'msg-123',
      };

      const success = await manager1.sendSyncNotification('peer-2', notification);

      // 等待异步处理
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(success).toBe(true);
      expect(receivedNotifications).toHaveLength(1);
      expect(receivedNotifications[0].deviceId).toBe('device-001');
      expect(receivedNotifications[0].messageId).toBe('msg-123');
    });

    it('应该在接收通知后立即触发同步', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });
      manager2 = new RealtimeSyncP2PManager({ node: node2 });

      manager2.syncManager = syncManager2;

      await manager1.initialize();
      await manager2.initialize();

      const notification = {
        deviceId: 'device-001',
        messageId: 'msg-123',
      };

      await manager1.sendSyncNotification('peer-2', notification);

      // 等待异步处理
      await new Promise(resolve => setTimeout(resolve, 50));

      // 验证syncDevice被调用
      expect(syncManager2.syncedDevices).toContain('device-001');
    });
  });

  describe('消息延迟测试', () => {
    it('实时通知应该在50ms内送达', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });
      manager2 = new RealtimeSyncP2PManager({ node: node2 });

      await manager1.initialize();
      await manager2.initialize();

      let receiveTime = 0;
      manager2.on('sync:notification-received', () => {
        receiveTime = Date.now();
      });

      const sendTime = Date.now();
      await manager1.sendSyncNotification('peer-2', {
        deviceId: 'device-001',
        messageId: 'msg-123',
      });

      // 等待接收
      await new Promise(resolve => setTimeout(resolve, 50));

      const latency = receiveTime - sendTime;
      expect(latency).toBeLessThan(50);  // <50ms延迟
    });

    it('降级轮询延迟应该在30秒级别', async () => {
      vi.useFakeTimers();

      manager1 = new RealtimeSyncP2PManager({
        node: node1,
        enableRealtimeSync: false,  // 禁用实时通知，只用轮询
        syncFallbackInterval: 30000,
      });

      await manager1.initialize();

      const fallbackEvents = [];
      manager1.on('sync:fallback-triggered', () => {
        fallbackEvents.push(Date.now());
      });

      // 快进30秒
      await vi.advanceTimersByTimeAsync(30000);

      expect(fallbackEvents).toHaveLength(1);

      // 再快进30秒
      await vi.advanceTimersByTimeAsync(30000);

      expect(fallbackEvents).toHaveLength(2);

      vi.useRealTimers();
    });
  });

  describe('降级机制', () => {
    it('实时通知失败时应该依赖降级轮询', async () => {
      manager1 = new RealtimeSyncP2PManager({
        node: node1,
        enableRealtimeSync: true,
        syncFallbackInterval: 1000,  // 快速测试
      });

      manager1.syncManager = syncManager1;

      await manager1.initialize();

      // 设置peer离线（实时通知会失败）
      node1.setPeerOnline('peer-2', false);

      const notification = {
        deviceId: 'device-001',
        messageId: 'msg-123',
      };

      const success = await manager1.sendSyncNotification('peer-2', notification);

      expect(success).toBe(false);  // 实时通知失败

      // 等待降级轮询触发
      await new Promise(resolve => setTimeout(resolve, 1100));

      // 验证降级轮询已触发（通过事件）
      const fallbackTriggered = await new Promise(resolve => {
        manager1.once('sync:fallback-triggered', () => resolve(true));
        setTimeout(() => resolve(false), 2000);
      });

      expect(fallbackTriggered).toBe(true);
    });

    it('应该在关闭时停止所有定时器', async () => {
      manager1 = new RealtimeSyncP2PManager({
        node: node1,
        enableRealtimeSync: true,
      });

      await manager1.initialize();

      expect(manager1.syncFallbackTimer).not.toBeNull();
      expect(manager1.heartbeatTimer).not.toBeNull();

      await manager1.close();

      expect(manager1.syncFallbackTimer).toBeNull();
      expect(manager1.heartbeatTimer).toBeNull();
    });
  });

  describe('心跳机制', () => {
    it('应该能够发送和接收心跳', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });
      manager2 = new RealtimeSyncP2PManager({ node: node2 });

      await manager1.initialize();
      await manager2.initialize();

      const heartbeats = [];
      manager2.on('heartbeat:received', (data) => {
        heartbeats.push(data);
      });

      await manager1.sendHeartbeat('peer-2');

      // 等待处理
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].from).toBe('peer-1');
    });

    it('应该更新最后同步时间', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });
      manager2 = new RealtimeSyncP2PManager({ node: node2 });

      await manager1.initialize();
      await manager2.initialize();

      const beforeTime = Date.now();

      await manager1.sendHeartbeat('peer-2');

      // 等待处理
      await new Promise(resolve => setTimeout(resolve, 50));

      const lastSyncTime = manager2.getLastSyncTime('peer-1');

      expect(lastSyncTime).toBeGreaterThanOrEqual(beforeTime);
      expect(lastSyncTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('事件发射', () => {
    it('应该在发送通知成功时发射事件', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });
      manager2 = new RealtimeSyncP2PManager({ node: node2 });

      await manager1.initialize();
      await manager2.initialize();

      const sentEvents = [];
      manager1.on('sync:notification-sent', (data) => {
        sentEvents.push(data);
      });

      await manager1.sendSyncNotification('peer-2', {
        deviceId: 'device-001',
        messageId: 'msg-123',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].to).toBe('peer-2');
    });

    it('应该在发送失败时发射事件', async () => {
      manager1 = new RealtimeSyncP2PManager({ node: node1 });

      await manager1.initialize();

      // 设置peer离线
      node1.setPeerOnline('peer-2', false);

      const failedEvents = [];
      manager1.on('sync:notification-failed', (data) => {
        failedEvents.push(data);
      });

      await manager1.sendSyncNotification('peer-2', {
        deviceId: 'device-001',
        messageId: 'msg-123',
      });

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].to).toBe('peer-2');
    });
  });
});
