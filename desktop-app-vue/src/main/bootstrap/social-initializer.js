/**
 * 社交模块初始化器
 * 负责 DID、P2P、联系人、好友、组织等社交功能的初始化
 *
 * @module bootstrap/social-initializer
 */

const path = require("path");
const { app } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * 注册社交模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂
 */
function registerSocialInitializers(factory) {
  // ========================================
  // DID 管理器
  // ========================================
  factory.register({
    name: "didManager",
    dependsOn: ["database"],
    async init(context) {
      const DIDManager = require("../did/did-manager");
      const didManager = new DIDManager(context.database);
      await didManager.initialize();
      return didManager;
    },
  });

  // ========================================
  // P2P 管理器（后台初始化）
  // ========================================
  factory.register({
    name: "p2pManager",
    dependsOn: ["database"],
    async init(_context) {
      const P2PManager = require("../p2p/p2p-manager");
      const p2pManager = new P2PManager({
        port: 9000,
        enableMDNS: true,
        enableDHT: true,
        dataPath: path.join(app.getPath("userData"), "p2p"),
      });

      // P2P 初始化可能较慢，使用异步初始化 + 超时保护
      // 返回 p2pManager，稍后在后台完成完整初始化
      const P2P_INIT_TIMEOUT = 30000; // 30秒超时

      p2pManager._initPromise = Promise.race([
        p2pManager.initialize(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("P2P初始化超时")),
            P2P_INIT_TIMEOUT,
          ),
        ),
      ])
        .then((initialized) => {
          if (initialized) {
            logger.info("[Social] P2P管理器初始化成功");
          } else {
            logger.warn("[Social] P2P管理器未启用");
          }
          return initialized;
        })
        .catch((error) => {
          logger.error("[Social] P2P管理器初始化失败:", error.message);
          if (error.message.includes("超时")) {
            logger.warn("[Social] P2P初始化超时，可能是网络问题或配置错误");
          }
          return false;
        });

      return p2pManager;
    },
  });

  // ========================================
  // 联系人管理器
  // ========================================
  factory.register({
    name: "contactManager",
    dependsOn: ["database", "p2pManager", "didManager"],
    async init(context) {
      const ContactManager = require("../contacts/contact-manager");
      const contactManager = new ContactManager(
        context.database,
        context.p2pManager,
        context.didManager,
      );
      await contactManager.initialize();
      return contactManager;
    },
  });

  // ========================================
  // 好友管理器
  // ========================================
  factory.register({
    name: "friendManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    async init(context) {
      const { FriendManager } = require("../social/friend-manager");
      const friendManager = new FriendManager(
        context.database,
        context.didManager,
        context.p2pManager,
      );
      await friendManager.initialize();
      return friendManager;
    },
  });

  // ========================================
  // 动态管理器（帖子）
  // ========================================
  factory.register({
    name: "postManager",
    dependsOn: ["database", "didManager", "p2pManager", "friendManager"],
    async init(context) {
      const { PostManager } = require("../social/post-manager");
      const postManager = new PostManager(
        context.database,
        context.didManager,
        context.p2pManager,
        context.friendManager,
      );
      await postManager.initialize();

      // 设置到 P2P 管理器
      if (context.p2pManager) {
        context.p2pManager.setPostManager(postManager);
      }

      return postManager;
    },
  });

  // ========================================
  // 组织管理器（企业版）
  // ========================================
  factory.register({
    name: "organizationManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false, // Non-critical, app can run without organization features
    async init(context) {
      try {
        if (!context.database || !context.database.db) {
          throw new Error("Database not initialized or missing db instance");
        }

        const OrganizationManager = require("../organization/organization-manager");
        // BUGFIX: Pass the raw db object, not the DatabaseManager instance
        const manager = new OrganizationManager(
          context.database.db,
          context.didManager,
          context.p2pManager,
        );
        logger.info(
          "[Bootstrap] ✓ OrganizationManager initialized successfully",
        );
        return manager;
      } catch (error) {
        logger.error(
          "[Bootstrap] OrganizationManager initialization failed:",
          error,
        );
        // Return null to indicate initialization failure
        return null;
      }
    },
  });

  // ========================================
  // 协作管理器（企业版）
  // ========================================
  factory.register({
    name: "collaborationManager",
    dependsOn: ["organizationManager"],
    async init(context) {
      const {
        getCollaborationManager,
      } = require("../collaboration/collaboration-manager");
      const collaborationManager = getCollaborationManager();

      // 设置组织管理器引用，启用企业版权限检查
      if (context.organizationManager) {
        collaborationManager.setOrganizationManager(
          context.organizationManager,
        );
        logger.info("[Social] 协作管理器已集成组织权限系统");
      }

      return collaborationManager;
    },
  });

  // ========================================
  // P2P 同步引擎
  // ========================================
  factory.register({
    name: "syncEngine",
    dependsOn: ["database", "didManager", "p2pManager"],
    async init(context) {
      const P2PSyncEngine = require("../sync/p2p-sync-engine");
      const syncEngine = new P2PSyncEngine(
        context.database,
        context.didManager,
        context.p2pManager,
      );
      await syncEngine.initialize();
      return syncEngine;
    },
  });

  // ========================================
  // 可验证凭证管理器
  // ========================================
  factory.register({
    name: "vcManager",
    dependsOn: ["database", "didManager"],
    async init(context) {
      const { VCManager } = require("../vc/vc-manager");
      const vcManager = new VCManager(context.database, context.didManager);
      await vcManager.initialize();
      return vcManager;
    },
  });

  // ========================================
  // 可验证凭证模板管理器
  // ========================================
  factory.register({
    name: "vcTemplateManager",
    dependsOn: ["database"],
    async init(context) {
      const VCTemplateManager = require("../vc/vc-template-manager");
      const vcTemplateManager = new VCTemplateManager(context.database);
      await vcTemplateManager.initialize();
      return vcTemplateManager;
    },
  });

  // ========================================
  // 深链接处理器（企业版 DID 邀请链接）
  // ========================================
  factory.register({
    name: "deepLinkHandler",
    dependsOn: ["organizationManager"],
    async init(context) {
      const DeepLinkHandler = require("../system/deep-link-handler");
      const deepLinkHandler = new DeepLinkHandler(
        context.mainWindow,
        context.organizationManager,
      );
      deepLinkHandler.register(app);
      return deepLinkHandler;
    },
  });
}

