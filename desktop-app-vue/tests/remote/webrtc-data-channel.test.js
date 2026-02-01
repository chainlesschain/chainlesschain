/**
 * WebRTC 数据通道管理器单元测试
 *
 * 测试 WebRTC 连接建立、数据通道管理、消息传输等功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import WebRTCDataChannelManager from '../../src/main/p2p/webrtc-data-channel.js';
import { EventEmitter } from 'events';

describe('WebRTCDataChannelManager', () => {
  let manager;
  let mockSignalServer;

  beforeEach(() => {
    // Mock signal server
    mockSignalServer = new EventEmitter();
    mockSignalServer.send = vi.fn();

    manager = new WebRTCDataChannelManager(mockSignalServer, {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
  });

  afterEach(async () => {
    await manager.cleanup();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await manager.initialize();

      const stats = manager.getStats();
      expect(stats.totalConnections).toBe(0);
      expect(stats.activeConnections).toBe(0);
    });

    it('should setup signaling handlers', async () => {
      await manager.initialize();

      const offerHandler = mockSignalServer.listenerCount('webrtc:offer');
      const candidateHandler = mockSignalServer.listenerCount('webrtc:ice-candidate');

      expect(offerHandler).toBeGreaterThan(0);
      expect(candidateHandler).toBeGreaterThan(0);
    });

    it('should enable mock mode when wrtc is not available', async () => {
      await manager.initialize();

      expect(manager.useMockMode).toBe(true); // In test environment
    });
  });

  describe('peer connection creation', () => {
    it('should create peer connection', async () => {
      await manager.initialize();

      const connection = manager.createPeerConnection('peer-123');

      expect(connection).toBeDefined();
      expect(connection.peerId).toBe('peer-123');
      expect(connection.state).toBe('connecting');
      expect(manager.connections.has('peer-123')).toBe(true);
    });

    it('should track connection statistics', async () => {
      await manager.initialize();

      manager.createPeerConnection('peer-1');
      manager.createPeerConnection('peer-2');

      const stats = manager.getStats();
      expect(stats.totalConnections).toBe(2);
    });

    it('should create mock connection in mock mode', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('mock-peer-1');

      expect(connection.peerId).toBe('mock-peer-1');
      expect(connection.state).toBe('connected');
      expect(connection.dataChannel).toBeDefined();
      expect(connection.dataChannel.readyState).toBe('open');
    });
  });

  describe('offer/answer handling', () => {
    it('should handle incoming offer and send answer', async () => {
      await manager.initialize();

      const offerData = {
        peerId: 'android-device-1',
        offer: {
          type: 'offer',
          sdp: 'mock-sdp-data'
        }
      };

      // Simulate receiving offer
      mockSignalServer.emit('webrtc:offer', offerData);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 600));

      // Should send answer back
      expect(mockSignalServer.send).toHaveBeenCalledWith(
        'webrtc:answer',
        expect.objectContaining({
          peerId: 'android-device-1',
          answer: expect.any(Object)
        })
      );

      // Should create connection
      expect(manager.connections.has('android-device-1')).toBe(true);
    });

    it('should handle ICE candidate', async () => {
      await manager.initialize();

      const candidateData = {
        peerId: 'peer-123',
        candidate: {
          candidate: 'mock-candidate',
          sdpMid: 'data',
          sdpMLineIndex: 0
        }
      };

      // Create connection first
      manager.createPeerConnection('peer-123');

      // Simulate receiving ICE candidate
      mockSignalServer.emit('webrtc:ice-candidate', candidateData);

      // Should store in pending candidates (no remote description yet)
      expect(manager.pendingIceCandidates.has('peer-123')).toBe(true);
    });

    it('should process pending ICE candidates after setting remote description', async () => {
      await manager.initialize();

      const peerId = 'peer-456';

      // Add pending candidates first
      const candidate = { candidate: 'test-candidate' };
      manager.pendingIceCandidates.set(peerId, [candidate]);

      // Then handle offer (which sets remote description)
      const offerData = {
        peerId,
        offer: { type: 'offer', sdp: 'test-sdp' }
      };

      mockSignalServer.emit('webrtc:offer', offerData);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 600));

      // Pending candidates should be cleared
      expect(manager.pendingIceCandidates.has(peerId)).toBe(false);
    });
  });

  describe('data channel setup', () => {
    it('should setup data channel with event handlers', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-dc-1');

      expect(connection.dataChannel).toBeDefined();
      expect(connection.dataChannel.readyState).toBe('open');
    });

    it('should emit channel:open event', async () => {
      await manager.initialize();

      const openHandler = vi.fn();
      manager.on('channel:open', openHandler);

      manager.createMockConnection('peer-open-1');

      // Wait for mock connection to emit events
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(openHandler).toHaveBeenCalledWith('peer-open-1');
    });

    it('should emit message event when receiving data', async () => {
      await manager.initialize();

      const messageHandler = vi.fn();
      manager.on('message', messageHandler);

      const connection = manager.createMockConnection('peer-msg-1');

      // Wait for connection to be established
      await new Promise(resolve => setTimeout(resolve, 600));

      // Send message
      connection.dataChannel.send('test message');

      // Wait for message to be echoed back (mock behavior)
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(messageHandler).toHaveBeenCalledWith('peer-msg-1', 'test message');
    });
  });

  describe('message sending', () => {
    it('should send message through data channel', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-send-1');

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 600));

      const sendSpy = vi.spyOn(connection.dataChannel, 'send');

      manager.sendMessage('peer-send-1', 'Hello, WebRTC!');

      expect(sendSpy).toHaveBeenCalledWith('Hello, WebRTC!');
    });

    it('should throw error if data channel does not exist', async () => {
      await manager.initialize();

      expect(() => {
        manager.sendMessage('non-existent-peer', 'test');
      }).toThrow('No data channel for peer');
    });

    it('should throw error if data channel is not open', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-closed');
      connection.dataChannel.readyState = 'closed';

      expect(() => {
        manager.sendMessage('peer-closed', 'test');
      }).toThrow('Data channel not open');
    });
  });

  describe('connection state management', () => {
    it('should emit connection:established event', async () => {
      await manager.initialize();

      const establishedHandler = vi.fn();
      manager.on('connection:established', establishedHandler);

      manager.createMockConnection('peer-est-1');

      // Wait for mock connection to establish
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(establishedHandler).toHaveBeenCalledWith('peer-est-1');
    });

    it('should track active connections', async () => {
      await manager.initialize();

      manager.createMockConnection('peer-1');
      manager.createMockConnection('peer-2');

      // Wait for connections to establish
      await new Promise(resolve => setTimeout(resolve, 600));

      const stats = manager.getStats();
      expect(stats.activeConnections).toBe(2);
    });

    it('should get connection state', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-state-1');

      const state = manager.getConnectionState('peer-state-1');
      expect(state).toBe('connected');
    });

    it('should return disconnected for non-existent connection', async () => {
      await manager.initialize();

      const state = manager.getConnectionState('non-existent');
      expect(state).toBe('disconnected');
    });
  });

  describe('connection failure handling', () => {
    it('should handle connection failure', async () => {
      await manager.initialize();

      const failedHandler = vi.fn();
      manager.on('connection:failed', failedHandler);

      const connection = manager.createMockConnection('peer-fail-1');

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 600));

      // Simulate connection failure
      manager.handleConnectionFailure('peer-fail-1');

      expect(failedHandler).toHaveBeenCalledWith('peer-fail-1');
      expect(manager.connections.has('peer-fail-1')).toBe(false);

      const stats = manager.getStats();
      expect(stats.failedConnections).toBe(1);
    });

    it('should cleanup connection resources on failure', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-cleanup-1');

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 600));

      const dcCloseSpy = vi.spyOn(connection.dataChannel, 'close');
      const pcCloseSpy = vi.spyOn(connection.pc, 'close');

      manager.handleConnectionFailure('peer-cleanup-1');

      expect(dcCloseSpy).toHaveBeenCalled();
      expect(pcCloseSpy).toHaveBeenCalled();
    });
  });

  describe('disconnection', () => {
    it('should disconnect peer', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-disconnect-1');

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(manager.connections.has('peer-disconnect-1')).toBe(true);

      manager.disconnect('peer-disconnect-1');

      expect(manager.connections.has('peer-disconnect-1')).toBe(false);
    });

    it('should cleanup resources on disconnect', async () => {
      await manager.initialize();

      const connection = manager.createMockConnection('peer-disc-2');

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 600));

      const dcCloseSpy = vi.spyOn(connection.dataChannel, 'close');
      const pcCloseSpy = vi.spyOn(connection.pc, 'close');

      manager.disconnect('peer-disc-2');

      expect(dcCloseSpy).toHaveBeenCalled();
      expect(pcCloseSpy).toHaveBeenCalled();
    });

    it('should handle disconnect of non-existent peer gracefully', async () => {
      await manager.initialize();

      expect(() => {
        manager.disconnect('non-existent-peer');
      }).not.toThrow();
    });
  });

  describe('statistics', () => {
    it('should track total connections', async () => {
      await manager.initialize();

      manager.createMockConnection('peer-1');
      manager.createMockConnection('peer-2');
      manager.createMockConnection('peer-3');

      const stats = manager.getStats();
      expect(stats.totalConnections).toBe(3);
    });

    it('should track active connections count', async () => {
      await manager.initialize();

      manager.createMockConnection('peer-1');
      manager.createMockConnection('peer-2');

      // Wait for connections to establish
      await new Promise(resolve => setTimeout(resolve, 600));

      const stats = manager.getStats();
      expect(stats.activeConnections).toBe(2);
    });

    it('should track failed connections', async () => {
      await manager.initialize();

      manager.createMockConnection('peer-1');
      manager.createMockConnection('peer-2');

      // Wait for connections
      await new Promise(resolve => setTimeout(resolve, 600));

      manager.handleConnectionFailure('peer-1');

      const stats = manager.getStats();
      expect(stats.failedConnections).toBe(1);
    });

    it('should return current connections count', async () => {
      await manager.initialize();

      manager.createMockConnection('peer-1');
      manager.createMockConnection('peer-2');
      manager.disconnect('peer-1');

      const stats = manager.getStats();
      expect(stats.connections).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should cleanup all connections', async () => {
      await manager.initialize();

      manager.createMockConnection('peer-1');
      manager.createMockConnection('peer-2');
      manager.createMockConnection('peer-3');

      await manager.cleanup();

      expect(manager.connections.size).toBe(0);
      expect(manager.pendingIceCandidates.size).toBe(0);
    });

    it('should disconnect all peers on cleanup', async () => {
      await manager.initialize();

      const connection1 = manager.createMockConnection('peer-1');
      const connection2 = manager.createMockConnection('peer-2');

      const spy1 = vi.spyOn(connection1.pc, 'close');
      const spy2 = vi.spyOn(connection2.pc, 'close');

      await manager.cleanup();

      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle offer processing error', async () => {
      await manager.initialize();

      const failedHandler = vi.fn();
      manager.on('connection:failed', failedHandler);

      // Invalid offer data
      const invalidOffer = {
        peerId: 'peer-error-1',
        offer: null // Invalid
      };

      mockSignalServer.emit('webrtc:offer', invalidOffer);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 600));

      const stats = manager.getStats();
      expect(stats.failedConnections).toBeGreaterThan(0);
    });

    it('should not crash on invalid ICE candidate', async () => {
      await manager.initialize();

      const invalidCandidate = {
        peerId: 'peer-123',
        candidate: null
      };

      expect(() => {
        mockSignalServer.emit('webrtc:ice-candidate', invalidCandidate);
      }).not.toThrow();
    });
  });
});
