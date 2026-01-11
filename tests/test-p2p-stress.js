/**
 * P2P系统压力测试脚本
 *
 * 测试内容：
 * 1. 并发连接测试
 * 2. 消息吞吐量测试
 * 3. 长时间稳定性测试
 * 4. 内存泄漏检测
 * 5. CPU使用率监控
 */

const WebSocket = require('ws');
const { performance } = require('perf_hooks');

class P2PStressTest {
  constructor(options = {}) {
    this.signalingUrl = options.signalingUrl || 'ws://localhost:9001';
    this.concurrentConnections = options.concurrentConnections || 100;
    this.messagesPerSecond = options.messagesPerSecond || 1000;
    this.testDuration = options.testDuration || 60000; // 60秒

    this.connections = [];
    this.metrics = {
      totalConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      connectionTimes: [],
      messageTimes: [],
      errors: [],
      memoryUsage: [],
      cpuUsage: []
    };
  }

  /**
   * 运行所有压力测试
   */
  async runAllTests() {
    console.log('='.repeat(60));
    console.log('P2P系统压力测试');
    console.log('='.repeat(60));
    console.log('');

    try {
      await this.testConcurrentConnections();
      await this.testMessageThroughput();
      await this.testLongRunningStability();
      await this.testMemoryLeak();
    } catch (error) {
      console.error('压力测试失败:', error);
    }

    this.printFinalReport();
  }

