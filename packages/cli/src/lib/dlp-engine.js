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
      if ((actionPriority[policy.action] || 0) > (actionPriority[highestAction] || 0)) {
        highestAction = policy.action;
      }
    }
  }

  const incidents = [];
  if (matchedPolicies.length > 0) {
    for (const policy of matchedPolicies) {
      const incidentId = crypto.randomUUID();
      const now = new Date().toISOString();
      const contentHash = crypto.createHash("sha256").update(content).digest("hex");

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

    if (highestAction === DLP_ACTIONS.BLOCK || highestAction === DLP_ACTIONS.QUARANTINE) {
      _blockCount++;
    } else if (highestAction === DLP_ACTIONS.ALERT) {
      _alertCount++;
    }
  }

  return {
    allowed: highestAction === DLP_ACTIONS.ALLOW || highestAction === DLP_ACTIONS.ALERT,
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
}
