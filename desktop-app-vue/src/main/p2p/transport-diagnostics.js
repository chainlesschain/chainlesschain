/**
 * 传输层诊断工具
 * 测试P2P传输层的健康状况和性能
 */

class TransportDiagnostics {
  constructor(p2pManager) {
    this.p2pManager = p2pManager;
    this.healthData = new Map(); // 传输层健康数据
    this.monitoringInterval = null;
  }

  /**
   * 测试单个传输层
   * @param {string} transport - 传输层名称 ('tcp', 'webrtc', 'websocket')
   * @param {string} targetPeer - 目标peer ID（可选）
   * @returns {Promise<Object>} 测试结果
   */
  async testTransport(transport, targetPeer = null) {
    const startTime = Date.now();
    const result = {
      transport,
      available: false,
      latency: null,
      error: null,
      timestamp: startTime
    };

    try {
      if (!this.p2pManager.node) {
        throw new Error('P2P节点未初始化');
      }

      // 获取当前节点的multiaddrs
      const multiaddrs = this.p2pManager.node.getMultiaddrs();

      // 过滤出指定传输层的地址
      const transportAddrs = multiaddrs.filter(addr => {
        const addrStr = addr.toString();
        if (transport === 'tcp') {
          return addrStr.includes('/tcp/') && !addrStr.includes('/ws') && !addrStr.includes('/wss');
        } else if (transport === 'websocket') {
          return addrStr.includes('/ws') || addrStr.includes('/wss');
        } else if (transport === 'webrtc') {
          return addrStr.includes('/webrtc');
        }
        return false;
      });

      if (transportAddrs.length === 0) {
        // Special handling for WebRTC - it may be enabled but not create traditional listen addresses
        if (transport === 'webrtc') {
          // Check if WebRTC transport is actually configured even without listen addresses
          const allTransports = this.p2pManager.node._components?.transportManager?.getTransports?.() || [];
          const hasWebRTC = Array.from(allTransports).some(t =>
            t.constructor.name.toLowerCase().includes('webrtc')
          );

          if (hasWebRTC) {
            result.available = true;
            result.listenAddresses = [];
            result.note = 'WebRTC传输已配置，但在Node.js环境中不创建传统监听地址';
            // Don't log this as success since it's a special case
            return result;
          }
        }

        throw new Error(`${transport}传输层未启用或未监听`);
      }

      result.available = true;
      result.listenAddresses = transportAddrs.map(addr => addr.toString());

      // 如果提供了目标peer，尝试拨号测试
      if (targetPeer) {
        const dialStartTime = Date.now();
        try {
          const connection = await this.p2pManager.node.dial(targetPeer);
          result.latency = Date.now() - dialStartTime;
          result.connectionSuccess = true;

          // 关闭测试连接
          await connection.close();
        } catch (dialError) {
          result.connectionSuccess = false;
          result.dialError = dialError.message;
        }
      }

      // 只在状态变化时记录
      const prevHealth = this.getTransportHealth(transport);
      if (prevHealth.lastCheck === null || prevHealth.successCount === 0) {
        console.log(`[Transport Diagnostics] ${transport} 测试完成: 可用`);
      }

    } catch (error) {
      result.error = error.message;

      // 只在状态变化或首次检测时记录错误
      const prevHealth = this.getTransportHealth(transport);
      const shouldLog = prevHealth.lastCheck === null ||
                       (prevHealth.successCount > 0 && prevHealth.failureCount === 0);

      if (shouldLog) {
        // Special handling for WebRTC - log as info instead of error
        if (transport === 'webrtc' && error.message.includes('未启用或未监听')) {
          console.info(`[Transport Diagnostics] ${transport} 在Node.js环境中不可用（这是正常的）`);
        } else {
          console.error(`[Transport Diagnostics] ${transport} 测试失败:`, error);
        }
      }
    }

    result.testDuration = Date.now() - startTime;
    return result;
  }

