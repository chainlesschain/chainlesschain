/**
 * 崩溃报告器
 * 捕获和报告应用崩溃信息
 */

const { logger } = require("../utils/logger.js");
const { app, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

const CRASH_REPORT_SCHEMA_VERSION = 2;
const CRASH_FILENAME =
  /^crash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/u;
const CRASH_TYPES = new Set([
  "unhandledRejection",
  "uncaughtException",
  "renderProcessGone",
  "childProcessGone",
  "unknown",
]);
const PROCESS_REASONS = new Set([
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "unknown",
]);
const PROCESS_TYPES = new Set([
  "Utility",
  "Zygote",
  "Sandbox helper",
  "GPU",
  "Pepper Plugin",
  "Pepper Plugin Broker",
  "unknown",
]);
const ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "unknown",
]);
const PLATFORMS = new Set([
  "aix",
  "darwin",
  "freebsd",
  "linux",
  "openbsd",
  "sunos",
  "win32",
  "android",
  "unknown",
]);
const ARCHITECTURES = new Set([
  "arm",
  "arm64",
  "ia32",
  "loong64",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "riscv64",
  "s390",
  "s390x",
  "x64",
  "unknown",
]);

function safeInteger(value) {
  return Number.isSafeInteger(value)
    ? Math.max(-2_147_483_648, Math.min(2_147_483_647, value))
    : null;
}

function safeEnum(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : "unknown";
}

function safeVersion(value) {
  return typeof value === "string" && /^[0-9A-Za-z.+-]{1,64}$/u.test(value)
    ? value
    : "unknown";
}

function sanitizeCrashInfo(crashInfo) {
  const input = crashInfo && typeof crashInfo === "object" ? crashInfo : {};
  const type = safeEnum(input.type, CRASH_TYPES);
  const result = { type };
  if (type === "uncaughtException") {
    result.errorName = safeEnum(input.errorName ?? input.name, ERROR_NAMES);
  }
  if (type === "renderProcessGone" || type === "childProcessGone") {
    result.reason = safeEnum(input.reason, PROCESS_REASONS);
    result.exitCode = safeInteger(input.exitCode);
  }
  if (type === "childProcessGone") {
    result.processType = safeEnum(
      input.processType ?? input.typeName ?? input.name,
      PROCESS_TYPES,
    );
  }
  return result;
}

function sanitizeStoredCrashReport(report) {
  const input = report && typeof report === "object" ? report : {};
  const timestamp =
    typeof input.timestamp === "string" &&
    !Number.isNaN(Date.parse(input.timestamp))
      ? new Date(input.timestamp).toISOString()
      : new Date(0).toISOString();
  return {
    schemaVersion: CRASH_REPORT_SCHEMA_VERSION,
    timestamp,
    crash: sanitizeCrashInfo(input.crash),
    runtime: {
      appVersion: safeVersion(input.runtime?.appVersion ?? input.app?.version),
      platform: safeEnum(
        input.runtime?.platform ?? input.system?.platform,
        PLATFORMS,
      ),
      arch: safeEnum(input.runtime?.arch ?? input.system?.arch, ARCHITECTURES),
    },
  };
}

class CrashReporter {
  constructor(options = {}) {
    this.app = options.app || app;
    this.dialog = options.dialog || dialog;
    this.crashesDir =
      options.crashesDir || path.join(this.app.getPath("userData"), "crashes");
    this.showDialog = options.showDialog !== false;
    this.setupHandlers = options.setupHandlers !== false;

    // 确保崩溃目录存在
    if (!fs.existsSync(this.crashesDir)) {
      fs.mkdirSync(this.crashesDir, { recursive: true, mode: 0o700 });
    }

    // 初始化崩溃报告器
    this.init();
  }

  /**
   * 初始化崩溃报告器
   */
  init() {
    try {
      // Native Chromium minidumps may contain arbitrary process memory and
      // cannot be field-redacted. Keep them disabled; the bounded JSON report
      // below is the only crash artifact owned by this component.
      this.migrateExistingReports();
      logger.info("[CrashReporter] Initialized with bounded reports");

      // 监听未捕获的异常
      if (this.setupHandlers) {
        this.setupExceptionHandlers();
      }
    } catch (_error) {
      logger.error("[CrashReporter] Initialization failed");
    }
  }

