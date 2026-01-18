/**
 * 崩溃报告器
 * 捕获和报告应用崩溃信息
 */

const { app, crashReporter, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

class CrashReporter {
  constructor(options = {}) {
    this.crashesDir =
      options.crashesDir || path.join(app.getPath("userData"), "crashes");
    this.submitURL = options.submitURL || "";
    this.productName = options.productName || app.getName();
    this.companyName = options.companyName || "ChainlessChain";
    this.uploadToServer = options.uploadToServer !== false;
    this.showDialog = options.showDialog !== false;

    // 确保崩溃目录存在
    if (!fs.existsSync(this.crashesDir)) {
      fs.mkdirSync(this.crashesDir, { recursive: true });
    }

    // 初始化崩溃报告器
    this.init();
  }

  /**
   * 初始化崩溃报告器
   */
  init() {
    try {
      // 启动Electron崩溃报告器
      crashReporter.start({
        productName: this.productName,
        companyName: this.companyName,
        submitURL: this.submitURL,
        uploadToServer: this.uploadToServer,
        compress: true,
        extra: {
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.versions.node,
          electronVersion: process.versions.electron,
          chromeVersion: process.versions.chrome,
        },
      });

      console.log("[CrashReporter] Initialized");
      console.log("[CrashReporter] Crashes directory:", this.crashesDir);

      // 监听未捕获的异常
      this.setupExceptionHandlers();
    } catch (error) {
      console.error("[CrashReporter] Init error:", error);
    }
  }

  /**
   * 设置异常处理器
   */
  setupExceptionHandlers() {
    // 捕获未处理的Promise拒绝
    process.on("unhandledRejection", (reason, promise) => {
      console.error("[CrashReporter] Unhandled Rejection:", reason);
      this.saveCrashReport({
        type: "unhandledRejection",
        reason: String(reason),
        stack: reason?.stack || "",
        promise: String(promise),
      });
    });

    // 捕获未捕获的异常
    process.on("uncaughtException", (error) => {
      // 忽略 EPIPE 错误（管道已关闭，通常发生在应用关闭时）
      if (error.code === "EPIPE") {
        console.log("[CrashReporter] Ignoring EPIPE error (broken pipe)");
        return;
      }

      console.error("[CrashReporter] Uncaught Exception:", error);
      this.saveCrashReport({
        type: "uncaughtException",
        message: error.message,
        stack: error.stack,
        name: error.name,
      });

      // 显示错误对话框
      if (this.showDialog) {
        this.showCrashDialog(error);
      }
    });

    // 监听渲染进程崩溃
    app.on("render-process-gone", (event, webContents, details) => {
      console.error("[CrashReporter] Render process gone:", details);
      this.saveCrashReport({
        type: "renderProcessGone",
        reason: details.reason,
        exitCode: details.exitCode,
      });

      if (this.showDialog) {
        dialog.showErrorBox(
          "渲染进程崩溃",
          `渲染进程意外终止\n原因: ${details.reason}\n退出码: ${details.exitCode}`,
        );
      }
    });

    // 监听子进程崩溃
    app.on("child-process-gone", (event, details) => {
      console.error("[CrashReporter] Child process gone:", details);
      this.saveCrashReport({
        type: "childProcessGone",
        processType: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        name: details.name,
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

      // 收集系统信息
      const systemInfo = {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        type: os.type(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpus: os.cpus().length,
        uptime: os.uptime(),
      };

      // 收集应用信息
      const appInfo = {
        name: app.getName(),
        version: app.getVersion(),
        path: app.getAppPath(),
        isPackaged: app.isPackaged,
        locale: app.getLocale(),
      };

      // 收集进程信息
      const processInfo = {
        pid: process.pid,
        versions: process.versions,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: process.uptime(),
      };

      // 构建完整报告
      const report = {
        timestamp: new Date().toISOString(),
        crash: crashInfo,
        system: systemInfo,
        app: appInfo,
        process: processInfo,
      };

      // 写入文件
      fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

      console.log("[CrashReporter] Crash report saved:", filepath);

      // 清理旧报告
      this.cleanOldReports();

      return filepath;
    } catch (error) {
      console.error("[CrashReporter] Save crash report error:", error);
      return null;
    }
  }

  /**
   * 显示崩溃对话框
   */
  showCrashDialog(error) {
    const options = {
      type: "error",
      title: "应用程序错误",
      message: "应用程序遇到了一个错误",
      detail: `${error.message}\n\n${error.stack}`,
      buttons: ["重启应用", "退出"],
      defaultId: 0,
      cancelId: 1,
    };

    dialog.showMessageBox(options).then((result) => {
      if (result.response === 0) {
        // 重启应用
        app.relaunch();
        app.exit(0);
      } else {
        // 退出应用
        app.exit(1);
      }
    });
  }

  /**
   * 获取崩溃报告列表
   */
  getCrashReports() {
    try {
      const files = fs
        .readdirSync(this.crashesDir)
        .filter((f) => f.startsWith("crash-") && f.endsWith(".json"))
        .map((f) => ({
          name: f,
          path: path.join(this.crashesDir, f),
          size: fs.statSync(path.join(this.crashesDir, f)).size,
          created: fs.statSync(path.join(this.crashesDir, f)).birthtime,
        }))
        .sort((a, b) => b.created - a.created);

      return files;
    } catch (error) {
      console.error("[CrashReporter] Get crash reports error:", error);
      return [];
    }
  }

  /**
   * 读取崩溃报告
   */
  readCrashReport(filename) {
    try {
      const filepath = path.join(this.crashesDir, filename);
      const content = fs.readFileSync(filepath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      console.error("[CrashReporter] Read crash report error:", error);
      return null;
    }
  }

  /**
   * 删除崩溃报告
   */
  deleteCrashReport(filename) {
    try {
      const filepath = path.join(this.crashesDir, filename);
      fs.unlinkSync(filepath);
      console.log("[CrashReporter] Crash report deleted:", filename);
      return true;
    } catch (error) {
      console.error("[CrashReporter] Delete crash report error:", error);
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
        console.log("[CrashReporter] Cleaned old reports:", toDelete.length);
      }
    } catch (error) {
      console.error("[CrashReporter] Clean old reports error:", error);
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
      console.log("[CrashReporter] All reports cleared");
      return true;
    } catch (error) {
      console.error("[CrashReporter] Clear all reports error:", error);
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

      fs.writeFileSync(outputPath, JSON.stringify(allReports, null, 2));
      console.log("[CrashReporter] Reports exported to:", outputPath);
      return true;
    } catch (error) {
      console.error("[CrashReporter] Export reports error:", error);
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
    } catch (error) {
      console.error("[CrashReporter] Get crash statistics error:", error);
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
