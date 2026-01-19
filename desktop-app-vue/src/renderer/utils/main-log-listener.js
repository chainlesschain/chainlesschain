import { logger, createLogger } from '@/utils/logger';

/**
 * 主进程日志监听器
 *
 * 自动监听从主进程转发过来的日志，并在 DevTools Console 中显示
 * 日志会以特定的样式显示，便于区分主进程和渲染进程的日志
 *
 * @module main-log-listener
 */

// 日志级别对应的颜色样式
const LOG_STYLES = {
  log: "color: #4CAF50; font-weight: bold;", // 绿色
  info: "color: #2196F3; font-weight: bold;", // 蓝色
  warn: "color: #FF9800; font-weight: bold;", // 橙色
  error: "color: #F44336; font-weight: bold;", // 红色
  debug: "color: #9E9E9E; font-weight: bold;", // 灰色
};

// 日志级别对应的图标
const LOG_ICONS = {
  log: "[Main]",
  info: "[Main ℹ]",
  warn: "[Main ⚠]",
  error: "[Main ❌]",
  debug: "[Main 🔍]",
};

let unsubscribe = null;
let isInitialized = false;

/**
 * 初始化主进程日志监听
 */
export function initMainLogListener() {
  if (isInitialized) {
    logger.info("[MainLogListener] Already initialized, skipping...");
    return;
  }

  if (!window.electronAPI?.mainLog?.onLog) {
    logger.warn("[MainLogListener] mainLog API not available, skipping...");
    return;
  }

  unsubscribe = window.electronAPI.mainLog.onLog((log) => {
    const { level, time, args } = log;
    const style = LOG_STYLES[level] || LOG_STYLES.log;
    const icon = LOG_ICONS[level] || LOG_ICONS.log;
    const prefix = `%c${icon} ${time}`;

    // 根据日志级别调用对应的 console 方法
    const consoleMethod = console[level] || console.log;

    if (args.length === 1) {
      consoleMethod(prefix, style, args[0]);
    } else {
      consoleMethod(prefix, style, ...args);
    }
  });

  isInitialized = true;
  logger.info(
    "%c[MainLogListener] ✅ 主进程日志监听已启动",
    "color: #4CAF50; font-weight: bold;",
  );
  logger.info(
    "%c[MainLogListener] 现在可以在 DevTools 中看到主进程日志了！",
    "color: #2196F3;",
  );
}

/**
 * 停止主进程日志监听
 */
export function stopMainLogListener() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  if (window.electronAPI?.mainLog?.removeAllListeners) {
    window.electronAPI.mainLog.removeAllListeners();
  }

  isInitialized = false;
  logger.info("[MainLogListener] 主进程日志监听已停止");
}

/**
 * 检查监听器是否已初始化
 * @returns {boolean}
 */
export function isMainLogListenerActive() {
  return isInitialized;
}

// 自动初始化
if (typeof window !== "undefined") {
  // 延迟初始化，确保 electronAPI 已经注入
  if (document.readyState === "complete") {
    initMainLogListener();
  } else {
    window.addEventListener("DOMContentLoaded", () => {
      // 再延迟一点确保 preload 完成
      setTimeout(initMainLogListener, 100);
    });
  }
}

export default {
  init: initMainLogListener,
  stop: stopMainLogListener,
  isActive: isMainLogListenerActive,
};
