/**
 * Keyboard Shortcuts System
 * 提供统一的键盘快捷键管理，支持作用域、禁用/启用、命令面板等
 */

class KeyboardShortcuts {
  constructor() {
    this.shortcuts = new Map(); // key -> handler
    this.scopes = new Map(); // scope -> Set of keys
    this.currentScope = "global";
    this.enabled = true;
    this.commandPaletteVisible = false;
    this.allCommands = [];

    // 绑定事件监听
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.init();
  }

  /**
   * 初始化
   */
  init() {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.handleKeyDown);
      console.log("[KeyboardShortcuts] Initialized");
    }
  }

  /**
   * 注册快捷键
   * @param {Object} options
   * @param {string} options.key - 快捷键组合 (e.g., 'Ctrl+S', 'Cmd+Shift+P')
   * @param {Function} options.handler - 处理函数
   * @param {string} options.description - 描述
   * @param {string} options.scope - 作用域 (默认: 'global')
   * @param {boolean} options.preventDefault - 是否阻止默认行为 (默认: true)
   */
  register({
    key,
    handler,
    description = "",
    scope = "global",
    preventDefault = true,
  }) {
    const normalizedKey = this.normalizeKey(key);

    // 保存快捷键
    this.shortcuts.set(normalizedKey, {
      handler,
      description,
      scope,
      preventDefault,
      key: normalizedKey,
    });

    // 添加到作用域
    if (!this.scopes.has(scope)) {
      this.scopes.set(scope, new Set());
    }
    this.scopes.get(scope).add(normalizedKey);

    // 添加到命令列表
    this.allCommands.push({
      key: normalizedKey,
      description,
      scope,
      handler,
    });

    console.log(
      `[KeyboardShortcuts] Registered: ${normalizedKey} in scope "${scope}"`,
    );
  }

  /**
   * 批量注册快捷键
   */
  registerMultiple(shortcuts) {
    shortcuts.forEach((shortcut) => this.register(shortcut));
  }

  /**
   * 注销快捷键
   */
  unregister(key) {
    const normalizedKey = this.normalizeKey(key);
    const shortcut = this.shortcuts.get(normalizedKey);

    if (shortcut) {
      // 从作用域中移除
      const scopeKeys = this.scopes.get(shortcut.scope);
      if (scopeKeys) {
        scopeKeys.delete(normalizedKey);
      }

      // 从快捷键映射中移除
      this.shortcuts.delete(normalizedKey);

      // 从命令列表中移除
      this.allCommands = this.allCommands.filter(
        (cmd) => cmd.key !== normalizedKey,
      );

      console.log(`[KeyboardShortcuts] Unregistered: ${normalizedKey}`);
    }
  }

  /**
   * 处理键盘事件
   */
  handleKeyDown(event) {
    if (!this.enabled) {return;}

    const key = this.getKeyFromEvent(event);
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      // 检查作用域
      if (shortcut.scope !== "global" && shortcut.scope !== this.currentScope) {
        return;
      }

      // 阻止默认行为
      if (shortcut.preventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }

      // 执行处理函数
      try {
        shortcut.handler(event);
      } catch (error) {
        console.error("[KeyboardShortcuts] Handler error:", error);
      }
    }
  }

  /**
   * 从事件对象获取标准化的键组合
   */
  getKeyFromEvent(event) {
    const parts = [];

    // 修饰键
    if (event.ctrlKey || event.metaKey) {parts.push("Ctrl");}
    if (event.altKey) {parts.push("Alt");}
    if (event.shiftKey) {parts.push("Shift");}

    // 主键
    let mainKey = event.key;

    // 特殊键映射
    const specialKeys = {
      " ": "Space",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Escape: "Esc",
    };

    mainKey = specialKeys[mainKey] || mainKey.toUpperCase();

    // 避免修饰键重复
    if (!["CONTROL", "ALT", "SHIFT", "META"].includes(mainKey)) {
      parts.push(mainKey);
    }

    return parts.join("+");
  }

  /**
   * 标准化快捷键字符串
   */
  normalizeKey(key) {
    // 将 Cmd 转换为 Ctrl (跨平台兼容)
    const normalized = key
      .replace(/Cmd/gi, "Ctrl")
      .replace(/Command/gi, "Ctrl")
      .split("+")
      .map((part) => part.trim())
      .map((part) => {
        // 首字母大写
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      });

    // 排序：Ctrl, Alt, Shift, 主键
    const order = { Ctrl: 1, Alt: 2, Shift: 3 };
    normalized.sort((a, b) => {
      const orderA = order[a] || 999;
      const orderB = order[b] || 999;
      return orderA - orderB;
    });

    return normalized.join("+");
  }

  /**
   * 设置当前作用域
   */
  setScope(scope) {
    this.currentScope = scope;
    console.log(`[KeyboardShortcuts] Scope changed to: ${scope}`);
  }

  /**
   * 启用/禁用快捷键
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[KeyboardShortcuts] ${enabled ? "Enabled" : "Disabled"}`);
  }

  /**
   * 显示命令面板
   */
  showCommandPalette() {
    this.commandPaletteVisible = true;

    // 触发自定义事件
    window.dispatchEvent(
      new CustomEvent("show-command-palette", {
        detail: { commands: this.getAllCommands() },
      }),
    );
  }

  /**
   * 隐藏命令面板
   */
  hideCommandPalette() {
    this.commandPaletteVisible = false;

    window.dispatchEvent(new CustomEvent("hide-command-palette"));
  }

  /**
   * 获取所有命令
   */
  getAllCommands() {
    return this.allCommands.map((cmd) => ({
      ...cmd,
      keyDisplay: this.formatKeyForDisplay(cmd.key),
    }));
  }

  /**
   * 格式化快捷键用于显示
   */
  formatKeyForDisplay(key) {
    // macOS 使用 ⌘ 符号
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

    if (isMac) {
      return key.replace("Ctrl", "⌘").replace("Alt", "⌥").replace("Shift", "⇧");
    }

    return key;
  }

  /**
   * 获取指定作用域的所有快捷键
   */
  getShortcutsByScope(scope) {
    return this.allCommands.filter((cmd) => cmd.scope === scope);
  }

  /**
   * 销毁
   */
  destroy() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.handleKeyDown);
    }

    this.shortcuts.clear();
    this.scopes.clear();
    this.allCommands = [];

    console.log("[KeyboardShortcuts] Destroyed");
  }
}

