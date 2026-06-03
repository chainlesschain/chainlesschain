"use strict";

const {
  WinRecentAdapter,
  WIN_RECENT_NAME,
  WIN_RECENT_VERSION,
} = require("./adapter");
const reader = require("./win-recent-reader");

module.exports = {
  WinRecentAdapter,
  WIN_RECENT_NAME,
  WIN_RECENT_VERSION,
  defaultRecentDir: reader.defaultRecentDir,
  readRecent: reader.readRecent,
};
