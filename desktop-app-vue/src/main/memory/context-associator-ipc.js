/**
 * ContextAssociator IPC Handlers
 * Handles IPC communication for context association
 *
 * @module context-associator-ipc
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger, createLogger } = require('../utils/logger.js');
const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all ContextAssociator IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.contextAssociator - ContextAssociator instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerContextAssociatorIPC({
  contextAssociator,
  ipcMain: injectedIpcMain,
}) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("context-associator-ipc")) {
    logger.info(
      "[ContextAssociator IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  logger.info(
    "[ContextAssociator IPC] Registering ContextAssociator IPC handlers...",
  );

  // Create mutable reference for hot-reload support
  const associatorRef = { current: contextAssociator };

  // ============================================================
  // Knowledge Extraction
  // ============================================================

  /**
   * Extract knowledge from session
   * Channel: 'context:extract-knowledge'
   */
  ipcMain.handle(
    "context:extract-knowledge",
    async (_event, sessionId, options = {}) => {
      try {
        if (!associatorRef.current) {
          throw new Error("ContextAssociator not initialized");
        }
        return await associatorRef.current.extractKnowledgeFromSession(
          sessionId,
          options,
        );
      } catch (error) {
        logger.error(
          "[ContextAssociator IPC] Extract knowledge failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Get session knowledge
   * Channel: 'context:get-session-knowledge'
   */
  ipcMain.handle(
    "context:get-session-knowledge",
    async (_event, sessionId, options = {}) => {
      try {
        if (!associatorRef.current) {
          throw new Error("ContextAssociator not initialized");
        }
        return await associatorRef.current.getSessionKnowledge(
          sessionId,
          options,
        );
      } catch (error) {
        logger.error(
          "[ContextAssociator IPC] Get session knowledge failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Session Associations
  // ============================================================

  /**
   * Find related sessions
   * Channel: 'context:find-related'
   */
  ipcMain.handle(
    "context:find-related",
    async (_event, sessionId, options = {}) => {
      try {
        if (!associatorRef.current) {
          throw new Error("ContextAssociator not initialized");
        }
        return await associatorRef.current.findRelatedSessions(
          sessionId,
          options,
        );
      } catch (error) {
        logger.error("[ContextAssociator IPC] Find related failed:", error);
        throw error;
      }
    },
  );

  /**
   * Analyze conversation
   * Channel: 'context:analyze-conversation'
   */
  ipcMain.handle(
    "context:analyze-conversation",
    async (_event, conversationId) => {
      try {
        if (!associatorRef.current) {
          throw new Error("ContextAssociator not initialized");
        }
        return await associatorRef.current.analyzeConversation(conversationId);
      } catch (error) {
        logger.error(
          "[ContextAssociator IPC] Analyze conversation failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Knowledge Search
  // ============================================================

  /**
   * Search knowledge
   * Channel: 'context:search-knowledge'
   */
  ipcMain.handle(
    "context:search-knowledge",
    async (_event, query, options = {}) => {
      try {
        if (!associatorRef.current) {
          throw new Error("ContextAssociator not initialized");
        }
        return await associatorRef.current.searchKnowledge(query, options);
      } catch (error) {
        logger.error(
          "[ContextAssociator IPC] Search knowledge failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Topics
  // ============================================================

  /**
   * Get or create topic
   * Channel: 'context:get-or-create-topic'
   */
  ipcMain.handle(
    "context:get-or-create-topic",
    async (_event, topicName, options = {}) => {
      try {
        if (!associatorRef.current) {
          throw new Error("ContextAssociator not initialized");
        }
        return await associatorRef.current.getOrCreateTopic(topicName, options);
      } catch (error) {
        logger.error(
          "[ContextAssociator IPC] Get/create topic failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Get popular topics
   * Channel: 'context:get-popular-topics'
   */
  ipcMain.handle("context:get-popular-topics", async (_event, options = {}) => {
    try {
      if (!associatorRef.current) {
        throw new Error("ContextAssociator not initialized");
      }
      return await associatorRef.current.getPopularTopics(options);
    } catch (error) {
      logger.error(
        "[ContextAssociator IPC] Get popular topics failed:",
        error,
      );
      throw error;
    }
  });

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get statistics
   * Channel: 'context:get-stats'
   */
  ipcMain.handle("context:get-stats", async () => {
    try {
      if (!associatorRef.current) {
        throw new Error("ContextAssociator not initialized");
      }
      return await associatorRef.current.getStats();
    } catch (error) {
      logger.error("[ContextAssociator IPC] Get stats failed:", error);
      throw error;
    }
  });

  /**
   * Update ContextAssociator reference
   * For hot-reload or reinitialization
   * @param {ContextAssociator} newAssociator - New instance
   */
  function updateContextAssociator(newAssociator) {
    associatorRef.current = newAssociator;
    logger.info("[ContextAssociator IPC] Reference updated");
  }

  // Mark as registered
  ipcGuard.markModuleRegistered("context-associator-ipc");

  logger.info(
    "[ContextAssociator IPC] ContextAssociator IPC handlers registered successfully",
  );

  return {
    updateContextAssociator,
  };
}

module.exports = {
  registerContextAssociatorIPC,
};
