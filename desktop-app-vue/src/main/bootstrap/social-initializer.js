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
    async init(context) {
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
          setTimeout(() => reject(new Error('P2P初始化超时')), P2P_INIT_TIMEOUT)
        )
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
          if (error.message.includes('超时')) {
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
    async init(context) {
      const OrganizationManager = require("../organization/organization-manager");
      return new OrganizationManager(
        context.database,
        context.didManager,
        context.p2pManager,
      );
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

  if (!p2pManager || !p2pManager._initPromise) {
    return;
  }

  // 等待 P2P 初始化完成
  const initialized = await p2pManager._initPromise;
  if (!initialized) {
    return;
  }

  // 设置 P2P 加密消息事件监听
  if (setupEncryptionEvents) {
    setupEncryptionEvents();
  }

  // 初始化移动端桥接
  if (initializeMobileBridge) {
    initializeMobileBridge().catch((error) => {
      logger.error("[Social] 移动端桥接初始化失败:", error);
    });
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
