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

  // ========================================
  // v0.39.0 — 通话管理器（语音/视频通话）
  // ========================================
  factory.register({
    name: "callManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { CallManager } = require("../p2p/call-manager");
        const callManager = new CallManager(
          context.database,
          context.didManager,
          context.p2pManager,
        );
        await callManager.initialize();
        logger.info("[Social] ✓ CallManager initialized");
        return callManager;
      } catch (error) {
        logger.error("[Social] CallManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.39.0 — 通话信令
  // ========================================
  factory.register({
    name: "callSignaling",
    dependsOn: ["p2pManager"],
    required: false,
    async init(context) {
      try {
        const { CallSignaling } = require("../p2p/call-signaling");
        const callSignaling = new CallSignaling(context.p2pManager);
        await callSignaling.initialize();
        logger.info("[Social] ✓ CallSignaling initialized");
        return callSignaling;
      } catch (error) {
        logger.error("[Social] CallSignaling initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.39.0 — 媒体引擎
  // ========================================
  factory.register({
    name: "mediaEngine",
    dependsOn: [],
    required: false,
    async init(_context) {
      try {
        const { MediaEngine } = require("../p2p/media-engine");
        const mediaEngine = new MediaEngine();
        logger.info("[Social] ✓ MediaEngine initialized");
        return mediaEngine;
      } catch (error) {
        logger.error("[Social] MediaEngine initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.39.0 — SFU 中继
  // ========================================
  factory.register({
    name: "sfuRelay",
    dependsOn: [],
    required: false,
    async init(_context) {
      try {
        const { SFURelay } = require("../p2p/sfu-relay");
        const sfuRelay = new SFURelay();
        logger.info("[Social] ✓ SFURelay initialized");
        return sfuRelay;
      } catch (error) {
        logger.error("[Social] SFURelay initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.40.0 — 共享相册管理器
  // ========================================
  factory.register({
    name: "sharedAlbumManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { SharedAlbumManager } = require("../social/shared-album-manager");
        const sharedAlbumManager = new SharedAlbumManager(
          context.database,
          context.didManager,
          context.p2pManager,
        );
        await sharedAlbumManager.initialize();
        logger.info("[Social] ✓ SharedAlbumManager initialized");
        return sharedAlbumManager;
      } catch (error) {
        logger.error("[Social] SharedAlbumManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.40.0 — 照片加密器
  // ========================================
  factory.register({
    name: "photoEncryptor",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { PhotoEncryptor } = require("../social/photo-encryptor");
        const photoEncryptor = new PhotoEncryptor(context.database);
        await photoEncryptor.initialize();
        logger.info("[Social] ✓ PhotoEncryptor initialized");
        return photoEncryptor;
      } catch (error) {
        logger.error("[Social] PhotoEncryptor initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.40.0 — 照片同步引擎
  // ========================================
  factory.register({
    name: "photoSync",
    dependsOn: ["database", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { PhotoSync } = require("../social/photo-sync");
        const photoSync = new PhotoSync(context.database, context.p2pManager);
        await photoSync.initialize();
        logger.info("[Social] ✓ PhotoSync initialized");
        return photoSync;
      } catch (error) {
        logger.error("[Social] PhotoSync initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.40.0 — EXIF 剥离器
  // ========================================
  factory.register({
    name: "exifStripper",
    dependsOn: [],
    required: false,
    async init(_context) {
      try {
        const { ExifStripper } = require("../social/exif-stripper");
        const exifStripper = new ExifStripper();
        logger.info("[Social] ✓ ExifStripper initialized");
        return exifStripper;
      } catch (error) {
        logger.error("[Social] ExifStripper initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.41.0 — 社交协作编辑引擎
  // ========================================
  factory.register({
    name: "collabEngine",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { CollabEngine } = require("../social/collab-engine");
        const collabEngine = new CollabEngine(
          context.database,
          context.didManager,
          context.p2pManager,
        );
        await collabEngine.initialize();
        logger.info("[Social] ✓ CollabEngine initialized");
        return collabEngine;
      } catch (error) {
        logger.error("[Social] CollabEngine initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.41.0 — 协作文档同步
  // ========================================
  factory.register({
    name: "collabSync",
    dependsOn: ["p2pManager"],
    required: false,
    async init(context) {
      try {
        const { CollabSync } = require("../social/collab-sync");
        const collabSync = new CollabSync(context.p2pManager);
        await collabSync.initialize();
        logger.info("[Social] ✓ CollabSync initialized");
        return collabSync;
      } catch (error) {
        logger.error("[Social] CollabSync initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.41.0 — 协作感知（光标/选区）
  // ========================================
  factory.register({
    name: "collabAwareness",
    dependsOn: ["p2pManager"],
    required: false,
    async init(context) {
      try {
        const { CollabAwareness } = require("../social/collab-awareness");
        const collabAwareness = new CollabAwareness(context.p2pManager);
        await collabAwareness.initialize();
        logger.info("[Social] ✓ CollabAwareness initialized");
        return collabAwareness;
      } catch (error) {
        logger.error("[Social] CollabAwareness initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.41.0 — 文档版本管理
  // ========================================
  factory.register({
    name: "docVersionManager",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { DocVersionManager } = require("../social/doc-version-manager");
        const docVersionManager = new DocVersionManager(context.database);
        await docVersionManager.initialize();
        logger.info("[Social] ✓ DocVersionManager initialized");
        return docVersionManager;
      } catch (error) {
        logger.error("[Social] DocVersionManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.42.0 — 社区管理器
  // ========================================
  factory.register({
    name: "communityManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { CommunityManager } = require("../social/community-manager");
        const communityManager = new CommunityManager(
          context.database,
          context.didManager,
          context.p2pManager,
        );
        await communityManager.initialize();
        logger.info("[Social] ✓ CommunityManager initialized");
        return communityManager;
      } catch (error) {
        logger.error("[Social] CommunityManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.42.0 — 频道管理器
  // ========================================
  factory.register({
    name: "channelManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { ChannelManager } = require("../social/channel-manager");
        const channelManager = new ChannelManager(
          context.database,
          context.didManager,
          context.p2pManager,
        );
        await channelManager.initialize();
        logger.info("[Social] ✓ ChannelManager initialized");
        return channelManager;
      } catch (error) {
        logger.error("[Social] ChannelManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.42.0 — 治理引擎
  // ========================================
  factory.register({
    name: "governanceEngine",
    dependsOn: ["database", "communityManager"],
    required: false,
    async init(context) {
      try {
        const { GovernanceEngine } = require("../social/governance-engine");
        const governanceEngine = new GovernanceEngine(
          context.database,
          context.communityManager,
        );
        await governanceEngine.initialize();
        logger.info("[Social] ✓ GovernanceEngine initialized");
        return governanceEngine;
      } catch (error) {
        logger.error("[Social] GovernanceEngine initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.42.0 — Gossip 协议
  // ========================================
  factory.register({
    name: "gossipProtocol",
    dependsOn: ["p2pManager"],
    required: false,
    async init(context) {
      try {
        const { GossipProtocol } = require("../social/gossip-protocol");
        const gossipProtocol = new GossipProtocol(context.p2pManager);
        await gossipProtocol.initialize();
        logger.info("[Social] ✓ GossipProtocol initialized");
        return gossipProtocol;
      } catch (error) {
        logger.error("[Social] GossipProtocol initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.42.0 — 内容审核
  // ========================================
  factory.register({
    name: "contentModerator",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { ContentModerator } = require("../social/content-moderator");
        const contentModerator = new ContentModerator(context.database);
        await contentModerator.initialize();
        logger.info("[Social] ✓ ContentModerator initialized");
        return contentModerator;
      } catch (error) {
        logger.error("[Social] ContentModerator initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.43.0 — 时光机
  // ========================================
  factory.register({
    name: "timeMachine",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { TimeMachine } = require("../social/time-machine");
        const timeMachine = new TimeMachine(context.database);
        await timeMachine.initialize();
        logger.info("[Social] ✓ TimeMachine initialized");
        return timeMachine;
      } catch (error) {
        logger.error("[Social] TimeMachine initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.43.0 — 回忆生成器
  // ========================================
  factory.register({
    name: "memoryGenerator",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { MemoryGenerator } = require("../social/memory-generator");
        const memoryGenerator = new MemoryGenerator(context.database, null);
        await memoryGenerator.initialize();
        logger.info("[Social] ✓ MemoryGenerator initialized");
        return memoryGenerator;
      } catch (error) {
        logger.error("[Social] MemoryGenerator initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.43.0 — 情感分析
  // ========================================
  factory.register({
    name: "sentimentAnalyzer",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { SentimentAnalyzer } = require("../social/sentiment-analyzer");
        const sentimentAnalyzer = new SentimentAnalyzer(context.database);
        await sentimentAnalyzer.initialize();
        logger.info("[Social] ✓ SentimentAnalyzer initialized");
        return sentimentAnalyzer;
      } catch (error) {
        logger.error("[Social] SentimentAnalyzer initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.43.0 — 社交统计
  // ========================================
  factory.register({
    name: "socialStats",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { SocialStats } = require("../social/social-stats");
        const socialStats = new SocialStats(context.database);
        await socialStats.initialize();
        logger.info("[Social] ✓ SocialStats initialized");
        return socialStats;
      } catch (error) {
        logger.error("[Social] SocialStats initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.44.0 — 直播管理器
  // ========================================
  factory.register({
    name: "livestreamManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { LivestreamManager } = require("../social/livestream-manager");
        const livestreamManager = new LivestreamManager(
          context.database,
          context.didManager,
          context.p2pManager,
        );
        await livestreamManager.initialize();
        logger.info("[Social] ✓ LivestreamManager initialized");
        return livestreamManager;
      } catch (error) {
        logger.error("[Social] LivestreamManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.44.0 — 弹幕引擎
  // ========================================
  factory.register({
    name: "danmakuEngine",
    dependsOn: ["database", "p2pManager"],
    required: false,
    async init(context) {
      try {
        const { DanmakuEngine } = require("../social/danmaku-engine");
        const danmakuEngine = new DanmakuEngine(
          context.database,
          context.p2pManager,
        );
        await danmakuEngine.initialize();
        logger.info("[Social] ✓ DanmakuEngine initialized");
        return danmakuEngine;
      } catch (error) {
        logger.error("[Social] DanmakuEngine initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.45.0+ — 匿名模式
  // ========================================
  factory.register({
    name: "anonymousMode",
    dependsOn: ["database", "didManager"],
    required: false,
    async init(context) {
      try {
        const { AnonymousMode } = require("../social/anonymous-mode");
        const anonymousMode = new AnonymousMode(context.database, context.didManager);
        await anonymousMode.initialize();
        logger.info("[Social] ✓ AnonymousMode initialized");
        return anonymousMode;
      } catch (error) {
        logger.error("[Social] AnonymousMode initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.45.0+ — 平台桥接
  // ========================================
  factory.register({
    name: "platformBridge",
    dependsOn: ["database", "didManager"],
    required: false,
    async init(context) {
      try {
        const { PlatformBridge } = require("../social/platform-bridge");
        const platformBridge = new PlatformBridge(context.database, context.didManager);
        await platformBridge.initialize();
        logger.info("[Social] ✓ PlatformBridge initialized");
        return platformBridge;
      } catch (error) {
        logger.error("[Social] PlatformBridge initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.45.0+ — 社交代币
  // ========================================
  factory.register({
    name: "socialToken",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { SocialTokenManager } = require("../social/social-token");
        const socialToken = new SocialTokenManager(context.database);
        await socialToken.initialize();
        logger.info("[Social] ✓ SocialTokenManager initialized");
        return socialToken;
      } catch (error) {
        logger.error("[Social] SocialTokenManager initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.45.0+ — AI 社交助手
  // ========================================
  factory.register({
    name: "aiSocialAssistant",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { AISocialAssistant } = require("../social/ai-social-assistant");
        const aiSocialAssistant = new AISocialAssistant(context.database, null);
        await aiSocialAssistant.initialize();
        logger.info("[Social] ✓ AISocialAssistant initialized");
        return aiSocialAssistant;
      } catch (error) {
        logger.error("[Social] AISocialAssistant initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.45.0+ — 存储市场
  // ========================================
  factory.register({
    name: "storageMarket",
    dependsOn: ["database"],
    required: false,
    async init(context) {
      try {
        const { StorageMarket } = require("../social/storage-market");
        const storageMarket = new StorageMarket(context.database);
        await storageMarket.initialize();
        logger.info("[Social] ✓ StorageMarket initialized");
        return storageMarket;
      } catch (error) {
        logger.error("[Social] StorageMarket initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // v0.45.0+ — Mesh 社交
  // ========================================
  factory.register({
    name: "meshSocial",
    dependsOn: [],
    required: false,
    async init(_context) {
      try {
        const { MeshSocial } = require("../social/mesh-social");
        const meshSocial = new MeshSocial();
        await meshSocial.initialize();
        logger.info("[Social] ✓ MeshSocial initialized");
        return meshSocial;
      } catch (error) {
        logger.error("[Social] MeshSocial initialization failed:", error.message);
        return null;
      }
    },
  });

  // ========================================
  // 远程网关（浏览器扩展服务器、远程控制）
  // ========================================
  factory.register({
    name: "remoteGateway",
    dependsOn: ["database", "didManager", "p2pManager", "ukeyManager"],
    required: false, // Non-critical, app can run without remote control
    async init(context) {
      try {
        const { createRemoteGateway } = require("../remote");

        const gateway = await createRemoteGateway(
          {
            p2pManager: context.p2pManager,
            didManager: context.didManager,
            ukeyManager: context.ukeyManager,
            database: context.database,
            mainWindow: context.mainWindow, // May be null initially
            aiEngine: context.aiEngineManager,
            ragManager: context.ragManager,
          },
          {
            enableP2P: true,
            enableWebSocket: true,
            browserExtension: {
              port: 18790,
              host: "127.0.0.1",
            },
          },
        );

        // 注册远程 IPC 处理器（包括命令日志）
        const { registerRemoteIPCHandlers } = require("../remote/remote-ipc");
        let loggingManager = null;
        if (context.database) {
          try {
            const { LoggingManager } = require("../remote/logging");
            loggingManager = new LoggingManager(context.database);
          } catch (err) {
            logger.warn(
              "[Social] LoggingManager init failed, logs IPC disabled:",
              err.message,
            );
          }
        }
        registerRemoteIPCHandlers(gateway, loggingManager);

        logger.info(
          "[Social] ✓ RemoteGateway initialized (browser extension server started)",
        );
        return gateway;
      } catch (error) {
        logger.error("[Social] RemoteGateway initialization failed:", error);
        return null;
      }
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
