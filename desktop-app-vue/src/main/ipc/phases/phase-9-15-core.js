/**
 * Phases 9-15 (v0.34.0 - v0.35.0): Cowork, Workflow Optimizations,
 * Enterprise Audit, Plugin Marketplace, Specialized Multi-Agent,
 * SSO, Unified Tool Registry.
 *
 *  - Phase 9:  Cowork 多代理协作系统
 *  - Phase 10: Workflow Optimizations
 *  - Phase 11: Enterprise Audit & Compliance (v0.34.0)
 *  - Phase 12: Plugin Marketplace (v0.34.0)
 *  - Phase 13: Specialized Multi-Agent System (v0.34.0)
 *  - Phase 14: SSO & Enterprise Authentication (v0.34.0)
 *  - Phase 15: Unified Tool Registry (v0.35.0)
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases9to15({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  const {
    app,
    database,
    mainWindow,
    aiEngineManager,
    llmManager,
    mcpToolAdapter,
  } = deps;

  // ============================================================
  // Phase 9: Cowork 多代理协作系统
  // ============================================================

  safeRegister("Cowork IPC", {
    handlers: 44,
    subDetails: [
      "TeammateTool: 15 handlers",
      "FileSandbox: 11 handlers",
      "LongRunningTaskManager: 9 handlers",
      "SkillRegistry: 5 handlers",
      "Utilities: 4 handlers",
    ],
    fatal: true,
    continueMessage: "Continuing without Cowork functionality...",
    register: () => {
      const {
        registerCoworkIPC,
      } = require("../../ai-engine/cowork/cowork-ipc");
      registerCoworkIPC({
        database: database || null,
        mainWindow: mainWindow || null,
      });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 9 Complete: Cowork system ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 10: Workflow Optimizations
  // ============================================================

  safeRegister("Workflow Optimizations IPC", {
    handlers: 7,
    subDetails: [
      "Status & Statistics: 2 handlers",
      "Toggle & Configuration: 3 handlers",
      "Reports & Health: 2 handlers",
    ],
    fatal: true,
    continueMessage: "Continuing without Workflow Optimizations dashboard...",
    register: () => {
      const {
        registerWorkflowOptimizationsIPC,
      } = require("../workflow-optimizations-ipc");
      registerWorkflowOptimizationsIPC({
        database: database || null,
        aiEngineManager: aiEngineManager || null,
      });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 10 Complete: Workflow Optimizations ready!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 11: Enterprise Audit & Compliance (v0.34.0)
  // ============================================================

  safeRegister("Enterprise Audit IPC", {
    handlers: 18,
    subDetails: [
      "Audit Logs: 4 handlers",
      "Compliance: 6 handlers",
      "Data Subject Requests: 6 handlers",
      "Retention: 2 handlers",
    ],
    register: () => {
      const { registerAuditIPC } = require("../../audit/audit-ipc");
      registerAuditIPC({ database: database || null });
    },
  });

  // ============================================================
  // Phase 12: Plugin Marketplace (v0.34.0)
  // ============================================================

  safeRegister("Plugin Marketplace IPC", {
    handlers: 22,
    subDetails: [
      "Browse: 6 handlers",
      "Install: 6 handlers",
      "Installed: 3 handlers",
      "Rating: 3 handlers",
      "Publish: 3 handlers",
      "Config: 1 handler",
    ],
    register: () => {
      const {
        registerMarketplaceIPC,
      } = require("../../marketplace/marketplace-ipc");
      registerMarketplaceIPC({ database: database || null });
    },
  });

  // ============================================================
  // Phase 13: Specialized Multi-Agent System (v0.34.0)
  // ============================================================

  safeRegister("Specialized Agents IPC", {
    handlers: 16,
    subDetails: [
      "Templates: 5 handlers",
      "Deploy: 4 handlers",
      "Tasks: 3 handlers",
      "Coordination: 2 handlers",
      "Analytics: 2 handlers",
    ],
    register: () => {
      const {
        registerAgentsIPC,
      } = require("../../ai-engine/agents/agents-ipc");
      registerAgentsIPC({ database: database || null });
    },
  });

  // ============================================================
  // Phase 14: SSO & Enterprise Authentication (v0.34.0)
  // ============================================================

  safeRegister("SSO IPC", {
    handlers: 20,
    subDetails: [
      "Config: 5 handlers",
      "Auth: 4 handlers",
      "Identity: 4 handlers",
      "Session: 3 handlers",
      "SAML: 2 handlers",
      "OIDC: 2 handlers",
    ],
    register: () => {
      const { registerSSOIPC } = require("../../auth/sso-ipc");
      registerSSOIPC({ database: database || null });
    },
  });

  logger.info("[IPC Registry] ========================================");
  logger.info(
    "[IPC Registry] Phase 14 Complete: All v0.34.0 features registered!",
  );
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 15: Unified Tool Registry (v0.35.0)
  // ============================================================

  safeRegister("Unified Tool Registry IPC", {
    register: () => {
      const {
        UnifiedToolRegistry,
      } = require("../../ai-engine/unified-tool-registry");
      const {
        registerUnifiedToolsIPC,
      } = require("../../ai-engine/unified-tools-ipc");

      const unifiedToolRegistry = new UnifiedToolRegistry();

      // Bind available subsystems
      const functionCaller = aiEngineManager?.functionCaller || null;
      if (functionCaller) {
        unifiedToolRegistry.bindFunctionCaller(functionCaller);
      }
      if (mcpToolAdapter) {
        unifiedToolRegistry.bindMCPAdapter(mcpToolAdapter);
      }

      // Bind SkillRegistry (from skills-ipc singleton)
      try {
        const {
          getSkillRegistry,
        } = require("../../ai-engine/cowork/skills/skill-registry");
        const skillRegistry = getSkillRegistry?.();
        if (skillRegistry) {
          unifiedToolRegistry.bindSkillRegistry(skillRegistry);
        }
      } catch (srError) {
        logger.warn(
          "[IPC Registry] ⚠️  SkillRegistry not available for UnifiedToolRegistry:",
          srError.message,
        );
      }

      // Initialize asynchronously (non-blocking) with deferred skill import
      // for faster main-process startup; reads trigger import on demand.
      unifiedToolRegistry
        .initialize({ deferSkills: true })
        .then(() => {
          // Wire into ManusOptimizations so AI conversations get skill context in prompts
          if (llmManager?.manusOptimizations?.bindUnifiedRegistry) {
            llmManager.manusOptimizations.bindUnifiedRegistry(
              unifiedToolRegistry,
            );
            logger.info(
              "[IPC Registry] ✓ UnifiedToolRegistry bound to ManusOptimizations",
            );
          }
        })
        .catch((initError) => {
          logger.warn(
            "[IPC Registry] ⚠️  UnifiedToolRegistry initialization error:",
            initError.message,
          );
        });

      // Save to app instance
      if (app) {
        app.unifiedToolRegistry = unifiedToolRegistry;
      }

      // Register IPC handlers
      registerUnifiedToolsIPC({ unifiedToolRegistry });
      registeredModules.unifiedToolRegistry = unifiedToolRegistry;
    },
    handlers: 8,
  });

  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 15 Complete: Unified Tool Registry ready!");
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases9to15 };
