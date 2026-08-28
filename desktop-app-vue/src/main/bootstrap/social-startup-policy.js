/**
 * Explicit startup policy for modules registered by social-initializer.
 *
 * A registration is not evidence that a feature is production-wired. Modules
 * in DORMANT_SOCIAL_MODULES keep their initializer for future adapter work,
 * but are lazy and absent from every normal startup phase. Their IPC handlers
 * therefore continue to receive null dependencies and fail closed.
 */

const SOCIAL_STARTUP_PHASE_MODULES = Object.freeze({
  6: Object.freeze([
    "didManager",
    "p2pManager",
    "contactManager",
    "friendManager",
    "postManager",
    "communityManager",
    "channelManager",
    "governanceEngine",
    "gossipProtocol",
    "contentModerator",
    "crossFedTrust",
    "governanceMultiSig",
    "channelEnvelopeArchiver",
    "archiveProviderFactory",
    "autoArchiveScheduler",
    "channelEventBatcher",
    "mtcFederationManager",
    "channelEnvelopeDistribution",
    "mtcAutoBridge",
    "gossipReceiver",
    "collabEngine",
    "collabSync",
    "collabAwareness",
  ]),
  7: Object.freeze([
    "organizationManager",
    "collaborationManager",
    "syncEngine",
    "vcManager",
    "vcTemplateManager",
  ]),
  9: Object.freeze(["remoteGateway"]),
});

const DORMANT_SOCIAL_MODULES = Object.freeze([
  "callManager",
  "callSignaling",
  "mediaEngine",
  "sfuRelay",
  "sharedAlbumManager",
  "photoEncryptor",
  "photoSync",
  "exifStripper",
  "docVersionManager",
  "timeMachine",
  "memoryGenerator",
  "sentimentAnalyzer",
  "socialStats",
  "livestreamManager",
  "danmakuEngine",
  "anonymousMode",
  "platformBridge",
  "socialToken",
  "aiSocialAssistant",
  "storageMarket",
  "meshSocial",
]);

const ACTIVE_SOCIAL_MODULES = Object.freeze(
  Object.values(SOCIAL_STARTUP_PHASE_MODULES).flat(),
);
const SOCIAL_INITIALIZER_MODULES = Object.freeze([
  ...ACTIVE_SOCIAL_MODULES,
  ...DORMANT_SOCIAL_MODULES,
]);
const SOCIAL_RUNTIME_MANAGER_CLEANUP = Object.freeze(
  [
    ["gossipReceiver", "close"],
    ["mtcAutoBridge", "close"],
    ["channelEnvelopeDistribution", "close"],
    ["autoArchiveScheduler", "stop"],
    ["channelEventBatcher", "close"],
    ["mtcFederationManager", "close"],
  ].map(Object.freeze),
);
const SOCIAL_COLLAB_MANAGER_CLEANUP = Object.freeze(
  [
    ["collabSync", "destroy"],
    ["collabAwareness", "destroy"],
    ["collabEngine", "destroy"],
    ["gossipProtocol", "destroy"],
  ].map(Object.freeze),
);
const SOCIAL_BUSINESS_MANAGER_CLEANUP = Object.freeze(
  [
    ["governanceEngine", "close"],
    ["contentModerator", "close"],
    ["vcTemplateManager", "close"],
    ["vcManager", "close"],
    ["channelManager", "close"],
    ["communityManager", "close"],
    ["postManager", "close"],
    ["friendManager", "close"],
    ["contactManager", "close"],
  ].map(Object.freeze),
);
const SOCIAL_ENTERPRISE_MANAGER_CLEANUP = Object.freeze(
  [
    ["collaborationManager", "stopServer"],
    ["syncEngine", "close"],
    ["organizationManager", "close"],
  ].map(Object.freeze),
);
const SOCIAL_FOUNDATION_MANAGER_CLEANUP = Object.freeze(
  [
    ["didManager", "close"],
    ["p2pManager", "close"],
  ].map(Object.freeze),
);
const SOCIAL_REMOTE_MANAGER_CLEANUP = Object.freeze(
  [["remoteGateway", "stop"]].map(Object.freeze),
);
const SOCIAL_PASSIVE_MODULES = Object.freeze([
  "crossFedTrust",
  "governanceMultiSig",
  "channelEnvelopeArchiver",
  "archiveProviderFactory",
]);
const SOCIAL_ACTIVE_CLEANUP_GROUPS = Object.freeze({
  runtime: SOCIAL_RUNTIME_MANAGER_CLEANUP,
  collaboration: SOCIAL_COLLAB_MANAGER_CLEANUP,
  enterprise: SOCIAL_ENTERPRISE_MANAGER_CLEANUP,
  business: SOCIAL_BUSINESS_MANAGER_CLEANUP,
  remote: SOCIAL_REMOTE_MANAGER_CLEANUP,
  foundation: SOCIAL_FOUNDATION_MANAGER_CLEANUP,
});
const SOCIAL_ACTIVE_LIFECYCLE_MODULES = Object.freeze([
  ...Object.values(SOCIAL_ACTIVE_CLEANUP_GROUPS).flatMap((entries) =>
    entries.map(([name]) => name),
  ),
  ...SOCIAL_PASSIVE_MODULES,
]);

