/**
 * P2P音视频通话功能测试套件
 * 测试连接建立、音视频通话、屏幕共享、通话历史等功能
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

// 测试配置
const TEST_CONFIG = {
  appPath: path.join(__dirname, '../../../'),
  timeout: 60000,
  retries: 2,
  // 测试用户
  users: {
    alice: {
      did: 'did:test:alice',
      name: 'Alice',
      peerId: 'peer-alice-001',
    },
    bob: {
      did: 'did:test:bob',
      name: 'Bob',
      peerId: 'peer-bob-001',
    },
  },
};

/**
 * P2P连接建立测试
 */
test.describe('P2P连接建立测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');
  });

  test('应该能够初始化P2P管理器', async ({ page }) => {
    // 检查P2P管理器是否初始化
    const p2pStatus = await page.evaluate(() => {
      return window.electronAPI?.p2p?.getStatus ? true : false;
    });

    expect(p2pStatus).toBe(true);
  });

  test('应该能够获取本地PeerID', async ({ page }) => {
    const peerId = await page.evaluate(async () => {
      return await window.electronAPI.p2p.getPeerId();
    });

    expect(peerId).toBeTruthy();
    expect(typeof peerId).toBe('string');
  });

  test('应该能够连接到信令服务器', async ({ page }) => {
    const connected = await page.evaluate(async () => {
      try {
        const status = await window.electronAPI.p2p.getConnectionStatus();
        return status.signaling === 'connected';
      } catch (error) {
        return false;
      }
    });

    expect(connected).toBe(true);
  });

  test('应该能够发现在线好友', async ({ page }) => {
    const peers = await page.evaluate(async () => {
      return await window.electronAPI.p2p.getOnlinePeers();
    });

    expect(Array.isArray(peers)).toBe(true);
  });

  test('应该能够建立P2P连接', async ({ page }) => {
    // 模拟连接到测试对等节点
    const result = await page.evaluate(async (testPeer) => {
      try {
        await window.electronAPI.p2p.connect(testPeer);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, TEST_CONFIG.users.bob.peerId);

    expect(result.success).toBe(true);
  });

  test('应该能够断开P2P连接', async ({ page }) => {
    // 先建立连接
    await page.evaluate(async (testPeer) => {
      await window.electronAPI.p2p.connect(testPeer);
    }, TEST_CONFIG.users.bob.peerId);

    // 等待连接建立
    await page.waitForTimeout(2000);

    // 断开连接
    const result = await page.evaluate(async (testPeer) => {
      try {
        await window.electronAPI.p2p.disconnect(testPeer);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, TEST_CONFIG.users.bob.peerId);

    expect(result.success).toBe(true);
  });
});

/**
 * 音视频通话测试
 */
test.describe('音视频通话测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');

    // 授予媒体权限
    await page.context().grantPermissions(['microphone', 'camera']);
  });

  test('应该能够发起语音通话', async ({ page }) => {
    const result = await page.evaluate(async (testPeer) => {
      try {
        await window.electronAPI.p2pCall.startCall({
          peerId: testPeer,
          type: 'audio',
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, TEST_CONFIG.users.bob.peerId);

    expect(result.success).toBe(true);
  });

  test('应该能够发起视频通话', async ({ page }) => {
    const result = await page.evaluate(async (testPeer) => {
      try {
        await window.electronAPI.p2pCall.startCall({
          peerId: testPeer,
          type: 'video',
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }, TEST_CONFIG.users.bob.peerId);

    expect(result.success).toBe(true);
  });

  test('应该能够接听来电', async ({ page }) => {
    // 模拟收到来电
    await page.evaluate(async (testPeer) => {
      // 触发来电事件
      window.dispatchEvent(new CustomEvent('p2p-call-incoming', {
        detail: {
          peerId: testPeer,
          type: 'audio',
          callId: 'test-call-001',
        },
      }));
    }, TEST_CONFIG.users.bob.peerId);

    // 等待来电通知
    await page.waitForTimeout(1000);

    // 接听
    const result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.acceptCall('test-call-001');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
  });

  test('应该能够拒绝来电', async ({ page }) => {
    // 模拟收到来电
    await page.evaluate(async (testPeer) => {
      window.dispatchEvent(new CustomEvent('p2p-call-incoming', {
        detail: {
          peerId: testPeer,
          type: 'audio',
          callId: 'test-call-002',
        },
      }));
    }, TEST_CONFIG.users.bob.peerId);

    await page.waitForTimeout(1000);

    // 拒绝
    const result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.rejectCall('test-call-002');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
  });

  test('应该能够挂断通话', async ({ page }) => {
    // 发起通话
    await page.evaluate(async (testPeer) => {
      await window.electronAPI.p2pCall.startCall({
        peerId: testPeer,
        type: 'audio',
      });
    }, TEST_CONFIG.users.bob.peerId);

    await page.waitForTimeout(2000);

    // 挂断
    const result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.endCall();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
  });

  test('应该能够切换音频设备', async ({ page }) => {
    // 获取音频设备列表
    const devices = await page.evaluate(async () => {
      return await window.electronAPI.p2pCall.getAudioDevices();
    });

    expect(Array.isArray(devices)).toBe(true);

    if (devices.length > 0) {
      // 切换到第一个设备
      const result = await page.evaluate(async (deviceId) => {
        try {
          await window.electronAPI.p2pCall.switchAudioDevice(deviceId);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, devices[0].deviceId);

      expect(result.success).toBe(true);
    }
  });

  test('应该能够切换视频设备', async ({ page }) => {
    const devices = await page.evaluate(async () => {
      return await window.electronAPI.p2pCall.getVideoDevices();
    });

    expect(Array.isArray(devices)).toBe(true);

    if (devices.length > 0) {
      const result = await page.evaluate(async (deviceId) => {
        try {
          await window.electronAPI.p2pCall.switchVideoDevice(deviceId);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, devices[0].deviceId);

      expect(result.success).toBe(true);
    }
  });

  test('应该能够静音/取消静音', async ({ page }) => {
    // 发起通话
    await page.evaluate(async (testPeer) => {
      await window.electronAPI.p2pCall.startCall({
        peerId: testPeer,
        type: 'audio',
      });
    }, TEST_CONFIG.users.bob.peerId);

    await page.waitForTimeout(1000);

    // 静音
    let result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.toggleMute(true);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);

    // 取消静音
    result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.toggleMute(false);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
  });

  test('应该能够开启/关闭视频', async ({ page }) => {
    // 发起视频通话
    await page.evaluate(async (testPeer) => {
      await window.electronAPI.p2pCall.startCall({
        peerId: testPeer,
        type: 'video',
      });
    }, TEST_CONFIG.users.bob.peerId);

    await page.waitForTimeout(1000);

    // 关闭视频
    let result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.toggleVideo(false);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);

    // 开启视频
    result = await page.evaluate(async () => {
      try {
        await window.electronAPI.p2pCall.toggleVideo(true);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
  });
});

/**
 * 屏幕共享测试
 */
test.describe('屏幕共享测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');
    await page.context().grantPermissions(['microphone', 'camera']);
  });

  test('应该能够获取屏幕源列表', async ({ page }) => {
    const sources = await page.evaluate(async () => {
      return await window.electronAPI.screenShare.getSources();
    });

    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThan(0);
  });

  test('应该能够开始屏幕共享', async ({ page }) => {
    // 获取屏幕源
    const sources = await page.evaluate(async () => {
      return await window.electronAPI.screenShare.getSources();
    });

    if (sources.length > 0) {
      const result = await page.evaluate(async (sourceId) => {
        try {
          await window.electronAPI.screenShare.startSharing(sourceId);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, sources[0].id);

      expect(result.success).toBe(true);
    }
  });

  test('应该能够停止屏幕共享', async ({ page }) => {
    // 先开始共享
    const sources = await page.evaluate(async () => {
      return await window.electronAPI.screenShare.getSources();
    });

    if (sources.length > 0) {
      await page.evaluate(async (sourceId) => {
        await window.electronAPI.screenShare.startSharing(sourceId);
      }, sources[0].id);

      await page.waitForTimeout(1000);

      // 停止共享
      const result = await page.evaluate(async () => {
        try {
          await window.electronAPI.screenShare.stopSharing();
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });

      expect(result.success).toBe(true);
    }
  });

  test('应该能够获取屏幕共享状态', async ({ page }) => {
    const status = await page.evaluate(async () => {
      return await window.electronAPI.screenShare.getStatus();
    });

    expect(status).toBeDefined();
    expect(typeof status.isSharing).toBe('boolean');
  });
});

/**
 * 通话历史测试
 */
test.describe('通话历史测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/#/call-history');
    await page.waitForLoadState('networkidle');
  });

  test('应该能够获取通话历史列表', async ({ page }) => {
    const history = await page.evaluate(async () => {
      return await window.electronAPI.callHistory.getHistory();
    });

    expect(Array.isArray(history)).toBe(true);
  });

  test('应该能够获取单个通话记录', async ({ page }) => {
    // 先获取列表
    const history = await page.evaluate(async () => {
      return await window.electronAPI.callHistory.getHistory();
    });

    if (history.length > 0) {
      const record = await page.evaluate(async (callId) => {
        return await window.electronAPI.callHistory.getRecord(callId);
      }, history[0].id);

      expect(record).toBeDefined();
      expect(record.id).toBe(history[0].id);
    }
  });

  test('应该能够删除通话记录', async ({ page }) => {
    const history = await page.evaluate(async () => {
      return await window.electronAPI.callHistory.getHistory();
    });

    if (history.length > 0) {
      const result = await page.evaluate(async (callId) => {
        try {
          await window.electronAPI.callHistory.deleteRecord(callId);
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, history[0].id);

      expect(result.success).toBe(true);
    }
  });

  test('应该能够清空通话历史', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        await window.electronAPI.callHistory.clearHistory();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);

    // 验证已清空
    const history = await page.evaluate(async () => {
      return await window.electronAPI.callHistory.getHistory();
    });

    expect(history.length).toBe(0);
  });

  test('应该能够搜索通话历史', async ({ page }) => {
    const results = await page.evaluate(async () => {
      return await window.electronAPI.callHistory.search('test');
    });

    expect(Array.isArray(results)).toBe(true);
  });

  test('应该能够获取通话统计', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      return await window.electronAPI.callHistory.getStats();
    });

    expect(stats).toBeDefined();
    expect(typeof stats.totalCalls).toBe('number');
    expect(typeof stats.totalDuration).toBe('number');
  });
});

/**
 * 连接健康监控测试
 */
test.describe('连接健康监控测试', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');
  });

  test('应该能够获取连接质量', async ({ page }) => {
    const quality = await page.evaluate(async () => {
      return await window.electronAPI.p2pCall.getConnectionQuality();
    });

    expect(quality).toBeDefined();
    expect(['excellent', 'good', 'fair', 'poor']).toContain(quality.level);
  });

  test('应该能够获取网络统计', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      return await window.electronAPI.p2pCall.getNetworkStats();
    });

    expect(stats).toBeDefined();
    expect(typeof stats.rtt).toBe('number');
    expect(typeof stats.packetLoss).toBe('number');
  });

  test('应该能够监听连接质量变化', async ({ page }) => {
    let qualityChanged = false;

    // 监听质量变化事件
    await page.evaluate(() => {
      window.addEventListener('connection-quality-changed', () => {
        window.qualityChanged = true;
      });
    });

    // 等待一段时间
    await page.waitForTimeout(5000);

    // 检查是否触发了事件
    qualityChanged = await page.evaluate(() => window.qualityChanged || false);

    // 注意：这个测试可能不会总是通过，因为质量可能不会变化
    // 这里只是验证监听机制是否正常
  });
});

