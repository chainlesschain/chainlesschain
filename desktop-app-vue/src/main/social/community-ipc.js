/**
 * Community IPC Handlers
 * Registers IPC handlers for community, channel, governance, and moderation features.
 *
 * @module community-ipc
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register all Community IPC handlers
 * @param {Object} dependencies - Dependency injection
 * @param {Object} dependencies.communityManager - Community manager instance
 * @param {Object} dependencies.channelManager - Channel manager instance
 * @param {Object} dependencies.governanceEngine - Governance engine instance
 * @param {Object} dependencies.gossipProtocol - Gossip protocol instance
 * @param {Object} dependencies.contentModerator - Content moderator instance
 */
function registerCommunityIPC({
  communityManager,
  channelManager,
  governanceEngine,
  gossipProtocol,
  contentModerator,
}) {
  logger.info("[Community IPC] Registering Community IPC handlers...");

  // ============================================================
  // Community Management - 12 handlers
  // ============================================================

  /**
   * Create a community
   * Channel: 'community:create'
   */
  ipcMain.handle("community:create", async (_event, options) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      return await communityManager.createCommunity(options);
    } catch (error) {
      logger.error("[Community IPC] Failed to create community:", error);
      throw error;
    }
  });

  /**
   * Delete a community
   * Channel: 'community:delete'
   */
  ipcMain.handle("community:delete", async (_event, communityId) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      return await communityManager.deleteCommunity(communityId);
    } catch (error) {
      logger.error("[Community IPC] Failed to delete community:", error);
      throw error;
    }
  });

  /**
   * Update community info
   * Channel: 'community:update'
   */
  ipcMain.handle("community:update", async (_event, communityId, updates) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      return await communityManager.updateCommunity(communityId, updates);
    } catch (error) {
      logger.error("[Community IPC] Failed to update community:", error);
      throw error;
    }
  });

  /**
   * Get community list
   * Channel: 'community:get-list'
   */
  ipcMain.handle("community:get-list", async (_event, options) => {
    try {
      if (!communityManager) {
        return [];
      }
      return await communityManager.getCommunities(options);
    } catch (error) {
      logger.error("[Community IPC] Failed to get communities:", error);
      return [];
    }
  });

  /**
   * Get community by ID
   * Channel: 'community:get-by-id'
   */
  ipcMain.handle("community:get-by-id", async (_event, communityId) => {
    try {
      if (!communityManager) {
        return null;
      }
      return await communityManager.getCommunityById(communityId);
    } catch (error) {
      logger.error("[Community IPC] Failed to get community:", error);
      return null;
    }
  });

  /**
   * Join a community
   * Channel: 'community:join'
   */
  ipcMain.handle("community:join", async (_event, communityId) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      const result = await communityManager.joinCommunity(communityId);

      // Subscribe to gossip for this community
      if (gossipProtocol) {
        gossipProtocol.subscribe(communityId);
      }

      return result;
    } catch (error) {
      logger.error("[Community IPC] Failed to join community:", error);
      throw error;
    }
  });

  /**
   * Leave a community
   * Channel: 'community:leave'
   */
  ipcMain.handle("community:leave", async (_event, communityId) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      const result = await communityManager.leaveCommunity(communityId);

      // Unsubscribe from gossip for this community
      if (gossipProtocol) {
        gossipProtocol.unsubscribe(communityId);
      }

      return result;
    } catch (error) {
      logger.error("[Community IPC] Failed to leave community:", error);
      throw error;
    }
  });

  /**
   * Search communities
   * Channel: 'community:search'
   */
  ipcMain.handle("community:search", async (_event, query, options) => {
    try {
      if (!communityManager) {
        return [];
      }
      return await communityManager.searchCommunities(query, options);
    } catch (error) {
      logger.error("[Community IPC] Failed to search communities:", error);
      return [];
    }
  });

  /**
   * Get community members
   * Channel: 'community:get-members'
   */
  ipcMain.handle("community:get-members", async (_event, communityId, options) => {
    try {
      if (!communityManager) {
        return [];
      }
      return await communityManager.getMembers(communityId, options);
    } catch (error) {
      logger.error("[Community IPC] Failed to get members:", error);
      return [];
    }
  });

  /**
   * Promote a member
   * Channel: 'community:promote'
   */
  ipcMain.handle("community:promote", async (_event, communityId, memberDid, newRole) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      return await communityManager.promoteMember(communityId, memberDid, newRole);
    } catch (error) {
      logger.error("[Community IPC] Failed to promote member:", error);
      throw error;
    }
  });

  /**
   * Demote a member
   * Channel: 'community:demote'
   */
  ipcMain.handle("community:demote", async (_event, communityId, memberDid) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      return await communityManager.demoteMember(communityId, memberDid);
    } catch (error) {
      logger.error("[Community IPC] Failed to demote member:", error);
      throw error;
    }
  });

  /**
   * Ban a member
   * Channel: 'community:ban'
   */
  ipcMain.handle("community:ban", async (_event, communityId, memberDid) => {
    try {
      if (!communityManager) {
        throw new Error("Community manager not initialized");
      }
      return await communityManager.banMember(communityId, memberDid);
    } catch (error) {
      logger.error("[Community IPC] Failed to ban member:", error);
      throw error;
    }
  });

  // ============================================================
  // Channel Management - 5 handlers
  // ============================================================

  /**
   * Create a channel
   * Channel: 'channel:create'
   */
  ipcMain.handle("channel:create", async (_event, options) => {
    try {
      if (!channelManager) {
        throw new Error("Channel manager not initialized");
      }
      return await channelManager.createChannel(options);
    } catch (error) {
      logger.error("[Community IPC] Failed to create channel:", error);
      throw error;
    }
  });

  /**
   * Delete a channel
   * Channel: 'channel:delete'
   */
  ipcMain.handle("channel:delete", async (_event, channelId) => {
    try {
      if (!channelManager) {
        throw new Error("Channel manager not initialized");
      }
      return await channelManager.deleteChannel(channelId);
    } catch (error) {
      logger.error("[Community IPC] Failed to delete channel:", error);
      throw error;
    }
  });

  /**
   * Get channels in a community
   * Channel: 'channel:get-list'
   */
  ipcMain.handle("channel:get-list", async (_event, communityId) => {
    try {
      if (!channelManager) {
        return [];
      }
      return await channelManager.getChannels(communityId);
    } catch (error) {
      logger.error("[Community IPC] Failed to get channels:", error);
      return [];
    }
  });

  /**
   * Send a message in a channel
   * Channel: 'channel:send-message'
   */
  ipcMain.handle("channel:send-message", async (_event, options) => {
    try {
      if (!channelManager) {
        throw new Error("Channel manager not initialized");
      }

      const message = await channelManager.sendMessage(options);

      // Broadcast via gossip protocol
      if (gossipProtocol && message) {
        const channel = channelManager.database.db
          .prepare("SELECT community_id FROM channels WHERE id = ?")
          .get(options.channelId);

        if (channel) {
          try {
            await gossipProtocol.broadcast(channel.community_id, {
              type: "channel_message",
              channelId: options.channelId,
              message,
            });
          } catch (gossipError) {
            logger.warn("[Community IPC] Gossip broadcast failed:", gossipError.message);
          }
        }
      }

      return message;
    } catch (error) {
      logger.error("[Community IPC] Failed to send message:", error);
      throw error;
    }
  });

  /**
   * Get messages in a channel
   * Channel: 'channel:get-messages'
   */
  ipcMain.handle("channel:get-messages", async (_event, channelId, options) => {
    try {
      if (!channelManager) {
        return [];
      }
      return await channelManager.getMessages(channelId, options);
    } catch (error) {
      logger.error("[Community IPC] Failed to get messages:", error);
      return [];
    }
  });

  /**
   * Pin a message
   * Channel: 'channel:pin-message'
   */
  ipcMain.handle("channel:pin-message", async (_event, messageId) => {
    try {
      if (!channelManager) {
        throw new Error("Channel manager not initialized");
      }
      return await channelManager.pinMessage(messageId);
    } catch (error) {
      logger.error("[Community IPC] Failed to pin message:", error);
      throw error;
    }
  });

  // ============================================================
  // Governance - 4 handlers
  // ============================================================

  /**
   * Create a proposal
   * Channel: 'governance:create-proposal'
   */
  ipcMain.handle("governance:create-proposal", async (_event, options) => {
    try {
      if (!governanceEngine) {
        throw new Error("Governance engine not initialized");
      }
      return await governanceEngine.createProposal(options);
    } catch (error) {
      logger.error("[Community IPC] Failed to create proposal:", error);
      throw error;
    }
  });

  /**
   * Cast a vote
   * Channel: 'governance:vote'
   */
  ipcMain.handle("governance:vote", async (_event, proposalId, vote) => {
    try {
      if (!governanceEngine) {
        throw new Error("Governance engine not initialized");
      }
      return await governanceEngine.castVote(proposalId, vote);
    } catch (error) {
      logger.error("[Community IPC] Failed to cast vote:", error);
      throw error;
    }
  });

  /**
   * Get proposals
   * Channel: 'governance:get-proposals'
   */
  ipcMain.handle("governance:get-proposals", async (_event, communityId, options) => {
    try {
      if (!governanceEngine) {
        return [];
      }
      return await governanceEngine.getProposals(communityId, options);
    } catch (error) {
      logger.error("[Community IPC] Failed to get proposals:", error);
      return [];
    }
  });

  /**
   * Get votes for a proposal
   * Channel: 'governance:get-votes'
   */
  ipcMain.handle("governance:get-votes", async (_event, proposalId) => {
    try {
      if (!governanceEngine) {
        return [];
      }
      return await governanceEngine.getVotes(proposalId);
    } catch (error) {
      logger.error("[Community IPC] Failed to get votes:", error);
      return [];
    }
  });

  // ============================================================
  // Content Moderation - 3 handlers
  // ============================================================

  /**
   * Report content
   * Channel: 'moderation:report'
   */
  ipcMain.handle("moderation:report", async (_event, options) => {
    try {
      if (!contentModerator) {
        throw new Error("Content moderator not initialized");
      }
      return await contentModerator.reportContent(options);
    } catch (error) {
      logger.error("[Community IPC] Failed to report content:", error);
      throw error;
    }
  });

  /**
   * Review a report
   * Channel: 'moderation:review'
   */
  ipcMain.handle("moderation:review", async (_event, reportId, action, reason) => {
    try {
      if (!contentModerator) {
        throw new Error("Content moderator not initialized");
      }
      return await contentModerator.reviewReport(reportId, action, reason);
    } catch (error) {
      logger.error("[Community IPC] Failed to review report:", error);
      throw error;
    }
  });

  /**
   * Get moderation log
   * Channel: 'moderation:get-log'
   */
  ipcMain.handle("moderation:get-log", async (_event, communityId, options) => {
    try {
      if (!contentModerator) {
        return [];
      }
      return await contentModerator.getModerationLog(communityId, options);
    } catch (error) {
      logger.error("[Community IPC] Failed to get moderation log:", error);
      return [];
    }
  });

  logger.info(
    "[Community IPC] All Community IPC handlers registered successfully (24 handlers)",
  );
}

module.exports = {
  registerCommunityIPC,
};
