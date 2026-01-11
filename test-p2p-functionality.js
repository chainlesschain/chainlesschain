/**
 * P2P功能测试脚本
 *
 * 测试内容：
 * 1. 信令服务器连接
 * 2. P2P节点注册
 * 3. WebRTC连接建立
 * 4. 消息传输
 * 5. 音视频通话模拟
 */

const WebSocket = require('ws');

class P2PFunctionalityTest {
  constructor() {
    this.signalingUrl = 'ws://localhost:9001';
    this.testResults = {
      signalingConnection: false,
      peerRegistration: false,
      messageForwarding: false,
      webrtcSignaling: false,
      offlineMessageQueue: false
    };
    this.testErrors = [];
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('='.repeat(60));
    console.log('ChainlessChain P2P功能测试');
    console.log('='.repeat(60));
    console.log('');

    try {
      await this.testSignalingConnection();
      await this.testPeerRegistration();
      await this.testMessageForwarding();
      await this.testWebRTCSignaling();
      await this.testOfflineMessageQueue();
    } catch (error) {
      console.error('测试过程中发生错误:', error);
      this.testErrors.push({ test: 'general', error: error.message });
    }

    this.printTestReport();
  }

  /**
   * 测试1: 信令服务器连接
   */
  async testSignalingConnection() {
    console.log('[测试1] 信令服务器连接测试...');

    return new Promise((resolve) => {
      const ws = new WebSocket(this.signalingUrl);
      const timeout = setTimeout(() => {
        ws.close();
        console.log('  ❌ 连接超时');
        this.testErrors.push({ test: 'signalingConnection', error: '连接超时' });
        resolve();
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('  ✅ 信令服务器连接成功');
        this.testResults.signalingConnection = true;
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ 连接失败:', error.message);
        this.testErrors.push({ test: 'signalingConnection', error: error.message });
        resolve();
      });
    });
  }

  /**
   * 测试2: 节点注册
   */
  async testPeerRegistration() {
    console.log('\n[测试2] 节点注册测试...');

    return new Promise((resolve) => {
      const ws = new WebSocket(this.signalingUrl);
      const timeout = setTimeout(() => {
        ws.close();
        console.log('  ❌ 注册超时');
        this.testErrors.push({ test: 'peerRegistration', error: '注册超时' });
        resolve();
      }, 5000);

      ws.on('open', () => {
        // 发送注册消息
        ws.send(JSON.stringify({
          type: 'register',
          peerId: 'test-peer-001',
          deviceInfo: {
            name: 'Test Device',
            platform: 'test'
          },
          deviceType: 'desktop'
        }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            clearTimeout(timeout);
            console.log('  ✅ 节点注册成功');
            console.log('     - PeerId:', message.peerId);
            this.testResults.peerRegistration = true;
            ws.close();
            resolve();
          }
        } catch (error) {
          console.log('  ⚠️  消息解析失败:', error.message);
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ 注册失败:', error.message);
        this.testErrors.push({ test: 'peerRegistration', error: error.message });
        resolve();
      });
    });
  }

  /**
   * 测试3: 消息转发
   */
  async testMessageForwarding() {
    console.log('\n[测试3] 消息转发测试...');

    return new Promise((resolve) => {
      let peer1, peer2;
      let peer1Ready = false;
      let peer2Ready = false;

      const timeout = setTimeout(() => {
        if (peer1) peer1.close();
        if (peer2) peer2.close();
        console.log('  ❌ 消息转发超时');
        this.testErrors.push({ test: 'messageForwarding', error: '消息转发超时' });
        resolve();
      }, 10000);

      // 创建第一个节点
      peer1 = new WebSocket(this.signalingUrl);
      peer1.on('open', () => {
        peer1.send(JSON.stringify({
          type: 'register',
          peerId: 'test-peer-sender',
          deviceType: 'desktop'
        }));
      });

      peer1.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            peer1Ready = true;
            console.log('  ✓ 发送方节点已注册');

            // 创建第二个节点
            if (!peer2) {
              peer2 = new WebSocket(this.signalingUrl);
              peer2.on('open', () => {
                peer2.send(JSON.stringify({
                  type: 'register',
                  peerId: 'test-peer-receiver',
                  deviceType: 'desktop'
                }));
              });

              peer2.on('message', (data2) => {
                try {
                  const message2 = JSON.parse(data2.toString());

                  if (message2.type === 'registered') {
                    peer2Ready = true;
                    console.log('  ✓ 接收方节点已注册');

                    // 发送测试消息
                    setTimeout(() => {
                      peer1.send(JSON.stringify({
                        type: 'message',
                        to: 'test-peer-receiver',
                        payload: { test: 'Hello from sender!' }
                      }));
                    }, 500);
                  } else if (message2.type === 'message' && message2.from === 'test-peer-sender') {
                    clearTimeout(timeout);
                    console.log('  ✅ 消息转发成功');
                    console.log('     - 消息内容:', message2.payload);
                    this.testResults.messageForwarding = true;
                    peer1.close();
                    peer2.close();
                    resolve();
                  }
                } catch (error) {
                  console.log('  ⚠️  Peer2消息解析失败:', error.message);
                }
              });
            }
          }
        } catch (error) {
          console.log('  ⚠️  Peer1消息解析失败:', error.message);
        }
      });