  /**
   * 设置异常处理器
   */
  setupExceptionHandlers() {
    // 捕获未处理的Promise拒绝
    process.on("unhandledRejection", () => {
      logger.error("[CrashReporter] Unhandled rejection recorded");
      this.saveCrashReport({
        type: "unhandledRejection",
      });
    });

    // 捕获未捕获的异常
    process.on("uncaughtException", (error) => {
      // 忽略 EPIPE 错误（管道已关闭，通常发生在应用关闭时）
      if (error.code === "EPIPE") {
        logger.info("[CrashReporter] Ignoring EPIPE error (broken pipe)");
        return;
      }

      logger.error("[CrashReporter] Uncaught exception recorded");
      this.saveCrashReport({
        type: "uncaughtException",
        errorName: error.name,
      });

      // 显示错误对话框
      if (this.showDialog) {
        this.showCrashDialog(error);
      }
    });

    // 监听渲染进程崩溃
    this.app.on("render-process-gone", (event, webContents, details) => {
      logger.error("[CrashReporter] Render process exit recorded");
      const crashInfo = sanitizeCrashInfo({
        type: "renderProcessGone",
        reason: details.reason,
        exitCode: details.exitCode,
      });
      this.saveCrashReport(crashInfo);

      if (this.showDialog) {
        this.dialog.showErrorBox(
          "渲染进程崩溃",
          `渲染进程意外终止\n原因: ${crashInfo.reason}\n退出码: ${crashInfo.exitCode ?? "unknown"}`,
        );
      }
    });

    // 监听子进程崩溃
    this.app.on("child-process-gone", (event, details) => {
      logger.error("[CrashReporter] Child process exit recorded");
      this.saveCrashReport({
        type: "childProcessGone",
        processType: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });
  }

  /**
   * 保存崩溃报告
   */
  saveCrashReport(crashInfo) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `crash-${timestamp}.json`;
      const filepath = path.join(this.crashesDir, filename);

      const report = sanitizeStoredCrashReport({
        timestamp: new Date().toISOString(),
        crash: sanitizeCrashInfo(crashInfo),
        runtime: {
          appVersion: this.app.getVersion(),
          platform: process.platform,
          arch: process.arch,
        },
      });

      // 写入文件
      fs.writeFileSync(filepath, JSON.stringify(report, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });

      logger.info("[CrashReporter] Bounded crash report saved");

      // 清理旧报告
      this.cleanOldReports();

      return filename;
    } catch (_error) {
      logger.error("[CrashReporter] Crash report save failed");
      return null;
    }
  }

  /**
   * 显示崩溃对话框
   */
  showCrashDialog(_error) {
    const options = {
      type: "error",
      title: "应用程序错误",
      message: "应用程序遇到了一个错误",
      detail: "错误详情已写入本地脱敏崩溃报告。",
      buttons: ["重启应用", "退出"],
      defaultId: 0,
      cancelId: 1,
    };

    this.dialog.showMessageBox(options).then((result) => {
      if (result.response === 0) {
        // 重启应用
        this.app.relaunch();
        this.app.exit(0);
      } else {
        // 退出应用
        this.app.exit(1);
      }
    });
  }

  resolveReportPath(filename) {
    if (typeof filename !== "string" || !CRASH_FILENAME.test(filename)) {
      return null;
    }
    return path.join(this.crashesDir, filename);
  }

  migrateExistingReports() {
    let filenames = [];
    try {
      filenames = fs
        .readdirSync(this.crashesDir)
        .filter((filename) => CRASH_FILENAME.test(filename));
    } catch (_error) {
      logger.error("[CrashReporter] Existing report scan failed");
      return;
    }

    for (const filename of filenames) {
      const filepath = this.resolveReportPath(filename);
      if (!filepath) {
        continue;
      }
      let report = null;
      try {
        report = JSON.parse(fs.readFileSync(filepath, "utf8"));
      } catch (_error) {
        report = {
          timestamp: new Date(0).toISOString(),
          crash: { type: "unknown" },
        };
      }
      try {
        fs.writeFileSync(
          filepath,
          JSON.stringify(sanitizeStoredCrashReport(report), null, 2),
          { encoding: "utf8", mode: 0o600 },
        );
        fs.chmodSync(filepath, 0o600);
      } catch (_error) {
        logger.error("[CrashReporter] Existing report migration failed");
      }
    }
  }

