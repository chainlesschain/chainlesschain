/**
 * PermissionDialogManager - 权限对话框管理器
 *
 * 职责：
 * - 管理权限请求和响应
 * - 协调主进程和渲染进程之间的权限授权流程
 * - 维护待处理的权限请求队列
 */

const { logger, createLogger } = require('../utils/logger.js');
const { BrowserWindow } = require("electron");
const EventEmitter = require("events");

/**
 * 权限风险等级定义
 */
const RISK_LEVELS = {
  low: {
    level: 1,
    color: "#52c41a", // 绿色
    label: "低风险",
    description: "基本功能权限，对系统安全影响较小",
  },
  medium: {
    level: 2,
    color: "#faad14", // 橙色
    label: "中等风险",
    description: "可能访问敏感数据或执行有影响的操作",
  },
  high: {
    level: 3,
    color: "#ff4d4f", // 红色
    label: "高风险",
    description: "可能修改或删除数据，需要谨慎授权",
  },
  dangerous: {
    level: 4,
    color: "#eb2f96", // 品红
    label: "危险",
    description: "可执行系统命令或访问网络，强烈建议仅授予可信插件",
  },
};

/**
 * 权限分类信息
 */
const PERMISSION_CATEGORIES = {
  database: {
    name: "数据库",
    icon: "DatabaseOutlined",
    description: "访问和操作本地数据库",
  },
  llm: {
    name: "AI模型",
    icon: "RobotOutlined",
    description: "调用AI大语言模型服务",
  },
  ui: {
    name: "界面扩展",
    icon: "LayoutOutlined",
    description: "注册UI组件和页面",
  },
  file: {
    name: "文件系统",
    icon: "FolderOutlined",
    description: "读写本地文件",
  },
  network: {
    name: "网络访问",
    icon: "GlobalOutlined",
    description: "发起网络请求",
  },
  system: {
    name: "系统功能",
    icon: "SettingOutlined",
    description: "执行系统级操作",
  },
  rag: {
    name: "知识检索",
    icon: "SearchOutlined",
    description: "使用RAG检索功能",
  },
  storage: {
    name: "插件存储",
    icon: "HddOutlined",
    description: "使用插件专属存储空间",
  },
};

/**
 * 权限详细信息
 */
const PERMISSION_DETAILS = {
  "database:read": {
    category: "database",
    name: "数据库读取",
    description: "读取数据库中的笔记和数据",
    risk: "low",
  },
  "database:write": {
    category: "database",
    name: "数据库写入",
    description: "写入或更新数据库中的数据",
    risk: "medium",
  },
  "database:delete": {
    category: "database",
    name: "数据库删除",
    description: "删除数据库中的数据",
    risk: "high",
  },
  "llm:query": {
    category: "llm",
    name: "LLM查询",
    description: "调用AI大模型进行查询",
    risk: "low",
  },
  "llm:stream": {
    category: "llm",
    name: "LLM流式响应",
    description: "使用流式响应调用AI大模型",
    risk: "low",
  },
  "ui:component": {
    category: "ui",
    name: "UI组件注册",
    description: "注册自定义UI组件",
    risk: "low",
  },
  "ui:page": {
    category: "ui",
    name: "页面注册",
    description: "注册新的页面",
    risk: "medium",
  },
  "ui:menu": {
    category: "ui",
    name: "菜单注册",
    description: "注册菜单项",
    risk: "low",
  },
  "ui:dialog": {
    category: "ui",
    name: "对话框显示",
    description: "显示对话框",
    risk: "low",
  },
  "file:read": {
    category: "file",
    name: "文件读取",
    description: "读取文件内容",
    risk: "medium",
  },
  "file:write": {
    category: "file",
    name: "文件写入",
    description: "写入文件",
    risk: "high",
  },
  "file:delete": {
    category: "file",
    name: "文件删除",
    description: "删除文件",
    risk: "high",
  },
  "file:list": {
    category: "file",
    name: "目录列表",
    description: "列出目录内容",
    risk: "low",
  },
  "network:http": {
    category: "network",
    name: "HTTP请求",
    description: "发起HTTP请求",
    risk: "medium",
  },
  "network:websocket": {
    category: "network",
    name: "WebSocket连接",
    description: "建立WebSocket连接",
    risk: "high",
  },
  "system:exec": {
    category: "system",
    name: "系统命令执行",
    description: "执行系统命令（高风险）",
    risk: "dangerous",
  },
  "system:clipboard": {
    category: "system",
    name: "剪贴板访问",
    description: "访问剪贴板",
    risk: "low",
  },
  "system:notification": {
    category: "system",
    name: "系统通知",
    description: "发送系统通知",
    risk: "low",
  },
  "rag:search": {
    category: "rag",
    name: "RAG搜索",
    description: "执行RAG检索搜索",
    risk: "low",
  },
  "rag:embed": {
    category: "rag",
    name: "文本嵌入",
    description: "生成文本嵌入向量",
    risk: "low",
  },
  "storage:read": {
    category: "storage",
    name: "存储读取",
    description: "读取插件存储",
    risk: "low",
  },
  "storage:write": {
    category: "storage",
    name: "存储写入",
    description: "写入插件存储",
    risk: "low",
  },
  "storage:delete": {
    category: "storage",
    name: "存储删除",
    description: "删除插件存储数据",
    risk: "medium",
  },
};

class PermissionDialogManager extends EventEmitter {
  constructor() {
    super();

    // 待处理的权限请求队列
    this.pendingRequests = new Map(); // requestId -> { manifest, resolve, reject }

    // 请求ID计数器
    this.requestIdCounter = 0;

    // 主窗口引用（用于发送事件）
    this.mainWindow = null;
  }

