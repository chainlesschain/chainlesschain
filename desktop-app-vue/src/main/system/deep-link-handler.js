/**
 * Deep Link Handler - 处理 chainlesschain:// 协议链接
 *
 * 功能:
 * - 注册自定义协议
 * - 解析邀请链接
 * - 触发邀请接受流程
 * - 处理其他深链接场景
 */

const { logger } = require("../utils/logger.js");
const { URL } = require("url");

class DeepLinkHandler {
  constructor(mainWindow, organizationManager) {
    this.mainWindow = mainWindow;
    this.organizationManager = organizationManager;
    this.pendingInvitation = null;
  }

  /**
   * 注册协议处理器
   * @param {Electron.App} app - Electron app实例
   */
  register(app) {
    // 设置为默认协议客户端
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("chainlesschain", process.execPath, [
          process.argv[1],
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient("chainlesschain");
    }

    // macOS: 处理 open-url 事件
    app.on("open-url", (event, url) => {
      event.preventDefault();
      this.handleDeepLink(url);
    });

    // Windows/Linux: 处理 second-instance 事件
    app.on("second-instance", (event, commandLine) => {
      // 在命令行参数中查找协议URL
      const url = commandLine.find((arg) =>
        arg.startsWith("chainlesschain://"),
      );
      if (url) {
        this.handleDeepLink(url);
      }

      // 聚焦主窗口
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) {
          this.mainWindow.restore();
        }
        this.mainWindow.focus();
      }
    });

    logger.info("[DeepLinkHandler] ✓ 协议处理器已注册");
  }

  /**
   * 处理深链接
   * @param {string} urlString - 深链接URL
   */
  async handleDeepLink(urlString) {
    logger.info("[DeepLinkHandler] 处理深链接:", urlString);

    try {
      const url = new URL(urlString);

      // 验证协议
      if (url.protocol !== "chainlesschain:") {
        logger.warn("[DeepLinkHandler] 无效的协议:", url.protocol);
        return;
      }

      // 根据路径分发处理
      const path = url.pathname.replace(/^\/\//, "");
      const parts = path.split("/");

      switch (parts[0]) {
        case "invite":
          await this.handleInvitationLink(parts[1]);
          break;
        case "did":
          await this.handleDIDLink(parts[1]);
          break;
        case "knowledge":
          await this.handleKnowledgeLink(parts[1]);
          break;
        case "notes":
          await this.handleNotesLink(parts[1], url.searchParams);
          break;
        case "clip":
          await this.handleClipLink(parts[1], url.searchParams);
          break;
        case "":
        case undefined:
          // 空路径：只聚焦应用
          await this.focusMainWindow();
          break;
        default:
          logger.warn("[DeepLinkHandler] 未知的深链接类型:", parts[0]);
          // 尝试作为通用导航处理
          await this.handleGenericNavigation(path, url.searchParams);
      }
    } catch (error) {
      logger.error("[DeepLinkHandler] 处理深链接失败:", error);
    }
  }

  /**
   * 处理邀请链接
   * @param {string} token - 邀请令牌
   */
  async handleInvitationLink(token) {
    if (!token) {
      logger.warn("[DeepLinkHandler] 邀请令牌为空");
      return;
    }

    logger.info("[DeepLinkHandler] 处理邀请链接");

    // 确保主窗口已创建
    if (!this.mainWindow) {
      logger.warn("[DeepLinkHandler] 主窗口未创建，保存待处理邀请");
      this.pendingInvitation = token;
      return;
    }

    // 聚焦主窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送事件到渲染进程
    this.mainWindow.webContents.send("deep-link:invitation", token);
  }

  /**
   * 处理DID链接
   * @param {string} did - DID标识符
   */
  async handleDIDLink(did) {
    if (!did) {
      logger.warn("[DeepLinkHandler] DID为空");
      return;
    }

    logger.info("[DeepLinkHandler] 处理DID链接:", did);

    if (!this.mainWindow) {
      return;
    }

    // 聚焦主窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送事件到渲染进程
    this.mainWindow.webContents.send("deep-link:did", did);
  }

  /**
   * 处理知识库链接
   * @param {string} knowledgeId - 知识库ID
   */
  async handleKnowledgeLink(knowledgeId) {
    if (!knowledgeId) {
      logger.warn("[DeepLinkHandler] 知识库ID为空");
      return;
    }

    logger.info("[DeepLinkHandler] 处理知识库链接:", knowledgeId);

    if (!this.mainWindow) {
      return;
    }

    // 聚焦主窗口
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    // 发送事件到渲染进程
    this.mainWindow.webContents.send("deep-link:knowledge", knowledgeId);
  }

  /**
   * 处理笔记链接
   * @param {string} noteId - 笔记ID
   * @param {URLSearchParams} params - URL参数
   */
  async handleNotesLink(noteId, params) {
    logger.info("[DeepLinkHandler] 处理笔记链接:", noteId);

    await this.focusMainWindow();

    if (!this.mainWindow) {
      return;
    }

    // 发送事件到渲染进程，导航到笔记页面
    this.mainWindow.webContents.send("deep-link:navigate", {
      route: noteId ? `/notes/${noteId}` : "/notes",
      params: Object.fromEntries(params || []),
    });
  }

  /**
   * 处理剪藏链接（来自浏览器扩展）
   * @param {string} clipId - 剪藏ID
   * @param {URLSearchParams} params - URL参数
   */
  async handleClipLink(clipId, params) {
    logger.info("[DeepLinkHandler] 处理剪藏链接:", clipId);

    await this.focusMainWindow();

    if (!this.mainWindow) {
      return;
    }

    // 发送事件到渲染进程
    this.mainWindow.webContents.send("deep-link:clip", {
      clipId,
      action: params?.get("action") || "view",
    });
  }

  /**
   * 处理通用导航链接
   * @param {string} path - 路径
   * @param {URLSearchParams} params - URL参数
   */
  async handleGenericNavigation(path, params) {
    logger.info("[DeepLinkHandler] 处理通用导航:", path);

    await this.focusMainWindow();

    if (!this.mainWindow) {
      return;
    }

    // 发送导航事件
    this.mainWindow.webContents.send("deep-link:navigate", {
      route: "/" + path,
      params: Object.fromEntries(params || []),
    });
  }

  /**
   * 聚焦主窗口
   */
  async focusMainWindow() {
    if (!this.mainWindow) {
      logger.warn("[DeepLinkHandler] 主窗口未创建");
      return;
    }

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  /**
   * 设置主窗口引用
   * @param {Electron.BrowserWindow} mainWindow - 主窗口实例
   */
  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;

    // 如果有待处理的邀请，立即处理
    if (this.pendingInvitation) {
      const token = this.pendingInvitation;
      this.pendingInvitation = null;
      this.handleInvitationLink(token);
    }
  }

  /**
   * 处理启动时的协议URL (Windows/Linux)
   * @param {string[]} argv - 命令行参数
   */
  handleStartupUrl(argv) {
    // 在命令行参数中查找协议URL
    const url = argv.find((arg) => arg.startsWith("chainlesschain://"));
    if (url) {
      // 延迟处理，等待应用完全启动
      setTimeout(() => {
        this.handleDeepLink(url);
      }, 1000);
    }
  }
}

module.exports = DeepLinkHandler;