/**
 * 设置 P2P 后台初始化完成后的回调
 * @param {Object} context - 包含所有初始化实例的上下文
 * @param {Function} setupEncryptionEvents - 设置加密消息事件的回调
 * @param {Function} initializeMobileBridge - 初始化移动端桥接的回调
 */
async function setupP2PPostInit(
  context,
  setupEncryptionEvents,
  initializeMobileBridge,
) {
  const { p2pManager, didManager, friendManager } = context;

  logger.info("[Social] ========================================");
  logger.info("[Social] setupP2PPostInit 开始执行");
  logger.info("[Social] p2pManager 存在:", !!p2pManager);
  logger.info(
    "[Social] p2pManager._initPromise 存在:",
    !!(p2pManager && p2pManager._initPromise),
  );
  logger.info(
    "[Social] initializeMobileBridge 回调存在:",
    !!initializeMobileBridge,
  );
  logger.info("[Social] ========================================");

  // 即使 p2pManager 不存在，也尝试初始化 MobileBridge
  if (!p2pManager) {
    logger.warn("[Social] ✗ P2P管理器不存在");
    if (initializeMobileBridge) {
      logger.info("[Social] 仍尝试初始化移动端桥接...");
      initializeMobileBridge().catch((error) => {
        logger.error("[Social] 移动端桥接初始化失败:", error);
      });
    }
    return;
  }

  if (!p2pManager._initPromise) {
    logger.warn("[Social] ✗ P2P管理器._initPromise 不存在");
    if (initializeMobileBridge) {
      logger.info("[Social] 仍尝试初始化移动端桥接...");
      initializeMobileBridge().catch((error) => {
        logger.error("[Social] 移动端桥接初始化失败:", error);
      });
    }
    return;
  }

  // 等待 P2P 初始化完成
  logger.info("[Social] 等待 P2P 初始化完成...");
  const initialized = await p2pManager._initPromise;
  logger.info("[Social] P2P 初始化结果:", initialized);

  if (!initialized) {
    logger.warn("[Social] ✗ P2P 初始化失败，但仍尝试初始化移动端桥接");
  } else {
    logger.info("[Social] ✓ P2P 初始化成功");
  }

  // 设置 P2P 加密消息事件监听
  if (setupEncryptionEvents && initialized) {
    setupEncryptionEvents();
  }

  // 初始化移动端桥接（即使 P2P 初始化失败也尝试）
  // MobileBridge 可以独立启动信令服务器
  if (initializeMobileBridge) {
    logger.info("[Social] 开始初始化移动端桥接...");
    initializeMobileBridge().catch((error) => {
      logger.error("[Social] 移动端桥接初始化失败:", error);
    });
  } else {
    logger.warn("[Social] ✗ initializeMobileBridge 回调未提供");
  }

  // 设置到 DID 管理器
  if (didManager) {
    didManager.setP2PManager(p2pManager);
    logger.info("[Social] P2P管理器已设置到DID管理器");

    // 启动自动重新发布 DID
    try {
      didManager.startAutoRepublish(24 * 60 * 60 * 1000);
      logger.info("[Social] DID 自动重新发布已启动");
    } catch (error) {
      logger.error("[Social] 启动 DID 自动重新发布失败:", error);
    }
  }

  // 设置好友管理器到 P2P 管理器
  if (friendManager) {
    p2pManager.setFriendManager(friendManager);
    logger.info("[Social] 好友管理器已设置到 P2P 管理器");
  }
}

module.exports = {
  registerSocialInitializers,
  setupP2PPostInit,
};
