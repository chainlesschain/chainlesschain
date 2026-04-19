/**
 * Compliance Framework Reporter
 *
 * Turns raw compliance evidence + policies into framework-aware
 * coverage reports. Each framework ships with a curated catalog of
 * representative controls (NOT the full official standard — we
 * don't pretend to replace a CPA audit). A control declares which
 * evidence types and policy types count toward it, and the analyzer
 * reports per-control: covered | partial | gap.
 *
 * Three renderers: markdown (default), html, json.
 *
 * Why a static catalog?
 *   - Reports should be deterministic and reviewable in diffs.
 *   - Evidence types used by `compliance-manager.collectEvidence` are
 *     already free-form — a static catalog gives us a fixed vocabulary
 *     to map them against.
 *   - The catalog can be extended per-project without touching code via
 *     `registerFrameworkTemplate(id, template)`.
 */

import crypto from "crypto";

/* ── Static framework catalogs ────────────────────────────── */

/**
 * SOC 2 — Trust Services Criteria (AICPA 2017, revised 2022).
 * Abbreviated to the most commonly audited CC (Common Criteria) items.
 */
const SOC2_TEMPLATE = {
  id: "soc2",
  name: "SOC 2",
  version: "TSC 2017 (rev. 2022)",
  category: "Attestation",
  controls: [
    {
      id: "CC1.1",
      title: "Control Environment — Commitment to Integrity",
      category: "Governance",
      requires: {
        evidenceTypes: ["policy_document", "code_of_conduct"],
        policyTypes: [],
      },
      description:
        "The entity demonstrates a commitment to integrity and ethical values.",
    },
    {
      id: "CC2.1",
      title: "Communication — Information Quality",
      category: "Governance",
      requires: {
        evidenceTypes: ["communication", "training_record"],
        policyTypes: [],
      },
      description:
        "Relevant and quality information supports internal controls.",
    },
    {
      id: "CC5.1",
      title: "Control Activities — Authorization",
      category: "Access Control",
      requires: {
        evidenceTypes: ["access_review", "rbac_report"],
        policyTypes: ["access_control"],
      },
      description:
        "The entity selects and develops control activities to mitigate risks.",
    },
    {
      id: "CC6.1",
      title: "Logical Access — Identification & Authentication",
      category: "Access Control",
      requires: {
        evidenceTypes: ["auth_log", "mfa_config"],
        policyTypes: ["access_control"],
      },
      description:
        "Logical access to data and software is restricted to authorized users.",
    },
    {
      id: "CC6.6",
      title: "Logical Access — Encryption in Transit",
      category: "Data Protection",
      requires: {
        evidenceTypes: ["tls_scan", "network_diagram"],
        policyTypes: ["encryption"],
      },
      description: "Data transmitted over external networks is encrypted.",
    },
    {
      id: "CC6.7",
      title: "Logical Access — Encryption at Rest",
      category: "Data Protection",
      requires: {
        evidenceTypes: ["disk_encryption", "db_encryption"],
        policyTypes: ["encryption"],
      },
      description: "Data at rest is protected via encryption.",
    },
    {
      id: "CC7.2",
      title: "System Operations — Monitoring",
      category: "Monitoring",
      requires: {
        evidenceTypes: ["siem_export", "audit_log"],
        policyTypes: ["audit_trail"],
      },
      description:
        "The entity monitors system components for anomalies and responds.",
    },
    {
      id: "CC7.4",
      title: "System Operations — Incident Response",
      category: "Incident Response",
      requires: {
        evidenceTypes: ["incident_report", "runbook"],
        policyTypes: [],
      },
      description: "Incidents are analyzed, contained, and remediated.",
    },
  ],
};

/**
 * ISO/IEC 27001:2022 — Annex A abbreviated snapshot.
 * Picks representative items from clauses 5, 6, 8 of the 93-control list.
 */