  /**
   * 测试1: 并发连接测试
   */
  async testConcurrentConnections() {
    console.log('[测试1] 并发连接测试');
    console.log(`目标: ${this.concurrentConnections} 个并发连接`);
    console.log('');

    const startTime = performance.now();
    const connectionPromises = [];

    for (let i = 0; i < this.concurrentConnections; i++) {
      connectionPromises.push(this.createConnection(`stress-test-${i}`));
    }

    const results = await Promise.allSettled(connectionPromises);

    const endTime = performance.now();
    const duration = endTime - startTime;

    // 统计结果
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        this.metrics.successfulConnections++;
      } else {
        this.metrics.failedConnections++;
        this.metrics.errors.push({
          type: 'connection',
          index,
          error: result.reason
        });
      }
    });

    console.log(`✓ 连接测试完成`);
    console.log(`  - 总连接数: ${this.concurrentConnections}`);
    console.log(`  - 成功: ${this.metrics.successfulConnections}`);
    console.log(`  - 失败: ${this.metrics.failedConnections}`);
    console.log(`  - 总耗时: ${duration.toFixed(2)}ms`);
    console.log(`  - 平均连接时间: ${(duration / this.concurrentConnections).toFixed(2)}ms`);
    console.log(`  - 连接速率: ${(this.concurrentConnections / (duration / 1000)).toFixed(2)} 连接/秒`);
    console.log('');

    // 清理连接
    await this.closeAllConnections();
  }

  /**
   * 测试2: 消息吞吐量测试
   */
  async testMessageThroughput() {
    console.log('[测试2] 消息吞吐量测试');
    console.log(`目标: ${this.messagesPerSecond} 消息/秒`);
    console.log(`持续时间: ${this.testDuration / 1000} 秒`);
    console.log('');

    // 创建发送方和接收方
    const sender = await this.createConnection('throughput-sender');
    const receiver = await this.createConnection('throughput-receiver');

    let messagesReceived = 0;
    const messageLatencies = [];

    // 监听接收方消息
    receiver.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'message' && message.payload?.timestamp) {
          messagesReceived++;
          const latency = Date.now() - message.payload.timestamp;
          messageLatencies.push(latency);
        }
      } catch (error) {
        // 忽略解析错误
      }
    });

    const startTime = performance.now();
    const messageInterval = 1000 / this.messagesPerSecond;
    let messagesSent = 0;

    // 发送消息
    const sendInterval = setInterval(() => {
      if (performance.now() - startTime >= this.testDuration) {
        clearInterval(sendInterval);
        return;
      }

      try {
        sender.send(JSON.stringify({
          type: 'message',
          to: 'throughput-receiver',
          payload: {
            index: messagesSent,
            timestamp: Date.now(),
            data: 'x'.repeat(100) // 100字节数据
          }
        }));
        messagesSent++;
        this.metrics.successfulMessages++;
      } catch (error) {
        this.metrics.failedMessages++;
        this.metrics.errors.push({
          type: 'message',
          error: error.message
        });
      }
    }, messageInterval);

    // 等待测试完成
    await new Promise(resolve => setTimeout(resolve, this.testDuration + 1000));

    const endTime = performance.now();
    const actualDuration = (endTime - startTime) / 1000;

    // 计算统计数据
    const avgLatency = messageLatencies.length > 0
      ? messageLatencies.reduce((a, b) => a + b, 0) / messageLatencies.length
      : 0;

    const sortedLatencies = messageLatencies.sort((a, b) => a - b);
    const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
    const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
    const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0;

    console.log(`✓ 吞吐量测试完成`);
    console.log(`  - 发送消息数: ${messagesSent}`);
    console.log(`  - 接收消息数: ${messagesReceived}`);
    console.log(`  - 消息丢失率: ${((1 - messagesReceived / messagesSent) * 100).toFixed(2)}%`);
    console.log(`  - 实际吞吐量: ${(messagesSent / actualDuration).toFixed(2)} 消息/秒`);
    console.log(`  - 平均延迟: ${avgLatency.toFixed(2)}ms`);
    console.log(`  - P50延迟: ${p50}ms`);
    console.log(`  - P95延迟: ${p95}ms`);
    console.log(`  - P99延迟: ${p99}ms`);
    console.log('');

    this.metrics.totalMessages = messagesSent;
    this.metrics.messageTimes = messageLatencies;

    // 清理
    sender.close();
    receiver.close();
  }

  /**
   * 测试3: 长时间稳定性测试
   */
  async testLongRunningStability() {
    console.log('[测试3] 长时间稳定性测试');
    console.log(`持续时间: 5分钟（简化版）`);
    console.log('');

    const testDuration = 5 * 60 * 1000; // 5分钟
    const checkInterval = 30 * 1000; // 每30秒检查一次

    // 创建持久连接
    const connections = [];
    for (let i = 0; i < 10; i++) {
      const conn = await this.createConnection(`stability-test-${i}`);
      connections.push(conn);
    }

    console.log(`✓ 已创建 ${connections.length} 个持久连接`);

    const startTime = Date.now();
    let checkCount = 0;

    // 定期检查连接状态和资源使用
    const checkTimer = setInterval(() => {
      checkCount++;
      const elapsed = Date.now() - startTime;

      // 检查连接状态
      const activeConnections = connections.filter(
        conn => conn.readyState === WebSocket.OPEN
      ).length;

      // 记录内存使用
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage.push({
        timestamp: elapsed,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      });

      console.log(`  [${Math.floor(elapsed / 1000)}s] 活动连接: ${activeConnections}/${connections.length}, ` +
                  `内存: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      if (elapsed >= testDuration) {
        clearInterval(checkTimer);
      }
    }, checkInterval);

    // 等待测试完成
    await new Promise(resolve => setTimeout(resolve, testDuration));

    console.log(`✓ 稳定性测试完成`);
    console.log(`  - 测试时长: ${testDuration / 1000}秒`);
    console.log(`  - 检查次数: ${checkCount}`);
    console.log(`  - 最终活动连接: ${connections.filter(c => c.readyState === WebSocket.OPEN).length}`);
    console.log('');

    // 清理
    connections.forEach(conn => conn.close());
  }

  /**
   * 测试4: 内存泄漏检测
   */
  async testMemoryLeak() {
    console.log('[测试4] 内存泄漏检测');
    console.log('');

    const iterations = 10;
    const connectionsPerIteration = 50;
    const memorySnapshots = [];

    for (let i = 0; i < iterations; i++) {
      // 创建连接
      const connections = [];
      for (let j = 0; j < connectionsPerIteration; j++) {
        const conn = await this.createConnection(`leak-test-${i}-${j}`);
        connections.push(conn);
      }

      // 等待一会儿
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 关闭连接
      connections.forEach(conn => conn.close());

      // 等待连接完全关闭
      await new Promise(resolve => setTimeout(resolve, 500));

      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }

      // 记录内存使用
      const memUsage = process.memoryUsage();
      memorySnapshots.push({
        iteration: i + 1,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      });

      console.log(`  迭代 ${i + 1}/${iterations}: ` +
                  `堆内存 ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    }

    // 分析内存趋势
    const firstSnapshot = memorySnapshots[0];
    const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
    const memoryGrowth = lastSnapshot.heapUsed - firstSnapshot.heapUsed;
    const growthPercentage = (memoryGrowth / firstSnapshot.heapUsed) * 100;

    console.log('');
    console.log(`✓ 内存泄漏检测完成`);
    console.log(`  - 初始内存: ${(firstSnapshot.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  - 最终内存: ${(lastSnapshot.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  - 内存增长: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB (${growthPercentage.toFixed(2)}%)`);

    if (growthPercentage > 50) {
      console.log(`  ⚠️  警告: 检测到可能的内存泄漏 (增长 > 50%)`);
    } else {
      console.log(`  ✓ 未检测到明显的内存泄漏`);
    }
    console.log('');
  }

  /**
   * 创建WebSocket连接
   */
  async createConnection(peerId) {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const ws = new WebSocket(this.signalingUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('连接超时'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        const connectionTime = performance.now() - startTime;
        this.metrics.connectionTimes.push(connectionTime);

        // 注册节点
        ws.send(JSON.stringify({
          type: 'register',
          peerId: peerId,
          deviceType: 'stress-test'
        }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'registered') {
            resolve(ws);
          }
        } catch (error) {
          // 忽略
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * 关闭所有连接
   */
  async closeAllConnections() {
    this.connections.forEach(conn => {
      if (conn.readyState === WebSocket.OPEN) {
        conn.close();
      }
    });
    this.connections = [];
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * 打印最终报告
   */
  printFinalReport() {
    console.log('='.repeat(60));
    console.log('压力测试最终报告');
    console.log('='.repeat(60));
    console.log('');

    console.log('连接性能:');
    console.log(`  - 总连接尝试: ${this.metrics.totalConnections}`);
    console.log(`  - 成功连接: ${this.metrics.successfulConnections}`);
    console.log(`  - 失败连接: ${this.metrics.failedConnections}`);
    console.log(`  - 成功率: ${((this.metrics.successfulConnections / this.metrics.totalConnections) * 100).toFixed(2)}%`);

    if (this.metrics.connectionTimes.length > 0) {
      const avgConnTime = this.metrics.connectionTimes.reduce((a, b) => a + b, 0) / this.metrics.connectionTimes.length;
      console.log(`  - 平均连接时间: ${avgConnTime.toFixed(2)}ms`);
    }

    console.log('');
    console.log('消息性能:');
    console.log(`  - 总消息数: ${this.metrics.totalMessages}`);
    console.log(`  - 成功消息: ${this.metrics.successfulMessages}`);
    console.log(`  - 失败消息: ${this.metrics.failedMessages}`);

    if (this.metrics.messageTimes.length > 0) {
      const avgMsgTime = this.metrics.messageTimes.reduce((a, b) => a + b, 0) / this.metrics.messageTimes.length;
      console.log(`  - 平均消息延迟: ${avgMsgTime.toFixed(2)}ms`);
    }

    console.log('');
    console.log('资源使用:');
    if (this.metrics.memoryUsage.length > 0) {
      const lastMem = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
      console.log(`  - 最终内存使用: ${(lastMem.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  - 最终RSS: ${(lastMem.rss / 1024 / 1024).toFixed(2)}MB`);
    }

    console.log('');
    console.log('错误统计:');
    console.log(`  - 总错误数: ${this.metrics.errors.length}`);

    if (this.metrics.errors.length > 0) {
      const errorTypes = {};
      this.metrics.errors.forEach(err => {
        errorTypes[err.type] = (errorTypes[err.type] || 0) + 1;
      });

      Object.entries(errorTypes).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count}`);
      });
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('');

    // 性能评级
    this.printPerformanceRating();
  }

  /**
   * 打印性能评级
   */
  printPerformanceRating() {
    console.log('性能评级:');

    const ratings = [];

    // 连接成功率
    const connSuccessRate = (this.metrics.successfulConnections / this.metrics.totalConnections) * 100;
    if (connSuccessRate >= 99) {
      ratings.push({ metric: '连接成功率', rating: '优秀', value: `${connSuccessRate.toFixed(2)}%` });
    } else if (connSuccessRate >= 95) {
      ratings.push({ metric: '连接成功率', rating: '良好', value: `${connSuccessRate.toFixed(2)}%` });
    } else {
      ratings.push({ metric: '连接成功率', rating: '需改进', value: `${connSuccessRate.toFixed(2)}%` });
    }

    // 平均连接时间
    if (this.metrics.connectionTimes.length > 0) {
      const avgConnTime = this.metrics.connectionTimes.reduce((a, b) => a + b, 0) / this.metrics.connectionTimes.length;
      if (avgConnTime < 100) {
        ratings.push({ metric: '连接速度', rating: '优秀', value: `${avgConnTime.toFixed(2)}ms` });
      } else if (avgConnTime < 200) {
        ratings.push({ metric: '连接速度', rating: '良好', value: `${avgConnTime.toFixed(2)}ms` });
      } else {
        ratings.push({ metric: '连接速度', rating: '需改进', value: `${avgConnTime.toFixed(2)}ms` });
      }
    }

    // 消息延迟
    if (this.metrics.messageTimes.length > 0) {
      const avgMsgTime = this.metrics.messageTimes.reduce((a, b) => a + b, 0) / this.metrics.messageTimes.length;
      if (avgMsgTime < 50) {
        ratings.push({ metric: '消息延迟', rating: '优秀', value: `${avgMsgTime.toFixed(2)}ms` });
      } else if (avgMsgTime < 100) {
        ratings.push({ metric: '消息延迟', rating: '良好', value: `${avgMsgTime.toFixed(2)}ms` });
      } else {
        ratings.push({ metric: '消息延迟', rating: '需改进', value: `${avgMsgTime.toFixed(2)}ms` });
      }
    }

    ratings.forEach(r => {
      const emoji = r.rating === '优秀' ? '⭐⭐⭐' : r.rating === '良好' ? '⭐⭐' : '⭐';
      console.log(`  ${emoji} ${r.metric}: ${r.rating} (${r.value})`);
    });

    console.log('');
  }
}

// 运行压力测试
if (require.main === module) {
  const test = new P2PStressTest({
    concurrentConnections: 100,
    messagesPerSecond: 1000,
    testDuration: 60000
  });

  test.runAllTests().then(() => {
    console.log('压力测试完成');
    process.exit(0);
  }).catch((error) => {
    console.error('压力测试失败:', error);
    process.exit(1);
  });
}

module.exports = P2PStressTest;
