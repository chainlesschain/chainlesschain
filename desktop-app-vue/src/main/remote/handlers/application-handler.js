/**
 * 应用程序管理远程处理器
 *
 * 处理来自 Android 端的应用管理命令：
 * - app.listInstalled: 获取已安装应用列表 (PUBLIC)
 * - app.listRunning: 获取运行中应用列表 (PUBLIC)
 * - app.getInfo: 获取应用详情 (PUBLIC)
 * - app.launch: 启动应用 (NORMAL)
 * - app.close: 关闭应用 (ADMIN)
 * - app.focus: 聚焦应用窗口 (NORMAL)
 * - app.search: 搜索应用 (PUBLIC)
 * - app.getRecent: 获取最近使用的应用 (PUBLIC)
 *
 * @module remote/handlers/application-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs").promises;
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 验证应用名称（防止命令注入）
 */
function validateAppName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 256) {
    throw new Error("Invalid application name");
  }
  // 允许字母、数字、空格、点、连字符、下划线、中文字符
  if (!/^[\w\s.\-\u4e00-\u9fa5]+$/.test(name)) {
    throw new Error("Invalid application name: contains disallowed characters");
  }
  return name;
}

/**
 * 验证路径（防止路径遍历）
 */
function validatePath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) {
    throw new Error("Invalid path");
  }
  if (p.includes("..") || p.includes("\0")) {
    throw new Error("Invalid path: path traversal detected");
  }
  return p;
}

/**
 * 应用程序管理处理器类
 */
