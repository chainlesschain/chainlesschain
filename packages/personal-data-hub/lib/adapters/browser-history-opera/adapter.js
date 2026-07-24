"use strict";

const {
  BrowserHistoryChromeAdapter,
} = require("../browser-history-chrome/adapter");
const {
  defaultOperaProfileDir,
} = require("../browser-history-chrome/chrome-db-reader");

const NAME = "browser-history-opera";
const VERSION = "0.2.0";

class BrowserHistoryOperaAdapter extends BrowserHistoryChromeAdapter {
  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "opera",
      defaultProfileDir: defaultOperaProfileDir,
    };
  }
}

module.exports = {
  BrowserHistoryOperaAdapter,
  BROWSER_HISTORY_OPERA_NAME: NAME,
  BROWSER_HISTORY_OPERA_VERSION: VERSION,
};
