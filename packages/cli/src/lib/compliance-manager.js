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
    throw new Error(`Unknown framework: ${framework}. Valid: ${FRAMEWORKS.join(", ")}`);
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
  ).run(id, framework, evidence.type, evidence.description, evidence.source, "collected", now);

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

  const score = policyList.length > 0 ? Math.min(100, evidenceList.length * 20) : 0;

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
  ).run(id, framework, report.title, report.summary, score, JSON.stringify(report.content), now);

  return report;
}

/* ── Data Classification ─��────────────────────────────────── */

export function classifyData(content) {
  if (!content) throw new Error("Content is required");

  const patterns = {
    pii: /\b\d{3}-\d{2}-\d{4}\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i,
    financial: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\baccount\s*#?\s*\d+/i,
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
    sensitivity: classifications.length > 1 ? "high" : classifications.length === 1 ? "medium" : "low",
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
    throw new Error(`Invalid policy type: ${type}. Valid: ${POLICY_TYPES.join(", ")}`);
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
  ).run(id, name, type, framework, JSON.stringify(rules || {}), 1, policy.severity, now);

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

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _evidence.clear();
  _reports.clear();
  _policies.clear();
}
