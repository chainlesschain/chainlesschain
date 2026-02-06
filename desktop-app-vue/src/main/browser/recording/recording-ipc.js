/**
 * Recording IPC - IPC handlers for browser recording system
 *
 * @module browser/recording/recording-ipc
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { ipcMain } = require('electron');
const { logger } = require('../../utils/logger');
const { createIPCErrorHandler } = require('../../utils/ipc-error-handler');
const { BrowserRecorder } = require('./recorder');
const { RecordingPlayer, PlaybackSpeed } = require('./player');
const { RecordingStorage } = require('./recording-storage');

// Singleton instances
let recorder = null;
let player = null;
let storage = null;

/**
 * Initialize recording system
 * @param {Object} browserEngine - Browser engine instance
 * @param {Object} db - Database instance
 */
function initializeRecordingSystem(browserEngine, db) {
  if (!recorder && browserEngine) {
    recorder = new BrowserRecorder(browserEngine);

    recorder.on('recording:started', (data) => {
      logger.info('[RecordingIPC] Recording started', data);
    });

    recorder.on('recording:stopped', (data) => {
      logger.info('[RecordingIPC] Recording stopped', {
        recordingId: data.recording?.id,
        eventCount: data.recording?.eventCount
      });
    });

    recorder.on('event', (data) => {
      logger.debug('[RecordingIPC] Event recorded', { type: data.event?.type });
    });

    logger.info('[RecordingIPC] BrowserRecorder initialized');
  }

  if (!player && browserEngine) {
    player = new RecordingPlayer(browserEngine);

    player.on('playback:started', (data) => {
      logger.info('[RecordingIPC] Playback started', data);
    });

    player.on('playback:completed', (data) => {
      logger.info('[RecordingIPC] Playback completed', data);
    });

    player.on('playback:failed', (data) => {
      logger.error('[RecordingIPC] Playback failed', data);
    });

    logger.info('[RecordingIPC] RecordingPlayer initialized');
  }

  if (!storage && db) {
    storage = new RecordingStorage(db);
    logger.info('[RecordingIPC] RecordingStorage initialized');
  }
}

/**
 * Get recorder instance
 */
function getRecorder() {
  if (!recorder) {
    throw new Error('Recorder not initialized');
  }
  return recorder;
}

/**
 * Get player instance
 */
function getPlayer() {
  if (!player) {
    throw new Error('Player not initialized');
  }
  return player;
}

/**
 * Get storage instance
 */
function getStorage() {
  if (!storage) {
    throw new Error('Recording storage not initialized');
  }
  return storage;
}

/**
 * Register all Recording IPC handlers
 */
