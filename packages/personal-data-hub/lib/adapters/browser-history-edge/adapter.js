"use strict";

// BrowserHistoryEdgeAdapter — Microsoft Edge is Chromium under the hood,
// so the History SQLite schema + Bookmarks JSON layout are byte-identical
// to Chrome. Only the on-disk profile root differs. Subclass the Chrome
// adapter and override the browser config; everything else (copy-then-read
// snapshot, bookmark walker, normalize, etc.) is inherited.

const {
  BrowserHistoryChromeAdapter,
} = require("../browser-history-chrome/adapter");
const {
  defaultEdgeProfileDir,
} = require("../browser-history-chrome/chrome-db-reader");

const NAME = "browser-history-edge";
const VERSION = "0.1.0";

class BrowserHistoryEdgeAdapter extends BrowserHistoryChromeAdapter {
  _browserConfig() {
    return {
      name: NAME,
      version: VERSION,
      browser: "edge",
      defaultProfileDir: defaultEdgeProfileDir,
    };
  }
}

module.exports = {
  BrowserHistoryEdgeAdapter,
  BROWSER_HISTORY_EDGE_NAME: NAME,
  BROWSER_HISTORY_EDGE_VERSION: VERSION,
};
