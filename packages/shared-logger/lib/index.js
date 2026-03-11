/**
 * @chainlesschain/shared-logger
 *
 * Cross-environment logger with file output and log rotation.
 * Works in both Electron and CLI (headless) environments.
 */

import fs from "fs";
import path from "path";
import { getLogsDir } from "@chainlesschain/core-env";
import {
  LOG_LEVELS,
  DEFAULT_CONFIG,
  formatLogMessage,
  getStackTrace,
  sanitizeData,
} from "./logger-config.js";

// Handle EPIPE errors globally
if (process.stdout && typeof process.stdout.on === "function") {
  process.stdout.on("error", (err) => {
    if (err.code === "EPIPE") return;
  });
}
if (process.stderr && typeof process.stderr.on === "function") {
  process.stderr.on("error", (err) => {
    if (err.code === "EPIPE") return;
  });
}

class Logger {
  /**
   * @param {string} [module="main"] - Module name for log prefix
   * @param {object} [options] - Override options
   * @param {string} [options.logDir] - Custom log directory (overrides core-env)
   * @param {object} [options.config] - Override DEFAULT_CONFIG fields
   */
  constructor(module = "main", options = {}) {
    this.module = module;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.logDir = options.logDir || getLogsDir();
    this.currentLogFile = null;
    this.performanceMarks = new Map();

    this.ensureLogDirectory();
    this.rotateLogsIfNeeded();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getCurrentLogFile() {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `chainlesschain-${date}.log`);
  }

  rotateLogsIfNeeded() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith("chainlesschain-") && f.endsWith(".log"))
        .map((f) => ({
          name: f,
          path: path.join(this.logDir, f),
          stat: fs.statSync(path.join(this.logDir, f)),
        }))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);

      if (files.length > this.config.fileConfig.maxFiles) {
        files.slice(this.config.fileConfig.maxFiles).forEach((file) => {
          fs.unlinkSync(file.path);
        });
      }

      const currentFile = this.getCurrentLogFile();
      if (fs.existsSync(currentFile)) {
        const stat = fs.statSync(currentFile);
        if (stat.size > this.config.fileConfig.maxSize) {
          const timestamp = Date.now();
          const newName = currentFile.replace(".log", `-${timestamp}.log`);
          fs.renameSync(currentFile, newName);
        }
      }
    } catch (error) {
      console.error("Log rotation failed:", error);
    }
  }

  log(level, message, data = {}) {
    if (level < this.config.level) return;

    const sanitized = sanitizeData(data);
    const formatted = formatLogMessage(
      level,
      this.module,
      message,
      sanitized,
      this.config.timestamp,
    );

    if (this.config.console) {
      try {
        const consoleMethod =
          level >= LOG_LEVELS.ERROR
            ? "error"
            : level >= LOG_LEVELS.WARN
              ? "warn"
              : level >= LOG_LEVELS.INFO
                ? "info"
                : "log";
        console[consoleMethod](formatted);
      } catch (err) {
        if (err.code !== "EPIPE") {
          this.config.console = false;
        }
      }
    }

    if (this.config.file) {
      try {
        const logFile = this.getCurrentLogFile();
        let output = formatted + "\n";

        if (level >= LOG_LEVELS.ERROR && this.config.stackTrace) {
          output += getStackTrace() + "\n";
        }

        fs.appendFileSync(logFile, output, "utf8");
        this.rotateLogsIfNeeded();
      } catch (_error) {
        // File write failure — avoid infinite recursion
      }
    }
  }

  debug(message, data) {
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  info(message, data) {
    this.log(LOG_LEVELS.INFO, message, data);
  }

  warn(message, data) {
    this.log(LOG_LEVELS.WARN, message, data);
  }

  error(message, data) {
    this.log(LOG_LEVELS.ERROR, message, data);
  }

  fatal(message, data) {
    this.log(LOG_LEVELS.FATAL, message, data);
  }

  perfStart(label) {
    if (!this.config.performance.enabled) return;
    this.performanceMarks.set(label, Date.now());
  }

  perfEnd(label, data = {}) {
    if (!this.config.performance.enabled) return;

    const startTime = this.performanceMarks.get(label);
    if (!startTime) {
      this.warn(`Performance mark not found: ${label}`);
      return;
    }

    const duration = Date.now() - startTime;
    this.performanceMarks.delete(label);

    const logData = { ...data, duration: `${duration}ms` };
    if (duration > this.config.performance.slowThreshold) {
      this.warn(`Slow operation: ${label}`, logData);
    } else {
      this.debug(`Perf: ${label}`, logData);
    }

    return duration;
  }

  child(subModule) {
    const childLogger = new Logger(`${this.module}:${subModule}`, {
      logDir: this.logDir,
    });
    childLogger.config = this.config;
    return childLogger;
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  cleanup(daysToKeep = 7) {
    try {
      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.logDir);

      let deletedCount = 0;
      files.forEach((file) => {
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      });

      this.info("Log cleanup complete", { deletedCount, daysToKeep });
      return deletedCount;
    } catch (error) {
      this.error("Log cleanup failed", { error: error.message });
      return 0;
    }
  }
}

// Singleton
export const logger = new Logger("main");

export { Logger };

export const createLogger = (module, options) => new Logger(module, options);

// Re-export config utilities
export { LOG_LEVELS, LOG_LEVEL_NAMES, DEFAULT_CONFIG } from "./logger-config.js";
export { formatLogMessage, getStackTrace, sanitizeData } from "./logger-config.js";
