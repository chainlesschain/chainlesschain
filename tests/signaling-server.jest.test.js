/**
 * 信令服务器单元测试
 *
 * 测试框架: Jest
 */

const { EventEmitter } = require('events');
const { URL } = require('url');

function createMockWebSocketModule() {
  const servers = new Map();

  class MockServerSocket extends EventEmitter {
    constructor(client, server) {
      super();
      this.client = client;
      this.server = server;
      this.isAlive = true;
      this.readyState = MockWebSocket.OPEN;
      this.peerId = null;
      this.connectionId = null;
    }

    send(data) {
      if (!this.client) return;
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
      setImmediate(() => this.client.emit('message', payload));
    }

    _receiveFromClient(data) {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
      setImmediate(() => this.emit('message', payload));
    }

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
      this.server.clients.delete(this);
      if (this.client) {
        const client = this.client;
        this.client = null;
        client._handleServerClose();
      }
    }

    terminate() {
      this.close();
    }

    ping() {
      setImmediate(() => this.emit('pong'));
    }
  }

  class MockWebSocketServer extends EventEmitter {
    constructor(options = {}) {
      super();
      this.port = options.port || 0;
      this.clients = new Set();
      servers.set(this.port, this);
    }

    _attach(serverSocket) {
      this.clients.add(serverSocket);
      const req = { socket: { remoteAddress: 'mock-address' } };
      this.emit('connection', serverSocket, req);
      serverSocket.on('close', () => this.clients.delete(serverSocket));
    }

    close(cb) {
      servers.delete(this.port);
      Array.from(this.clients).forEach((client) => client.close());
      cb && cb();
      this.emit('close');
    }
  }

  class MockWebSocket extends EventEmitter {
    constructor(address) {
      super();
      this.readyState = MockWebSocket.CONNECTING;
      this.isAlive = true;
      this.serverSocket = null;

      try {
        const parsed = new URL(address);
        const port = Number(parsed.port) || 80;
        const server = servers.get(port);

        if (!server) {
          const available = Array.from(servers.keys()).join(', ');
          throw new Error(`No WebSocket server listening on port ${port}. Available: ${available}`);
        }

        this.serverSocket = new MockServerSocket(this, server);
        server._attach(this.serverSocket);

        setImmediate(() => {
          this.readyState = MockWebSocket.OPEN;
          this.emit('open');
        });
      } catch (error) {
        setImmediate(() => this.emit('error', error));
      }
    }

    send(data) {
      if (!this.serverSocket) return;
      this.serverSocket._receiveFromClient(data);
    }

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
      if (this.serverSocket && this.serverSocket.readyState !== MockWebSocket.CLOSED) {
        const socket = this.serverSocket;
        this.serverSocket = null;
        socket.close();
      }
    }

    _handleServerClose() {
      this.serverSocket = null;
      if (this.readyState !== MockWebSocket.CLOSED) {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close');
      }
    }
  }

  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;
  MockWebSocket.Server = MockWebSocketServer;
  MockWebSocket.__reset = () => servers.clear();
  MockWebSocket.__getServerPorts = () => Array.from(servers.keys());

  return MockWebSocket;
}

function createMockHttpModule() {
  const servers = new Map();

  class MockServerResponse extends EventEmitter {
    constructor() {
      super();
      this.statusCode = 200;
      this.headers = {};
    }

    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    }

    end(body = '') {
      if (body) {
        this.emit('data', Buffer.from(body));
      }
      setImmediate(() => this.emit('end'));
    }
  }

  class MockHttpServer extends EventEmitter {
    constructor(handler) {
      super();
      this.handler = handler;
      this.port = null;
    }

    listen(port, cb) {
      this.port = port;
      servers.set(port, this);
      cb && cb();
    }

    close(cb) {
      if (this.port !== null) {
        servers.delete(this.port);
        this.port = null;
      }
      cb && cb();
    }
  }

  return {
    createServer: (handler) => new MockHttpServer(handler),
    get: (url, callback) => {
      const emitter = new EventEmitter();

      process.nextTick(() => {
        try {
          const parsed = new URL(url);
          const port = Number(parsed.port) || 80;
          const server = servers.get(port);

          if (!server) {
            throw new Error(`No HTTP server listening on port ${port}`);
          }

          const req = new EventEmitter();
          req.url = parsed.pathname;
          req.method = 'GET';

          const res = new MockServerResponse();
          callback && callback(res);
          server.handler(req, res);
        } catch (error) {
          emitter.emit('error', error);
        }
      });

      emitter.on = function (event, handler) {
        EventEmitter.prototype.on.call(this, event, handler);
        return this;
      };

      return emitter;
    },
    __reset: () => servers.clear(),
  };
}

jest.mock('ws', () => createMockWebSocketModule());
jest.mock('http', () => createMockHttpModule());

const SignalingServer = require('../signaling-server/index');
let WebSocket;
let httpModule;

describe('SignalingServer', () => {
  let serverInstance;

  beforeAll(() => {
    WebSocket = createMockWebSocketModule();
    httpModule = createMockHttpModule();

    serverInstance = new SignalingServer({
      port: 9101,
      healthPort: 9102,
      websocketModule: WebSocket,
      httpModule,
    });
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