const ISO27001_TEMPLATE = {
  id: "iso27001",
  name: "ISO/IEC 27001:2022",
  version: "2022",
  category: "Certification",
  controls: [
    {
      id: "A.5.1",
      title: "Policies for information security",
      category: "Organizational",
      requires: { evidenceTypes: ["policy_document"], policyTypes: [] },
      description:
        "An information security policy shall be defined, approved, published and communicated.",
    },
    {
      id: "A.5.15",
      title: "Access control",
      category: "Organizational",
      requires: {
        evidenceTypes: ["access_review", "rbac_report"],
        policyTypes: ["access_control"],
      },
      description:
        "Rules to control physical and logical access shall be established.",
    },
    {
      id: "A.5.23",
      title: "Information security for use of cloud services",
      category: "Organizational",
      requires: {
        evidenceTypes: ["cloud_config", "vendor_assessment"],
        policyTypes: [],
      },
      description:
        "Security of cloud services shall be established and managed.",
    },
    {
      id: "A.8.5",
      title: "Secure authentication",
      category: "Technological",
      requires: {
        evidenceTypes: ["auth_log", "mfa_config"],
        policyTypes: ["access_control"],
      },
      description: "Secure authentication technologies shall be implemented.",
    },
    {
      id: "A.8.12",
      title: "Data leakage prevention",
      category: "Technological",
      requires: {
        evidenceTypes: ["dlp_scan", "egress_report"],
        policyTypes: ["data_classification"],
      },
      description:
        "DLP measures shall be applied to systems and networks processing sensitive data.",
    },
    {
      id: "A.8.15",
      title: "Logging",
      category: "Technological",
      requires: {
        evidenceTypes: ["audit_log", "siem_export"],
        policyTypes: ["audit_trail"],
      },
      description:
        "Logs recording security events shall be produced and retained.",
    },
    {
      id: "A.8.24",
      title: "Use of cryptography",
      category: "Technological",
      requires: {
        evidenceTypes: ["key_inventory", "disk_encryption"],
        policyTypes: ["encryption"],
      },
      description:
        "Rules for cryptographic controls shall be defined and implemented.",
    },
    {
      id: "A.8.28",
      title: "Secure coding",
      category: "Technological",
      requires: {
        evidenceTypes: ["sast_report", "code_review"],
        policyTypes: [],
      },
      description:
        "Secure coding principles shall be applied to software development.",
    },
  ],
};

/**
 * GDPR — EU General Data Protection Regulation.
 * Articles selected for the data-protection core.
 */
const GDPR_TEMPLATE = {
  id: "gdpr",
  name: "GDPR",
  version: "Regulation (EU) 2016/679",
  category: "Regulation",
  controls: [
    {
      id: "Art.5",
      title: "Principles relating to processing of personal data",
      category: "Principles",
      requires: {
        evidenceTypes: ["data_map", "policy_document"],
        policyTypes: ["retention", "data_classification"],
      },
      description:
        "Personal data processed lawfully, fairly, transparently, purpose-limited, minimised, accurate.",
    },
    {
      id: "Art.6",
      title: "Lawfulness of processing",
      category: "Principles",
      requires: { evidenceTypes: ["consent_record", "dpia"], policyTypes: [] },
      description:
        "Processing requires a legal basis (consent, contract, legal obligation, vital interests, public task, legitimate interests).",
    },
    {
      id: "Art.15",
      title: "Right of access by the data subject",
      category: "Data Subject Rights",
      requires: { evidenceTypes: ["dsr_log"], policyTypes: [] },
      description:
        "The data subject shall have the right to obtain confirmation and access to personal data.",
    },
    {
      id: "Art.17",
      title: "Right to erasure ('right to be forgotten')",
      category: "Data Subject Rights",
      requires: {
        evidenceTypes: ["dsr_log", "deletion_log"],
        policyTypes: ["retention"],
      },
      description: "The data subject shall have the right to obtain erasure.",
    },
    {
      id: "Art.25",
      title: "Data protection by design and by default",
      category: "Accountability",
      requires: {
        evidenceTypes: ["dpia", "architecture_review"],
        policyTypes: ["data_classification"],
      },
      description:
        "Controller shall implement appropriate technical and organisational measures.",
    },
    {
      id: "Art.30",
      title: "Records of processing activities",
      category: "Accountability",
      requires: { evidenceTypes: ["ropa", "data_map"], policyTypes: [] },
      description:
        "Each controller shall maintain a record of processing activities under its responsibility.",
    },
    {
      id: "Art.32",
      title: "Security of processing",
      category: "Security",
      requires: {
        evidenceTypes: ["disk_encryption", "audit_log"],
        policyTypes: ["encryption", "access_control"],
      },
      description:
        "Implement appropriate technical and organisational measures to ensure a level of security.",
    },
    {
      id: "Art.33",
      title: "Notification of a personal data breach",
      category: "Security",
      requires: {
        evidenceTypes: ["incident_report", "breach_log"],
        policyTypes: [],
      },
      description:
        "Controller shall notify the supervisory authority within 72 hours of becoming aware.",
    },
  ],
};