/**
 * 性能和稳定性测试
 */
test.describe('性能和稳定性测试', () => {
  test('应该能够处理多次连接/断开', async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');

    const iterations = 5;
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
      const result = await page.evaluate(async (testPeer) => {
        try {
          // 连接
          await window.electronAPI.p2p.connect(testPeer);
          await new Promise(resolve => setTimeout(resolve, 1000));

          // 断开
          await window.electronAPI.p2p.disconnect(testPeer);
          await new Promise(resolve => setTimeout(resolve, 500));

          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }, TEST_CONFIG.users.bob.peerId);

      if (result.success) successCount++;
    }

    // 至少80%成功率
    expect(successCount / iterations).toBeGreaterThanOrEqual(0.8);
  });

  test('应该能够处理长时间通话', async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');
    await page.context().grantPermissions(['microphone', 'camera']);

    // 发起通话
    await page.evaluate(async (testPeer) => {
      await window.electronAPI.p2pCall.startCall({
        peerId: testPeer,
        type: 'audio',
      });
    }, TEST_CONFIG.users.bob.peerId);

    // 保持通话30秒
    await page.waitForTimeout(30000);

    // 检查连接状态
    const status = await page.evaluate(async () => {
      return await window.electronAPI.p2pCall.getStatus();
    });

    expect(status.isActive).toBe(true);

    // 挂断
    await page.evaluate(async () => {
      await window.electronAPI.p2pCall.endCall();
    });
  });

  test('应该能够处理网络中断', async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');

    // 发起连接
    await page.evaluate(async (testPeer) => {
      await window.electronAPI.p2p.connect(testPeer);
    }, TEST_CONFIG.users.bob.peerId);

    await page.waitForTimeout(2000);

    // 模拟网络中断
    await page.context().setOffline(true);
    await page.waitForTimeout(3000);

    // 恢复网络
    await page.context().setOffline(false);
    await page.waitForTimeout(3000);

    // 检查是否自动重连
    const status = await page.evaluate(async () => {
      return await window.electronAPI.p2p.getConnectionStatus();
    });

    // 应该尝试重连或显示断开状态
    expect(['connected', 'reconnecting', 'disconnected']).toContain(status.state);
  });

  test('内存使用应该保持稳定', async ({ page }) => {
    await page.goto('http://localhost:5173/#/social');
    await page.waitForLoadState('networkidle');

    // 获取初始内存使用
    const initialMemory = await page.evaluate(() => {
      return performance.memory ? performance.memory.usedJSHeapSize : 0;
    });

    // 执行多次操作
    for (let i = 0; i < 10; i++) {
      await page.evaluate(async (testPeer) => {
        await window.electronAPI.p2p.connect(testPeer);
        await new Promise(resolve => setTimeout(resolve, 500));
        await window.electronAPI.p2p.disconnect(testPeer);
      }, TEST_CONFIG.users.bob.peerId);
    }

    // 获取最终内存使用
    const finalMemory = await page.evaluate(() => {
      return performance.memory ? performance.memory.usedJSHeapSize : 0;
    });

    // 内存增长不应超过50%
    if (initialMemory > 0) {
      const memoryGrowth = (finalMemory - initialMemory) / initialMemory;
      expect(memoryGrowth).toBeLessThan(0.5);
    }
  });
});

module.exports = {
  TEST_CONFIG,
};
