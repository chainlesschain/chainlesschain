/**
 * StreamController 管理器
 * 负责管理所有活动的流式输出会话
 *
 * @module stream-controller-manager
 * @description 提供全局的StreamController管理，支持暂停、恢复、取消等操作
 */

const { logger } = require("../utils/logger.js");
const { createStreamController } = require("../llm/stream-controller");

/**
 * StreamController 管理器类
 * 单例模式，全局管理所有流式会话
 */
class StreamControllerManager {
  constructor() {
    /** @type {Map<string, StreamController>} 存储所有活动的controller */
    this.controllers = new Map();

    /** @type {Map<string, Object>} 存储会话元数据 */
    this.metadata = new Map();

    logger.info("[StreamControllerManager] 初始化完成");
  }

  /**
   * 创建新的StreamController
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 控制器选项
   * @returns {StreamController} 控制器实例
   */
  create(conversationId, options = {}) {
    if (this.controllers.has(conversationId)) {
      logger.warn(
        `[StreamControllerManager] 对话 ${conversationId} 已存在controller，将销毁旧的`,
      );
      this.delete(conversationId);
    }

    const controller = createStreamController({
      enableBuffering: true,
      ...options,
    });

    this.controllers.set(conversationId, controller);
    this.metadata.set(conversationId, {
      createdAt: Date.now(),
      conversationId,
      options,
    });

    logger.info(`[StreamControllerManager] 创建controller: ${conversationId}`);

    // 监听controller事件
    controller.on("complete", () => {
      logger.info(`[StreamControllerManager] 对话 ${conversationId} 完成`);
      // 完成后可以选择自动清理或保留统计信息
      // this.delete(conversationId);
    });

    controller.on("stream-error", (data) => {
      logger.error(
        `[StreamControllerManager] 对话 ${conversationId} 出错:`,
        data.error,
      );
    });

    controller.on("cancel", () => {
      logger.info(`[StreamControllerManager] 对话 ${conversationId} 已取消`);
      // 取消后延迟清理，给前端足够时间获取状态
      setTimeout(() => {
        this.delete(conversationId);
      }, 5000);
    });

    return controller;
  }

  /**
   * 获取指定对话的controller
   * @param {string} conversationId - 对话ID
   * @returns {StreamController|null} 控制器实例或null
   */
  get(conversationId) {
    return this.controllers.get(conversationId) || null;
  }

  /**
   * 检查controller是否存在
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否存在
   */
  has(conversationId) {
    return this.controllers.has(conversationId);
  }

  /**
   * 删除controller
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否成功删除
   */
  delete(conversationId) {
    const controller = this.controllers.get(conversationId);
    if (controller) {
      controller.destroy();
      this.controllers.delete(conversationId);
      this.metadata.delete(conversationId);
      logger.info(
        `[StreamControllerManager] 删除controller: ${conversationId}`,
      );
      return true;
    }
    return false;
  }

