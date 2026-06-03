/**
 * Plugin Ecosystem v2.0 — CLI port of Phase 64 智能插件生态2.0
 * (docs/design/modules/64_智能插件生态2.0.md).
 *
 * Desktop ships 8 IPC handlers for an AI-driven plugin ecosystem:
 * recommendation (user profile + collaborative filtering + context),
 * dependency resolver (version negotiation + cycle detection),
 * sandbox tester (resource-limited isolated testing), AI code reviewer
 * (security + quality + API compliance), publisher (package + sign +
 * upload), and revenue manager (download tracking + dev share).
 *
 * CLI port is headless and heuristic-only:
 * - Recommendation uses category overlap + download count + rating
 *   weighting against user's installed plugins (NO collaborative
 *   filtering / ML model / embedding match)
 * - Dependency resolver does real flatten + cycle detection + exact
 *   version conflict detection (NO full semver range negotiation)
 * - Sandbox tester is caller-pushed: you give the test result, CLI
 *   just records it (NO real vm / process isolation)
 * - AI review is regex-based security + quality rules with weighted
 *   severity score (NO LLM call)
 * - Publish flips a status flag + computes a content hash (NO real
 *   packaging / signing / upload)
 * - Revenue tracking is double-entry event log with calculated
 *   developer share (NO payment gateway)
 */

import crypto from "crypto";

/* ── Constants ───────────────────────────────────────────── */

export const REVIEW_SEVERITY = Object.freeze({
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
  BLOCKER: "blocker",
});

export const PUBLISH_STATUS = Object.freeze({
  DRAFT: "draft",
  REVIEWING: "reviewing",
  APPROVED: "approved",
  REJECTED: "rejected",
  PUBLISHED: "published",
});

export const REVENUE_TYPE = Object.freeze({
  DOWNLOAD: "download",
  SUBSCRIPTION: "subscription",
  DONATION: "donation",
  PREMIUM: "premium",
});

export const INSTALL_STATUS = Object.freeze({
  PENDING: "pending",
  RESOLVING: "resolving",
  INSTALLED: "installed",
  FAILED: "failed",
  UNINSTALLED: "uninstalled",
});

export const DEP_KIND = Object.freeze({
  REQUIRED: "required",
  OPTIONAL: "optional",
  PEER: "peer",
});

export const SANDBOX_RESULT = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  TIMEOUT: "timeout",
  RESOURCE_EXCEEDED: "resource-exceeded",
});

export const DEFAULT_DEVELOPER_SHARE = 0.7;
export const DEFAULT_SANDBOX_MEMORY_MB = 256;
export const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RECOMMENDATIONS = 20;

/* ── Heuristic review rules ──────────────────────────────── */

