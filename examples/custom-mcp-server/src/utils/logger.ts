/**
 * 简单的日志工具
 *
 * 注意: 所有日志输出到stderr，因为stdout用于JSON-RPC通信
 */

import { config } from "../config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: number;

  constructor(level: LogLevel = "info") {
    this.minLevel = LOG_LEVELS[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    data?: unknown,
  ): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let logEntry = `[${timestamp}] ${levelStr} ${message}`;

    if (data !== undefined) {
      try {
        const dataStr =
          typeof data === "object" ? JSON.stringify(data) : String(data);
        logEntry += ` | ${dataStr}`;
      } catch (error) {
        logEntry += ` | [Unserializable data]`;
      }
    }

    return logEntry;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      console.error(this.formatMessage("debug", message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      console.error(this.formatMessage("info", message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      console.error(this.formatMessage("warn", message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, data));
    }
  }
}

export const logger = new Logger(config.logLevel);
