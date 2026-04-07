/**
 * Phases 51-57 (v1.1.0): SIEM, PQC, Firmware OTA, Governance,
 * Matrix, Terraform, Production Hardening
 *
 *  - Phase 51: SIEM Integration
 *  - Phase 52: PQC Migration
 *  - Phase 53: Firmware OTA
 *  - Phase 54: AI Community Governance
 *  - Phase 55: Matrix Integration
 *  - Phase 56: Terraform Provider
 *  - Phase 57: Production Hardening
 *
 * Extracted from ipc-registry.js as part of H2 file split.
 */

function registerPhases51to57({
  safeRegister,
  logger,
  deps,
  registeredModules,
}) {
  // ============================================================
  // Phase 51: SIEM Integration
  // ============================================================
  safeRegister("SIEM module", {
    register: () => {
      const { SIEMExporter } = require("../../audit/siem-exporter");
      const { registerSIEMIPC } = require("../../audit/siem-ipc");

      const database = deps.database || null;

      const siemExporter = new SIEMExporter(database);

      if (database) {
        siemExporter
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] SIEMExporter init warning:",
              err.message,
            ),
          );
      }

      registerSIEMIPC({ siemExporter });

      registeredModules.siemExporter = siemExporter;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 51 Complete: SIEM Integration ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 52: PQC Migration
  // ============================================================
  safeRegister("PQC Migration module", {
    register: () => {
      const {
        PQCMigrationManager,
      } = require("../../ukey/pqc-migration-manager");
      const { registerPQCIPC } = require("../../ukey/pqc-ipc");

      const database = deps.database || null;

      const pqcManager = new PQCMigrationManager(database);

      if (database) {
        pqcManager
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PQCMigrationManager init warning:",
              err.message,
            ),
          );
      }

      registerPQCIPC({ pqcManager });

      registeredModules.pqcManager = pqcManager;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 52 Complete: PQC Migration ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 53: Firmware OTA
  // ============================================================
  safeRegister("Firmware OTA module", {
    register: () => {
      const { FirmwareOTAManager } = require("../../ukey/firmware-ota-manager");
      const { registerFirmwareOTAIPC } = require("../../ukey/firmware-ota-ipc");

      const database = deps.database || null;

      const firmwareManager = new FirmwareOTAManager(database);

      if (database) {
        firmwareManager
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] FirmwareOTAManager init warning:",
              err.message,
            ),
          );
      }

      registerFirmwareOTAIPC({ firmwareManager });

      registeredModules.firmwareManager = firmwareManager;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 53 Complete: Firmware OTA ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 54: AI Community Governance
  // ============================================================
  safeRegister("Governance AI module", {
    register: () => {
      const { GovernanceAI } = require("../../social/governance-ai");
      const { registerGovernanceIPC } = require("../../social/governance-ipc");

      const database = deps.database || null;

      const governanceAI = new GovernanceAI(database);

      if (database) {
        governanceAI
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] GovernanceAI init warning:",
              err.message,
            ),
          );
      }

      registerGovernanceIPC({ governanceAI });

      registeredModules.governanceAI = governanceAI;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 54 Complete: AI Governance ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 55: Matrix Integration
  // ============================================================
  safeRegister("Matrix Bridge module", {
    register: () => {
      const { MatrixBridge } = require("../../social/matrix-bridge");
      const { registerMatrixIPC } = require("../../social/matrix-ipc");

      const database = deps.database || null;

      const matrixBridge = new MatrixBridge(database);

      if (database) {
        matrixBridge
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] MatrixBridge init warning:",
              err.message,
            ),
          );
      }

      registerMatrixIPC({ matrixBridge });

      registeredModules.matrixBridge = matrixBridge;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 55 Complete: Matrix Integration ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 56: Terraform Provider
  // ============================================================
  safeRegister("Terraform module", {
    register: () => {
      const {
        TerraformManager,
      } = require("../../enterprise/terraform-manager");
      const {
        registerTerraformIPC,
      } = require("../../enterprise/terraform-ipc");

      const database = deps.database || null;

      const terraformManager = new TerraformManager(database);

      if (database) {
        terraformManager
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] TerraformManager init warning:",
              err.message,
            ),
          );
      }

      registerTerraformIPC({ terraformManager });

      registeredModules.terraformManager = terraformManager;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 56 Complete: Terraform Provider ready!");
  logger.info("[IPC Registry] ========================================");

  // ============================================================
  // Phase 57: Production Hardening
  // ============================================================
  safeRegister("Production Hardening", {
    register: () => {
      const {
        PerformanceBaseline,
      } = require("../../performance/performance-baseline");
      const { SecurityAuditor } = require("../../audit/security-auditor");
      const {
        registerHardeningIPC,
      } = require("../../performance/hardening-ipc");

      const database = deps.database || null;

      const performanceBaseline = new PerformanceBaseline(database);
      const securityAuditor = new SecurityAuditor(database);

      if (database) {
        performanceBaseline
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] PerformanceBaseline init warning:",
              err.message,
            ),
          );
        securityAuditor
          .initialize()
          .catch((err) =>
            logger.warn(
              "[IPC Registry] SecurityAuditor init warning:",
              err.message,
            ),
          );
      }

      registerHardeningIPC({ performanceBaseline, securityAuditor });

      registeredModules.performanceBaseline = performanceBaseline;
      registeredModules.securityAuditor = securityAuditor;
    },
  });
  logger.info("[IPC Registry] ========================================");
  logger.info("[IPC Registry] Phase 57 Complete: Production Hardening ready!");
  logger.info("[IPC Registry] ========================================");
}

module.exports = { registerPhases51to57 };
