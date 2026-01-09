/**
 * WebRTC连接质量监控器
 *
 * 功能：
 * - 监控WebRTC连接质量
 * - 收集连接统计信息
 * - 检测连接问题
 * - 提供优化建议
 */

const EventEmitter = require('events');

/**
 * 连接质量等级
 */
const QualityLevel = {
  EXCELLENT: 'excellent',  // 优秀
  GOOD: 'good',           // 良好
  FAIR: 'fair',           // 一般
  POOR: 'poor',           // 较差
  CRITICAL: 'critical'    // 严重
};

/**
 * WebRTC质量监控器类
 */
class WebRTCQualityMonitor extends EventEmitter {
  constructor(p2pManager, options = {}) {
    super();

    this.p2pManager = p2pManager;
    this.options = {
      monitorInterval: options.monitorInterval || 5000,  // 监控间隔（毫秒）
      statsRetention: options.statsRetention || 100,     // 保留统计数据条数
      alertThresholds: {
        packetLoss: options.packetLossThreshold || 5,    // 丢包率阈值（%）
        rtt: options.rttThreshold || 300,                // RTT阈值（毫秒）
        jitter: options.jitterThreshold || 50,           // 抖动阈值（毫秒）
        bandwidth: options.bandwidthThreshold || 100000  // 带宽阈值（bps）
      }
    };

    this.connections = new Map();  // peerId -> connection stats
    this.monitorTimer = null;
    this.isMonitoring = false;
  }

  /**
   * 开始监控
   */
  start() {
    if (this.isMonitoring) {
      console.warn('[WebRTC Monitor] 监控已在运行');
      return;
    }

    console.log('[WebRTC Monitor] 开始监控WebRTC连接质量');
    this.isMonitoring = true;

    // 定期收集统计信息
    this.monitorTimer = setInterval(() => {
      this.collectStats();
    }, this.options.monitorInterval);

    // 监听连接事件
    this.setupEventListeners();
  }

  /**
   * 停止监控
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }

    console.log('[WebRTC Monitor] 停止监控');
    this.isMonitoring = false;

    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (!this.p2pManager || !this.p2pManager.node) {
      return;
    }

    // 监听新连接
    this.p2pManager.node.addEventListener('peer:connect', (event) => {
      const peerId = event.detail.toString();
      console.log(`[WebRTC Monitor] 新连接: ${peerId}`);
      this.initializeConnectionStats(peerId);
    });

    // 监听连接断开
    this.p2pManager.node.addEventListener('peer:disconnect', (event) => {
      const peerId = event.detail.toString();
      console.log(`[WebRTC Monitor] 连接断开: ${peerId}`);
      this.connections.delete(peerId);
    });
  }

  /**
   * 初始化连接统计信息
   */
  initializeConnectionStats(peerId) {
    this.connections.set(peerId, {
      peerId,
      startTime: Date.now(),
      stats: [],
      currentQuality: QualityLevel.GOOD,
      alerts: []
    });
  }

  /**
   * 收集统计信息
   */
  async collectStats() {
    if (!this.p2pManager || !this.p2pManager.node) {
      return;
    }

    try {
      const connections = this.p2pManager.node.getConnections();

      for (const connection of connections) {
        const peerId = connection.remotePeer.toString();

        // 检查是否是WebRTC连接
        if (!this.isWebRTCConnection(connection)) {
          continue;
        }

        const stats = await this.getConnectionStats(connection);
        if (stats) {
          this.processStats(peerId, stats);
        }
      }
    } catch (error) {
      console.error('[WebRTC Monitor] 收集统计信息失败:', error);
    }
  }

  /**
   * 检查是否是WebRTC连接
   */
  isWebRTCConnection(connection) {
    // 检查连接的multiaddr是否包含webrtc
    const remoteAddr = connection.remoteAddr.toString();
    return remoteAddr.includes('/webrtc');
  }

