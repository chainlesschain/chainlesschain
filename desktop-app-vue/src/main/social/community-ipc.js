/**
 * Community IPC Handlers
 * Registers IPC handlers for community, channel, governance, and moderation features.
 *
 * @module community-ipc
 * @version 0.42.0
 */

const { logger } = require("../utils/logger.js");
const electron = require("electron");

/**
 * Register all Community IPC handlers
 * @param {Object} dependencies - Dependency injection
 * @param {Object} dependencies.communityManager - Community manager instance
 * @param {Object} dependencies.channelManager - Channel manager instance
 * @param {Object} dependencies.governanceEngine - Governance engine instance
 * @param {Object} dependencies.gossipProtocol - Gossip protocol instance (Phase A direct gossip)
 * @param {Object} dependencies.contentModerator - Content moderator instance
 * @param {Object} [dependencies.mtcFederationManager] - Phase B MTC fed gossipsub
 *   (optional; when present, community/channel events are dual-published on
 *   `cc.community.<id>.events` topic alongside the Phase A gossip path)
 * @param {Object} [dependencies.channelEventBatcher] - B4-merkle channel event
 *   batcher (optional; when present, locally-sent signed messages are
 *   enqueued for Merkle batch envelope finality)
 * @param {Object} [dependencies.ipcMain] - Override electron.ipcMain (test-only)
 */
