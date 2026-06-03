/**
 * Social IPC handlers — activitypub group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-activitypub
 */
import { logger } from "../utils/logger.js";

export function registerActivityPubHandlers(ctx) {
  const { ipcMain, activityPubBridge, apContentSync, apWebFinger } = ctx;

  // ============================================================
  // ActivityPub Bridge (Phase 42) - 10 handlers
  // ============================================================

  // activityPubBridge, apContentSync, apWebFinger are destructured from params above

  /**
   * Create ActivityPub Actor
   * Channel: 'ap:create-actor'
   */
  ipcMain.handle("ap:create-actor", async (_event, { did, profile }) => {
    try {
      if (!activityPubBridge) {
        throw new Error("ActivityPub Bridge not initialized");
      }
      return await activityPubBridge.createLocalActor(did, profile);
    } catch (error) {
      logger.error("[Social IPC] AP create actor failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Actor Document
   * Channel: 'ap:get-actor'
   */
  ipcMain.handle("ap:get-actor", async (_event, { did }) => {
    try {
      if (!activityPubBridge) {
        throw new Error("ActivityPub Bridge not initialized");
      }
      return await activityPubBridge.buildActorDocument(did);
    } catch (error) {
      logger.error("[Social IPC] AP get actor failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Publish Post to ActivityPub
   * Channel: 'ap:publish-post'
   */
  ipcMain.handle("ap:publish-post", async (_event, { actorDid, post }) => {
    try {
      if (!apContentSync) {
        throw new Error("AP Content Sync not initialized");
      }
      return await apContentSync.publishPost(actorDid, post);
    } catch (error) {
      logger.error("[Social IPC] AP publish post failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Publish Like
   * Channel: 'ap:publish-like'
   */
  ipcMain.handle("ap:publish-like", async (_event, { actorDid, objectId }) => {
    try {
      if (!apContentSync) {
        throw new Error("AP Content Sync not initialized");
      }
      return await apContentSync.publishLike(actorDid, objectId);
    } catch (error) {
      logger.error("[Social IPC] AP publish like failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Publish Boost
   * Channel: 'ap:publish-boost'
   */
  ipcMain.handle("ap:publish-boost", async (_event, { actorDid, objectId }) => {
    try {
      if (!apContentSync) {
        throw new Error("AP Content Sync not initialized");
      }
      return await apContentSync.publishBoost(actorDid, objectId);
    } catch (error) {
      logger.error("[Social IPC] AP publish boost failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Follow Remote Actor
   * Channel: 'ap:follow'
   */
  ipcMain.handle("ap:follow", async (_event, { actorDid, targetActorId }) => {
    try {
      if (!apContentSync) {
        throw new Error("AP Content Sync not initialized");
      }
      return await apContentSync.publishFollow(actorDid, targetActorId);
    } catch (error) {
      logger.error("[Social IPC] AP follow failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * WebFinger Lookup
   * Channel: 'ap:webfinger-lookup'
   */
  ipcMain.handle("ap:webfinger-lookup", async (_event, { address }) => {
    try {
      if (!apWebFinger) {
        throw new Error("WebFinger not initialized");
      }
      return await apWebFinger.lookupUser(address);
    } catch (error) {
      logger.error("[Social IPC] WebFinger lookup failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Outbox
   * Channel: 'ap:get-outbox'
   */
  ipcMain.handle("ap:get-outbox", async (_event, { actorDid, options }) => {
    try {
      if (!activityPubBridge) {
        throw new Error("ActivityPub Bridge not initialized");
      }
      return await activityPubBridge.getOutbox(actorDid, options);
    } catch (error) {
      logger.error("[Social IPC] AP get outbox failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get Sync Status
   * Channel: 'ap:sync-status'
   */
  ipcMain.handle("ap:sync-status", async () => {
    try {
      if (!apContentSync) {
        throw new Error("AP Content Sync not initialized");
      }
      const syncStatus = await apContentSync.getSyncStatus();
      const bridgeStatus = activityPubBridge
        ? await activityPubBridge.getStatus()
        : {};
      return { success: true, ...syncStatus, ...bridgeStatus };
    } catch (error) {
      logger.error("[Social IPC] AP sync status failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Trigger Manual Sync
   * Channel: 'ap:sync-now'
   */
  ipcMain.handle("ap:sync-now", async () => {
    try {
      if (!apContentSync) {
        throw new Error("AP Content Sync not initialized");
      }
      return await apContentSync.syncAll();
    } catch (error) {
      logger.error("[Social IPC] AP sync failed:", error);
      return { success: false, error: error.message };
    }
  });
}
