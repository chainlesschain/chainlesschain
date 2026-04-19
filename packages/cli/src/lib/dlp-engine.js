/**
 * DLP Engine — data loss prevention scanning, incident management,
 * policy creation, and statistics.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _incidents = new Map();
const _policies = new Map();
let _scanCount = 0;
let _blockCount = 0;
let _alertCount = 0;

const DLP_ACTIONS = {
  ALLOW: "allow",
  ALERT: "alert",
  BLOCK: "block",
  QUARANTINE: "quarantine",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureDLPTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dlp_incidents (
      id TEXT PRIMARY KEY,
      policy_id TEXT,
      channel TEXT,
      action_taken TEXT,
      content_hash TEXT,
      matched_patterns TEXT,
      severity TEXT DEFAULT 'medium',
      user_id TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolution TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dlp_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      patterns TEXT,
      keywords TEXT,
      action TEXT DEFAULT 'alert',
      severity TEXT DEFAULT 'medium',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Content Scanning ─────────────────────────────────────── */

export function scanContent(db, content, channel, userId) {
  if (!content) throw new Error("Content is required");

  _scanCount++;
  const policies = [..._policies.values()].filter((p) => p.enabled);
  const matchedPolicies = [];
  let highestAction = DLP_ACTIONS.ALLOW;

  const actionPriority = { allow: 0, alert: 1, block: 2, quarantine: 3 };

  for (const policy of policies) {
    const patterns = policy.patterns || [];
    const keywords = policy.keywords || [];
    let matched = false;

    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern, "i").test(content)) {
          matched = true;
          break;
        }
      } catch (_err) {
        // Invalid regex — skip
      }
    }

    if (!matched) {
      for (const kw of keywords) {
        if (content.toLowerCase().includes(kw.toLowerCase())) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      matchedPolicies.push(policy);
      if (
        (actionPriority[policy.action] || 0) >
        (actionPriority[highestAction] || 0)
      ) {
        highestAction = policy.action;
      }
    }
  }

  const incidents = [];
  if (matchedPolicies.length > 0) {
    for (const policy of matchedPolicies) {
      const incidentId = crypto.randomUUID();
      const now = new Date().toISOString();
      const contentHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      const incident = {
        id: incidentId,
        policyId: policy.id,
        channel: channel || "unknown",
        actionTaken: policy.action,
        contentHash,
        matchedPatterns: policy.patterns || [],
        severity: policy.severity,
        userId: userId || "unknown",
        createdAt: now,
        resolvedAt: null,
        resolution: null,
      };

      _incidents.set(incidentId, incident);
      incidents.push(incident);

      db.prepare(
        `INSERT INTO dlp_incidents (id, policy_id, channel, action_taken, content_hash, matched_patterns, severity, user_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        incidentId,
        policy.id,
        incident.channel,
        incident.actionTaken,
        contentHash,
        JSON.stringify(incident.matchedPatterns),
        incident.severity,
        incident.userId,
        "{}",
        now,
      );
    }

    if (
      highestAction === DLP_ACTIONS.BLOCK ||
      highestAction === DLP_ACTIONS.QUARANTINE
    ) {
      _blockCount++;
    } else if (highestAction === DLP_ACTIONS.ALERT) {
      _alertCount++;
    }
  }

  return {
    allowed:
      highestAction === DLP_ACTIONS.ALLOW ||
      highestAction === DLP_ACTIONS.ALERT,
    action: highestAction,
    matchedPolicies: matchedPolicies.length,
    incidents,
  };
}

/* ── Incident Management ──────────────────────────────────── */

export function listIncidents(filter = {}) {
  let incidents = [..._incidents.values()];
  if (filter.channel) {
    incidents = incidents.filter((i) => i.channel === filter.channel);
  }
  if (filter.severity) {
    incidents = incidents.filter((i) => i.severity === filter.severity);
  }
  if (filter.resolved === false) {
    incidents = incidents.filter((i) => !i.resolvedAt);
  }
  const limit = filter.limit || 50;
  return incidents.slice(0, limit);
}

export function resolveIncident(db, incidentId, resolution) {
  const incident = _incidents.get(incidentId);
  if (!incident) throw new Error(`Incident not found: ${incidentId}`);

  const now = new Date().toISOString();
  incident.resolvedAt = now;
  incident.resolution = resolution || "resolved";

  db.prepare(
    `UPDATE dlp_incidents SET resolved_at = ?, resolution = ? WHERE id = ?`,
  ).run(now, incident.resolution, incidentId);

  return { success: true, incidentId, resolution: incident.resolution };
}

/* ── DLP Stats ────────────────────────────────────────────── */

export function getDLPStats() {
  const unresolvedIncidents = [..._incidents.values()].filter(
    (i) => !i.resolvedAt,
  ).length;
  return {
    scanned: _scanCount,
    blocked: _blockCount,
    alerted: _alertCount,
    totalIncidents: _incidents.size,
    unresolvedIncidents,
  };
}

/* ── Policy Management ────────────────────────────────────── */

export function createPolicy(db, name, patterns, keywords, action, severity) {
  if (!name) throw new Error("Policy name is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const policy = {
    id,
    name,
    patterns: patterns || [],
    keywords: keywords || [],
    action: action || DLP_ACTIONS.ALERT,
    severity: severity || "medium",
    enabled: true,
    createdAt: now,
  };

  _policies.set(id, policy);

  db.prepare(
    `INSERT INTO dlp_policies (id, name, patterns, keywords, action, severity, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    JSON.stringify(policy.patterns),
    JSON.stringify(policy.keywords),
    policy.action,
    policy.severity,
    1,
    now,
    now,
  );

  return policy;
}

export function updatePolicy(db, policyId, updates) {
  const policy = _policies.get(policyId);
  if (!policy) throw new Error(`Policy not found: ${policyId}`);

  if (updates.name !== undefined) policy.name = updates.name;
  if (updates.patterns !== undefined) policy.patterns = updates.patterns;
  if (updates.keywords !== undefined) policy.keywords = updates.keywords;
  if (updates.action !== undefined) policy.action = updates.action;
  if (updates.severity !== undefined) policy.severity = updates.severity;
  if (updates.enabled !== undefined) policy.enabled = updates.enabled;

  db.prepare(
    `UPDATE dlp_policies SET name = ?, patterns = ?, keywords = ?, action = ?, severity = ?, enabled = ?, updated_at = ? WHERE id = ?`,
  ).run(
    policy.name,
    JSON.stringify(policy.patterns),
    JSON.stringify(policy.keywords),
    policy.action,
    policy.severity,
    policy.enabled ? 1 : 0,
    new Date().toISOString(),
    policyId,
  );

  return policy;
}

export function deletePolicy(db, policyId) {
  const policy = _policies.get(policyId);
  if (!policy) throw new Error(`Policy not found: ${policyId}`);

  _policies.delete(policyId);

  db.prepare(`DELETE FROM dlp_policies WHERE id = ?`).run(policyId);

  return { success: true, policyId };
}

export function listDLPPolicies() {
  return [..._policies.values()];
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _incidents.clear();
  _policies.clear();
  _scanCount = 0;
  _blockCount = 0;
  _alertCount = 0;
  _v2PolicyMeta.clear();
  _v2IncidentMeta.clear();
}

// ═══════════════════════════════════════════════════════════════
// V2 Canonical Surface (Phase 50)
// ═══════════════════════════════════════════════════════════════

export const DLP_ACTION = Object.freeze({
  ALLOW: "allow",
  ALERT: "alert",
  BLOCK: "block",
  QUARANTINE: "quarantine",
});

export const DLP_CHANNEL = Object.freeze({
  EMAIL: "email",
  CHAT: "chat",
  FILE_TRANSFER: "file_transfer",
  CLIPBOARD: "clipboard",
  EXPORT: "export",
});

export const DLP_SEVERITY = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

// Ordered priority for "highest action wins" aggregation.
const _actionPriority = Object.freeze({
  allow: 0,
  alert: 1,
  block: 2,
  quarantine: 3,
});

const _severityOrder = Object.freeze(["low", "medium", "high", "critical"]);

// Default maxContentSize (10 MB — matches Phase 50 design §六)
export const DLP_DEFAULT_MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// Parallel V2 metadata Maps (policy → {description, channels}), (incident → {metadata})
const _v2PolicyMeta = new Map();
const _v2IncidentMeta = new Map();

// Built-in policy templates from Phase 50 design §七
const _builtinPolicyTemplates = Object.freeze([
  Object.freeze({
    name: "credit-card",
    description:
      "Detects credit card numbers (13-19 digits, optional separators)",
    patterns: ["\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b"],
    keywords: [],
    channels: [],
    action: "block",
    severity: "high",
  }),
  Object.freeze({
    name: "cn-id-number",
    description: "Detects Chinese 18-digit ID numbers",
    patterns: ["\\b\\d{17}[\\dXx]\\b"],
    keywords: [],
    channels: [],
    action: "block",
    severity: "high",
  }),
  Object.freeze({
    name: "email-address",
    description: "Detects email addresses (alert-only for export channel)",
    patterns: ["[\\w.]+@[\\w.]+\\.\\w+"],
    keywords: [],
    channels: ["export"],
    action: "alert",
    severity: "medium",
  }),
  Object.freeze({
    name: "api-key",
    description:
      "Detects common API-key tokens (sk-*, api_key=..., secret_key=...)",
    patterns: ["sk-[A-Za-z0-9]{20,}", "(?:api_key|secret_key)\\s*[:=]\\s*\\S+"],
    keywords: [],
    channels: [],
    action: "block",
    severity: "critical",
  }),
  Object.freeze({
    name: "plaintext-password",
    description: "Detects plaintext passwords in content",
    patterns: ["password\\s*[:=]\\s*\\S+"],
    keywords: [],
    channels: [],
    action: "alert",
    severity: "medium",
  }),
]);

function _validateAction(action) {
  if (!Object.values(DLP_ACTION).includes(action)) {
    throw new Error(
      `Invalid action: ${action}. Expected one of ${Object.values(DLP_ACTION).join("|")}`,
    );
  }
}

function _validateSeverity(severity) {
  if (!Object.values(DLP_SEVERITY).includes(severity)) {
    throw new Error(
      `Invalid severity: ${severity}. Expected one of ${Object.values(DLP_SEVERITY).join("|")}`,
    );
  }
}

function _validateChannels(channels) {
  if (!Array.isArray(channels)) {
    throw new Error("channels must be an array");
  }
  for (const c of channels) {
    if (!Object.values(DLP_CHANNEL).includes(c)) {
      throw new Error(
        `Invalid channel: ${c}. Expected one of ${Object.values(DLP_CHANNEL).join("|")}`,
      );
    }
  }
}

/**
 * Create a policy with V2 canonical validation + channel filter + description.
 */
export function createPolicyV2(db, options) {
  if (!options || typeof options !== "object") {
    throw new Error("options object is required");
  }
  const {
    name,
    description = "",
    channels = [],
    patterns = [],
    keywords = [],
    action = DLP_ACTION.ALERT,
    severity = DLP_SEVERITY.MEDIUM,
  } = options;
  if (!name) throw new Error("Policy name is required");
  _validateAction(action);
  _validateSeverity(severity);
  _validateChannels(channels);
  const policy = createPolicy(db, name, patterns, keywords, action, severity);
  _v2PolicyMeta.set(policy.id, {
    description,
    channels: [...channels],
  });
  return { ...policy, description, channels: [...channels] };
}

/**
 * Get V2 metadata for a policy (description + channels).
 */
export function getPolicyV2(policyId) {
  const base = [..._policies.values()].find((p) => p.id === policyId);
  if (!base) throw new Error(`Policy not found: ${policyId}`);
  const meta = _v2PolicyMeta.get(policyId) || {
    description: "",
    channels: [],
  };
  return {
    ...base,
    description: meta.description,
    channels: [...meta.channels],
  };
}

/**
 * List active (enabled) policies applicable to a specific channel.
 * Policies with an empty channels array are considered "all channels".
 */
export function listActivePoliciesForChannel(channel) {
  if (!Object.values(DLP_CHANNEL).includes(channel)) {
    throw new Error(`Invalid channel: ${channel}`);
  }
  const results = [];
  for (const p of _policies.values()) {
    if (!p.enabled) continue;
    const meta = _v2PolicyMeta.get(p.id);
    const channels = meta ? meta.channels : [];
    if (channels.length === 0 || channels.includes(channel)) {
      results.push({
        ...p,
        description: meta ? meta.description : "",
        channels: [...channels],
      });
    }
  }
  return results;
}

/**
 * Scan content with V2 channel filter + size limit + metadata attach.
 * Throws if content exceeds maxContentSize (default 10 MB).
 */
export function scanContentV2(db, options) {
  if (!options || typeof options !== "object") {
    throw new Error("options object is required");
  }
  const {
    content,
    channel,
    userId,
    metadata = {},
    maxContentSize = DLP_DEFAULT_MAX_CONTENT_SIZE,
  } = options;
  if (!content) throw new Error("Content is required");
  if (channel !== undefined && !Object.values(DLP_CHANNEL).includes(channel)) {
    throw new Error(`Invalid channel: ${channel}`);
  }
  // Size gate — byte length of UTF-8 representation
  const byteLen = Buffer.byteLength(content, "utf8");
  if (byteLen > maxContentSize) {
    throw new Error(
      `Content size ${byteLen}B exceeds maxContentSize ${maxContentSize}B`,
    );
  }

  // Hold channel-filtered policies while scanning.
  const originalEnabled = new Map();
  if (channel) {
    for (const p of _policies.values()) {
      const meta = _v2PolicyMeta.get(p.id);
      const channels = meta ? meta.channels : [];
      if (channels.length > 0 && !channels.includes(channel)) {
        originalEnabled.set(p.id, p.enabled);
        p.enabled = false;
      }
    }
  }

  let result;
  try {
    result = scanContent(db, content, channel, userId);
  } finally {
    for (const [id, enabled] of originalEnabled) {
      const p = _policies.get(id);
      if (p) p.enabled = enabled;
    }
  }

  // Attach V2 metadata to every incident.
  for (const incident of result.incidents) {
    _v2IncidentMeta.set(incident.id, { ...metadata });
  }

  return { ...result, contentBytes: byteLen, channel: channel || "unknown" };
}

/**
 * List incidents with V2 filter (channel/severity/resolved/userId/policyId/from/to).
 */
export function listIncidentsV2(filter = {}) {
  let incidents = [..._incidents.values()];
  if (filter.channel) {
    if (!Object.values(DLP_CHANNEL).includes(filter.channel)) {
      throw new Error(`Invalid channel: ${filter.channel}`);
    }
    incidents = incidents.filter((i) => i.channel === filter.channel);
  }
  if (filter.severity) {
    if (!Object.values(DLP_SEVERITY).includes(filter.severity)) {
      throw new Error(`Invalid severity: ${filter.severity}`);
    }
    incidents = incidents.filter((i) => i.severity === filter.severity);
  }
  if (filter.resolved === true) {
    incidents = incidents.filter((i) => !!i.resolvedAt);
  } else if (filter.resolved === false) {
    incidents = incidents.filter((i) => !i.resolvedAt);
  }
  if (filter.userId) {
    incidents = incidents.filter((i) => i.userId === filter.userId);
  }
  if (filter.policyId) {
    incidents = incidents.filter((i) => i.policyId === filter.policyId);
  }
  if (filter.fromDate) {
    incidents = incidents.filter((i) => i.createdAt >= filter.fromDate);
  }
  if (filter.toDate) {
    incidents = incidents.filter((i) => i.createdAt <= filter.toDate);
  }
  incidents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = filter.limit || 50;
  return incidents.slice(0, limit).map((i) => ({
    ...i,
    metadata: _v2IncidentMeta.get(i.id) || {},
  }));
}

/**
 * Detailed incident snapshot including V2 metadata.
 */
export function getIncidentV2(incidentId) {
  const incident = _incidents.get(incidentId);
  if (!incident) throw new Error(`Incident not found: ${incidentId}`);
  return { ...incident, metadata: _v2IncidentMeta.get(incidentId) || {} };
}

/**
 * Built-in policy template catalog.
 */
export function listBuiltinPolicyTemplates() {
  return _builtinPolicyTemplates.map((t) => ({ ...t }));
}

/**
 * Install one or more built-in policy templates by name (or all if names omitted).
 * Returns the list of installed policy records.
 */
export function installBuiltinPolicies(db, names) {
  const selected =
    names && names.length > 0
      ? _builtinPolicyTemplates.filter((t) => names.includes(t.name))
      : _builtinPolicyTemplates;
  if (names && names.length > 0) {
    const requested = new Set(names);
    for (const t of selected) requested.delete(t.name);
    if (requested.size > 0) {
      throw new Error(
        `Unknown built-in template(s): ${[...requested].join(", ")}`,
      );
    }
  }
  const installed = [];
  for (const t of selected) {
    installed.push(createPolicyV2(db, { ...t }));
  }
  return installed;
}

/**
 * Extended stats with byAction / bySeverity / byChannel breakdowns and top policies.
 */
export function getDLPStatsV2() {
  const base = getDLPStats();
  const byAction = {};
  for (const v of Object.values(DLP_ACTION)) byAction[v] = 0;
  const bySeverity = {};
  for (const v of Object.values(DLP_SEVERITY)) bySeverity[v] = 0;
  const byChannel = {};
  for (const v of Object.values(DLP_CHANNEL)) byChannel[v] = 0;
  const byPolicy = {};
  for (const incident of _incidents.values()) {
    if (byAction[incident.actionTaken] !== undefined) {
      byAction[incident.actionTaken] += 1;
    }
    if (bySeverity[incident.severity] !== undefined) {
      bySeverity[incident.severity] += 1;
    }
    if (byChannel[incident.channel] !== undefined) {
      byChannel[incident.channel] += 1;
    }
    byPolicy[incident.policyId] = (byPolicy[incident.policyId] || 0) + 1;
  }
  const topPolicies = Object.entries(byPolicy)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([policyId, count]) => ({ policyId, count }));
  return {
    ...base,
    policies: _policies.size,
    activePolicies: [..._policies.values()].filter((p) => p.enabled).length,
    byAction,
    bySeverity,
    byChannel,
    topPolicies,
  };
}

/**
 * Highest severity among unresolved incidents (for alert aggregation).
 */
export function getHighestUnresolvedSeverity() {
  let highestIdx = -1;
  for (const incident of _incidents.values()) {
    if (incident.resolvedAt) continue;
    const idx = _severityOrder.indexOf(incident.severity);
    if (idx > highestIdx) highestIdx = idx;
  }
  return highestIdx === -1 ? null : _severityOrder[highestIdx];
}

export { _v2PolicyMeta, _v2IncidentMeta, _builtinPolicyTemplates };

// ===== V2 Surface: DLP Engine governance overlay (CLI v0.135.0) =====
export const DLP_POLICY_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  RETIRED: "retired",
});
export const DLP_SCAN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SCANNING: "scanning",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _dlpPolTrans = new Map([
  [
    DLP_POLICY_MATURITY_V2.PENDING,
    new Set([DLP_POLICY_MATURITY_V2.ACTIVE, DLP_POLICY_MATURITY_V2.RETIRED]),
  ],
  [
    DLP_POLICY_MATURITY_V2.ACTIVE,
    new Set([DLP_POLICY_MATURITY_V2.SUSPENDED, DLP_POLICY_MATURITY_V2.RETIRED]),
  ],
  [
    DLP_POLICY_MATURITY_V2.SUSPENDED,
    new Set([DLP_POLICY_MATURITY_V2.ACTIVE, DLP_POLICY_MATURITY_V2.RETIRED]),
  ],
  [DLP_POLICY_MATURITY_V2.RETIRED, new Set()],
]);
const _dlpPolTerminal = new Set([DLP_POLICY_MATURITY_V2.RETIRED]);
const _dlpScanTrans = new Map([
  [
    DLP_SCAN_LIFECYCLE_V2.QUEUED,
    new Set([DLP_SCAN_LIFECYCLE_V2.SCANNING, DLP_SCAN_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    DLP_SCAN_LIFECYCLE_V2.SCANNING,
    new Set([
      DLP_SCAN_LIFECYCLE_V2.COMPLETED,
      DLP_SCAN_LIFECYCLE_V2.FAILED,
      DLP_SCAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DLP_SCAN_LIFECYCLE_V2.COMPLETED, new Set()],
  [DLP_SCAN_LIFECYCLE_V2.FAILED, new Set()],
  [DLP_SCAN_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _dlpPols = new Map();
const _dlpScans = new Map();
let _dlpMaxActivePerOwner = 16;
let _dlpMaxPendingPerPol = 20;
let _dlpPolIdleMs = 12 * 60 * 60 * 1000;
let _dlpScanStuckMs = 5 * 60 * 1000;

function _dlpPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveDlpPoliciesPerOwnerV2(n) {
  _dlpMaxActivePerOwner = _dlpPos(n, "maxActiveDlpPoliciesPerOwner");
}
export function getMaxActiveDlpPoliciesPerOwnerV2() {
  return _dlpMaxActivePerOwner;
}
export function setMaxPendingDlpScansPerPolicyV2(n) {
  _dlpMaxPendingPerPol = _dlpPos(n, "maxPendingDlpScansPerPolicy");
}
export function getMaxPendingDlpScansPerPolicyV2() {
  return _dlpMaxPendingPerPol;
}
export function setDlpPolicyIdleMsV2(n) {
  _dlpPolIdleMs = _dlpPos(n, "dlpPolicyIdleMs");
}
export function getDlpPolicyIdleMsV2() {
  return _dlpPolIdleMs;
}
export function setDlpScanStuckMsV2(n) {
  _dlpScanStuckMs = _dlpPos(n, "dlpScanStuckMs");
}
export function getDlpScanStuckMsV2() {
  return _dlpScanStuckMs;
}

export function _resetStateDlpEngineV2() {
  _dlpPols.clear();
  _dlpScans.clear();
  _dlpMaxActivePerOwner = 16;
  _dlpMaxPendingPerPol = 20;
  _dlpPolIdleMs = 12 * 60 * 60 * 1000;
  _dlpScanStuckMs = 5 * 60 * 1000;
}

export function registerDlpPolicyV2({
  id,
  owner,
  classification,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_dlpPols.has(id)) throw new Error(`dlp policy ${id} already registered`);
  const now = Date.now();
  const p = {
    id,
    owner,
    classification: classification || "internal",
    status: DLP_POLICY_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _dlpPols.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _dlpCheckP(from, to) {
  const a = _dlpPolTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dlp policy transition ${from} → ${to}`);
}
function _dlpCountActive(owner) {
  let n = 0;
  for (const p of _dlpPols.values())
    if (p.owner === owner && p.status === DLP_POLICY_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateDlpPolicyV2(id) {
  const p = _dlpPols.get(id);
  if (!p) throw new Error(`dlp policy ${id} not found`);
  _dlpCheckP(p.status, DLP_POLICY_MATURITY_V2.ACTIVE);
  const recovery = p.status === DLP_POLICY_MATURITY_V2.SUSPENDED;
  if (!recovery) {
    const a = _dlpCountActive(p.owner);
    if (a >= _dlpMaxActivePerOwner)
      throw new Error(
        `max active dlp policies per owner (${_dlpMaxActivePerOwner}) reached for ${p.owner}`,
      );
  }
  const now = Date.now();
  p.status = DLP_POLICY_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendDlpPolicyV2(id) {
  const p = _dlpPols.get(id);
  if (!p) throw new Error(`dlp policy ${id} not found`);
  _dlpCheckP(p.status, DLP_POLICY_MATURITY_V2.SUSPENDED);
  p.status = DLP_POLICY_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function retireDlpPolicyV2(id) {
  const p = _dlpPols.get(id);
  if (!p) throw new Error(`dlp policy ${id} not found`);
  _dlpCheckP(p.status, DLP_POLICY_MATURITY_V2.RETIRED);
  const now = Date.now();
  p.status = DLP_POLICY_MATURITY_V2.RETIRED;
  p.updatedAt = now;
  if (!p.retiredAt) p.retiredAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchDlpPolicyV2(id) {
  const p = _dlpPols.get(id);
  if (!p) throw new Error(`dlp policy ${id} not found`);
  if (_dlpPolTerminal.has(p.status))
    throw new Error(`cannot touch terminal dlp policy ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getDlpPolicyV2(id) {
  const p = _dlpPols.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDlpPoliciesV2() {
  return [..._dlpPols.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _dlpCountPending(pid) {
  let n = 0;
  for (const s of _dlpScans.values())
    if (
      s.policyId === pid &&
      (s.status === DLP_SCAN_LIFECYCLE_V2.QUEUED ||
        s.status === DLP_SCAN_LIFECYCLE_V2.SCANNING)
    )
      n++;
  return n;
}

export function createDlpScanV2({ id, policyId, target, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!policyId || typeof policyId !== "string")
    throw new Error("policyId is required");
  if (_dlpScans.has(id)) throw new Error(`dlp scan ${id} already exists`);
  if (!_dlpPols.has(policyId))
    throw new Error(`dlp policy ${policyId} not found`);
  const pending = _dlpCountPending(policyId);
  if (pending >= _dlpMaxPendingPerPol)
    throw new Error(
      `max pending dlp scans per policy (${_dlpMaxPendingPerPol}) reached for ${policyId}`,
    );
  const now = Date.now();
  const s = {
    id,
    policyId,
    target: target || "",
    status: DLP_SCAN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dlpScans.set(id, s);
  return { ...s, metadata: { ...s.metadata } };
}
function _dlpCheckS(from, to) {
  const a = _dlpScanTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dlp scan transition ${from} → ${to}`);
}
export function startDlpScanV2(id) {
  const s = _dlpScans.get(id);
  if (!s) throw new Error(`dlp scan ${id} not found`);
  _dlpCheckS(s.status, DLP_SCAN_LIFECYCLE_V2.SCANNING);
  const now = Date.now();
  s.status = DLP_SCAN_LIFECYCLE_V2.SCANNING;
  s.updatedAt = now;
  if (!s.startedAt) s.startedAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function completeDlpScanV2(id) {
  const s = _dlpScans.get(id);
  if (!s) throw new Error(`dlp scan ${id} not found`);
  _dlpCheckS(s.status, DLP_SCAN_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  s.status = DLP_SCAN_LIFECYCLE_V2.COMPLETED;
  s.updatedAt = now;
  if (!s.settledAt) s.settledAt = now;
  return { ...s, metadata: { ...s.metadata } };
}
export function failDlpScanV2(id, reason) {
  const s = _dlpScans.get(id);
  if (!s) throw new Error(`dlp scan ${id} not found`);
  _dlpCheckS(s.status, DLP_SCAN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  s.status = DLP_SCAN_LIFECYCLE_V2.FAILED;
  s.updatedAt = now;
  if (!s.settledAt) s.settledAt = now;
  if (reason) s.metadata.failReason = String(reason);
  return { ...s, metadata: { ...s.metadata } };
}
export function cancelDlpScanV2(id, reason) {
  const s = _dlpScans.get(id);
  if (!s) throw new Error(`dlp scan ${id} not found`);
  _dlpCheckS(s.status, DLP_SCAN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  s.status = DLP_SCAN_LIFECYCLE_V2.CANCELLED;
  s.updatedAt = now;
  if (!s.settledAt) s.settledAt = now;
  if (reason) s.metadata.cancelReason = String(reason);
  return { ...s, metadata: { ...s.metadata } };
}
export function getDlpScanV2(id) {
  const s = _dlpScans.get(id);
  if (!s) return null;
  return { ...s, metadata: { ...s.metadata } };
}
export function listDlpScansV2() {
  return [..._dlpScans.values()].map((s) => ({
    ...s,
    metadata: { ...s.metadata },
  }));
}

export function autoSuspendIdleDlpPoliciesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _dlpPols.values())
    if (
      p.status === DLP_POLICY_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _dlpPolIdleMs
    ) {
      p.status = DLP_POLICY_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDlpScansV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const s of _dlpScans.values())
    if (
      s.status === DLP_SCAN_LIFECYCLE_V2.SCANNING &&
      s.startedAt != null &&
      t - s.startedAt >= _dlpScanStuckMs
    ) {
      s.status = DLP_SCAN_LIFECYCLE_V2.FAILED;
      s.updatedAt = t;
      if (!s.settledAt) s.settledAt = t;
      s.metadata.failReason = "auto-fail-stuck";
      flipped.push(s.id);
    }
  return { flipped, count: flipped.length };
}

export function getDlpEngineStatsV2() {
  const policiesByStatus = {};
  for (const s of Object.values(DLP_POLICY_MATURITY_V2))
    policiesByStatus[s] = 0;
  for (const p of _dlpPols.values()) policiesByStatus[p.status]++;
  const scansByStatus = {};
  for (const s of Object.values(DLP_SCAN_LIFECYCLE_V2)) scansByStatus[s] = 0;
  for (const sc of _dlpScans.values()) scansByStatus[sc.status]++;
  return {
    totalPoliciesV2: _dlpPols.size,
    totalScansV2: _dlpScans.size,
    maxActiveDlpPoliciesPerOwner: _dlpMaxActivePerOwner,
    maxPendingDlpScansPerPolicy: _dlpMaxPendingPerPol,
    dlpPolicyIdleMs: _dlpPolIdleMs,
    dlpScanStuckMs: _dlpScanStuckMs,
    policiesByStatus,
    scansByStatus,
  };
}

// =====================================================================
// dlp-engine V2 governance overlay (iter20)
// =====================================================================
export const DLPGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const DLPGOV_SCAN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  SCANNING: "scanning",
  SCANNED: "scanned",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _dlpgovPTrans = new Map([
  [
    DLPGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      DLPGOV_PROFILE_MATURITY_V2.ACTIVE,
      DLPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DLPGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      DLPGOV_PROFILE_MATURITY_V2.SUSPENDED,
      DLPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    DLPGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      DLPGOV_PROFILE_MATURITY_V2.ACTIVE,
      DLPGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [DLPGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _dlpgovPTerminal = new Set([DLPGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _dlpgovJTrans = new Map([
  [
    DLPGOV_SCAN_LIFECYCLE_V2.QUEUED,
    new Set([
      DLPGOV_SCAN_LIFECYCLE_V2.SCANNING,
      DLPGOV_SCAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    DLPGOV_SCAN_LIFECYCLE_V2.SCANNING,
    new Set([
      DLPGOV_SCAN_LIFECYCLE_V2.SCANNED,
      DLPGOV_SCAN_LIFECYCLE_V2.FAILED,
      DLPGOV_SCAN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DLPGOV_SCAN_LIFECYCLE_V2.SCANNED, new Set()],
  [DLPGOV_SCAN_LIFECYCLE_V2.FAILED, new Set()],
  [DLPGOV_SCAN_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _dlpgovPsV2 = new Map();
const _dlpgovJsV2 = new Map();
let _dlpgovMaxActive = 8,
  _dlpgovMaxPending = 20,
  _dlpgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _dlpgovStuckMs = 60 * 1000;
function _dlpgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _dlpgovCheckP(from, to) {
  const a = _dlpgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dlpgov profile transition ${from} → ${to}`);
}
function _dlpgovCheckJ(from, to) {
  const a = _dlpgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dlpgov scan transition ${from} → ${to}`);
}
function _dlpgovCountActive(owner) {
  let c = 0;
  for (const p of _dlpgovPsV2.values())
    if (p.owner === owner && p.status === DLPGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _dlpgovCountPending(profileId) {
  let c = 0;
  for (const j of _dlpgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === DLPGOV_SCAN_LIFECYCLE_V2.QUEUED ||
        j.status === DLPGOV_SCAN_LIFECYCLE_V2.SCANNING)
    )
      c++;
  return c;
}
export function setMaxActiveDlpgovProfilesPerOwnerV2(n) {
  _dlpgovMaxActive = _dlpgovPos(n, "maxActiveDlpgovProfilesPerOwner");
}
export function getMaxActiveDlpgovProfilesPerOwnerV2() {
  return _dlpgovMaxActive;
}
export function setMaxPendingDlpgovScansPerProfileV2(n) {
  _dlpgovMaxPending = _dlpgovPos(n, "maxPendingDlpgovScansPerProfile");
}
export function getMaxPendingDlpgovScansPerProfileV2() {
  return _dlpgovMaxPending;
}
export function setDlpgovProfileIdleMsV2(n) {
  _dlpgovIdleMs = _dlpgovPos(n, "dlpgovProfileIdleMs");
}
export function getDlpgovProfileIdleMsV2() {
  return _dlpgovIdleMs;
}
export function setDlpgovScanStuckMsV2(n) {
  _dlpgovStuckMs = _dlpgovPos(n, "dlpgovScanStuckMs");
}
export function getDlpgovScanStuckMsV2() {
  return _dlpgovStuckMs;
}
export function _resetStateDlpEngineGovV2() {
  _dlpgovPsV2.clear();
  _dlpgovJsV2.clear();
  _dlpgovMaxActive = 8;
  _dlpgovMaxPending = 20;
  _dlpgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _dlpgovStuckMs = 60 * 1000;
}
export function registerDlpgovProfileV2({
  id,
  owner,
  classification,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_dlpgovPsV2.has(id))
    throw new Error(`dlpgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    classification: classification || "internal",
    status: DLPGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dlpgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateDlpgovProfileV2(id) {
  const p = _dlpgovPsV2.get(id);
  if (!p) throw new Error(`dlpgov profile ${id} not found`);
  const isInitial = p.status === DLPGOV_PROFILE_MATURITY_V2.PENDING;
  _dlpgovCheckP(p.status, DLPGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _dlpgovCountActive(p.owner) >= _dlpgovMaxActive)
    throw new Error(`max active dlpgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = DLPGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendDlpgovProfileV2(id) {
  const p = _dlpgovPsV2.get(id);
  if (!p) throw new Error(`dlpgov profile ${id} not found`);
  _dlpgovCheckP(p.status, DLPGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = DLPGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveDlpgovProfileV2(id) {
  const p = _dlpgovPsV2.get(id);
  if (!p) throw new Error(`dlpgov profile ${id} not found`);
  _dlpgovCheckP(p.status, DLPGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = DLPGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchDlpgovProfileV2(id) {
  const p = _dlpgovPsV2.get(id);
  if (!p) throw new Error(`dlpgov profile ${id} not found`);
  if (_dlpgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal dlpgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getDlpgovProfileV2(id) {
  const p = _dlpgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDlpgovProfilesV2() {
  return [..._dlpgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createDlpgovScanV2({ id, profileId, resource, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_dlpgovJsV2.has(id)) throw new Error(`dlpgov scan ${id} already exists`);
  if (!_dlpgovPsV2.has(profileId))
    throw new Error(`dlpgov profile ${profileId} not found`);
  if (_dlpgovCountPending(profileId) >= _dlpgovMaxPending)
    throw new Error(
      `max pending dlpgov scans for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    resource: resource || "",
    status: DLPGOV_SCAN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dlpgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function scanningDlpgovScanV2(id) {
  const j = _dlpgovJsV2.get(id);
  if (!j) throw new Error(`dlpgov scan ${id} not found`);
  _dlpgovCheckJ(j.status, DLPGOV_SCAN_LIFECYCLE_V2.SCANNING);
  const now = Date.now();
  j.status = DLPGOV_SCAN_LIFECYCLE_V2.SCANNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeScanDlpgovV2(id) {
  const j = _dlpgovJsV2.get(id);
  if (!j) throw new Error(`dlpgov scan ${id} not found`);
  _dlpgovCheckJ(j.status, DLPGOV_SCAN_LIFECYCLE_V2.SCANNED);
  const now = Date.now();
  j.status = DLPGOV_SCAN_LIFECYCLE_V2.SCANNED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failDlpgovScanV2(id, reason) {
  const j = _dlpgovJsV2.get(id);
  if (!j) throw new Error(`dlpgov scan ${id} not found`);
  _dlpgovCheckJ(j.status, DLPGOV_SCAN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = DLPGOV_SCAN_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelDlpgovScanV2(id, reason) {
  const j = _dlpgovJsV2.get(id);
  if (!j) throw new Error(`dlpgov scan ${id} not found`);
  _dlpgovCheckJ(j.status, DLPGOV_SCAN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = DLPGOV_SCAN_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getDlpgovScanV2(id) {
  const j = _dlpgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listDlpgovScansV2() {
  return [..._dlpgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleDlpgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _dlpgovPsV2.values())
    if (
      p.status === DLPGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _dlpgovIdleMs
    ) {
      p.status = DLPGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDlpgovScansV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _dlpgovJsV2.values())
    if (
      j.status === DLPGOV_SCAN_LIFECYCLE_V2.SCANNING &&
      j.startedAt != null &&
      t - j.startedAt >= _dlpgovStuckMs
    ) {
      j.status = DLPGOV_SCAN_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getDlpEngineGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(DLPGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _dlpgovPsV2.values()) profilesByStatus[p.status]++;
  const scansByStatus = {};
  for (const v of Object.values(DLPGOV_SCAN_LIFECYCLE_V2)) scansByStatus[v] = 0;
  for (const j of _dlpgovJsV2.values()) scansByStatus[j.status]++;
  return {
    totalDlpgovProfilesV2: _dlpgovPsV2.size,
    totalDlpgovScansV2: _dlpgovJsV2.size,
    maxActiveDlpgovProfilesPerOwner: _dlpgovMaxActive,
    maxPendingDlpgovScansPerProfile: _dlpgovMaxPending,
    dlpgovProfileIdleMs: _dlpgovIdleMs,
    dlpgovScanStuckMs: _dlpgovStuckMs,
    profilesByStatus,
    scansByStatus,
  };
}
