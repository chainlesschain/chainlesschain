/**
 * 主进程日志监听器
 *
 * 自动监听从主进程转发过来的日志，并在 DevTools Console 中显示
 * 日志会以特定的样式显示，便于区分主进程和渲染进程的日志
 *
 * @module main-log-listener
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 日志级别类型
 */
export type MainLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * 主进程日志条目
 */
export interface MainLogEntry {
  /** 日志级别 */
  level: MainLogLevel;
  /** 时间戳 */
  time: string;
  /** 日志参数 */
  args: unknown[];
}

/**
 * 日志样式映射
 */
export interface LogStyleMap {
  [K: string]: string;
}

/**
 * 日志图标映射
 */
export interface LogIconMap {
  [K: string]: string;
}

/**
 * 取消订阅函数类型
 */
export type UnsubscribeFunction = () => void;

/**
 * 主进程日志 API 接口
 */
export interface MainLogAPI {
  onLog: (callback: (log: MainLogEntry) => void) => UnsubscribeFunction;
  removeAllListeners: () => void;
}

/**
 * Electron API 接口（部分）
 */
export interface ElectronAPIWithMainLog {
  mainLog?: MainLogAPI;
}

/**
 * 主进程日志监听器接口
 */
export interface MainLogListener {
  init: () => void;
  stop: () => void;
  isActive: () => boolean;
}

// ==================== 常量定义 ====================

/**
 * 日志级别对应的颜色样式
 */
const LOG_STYLES: LogStyleMap = {
  log: 'color: #4CAF50; font-weight: bold;', // 绿色
  info: 'color: #2196F3; font-weight: bold;', // 蓝色
  warn: 'color: #FF9800; font-weight: bold;', // 橙色
  error: 'color: #F44336; font-weight: bold;', // 红色
  debug: 'color: #9E9E9E; font-weight: bold;', // 灰色
};

/**
 * 日志级别对应的图标
 */
const LOG_ICONS: LogIconMap = {
  log: '[Main]',
  info: '[Main i]',
  warn: '[Main !]',
  error: '[Main X]',
  debug: '[Main ?]',
};

// ==================== 状态变量 ====================

/** 取消订阅函数 */
let unsubscribe: UnsubscribeFunction | null = null;

/** 是否已初始化 */
let isInitialized = false;

// ==================== 辅助函数 ====================

/**
 * 获取 Electron API
 */
function getElectronAPI(): ElectronAPIWithMainLog | undefined {
  if (typeof window !== 'undefined') {
    return (window as Window & { electronAPI?: ElectronAPIWithMainLog }).electronAPI;
  }
  return undefined;
}

/**
 * 获取控制台方法
 */
function getConsoleMethod(level: MainLogLevel): (...args: unknown[]) => void {
  const method = console[level];
  if (typeof method === 'function') {
    return method.bind(console);
  }
  return console.log.bind(console);
}

// ==================== 导出函数 ====================

/**
 * 初始化主进程日志监听
 */
export function initMainLogListener(): void {
  if (isInitialized) {
    logger.info('[MainLogListener] Already initialized, skipping...');
    return;
  }

  const electronAPI = getElectronAPI();
  if (!electronAPI?.mainLog?.onLog) {
    logger.warn('[MainLogListener] mainLog API not available, skipping...');
    return;
  }

  unsubscribe = electronAPI.mainLog.onLog((log: MainLogEntry) => {
    const { level, time, args } = log;
    const style = LOG_STYLES[level] || LOG_STYLES.log;
    const icon = LOG_ICONS[level] || LOG_ICONS.log;
    const prefix = `%c${icon} ${time}`;

    // 根据日志级别调用对应的 console 方法
    const consoleMethod = getConsoleMethod(level);

    if (args.length === 1) {
      consoleMethod(prefix, style, args[0]);
    } else {
      consoleMethod(prefix, style, ...args);
    }
  });

  isInitialized = true;
  logger.info('[MainLogListener] Main process log listener started');
  logger.info('[MainLogListener] Main process logs are now visible in DevTools!');
}

/**
 * 停止主进程日志监听
 */
export function stopMainLogListener(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const electronAPI = getElectronAPI();
  if (electronAPI?.mainLog?.removeAllListeners) {
    electronAPI.mainLog.removeAllListeners();
  }

  isInitialized = false;
  logger.info('[MainLogListener] Main process log listener stopped');
}

/**
 * 检查监听器是否已初始化
 * @returns 是否已初始化
 */
export function isMainLogListenerActive(): boolean {
  return isInitialized;
}

// ==================== 自动初始化 ====================

if (typeof window !== 'undefined') {
  // 延迟初始化，确保 electronAPI 已经注入
  if (document.readyState === 'complete') {
    initMainLogListener();
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      // 再延迟一点确保 preload 完成
      setTimeout(initMainLogListener, 100);
    });
  }
}

// ==================== 默认导出 ====================

/**
 * 主进程日志监听器对象
 */
const mainLogListener: MainLogListener = {
  init: initMainLogListener,
  stop: stopMainLogListener,
  isActive: isMainLogListenerActive,
};

export default mainLogListener;