export const FRAMEWORK_TEMPLATES = Object.freeze({
  soc2: SOC2_TEMPLATE,
  iso27001: ISO27001_TEMPLATE,
  gdpr: GDPR_TEMPLATE,
});

// Custom templates registered at runtime (for project-specific frameworks).
const _customTemplates = new Map();

export function registerFrameworkTemplate(id, template) {
  if (!id) throw new Error("Framework id is required");
  if (!template || !Array.isArray(template.controls)) {
    throw new Error("Template must have a controls array");
  }
  _customTemplates.set(id, template);
}

export function unregisterFrameworkTemplate(id) {
  return _customTemplates.delete(id);
}

export function getFrameworkTemplate(id) {
  return _customTemplates.get(id) || FRAMEWORK_TEMPLATES[id] || null;
}

export function listFrameworks() {
  return [
    ...Object.keys(FRAMEWORK_TEMPLATES),
    ..._customTemplates.keys(),
  ].filter((v, i, arr) => arr.indexOf(v) === i);
}

/* ── Gap analysis ─────────────────────────────────────────── */

/**
 * Analyze framework coverage against a set of evidence + policies.
 *
 * @param {string} frameworkId
 * @param {{ evidence: Array<{type,description}>, policies: Array<{type,name}> }} opts
 * @returns coverage report object (see shape below)
 */
export function analyzeCoverage(frameworkId, opts = {}) {
  const template = getFrameworkTemplate(frameworkId);
  if (!template) {
    throw new Error(`Unknown framework: ${frameworkId}`);
  }
  const evidence = Array.isArray(opts.evidence) ? opts.evidence : [];
  const policies = Array.isArray(opts.policies) ? opts.policies : [];

  const evidenceByType = new Map();
  for (const e of evidence) {
    if (!e?.type) continue;
    const bucket = evidenceByType.get(e.type) || [];
    bucket.push(e);
    evidenceByType.set(e.type, bucket);
  }
  const policyByType = new Map();
  for (const p of policies) {
    if (!p?.type) continue;
    const bucket = policyByType.get(p.type) || [];
    bucket.push(p);
    policyByType.set(p.type, bucket);
  }

  const controls = template.controls.map((ctrl) => {
    const need = ctrl.requires || {};
    const evTypes = need.evidenceTypes || [];
    const polTypes = need.policyTypes || [];

    const matchedEvidence = [];
    const matchedPolicies = [];
    for (const t of evTypes) {
      const rows = evidenceByType.get(t);
      if (rows) matchedEvidence.push(...rows);
    }
    for (const t of polTypes) {
      const rows = policyByType.get(t);
      if (rows) matchedPolicies.push(...rows);
    }

    const needsEvidence = evTypes.length > 0;
    const needsPolicy = polTypes.length > 0;
    const hasEvidence =
      needsEvidence && evTypes.some((t) => evidenceByType.has(t));
    const hasPolicy = needsPolicy && polTypes.some((t) => policyByType.has(t));

    // Semantics:
    //   - No requirements at all → trivially covered.
    //   - One requirement (ev OR pol) → covered iff that side has a match,
    //     otherwise gap (partial needs *something*).
    //   - Both requirements → covered iff both match, partial iff exactly
    //     one matches, gap if neither.
    let status;
    if (!needsEvidence && !needsPolicy) {
      status = "covered";
    } else if (needsEvidence && needsPolicy) {
      if (hasEvidence && hasPolicy) status = "covered";
      else if (hasEvidence || hasPolicy) status = "partial";
      else status = "gap";
    } else if (needsEvidence) {
      status = hasEvidence ? "covered" : "gap";
    } else {
      status = hasPolicy ? "covered" : "gap";
    }

    return {
      id: ctrl.id,
      title: ctrl.title,
      category: ctrl.category,
      description: ctrl.description,
      requires: need,
      status,
      matchedEvidence,
      matchedPolicies,
    };
  });

  const counts = { covered: 0, partial: 0, gap: 0 };
  for (const c of controls) counts[c.status] += 1;

  const total = controls.length || 1;
  // Partial counts half. Gap counts zero.
  const score = Math.round(
    ((counts.covered + counts.partial * 0.5) / total) * 100,
  );

  return {
    id: crypto.randomUUID(),
    framework: template.id,
    frameworkName: template.name,
    version: template.version,
    generatedAt: new Date().toISOString(),
    score,
    counts,
    total: controls.length,
    controls,
    summary:
      `${counts.covered}/${controls.length} controls covered, ` +
      `${counts.partial} partial, ${counts.gap} gaps`,
  };
}

