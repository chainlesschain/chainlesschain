/**
 * PC Status Handler - PC状态监控处理器
 *
 * 功能：
 * - 提供PC端系统信息
 * - 实时监控CPU、内存、磁盘使用情况
 * - 监控AI服务状态
 * - 监控数据库状态
 */

const EventEmitter = require('events');
const os = require('os');
const fs = require('fs').promises;

class PCStatusHandler extends EventEmitter {
  constructor(p2pManager, mobileBridge) {
    super();

    this.p2pManager = p2pManager;
    this.mobileBridge = mobileBridge;

    // 状态缓存
    this.statusCache = {
      system: null,
      services: null,
      lastUpdate: null
    };

    // 更新间隔（30秒）
    this.updateInterval = 30000;
    this.updateTimer = null;

    // 启动定期更新
    this.startStatusUpdates();
  }

  /**
   * 统一消息处理入口
   */
  async handleMessage(mobilePeerId, message) {
    const { type } = message;

    switch (type) {
      case 'pc-status:get-system-info':
        await this.handleGetSystemInfo(mobilePeerId, message);
        break;

      case 'pc-status:get-services-status':
      case 'pc-status:get-services':
        await this.handleGetServices(mobilePeerId, message);
        break;

      case 'pc-status:get-realtime':
        await this.handleGetRealtime(mobilePeerId, message);
        break;

      case 'pc-status:subscribe':
        await this.handleSubscribe(mobilePeerId, message);
        break;

      default:
        console.warn(`[PCStatus] 未知消息类型: ${type}`);
        return {
          error: {
            code: 'UNKNOWN_TYPE',
            message: `Unknown PC status message type: ${type}`
          }
        };
    }

    return undefined;
  }

