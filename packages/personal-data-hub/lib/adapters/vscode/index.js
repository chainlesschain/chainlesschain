"use strict";

const {
  VSCodeAdapter,
  VSCODE_NAME,
  VSCODE_VERSION,
} = require("./adapter");
const reader = require("./vscode-reader");

module.exports = {
  VSCodeAdapter,
  VSCODE_NAME,
  VSCODE_VERSION,
  defaultVscodeRoot: reader.defaultVscodeRoot,
  decodeFileUri: reader.decodeFileUri,
  readWorkspaces: reader.readWorkspaces,
  readTerminalHistory: reader.readTerminalHistory,
};
