/**
 * Phases 42-50 (v1.1.0): Social, Compliance, Identity, U-Key, DLP
 *
 *  - Phase 42: Social AI + ActivityPub Bridge
 *  - Phase 43: Compliance + Data Classification (SOC2, DataClassifier)
 *  - Phase 44: SCIM 2.0 User Sync
 *  - Phase 45: Unified Key + FIDO2 Authenticator
 *  - Phase 46: Threshold Signatures + Biometric Binding
 *  - Phase 47: BLE U-Key driver
 *  - Phase 48: Smart Content Recommendation
 *  - Phase 49: Nostr Bridge
 *  - Phase 50: DLP (Data Loss Prevention)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases42to50({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  // ============================================================
  // Phase 42: Social AI + ActivityPub Bridge
  // ============================================================
  safeRegister("Social AI + ActivityPub IPC", {
    register: () => {
      const { TopicAnalyzer } = require("../../social/topic-analyzer");
      const { SocialGraph } = require("../../social/social-graph");
      const { AISocialAssistant } = require("../../social/ai-social-assistant");
      const { ActivityPubBridge } = require("../../social/activitypub-bridge");
      const { APContentSync } = require("../../social/ap-content-sync");
      const { APWebFinger } = require("../../social/ap-webfinger");

      const database = deps.database || null;
      const llmManager = registeredModules.llmManager || null;
      const didManager = registeredModules.didManager || null;

      const topicAnalyzer = new TopicAnalyzer(database, llmManager);
      const socialGraph = new SocialGraph(database);
      const aiSocialAssistant = new AISocialAssistant(llmManager);

      if (database) {
        topicAnalyzer
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] TopicAnalyzer init warning:",
              err.message,
            ),
          );
        socialGraph
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] SocialGraph init warning:",
              err.message,
            ),
          );
        aiSocialAssistant
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] AISocialAssistant init warning:",
              err.message,
            ),
          );
      }

      const activityPubBridge = new ActivityPubBridge(database, didManager);
      const apContentSync = new APContentSync(database, activityPubBridge);
      const apWebFinger = new APWebFinger(activityPubBridge);

      if (database) {
        activityPubBridge
          .initialize({ domain: "localhost" })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] ActivityPubBridge init warning:",
              err.message,
            ),
          );
        apContentSync
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] APContentSync init warning:",
              err.message,
            ),
          );
      }

      registeredModules.topicAnalyzer = topicAnalyzer;
      registeredModules.socialGraph = socialGraph;
      registeredModules.activityPubBridge = activityPubBridge;
      registeredModules.apContentSync = apContentSync;
      registeredModules.apWebFinger = apWebFinger;

      if (registeredModules.contextEngineering) {
        registeredModules.contextEngineering.setSocialGraph(socialGraph);
      }
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 42 Complete: Social AI + ActivityPub ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 43: Compliance + Data Classification
  // ============================================================
  safeRegister("Compliance + Classification IPC", {
    register: () => {
      const { SOC2Compliance } = require("../../audit/soc2-compliance");
      const { DataClassifier } = require("../../audit/data-classifier");
      const {
        ClassificationPolicy,
      } = require("../../audit/classification-policy");
      const { registerComplianceIPC } = require("../../audit/compliance-ipc");

      const database = deps.database || null;
      const auditLogger = registeredModules.auditLogger || null;
      const llmManager = registeredModules.llmManager || null;

      const soc2Compliance = new SOC2Compliance(database, auditLogger);
      const dataClassifier = new DataClassifier(database, llmManager);
      const classificationPolicy = new ClassificationPolicy(database);

      if (database) {
        soc2Compliance
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] SOC2Compliance init warning:",
              err.message,
            ),
          );
        dataClassifier
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DataClassifier init warning:",
              err.message,
            ),
          );
        classificationPolicy
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] ClassificationPolicy init warning:",
              err.message,
            ),
          );
      }

      registerComplianceIPC({
        soc2Compliance,
        dataClassifier,
        classificationPolicy,
      });

      registeredModules.soc2Compliance = soc2Compliance;
      registeredModules.dataClassifier = dataClassifier;
      registeredModules.classificationPolicy = classificationPolicy;

      if (registeredModules.contextEngineering) {
        registeredModules.contextEngineering.setComplianceManager(
          soc2Compliance,
        );
      }
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 43 Complete: Compliance + Classification ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 44: SCIM 2.0 User Sync
  // ============================================================
  safeRegister("SCIM 2.0 IPC", {
    register: () => {
      const { SCIMServer } = require("../../enterprise/scim-server");
      const { SCIMSync } = require("../../enterprise/scim-sync");
      const { registerSCIMIPC } = require("../../enterprise/scim-ipc");

      const database = deps.database || null;

      const scimServer = new SCIMServer(database);
      const scimSync = new SCIMSync(database, scimServer);

      if (database) {
        scimServer
          .initialize()
          .catch((err) =>
            logger.warn("[IPC Registry] SCIMServer init warning:", err.message),
          );
        scimSync
          .initialize()
          .catch((err) =>
            logger.warn("[IPC Registry] SCIMSync init warning:", err.message),
          );
      }

      registerSCIMIPC({ scimServer, scimSync });

      registeredModules.scimServer = scimServer;
      registeredModules.scimSync = scimSync;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 44 Complete: SCIM 2.0 ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 45: Unified Key + FIDO2 + USB Transport
  // ============================================================
  safeRegister("Unified Key + FIDO2 modules", {
    register: () => {
      const { UnifiedKeyManager } = require("../../ukey/unified-key-manager");
      const { FIDO2Authenticator } = require("../../ukey/fido2-authenticator");

      const database = deps.database || null;

      const unifiedKeyManager = new UnifiedKeyManager(database);
      const fido2Authenticator = new FIDO2Authenticator(database);

      if (database) {
        unifiedKeyManager
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] UnifiedKeyManager init warning:",
              err.message,
            ),
          );
        fido2Authenticator
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] FIDO2Authenticator init warning:",
              err.message,
            ),
          );
      }

      registeredModules.unifiedKeyManager = unifiedKeyManager;
      registeredModules.fido2Authenticator = fido2Authenticator;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 45 Complete: Unified Key + FIDO2 ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 46: Threshold Signatures + Biometric Binding
  // ============================================================
  safeRegister("Threshold Signature + Biometric", {
    register: () => {
      const {
        ThresholdSignatureManager,
      } = require("../../ukey/threshold-signature-manager");
      const { BiometricBinding } = require("../../ukey/biometric-binding");

      const database = deps.database || null;

      const thresholdManager = new ThresholdSignatureManager(database);
      const biometricBinding = new BiometricBinding(database);

      if (database) {
        thresholdManager
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] ThresholdSignatureManager init warning:",
              err.message,
            ),
          );
        biometricBinding
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] BiometricBinding init warning:",
              err.message,
            ),
          );
      }

      registeredModules.thresholdManager = thresholdManager;
      registeredModules.biometricBinding = biometricBinding;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 46 Complete: Threshold Signatures ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 47: BLE U-Key
  // ============================================================
  safeRegister("BLE U-Key driver", {
    register: () => {
      const { getBLEDriver } = require("../../ukey/ble-driver");
      const bleDriver = getBLEDriver();
      registeredModules.bleDriver = bleDriver;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 47 Complete: BLE U-Key ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 48: Smart Content Recommendation
  // ============================================================
  safeRegister("Recommendation modules", {
    register: () => {
      const { LocalRecommender } = require("../../social/local-recommender");
      const { InterestProfiler } = require("../../social/interest-profiler");
      const {
        registerRecommendationIPC,
      } = require("../../social/recommendation-ipc");

      const database = deps.database || null;

      const localRecommender = new LocalRecommender(database);
      const interestProfiler = new InterestProfiler(database);

      if (database) {
        localRecommender
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] LocalRecommender init warning:",
              err.message,
            ),
          );
        interestProfiler
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] InterestProfiler init warning:",
              err.message,
            ),
          );
      }

      localRecommender.setInterestProfiler(interestProfiler);

      registerRecommendationIPC({ localRecommender, interestProfiler });

      registeredModules.localRecommender = localRecommender;
      registeredModules.interestProfiler = interestProfiler;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 48 Complete: Content Recommendation ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 49: Nostr Bridge
  // ============================================================
  safeRegister("Nostr Bridge modules", {
    register: () => {
      const { NostrBridge } = require("../../social/nostr-bridge");
      const { NostrIdentity } = require("../../social/nostr-identity");
      const {
        registerNostrBridgeIPC,
      } = require("../../social/nostr-bridge-ipc");

      const database = deps.database || null;

      const nostrBridge = new NostrBridge(database);
      const nostrIdentity = new NostrIdentity(database);

      if (database) {
        nostrBridge
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] NostrBridge init warning:",
              err.message,
            ),
          );
        nostrIdentity
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] NostrIdentity init warning:",
              err.message,
            ),
          );
      }

      registerNostrBridgeIPC({ nostrBridge, nostrIdentity });

      registeredModules.nostrBridge = nostrBridge;
      registeredModules.nostrIdentity = nostrIdentity;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 49 Complete: Nostr Bridge ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 50: DLP Data Loss Prevention
  // ============================================================
  safeRegister("DLP modules", {
    register: () => {
      const { DLPEngine } = require("../../audit/dlp-engine");
      const { DLPPolicyManager } = require("../../audit/dlp-policy");
      const { registerDLPIPC } = require("../../audit/dlp-ipc");

      const database = deps.database || null;

      const dlpEngine = new DLPEngine(database);
      const dlpPolicyManager = new DLPPolicyManager(database);

      if (database) {
        dlpEngine
          .initialize()
          .catch((err) =>
            logger.warn("[IPC Registry] DLPEngine init warning:", err.message),
          );
        dlpPolicyManager
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] DLPPolicyManager init warning:",
              err.message,
            ),
          );
      }

      dlpEngine.setPolicyManager(dlpPolicyManager);

      registerDLPIPC({ dlpEngine, dlpPolicyManager });

      registeredModules.dlpEngine = dlpEngine;
      registeredModules.dlpPolicyManager = dlpPolicyManager;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 50 Complete: DLP ready!");
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases42to50 };