  /**
   * 获取连接统计信息
   */
  async getConnectionStats(connection) {
    try {
      // 注意：libp2p的WebRTC传输可能不直接暴露RTCPeerConnection
      // 这里我们尝试获取可用的统计信息

      const stats = {
        timestamp: Date.now(),
        bytesReceived: 0,
        bytesSent: 0,
        packetsReceived: 0,
        packetsSent: 0,
        packetsLost: 0,
        rtt: 0,
        jitter: 0,
        bandwidth: 0
      };

      // 尝试从connection获取统计信息
      if (connection.stat) {
        const connStats = connection.stat;
        stats.bytesReceived = connStats.timeline.dataReceived || 0;
        stats.bytesSent = connStats.timeline.dataSent || 0;
      }

      return stats;
    } catch (error) {
      console.warn('[WebRTC Monitor] 获取连接统计失败:', error.message);
      return null;
    }
  }

  /**
   * 处理统计信息
   */
  processStats(peerId, stats) {
    let connData = this.connections.get(peerId);
    if (!connData) {
      this.initializeConnectionStats(peerId);
      connData = this.connections.get(peerId);
    }

    // 添加统计数据
    connData.stats.push(stats);

    // 保持统计数据在限制范围内
    if (connData.stats.length > this.options.statsRetention) {
      connData.stats.shift();
    }

    // 计算质量指标
    const quality = this.calculateQuality(connData.stats);
    const previousQuality = connData.currentQuality;
    connData.currentQuality = quality;

    // 检测质量变化
    if (quality !== previousQuality) {
      console.log(`[WebRTC Monitor] ${peerId} 连接质量变化: ${previousQuality} -> ${quality}`);
      this.emit('quality:change', {
        peerId,
        previousQuality,
        currentQuality: quality,
        stats: stats
      });
    }

    // 检查告警阈值
    this.checkAlerts(peerId, stats, connData);

    // 发送统计更新事件
    this.emit('stats:update', {
      peerId,
      stats,
      quality
    });
  }

  /**
   * 计算连接质量
   */
  calculateQuality(statsHistory) {
    if (statsHistory.length === 0) {
      return QualityLevel.GOOD;
    }

    const latestStats = statsHistory[statsHistory.length - 1];
    const { packetLoss, rtt, jitter } = this.calculateMetrics(statsHistory);

    // 根据多个指标综合评估质量
    let score = 100;

    // 丢包率影响（权重40%）
    if (packetLoss > 10) score -= 40;
    else if (packetLoss > 5) score -= 30;
    else if (packetLoss > 2) score -= 15;

    // RTT影响（权重30%）
    if (rtt > 500) score -= 30;
    else if (rtt > 300) score -= 20;
    else if (rtt > 150) score -= 10;

    // 抖动影响（权重30%）
    if (jitter > 100) score -= 30;
    else if (jitter > 50) score -= 20;
    else if (jitter > 30) score -= 10;

    // 根据分数确定质量等级
    if (score >= 90) return QualityLevel.EXCELLENT;
    if (score >= 75) return QualityLevel.GOOD;
    if (score >= 50) return QualityLevel.FAIR;
    if (score >= 25) return QualityLevel.POOR;
    return QualityLevel.CRITICAL;
  }

  /**
   * 计算质量指标
   */
  calculateMetrics(statsHistory) {
    if (statsHistory.length < 2) {
      return { packetLoss: 0, rtt: 0, jitter: 0, bandwidth: 0 };
    }

    const latest = statsHistory[statsHistory.length - 1];
    const previous = statsHistory[statsHistory.length - 2];

    // 计算丢包率
    const packetsSent = latest.packetsSent - previous.packetsSent;
    const packetsLost = latest.packetsLost - previous.packetsLost;
    const packetLoss = packetsSent > 0 ? (packetsLost / packetsSent) * 100 : 0;

    // RTT（往返时间）
    const rtt = latest.rtt || 0;

    // 抖动
    const jitter = latest.jitter || 0;

    // 带宽（bps）
    const timeDiff = (latest.timestamp - previous.timestamp) / 1000; // 秒
    const bytesDiff = latest.bytesReceived - previous.bytesReceived;
    const bandwidth = timeDiff > 0 ? (bytesDiff * 8) / timeDiff : 0;

    return { packetLoss, rtt, jitter, bandwidth };
  }

