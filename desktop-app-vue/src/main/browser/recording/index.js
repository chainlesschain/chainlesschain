/**
 * Browser Recording System - Entry Point
 *
 * @module browser/recording
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { BrowserRecorder, EventType, RecordingState } = require('./recorder');
const { RecordingPlayer, PlaybackState, PlaybackSpeed } = require('./player');
const { RecordingStorage } = require('./recording-storage');
const {
  registerRecordingIPC,
  initializeRecordingSystem,
  getRecorder,
  getPlayer,
  getStorage,
  cleanupRecordingSystem
} = require('./recording-ipc');

module.exports = {
  // Recorder
  BrowserRecorder,
  EventType,
  RecordingState,

  // Player
  RecordingPlayer,
  PlaybackState,
  PlaybackSpeed,

  // Storage
  RecordingStorage,

  // IPC
  registerRecordingIPC,
  initializeRecordingSystem,
  getRecorder,
  getPlayer,
  getStorage,
  cleanupRecordingSystem
};
