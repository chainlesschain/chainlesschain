/**
 * 权限验证器 - 基于 DID 的命令授权系统
 *
 * 功能：
 * - DID 签名验证
 * - 时间戳验证（防重放攻击）
 * - 命令权限级别检查（4 级权限体系）
 * - U-Key 二次验证（Level 4 命令）
 * - 设备权限管理
 * - 频率限制（Rate Limiting）
 *
 * 权限级别：
 * Level 1 (Public):  查询状态、读取数据
 * Level 2 (Normal):  AI 对话、文件操作
 * Level 3 (Admin):   系统控制、配置修改
 * Level 4 (Root):    核心功能、安全设置（需要 U-Key）
 *
 * @module remote/permission-gate
 */

const { logger } = require("../utils/logger");
const crypto = require("crypto");
const naclUtil = require("tweetnacl-util");
const nacl = require("tweetnacl");

/**
 * 权限级别常量
 */
const PERMISSION_LEVELS = {
  PUBLIC: 1,
  NORMAL: 2,
  ADMIN: 3,
  ROOT: 4,
};

/**
 * 默认命令权限映射
 */
const DEFAULT_COMMAND_PERMISSIONS = {
  // Level 1: Public - 查询类
  "ai.getConversations": PERMISSION_LEVELS.PUBLIC,
  "ai.getModels": PERMISSION_LEVELS.PUBLIC,
  "system.getStatus": PERMISSION_LEVELS.PUBLIC,
  "system.getInfo": PERMISSION_LEVELS.PUBLIC,
  "knowledge.search": PERMISSION_LEVELS.PUBLIC,
  "knowledge.getNotes": PERMISSION_LEVELS.PUBLIC,

  // Level 2: Normal - 操作类
  "ai.chat": PERMISSION_LEVELS.NORMAL,
  "ai.ragSearch": PERMISSION_LEVELS.NORMAL,
  "ai.controlAgent": PERMISSION_LEVELS.NORMAL,
  "system.screenshot": PERMISSION_LEVELS.NORMAL,
  "system.notify": PERMISSION_LEVELS.NORMAL,
  "file.read": PERMISSION_LEVELS.NORMAL,
  "knowledge.createNote": PERMISSION_LEVELS.NORMAL,
  "knowledge.updateNote": PERMISSION_LEVELS.NORMAL,
  "channel.*.send": PERMISSION_LEVELS.NORMAL,
  "browser.navigate": PERMISSION_LEVELS.NORMAL,
  "browser.extractData": PERMISSION_LEVELS.NORMAL,
  "browser.openUrl": PERMISSION_LEVELS.NORMAL,
  "browser.screenshot": PERMISSION_LEVELS.NORMAL,
  "browser.getStatus": PERMISSION_LEVELS.PUBLIC,
  "browser.listTabs": PERMISSION_LEVELS.PUBLIC,
  "browser.takeSnapshot": PERMISSION_LEVELS.NORMAL,
  "browser.findElement": PERMISSION_LEVELS.NORMAL,
  "browser.start": PERMISSION_LEVELS.ADMIN,
  "browser.stop": PERMISSION_LEVELS.ADMIN,
  "browser.closeTab": PERMISSION_LEVELS.NORMAL,
  "browser.focusTab": PERMISSION_LEVELS.NORMAL,
  "browser.act": PERMISSION_LEVELS.ADMIN,
  // 剪贴板操作
  "clipboard.get": PERMISSION_LEVELS.NORMAL,
  "clipboard.set": PERMISSION_LEVELS.NORMAL,
  "clipboard.watch": PERMISSION_LEVELS.NORMAL,
  "clipboard.unwatch": PERMISSION_LEVELS.NORMAL,
  "clipboard.getHistory": PERMISSION_LEVELS.NORMAL,
  "clipboard.clearHistory": PERMISSION_LEVELS.NORMAL,
  // 通知操作
  "notification.send": PERMISSION_LEVELS.NORMAL,
  "notification.sendToMobile": PERMISSION_LEVELS.NORMAL,
  "notification.getHistory": PERMISSION_LEVELS.NORMAL,
  "notification.markAsRead": PERMISSION_LEVELS.NORMAL,
  "notification.clearHistory": PERMISSION_LEVELS.NORMAL,
  "notification.getSettings": PERMISSION_LEVELS.NORMAL,
  "notification.updateSettings": PERMISSION_LEVELS.NORMAL,
  // 工作流操作
  "workflow.list": PERMISSION_LEVELS.NORMAL,
  "workflow.get": PERMISSION_LEVELS.NORMAL,
  "workflow.getStatus": PERMISSION_LEVELS.NORMAL,
  "workflow.getHistory": PERMISSION_LEVELS.NORMAL,
  "workflow.getRunning": PERMISSION_LEVELS.NORMAL,
  "workflow.create": PERMISSION_LEVELS.ADMIN,
  "workflow.update": PERMISSION_LEVELS.ADMIN,
  "workflow.delete": PERMISSION_LEVELS.ADMIN,
  "workflow.execute": PERMISSION_LEVELS.ADMIN,
  "workflow.cancel": PERMISSION_LEVELS.ADMIN,

  // Level 3: Admin - 高级操作
  "file.write": PERMISSION_LEVELS.ADMIN,
  "file.create": PERMISSION_LEVELS.ADMIN,
  "file.mkdir": PERMISSION_LEVELS.ADMIN,
  "file.delete": PERMISSION_LEVELS.ADMIN,
  "knowledge.deleteNote": PERMISSION_LEVELS.ADMIN,
  "system.execCommand": PERMISSION_LEVELS.ADMIN, // 暂定为 Admin，可升级到 ROOT
  "browser.fillForm": PERMISSION_LEVELS.ADMIN,

  // Level 4: Root - 敏感操作（需要 U-Key）
  "system.shutdown": PERMISSION_LEVELS.ROOT,
  "system.restart": PERMISSION_LEVELS.ROOT,
  "config.update": PERMISSION_LEVELS.ROOT,
  "security.changePassword": PERMISSION_LEVELS.ROOT,
  "device.revoke": PERMISSION_LEVELS.ROOT,
  "ukey.verify": PERMISSION_LEVELS.ROOT,

  // 电源控制
  "power.lock": PERMISSION_LEVELS.NORMAL,
  "power.getSchedule": PERMISSION_LEVELS.PUBLIC,
  "power.sleep": PERMISSION_LEVELS.ADMIN,
  "power.hibernate": PERMISSION_LEVELS.ADMIN,
  "power.logout": PERMISSION_LEVELS.ADMIN,
  "power.scheduleShutdown": PERMISSION_LEVELS.ADMIN,
  "power.cancelSchedule": PERMISSION_LEVELS.ADMIN,
  "power.shutdown": PERMISSION_LEVELS.ROOT,
  "power.restart": PERMISSION_LEVELS.ROOT,
  "power.confirm": PERMISSION_LEVELS.ROOT,

  // 进程管理
  "process.list": PERMISSION_LEVELS.PUBLIC,
  "process.get": PERMISSION_LEVELS.NORMAL,
  "process.getResources": PERMISSION_LEVELS.PUBLIC,
  "process.search": PERMISSION_LEVELS.PUBLIC,
  "process.kill": PERMISSION_LEVELS.ADMIN,
  "process.start": PERMISSION_LEVELS.ADMIN,

  // 媒体控制
  "media.getVolume": PERMISSION_LEVELS.PUBLIC,
  "media.getDevices": PERMISSION_LEVELS.PUBLIC,
  "media.getPlaybackStatus": PERMISSION_LEVELS.PUBLIC,
  "media.setVolume": PERMISSION_LEVELS.NORMAL,
  "media.mute": PERMISSION_LEVELS.NORMAL,
  "media.unmute": PERMISSION_LEVELS.NORMAL,
  "media.toggleMute": PERMISSION_LEVELS.NORMAL,
  "media.playSound": PERMISSION_LEVELS.NORMAL,
  "media.stopSound": PERMISSION_LEVELS.NORMAL,
  "media.mediaControl": PERMISSION_LEVELS.NORMAL,

  // 网络信息
  "network.getStatus": PERMISSION_LEVELS.PUBLIC,
  "network.getInterfaces": PERMISSION_LEVELS.PUBLIC,
  "network.getPublicIP": PERMISSION_LEVELS.PUBLIC,
  "network.getDNS": PERMISSION_LEVELS.PUBLIC,
  "network.getWifi": PERMISSION_LEVELS.PUBLIC,
  "network.getConnections": PERMISSION_LEVELS.NORMAL,
  "network.getBandwidth": PERMISSION_LEVELS.NORMAL,
  "network.ping": PERMISSION_LEVELS.NORMAL,
  "network.resolve": PERMISSION_LEVELS.NORMAL,
  "network.getSpeed": PERMISSION_LEVELS.NORMAL,
  "network.traceroute": PERMISSION_LEVELS.ADMIN,
  // 存储信息
  "storage.getDisks": PERMISSION_LEVELS.PUBLIC,
  "storage.getUsage": PERMISSION_LEVELS.PUBLIC,
  "storage.getPartitions": PERMISSION_LEVELS.PUBLIC,
  "storage.getDriveHealth": PERMISSION_LEVELS.PUBLIC,
  "storage.getStats": PERMISSION_LEVELS.NORMAL,
  "storage.getFolderSize": PERMISSION_LEVELS.NORMAL,
  "storage.getLargeFiles": PERMISSION_LEVELS.NORMAL,
  "storage.getRecentFiles": PERMISSION_LEVELS.NORMAL,
  "storage.cleanup": PERMISSION_LEVELS.ADMIN,
  "storage.emptyTrash": PERMISSION_LEVELS.ADMIN,

  // 显示器信息
  "display.getDisplays": PERMISSION_LEVELS.PUBLIC,
  "display.getPrimary": PERMISSION_LEVELS.PUBLIC,
  "display.getResolution": PERMISSION_LEVELS.PUBLIC,
  "display.getBrightness": PERMISSION_LEVELS.PUBLIC,
  "display.getScaling": PERMISSION_LEVELS.PUBLIC,
  "display.getRefreshRate": PERMISSION_LEVELS.PUBLIC,
  "display.getColorDepth": PERMISSION_LEVELS.PUBLIC,
  "display.getCursorPosition": PERMISSION_LEVELS.NORMAL,
  "display.screenshot": PERMISSION_LEVELS.NORMAL,
  "display.getWindowList": PERMISSION_LEVELS.NORMAL,
  "display.setBrightness": PERMISSION_LEVELS.ADMIN,

  // 用户浏览器控制 (通过 CDP)
  "userBrowser.findBrowsers": PERMISSION_LEVELS.PUBLIC,
  "userBrowser.getStatus": PERMISSION_LEVELS.PUBLIC,
  "userBrowser.connect": PERMISSION_LEVELS.ADMIN,
  "userBrowser.disconnect": PERMISSION_LEVELS.NORMAL,
  "userBrowser.listTabs": PERMISSION_LEVELS.NORMAL,
  "userBrowser.getActiveTab": PERMISSION_LEVELS.NORMAL,
  "userBrowser.createTab": PERMISSION_LEVELS.NORMAL,
  "userBrowser.closeTab": PERMISSION_LEVELS.NORMAL,
  "userBrowser.focusTab": PERMISSION_LEVELS.NORMAL,
  "userBrowser.navigate": PERMISSION_LEVELS.NORMAL,
  "userBrowser.goBack": PERMISSION_LEVELS.NORMAL,
  "userBrowser.goForward": PERMISSION_LEVELS.NORMAL,
  "userBrowser.refresh": PERMISSION_LEVELS.NORMAL,
  "userBrowser.executeScript": PERMISSION_LEVELS.ADMIN,
  "userBrowser.getPageContent": PERMISSION_LEVELS.NORMAL,
  "userBrowser.screenshot": PERMISSION_LEVELS.NORMAL,
  "userBrowser.getBookmarks": PERMISSION_LEVELS.NORMAL,
  "userBrowser.getHistory": PERMISSION_LEVELS.NORMAL,

  // 浏览器扩展控制
  "extension.getStatus": PERMISSION_LEVELS.PUBLIC,
  "extension.getClients": PERMISSION_LEVELS.NORMAL,
  "extension.listTabs": PERMISSION_LEVELS.NORMAL,
  "extension.createTab": PERMISSION_LEVELS.NORMAL,
  "extension.closeTab": PERMISSION_LEVELS.NORMAL,
  "extension.focusTab": PERMISSION_LEVELS.NORMAL,
  "extension.navigate": PERMISSION_LEVELS.NORMAL,
  "extension.reload": PERMISSION_LEVELS.NORMAL,
  "extension.goBack": PERMISSION_LEVELS.NORMAL,
  "extension.goForward": PERMISSION_LEVELS.NORMAL,
  "extension.getPageContent": PERMISSION_LEVELS.NORMAL,
  "extension.executeScript": PERMISSION_LEVELS.ADMIN,
  "extension.screenshot": PERMISSION_LEVELS.NORMAL,
  "extension.getBookmarks": PERMISSION_LEVELS.NORMAL,
  "extension.searchBookmarks": PERMISSION_LEVELS.NORMAL,
  "extension.createBookmark": PERMISSION_LEVELS.ADMIN,
  "extension.removeBookmark": PERMISSION_LEVELS.ADMIN,
  "extension.getHistory": PERMISSION_LEVELS.NORMAL,
  "extension.deleteHistory": PERMISSION_LEVELS.ADMIN,
  "extension.readClipboard": PERMISSION_LEVELS.NORMAL,
  "extension.writeClipboard": PERMISSION_LEVELS.NORMAL,
  "extension.showNotification": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Cookie 管理
  "extension.getCookies": PERMISSION_LEVELS.NORMAL,
  "extension.getCookie": PERMISSION_LEVELS.NORMAL,
  "extension.setCookie": PERMISSION_LEVELS.ADMIN,
  "extension.removeCookie": PERMISSION_LEVELS.ADMIN,
  "extension.clearCookies": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 下载管理
  "extension.listDownloads": PERMISSION_LEVELS.NORMAL,
  "extension.download": PERMISSION_LEVELS.NORMAL,
  "extension.cancelDownload": PERMISSION_LEVELS.NORMAL,
  "extension.pauseDownload": PERMISSION_LEVELS.NORMAL,
  "extension.resumeDownload": PERMISSION_LEVELS.NORMAL,
  "extension.openDownload": PERMISSION_LEVELS.NORMAL,
  "extension.showDownload": PERMISSION_LEVELS.NORMAL,
  "extension.eraseDownloads": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 窗口管理
  "extension.getAllWindows": PERMISSION_LEVELS.NORMAL,
  "extension.getWindow": PERMISSION_LEVELS.NORMAL,
  "extension.createWindow": PERMISSION_LEVELS.NORMAL,
  "extension.updateWindow": PERMISSION_LEVELS.NORMAL,
  "extension.removeWindow": PERMISSION_LEVELS.ADMIN,
  "extension.getCurrentWindow": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - 存储访问
  "extension.getLocalStorage": PERMISSION_LEVELS.NORMAL,
  "extension.setLocalStorage": PERMISSION_LEVELS.ADMIN,
  "extension.getSessionStorage": PERMISSION_LEVELS.NORMAL,
  "extension.setSessionStorage": PERMISSION_LEVELS.ADMIN,
  "extension.clearLocalStorage": PERMISSION_LEVELS.ADMIN,
  "extension.clearSessionStorage": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 元素交互
  "extension.hoverElement": PERMISSION_LEVELS.NORMAL,
  "extension.focusElement": PERMISSION_LEVELS.NORMAL,
  "extension.blurElement": PERMISSION_LEVELS.NORMAL,
  "extension.selectText": PERMISSION_LEVELS.NORMAL,
  "extension.getAttribute": PERMISSION_LEVELS.PUBLIC,
  "extension.setAttribute": PERMISSION_LEVELS.ADMIN,
  "extension.getBoundingRect": PERMISSION_LEVELS.PUBLIC,
  "extension.isVisible": PERMISSION_LEVELS.PUBLIC,
  "extension.waitForSelector": PERMISSION_LEVELS.NORMAL,
  "extension.dragDrop": PERMISSION_LEVELS.ADMIN,
  "extension.doubleClick": PERMISSION_LEVELS.NORMAL,
  "extension.rightClick": PERMISSION_LEVELS.NORMAL,
  "extension.type": PERMISSION_LEVELS.NORMAL,
  "extension.selectOption": PERMISSION_LEVELS.NORMAL,
  "extension.checkCheckbox": PERMISSION_LEVELS.NORMAL,
  "extension.uploadFile": PERMISSION_LEVELS.ADMIN,
  "extension.getComputedStyle": PERMISSION_LEVELS.PUBLIC,
  "extension.queryShadowDom": PERMISSION_LEVELS.NORMAL,
  "extension.executeInShadowDom": PERMISSION_LEVELS.ADMIN,
  "extension.getTableData": PERMISSION_LEVELS.PUBLIC,
  "extension.simulateKeyboard": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 页面操作
  "extension.printPage": PERMISSION_LEVELS.NORMAL,
  "extension.saveToPdf": PERMISSION_LEVELS.ADMIN,
  "extension.getConsoleLogs": PERMISSION_LEVELS.NORMAL,
  "extension.setViewport": PERMISSION_LEVELS.ADMIN,
  "extension.emulateDevice": PERMISSION_LEVELS.ADMIN,
  "extension.setGeolocation": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 浏览数据
  "extension.clearBrowsingData": PERMISSION_LEVELS.ROOT,

  // 扩展 - 网络拦截
  "extension.enableNetworkInterception": PERMISSION_LEVELS.ADMIN,
  "extension.disableNetworkInterception": PERMISSION_LEVELS.ADMIN,
  "extension.setRequestBlocking": PERMISSION_LEVELS.ADMIN,
  "extension.clearRequestBlocking": PERMISSION_LEVELS.ADMIN,
  "extension.getNetworkRequests": PERMISSION_LEVELS.NORMAL,
  "extension.mockResponse": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 控制台捕获
  "extension.enableConsoleCapture": PERMISSION_LEVELS.NORMAL,
  "extension.disableConsoleCapture": PERMISSION_LEVELS.NORMAL,
  "extension.getCapturedConsoleLogs": PERMISSION_LEVELS.NORMAL,
  "extension.clearConsoleLogs": PERMISSION_LEVELS.NORMAL,

  // 扩展 - IndexedDB
  "extension.getIndexedDBDatabases": PERMISSION_LEVELS.NORMAL,
  "extension.getIndexedDBData": PERMISSION_LEVELS.NORMAL,
  "extension.setIndexedDBData": PERMISSION_LEVELS.ADMIN,
  "extension.deleteIndexedDBData": PERMISSION_LEVELS.ADMIN,
  "extension.clearIndexedDBStore": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 性能监控
  "extension.getPerformanceMetrics": PERMISSION_LEVELS.PUBLIC,
  "extension.getPerformanceEntries": PERMISSION_LEVELS.PUBLIC,
  "extension.startPerformanceTrace": PERMISSION_LEVELS.ADMIN,
  "extension.stopPerformanceTrace": PERMISSION_LEVELS.ADMIN,

  // 扩展 - CSS 注入
  "extension.injectCSS": PERMISSION_LEVELS.ADMIN,
  "extension.removeCSS": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 无障碍
  "extension.getAccessibilityTree": PERMISSION_LEVELS.PUBLIC,
  "extension.getElementRole": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - 框架管理
  "extension.listFrames": PERMISSION_LEVELS.NORMAL,
  "extension.executeScriptInFrame": PERMISSION_LEVELS.ADMIN,

  // ==================== Phase 17: Advanced Debugging ====================

  // 扩展 - WebSocket 调试
  "extension.enableWebSocketDebugging": PERMISSION_LEVELS.ADMIN,
  "extension.disableWebSocketDebugging": PERMISSION_LEVELS.ADMIN,
  "extension.getWebSocketConnections": PERMISSION_LEVELS.NORMAL,
  "extension.getWebSocketMessages": PERMISSION_LEVELS.NORMAL,
  "extension.sendWebSocketMessage": PERMISSION_LEVELS.ADMIN,
  "extension.closeWebSocketConnection": PERMISSION_LEVELS.ADMIN,

  // 扩展 - Service Worker 管理
  "extension.listServiceWorkers": PERMISSION_LEVELS.NORMAL,
  "extension.getServiceWorkerInfo": PERMISSION_LEVELS.NORMAL,
  "extension.unregisterServiceWorker": PERMISSION_LEVELS.ADMIN,
  "extension.updateServiceWorker": PERMISSION_LEVELS.ADMIN,
  "extension.postMessageToServiceWorker": PERMISSION_LEVELS.ADMIN,

  // 扩展 - Cache Storage
  "extension.listCaches": PERMISSION_LEVELS.NORMAL,
  "extension.listCacheEntries": PERMISSION_LEVELS.NORMAL,
  "extension.getCacheEntry": PERMISSION_LEVELS.NORMAL,
  "extension.deleteCacheEntry": PERMISSION_LEVELS.ADMIN,
  "extension.deleteCache": PERMISSION_LEVELS.ADMIN,
  "extension.addCacheEntry": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 安全信息
  "extension.getCertificateInfo": PERMISSION_LEVELS.NORMAL,
  "extension.getSecurityState": PERMISSION_LEVELS.PUBLIC,
  "extension.checkMixedContent": PERMISSION_LEVELS.PUBLIC,
  "extension.getSitePermissions": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 动画控制
  "extension.listAnimations": PERMISSION_LEVELS.NORMAL,
  "extension.pauseAnimation": PERMISSION_LEVELS.NORMAL,
  "extension.playAnimation": PERMISSION_LEVELS.NORMAL,
  "extension.setAnimationSpeed": PERMISSION_LEVELS.NORMAL,
  "extension.seekAnimation": PERMISSION_LEVELS.NORMAL,
  "extension.cancelAnimation": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 布局检查
  "extension.getBoxModel": PERMISSION_LEVELS.PUBLIC,
  "extension.getComputedLayout": PERMISSION_LEVELS.PUBLIC,
  "extension.highlightNode": PERMISSION_LEVELS.NORMAL,
  "extension.hideHighlight": PERMISSION_LEVELS.NORMAL,
  "extension.getNodeInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.forceElementState": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 覆盖率分析
  "extension.startJSCoverage": PERMISSION_LEVELS.ADMIN,
  "extension.stopJSCoverage": PERMISSION_LEVELS.ADMIN,
  "extension.startCSSCoverage": PERMISSION_LEVELS.ADMIN,
  "extension.stopCSSCoverage": PERMISSION_LEVELS.ADMIN,
  "extension.getJSCoverageResults": PERMISSION_LEVELS.NORMAL,
  "extension.getCSSCoverageResults": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 内存分析
  "extension.getMemoryInfo": PERMISSION_LEVELS.NORMAL,
  "extension.takeHeapSnapshot": PERMISSION_LEVELS.ADMIN,
  "extension.startMemorySampling": PERMISSION_LEVELS.ADMIN,
  "extension.stopMemorySampling": PERMISSION_LEVELS.ADMIN,
  "extension.forceGarbageCollection": PERMISSION_LEVELS.ADMIN,

  // ==================== Phase 18: DOM & Input Tools ====================

  // 扩展 - DOM 变化监控
  "extension.observeMutations": PERMISSION_LEVELS.NORMAL,
  "extension.stopObservingMutations": PERMISSION_LEVELS.NORMAL,
  "extension.getMutations": PERMISSION_LEVELS.NORMAL,
  "extension.clearMutations": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 事件监听器检查
  "extension.getEventListeners": PERMISSION_LEVELS.NORMAL,
  "extension.removeEventListener": PERMISSION_LEVELS.ADMIN,
  "extension.monitorEvents": PERMISSION_LEVELS.NORMAL,
  "extension.stopMonitoringEvents": PERMISSION_LEVELS.NORMAL,
  "extension.getEventLog": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 输入录制
  "extension.startInputRecording": PERMISSION_LEVELS.NORMAL,
  "extension.stopInputRecording": PERMISSION_LEVELS.NORMAL,
  "extension.getInputRecording": PERMISSION_LEVELS.NORMAL,
  "extension.replayInputs": PERMISSION_LEVELS.ADMIN,
  "extension.clearInputRecording": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 媒体模拟
  "extension.emulateColorScheme": PERMISSION_LEVELS.NORMAL,
  "extension.emulateReducedMotion": PERMISSION_LEVELS.NORMAL,
  "extension.emulateForcedColors": PERMISSION_LEVELS.NORMAL,
  "extension.emulateVisionDeficiency": PERMISSION_LEVELS.NORMAL,
  "extension.clearMediaEmulation": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 页面生命周期
  "extension.getPageLifecycleState": PERMISSION_LEVELS.PUBLIC,
  "extension.subscribeLifecycleChanges": PERMISSION_LEVELS.NORMAL,
  "extension.freezePage": PERMISSION_LEVELS.ADMIN,
  "extension.resumePage": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 字体检查
  "extension.getUsedFonts": PERMISSION_LEVELS.PUBLIC,
  "extension.getComputedFonts": PERMISSION_LEVELS.PUBLIC,
  "extension.checkFontAvailability": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - 测量工具
  "extension.measureDistance": PERMISSION_LEVELS.PUBLIC,
  "extension.measureElementSize": PERMISSION_LEVELS.PUBLIC,
  "extension.enableRuler": PERMISSION_LEVELS.NORMAL,
  "extension.disableRuler": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 颜色选取器
  "extension.pickColorFromPoint": PERMISSION_LEVELS.NORMAL,
  "extension.getElementColors": PERMISSION_LEVELS.PUBLIC,
  "extension.enableColorPicker": PERMISSION_LEVELS.NORMAL,
  "extension.disableColorPicker": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 存储检查 (增强)
  "extension.getStorageQuota": PERMISSION_LEVELS.PUBLIC,
  "extension.getStorageUsage": PERMISSION_LEVELS.PUBLIC,
  "extension.exportAllStorage": PERMISSION_LEVELS.ADMIN,
  "extension.importAllStorage": PERMISSION_LEVELS.ROOT,

  // ==================== Phase 19: Network & Device Emulation ====================

  // 扩展 - 网络节流
  "extension.setNetworkThrottling": PERMISSION_LEVELS.ADMIN,
  "extension.clearNetworkThrottling": PERMISSION_LEVELS.ADMIN,
  "extension.getThrottlingProfiles": PERMISSION_LEVELS.PUBLIC,
  "extension.setOfflineMode": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 设备模拟
  "extension.setUserAgent": PERMISSION_LEVELS.ADMIN,
  "extension.getUserAgent": PERMISSION_LEVELS.PUBLIC,
  "extension.setTimezone": PERMISSION_LEVELS.ADMIN,
  "extension.setLocale": PERMISSION_LEVELS.ADMIN,
  "extension.setGeolocationOverride": PERMISSION_LEVELS.ADMIN,
  "extension.clearGeolocationOverride": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 触摸模拟
  "extension.enableTouchEmulation": PERMISSION_LEVELS.NORMAL,
  "extension.disableTouchEmulation": PERMISSION_LEVELS.NORMAL,
  "extension.emulateTap": PERMISSION_LEVELS.NORMAL,
  "extension.emulateSwipe": PERMISSION_LEVELS.NORMAL,
  "extension.emulatePinch": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 传感器模拟
  "extension.setSensorOrientation": PERMISSION_LEVELS.ADMIN,
  "extension.setAccelerometer": PERMISSION_LEVELS.ADMIN,
  "extension.setAmbientLight": PERMISSION_LEVELS.ADMIN,
  "extension.clearSensorOverrides": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 视口管理 (Enhanced - Phase 19)
  "extension.setViewportEmulation": PERMISSION_LEVELS.NORMAL,
  "extension.getViewportInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.setDeviceMetrics": PERMISSION_LEVELS.ADMIN,
  "extension.clearDeviceMetrics": PERMISSION_LEVELS.ADMIN,
  "extension.getViewportPresets": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - 截图对比
  "extension.captureScreenshot": PERMISSION_LEVELS.NORMAL,
  "extension.captureElementScreenshot": PERMISSION_LEVELS.NORMAL,
  "extension.compareScreenshots": PERMISSION_LEVELS.NORMAL,
  "extension.captureFullPageScreenshot": PERMISSION_LEVELS.NORMAL,

  // 扩展 - 高级剪贴板
  "extension.readRichClipboard": PERMISSION_LEVELS.NORMAL,
  "extension.writeRichClipboard": PERMISSION_LEVELS.ADMIN,
  "extension.getClipboardFormats": PERMISSION_LEVELS.NORMAL,
  "extension.writeImageToClipboard": PERMISSION_LEVELS.ADMIN,

  // 扩展 - 打印/PDF
  "extension.getPrintPreview": PERMISSION_LEVELS.NORMAL,
  "extension.printToPDF": PERMISSION_LEVELS.ADMIN,
  "extension.getPrintSettings": PERMISSION_LEVELS.PUBLIC,

  // ==================== Phase 20: Web APIs & System Info ====================

  // 扩展 - Web Workers
  "extension.listWebWorkers": PERMISSION_LEVELS.NORMAL,
  "extension.terminateWorker": PERMISSION_LEVELS.ADMIN,
  "extension.postMessageToWorker": PERMISSION_LEVELS.ADMIN,
  "extension.getSharedWorkers": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Broadcast Channel
  "extension.createBroadcastChannel": PERMISSION_LEVELS.NORMAL,
  "extension.broadcastMessage": PERMISSION_LEVELS.NORMAL,
  "extension.closeBroadcastChannel": PERMISSION_LEVELS.NORMAL,
  "extension.listBroadcastChannels": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Web Audio
  "extension.getAudioContexts": PERMISSION_LEVELS.NORMAL,
  "extension.suspendAudioContext": PERMISSION_LEVELS.NORMAL,
  "extension.resumeAudioContext": PERMISSION_LEVELS.NORMAL,
  "extension.getAudioNodes": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Canvas/WebGL
  "extension.listCanvasElements": PERMISSION_LEVELS.PUBLIC,
  "extension.getCanvasContext": PERMISSION_LEVELS.PUBLIC,
  "extension.canvasToDataURL": PERMISSION_LEVELS.NORMAL,
  "extension.getWebGLInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.getWebGLExtensions": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Media Devices
  "extension.enumerateMediaDevices": PERMISSION_LEVELS.NORMAL,
  "extension.getSupportedConstraints": PERMISSION_LEVELS.PUBLIC,
  "extension.getDisplayMediaCapabilities": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - System Info
  "extension.getBatteryInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.getConnectionInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.getDeviceMemory": PERMISSION_LEVELS.PUBLIC,
  "extension.getHardwareInfo": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Permissions
  "extension.queryPermission": PERMISSION_LEVELS.NORMAL,
  "extension.queryAllPermissions": PERMISSION_LEVELS.NORMAL,
  "extension.requestPermission": PERMISSION_LEVELS.ADMIN,

  // 扩展 - Notifications
  "extension.getNotificationPermission": PERMISSION_LEVELS.PUBLIC,
  "extension.requestNotificationPermission": PERMISSION_LEVELS.ADMIN,
  "extension.createPageNotification": PERMISSION_LEVELS.ADMIN,

  // 扩展 - Fullscreen
  "extension.enterFullscreen": PERMISSION_LEVELS.NORMAL,
  "extension.exitFullscreen": PERMISSION_LEVELS.NORMAL,
  "extension.getFullscreenState": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Pointer Lock
  "extension.requestPointerLock": PERMISSION_LEVELS.ADMIN,
  "extension.exitPointerLock": PERMISSION_LEVELS.NORMAL,
  "extension.getPointerLockState": PERMISSION_LEVELS.PUBLIC,

  // ========== Phase 21: Accessibility & Performance ==========

  // 扩展 - Accessibility (Enhanced)
  // Note: extension.getAccessibilityTree already defined earlier
  "extension.getARIAProperties": PERMISSION_LEVELS.PUBLIC,
  "extension.checkColorContrast": PERMISSION_LEVELS.PUBLIC,
  "extension.getFocusOrder": PERMISSION_LEVELS.PUBLIC,
  "extension.getAccessibilityLandmarks": PERMISSION_LEVELS.PUBLIC,
  "extension.getHeadingStructure": PERMISSION_LEVELS.PUBLIC,
  "extension.checkAltTexts": PERMISSION_LEVELS.PUBLIC,
  "extension.checkFormLabels": PERMISSION_LEVELS.PUBLIC,
  "extension.simulateAccessibility": PERMISSION_LEVELS.NORMAL,
  "extension.runAccessibilityAudit": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Performance Metrics (Enhanced)
  // Note: extension.getPerformanceMetrics already defined earlier
  "extension.getPerformanceTimeline": PERMISSION_LEVELS.PUBLIC,
  "extension.getLongTasks": PERMISSION_LEVELS.PUBLIC,
  "extension.getLayoutShifts": PERMISSION_LEVELS.PUBLIC,
  "extension.getPaintTiming": PERMISSION_LEVELS.PUBLIC,
  "extension.getResourceTiming": PERMISSION_LEVELS.PUBLIC,
  "extension.getNavigationTiming": PERMISSION_LEVELS.PUBLIC,
  "extension.measureElementPerformance": PERMISSION_LEVELS.PUBLIC,
  "extension.createPerformanceMark": PERMISSION_LEVELS.NORMAL,
  "extension.measureBetweenMarks": PERMISSION_LEVELS.NORMAL,
  "extension.clearPerformanceMarks": PERMISSION_LEVELS.NORMAL,
  // Note: extension.getPerformanceEntries already defined earlier

  // 扩展 - Memory Analysis
  "extension.getMemoryUsage": PERMISSION_LEVELS.PUBLIC,
  "extension.measureHeapUsage": PERMISSION_LEVELS.PUBLIC,
  "extension.getJSHeapSize": PERMISSION_LEVELS.PUBLIC,
  "extension.detectMemoryLeaks": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Frame Analysis
  "extension.getAllFrames": PERMISSION_LEVELS.PUBLIC,
  "extension.getFrameInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.executeInFrame": PERMISSION_LEVELS.ADMIN,
  "extension.getFrameTree": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Security Analysis (Enhanced)
  "extension.getSecurityInfo": PERMISSION_LEVELS.PUBLIC,
  "extension.getCSPInfo": PERMISSION_LEVELS.PUBLIC,
  // Note: extension.checkMixedContent and extension.getCertificateInfo already defined earlier
  "extension.checkCORSIssues": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Network Timing
  "extension.getNetworkTiming": PERMISSION_LEVELS.PUBLIC,
  "extension.getNetworkWaterfall": PERMISSION_LEVELS.PUBLIC,
  "extension.analyzeNetworkRequests": PERMISSION_LEVELS.PUBLIC,

  // ========== Phase 22: WebRTC & Advanced Storage ==========

  // 扩展 - WebRTC
  "extension.getWebRTCPeerConnections": PERMISSION_LEVELS.NORMAL,
  "extension.getWebRTCConnectionStats": PERMISSION_LEVELS.NORMAL,
  "extension.getWebRTCDataChannels": PERMISSION_LEVELS.NORMAL,
  "extension.getWebRTCMediaStreams": PERMISSION_LEVELS.NORMAL,
  "extension.getICECandidates": PERMISSION_LEVELS.NORMAL,
  "extension.getLocalDescription": PERMISSION_LEVELS.NORMAL,
  "extension.getRemoteDescription": PERMISSION_LEVELS.NORMAL,
  "extension.monitorWebRTCConnection": PERMISSION_LEVELS.NORMAL,
  "extension.closeWebRTCConnection": PERMISSION_LEVELS.ADMIN,

  // 扩展 - Advanced IndexedDB
  "extension.listIndexedDBDatabases": PERMISSION_LEVELS.NORMAL,
  "extension.getIndexedDBDatabaseInfo": PERMISSION_LEVELS.NORMAL,
  "extension.getIndexedDBObjectStores": PERMISSION_LEVELS.NORMAL,
  "extension.getIndexedDBStoreData": PERMISSION_LEVELS.NORMAL,
  "extension.getIndexedDBStoreIndexes": PERMISSION_LEVELS.NORMAL,
  "extension.queryIndexedDBByIndex": PERMISSION_LEVELS.NORMAL,
  "extension.countIndexedDBRecords": PERMISSION_LEVELS.NORMAL,
  "extension.deleteIndexedDBDatabase": PERMISSION_LEVELS.ROOT,
  // Note: extension.clearIndexedDBStore already defined earlier
  "extension.exportIndexedDBDatabase": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Web Components / Shadow DOM
  "extension.getCustomElements": PERMISSION_LEVELS.PUBLIC,
  "extension.getShadowRoots": PERMISSION_LEVELS.PUBLIC,
  "extension.queryShadowDOM": PERMISSION_LEVELS.PUBLIC,
  "extension.getSlottedContent": PERMISSION_LEVELS.PUBLIC,
  "extension.getAdoptedStylesheets": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Drag and Drop
  "extension.simulateDrag": PERMISSION_LEVELS.NORMAL,
  "extension.simulateFileDrop": PERMISSION_LEVELS.ADMIN,
  "extension.getDropZones": PERMISSION_LEVELS.PUBLIC,
  "extension.getDraggableElements": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Selection & Range
  "extension.getTextSelection": PERMISSION_LEVELS.PUBLIC,
  "extension.setTextSelection": PERMISSION_LEVELS.NORMAL,
  "extension.selectAllText": PERMISSION_LEVELS.NORMAL,
  "extension.clearSelection": PERMISSION_LEVELS.NORMAL,
  "extension.getSelectedHTML": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - History & Navigation
  "extension.getHistoryState": PERMISSION_LEVELS.PUBLIC,
  "extension.pushHistoryState": PERMISSION_LEVELS.NORMAL,
  "extension.replaceHistoryState": PERMISSION_LEVELS.NORMAL,
  "extension.getHistoryLength": PERMISSION_LEVELS.PUBLIC,
  "extension.historyGo": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Intersection Observer
  "extension.observeIntersection": PERMISSION_LEVELS.PUBLIC,
  "extension.getVisibleElements": PERMISSION_LEVELS.PUBLIC,
  "extension.checkElementVisibility": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Resize Observer
  "extension.observeResize": PERMISSION_LEVELS.PUBLIC,
  "extension.getElementSizes": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Mutation Summary
  "extension.getMutationSummary": PERMISSION_LEVELS.PUBLIC,
  "extension.getMutationChangeHistory": PERMISSION_LEVELS.PUBLIC,

  // ==================== Phase 23: Advanced Web APIs ====================

  // 扩展 - Web Share API
  "extension.canShare": PERMISSION_LEVELS.PUBLIC,
  "extension.share": PERMISSION_LEVELS.NORMAL,
  "extension.shareFiles": PERMISSION_LEVELS.ADMIN,
  "extension.getShareTargets": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Credential Management API
  "extension.getCredential": PERMISSION_LEVELS.ADMIN,
  "extension.storeCredential": PERMISSION_LEVELS.ROOT,
  "extension.createCredential": PERMISSION_LEVELS.ROOT,
  "extension.preventSilentAccess": PERMISSION_LEVELS.NORMAL,
  "extension.isConditionalMediationAvailable": PERMISSION_LEVELS.PUBLIC,
  "extension.getPublicKeyCredential": PERMISSION_LEVELS.ADMIN,

  // 扩展 - Screen Wake Lock API
  "extension.requestWakeLock": PERMISSION_LEVELS.NORMAL,
  "extension.releaseWakeLock": PERMISSION_LEVELS.NORMAL,
  "extension.getWakeLockState": PERMISSION_LEVELS.PUBLIC,
  "extension.isWakeLockSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - File System Access API
  "extension.showOpenFilePicker": PERMISSION_LEVELS.ADMIN,
  "extension.showSaveFilePicker": PERMISSION_LEVELS.ADMIN,
  "extension.showDirectoryPicker": PERMISSION_LEVELS.ADMIN,
  "extension.getFileSystemHandle": PERMISSION_LEVELS.ADMIN,
  "extension.readFileFromHandle": PERMISSION_LEVELS.ADMIN,
  "extension.writeFileToHandle": PERMISSION_LEVELS.ROOT,
  "extension.getFileHandleInfo": PERMISSION_LEVELS.NORMAL,
  "extension.removeFileEntry": PERMISSION_LEVELS.ROOT,

  // 扩展 - Tab Groups API
  "extension.createTabGroup": PERMISSION_LEVELS.NORMAL,
  "extension.getTabGroup": PERMISSION_LEVELS.PUBLIC,
  "extension.getAllTabGroups": PERMISSION_LEVELS.PUBLIC,
  "extension.updateTabGroup": PERMISSION_LEVELS.NORMAL,
  "extension.moveTabGroup": PERMISSION_LEVELS.NORMAL,
  "extension.ungroupTabs": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Eye Dropper API
  "extension.openEyeDropper": PERMISSION_LEVELS.NORMAL,
  "extension.isEyeDropperSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Speech Synthesis API
  "extension.speak": PERMISSION_LEVELS.NORMAL,
  "extension.cancelSpeech": PERMISSION_LEVELS.NORMAL,
  "extension.pauseSpeech": PERMISSION_LEVELS.NORMAL,
  "extension.resumeSpeech": PERMISSION_LEVELS.NORMAL,
  "extension.getVoices": PERMISSION_LEVELS.PUBLIC,
  "extension.isSpeaking": PERMISSION_LEVELS.PUBLIC,
  "extension.isSpeechPending": PERMISSION_LEVELS.PUBLIC,
  "extension.isSpeechPaused": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Background Sync API
  "extension.registerBackgroundSync": PERMISSION_LEVELS.ADMIN,
  "extension.getBackgroundSyncTags": PERMISSION_LEVELS.NORMAL,
  "extension.getBackgroundSyncRegistration": PERMISSION_LEVELS.NORMAL,
  "extension.getBackgroundSyncRegistrations": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Periodic Background Sync API
  "extension.registerPeriodicSync": PERMISSION_LEVELS.ADMIN,
  "extension.unregisterPeriodicSync": PERMISSION_LEVELS.ADMIN,
  "extension.getPeriodicSyncTags": PERMISSION_LEVELS.NORMAL,
  "extension.getPeriodicSyncMinInterval": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Idle Detection API
  "extension.requestIdleDetectionPermission": PERMISSION_LEVELS.NORMAL,
  "extension.startIdleDetection": PERMISSION_LEVELS.NORMAL,
  "extension.stopIdleDetection": PERMISSION_LEVELS.NORMAL,
  "extension.getIdleState": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Device Memory API (navigator.deviceMemory)
  "extension.getNavigatorDeviceMemory": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Network Information API
  "extension.getNetworkInformation": PERMISSION_LEVELS.PUBLIC,
  "extension.onNetworkChange": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Vibration API
  "extension.vibrate": PERMISSION_LEVELS.NORMAL,
  "extension.cancelVibration": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Screen Orientation API
  "extension.getScreenOrientation": PERMISSION_LEVELS.PUBLIC,
  "extension.lockScreenOrientation": PERMISSION_LEVELS.NORMAL,
  "extension.unlockScreenOrientation": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Presentation API
  "extension.getPresentationAvailability": PERMISSION_LEVELS.PUBLIC,
  "extension.startPresentation": PERMISSION_LEVELS.NORMAL,
  "extension.reconnectPresentation": PERMISSION_LEVELS.NORMAL,
  "extension.getPresentationConnections": PERMISSION_LEVELS.PUBLIC,
  "extension.terminatePresentation": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Reporting API
  "extension.getReports": PERMISSION_LEVELS.PUBLIC,
  "extension.clearReports": PERMISSION_LEVELS.NORMAL,

  // ==================== Phase 24: Hardware & Media APIs ====================

  // 扩展 - Web Bluetooth API
  "extension.requestBluetoothDevice": PERMISSION_LEVELS.ADMIN,
  "extension.getBluetoothDevices": PERMISSION_LEVELS.NORMAL,
  "extension.getBluetoothAvailability": PERMISSION_LEVELS.PUBLIC,
  "extension.connectBluetoothDevice": PERMISSION_LEVELS.ADMIN,
  "extension.disconnectBluetoothDevice": PERMISSION_LEVELS.ADMIN,
  "extension.getBluetoothServices": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Web USB API
  "extension.requestUSBDevice": PERMISSION_LEVELS.ROOT,
  "extension.getUSBDevices": PERMISSION_LEVELS.ADMIN,
  "extension.openUSBDevice": PERMISSION_LEVELS.ROOT,
  "extension.closeUSBDevice": PERMISSION_LEVELS.ADMIN,
  "extension.selectUSBConfiguration": PERMISSION_LEVELS.ROOT,
  "extension.claimUSBInterface": PERMISSION_LEVELS.ROOT,

  // 扩展 - Web Serial API
  "extension.requestSerialPort": PERMISSION_LEVELS.ROOT,
  "extension.getSerialPorts": PERMISSION_LEVELS.ADMIN,
  "extension.openSerialPort": PERMISSION_LEVELS.ROOT,
  "extension.closeSerialPort": PERMISSION_LEVELS.ADMIN,
  "extension.readSerialPort": PERMISSION_LEVELS.ADMIN,
  "extension.writeSerialPort": PERMISSION_LEVELS.ROOT,

  // 扩展 - Gamepad API
  "extension.getGamepads": PERMISSION_LEVELS.PUBLIC,
  "extension.getGamepadState": PERMISSION_LEVELS.PUBLIC,
  "extension.vibrateGamepad": PERMISSION_LEVELS.NORMAL,
  "extension.isGamepadSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Web MIDI API
  "extension.requestMIDIAccess": PERMISSION_LEVELS.ADMIN,
  "extension.getMIDIInputs": PERMISSION_LEVELS.NORMAL,
  "extension.getMIDIOutputs": PERMISSION_LEVELS.NORMAL,
  "extension.sendMIDIMessage": PERMISSION_LEVELS.ADMIN,
  "extension.closeMIDIAccess": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Picture-in-Picture API
  "extension.requestPictureInPicture": PERMISSION_LEVELS.NORMAL,
  "extension.exitPictureInPicture": PERMISSION_LEVELS.NORMAL,
  "extension.getPictureInPictureWindow": PERMISSION_LEVELS.PUBLIC,
  "extension.isPictureInPictureEnabled": PERMISSION_LEVELS.PUBLIC,
  "extension.isPictureInPictureSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Document Picture-in-Picture API
  "extension.requestDocumentPictureInPicture": PERMISSION_LEVELS.NORMAL,
  "extension.getDocumentPictureInPictureWindow": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Web Locks API
  "extension.requestLock": PERMISSION_LEVELS.NORMAL,
  "extension.queryLocks": PERMISSION_LEVELS.PUBLIC,
  "extension.releaseLock": PERMISSION_LEVELS.NORMAL,
  "extension.isLocksSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Badging API
  "extension.setBadge": PERMISSION_LEVELS.NORMAL,
  "extension.clearBadge": PERMISSION_LEVELS.NORMAL,
  "extension.isBadgeSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Local Font Access API
  "extension.queryLocalFonts": PERMISSION_LEVELS.NORMAL,
  "extension.getFontPostscriptNames": PERMISSION_LEVELS.NORMAL,
  "extension.isLocalFontsSupported": PERMISSION_LEVELS.PUBLIC,

  // 扩展 - Window Management API
  "extension.getScreenDetails": PERMISSION_LEVELS.NORMAL,
  "extension.getCurrentScreen": PERMISSION_LEVELS.PUBLIC,
  "extension.isMultiScreenEnvironment": PERMISSION_LEVELS.PUBLIC,
  "extension.requestScreensPermission": PERMISSION_LEVELS.NORMAL,
  "extension.getScreenById": PERMISSION_LEVELS.NORMAL,

  // 扩展 - Compute Pressure API
  "extension.observeComputePressure": PERMISSION_LEVELS.NORMAL,
  "extension.unobserveComputePressure": PERMISSION_LEVELS.NORMAL,
  "extension.getComputePressureState": PERMISSION_LEVELS.PUBLIC,
  "extension.isComputePressureSupported": PERMISSION_LEVELS.PUBLIC,

  // 输入控制
  "input.getCursorPosition": PERMISSION_LEVELS.PUBLIC,
  "input.getKeyboardLayout": PERMISSION_LEVELS.PUBLIC,
  "input.sendKeyPress": PERMISSION_LEVELS.NORMAL,
  "input.sendKeyCombo": PERMISSION_LEVELS.NORMAL,
  "input.typeText": PERMISSION_LEVELS.NORMAL,
  "input.mouseMove": PERMISSION_LEVELS.NORMAL,
  "input.mouseClick": PERMISSION_LEVELS.NORMAL,
  "input.mouseDoubleClick": PERMISSION_LEVELS.NORMAL,
  "input.mouseScroll": PERMISSION_LEVELS.NORMAL,
  "input.mouseDrag": PERMISSION_LEVELS.ADMIN,

  // 应用程序管理
  "app.listInstalled": PERMISSION_LEVELS.PUBLIC,
  "app.listRunning": PERMISSION_LEVELS.PUBLIC,
  "app.getInfo": PERMISSION_LEVELS.PUBLIC,
  "app.search": PERMISSION_LEVELS.PUBLIC,
  "app.getRecent": PERMISSION_LEVELS.PUBLIC,
  "app.launch": PERMISSION_LEVELS.NORMAL,
  "app.focus": PERMISSION_LEVELS.NORMAL,
  "app.close": PERMISSION_LEVELS.ADMIN,

  // 系统信息
  "sysinfo.getCPU": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getMemory": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getBattery": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getTemperature": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getUptime": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getOS": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getHardware": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getPerformance": PERMISSION_LEVELS.PUBLIC,
  "sysinfo.getServices": PERMISSION_LEVELS.NORMAL,
  "sysinfo.getLogs": PERMISSION_LEVELS.ADMIN,

  // 安全操作
  "security.getStatus": PERMISSION_LEVELS.PUBLIC,
  "security.getFirewallStatus": PERMISSION_LEVELS.PUBLIC,
  "security.getAntivirusStatus": PERMISSION_LEVELS.PUBLIC,
  "security.getEncryptionStatus": PERMISSION_LEVELS.PUBLIC,
  "security.getUpdates": PERMISSION_LEVELS.PUBLIC,
  "security.getActiveUsers": PERMISSION_LEVELS.NORMAL,
  "security.lockWorkstation": PERMISSION_LEVELS.NORMAL,
  "security.getLoginHistory": PERMISSION_LEVELS.ADMIN,
};

