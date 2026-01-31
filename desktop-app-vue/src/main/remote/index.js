/**
 * 远程控制模块 - 主入口
 *
 * 提供统一的初始化和导出接口
 *
 * @module remote
 */

const RemoteGateway = require('./remote-gateway');
const { P2PCommandAdapter } = require('./p2p-command-adapter');
const { PermissionGate, PERMISSION_LEVELS } = require('./permission-gate');
const { CommandRouter } = require('./command-router');

// 导出命令处理器
const AICommandHandler = require('./handlers/ai-handler');
const SystemCommandHandler = require('./handlers/system-handler');
const { FileTransferHandler } = require('./handlers/file-transfer-handler');
const { RemoteDesktopHandler } = require('./handlers/remote-desktop-handler');

/**
 * 创建并初始化远程网关
 *
 * @param {Object} dependencies - 依赖项
 * @param {Object} dependencies.p2pManager - P2P 管理器实例
 * @param {Object} dependencies.didManager - DID 管理器实例
 * @param {Object} dependencies.ukeyManager - U-Key 管理器实例（可选）
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.aiEngine - AI 引擎实例（可选）
 * @param {Object} dependencies.ragManager - RAG 管理器实例（可选）
 * @param {Object} options - 配置选项
 * @returns {Promise<RemoteGateway>} 远程网关实例
 */
async function createRemoteGateway(dependencies, options = {}) {
  const gateway = new RemoteGateway(dependencies, options);
  await gateway.initialize();
  return gateway;
}

module.exports = {
  // 主要导出
  RemoteGateway,
  createRemoteGateway,

  // 核心组件
  P2PCommandAdapter,
  PermissionGate,
  CommandRouter,

  // 命令处理器
  AICommandHandler,
  SystemCommandHandler,
  FileTransferHandler,
  RemoteDesktopHandler,

  // 常量
  PERMISSION_LEVELS
};