const REVIEW_RULES = Object.freeze([
  {
    id: "code-injection-eval",
    pattern: /\beval\s*\(/g,
    severity: REVIEW_SEVERITY.BLOCKER,
    message: "Use of eval() — code injection risk",
    penalty: 40,
  },
  {
    id: "code-injection-new-function",
    pattern: /new\s+Function\s*\(/g,
    severity: REVIEW_SEVERITY.CRITICAL,
    message: "Dynamic Function constructor — code injection risk",
    penalty: 30,
  },
  {
    id: "shell-exec",
    pattern: /\bexec(?:Sync)?\s*\(|spawnSync\s*\(/g,
    severity: REVIEW_SEVERITY.CRITICAL,
    message: "Shell command execution — command injection risk",
    penalty: 20,
  },
  {
    id: "fs-write",
    pattern: /fs\.(?:writeFile|unlink|rm|rmdir|mkdir)/g,
    severity: REVIEW_SEVERITY.WARNING,
    message: "Filesystem write/delete — review scope carefully",
    penalty: 10,
  },
  {
    id: "child-process",
    pattern:
      /require\(\s*['"]child_process['"]\s*\)|from\s+['"]child_process['"]/g,
    severity: REVIEW_SEVERITY.WARNING,
    message: "child_process import — review command usage",
    penalty: 10,
  },
  {
    id: "network-request",
    pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|require\(\s*['"]http['"]\s*\)/g,
    severity: REVIEW_SEVERITY.INFO,
    message: "Network request — ensure URLs are allow-listed",
    penalty: 3,
  },
  {
    id: "env-access",
    pattern: /process\.env\b/g,
    severity: REVIEW_SEVERITY.INFO,
    message: "Environment variable access — review secrets exposure",
    penalty: 2,
  },
  {
    id: "hardcoded-secret",
    pattern:
      /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi,
    severity: REVIEW_SEVERITY.BLOCKER,
    message: "Hardcoded credential — remove before publishing",
    penalty: 40,
  },
]);

/* ── Schema ──────────────────────────────────────────────── */

export function ensurePluginEcosystemTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_eco_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      developer_id TEXT NOT NULL,
      category TEXT,
      description TEXT,
      manifest TEXT,
      source_hash TEXT,
      status TEXT NOT NULL,
      download_count INTEGER DEFAULT 0,
      avg_rating REAL DEFAULT 0.0,
      revenue_total REAL DEFAULT 0.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      published_at INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_eco_dependencies (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      dep_plugin_id TEXT NOT NULL,
      dep_version TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_eco_installs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_eco_reviews (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      source_hash TEXT,
      issues TEXT,
      score REAL NOT NULL,
      severity TEXT NOT NULL,
      strictness TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_eco_sandbox_tests (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      test_suite TEXT,
      result TEXT NOT NULL,
      metrics TEXT,
      logs TEXT,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_eco_revenue (
      id TEXT PRIMARY KEY,
      developer_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      developer_share REAL NOT NULL,
      platform_share REAL NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

/* ── Internals ───────────────────────────────────────────── */

const _now = () => Date.now();
const _uid = (prefix) => `${prefix}-${crypto.randomBytes(6).toString("hex")}`;

function _parseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function _sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function _rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    developerId: row.developer_id,
    category: row.category,
    description: row.description,
    manifest: _parseJSON(row.manifest, {}),
    sourceHash: row.source_hash,
    status: row.status,
    downloadCount: row.download_count,
    avgRating: row.avg_rating,
    revenueTotal: row.revenue_total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function _rowToDep(row) {
  if (!row) return null;
  return {
    id: row.id,
    pluginId: row.plugin_id,
    depPluginId: row.dep_plugin_id,
    depVersion: row.dep_version,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function _rowToInstall(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    pluginId: row.plugin_id,
    version: row.version,
    status: row.status,
    errorMessage: row.error_message,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

function _rowToReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    pluginId: row.plugin_id,
    sourceHash: row.source_hash,
    issues: _parseJSON(row.issues, []),
    score: row.score,
    severity: row.severity,
    strictness: row.strictness,
    createdAt: row.created_at,
  };
}

function _rowToSandbox(row) {
  if (!row) return null;
  return {
    id: row.id,
    pluginId: row.plugin_id,
    testSuite: row.test_suite,
    result: row.result,
    metrics: _parseJSON(row.metrics, {}),
    logs: _parseJSON(row.logs, []),
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

function _rowToRevenue(row) {
  if (!row) return null;
  return {
    id: row.id,
    developerId: row.developer_id,
    pluginId: row.plugin_id,
    userId: row.user_id,
    type: row.type,
    amount: row.amount,
    developerShare: row.developer_share,
    platformShare: row.platform_share,
    createdAt: row.created_at,
  };
}

function _getEntryRow(db, pluginId) {
  return db
    .prepare("SELECT * FROM plugin_eco_entries WHERE id = ?")
    .get(pluginId);
}

/* ── Plugin registry ─────────────────────────────────────── */

export function registerPlugin(
  db,
  {
    name,
    version,
    developerId,
    category = null,
    description = null,
    manifest = {},
  } = {},
) {
  if (!name) throw new Error("name is required");
  if (!version) throw new Error("version is required");
  if (!developerId) throw new Error("developerId is required");

  const id = _uid("plg");
  const now = _now();
  db.prepare(
    `INSERT INTO plugin_eco_entries (id, name, version, developer_id, category, description, manifest, status, download_count, avg_rating, revenue_total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    version,
    developerId,
    category,
    description,
    JSON.stringify(manifest || {}),
    PUBLISH_STATUS.DRAFT,
    0,
    0,
    0,
    now,
    now,
  );
  return getPlugin(db, id);
}

export function getPlugin(db, pluginId) {
  return _rowToEntry(_getEntryRow(db, pluginId));
}

export function listPlugins(
  db,
  { category, status, developerId, limit = 100 } = {},
) {
  const wheres = [];
  const params = [];
  if (category) {
    wheres.push("category = ?");
    params.push(category);
  }
  if (status) {
    wheres.push("status = ?");
    params.push(status);
  }
  if (developerId) {
    wheres.push("developer_id = ?");
    params.push(developerId);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM plugin_eco_entries ${where} ORDER BY download_count DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(_rowToEntry);
}

export function updatePluginStats(
  db,
  pluginId,
  { downloadCount = null, avgRating = null } = {},
) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

  const sets = [];
  const params = [];
  if (downloadCount != null) {
    sets.push("download_count = ?");
    params.push(downloadCount);
  }
  if (avgRating != null) {
    sets.push("avg_rating = ?");
    params.push(avgRating);
  }
  if (!sets.length) return getPlugin(db, pluginId);

  sets.push("updated_at = ?");
  params.push(_now());
  params.push(pluginId);
  db.prepare(
    `UPDATE plugin_eco_entries SET ${sets.join(", ")} WHERE id = ?`,
  ).run(...params);
  return getPlugin(db, pluginId);
}

/* ── Dependencies ────────────────────────────────────────── */

export function addDependency(
  db,
  pluginId,
  { depPluginId, depVersion, kind = DEP_KIND.REQUIRED } = {},
) {
  if (!depPluginId) throw new Error("depPluginId is required");
  if (!depVersion) throw new Error("depVersion is required");
  if (!Object.values(DEP_KIND).includes(kind)) {
    throw new Error(`Unknown dep kind: ${kind}`);
  }
  const id = _uid("dep");
  const now = _now();
  db.prepare(
    `INSERT INTO plugin_eco_dependencies (id, plugin_id, dep_plugin_id, dep_version, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, pluginId, depPluginId, depVersion, kind, now);
  return _rowToDep(
    db.prepare("SELECT * FROM plugin_eco_dependencies WHERE id = ?").get(id),
  );
}

export function listDependencies(db, pluginId) {
  const rows = db
    .prepare(
      "SELECT * FROM plugin_eco_dependencies WHERE plugin_id = ? ORDER BY created_at ASC",
    )
    .all(pluginId);
  return rows.map(_rowToDep);
}

export function resolveDependencies(db, pluginId) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

  const flat = new Map(); // depPluginId → { depVersion, kind, path[] }
  const conflicts = [];
  const circular = [];
  const visited = new Set();
  const stack = new Set();

  function walk(currentId, path) {
    if (stack.has(currentId)) {
      circular.push([...path, currentId]);
      return;
    }
    if (visited.has(currentId)) return;
    visited.add(currentId);
    stack.add(currentId);

    const deps = listDependencies(db, currentId);
    for (const dep of deps) {
      if (dep.kind === DEP_KIND.OPTIONAL) continue;
      const existing = flat.get(dep.depPluginId);
      if (existing && existing.depVersion !== dep.depVersion) {
        conflicts.push({
          depPluginId: dep.depPluginId,
          requiredByA: existing.path[existing.path.length - 1],
          requiredByB: currentId,
          versionA: existing.depVersion,
          versionB: dep.depVersion,
        });
      }
      if (!existing) {
        flat.set(dep.depPluginId, {
          depVersion: dep.depVersion,
          kind: dep.kind,
          path: [...path, currentId],
        });
      }
      walk(dep.depPluginId, [...path, currentId]);
    }
    stack.delete(currentId);
  }

  walk(pluginId, []);

  return {
    pluginId,
    dependencies: Array.from(flat.entries()).map(([id, info]) => ({
      depPluginId: id,
      depVersion: info.depVersion,
      kind: info.kind,
      path: info.path,
    })),
    conflicts,
    circular,
  };
}

/* ── Installation ────────────────────────────────────────── */

export function installPlugin(
  db,
  { userId, pluginId, version = null, autoResolveDeps = true } = {},
) {
  if (!userId) throw new Error("userId is required");
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

  const targetVersion = version || entry.version;
  const resolved = autoResolveDeps ? resolveDependencies(db, pluginId) : null;

  const id = _uid("ins");
  const now = _now();
  let status = INSTALL_STATUS.INSTALLED;
  let errorMessage = null;

  if (resolved && resolved.circular.length > 0) {
    status = INSTALL_STATUS.FAILED;
    errorMessage = `circular dependency: ${resolved.circular[0].join(" → ")}`;
  } else if (resolved && resolved.conflicts.length > 0) {
    status = INSTALL_STATUS.FAILED;
    errorMessage = `version conflict: ${resolved.conflicts[0].depPluginId} (${resolved.conflicts[0].versionA} vs ${resolved.conflicts[0].versionB})`;
  }

  db.prepare(
    `INSERT INTO plugin_eco_installs (id, user_id, plugin_id, version, status, error_message, installed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, pluginId, targetVersion, status, errorMessage, now, now);

  if (status === INSTALL_STATUS.INSTALLED) {
    const newCount = (entry.download_count || 0) + 1;
    db.prepare(
      "UPDATE plugin_eco_entries SET download_count = ?, updated_at = ? WHERE id = ?",
    ).run(newCount, now, pluginId);
  }

  return {
    install: _rowToInstall(
      db.prepare("SELECT * FROM plugin_eco_installs WHERE id = ?").get(id),
    ),
    resolved,
  };
}

export function listInstalls(
  db,
  { userId, pluginId, status, limit = 100 } = {},
) {
  const wheres = [];
  const params = [];
  if (userId) {
    wheres.push("user_id = ?");
    params.push(userId);
  }
  if (pluginId) {
    wheres.push("plugin_id = ?");
    params.push(pluginId);
  }
  if (status) {
    wheres.push("status = ?");
    params.push(status);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM plugin_eco_installs ${where} ORDER BY installed_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(_rowToInstall);
}

export function uninstallPlugin(db, installId) {
  const row = db
    .prepare("SELECT * FROM plugin_eco_installs WHERE id = ?")
    .get(installId);
  if (!row) throw new Error(`Install not found: ${installId}`);
  if (row.status === INSTALL_STATUS.UNINSTALLED) {
    throw new Error("Install already uninstalled");
  }
  const now = _now();
  db.prepare(
    "UPDATE plugin_eco_installs SET status = ?, updated_at = ? WHERE id = ?",
  ).run(INSTALL_STATUS.UNINSTALLED, now, installId);
  return _rowToInstall(
    db.prepare("SELECT * FROM plugin_eco_installs WHERE id = ?").get(installId),
  );
}

/* ── AI Code Review (heuristic) ──────────────────────────── */

export function aiReviewCode(
  db,
  pluginId,
  { sourceCode = "", strictness = "standard" } = {},
) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

  const code = String(sourceCode || "");
  const sourceHash = code ? _sha256Hex(code) : null;

  const strictMultiplier =
    strictness === "strict" ? 1.5 : strictness === "lenient" ? 0.6 : 1.0;

  const issues = [];
  let maxSeverity = REVIEW_SEVERITY.INFO;
  let totalPenalty = 0;

  for (const rule of REVIEW_RULES) {
    const matches = [...code.matchAll(rule.pattern)];
    if (!matches.length) continue;
    for (const m of matches) {
      const idx = m.index ?? 0;
      const line = code.slice(0, idx).split("\n").length;
      issues.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: rule.message,
        line,
        snippet: (m[0] || "").slice(0, 80),
      });
    }
    totalPenalty += rule.penalty * matches.length * strictMultiplier;
    if (_severityRank(rule.severity) > _severityRank(maxSeverity)) {
      maxSeverity = rule.severity;
    }
  }

  const score = Math.max(0, Math.round(100 - totalPenalty));

  const id = _uid("rev");
  const now = _now();
  db.prepare(
    `INSERT INTO plugin_eco_reviews (id, plugin_id, source_hash, issues, score, severity, strictness, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pluginId,
    sourceHash,
    JSON.stringify(issues),
    score,
    maxSeverity,
    strictness,
    now,
  );
  return _rowToReview(
    db.prepare("SELECT * FROM plugin_eco_reviews WHERE id = ?").get(id),
  );
}

function _severityRank(s) {
  return { info: 0, warning: 1, critical: 2, blocker: 3 }[s] ?? 0;
}

export function getReview(db, reviewId) {
  return _rowToReview(
    db.prepare("SELECT * FROM plugin_eco_reviews WHERE id = ?").get(reviewId),
  );
}

export function listReviews(db, { pluginId, severity, limit = 100 } = {}) {
  const wheres = [];
  const params = [];
  if (pluginId) {
    wheres.push("plugin_id = ?");
    params.push(pluginId);
  }
  if (severity) {
    wheres.push("severity = ?");
    params.push(severity);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM plugin_eco_reviews ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(_rowToReview);
}

/* ── Sandbox testing ─────────────────────────────────────── */

export function recordSandboxTest(
  db,
  pluginId,
  {
    testSuite = "default",
    result = SANDBOX_RESULT.PASSED,
    metrics = {},
    logs = [],
    durationMs = null,
  } = {},
) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);

  if (!Object.values(SANDBOX_RESULT).includes(result)) {
    throw new Error(`Unknown sandbox result: ${result}`);
  }

  const id = _uid("sbx");
  const now = _now();
  db.prepare(
    `INSERT INTO plugin_eco_sandbox_tests (id, plugin_id, test_suite, result, metrics, logs, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    pluginId,
    testSuite,
    result,
    JSON.stringify(metrics || {}),
    JSON.stringify(logs || []),
    durationMs,
    now,
  );
  return _rowToSandbox(
    db.prepare("SELECT * FROM plugin_eco_sandbox_tests WHERE id = ?").get(id),
  );
}

export function getSandboxTest(db, testId) {
  return _rowToSandbox(
    db
      .prepare("SELECT * FROM plugin_eco_sandbox_tests WHERE id = ?")
      .get(testId),
  );
}

export function listSandboxTests(db, { pluginId, result, limit = 100 } = {}) {
  const wheres = [];
  const params = [];
  if (pluginId) {
    wheres.push("plugin_id = ?");
    params.push(pluginId);
  }
  if (result) {
    wheres.push("result = ?");
    params.push(result);
  }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT * FROM plugin_eco_sandbox_tests ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params);
  return rows.map(_rowToSandbox);
}

/* ── Publish flow ────────────────────────────────────────── */

export function submitForReview(db, pluginId) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
  if (
    entry.status !== PUBLISH_STATUS.DRAFT &&
    entry.status !== PUBLISH_STATUS.REJECTED
  ) {
    throw new Error(
      `Cannot submit for review from status ${entry.status} (must be draft or rejected)`,
    );
  }
  const now = _now();
  db.prepare(
    "UPDATE plugin_eco_entries SET status = ?, updated_at = ? WHERE id = ?",
  ).run(PUBLISH_STATUS.REVIEWING, now, pluginId);
  return getPlugin(db, pluginId);
}

export function approvePlugin(db, pluginId) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
  if (entry.status !== PUBLISH_STATUS.REVIEWING) {
    throw new Error(
      `Cannot approve plugin in status ${entry.status} (must be reviewing)`,
    );
  }
  const now = _now();
  db.prepare(
    "UPDATE plugin_eco_entries SET status = ?, updated_at = ? WHERE id = ?",
  ).run(PUBLISH_STATUS.APPROVED, now, pluginId);
  return getPlugin(db, pluginId);
}

export function rejectPlugin(db, pluginId, reason = "review rejected") {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
  if (entry.status !== PUBLISH_STATUS.REVIEWING) {
    throw new Error(
      `Cannot reject plugin in status ${entry.status} (must be reviewing)`,
    );
  }
  const now = _now();
  db.prepare(
    "UPDATE plugin_eco_entries SET status = ?, updated_at = ? WHERE id = ?",
  ).run(PUBLISH_STATUS.REJECTED, now, pluginId);
  // Store reason as a "rejection" review record so it shows up in listReviews
  db.prepare(
    `INSERT INTO plugin_eco_reviews (id, plugin_id, source_hash, issues, score, severity, strictness, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    _uid("rev"),
    pluginId,
    null,
    JSON.stringify([
      {
        ruleId: "review-rejected",
        severity: REVIEW_SEVERITY.BLOCKER,
        message: reason,
      },
    ]),
    0,
    REVIEW_SEVERITY.BLOCKER,
    "rejection",
    now,
  );
  return getPlugin(db, pluginId);
}

export function publishPlugin(
  db,
  pluginId,
  { sourceCode = "", changelog = "" } = {},
) {
  const entry = _getEntryRow(db, pluginId);
  if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
  if (entry.status !== PUBLISH_STATUS.APPROVED) {
    throw new Error(
      `Cannot publish plugin in status ${entry.status} (must be approved)`,
    );
  }
  const now = _now();
  const sourceHash = sourceCode ? _sha256Hex(sourceCode) : null;
  const manifest = _parseJSON(entry.manifest, {});
  if (changelog) manifest.lastChangelog = changelog;
  db.prepare(
    `UPDATE plugin_eco_entries SET status = ?, source_hash = ?, manifest = ?, published_at = ?, updated_at = ? WHERE id = ?`,
  ).run(
    PUBLISH_STATUS.PUBLISHED,
    sourceHash,
    JSON.stringify(manifest),
    now,
    now,
    pluginId,
  );
  return getPlugin(db, pluginId);
}

/* ── Revenue ─────────────────────────────────────────────── */

export function recordRevenue(
  db,
  {
    developerId,
    pluginId,
    userId = null,
    type,
    amount,
    developerShareRatio = DEFAULT_DEVELOPER_SHARE,
  } = {},
) {
  if (!developerId) throw new Error("developerId is required");
  if (!pluginId) throw new Error("pluginId is required");
  if (!Object.values(REVENUE_TYPE).includes(type)) {
    throw new Error(`Unknown revenue type: ${type}`);
  }
  if (typeof amount !== "number" || amount < 0) {
    throw new Error("amount must be a non-negative number");
  }
  if (developerShareRatio < 0 || developerShareRatio > 1) {
    throw new Error("developerShareRatio must be in [0, 1]");
  }

  const developerShare = amount * developerShareRatio;
  const platformShare = amount - developerShare;
  const id = _uid("rev");
  const now = _now();
  db.prepare(
    `INSERT INTO plugin_eco_revenue (id, developer_id, plugin_id, user_id, type, amount, developer_share, platform_share, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    developerId,
    pluginId,
    userId,
    type,
    amount,
    developerShare,
    platformShare,
    now,
  );

  const currentEntry = _getEntryRow(db, pluginId);
  const newRevenueTotal = (currentEntry?.revenue_total || 0) + amount;
  db.prepare(
    "UPDATE plugin_eco_entries SET revenue_total = ?, updated_at = ? WHERE id = ?",
  ).run(newRevenueTotal, now, pluginId);

  return _rowToRevenue(
    db.prepare("SELECT * FROM plugin_eco_revenue WHERE id = ?").get(id),
  );
}

export function getDeveloperRevenue(
  db,
  developerId,
  { from = null, to = null, pluginId = null } = {},
) {
  const wheres = ["developer_id = ?"];
  const params = [developerId];
  if (from != null) {
    wheres.push("created_at >= ?");
    params.push(from);
  }
  if (to != null) {
    wheres.push("created_at <= ?");
    params.push(to);
  }
  if (pluginId) {
    wheres.push("plugin_id = ?");
    params.push(pluginId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM plugin_eco_revenue WHERE ${wheres.join(" AND ")} ORDER BY created_at DESC`,
    )
    .all(...params);

  const events = rows.map(_rowToRevenue);
  const totalGross = events.reduce((s, e) => s + e.amount, 0);
  const totalDeveloper = events.reduce((s, e) => s + e.developerShare, 0);
  const totalPlatform = events.reduce((s, e) => s + e.platformShare, 0);
  const byType = {};
  const byPlugin = {};
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + e.amount;
    byPlugin[e.pluginId] = (byPlugin[e.pluginId] || 0) + e.amount;
  }

  return {
    developerId,
    totalGross,
    totalDeveloperShare: totalDeveloper,
    totalPlatformShare: totalPlatform,
    eventCount: events.length,
    byType,
    byPlugin,
    events,
  };
}

/* ── Recommendation (heuristic) ──────────────────────────── */

export function recommend(
  db,
  { userId, category = null, limit = DEFAULT_MAX_RECOMMENDATIONS } = {},
) {
  if (!userId) throw new Error("userId is required");

  const installed = listInstalls(db, { userId }).filter(
    (i) => i.status === INSTALL_STATUS.INSTALLED,
  );
  const installedIds = new Set(installed.map((i) => i.pluginId));

  // Discover user's favored categories
  const categoryScores = {};
  for (const inst of installed) {
    const entry = getPlugin(db, inst.pluginId);
    if (entry && entry.category) {
      categoryScores[entry.category] =
        (categoryScores[entry.category] || 0) + 1;
    }
  }

  const candidates = listPlugins(db, {
    category: category || undefined,
    status: PUBLISH_STATUS.PUBLISHED,
    limit: 500,
  });

  const scored = [];
  for (const plugin of candidates) {
    if (installedIds.has(plugin.id)) continue;
    const categoryAffinity = plugin.category
      ? categoryScores[plugin.category] || 0
      : 0;
    const downloadScore = Math.log10((plugin.downloadCount || 0) + 1);
    const ratingScore = (plugin.avgRating || 0) * 2;
    const score = categoryAffinity * 10 + downloadScore * 3 + ratingScore + 1;
    scored.push({
      plugin,
      score,
      reasons: {
        categoryAffinity,
        downloadScore,
        ratingScore,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    userId,
    context: category,
    userCategories: Object.entries(categoryScores)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, weight: count })),
    recommendations: scored.slice(0, limit),
  };
}

/* ── Stats / Config ──────────────────────────────────────── */

export function getConfig() {
  return {
    reviewSeverities: Object.values(REVIEW_SEVERITY),
    publishStatuses: Object.values(PUBLISH_STATUS),
    revenueTypes: Object.values(REVENUE_TYPE),
    installStatuses: Object.values(INSTALL_STATUS),
    depKinds: Object.values(DEP_KIND),
    sandboxResults: Object.values(SANDBOX_RESULT),
    defaults: {
      developerShare: DEFAULT_DEVELOPER_SHARE,
      sandboxMemoryMb: DEFAULT_SANDBOX_MEMORY_MB,
      sandboxTimeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS,
      maxRecommendations: DEFAULT_MAX_RECOMMENDATIONS,
    },
    reviewRules: REVIEW_RULES.map((r) => ({
      id: r.id,
      severity: r.severity,
      message: r.message,
      penalty: r.penalty,
    })),
  };
}

export function getStats(db) {
  const plugins = db.prepare("SELECT * FROM plugin_eco_entries").all();
  const installs = db.prepare("SELECT * FROM plugin_eco_installs").all();
  const reviews = db.prepare("SELECT * FROM plugin_eco_reviews").all();
  const sandboxTests = db
    .prepare("SELECT * FROM plugin_eco_sandbox_tests")
    .all();
  const revenue = db.prepare("SELECT * FROM plugin_eco_revenue").all();

  const byStatus = {};
  for (const p of plugins) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

  const byCategory = {};
  for (const p of plugins) {
    if (p.category) byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  }

  const bySeverity = {};
  for (const r of reviews)
    bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;

  const totalRevenue = revenue.reduce((s, r) => s + (r.amount || 0), 0);
  const totalDeveloperShare = revenue.reduce(
    (s, r) => s + (r.developer_share || 0),
    0,
  );

  return {
    totalPlugins: plugins.length,
    pluginsByStatus: byStatus,
    pluginsByCategory: byCategory,
    totalInstalls: installs.length,
    totalReviews: reviews.length,
    reviewsBySeverity: bySeverity,
    totalSandboxTests: sandboxTests.length,
    totalRevenueEvents: revenue.length,
    totalRevenueGross: totalRevenue,
    totalDeveloperShare,
  };
}

// ═══════════════════════════════════════════════════════════════
// Phase 64 V2 — Plugin maturity + formal install lifecycles,
// per-developer active-plugin cap, per-user pending-install cap,
// auto-deprecate + auto-archive
// ═══════════════════════════════════════════════════════════════

export const PLUGIN_MATURITY_V2 = Object.freeze({
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived",
  REMOVED: "removed",
});

export const INSTALL_LIFECYCLE_V2 = Object.freeze({
  PENDING: "pending",
  RESOLVING: "resolving",
  INSTALLED: "installed",
  FAILED: "failed",
  UNINSTALLED: "uninstalled",
});

export const PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER = 20;
export const PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER = 5;
export const PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
export const PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

let _maxActivePluginsPerDeveloper = PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER;
let _maxPendingInstallsPerUser = PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER;
let _autoDeprecateAfterMs = PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS;
let _autoArchiveAfterMs = PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS;

const _maturityStatesV2 = new Map();
const _installStatesV2 = new Map();

const MATURITY_TRANSITIONS_V2 = new Map([
  ["active", new Set(["deprecated", "archived"])],
  ["deprecated", new Set(["active", "archived", "removed"])],
  ["archived", new Set(["active", "removed"])],
]);
const MATURITY_TERMINALS_V2 = new Set(["removed"]);

const INSTALL_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["resolving", "failed", "uninstalled"])],
  ["resolving", new Set(["installed", "failed"])],
  ["installed", new Set(["uninstalled"])],
  ["failed", new Set(["pending", "uninstalled"])],
]);
const INSTALL_TERMINALS_V2 = new Set(["uninstalled"]);

function _positiveIntV2(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(v);
}

export function setMaxActivePluginsPerDeveloper(n) {
  _maxActivePluginsPerDeveloper = _positiveIntV2(
    n,
    "maxActivePluginsPerDeveloper",
  );
  return _maxActivePluginsPerDeveloper;
}

export function setMaxPendingInstallsPerUser(n) {
  _maxPendingInstallsPerUser = _positiveIntV2(n, "maxPendingInstallsPerUser");
  return _maxPendingInstallsPerUser;
}

export function setAutoDeprecateAfterMs(ms) {
  _autoDeprecateAfterMs = _positiveIntV2(ms, "autoDeprecateAfterMs");
  return _autoDeprecateAfterMs;
}

export function setAutoArchiveAfterMs(ms) {
  _autoArchiveAfterMs = _positiveIntV2(ms, "autoArchiveAfterMs");
  return _autoArchiveAfterMs;
}

export function getMaxActivePluginsPerDeveloper() {
  return _maxActivePluginsPerDeveloper;
}

export function getMaxPendingInstallsPerUser() {
  return _maxPendingInstallsPerUser;
}

export function getAutoDeprecateAfterMs() {
  return _autoDeprecateAfterMs;
}

export function getAutoArchiveAfterMs() {
  return _autoArchiveAfterMs;
}

export function getActivePluginCount(developerId) {
  let count = 0;
  for (const entry of _maturityStatesV2.values()) {
    if (entry.status !== PLUGIN_MATURITY_V2.ACTIVE) continue;
    if (!developerId || entry.developerId === developerId) count += 1;
  }
  return count;
}

export function getPendingInstallCount(userId) {
  let count = 0;
  for (const entry of _installStatesV2.values()) {
    if (
      entry.status !== INSTALL_LIFECYCLE_V2.PENDING &&
      entry.status !== INSTALL_LIFECYCLE_V2.RESOLVING
    ) {
      continue;
    }
    if (!userId || entry.userId === userId) count += 1;
  }
  return count;
}

/* ── Maturity V2 ────────────────────────────────────── */

export function registerPluginV2(db, { pluginId, developerId, metadata } = {}) {
  if (!pluginId) throw new Error("pluginId is required");
  if (!developerId) throw new Error("developerId is required");
  if (_maturityStatesV2.has(pluginId)) {
    throw new Error(`Plugin already registered: ${pluginId}`);
  }
  const activeCount = getActivePluginCount(developerId);
  if (activeCount >= _maxActivePluginsPerDeveloper) {
    throw new Error(
      `Max active plugins reached (${activeCount}/${_maxActivePluginsPerDeveloper}) for developer ${developerId}`,
    );
  }
  const now = Date.now();
  const entry = {
    pluginId,
    developerId,
    status: PLUGIN_MATURITY_V2.ACTIVE,
    reason: null,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  };
  _maturityStatesV2.set(pluginId, entry);
  return { ...entry };
}

export function getMaturityV2(pluginId) {
  const entry = _maturityStatesV2.get(pluginId);
  return entry ? { ...entry } : null;
}

export function setPluginMaturityV2(db, pluginId, newStatus, patch = {}) {
  const entry = _maturityStatesV2.get(pluginId);
  if (!entry) throw new Error(`Plugin not registered: ${pluginId}`);
  if (!Object.values(PLUGIN_MATURITY_V2).includes(newStatus)) {
    throw new Error(`Invalid maturity status: ${newStatus}`);
  }
  if (MATURITY_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Plugin is terminal: ${entry.status}`);
  }
  const allowed = MATURITY_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function deprecatePlugin(db, pluginId, reason) {
  return setPluginMaturityV2(db, pluginId, PLUGIN_MATURITY_V2.DEPRECATED, {
    reason,
  });
}

export function archivePluginV2(db, pluginId, reason) {
  return setPluginMaturityV2(db, pluginId, PLUGIN_MATURITY_V2.ARCHIVED, {
    reason,
  });
}

export function removePluginV2(db, pluginId, reason) {
  return setPluginMaturityV2(db, pluginId, PLUGIN_MATURITY_V2.REMOVED, {
    reason,
  });
}

export function touchPluginActivity(pluginId) {
  const entry = _maturityStatesV2.get(pluginId);
  if (!entry) throw new Error(`Plugin not registered: ${pluginId}`);
  const now = Date.now();
  entry.lastActivityAt = now;
  entry.updatedAt = now;
  return { ...entry };
}

/* ── Install V2 ─────────────────────────────────────── */

export function submitInstallV2(
  db,
  { installId, userId, pluginId, metadata } = {},
) {
  if (!installId) throw new Error("installId is required");
  if (!userId) throw new Error("userId is required");
  if (!pluginId) throw new Error("pluginId is required");
  if (_installStatesV2.has(installId)) {
    throw new Error(`Install already registered: ${installId}`);
  }
  const maturityEntry = _maturityStatesV2.get(pluginId);
  if (
    maturityEntry &&
    maturityEntry.status !== PLUGIN_MATURITY_V2.ACTIVE &&
    maturityEntry.status !== PLUGIN_MATURITY_V2.DEPRECATED
  ) {
    throw new Error(`Plugin not installable: ${maturityEntry.status}`);
  }
  const pendingCount = getPendingInstallCount(userId);
  if (pendingCount >= _maxPendingInstallsPerUser) {
    throw new Error(
      `Max pending installs reached (${pendingCount}/${_maxPendingInstallsPerUser}) for user ${userId}`,
    );
  }
  const now = Date.now();
  const entry = {
    installId,
    userId,
    pluginId,
    status: INSTALL_LIFECYCLE_V2.PENDING,
    reason: null,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
  };
  _installStatesV2.set(installId, entry);
  return { ...entry };
}

export function getInstallStatusV2(installId) {
  const entry = _installStatesV2.get(installId);
  return entry ? { ...entry } : null;
}

export function setInstallStatusV2(db, installId, newStatus, patch = {}) {
  const entry = _installStatesV2.get(installId);
  if (!entry) throw new Error(`Install not found: ${installId}`);
  if (!Object.values(INSTALL_LIFECYCLE_V2).includes(newStatus)) {
    throw new Error(`Invalid install status: ${newStatus}`);
  }
  if (INSTALL_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Install is terminal: ${entry.status}`);
  }
  const allowed = INSTALL_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function resolveInstall(db, installId, reason) {
  return setInstallStatusV2(db, installId, INSTALL_LIFECYCLE_V2.RESOLVING, {
    reason,
  });
}

export function completeInstall(db, installId, reason) {
  return setInstallStatusV2(db, installId, INSTALL_LIFECYCLE_V2.INSTALLED, {
    reason,
  });
}

export function failInstall(db, installId, reason) {
  return setInstallStatusV2(db, installId, INSTALL_LIFECYCLE_V2.FAILED, {
    reason,
  });
}

export function uninstallInstallV2(db, installId, reason) {
  return setInstallStatusV2(db, installId, INSTALL_LIFECYCLE_V2.UNINSTALLED, {
    reason,
  });
}

export function retryFailedInstall(db, installId, reason) {
  return setInstallStatusV2(db, installId, INSTALL_LIFECYCLE_V2.PENDING, {
    reason,
  });
}

/* ── Auto-flip bulk operations ──────────────────────── */

export function autoDeprecateStalePlugins(db, nowMs = Date.now()) {
  const deprecated = [];
  for (const entry of _maturityStatesV2.values()) {
    if (entry.status !== PLUGIN_MATURITY_V2.ACTIVE) continue;
    if (nowMs - entry.lastActivityAt > _autoDeprecateAfterMs) {
      entry.status = PLUGIN_MATURITY_V2.DEPRECATED;
      entry.reason = "stale";
      entry.updatedAt = nowMs;
      deprecated.push({ ...entry });
    }
  }
  return deprecated;
}

export function autoArchiveLongDeprecated(db, nowMs = Date.now()) {
  const archived = [];
  for (const entry of _maturityStatesV2.values()) {
    if (entry.status !== PLUGIN_MATURITY_V2.DEPRECATED) continue;
    if (nowMs - entry.updatedAt > _autoArchiveAfterMs) {
      entry.status = PLUGIN_MATURITY_V2.ARCHIVED;
      entry.reason = "long-deprecated";
      entry.updatedAt = nowMs;
      archived.push({ ...entry });
    }
  }
  return archived;
}

/* ── Stats V2 ───────────────────────────────────────── */

export function getEcosystemStatsV2() {
  const maturityByStatus = {
    active: 0,
    deprecated: 0,
    archived: 0,
    removed: 0,
  };
  const installsByStatus = {
    pending: 0,
    resolving: 0,
    installed: 0,
    failed: 0,
    uninstalled: 0,
  };

  for (const entry of _maturityStatesV2.values()) {
    if (maturityByStatus[entry.status] !== undefined) {
      maturityByStatus[entry.status] += 1;
    }
  }
  for (const entry of _installStatesV2.values()) {
    if (installsByStatus[entry.status] !== undefined) {
      installsByStatus[entry.status] += 1;
    }
  }

  return {
    totalPluginsV2: _maturityStatesV2.size,
    totalInstallsV2: _installStatesV2.size,
    maxActivePluginsPerDeveloper: _maxActivePluginsPerDeveloper,
    maxPendingInstallsPerUser: _maxPendingInstallsPerUser,
    autoDeprecateAfterMs: _autoDeprecateAfterMs,
    autoArchiveAfterMs: _autoArchiveAfterMs,
    maturityByStatus,
    installsByStatus,
  };
}

/* ── Reset V2 (tests) ───────────────────────────────── */

export function _resetStateV2() {
  _maturityStatesV2.clear();
  _installStatesV2.clear();
  _maxActivePluginsPerDeveloper = PLUGIN_DEFAULT_MAX_ACTIVE_PER_DEVELOPER;
  _maxPendingInstallsPerUser = PLUGIN_DEFAULT_MAX_PENDING_INSTALLS_PER_USER;
  _autoDeprecateAfterMs = PLUGIN_DEFAULT_AUTO_DEPRECATE_AFTER_MS;
  _autoArchiveAfterMs = PLUGIN_DEFAULT_AUTO_ARCHIVE_AFTER_MS;
}

// =====================================================================
// plugin-ecosystem V2 governance overlay (iter24)
// =====================================================================
export const ECOGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DISABLED: "disabled",
  ARCHIVED: "archived",
});
export const ECOGOV_INSTALL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  INSTALLING: "installing",
  INSTALLED: "installed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ecogovPTrans = new Map([
  [
    ECOGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      ECOGOV_PROFILE_MATURITY_V2.ACTIVE,
      ECOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    ECOGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      ECOGOV_PROFILE_MATURITY_V2.DISABLED,
      ECOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    ECOGOV_PROFILE_MATURITY_V2.DISABLED,
    new Set([
      ECOGOV_PROFILE_MATURITY_V2.ACTIVE,
      ECOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [ECOGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ecogovPTerminal = new Set([ECOGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ecogovJTrans = new Map([
  [
    ECOGOV_INSTALL_LIFECYCLE_V2.QUEUED,
    new Set([
      ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLING,
      ECOGOV_INSTALL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLING,
    new Set([
      ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLED,
      ECOGOV_INSTALL_LIFECYCLE_V2.FAILED,
      ECOGOV_INSTALL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLED, new Set()],
  [ECOGOV_INSTALL_LIFECYCLE_V2.FAILED, new Set()],
  [ECOGOV_INSTALL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ecogovPsV2 = new Map();
const _ecogovJsV2 = new Map();
let _ecogovMaxActive = 12,
  _ecogovMaxPending = 30,
  _ecogovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ecogovStuckMs = 60 * 1000;
function _ecogovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ecogovCheckP(from, to) {
  const a = _ecogovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ecogov profile transition ${from} → ${to}`);
}
function _ecogovCheckJ(from, to) {
  const a = _ecogovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ecogov install transition ${from} → ${to}`);
}
function _ecogovCountActive(owner) {
  let c = 0;
  for (const p of _ecogovPsV2.values())
    if (p.owner === owner && p.status === ECOGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _ecogovCountPending(profileId) {
  let c = 0;
  for (const j of _ecogovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === ECOGOV_INSTALL_LIFECYCLE_V2.QUEUED ||
        j.status === ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLING)
    )
      c++;
  return c;
}
export function setMaxActiveEcogovProfilesPerOwnerV2(n) {
  _ecogovMaxActive = _ecogovPos(n, "maxActiveEcogovProfilesPerOwner");
}
export function getMaxActiveEcogovProfilesPerOwnerV2() {
  return _ecogovMaxActive;
}
export function setMaxPendingEcogovInstallsPerProfileV2(n) {
  _ecogovMaxPending = _ecogovPos(n, "maxPendingEcogovInstallsPerProfile");
}
export function getMaxPendingEcogovInstallsPerProfileV2() {
  return _ecogovMaxPending;
}
export function setEcogovProfileIdleMsV2(n) {
  _ecogovIdleMs = _ecogovPos(n, "ecogovProfileIdleMs");
}
export function getEcogovProfileIdleMsV2() {
  return _ecogovIdleMs;
}
export function setEcogovInstallStuckMsV2(n) {
  _ecogovStuckMs = _ecogovPos(n, "ecogovInstallStuckMs");
}
export function getEcogovInstallStuckMsV2() {
  return _ecogovStuckMs;
}
export function _resetStatePluginEcosystemGovV2() {
  _ecogovPsV2.clear();
  _ecogovJsV2.clear();
  _ecogovMaxActive = 12;
  _ecogovMaxPending = 30;
  _ecogovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ecogovStuckMs = 60 * 1000;
}
export function registerEcogovProfileV2({
  id,
  owner,
  category,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ecogovPsV2.has(id))
    throw new Error(`ecogov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    category: category || "general",
    status: ECOGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ecogovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateEcogovProfileV2(id) {
  const p = _ecogovPsV2.get(id);
  if (!p) throw new Error(`ecogov profile ${id} not found`);
  const isInitial = p.status === ECOGOV_PROFILE_MATURITY_V2.PENDING;
  _ecogovCheckP(p.status, ECOGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ecogovCountActive(p.owner) >= _ecogovMaxActive)
    throw new Error(`max active ecogov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = ECOGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function disableEcogovProfileV2(id) {
  const p = _ecogovPsV2.get(id);
  if (!p) throw new Error(`ecogov profile ${id} not found`);
  _ecogovCheckP(p.status, ECOGOV_PROFILE_MATURITY_V2.DISABLED);
  p.status = ECOGOV_PROFILE_MATURITY_V2.DISABLED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveEcogovProfileV2(id) {
  const p = _ecogovPsV2.get(id);
  if (!p) throw new Error(`ecogov profile ${id} not found`);
  _ecogovCheckP(p.status, ECOGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = ECOGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchEcogovProfileV2(id) {
  const p = _ecogovPsV2.get(id);
  if (!p) throw new Error(`ecogov profile ${id} not found`);
  if (_ecogovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ecogov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getEcogovProfileV2(id) {
  const p = _ecogovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listEcogovProfilesV2() {
  return [..._ecogovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createEcogovInstallV2({
  id,
  profileId,
  version,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ecogovJsV2.has(id))
    throw new Error(`ecogov install ${id} already exists`);
  if (!_ecogovPsV2.has(profileId))
    throw new Error(`ecogov profile ${profileId} not found`);
  if (_ecogovCountPending(profileId) >= _ecogovMaxPending)
    throw new Error(
      `max pending ecogov installs for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    version: version || "",
    status: ECOGOV_INSTALL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ecogovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function installingEcogovInstallV2(id) {
  const j = _ecogovJsV2.get(id);
  if (!j) throw new Error(`ecogov install ${id} not found`);
  _ecogovCheckJ(j.status, ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLING);
  const now = Date.now();
  j.status = ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeInstallEcogovV2(id) {
  const j = _ecogovJsV2.get(id);
  if (!j) throw new Error(`ecogov install ${id} not found`);
  _ecogovCheckJ(j.status, ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLED);
  const now = Date.now();
  j.status = ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failEcogovInstallV2(id, reason) {
  const j = _ecogovJsV2.get(id);
  if (!j) throw new Error(`ecogov install ${id} not found`);
  _ecogovCheckJ(j.status, ECOGOV_INSTALL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = ECOGOV_INSTALL_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelEcogovInstallV2(id, reason) {
  const j = _ecogovJsV2.get(id);
  if (!j) throw new Error(`ecogov install ${id} not found`);
  _ecogovCheckJ(j.status, ECOGOV_INSTALL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = ECOGOV_INSTALL_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getEcogovInstallV2(id) {
  const j = _ecogovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listEcogovInstallsV2() {
  return [..._ecogovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDisableIdleEcogovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ecogovPsV2.values())
    if (
      p.status === ECOGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ecogovIdleMs
    ) {
      p.status = ECOGOV_PROFILE_MATURITY_V2.DISABLED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEcogovInstallsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ecogovJsV2.values())
    if (
      j.status === ECOGOV_INSTALL_LIFECYCLE_V2.INSTALLING &&
      j.startedAt != null &&
      t - j.startedAt >= _ecogovStuckMs
    ) {
      j.status = ECOGOV_INSTALL_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getPluginEcosystemGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(ECOGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ecogovPsV2.values()) profilesByStatus[p.status]++;
  const installsByStatus = {};
  for (const v of Object.values(ECOGOV_INSTALL_LIFECYCLE_V2))
    installsByStatus[v] = 0;
  for (const j of _ecogovJsV2.values()) installsByStatus[j.status]++;
  return {
    totalEcogovProfilesV2: _ecogovPsV2.size,
    totalEcogovInstallsV2: _ecogovJsV2.size,
    maxActiveEcogovProfilesPerOwner: _ecogovMaxActive,
    maxPendingEcogovInstallsPerProfile: _ecogovMaxPending,
    ecogovProfileIdleMs: _ecogovIdleMs,
    ecogovInstallStuckMs: _ecogovStuckMs,
    profilesByStatus,
    installsByStatus,
  };
}
