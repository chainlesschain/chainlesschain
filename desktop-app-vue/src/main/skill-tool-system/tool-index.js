const { logger } = require("../utils/logger.js");

/**
 * 工具索引系统
 * 提供O(1)时间复杂度的工具查找
 *
 * 索引类型：
 * - byId: 通过工具ID查找
 * - byName: 通过工具名称查找
 * - byCategory: 通过类别获取工具列表
 * - byPermission: 通过权限获取工具列表
 * - byRiskLevel: 通过风险级别获取工具列表
 */

class ToolIndex {
  constructor(toolsArray) {
    if (!Array.isArray(toolsArray)) {
      throw new Error("ToolIndex requires an array of tools");
    }

    this.tools = toolsArray;
    this.byId = new Map();
    this.byName = new Map();
    this.byCategory = new Map();
    this.byPermission = new Map();
    this.byRiskLevel = new Map();

    this._buildIndexes();
  }

  /**
   * 构建所有索引
   * @private
   */
  _buildIndexes() {
    this.tools.forEach((tool) => {
      if (!tool.id || !tool.name) {
        logger.warn("Tool missing id or name:", tool);
        return;
      }

      // ID索引
      this.byId.set(tool.id, tool);

      // Name索引
      this.byName.set(tool.name, tool);

      // Category索引
      if (tool.category) {
        if (!this.byCategory.has(tool.category)) {
          this.byCategory.set(tool.category, []);
        }
        this.byCategory.get(tool.category).push(tool);
      }

      // Permission索引（倒排索引）
      if (Array.isArray(tool.required_permissions)) {
        tool.required_permissions.forEach((perm) => {
          if (!this.byPermission.has(perm)) {
            this.byPermission.set(perm, new Set());
          }
          this.byPermission.get(perm).add(tool.id);
        });
      }

      // Risk Level索引
      const riskLevel = tool.risk_level || 1;
      if (!this.byRiskLevel.has(riskLevel)) {
        this.byRiskLevel.set(riskLevel, []);
      }
      this.byRiskLevel.get(riskLevel).push(tool);
    });
  }

  /**
   * 通过ID获取工具
   * @param {string} id - 工具ID
   * @returns {Object|undefined} 工具对象
   */
  getById(id) {
    return this.byId.get(id);
  }

  /**
   * 通过名称获取工具
   * @param {string} name - 工具名称
   * @returns {Object|undefined} 工具对象
   */
  getByName(name) {
    return this.byName.get(name);
  }

  /**
   * 通过类别获取工具列表
   * @param {string} category - 类别名称
   * @returns {Array} 工具对象数组
   */
  getByCategory(category) {
    return this.byCategory.get(category) || [];
  }

