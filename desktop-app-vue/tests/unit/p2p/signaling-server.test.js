/**
 * Embedded Signaling Server Unit Tests
 *
 * Tests for the embedded signaling server components:
 * - SignalingPeerRegistry
 * - SignalingMessageQueue
 * - SignalingServer (with mocked WebSocket)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock ws module
vi.mock('ws', () => {
  const OPEN = 1;
  const CLOSED = 3;
  const CLOSING = 2;

  class MockWebSocket {
    static OPEN = OPEN;
    static CLOSED = CLOSED;
    static CLOSING = CLOSING;

    constructor() {
      this.readyState = OPEN;
      this.connectionId = null;
      this.peerId = null;
      this.isAlive = true;
      this._listeners = {};
    }

    on(event, handler) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(handler);
    }

    emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(handler => handler(data));
      }
    }

    send(data) {
      // Mock send
    }

    ping() {
      // Mock ping
    }

    close() {
      this.readyState = CLOSED;
    }

    terminate() {
      this.readyState = CLOSED;
    }
  }

  class MockWebSocketServer {
    constructor(options) {
      this.port = options?.port;
      this.host = options?.host;
      this.clients = new Set();
      this._listeners = {};
    }

    on(event, handler) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(handler);
    }

    emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(handler => handler(data));
      }
    }

    close(callback) {
      if (callback) callback();
    }
  }

  MockWebSocket.Server = MockWebSocketServer;

  return {
    default: MockWebSocket,
    WebSocket: MockWebSocket,
  };
});

// Import after mocking
const SignalingPeerRegistry = require('../../../src/main/p2p/signaling-peer-registry');
const SignalingMessageQueue = require('../../../src/main/p2p/signaling-message-queue');

describe('SignalingPeerRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new SignalingPeerRegistry();
    registry.initialize();
  });

  afterEach(() => {
    registry.stop();
    registry.clear();
  });

  describe('register', () => {
    it('should register a new peer', () => {
      const mockSocket = { connectionId: 'conn-1', readyState: 1 };
      const result = registry.register('peer-1', mockSocket, { name: 'Test' }, 'desktop');

      expect(result.success).toBe(true);
      expect(result.isReconnect).toBe(false);
      expect(registry.getCount()).toBe(1);
    });

    it('should handle duplicate registration', () => {
      const mockSocket1 = { connectionId: 'conn-1', readyState: 1 };
      const mockSocket2 = { connectionId: 'conn-2', readyState: 1 };

      registry.register('peer-1', mockSocket1, {}, 'desktop');
      const result = registry.register('peer-1', mockSocket2, {}, 'mobile');

      expect(result.success).toBe(true);
      expect(result.isReconnect).toBe(true);
      expect(result.previousConnection).not.toBeNull();
      expect(registry.getCount()).toBe(1);
    });

    it('should track device types', () => {
      const mockSocket1 = { connectionId: 'conn-1', readyState: 1 };
      const mockSocket2 = { connectionId: 'conn-2', readyState: 1 };

      registry.register('peer-1', mockSocket1, {}, 'desktop');
      registry.register('peer-2', mockSocket2, {}, 'mobile');

      const desktops = registry.getPeersByType('desktop');
      const mobiles = registry.getPeersByType('mobile');

      expect(desktops.length).toBe(1);
      expect(mobiles.length).toBe(1);
    });
  });

  describe('unregister', () => {
    it('should unregister a peer', () => {
      const mockSocket = { connectionId: 'conn-1', readyState: 1 };
      registry.register('peer-1', mockSocket, {}, 'desktop');

      const result = registry.unregister('peer-1');

      expect(result).not.toBeNull();
      expect(registry.getCount()).toBe(0);
    });

    it('should return null for non-existent peer', () => {
      const result = registry.unregister('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getPeer', () => {
    it('should return peer info', () => {
      const mockSocket = { connectionId: 'conn-1', readyState: 1 };
      registry.register('peer-1', mockSocket, { name: 'Test' }, 'desktop');

      const peer = registry.getPeer('peer-1');

      expect(peer).not.toBeNull();
      expect(peer.deviceType).toBe('desktop');
      expect(peer.deviceInfo.name).toBe('Test');
    });

    it('should return null for non-existent peer', () => {
      const peer = registry.getPeer('non-existent');
      expect(peer).toBeNull();
    });
  });

  describe('isOnline', () => {
    it('should return true for online peer', () => {
      const mockSocket = { connectionId: 'conn-1', readyState: 1 };
      registry.register('peer-1', mockSocket, {}, 'desktop');

      expect(registry.isOnline('peer-1')).toBe(true);
    });

    it('should return false for offline peer', () => {
      const mockSocket = { connectionId: 'conn-1', readyState: 3 }; // CLOSED
      registry.register('peer-1', mockSocket, {}, 'desktop');

      expect(registry.isOnline('peer-1')).toBe(false);
    });

    it('should return false for non-existent peer', () => {
      expect(registry.isOnline('non-existent')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const mockSocket1 = { connectionId: 'conn-1', readyState: 1 };
      const mockSocket2 = { connectionId: 'conn-2', readyState: 1 };

      registry.register('peer-1', mockSocket1, {}, 'desktop');
      registry.register('peer-2', mockSocket2, {}, 'mobile');

      const stats = registry.getStats();

      expect(stats.currentPeers).toBe(2);
      expect(stats.totalRegistrations).toBe(2);
      expect(stats.desktopCount).toBe(1);
      expect(stats.mobileCount).toBe(1);
    });
  });
});

describe('SignalingMessageQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new SignalingMessageQueue({
      maxQueueSize: 5,
      messageTTL: 60000,
    });
    queue.initialize();
  });

  afterEach(() => {
    queue.stop();
    queue.clearAll();
  });

  describe('enqueue', () => {
    it('should enqueue a message', () => {
      const result = queue.enqueue('peer-1', { type: 'test', data: 'hello' });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.queueSize).toBe(1);
    });

    it('should drop oldest message when queue is full', () => {
      for (let i = 0; i < 6; i++) {
        queue.enqueue('peer-1', { type: 'test', index: i });
      }

      expect(queue.getQueueSize('peer-1')).toBe(5);

      const stats = queue.getStats();
      expect(stats.totalDropped).toBe(1);
    });
  });

  describe('dequeue', () => {
    it('should dequeue all messages', () => {
      queue.enqueue('peer-1', { type: 'msg1' });
      queue.enqueue('peer-1', { type: 'msg2' });

      const messages = queue.dequeue('peer-1');

      expect(messages.length).toBe(2);
      expect(queue.getQueueSize('peer-1')).toBe(0);
    });

    it('should return empty array for peer with no messages', () => {
      const messages = queue.dequeue('non-existent');
      expect(messages).toEqual([]);
    });
  });

  describe('peek', () => {
    it('should return messages without removing them', () => {
      queue.enqueue('peer-1', { type: 'test' });

      const messages1 = queue.peek('peer-1');
      const messages2 = queue.peek('peer-1');

      expect(messages1.length).toBe(1);
      expect(messages2.length).toBe(1);
    });
  });

  describe('clearQueue', () => {
    it('should clear queue for specific peer', () => {
      queue.enqueue('peer-1', { type: 'msg1' });
      queue.enqueue('peer-2', { type: 'msg2' });

      const count = queue.clearQueue('peer-1');

      expect(count).toBe(1);
      expect(queue.getQueueSize('peer-1')).toBe(0);
      expect(queue.getQueueSize('peer-2')).toBe(1);
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired messages', () => {
      // Create queue with very short TTL
      const shortQueue = new SignalingMessageQueue({
        maxQueueSize: 10,
        messageTTL: 1, // 1ms TTL
      });
      shortQueue.initialize();

      shortQueue.enqueue('peer-1', { type: 'test' });

      // Wait for message to expire
      return new Promise((resolve) => {
        setTimeout(() => {
          const result = shortQueue.cleanupExpired();
          expect(result.expiredCount).toBe(1);
          shortQueue.stop();
          resolve();
        }, 10);
      });
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      queue.enqueue('peer-1', { type: 'msg1' });
      queue.enqueue('peer-1', { type: 'msg2' });
      queue.enqueue('peer-2', { type: 'msg3' });

      const stats = queue.getStats();

      expect(stats.currentQueues).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.totalEnqueued).toBe(3);
    });
  });
});

describe('SignalingHandlers', () => {
  const handlers = require('../../../src/main/p2p/signaling-handlers');
  let mockRegistry;
  let mockQueue;
  let mockSocket;
  let sentMessages;
  let broadcastedStatuses;

  beforeEach(() => {
    sentMessages = [];
    broadcastedStatuses = [];

    mockRegistry = {
      register: vi.fn(() => ({ success: true, isReconnect: false, previousConnection: null })),
      getPeer: vi.fn(),
      isOnline: vi.fn(),
      updateLastSeen: vi.fn(),
      getOnlinePeers: vi.fn(() => []),
    };

    mockQueue = {
      dequeue: vi.fn(() => []),
      enqueue: vi.fn(() => ({ success: true, messageId: 'msg-1' })),
      peek: vi.fn(() => []),
    };

    mockSocket = {
      peerId: 'sender-peer',
      connectionId: 'conn-1',
      readyState: 1,
    };
  });

  const sendMessage = (socket, message) => {
    sentMessages.push({ socket, message });
  };

  const broadcastPeerStatus = (peerId, status, metadata) => {
    broadcastedStatuses.push({ peerId, status, metadata });
  };

  describe('handleRegister', () => {
    it('should register peer and send confirmation', () => {
      handlers.handleRegister(
        mockSocket,
        { peerId: 'new-peer', deviceType: 'desktop', deviceInfo: { name: 'Test' } },
        mockRegistry,
        mockQueue,
        sendMessage,
        broadcastPeerStatus
      );

      expect(mockRegistry.register).toHaveBeenCalledWith('new-peer', mockSocket, { name: 'Test' }, 'desktop');
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].message.type).toBe('registered');
      expect(broadcastedStatuses.length).toBe(1);
      expect(broadcastedStatuses[0].status).toBe('online');
    });

    it('should reject registration without peerId', () => {
      handlers.handleRegister(
        mockSocket,
        { deviceType: 'desktop' },
        mockRegistry,
        mockQueue,
        sendMessage,
        broadcastPeerStatus
      );

      expect(mockRegistry.register).not.toHaveBeenCalled();
      expect(sentMessages[0].message.type).toBe('error');
    });

    it('should deliver offline messages after registration', () => {
      mockQueue.dequeue.mockReturnValue([
        { messageId: 'msg-1', message: { type: 'test' }, storedAt: Date.now() },
      ]);

      handlers.handleRegister(
        mockSocket,
        { peerId: 'new-peer', deviceType: 'desktop' },
        mockRegistry,
        mockQueue,
        sendMessage,
        broadcastPeerStatus
      );

      // registered + offline-message
      expect(sentMessages.length).toBe(2);
      expect(sentMessages[1].message.type).toBe('offline-message');
    });
  });

  describe('handleOffer', () => {
    it('should forward offer to online peer', () => {
      const targetSocket = { peerId: 'target', readyState: 1 };
      mockRegistry.getPeer.mockReturnValue({ socket: targetSocket });
      mockRegistry.isOnline.mockReturnValue(true);

      handlers.handleOffer(
        mockSocket,
        { to: 'target', offer: { type: 'offer', sdp: 'test-sdp' } },
        mockRegistry,
        mockQueue,
        sendMessage
      );

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].socket).toBe(targetSocket);
      expect(sentMessages[0].message.type).toBe('offer');
    });

    it('should queue offer for offline peer', () => {
      mockRegistry.getPeer.mockReturnValue(null);
      mockRegistry.isOnline.mockReturnValue(false);

      handlers.handleOffer(
        mockSocket,
        { to: 'target', offer: { type: 'offer', sdp: 'test-sdp' } },
        mockRegistry,
        mockQueue,
        sendMessage
      );

      expect(mockQueue.enqueue).toHaveBeenCalled();
      expect(sentMessages[0].message.type).toBe('peer-offline');
    });
  });

  describe('handleMessage', () => {
    it('should forward message to online peer', () => {
      const targetSocket = { peerId: 'target', readyState: 1 };
      mockRegistry.getPeer.mockReturnValue({ socket: targetSocket });
      mockRegistry.isOnline.mockReturnValue(true);

      handlers.handleMessage(
        mockSocket,
        { to: 'target', payload: { text: 'hello' } },
        mockRegistry,
        mockQueue,
        sendMessage
      );

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].message.type).toBe('message');
      expect(sentMessages[0].message.payload.text).toBe('hello');
    });

    it('should reject message without to field', () => {
      handlers.handleMessage(
        mockSocket,
        { payload: { text: 'hello' } },
        mockRegistry,
        mockQueue,
        sendMessage
      );

      expect(sentMessages[0].message.type).toBe('error');
    });
  });
});