class ApplicationHandler {
  constructor(options = {}) {
    this.options = {
      maxResults: options.maxResults || 100,
      includeSystemApps: options.includeSystemApps !== false,
      ...options,
    };

    logger.info("[ApplicationHandler] 应用程序管理处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[ApplicationHandler] 处理命令: ${action}`);

    switch (action) {
      case "listInstalled":
        return await this.listInstalled(params, context);

      case "listRunning":
        return await this.listRunning(params, context);

      case "getInfo":
        return await this.getInfo(params, context);

      case "launch":
        return await this.launch(params, context);

      case "close":
        return await this.close(params, context);

      case "focus":
        return await this.focus(params, context);

      case "search":
        return await this.search(params, context);

      case "getRecent":
        return await this.getRecent(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取已安装应用列表
   */
  async listInstalled(params = {}, context) {
    const { limit = this.options.maxResults, filter } = params;

    logger.debug(`[ApplicationHandler] 获取已安装应用列表`);

    try {
      let apps = [];

      if (isWindows) {
        apps = await this._getWindowsInstalledApps();
      } else if (isMac) {
        apps = await this._getMacInstalledApps();
      } else if (isLinux) {
        apps = await this._getLinuxInstalledApps();
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      // 过滤
      if (filter) {
        const filterLower = filter.toLowerCase();
        apps = apps.filter(
          (app) =>
            app.name.toLowerCase().includes(filterLower) ||
            (app.publisher &&
              app.publisher.toLowerCase().includes(filterLower)),
        );
      }

      // 限制数量
      const limitedApps = apps.slice(0, limit);

      return {
        success: true,
        apps: limitedApps,
        total: apps.length,
        returned: limitedApps.length,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 获取已安装应用失败:", error);
      throw new Error(`Failed to list installed apps: ${error.message}`);
    }
  }

  async _getWindowsInstalledApps() {
    const { stdout } = await execAsync(
      `powershell -command "Get-ItemProperty HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | Select-Object DisplayName, Publisher, InstallDate, DisplayVersion, InstallLocation | ConvertTo-Json"`,
      { maxBuffer: 10 * 1024 * 1024 },
    );

    try {
      const data = JSON.parse(stdout || "[]");
      const apps = Array.isArray(data) ? data : [data];

      return apps.map((app) => ({
        name: app.DisplayName || "Unknown",
        publisher: app.Publisher || null,
        version: app.DisplayVersion || null,
        installDate: app.InstallDate || null,
        installPath: app.InstallLocation || null,
      }));
    } catch {
      return [];
    }
  }

  async _getMacInstalledApps() {
    const { stdout } = await execAsync("ls -1 /Applications | grep '.app$'");

    const appNames = stdout.trim().split("\n").filter(Boolean);
    const apps = [];

    for (const name of appNames.slice(0, this.options.maxResults)) {
      const appName = name.replace(".app", "");
      apps.push({
        name: appName,
        publisher: null,
        version: null,
        installPath: `/Applications/${name}`,
      });
    }

    return apps;
  }

  async _getLinuxInstalledApps() {
    try {
      const { stdout } = await execAsync(
        "dpkg-query -W -f='${Package}|${Version}|${Status}\\n' 2>/dev/null | grep 'install ok installed' | head -500",
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const [name, version] = line.split("|");
        return {
          name: name || "Unknown",
          version: version || null,
          publisher: null,
          installPath: null,
        };
      });
    } catch {
      // 尝试 rpm
      try {
        const { stdout } = await execAsync(
          "rpm -qa --queryformat '%{NAME}|%{VERSION}\\n' 2>/dev/null | head -500",
        );

        const lines = stdout.trim().split("\n").filter(Boolean);
        return lines.map((line) => {
          const [name, version] = line.split("|");
          return {
            name: name || "Unknown",
            version: version || null,
            publisher: null,
            installPath: null,
          };
        });
      } catch {
        return [];
      }
    }
  }

  /**
   * 获取运行中的应用列表
   */
  async listRunning(params = {}, context) {
    const { limit = this.options.maxResults } = params;

    logger.debug(`[ApplicationHandler] 获取运行中应用列表`);

    try {
      let apps = [];

      if (isWindows) {
        apps = await this._getWindowsRunningApps();
      } else if (isMac) {
        apps = await this._getMacRunningApps();
      } else if (isLinux) {
        apps = await this._getLinuxRunningApps();
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      const limitedApps = apps.slice(0, limit);

      return {
        success: true,
        apps: limitedApps,
        total: apps.length,
        returned: limitedApps.length,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 获取运行中应用失败:", error);
      throw new Error(`Failed to list running apps: ${error.message}`);
    }
  }

  async _getWindowsRunningApps() {
    const { stdout } = await execAsync(
      `powershell -command "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, Id, MainWindowTitle, CPU, WorkingSet64 | ConvertTo-Json"`,
    );

    try {
      const data = JSON.parse(stdout || "[]");
      const processes = Array.isArray(data) ? data : [data];

      return processes.map((proc) => ({
        name: proc.ProcessName,
        pid: proc.Id,
        title: proc.MainWindowTitle,
        cpu: proc.CPU || 0,
        memory: proc.WorkingSet64 || 0,
      }));
    } catch {
      return [];
    }
  }

  async _getMacRunningApps() {
    const { stdout } = await execAsync(
      "osascript -e 'tell application \"System Events\" to get name of every process whose background only is false'",
    );

    const appNames = stdout.replace(/^{|}$/g, "").split(", ").filter(Boolean);

    return appNames.map((name) => ({
      name: name.replace(/"/g, ""),
      pid: null,
      title: null,
    }));
  }

  async _getLinuxRunningApps() {
    const { stdout } = await execAsync(
      "wmctrl -l 2>/dev/null | awk '{$1=$2=$3=\"\"; print substr($0,4)}' || xdotool search --name '.*' getwindowname %@ 2>/dev/null | head -50",
    );

    const titles = stdout.trim().split("\n").filter(Boolean);
    return titles.map((title, index) => ({
      name: title,
      pid: null,
      title,
    }));
  }

  /**
   * 获取应用详情
   */
  async getInfo(params, context) {
    const { name, path: appPath } = params;

    if (!name && !appPath) {
      throw new Error('Parameter "name" or "path" is required');
    }

    const searchName = name ? validateAppName(name) : null;
    const searchPath = appPath ? validatePath(appPath) : null;

    logger.debug(
      `[ApplicationHandler] 获取应用详情: ${searchName || searchPath}`,
    );

    try {
      let appInfo;

      if (isWindows) {
        appInfo = await this._getWindowsAppInfo(searchName, searchPath);
      } else if (isMac) {
        appInfo = await this._getMacAppInfo(searchName, searchPath);
      } else if (isLinux) {
        appInfo = await this._getLinuxAppInfo(searchName, searchPath);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        app: appInfo,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 获取应用详情失败:", error);
      throw new Error(`Failed to get app info: ${error.message}`);
    }
  }

  async _getWindowsAppInfo(name, appPath) {
    if (name) {
      const { stdout } = await execAsync(
        `powershell -command "Get-ItemProperty HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName -like '*${name.replace(/'/g, "''")}*' } | Select-Object DisplayName, Publisher, InstallDate, DisplayVersion, InstallLocation, UninstallString | ConvertTo-Json -First 1"`,
      );

      try {
        const data = JSON.parse(stdout || "null");
        if (!data) {
          return null;
        }

        return {
          name: data.DisplayName,
          publisher: data.Publisher,
          version: data.DisplayVersion,
          installDate: data.InstallDate,
          installPath: data.InstallLocation,
          uninstallCommand: data.UninstallString,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  async _getMacAppInfo(name, appPath) {
    const searchPath = appPath || `/Applications/${name}.app`;
    try {
      const { stdout } = await execAsync(
        `defaults read "${searchPath}/Contents/Info" CFBundleName CFBundleShortVersionString CFBundleIdentifier 2>/dev/null`,
      );

      const lines = stdout.trim().split("\n");
      return {
        name: lines[0] || name,
        version: lines[1] || null,
        bundleId: lines[2] || null,
        installPath: searchPath,
      };
    } catch {
      return {
        name,
        installPath: searchPath,
      };
    }
  }

  async _getLinuxAppInfo(name, appPath) {
    try {
      const { stdout } = await execAsync(
        `dpkg-query -W -f='\${Package}|\${Version}|\${Status}|\${Maintainer}' "${name}" 2>/dev/null`,
      );

      const [pkg, version, status, maintainer] = stdout.split("|");
      return {
        name: pkg,
        version,
        status,
        publisher: maintainer,
      };
    } catch {
      return { name };
    }
  }

  /**
   * 启动应用
   */
  async launch(params, context) {
    const { name, path: appPath, args = [] } = params;

    if (!name && !appPath) {
      throw new Error('Parameter "name" or "path" is required');
    }

    const launchName = name ? validateAppName(name) : null;
    const launchPath = appPath ? validatePath(appPath) : null;

    logger.info(`[ApplicationHandler] 启动应用: ${launchName || launchPath}`);

    try {
      if (isWindows) {
        await this._launchWindowsApp(launchName, launchPath, args);
      } else if (isMac) {
        await this._launchMacApp(launchName, launchPath, args);
      } else if (isLinux) {
        await this._launchLinuxApp(launchName, launchPath, args);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        name: launchName || launchPath,
        message: `Application launched: ${launchName || launchPath}`,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 启动应用失败:", error);
      throw new Error(`Failed to launch app: ${error.message}`);
    }
  }

  async _launchWindowsApp(name, appPath, args) {
    if (appPath) {
      await execAsync(`start "" "${appPath}" ${args.join(" ")}`);
    } else {
      // 尝试通过名称启动
      await execAsync(`start "" "${name}"`);
    }
  }

  async _launchMacApp(name, appPath, args) {
    if (appPath) {
      await execAsync(`open "${appPath}" --args ${args.join(" ")}`);
    } else {
      await execAsync(`open -a "${name}" --args ${args.join(" ")}`);
    }
  }

  async _launchLinuxApp(name, appPath, args) {
    if (appPath) {
      await execAsync(`"${appPath}" ${args.join(" ")} &`);
    } else {
      await execAsync(`${name} ${args.join(" ")} &`);
    }
  }

  /**
   * 关闭应用
   */
  async close(params, context) {
    const { name, pid, force = false } = params;

    if (!name && !pid) {
      throw new Error('Parameter "name" or "pid" is required');
    }

    const closeName = name ? validateAppName(name) : null;

    logger.info(`[ApplicationHandler] 关闭应用: ${closeName || pid}`);

    try {
      if (isWindows) {
        await this._closeWindowsApp(closeName, pid, force);
      } else if (isMac) {
        await this._closeMacApp(closeName, pid, force);
      } else if (isLinux) {
        await this._closeLinuxApp(closeName, pid, force);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        name: closeName,
        pid,
        force,
        message: `Application closed: ${closeName || pid}`,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 关闭应用失败:", error);
      throw new Error(`Failed to close app: ${error.message}`);
    }
  }

  async _closeWindowsApp(name, pid, force) {
    if (pid) {
      const flag = force ? "/F" : "";
      await execAsync(`taskkill ${flag} /PID ${pid}`);
    } else if (name) {
      const flag = force ? "/F" : "";
      await execAsync(`taskkill ${flag} /IM "${name}.exe"`);
    }
  }

  async _closeMacApp(name, pid, force) {
    if (pid) {
      const signal = force ? "-9" : "-15";
      await execAsync(`kill ${signal} ${pid}`);
    } else if (name) {
      if (force) {
        await execAsync(`pkill -9 -f "${name}"`);
      } else {
        await execAsync(`osascript -e 'tell application "${name}" to quit'`);
      }
    }
  }

  async _closeLinuxApp(name, pid, force) {
    if (pid) {
      const signal = force ? "-9" : "-15";
      await execAsync(`kill ${signal} ${pid}`);
    } else if (name) {
      const signal = force ? "-9" : "-15";
      await execAsync(`pkill ${signal} -f "${name}"`);
    }
  }

  /**
   * 聚焦应用窗口
   */
  async focus(params, context) {
    const { name, pid } = params;

    if (!name && !pid) {
      throw new Error('Parameter "name" or "pid" is required');
    }

    const focusName = name ? validateAppName(name) : null;

    logger.info(`[ApplicationHandler] 聚焦应用: ${focusName || pid}`);

    try {
      if (isWindows) {
        await this._focusWindowsApp(focusName, pid);
      } else if (isMac) {
        await this._focusMacApp(focusName, pid);
      } else if (isLinux) {
        await this._focusLinuxApp(focusName, pid);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        name: focusName,
        pid,
        message: `Application focused: ${focusName || pid}`,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 聚焦应用失败:", error);
      throw new Error(`Failed to focus app: ${error.message}`);
    }
  }

  async _focusWindowsApp(name, pid) {
    const script = pid
      ? `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle | ForEach-Object { [void][Win32.User32]::SetForegroundWindow($_) }`
      : `(Get-Process -Name "${name}" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle | ForEach-Object { [void][Win32.User32]::SetForegroundWindow($_) }`;

    await execAsync(
      `powershell -command "Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
    public class User32 {
        [DllImport(\\"user32.dll\\")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
    }
}
'@; ${script}"`,
    );
  }

  async _focusMacApp(name, pid) {
    if (name) {
      await execAsync(`osascript -e 'tell application "${name}" to activate'`);
    }
  }

  async _focusLinuxApp(name, pid) {
    if (pid) {
      await execAsync(
        `wmctrl -i -a $(wmctrl -lp | grep ${pid} | head -1 | awk '{print $1}')`,
      );
    } else if (name) {
      await execAsync(`wmctrl -a "${name}"`);
    }
  }

  /**
   * 搜索应用
   */
  async search(params, context) {
    const { query, limit = 20 } = params;

    if (!query) {
      throw new Error('Parameter "query" is required');
    }

    const searchQuery = validateAppName(query);

    logger.debug(`[ApplicationHandler] 搜索应用: ${searchQuery}`);

    try {
      const result = await this.listInstalled(
        { filter: searchQuery, limit },
        context,
      );
      return {
        success: true,
        query: searchQuery,
        apps: result.apps,
        total: result.total,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 搜索应用失败:", error);
      throw new Error(`Failed to search apps: ${error.message}`);
    }
  }

  /**
   * 获取最近使用的应用
   */
  async getRecent(params = {}, context) {
    const { limit = 10 } = params;

    logger.debug(`[ApplicationHandler] 获取最近使用的应用`);

    try {
      let apps = [];

      if (isWindows) {
        apps = await this._getWindowsRecentApps();
      } else if (isMac) {
        apps = await this._getMacRecentApps();
      } else if (isLinux) {
        apps = await this._getLinuxRecentApps();
      }

      const limitedApps = apps.slice(0, limit);

      return {
        success: true,
        apps: limitedApps,
        total: limitedApps.length,
      };
    } catch (error) {
      logger.error("[ApplicationHandler] 获取最近应用失败:", error);
      return {
        success: true,
        apps: [],
        total: 0,
        error: error.message,
      };
    }
  }

  async _getWindowsRecentApps() {
    // Windows 最近使用的应用在任务栏跳转列表中
    // 这是一个简化版本，返回运行中的应用
    const running = await this._getWindowsRunningApps();
    return running;
  }

  async _getMacRecentApps() {
    try {
      const { stdout } = await execAsync(
        "osascript -e 'tell application \"System Events\" to get name of every process whose background only is false' | tr ',' '\\n'",
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((name) => ({ name: name.trim() }));
    } catch {
      return [];
    }
  }

  async _getLinuxRecentApps() {
    try {
      const { stdout } = await execAsync(
        "cat ~/.local/share/recently-used.xbel 2>/dev/null | grep -oP '(?<=href=\")[^\"]+' | head -20",
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((path) => ({
          name: path.split("/").pop(),
          path,
        }));
    } catch {
      return [];
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[ApplicationHandler] 资源已清理");
  }
}

module.exports = { ApplicationHandler };
