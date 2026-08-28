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
    "deepLinkHandler",
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
  SOCIAL_INITIALIZER_MODULES,
  SOCIAL_STARTUP_PHASE_MODULES,
  applySocialStartupPolicy,
  getSocialStartupDisposition,
};
