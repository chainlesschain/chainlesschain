"use strict";

const {
  VSCodiumAdapter,
  VSCODIUM_NAME,
  VSCODIUM_VERSION,
} = require("./adapter");
const { defaultVscodiumRoot } = require("./vscodium-reader");
const sharedReader = require("../vscode/vscode-reader");

module.exports = {
  VSCodiumAdapter,
  VSCODIUM_NAME,
  VSCODIUM_VERSION,
  defaultVscodiumRoot,
  decodeFileUri: sharedReader.decodeFileUri,
  readWorkspaces: sharedReader.readWorkspaces,
  readTerminalHistory: sharedReader.readTerminalHistory,
  readLocalHistory: sharedReader.readLocalHistory,
};
