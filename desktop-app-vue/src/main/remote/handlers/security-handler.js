/**
 * 安全操作远程处理器
 *
 * 处理来自 Android 端的安全相关命令：
 * - security.lockWorkstation: 锁定工作站 (NORMAL)
 * - security.getStatus: 获取安全状态 (PUBLIC)
 * - security.getActiveUsers: 获取活动用户 (NORMAL)
 * - security.getLoginHistory: 获取登录历史 (ADMIN)
 * - security.getFirewallStatus: 获取防火墙状态 (PUBLIC)
 * - security.getAntivirusStatus: 获取杀毒软件状态 (PUBLIC)
 * - security.getEncryptionStatus: 获取加密状态 (PUBLIC)
 * - security.getUpdates: 获取系统更新状态 (PUBLIC)
 *
 * @module remote/handlers/security-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const os = require("os");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 安全操作处理器类
 */
class SecurityHandler {
  constructor(options = {}) {
    this.options = {
      maxLoginHistory: options.maxLoginHistory || 50,
      ...options,
    };

    logger.info("[SecurityHandler] 安全操作处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[SecurityHandler] 处理命令: ${action}`);

    switch (action) {
      case "lockWorkstation":
        return await this.lockWorkstation(params, context);

      case "getStatus":
        return await this.getStatus(params, context);

      case "getActiveUsers":
        return await this.getActiveUsers(params, context);

      case "getLoginHistory":
        return await this.getLoginHistory(params, context);

      case "getFirewallStatus":
        return await this.getFirewallStatus(params, context);

      case "getAntivirusStatus":
        return await this.getAntivirusStatus(params, context);

      case "getEncryptionStatus":
        return await this.getEncryptionStatus(params, context);

      case "getUpdates":
        return await this.getUpdates(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 锁定工作站
   */
  async lockWorkstation(params = {}, context) {
    logger.info(`[SecurityHandler] 锁定工作站`);

    try {
      if (isWindows) {
        await execAsync("rundll32.exe user32.dll,LockWorkStation");
      } else if (isMac) {
        await execAsync(
          'osascript -e \'tell application "System Events" to keystroke "q" using {control down, command down}\'',
        );
      } else if (isLinux) {
        // 尝试多种锁屏方式
        try {
          await execAsync("gnome-screensaver-command -l");
        } catch {
          try {
            await execAsync("xdg-screensaver lock");
          } catch {
            await execAsync("loginctl lock-session");
          }
        }
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      return {
        success: true,
        message: "Workstation locked",
      };
    } catch (error) {
      logger.error("[SecurityHandler] 锁定工作站失败:", error);
      throw new Error(`Failed to lock workstation: ${error.message}`);
    }
  }

  /**
   * 获取安全状态摘要
   */
  async getStatus(params = {}, context) {
    logger.debug(`[SecurityHandler] 获取安全状态`);

    try {
      const [firewall, antivirus, encryption, updates] = await Promise.all([
        this.getFirewallStatus({}, context).catch(() => ({ enabled: null })),
        this.getAntivirusStatus({}, context).catch(() => ({ installed: null })),
        this.getEncryptionStatus({}, context).catch(() => ({ enabled: null })),
        this.getUpdates({}, context).catch(() => ({ pendingCount: null })),
      ]);

      return {
        success: true,
        security: {
          firewallEnabled: firewall.enabled,
          antivirusInstalled: antivirus.installed,
          encryptionEnabled: encryption.enabled,
          pendingUpdates: updates.pendingCount,
          platform: process.platform,
        },
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取安全状态失败:", error);
      throw new Error(`Failed to get security status: ${error.message}`);
    }
  }

  /**
   * 获取活动用户
   */
  async getActiveUsers(params = {}, context) {
    logger.debug(`[SecurityHandler] 获取活动用户`);

    try {
      let users = [];

      if (isWindows) {
        users = await this._getWindowsActiveUsers();
      } else if (isMac) {
        users = await this._getMacActiveUsers();
      } else if (isLinux) {
        users = await this._getLinuxActiveUsers();
      }

      return {
        success: true,
        users,
        count: users.length,
        currentUser: os.userInfo().username,
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取活动用户失败:", error);
      throw new Error(`Failed to get active users: ${error.message}`);
    }
  }

  async _getWindowsActiveUsers() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance Win32_ComputerSystem | Select-Object UserName | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "{}");
      const username = data.UserName || os.userInfo().username;
      return [
        {
          username: username.split("\\").pop(),
          domain: username.includes("\\") ? username.split("\\")[0] : null,
          logonType: "interactive",
        },
      ];
    } catch {
      return [{ username: os.userInfo().username }];
    }
  }

  async _getMacActiveUsers() {
    try {
      const { stdout } = await execAsync("who");
      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(/\s+/);
        return {
          username: parts[0],
          terminal: parts[1],
          loginTime: parts.slice(2, 5).join(" "),
        };
      });
    } catch {
      return [{ username: os.userInfo().username }];
    }
  }

  async _getLinuxActiveUsers() {
    try {
      const { stdout } = await execAsync("who");
      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const parts = line.split(/\s+/);
        return {
          username: parts[0],
          terminal: parts[1],
          loginTime: parts.slice(2, 4).join(" "),
        };
      });
    } catch {
      return [{ username: os.userInfo().username }];
    }
  }