  /**
   * 检查告警
   */
  checkAlerts(peerId, stats, connData) {
    const metrics = this.calculateMetrics(connData.stats);
    const alerts = [];

    // 检查丢包率
    if (metrics.packetLoss > this.options.alertThresholds.packetLoss) {
      alerts.push({
        type: 'packet_loss',
        severity: metrics.packetLoss > 10 ? 'critical' : 'warning',
        message: `丢包率过高: ${metrics.packetLoss.toFixed(2)}%`,
        value: metrics.packetLoss
      });
    }

    // 检查RTT
    if (metrics.rtt > this.options.alertThresholds.rtt) {
      alerts.push({
        type: 'high_rtt',
        severity: metrics.rtt > 500 ? 'critical' : 'warning',
        message: `延迟过高: ${metrics.rtt}ms`,
        value: metrics.rtt
      });
    }

    // 检查抖动
    if (metrics.jitter > this.options.alertThresholds.jitter) {
      alerts.push({
        type: 'high_jitter',
        severity: metrics.jitter > 100 ? 'critical' : 'warning',
        message: `抖动过高: ${metrics.jitter}ms`,
        value: metrics.jitter
      });
    }

    // 检查带宽
    if (metrics.bandwidth < this.options.alertThresholds.bandwidth) {
      alerts.push({
        type: 'low_bandwidth',
        severity: 'warning',
        message: `带宽过低: ${(metrics.bandwidth / 1000).toFixed(2)} kbps`,
        value: metrics.bandwidth
      });
    }

    // 发送告警
    if (alerts.length > 0) {
      connData.alerts = alerts;
      this.emit('alert', {
        peerId,
        alerts,
        metrics
      });
    }
  }

  /**
   * 获取连接质量报告
   */
  getQualityReport(peerId) {
    const connData = this.connections.get(peerId);
    if (!connData) {
      return null;
    }

    const metrics = this.calculateMetrics(connData.stats);

    return {
      peerId,
      quality: connData.currentQuality,
      uptime: Date.now() - connData.startTime,
      metrics,
      alerts: connData.alerts,
      statsCount: connData.stats.length
    };
  }

  /**
   * 获取所有连接的质量报告
   */
  getAllQualityReports() {
    const reports = [];
    for (const [peerId, _] of this.connections) {
      const report = this.getQualityReport(peerId);
      if (report) {
        reports.push(report);
      }
    }
    return reports;
  }

  /**
   * 获取优化建议
   */
  getOptimizationSuggestions(peerId) {
    const report = this.getQualityReport(peerId);
    if (!report) {
      return [];
    }

    const suggestions = [];
    const { metrics, quality } = report;

    // 基于质量和指标提供建议
    if (metrics.packetLoss > 5) {
      suggestions.push({
        issue: '高丢包率',
        suggestion: '考虑切换到更稳定的网络连接，或启用TURN服务器中继',
        priority: 'high'
      });
    }

    if (metrics.rtt > 300) {
      suggestions.push({
        issue: '高延迟',
        suggestion: '尝试连接到地理位置更近的节点，或检查网络路由',
        priority: 'medium'
      });
    }

    if (metrics.jitter > 50) {
      suggestions.push({
        issue: '高抖动',
        suggestion: '网络不稳定，建议使用有线连接或改善WiFi信号',
        priority: 'medium'
      });
    }

    if (metrics.bandwidth < 100000) {
      suggestions.push({
        issue: '低带宽',
        suggestion: '当前带宽较低，可能影响大文件传输，建议升级网络套餐',
        priority: 'low'
      });
    }

    if (quality === QualityLevel.CRITICAL || quality === QualityLevel.POOR) {
      suggestions.push({
        issue: '连接质量差',
        suggestion: '建议重新连接或切换到其他传输协议（WebSocket/TCP）',
        priority: 'high'
      });
    }

    return suggestions;
  }
}

module.exports = {
  WebRTCQualityMonitor,
  QualityLevel
};
