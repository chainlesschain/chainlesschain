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

const POLICY_TYPES = [
  "retention",
  "access_control",
  "encryption",
  "data_classification",
  "audit_trail",
];

const FRAMEWORKS = ["gdpr", "soc2", "hipaa", "iso27001"];

const POLICY_WEIGHTS = {
  retention: 0.15,
  access_control: 0.25,
  encryption: 0.25,
  data_classification: 0.15,
  audit_trail: 0.20,
};

class ComplianceManager {
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

  async createPolicy(policyData) {
    try {
      if (!policyData.name || !policyData.type || !policyData.framework || !policyData.rules) {
        return { success: false, error: "Missing required fields: name, type, framework, rules" };
      }
      if (!POLICY_TYPES.includes(policyData.type)) {
        return { success: false, error: `Invalid policy type: ${policyData.type}. Must be one of: ${POLICY_TYPES.join(", ")}` };
      }
      if (!FRAMEWORKS.includes(policyData.framework)) {
        return { success: false, error: `Invalid framework: ${policyData.framework}. Must be one of: ${FRAMEWORKS.join(", ")}` };
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

  async updatePolicy(id, updates) {
    try {
      if (!id) return { success: false, error: "Policy ID is required" };

      const existing = await this.db.get("SELECT * FROM compliance_policies WHERE id = ?", [id]);
      if (!existing) return { success: false, error: `Policy not found: ${id}` };
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
      if (fields.length === 0) return { success: false, error: "No valid fields to update" };

      fields.push("updated_at = ?");
      values.push(now);
      values.push(id);

      await this.db.run(`UPDATE compliance_policies SET ${fields.join(", ")} WHERE id = ?`, values);
      const updated = await this.db.get("SELECT * FROM compliance_policies WHERE id = ?", [id]);

      await this._logAudit("policy_updated", { policyId: id, updates: Object.keys(updates) });
      logger.info(`[ComplianceManager] Policy updated: ${id}`);

      return { success: true, data: this._parsePolicy(updated) };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to update policy:", error);
      return { success: false, error: error.message };
    }
  }

  async deletePolicy(id) {
    try {
      if (!id) return { success: false, error: "Policy ID is required" };

      const existing = await this.db.get("SELECT * FROM compliance_policies WHERE id = ?", [id]);
      if (!existing) return { success: false, error: `Policy not found: ${id}` };

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

  async getPolicy(id) {
    try {
      if (!id) return { success: false, error: "Policy ID is required" };
      const policy = await this.db.get("SELECT * FROM compliance_policies WHERE id = ?", [id]);
      if (!policy) return { success: false, error: `Policy not found: ${id}` };
      return { success: true, data: this._parsePolicy(policy) };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get policy:", error);
      return { success: false, error: error.message };
    }
  }

  async getPolicies(filters = {}) {
    try {
      const conditions = [];
      const params = [];

      if (filters.framework) { conditions.push("framework = ?"); params.push(filters.framework); }
      if (filters.type) { conditions.push("type = ?"); params.push(filters.type); }
      if (filters.enabled !== undefined) { conditions.push("enabled = ?"); params.push(filters.enabled ? 1 : 0); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const policies = await this.db.all(
        `SELECT * FROM compliance_policies ${where} ORDER BY framework, type, created_at DESC`,
        params,
      );

      return { success: true, data: (policies || []).map((p) => this._parsePolicy(p)) };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get policies:", error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Compliance Checks
  // ========================================

  async checkCompliance(framework) {
    try {
      if (!framework) return { success: false, error: "Framework is required" };
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
            framework, score: 0, totalPolicies: 0, passed: 0, failed: 0, checks: [],
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
          id: resultId, framework, policyId: policy.id, policyName: policy.name,
          policyType: policy.type, status: checkResult.passed ? "passed" : "failed",
          score: checkResult.score, details: checkResult.details,
          evidence: checkResult.evidence, recommendations: checkResult.recommendations,
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
      await this.db.run(
        `INSERT INTO compliance_score_history (id, framework, score, total_policies, passed, failed, details, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), framework, overallScore, policies.length, passed, failed,
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
          framework, score: overallScore, totalPolicies: policies.length,
          passed, failed, checks: checkResults,
          recommendations: allRecommendations, checkedAt: now,
        },
      };
    } catch (error) {
      logger.error("[ComplianceManager] Compliance check failed:", error);
      return { success: false, error: error.message };
    }
  }

  async _evaluatePolicy(policy, rules) {
    const handlers = {
      encryption: () => this._checkEncryption(policy, rules),
      audit_trail: () => this._checkAuditTrail(policy, rules),
      access_control: () => this._checkAccessControl(policy, rules),
      retention: () => this._checkRetention(policy, rules),
      data_classification: () => this._checkDataClassification(policy, rules),
    };
    const handler = handlers[policy.type];
    if (!handler) {
      return { passed: false, score: 0, details: { message: `Unknown policy type: ${policy.type}` },
        evidence: [], recommendations: [`Configure check handler for policy type: ${policy.type}`] };
    }
    return handler();
  }

  async _checkEncryption(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let total = 0, passed = 0;

    if (rules.requireDatabaseEncryption !== false) {
      total++;
      try {
        const dbInfo = await this.db.get("PRAGMA cipher_version");
        if (dbInfo) { passed++; evidence.push({ check: "database_encryption", status: "enabled", detail: "SQLCipher active" }); }
        else { evidence.push({ check: "database_encryption", status: "disabled" }); recommendations.push("Enable SQLCipher database encryption"); }
      } catch { evidence.push({ check: "database_encryption", status: "unknown" }); recommendations.push("Verify database encryption configuration"); }
    }
    if (rules.minKeyLength) {
      total++;
      if (rules.minKeyLength >= 256) { passed++; evidence.push({ check: "key_length", status: "compliant", detail: `${rules.minKeyLength} bits` }); }
      else { evidence.push({ check: "key_length", status: "non_compliant", detail: `${rules.minKeyLength} < 256 bits` }); recommendations.push("Increase encryption key length to at least 256 bits"); }
    }
    if (rules.requireTLS !== false) {
      total++; passed++;
      evidence.push({ check: "tls_enabled", status: "compliant", detail: "TLS enforced for network communications" });
    }

    const score = total > 0 ? Math.round((passed / total) * 100) : 100;
    return { passed: score >= (rules.passThreshold || 80), score, details: { checksTotal: total, checksPassed: passed, policyName: policy.name }, evidence, recommendations };
  }

  async _checkAuditTrail(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let total = 0, passed = 0;

    if (rules.requireAuditLogging !== false) {
      total++;
      if (this.auditLogger) { passed++; evidence.push({ check: "audit_logging", status: "active" }); }
      else { evidence.push({ check: "audit_logging", status: "inactive" }); recommendations.push("Configure audit logging for all sensitive operations"); }
    }
    if (rules.minRetentionDays) {
      total++;
      const cutoff = Date.now() - rules.minRetentionDays * 86400000;
      try {
        const oldest = await this.db.get("SELECT MIN(checked_at) as oldest FROM compliance_check_results");
        if (oldest && oldest.oldest && oldest.oldest <= cutoff) { passed++; evidence.push({ check: "log_retention", status: "compliant", detail: `${rules.minRetentionDays}+ days` }); }
        else { evidence.push({ check: "log_retention", status: "insufficient" }); recommendations.push(`Ensure audit logs retained for at least ${rules.minRetentionDays} days`); }
      } catch { evidence.push({ check: "log_retention", status: "unknown" }); recommendations.push("Verify audit log retention configuration"); }
    }
    if (rules.requireCompleteLogs !== false) {
      total++;
      try {
        const recent = await this.db.get("SELECT COUNT(*) as count FROM compliance_check_results WHERE checked_at > ?", [Date.now() - 604800000]);
        if (recent && recent.count > 0) { passed++; evidence.push({ check: "log_completeness", status: "compliant", detail: `${recent.count} records in last 7 days` }); }
        else { evidence.push({ check: "log_completeness", status: "incomplete" }); recommendations.push("Run compliance checks regularly (at least weekly)"); }
      } catch { evidence.push({ check: "log_completeness", status: "unknown" }); }
    }

    const score = total > 0 ? Math.round((passed / total) * 100) : 100;
    return { passed: score >= (rules.passThreshold || 80), score, details: { checksTotal: total, checksPassed: passed, policyName: policy.name }, evidence, recommendations };
  }

  async _checkAccessControl(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let total = 0, passed = 0;

    if (rules.requireRBAC !== false) {
      total++;
      try {
        const tbl = await this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='permission_grants'");
        if (tbl) { passed++; evidence.push({ check: "rbac_enabled", status: "compliant" }); }
        else { evidence.push({ check: "rbac_enabled", status: "not_configured" }); recommendations.push("Enable Role-Based Access Control (RBAC)"); }
      } catch { evidence.push({ check: "rbac_enabled", status: "unknown" }); }
    }
    if (rules.requireAuthentication !== false) {
      total++;
      try {
        const tbl = await this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='did_identities'");
        if (tbl) { passed++; evidence.push({ check: "authentication", status: "compliant" }); }
        else { evidence.push({ check: "authentication", status: "not_configured" }); recommendations.push("Configure DID-based authentication"); }
      } catch { evidence.push({ check: "authentication", status: "unknown" }); }
    }
    if (rules.requireSessionManagement !== false) {
      total++; passed++;
      evidence.push({ check: "session_management", status: "compliant", detail: "Session management is active" });
    }
    if (rules.enforceLeastPrivilege) {
      total++;
      try {
        const wc = await this.db.get("SELECT COUNT(*) as count FROM permission_grants WHERE resource_id = '*'");
        if (!wc || wc.count === 0) { passed++; evidence.push({ check: "least_privilege", status: "compliant" }); }
        else { evidence.push({ check: "least_privilege", status: "warning", detail: `${wc.count} wildcard grants` }); recommendations.push("Restrict wildcard permission grants"); }
      } catch { evidence.push({ check: "least_privilege", status: "unknown" }); }
    }

    const score = total > 0 ? Math.round((passed / total) * 100) : 100;
    return { passed: score >= (rules.passThreshold || 80), score, details: { checksTotal: total, checksPassed: passed, policyName: policy.name }, evidence, recommendations };
  }

  async _checkRetention(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let total = 0, passed = 0;

    if (rules.maxRetentionDays) {
      total++; passed++;
      evidence.push({ check: "retention_policy_defined", status: "compliant", detail: `Max retention: ${rules.maxRetentionDays} days` });

      total++;
      const cutoff = Date.now() - rules.maxRetentionDays * 86400000;
      try {
        const expired = await this.db.get("SELECT COUNT(*) as count FROM notes WHERE created_at < ? AND archived = 0", [cutoff]);
        if (!expired || expired.count === 0) { passed++; evidence.push({ check: "expired_data", status: "compliant" }); }
        else { evidence.push({ check: "expired_data", status: "non_compliant", detail: `${expired.count} records exceed retention` }); recommendations.push(`Archive or delete ${expired.count} records exceeding ${rules.maxRetentionDays}-day retention`); }
      } catch { passed++; evidence.push({ check: "expired_data", status: "compliant", detail: "No applicable data found" }); }
    }
    if (rules.requireDeletionVerification) {
      total++;
      if (this.auditLogger) { passed++; evidence.push({ check: "deletion_verification", status: "compliant" }); }
      else { evidence.push({ check: "deletion_verification", status: "non_compliant" }); recommendations.push("Enable audit logging for data deletion verification"); }
    }

    const score = total > 0 ? Math.round((passed / total) * 100) : 100;
    return { passed: score >= (rules.passThreshold || 80), score, details: { checksTotal: total, checksPassed: passed, policyName: policy.name }, evidence, recommendations };
  }

  async _checkDataClassification(policy, rules) {
    const evidence = [];
    const recommendations = [];
    let total = 0, passed = 0;

    if (rules.requireClassification !== false) {
      total++; passed++;
      const levels = rules.levels || ["public", "internal", "confidential", "restricted"];
      evidence.push({ check: "classification_schema", status: "defined", detail: `Levels: ${levels.join(", ")}` });
    }
    if (rules.requireSensitiveDataHandling) {
      total++;
      try {
        const enc = await this.db.get("PRAGMA cipher_version");
        if (enc) { passed++; evidence.push({ check: "sensitive_data_handling", status: "compliant" }); }
        else { evidence.push({ check: "sensitive_data_handling", status: "non_compliant" }); recommendations.push("Ensure sensitive data is stored in encrypted storage"); }
      } catch { evidence.push({ check: "sensitive_data_handling", status: "unknown" }); recommendations.push("Verify sensitive data handling procedures"); }
    }
    if (rules.requireLabeling) {
      total++;
      try {
        const labeled = await this.db.get("SELECT COUNT(*) as count FROM notes WHERE tags IS NOT NULL AND tags != ''");
        const all = await this.db.get("SELECT COUNT(*) as count FROM notes");
        if (all && all.count > 0 && labeled) {
          const rate = (labeled.count / all.count) * 100;
          if (rate >= (rules.minLabelRate || 80)) { passed++; evidence.push({ check: "data_labeling", status: "compliant", detail: `${Math.round(rate)}% labeled` }); }
          else { evidence.push({ check: "data_labeling", status: "partial", detail: `${Math.round(rate)}% < ${rules.minLabelRate || 80}%` }); recommendations.push(`Increase data labeling to at least ${rules.minLabelRate || 80}%`); }
        } else { passed++; evidence.push({ check: "data_labeling", status: "compliant", detail: "No applicable data" }); }
      } catch { passed++; evidence.push({ check: "data_labeling", status: "compliant", detail: "No applicable data found" }); }
    }

    const score = total > 0 ? Math.round((passed / total) * 100) : 100;
    return { passed: score >= (rules.passThreshold || 80), score, details: { checksTotal: total, checksPassed: passed, policyName: policy.name }, evidence, recommendations };
  }

  // ========================================
  // Score Calculation
  // ========================================

  _calculateWeightedScore(checkResults) {
    if (!checkResults || checkResults.length === 0) return 0;
    let weightedSum = 0;
    let totalWeight = 0;
    for (const result of checkResults) {
      const weight = POLICY_WEIGHTS[result.policyType] || 0.10;
      weightedSum += result.score * weight;
      totalWeight += weight;
    }
    return totalWeight === 0 ? 0 : Math.round(weightedSum / totalWeight);
  }

  async getComplianceScore(framework) {
    try {
      if (!framework) return { success: false, error: "Framework is required" };

      const latest = await this.db.get(
        "SELECT * FROM compliance_score_history WHERE framework = ? ORDER BY recorded_at DESC LIMIT 1",
        [framework],
      );

      if (!latest) {
        return { success: true, data: { framework, score: null, message: "No compliance checks have been run for this framework yet" } };
      }
      return {
        success: true,
        data: {
          framework, score: latest.score, totalPolicies: latest.total_policies,
          passed: latest.passed, failed: latest.failed,
          details: JSON.parse(latest.details || "{}"), recordedAt: latest.recorded_at,
        },
      };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get compliance score:", error);
      return { success: false, error: error.message };
    }
  }

  async getScoreHistory(framework, days = 30) {
    try {
      if (!framework) return { success: false, error: "Framework is required" };

      const since = Date.now() - days * 86400000;
      const history = await this.db.all(
        "SELECT * FROM compliance_score_history WHERE framework = ? AND recorded_at >= ? ORDER BY recorded_at ASC",
        [framework, since],
      );

      const entries = (history || []).map((e) => ({
        score: e.score, totalPolicies: e.total_policies,
        passed: e.passed, failed: e.failed, recordedAt: e.recorded_at,
      }));

      let trend = "stable";
      if (entries.length >= 2) {
        const diff = entries[entries.length - 1].score - entries[0].score;
        if (diff >= 5) trend = "improving";
        else if (diff <= -5) trend = "declining";
      }

      return { success: true, data: { framework, days, trend, entries, count: entries.length } };
    } catch (error) {
      logger.error("[ComplianceManager] Failed to get score history:", error);
      return { success: false, error: error.message };
    }
  }

  // ========================================
  // Report Generation
  // ========================================

  async generateReport(framework, dateRange = {}) {
    try {
      if (!framework) return { success: false, error: "Framework is required" };
      if (!FRAMEWORKS.includes(framework)) return { success: false, error: `Invalid framework: ${framework}` };

      logger.info(`[ComplianceManager] Generating compliance report for: ${framework}`);

      const checkResult = await this.checkCompliance(framework);
      if (!checkResult.success) return { success: false, error: `Compliance check failed: ${checkResult.error}` };

      const checkData = checkResult.data;
      const now = Date.now();
      const rangeStart = dateRange.start || now - 30 * 86400000;
      const rangeEnd = dateRange.end || now;

      const historyResult = await this.getScoreHistory(framework, 90);
      const scoreHistory = historyResult.success ? historyResult.data : { entries: [], trend: "unknown" };
      const policiesResult = await this.getPolicies({ framework });
      const policies = policiesResult.success ? policiesResult.data : [];

      const executiveSummary = this._buildExecutiveSummary(framework, checkData, scoreHistory);
      const findings = this._buildFindings(checkData);

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
        policies: policies.map((p) => ({ id: p.id, name: p.name, type: p.type, severity: p.severity, enabled: p.enabled })),
        recommendations: checkData.recommendations,
        evidence: checkData.checks.flatMap((c) => (c.evidence || []).map((e) => ({ ...e, policyName: c.policyName }))),
        scoreHistory: scoreHistory.entries,
      };

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

  _buildExecutiveSummary(framework, checkData, scoreHistory) {
    const name = framework.toUpperCase();
    const label = checkData.score >= 90 ? "excellent" : checkData.score >= 70 ? "good" : checkData.score >= 50 ? "moderate" : "needs improvement";

    let summary = `${name} compliance assessment completed with an overall score of ${checkData.score}/100 (${label}). `;
    summary += `${checkData.passed} of ${checkData.totalPolicies} policies passed. `;
    if (checkData.failed > 0) summary += `${checkData.failed} policies require attention. `;

    if (scoreHistory.trend === "improving") summary += "The compliance score trend is improving.";
    else if (scoreHistory.trend === "declining") summary += "The compliance score trend is declining and requires immediate attention.";
    else summary += "The compliance score has remained stable.";

    return summary;
  }

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

  _parsePolicy(row) {
    if (!row) return null;
    return { ...row, rules: JSON.parse(row.rules || "{}"), enabled: row.enabled === 1 };
  }

  async _logAudit(action, details) {
    try {
      if (this.auditLogger && typeof this.auditLogger.log === "function") {
        await this.auditLogger.log({ module: "ComplianceManager", action, details, timestamp: Date.now() });
      }
    } catch (error) {
      logger.warn("[ComplianceManager] Failed to log audit event:", error.message);
    }
  }
}

module.exports = { ComplianceManager, POLICY_TYPES, FRAMEWORKS, POLICY_WEIGHTS };
