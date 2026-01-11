/**
 * P2P系统快速压力测试
 * 使用较小的参数进行快速验证
 */

const P2PStressTest = require('./test-p2p-stress');

async function runQuickStressTest() {
  console.log('运行快速压力测试（使用较小参数）...\n');

  const test = new P2PStressTest({
    concurrentConnections: 20,      // 20个并发连接
    messagesPerSecond: 100,         // 100消息/秒
    testDuration: 10000             // 10秒
  });

  await test.runAllTests();
}

runQuickStressTest().catch(console.error);