/**
 * 权限验证器类
 */
class PermissionGate {
  constructor(didManager, ukeyManager, database, options = {}) {
    this.didManager = didManager;
    this.ukeyManager = ukeyManager;
    this.database = database;

    // 配置选项
    this.options = {
      timestampWindow: options.timestampWindow || 300000, // 时间戳有效期：5 分钟
      enableRateLimit: options.enableRateLimit !== false,
      defaultRateLimit: options.defaultRateLimit || 100, // 默认 100 req/min
      highRiskRateLimit: options.highRiskRateLimit || 10, // 高危命令 10 req/min
      enableNonceCheck: options.enableNonceCheck !== false,
      nonceExpiry: options.nonceExpiry || 600000, // Nonce 有效期：10 分钟
      requireUKeyForLevel4: options.requireUKeyForLevel4 !== false,
      // 设备自动撤销配置
      enableAutoRevoke: options.enableAutoRevoke !== false,
      inactivityThreshold:
        options.inactivityThreshold || 7 * 24 * 60 * 60 * 1000, // 7 天无活动
      autoRevokeCheckInterval:
        options.autoRevokeCheckInterval || 60 * 60 * 1000, // 每小时检查
      ...options,
    };

    // 命令权限映射（可动态扩展）
    this.commandPermissions = { ...DEFAULT_COMMAND_PERMISSIONS };

    // 设备权限缓存（DID -> Level）
    this.devicePermissions = new Map();

    // Nonce 缓存（防重放攻击）
    this.nonceCache = new Map();

    // 频率限制缓存（DID -> RequestCount）
    this.rateLimitCache = new Map();

    // 定期清理定时器
    this.cleanupTimer = null;

    // 自动撤销检查定时器
    this.autoRevokeTimer = null;
  }

