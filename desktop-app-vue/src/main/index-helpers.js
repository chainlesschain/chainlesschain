/**
 * index-helpers — pure, side-effect-free helpers extracted verbatim from
 * index.js so the Electron entry stays focused on startup orchestration.
 *
 * Only stateless helpers live here; the imperative startup sequence (setupApp,
 * GPU crash recovery, lifecycle wiring) stays in index.js where ordering is
 * load-bearing.
 *
 * @module index-helpers
 */

const path = require("path");
const fs = require("fs");

// Resolve app icon for BrowserWindow + Windows AppUserModelId. Same dual-
// origin pattern as EnhancedTrayManager: assets/ in dev, resources/ when
// packaged (electron-builder.yml extraResources copies icon.ico into
// process.resourcesPath at build time). __dirname is src/main/ in both this
// file and index.js, so the relative candidate resolves identically.
function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, "../../assets/icon.ico"),
    path.join(process.resourcesPath || "", "icon.ico"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || candidates[0];
}

// 过滤控制台输出
const filterPatterns = [
  /Request interrupted/i,
  /interrupted by user/i,
  /没有可用实例/,
];

const shouldFilterMessage = (message) => {
  const msgStr = String(message);
  if (!msgStr || msgStr.trim() === "") {
    return true;
  }
  if (msgStr.trim().length <= 3 && /^[\]\d\s]+$/.test(msgStr.trim())) {
    return true;
  }
  return filterPatterns.some((pattern) => pattern.test(msgStr));
};

module.exports = {
  resolveAppIconPath,
  shouldFilterMessage,
};
