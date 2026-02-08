const { logger } = require("../utils/logger.js");

/**
 * PermissionChecker - 权限检查器
 *
 * 职责：
 * - 运行时权限验证
 * - 权限组管理
 * - 权限审计日志
 */

class PermissionChecker {
  constructor(registry) {
    this.registry = registry;

    // 定义权限组
    this.permissionGroups = {
      database: ["database:read", "database:write", "database:delete"],
      llm: ["llm:query", "llm:stream"],
      ui: ["ui:component", "ui:page", "ui:menu", "ui:dialog"],
      file: ["file:read", "file:write", "file:delete", "file:list"],
      network: ["network:http", "network:websocket"],
      system: ["system:exec", "system:clipboard", "system:notification"],
      rag: ["rag:search", "rag:embed"],
      storage: ["storage:read", "storage:write", "storage:delete"],
    };

    // 权限层级（数字越大权限越高）
    this.permissionLevels = {
      "database:read": 1,
      "database:write": 2,
      "database:delete": 3,
      "file:read": 1,
      "file:write": 2,
      "file:delete": 3,
      "llm:query": 1,
      "llm:stream": 1,
      "ui:component": 1,
      "ui:page": 2,
      "ui:menu": 1,
      "ui:dialog": 1,
      "network:http": 2,
      "network:websocket": 3,
      "system:exec": 5, // 最高权限
      "system:clipboard": 1,
      "system:notification": 1,
      "rag:search": 1,
      "rag:embed": 1,
      "storage:read": 1,
      "storage:write": 2,
      "storage:delete": 3,
    };
  }

