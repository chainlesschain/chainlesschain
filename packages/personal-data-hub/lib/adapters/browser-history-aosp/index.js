"use strict";

const {
  BrowserHistoryAospAdapter,
  BROWSER_HISTORY_AOSP_NAME,
  BROWSER_HISTORY_AOSP_VERSION,
} = require("./adapter");
const reader = require("./aosp-db-reader");

module.exports = {
  BrowserHistoryAospAdapter,
  BROWSER_HISTORY_AOSP_NAME,
  BROWSER_HISTORY_AOSP_VERSION,
  copyDbSnapshot: reader.copyDbSnapshot,
  cleanupDbSnapshot: reader.cleanupDbSnapshot,
  readHistory: reader.readHistory,
  readBookmarks: reader.readBookmarks,
  normalizeEpochMs: reader.normalizeEpochMs,
};