// 创建单例实例
const keyboardShortcuts = new KeyboardShortcuts();

// 注册默认快捷键
keyboardShortcuts.registerMultiple([
  // 全局快捷键
  {
    key: "Ctrl+S",
    description: "保存当前文件",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-save"));
    },
  },
  {
    key: "Ctrl+F",
    description: "在当前文件中查找",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-find"));
    },
  },
  {
    key: "Ctrl+Shift+F",
    description: "在项目中查找",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-find-in-project"));
    },
  },
  {
    key: "Ctrl+P",
    description: "打开命令面板",
    handler: () => {
      keyboardShortcuts.showCommandPalette();
    },
  },
  {
    key: "Ctrl+K",
    description: "打开命令面板",
    handler: () => {
      keyboardShortcuts.showCommandPalette();
    },
  },
  {
    key: "Ctrl+B",
    description: "切换侧边栏",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-toggle-sidebar"));
    },
  },
  {
    key: "Ctrl+`",
    description: "切换终端面板",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-toggle-terminal"));
    },
  },
  {
    key: "Ctrl+/",
    description: "切换注释",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-toggle-comment"));
    },
  },
  {
    key: "Ctrl+D",
    description: "复制当前行",
    scope: "editor",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-duplicate-line"));
    },
  },
  {
    key: "Ctrl+Shift+K",
    description: "删除当前行",
    scope: "editor",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-delete-line"));
    },
  },
  {
    key: "Alt+Up",
    description: "向上移动行",
    scope: "editor",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-move-line-up"));
    },
  },
  {
    key: "Alt+Down",
    description: "向下移动行",
    scope: "editor",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-move-line-down"));
    },
  },
  {
    key: "Ctrl+Z",
    description: "撤销",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-undo"));
    },
  },
  {
    key: "Ctrl+Shift+Z",
    description: "重做",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-redo"));
    },
  },
  {
    key: "Ctrl+N",
    description: "新建文件",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-new-file"));
    },
  },
  {
    key: "Ctrl+W",
    description: "关闭当前标签",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-close-tab"));
    },
  },
  {
    key: "Ctrl+Shift+T",
    description: "重新打开已关闭的标签",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-reopen-tab"));
    },
  },
  {
    key: "Ctrl+Tab",
    description: "切换到下一个标签",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-next-tab"));
    },
  },
  {
    key: "Ctrl+Shift+Tab",
    description: "切换到上一个标签",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-prev-tab"));
    },
  },
  // 数字键快速切换标签
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => ({
    key: `Alt+${num}`,
    description: `切换到第 ${num} 个标签`,
    handler: () => {
      window.dispatchEvent(
        new CustomEvent("shortcut-switch-tab", { detail: { index: num - 1 } }),
      );
    },
  })),
  {
    key: "Esc",
    description: "关闭弹窗/取消操作",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-escape"));
    },
  },
  {
    key: "F2",
    description: "重命名",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-rename"));
    },
  },
  {
    key: "Delete",
    description: "删除",
    handler: () => {
      window.dispatchEvent(new CustomEvent("shortcut-delete"));
    },
  },
]);