  /**
   * 检查插件是否有权限
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @returns {boolean} 是否有权限
   */
  hasPermission(pluginId, permission) {
    try {
      const permissions = this.registry.getPluginPermissions(pluginId);

      // 检查是否已授予该权限
      const permissionEntry = permissions.find(
        (p) => p.permission === permission,
      );

      if (!permissionEntry) {
        logger.warn(
          `[PermissionChecker] 插件 ${pluginId} 未请求权限: ${permission}`,
        );
        return false;
      }

      if (!permissionEntry.granted) {
        logger.warn(
          `[PermissionChecker] 插件 ${pluginId} 权限被拒绝: ${permission}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`[PermissionChecker] 检查权限失败:`, error);
      return false;
    }
  }

  /**
   * 检查多个权限（需要全部满足）
   * @param {string} pluginId - 插件ID
   * @param {string[]} permissions - 权限列表
   * @returns {boolean} 是否全部有权限
   */
  hasPermissions(pluginId, permissions) {
    return permissions.every((p) => this.hasPermission(pluginId, p));
  }

  /**
   * 检查任意权限（至少满足一个）
   * @param {string} pluginId - 插件ID
   * @param {string[]} permissions - 权限列表
   * @returns {boolean} 是否至少有一个权限
   */
  hasAnyPermission(pluginId, permissions) {
    return permissions.some((p) => this.hasPermission(pluginId, p));
  }

  /**
   * 要求权限（如果没有则抛出错误）
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @throws {Error} 如果没有权限
   */
  requirePermission(pluginId, permission) {
    if (!this.hasPermission(pluginId, permission)) {
      throw new Error(
        `权限被拒绝: ${permission}。插件 ${pluginId} 没有该权限。`,
      );
    }
  }

  /**
   * 要求多个权限
   * @param {string} pluginId - 插件ID
   * @param {string[]} permissions - 权限列表
   * @throws {Error} 如果缺少任何权限
   */
  requirePermissions(pluginId, permissions) {
    const missing = permissions.filter((p) => !this.hasPermission(pluginId, p));

    if (missing.length > 0) {
      throw new Error(
        `缺少权限: ${missing.join(", ")}。插件 ${pluginId} 没有这些权限。`,
      );
    }
  }

  /**
   * 检查权限等级
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @param {number} minLevel - 最小权限等级
   * @returns {boolean} 是否满足权限等级
   */
  checkPermissionLevel(pluginId, permission, minLevel) {
    if (!this.hasPermission(pluginId, permission)) {
      return false;
    }

    const level = this.permissionLevels[permission] || 0;
    return level >= minLevel;
  }

  /**
   * 获取插件的所有已授予权限
   * @param {string} pluginId - 插件ID
   * @returns {string[]} 已授予的权限列表
   */
  getGrantedPermissions(pluginId) {
    const permissions = this.registry.getPluginPermissions(pluginId);
    return permissions.filter((p) => p.granted).map((p) => p.permission);
  }

  /**
   * 获取插件缺少的权限
   * @param {string} pluginId - 插件ID
   * @param {string[]} requiredPermissions - 需要的权限列表
   * @returns {string[]} 缺少的权限
   */
  getMissingPermissions(pluginId, requiredPermissions) {
    return requiredPermissions.filter((p) => !this.hasPermission(pluginId, p));
  }

  /**
   * 验证权限名称格式
   * @param {string} permission - 权限名称
   * @returns {boolean} 是否有效
   */
  isValidPermission(permission) {
    // 权限格式: category:action
    const pattern = /^[a-z]+:[a-z]+$/;
    return pattern.test(permission);
  }

  /**
   * 获取权限的分类
   * @param {string} permission - 权限名称
   * @returns {string|null} 分类名称
   */
  getPermissionCategory(permission) {
    const parts = permission.split(":");
    return parts.length === 2 ? parts[0] : null;
  }

  /**
   * 获取权限的操作
   * @param {string} permission - 权限名称
   * @returns {string|null} 操作名称
   */
  getPermissionAction(permission) {
    const parts = permission.split(":");
    return parts.length === 2 ? parts[1] : null;
  }

  /**
   * 检查插件是否有整个权限组
   * @param {string} pluginId - 插件ID
   * @param {string} group - 权限组名称
   * @returns {boolean} 是否有整个权限组
   */
  hasPermissionGroup(pluginId, group) {
    const permissions = this.permissionGroups[group];
    if (!permissions) {
      logger.warn(`[PermissionChecker] 未知权限组: ${group}`);
      return false;
    }

    return this.hasPermissions(pluginId, permissions);
  }

  /**
   * 记录权限检查日志（用于审计）
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @param {boolean} granted - 是否授予
   * @param {string} reason - 原因
   */
  async logPermissionCheck(pluginId, permission, granted, reason = "") {
    try {
      await this.registry.logEvent(
        pluginId,
        "permission_check",
        {
          permission,
          granted,
          reason,
          timestamp: Date.now(),
        },
        granted ? "info" : "warn",
      );
    } catch (error) {
      logger.error("[PermissionChecker] 记录权限检查日志失败:", error);
    }
  }

  /**
   * 获取所有可用的权限列表
   * @returns {Object} 权限列表（按分类）
   */
  getAllPermissions() {
    const permissions = {};

    for (const [category, perms] of Object.entries(this.permissionGroups)) {
      permissions[category] = perms.map((p) => ({
        name: p,
        level: this.permissionLevels[p] || 0,
        description: this.getPermissionDescription(p),
      }));
    }

    return permissions;
  }

  /**
   * 获取权限描述
   * @param {string} permission - 权限名称
   * @returns {string} 描述
   */
  getPermissionDescription(permission) {
    const descriptions = {
      "database:read": "读取数据库中的笔记和数据",
      "database:write": "写入或更新数据库中的数据",
      "database:delete": "删除数据库中的数据",
      "llm:query": "调用AI大模型进行查询",
      "llm:stream": "使用流式响应调用AI大模型",
      "ui:component": "注册自定义UI组件",
      "ui:page": "注册新的页面",
      "ui:menu": "注册菜单项",
      "ui:dialog": "显示对话框",
      "file:read": "读取文件内容",
      "file:write": "写入文件",
      "file:delete": "删除文件",
      "file:list": "列出目录内容",
      "network:http": "发起HTTP请求",
      "network:websocket": "建立WebSocket连接",
      "system:exec": "执行系统命令（高风险）",
      "system:clipboard": "访问剪贴板",
      "system:notification": "发送系统通知",
      "rag:search": "执行RAG检索搜索",
      "rag:embed": "生成文本嵌入向量",
      "storage:read": "读取插件存储",
      "storage:write": "写入插件存储",
      "storage:delete": "删除插件存储数据",
    };

    return descriptions[permission] || "未知权限";
  }
}

module.exports = PermissionChecker;
