/**
 * Phase 3+4: Social Network + Enterprise (DID, P2P, Social, VC, Org).
 *
 *  Phase 3: DID, P2P + Signaling, External Device File,
 *           Social (contact/friend/post), Call, Album, Social Collab,
 *           Community, Time Machine, Livestream, Future Social
 *  Phase 4: VC, Identity Context, Organization, Dashboard
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases3to4Social({
  safeRegister,
  logger,
  deps,
  registeredModules: _registeredModules,
}) {
  const {
    database,
    didManager,
    p2pManager,
    contactManager,
    friendManager,
    postManager,
    vcManager,
    identityContextManager,
    organizationManager,
    dbManager,
    versionManager,
  } = deps;
  // Re-bind dependencies alias for blocks that read deps.X directly
  const dependencies = deps;

  // ============================================================
  // 第三阶段模块 (社交网络 - DID, P2P, Social)
  // ============================================================

  // DID 身份管理 (函数模式 - 中等模块，24 handlers)
  if (didManager) {
    safeRegister("DID IPC", {
      register: () => {
        const { registerDIDIPC } = require("../../did/did-ipc");
        registerDIDIPC({ didManager });
      },
      handlers: 24,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });
  }

  // P2P 网络通信 (函数模式 - 中等模块，18 handlers)
  if (p2pManager) {
    safeRegister("P2P + Signaling IPC", {
      register: () => {
        const { registerP2PIPC } = require("../../p2p/p2p-ipc");
        registerP2PIPC({ p2pManager });
        // 嵌入式信令服务器 (函数模式 - 小模块，11 handlers)
        // Note: Signaling server IPC is registered with p2pManager as provider
        const { registerSignalingIPC } = require("../../p2p/signaling-ipc");
        registerSignalingIPC({ p2pManager });
      },
      handlers: 29,
      fatal: true,
      continueMessage: "Continuing with other IPC registrations...",
    });
  }

  // 外部设备文件管理 (函数模式 - 中等模块，15 handlers)
  if (p2pManager && database) {
    const externalFileManager = dependencies.externalFileManager;
    if (externalFileManager) {
      safeRegister("External Device File IPC", {
        register: () => {
          const {
            registerExternalDeviceFileIPC,
          } = require("../../file/external-device-file-ipc");
          registerExternalDeviceFileIPC(
            require("electron").ipcMain,
            externalFileManager,
          );
        },
        handlers: 15,
        fatal: true,
        continueMessage: "Continuing with other IPC registrations...",
      });
    }
  }

  // 社交网络 (函数模式 - 大模块，33 handlers: contact + friend + post + chat)
  safeRegister("Social IPC", {
    register: () => {
      const { registerSocialIPC } = require("../../social/social-ipc");
      registerSocialIPC({
        contactManager: contactManager || null,
        friendManager: friendManager || null,
        postManager: postManager || null,
        database: database || null,
      });
      if (!contactManager && !friendManager && !postManager && !database) {
        logger.warn(
          "[IPC Registry] ⚠ Social IPC registered with null dependencies (degraded mode)",
        );
      }
    },
    handlers: 33,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // v0.39.0 — 通话 IPC (12 handlers)
  safeRegister("Call IPC", {
    register: () => {
      const { registerCallIPC } = require("../../social/call-ipc");
      registerCallIPC({
        callManager: dependencies.callManager || null,
        mediaEngine: dependencies.mediaEngine || null,
        callSignaling: dependencies.callSignaling || null,
        sfuRelay: dependencies.sfuRelay || null,
      });
    },
    handlers: 12,
    fatal: true,
  });

  // v0.40.0 — 共享相册 IPC (12 handlers)
  safeRegister("Album IPC", {
    register: () => {
      const { registerAlbumIPC } = require("../../social/album-ipc");
      registerAlbumIPC({
        sharedAlbumManager: dependencies.sharedAlbumManager || null,
        photoEncryptor: dependencies.photoEncryptor || null,
        photoSync: dependencies.photoSync || null,
        exifStripper: dependencies.exifStripper || null,
      });
    },
    handlers: 12,
    fatal: true,
  });

  // v0.41.0 — 社交协作编辑 IPC (12 handlers)
  safeRegister("Social Collab IPC", {
    register: () => {
      const {
        registerCollabSocialIPC,
      } = require("../../social/collab-social-ipc");
      registerCollabSocialIPC({
        collabEngine: dependencies.collabEngine || null,
        collabSync: dependencies.collabSync || null,
        collabAwareness: dependencies.collabAwareness || null,
        docVersionManager: dependencies.docVersionManager || null,
      });
    },
    handlers: 12,
    fatal: true,
  });

  // v0.42.0 — 社区/频道 IPC (24 handlers)
  safeRegister("Community IPC", {
    register: () => {
      const { registerCommunityIPC } = require("../../social/community-ipc");
      registerCommunityIPC({
        communityManager: dependencies.communityManager || null,
        channelManager: dependencies.channelManager || null,
        governanceEngine: dependencies.governanceEngine || null,
        gossipProtocol: dependencies.gossipProtocol || null,
        contentModerator: dependencies.contentModerator || null,
      });
    },
    handlers: 24,
    fatal: true,
  });

  // v0.43.0 — 时光机 IPC (15 handlers)
  safeRegister("Time Machine IPC", {
    register: () => {
      const {
        registerTimeMachineIPC,
      } = require("../../social/time-machine-ipc");
      registerTimeMachineIPC({
        timeMachine: dependencies.timeMachine || null,
        memoryGenerator: dependencies.memoryGenerator || null,
        sentimentAnalyzer: dependencies.sentimentAnalyzer || null,
        socialStats: dependencies.socialStats || null,
      });
    },
    handlers: 15,
    fatal: true,
  });

  // v0.44.0 — 直播 IPC (12 handlers)
  safeRegister("Livestream IPC", {
    register: () => {
      const { registerLivestreamIPC } = require("../../social/livestream-ipc");
      registerLivestreamIPC({
        livestreamManager: dependencies.livestreamManager || null,
        danmakuEngine: dependencies.danmakuEngine || null,
      });
    },
    handlers: 12,
    fatal: true,
  });

  // v0.45.0+ — 未来功能 IPC (38 handlers)
  safeRegister("Future Social IPC", {
    register: () => {
      const { registerFutureIPC } = require("../../social/future-ipc");
      registerFutureIPC({
        anonymousMode: dependencies.anonymousMode || null,
        platformBridge: dependencies.platformBridge || null,
        socialToken: dependencies.socialToken || null,
        aiSocialAssistant: dependencies.aiSocialAssistant || null,
        storageMarket: dependencies.storageMarket || null,
        meshSocial: dependencies.meshSocial || null,
      });
    },
    handlers: 38,
    fatal: true,
  });

  // ============================================================
  // 第四阶段模块 (企业版 - VC, Organization, Identity Context)
  // ============================================================

  // 可验证凭证 (函数模式 - 小模块，10 handlers)
  if (vcManager) {
    safeRegister("VC IPC", {
      register: () => {
        const { registerVCIPC } = require("../../vc/vc-ipc");
        registerVCIPC({ vcManager });
      },
      handlers: 10,
      fatal: true,
    });
  }

  // 身份上下文 (函数模式 - 小模块，7 handlers)
  if (identityContextManager) {
    safeRegister("Identity Context IPC", {
      register: () => {
        const {
          registerIdentityContextIPC,
        } = require("../../identity-context/identity-context-ipc");
        registerIdentityContextIPC({ identityContextManager });
      },
      handlers: 7,
      fatal: true,
    });
  }

  // 组织管理 (函数模式 - 大模块，32 handlers)
  // 🔥 始终注册，handlers 内部会处理 organizationManager 为 null 的情况
  logger.info("[IPC Registry] Organization 依赖状态:", {
    organizationManager: !!organizationManager,
    dbManager: !!dbManager,
    versionManager: !!versionManager,
  });
  safeRegister("Organization IPC", {
    register: () => {
      const {
        registerOrganizationIPC,
      } = require("../../organization/organization-ipc");
      registerOrganizationIPC({
        organizationManager,
        dbManager,
        versionManager,
      });
      if (!organizationManager && !dbManager) {
        logger.warn(
          "[IPC Registry] ⚠️  Organization IPC registered with null dependencies",
        );
        logger.warn("[IPC Registry] 企业版功能将返回空数据直到依赖初始化");
      }
    },
    handlers: 32,
    fatal: true,
    continueMessage: "Continuing with other IPC registrations...",
  });

  // 企业版仪表板 (函数模式 - 中模块，10 handlers)
  if (database) {
    safeRegister("Dashboard IPC", {
      register: () => {
        const {
          registerDashboardIPC,
        } = require("../../organization/dashboard-ipc");
        registerDashboardIPC({
          database,
          organizationManager,
        });
      },
      handlers: 10,
      fatal: true,
    });
  }

  // 企业版权限管理扩展 (降级模式)
  // 注意：这些处理器已由 registerPermissionIPC() 注册（第二阶段），此处跳过
  // 保留注释以说明设计意图：当 PermissionEngine 不可用时提供降级服务
  logger.info(
    "[IPC Registry] ✓ Organization Permission IPC skipped (already registered by Permission IPC)",
  );
}

module.exports = { registerPhases3to4Social };