function registerCommunityIPC({
  communityManager,
  channelManager,
  governanceEngine,
  gossipProtocol,
  contentModerator,
  mtcFederationManager,
  channelEventBatcher,
  ipcMain,
}) {
  // Default to real electron.ipcMain in production; tests inject a mock.
  // This mirrors social-ipc.js's DI pattern and dodges vitest's alias-based
  // electron stub which doesn't reliably surface named CJS requires.
  if (!ipcMain) {
    ipcMain =
      electron.ipcMain || (electron.default && electron.default.ipcMain);
  }
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error(
      "registerCommunityIPC: ipcMain dependency missing — pass {ipcMain} explicitly or run inside Electron",
    );
  }
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

      // Subscribe to gossip for this community (Phase A — direct dial gossip)
      if (gossipProtocol) {
        gossipProtocol.subscribe(communityId);
      }

      // Phase B v1: also subscribe MTC federation gossipsub topic.
      // Idempotent at MtcFederationManager (re-subscribe replaces handler).
      // Failure is non-fatal — Phase A gossip still delivers.
      if (mtcFederationManager && mtcFederationManager.isInitialized()) {
        try {
          await mtcFederationManager.subscribeCommunity(
            communityId,
            (payload) => {
              // Same dispatch shape as social-initializer's gossipReceiver:
              // route channel_message → channelManager.handleMessageReceived
              // (INSERT OR IGNORE on message.id de-dups across both paths)
              if (
                !payload ||
                payload.type !== "channel_message" ||
                !payload.channelId ||
                !payload.message ||
                !channelManager
              ) {
                return;
              }
              channelManager
                .handleMessageReceived(payload.channelId, payload.message)
                .catch((err) =>
                  logger.warn(
                    "[Community IPC] MTC dispatch failed:",
                    err.message,
                  ),
                );
            },
          );
        } catch (mtcErr) {
          logger.warn(
            "[Community IPC] MTC subscribeCommunity failed (gossip path still active):",
            mtcErr.message,
          );
        }
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

      // Phase B v1: unsubscribe MTC topic. Idempotent on unknown community.
      if (mtcFederationManager && mtcFederationManager.isInitialized()) {
        try {
          mtcFederationManager.unsubscribeCommunity(communityId);
        } catch (mtcErr) {
          logger.warn(
            "[Community IPC] MTC unsubscribeCommunity failed:",
            mtcErr.message,
          );
        }
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
  ipcMain.handle(
    "community:get-members",
    async (_event, communityId, options) => {
      try {
        if (!communityManager) {
          return [];
        }
        return await communityManager.getMembers(communityId, options);
      } catch (error) {
        logger.error("[Community IPC] Failed to get members:", error);
        return [];
      }
    },
  );

  /**
   * Promote a member
   * Channel: 'community:promote'
   */
  ipcMain.handle(
    "community:promote",
    async (_event, communityId, memberDid, newRole) => {
      try {
        if (!communityManager) {
          throw new Error("Community manager not initialized");
        }
        return await communityManager.promoteMember(
          communityId,
          memberDid,
          newRole,
        );
      } catch (error) {
        logger.error("[Community IPC] Failed to promote member:", error);
        throw error;
      }
    },
  );

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

      // Dual-track broadcast:
      //   Phase A — direct gossip (gossipProtocol.broadcast)
      //   Phase B — MTC federation gossipsub (mtcFederationManager.publishCommunityEvent)
      // Both deliver the same {type:'channel_message', channelId, message}
      // payload; receivers idempotently INSERT OR IGNORE by message.id.
      if (message && (gossipProtocol || mtcFederationManager)) {
        const channel = channelManager.database.db
          .prepare("SELECT community_id FROM channels WHERE id = ?")
          .get(options.channelId);

        if (channel) {
          const eventPayload = {
            type: "channel_message",
            channelId: options.channelId,
            message,
          };

          if (gossipProtocol) {
            try {
              await gossipProtocol.broadcast(
                channel.community_id,
                eventPayload,
              );
            } catch (gossipError) {
              logger.warn(
                "[Community IPC] Gossip broadcast failed:",
                gossipError.message,
              );
            }
          }

          if (mtcFederationManager && mtcFederationManager.isInitialized()) {
            try {
              await mtcFederationManager.publishCommunityEvent(
                channel.community_id,
                eventPayload,
              );
            } catch (mtcError) {
              logger.warn(
                "[Community IPC] MTC publish failed:",
                mtcError.message,
              );
            }
          }

          // B4-merkle v1: enqueue our own signed messages into per-community
          // staging for Merkle batch envelope finality. enqueueEvent skips
          // unsigned messages (B4a contract); auto-closes when threshold hit.
          if (
            channelEventBatcher &&
            message.signature &&
            message.sender_pubkey
          ) {
            try {
              channelEventBatcher.enqueueEvent(channel.community_id, message);
            } catch (mtcMerkleErr) {
              logger.warn(
                "[Community IPC] Merkle envelope enqueue failed:",
                mtcMerkleErr.message,
              );
            }
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
   * B4-merkle: query the Merkle inclusion proof + landmark for a sent
   * channel message.
   * Channel: 'channel:get-message-envelope'
   *
   * Args: (communityId, messageId) — community must match the one the
   *   message was sent to (we use this for staging/batch path lookup).
   * Returns: { found:boolean, staging?:bool, envelope?, landmark?, treeHeadId?,
   *            namespace?, batchId?, leafIndex? }
   *
   * v1: only finds locally-batched messages (i.e. ones this device sent).
   * Future: cross-machine envelope distribution (federation) so any node
   * can serve any envelope.
   */
  ipcMain.handle(
    "channel:get-message-envelope",
    async (_event, communityId, messageId) => {
      try {
        if (!channelEventBatcher) {
          return {
            found: false,
            reason: "channelEventBatcher not initialized",
          };
        }
        if (!communityId || !messageId) {
          return { found: false, reason: "communityId + messageId required" };
        }
        return channelEventBatcher.loadEnvelopeAndLandmark(
          communityId,
          messageId,
        );
      } catch (err) {
        logger.error("[Community IPC] get-message-envelope failed:", err);
        return { found: false, reason: err.message };
      }
    },
  );

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
  ipcMain.handle(
    "governance:get-proposals",
    async (_event, communityId, options) => {
      try {
        if (!governanceEngine) {
          return [];
        }
        return await governanceEngine.getProposals(communityId, options);
      } catch (error) {
        logger.error("[Community IPC] Failed to get proposals:", error);
        return [];
      }
    },
  );

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
  ipcMain.handle(
    "moderation:review",
    async (_event, reportId, action, reason) => {
      try {
        if (!contentModerator) {
          throw new Error("Content moderator not initialized");
        }
        return await contentModerator.reviewReport(reportId, action, reason);
      } catch (error) {
        logger.error("[Community IPC] Failed to review report:", error);
        throw error;
      }
    },
  );

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