  /**
   * 获取崩溃报告列表
   */
  getCrashReports() {
    try {
      const files = fs
        .readdirSync(this.crashesDir)
        .filter((filename) => CRASH_FILENAME.test(filename))
        .map((filename) => {
          const filepath = this.resolveReportPath(filename);
          const stat = fs.statSync(filepath);
          return {
            name: filename,
            size: stat.size,
            created: stat.birthtime,
          };
        })
        .sort((a, b) => b.created - a.created);

      return files;
    } catch (_error) {
      logger.error("[CrashReporter] Crash report listing failed");
      return [];
    }
  }

  /**
   * 读取崩溃报告
   */
  readCrashReport(filename) {
    try {
      const filepath = this.resolveReportPath(filename);
      if (!filepath) {
        return null;
      }
      const content = fs.readFileSync(filepath, "utf8");
      return sanitizeStoredCrashReport(JSON.parse(content));
    } catch (_error) {
      logger.error("[CrashReporter] Crash report read failed");
      return null;
    }
  }

  /**
   * 删除崩溃报告
   */
  deleteCrashReport(filename) {
    try {
      const filepath = this.resolveReportPath(filename);
      if (!filepath) {
        return false;
      }
      fs.unlinkSync(filepath);
      logger.info("[CrashReporter] Crash report deleted");
      return true;
    } catch (_error) {
      logger.error("[CrashReporter] Crash report deletion failed");
      return false;
    }
  }

  /**
   * 清理旧报告
   */
  cleanOldReports(maxReports = 20) {
    try {
      const reports = this.getCrashReports();

      if (reports.length > maxReports) {
        const toDelete = reports.slice(maxReports);
        for (const report of toDelete) {
          this.deleteCrashReport(report.name);
        }
        logger.info("[CrashReporter] Old crash reports cleaned");
      }
    } catch (_error) {
      logger.error("[CrashReporter] Old crash report cleanup failed");
    }
  }

  /**
   * 清空所有报告
   */
  clearAllReports() {
    try {
      const reports = this.getCrashReports();
      for (const report of reports) {
        this.deleteCrashReport(report.name);
      }
      logger.info("[CrashReporter] All reports cleared");
      return true;
    } catch (_error) {
      logger.error("[CrashReporter] Crash report clearing failed");
      return false;
    }
  }

  /**
   * 导出崩溃报告
   */
  exportCrashReports(outputPath) {
    try {
      const reports = this.getCrashReports();
      const allReports = [];

      for (const report of reports) {
        const content = this.readCrashReport(report.name);
        if (content) {
          allReports.push(content);
        }
      }

      fs.writeFileSync(outputPath, JSON.stringify(allReports, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      logger.info("[CrashReporter] Bounded reports exported");
      return true;
    } catch (_error) {
      logger.error("[CrashReporter] Crash report export failed");
      return false;
    }
  }

  /**
   * 获取崩溃统计
   */
  getCrashStatistics() {
    try {
      const reports = this.getCrashReports();
      const stats = {
        total: reports.length,
        byType: {},
        recent: reports.slice(0, 5),
      };

      for (const report of reports) {
        const content = this.readCrashReport(report.name);
        if (content && content.crash) {
          const type = content.crash.type || "unknown";
          stats.byType[type] = (stats.byType[type] || 0) + 1;
        }
      }

      return stats;
    } catch (_error) {
      logger.error("[CrashReporter] Crash statistics failed");
      return { total: 0, byType: {}, recent: [] };
    }
  }
}

// 创建全局实例
let crashReporterInstance = null;

function getCrashReporter(options) {
  if (!crashReporterInstance) {
    crashReporterInstance = new CrashReporter(options);
  }
  return crashReporterInstance;
}

module.exports = { CrashReporter, getCrashReporter };