  /**
   * 获取登录历史
   */
  async getLoginHistory(params, context) {
    const { limit = this.options.maxLoginHistory } = params;

    logger.debug(`[SecurityHandler] 获取登录历史`);

    try {
      let history = [];

      if (isWindows) {
        history = await this._getWindowsLoginHistory(limit);
      } else if (isMac) {
        history = await this._getMacLoginHistory(limit);
      } else if (isLinux) {
        history = await this._getLinuxLoginHistory(limit);
      }

      return {
        success: true,
        history: history.slice(0, limit),
        count: history.length,
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取登录历史失败:", error);
      throw new Error(`Failed to get login history: ${error.message}`);
    }
  }

  async _getWindowsLoginHistory(limit) {
    try {
      const { stdout } = await execAsync(
        `powershell -command "Get-EventLog -LogName Security -InstanceId 4624 -Newest ${limit} 2>$null | Select-Object TimeGenerated, Message | ConvertTo-Json"`,
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const data = JSON.parse(stdout || "[]");
      const events = Array.isArray(data) ? data : [data];
      return events.map((e) => ({
        time: e.TimeGenerated,
        type: "login",
        details: (e.Message || "").substring(0, 200),
      }));
    } catch {
      return [];
    }
  }

  async _getMacLoginHistory(limit) {
    try {
      const { stdout } = await execAsync(`last -${limit}`);
      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.slice(0, -1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          username: parts[0],
          terminal: parts[1],
          time: parts.slice(2, 6).join(" "),
          type: line.includes("still logged in") ? "active" : "logout",
        };
      });
    } catch {
      return [];
    }
  }

