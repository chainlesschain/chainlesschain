/**
 * 信令服务器单元测试
 *
 * 测试框架: Jest
 */

const SignalingServer = require('../signaling-server/index');
const WebSocket = require('ws');

describe('SignalingServer', () => {
  let server;
  let serverInstance;

  beforeAll(() => {
    // 创建测试服务器实例
    serverInstance = new SignalingServer({ port: 9101, healthPort: 9102 });
    serverInstance.start();
  });

  afterAll(() => {
    // 关闭服务器
    if (serverInstance) {
      serverInstance.stop();
    }
  });

  describe('节点注册', () => {
    test('应该成功注册新节点', (done) => {
      const ws = new WebSocket('ws://localhost:9101');

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'register',
          peerId: 'test-peer-001',
          deviceType: 'desktop'
        }));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          expect(message.peerId).toBe('test-peer-001');
          ws.close();
          done();
        }
      });

      ws.on('error', done);
    });

    test('应该拒绝没有peerId的注册', (done) => {
      const ws = new WebSocket('ws://localhost:9101');

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'register',
          deviceType: 'desktop'
        }));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'error') {
          expect(message.error).toContain('peerId');
          ws.close();
          done();
        }
      });

      ws.on('error', done);
    });

    test('应该处理重复注册（替换旧连接）', (done) => {
      const ws1 = new WebSocket('ws://localhost:9101');
      let ws1Registered = false;

      ws1.on('open', () => {
        ws1.send(JSON.stringify({
          type: 'register',
          peerId: 'test-peer-duplicate',
          deviceType: 'desktop'
        }));
      });

      ws1.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered' && !ws1Registered) {
          ws1Registered = true;

          // 创建第二个连接使用相同peerId
          const ws2 = new WebSocket('ws://localhost:9101');

          ws2.on('open', () => {
            ws2.send(JSON.stringify({
              type: 'register',
              peerId: 'test-peer-duplicate',
              deviceType: 'mobile'
            }));
          });

          ws2.on('message', (data2) => {
            const message2 = JSON.parse(data2.toString());
            if (message2.type === 'registered') {
              // 第二个连接应该成功注册
              expect(message2.peerId).toBe('test-peer-duplicate');
              ws2.close();
              done();
            }
          });
        }
      });

      ws1.on('close', () => {
        // 第一个连接应该被关闭
      });

      ws1.on('error', done);
    });
  });

  describe('消息转发', () => {
    test('应该成功转发消息给在线节点', (done) => {
      const sender = new WebSocket('ws://localhost:9101');
      const receiver = new WebSocket('ws://localhost:9101');

      let senderReady = false;
      let receiverReady = false;

      sender.on('open', () => {
        sender.send(JSON.stringify({
          type: 'register',
          peerId: 'test-sender',
          deviceType: 'desktop'
        }));
      });

      sender.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          senderReady = true;
          if (receiverReady) {
            // 发送测试消息
            sender.send(JSON.stringify({
              type: 'message',
              to: 'test-receiver',
              payload: { test: 'Hello!' }
            }));
          }
        }
      });

      receiver.on('open', () => {
        receiver.send(JSON.stringify({
          type: 'register',
          peerId: 'test-receiver',
          deviceType: 'desktop'
        }));
      });

      receiver.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          receiverReady = true;
          if (senderReady) {
            sender.send(JSON.stringify({
              type: 'message',
              to: 'test-receiver',
              payload: { test: 'Hello!' }
            }));
          }
        } else if (message.type === 'message') {
          expect(message.from).toBe('test-sender');
          expect(message.payload.test).toBe('Hello!');
          sender.close();
          receiver.close();
          done();
        }
      });

      sender.on('error', done);
      receiver.on('error', done);
    });

    test('应该暂存消息给离线节点', (done) => {
      const sender = new WebSocket('ws://localhost:9101');

      sender.on('open', () => {
        sender.send(JSON.stringify({
          type: 'register',
          peerId: 'test-sender-offline',
          deviceType: 'desktop'
        }));
      });

      sender.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          // 发送消息给离线节点
          sender.send(JSON.stringify({
            type: 'message',
            to: 'test-offline-node',
            payload: { test: 'Offline message' }
          }));
        } else if (message.type === 'peer-offline') {
          // 应该收到离线通知
          expect(message.peerId).toBe('test-offline-node');
          sender.close();
          done();
        }
      });

      sender.on('error', done);
    });
  });

  describe('WebRTC信令', () => {
    test('应该转发Offer消息', (done) => {
      const caller = new WebSocket('ws://localhost:9101');
      const callee = new WebSocket('ws://localhost:9101');

      let callerReady = false;
      let calleeReady = false;

      caller.on('open', () => {
        caller.send(JSON.stringify({
          type: 'register',
          peerId: 'test-caller',
          deviceType: 'desktop'
        }));
      });

      caller.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          callerReady = true;
          if (calleeReady) {
            caller.send(JSON.stringify({
              type: 'offer',
              to: 'test-callee',
              sdp: { type: 'offer', sdp: 'mock-sdp' }
            }));
          }
        }
      });

      callee.on('open', () => {
        callee.send(JSON.stringify({
          type: 'register',
          peerId: 'test-callee',
          deviceType: 'desktop'
        }));
      });

      callee.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered') {
          calleeReady = true;
          if (callerReady) {
            caller.send(JSON.stringify({
              type: 'offer',
              to: 'test-callee',
              sdp: { type: 'offer', sdp: 'mock-sdp' }
            }));
          }
        } else if (message.type === 'offer') {
          expect(message.from).toBe('test-caller');
          expect(message.sdp.type).toBe('offer');
          caller.close();
          callee.close();
          done();
        }
      });

      caller.on('error', done);
      callee.on('error', done);
    });

    test('应该转发Answer消息', (done) => {
      const caller = new WebSocket('ws://localhost:9101');
      const callee = new WebSocket('ws://localhost:9101');

      let offerSent = false;

      caller.on('open', () => {
        caller.send(JSON.stringify({
          type: 'register',
          peerId: 'test-caller-answer',
          deviceType: 'desktop'
        }));
      });

      caller.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'registered' && !offerSent) {
          // 等待callee注册
          setTimeout(() => {
            caller.send(JSON.stringify({
              type: 'offer',
              to: 'test-callee-answer',
              sdp: { type: 'offer', sdp: 'mock-sdp' }
            }));
            offerSent = true;
          }, 500);
        } else if (message.type === 'answer') {
          expect(message.from).toBe('test-callee-answer');
          expect(message.sdp.type).toBe('answer');
          caller.close();
          callee.close();
          done();
        }
      });

      callee.on('open', () => {
        callee.send(JSON.stringify({
          type: 'register',
          peerId: 'test-callee-answer',
          deviceType: 'desktop'
        }));
      });

      callee.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'offer') {
          // 发送Answer
          callee.send(JSON.stringify({
            type: 'answer',
            to: 'test-caller-answer',
            sdp: { type: 'answer', sdp: 'mock-sdp-answer' }
          }));
        }
      });

      caller.on('error', done);
      callee.on('error', done);
    });
  });

  describe('健康检查', () => {
    test('应该返回健康状态', async () => {
      const http = require('http');

      const response = await new Promise((resolve, reject) => {
        http.get('http://localhost:9102/health', (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
      });

      expect(response.status).toBe(200);

      const health = JSON.parse(response.data);
      expect(health.status).toBe('healthy');
      expect(health.service).toBe('signaling-server');
      expect(health.connections).toBeDefined();
    });

    test('应该返回统计信息', async () => {
      const http = require('http');

      const response = await new Promise((resolve, reject) => {
        http.get('http://localhost:9102/stats', (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
      });

      expect(response.status).toBe(200);

      const stats = JSON.parse(response.data);
      expect(stats.totalConnections).toBeGreaterThanOrEqual(0);
      expect(stats.currentConnections).toBeGreaterThanOrEqual(0);
    });
  });
});
