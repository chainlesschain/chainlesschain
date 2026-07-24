"use strict";

const { CodeEditorActivityAdapter } = require("../vscode/adapter");
const { defaultVscodiumRoot } = require("./vscodium-reader");

const NAME = "vscodium";
const VERSION = "0.1.0";

const VSCODIUM_DESCRIPTOR = Object.freeze({
  name: NAME,
  version: VERSION,
  displayName: "VSCodium",
  editor: "vscodium",
  rootOption: "vscodiumRoot",
  scopeIdentityKey: "vscodiumRoot",
  errorPrefix: "VSCODIUM",
  defaultRoot: defaultVscodiumRoot,
  capabilities: Object.freeze([
    "sync:vscodium-workspace-storage",
    "sync:vscodium-globalstorage-sqlite",
    "sync:vscodium-local-history-metadata",
    "sync:profile-directory",
  ]),
});

class VSCodiumAdapter extends CodeEditorActivityAdapter {
  constructor(opts = {}) {
    super(opts, VSCODIUM_DESCRIPTOR);
  }
}

module.exports = {
  VSCodiumAdapter,
  VSCODIUM_NAME: NAME,
  VSCODIUM_VERSION: VERSION,
};
