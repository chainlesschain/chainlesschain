"use strict";

const adapter = require("./adapter");
const reader = require("./firefox-db-reader");

module.exports = {
  BrowserHistoryFirefoxAdapter: adapter.BrowserHistoryFirefoxAdapter,
  BROWSER_HISTORY_FIREFOX_NAME: adapter.BROWSER_HISTORY_FIREFOX_NAME,
  BROWSER_HISTORY_FIREFOX_VERSION: adapter.BROWSER_HISTORY_FIREFOX_VERSION,
  canonicalFirefoxProfileDir: adapter.canonicalProfileDir,
  firefoxProfileFingerprint: adapter.profileFingerprint,
  firefoxScopeForProfile: adapter.scopeForProfile,
  cleanupFirefoxPlacesSnapshot: reader.cleanupPlacesSnapshot,
  copyFirefoxPlacesSnapshot: reader.copyPlacesSnapshot,
  decodeFirefoxVisitType: reader.decodeVisitType,
  defaultFirefoxProfileDir: reader.defaultFirefoxProfileDir,
  defaultFirefoxRoots: reader.defaultFirefoxRoots,
  findFirefoxProfiles: reader.findFirefoxProfiles,
  normalizeFirefoxProfilePath: reader.normalizeFirefoxProfilePath,
  parseFirefoxProfilesIni: reader.parseIni,
  firefoxPrTimeUsToEpochMs: reader.prTimeUsToEpochMs,
  readFirefoxData: reader.readFirefoxData,
};
