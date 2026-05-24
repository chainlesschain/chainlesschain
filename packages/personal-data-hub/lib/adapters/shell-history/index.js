"use strict";

const {
  ShellHistoryAdapter,
  SHELL_HISTORY_NAME,
  SHELL_HISTORY_VERSION,
} = require("./adapter");
const reader = require("./shell-reader");

module.exports = {
  ShellHistoryAdapter,
  SHELL_HISTORY_NAME,
  SHELL_HISTORY_VERSION,
  defaultHistorySources: reader.defaultHistorySources,
  readHistoryFile: reader.readHistoryFile,
  readAllHistory: reader.readAllHistory,
};
