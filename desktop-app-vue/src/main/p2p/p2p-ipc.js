/**
 * P2P IPC 处理器
 * 负责处理 P2P 网络通信相关的前后端通信
 *
 * @module p2p-ipc
 * @description 提供 P2P 节点管理、加密消息、多设备支持、设备同步、NAT穿透等 IPC 接口
 */

/**
 * 注册所有 P2P IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.p2pManager - P2P 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 */
function registerP2PIPC({ p2pManager, ipcMain: injectedIpcMain }) {
  // 支持依赖注入，用于测试
  const ipcMain = injectedIpcMain || require('electron').ipcMain;

  console.log('[P2P IPC] Registering P2P IPC handlers...');

  // ============================================================
  // P2P 基础操作 (Basic Operations)
  // ============================================================

  /**
   * 获取节点信息
   * Channel: 'p2p:get-node-info'
   */
  ipcMain.handle('p2p:get-node-info', async () => {
    try {
      if (!p2pManager || !p2pManager.initialized) {
        return null;
      }

      return p2pManager.getNodeInfo();
    } catch (error) {
      console.error('[P2P IPC] 获取节点信息失败:', error);
      return null;
    }
  });

  /**
   * 连接到对等节点
   * Channel: 'p2p:connect'
   */
  ipcMain.handle('p2p:connect', async (_event, multiaddr) => {
    try {
      if (!p2pManager) {
        throw new Error('P2P管理器未初始化');
      }

      return await p2pManager.connectToPeer(multiaddr);
    } catch (error) {
      console.error('[P2P IPC] 连接对等节点失败:', error);
      throw error;
    }
  });

  /**
   * 断开对等节点连接
   * Channel: 'p2p:disconnect'
   */
  ipcMain.handle('p2p:disconnect', async (_event, peerId) => {
    try {
      if (!p2pManager) {
        throw new Error('P2P管理器未初始化');
      }

      return await p2pManager.disconnectFromPeer(peerId);
    } catch (error) {
      console.error('[P2P IPC] 断开对等节点失败:', error);
      throw error;
    }
  });

  /**
   * 获取已连接的对等节点列表
   * Channel: 'p2p:get-peers'
   */
  ipcMain.handle('p2p:get-peers', async () => {
    try {
      if (!p2pManager) {
        return [];
      }

      return p2pManager.getConnectedPeers();
    } catch (error) {
      console.error('[P2P IPC] 获取对等节点列表失败:', error);
      return [];
    }
  });

  // ============================================================
  // P2P 加密消息 (Encrypted Messaging)
  // ============================================================

  /**
   * 发送加密消息
   * Channel: 'p2p:send-encrypted-message'
   */
  ipcMain.handle('p2p:send-encrypted-message', async (_event, peerId, message, deviceId, options) => {
    try {
      if (!p2pManager) {
        throw new Error('P2P管理器未初始化');
      }

      return await p2pManager.sendEncryptedMessage(peerId, message, deviceId, options);
    } catch (error) {
      console.error('[P2P IPC] 发送加密消息失败:', error);
      throw error;
    }
  });

  /**
   * 检查是否存在加密会话
   * Channel: 'p2p:has-encrypted-session'
   */
  ipcMain.handle('p2p:has-encrypted-session', async (_event, peerId) => {
    try {
      if (!p2pManager) {
        return false;
      }

      return await p2pManager.hasEncryptedSession(peerId);
    } catch (error) {
      console.error('[P2P IPC] 检查加密会话失败:', error);
      return false;
    }
  });

  /**
   * 发起密钥交换
   * Channel: 'p2p:initiate-key-exchange'
   */
  ipcMain.handle('p2p:initiate-key-exchange', async (_event, peerId, deviceId) => {
    try {
      if (!p2pManager) {
        throw new Error('P2P管理器未初始化');
      }

      return await p2pManager.initiateKeyExchange(peerId, deviceId);
    } catch (error) {
      console.error('[P2P IPC] 密钥交换失败:', error);
      throw error;
    }
  });

  // ============================================================
  // P2P 多设备支持 (Multi-Device Support)
  // ============================================================

  /**
   * 获取用户的所有设备列表
   * Channel: 'p2p:get-user-devices'
   */
  ipcMain.handle('p2p:get-user-devices', async (_event, userId) => {
    try {
      if (!p2pManager) {
        return [];
      }

      return p2pManager.getUserDevices(userId);
    } catch (error) {
      console.error('[P2P IPC] 获取用户设备列表失败:', error);
      return [];
    }
  });

  /**
   * 获取当前设备信息
   * Channel: 'p2p:get-current-device'
   */
  ipcMain.handle('p2p:get-current-device', async () => {
    try {
      if (!p2pManager) {
        return null;
      }

      return p2pManager.getCurrentDevice();
    } catch (error) {
      console.error('[P2P IPC] 获取当前设备失败:', error);
      return null;
    }
  });

  /**
   * 获取设备统计信息
   * Channel: 'p2p:get-device-statistics'
   */
  ipcMain.handle('p2p:get-device-statistics', async () => {
    try {
      if (!p2pManager) {
        return {
          userCount: 0,
          totalDevices: 0,
          currentDevice: null,
        };
      }

      return p2pManager.getDeviceStatistics();
    } catch (error) {
      console.error('[P2P IPC] 获取设备统计失败:', error);
      return {
        userCount: 0,
        totalDevices: 0,
        currentDevice: null,
      };
    }
  });

  // ============================================================
  // P2P 设备同步 (Device Synchronization)
  // ============================================================

  /**
   * 获取同步统计信息
   * Channel: 'p2p:get-sync-statistics'
   */
  ipcMain.handle('p2p:get-sync-statistics', async () => {
    try {
      if (!p2pManager || !p2pManager.syncManager) {
        return {
          totalMessages: 0,
          deviceCount: 0,
          deviceQueues: {},
          statusCount: 0,
          activeSyncs: 0,
        };
      }

      return p2pManager.syncManager.getStatistics();
    } catch (error) {
      console.error('[P2P IPC] 获取同步统计失败:', error);
      return {
        totalMessages: 0,
        deviceCount: 0,
        deviceQueues: {},
        statusCount: 0,
        activeSyncs: 0,
      };
    }
  });

  /**
   * 获取消息状态
   * Channel: 'p2p:get-message-status'
   */
  ipcMain.handle('p2p:get-message-status', async (_event, messageId) => {
    try {
      if (!p2pManager || !p2pManager.syncManager) {
        return null;
      }

      return p2pManager.syncManager.messageStatus.get(messageId) || null;
    } catch (error) {
      console.error('[P2P IPC] 获取消息状态失败:', error);
      return null;
    }
  });

  /**
   * 启动设备同步
   * Channel: 'p2p:start-device-sync'
   */
  ipcMain.handle('p2p:start-device-sync', async (_event, deviceId) => {
    try {
      if (!p2pManager || !p2pManager.syncManager) {
        throw new Error('设备同步管理器未初始化');
      }

      p2pManager.syncManager.startDeviceSync(deviceId);
      return { success: true };
    } catch (error) {
      console.error('[P2P IPC] 启动设备同步失败:', error);
      throw error;
    }
  });

  /**
   * 停止设备同步
   * Channel: 'p2p:stop-device-sync'
   */
  ipcMain.handle('p2p:stop-device-sync', async (_event, deviceId) => {
    try {
      if (!p2pManager || !p2pManager.syncManager) {
        throw new Error('设备同步管理器未初始化');
      }

      p2pManager.syncManager.stopDeviceSync(deviceId);
      return { success: true };
    } catch (error) {
      console.error('[P2P IPC] 停止设备同步失败:', error);
      throw error;
    }
  });

  // ============================================================
  // NAT 穿透 (NAT Traversal)
  // ============================================================

  /**
   * 检测 NAT 类型
   * Channel: 'p2p:detect-nat'
   */
  ipcMain.handle('p2p:detect-nat', async () => {
    try {
      if (!p2pManager || !p2pManager.natDetector) {
        throw new Error('P2P管理器未初始化');
      }
      return await p2pManager.natDetector.detectNATType(
        p2pManager.p2pConfig.stun.servers
      );
    } catch (error) {
      console.error('[P2P IPC] NAT检测失败:', error);
      throw error;
    }
  });

  /**
   * 获取 NAT 信息
   * Channel: 'p2p:get-nat-info'
   */
  ipcMain.handle('p2p:get-nat-info', async () => {
    try {
      if (!p2pManager) {
        throw new Error('P2P管理器未初始化');
      }
      return p2pManager.natInfo;
    } catch (error) {
      console.error('[P2P IPC] 获取NAT信息失败:', error);
      throw error;
    }
  });

  /**
   * 获取中继信息
   * Channel: 'p2p:get-relay-info'
   */
  ipcMain.handle('p2p:get-relay-info', async () => {
    try {
      if (!p2pManager || !p2pManager.node) {
        return [];
      }

      const connections = p2pManager.node.getConnections();
      const relays = connections.filter(conn =>
        conn.remoteAddr.toString().includes('/p2p-circuit')
      );

      return relays.map(relay => ({
        peerId: relay.remotePeer.toString(),
        addr: relay.remoteAddr.toString(),
        status: relay.status,
      }));
    } catch (error) {
      console.error('[P2P IPC] 获取中继信息失败:', error);
      throw error;
    }
  });

  /**
   * 运行网络诊断
   * Channel: 'p2p:run-diagnostics'
   */
  ipcMain.handle('p2p:run-diagnostics', async () => {
    try {
      if (!p2pManager || !p2pManager.transportDiagnostics) {
        throw new Error('P2P管理器未初始化');
      }
      return await p2pManager.transportDiagnostics.runFullDiagnostics();
    } catch (error) {
      console.error('[P2P IPC] 运行诊断失败:', error);
      throw error;
    }
  });

  // ============================================================
  // WebRTC 质量监控 (WebRTC Quality Monitoring)
  // ============================================================

  /**
   * 获取WebRTC连接质量报告
   * Channel: 'p2p:get-webrtc-quality-report'
   * @param {string} peerId - 对等节点ID（可选，不传则返回所有连接的报告）
   */
  ipcMain.handle('p2p:get-webrtc-quality-report', async (_event, peerId) => {
    try {
      if (!p2pManager) {
        return null;
      }

      return p2pManager.getWebRTCQualityReport(peerId);
    } catch (error) {
      console.error('[P2P IPC] 获取WebRTC质量报告失败:', error);
      return null;
    }
  });

  /**
   * 获取WebRTC优化建议
   * Channel: 'p2p:get-webrtc-optimization-suggestions'
   * @param {string} peerId - 对等节点ID
   */
  ipcMain.handle('p2p:get-webrtc-optimization-suggestions', async (_event, peerId) => {
    try {
      if (!p2pManager) {
        return [];
      }

      return p2pManager.getWebRTCOptimizationSuggestions(peerId);
    } catch (error) {
      console.error('[P2P IPC] 获取WebRTC优化建议失败:', error);
      return [];
    }
  });

  /**
   * 获取连接池统计信息
   * Channel: 'p2p:get-connection-pool-stats'
   */
  ipcMain.handle('p2p:get-connection-pool-stats', async () => {
    try {
      if (!p2pManager) {
        return null;
      }

      return p2pManager.getConnectionPoolStats();
    } catch (error) {
      console.error('[P2P IPC] 获取连接池统计失败:', error);
      return null;
    }
  });

  console.log('[P2P IPC] ✓ All P2P IPC handlers registered successfully (21 handlers)');
}

module.exports = {
  registerP2PIPC
};
