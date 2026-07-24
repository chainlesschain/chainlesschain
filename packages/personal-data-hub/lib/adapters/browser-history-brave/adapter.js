"use strict";

const {
  BrowserHistoryChromeAdapter,
} = require("../browser-history-chrome/adapter");
const {
  defaultBraveProfileDir,
} = require("../browser-history-chrome/chrome-db-reader");

const NAME = "browser-history-brave";
const VERSION = "0.2.0";

class BrowserHistoryBraveAdapter extends BrowserHistoryChromeAdapter {
  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "brave",
      defaultProfileDir: defaultBraveProfileDir,
    };
  }
}

module.exports = {
  BrowserHistoryBraveAdapter,
  BROWSER_HISTORY_BRAVE_NAME: NAME,
  BROWSER_HISTORY_BRAVE_VERSION: VERSION,
};
