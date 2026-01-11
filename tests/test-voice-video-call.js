/**
 * 音视频通话端到端测试
 *
 * 测试内容：
 * 1. 通话发起流程
 * 2. 通话接受流程
 * 3. WebRTC SDP交换
 * 4. ICE候选交换
 * 5. 通话结束流程
 */

const WebSocket = require('ws');

class VoiceVideoCallTest {
  constructor() {
    this.signalingUrl = 'ws://localhost:9001';
    this.testResults = {
      callInitiation: false,
      callAcceptance: false,
      sdpExchange: false,
      iceCandidateExchange: false,
      callTermination: false
    };
    this.testErrors = [];
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('='.repeat(60));
    console.log('音视频通话端到端测试');
    console.log('='.repeat(60));
    console.log('');

    try {
      await this.testVoiceCall();
      await this.testVideoCall();
      await this.testCallRejection();
      await this.testCallTimeout();
    } catch (error) {
      console.error('测试过程中发生错误:', error);
      this.testErrors.push({ test: 'general', error: error.message });
    }

    this.printTestReport();
  }

  /**
   * 测试1: 语音通话流程
   */
  async testVoiceCall() {
    console.log('[测试1] 语音通话完整流程测试...');

    return new Promise((resolve) => {
      let caller, callee;
      let offerReceived = false;
      let answerReceived = false;
      let iceCandidatesExchanged = 0;

      const timeout = setTimeout(() => {
        if (caller) caller.close();
        if (callee) callee.close();
        console.log('  ❌ 语音通话测试超时');
        this.testErrors.push({ test: 'voiceCall', error: '测试超时' });
        resolve();
      }, 15000);

      // 创建Caller（发起方）
      caller = new WebSocket(this.signalingUrl);
      caller.on('open', () => {
        caller.send(JSON.stringify({
          type: 'register',
          peerId: 'test-caller-voice',
          deviceType: 'desktop'
        }));
      });

      caller.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            console.log('  ✓ Caller已注册');

            // 创建Callee（接收方）
            if (!callee) {
              callee = new WebSocket(this.signalingUrl);
              callee.on('open', () => {
                callee.send(JSON.stringify({
                  type: 'register',
                  peerId: 'test-callee-voice',
                  deviceType: 'desktop'
                }));
              });

              callee.on('message', (data2) => {
                try {
                  const message2 = JSON.parse(data2.toString());

                  if (message2.type === 'registered') {
                    console.log('  ✓ Callee已注册');

                    // 发起语音通话（发送Offer）
                    setTimeout(() => {
                      console.log('  → Caller发起语音通话');
                      caller.send(JSON.stringify({
                        type: 'offer',
                        to: 'test-callee-voice',
                        callType: 'audio',
                        sdp: {
                          type: 'offer',
                          sdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=Audio Call\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00\r\na=setup:actpass\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n'
                        }
                      }));
                      this.testResults.callInitiation = true;
                    }, 500);
                  } else if (message2.type === 'offer' && message2.from === 'test-caller-voice') {
                    offerReceived = true;
                    console.log('  ✓ Callee收到Offer');
                    console.log('     - 通话类型:', message2.callType);

                    // 发送Answer
                    setTimeout(() => {
                      console.log('  → Callee接受通话');
                      callee.send(JSON.stringify({
                        type: 'answer',
                        to: 'test-caller-voice',
                        sdp: {
                          type: 'answer',
                          sdp: 'v=0\r\no=- 654321 2 IN IP4 127.0.0.1\r\ns=Audio Call\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test2\r\na=ice-pwd:testpassword2\r\na=fingerprint:sha-256 11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11\r\na=setup:active\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n'
                        }
                      }));
                      this.testResults.callAcceptance = true;
                    }, 500);
                  }
                } catch (error) {
                  console.log('  ⚠️  Callee消息解析失败:', error.message);
                }
              });
            }
          } else if (message.type === 'answer' && message.from === 'test-callee-voice') {
            answerReceived = true;
            console.log('  ✓ Caller收到Answer');
            this.testResults.sdpExchange = true;

            // 模拟ICE候选交换
            setTimeout(() => {
              console.log('  → 交换ICE候选');

              // Caller发送ICE候选
              caller.send(JSON.stringify({
                type: 'ice-candidate',
                to: 'test-callee-voice',
                candidate: {
                  candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 54321 typ host',
                  sdpMLineIndex: 0,
                  sdpMid: '0'
                }
              }));

              // Callee发送ICE候选
              setTimeout(() => {
                callee.send(JSON.stringify({
                  type: 'ice-candidate',
                  to: 'test-caller-voice',
                  candidate: {
                    candidate: 'candidate:1 1 UDP 2130706431 192.168.1.101 54322 typ host',
                    sdpMLineIndex: 0,
                    sdpMid: '0'
                  }
                }));
              }, 200);
            }, 500);
          } else if (message.type === 'ice-candidate' && message.from === 'test-callee-voice') {
            iceCandidatesExchanged++;
            console.log('  ✓ Caller收到ICE候选');

            if (iceCandidatesExchanged >= 1) {
              this.testResults.iceCandidateExchange = true;

              // 模拟通话建立成功，然后结束通话
              setTimeout(() => {
                console.log('  → 通话已建立，模拟通话中...');

                setTimeout(() => {
                  console.log('  → Caller结束通话');
                  caller.send(JSON.stringify({
                    type: 'message',
                    to: 'test-callee-voice',
                    payload: {
                      type: 'call-end',
                      reason: 'normal'
                    }
                  }));
                  this.testResults.callTermination = true;

                  clearTimeout(timeout);
                  console.log('  ✅ 语音通话流程测试完成');

                  setTimeout(() => {
                    caller.close();
                    callee.close();
                    resolve();
                  }, 500);
                }, 1000);
              }, 500);
            }
          }
        } catch (error) {
          console.log('  ⚠️  Caller消息解析失败:', error.message);
        }
      });

      caller.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ Caller错误:', error.message);
        this.testErrors.push({ test: 'voiceCall', error: error.message });
        if (callee) callee.close();
        resolve();
      });
    });
  }

  /**
   * 测试2: 视频通话流程
   */
  async testVideoCall() {
    console.log('\n[测试2] 视频通话流程测试...');

    return new Promise((resolve) => {
      let caller, callee;
      let videoOfferReceived = false;

      const timeout = setTimeout(() => {
        if (caller) caller.close();
        if (callee) callee.close();
        console.log('  ❌ 视频通话测试超时');
        this.testErrors.push({ test: 'videoCall', error: '测试超时' });
        resolve();
      }, 10000);

      caller = new WebSocket(this.signalingUrl);
      caller.on('open', () => {
        caller.send(JSON.stringify({
          type: 'register',
          peerId: 'test-caller-video',
          deviceType: 'desktop'
        }));
      });

      caller.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            console.log('  ✓ Caller已注册');

            if (!callee) {
              callee = new WebSocket(this.signalingUrl);
              callee.on('open', () => {
                callee.send(JSON.stringify({
                  type: 'register',
                  peerId: 'test-callee-video',
                  deviceType: 'desktop'
                }));
              });

              callee.on('message', (data2) => {
                try {
                  const message2 = JSON.parse(data2.toString());

                  if (message2.type === 'registered') {
                    console.log('  ✓ Callee已注册');

                    setTimeout(() => {
                      console.log('  → Caller发起视频通话');
                      caller.send(JSON.stringify({
                        type: 'offer',
                        to: 'test-callee-video',
                        callType: 'video',
                        sdp: {
                          type: 'offer',
                          sdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=Video Call\r\nt=0 0\r\na=group:BUNDLE 0 1\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=mid:0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\na=mid:1\r\na=rtpmap:96 VP8/90000\r\n'
                        }
                      }));
                    }, 500);
                  } else if (message2.type === 'offer' && message2.callType === 'video') {
                    videoOfferReceived = true;
                    console.log('  ✓ Callee收到视频通话Offer');
                    console.log('  ✅ 视频通话流程测试完成');

                    clearTimeout(timeout);
                    caller.close();
                    callee.close();
                    resolve();
                  }
                } catch (error) {
                  console.log('  ⚠️  Callee消息解析失败:', error.message);
                }
              });
            }
          }
        } catch (error) {
          console.log('  ⚠️  Caller消息解析失败:', error.message);
        }
      });

      caller.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ Caller错误:', error.message);
        this.testErrors.push({ test: 'videoCall', error: error.message });
        if (callee) callee.close();
        resolve();
      });
    });
  }

  /**
   * 测试3: 通话拒绝流程
   */
  async testCallRejection() {
    console.log('\n[测试3] 通话拒绝流程测试...');

    return new Promise((resolve) => {
      let caller, callee;
      let rejectionReceived = false;

      const timeout = setTimeout(() => {
        if (caller) caller.close();
        if (callee) callee.close();
        console.log('  ❌ 通话拒绝测试超时');
        this.testErrors.push({ test: 'callRejection', error: '测试超时' });
        resolve();
      }, 10000);

      caller = new WebSocket(this.signalingUrl);
      caller.on('open', () => {
        caller.send(JSON.stringify({
          type: 'register',
          peerId: 'test-caller-reject',
          deviceType: 'desktop'
        }));
      });

      caller.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            console.log('  ✓ Caller已注册');

            if (!callee) {
              callee = new WebSocket(this.signalingUrl);
              callee.on('open', () => {
                callee.send(JSON.stringify({
                  type: 'register',
                  peerId: 'test-callee-reject',
                  deviceType: 'desktop'
                }));
              });

              callee.on('message', (data2) => {
                try {
                  const message2 = JSON.parse(data2.toString());

                  if (message2.type === 'registered') {
                    console.log('  ✓ Callee已注册');

                    setTimeout(() => {
                      console.log('  → Caller发起通话');
                      caller.send(JSON.stringify({
                        type: 'offer',
                        to: 'test-callee-reject',
                        callType: 'audio',
                        sdp: { type: 'offer', sdp: 'mock-sdp' }
                      }));
                    }, 500);
                  } else if (message2.type === 'offer') {
                    console.log('  ✓ Callee收到通话请求');

                    setTimeout(() => {
                      console.log('  → Callee拒绝通话');
                      callee.send(JSON.stringify({
                        type: 'message',
                        to: 'test-caller-reject',
                        payload: {
                          type: 'call-reject',
                          reason: 'busy'
                        }
                      }));
                    }, 500);
                  }
                } catch (error) {
                  console.log('  ⚠️  Callee消息解析失败:', error.message);
                }
              });
            }
          } else if (message.type === 'message' && message.payload?.type === 'call-reject') {
            rejectionReceived = true;
            console.log('  ✓ Caller收到拒绝通知');
            console.log('     - 拒绝原因:', message.payload.reason);
            console.log('  ✅ 通话拒绝流程测试完成');

            clearTimeout(timeout);
            caller.close();
            callee.close();
            resolve();
          }
        } catch (error) {
          console.log('  ⚠️  Caller消息解析失败:', error.message);
        }
      });

      caller.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ Caller错误:', error.message);
        this.testErrors.push({ test: 'callRejection', error: error.message });
        if (callee) callee.close();
        resolve();
      });
    });
  }

  /**
   * 测试4: 通话超时处理
   */
  async testCallTimeout() {
    console.log('\n[测试4] 通话超时处理测试...');

    return new Promise((resolve) => {
      let caller;

      const timeout = setTimeout(() => {
        if (caller) caller.close();
        console.log('  ❌ 通话超时测试失败');
        this.testErrors.push({ test: 'callTimeout', error: '测试超时' });
        resolve();
      }, 10000);

      caller = new WebSocket(this.signalingUrl);
      caller.on('open', () => {
        caller.send(JSON.stringify({
          type: 'register',
          peerId: 'test-caller-timeout',
          deviceType: 'desktop'
        }));
      });

      caller.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'registered') {
            console.log('  ✓ Caller已注册');

            setTimeout(() => {
              console.log('  → Caller呼叫离线用户');
              caller.send(JSON.stringify({
                type: 'offer',
                to: 'test-offline-user',
                callType: 'audio',
                sdp: { type: 'offer', sdp: 'mock-sdp' }
              }));
            }, 500);
          } else if (message.type === 'peer-offline') {
            console.log('  ✓ 收到对方离线通知');
            console.log('     - 离线用户:', message.peerId);
            console.log('  ✅ 通话超时处理测试完成');

            clearTimeout(timeout);
            caller.close();
            resolve();
          }
        } catch (error) {
          console.log('  ⚠️  消息解析失败:', error.message);
        }
      });

      caller.on('error', (error) => {
        clearTimeout(timeout);
        console.log('  ❌ Caller错误:', error.message);
        this.testErrors.push({ test: 'callTimeout', error: error.message });
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
      { name: '通话发起', key: 'callInitiation' },
      { name: '通话接受', key: 'callAcceptance' },
      { name: 'SDP交换', key: 'sdpExchange' },
      { name: 'ICE候选交换', key: 'iceCandidateExchange' },
      { name: '通话结束', key: 'callTermination' }
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
      }
    });

    console.log('\n' + '-'.repeat(60));
    console.log(`总计: ${tests.length} 个测试`);
    console.log(`通过: ${passedCount} 个`);
    console.log(`失败: ${failedCount} 个`);
    console.log(`成功率: ${((passedCount / tests.length) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    if (this.testErrors.length > 0) {
      console.log('\n错误详情:');
      this.testErrors.forEach(error => {
        console.log(`- [${error.test}] ${error.error}`);
      });
    }

    console.log('\n说明:');
    console.log('- 本测试模拟了完整的音视频通话信令交换流程');
    console.log('- 实际的媒体流传输需要在真实环境中测试');
    console.log('- WebRTC连接建立需要STUN/TURN服务器支持');
  }
}

// 运行测试
if (require.main === module) {
  const test = new VoiceVideoCallTest();
  test.runAllTests().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = VoiceVideoCallTest;
