/**
 * 远程控制模块集成示例
 *
 * 展示如何在主进程中初始化和使用远程控制系统
 */

const { createRemoteGateway } = require('./index');
const { logger } = require('../utils/logger');

/**
 * 初始化远程控制系统
 *
 * @param {Object} app - Electron app 实例
 * @param {Object} mainWindow - 主窗口实例
 * @returns {Promise<Object>} 远程网关实例
 */
async function initializeRemoteControl(app, mainWindow) {
  logger.info('[RemoteControl] 开始初始化远程控制系统...');

  try {
    // 1. 获取必要的依赖
    const { getDatabase } = require('../database');
    const database = getDatabase();

    // 2. 获取 P2P 管理器（假设已初始化）
    const p2pManager = global.p2pManager;
    if (!p2pManager) {
      throw new Error('P2P Manager not initialized');
    }

    // 3. 获取 DID 管理器（假设已初始化）
    const didManager = global.didManager;
    if (!didManager) {
      throw new Error('DID Manager not initialized');
    }

    // 4. 获取 U-Key 管理器（可选）
    const ukeyManager = global.ukeyManager || null;

    // 5. 获取 AI 引擎和 RAG 管理器（可选）
    const aiEngine = global.aiEngine || null;
    const ragManager = global.ragManager || null;

    // 6. 创建远程网关
    const gateway = await createRemoteGateway({
      p2pManager,
      didManager,
      ukeyManager,
      database,
      mainWindow,
      aiEngine,
      ragManager
    }, {
      enableP2P: true,
      enableWebSocket: false,  // 暂时不启用 WebSocket
      p2p: {
        requestTimeout: 30000,
        enableHeartbeat: true,
        heartbeatInterval: 30000
      },
      permission: {
        timestampWindow: 300000,        // 5 分钟
        enableRateLimit: true,
        defaultRateLimit: 100,          // 100 req/min
        highRiskRateLimit: 10,          // 10 req/min
        requireUKeyForLevel4: true
      }
    });

    // 7. 设置事件监听
    setupEventHandlers(gateway, mainWindow);

    // 8. 保存到全局
    global.remoteGateway = gateway;

    logger.info('[RemoteControl] ✅ 远程控制系统初始化完成');

    return gateway;
  } catch (error) {
    logger.error('[RemoteControl] ❌ 远程控制系统初始化失败:', error);
    throw error;
  }
}

/**
 * 设置事件处理器
 */
function setupEventHandlers(gateway, mainWindow) {
  logger.info('[RemoteControl] 设置事件处理器...');

  // 1. 设备连接事件
  gateway.on('device:connected', (peerId) => {
    logger.info(`[RemoteControl] 设备已连接: ${peerId}`);

    // 通知渲染进程
    mainWindow?.webContents.send('remote:device-connected', { peerId });
  });

  // 2. 设备注册事件
  gateway.on('device:registered', ({ peerId, did }) => {
    logger.info(`[RemoteControl] 设备已注册: ${did}`);

    // 默认授予 Normal 权限（Level 2）
    gateway.setDevicePermission(did, 2, {
      deviceName: 'Mobile Device',
      grantedBy: 'system',
      notes: 'Auto-granted on registration'
    }).catch(err => {
      logger.error('[RemoteControl] 设置设备权限失败:', err);
    });

    // 通知渲染进程
    mainWindow?.webContents.send('remote:device-registered', { peerId, did });
  });

  // 3. 设备断开事件
  gateway.on('device:disconnected', (peerId) => {
    logger.info(`[RemoteControl] 设备已断开: ${peerId}`);

    // 通知渲染进程
    mainWindow?.webContents.send('remote:device-disconnected', { peerId });
  });

  // 4. 命令完成事件
  gateway.on('command:completed', ({ method, peerId, success, duration }) => {
    logger.info(`[RemoteControl] 命令完成: ${method} (${success ? '成功' : '失败'}, ${duration}ms)`);

    // 记录到数据库（可选）
    // ...
  });

  // 5. 定期输出统计信息
  setInterval(() => {
    const stats = gateway.getStats();
    logger.info('[RemoteControl] 统计信息:', {
      totalCommands: stats.totalCommands,
      successRate: stats.successRate,
      connectedDevices: stats.connectedDevices,
      uptime: Math.floor(stats.uptime / 1000) + 's'
    });
  }, 300000); // 每 5 分钟

  logger.info('[RemoteControl] 事件处理器设置完成');
}

/**
 * 获取远程网关实例
 */
function getRemoteGateway() {
  const gateway = global.remoteGateway;
  if (!gateway) {
    throw new Error('Remote Gateway not initialized. Call initializeRemoteControl() first.');
  }
  return gateway;
}

/**
 * 关闭远程控制系统
 */
async function shutdownRemoteControl() {
  logger.info('[RemoteControl] 关闭远程控制系统...');

  try {
    const gateway = global.remoteGateway;
    if (gateway) {
      await gateway.stop();
      global.remoteGateway = null;
      logger.info('[RemoteControl] ✅ 远程控制系统已关闭');
    }
  } catch (error) {
    logger.error('[RemoteControl] ❌ 关闭远程控制系统失败:', error);
  }
}

/**
 * 使用示例
 */
async function example(mainWindow) {
  // 1. 初始化远程控制系统
  // eslint-disable-next-line no-undef
  const gateway = await initializeRemoteControl(global.app, mainWindow);

  // 2. 获取已连接设备列表
  const devices = gateway.getConnectedDevices();
  console.log('已连接设备:', devices);

  // 3. 主动发送命令到移动设备（如果需要）
  if (devices.length > 0) {
    const device = devices[0];

    try {
      const response = await gateway.sendCommand(
        device.peerId,
        'mobile.vibrate',
        { duration: 500 }
      );
      console.log('命令响应:', response);
    } catch (error) {
      console.error('发送命令失败:', error);
    }
  }

  // 4. 广播事件到所有设备
  gateway.broadcastEvent('pc.status.changed', {
    status: 'idle',
    timestamp: Date.now()
  });

  // 5. 设置设备权限
  const did = 'did:chainlesschain:abc123';
  await gateway.setDevicePermission(did, 3, {
    deviceName: 'Admin Phone',
    grantedBy: 'admin',
    expiresIn: 86400000  // 24 小时
  });

  // 6. 查看审计日志
  const logs = gateway.getAuditLogs({
    did,
    limit: 10
  });
  console.log('审计日志:', logs);

  // 7. 查看统计信息
  const stats = gateway.getStats();
  console.log('统计信息:', stats);
}

module.exports = {
  initializeRemoteControl,
  getRemoteGateway,
  shutdownRemoteControl
};
