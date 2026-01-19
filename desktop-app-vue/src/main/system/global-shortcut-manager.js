/**
 * 全局快捷键注册器
 * 管理Electron全局快捷键
 */

const { logger, createLogger } = require('../utils/logger.js');
const { globalShortcut, app } = require("electron");
const fs = require("fs");
const path = require("path");

class GlobalShortcutManager {
  constructor() {
    this.shortcuts = new Map(); // accelerator -> handler
    this.configPath = path.join(app.getPath("userData"), "shortcuts.json");
    this.defaultShortcuts = {
      "show-hide-window": "CommandOrControl+Shift+Space",
      "new-note": "CommandOrControl+Shift+N",
      "global-search": "CommandOrControl+Shift+F",
      screenshot: "CommandOrControl+Shift+S",
      "clipboard-history": "CommandOrControl+Shift+V",
    };

    // 加载配置
    this.loadConfig();

    // 监听应用退出
    app.on("will-quit", () => {
      this.unregisterAll();
    });
  }

  /**
   * 注册快捷键
   */
  register(accelerator, handler, options = {}) {
    try {
      // 如果已注册，先注销
      if (this.shortcuts.has(accelerator)) {
        this.unregister(accelerator);
      }

      // 注册全局快捷键
      const success = globalShortcut.register(accelerator, () => {
        try {
          handler();
        } catch (error) {
          logger.error("[GlobalShortcut] Handler error:", error);
        }
      });

      if (success) {
        this.shortcuts.set(accelerator, {
          handler,
          description: options.description || "",
          enabled: true,
        });

        logger.info("[GlobalShortcut] Registered:", accelerator);
        return true;
      } else {
        logger.warn("[GlobalShortcut] Failed to register:", accelerator);
        return false;
      }
    } catch (error) {
      logger.error("[GlobalShortcut] Register error:", error);
      return false;
    }
  }

  /**
   * 注销快捷键
   */
  unregister(accelerator) {
    try {
      globalShortcut.unregister(accelerator);
      this.shortcuts.delete(accelerator);
      logger.info("[GlobalShortcut] Unregistered:", accelerator);
      return true;
    } catch (error) {
      logger.error("[GlobalShortcut] Unregister error:", error);
      return false;
    }
  }

  /**
   * 注销所有快捷键
   */
  unregisterAll() {
    try {
      globalShortcut.unregisterAll();
      this.shortcuts.clear();
      logger.info("[GlobalShortcut] All shortcuts unregistered");
    } catch (error) {
      logger.error("[GlobalShortcut] Unregister all error:", error);
    }
  }

  /**
   * 检查快捷键是否已注册
   */
  isRegistered(accelerator) {
    return globalShortcut.isRegistered(accelerator);
  }

  /**
   * 获取所有快捷键
   */
  getAll() {
    const shortcuts = [];
    for (const [accelerator, data] of this.shortcuts) {
      shortcuts.push({
        accelerator,
        description: data.description,
        enabled: data.enabled,
      });
    }
    return shortcuts;
  }

  /**
   * 更新快捷键
   */
  update(oldAccelerator, newAccelerator, handler) {
    if (oldAccelerator !== newAccelerator) {
      const data = this.shortcuts.get(oldAccelerator);
      this.unregister(oldAccelerator);
      this.register(newAccelerator, handler || data.handler, {
        description: data.description,
      });
    }
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
        logger.info("[GlobalShortcut] Config loaded");
        return config;
      }
    } catch (error) {
      logger.error("[GlobalShortcut] Load config error:", error);
    }
    return this.defaultShortcuts;
  }

  /**
   * 保存配置
   */
  saveConfig(config) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      logger.info("[GlobalShortcut] Config saved");
      return true;
    } catch (error) {
      logger.error("[GlobalShortcut] Save config error:", error);
      return false;
    }
  }

  /**
   * 重置为默认配置
   */
  resetToDefault() {
    this.unregisterAll();
    this.saveConfig(this.defaultShortcuts);
    return this.defaultShortcuts;
  }
}

// 创建全局实例
let globalShortcutManager = null;

function getGlobalShortcutManager() {
  if (!globalShortcutManager) {
    globalShortcutManager = new GlobalShortcutManager();
  }
  return globalShortcutManager;
}

module.exports = { GlobalShortcutManager, getGlobalShortcutManager };
