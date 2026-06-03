"use strict";

const { KeyProvider } = require("./key-provider-base");
const { MD5KeyProvider } = require("./md5-key-provider");

// FridaKeyProvider depends on the optional `frida` nodejs binding. Load
// lazily so users on devices without the binding can still use the v0.5
// MD5 path. Phase 12.6.3 ships the implementation.
let FridaKeyProvider = null;
try {
  // eslint-disable-next-line global-require
  ({ FridaKeyProvider } = require("./frida-key-provider"));
} catch (_e) {
  // Module not yet built / frida binding missing — leave null. Callers
  // that need it should require it directly so they see the real error.
}

module.exports = {
  KeyProvider,
  MD5KeyProvider,
  FridaKeyProvider,
};
