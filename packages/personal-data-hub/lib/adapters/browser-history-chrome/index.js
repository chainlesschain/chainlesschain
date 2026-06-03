"use strict";

const {
  BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME,
  BROWSER_HISTORY_CHROME_VERSION,
} = require("./adapter");
const dbReader = require("./chrome-db-reader");
const bookmarksReader = require("./bookmarks-reader");

module.exports = {
  BrowserHistoryChromeAdapter,
  BROWSER_HISTORY_CHROME_NAME,
  BROWSER_HISTORY_CHROME_VERSION,
  defaultChromeProfileDir: dbReader.defaultChromeProfileDir,
  copyHistorySnapshot: dbReader.copyHistorySnapshot,
  cleanupHistorySnapshot: dbReader.cleanupHistorySnapshot,
  readVisits: dbReader.readVisits,
  readBookmarks: bookmarksReader.readBookmarks,
  webkitUsToEpochMs: dbReader.webkitUsToEpochMs,
  epochMsToWebkitUs: dbReader.epochMsToWebkitUs,
  decodeTransition: dbReader.decodeTransition,
};
