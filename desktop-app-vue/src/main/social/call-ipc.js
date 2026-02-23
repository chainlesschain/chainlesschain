/**
 * Call IPC Handlers
 *
 * Registers IPC handlers for voice/video call features.
 * Bridges the renderer process call UI with the main process
 * call management, media engine, signaling, and SFU relay.
 *
 * @module social/call-ipc
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

/**
 * Register all Call IPC handlers
 * @param {Object} dependencies - Dependency injection
 * @param {Object} dependencies.callManager - Call room lifecycle manager
 * @param {Object} dependencies.mediaEngine - Media stream engine
 * @param {Object} dependencies.callSignaling - SDP/ICE signaling manager
 * @param {Object} dependencies.sfuRelay - SFU relay for group calls
 */
function registerCallIPC({ callManager, mediaEngine, callSignaling, sfuRelay }) {
  logger.info("[Call IPC] Registering Call IPC handlers...");

  // ============================================================
  // Room Management
  // ============================================================

  /**
   * Create a new call room
   * Channel: 'call:create-room'
   * @param {Object} options - { type: 'voice'|'video', maxParticipants?: number, inviteDids?: string[] }
   * @returns {Object} { success, room }
   */
  ipcMain.handle("call:create-room", async (_event, options) => {
    try {
      if (!callManager) {
        throw new Error("Call manager not initialized");
      }

      if (!options || !options.type) {
        throw new Error("Call type is required (voice or video)");
      }

      const result = await callManager.createRoom({
        type: options.type,
        maxParticipants: options.maxParticipants,
        inviteDids: options.inviteDids || [],
      });

      // If room created successfully and it's a group call, create SFU relay
      if (result.success && sfuRelay && options.inviteDids && options.inviteDids.length > 3) {
        sfuRelay.createRelay(result.room.id);
      }

      return result;
    } catch (error) {
      logger.error("[Call IPC] Create room failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Join an existing call room
   * Channel: 'call:join-room'
   * @param {Object} params - { roomId: string }
   * @returns {Object} { success, room }
   */
  ipcMain.handle("call:join-room", async (_event, params) => {
    try {
      if (!callManager) {
        throw new Error("Call manager not initialized");
      }

      if (!params || !params.roomId) {
        throw new Error("Room ID is required");
      }

      const result = await callManager.joinRoom(params.roomId);

      // Set up media stream for the joined room
      if (result.success && mediaEngine) {
        const room = result.room;
        await mediaEngine.acquireMediaStream(params.roomId, {
          audio: true,
          video: room.type === "video",
        });
      }

      return result;
    } catch (error) {
      logger.error("[Call IPC] Join room failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Leave a call room
   * Channel: 'call:leave-room'
   * @param {Object} params - { roomId: string }
   * @returns {Object} { success }
   */
  ipcMain.handle("call:leave-room", async (_event, params) => {
    try {
      if (!callManager) {
        throw new Error("Call manager not initialized");
      }

      if (!params || !params.roomId) {
        throw new Error("Room ID is required");
      }

      // Release media stream first
      if (mediaEngine) {
        await mediaEngine.releaseMediaStream(params.roomId);
      }

      // Remove from SFU relay if applicable
      if (sfuRelay) {
        const currentDid = callManager._getCurrentDid();
        if (currentDid) {
          sfuRelay.removeUpstream(params.roomId, currentDid);
        }
      }

      const result = await callManager.leaveRoom(params.roomId);
      return result;
    } catch (error) {
      logger.error("[Call IPC] Leave room failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * End a call room
   * Channel: 'call:end-room'
   * @param {Object} params - { roomId: string }
   * @returns {Object} { success }
   */
  ipcMain.handle("call:end-room", async (_event, params) => {
    try {
      if (!callManager) {
        throw new Error("Call manager not initialized");
      }

      if (!params || !params.roomId) {
        throw new Error("Room ID is required");
      }

      // Release all media streams for this room
      if (mediaEngine) {
        await mediaEngine.releaseMediaStream(params.roomId);
      }

      // Shutdown SFU relay if active
      if (sfuRelay) {
        sfuRelay.shutdown(params.roomId);
      }

      // Send hangup signal to all participants
      if (callSignaling) {
        const participantsResult = await callManager.getParticipants(params.roomId);
        if (participantsResult.success) {
          for (const participant of participantsResult.participants) {
            await callSignaling
              .sendHangup(participant.participantDid, params.roomId)
              .catch((err) => {
                logger.warn(
                  `[Call IPC] Failed to send hangup to ${participant.participantDid}:`,
                  err.message,
                );
              });
          }
        }
      }

      const result = await callManager.endRoom(params.roomId);
      return result;
    } catch (error) {
      logger.error("[Call IPC] End room failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all active call rooms
   * Channel: 'call:get-active-rooms'
   * @returns {Object} { success, rooms }
   */
  ipcMain.handle("call:get-active-rooms", async () => {
    try {
      if (!callManager) {
        return { success: true, rooms: [] };
      }

      return await callManager.getActiveRooms();
    } catch (error) {
      logger.error("[Call IPC] Get active rooms failed:", error);
      return { success: false, error: error.message, rooms: [] };
    }
  });

  /**
   * Get participants of a call room
   * Channel: 'call:get-participants'
   * @param {Object} params - { roomId: string, activeOnly?: boolean }
   * @returns {Object} { success, participants }
   */
  ipcMain.handle("call:get-participants", async (_event, params) => {
    try {
      if (!callManager) {
        return { success: true, participants: [] };
      }

      if (!params || !params.roomId) {
        throw new Error("Room ID is required");
      }

      return await callManager.getParticipants(
        params.roomId,
        params.activeOnly !== false,
      );
    } catch (error) {
      logger.error("[Call IPC] Get participants failed:", error);
      return { success: false, error: error.message, participants: [] };
    }
  });

  // ============================================================
  // Media Controls
  // ============================================================

  /**
   * Toggle audio (mute/unmute)
   * Channel: 'call:toggle-audio'
   * @param {Object} params - { roomId: string, enabled: boolean }
   * @returns {Object} { success, audioEnabled }
   */
  ipcMain.handle("call:toggle-audio", async (_event, params) => {
    try {
      if (!mediaEngine) {
        throw new Error("Media engine not initialized");
      }

      if (!params || !params.roomId || typeof params.enabled !== "boolean") {
        throw new Error("Room ID and enabled state are required");
      }

      const result = await mediaEngine.toggleAudio(
        params.roomId,
        params.enabled,
      );
      return result;
    } catch (error) {
      logger.error("[Call IPC] Toggle audio failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Toggle video (camera on/off)
   * Channel: 'call:toggle-video'
   * @param {Object} params - { roomId: string, enabled: boolean }
   * @returns {Object} { success, videoEnabled }
   */
  ipcMain.handle("call:toggle-video", async (_event, params) => {
    try {
      if (!mediaEngine) {
        throw new Error("Media engine not initialized");
      }

      if (!params || !params.roomId || typeof params.enabled !== "boolean") {
        throw new Error("Room ID and enabled state are required");
      }

      const result = await mediaEngine.toggleVideo(
        params.roomId,
        params.enabled,
      );
      return result;
    } catch (error) {
      logger.error("[Call IPC] Toggle video failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Start screen sharing
   * Channel: 'call:share-screen'
   * @param {Object} params - { roomId: string, sourceId?: string }
   * @returns {Object} { success, screenConfig }
   */
  ipcMain.handle("call:share-screen", async (_event, params) => {
    try {
      if (!mediaEngine) {
        throw new Error("Media engine not initialized");
      }

      if (!params || !params.roomId) {
        throw new Error("Room ID is required");
      }

      // Check if already screen sharing - if so, stop it
      const trackStates = mediaEngine.getTrackStates(params.roomId);
      if (trackStates && trackStates.screenSharing) {
        const stopResult = await mediaEngine.stopScreenShare(params.roomId);
        return { ...stopResult, screenSharing: false };
      }

      // Start screen sharing
      const result = await mediaEngine.startScreenShare(params.roomId, {
        sourceId: params.sourceId || null,
      });

      return { ...result, screenSharing: true };
    } catch (error) {
      logger.error("[Call IPC] Screen share failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Signaling (for advanced renderer-side usage)
  // ============================================================

  /**
   * Send SDP offer
   * Channel: 'call:send-offer'
   * @param {Object} params - { targetDid, sdp, roomId?, sessionId? }
   */
  ipcMain.handle("call:send-offer", async (_event, params) => {
    try {
      if (!callSignaling) {
        throw new Error("Call signaling not initialized");
      }

      if (!params || !params.targetDid || !params.sdp) {
        throw new Error("Target DID and SDP are required");
      }

      return await callSignaling.sendOffer(params.targetDid, params.sdp, {
        roomId: params.roomId,
        sessionId: params.sessionId,
      });
    } catch (error) {
      logger.error("[Call IPC] Send offer failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Send SDP answer
   * Channel: 'call:send-answer'
   * @param {Object} params - { targetDid, sdp, sessionId? }
   */
  ipcMain.handle("call:send-answer", async (_event, params) => {
    try {
      if (!callSignaling) {
        throw new Error("Call signaling not initialized");
      }

      if (!params || !params.targetDid || !params.sdp) {
        throw new Error("Target DID and SDP are required");
      }

      return await callSignaling.sendAnswer(params.targetDid, params.sdp, {
        sessionId: params.sessionId,
      });
    } catch (error) {
      logger.error("[Call IPC] Send answer failed:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Send ICE candidate
   * Channel: 'call:send-ice-candidate'
   * @param {Object} params - { targetDid, candidate, sessionId? }
   */
  ipcMain.handle("call:send-ice-candidate", async (_event, params) => {
    try {
      if (!callSignaling) {
        throw new Error("Call signaling not initialized");
      }

      if (!params || !params.targetDid || !params.candidate) {
        throw new Error("Target DID and ICE candidate are required");
      }

      return await callSignaling.sendIceCandidate(
        params.targetDid,
        params.candidate,
        { sessionId: params.sessionId },
      );
    } catch (error) {
      logger.error("[Call IPC] Send ICE candidate failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[Call IPC] All Call IPC handlers registered (12 handlers)");
}

module.exports = { registerCallIPC };
