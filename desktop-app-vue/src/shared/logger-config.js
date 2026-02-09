/**
 * 日志管理器配置
 * 主进程和渲染进程共享的日志配置
 */

export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};

export const LOG_LEVEL_NAMES = {
  0: "DEBUG",
  1: "INFO",
  2: "WARN",
  3: "ERROR",
  4: "FATAL",
};

export const DEFAULT_CONFIG = {
  // 日志级别（开发环境：DEBUG，生产环境：INFO）
  level:
    process.env.NODE_ENV === "production" ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG,

  // 是否输出到控制台
  console: process.env.NODE_ENV !== "production",

  // 是否输出到文件（仅主进程）
  file: true,

  // 日志文件配置
  fileConfig: {
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5, // 保留最近5个日志文件
    compress: true, // 压缩旧日志
  },

  // 是否包含堆栈跟踪（ERROR及以上级别）
  stackTrace: true,

  // 是否包含时间戳
  timestamp: true,

  // 是否包含模块名
  module: true,

  // 性能监控
  performance: {
    enabled: true,
    slowThreshold: 1000, // 慢操作阈值（毫秒）
  },
};

/**
 * 格式化日志消息
 */
export function formatLogMessage(level, module, message, data, timestamp) {
  const parts = [];

  if (timestamp) {
    parts.push(`[${new Date().toISOString()}]`);
  }

  parts.push(`[${LOG_LEVEL_NAMES[level]}]`);

  if (module) {
    parts.push(`[${module}]`);
  }

  parts.push(message);

  if (data && Object.keys(data).length > 0) {
    parts.push(JSON.stringify(data, null, 2));
  }

  return parts.join(" ");
}

/**
 * 获取调用栈信息
 */
export function getStackTrace() {
  const stack = new Error().stack;
  if (!stack) {
    return "";
  }

  const lines = stack.split("\n");
  // 跳过前3行（Error, getStackTrace, logger方法）
  return lines.slice(3).join("\n");
}

/**
 * 清理敏感信息
 * @param {any} data - 需要清理的数据
 * @param {WeakSet} [seen] - 已访问对象的集合，用于检测循环引用
 */
export function sanitizeData(data, seen = new WeakSet()) {
  if (!data || typeof data !== "object") {
    return data;
  }

  // 检测循环引用
  if (seen.has(data)) {
    return "[Circular Reference]";
  }
  seen.add(data);

  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "apiKey",
    "privateKey",
    "pin",
  ];
  const sanitized = Array.isArray(data) ? [...data] : { ...data };

  for (const key in sanitized) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = "***REDACTED***";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeData(sanitized[key], seen);
    }
  }

  return sanitized;
}
