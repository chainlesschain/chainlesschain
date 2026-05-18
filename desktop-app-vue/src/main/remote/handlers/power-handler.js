/**
 * 电源控制远程处理器
 *
 * 处理来自 Android 端的电源控制命令：
 * - power.shutdown: 关机 (ROOT)
 * - power.restart: 重启 (ROOT)
 * - power.sleep: 睡眠 (ADMIN)
 * - power.hibernate: 休眠 (ADMIN)
 * - power.lock: 锁屏 (NORMAL)
 * - power.logout: 注销 (ADMIN)
 * - power.scheduleShutdown: 定时关机 (ADMIN)
 * - power.cancelSchedule: 取消定时 (ADMIN)
 * - power.getSchedule: 获取定时任务 (PUBLIC)
 *
 * @module remote/handlers/power-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

// 定时任务存储
const scheduledTasks = new Map();

/**
 * 电源控制处理器类
 */
class PowerHandler {
  constructor(options = {}) {
    this.options = {
      requireConfirmation: true,
      confirmationTimeout: 30000, // 30 seconds
      ...options,
    };

    // 待确认的操作
    this.pendingConfirmations = new Map();

    logger.info("[PowerHandler] 电源控制处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[PowerHandler] 处理命令: ${action}`);

    switch (action) {
      case "shutdown":
        return await this.shutdown(params, context);

      case "restart":
        return await this.restart(params, context);

      case "sleep":
        return await this.sleep(params, context);

      case "hibernate":
        return await this.hibernate(params, context);

      case "lock":
        return await this.lock(params, context);

      case "logout":
        return await this.logout(params, context);

      case "scheduleShutdown":
        return await this.scheduleShutdown(params, context);

      case "cancelSchedule":
        return await this.cancelSchedule(params, context);

      case "getSchedule":
        return await this.getSchedule(params, context);

      case "confirm":
        return await this.confirmAction(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 关机
   */
  async shutdown(params = {}, context) {
    const { delay = 0, force = false, confirm = true } = params;

    logger.info(
      `[PowerHandler] 关机请求 from ${context?.did || "local"}, delay=${delay}s, force=${force}`,
    );

    if (confirm && this.options.requireConfirmation) {
      return this._createConfirmation("shutdown", { delay, force }, context);
    }

    return await this._executeShutdown(delay, force);
  }

  async _executeShutdown(delay, force) {
    let command;

    if (isWindows) {
      command = `shutdown /s /t ${delay}${force ? " /f" : ""}`;
    } else if (isMac) {
      const minutes = Math.ceil(delay / 60);
      command =
        delay > 0 ? `sudo shutdown -h +${minutes}` : "sudo shutdown -h now";
    } else if (isLinux) {
      const minutes = Math.ceil(delay / 60);
      command = delay > 0 ? `shutdown -h +${minutes}` : "shutdown -h now";
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await execAsync(command);
      return {
        success: true,
        message:
          delay > 0
            ? `Shutdown scheduled in ${delay} seconds`
            : "Shutting down...",
        action: "shutdown",
        delay,
      };
    } catch (error) {
      logger.error("[PowerHandler] 关机失败:", error);
      throw new Error(`Shutdown failed: ${error.message}`);
    }
  }

  /**
   * 重启
   */
  async restart(params = {}, context) {
    const { delay = 0, force = false, confirm = true } = params;

    logger.info(
      `[PowerHandler] 重启请求 from ${context?.did || "local"}, delay=${delay}s`,
    );

    if (confirm && this.options.requireConfirmation) {
      return this._createConfirmation("restart", { delay, force }, context);
    }

    return await this._executeRestart(delay, force);
  }

  async _executeRestart(delay, force) {
    let command;

    if (isWindows) {
      command = `shutdown /r /t ${delay}${force ? " /f" : ""}`;
    } else if (isMac) {
      const minutes = Math.ceil(delay / 60);
      command =
        delay > 0 ? `sudo shutdown -r +${minutes}` : "sudo shutdown -r now";
    } else if (isLinux) {
      const minutes = Math.ceil(delay / 60);
      command = delay > 0 ? `shutdown -r +${minutes}` : "shutdown -r now";
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await execAsync(command);
      return {
        success: true,
        message:
          delay > 0 ? `Restart scheduled in ${delay} seconds` : "Restarting...",
        action: "restart",
        delay,
      };
    } catch (error) {
      logger.error("[PowerHandler] 重启失败:", error);
      throw new Error(`Restart failed: ${error.message}`);
    }
  }

  /**
   * 睡眠
   */
  async sleep(params = {}, context) {
    logger.info(`[PowerHandler] 睡眠请求 from ${context?.did || "local"}`);

    let command;

    if (isWindows) {
      // Windows 使用 rundll32 进入睡眠
      command = "rundll32.exe powrprof.dll,SetSuspendState 0,1,0";
    } else if (isMac) {
      command = "pmset sleepnow";
    } else if (isLinux) {
      command = "systemctl suspend";
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await execAsync(command);
      return {
        success: true,
        message: "Entering sleep mode...",
        action: "sleep",
      };
    } catch (error) {
      logger.error("[PowerHandler] 睡眠失败:", error);
      throw new Error(`Sleep failed: ${error.message}`);
    }
  }

  /**
   * 休眠
   */
  async hibernate(params = {}, context) {
    logger.info(`[PowerHandler] 休眠请求 from ${context?.did || "local"}`);

    let command;

    if (isWindows) {
      command = "shutdown /h";
    } else if (isMac) {
      // macOS 使用 deep sleep
      command = "sudo pmset -a hibernatemode 25 && pmset sleepnow";
    } else if (isLinux) {
      command = "systemctl hibernate";
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await execAsync(command);
      return {
        success: true,
        message: "Entering hibernation...",
        action: "hibernate",
      };
    } catch (error) {
      logger.error("[PowerHandler] 休眠失败:", error);
      throw new Error(`Hibernate failed: ${error.message}`);
    }
  }

  /**
   * 锁屏
   */
  async lock(params = {}, context) {
    logger.info(`[PowerHandler] 锁屏请求 from ${context?.did || "local"}`);

    let command;

    if (isWindows) {
      command = "rundll32.exe user32.dll,LockWorkStation";
    } else if (isMac) {
      command =
        "/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend";
    } else if (isLinux) {
      // 尝试多种锁屏方式
      command =
        "loginctl lock-session || gnome-screensaver-command -l || xdg-screensaver lock";
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await execAsync(command);
      return {
        success: true,
        message: "Screen locked",
        action: "lock",
      };
    } catch (error) {
      logger.error("[PowerHandler] 锁屏失败:", error);
      throw new Error(`Lock failed: ${error.message}`);
    }
  }

  /**
   * 注销
   */
  async logout(params = {}, context) {
    const { force = false, confirm = true } = params;

    logger.info(`[PowerHandler] 注销请求 from ${context?.did || "local"}`);

    if (confirm && this.options.requireConfirmation) {
      return this._createConfirmation("logout", { force }, context);
    }

    return await this._executeLogout(force);
  }

  async _executeLogout(force) {
    let command;

    if (isWindows) {
      command = force ? "shutdown /l /f" : "shutdown /l";
    } else if (isMac) {
      command = force
        ? "osascript -e 'tell app \"System Events\" to log out'"
        : "osascript -e 'tell app \"System Events\" to log out'";
    } else if (isLinux) {
      command =
        "loginctl terminate-user $USER || gnome-session-quit --logout --no-prompt";
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await execAsync(command);
      return {
        success: true,
        message: "Logging out...",
        action: "logout",
      };
    } catch (error) {
      logger.error("[PowerHandler] 注销失败:", error);
      throw new Error(`Logout failed: ${error.message}`);
    }
  }

  /**
   * 定时关机
   */
  async scheduleShutdown(params, context) {
    const { delay, time, action = "shutdown" } = params;

    if (!delay && !time) {
      throw new Error('Parameter "delay" or "time" is required');
    }

    let delayMs;
    if (delay) {
      delayMs = delay * 1000;
    } else {
      const targetTime = new Date(time);
      delayMs = targetTime.getTime() - Date.now();
      if (delayMs < 0) {
        throw new Error("Scheduled time is in the past");
      }
    }

    const taskId = `schedule-${Date.now()}`;
    const scheduledTime = new Date(Date.now() + delayMs);

    logger.info(
      `[PowerHandler] 定时 ${action} from ${context?.did || "local"}, 时间: ${scheduledTime.toISOString()}`,
    );

    const timer = setTimeout(async () => {
      try {
        if (action === "shutdown") {
          await this._executeShutdown(0, false);
        } else if (action === "restart") {
          await this._executeRestart(0, false);
        }
        scheduledTasks.delete(taskId);
      } catch (error) {
        logger.error(`[PowerHandler] 定时 ${action} 执行失败:`, error);
      }
    }, delayMs);

    scheduledTasks.set(taskId, {
      id: taskId,
      action,
      scheduledTime: scheduledTime.toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: context?.did || "local",
      timer,
    });

    return {
      success: true,
      taskId,
      action,
      scheduledTime: scheduledTime.toISOString(),
      message: `${action} scheduled for ${scheduledTime.toLocaleString()}`,
    };
  }

  /**
   * 取消定时任务
   */
  async cancelSchedule(params, context) {
    const { taskId } = params;

    if (!taskId) {
      throw new Error('Parameter "taskId" is required');
    }

    const task = scheduledTasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    clearTimeout(task.timer);
    scheduledTasks.delete(taskId);

    logger.info(`[PowerHandler] 取消定时任务: ${taskId}`);

    return {
      success: true,
      taskId,
      message: "Scheduled task cancelled",
    };
  }

  /**
   * 获取定时任务列表
   */
  async getSchedule(params, context) {
    const tasks = [];
    for (const [id, task] of scheduledTasks) {
      tasks.push({
        id,
        action: task.action,
        scheduledTime: task.scheduledTime,
        createdAt: task.createdAt,
        createdBy: task.createdBy,
      });
    }

    return {
      success: true,
      tasks,
      total: tasks.length,
    };
  }

  /**
   * 创建确认请求
   */
  _createConfirmation(action, params, context) {
    const confirmId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.pendingConfirmations.set(confirmId, {
      action,
      params,
      context,
      createdAt: Date.now(),
    });

    // 超时自动清理
    setTimeout(() => {
      this.pendingConfirmations.delete(confirmId);
    }, this.options.confirmationTimeout);

    return {
      success: true,
      requiresConfirmation: true,
      confirmId,
      action,
      message: `Action "${action}" requires confirmation. Call power.confirm with confirmId to proceed.`,
      expiresIn: this.options.confirmationTimeout,
    };
  }

  /**
   * 确认操作
   */
  async confirmAction(params, context) {
    const { confirmId } = params;

    if (!confirmId) {
      throw new Error('Parameter "confirmId" is required');
    }

    const pending = this.pendingConfirmations.get(confirmId);
    if (!pending) {
      throw new Error("Confirmation expired or invalid");
    }

    this.pendingConfirmations.delete(confirmId);

    logger.info(`[PowerHandler] 确认操作: ${pending.action}`);

    // 执行操作
    switch (pending.action) {
      case "shutdown":
        return await this._executeShutdown(
          pending.params.delay || 0,
          pending.params.force || false,
        );
      case "restart":
        return await this._executeRestart(
          pending.params.delay || 0,
          pending.params.force || false,
        );
      case "logout":
        return await this._executeLogout(pending.params.force || false);
      default:
        throw new Error(`Unknown action: ${pending.action}`);
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    // 清理所有定时任务
    for (const [id, task] of scheduledTasks) {
      clearTimeout(task.timer);
    }
    scheduledTasks.clear();
    this.pendingConfirmations.clear();

    logger.info("[PowerHandler] 资源已清理");
  }
}

module.exports = { PowerHandler };