  /**
   * 暂停流式输出
   * @param {string} conversationId - 对话ID
   * @returns {Object} 操作结果
   */
  pause(conversationId) {
    const controller = this.get(conversationId);
    if (!controller) {
      return {
        success: false,
        error: "对话不存在或未在流式输出",
      };
    }

    try {
      controller.pause();
      logger.info(`[StreamControllerManager] 暂停对话: ${conversationId}`);
      return {
        success: true,
        status: controller.status,
      };
    } catch (error) {
      logger.error(`[StreamControllerManager] 暂停失败:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 恢复流式输出
   * @param {string} conversationId - 对话ID
   * @returns {Object} 操作结果
   */
  resume(conversationId) {
    const controller = this.get(conversationId);
    if (!controller) {
      return {
        success: false,
        error: "对话不存在或未在流式输出",
      };
    }

    try {
      controller.resume();
      logger.info(`[StreamControllerManager] 恢复对话: ${conversationId}`);
      return {
        success: true,
        status: controller.status,
      };
    } catch (error) {
      logger.error(`[StreamControllerManager] 恢复失败:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 取消流式输出
   * @param {string} conversationId - 对话ID
   * @param {string} reason - 取消原因
   * @returns {Object} 操作结果
   */
  cancel(conversationId, reason = "用户取消") {
    const controller = this.get(conversationId);
    if (!controller) {
      return {
        success: false,
        error: "对话不存在或未在流式输出",
      };
    }

    try {
      controller.cancel(reason);
      logger.info(
        `[StreamControllerManager] 取消对话: ${conversationId}, 原因: ${reason}`,
      );
      return {
        success: true,
        status: controller.status,
        reason,
      };
    } catch (error) {
      logger.error(`[StreamControllerManager] 取消失败:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取流式输出统计信息
   * @param {string} conversationId - 对话ID
   * @returns {Object} 统计信息或错误
   */
  getStats(conversationId) {
    const controller = this.get(conversationId);
    if (!controller) {
      return {
        success: false,
        error: "对话不存在或未在流式输出",
      };
    }

    try {
      const stats = controller.getStats();
      const metadata = this.metadata.get(conversationId);

      return {
        success: true,
        stats: {
          ...stats,
          conversationId,
          metadata,
        },
      };
    } catch (error) {
      logger.error(`[StreamControllerManager] 获取统计信息失败:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取所有活动会话
   * @returns {Array<Object>} 会话列表
   */
  getAllActiveSessions() {
    const sessions = [];
    for (const [conversationId, controller] of this.controllers.entries()) {
      const metadata = this.metadata.get(conversationId);
      sessions.push({
        conversationId,
        status: controller.status,
        stats: controller.getStats(),
        metadata,
      });
    }
    return sessions;
  }

  /**
   * 清理所有已完成或已取消的会话
   * @returns {number} 清理的数量
   */
  cleanup() {
    let cleanedCount = 0;
    for (const [conversationId, controller] of this.controllers.entries()) {
      if (
        controller.status === "completed" ||
        controller.status === "cancelled" ||
        controller.status === "error"
      ) {
        this.delete(conversationId);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      logger.info(
        `[StreamControllerManager] 清理了 ${cleanedCount} 个已结束的会话`,
      );
    }
    return cleanedCount;
  }

  /**
   * 销毁所有controller
   */
  destroyAll() {
    logger.info(
      `[StreamControllerManager] 销毁所有controller (共 ${this.controllers.size} 个)`,
    );
    for (const [conversationId] of this.controllers.entries()) {
      this.delete(conversationId);
    }
  }

  /**
   * 获取管理器状态
   * @returns {Object} 管理器状态信息
   */
  getManagerStats() {
    const stats = {
      totalSessions: this.controllers.size,
      activeSessions: 0,
      pausedSessions: 0,
      completedSessions: 0,
      cancelledSessions: 0,
      errorSessions: 0,
    };

    for (const controller of this.controllers.values()) {
      switch (controller.status) {
        case "running":
          stats.activeSessions++;
          break;
        case "paused":
          stats.pausedSessions++;
          break;
        case "completed":
          stats.completedSessions++;
          break;
        case "cancelled":
          stats.cancelledSessions++;
          break;
        case "error":
          stats.errorSessions++;
          break;
      }
    }

    return stats;
  }
}

// 单例实例
let instance = null;

/**
 * 获取StreamControllerManager单例
 * @returns {StreamControllerManager} 管理器实例
 */
function getStreamControllerManager() {
  if (!instance) {
    instance = new StreamControllerManager();
  }
  return instance;
}

/**
 * 重置管理器（主要用于测试）
 */
function resetStreamControllerManager() {
  if (instance) {
    instance.destroyAll();
    instance = null;
  }
}

module.exports = {
  StreamControllerManager,
  getStreamControllerManager,
  resetStreamControllerManager,
};
