/**
 * Compliance Manager — evidence collection, report generation,
 * data classification, compliance scanning, and policy management.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _evidence = new Map();
const _reports = new Map();
const _policies = new Map();

const FRAMEWORKS = ["gdpr", "soc2", "hipaa", "iso27001"];
const POLICY_TYPES = [
  "retention",
  "access_control",
  "encryption",
  "data_classification",
  "audit_trail",
];

/* ── Schema ────────────────────────────────────────────────── */

export function ensureComplianceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_evidence (
      id TEXT PRIMARY KEY,
      framework TEXT NOT NULL,
      type TEXT,
      description TEXT,
      source TEXT,
      status TEXT DEFAULT 'collected',
      collected_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_reports (
      id TEXT PRIMARY KEY,
      framework TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      score REAL DEFAULT 0,
      content TEXT,
      generated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS compliance_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      framework TEXT,
      rules TEXT,
      enabled INTEGER DEFAULT 1,
      severity TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Evidence Collection ──────────────────────────────────── */

export function collectEvidence(db, framework, type, description, source) {
  if (!framework) throw new Error("Framework is required");
  if (!FRAMEWORKS.includes(framework)) {
    throw new Error(
      `Unknown framework: ${framework}. Valid: ${FRAMEWORKS.join(", ")}`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const evidence = {
    id,
    framework,
    type: type || "general",
    description: description || "",
    source: source || "cli",
    status: "collected",
    collectedAt: now,
  };

  _evidence.set(id, evidence);

  db.prepare(
    `INSERT INTO compliance_evidence (id, framework, type, description, source, status, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    framework,
    evidence.type,
    evidence.description,
    evidence.source,
    "collected",
    now,
  );

  return evidence;
}

/* ── Report Generation ────────────────────────────────────── */

export function generateReport(db, framework, title) {
  if (!framework) throw new Error("Framework is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const evidenceList = [..._evidence.values()].filter(
    (e) => e.framework === framework,
  );
  const policyList = [..._policies.values()].filter(
    (p) => p.framework === framework && p.enabled,
  );

  const score =
    policyList.length > 0 ? Math.min(100, evidenceList.length * 20) : 0;

  const report = {
    id,
    framework,
    title: title || `${framework.toUpperCase()} Compliance Report`,
    summary: `${evidenceList.length} evidence items, ${policyList.length} active policies`,
    score,
    content: { evidence: evidenceList.length, policies: policyList.length },
    generatedAt: now,
  };

  _reports.set(id, report);

  db.prepare(
    `INSERT INTO compliance_reports (id, framework, title, summary, score, content, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    framework,
    report.title,
    report.summary,
    score,
    JSON.stringify(report.content),
    now,
  );

  return report;
}

/* ── Data Classification ────────────────────────────────────── */

export function classifyData(content) {
  if (!content) throw new Error("Content is required");

  const patterns = {
    pii: /\b\d{3}-\d{2}-\d{4}\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i,
    financial:
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\baccount\s*#?\s*\d+/i,
    health: /\bdiagnosis\b|\bpatient\b|\bmedical\b|\bprescription\b/i,
  };

  const classifications = [];
  for (const [type, regex] of Object.entries(patterns)) {
    if (regex.test(content)) {
      classifications.push(type);
    }
  }

  return {
    hasClassifiedData: classifications.length > 0,
    classifications,
    sensitivity:
      classifications.length > 1
        ? "high"
        : classifications.length === 1
          ? "medium"
          : "low",
  };
}

/* ── Compliance Scanning ──────────────────────────────────── */

export function scanCompliance(db, framework) {
  if (!framework) throw new Error("Framework is required");

  const policies = [..._policies.values()].filter(
    (p) => p.framework === framework && p.enabled,
  );
  const evidence = [..._evidence.values()].filter(
    (e) => e.framework === framework,
  );

  const checks = policies.map((policy) => {
    const relatedEvidence = evidence.filter((e) => e.type === policy.type);
    return {
      policyId: policy.id,
      policyName: policy.name,
      status: relatedEvidence.length > 0 ? "pass" : "fail",
      evidenceCount: relatedEvidence.length,
    };
  });

  const passed = checks.filter((c) => c.status === "pass").length;
  const total = checks.length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;

  return { framework, score, total, passed, failed: total - passed, checks };
}

/* ── Policy Management ────────────────────────────────────── */

export function listPolicies(db, filter = {}) {
  let policies = [..._policies.values()];
  if (filter.framework) {
    policies = policies.filter((p) => p.framework === filter.framework);
  }
  if (filter.type) {
    policies = policies.filter((p) => p.type === filter.type);
  }
  return policies;
}

export function addPolicy(db, name, type, framework, rules, severity) {
  if (!name) throw new Error("Policy name is required");
  if (!POLICY_TYPES.includes(type)) {
    throw new Error(
      `Invalid policy type: ${type}. Valid: ${POLICY_TYPES.join(", ")}`,
    );
  }
  if (!FRAMEWORKS.includes(framework)) {
    throw new Error(`Invalid framework: ${framework}`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const policy = {
    id,
    name,
    type,
    framework,
    rules: rules || {},
    enabled: true,
    severity: severity || "medium",
    createdAt: now,
  };

  _policies.set(id, policy);

  db.prepare(
    `INSERT INTO compliance_policies (id, name, type, framework, rules, enabled, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    type,
    framework,
    JSON.stringify(rules || {}),
    1,
    policy.severity,
    now,
  );

  return policy;
}

/* ── Access Check ─────────────────────────────────────────── */

export function checkAccess(resource, action, role) {
  // Simplified RBAC check
  const allowedRoles = {
    admin: ["read", "write", "delete", "audit"],
    auditor: ["read", "audit"],
    user: ["read"],
  };

  const allowed = allowedRoles[role] || [];
  return {
    resource,
    action,
    role,
    granted: allowed.includes(action),
  };
}

/* ═══════════════════════════════════════════════════════════════
   V2 SURFACE (Phase 19 canonical) — strictly additive
   ═══════════════════════════════════════════════════════════════ */

export const EVIDENCE_STATUS_V2 = Object.freeze({
  COLLECTED: "collected",
  VERIFIED: "verified",
  REJECTED: "rejected",
  EXPIRED: "expired",
});

export const POLICY_STATUS_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DEPRECATED: "deprecated",
});

export const REPORT_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  GENERATING: "generating",
  PUBLISHED: "published",
  ARCHIVED: "archived",
});

export const SEVERITY_V2 = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

export const FRAMEWORKS_V2 = Object.freeze([
  "gdpr",
  "soc2",
  "hipaa",
  "iso27001",
]);
export const POLICY_TYPES_V2 = Object.freeze([
  "retention",
  "access_control",
  "encryption",
  "data_classification",
  "audit_trail",
]);

export const COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES = 20;
export const COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS =
  180 * 24 * 60 * 60 * 1000; // 180 days
export const COMPLIANCE_DEFAULT_REPORT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 365 days

let _maxActivePolicies = COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES;
let _evidenceRetentionMs = COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS;
let _reportRetentionMs = COMPLIANCE_DEFAULT_REPORT_RETENTION_MS;

const _evidenceStatesV2 = new Map();
const _policyStatesV2 = new Map();
const _reportStatesV2 = new Map();

const EVIDENCE_TRANSITIONS_V2 = new Map([
  ["collected", new Set(["verified", "rejected", "expired"])],
  ["verified", new Set(["expired"])],
  ["rejected", new Set(["expired"])],
]);
const EVIDENCE_TERMINALS_V2 = new Set(["expired"]);

const POLICY_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["active", "deprecated"])],
  ["active", new Set(["suspended", "deprecated"])],
  ["suspended", new Set(["active", "deprecated"])],
]);
const POLICY_TERMINALS_V2 = new Set(["deprecated"]);

const REPORT_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["generating", "archived"])],
  ["generating", new Set(["published", "archived"])],
  ["published", new Set(["archived"])],
]);
const REPORT_TERMINALS_V2 = new Set(["archived"]);

function _positiveInt(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(v);
}

export function setMaxActivePolicies(n) {
  _maxActivePolicies = _positiveInt(n, "maxActivePolicies");
  return _maxActivePolicies;
}

export function setEvidenceRetentionMs(ms) {
  _evidenceRetentionMs = _positiveInt(ms, "evidenceRetentionMs");
  return _evidenceRetentionMs;
}

export function setReportRetentionMs(ms) {
  _reportRetentionMs = _positiveInt(ms, "reportRetentionMs");
  return _reportRetentionMs;
}

export function getMaxActivePolicies() {
  return _maxActivePolicies;
}

export function getEvidenceRetentionMs() {
  return _evidenceRetentionMs;
}

export function getReportRetentionMs() {
  return _reportRetentionMs;
}

export function getActivePolicyCount(framework) {
  let count = 0;
  for (const entry of _policyStatesV2.values()) {
    if (entry.status === POLICY_STATUS_V2.ACTIVE) {
      if (!framework || entry.framework === framework) count += 1;
    }
  }
  return count;
}

/* ── Evidence V2 ────────────────────────────────────────────── */

export function registerEvidenceV2(
  db,
  { evidenceId, framework, type, description, source, metadata } = {},
) {
  if (!evidenceId) throw new Error("evidenceId is required");
  if (!framework) throw new Error("framework is required");
  if (!FRAMEWORKS_V2.includes(framework)) {
    throw new Error(
      `Invalid framework: ${framework}. Valid: ${FRAMEWORKS_V2.join(", ")}`,
    );
  }
  if (_evidenceStatesV2.has(evidenceId)) {
    throw new Error(`Evidence already registered: ${evidenceId}`);
  }
  const now = Date.now();
  const entry = {
    evidenceId,
    framework,
    type: type || "general",
    description: description || "",
    source: source || "cli",
    status: EVIDENCE_STATUS_V2.COLLECTED,
    metadata: metadata || {},
    reason: null,
    createdAt: now,
    updatedAt: now,
  };
  _evidenceStatesV2.set(evidenceId, entry);
  return { ...entry };
}

export function getEvidenceStatusV2(evidenceId) {
  const entry = _evidenceStatesV2.get(evidenceId);
  return entry ? { ...entry } : null;
}

export function setEvidenceStatusV2(db, evidenceId, newStatus, patch = {}) {
  const entry = _evidenceStatesV2.get(evidenceId);
  if (!entry) throw new Error(`Evidence not found: ${evidenceId}`);
  if (!Object.values(EVIDENCE_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid evidence status: ${newStatus}`);
  }
  if (EVIDENCE_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Evidence is terminal: ${entry.status}`);
  }
  const allowed = EVIDENCE_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function autoExpireEvidence(db, nowMs = Date.now()) {
  const expired = [];
  for (const entry of _evidenceStatesV2.values()) {
    if (EVIDENCE_TERMINALS_V2.has(entry.status)) continue;
    if (nowMs - entry.createdAt > _evidenceRetentionMs) {
      entry.status = EVIDENCE_STATUS_V2.EXPIRED;
      entry.updatedAt = nowMs;
      entry.reason = "auto-expired: retention exceeded";
      expired.push({ ...entry });
    }
  }
  return expired;
}

/* ── Policy V2 ──────────────────────────────────────────────── */

export function registerPolicyV2(
  db,
  { policyId, name, type, framework, severity, rules, metadata } = {},
) {
  if (!policyId) throw new Error("policyId is required");
  if (!name) throw new Error("name is required");
  if (!POLICY_TYPES_V2.includes(type)) {
    throw new Error(
      `Invalid policy type: ${type}. Valid: ${POLICY_TYPES_V2.join(", ")}`,
    );
  }
  if (!FRAMEWORKS_V2.includes(framework)) {
    throw new Error(
      `Invalid framework: ${framework}. Valid: ${FRAMEWORKS_V2.join(", ")}`,
    );
  }
  const sev = severity || SEVERITY_V2.MEDIUM;
  if (!Object.values(SEVERITY_V2).includes(sev)) {
    throw new Error(`Invalid severity: ${sev}`);
  }
  if (_policyStatesV2.has(policyId)) {
    throw new Error(`Policy already registered: ${policyId}`);
  }
  const now = Date.now();
  const entry = {
    policyId,
    name,
    type,
    framework,
    severity: sev,
    rules: rules || {},
    status: POLICY_STATUS_V2.DRAFT,
    metadata: metadata || {},
    reason: null,
    createdAt: now,
    updatedAt: now,
  };
  _policyStatesV2.set(policyId, entry);
  return { ...entry };
}

export function getPolicyStatusV2(policyId) {
  const entry = _policyStatesV2.get(policyId);
  return entry ? { ...entry } : null;
}

export function setPolicyStatusV2(db, policyId, newStatus, patch = {}) {
  const entry = _policyStatesV2.get(policyId);
  if (!entry) throw new Error(`Policy not found: ${policyId}`);
  if (!Object.values(POLICY_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid policy status: ${newStatus}`);
  }
  if (POLICY_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Policy is terminal: ${entry.status}`);
  }
  const allowed = POLICY_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  if (newStatus === POLICY_STATUS_V2.ACTIVE) {
    const activeCount = getActivePolicyCount(entry.framework);
    if (
      entry.status !== POLICY_STATUS_V2.ACTIVE &&
      activeCount >= _maxActivePolicies
    ) {
      throw new Error(
        `Max active policies reached (${activeCount}/${_maxActivePolicies}) for framework ${entry.framework}`,
      );
    }
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function activatePolicy(db, policyId) {
  return setPolicyStatusV2(db, policyId, POLICY_STATUS_V2.ACTIVE);
}

/* ── Report V2 ──────────────────────────────────────────────── */

export function registerReportV2(
  db,
  { reportId, framework, title, metadata } = {},
) {
  if (!reportId) throw new Error("reportId is required");
  if (!framework) throw new Error("framework is required");
  if (!FRAMEWORKS_V2.includes(framework)) {
    throw new Error(`Invalid framework: ${framework}`);
  }
  if (_reportStatesV2.has(reportId)) {
    throw new Error(`Report already registered: ${reportId}`);
  }
  const now = Date.now();
  const entry = {
    reportId,
    framework,
    title: title || `${framework.toUpperCase()} Compliance Report`,
    status: REPORT_STATUS_V2.PENDING,
    score: 0,
    summary: "",
    metadata: metadata || {},
    reason: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  _reportStatesV2.set(reportId, entry);
  return { ...entry };
}

export function getReportStatusV2(reportId) {
  const entry = _reportStatesV2.get(reportId);
  return entry ? { ...entry } : null;
}

export function setReportStatusV2(db, reportId, newStatus, patch = {}) {
  const entry = _reportStatesV2.get(reportId);
  if (!entry) throw new Error(`Report not found: ${reportId}`);
  if (!Object.values(REPORT_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid report status: ${newStatus}`);
  }
  if (REPORT_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Report is terminal: ${entry.status}`);
  }
  const allowed = REPORT_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (newStatus === REPORT_STATUS_V2.PUBLISHED) {
    entry.publishedAt = entry.updatedAt;
    if (typeof patch.score === "number") entry.score = patch.score;
    if (typeof patch.summary === "string") entry.summary = patch.summary;
  }
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function publishReport(db, reportId, { score, summary } = {}) {
  const entry = _reportStatesV2.get(reportId);
  if (!entry) throw new Error(`Report not found: ${reportId}`);
  if (entry.status === REPORT_STATUS_V2.PENDING) {
    setReportStatusV2(db, reportId, REPORT_STATUS_V2.GENERATING);
  }
  return setReportStatusV2(db, reportId, REPORT_STATUS_V2.PUBLISHED, {
    score,
    summary,
  });
}

export function autoArchiveStaleReports(db, nowMs = Date.now()) {
  const archived = [];
  for (const entry of _reportStatesV2.values()) {
    if (entry.status !== REPORT_STATUS_V2.PUBLISHED) continue;
    if (!entry.publishedAt) continue;
    if (nowMs - entry.publishedAt > _reportRetentionMs) {
      entry.status = REPORT_STATUS_V2.ARCHIVED;
      entry.updatedAt = nowMs;
      entry.reason = "auto-archived: retention exceeded";
      archived.push({ ...entry });
    }
  }
  return archived;
}

/* ── Stats V2 ───────────────────────────────────────────────── */

export function getComplianceStatsV2() {
  const evidenceByStatus = {
    collected: 0,
    verified: 0,
    rejected: 0,
    expired: 0,
  };
  const policyByStatus = {
    draft: 0,
    active: 0,
    suspended: 0,
    deprecated: 0,
  };
  const reportByStatus = {
    pending: 0,
    generating: 0,
    published: 0,
    archived: 0,
  };
  const policyBySeverity = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const entry of _evidenceStatesV2.values()) {
    if (evidenceByStatus[entry.status] !== undefined)
      evidenceByStatus[entry.status] += 1;
  }
  for (const entry of _policyStatesV2.values()) {
    if (policyByStatus[entry.status] !== undefined)
      policyByStatus[entry.status] += 1;
    if (policyBySeverity[entry.severity] !== undefined)
      policyBySeverity[entry.severity] += 1;
  }
  for (const entry of _reportStatesV2.values()) {
    if (reportByStatus[entry.status] !== undefined)
      reportByStatus[entry.status] += 1;
  }

  return {
    totalEvidence: _evidenceStatesV2.size,
    totalPolicies: _policyStatesV2.size,
    activePolicies: policyByStatus.active,
    totalReports: _reportStatesV2.size,
    publishedReports: reportByStatus.published,
    maxActivePolicies: _maxActivePolicies,
    evidenceRetentionMs: _evidenceRetentionMs,
    reportRetentionMs: _reportRetentionMs,
    evidenceByStatus,
    policyByStatus,
    reportByStatus,
    policyBySeverity,
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _evidence.clear();
  _reports.clear();
  _policies.clear();
  _evidenceStatesV2.clear();
  _policyStatesV2.clear();
  _reportStatesV2.clear();
  _maxActivePolicies = COMPLIANCE_DEFAULT_MAX_ACTIVE_POLICIES;
  _evidenceRetentionMs = COMPLIANCE_DEFAULT_EVIDENCE_RETENTION_MS;
  _reportRetentionMs = COMPLIANCE_DEFAULT_REPORT_RETENTION_MS;
}

// =====================================================================
// compliance-manager V2 governance overlay (iter17)
// =====================================================================
export const CMGR_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
});
export const CMGR_AUDIT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  AUDITING: "auditing",
  AUDITED: "audited",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cmgrPTrans = new Map([
  [
    CMGR_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CMGR_PROFILE_MATURITY_V2.ACTIVE,
      CMGR_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CMGR_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CMGR_PROFILE_MATURITY_V2.DEPRECATED,
      CMGR_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CMGR_PROFILE_MATURITY_V2.DEPRECATED,
    new Set([
      CMGR_PROFILE_MATURITY_V2.ACTIVE,
      CMGR_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CMGR_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cmgrPTerminal = new Set([CMGR_PROFILE_MATURITY_V2.ARCHIVED]);
const _cmgrJTrans = new Map([
  [
    CMGR_AUDIT_LIFECYCLE_V2.QUEUED,
    new Set([
      CMGR_AUDIT_LIFECYCLE_V2.AUDITING,
      CMGR_AUDIT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CMGR_AUDIT_LIFECYCLE_V2.AUDITING,
    new Set([
      CMGR_AUDIT_LIFECYCLE_V2.AUDITED,
      CMGR_AUDIT_LIFECYCLE_V2.FAILED,
      CMGR_AUDIT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CMGR_AUDIT_LIFECYCLE_V2.AUDITED, new Set()],
  [CMGR_AUDIT_LIFECYCLE_V2.FAILED, new Set()],
  [CMGR_AUDIT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cmgrPsV2 = new Map();
const _cmgrJsV2 = new Map();
let _cmgrMaxActive = 8,
  _cmgrMaxPending = 20,
  _cmgrIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cmgrStuckMs = 60 * 1000;
function _cmgrPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cmgrCheckP(from, to) {
  const a = _cmgrPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cmgr profile transition ${from} → ${to}`);
}
function _cmgrCheckJ(from, to) {
  const a = _cmgrJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cmgr audit transition ${from} → ${to}`);
}
function _cmgrCountActive(owner) {
  let c = 0;
  for (const p of _cmgrPsV2.values())
    if (p.owner === owner && p.status === CMGR_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _cmgrCountPending(profileId) {
  let c = 0;
  for (const j of _cmgrJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CMGR_AUDIT_LIFECYCLE_V2.QUEUED ||
        j.status === CMGR_AUDIT_LIFECYCLE_V2.AUDITING)
    )
      c++;
  return c;
}
export function setMaxActiveCmgrProfilesPerOwnerV2(n) {
  _cmgrMaxActive = _cmgrPos(n, "maxActiveCmgrProfilesPerOwner");
}
export function getMaxActiveCmgrProfilesPerOwnerV2() {
  return _cmgrMaxActive;
}
export function setMaxPendingCmgrAuditsPerProfileV2(n) {
  _cmgrMaxPending = _cmgrPos(n, "maxPendingCmgrAuditsPerProfile");
}
export function getMaxPendingCmgrAuditsPerProfileV2() {
  return _cmgrMaxPending;
}
export function setCmgrProfileIdleMsV2(n) {
  _cmgrIdleMs = _cmgrPos(n, "cmgrProfileIdleMs");
}
export function getCmgrProfileIdleMsV2() {
  return _cmgrIdleMs;
}
export function setCmgrAuditStuckMsV2(n) {
  _cmgrStuckMs = _cmgrPos(n, "cmgrAuditStuckMs");
}
export function getCmgrAuditStuckMsV2() {
  return _cmgrStuckMs;
}
export function _resetStateComplianceManagerV2() {
  _cmgrPsV2.clear();
  _cmgrJsV2.clear();
  _cmgrMaxActive = 8;
  _cmgrMaxPending = 20;
  _cmgrIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cmgrStuckMs = 60 * 1000;
}
export function registerCmgrProfileV2({ id, owner, framework, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cmgrPsV2.has(id)) throw new Error(`cmgr profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    framework: framework || "soc2",
    status: CMGR_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cmgrPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCmgrProfileV2(id) {
  const p = _cmgrPsV2.get(id);
  if (!p) throw new Error(`cmgr profile ${id} not found`);
  const isInitial = p.status === CMGR_PROFILE_MATURITY_V2.PENDING;
  _cmgrCheckP(p.status, CMGR_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cmgrCountActive(p.owner) >= _cmgrMaxActive)
    throw new Error(`max active cmgr profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CMGR_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function deprecateCmgrProfileV2(id) {
  const p = _cmgrPsV2.get(id);
  if (!p) throw new Error(`cmgr profile ${id} not found`);
  _cmgrCheckP(p.status, CMGR_PROFILE_MATURITY_V2.DEPRECATED);
  p.status = CMGR_PROFILE_MATURITY_V2.DEPRECATED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCmgrProfileV2(id) {
  const p = _cmgrPsV2.get(id);
  if (!p) throw new Error(`cmgr profile ${id} not found`);
  _cmgrCheckP(p.status, CMGR_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CMGR_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCmgrProfileV2(id) {
  const p = _cmgrPsV2.get(id);
  if (!p) throw new Error(`cmgr profile ${id} not found`);
  if (_cmgrPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cmgr profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCmgrProfileV2(id) {
  const p = _cmgrPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCmgrProfilesV2() {
  return [..._cmgrPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCmgrAuditV2({ id, profileId, control, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cmgrJsV2.has(id)) throw new Error(`cmgr audit ${id} already exists`);
  if (!_cmgrPsV2.has(profileId))
    throw new Error(`cmgr profile ${profileId} not found`);
  if (_cmgrCountPending(profileId) >= _cmgrMaxPending)
    throw new Error(`max pending cmgr audits for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    control: control || "",
    status: CMGR_AUDIT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cmgrJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function auditingCmgrAuditV2(id) {
  const j = _cmgrJsV2.get(id);
  if (!j) throw new Error(`cmgr audit ${id} not found`);
  _cmgrCheckJ(j.status, CMGR_AUDIT_LIFECYCLE_V2.AUDITING);
  const now = Date.now();
  j.status = CMGR_AUDIT_LIFECYCLE_V2.AUDITING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeAuditCmgrV2(id) {
  const j = _cmgrJsV2.get(id);
  if (!j) throw new Error(`cmgr audit ${id} not found`);
  _cmgrCheckJ(j.status, CMGR_AUDIT_LIFECYCLE_V2.AUDITED);
  const now = Date.now();
  j.status = CMGR_AUDIT_LIFECYCLE_V2.AUDITED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCmgrAuditV2(id, reason) {
  const j = _cmgrJsV2.get(id);
  if (!j) throw new Error(`cmgr audit ${id} not found`);
  _cmgrCheckJ(j.status, CMGR_AUDIT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CMGR_AUDIT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCmgrAuditV2(id, reason) {
  const j = _cmgrJsV2.get(id);
  if (!j) throw new Error(`cmgr audit ${id} not found`);
  _cmgrCheckJ(j.status, CMGR_AUDIT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CMGR_AUDIT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCmgrAuditV2(id) {
  const j = _cmgrJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCmgrAuditsV2() {
  return [..._cmgrJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDeprecateIdleCmgrProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cmgrPsV2.values())
    if (
      p.status === CMGR_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cmgrIdleMs
    ) {
      p.status = CMGR_PROFILE_MATURITY_V2.DEPRECATED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCmgrAuditsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cmgrJsV2.values())
    if (
      j.status === CMGR_AUDIT_LIFECYCLE_V2.AUDITING &&
      j.startedAt != null &&
      t - j.startedAt >= _cmgrStuckMs
    ) {
      j.status = CMGR_AUDIT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getComplianceManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CMGR_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cmgrPsV2.values()) profilesByStatus[p.status]++;
  const auditsByStatus = {};
  for (const v of Object.values(CMGR_AUDIT_LIFECYCLE_V2)) auditsByStatus[v] = 0;
  for (const j of _cmgrJsV2.values()) auditsByStatus[j.status]++;
  return {
    totalCmgrProfilesV2: _cmgrPsV2.size,
    totalCmgrAuditsV2: _cmgrJsV2.size,
    maxActiveCmgrProfilesPerOwner: _cmgrMaxActive,
    maxPendingCmgrAuditsPerProfile: _cmgrMaxPending,
    cmgrProfileIdleMs: _cmgrIdleMs,
    cmgrAuditStuckMs: _cmgrStuckMs,
    profilesByStatus,
    auditsByStatus,
  };
}
