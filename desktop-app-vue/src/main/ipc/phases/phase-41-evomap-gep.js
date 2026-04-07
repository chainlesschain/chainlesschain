/**
 * Phase 41: EvoMap GEP Protocol Integration (v1.0.0)
 *
 * Wires EvoMapClient, EvoMapNodeManager, EvoMapGeneSynthesizer,
 * and EvoMapAssetBridge into the IPC layer. Bridges into
 * ContextEngineering when present.
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhase41({ safeRegister, logger, deps, registeredModules }) {
  safeRegister("EvoMap GEP Protocol IPC", {
    register: () => {
      const { getEvoMapClient } = require("../../evomap/evomap-client");
      const {
        getEvoMapNodeManager,
      } = require("../../evomap/evomap-node-manager");
      const {
        getEvoMapGeneSynthesizer,
      } = require("../../evomap/evomap-gene-synthesizer");
      const {
        getEvoMapAssetBridge,
      } = require("../../evomap/evomap-asset-bridge");
      const { registerEvoMapIPC } = require("../../evomap/evomap-ipc");

      const evoMapClient = getEvoMapClient();
      const evoMapNodeManager = getEvoMapNodeManager();
      const evoMapSynthesizer = getEvoMapGeneSynthesizer();
      const evoMapBridge = getEvoMapAssetBridge();

      const database = deps.database || null;
      const hookSystem = deps.hookSystem || null;
      const didManager = registeredModules.didManager || null;
      const instinctManager = registeredModules.instinctManager || null;
      const decisionKnowledgeBase =
        registeredModules.decisionKnowledgeBase || null;
      const promptOptimizer = registeredModules.promptOptimizer || null;
      const skillRegistry = registeredModules.skillRegistry || null;

      if (database) {
        evoMapNodeManager
          .initialize(database, didManager, hookSystem)
          .catch((err) =>
            logger.warn(
              "[IPC Registry] EvoMapNodeManager init warning:",
              err.message,
            ),
          );
        evoMapSynthesizer
          .initialize(
            database,
            instinctManager,
            decisionKnowledgeBase,
            promptOptimizer,
          )
          .catch((err) =>
            logger.warn(
              "[IPC Registry] EvoMapGeneSynthesizer init warning:",
              err.message,
            ),
          );
        evoMapBridge
          .initialize({
            database,
            client: evoMapClient,
            nodeManager: evoMapNodeManager,
            synthesizer: evoMapSynthesizer,
            skillRegistry,
            instinctManager,
            hookSystem,
          })
          .catch((err) =>
            logger.warn(
              "[IPC Registry] EvoMapAssetBridge init warning:",
              err.message,
            ),
          );
      }

      if (registeredModules.contextEngineering) {
        registeredModules.contextEngineering.setEvoMapBridge(evoMapBridge);
      }

      registerEvoMapIPC({
        nodeManager: evoMapNodeManager,
        client: evoMapClient,
        synthesizer: evoMapSynthesizer,
        bridge: evoMapBridge,
      });

      registeredModules.evoMapBridge = evoMapBridge;
      registeredModules.evoMapNodeManager = evoMapNodeManager;
      registeredModules.evoMapClient = evoMapClient;
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 41 Complete: EvoMap GEP Protocol ready!");
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhase41 };
