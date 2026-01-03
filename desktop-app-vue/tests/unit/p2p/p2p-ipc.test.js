/**
 * P2P Network IPC 单元测试
 * 测试18个P2P网络管理 API 方法
 *
 * 测试覆盖：
 * - P2P基础操作 (4 handlers)
 * - 加密消息 (3 handlers)
 * - 多设备支持 (3 handlers)
 * - 设备同步 (3 handlers)
 * - NAT穿透 (5 handlers)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('P2P Network IPC', () => {
  let handlers = {};
  let mockP2PManager;
  let mockIpcMain;
  let registerP2PIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock P2P manager with all required methods and properties
    mockP2PManager = {
      initialized: true,
      p2pConfig: {
        stun: {
          servers: ['stun.l.google.com:19302'],
        },
      },
      natInfo: {
        type: 'full-cone',
        publicIP: '1.2.3.4',
        publicPort: 12345,
      },
      node: {
        getConnections: vi.fn(() => []),
      },
      syncManager: {
        getStatistics: vi.fn(),
        messageStatus: new Map(),
        startDeviceSync: vi.fn(),
        stopDeviceSync: vi.fn(),
      },
      natDetector: {
        detectNATType: vi.fn(),
      },
      transportDiagnostics: {
        runFullDiagnostics: vi.fn(),
      },

      // P2P 基础操作
      getNodeInfo: vi.fn(),
      connectToPeer: vi.fn(),
      disconnectFromPeer: vi.fn(),
      getConnectedPeers: vi.fn(),

      // 加密消息
      sendEncryptedMessage: vi.fn(),
      hasEncryptedSession: vi.fn(),
      initiateKeyExchange: vi.fn(),

      // 多设备支持
      getUserDevices: vi.fn(),
      getCurrentDevice: vi.fn(),
      getDeviceStatistics: vi.fn(),
    };

    // 动态导入
    const module = await import('../../../src/main/p2p/p2p-ipc.js');
    registerP2PIPC = module.registerP2PIPC;

    // 注册 P2P IPC 并注入 mock ipcMain
    registerP2PIPC({
      p2pManager: mockP2PManager,
      ipcMain: mockIpcMain
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('基本功能测试', () => {
    it('should register all 18 IPC handlers', () => {
      expect(Object.keys(handlers).length).toBe(18);
    });

    it('should have all expected handler channels', () => {
      const expectedChannels = [
        // P2P 基础操作 (4)
        'p2p:get-node-info',
        'p2p:connect',
        'p2p:disconnect',
        'p2p:get-peers',

        // 加密消息 (3)
        'p2p:send-encrypted-message',
        'p2p:has-encrypted-session',
        'p2p:initiate-key-exchange',

        // 多设备支持 (3)
        'p2p:get-user-devices',
        'p2p:get-current-device',
        'p2p:get-device-statistics',

        // 设备同步 (3)
        'p2p:get-sync-statistics',
        'p2p:get-message-status',
        'p2p:start-device-sync',
        'p2p:stop-device-sync',

        // NAT 穿透 (4)
        'p2p:detect-nat',
        'p2p:get-nat-info',
        'p2p:get-relay-info',
        'p2p:run-diagnostics',
      ];

      expectedChannels.forEach(channel => {
        expect(handlers[channel]).toBeDefined();
        expect(typeof handlers[channel]).toBe('function');
      });
    });
  });

  describe('P2P 基础操作 (4 handlers)', () => {
    describe('p2p:get-node-info', () => {
      it('should return node info when manager is initialized', async () => {
        const mockNodeInfo = {
          peerId: 'QmTest123',
          addresses: ['/ip4/127.0.0.1/tcp/4001'],
        };
        mockP2PManager.getNodeInfo.mockReturnValue(mockNodeInfo);

        const result = await handlers['p2p:get-node-info']();

        expect(result).toEqual(mockNodeInfo);
        expect(mockP2PManager.getNodeInfo).toHaveBeenCalled();
      });

      it('should return null when manager is not initialized', async () => {
        mockP2PManager.initialized = false;

        const result = await handlers['p2p:get-node-info']();

        expect(result).toBeNull();
        expect(mockP2PManager.getNodeInfo).not.toHaveBeenCalled();
      });

      it('should return null when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-node-info']();

        expect(result).toBeNull();
      });

      it('should return null when getNodeInfo throws error', async () => {
        mockP2PManager.getNodeInfo.mockImplementation(() => {
          throw new Error('Node info error');
        });

        const result = await handlers['p2p:get-node-info']();

        expect(result).toBeNull();
      });
    });

    describe('p2p:connect', () => {
      it('should connect to peer successfully', async () => {
        const multiaddr = '/ip4/1.2.3.4/tcp/4001/p2p/QmPeer123';
        mockP2PManager.connectToPeer.mockResolvedValue({ success: true });

        const result = await handlers['p2p:connect']({}, multiaddr);

        expect(result).toEqual({ success: true });
        expect(mockP2PManager.connectToPeer).toHaveBeenCalledWith(multiaddr);
      });

      it('should throw error when manager is not initialized', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        await expect(handlers['p2p:connect']({}, '/ip4/1.2.3.4/tcp/4001'))
          .rejects.toThrow('P2P管理器未初始化');
      });

      it('should throw error when connection fails', async () => {
        const error = new Error('Connection failed');
        mockP2PManager.connectToPeer.mockRejectedValue(error);

        await expect(handlers['p2p:connect']({}, '/ip4/1.2.3.4/tcp/4001'))
          .rejects.toThrow('Connection failed');
      });
    });

    describe('p2p:disconnect', () => {
      it('should disconnect from peer successfully', async () => {
        const peerId = 'QmPeer123';
        mockP2PManager.disconnectFromPeer.mockResolvedValue({ success: true });

        const result = await handlers['p2p:disconnect']({}, peerId);

        expect(result).toEqual({ success: true });
        expect(mockP2PManager.disconnectFromPeer).toHaveBeenCalledWith(peerId);
      });

      it('should throw error when manager is not initialized', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        await expect(handlers['p2p:disconnect']({}, 'QmPeer123'))
          .rejects.toThrow('P2P管理器未初始化');
      });

      it('should throw error when disconnection fails', async () => {
        const error = new Error('Disconnect failed');
        mockP2PManager.disconnectFromPeer.mockRejectedValue(error);

        await expect(handlers['p2p:disconnect']({}, 'QmPeer123'))
          .rejects.toThrow('Disconnect failed');
      });
    });

    describe('p2p:get-peers', () => {
      it('should return connected peers list', async () => {
        const mockPeers = [
          { peerId: 'QmPeer1', addresses: ['/ip4/1.2.3.4/tcp/4001'] },
          { peerId: 'QmPeer2', addresses: ['/ip4/5.6.7.8/tcp/4001'] },
        ];
        mockP2PManager.getConnectedPeers.mockReturnValue(mockPeers);

        const result = await handlers['p2p:get-peers']();

        expect(result).toEqual(mockPeers);
        expect(mockP2PManager.getConnectedPeers).toHaveBeenCalled();
      });

      it('should return empty array when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-peers']();

        expect(result).toEqual([]);
      });

      it('should return empty array when error occurs', async () => {
        mockP2PManager.getConnectedPeers.mockImplementation(() => {
          throw new Error('Get peers error');
        });

        const result = await handlers['p2p:get-peers']();

        expect(result).toEqual([]);
      });
    });
  });

  describe('加密消息 (3 handlers)', () => {
    describe('p2p:send-encrypted-message', () => {
      it('should send encrypted message successfully', async () => {
        const peerId = 'QmPeer123';
        const message = 'Hello, world!';
        const deviceId = 'device-1';
        const options = { priority: 'high' };

        mockP2PManager.sendEncryptedMessage.mockResolvedValue({
          messageId: 'msg-123',
          success: true
        });

        const result = await handlers['p2p:send-encrypted-message'](
          {}, peerId, message, deviceId, options
        );

        expect(result).toEqual({ messageId: 'msg-123', success: true });
        expect(mockP2PManager.sendEncryptedMessage).toHaveBeenCalledWith(
          peerId, message, deviceId, options
        );
      });

      it('should throw error when manager is not initialized', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        await expect(handlers['p2p:send-encrypted-message'](
          {}, 'QmPeer123', 'message', 'device-1'
        )).rejects.toThrow('P2P管理器未初始化');
      });

      it('should throw error when sending fails', async () => {
        const error = new Error('Send failed');
        mockP2PManager.sendEncryptedMessage.mockRejectedValue(error);

        await expect(handlers['p2p:send-encrypted-message'](
          {}, 'QmPeer123', 'message', 'device-1'
        )).rejects.toThrow('Send failed');
      });
    });

    describe('p2p:has-encrypted-session', () => {
      it('should return true when session exists', async () => {
        const peerId = 'QmPeer123';
        mockP2PManager.hasEncryptedSession.mockResolvedValue(true);

        const result = await handlers['p2p:has-encrypted-session']({}, peerId);

        expect(result).toBe(true);
        expect(mockP2PManager.hasEncryptedSession).toHaveBeenCalledWith(peerId);
      });

      it('should return false when session does not exist', async () => {
        mockP2PManager.hasEncryptedSession.mockResolvedValue(false);

        const result = await handlers['p2p:has-encrypted-session']({}, 'QmPeer123');

        expect(result).toBe(false);
      });

      it('should return false when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        const result = await handlers['p2p:has-encrypted-session']({}, 'QmPeer123');

        expect(result).toBe(false);
      });

      it('should return false when error occurs', async () => {
        mockP2PManager.hasEncryptedSession.mockRejectedValue(new Error('Check failed'));

        const result = await handlers['p2p:has-encrypted-session']({}, 'QmPeer123');

        expect(result).toBe(false);
      });
    });

    describe('p2p:initiate-key-exchange', () => {
      it('should initiate key exchange successfully', async () => {
        const peerId = 'QmPeer123';
        const deviceId = 'device-1';
        mockP2PManager.initiateKeyExchange.mockResolvedValue({
          success: true,
          sessionId: 'session-123'
        });

        const result = await handlers['p2p:initiate-key-exchange'](
          {}, peerId, deviceId
        );

        expect(result).toEqual({ success: true, sessionId: 'session-123' });
        expect(mockP2PManager.initiateKeyExchange).toHaveBeenCalledWith(peerId, deviceId);
      });

      it('should throw error when manager is not initialized', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        await expect(handlers['p2p:initiate-key-exchange'](
          {}, 'QmPeer123', 'device-1'
        )).rejects.toThrow('P2P管理器未初始化');
      });

      it('should throw error when key exchange fails', async () => {
        const error = new Error('Key exchange failed');
        mockP2PManager.initiateKeyExchange.mockRejectedValue(error);

        await expect(handlers['p2p:initiate-key-exchange'](
          {}, 'QmPeer123', 'device-1'
        )).rejects.toThrow('Key exchange failed');
      });
    });
  });

  describe('多设备支持 (3 handlers)', () => {
    describe('p2p:get-user-devices', () => {
      it('should return user devices list', async () => {
        const userId = 'user-123';
        const mockDevices = [
          { deviceId: 'device-1', name: 'Desktop', online: true },
          { deviceId: 'device-2', name: 'Laptop', online: false },
        ];
        mockP2PManager.getUserDevices.mockReturnValue(mockDevices);

        const result = await handlers['p2p:get-user-devices']({}, userId);

        expect(result).toEqual(mockDevices);
        expect(mockP2PManager.getUserDevices).toHaveBeenCalledWith(userId);
      });

      it('should return empty array when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-user-devices']({}, 'user-123');

        expect(result).toEqual([]);
      });

      it('should return empty array when error occurs', async () => {
        mockP2PManager.getUserDevices.mockImplementation(() => {
          throw new Error('Get devices error');
        });

        const result = await handlers['p2p:get-user-devices']({}, 'user-123');

        expect(result).toEqual([]);
      });
    });

    describe('p2p:get-current-device', () => {
      it('should return current device info', async () => {
        const mockDevice = {
          deviceId: 'device-1',
          name: 'Desktop',
          online: true,
        };
        mockP2PManager.getCurrentDevice.mockReturnValue(mockDevice);

        const result = await handlers['p2p:get-current-device']();

        expect(result).toEqual(mockDevice);
        expect(mockP2PManager.getCurrentDevice).toHaveBeenCalled();
      });

      it('should return null when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-current-device']();

        expect(result).toBeNull();
      });

      it('should return null when error occurs', async () => {
        mockP2PManager.getCurrentDevice.mockImplementation(() => {
          throw new Error('Get device error');
        });

        const result = await handlers['p2p:get-current-device']();

        expect(result).toBeNull();
      });
    });

    describe('p2p:get-device-statistics', () => {
      it('should return device statistics', async () => {
        const mockStats = {
          userCount: 10,
          totalDevices: 25,
          currentDevice: { deviceId: 'device-1', name: 'Desktop' },
        };
        mockP2PManager.getDeviceStatistics.mockReturnValue(mockStats);

        const result = await handlers['p2p:get-device-statistics']();

        expect(result).toEqual(mockStats);
        expect(mockP2PManager.getDeviceStatistics).toHaveBeenCalled();
      });

      it('should return default stats when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-device-statistics']();

        expect(result).toEqual({
          userCount: 0,
          totalDevices: 0,
          currentDevice: null,
        });
      });

      it('should return default stats when error occurs', async () => {
        mockP2PManager.getDeviceStatistics.mockImplementation(() => {
          throw new Error('Get statistics error');
        });

        const result = await handlers['p2p:get-device-statistics']();

        expect(result).toEqual({
          userCount: 0,
          totalDevices: 0,
          currentDevice: null,
        });
      });
    });
  });

  describe('设备同步 (4 handlers)', () => {
    describe('p2p:get-sync-statistics', () => {
      it('should return sync statistics', async () => {
        const mockStats = {
          totalMessages: 100,
          deviceCount: 3,
          deviceQueues: { 'device-1': 10, 'device-2': 5 },
          statusCount: 95,
          activeSyncs: 2,
        };
        mockP2PManager.syncManager.getStatistics.mockReturnValue(mockStats);

        const result = await handlers['p2p:get-sync-statistics']();

        expect(result).toEqual(mockStats);
        expect(mockP2PManager.syncManager.getStatistics).toHaveBeenCalled();
      });

      it('should return default stats when syncManager is null', async () => {
        handlers = {};

        const managerWithoutSync = { ...mockP2PManager, syncManager: null };
        registerP2PIPC({ p2pManager: managerWithoutSync, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-sync-statistics']();

        expect(result).toEqual({
          totalMessages: 0,
          deviceCount: 0,
          deviceQueues: {},
          statusCount: 0,
          activeSyncs: 0,
        });
      });

      it('should return default stats when error occurs', async () => {
        mockP2PManager.syncManager.getStatistics.mockImplementation(() => {
          throw new Error('Get statistics error');
        });

        const result = await handlers['p2p:get-sync-statistics']();

        expect(result).toEqual({
          totalMessages: 0,
          deviceCount: 0,
          deviceQueues: {},
          statusCount: 0,
          activeSyncs: 0,
        });
      });
    });

    describe('p2p:get-message-status', () => {
      it('should return message status when exists', async () => {
        const messageId = 'msg-123';
        const mockStatus = {
          messageId: 'msg-123',
          status: 'delivered',
          timestamp: Date.now(),
        };
        mockP2PManager.syncManager.messageStatus.set(messageId, mockStatus);

        const result = await handlers['p2p:get-message-status']({}, messageId);

        expect(result).toEqual(mockStatus);
      });

      it('should return null when message status does not exist', async () => {
        const result = await handlers['p2p:get-message-status']({}, 'nonexistent');

        expect(result).toBeNull();
      });

      it('should return null when syncManager is null', async () => {
        handlers = {};

        const managerWithoutSync = { ...mockP2PManager, syncManager: null };
        registerP2PIPC({ p2pManager: managerWithoutSync, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-message-status']({}, 'msg-123');

        expect(result).toBeNull();
      });

      it('should return null when error occurs', async () => {
        mockP2PManager.syncManager.messageStatus = {
          get: vi.fn(() => {
            throw new Error('Get status error');
          }),
        };

        const result = await handlers['p2p:get-message-status']({}, 'msg-123');

        expect(result).toBeNull();
      });
    });

    describe('p2p:start-device-sync', () => {
      it('should start device sync successfully', async () => {
        const deviceId = 'device-1';

        const result = await handlers['p2p:start-device-sync']({}, deviceId);

        expect(result).toEqual({ success: true });
        expect(mockP2PManager.syncManager.startDeviceSync).toHaveBeenCalledWith(deviceId);
      });

      it('should throw error when syncManager is null', async () => {
        handlers = {};

        const managerWithoutSync = { ...mockP2PManager, syncManager: null };
        registerP2PIPC({ p2pManager: managerWithoutSync, ipcMain: mockIpcMain });

        await expect(handlers['p2p:start-device-sync']({}, 'device-1'))
          .rejects.toThrow('设备同步管理器未初始化');
      });

      it('should throw error when sync fails', async () => {
        mockP2PManager.syncManager.startDeviceSync.mockImplementation(() => {
          throw new Error('Start sync failed');
        });

        await expect(handlers['p2p:start-device-sync']({}, 'device-1'))
          .rejects.toThrow('Start sync failed');
      });
    });

    describe('p2p:stop-device-sync', () => {
      it('should stop device sync successfully', async () => {
        const deviceId = 'device-1';

        const result = await handlers['p2p:stop-device-sync']({}, deviceId);

        expect(result).toEqual({ success: true });
        expect(mockP2PManager.syncManager.stopDeviceSync).toHaveBeenCalledWith(deviceId);
      });

      it('should throw error when syncManager is null', async () => {
        handlers = {};

        const managerWithoutSync = { ...mockP2PManager, syncManager: null };
        registerP2PIPC({ p2pManager: managerWithoutSync, ipcMain: mockIpcMain });

        await expect(handlers['p2p:stop-device-sync']({}, 'device-1'))
          .rejects.toThrow('设备同步管理器未初始化');
      });

      it('should throw error when sync stop fails', async () => {
        mockP2PManager.syncManager.stopDeviceSync.mockImplementation(() => {
          throw new Error('Stop sync failed');
        });

        await expect(handlers['p2p:stop-device-sync']({}, 'device-1'))
          .rejects.toThrow('Stop sync failed');
      });
    });
  });

  describe('NAT 穿透 (4 handlers)', () => {
    describe('p2p:detect-nat', () => {
      it('should detect NAT type successfully', async () => {
        const mockNatResult = {
          type: 'full-cone',
          publicIP: '1.2.3.4',
          publicPort: 12345,
        };
        mockP2PManager.natDetector.detectNATType.mockResolvedValue(mockNatResult);

        const result = await handlers['p2p:detect-nat']();

        expect(result).toEqual(mockNatResult);
        expect(mockP2PManager.natDetector.detectNATType).toHaveBeenCalledWith(
          mockP2PManager.p2pConfig.stun.servers
        );
      });

      it('should throw error when natDetector is null', async () => {
        handlers = {};

        const managerWithoutNat = { ...mockP2PManager, natDetector: null };
        registerP2PIPC({ p2pManager: managerWithoutNat, ipcMain: mockIpcMain });

        await expect(handlers['p2p:detect-nat']())
          .rejects.toThrow('P2P管理器未初始化');
      });

      it('should throw error when detection fails', async () => {
        const error = new Error('NAT detection failed');
        mockP2PManager.natDetector.detectNATType.mockRejectedValue(error);

        await expect(handlers['p2p:detect-nat']())
          .rejects.toThrow('NAT detection failed');
      });
    });

    describe('p2p:get-nat-info', () => {
      it('should return NAT info', async () => {
        const result = await handlers['p2p:get-nat-info']();

        expect(result).toEqual({
          type: 'full-cone',
          publicIP: '1.2.3.4',
          publicPort: 12345,
        });
      });

      it('should throw error when manager is null', async () => {
        handlers = {};

        registerP2PIPC({ p2pManager: null, ipcMain: mockIpcMain });

        await expect(handlers['p2p:get-nat-info']())
          .rejects.toThrow('P2P管理器未初始化');
      });
    });

    describe('p2p:get-relay-info', () => {
      it('should return relay connections info', async () => {
        const mockConnections = [
          {
            remotePeer: { toString: () => 'QmRelay1' },
            remoteAddr: { toString: () => '/ip4/1.2.3.4/tcp/4001/p2p-circuit/p2p/QmRelay1' },
            status: 'open',
          },
          {
            remotePeer: { toString: () => 'QmRelay2' },
            remoteAddr: { toString: () => '/ip4/5.6.7.8/tcp/4001/p2p-circuit/p2p/QmRelay2' },
            status: 'open',
          },
        ];
        mockP2PManager.node.getConnections.mockReturnValue(mockConnections);

        const result = await handlers['p2p:get-relay-info']();

        expect(result).toEqual([
          {
            peerId: 'QmRelay1',
            addr: '/ip4/1.2.3.4/tcp/4001/p2p-circuit/p2p/QmRelay1',
            status: 'open',
          },
          {
            peerId: 'QmRelay2',
            addr: '/ip4/5.6.7.8/tcp/4001/p2p-circuit/p2p/QmRelay2',
            status: 'open',
          },
        ]);
      });

      it('should return empty array when no relay connections', async () => {
        const mockConnections = [
          {
            remotePeer: { toString: () => 'QmPeer1' },
            remoteAddr: { toString: () => '/ip4/1.2.3.4/tcp/4001/p2p/QmPeer1' },
            status: 'open',
          },
        ];
        mockP2PManager.node.getConnections.mockReturnValue(mockConnections);

        const result = await handlers['p2p:get-relay-info']();

        expect(result).toEqual([]);
      });

      it('should return empty array when node is null', async () => {
        handlers = {};

        const managerWithoutNode = { ...mockP2PManager, node: null };
        registerP2PIPC({ p2pManager: managerWithoutNode, ipcMain: mockIpcMain });

        const result = await handlers['p2p:get-relay-info']();

        expect(result).toEqual([]);
      });

      it('should throw error when getConnections fails', async () => {
        mockP2PManager.node.getConnections.mockImplementation(() => {
          throw new Error('Get connections failed');
        });

        await expect(handlers['p2p:get-relay-info']())
          .rejects.toThrow('Get connections failed');
      });
    });

    describe('p2p:run-diagnostics', () => {
      it('should run diagnostics successfully', async () => {
        const mockDiagnostics = {
          tcp: { available: true, port: 4001 },
          webrtc: { available: true },
          websockets: { available: true },
          nat: { type: 'full-cone' },
        };
        mockP2PManager.transportDiagnostics.runFullDiagnostics.mockResolvedValue(mockDiagnostics);

        const result = await handlers['p2p:run-diagnostics']();

        expect(result).toEqual(mockDiagnostics);
        expect(mockP2PManager.transportDiagnostics.runFullDiagnostics).toHaveBeenCalled();
      });

      it('should throw error when transportDiagnostics is null', async () => {
        handlers = {};

        const managerWithoutDiagnostics = { ...mockP2PManager, transportDiagnostics: null };
        registerP2PIPC({ p2pManager: managerWithoutDiagnostics, ipcMain: mockIpcMain });

        await expect(handlers['p2p:run-diagnostics']())
          .rejects.toThrow('P2P管理器未初始化');
      });

      it('should throw error when diagnostics fails', async () => {
        const error = new Error('Diagnostics failed');
        mockP2PManager.transportDiagnostics.runFullDiagnostics.mockRejectedValue(error);

        await expect(handlers['p2p:run-diagnostics']())
          .rejects.toThrow('Diagnostics failed');
      });
    });
  });
});