  /**
   * 通过权限获取工具列表
   * @param {string} permission - 权限名称
   * @returns {Array} 工具对象数组
   */
  getByPermission(permission) {
    const ids = this.byPermission.get(permission);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.byId.get(id))
      .filter(Boolean);
  }

  /**
   * 通过风险级别获取工具列表
   * @param {number} level - 风险级别 (1-5)
   * @returns {Array} 工具对象数组
   */
  getByRiskLevel(level) {
    return this.byRiskLevel.get(level) || [];
  }

  /**
   * 获取所有类别
   * @returns {Array<string>} 类别名称数组
   */
  getAllCategories() {
    return Array.from(this.byCategory.keys()).sort();
  }

  /**
   * 获取所有权限类型
   * @returns {Array<string>} 权限名称数组
   */
  getAllPermissions() {
    return Array.from(this.byPermission.keys()).sort();
  }

  /**
   * 获取所有风险级别
   * @returns {Array<number>} 风险级别数组
   */
  getAllRiskLevels() {
    return Array.from(this.byRiskLevel.keys()).sort((a, b) => a - b);
  }

  /**
   * 多条件查询
   * @param {Object} filters - 过滤条件
   * @param {string} [filters.category] - 类别
   * @param {number} [filters.riskLevel] - 风险级别
   * @param {Array<string>} [filters.permissions] - 需要的权限（AND）
   * @param {boolean} [filters.enabled] - 是否启用
   * @returns {Array} 符合条件的工具数组
   */
  query(filters = {}) {
    let results = this.tools;

    // 按类别过滤
    if (filters.category) {
      results = results.filter((t) => t.category === filters.category);
    }

    // 按风险级别过滤
    if (filters.riskLevel !== undefined) {
      results = results.filter(
        (t) => (t.risk_level || 1) === filters.riskLevel,
      );
    }

    // 按权限过滤（工具必须包含所有指定权限）
    if (Array.isArray(filters.permissions) && filters.permissions.length > 0) {
      results = results.filter((t) => {
        if (!Array.isArray(t.required_permissions)) {
          return false;
        }
        return filters.permissions.every((perm) =>
          t.required_permissions.includes(perm),
        );
      });
    }

    // 按启用状态过滤
    if (filters.enabled !== undefined) {
      results = results.filter((t) => t.enabled === filters.enabled);
    }

    return results;
  }

  /**
   * 搜索工具（支持模糊匹配）
   * @param {string} keyword - 搜索关键词
   * @param {Array<string>} fields - 搜索字段 ['name', 'display_name', 'description']
   * @returns {Array} 匹配的工具数组
   */
  search(keyword, fields = ["name", "display_name", "description"]) {
    if (!keyword) {
      return [];
    }

    const lowerKeyword = keyword.toLowerCase();
    return this.tools.filter((tool) => {
      return fields.some((field) => {
        const value = tool[field];
        if (!value) {
          return false;
        }
        return value.toLowerCase().includes(lowerKeyword);
      });
    });
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    const stats = {
      totalTools: this.tools.length,
      categoriesCount: this.byCategory.size,
      permissionsCount: this.byPermission.size,
      riskLevelsCount: this.byRiskLevel.size,
      byCategory: {},
      byRiskLevel: {},
      topPermissions: [],
    };

    // 按类别统计
    this.byCategory.forEach((tools, category) => {
      stats.byCategory[category] = tools.length;
    });

    // 按风险级别统计
    this.byRiskLevel.forEach((tools, level) => {
      stats.byRiskLevel[level] = tools.length;
    });

    // 权限使用排行
    const permCounts = [];
    this.byPermission.forEach((toolIds, perm) => {
      permCounts.push({ permission: perm, count: toolIds.size });
    });
    stats.topPermissions = permCounts
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return stats;
  }

  /**
   * 检查索引健康状态
   * @returns {Object} 健康检查结果
   */
  healthCheck() {
    const issues = [];

    // 检查是否有工具缺少ID
    const toolsWithoutId = this.tools.filter((t) => !t.id);
    if (toolsWithoutId.length > 0) {
      issues.push(`${toolsWithoutId.length} tools missing id`);
    }

    // 检查是否有工具缺少name
    const toolsWithoutName = this.tools.filter((t) => !t.name);
    if (toolsWithoutName.length > 0) {
      issues.push(`${toolsWithoutName.length} tools missing name`);
    }

    // 检查是否有工具缺少category
    const toolsWithoutCategory = this.tools.filter((t) => !t.category);
    if (toolsWithoutCategory.length > 0) {
      issues.push(`${toolsWithoutCategory.length} tools missing category`);
    }

    // 检查索引大小是否一致
    if (this.byId.size !== this.tools.length) {
      issues.push(
        `ID index size mismatch: ${this.byId.size} vs ${this.tools.length}`,
      );
    }

    return {
      healthy: issues.length === 0,
      issues: issues,
      indexSizes: {
        byId: this.byId.size,
        byName: this.byName.size,
        byCategory: this.byCategory.size,
        byPermission: this.byPermission.size,
        byRiskLevel: this.byRiskLevel.size,
      },
    };
  }
}

// 单例实例
let indexInstance = null;

/**
 * 获取工具索引实例（单例模式）
 * @returns {ToolIndex} 工具索引实例
 */
function getToolIndex() {
  if (!indexInstance) {
    const tools = require("./builtin-tools");
    indexInstance = new ToolIndex(tools);
  }
  return indexInstance;
}

/**
 * 重置索引实例（主要用于测试）
 */
function resetToolIndex() {
  indexInstance = null;
}

module.exports = {
  ToolIndex,
  getToolIndex,
  resetToolIndex,
};