  /**
   * 处理获取系统信息请求
   */
  async handleGetSystemInfo(mobilePeerId, message) {
    console.log('[PCStatus] 处理系统信息请求');

    try {
      const systemInfo = await this.getSystemInfo();

      await this.sendToMobile(mobilePeerId, {
        type: 'pc-status:get-system-info:response',
        requestId: message.requestId,
        data: { systemInfo }
      });

      console.log('[PCStatus] ✅ 系统信息已发送');

    } catch (error) {
      console.error('[PCStatus] 处理系统信息请求失败:', error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理获取服务状态请求
   */
  async handleGetServices(mobilePeerId, message) {
    console.log('[PCStatus] 处理服务状态请求');

    try {
      const services = await this.getServicesStatus();

      await this.sendToMobile(mobilePeerId, {
        type: 'pc-status:get-services:response',
        requestId: message.requestId,
        data: { services }
      });

      console.log('[PCStatus] ✅ 服务状态已发送');

    } catch (error) {
      console.error('[PCStatus] 处理服务状态请求失败:', error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理获取实时状态请求
   */
  async handleGetRealtime(mobilePeerId, message) {
    console.log('[PCStatus] 处理实时状态请求');

    try {
      const realtimeStatus = await this.getRealtimeStatus();

      await this.sendToMobile(mobilePeerId, {
        type: 'pc-status:get-realtime:response',
        requestId: message.requestId,
        data: realtimeStatus
      });

      console.log('[PCStatus] ✅ 实时状态已发送');

    } catch (error) {
      console.error('[PCStatus] 处理实时状态请求失败:', error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理订阅状态更新请求
   */
  async handleSubscribe(mobilePeerId, message) {
    console.log('[PCStatus] 处理订阅请求');

    try {
      const { interval = 30000 } = message.params || {};

      // 创建订阅
      this.emit('status-subscription', { mobilePeerId, interval });

      await this.sendToMobile(mobilePeerId, {
        type: 'pc-status:subscribe:response',
        requestId: message.requestId,
        data: { subscribed: true, interval }
      });

      console.log('[PCStatus] ✅ 订阅成功:', mobilePeerId);

    } catch (error) {
      console.error('[PCStatus] 处理订阅请求失败:', error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 获取系统信息
   */
  async getSystemInfo() {
    const cpus = os.cpus();

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuModel: cpus[0]?.model || 'Unknown',
      cpuCores: cpus.length,
      nodeVersion: process.version,
      appVersion: process.env.npm_package_version || '0.16.0'
    };
  }

  /**
   * 获取服务状态
   */
  async getServicesStatus() {
    const services = [];

    // 检查数据库服务
    try {
      const { getDatabase } = require('../database');
      const db = getDatabase();
      const { count } = await db.get('SELECT COUNT(*) as count FROM notes');

      services.push({
        name: 'Database',
        status: 'running',
        type: 'sqlite',
        details: {
          notesCount: count
        }
      });
    } catch (error) {
      services.push({
        name: 'Database',
        status: 'error',
        error: error.message
      });
    }

    // 检查P2P服务
    if (this.p2pManager) {
      services.push({
        name: 'P2P Network',
        status: this.p2pManager.node ? 'running' : 'stopped',
        details: {
          peerId: this.p2pManager.peerId?.toString() || 'N/A',
          connectedPeers: this.p2pManager.connectionPool ?
            this.p2pManager.connectionPool.getStats().total : 0
        }
      });
    }

    // 检查LLM服务（如果已配置）
    try {
      const { getDatabase } = require('../database');
      const db = getDatabase();
      const llmConfig = await db.get('SELECT value FROM settings WHERE key = ?', ['llm.provider']);

      services.push({
        name: 'LLM Service',
        status: llmConfig ? 'configured' : 'not-configured',
        details: {
          provider: llmConfig?.value || 'none'
        }
      });
    } catch (error) {
      services.push({
        name: 'LLM Service',
        status: 'unknown',
        error: error.message
      });
    }

    return services;
  }

  /**
   * 获取实时状态
   */
  async getRealtimeStatus() {
    const cpus = os.cpus();

    // 计算CPU使用率
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const cpuUsage = 100 - Math.floor((totalIdle / totalTick) * 100);

    // 内存使用情况
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = Math.floor((usedMemory / totalMemory) * 100);

    // 磁盘使用情况（仅支持部分平台）
    let diskUsage = null;
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        // 在Unix系统上可以读取
        const { execSync } = require('child_process');
        const dfOutput = execSync('df -k /').toString();
        const lines = dfOutput.split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          diskUsage = {
            total: parseInt(parts[1]) * 1024,
            used: parseInt(parts[2]) * 1024,
            available: parseInt(parts[3]) * 1024,
            usagePercent: parseInt(parts[4])
          };
        }
      }
    } catch (error) {
      console.warn('[PCStatus] 无法获取磁盘使用情况:', error.message);
    }

    return {
      cpu: {
        usage: cpuUsage,
        cores: cpus.length,
        temperature: null // 需要额外的系统工具
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usagePercent: memoryUsagePercent
      },
      disk: diskUsage,
      network: {
        // TODO: 实现网络流量监控
        bytesReceived: 0,
        bytesSent: 0
      },
      timestamp: Date.now()
    };
  }

  /**
   * 启动定期状态更新
   */
  startStatusUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    this.updateTimer = setInterval(async () => {
      try {
        this.statusCache.system = await this.getSystemInfo();
        this.statusCache.services = await this.getServicesStatus();
        this.statusCache.lastUpdate = Date.now();
      } catch (error) {
        console.error('[PCStatus] 更新状态缓存失败:', error);
      }
    }, this.updateInterval);
  }

  /**
   * 停止状态更新
   */
  stopStatusUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * 发送消息到移动端
   */
  async sendToMobile(mobilePeerId, message) {
    if (this.mobileBridge) {
      await this.mobileBridge.send({
        type: 'message',
        to: mobilePeerId,
        payload: message
      });
    } else {
      console.error('[PCStatus] MobileBridge未初始化');
    }
  }

  /**
   * 发送错误响应
   */
  async sendError(mobilePeerId, requestId, errorMessage) {
    await this.sendToMobile(mobilePeerId, {
      type: 'error',
      requestId,
      error: errorMessage
    });
  }

  /**
   * 清理资源
   */
  destroy() {
    this.stopStatusUpdates();
    this.removeAllListeners();
  }
}

module.exports = PCStatusHandler;