  /**
   * 设置主窗口引用
   * @param {BrowserWindow} window - 主窗口
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * 请求用户授权权限
   * @param {Object} manifest - 插件manifest
   * @returns {Promise<Object>} 授权结果 { granted: boolean, permissions: Object }
   */
  async requestPermissions(manifest) {
    const { permissions = [] } = manifest;

    if (permissions.length === 0) {
      return { granted: true, permissions: {} };
    }

    // 生成请求ID
    const requestId = `perm_${++this.requestIdCounter}_${Date.now()}`;

    // 准备权限详情信息
    const permissionDetails = this.getPermissionDetails(permissions);

    // 创建Promise用于等待用户响应
    return new Promise((resolve, reject) => {
      // 存储请求信息
      this.pendingRequests.set(requestId, {
        manifest,
        permissions,
        permissionDetails,
        resolve,
        reject,
        createdAt: Date.now(),
      });

      // 通知渲染进程显示对话框
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("plugin:permission-request", {
          requestId,
          plugin: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author || "未知",
            description: manifest.description || "",
            homepage: manifest.homepage || "",
          },
          permissions: permissionDetails,
          categories: PERMISSION_CATEGORIES,
          riskLevels: RISK_LEVELS,
        });
      } else {
        // 如果主窗口不可用，自动拒绝
        reject(new Error("主窗口不可用，无法显示权限对话框"));
        this.pendingRequests.delete(requestId);
      }

      // 设置超时（5分钟）
      setTimeout(
        () => {
          if (this.pendingRequests.has(requestId)) {
            const request = this.pendingRequests.get(requestId);
            this.pendingRequests.delete(requestId);
            request.reject(new Error("权限请求超时"));
          }
        },
        5 * 60 * 1000,
      );
    });
  }

  /**
   * 处理用户的权限响应
   * @param {string} requestId - 请求ID
   * @param {Object} response - 用户响应
   * @param {boolean} response.granted - 是否授权
   * @param {Object} response.permissions - 各权限的授权状态
   * @param {boolean} response.remember - 是否记住选择
   */
  handlePermissionResponse(requestId, response) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      logger.warn(`[PermissionDialogManager] 未找到权限请求: ${requestId}`);
      return { success: false, error: "权限请求不存在或已过期" };
    }

    // 从队列中移除
    this.pendingRequests.delete(requestId);

    // 解析响应
    const { granted, permissions = {}, remember = false } = response;

    if (granted) {
      // 用户同意授权
      request.resolve({
        granted: true,
        permissions,
        remember,
      });

      this.emit("permission-granted", {
        pluginId: request.manifest.id,
        permissions,
        remember,
      });
    } else {
      // 用户拒绝授权
      request.resolve({
        granted: false,
        permissions: {},
        remember,
      });

      this.emit("permission-denied", {
        pluginId: request.manifest.id,
      });
    }

    return { success: true };
  }

  /**
   * 取消权限请求
   * @param {string} requestId - 请求ID
   */
  cancelRequest(requestId) {
    const request = this.pendingRequests.get(requestId);

    if (request) {
      this.pendingRequests.delete(requestId);
      request.reject(new Error("用户取消了权限请求"));
    }
  }

  /**
   * 获取权限详情信息
   * @param {string[]} permissions - 权限列表
   * @returns {Object[]} 权限详情列表
   */
  getPermissionDetails(permissions) {
    return permissions.map((permission) => {
      const detail = PERMISSION_DETAILS[permission] || {
        category: "system",
        name: permission,
        description: "未知权限",
        risk: "medium",
      };

      const riskInfo = RISK_LEVELS[detail.risk] || RISK_LEVELS.medium;

      return {
        permission,
        ...detail,
        riskLevel: riskInfo.level,
        riskColor: riskInfo.color,
        riskLabel: riskInfo.label,
        riskDescription: riskInfo.description,
      };
    });
  }

  /**
   * 按分类分组权限
   * @param {Object[]} permissionDetails - 权限详情列表
   * @returns {Object} 按分类分组的权限
   */
  groupPermissionsByCategory(permissionDetails) {
    const grouped = {};

    for (const perm of permissionDetails) {
      const category = perm.category;
      if (!grouped[category]) {
        grouped[category] = {
          ...PERMISSION_CATEGORIES[category],
          category,
          permissions: [],
        };
      }
      grouped[category].permissions.push(perm);
    }

    // 按风险等级排序每个分类中的权限
    for (const category of Object.values(grouped)) {
      category.permissions.sort((a, b) => b.riskLevel - a.riskLevel);
    }

    return grouped;
  }

  /**
   * 获取所有权限分类
   * @returns {Object} 权限分类信息
   */
  getPermissionCategories() {
    return PERMISSION_CATEGORIES;
  }

  /**
   * 获取风险等级定义
   * @returns {Object} 风险等级信息
   */
  getRiskLevels() {
    return RISK_LEVELS;
  }

  /**
   * 清理所有待处理的请求
   */
  cleanup() {
    for (const [requestId, request] of this.pendingRequests) {
      request.reject(new Error("权限对话框管理器已关闭"));
    }
    this.pendingRequests.clear();
  }
}

// 单例实例
let instance = null;

/**
 * 获取PermissionDialogManager单例
 * @returns {PermissionDialogManager}
 */
function getPermissionDialogManager() {
  if (!instance) {
    instance = new PermissionDialogManager();
  }
  return instance;
}

module.exports = {
  PermissionDialogManager,
  getPermissionDialogManager,
  RISK_LEVELS,
  PERMISSION_CATEGORIES,
  PERMISSION_DETAILS,
};