function registerRecordingIPC() {
  const withErrorHandler = createIPCErrorHandler('recording');

  // ==================== Recording Control ====================

  /**
   * Start recording
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Recording options
   * @returns {Promise<Object>} Recording info
   */
  ipcMain.handle('browser:recording:start', withErrorHandler(async (event, targetId, options = {}) => {
    const rec = getRecorder();
    const result = await rec.startRecording(targetId, options);

    logger.info('[RecordingIPC] Recording started', { targetId, recordingId: result.recordingId });

    return result;
  }));

  /**
   * Stop recording
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<Object>} Recording data
   */
  ipcMain.handle('browser:recording:stop', withErrorHandler(async (event, targetId) => {
    const rec = getRecorder();
    const recording = await rec.stopRecording(targetId);

    logger.info('[RecordingIPC] Recording stopped', {
      recordingId: recording.id,
      eventCount: recording.eventCount
    });

    return recording;
  }));

  /**
   * Pause recording
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:recording:pause', withErrorHandler(async (event, targetId) => {
    const rec = getRecorder();
    return rec.pauseRecording(targetId);
  }));

  /**
   * Resume recording
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:recording:resume', withErrorHandler(async (event, targetId) => {
    const rec = getRecorder();
    return rec.resumeRecording(targetId);
  }));

  /**
   * Get recording status
   * @param {string} targetId - Browser tab ID
   * @returns {Promise<Object|null>}
   */
  ipcMain.handle('browser:recording:getStatus', withErrorHandler(async (event, targetId) => {
    const rec = getRecorder();
    return rec.getStatus(targetId);
  }));

  // ==================== Playback Control ====================

  /**
   * Play a recording
   * @param {Object} recording - Recording data (or ID to load)
   * @param {string} targetId - Browser tab ID
   * @param {Object} options - Playback options
   * @returns {Promise<Object>} Playback result
   */
  ipcMain.handle('browser:recording:play', withErrorHandler(async (event, recording, targetId, options = {}) => {
    const p = getPlayer();

    // If recording is an ID, load it
    let recordingData = recording;
    if (typeof recording === 'string') {
      const store = getStorage();
      recordingData = await store.getRecording(recording);
      if (!recordingData) {
        throw new Error(`Recording ${recording} not found`);
      }
    }

    const result = await p.play(recordingData, targetId, options);

    logger.info('[RecordingIPC] Playback completed', {
      playbackId: result.playbackId,
      eventsPlayed: result.eventsPlayed
    });

    return result;
  }));

  /**
   * Pause playback
   * @param {string} playbackId - Playback ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:recording:playPause', withErrorHandler(async (event, playbackId) => {
    const p = getPlayer();
    return p.pause(playbackId);
  }));

  /**
   * Resume playback
   * @param {string} playbackId - Playback ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:recording:playResume', withErrorHandler(async (event, playbackId) => {
    const p = getPlayer();
    return p.resume(playbackId);
  }));

  /**
   * Stop playback
   * @param {string} playbackId - Playback ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:recording:playStop', withErrorHandler(async (event, playbackId) => {
    const p = getPlayer();
    return p.stop(playbackId);
  }));

  /**
   * Get playback status
   * @param {string} playbackId - Playback ID
   * @returns {Promise<Object|null>}
   */
  ipcMain.handle('browser:recording:getPlaybackStatus', withErrorHandler(async (event, playbackId) => {
    const p = getPlayer();
    return p.getStatus(playbackId);
  }));

  // ==================== Storage Operations ====================

  /**
   * Save recording to database
   * @param {Object} recording - Recording data
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:recording:save', withErrorHandler(async (event, recording) => {
    const store = getStorage();
    const result = await store.saveRecording(recording);

    logger.info('[RecordingIPC] Recording saved', { id: result.id });

    return result;
  }));

  /**
   * Load recording from database
   * @param {string} id - Recording ID
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:recording:load', withErrorHandler(async (event, id) => {
    const store = getStorage();
    const recording = await store.getRecording(id);

    if (!recording) {
      throw new Error(`Recording ${id} not found`);
    }

    return recording;
  }));

  /**
   * List recordings
   * @param {Object} options - Filter options
   * @returns {Promise<Array>}
   */
  ipcMain.handle('browser:recording:list', withErrorHandler(async (event, options = {}) => {
    const store = getStorage();
    return store.listRecordings(options);
  }));

  /**
   * Update recording
   * @param {string} id - Recording ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:recording:update', withErrorHandler(async (event, id, updates) => {
    const store = getStorage();
    return store.updateRecording(id, updates);
  }));

  /**
   * Delete recording
   * @param {string} id - Recording ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:recording:delete', withErrorHandler(async (event, id) => {
    const store = getStorage();
    return store.deleteRecording(id);
  }));

  // ==================== Conversion ====================

  /**
   * Convert recording to workflow
   * @param {Object|string} recording - Recording data or ID
   * @returns {Promise<Object>} Workflow definition
   */
  ipcMain.handle('browser:recording:toWorkflow', withErrorHandler(async (event, recording) => {
    const rec = getRecorder();

    // If recording is an ID, load it
    let recordingData = recording;
    if (typeof recording === 'string') {
      const store = getStorage();
      recordingData = await store.getRecording(recording);
      if (!recordingData) {
        throw new Error(`Recording ${recording} not found`);
      }
    }

    const workflow = rec.toWorkflow(recordingData);

    logger.info('[RecordingIPC] Recording converted to workflow', {
      recordingId: recordingData.id,
      stepsCount: workflow.steps.length
    });

    return workflow;
  }));

  // ==================== Baseline Management ====================

  /**
   * Save baseline
   * @param {Object} baseline - Baseline data
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:baseline:save', withErrorHandler(async (event, baseline) => {
    const store = getStorage();
    return store.saveBaseline(baseline);
  }));

  /**
   * Get baseline
   * @param {string} id - Baseline ID
   * @returns {Promise<Object>}
   */
  ipcMain.handle('browser:baseline:get', withErrorHandler(async (event, id) => {
    const store = getStorage();
    return store.getBaseline(id);
  }));

  /**
   * List baselines
   * @param {Object} options - Filter options
   * @returns {Promise<Array>}
   */
  ipcMain.handle('browser:baseline:list', withErrorHandler(async (event, options = {}) => {
    const store = getStorage();
    return store.listBaselines(options);
  }));

  /**
   * Delete baseline
   * @param {string} id - Baseline ID
   * @returns {Promise<boolean>}
   */
  ipcMain.handle('browser:baseline:delete', withErrorHandler(async (event, id) => {
    const store = getStorage();
    return store.deleteBaseline(id);
  }));

  logger.info('[RecordingIPC] All Recording IPC handlers registered (15 handlers)');
}

/**
 * Cleanup recording system
 */
function cleanupRecordingSystem() {
  recorder = null;
  player = null;
  storage = null;
  logger.info('[RecordingIPC] Recording system cleaned up');
}

module.exports = {
  registerRecordingIPC,
  initializeRecordingSystem,
  getRecorder,
  getPlayer,
  getStorage,
  cleanupRecordingSystem
};
