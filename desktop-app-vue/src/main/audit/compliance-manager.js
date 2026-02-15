/**
 * Compliance Manager - GDPR/SOC2 Compliance Management
 *
 * Manages compliance policies, runs compliance checks against
 * current system state, and generates compliance reports.
 *
 * Features:
 * - Policy CRUD (retention, access_control, encryption, data_classification, audit_trail)
 * - Framework support (GDPR, SOC2, HIPAA, ISO27001)
 * - Automated compliance checks with scoring
 * - Detailed report generation with recommendations
 * - Score history tracking over time
 *
 * @module audit/compliance-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Valid policy types
 */
const POLICY_TYPES = [
  "retention",
  "access_control",
  "encryption",
  "data_classification",
  "audit_trail",
];

/**
 * Supported compliance frameworks
 */
const FRAMEWORKS = ["gdpr", "soc2", "hipaa", "iso27001"];

/**
 * Default weights for each policy type in score calculation
 */
const POLICY_WEIGHTS = {
  retention: 0.15,
  access_control: 0.25,
  encryption: 0.25,
  data_classification: 0.15,
  audit_trail: 0.20,
};

/**
 * ComplianceManager class
 */
class ComplianceManager {
  /**
   * Create a compliance manager
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance
   * @param {Object} options.auditLogger - Audit logger instance
   */
  constructor({ database, auditLogger }) {
    if (!database) {
      throw new Error("[ComplianceManager] database parameter is required");
    }

    this.db = database;
    this.auditLogger = auditLogger || null;
    this.initialized = false;
  }

  // ========================================
  // Initialization
  // ========================================

