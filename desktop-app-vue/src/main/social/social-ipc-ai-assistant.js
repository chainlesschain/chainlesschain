/**
 * Social IPC handlers — ai-assistant group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-ai-assistant
 */
import { logger } from "../utils/logger.js";

export function registerAiAssistantHandlers(ctx) {
  const { ipcMain, aiSocialAssistant, topicAnalyzer, socialGraph } = ctx;

  // ============================================================
  // AI Social Assistant Enhanced (Phase 42) - 8 handlers
  // ============================================================

  // aiSocialAssistant, topicAnalyzer, socialGraph are destructured from params above

  /**
   * AI Enhanced Reply
   * Channel: 'social-ai:enhanced-reply'
   */
  ipcMain.handle(
    "social-ai:enhanced-reply",
    async (_event, { context, style, options }) => {
      try {
        if (!aiSocialAssistant) {
          throw new Error("AI Social Assistant not initialized");
        }
        return await aiSocialAssistant.enhancedReply(context, style, options);
      } catch (error) {
        logger.error("[Social IPC] Enhanced reply failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * AI Multi-Style Replies
   * Channel: 'social-ai:multi-style-replies'
   */
  ipcMain.handle(
    "social-ai:multi-style-replies",
    async (_event, { context, styles }) => {
      try {
        if (!aiSocialAssistant) {
          throw new Error("AI Social Assistant not initialized");
        }
        return await aiSocialAssistant.suggestMultiStyleReplies(
          context,
          styles,
        );
      } catch (error) {
        logger.error("[Social IPC] Multi-style replies failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Topic Analysis
   * Channel: 'social-ai:analyze-topics'
   */
  ipcMain.handle(
    "social-ai:analyze-topics",
    async (_event, { content, options }) => {
      try {
        if (!topicAnalyzer) {
          throw new Error("Topic Analyzer not initialized");
        }
        return await topicAnalyzer.analyzeTopics(content, options);
      } catch (error) {
        logger.error("[Social IPC] Topic analysis failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get Trending Topics
   * Channel: 'social-ai:trending-topics'
   */
  ipcMain.handle("social-ai:trending-topics", async (_event, options) => {
    try {
      if (!topicAnalyzer) {
        throw new Error("Topic Analyzer not initialized");
      }
      return await topicAnalyzer.getTrendingTopics(options);
    } catch (error) {
      logger.error("[Social IPC] Trending topics failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Batch Sentiment Analysis
   * Channel: 'social-ai:batch-sentiment'
   */
  ipcMain.handle("social-ai:batch-sentiment", async (_event, { contents }) => {
    try {
      if (!topicAnalyzer) {
        throw new Error("Topic Analyzer not initialized");
      }
      return await topicAnalyzer.batchSentiment(contents);
    } catch (error) {
      logger.error("[Social IPC] Batch sentiment failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Record Social Interaction
   * Channel: 'social-ai:record-interaction'
   */
  ipcMain.handle(
    "social-ai:record-interaction",
    async (_event, { sourceDid, targetDid, interactionType }) => {
      try {
        if (!socialGraph) {
          throw new Error("Social Graph not initialized");
        }
        return await socialGraph.recordInteraction(
          sourceDid,
          targetDid,
          interactionType,
        );
      } catch (error) {
        logger.error("[Social IPC] Record interaction failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get Closest Contacts
   * Channel: 'social-ai:closest-contacts'
   */
  ipcMain.handle(
    "social-ai:closest-contacts",
    async (_event, { did, options }) => {
      try {
        if (!socialGraph) {
          throw new Error("Social Graph not initialized");
        }
        return await socialGraph.getClosestContacts(did, options);
      } catch (error) {
        logger.error("[Social IPC] Closest contacts failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * Get Social Graph
   * Channel: 'social-ai:get-graph'
   */
  ipcMain.handle("social-ai:get-graph", async (_event, { did, options }) => {
    try {
      if (!socialGraph) {
        throw new Error("Social Graph not initialized");
      }
      const graph = await socialGraph.getGraph(did, options);
      const stats = await socialGraph.getStats(did);
      const communities = await socialGraph.detectCommunities(did);
      return { success: true, graph, stats, communities };
    } catch (error) {
      logger.error("[Social IPC] Get graph failed:", error);
      return { success: false, error: error.message };
    }
  });
}