/* ── Renderers ────────────────────────────────────────────── */

const STATUS_BADGE = {
  covered: "✅",
  partial: "⚠️",
  gap: "❌",
};

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.frameworkName} Compliance Report`);
  lines.push("");
  lines.push(`- **Framework:** ${report.frameworkName} (${report.version})`);
  lines.push(`- **Score:** ${report.score}/100`);
  lines.push(`- **Summary:** ${report.summary}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push("");
  lines.push(
    `| Status | Count |`,
    `|--------|-------|`,
    `| ✅ Covered | ${report.counts.covered} |`,
    `| ⚠️ Partial | ${report.counts.partial} |`,
    `| ❌ Gap | ${report.counts.gap} |`,
  );
  lines.push("");
  lines.push(`## Controls`);
  lines.push("");
  lines.push(`| Control | Title | Category | Status | Evidence | Policies |`);
  lines.push(`|---------|-------|----------|--------|----------|----------|`);
  for (const c of report.controls) {
    lines.push(
      `| ${c.id} | ${c.title} | ${c.category} | ${STATUS_BADGE[c.status]} ${c.status} | ${c.matchedEvidence.length} | ${c.matchedPolicies.length} |`,
    );
  }

  const gaps = report.controls.filter((c) => c.status !== "covered");
  if (gaps.length > 0) {
    lines.push("");
    lines.push(`## Remediation`);
    lines.push("");
    for (const c of gaps) {
      const needEv = (c.requires.evidenceTypes || []).filter(
        (t) => !c.matchedEvidence.some((e) => e.type === t),
      );
      const needPol = (c.requires.policyTypes || []).filter(
        (t) => !c.matchedPolicies.some((p) => p.type === t),
      );
      lines.push(`### ${c.id} — ${c.title}`);
      lines.push("");
      lines.push(`${c.description}`);
      lines.push("");
      if (needEv.length > 0) {
        lines.push(`- Missing evidence: \`${needEv.join("`, `")}\``);
      }
      if (needPol.length > 0) {
        lines.push(`- Missing policies: \`${needPol.join("`, `")}\``);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function _htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHTML(report) {
  const rows = report.controls
    .map(
      (c) =>
        `<tr class="status-${c.status}">` +
        `<td>${_htmlEscape(c.id)}</td>` +
        `<td>${_htmlEscape(c.title)}</td>` +
        `<td>${_htmlEscape(c.category)}</td>` +
        `<td>${STATUS_BADGE[c.status]} ${c.status}</td>` +
        `<td>${c.matchedEvidence.length}</td>` +
        `<td>${c.matchedPolicies.length}</td>` +
        `</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<title>${_htmlEscape(report.frameworkName)} Compliance Report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2em auto; padding: 0 1em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; }
  .status-covered { background: #e6f9ea; }
  .status-partial { background: #fff8e1; }
  .status-gap { background: #ffebee; }
  .summary { margin: 1em 0; }
</style>
</head>
<body>
<h1>${_htmlEscape(report.frameworkName)} Compliance Report</h1>
<div class="summary">
  <p><strong>Framework:</strong> ${_htmlEscape(report.frameworkName)} (${_htmlEscape(report.version)})</p>
  <p><strong>Score:</strong> ${report.score}/100</p>
  <p><strong>Summary:</strong> ${_htmlEscape(report.summary)}</p>
  <p><strong>Generated:</strong> ${_htmlEscape(report.generatedAt)}</p>
</div>
<table>
  <thead>
    <tr><th>Control</th><th>Title</th><th>Category</th><th>Status</th><th>Evidence</th><th>Policies</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>
`;
}

export function renderJSON(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * One-shot convenience: analyze + render in the requested format.
 */
export function generateFrameworkReport(frameworkId, opts = {}) {
  const { format = "markdown", ...rest } = opts;
  const analysis = analyzeCoverage(frameworkId, rest);
  let body;
  if (format === "markdown" || format === "md") body = renderMarkdown(analysis);
  else if (format === "html") body = renderHTML(analysis);
  else if (format === "json") body = renderJSON(analysis);
  else throw new Error(`Unknown format: ${format}`);
  return { analysis, body, format };
}

/* ── Reset (for testing) ──────────────────────────────────── */

export function _resetState() {
  _customTemplates.clear();
}

// ===== V2 Surface: Compliance Framework Reporter governance overlay (CLI v0.138.0) =====
export const COMPLIANCE_FW_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
});
export const COMPLIANCE_FW_REPORT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  GENERATING: "generating",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _cfwTrans = new Map([
  [
    COMPLIANCE_FW_MATURITY_V2.PENDING,
    new Set([
      COMPLIANCE_FW_MATURITY_V2.ACTIVE,
      COMPLIANCE_FW_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COMPLIANCE_FW_MATURITY_V2.ACTIVE,
    new Set([
      COMPLIANCE_FW_MATURITY_V2.DEPRECATED,
      COMPLIANCE_FW_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COMPLIANCE_FW_MATURITY_V2.DEPRECATED,
    new Set([
      COMPLIANCE_FW_MATURITY_V2.ACTIVE,
      COMPLIANCE_FW_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [COMPLIANCE_FW_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cfwTerminal = new Set([COMPLIANCE_FW_MATURITY_V2.ARCHIVED]);
const _cfwRepTrans = new Map([
  [
    COMPLIANCE_FW_REPORT_LIFECYCLE_V2.QUEUED,
    new Set([
      COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING,
      COMPLIANCE_FW_REPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING,
    new Set([
      COMPLIANCE_FW_REPORT_LIFECYCLE_V2.COMPLETED,
      COMPLIANCE_FW_REPORT_LIFECYCLE_V2.FAILED,
      COMPLIANCE_FW_REPORT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [COMPLIANCE_FW_REPORT_LIFECYCLE_V2.COMPLETED, new Set()],
  [COMPLIANCE_FW_REPORT_LIFECYCLE_V2.FAILED, new Set()],
  [COMPLIANCE_FW_REPORT_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _cfwsV2 = new Map();
const _cfwReports = new Map();
let _cfwMaxActivePerOwner = 8;
let _cfwMaxPendingReportsPerFw = 15;
let _cfwIdleMs = 90 * 24 * 60 * 60 * 1000;
let _cfwReportStuckMs = 10 * 60 * 1000;

function _cfwPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveComplianceFwsPerOwnerV2(n) {
  _cfwMaxActivePerOwner = _cfwPos(n, "maxActiveComplianceFwsPerOwner");
}
export function getMaxActiveComplianceFwsPerOwnerV2() {
  return _cfwMaxActivePerOwner;
}
export function setMaxPendingComplianceFwReportsPerFwV2(n) {
  _cfwMaxPendingReportsPerFw = _cfwPos(n, "maxPendingComplianceFwReportsPerFw");
}
export function getMaxPendingComplianceFwReportsPerFwV2() {
  return _cfwMaxPendingReportsPerFw;
}
export function setComplianceFwIdleMsV2(n) {
  _cfwIdleMs = _cfwPos(n, "complianceFwIdleMs");
}
export function getComplianceFwIdleMsV2() {
  return _cfwIdleMs;
}
export function setComplianceFwReportStuckMsV2(n) {
  _cfwReportStuckMs = _cfwPos(n, "complianceFwReportStuckMs");
}
export function getComplianceFwReportStuckMsV2() {
  return _cfwReportStuckMs;
}

export function _resetStateComplianceFwReporterV2() {
  _cfwsV2.clear();
  _cfwReports.clear();
  _cfwMaxActivePerOwner = 8;
  _cfwMaxPendingReportsPerFw = 15;
  _cfwIdleMs = 90 * 24 * 60 * 60 * 1000;
  _cfwReportStuckMs = 10 * 60 * 1000;
}

export function registerComplianceFwV2({ id, owner, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_cfwsV2.has(id))
    throw new Error(`compliance framework ${id} already registered`);
  const now = Date.now();
  const f = {
    id,
    owner,
    name: name || id,
    status: COMPLIANCE_FW_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _cfwsV2.set(id, f);
  return { ...f, metadata: { ...f.metadata } };
}
function _cfwCheckF(from, to) {
  const a = _cfwTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid compliance framework transition ${from} → ${to}`);
}
function _cfwCountActive(owner) {
  let n = 0;
  for (const f of _cfwsV2.values())
    if (f.owner === owner && f.status === COMPLIANCE_FW_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateComplianceFwV2(id) {
  const f = _cfwsV2.get(id);
  if (!f) throw new Error(`compliance framework ${id} not found`);
  _cfwCheckF(f.status, COMPLIANCE_FW_MATURITY_V2.ACTIVE);
  const recovery = f.status === COMPLIANCE_FW_MATURITY_V2.DEPRECATED;
  if (!recovery) {
    const c = _cfwCountActive(f.owner);
    if (c >= _cfwMaxActivePerOwner)
      throw new Error(
        `max active compliance frameworks per owner (${_cfwMaxActivePerOwner}) reached for ${f.owner}`,
      );
  }
  const now = Date.now();
  f.status = COMPLIANCE_FW_MATURITY_V2.ACTIVE;
  f.updatedAt = now;
  f.lastTouchedAt = now;
  if (!f.activatedAt) f.activatedAt = now;
  return { ...f, metadata: { ...f.metadata } };
}
export function deprecateComplianceFwV2(id) {
  const f = _cfwsV2.get(id);
  if (!f) throw new Error(`compliance framework ${id} not found`);
  _cfwCheckF(f.status, COMPLIANCE_FW_MATURITY_V2.DEPRECATED);
  f.status = COMPLIANCE_FW_MATURITY_V2.DEPRECATED;
  f.updatedAt = Date.now();
  return { ...f, metadata: { ...f.metadata } };
}
export function archiveComplianceFwV2(id) {
  const f = _cfwsV2.get(id);
  if (!f) throw new Error(`compliance framework ${id} not found`);
  _cfwCheckF(f.status, COMPLIANCE_FW_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  f.status = COMPLIANCE_FW_MATURITY_V2.ARCHIVED;
  f.updatedAt = now;
  if (!f.archivedAt) f.archivedAt = now;
  return { ...f, metadata: { ...f.metadata } };
}
export function touchComplianceFwV2(id) {
  const f = _cfwsV2.get(id);
  if (!f) throw new Error(`compliance framework ${id} not found`);
  if (_cfwTerminal.has(f.status))
    throw new Error(`cannot touch terminal compliance framework ${id}`);
  const now = Date.now();
  f.lastTouchedAt = now;
  f.updatedAt = now;
  return { ...f, metadata: { ...f.metadata } };
}
export function getComplianceFwV2(id) {
  const f = _cfwsV2.get(id);
  if (!f) return null;
  return { ...f, metadata: { ...f.metadata } };
}
export function listComplianceFwsV2() {
  return [..._cfwsV2.values()].map((f) => ({
    ...f,
    metadata: { ...f.metadata },
  }));
}

function _cfwCountPendingReports(frameworkId) {
  let n = 0;
  for (const r of _cfwReports.values())
    if (
      r.frameworkId === frameworkId &&
      (r.status === COMPLIANCE_FW_REPORT_LIFECYCLE_V2.QUEUED ||
        r.status === COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING)
    )
      n++;
  return n;
}

export function createComplianceFwReportV2({
  id,
  frameworkId,
  format,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!frameworkId || typeof frameworkId !== "string")
    throw new Error("frameworkId is required");
  if (_cfwReports.has(id))
    throw new Error(`compliance framework report ${id} already exists`);
  if (!_cfwsV2.has(frameworkId))
    throw new Error(`compliance framework ${frameworkId} not found`);
  const pending = _cfwCountPendingReports(frameworkId);
  if (pending >= _cfwMaxPendingReportsPerFw)
    throw new Error(
      `max pending compliance framework reports per framework (${_cfwMaxPendingReportsPerFw}) reached for ${frameworkId}`,
    );
  const now = Date.now();
  const r = {
    id,
    frameworkId,
    format: format || "markdown",
    status: COMPLIANCE_FW_REPORT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cfwReports.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _cfwCheckR(from, to) {
  const a = _cfwRepTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(
      `invalid compliance framework report transition ${from} → ${to}`,
    );
}
export function startComplianceFwReportV2(id) {
  const r = _cfwReports.get(id);
  if (!r) throw new Error(`compliance framework report ${id} not found`);
  _cfwCheckR(r.status, COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING);
  const now = Date.now();
  r.status = COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function completeComplianceFwReportV2(id) {
  const r = _cfwReports.get(id);
  if (!r) throw new Error(`compliance framework report ${id} not found`);
  _cfwCheckR(r.status, COMPLIANCE_FW_REPORT_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  r.status = COMPLIANCE_FW_REPORT_LIFECYCLE_V2.COMPLETED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failComplianceFwReportV2(id, reason) {
  const r = _cfwReports.get(id);
  if (!r) throw new Error(`compliance framework report ${id} not found`);
  _cfwCheckR(r.status, COMPLIANCE_FW_REPORT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = COMPLIANCE_FW_REPORT_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelComplianceFwReportV2(id, reason) {
  const r = _cfwReports.get(id);
  if (!r) throw new Error(`compliance framework report ${id} not found`);
  _cfwCheckR(r.status, COMPLIANCE_FW_REPORT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = COMPLIANCE_FW_REPORT_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getComplianceFwReportV2(id) {
  const r = _cfwReports.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listComplianceFwReportsV2() {
  return [..._cfwReports.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}

export function autoDeprecateIdleComplianceFwsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const f of _cfwsV2.values())
    if (
      f.status === COMPLIANCE_FW_MATURITY_V2.ACTIVE &&
      t - f.lastTouchedAt >= _cfwIdleMs
    ) {
      f.status = COMPLIANCE_FW_MATURITY_V2.DEPRECATED;
      f.updatedAt = t;
      flipped.push(f.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckComplianceFwReportsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _cfwReports.values())
    if (
      r.status === COMPLIANCE_FW_REPORT_LIFECYCLE_V2.GENERATING &&
      r.startedAt != null &&
      t - r.startedAt >= _cfwReportStuckMs
    ) {
      r.status = COMPLIANCE_FW_REPORT_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}

export function getComplianceFwReporterGovStatsV2() {
  const fwsByStatus = {};
  for (const s of Object.values(COMPLIANCE_FW_MATURITY_V2)) fwsByStatus[s] = 0;
  for (const f of _cfwsV2.values()) fwsByStatus[f.status]++;
  const reportsByStatus = {};
  for (const s of Object.values(COMPLIANCE_FW_REPORT_LIFECYCLE_V2))
    reportsByStatus[s] = 0;
  for (const r of _cfwReports.values()) reportsByStatus[r.status]++;
  return {
    totalComplianceFwsV2: _cfwsV2.size,
    totalComplianceFwReportsV2: _cfwReports.size,
    maxActiveComplianceFwsPerOwner: _cfwMaxActivePerOwner,
    maxPendingComplianceFwReportsPerFw: _cfwMaxPendingReportsPerFw,
    complianceFwIdleMs: _cfwIdleMs,
    complianceFwReportStuckMs: _cfwReportStuckMs,
    fwsByStatus,
    reportsByStatus,
  };
}