  /**
   * 初始化权限验证器
   */
  async initialize() {
    logger.info("[PermissionGate] 初始化权限验证器...");

    try {
      // 1. 确保数据库表存在
      await this.ensureTables();

      // 2. 加载设备权限
      await this.loadDevicePermissions();

      // 3. 启动定期清理
      this.startCleanup();

      // 4. 启动设备自动撤销检查
      if (this.options.enableAutoRevoke) {
        this.startAutoRevokeCheck();
      }

      logger.info("[PermissionGate] ✅ 初始化完成");
    } catch (error) {
      logger.error("[PermissionGate] ❌ 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS device_permissions (
        did TEXT PRIMARY KEY,
        permission_level INTEGER NOT NULL DEFAULT 2,
        device_name TEXT,
        granted_at INTEGER NOT NULL,
        granted_by TEXT,
        expires_at INTEGER,
        notes TEXT
      )
    `);

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        did TEXT NOT NULL,
        method TEXT NOT NULL,
        permission_level INTEGER NOT NULL,
        granted BOOLEAN NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    // Nonce 持久化存储表（防止应用重启后的重放攻击）
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce_key TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // 创建索引以加速过期 Nonce 清理
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_used_nonces_timestamp ON used_nonces(timestamp)
    `);

    // 添加 last_activity 列（如果不存在）
    try {
      this.database.exec(`
        ALTER TABLE device_permissions ADD COLUMN last_activity INTEGER
      `);
      logger.info("[PermissionGate] 已添加 last_activity 列");
    } catch (e) {
      // 列已存在，忽略错误
    }

    // 创建索引以加速设备活动检查
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_device_permissions_activity ON device_permissions(last_activity)
    `);

    logger.info("[PermissionGate] 数据库表已就绪");
  }

  /**
   * 验证命令权限（核心方法）
   */
  async verify(auth, method) {
    const startTime = Date.now();

    try {
      // 1. 基础验证
      if (
        !auth ||
        !auth.did ||
        !auth.signature ||
        !auth.timestamp ||
        !auth.nonce
      ) {
        logger.warn("[PermissionGate] 验证失败: 认证信息不完整");
        await this.logAudit(
          auth?.did,
          method,
          0,
          false,
          "Incomplete auth info",
        );
        return false;
      }

      // 2. 验证时间戳（防重放攻击）
      const now = Date.now();
      const timeDiff = Math.abs(now - auth.timestamp);
      if (timeDiff > this.options.timestampWindow) {
        logger.warn(
          `[PermissionGate] 验证失败: 时间戳过期 (差值: ${timeDiff}ms)`,
        );
        await this.logAudit(auth.did, method, 0, false, "Timestamp expired");
        return false;
      }

      // 3. 验证 Nonce（防重放攻击）- 使用 DID:Nonce 组合防止跨设备攻击
      if (this.options.enableNonceCheck) {
        const nonceKey = `${auth.did}:${auth.nonce}`;

        // 先检查内存缓存（快速路径）
        if (this.nonceCache.has(nonceKey)) {
          logger.warn(
            `[PermissionGate] 验证失败: Nonce 已使用 (DID: ${auth.did.substring(0, 20)}...)`,
          );
          await this.logAudit(auth.did, method, 0, false, "Nonce reused");
          return false;
        }

        // 再检查持久化存储（防止应用重启后的重放攻击）
        const existingNonce = this.database
          .prepare("SELECT nonce_key FROM used_nonces WHERE nonce_key = ?")
          .get(nonceKey);

        if (existingNonce) {
          logger.warn(
            `[PermissionGate] 验证失败: Nonce 已使用 (持久化, DID: ${auth.did.substring(0, 20)}...)`,
          );
          await this.logAudit(
            auth.did,
            method,
            0,
            false,
            "Nonce reused (persistent)",
          );
          return false;
        }

        // 记录 DID:Nonce 组合到内存和数据库
        this.nonceCache.set(nonceKey, now);
        try {
          this.database
            .prepare(
              "INSERT INTO used_nonces (nonce_key, did, timestamp) VALUES (?, ?, ?)",
            )
            .run(nonceKey, auth.did, now);
        } catch (dbError) {
          logger.error("[PermissionGate] 保存 Nonce 到数据库失败:", dbError);
          // 继续处理，内存缓存仍然有效
        }
      }

      // 4. 验证 DID 签名
      const isValidSignature = await this.verifySignature(auth, method);
      if (!isValidSignature) {
        logger.warn("[PermissionGate] 验证失败: DID 签名无效");
        await this.logAudit(auth.did, method, 0, false, "Invalid signature");
        return false;
      }

      // 5. 获取命令所需权限级别
      const requiredLevel = this.getCommandPermissionLevel(method);

      // 6. 获取设备权限级别
      const deviceLevel = await this.getDevicePermissionLevel(auth.did);

      // 7. 检查权限级别
      if (deviceLevel < requiredLevel) {
        logger.warn(
          `[PermissionGate] 验证失败: 权限不足 (需要: ${requiredLevel}, 当前: ${deviceLevel})`,
        );
        await this.logAudit(
          auth.did,
          method,
          requiredLevel,
          false,
          `Permission denied (${deviceLevel} < ${requiredLevel})`,
        );
        return false;
      }

      // 8. 频率限制检查
      if (this.options.enableRateLimit) {
        const rateCheck = await this.checkRateLimit(
          auth.did,
          method,
          requiredLevel,
        );
        if (!rateCheck.allowed) {
          logger.warn(
            `[PermissionGate] 验证失败: 频率限制 (${rateCheck.current}/${rateCheck.limit})`,
          );
          await this.logAudit(
            auth.did,
            method,
            requiredLevel,
            false,
            "Rate limit exceeded",
          );
          return false;
        }
      }

      // 9. Level 4 命令需要 U-Key 验证
      if (
        requiredLevel === PERMISSION_LEVELS.ROOT &&
        this.options.requireUKeyForLevel4 &&
        this.ukeyManager
      ) {
        const isUKeyValid = await this.verifyUKey();
        if (!isUKeyValid) {
          logger.warn("[PermissionGate] 验证失败: U-Key 验证失败");
          await this.logAudit(
            auth.did,
            method,
            requiredLevel,
            false,
            "U-Key verification failed",
          );
          return false;
        }
      }

      // 10. 更新设备最后活动时间
      this.updateDeviceActivity(auth.did);

      // 11. 验证成功
      const duration = Date.now() - startTime;
      logger.info(
        `[PermissionGate] ✅ 验证成功: ${method} by ${auth.did} (${duration}ms)`,
      );
      await this.logAudit(auth.did, method, requiredLevel, true, "Success");

      return true;
    } catch (error) {
      logger.error("[PermissionGate] 验证异常:", error);
      await this.logAudit(
        auth?.did,
        method,
        0,
        false,
        `Error: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * 验证 DID 签名
   */
  async verifySignature(auth, method) {
    try {
      // 构造签名数据（与 Android 端保持一致）
      const signData = JSON.stringify({
        method,
        timestamp: auth.timestamp,
        nonce: auth.nonce,
      });

      // 从 DID 获取公钥
      const identity = await this.didManager.cache.get(auth.did);
      if (!identity) {
        logger.warn(`[PermissionGate] DID 不存在: ${auth.did}`);
        return false;
      }

      // 解码公钥和签名
      const publicKey = naclUtil.decodeBase64(identity.public_key_sign);
      const signature = naclUtil.decodeBase64(auth.signature);
      const message = naclUtil.decodeUTF8(signData);

      // 验证签名
      const isValid = nacl.sign.detached.verify(message, signature, publicKey);

      if (!isValid) {
        logger.warn("[PermissionGate] 签名验证失败");
      }

      return isValid;
    } catch (error) {
      logger.error("[PermissionGate] 签名验证异常:", error);
      return false;
    }
  }

  /**
   * 验证 U-Key（Level 4 命令）
   */
  async verifyUKey() {
    try {
      if (!this.ukeyManager) {
        logger.warn("[PermissionGate] U-Key 管理器未初始化");
        return false;
      }

      // 调用 U-Key 验证
      const result = await this.ukeyManager.verifyPIN();
      return result.success;
    } catch (error) {
      logger.error("[PermissionGate] U-Key 验证异常:", error);
      return false;
    }
  }

  /**
   * 获取命令权限级别
   */
  getCommandPermissionLevel(method) {
    // 1. 精确匹配
    if (this.commandPermissions[method] !== undefined) {
      return this.commandPermissions[method];
    }

    // 2. 通配符匹配
    for (const [pattern, level] of Object.entries(this.commandPermissions)) {
      if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        if (regex.test(method)) {
          return level;
        }
      }
    }

    // 3. 命名空间匹配（如 ai.*）
    const namespace = method.split(".")[0];
    const namespacePattern = `${namespace}.*`;
    if (this.commandPermissions[namespacePattern] !== undefined) {
      return this.commandPermissions[namespacePattern];
    }

    // 4. 默认权限级别
    logger.debug(
      `[PermissionGate] 命令 ${method} 未配置权限，使用默认级别: ${PERMISSION_LEVELS.NORMAL}`,
    );
    return PERMISSION_LEVELS.NORMAL;
  }