  /**
   * 运行完整诊断
   * @returns {Promise<Object>} 完整诊断结果
   */
  async runFullDiagnostics() {
    console.log('[Transport Diagnostics] 开始完整诊断...');

    const results = {
      timestamp: Date.now(),
      nodeInfo: null,
      transports: {},
      connections: [],
      summary: {
        totalTransports: 0,
        availableTransports: 0,
        activeConnections: 0
      }
    };

    try {
      // 1. 获取节点信息
      if (this.p2pManager.node) {
        const peerId = this.p2pManager.node.peerId.toString();
        const multiaddrs = this.p2pManager.node.getMultiaddrs();

        results.nodeInfo = {
          peerId,
          multiaddrs: multiaddrs.map(addr => addr.toString()),
          multiaddrsCount: multiaddrs.length
        };

        // 2. 测试各传输层
        const transportsToTest = ['tcp', 'websocket', 'webrtc'];

        for (const transport of transportsToTest) {
          const testResult = await this.testTransport(transport);
          results.transports[transport] = testResult;
          results.summary.totalTransports++;

          if (testResult.available) {
            results.summary.availableTransports++;
          }
        }

        // 3. 获取当前连接信息
        const connections = this.p2pManager.node.getConnections();
        results.summary.activeConnections = connections.length;

        results.connections = connections.map(conn => ({
          peerId: conn.remotePeer.toString(),
          remoteAddr: conn.remoteAddr.toString(),
          status: conn.status,
          direction: conn.direction,
          timeline: {
            open: conn.timeline.open,
            upgraded: conn.timeline.upgraded
          }
        }));

        // 4. NAT信息
        if (this.p2pManager.natInfo) {
          results.natInfo = {
            type: this.p2pManager.natInfo.type,
            publicIP: this.p2pManager.natInfo.publicIP,
            localIP: this.p2pManager.natInfo.localIP,
            description: this.p2pManager.natInfo.description
          };
        }

        console.log(`[Transport Diagnostics] 诊断完成: ${results.summary.availableTransports}/${results.summary.totalTransports} 传输层可用, ${results.summary.activeConnections} 活跃连接`);

      } else {
        throw new Error('P2P节点未初始化');
      }

    } catch (error) {
      results.error = error.message;
      console.error('[Transport Diagnostics] 诊断失败:', error);
    }

    return results;
  }

  /**
   * 获取传输层健康状态
   * @param {string} transport - 传输层名称
   * @returns {Object} 健康指标
   */
  getTransportHealth(transport) {
    return this.healthData.get(transport) || {
      transport,
      successCount: 0,
      failureCount: 0,
      totalLatency: 0,
      avgLatency: 0,
      successRate: 0,
      lastCheck: null
    };
  }

  /**
   * 更新传输层健康数据
   * @param {string} transport - 传输层名称
   * @param {boolean} success - 是否成功
   * @param {number} latency - 延迟（毫秒）
   */
  updateTransportHealth(transport, success, latency = 0) {
    let health = this.healthData.get(transport);

    if (!health) {
      health = {
        transport,
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        avgLatency: 0,
        successRate: 0,
        lastCheck: null
      };
      this.healthData.set(transport, health);
    }

    if (success) {
      health.successCount++;
      health.totalLatency += latency;
      health.avgLatency = health.totalLatency / health.successCount;
    } else {
      health.failureCount++;
    }

    const total = health.successCount + health.failureCount;
    const oldSuccessRate = health.successRate;
    health.successRate = total > 0 ? (health.successCount / total) * 100 : 0;
    health.lastCheck = Date.now();

    // 只在首次检测或成功率变化超过10%时记录
    const rateChanged = Math.abs(health.successRate - oldSuccessRate) > 10;
    if (total === 1 || rateChanged) {
      console.log(`[Transport Diagnostics] ${transport} 健康更新: 成功率 ${health.successRate.toFixed(1)}%, 平均延迟 ${health.avgLatency.toFixed(0)}ms`);
    }
  }

  /**
   * 开始健康监控
   * @param {number} interval - 监控间隔（毫秒）
   */
  startHealthMonitoring(interval = 60000) {
    if (this.monitoringInterval) {
      console.warn('[Transport Diagnostics] 健康监控已在运行');
      return;
    }

    console.log(`[Transport Diagnostics] 启动健康监控，间隔: ${interval}ms`);

    this.monitoringInterval = setInterval(async () => {
      try {
        const transports = ['tcp', 'websocket', 'webrtc'];

        for (const transport of transports) {
          const result = await this.testTransport(transport);
          this.updateTransportHealth(transport, result.available, result.latency);
        }
      } catch (error) {
        console.error('[Transport Diagnostics] 健康监控错误:', error);
      }
    }, interval);
  }

  /**
   * 停止健康监控
   */
  stopHealthMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[Transport Diagnostics] 健康监控已停止');
    }
  }

  /**
   * 获取所有传输层的健康报告
   * @returns {Object} 健康报告
   */
  getHealthReport() {
    const report = {
      timestamp: Date.now(),
      transports: {}
    };

    for (const [transport, health] of this.healthData.entries()) {
      report.transports[transport] = { ...health };
    }

    return report;
  }

  /**
   * 清除健康数据
   */
  clearHealthData() {
    this.healthData.clear();
    console.log('[Transport Diagnostics] 健康数据已清除');
  }
}

module.exports = TransportDiagnostics;