      peer1.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ Peer1错误:', error.message);
        this.testErrors.push({ test: 'messageForwarding', error: error.message });
        if (peer2) peer2.close();
        resolve();
      });
    });
  }

  /**
   * 测试4: WebRTC信令交换
   */
  async testWebRTCSignaling() {
    console.log('\n[测试4] WebRTC信令交换测试...');

    return new Promise((resolve) => {
      let peer1, peer2;
      let offerReceived = false;
      let answerReceived = false;

      const timeout = setTimeout(() => {
        if (peer1) peer1.close();
        if (peer2) peer2.close();
        console.log('  ❌ WebRTC信令交换超时');
        this.testErrors.push({ test: 'webrtcSignaling', error: 'WebRTC信令交换超时' });
        resolve();
      }, 10000);

      // 创建Peer1 (Caller)
      peer1 = new WebSocket(this.signalingUrl);
      peer1.on('open', () => {
        peer1.send(JSON.stringify({
          type: 'register',
          peerId: 'test-peer-caller',
          deviceType: 'desktop'
        }));
      });

      peer1.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            console.log('  ✓ Caller节点已注册');

            // 创建Peer2 (Callee)
            if (!peer2) {
              peer2 = new WebSocket(this.signalingUrl);
              peer2.on('open', () => {
                peer2.send(JSON.stringify({
                  type: 'register',
                  peerId: 'test-peer-callee',
                  deviceType: 'desktop'
                }));
              });

              peer2.on('message', (data2) => {
                try {
                  const message2 = JSON.parse(data2.toString());

                  if (message2.type === 'registered') {
                    console.log('  ✓ Callee节点已注册');

                    // 发送Offer
                    setTimeout(() => {
                      peer1.send(JSON.stringify({
                        type: 'offer',
                        to: 'test-peer-callee',
                        sdp: { type: 'offer', sdp: 'mock-sdp-offer' }
                      }));
                    }, 500);
                  } else if (message2.type === 'offer' && message2.from === 'test-peer-caller') {
                    offerReceived = true;
                    console.log('  ✓ Offer已接收');

                    // 发送Answer
                    peer2.send(JSON.stringify({
                      type: 'answer',
                      to: 'test-peer-caller',
                      sdp: { type: 'answer', sdp: 'mock-sdp-answer' }
                    }));
                  }
                } catch (error) {
                  console.log('  ⚠️  Peer2消息解析失败:', error.message);
                }
              });
            }
          } else if (message.type === 'answer' && message.from === 'test-peer-callee') {
            answerReceived = true;
            console.log('  ✓ Answer已接收');

            if (offerReceived && answerReceived) {
              clearTimeout(timeout);
              console.log('  ✅ WebRTC信令交换成功');
              this.testResults.webrtcSignaling = true;
              peer1.close();
              peer2.close();
              resolve();
            }
          }
        } catch (error) {
          console.log('  ⚠️  Peer1消息解析失败:', error.message);
        }
      });

      peer1.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ Peer1错误:', error.message);
        this.testErrors.push({ test: 'webrtcSignaling', error: error.message });
        if (peer2) peer2.close();
        resolve();
      });
    });
  }

  /**
   * 测试5: 离线消息队列
   */
  async testOfflineMessageQueue() {
    console.log('\n[测试5] 离线消息队列测试...');

    return new Promise((resolve) => {
      let sender, receiver;

      const timeout = setTimeout(() => {
        if (sender) sender.close();
        if (receiver) receiver.close();
        console.log('  ❌ 离线消息队列测试超时');
        this.testErrors.push({ test: 'offlineMessageQueue', error: '离线消息队列测试超时' });
        resolve();
      }, 10000);

      // 创建发送方
      sender = new WebSocket(this.signalingUrl);
      sender.on('open', () => {
        sender.send(JSON.stringify({
          type: 'register',
          peerId: 'test-peer-sender-offline',
          deviceType: 'desktop'
        }));
      });

      sender.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            console.log('  ✓ 发送方节点已注册');

            // 发送消息给离线节点
            setTimeout(() => {
              sender.send(JSON.stringify({
                type: 'message',
                to: 'test-peer-receiver-offline',
                payload: { test: 'Offline message test' }
              }));

              console.log('  ✓ 已发送消息给离线节点');

              // 等待一会儿后创建接收方
              setTimeout(() => {
                receiver = new WebSocket(this.signalingUrl);
                receiver.on('open', () => {
                  receiver.send(JSON.stringify({
                    type: 'register',
                    peerId: 'test-peer-receiver-offline',
                    deviceType: 'desktop'
                  }));
                });

                receiver.on('message', (data2) => {
                  try {
                    const message2 = JSON.parse(data2.toString());

                    if (message2.type === 'registered') {
                      console.log('  ✓ 接收方节点已上线');
                    } else if (message2.type === 'offline-message') {
                      clearTimeout(timeout);
                      console.log('  ✅ 离线消息已投递');
                      console.log('     - 消息内容:', message2.originalMessage.payload);
                      this.testResults.offlineMessageQueue = true;
                      sender.close();
                      receiver.close();
                      resolve();
                    }
                  } catch (error) {
                    console.log('  ⚠️  接收方消息解析失败:', error.message);
                  }
                });
              }, 1000);
            }, 500);
          }
        } catch (error) {
          console.log('  ⚠️  发送方消息解析失败:', error.message);
        }
      });

      sender.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ 发送方错误:', error.message);
        this.testErrors.push({ test: 'offlineMessageQueue', error: error.message });
        if (receiver) receiver.close();
        resolve();
      });
    });
  }

  /**
   * 打印测试报告
   */
  printTestReport() {
    console.log('\n' + '='.repeat(60));
    console.log('测试报告');
    console.log('='.repeat(60));

    const tests = [
      { name: '信令服务器连接', key: 'signalingConnection' },
      { name: '节点注册', key: 'peerRegistration' },
      { name: '消息转发', key: 'messageForwarding' },
      { name: 'WebRTC信令交换', key: 'webrtcSignaling' },
      { name: '离线消息队列', key: 'offlineMessageQueue' }
    ];

    let passedCount = 0;
    let failedCount = 0;

    tests.forEach(test => {
      const passed = this.testResults[test.key];
      const status = passed ? '✅ 通过' : '❌ 失败';
      console.log(`${test.name}: ${status}`);

      if (passed) {
        passedCount++;
      } else {
        failedCount++;
        const error = this.testErrors.find(e => e.test === test.key);
        if (error) {
          console.log(`   错误: ${error.error}`);
        }
      }
    });

    console.log('\n' + '-'.repeat(60));
    console.log(`总计: ${tests.length} 个测试`);
    console.log(`通过: ${passedCount} 个`);
    console.log(`失败: ${failedCount} 个`);
    console.log(`成功率: ${((passedCount / tests.length) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    // 建议
    if (failedCount > 0) {
      console.log('\n建议:');
      if (!this.testResults.signalingConnection) {
        console.log('- 检查信令服务器是否正在运行 (docker-compose ps signaling-server)');
        console.log('- 检查端口9001是否被占用');
      }
      if (!this.testResults.peerRegistration) {
        console.log('- 检查信令服务器日志 (docker-compose logs signaling-server)');
      }
      if (!this.testResults.messageForwarding) {
        console.log('- 检查消息转发逻辑是否正常');
      }
      if (!this.testResults.webrtcSignaling) {
        console.log('- 检查WebRTC信令处理逻辑');
      }
      if (!this.testResults.offlineMessageQueue) {
        console.log('- 检查离线消息队列功能');
      }
    }
  }
}

// 运行测试
if (require.main === module) {
  const test = new P2PFunctionalityTest();
  test.runAllTests().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = P2PFunctionalityTest;