  /**
   * 获取设备权限级别
   */
  async getDevicePermissionLevel(did) {
    // 1. 从缓存获取
    if (this.devicePermissions.has(did)) {
      return this.devicePermissions.get(did);
    }

    // 2. 从数据库查询
    try {
      const row = this.database
        .prepare(
          "SELECT permission_level, expires_at FROM device_permissions WHERE did = ?",
        )
        .get(did);

      if (row) {
        // 检查是否过期
        if (row.expires_at && row.expires_at < Date.now()) {
          logger.warn(`[PermissionGate] 设备权限已过期: ${did}`);
          return PERMISSION_LEVELS.PUBLIC;
        }

        // 缓存权限
        this.devicePermissions.set(did, row.permission_level);
        return row.permission_level;
      }
    } catch (error) {
      logger.error("[PermissionGate] 查询设备权限失败:", error);
    }

    // 3. 默认权限级别（新设备）
    logger.info(
      `[PermissionGate] 新设备使用默认权限: ${did} -> Level ${PERMISSION_LEVELS.PUBLIC}`,
    );
    return PERMISSION_LEVELS.PUBLIC;
  }

  /**
   * 设置设备权限级别
   */
  async setDevicePermissionLevel(did, level, options = {}) {
    try {
      const now = Date.now();
      const expiresAt = options.expiresIn ? now + options.expiresIn : null;

      this.database
        .prepare(
          `
          INSERT OR REPLACE INTO device_permissions
          (did, permission_level, device_name, granted_at, granted_by, expires_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          did,
          level,
          options.deviceName || null,
          now,
          options.grantedBy || "system",
          expiresAt,
          options.notes || null,
        );

      // 更新缓存
      this.devicePermissions.set(did, level);

      logger.info(`[PermissionGate] 设置设备权限: ${did} -> Level ${level}`);

      // 记录审计日志
      await this.logAudit(
        did,
        "device.setPermission",
        level,
        true,
        `Level changed to ${level}`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[PermissionGate] 设置设备权限失败:", error);
      throw error;
    }
  }

  /**
   * 检查频率限制
   */
  async checkRateLimit(did, method, permissionLevel) {
    const now = Date.now();
    const windowMs = 60000; // 1 分钟窗口

    // 获取限制值
    const limit =
      permissionLevel >= PERMISSION_LEVELS.ADMIN
        ? this.options.highRiskRateLimit
        : this.options.defaultRateLimit;

    // 获取或创建计数器
    if (!this.rateLimitCache.has(did)) {
      this.rateLimitCache.set(did, {
        requests: [],
        lastCleanup: now,
      });
    }

    const rateInfo = this.rateLimitCache.get(did);

    // 清理过期请求
    rateInfo.requests = rateInfo.requests.filter(
      (timestamp) => now - timestamp < windowMs,
    );

    // 检查是否超限
    const current = rateInfo.requests.length;
    if (current >= limit) {
      return { allowed: false, current, limit };
    }

    // 记录请求
    rateInfo.requests.push(now);
    rateInfo.lastCleanup = now;

    return { allowed: true, current: current + 1, limit };
  }

  /**
   * 加载设备权限
   */
  async loadDevicePermissions() {
    try {
      const rows = this.database
        .prepare(
          "SELECT did, permission_level FROM device_permissions WHERE expires_at IS NULL OR expires_at > ?",
        )
        .all(Date.now());

      for (const row of rows) {
        this.devicePermissions.set(row.did, row.permission_level);
      }

      logger.info(`[PermissionGate] 加载了 ${rows.length} 个设备权限`);
    } catch (error) {
      logger.error("[PermissionGate] 加载设备权限失败:", error);
    }
  }

  /**
   * 记录审计日志
   */
  async logAudit(did, method, permissionLevel, granted, reason) {
    try {
      this.database
        .prepare(
          `
          INSERT INTO permission_audit_log
          (did, method, permission_level, granted, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          did || "unknown",
          method,
          permissionLevel,
          granted ? 1 : 0,
          reason,
          Date.now(),
        );
    } catch (error) {
      logger.error("[PermissionGate] 记录审计日志失败:", error);
    }
  }

  /**
   * 获取审计日志
   */
  getAuditLogs(options = {}) {
    try {
      const { did, method, limit = 100, offset = 0 } = options;

      let query = "SELECT * FROM permission_audit_log WHERE 1=1";
      const params = [];

      if (did) {
        query += " AND did = ?";
        params.push(did);
      }

      if (method) {
        query += " AND method = ?";
        params.push(method);
      }

      query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      return this.database.prepare(query).all(...params);
    } catch (error) {
      logger.error("[PermissionGate] 获取审计日志失败:", error);
      return [];
    }
  }

  /**
   * 注册自定义命令权限
   */
  registerCommandPermission(method, level) {
    this.commandPermissions[method] = level;
    logger.info(`[PermissionGate] 注册命令权限: ${method} -> Level ${level}`);
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // 每分钟清理一次

    logger.info("[PermissionGate] 定期清理已启动");
  }

  /**
   * 清理过期数据
   */
  cleanup() {
    const now = Date.now();

    // 清理内存中的过期 Nonce
    let expiredNonces = 0;
    for (const [nonce, timestamp] of this.nonceCache.entries()) {
      if (now - timestamp > this.options.nonceExpiry) {
        this.nonceCache.delete(nonce);
        expiredNonces++;
      }
    }

    // 清理数据库中的过期 Nonce（持久化存储）
    let dbExpiredNonces = 0;
    try {
      const expiryTime = now - this.options.nonceExpiry;
      const result = this.database
        .prepare("DELETE FROM used_nonces WHERE timestamp < ?")
        .run(expiryTime);
      dbExpiredNonces = result.changes || 0;
    } catch (error) {
      logger.error("[PermissionGate] 清理数据库 Nonce 失败:", error);
    }

    // 清理频率限制缓存
    let cleanedRateLimits = 0;
    for (const [did, rateInfo] of this.rateLimitCache.entries()) {
      if (now - rateInfo.lastCleanup > 300000) {
        // 5 分钟无请求
        this.rateLimitCache.delete(did);
        cleanedRateLimits++;
      }
    }

    if (expiredNonces > 0 || dbExpiredNonces > 0 || cleanedRateLimits > 0) {
      logger.debug(
        `[PermissionGate] 清理: ${expiredNonces} memory nonces, ${dbExpiredNonces} db nonces, ${cleanedRateLimits} rate limits`,
      );
    }
  }

  /**
   * 停止定期清理
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info("[PermissionGate] 定期清理已停止");
    }
  }

  /**
   * 更新设备最后活动时间
   */
  updateDeviceActivity(did) {
    try {
      const now = Date.now();
      this.database
        .prepare(
          "UPDATE device_permissions SET last_activity = ? WHERE did = ?",
        )
        .run(now, did);
    } catch (error) {
      logger.error("[PermissionGate] 更新设备活动时间失败:", error);
    }
  }

  /**
   * 启动设备自动撤销检查
   */
  startAutoRevokeCheck() {
    if (this.autoRevokeTimer) {
      return;
    }

    // 立即执行一次检查
    this.checkInactiveDevices();

    // 定期检查
    this.autoRevokeTimer = setInterval(() => {
      this.checkInactiveDevices();
    }, this.options.autoRevokeCheckInterval);

    logger.info(
      `[PermissionGate] 设备自动撤销检查已启动 (间隔: ${this.options.autoRevokeCheckInterval / 1000}s, 阈值: ${this.options.inactivityThreshold / (24 * 60 * 60 * 1000)}天)`,
    );
  }

  /**
   * 检查并降级不活跃设备
   */
  checkInactiveDevices() {
    try {
      const now = Date.now();
      const threshold = now - this.options.inactivityThreshold;

      // 查找需要降级的设备（权限 > PUBLIC 且超过阈值未活动）
      const inactiveDevices = this.database
        .prepare(
          `
          SELECT did, permission_level, device_name, last_activity
          FROM device_permissions
          WHERE permission_level > ?
            AND (last_activity IS NULL OR last_activity < ?)
        `,
        )
        .all(PERMISSION_LEVELS.PUBLIC, threshold);

      if (inactiveDevices.length === 0) {
        return;
      }

      logger.info(
        `[PermissionGate] 发现 ${inactiveDevices.length} 个不活跃设备，正在降级...`,
      );

      for (const device of inactiveDevices) {
        const inactiveDays = device.last_activity
          ? Math.floor((now - device.last_activity) / (24 * 60 * 60 * 1000))
          : "未知";

        logger.warn(
          `[PermissionGate] 设备自动降级: ${device.did.substring(0, 30)}... ` +
            `(原权限: ${device.permission_level}, 不活跃: ${inactiveDays}天)`,
        );

        // 降级到 PUBLIC
        this.database
          .prepare(
            "UPDATE device_permissions SET permission_level = ?, notes = ? WHERE did = ?",
          )
          .run(
            PERMISSION_LEVELS.PUBLIC,
            `Auto-revoked: inactive for ${inactiveDays} days (was level ${device.permission_level})`,
            device.did,
          );

        // 更新缓存
        this.devicePermissions.set(device.did, PERMISSION_LEVELS.PUBLIC);

        // 记录审计日志
        this.logAudit(
          device.did,
          "device.autoRevoke",
          PERMISSION_LEVELS.PUBLIC,
          true,
          `Auto-revoked due to ${inactiveDays} days inactivity`,
        );
      }

      logger.info(
        `[PermissionGate] 已降级 ${inactiveDevices.length} 个不活跃设备到 PUBLIC 权限`,
      );
    } catch (error) {
      logger.error("[PermissionGate] 检查不活跃设备失败:", error);
    }
  }

  /**
   * 停止设备自动撤销检查
   */
  stopAutoRevokeCheck() {
    if (this.autoRevokeTimer) {
      clearInterval(this.autoRevokeTimer);
      this.autoRevokeTimer = null;
      logger.info("[PermissionGate] 设备自动撤销检查已停止");
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    // 获取数据库中的 Nonce 数量
    let dbNonceCount = 0;
    try {
      const result = this.database
        .prepare("SELECT COUNT(*) as count FROM used_nonces")
        .get();
      dbNonceCount = result?.count || 0;
    } catch (e) {
      // 忽略
    }

    return {
      devicePermissions: this.devicePermissions.size,
      nonceCache: this.nonceCache.size,
      nonceCacheDb: dbNonceCount,
      rateLimitCache: this.rateLimitCache.size,
      registeredCommands: Object.keys(this.commandPermissions).length,
      autoRevokeEnabled: this.options.enableAutoRevoke,
      inactivityThresholdDays:
        this.options.inactivityThreshold / (24 * 60 * 60 * 1000),
    };
  }

  /**
   * 获取不活跃设备列表
   */
  getInactiveDevices(days = 7) {
    try {
      const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
      return this.database
        .prepare(
          `
          SELECT did, permission_level, device_name, last_activity, granted_at
          FROM device_permissions
          WHERE last_activity IS NULL OR last_activity < ?
          ORDER BY last_activity ASC
        `,
        )
        .all(threshold);
    } catch (error) {
      logger.error("[PermissionGate] 获取不活跃设备失败:", error);
      return [];
    }
  }

  /**
   * 手动撤销设备权限
   */
  async revokeDevice(did, reason = "Manual revocation") {
    try {
      // 删除设备权限
      this.database
        .prepare("DELETE FROM device_permissions WHERE did = ?")
        .run(did);

      // 清除缓存
      this.devicePermissions.delete(did);

      // 记录审计日志
      await this.logAudit(did, "device.revoke", 0, true, reason);

      logger.info(`[PermissionGate] 设备已撤销: ${did} (${reason})`);
      return { success: true };
    } catch (error) {
      logger.error("[PermissionGate] 撤销设备失败:", error);
      throw error;
    }
  }

  /**
   * 停止所有定时器
   */
  shutdown() {
    this.stopCleanup();
    this.stopAutoRevokeCheck();
    logger.info("[PermissionGate] 已关闭");
  }
}

module.exports = {
  PermissionGate,
  PERMISSION_LEVELS,
};
