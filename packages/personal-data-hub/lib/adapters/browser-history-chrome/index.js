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
  defaultBraveProfileDir: dbReader.defaultBraveProfileDir,
  defaultEdgeProfileDir: dbReader.defaultEdgeProfileDir,
  defaultOperaProfileDir: dbReader.defaultOperaProfileDir,
  defaultVivaldiProfileDir: dbReader.defaultVivaldiProfileDir,
  findChromiumProfiles: dbReader.findChromiumProfiles,
  copyHistorySnapshot: dbReader.copyHistorySnapshot,
  cleanupHistorySnapshot: dbReader.cleanupHistorySnapshot,
  readVisits: dbReader.readVisits,
  readVisitsPage: dbReader.readVisitsPage,
  readDownloadsPage: dbReader.readDownloadsPage,
  readBookmarks: bookmarksReader.readBookmarks,
  readBookmarksPage: bookmarksReader.readBookmarksPage,
  bookmarkCapturedAt: bookmarksReader.bookmarkCapturedAt,
  webkitUsToEpochMs: dbReader.webkitUsToEpochMs,
  epochMsToWebkitUs: dbReader.epochMsToWebkitUs,
  decodeTransition: dbReader.decodeTransition,
  decodeDownloadState: dbReader.decodeDownloadState,
  decodeDownloadDanger: dbReader.decodeDownloadDanger,
  sanitizeDownloadUrl: dbReader.sanitizeDownloadUrl,
};
