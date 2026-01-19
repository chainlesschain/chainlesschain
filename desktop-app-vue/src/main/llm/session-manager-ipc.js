/**
 * SessionManager IPC 处理器
 * 负责处理会话管理相关的前后端通信
 *
 * @module session-manager-ipc
 * @version 1.0.0
 * @since 2026-01-16
 */

const { logger, createLogger } = require('../utils/logger.js');
const ipcGuard = require("../ipc/ipc-guard");

/**
 * 注册所有 SessionManager IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.sessionManager - SessionManager 实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）
 */
function registerSessionManagerIPC({
  sessionManager,
  ipcMain: injectedIpcMain,
}) {
  // 防止重复注册
  if (ipcGuard.isModuleRegistered("session-manager-ipc")) {
    logger.info(
      "[SessionManager IPC] Handlers already registered, skipping...",
    );
    return;
  }

  // 支持依赖注入，用于测试
  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info(
    "[SessionManager IPC] Registering SessionManager IPC handlers...",
  );

  // 创建可变的引用容器
  const managerRef = { current: sessionManager };

  // ============================================================
  // 会话管理
  // ============================================================

  /**
   * 创建新会话
   * Channel: 'session:create'
   */
  ipcMain.handle("session:create", async (_event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.createSession(params);
    } catch (error) {
      logger.error("[SessionManager IPC] 创建会话失败:", error);
      throw error;
    }
  });

  /**
   * 加载会话
   * Channel: 'session:load'
   */
  ipcMain.handle("session:load", async (_event, sessionId, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.loadSession(sessionId, options);
    } catch (error) {
      logger.error("[SessionManager IPC] 加载会话失败:", error);
      throw error;
    }
  });

  /**
   * 添加消息到会话
   * Channel: 'session:add-message'
   */
  ipcMain.handle(
    "session:add-message",
    async (_event, sessionId, message, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.addMessage(sessionId, message, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 添加消息失败:", error);
        throw error;
      }
    },
  );

  /**
   * 压缩会话历史
   * Channel: 'session:compress'
   */
  ipcMain.handle("session:compress", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.compressSession(sessionId);
    } catch (error) {
      logger.error("[SessionManager IPC] 压缩会话失败:", error);
      throw error;
    }
  });

  /**
   * 保存会话
   * Channel: 'session:save'
   */
  ipcMain.handle("session:save", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      await managerRef.current.saveSession(sessionId);
      return { success: true };
    } catch (error) {
      logger.error("[SessionManager IPC] 保存会话失败:", error);
      throw error;
    }
  });

  /**
   * 获取有效消息（用于 LLM 调用）
   * Channel: 'session:get-effective-messages'
   */
  ipcMain.handle(
    "session:get-effective-messages",
    async (_event, sessionId) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.getEffectiveMessages(sessionId);
      } catch (error) {
        logger.error("[SessionManager IPC] 获取有效消息失败:", error);
        throw error;
      }
    },
  );

  /**
   * 删除会话
   * Channel: 'session:delete'
   */
  ipcMain.handle("session:delete", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      await managerRef.current.deleteSession(sessionId);
      return { success: true };
    } catch (error) {
      logger.error("[SessionManager IPC] 删除会话失败:", error);
      throw error;
    }
  });

  /**
   * 列出会话
   * Channel: 'session:list'
   */
  ipcMain.handle("session:list", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.listSessions(options);
    } catch (error) {
      logger.error("[SessionManager IPC] 列出会话失败:", error);
      throw error;
    }
  });

  /**
   * 获取会话统计
   * Channel: 'session:get-stats'
   */
  ipcMain.handle("session:get-stats", async (_event, sessionId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.getSessionStats(sessionId);
    } catch (error) {
      logger.error("[SessionManager IPC] 获取统计失败:", error);
      throw error;
    }
  });

  /**
   * 清理旧会话
   * Channel: 'session:cleanup-old'
   */
  ipcMain.handle("session:cleanup-old", async (_event, daysToKeep = 30) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      const deletedCount =
        await managerRef.current.cleanupOldSessions(daysToKeep);
      return {
        success: true,
        deletedCount,
      };
    } catch (error) {
      logger.error("[SessionManager IPC] 清理旧会话失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 搜索功能
  // ============================================================

  /**
   * 搜索会话
   * Channel: 'session:search'
   */
  ipcMain.handle("session:search", async (_event, query, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.searchSessions(query, options);
    } catch (error) {
      logger.error("[SessionManager IPC] 搜索会话失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 标签功能
  // ============================================================

  /**
   * 添加标签
   * Channel: 'session:add-tags'
   */
  ipcMain.handle("session:add-tags", async (_event, sessionId, tags) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.addTags(sessionId, tags);
    } catch (error) {
      logger.error("[SessionManager IPC] 添加标签失败:", error);
      throw error;
    }
  });

  /**
   * 移除标签
   * Channel: 'session:remove-tags'
   */
  ipcMain.handle("session:remove-tags", async (_event, sessionId, tags) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.removeTags(sessionId, tags);
    } catch (error) {
      logger.error("[SessionManager IPC] 移除标签失败:", error);
      throw error;
    }
  });

  /**
   * 获取所有标签
   * Channel: 'session:get-all-tags'
   */
  ipcMain.handle("session:get-all-tags", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.getAllTags();
    } catch (error) {
      logger.error("[SessionManager IPC] 获取标签失败:", error);
      throw error;
    }
  });

  /**
   * 按标签查找会话
   * Channel: 'session:find-by-tags'
   */
  ipcMain.handle("session:find-by-tags", async (_event, tags, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.findSessionsByTags(tags, options);
    } catch (error) {
      logger.error("[SessionManager IPC] 按标签查找失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 导出/导入功能
  // ============================================================

  /**
   * 导出会话为 JSON
   * Channel: 'session:export-json'
   */
  ipcMain.handle(
    "session:export-json",
    async (_event, sessionId, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.exportToJSON(sessionId, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 导出 JSON 失败:", error);
        throw error;
      }
    },
  );

  /**
   * 导出会话为 Markdown
   * Channel: 'session:export-markdown'
   */
  ipcMain.handle(
    "session:export-markdown",
    async (_event, sessionId, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.exportToMarkdown(sessionId, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 导出 Markdown 失败:", error);
        throw error;
      }
    },
  );

  /**
   * 从 JSON 导入会话
   * Channel: 'session:import-json'
   */
  ipcMain.handle(
    "session:import-json",
    async (_event, jsonData, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.importFromJSON(jsonData, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 导入 JSON 失败:", error);
        throw error;
      }
    },
  );

  /**
   * 批量导出会话
   * Channel: 'session:export-multiple'
   */
  ipcMain.handle(
    "session:export-multiple",
    async (_event, sessionIds, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.exportMultiple(sessionIds, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 批量导出失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 摘要功能
  // ============================================================

  /**
   * 生成会话摘要
   * Channel: 'session:generate-summary'
   */
  ipcMain.handle(
    "session:generate-summary",
    async (_event, sessionId, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.generateSummary(sessionId, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 生成摘要失败:", error);
        throw error;
      }
    },
  );

  /**
   * 批量生成摘要
   * Channel: 'session:generate-summaries-batch'
   */
  ipcMain.handle(
    "session:generate-summaries-batch",
    async (_event, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.generateSummariesBatch(options);
      } catch (error) {
        logger.error("[SessionManager IPC] 批量生成摘要失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 自动摘要功能
  // ============================================================

  /**
   * 获取自动摘要配置
   * Channel: 'session:get-auto-summary-config'
   */
  ipcMain.handle("session:get-auto-summary-config", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return managerRef.current.getAutoSummaryConfig();
    } catch (error) {
      logger.error("[SessionManager IPC] 获取自动摘要配置失败:", error);
      throw error;
    }
  });

  /**
   * 更新自动摘要配置
   * Channel: 'session:update-auto-summary-config'
   */
  ipcMain.handle(
    "session:update-auto-summary-config",
    async (_event, config) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return managerRef.current.updateAutoSummaryConfig(config);
      } catch (error) {
        logger.error("[SessionManager IPC] 更新自动摘要配置失败:", error);
        throw error;
      }
    },
  );

  /**
   * 启动后台摘要生成器
   * Channel: 'session:start-background-summary'
   */
  ipcMain.handle("session:start-background-summary", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      managerRef.current.startBackgroundSummaryGenerator();
      return { success: true };
    } catch (error) {
      logger.error("[SessionManager IPC] 启动后台摘要生成器失败:", error);
      throw error;
    }
  });

  /**
   * 停止后台摘要生成器
   * Channel: 'session:stop-background-summary'
   */
  ipcMain.handle("session:stop-background-summary", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      managerRef.current.stopBackgroundSummaryGenerator();
      return { success: true };
    } catch (error) {
      logger.error("[SessionManager IPC] 停止后台摘要生成器失败:", error);
      throw error;
    }
  });

  /**
   * 获取没有摘要的会话列表
   * Channel: 'session:get-without-summary'
   */
  ipcMain.handle(
    "session:get-without-summary",
    async (_event, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.getSessionsWithoutSummary(options);
      } catch (error) {
        logger.error("[SessionManager IPC] 获取无摘要会话失败:", error);
        throw error;
      }
    },
  );

  /**
   * 触发批量摘要生成
   * Channel: 'session:trigger-bulk-summary'
   */
  ipcMain.handle(
    "session:trigger-bulk-summary",
    async (_event, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.triggerBulkSummaryGeneration(options);
      } catch (error) {
        logger.error("[SessionManager IPC] 触发批量摘要生成失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取自动摘要统计
   * Channel: 'session:get-auto-summary-stats'
   */
  ipcMain.handle("session:get-auto-summary-stats", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.getAutoSummaryStats();
    } catch (error) {
      logger.error("[SessionManager IPC] 获取自动摘要统计失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 会话续接功能
  // ============================================================

  /**
   * 恢复会话
   * Channel: 'session:resume'
   */
  ipcMain.handle("session:resume", async (_event, sessionId, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.resumeSession(sessionId, options);
    } catch (error) {
      logger.error("[SessionManager IPC] 恢复会话失败:", error);
      throw error;
    }
  });

  /**
   * 获取最近的会话
   * Channel: 'session:get-recent'
   */
  ipcMain.handle("session:get-recent", async (_event, count = 5) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.getRecentSessions(count);
    } catch (error) {
      logger.error("[SessionManager IPC] 获取最近会话失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 模板功能
  // ============================================================

  /**
   * 保存为模板
   * Channel: 'session:save-as-template'
   */
  ipcMain.handle(
    "session:save-as-template",
    async (_event, sessionId, templateInfo) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.saveAsTemplate(sessionId, templateInfo);
      } catch (error) {
        logger.error("[SessionManager IPC] 保存模板失败:", error);
        throw error;
      }
    },
  );

  /**
   * 从模板创建会话
   * Channel: 'session:create-from-template'
   */
  ipcMain.handle(
    "session:create-from-template",
    async (_event, templateId, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.createFromTemplate(templateId, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 从模板创建失败:", error);
        throw error;
      }
    },
  );

  /**
   * 列出模板
   * Channel: 'session:list-templates'
   */
  ipcMain.handle("session:list-templates", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.listTemplates(options);
    } catch (error) {
      logger.error("[SessionManager IPC] 列出模板失败:", error);
      throw error;
    }
  });

  /**
   * 删除模板
   * Channel: 'session:delete-template'
   */
  ipcMain.handle("session:delete-template", async (_event, templateId) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      await managerRef.current.deleteTemplate(templateId);
      return { success: true };
    } catch (error) {
      logger.error("[SessionManager IPC] 删除模板失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 批量操作
  // ============================================================

  /**
   * 批量删除会话
   * Channel: 'session:delete-multiple'
   */
  ipcMain.handle("session:delete-multiple", async (_event, sessionIds) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.deleteMultiple(sessionIds);
    } catch (error) {
      logger.error("[SessionManager IPC] 批量删除失败:", error);
      throw error;
    }
  });

  /**
   * 批量添加标签
   * Channel: 'session:add-tags-multiple'
   */
  ipcMain.handle(
    "session:add-tags-multiple",
    async (_event, sessionIds, tags) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.addTagsToMultiple(sessionIds, tags);
      } catch (error) {
        logger.error("[SessionManager IPC] 批量添加标签失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 统计和其他
  // ============================================================

  /**
   * 获取全局统计
   * Channel: 'session:get-global-stats'
   */
  ipcMain.handle("session:get-global-stats", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.getGlobalStats();
    } catch (error) {
      logger.error("[SessionManager IPC] 获取全局统计失败:", error);
      throw error;
    }
  });

  /**
   * 更新会话标题
   * Channel: 'session:update-title'
   */
  ipcMain.handle("session:update-title", async (_event, sessionId, title) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.updateTitle(sessionId, title);
    } catch (error) {
      logger.error("[SessionManager IPC] 更新标题失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 会话复制功能
  // ============================================================

  /**
   * 复制会话
   * Channel: 'session:duplicate'
   */
  ipcMain.handle(
    "session:duplicate",
    async (_event, sessionId, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.duplicateSession(sessionId, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 复制会话失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 标签管理功能
  // ============================================================

  /**
   * 重命名标签
   * Channel: 'session:rename-tag'
   */
  ipcMain.handle("session:rename-tag", async (_event, oldTag, newTag) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.renameTag(oldTag, newTag);
    } catch (error) {
      logger.error("[SessionManager IPC] 重命名标签失败:", error);
      throw error;
    }
  });

  /**
   * 合并标签
   * Channel: 'session:merge-tags'
   */
  ipcMain.handle(
    "session:merge-tags",
    async (_event, sourceTags, targetTag) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.mergeTags(sourceTags, targetTag);
      } catch (error) {
        logger.error("[SessionManager IPC] 合并标签失败:", error);
        throw error;
      }
    },
  );

  /**
   * 删除标签
   * Channel: 'session:delete-tag'
   */
  ipcMain.handle("session:delete-tag", async (_event, tag) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.deleteTag(tag);
    } catch (error) {
      logger.error("[SessionManager IPC] 删除标签失败:", error);
      throw error;
    }
  });

  /**
   * 批量删除标签
   * Channel: 'session:delete-tags'
   */
  ipcMain.handle("session:delete-tags", async (_event, tags) => {
    try {
      if (!managerRef.current) {
        throw new Error("SessionManager 未初始化");
      }

      return await managerRef.current.deleteTags(tags);
    } catch (error) {
      logger.error("[SessionManager IPC] 批量删除标签失败:", error);
      throw error;
    }
  });

  /**
   * 获取标签详情
   * Channel: 'session:get-tag-details'
   */
  ipcMain.handle(
    "session:get-tag-details",
    async (_event, tag, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("SessionManager 未初始化");
        }

        return await managerRef.current.getTagDetails(tag, options);
      } catch (error) {
        logger.error("[SessionManager IPC] 获取标签详情失败:", error);
        throw error;
      }
    },
  );

  /**
   * 更新 SessionManager 引用
   * 用于热重载或重新初始化
   * @param {SessionManager} newSessionManager - 新的 SessionManager 实例
   */
  function updateSessionManager(newSessionManager) {
    managerRef.current = newSessionManager;
    logger.info("[SessionManager IPC] SessionManager 引用已更新");
  }

  // 标记为已注册
  ipcGuard.markModuleRegistered("session-manager-ipc");

  logger.info(
    "[SessionManager IPC] SessionManager IPC handlers registered successfully",
  );

  // 返回更新函数，供主进程使用
  return {
    updateSessionManager,
  };
}

module.exports = {
  registerSessionManagerIPC,
};