function assertActiveSocialLifecycleInventory() {
  const names = new Set(SOCIAL_ACTIVE_LIFECYCLE_MODULES);
  if (names.size !== SOCIAL_ACTIVE_LIFECYCLE_MODULES.length) {
    throw new Error(
      "[SocialStartupPolicy] Duplicate active social lifecycle entry",
    );
  }
  if (
    names.size !== ACTIVE_SOCIAL_MODULES.length ||
    ACTIVE_SOCIAL_MODULES.some((name) => !names.has(name))
  ) {
    throw new Error(
      "[SocialStartupPolicy] Active social lifecycle inventory is incomplete",
    );
  }
}

assertActiveSocialLifecycleInventory();
const ACTIVE_SOCIAL_MODULE_SET = new Set(ACTIVE_SOCIAL_MODULES);
const DORMANT_SOCIAL_MODULE_SET = new Set(DORMANT_SOCIAL_MODULES);

function getSocialStartupDisposition(name) {
  if (ACTIVE_SOCIAL_MODULE_SET.has(name)) {
    return "startup";
  }
  if (DORMANT_SOCIAL_MODULE_SET.has(name)) {
    return "dormant";
  }
  return null;
}

function applySocialStartupPolicy(config) {
  const disposition = getSocialStartupDisposition(config?.name);
  if (!disposition) {
    throw new Error(
      `[SocialStartupPolicy] Unclassified social initializer: ${config?.name || "<missing>"}`,
    );
  }

  return {
    ...config,
    lazy: disposition === "dormant",
  };
}

module.exports = {
  ACTIVE_SOCIAL_MODULES,
  DORMANT_SOCIAL_MODULES,
  SOCIAL_ACTIVE_CLEANUP_GROUPS,
  SOCIAL_ACTIVE_LIFECYCLE_MODULES,
  SOCIAL_BUSINESS_MANAGER_CLEANUP,
  SOCIAL_COLLAB_MANAGER_CLEANUP,
  SOCIAL_ENTERPRISE_MANAGER_CLEANUP,
  SOCIAL_FOUNDATION_MANAGER_CLEANUP,
  SOCIAL_INITIALIZER_MODULES,
  SOCIAL_PASSIVE_MODULES,
  SOCIAL_REMOTE_MANAGER_CLEANUP,
  SOCIAL_RUNTIME_MANAGER_CLEANUP,
  SOCIAL_STARTUP_PHASE_MODULES,
  applySocialStartupPolicy,
  getSocialStartupDisposition,
};