// ==================== 菜单导航命令 ====================
// 添加所有菜单项作为可搜索的命令

/**
 * 注册菜单导航命令
 * @param {Object} router - Vue Router 实例
 */
export function registerMenuCommands(router) {
  const menuCommands = [
    // 项目管理模块
    {
      key: "menu-project-categories",
      path: "/projects/categories",
      title: "项目分类",
      scope: "navigation",
      icon: "AppstoreOutlined",
    },
    {
      key: "menu-projects",
      path: "/projects",
      title: "我的项目",
      scope: "navigation",
      icon: "FolderOpenOutlined",
      shortcut: "Alt+1",
    },
    {
      key: "menu-project-list-management",
      path: "/projects/management",
      title: "项目列表管理",
      scope: "navigation",
      icon: "TableOutlined",
    },
    {
      key: "menu-workspace-management",
      path: "/projects/workspace",
      title: "工作区管理",
      scope: "navigation",
      icon: "ApartmentOutlined",
    },
    {
      key: "menu-template-management",
      path: "/template-management",
      title: "模板管理",
      scope: "navigation",
      icon: "TagsOutlined",
    },
    {
      key: "menu-project-market",
      path: "/projects/market",
      title: "项目市场",
      scope: "navigation",
      icon: "ShopOutlined",
    },
    {
      key: "menu-project-collaboration",
      path: "/projects/collaboration",
      title: "协作项目",
      scope: "navigation",
      icon: "TeamOutlined",
    },
    {
      key: "menu-project-archived",
      path: "/projects/archived",
      title: "已归档项目",
      scope: "navigation",
      icon: "InboxOutlined",
    },

    // 知识与AI模块
    {
      key: "menu-home",
      path: "/",
      title: "知识首页",
      scope: "navigation",
      icon: "HomeOutlined",
    },
    {
      key: "menu-knowledge-list",
      path: "/knowledge/list",
      title: "我的知识",
      scope: "navigation",
      icon: "FileTextOutlined",
      shortcut: "Alt+2",
    },
    {
      key: "menu-knowledge-graph",
      path: "/knowledge/graph",
      title: "知识图谱",
      scope: "navigation",
      icon: "NodeIndexOutlined",
    },
    {
      key: "menu-file-import",
      path: "/file-import",
      title: "文件导入",
      scope: "navigation",
      icon: "CloudUploadOutlined",
    },
    {
      key: "menu-image-upload",
      path: "/image-upload",
      title: "图片上传",
      scope: "navigation",
      icon: "FileImageOutlined",
    },
    {
      key: "menu-audio-import",
      path: "/audio/import",
      title: "音频导入",
      scope: "navigation",
      icon: "SoundOutlined",
    },
    {
      key: "menu-multimedia-demo",
      path: "/multimedia/demo",
      title: "多媒体处理",
      scope: "navigation",
      icon: "VideoCameraOutlined",
    },
    {
      key: "menu-prompt-templates",
      path: "/prompt-templates",
      title: "提示词模板",
      scope: "navigation",
      icon: "TagsOutlined",
    },
    {
      key: "menu-ai-chat",
      path: "/ai/chat",
      title: "AI对话",
      scope: "navigation",
      icon: "RobotOutlined",
      shortcut: "Alt+3",
    },
    {
      key: "menu-knowledge-store",
      path: "/knowledge-store",
      title: "知识付费",
      scope: "navigation",
      icon: "ShopOutlined",
    },
    {
      key: "menu-my-purchases",
      path: "/my-purchases",
      title: "我的购买",
      scope: "navigation",
      icon: "ShoppingCartOutlined",
    },

    // 身份与社交模块
    {
      key: "menu-did",
      path: "/did",
      title: "DID身份",
      scope: "navigation",
      icon: "IdcardOutlined",
      shortcut: "Alt+4",
    },
    {
      key: "menu-credentials",
      path: "/credentials",
      title: "可验证凭证",
      scope: "navigation",
      icon: "SafetyCertificateOutlined",
    },
    {
      key: "menu-contacts",
      path: "/contacts",
      title: "联系人",
      scope: "navigation",
      icon: "TeamOutlined",
    },
    {
      key: "menu-friends",
      path: "/friends",
      title: "好友管理",
      scope: "navigation",
      icon: "UserOutlined",
    },
    {
      key: "menu-posts",
      path: "/posts",
      title: "动态广场",
      scope: "navigation",
      icon: "CommentOutlined",
    },
    {
      key: "menu-p2p-messaging",
      path: "/p2p-messaging",
      title: "P2P加密消息",
      scope: "navigation",
      icon: "MessageOutlined",
    },

    // 交易系统模块
    {
      key: "menu-trading",
      path: "/trading",
      title: "交易中心",
      scope: "navigation",
      icon: "DashboardOutlined",
      shortcut: "Alt+5",
    },
    {
      key: "menu-marketplace",
      path: "/marketplace",
      title: "交易市场",
      scope: "navigation",
      icon: "ShopOutlined",
    },
    {
      key: "menu-contracts",
      path: "/contracts",
      title: "智能合约",
      scope: "navigation",
      icon: "AuditOutlined",
    },
    {
      key: "menu-credit-score",
      path: "/credit-score",
      title: "信用评分",
      scope: "navigation",
      icon: "StarOutlined",
    },
    {
      key: "menu-wallet",
      path: "/wallet",
      title: "钱包管理",
      scope: "navigation",
      icon: "WalletOutlined",
    },
    {
      key: "menu-bridge",
      path: "/bridge",
      title: "跨链桥",
      scope: "navigation",
      icon: "SwapOutlined",
    },

    // 开发工具模块
    {
      key: "menu-webide",
      path: "/webide",
      title: "Web IDE",
      scope: "navigation",
      icon: "CodeOutlined",
      shortcut: "Alt+6",
    },
    {
      key: "menu-design-editor",
      path: "/design/new",
      title: "设计编辑器",
      scope: "navigation",
      icon: "BgColorsOutlined",
    },

    // 内容聚合模块
    {
      key: "menu-rss-feeds",
      path: "/rss/feeds",
      title: "RSS订阅",
      scope: "navigation",
      icon: "ReadOutlined",
    },
    {
      key: "menu-email-accounts",
      path: "/email/accounts",
      title: "邮件管理",
      scope: "navigation",
      icon: "MailOutlined",
    },

    // 企业版模块
    {
      key: "menu-organizations",
      path: "/organizations",
      title: "组织管理",
      scope: "navigation",
      icon: "ApartmentOutlined",
      shortcut: "Alt+7",
    },
    {
      key: "menu-enterprise-dashboard",
      path: "/enterprise/dashboard",
      title: "企业仪表板",
      scope: "navigation",
      icon: "DashboardOutlined",
    },
    {
      key: "menu-permission-management",
      path: "/permissions",
      title: "权限管理",
      scope: "navigation",
      icon: "SafetyCertificateOutlined",
    },

    // 系统设置模块
    {
      key: "menu-system-settings",
      path: "/settings/system",
      title: "系统配置",
      scope: "navigation",
      icon: "SettingOutlined",
      shortcut: "Alt+8",
    },
    {
      key: "menu-settings",
      path: "/settings",
      title: "通用设置",
      scope: "navigation",
      icon: "SettingOutlined",
    },
    {
      key: "menu-plugin-management",
      path: "/settings/plugins",
      title: "插件管理",
      scope: "navigation",
      icon: "AppstoreOutlined",
    },
    {
      key: "menu-plugin-marketplace",
      path: "/plugins/marketplace",
      title: "插件市场",
      scope: "navigation",
      icon: "ShopOutlined",
    },
    {
      key: "menu-plugin-publisher",
      path: "/plugins/publisher",
      title: "插件发布",
      scope: "navigation",
      icon: "CloudUploadOutlined",
    },
    {
      key: "menu-skill-management",
      path: "/settings/skills",
      title: "技能管理",
      scope: "navigation",
      icon: "ThunderboltOutlined",
    },
    {
      key: "menu-tool-management",
      path: "/settings/tools",
      title: "工具管理",
      scope: "navigation",
      icon: "ToolOutlined",
    },
    {
      key: "menu-llm-settings",
      path: "/settings",
      title: "LLM配置",
      scope: "navigation",
      icon: "ApiOutlined",
      query: { tab: "llm" },
    },
    {
      key: "menu-rag-settings",
      path: "/settings",
      title: "RAG配置",
      scope: "navigation",
      icon: "DatabaseOutlined",
      query: { tab: "rag" },
    },
    {
      key: "menu-git-settings",
      path: "/settings",
      title: "Git同步",
      scope: "navigation",
      icon: "SyncOutlined",
      query: { tab: "git" },
    },
    {
      key: "menu-sync-conflicts",
      path: "/sync/conflicts",
      title: "同步冲突管理",
      scope: "navigation",
      icon: "ExclamationCircleOutlined",
    },
    {
      key: "menu-ukey-settings",
      path: "/settings",
      title: "UKey安全",
      scope: "navigation",
      icon: "SafetyOutlined",
      query: { tab: "ukey" },
    },
    {
      key: "menu-database-performance",
      path: "/database/performance",
      title: "数据库性能监控",
      scope: "navigation",
      icon: "DashboardOutlined",
    },
  ];

  // 注册所有菜单命令
  menuCommands.forEach((menu) => {
    keyboardShortcuts.register({
      key: menu.shortcut || menu.key,
      description: `打开 ${menu.title}`,
      scope: menu.scope,
      preventDefault: true,
      handler: () => {
        if (router) {
          if (menu.query) {
            router.push({ path: menu.path, query: menu.query });
          } else {
            router.push(menu.path);
          }
        }
      },
    });
  });

  console.log(
    `[KeyboardShortcuts] Registered ${menuCommands.length} menu commands`,
  );
}

export default keyboardShortcuts;

export { KeyboardShortcuts };
