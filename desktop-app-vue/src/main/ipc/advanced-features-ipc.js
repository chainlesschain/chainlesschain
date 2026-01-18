/**
 * 高级特性 IPC 处理程序
 * 将三大高级特性集成到主应用的IPC系统
 */

const { ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// 防止重复注册的标志
let handlersRegistered = false;

class AdvancedFeaturesIPC {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.setupHandlers();
  }

  setupHandlers() {
    if (handlersRegistered) {
      console.log(
        "[AdvancedFeaturesIPC] Handlers already registered, skipping...",
      );
      return;
    }

    console.log("[AdvancedFeaturesIPC] Registering handlers...");

    // ===== 总览 =====
    ipcMain.handle(
      "advanced-features:get-overview",
      async (event, days = 7) => {
        return this.getOverviewData(days);
      },
    );

    // ===== 自适应阈值 =====
    ipcMain.handle(
      "advanced-features:threshold-monitor",
      async (event, days = 7) => {
        return this.executeScript("adaptive-threshold.js", [
          "monitor",
          `--days=${days}`,
        ]);
      },
    );

    ipcMain.handle("advanced-features:threshold-simulate", async () => {
      return this.executeScript("adaptive-threshold.js", ["simulate"]);
    });

    ipcMain.handle("advanced-features:threshold-adjust", async () => {
      return this.executeScript("adaptive-threshold.js", ["adjust"]);
    });

    ipcMain.handle(
      "advanced-features:threshold-auto",
      async (event, interval = 60) => {
        return this.executeScript("adaptive-threshold.js", [
          "auto",
          `--interval=${interval}`,
        ]);
      },
    );

    ipcMain.handle(
      "advanced-features:threshold-history",
      async (event, limit = 20) => {
        return this.getThresholdHistory(limit);
      },
    );

    // ===== 在线学习 =====
    ipcMain.handle(
      "advanced-features:learning-train",
      async (event, days = 30) => {
        return this.executeScript("online-learning.js", [
          "train",
          `--days=${days}`,
        ]);
      },
    );

    ipcMain.handle("advanced-features:learning-evaluate", async () => {
      return this.executeScript("online-learning.js", ["evaluate"]);
    });

    ipcMain.handle("advanced-features:learning-stats", async () => {
      return this.executeScript("online-learning.js", ["stats"]);
    });

    // ===== 高级优化器 =====
    ipcMain.handle("advanced-features:optimizer-predict", async () => {
      return this.executeScript("advanced-optimizer.js", ["predict"]);
    });

    ipcMain.handle("advanced-features:optimizer-parallel", async () => {
      return this.executeScript("advanced-optimizer.js", ["parallel"]);
    });

    ipcMain.handle("advanced-features:optimizer-retry", async () => {
      return this.executeScript("advanced-optimizer.js", ["retry"]);
    });

    ipcMain.handle(
      "advanced-features:optimizer-bottleneck",
      async (event, days = 7) => {
        return this.executeScript("advanced-optimizer.js", [
          "bottleneck",
          `--days=${days}`,
        ]);
      },
    );

    ipcMain.handle("advanced-features:optimizer-optimize", async () => {
      return this.executeScript("advanced-optimizer.js", ["optimize"]);
    });

    // ===== 配置 =====
    ipcMain.handle("advanced-features:get-config", async () => {
      return this.getConfig();
    });

    ipcMain.handle("advanced-features:save-config", async (event, config) => {
      return this.saveConfig(config);
    });

    // ===== 日志 =====
    ipcMain.handle(
      "advanced-features:get-logs",
      async (event, options = {}) => {
        return this.getLogs(options);
      },
    );

    // ===== 打开控制面板 =====
    ipcMain.handle("advanced-features:open-control-panel", async () => {
      return this.openControlPanel();
    });

    handlersRegistered = true;
    console.log("[AdvancedFeaturesIPC] ✓ All handlers registered successfully");
  }

  /**
   * 执行脚本命令
   */
  executeScript(script, args = []) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, "..", "..", script);

      const child = spawn("node", [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
      });

      let output = "";
      let errorOutput = "";

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: output,
            exitCode: code,
          });
        } else {
          reject({
            success: false,
            error: errorOutput || output,
            exitCode: code,
          });
        }
      });

      child.on("error", (error) => {
        reject({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * 获取总览数据
   */
  async getOverviewData(days) {
    const db = this.getDatabase();
    if (!db) {
      throw new Error("数据库未连接");
    }

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT
          COUNT(*) as total_tasks,
          AVG(CASE WHEN selected_model = 'small' THEN 100.0 ELSE 0.0 END) as small_model_rate,
          AVG(CASE WHEN is_success = 1 THEN 100.0 ELSE 0.0 END) as success_rate,
          AVG(cost_savings) as avg_cost_savings,
          AVG(quality_score) as avg_quality_score
        FROM knowledge_distillation_history
        WHERE created_at >= datetime('now', '-${days} days')
      `;

      db.get(sql, (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          success: true,
          data: {
            totalTasks: row.total_tasks || 0,
            smallModelRate: row.small_model_rate || 0,
            successRate: row.success_rate || 0,
            costSavings: row.avg_cost_savings || 0,
            qualityScore: row.avg_quality_score || 0,
            period: `${days}天`,
          },
        });
      });
    });
  }

  /**
   * 获取阈值调整历史
   */
  async getThresholdHistory(limit) {
    const db = this.getDatabase();
    if (!db) {
      throw new Error("数据库未连接");
    }

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM threshold_adjustment_history
        ORDER BY created_at DESC
        LIMIT ?
      `;

      db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          success: true,
          data: rows || [],
        });
      });
    });
  }

  /**
   * 获取配置
   */
  async getConfig() {
    try {
      const configPath = path.join(
        __dirname,
        "..",
        "..",
        "config",
        "advanced-features.json",
      );
      const data = fs.readFileSync(configPath, "utf8");
      return {
        success: true,
        data: JSON.parse(data),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(config) {
    try {
      const configPath = path.join(
        __dirname,
        "..",
        "..",
        "config",
        "advanced-features.json",
      );
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return {
        success: true,
        message: "配置保存成功",
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取日志
   */
  async getLogs(options = {}) {
    try {
      const { lines = 100, filter = "all" } = options;
      const logPath = path.join(
        __dirname,
        "..",
        "..",
        "logs",
        "production-integration.log",
      );

      if (!fs.existsSync(logPath)) {
        return {
          success: true,
          data: { logs: [] },
        };
      }

      const data = fs.readFileSync(logPath, "utf8");
      let logLines = data.split("\n").filter((line) => line.trim());

      // 过滤
      if (filter !== "all") {
        logLines = logLines.filter((line) =>
          line.includes(`[${filter.toUpperCase()}]`),
        );
      }

      // 获取最后N行
      logLines = logLines.slice(-lines);

      return {
        success: true,
        data: { logs: logLines },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 打开控制面板
   */
  async openControlPanel() {
    const { shell } = require("electron");
    await shell.openExternal("http://localhost:3001");
    return {
      success: true,
      message: "已打开控制面板",
    };
  }

  /**
   * 获取数据库连接
   */
  getDatabase() {
    // 从主应用获取数据库实例
    // 需要根据实际的数据库管理方式调整
    return require("./database").getDatabase();
  }
}

module.exports = AdvancedFeaturesIPC;
