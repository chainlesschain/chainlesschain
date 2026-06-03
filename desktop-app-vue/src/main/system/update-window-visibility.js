/**
 * 决定更新事件（downloaded / not-available / error）触发时是否需要 OS 系统
 * 通知兜底。
 *
 * 自 v5.0.3.44 起更新提示走渲染端 AppUpdateNotifier 卡片（窗口右下角），不再
 * 弹原生 dialog。这套 UI 只在主窗口可见时有意义——用户把窗口最小化到托盘后
 * 从托盘点"检查更新"，下载完成 / "已是最新版" / 错误都画在不可见窗口里，等
 * 于哑响。dialog.showMessageBox(parentWindow, ...) 在 parent 隐藏时同样不可见。
 *
 * 解法是窗口不可见时额外发一条 Electron Notification，点击通知亮窗口让用户
 * 看到 notifier 卡片 / dialog。
 *
 * 抽出来是为了单测——auto-updater.js 整文件 require 会拉 electron-updater
 * 真单例，跑不动（同 classifyUpdateError 的原因）。
 *
 * @param {Object} args
 * @param {Electron.BrowserWindow|null} args.window
 * @param {boolean} args.notificationSupported  Notification.isSupported() 结果
 * @returns {boolean} true = 应当发系统通知；false = notifier 卡片已可见或环境不支持
 */
function shouldFallbackToOsNotification({ window, notificationSupported }) {
  if (!window) {
    return false;
  }
  if (typeof window.isDestroyed === "function" && window.isDestroyed()) {
    return false;
  }
  if (!notificationSupported) {
    return false;
  }
  const visible =
    typeof window.isVisible === "function" ? window.isVisible() : false;
  const minimized =
    typeof window.isMinimized === "function" ? window.isMinimized() : false;
  // 可见且非最小化 → notifier 卡片画在窗口内 OK，不需要通知；其余情况
  // （隐藏到托盘 / 最小化 / 不可见）都需要系统通知兜底。
  return !visible || minimized;
}

module.exports = { shouldFallbackToOsNotification };
