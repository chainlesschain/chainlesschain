/**
 * 日志转发器 - 将主进程日志转发到渲染进程 DevTools
 *
 * 使用方法：
 * 1. 在主进程中调用 initLogForwarder(mainWindow)
 * 2. 在渲染进程中通过 window.electronAPI.mainLog.onLog(callback) 监听
 *
 * @module log-forwarder
 */

const LOG_CHANNEL = "main:log";

// 存储 webContents 引用
let webContentsRef = null;

// 原始 console 方法备份
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

// 日志过滤规则 - 只转发带特定前缀的日志
const LOG_PREFIXES = [
  "[LLM",
  "[Conversation",
  "[Session",
  "[RAG",
  "[Manus",
  "[Agent",
  "[Error",
  "[MCP",
  "[Token",
  "[Database",
];

/**
 * 检查日志是否应该被转发
 * @param {any[]} args - console 参数
 * @returns {boolean}
 */
function shouldForward(args) {
  if (args.length === 0) {return false;}

  const firstArg = String(args[0]);
  return LOG_PREFIXES.some((prefix) => firstArg.includes(prefix));
}

/**
 * 安全序列化参数
 * @param {any[]} args - 原始参数
 * @returns {string[]}
 */
function serializeArgs(args) {
  return args.map((arg) => {
    if (arg === null) {return "null";}
    if (arg === undefined) {return "undefined";}

    if (typeof arg === "object") {
      try {
        // 处理 Error 对象
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}\n${arg.stack || ""}`;
        }
        // 处理普通对象
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return "[Unserializable Object]";
      }
    }

    return String(arg);
  });
}

/**
 * 发送日志到渲染进程
 * @param {string} level - 日志级别
 * @param {any[]} args - 日志参数
 */
function forwardLog(level, args) {
  if (!webContentsRef || webContentsRef.isDestroyed()) {
    return;
  }

  if (!shouldForward(args)) {
    return;
  }

  try {
    const logEntry = {
      level,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      args: serializeArgs(args),
    };

    webContentsRef.send(LOG_CHANNEL, logEntry);
  } catch (error) {
    // 静默失败，避免循环
  }
}

/**
 * 创建包装后的 console 方法
 * @param {string} level - 日志级别
 * @param {Function} original - 原始方法
 * @returns {Function}
 */
function createWrapper(level, original) {
  return function (...args) {
    // 先调用原始方法（终端仍然显示）
    original.apply(console, args);
    // 然后转发到渲染进程
    forwardLog(level, args);
  };
}

/**
 * 初始化日志转发器
 * @param {Electron.BrowserWindow} mainWindow - 主窗口实例
 */
function initLogForwarder(mainWindow) {
  if (!mainWindow || !mainWindow.webContents) {
    originalConsole.warn("[LogForwarder] 无法初始化：mainWindow 无效");
    return;
  }

  webContentsRef = mainWindow.webContents;

  // 替换 console 方法
  console.log = createWrapper("log", originalConsole.log);
  console.warn = createWrapper("warn", originalConsole.warn);
  console.error = createWrapper("error", originalConsole.error);
  console.info = createWrapper("info", originalConsole.info);
  console.debug = createWrapper("debug", originalConsole.debug);

  originalConsole.log("[LogForwarder] ✅ 日志转发器已初始化");

  // 窗口关闭时清理
  mainWindow.on("closed", () => {
    webContentsRef = null;
    // 恢复原始 console
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  });
}

/**
 * 更新 webContents 引用（窗口重建时使用）
 * @param {Electron.WebContents} webContents
 */
function updateWebContents(webContents) {
  webContentsRef = webContents;
}

/**
 * 手动发送日志（用于特殊情况）
 * @param {string} level - 日志级别
 * @param {...any} args - 日志内容
 */
function sendLog(level, ...args) {
  // 调用原始方法
  if (originalConsole[level]) {
    originalConsole[level].apply(console, args);
  }
  // 强制转发（忽略过滤规则）
  if (webContentsRef && !webContentsRef.isDestroyed()) {
    try {
      webContentsRef.send(LOG_CHANNEL, {
        level,
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        args: serializeArgs(args),
      });
    } catch (error) {
      // 静默失败
    }
  }
}

/**
 * 获取日志通道名称
 * @returns {string}
 */
function getLogChannel() {
  return LOG_CHANNEL;
}

module.exports = {
  initLogForwarder,
  updateWebContents,
  sendLog,
  getLogChannel,
  LOG_CHANNEL,
};
