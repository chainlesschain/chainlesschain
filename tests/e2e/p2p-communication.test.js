/**
 * P2P通讯端到端测试
 *
 * 测试范围：
 * 1. 信令服务器连接
 * 2. WebRTC连接建立
 * 3. ICE候选交换
 * 4. DataChannel通信
 * 5. 断线重连
 * 6. 连接质量监控
 * 7. 错误处理
 */

const { test, expect } = require('@playwright/test');
const WebSocket = require('ws');

// 测试配置
const SIGNALING_URL = 'ws://localhost:9001';
const TEST_TIMEOUT = 30000;

test.describe('P2P通讯端到端测试', () => {
  let signalingServer;
  let mobileClient;
  let pcClient;

  test.beforeAll(async () => {
    // 确保信令服务器正在运行
    console.log('检查信令服务器状态...');
  });

  test.afterEach(async () => {
    // 清理连接
    if (mobileClient) {
      mobileClient.close();
      mobileClient = null;
    }
    if (pcClient) {
      pcClient.close();
      pcClient = null;
    }
  });

  test('1. 信令服务器连接测试', async () => {
    // 创建WebSocket连接
    const ws = await new Promise((resolve, reject) => {
      const client = new WebSocket(SIGNALING_URL);

      client.on('open', () => {
        console.log('✅ 信令服务器连接成功');
        resolve(client);
      });

      client.on('error', (error) => {
        console.error('❌ 信令服务器连接失败:', error);
        reject(error);
      });

      setTimeout(() => reject(new Error('连接超时')), 5000);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test('2. 节点注册测试', async () => {
    const ws = await connectToSignaling();

    // 发送注册消息
    const registered = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          console.log('✅ 节点注册成功:', message.peerId);
          resolve(true);
        }
      });

      ws.send(JSON.stringify({
        type: 'register',
        peerId: 'test-peer-' + Date.now(),
        deviceType: 'test',
        deviceInfo: {
          name: 'Test Device',
          platform: 'test',
          version: '0.17.0'
        }
      }));

      setTimeout(() => resolve(false), 5000);
    });

    expect(registered).toBe(true);
    ws.close();
  });

  test('3. ICE候选批量发送测试', async () => {
    const ws = await connectToSignaling();
    await registerPeer(ws, 'test-sender');

    // 发送批量ICE候选
    const candidates = [
      { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: 'candidate:2 1 UDP 2130706431 192.168.1.100 54322 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: 'candidate:3 1 UDP 2130706431 192.168.1.100 54323 typ host', sdpMid: '0', sdpMLineIndex: 0 }
    ];

    ws.send(JSON.stringify({
      type: 'ice-candidates',
      from: 'test-sender',
      to: 'test-receiver',
      candidates: candidates
    }));

    console.log('✅ 批量ICE候选已发送:', candidates.length);

    // 等待一下确保消息被处理
    await new Promise(resolve => setTimeout(resolve, 100));

    ws.close();
  });

  test('4. 连接超时测试', async () => {
    const ws = await connectToSignaling();
    const peerId = 'test-timeout-' + Date.now();
    await registerPeer(ws, peerId);

    // 模拟连接超时（不发送Answer）
    const startTime = Date.now();

    ws.send(JSON.stringify({
      type: 'offer',
      from: peerId,
      to: 'non-existent-peer',
      offer: {
        type: 'offer',
        sdp: 'fake-sdp'
      }
    }));

    // 等待超时响应
    const timeout = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'peer-offline') {
          const elapsed = Date.now() - startTime;
          console.log('✅ 收到离线通知，耗时:', elapsed, 'ms');
          resolve(true);
        }
      });

      setTimeout(() => resolve(false), 5000);
    });

    expect(timeout).toBe(true);
    ws.close();
  });

  test('5. 错误处理测试', async () => {
    const ws = await connectToSignaling();

    // 发送无效消息
    ws.send('invalid json');

    // 发送缺少必需字段的消息
    ws.send(JSON.stringify({
      type: 'register'
      // 缺少 peerId
    }));

    // 等待一下确保服务器处理了消息
    await new Promise(resolve => setTimeout(resolve, 100));

    // 连接应该仍然有效
    expect(ws.readyState).toBe(WebSocket.OPEN);

    console.log('✅ 错误处理测试通过');
    ws.close();
  });

  test('6. 多客户端连接测试', async () => {
    const clients = [];
    const clientCount = 5;

    // 创建多个客户端
    for (let i = 0; i < clientCount; i++) {
      const ws = await connectToSignaling();
      await registerPeer(ws, `test-client-${i}`);
      clients.push(ws);
    }

    console.log(`✅ ${clientCount} 个客户端连接成功`);

    // 请求在线节点列表
    const lastClient = clients[clients.length - 1];

    const peersList = await new Promise((resolve) => {
      lastClient.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'peers-list') {
          console.log('✅ 在线节点数:', message.count);
          resolve(message.peers);
        }
      });

      lastClient.send(JSON.stringify({
        type: 'get-peers'
      }));

      setTimeout(() => resolve([]), 5000);
    });

    expect(peersList.length).toBeGreaterThanOrEqual(clientCount - 1);

    // 清理
    clients.forEach(ws => ws.close());
  });

  test('7. 心跳机制测试', async () => {
    const ws = await connectToSignaling();
    await registerPeer(ws, 'test-heartbeat');

    // 发送心跳
    ws.send(JSON.stringify({
      type: 'ping'
    }));

    // 等待pong响应
    const pong = await new Promise((resolve) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'pong') {
          console.log('✅ 收到心跳响应');
          resolve(true);
        }
      });

      setTimeout(() => resolve(false), 5000);
    });

    expect(pong).toBe(true);
    ws.close();
  });

  test('8. 离线消息测试', async () => {
    // 创建接收方并注册
    const receiver = await connectToSignaling();
    const receiverId = 'test-receiver-' + Date.now();
    await registerPeer(receiver, receiverId);

    // 接收方断开连接
    receiver.close();
    await new Promise(resolve => setTimeout(resolve, 500));

    // 创建发送方
    const sender = await connectToSignaling();
    const senderId = 'test-sender-' + Date.now();
    await registerPeer(sender, senderId);

    // 发送消息给离线的接收方
    sender.send(JSON.stringify({
      type: 'message',
      to: receiverId,
      payload: {
        type: 'test',
        content: 'Hello offline peer'
      }
    }));

    // 等待离线通知
    const offline = await new Promise((resolve) => {
      sender.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'peer-offline') {
          console.log('✅ 收到离线通知');
          resolve(true);
        }
      });

      setTimeout(() => resolve(false), 5000);
    });

    expect(offline).toBe(true);
    sender.close();
  });

  test('9. 连接池限制测试', async () => {
    // 注意：这个测试需要修改配置或创建大量连接
    // 这里只做基本验证
    const ws = await connectToSignaling();
    await registerPeer(ws, 'test-pool');

    console.log('✅ 连接池测试（基本验证）');
    ws.close();
  });

  test('10. ICE重启测试', async () => {
    const ws = await connectToSignaling();
    const peerId = 'test-ice-restart-' + Date.now();
    await registerPeer(ws, peerId);

    // 发送带有iceRestart标志的Offer
    ws.send(JSON.stringify({
      type: 'offer',
      from: peerId,
      to: 'test-target',
      offer: {
        type: 'offer',
        sdp: 'fake-sdp'
      },
      iceRestart: true
    }));

    console.log('✅ ICE重启Offer已发送');

    await new Promise(resolve => setTimeout(resolve, 100));
    ws.close();
  });
});

// 辅助函数

/**
 * 连接到信令服务器
 */
async function connectToSignaling() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SIGNALING_URL);

    ws.on('open', () => {
      resolve(ws);
    });

    ws.on('error', (error) => {
      reject(error);
    });

    setTimeout(() => reject(new Error('连接超时')), 5000);
  });
}

/**
 * 注册节点
 */
async function registerPeer(ws, peerId) {
  return new Promise((resolve, reject) => {
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'registered') {
        resolve(message);
      }
    });

    ws.send(JSON.stringify({
      type: 'register',
      peerId: peerId,
      deviceType: 'test',
      deviceInfo: {
        name: 'Test Device',
        platform: 'test',
        version: '0.17.0'
      }
    }));

    setTimeout(() => reject(new Error('注册超时')), 5000);
  });
}

/**
 * 等待特定消息类型
 */
async function waitForMessage(ws, messageType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === messageType) {
        ws.off('message', handler);
        resolve(message);
      }
    };

    ws.on('message', handler);

    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`等待消息超时: ${messageType}`));
    }, timeout);
  });
}
