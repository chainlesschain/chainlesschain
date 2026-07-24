"use strict";

const {
  BrowserHistoryChromeAdapter,
} = require("../browser-history-chrome/adapter");
const {
  defaultVivaldiProfileDir,
} = require("../browser-history-chrome/chrome-db-reader");

const NAME = "browser-history-vivaldi";
const VERSION = "0.2.0";

class BrowserHistoryVivaldiAdapter extends BrowserHistoryChromeAdapter {
  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "vivaldi",
      defaultProfileDir: defaultVivaldiProfileDir,
    };
  }
}

module.exports = {
  BrowserHistoryVivaldiAdapter,
  BROWSER_HISTORY_VIVALDI_NAME: NAME,
  BROWSER_HISTORY_VIVALDI_VERSION: VERSION,
};