  async _getLinuxLoginHistory(limit) {
    try {
      const { stdout } = await execAsync(`last -n ${limit}`);
      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.slice(0, -2).map((line) => {
        const parts = line.split(/\s+/);
        return {
          username: parts[0],
          terminal: parts[1],
          time: parts.slice(3, 7).join(" "),
          type: line.includes("still logged in") ? "active" : "logout",
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * 获取防火墙状态
   */
  async getFirewallStatus(params = {}, context) {
    logger.debug(`[SecurityHandler] 获取防火墙状态`);

    try {
      let status = { enabled: null, profiles: [] };

      if (isWindows) {
        status = await this._getWindowsFirewallStatus();
      } else if (isMac) {
        status = await this._getMacFirewallStatus();
      } else if (isLinux) {
        status = await this._getLinuxFirewallStatus();
      }

      return {
        success: true,
        ...status,
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取防火墙状态失败:", error);
      return {
        success: true,
        enabled: null,
        error: error.message,
      };
    }
  }

  async _getWindowsFirewallStatus() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-NetFirewallProfile | Select-Object Name, Enabled | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "[]");
      const profiles = Array.isArray(data) ? data : [data];

      return {
        enabled: profiles.some((p) => p.Enabled),
        profiles: profiles.map((p) => ({
          name: p.Name,
          enabled: p.Enabled,
        })),
      };
    } catch {
      return { enabled: null };
    }
  }

  async _getMacFirewallStatus() {
    try {
      const { stdout } = await execAsync(
        "sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null || defaults read /Library/Preferences/com.apple.alf globalstate",
      );
      const enabled = stdout.includes("enabled") || stdout.trim() === "1";
      return { enabled };
    } catch {
      return { enabled: null };
    }
  }

  async _getLinuxFirewallStatus() {
    try {
      // 尝试 ufw
      const { stdout: ufwStatus } = await execAsync(
        "sudo ufw status 2>/dev/null",
      );
      if (ufwStatus.includes("active")) {
        return { enabled: true, type: "ufw" };
      }
      if (ufwStatus.includes("inactive")) {
        return { enabled: false, type: "ufw" };
      }
    } catch {
      // 尝试 firewalld
      try {
        const { stdout } = await execAsync(
          "systemctl is-active firewalld 2>/dev/null",
        );
        return {
          enabled: stdout.trim() === "active",
          type: "firewalld",
        };
      } catch {
        // 尝试 iptables
        try {
          const { stdout } = await execAsync(
            "iptables -L -n 2>/dev/null | head -5",
          );
          return {
            enabled: stdout.includes("Chain"),
            type: "iptables",
          };
        } catch {
          return { enabled: null };
        }
      }
    }
    return { enabled: null };
  }

  /**
   * 获取杀毒软件状态
   */
  async getAntivirusStatus(params = {}, context) {
    logger.debug(`[SecurityHandler] 获取杀毒软件状态`);

    try {
      let status = { installed: null, products: [] };

      if (isWindows) {
        status = await this._getWindowsAntivirusStatus();
      } else if (isMac) {
        status = await this._getMacAntivirusStatus();
      } else if (isLinux) {
        status = await this._getLinuxAntivirusStatus();
      }

      return {
        success: true,
        ...status,
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取杀毒软件状态失败:", error);
      return {
        success: true,
        installed: null,
        error: error.message,
      };
    }
  }

  async _getWindowsAntivirusStatus() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct | Select-Object displayName, productState | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "[]");
      const products = Array.isArray(data) ? data : [data];

      return {
        installed: products.length > 0,
        products: products.map((p) => ({
          name: p.displayName,
          state: p.productState,
        })),
      };
    } catch {
      return { installed: null };
    }
  }

  async _getMacAntivirusStatus() {
    // macOS 内置 XProtect 和 Gatekeeper
    return {
      installed: true,
      products: [
        { name: "XProtect", builtin: true },
        { name: "Gatekeeper", builtin: true },
      ],
    };
  }

  async _getLinuxAntivirusStatus() {
    try {
      // 检查 ClamAV
      const { stdout } = await execAsync("which clamscan 2>/dev/null");
      if (stdout.trim()) {
        return {
          installed: true,
          products: [{ name: "ClamAV" }],
        };
      }
    } catch {
      // 忽略
    }
    return { installed: false, products: [] };
  }

  /**
   * 获取加密状态
   */
  async getEncryptionStatus(params = {}, context) {
    logger.debug(`[SecurityHandler] 获取加密状态`);

    try {
      let status = { enabled: null };

      if (isWindows) {
        status = await this._getWindowsEncryptionStatus();
      } else if (isMac) {
        status = await this._getMacEncryptionStatus();
      } else if (isLinux) {
        status = await this._getLinuxEncryptionStatus();
      }

      return {
        success: true,
        ...status,
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取加密状态失败:", error);
      return {
        success: true,
        enabled: null,
        error: error.message,
      };
    }
  }

  async _getWindowsEncryptionStatus() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-BitLockerVolume -MountPoint C: 2>$null | Select-Object ProtectionStatus, EncryptionPercentage | ConvertTo-Json"',
      );
      const data = JSON.parse(stdout || "{}");
      return {
        enabled: data.ProtectionStatus === 1,
        type: "BitLocker",
        percentage: data.EncryptionPercentage || 0,
      };
    } catch {
      return { enabled: null };
    }
  }

  async _getMacEncryptionStatus() {
    try {
      const { stdout } = await execAsync("fdesetup status");
      const enabled = stdout.includes("FileVault is On");
      return {
        enabled,
        type: "FileVault",
      };
    } catch {
      return { enabled: null };
    }
  }

  async _getLinuxEncryptionStatus() {
    try {
      const { stdout } = await execAsync(
        "lsblk -o NAME,TYPE,MOUNTPOINT,FSTYPE | grep crypt",
      );
      return {
        enabled: stdout.trim().length > 0,
        type: "LUKS",
      };
    } catch {
      return { enabled: null };
    }
  }

  /**
   * 获取系统更新状态
   */
  async getUpdates(params = {}, context) {
    logger.debug(`[SecurityHandler] 获取系统更新状态`);

    try {
      let updates = { pendingCount: null, updates: [] };

      if (isWindows) {
        updates = await this._getWindowsUpdates();
      } else if (isMac) {
        updates = await this._getMacUpdates();
      } else if (isLinux) {
        updates = await this._getLinuxUpdates();
      }

      return {
        success: true,
        ...updates,
      };
    } catch (error) {
      logger.error("[SecurityHandler] 获取系统更新失败:", error);
      return {
        success: true,
        pendingCount: null,
        error: error.message,
      };
    }
  }

  async _getWindowsUpdates() {
    try {
      const { stdout } = await execAsync(
        "powershell -command \"(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search('IsInstalled=0').Updates | Select-Object Title, KBArticleIDs | ConvertTo-Json\"",
        { timeout: 30000 },
      );
      const data = JSON.parse(stdout || "[]");
      const updates = Array.isArray(data) ? data : [data];

      return {
        pendingCount: updates.length,
        updates: updates.slice(0, 10).map((u) => ({
          title: u.Title,
          kb: u.KBArticleIDs?.[0],
        })),
      };
    } catch {
      return { pendingCount: null };
    }
  }

  async _getMacUpdates() {
    try {
      const { stdout } = await execAsync(
        "softwareupdate -l 2>&1 | grep -c '*'",
      );
      const count = parseInt(stdout.trim()) || 0;
      return { pendingCount: count };
    } catch {
      return { pendingCount: 0 };
    }
  }

  async _getLinuxUpdates() {
    try {
      // Debian/Ubuntu
      const { stdout: aptCount } = await execAsync(
        "apt list --upgradable 2>/dev/null | grep -c upgradable",
      );
      return { pendingCount: parseInt(aptCount.trim()) || 0 };
    } catch {
      try {
        // RHEL/CentOS
        const { stdout: yumCount } = await execAsync(
          "yum check-update 2>/dev/null | grep -c '^[a-zA-Z]'",
        );
        return { pendingCount: parseInt(yumCount.trim()) || 0 };
      } catch {
        return { pendingCount: null };
      }
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[SecurityHandler] 资源已清理");
  }
}

module.exports = { SecurityHandler };