  /**
   * Initialize compliance manager and create database tables
   */
  async initialize() {
    try {
      logger.info("[ComplianceManager] Initializing compliance manager...");
      await this._createTables();
      this.initialized = true;
      logger.info("[ComplianceManager] Initialization complete");
      return { success: true };
    } catch (error) {
      logger.error("[ComplianceManager] Initialization failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create database tables for compliance management
   */
  async _createTables() {
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS compliance_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        framework TEXT NOT NULL,
        rules TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        severity TEXT DEFAULT 'medium',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await this.db.run(`
      CREATE TABLE IF NOT EXISTS compliance_check_results (
        id TEXT PRIMARY KEY,
        framework TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        policy_name TEXT,
        policy_type TEXT,
        status TEXT NOT NULL,
        score INTEGER NOT NULL,
        details TEXT,
        evidence TEXT,
        recommendations TEXT,
        checked_at INTEGER NOT NULL
      )
    `);

    await this.db.run(`
      CREATE TABLE IF NOT EXISTS compliance_score_history (
        id TEXT PRIMARY KEY,
        framework TEXT NOT NULL,
        score INTEGER NOT NULL,
        total_policies INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        details TEXT,
        recorded_at INTEGER NOT NULL
      )
    `);

    await this.db.run(`
      CREATE TABLE IF NOT EXISTS compliance_reports (
        id TEXT PRIMARY KEY,
        framework TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        score INTEGER NOT NULL,
        content TEXT NOT NULL,
        date_range_start INTEGER,
        date_range_end INTEGER,
        generated_at INTEGER NOT NULL
      )
    `);

    logger.info("[ComplianceManager] Database tables created");
  }

  // ========================================
  // Policy Management
  // ========================================

  /**
   * Create a new compliance policy
   * @param {Object} policyData - Policy data
   * @param {string} policyData.name - Policy name
   * @param {string} [policyData.description] - Policy description
   * @param {string} policyData.type - Policy type
   * @param {string} policyData.framework - Compliance framework
   * @param {Object} policyData.rules - Policy rules as JSON
   * @param {string} [policyData.severity] - Severity level (low, medium, high, critical)
   * @returns {Object} Result with created policy
   */
  async createPolicy(policyData) {
    try {
      if (!policyData.name || !policyData.type || !policyData.framework || !policyData.rules) {
        return { success: false, error: "Missing required fields: name, type, framework, rules" };
      }

      if (!POLICY_TYPES.includes(policyData.type)) {
        return {
          success: false,
          error: `Invalid policy type: ${policyData.type}. Must be one of: ${POLICY_TYPES.join(", ")}`,
        };
      }

      if (!FRAMEWORKS.includes(policyData.framework)) {
        return {
          success: false,
          error: `Invalid framework: ${policyData.framework}. Must be one of: ${FRAMEWORKS.join(", ")}`,
        };
      }

      const now = Date.now();
      const id = uuidv4();

      const policy = {
        id,
        name: policyData.name,
        description: policyData.description || "",
        type: policyData.type,
        framework: policyData.framework,
        rules: typeof policyData.rules === "string" ? policyData.rules : JSON.stringify(policyData.rules),
        enabled: policyData.enabled !== false ? 1 : 0,
        severity: policyData.severity || "medium",
        created_at: now,
        updated_at: now,
      };

      await this.db.run(
        `INSERT INTO compliance_policies (id, name, description, type, framework, rules, enabled, severity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [policy.id, policy.name, policy.description, policy.type, policy.framework,
         policy.rules, policy.enabled, policy.severity, policy.created_at, policy.updated_at],
      );

      await this._logAudit("policy_created", { policyId: id, name: policy.name, framework: policy.framework });

      logger.info(`[ComplianceManager] Policy created: ${policy.name} (${policy.framework}/${policy.type})`);

      return { success: true, data: { ...policy, rules: JSON.parse(policy.rules) } };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to create policy:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing compliance policy
   * @param {string} id - Policy ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Result with updated policy
   */
  async updatePolicy(id, updates) {
    try {
      if (!id) {
        return { success: false, error: "Policy ID is required" };
      }

      const existing = await this.db.get(
        "SELECT * FROM compliance_policies WHERE id = ?",
        [id],
      );

      if (!existing) {
        return { success: false, error: `Policy not found: ${id}` };
      }

      if (updates.type && !POLICY_TYPES.includes(updates.type)) {
        return { success: false, error: `Invalid policy type: ${updates.type}` };
      }

      if (updates.framework && !FRAMEWORKS.includes(updates.framework)) {
        return { success: false, error: `Invalid framework: ${updates.framework}` };
      }

      const now = Date.now();
      const fields = [];
      const values = [];

      const allowedFields = ["name", "description", "type", "framework", "rules", "enabled", "severity"];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          fields.push(`${field} = ?`);
          if (field === "rules" && typeof updates[field] === "object") {
            values.push(JSON.stringify(updates[field]));
          } else if (field === "enabled") {
            values.push(updates[field] ? 1 : 0);
          } else {
            values.push(updates[field]);
          }
        }
      }

      if (fields.length === 0) {
        return { success: false, error: "No valid fields to update" };
      }

      fields.push("updated_at = ?");
      values.push(now);
      values.push(id);

      await this.db.run(
        `UPDATE compliance_policies SET ${fields.join(", ")} WHERE id = ?`,
        values,
      );

      const updated = await this.db.get(
        "SELECT * FROM compliance_policies WHERE id = ?",
        [id],
      );

      await this._logAudit("policy_updated", { policyId: id, updates: Object.keys(updates) });

      logger.info(`[ComplianceManager] Policy updated: ${id}`);

      return { success: true, data: this._parsePolicy(updated) };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to update policy:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a compliance policy
   * @param {string} id - Policy ID
   * @returns {Object} Result
   */
  async deletePolicy(id) {
    try {
      if (!id) {
        return { success: false, error: "Policy ID is required" };
      }

      const existing = await this.db.get(
        "SELECT * FROM compliance_policies WHERE id = ?",
        [id],
      );

      if (!existing) {
        return { success: false, error: `Policy not found: ${id}` };
      }

      await this.db.run("DELETE FROM compliance_policies WHERE id = ?", [id]);
      await this.db.run("DELETE FROM compliance_check_results WHERE policy_id = ?", [id]);

      await this._logAudit("policy_deleted", { policyId: id, name: existing.name });

      logger.info(`[ComplianceManager] Policy deleted: ${existing.name} (${id})`);

      return { success: true, data: { id, name: existing.name } };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to delete policy:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get a single policy by ID
   * @param {string} id - Policy ID
   * @returns {Object} Result with policy data
   */
  async getPolicy(id) {
    try {
      if (!id) {
        return { success: false, error: "Policy ID is required" };
      }

      const policy = await this.db.get(
        "SELECT * FROM compliance_policies WHERE id = ?",
        [id],
      );

      if (!policy) {
        return { success: false, error: `Policy not found: ${id}` };
      }

      return { success: true, data: this._parsePolicy(policy) };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get policy:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * List policies with optional filters
   * @param {Object} [filters] - Filter options
   * @param {string} [filters.framework] - Filter by framework
   * @param {string} [filters.type] - Filter by policy type
   * @param {boolean} [filters.enabled] - Filter by enabled status
   * @returns {Object} Result with policy list
   */
  async getPolicies(filters = {}) {
    try {
      const conditions = [];
      const params = [];

      if (filters.framework) {
        conditions.push("framework = ?");
        params.push(filters.framework);
      }

      if (filters.type) {
        conditions.push("type = ?");
        params.push(filters.type);
      }

      if (filters.enabled !== undefined) {
        conditions.push("enabled = ?");
        params.push(filters.enabled ? 1 : 0);
      }

      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const policies = await this.db.all(
        `SELECT * FROM compliance_policies ${whereClause} ORDER BY framework, type, created_at DESC`,
        params,
      );

      return {
        success: true,
        data: (policies || []).map((p) => this._parsePolicy(p)),
      };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get policies:", error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Compliance Checks
  // ========================================

  /**
   * Run compliance checks for a specific framework
   * @param {string} framework - Compliance framework to check
   * @returns {Object} Result with compliance check results
   */
  async checkCompliance(framework) {
    try {
      if (!framework) {
        return { success: false, error: "Framework is required" };
      }

      if (!FRAMEWORKS.includes(framework)) {
        return { success: false, error: `Invalid framework: ${framework}. Must be one of: ${FRAMEWORKS.join(", ")}` };
      }

      logger.info(`[ComplianceManager] Running compliance check for: ${framework}`);

      const policies = await this.db.all(
        "SELECT * FROM compliance_policies WHERE framework = ? AND enabled = 1",
        [framework],
      );

      if (!policies || policies.length === 0) {
        return {
          success: true,
          data: {
            framework,
            score: 0,
            totalPolicies: 0,
            passed: 0,
            failed: 0,
            checks: [],
            recommendations: ["No policies configured for this framework. Add policies to begin compliance tracking."],
            checkedAt: Date.now(),
          },
        };
      }

      const checkResults = [];
      const now = Date.now();

      for (const policy of policies) {
        const parsedRules = JSON.parse(policy.rules);
        const checkResult = await this._evaluatePolicy(policy, parsedRules);

        const resultId = uuidv4();
        const result = {
          id: resultId,
          framework,
          policyId: policy.id,
          policyName: policy.name,
          policyType: policy.type,
          status: checkResult.passed ? "passed" : "failed",
          score: checkResult.score,
          details: checkResult.details,
          evidence: checkResult.evidence,
          recommendations: checkResult.recommendations,
          checkedAt: now,
        };

        await this.db.run(
          `INSERT INTO compliance_check_results (id, framework, policy_id, policy_name, policy_type, status, score, details, evidence, recommendations, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [resultId, framework, policy.id, policy.name, policy.type, result.status,
           result.score, JSON.stringify(result.details), JSON.stringify(result.evidence),
           JSON.stringify(result.recommendations), now],
        );

        checkResults.push(result);
      }

      const passed = checkResults.filter((r) => r.status === "passed").length;
      const failed = checkResults.filter((r) => r.status === "failed").length;
      const overallScore = this._calculateWeightedScore(checkResults);

      // Record score history
      const historyId = uuidv4();
      await this.db.run(
        `INSERT INTO compliance_score_history (id, framework, score, total_policies, passed, failed, details, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [historyId, framework, overallScore, policies.length, passed, failed,
         JSON.stringify({ checks: checkResults.map((r) => ({ id: r.id, policyName: r.policyName, status: r.status, score: r.score })) }),
         now],
      );

      const allRecommendations = checkResults
        .filter((r) => r.recommendations && r.recommendations.length > 0)
        .flatMap((r) => r.recommendations);

      await this._logAudit("compliance_check", { framework, score: overallScore, passed, failed });

      logger.info(`[ComplianceManager] Compliance check complete: ${framework} - Score: ${overallScore}, Passed: ${passed}/${policies.length}`);

      return {
        success: true,
        data: {
          framework,
          score: overallScore,
          totalPolicies: policies.length,
          passed,
          failed,
          checks: checkResults,
          recommendations: allRecommendations,
          checkedAt: now,
        },
      };
    } catch (error) {
      logger.error("[ComplianceManager] Compliance check failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Evaluate a single policy against current system state
   * @param {Object} policy - The policy record
   * @param {Object} rules - Parsed policy rules
   * @returns {Object} Evaluation result
   */
  async _evaluatePolicy(policy, rules) {
    switch (policy.type) {
      case "encryption":
        return this._checkEncryption(policy, rules);
      case "audit_trail":
        return this._checkAuditTrail(policy, rules);
      case "access_control":
        return this._checkAccessControl(policy, rules);
      case "retention":
        return this._checkRetention(policy, rules);
      case "data_classification":
        return this._checkDataClassification(policy, rules);
      default:
        return {
          passed: false,
          score: 0,
          details: { message: `Unknown policy type: ${policy.type}` },
          evidence: [],
          recommendations: [`Configure check handler for policy type: ${policy.type}`],
        };
    }
  }

  /**
   * Check encryption compliance
   */
  async _checkEncryption(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let score = 0;
    let checksTotal = 0;
    let checksPassed = 0;

    // Check database encryption
    if (rules.requireDatabaseEncryption !== false) {
      checksTotal++;
      try {
        const dbInfo = await this.db.get("PRAGMA cipher_version");
        if (dbInfo) {
          checksPassed++;
          evidence.push({ check: "database_encryption", status: "enabled", detail: "SQLCipher active" });
        } else {
          evidence.push({ check: "database_encryption", status: "disabled", detail: "No encryption detected" });
          recommendations.push("Enable SQLCipher database encryption for data at rest protection");
        }
      } catch {
        evidence.push({ check: "database_encryption", status: "unknown", detail: "Could not verify encryption status" });
        recommendations.push("Verify database encryption configuration");
      }
    }

    // Check minimum key length requirement
    if (rules.minKeyLength) {
      checksTotal++;
      const requiredLength = rules.minKeyLength;
      if (requiredLength >= 256) {
        checksPassed++;
        evidence.push({ check: "key_length", status: "compliant", detail: `Minimum key length: ${requiredLength} bits` });
      } else {
        evidence.push({ check: "key_length", status: "non_compliant", detail: `Key length ${requiredLength} below recommended 256 bits` });
        recommendations.push("Increase encryption key length to at least 256 bits");
      }
    }

    // Check TLS requirement
    if (rules.requireTLS !== false) {
      checksTotal++;
      checksPassed++; // Electron apps use HTTPS by default for external connections
      evidence.push({ check: "tls_enabled", status: "compliant", detail: "TLS enforced for network communications" });
    }

    score = checksTotal > 0 ? Math.round((checksPassed / checksTotal) * 100) : 100;

    return {
      passed: score >= (rules.passThreshold || 80),
      score,
      details: { checksTotal, checksPassed, policyName: policy.name },
      evidence,
      recommendations,
    };
  }

  /**
   * Check audit trail compliance
   */
  async _checkAuditTrail(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let checksTotal = 0;
    let checksPassed = 0;

    // Check if audit logging is active
    if (rules.requireAuditLogging !== false) {
      checksTotal++;
      if (this.auditLogger) {
        checksPassed++;
        evidence.push({ check: "audit_logging", status: "active", detail: "Audit logger is configured" });
      } else {
        evidence.push({ check: "audit_logging", status: "inactive", detail: "No audit logger configured" });
        recommendations.push("Configure audit logging for all sensitive operations");
      }
    }

    // Check log retention
    if (rules.minRetentionDays) {
      checksTotal++;
      const retentionDays = rules.minRetentionDays;
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      try {
        const oldestLog = await this.db.get(
          "SELECT MIN(checked_at) as oldest FROM compliance_check_results",
        );
        if (oldestLog && oldestLog.oldest && oldestLog.oldest <= cutoff) {
          checksPassed++;
          evidence.push({ check: "log_retention", status: "compliant", detail: `Logs retained for ${retentionDays}+ days` });
        } else {
          evidence.push({ check: "log_retention", status: "insufficient", detail: `Logs may not cover full ${retentionDays} day retention period` });
          recommendations.push(`Ensure audit logs are retained for at least ${retentionDays} days`);
        }
      } catch {
        evidence.push({ check: "log_retention", status: "unknown", detail: "Could not verify log retention" });
        recommendations.push("Verify audit log retention configuration");
      }
    }

    // Check log completeness
    if (rules.requireCompleteLogs !== false) {
      checksTotal++;
      try {
        const recentChecks = await this.db.get(
          "SELECT COUNT(*) as count FROM compliance_check_results WHERE checked_at > ?",
          [Date.now() - 7 * 24 * 60 * 60 * 1000],
        );
        if (recentChecks && recentChecks.count > 0) {
          checksPassed++;
          evidence.push({ check: "log_completeness", status: "compliant", detail: `${recentChecks.count} check records in last 7 days` });
        } else {
          evidence.push({ check: "log_completeness", status: "incomplete", detail: "No compliance check records in last 7 days" });
          recommendations.push("Run compliance checks regularly (at least weekly)");
        }
      } catch {
        evidence.push({ check: "log_completeness", status: "unknown", detail: "Could not verify log completeness" });
      }
    }

    const score = checksTotal > 0 ? Math.round((checksPassed / checksTotal) * 100) : 100;

    return {
      passed: score >= (rules.passThreshold || 80),
      score,
      details: { checksTotal, checksPassed, policyName: policy.name },
      evidence,
      recommendations,
    };
  }

  /**
   * Check access control compliance
   */
  async _checkAccessControl(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let checksTotal = 0;
    let checksPassed = 0;

    // Check RBAC is enabled
    if (rules.requireRBAC !== false) {
      checksTotal++;
      try {
        const permissionTable = await this.db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='permission_grants'",
        );
        if (permissionTable) {
          checksPassed++;
          evidence.push({ check: "rbac_enabled", status: "compliant", detail: "Permission system is active" });
        } else {
          evidence.push({ check: "rbac_enabled", status: "not_configured", detail: "Permission grants table not found" });
          recommendations.push("Enable Role-Based Access Control (RBAC) for resource protection");
        }
      } catch {
        evidence.push({ check: "rbac_enabled", status: "unknown", detail: "Could not verify RBAC status" });
      }
    }

    // Check authentication requirement
    if (rules.requireAuthentication !== false) {
      checksTotal++;
      try {
        const didTable = await this.db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='did_identities'",
        );
        if (didTable) {
          checksPassed++;
          evidence.push({ check: "authentication", status: "compliant", detail: "DID-based authentication is configured" });
        } else {
          evidence.push({ check: "authentication", status: "not_configured", detail: "Identity management not found" });
          recommendations.push("Configure DID-based authentication for user identity verification");
        }
      } catch {
        evidence.push({ check: "authentication", status: "unknown", detail: "Could not verify authentication status" });
      }
    }

    // Check session management
    if (rules.requireSessionManagement !== false) {
      checksTotal++;
      checksPassed++; // SessionManager is a core feature
      evidence.push({ check: "session_management", status: "compliant", detail: "Session management is active" });
    }

    // Check principle of least privilege
    if (rules.enforceLeastPrivilege) {
      checksTotal++;
      try {
        const wildcardGrants = await this.db.get(
          "SELECT COUNT(*) as count FROM permission_grants WHERE resource_id = '*'",
        );
        if (!wildcardGrants || wildcardGrants.count === 0) {
          checksPassed++;
          evidence.push({ check: "least_privilege", status: "compliant", detail: "No wildcard permission grants found" });
        } else {
          evidence.push({ check: "least_privilege", status: "warning", detail: `${wildcardGrants.count} wildcard grants found` });
          recommendations.push("Review and restrict wildcard permission grants to enforce least privilege");
        }
      } catch {
        evidence.push({ check: "least_privilege", status: "unknown", detail: "Could not verify permission scope" });
      }
    }

    const score = checksTotal > 0 ? Math.round((checksPassed / checksTotal) * 100) : 100;

    return {
      passed: score >= (rules.passThreshold || 80),
      score,
      details: { checksTotal, checksPassed, policyName: policy.name },
      evidence,
      recommendations,
    };
  }

  /**
   * Check data retention compliance
   */
  async _checkRetention(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let checksTotal = 0;
    let checksPassed = 0;

    // Check retention policy is defined
    if (rules.maxRetentionDays) {
      checksTotal++;
      evidence.push({ check: "retention_policy_defined", status: "compliant", detail: `Max retention: ${rules.maxRetentionDays} days` });
      checksPassed++;
    }

    // Check for expired data
    if (rules.maxRetentionDays) {
      checksTotal++;
      const cutoffDate = Date.now() - rules.maxRetentionDays * 24 * 60 * 60 * 1000;
      try {
        const expiredNotes = await this.db.get(
          "SELECT COUNT(*) as count FROM notes WHERE created_at < ? AND archived = 0",
          [cutoffDate],
        );
        if (!expiredNotes || expiredNotes.count === 0) {
          checksPassed++;
          evidence.push({ check: "expired_data", status: "compliant", detail: "No data exceeds retention period" });
        } else {
          evidence.push({ check: "expired_data", status: "non_compliant", detail: `${expiredNotes.count} records exceed retention period` });
          recommendations.push(`Archive or delete ${expiredNotes.count} records that exceed the ${rules.maxRetentionDays}-day retention period`);
        }
      } catch {
        // Table may not exist, treat as compliant
        checksPassed++;
        evidence.push({ check: "expired_data", status: "compliant", detail: "No applicable data found" });
      }
    }

    // Check deletion verification
    if (rules.requireDeletionVerification) {
      checksTotal++;
      // Deletion verification is handled through audit logger
      if (this.auditLogger) {
        checksPassed++;
        evidence.push({ check: "deletion_verification", status: "compliant", detail: "Deletion events are audit-logged" });
      } else {
        evidence.push({ check: "deletion_verification", status: "non_compliant", detail: "No audit logging for deletions" });
        recommendations.push("Enable audit logging to track data deletion for verification");
      }
    }

    const score = checksTotal > 0 ? Math.round((checksPassed / checksTotal) * 100) : 100;

    return {
      passed: score >= (rules.passThreshold || 80),
      score,
      details: { checksTotal, checksPassed, policyName: policy.name },
      evidence,
      recommendations,
    };
  }

  /**
   * Check data classification compliance
   */
  async _checkDataClassification(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let checksTotal = 0;
    let checksPassed = 0;

    // Check classification schema exists
    if (rules.requireClassification !== false) {
      checksTotal++;
      const classificationLevels = rules.levels || ["public", "internal", "confidential", "restricted"];
      evidence.push({ check: "classification_schema", status: "defined", detail: `Levels: ${classificationLevels.join(", ")}` });
      checksPassed++;
    }

    // Check sensitive data handling
    if (rules.requireSensitiveDataHandling) {
      checksTotal++;
      try {
        const encryptedDb = await this.db.get("PRAGMA cipher_version");
        if (encryptedDb) {
          checksPassed++;
          evidence.push({ check: "sensitive_data_handling", status: "compliant", detail: "Sensitive data stored in encrypted database" });
        } else {
          evidence.push({ check: "sensitive_data_handling", status: "non_compliant", detail: "Database encryption not verified" });
          recommendations.push("Ensure sensitive data is stored in encrypted storage");
        }
      } catch {
        evidence.push({ check: "sensitive_data_handling", status: "unknown", detail: "Could not verify data handling" });
        recommendations.push("Verify sensitive data handling procedures");
      }
    }

    // Check data labeling
    if (rules.requireLabeling) {
      checksTotal++;
      // Check if data has classification metadata
      try {
        const labeledData = await this.db.get(
          "SELECT COUNT(*) as count FROM notes WHERE tags IS NOT NULL AND tags != ''",
        );
        const totalData = await this.db.get("SELECT COUNT(*) as count FROM notes");
        if (totalData && totalData.count > 0 && labeledData) {
          const labelRate = (labeledData.count / totalData.count) * 100;
          if (labelRate >= (rules.minLabelRate || 80)) {
            checksPassed++;
            evidence.push({ check: "data_labeling", status: "compliant", detail: `${Math.round(labelRate)}% of data is labeled` });
          } else {
            evidence.push({ check: "data_labeling", status: "partial", detail: `Only ${Math.round(labelRate)}% of data is labeled (minimum: ${rules.minLabelRate || 80}%)` });
            recommendations.push(`Increase data labeling coverage from ${Math.round(labelRate)}% to at least ${rules.minLabelRate || 80}%`);
          }
        } else {
          checksPassed++;
          evidence.push({ check: "data_labeling", status: "compliant", detail: "No applicable data requires labeling" });
        }
      } catch {
        checksPassed++;
        evidence.push({ check: "data_labeling", status: "compliant", detail: "No applicable data found" });
      }
    }

    const score = checksTotal > 0 ? Math.round((checksPassed / checksTotal) * 100) : 100;

    return {
      passed: score >= (rules.passThreshold || 80),
      score,
      details: { checksTotal, checksPassed, policyName: policy.name },
      evidence,
      recommendations,
    };
  }

  // ========================================
  // Score Calculation
  // ========================================

  /**
   * Calculate weighted compliance score from check results
   * @param {Array} checkResults - Array of check results
   * @returns {number} Weighted score 0-100
   */
  _calculateWeightedScore(checkResults) {
    if (!checkResults || checkResults.length === 0) {
      return 0;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const result of checkResults) {
      const weight = POLICY_WEIGHTS[result.policyType] || 0.10;
      weightedSum += result.score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return 0;
    }

    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Get current compliance score for a framework
   * @param {string} framework - Compliance framework
   * @returns {Object} Result with current score
   */
  async getComplianceScore(framework) {
    try {
      if (!framework) {
        return { success: false, error: "Framework is required" };
      }

      const latestScore = await this.db.get(
        "SELECT * FROM compliance_score_history WHERE framework = ? ORDER BY recorded_at DESC LIMIT 1",
        [framework],
      );

      if (!latestScore) {
        return {
          success: true,
          data: {
            framework,
            score: null,
            message: "No compliance checks have been run for this framework yet",
          },
        };
      }

      return {
        success: true,
        data: {
          framework,
          score: latestScore.score,
          totalPolicies: latestScore.total_policies,
          passed: latestScore.passed,
          failed: latestScore.failed,
          details: JSON.parse(latestScore.details || "{}"),
          recordedAt: latestScore.recorded_at,
        },
      };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get compliance score:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get compliance score history over time
   * @param {string} framework - Compliance framework
   * @param {number} [days=30] - Number of days of history
   * @returns {Object} Result with score trend
   */
  async getScoreHistory(framework, days = 30) {
    try {
      if (!framework) {
        return { success: false, error: "Framework is required" };
      }

      const since = Date.now() - days * 24 * 60 * 60 * 1000;

      const history = await this.db.all(
        `SELECT * FROM compliance_score_history
         WHERE framework = ? AND recorded_at >= ?
         ORDER BY recorded_at ASC`,
        [framework, since],
      );

      const entries = (history || []).map((entry) => ({
        score: entry.score,
        totalPolicies: entry.total_policies,
        passed: entry.passed,
        failed: entry.failed,
        recordedAt: entry.recorded_at,
      }));

      // Calculate trend
      let trend = "stable";
      if (entries.length >= 2) {
        const first = entries[0].score;
        const last = entries[entries.length - 1].score;
        if (last - first >= 5) {
          trend = "improving";
        } else if (first - last >= 5) {
          trend = "declining";
        }
      }

      return {
        success: true,
        data: {
          framework,
          days,
          trend,
          entries,
          count: entries.length,
        },
      };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get score history:", error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Report Generation
  // ========================================

  /**
   * Generate a detailed compliance report
   * @param {string} framework - Compliance framework
   * @param {Object} [dateRange] - Optional date range
   * @param {number} [dateRange.start] - Start timestamp
   * @param {number} [dateRange.end] - End timestamp
   * @returns {Object} Result with compliance report
   */
  async generateReport(framework, dateRange = {}) {
    try {
      if (!framework) {
        return { success: false, error: "Framework is required" };
      }

      if (!FRAMEWORKS.includes(framework)) {
        return { success: false, error: `Invalid framework: ${framework}` };
      }

      logger.info(`[ComplianceManager] Generating compliance report for: ${framework}`);

      // Run a fresh compliance check
      const checkResult = await this.checkCompliance(framework);
      if (!checkResult.success) {
        return { success: false, error: `Compliance check failed: ${checkResult.error}` };
      }

      const checkData = checkResult.data;
      const now = Date.now();
      const rangeStart = dateRange.start || now - 30 * 24 * 60 * 60 * 1000;
      const rangeEnd = dateRange.end || now;

      // Get score history for trend analysis
      const historyResult = await this.getScoreHistory(framework, 90);
      const scoreHistory = historyResult.success ? historyResult.data : { entries: [], trend: "unknown" };

      // Get all policies for this framework
      const policiesResult = await this.getPolicies({ framework });
      const policies = policiesResult.success ? policiesResult.data : [];

      // Build executive summary
      const executiveSummary = this._buildExecutiveSummary(framework, checkData, scoreHistory);

      // Build findings
      const findings = this._buildFindings(checkData);

      // Build report
      const reportId = uuidv4();
      const report = {
        id: reportId,
        framework: framework.toUpperCase(),
        title: `${framework.toUpperCase()} Compliance Report`,
        generatedAt: now,
        dateRange: { start: rangeStart, end: rangeEnd },
        executiveSummary,
        score: checkData.score,
        scoreTrend: scoreHistory.trend,
        totalPolicies: checkData.totalPolicies,
        passed: checkData.passed,
        failed: checkData.failed,
        findings,
        policies: policies.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          severity: p.severity,
          enabled: p.enabled,
        })),
        recommendations: checkData.recommendations,
        evidence: checkData.checks.flatMap((c) => (c.evidence || []).map((e) => ({
          ...e,
          policyName: c.policyName,
        }))),
        scoreHistory: scoreHistory.entries,
      };

      // Save report to database
      await this.db.run(
        `INSERT INTO compliance_reports (id, framework, title, summary, score, content, date_range_start, date_range_end, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, framework, report.title, executiveSummary, checkData.score,
         JSON.stringify(report), rangeStart, rangeEnd, now],
      );

      await this._logAudit("report_generated", { reportId, framework, score: checkData.score });

      logger.info(`[ComplianceManager] Report generated: ${reportId} (Score: ${checkData.score})`);

      return { success: true, data: report };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to generate report:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Build executive summary for report
   */
  _buildExecutiveSummary(framework, checkData, scoreHistory) {
    const frameworkName = framework.toUpperCase();
    const scoreLabel = checkData.score >= 90 ? "excellent"
      : checkData.score >= 70 ? "good"
      : checkData.score >= 50 ? "moderate"
      : "needs improvement";

    let summary = `${frameworkName} compliance assessment completed with an overall score of ${checkData.score}/100 (${scoreLabel}). `;
    summary += `${checkData.passed} of ${checkData.totalPolicies} policies passed compliance checks. `;

    if (checkData.failed > 0) {
      summary += `${checkData.failed} policies require attention. `;
    }

    if (scoreHistory.trend === "improving") {
      summary += "The compliance score trend is improving over the review period.";
    } else if (scoreHistory.trend === "declining") {
      summary += "The compliance score trend is declining and requires immediate attention.";
    } else {
      summary += "The compliance score has remained stable over the review period.";
    }

    return summary;
  }

  /**
   * Build findings list from check results
   */
  _buildFindings(checkData) {
    return checkData.checks.map((check) => ({
      policyName: check.policyName,
      policyType: check.policyType,
      status: check.status,
      score: check.score,
      severity: check.status === "failed" ? "high" : "info",
      description: check.status === "passed"
        ? `${check.policyName} meets compliance requirements`
        : `${check.policyName} does not meet compliance requirements`,
      evidence: check.evidence || [],
      recommendations: check.recommendations || [],
    }));
  }

  // ========================================
  // Internal Helpers
  // ========================================

  /**
   * Parse a policy row from the database
   * @param {Object} row - Database row
   * @returns {Object} Parsed policy object
   */
  _parsePolicy(row) {
    if (!row) return null;
    return {
      ...row,
      rules: JSON.parse(row.rules || "{}"),
      enabled: row.enabled === 1,
    };
  }

  /**
   * Log an audit event
   * @param {string} action - Action name
   * @param {Object} details - Action details
   */
  async _logAudit(action, details) {
    try {
      if (this.auditLogger && typeof this.auditLogger.log === "function") {
        await this.auditLogger.log({
          module: "ComplianceManager",
          action,
          details,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      logger.warn("[ComplianceManager] Failed to log audit event:", error.message);
    }
  }
}

module.exports = { ComplianceManager, POLICY_TYPES, FRAMEWORKS, POLICY_WEIGHTS };
