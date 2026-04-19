/**
 * Code Generation Agent 2.0 — CLI port of Phase 86
 * (docs/design/modules/51_代码生成Agent2.0.md).
 *
 * Desktop uses LLM-powered full-stack code generation, AI code review,
 * scaffold generation, and CI/CD configuration.
 * CLI port ships:
 *
 *   - Code generation session tracking (prompt/language/framework)
 *   - Heuristic code review with security rule detection
 *   - Scaffold template catalog and record tracking
 *   - CI/CD platform catalog
 *
 * What does NOT port: real LLM code generation, AI-powered review,
 * full-stack generation pipeline, intelligent refactoring.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const SCAFFOLD_TEMPLATE = Object.freeze({
  REACT: "react",
  VUE: "vue",
  EXPRESS: "express",
  FASTAPI: "fastapi",
  SPRING_BOOT: "spring_boot",
});

export const REVIEW_SEVERITY = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
});

export const SECURITY_RULE = Object.freeze({
  EVAL_DETECTION: "eval_detection",
  SQL_INJECTION: "sql_injection",
  XSS: "xss",
  PATH_TRAVERSAL: "path_traversal",
  COMMAND_INJECTION: "command_injection",
});

export const CICD_PLATFORM = Object.freeze({
  GITHUB_ACTIONS: "github_actions",
  GITLAB_CI: "gitlab_ci",
  JENKINS: "jenkins",
});

/* ── State ──────────────────────────────────────────────── */

let _generations = new Map();
let _reviews = new Map();
let _scaffolds = new Map();

function _id() {
  return crypto.randomUUID();
}
function _now() {
  return Date.now();
}

function _strip(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k !== "_rowid_" && k !== "rowid") out[k] = v;
  }
  return out;
}

/* ── Schema ─────────────────────────────────────────────── */

export function ensureCodeAgentTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS code_generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    language TEXT,
    framework TEXT,
    generated_code TEXT,
    file_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    metadata TEXT,
    created_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS code_reviews (
    id TEXT PRIMARY KEY,
    generation_id TEXT,
    code_hash TEXT,
    language TEXT,
    issues_found INTEGER DEFAULT 0,
    security_issues INTEGER DEFAULT 0,
    severity_summary TEXT,
    issues_detail TEXT,
    reviewed_at INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS code_scaffolds (
    id TEXT PRIMARY KEY,
    template TEXT NOT NULL,
    project_name TEXT,
    options TEXT,
    files_generated INTEGER DEFAULT 0,
    output_path TEXT,
    created_at INTEGER
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _generations.clear();
  _reviews.clear();
  _scaffolds.clear();

  const tables = [
    ["code_generations", _generations],
    ["code_reviews", _reviews],
    ["code_scaffolds", _scaffolds],
  ];
  for (const [table, map] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r.id, r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Phase 86: Code Generation ──────────────────────────── */

export function createGeneration(
  db,
  {
    prompt,
    language,
    framework,
    generatedCode,
    fileCount,
    tokenCount,
    metadata,
  } = {},
) {
  if (!prompt) return { generationId: null, reason: "missing_prompt" };

  const id = _id();
  const now = _now();

  const entry = {
    id,
    prompt,
    language: language || null,
    framework: framework || null,
    generated_code: generatedCode || null,
    file_count: fileCount || 0,
    token_count: tokenCount || 0,
    metadata: metadata || null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO code_generations (id, prompt, language, framework, generated_code, file_count, token_count, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    prompt,
    entry.language,
    entry.framework,
    entry.generated_code,
    entry.file_count,
    entry.token_count,
    entry.metadata,
    now,
  );

  _generations.set(id, entry);
  return { generationId: id };
}

export function getGeneration(db, id) {
  const g = _generations.get(id);
  return g ? { ...g } : null;
}

export function listGenerations(db, { language, framework, limit = 50 } = {}) {
  let gens = [..._generations.values()];
  if (language) gens = gens.filter((g) => g.language === language);
  if (framework) gens = gens.filter((g) => g.framework === framework);
  return gens
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((g) => ({ ...g }));
}

/* ── Heuristic Code Review ──────────────────────────────── */

const SECURITY_PATTERNS = {
  eval_detection: [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bsetTimeout\s*\(\s*["'`]/,
    /\bsetInterval\s*\(\s*["'`]/,
  ],
  sql_injection: [
    /['"`]\s*\+\s*\w+.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)/i,
    /\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i,
    /(?:execute|query)\s*\(\s*["'`].*\+/i,
  ],
  xss: [
    /\.innerHTML\s*=/,
    /document\.write\s*\(/,
    /\.insertAdjacentHTML\s*\(/,
    /dangerouslySetInnerHTML/,
  ],
  path_traversal: [
    /\.\.\//,
    /\.\.\\/, // backslash variant
    /path\.join\s*\([^)]*\.\./,
  ],
  command_injection: [
    /child_process.*exec\s*\(\s*[`"'].*\$\{/,
    /exec\s*\(\s*.*\+\s*\w+/,
    /spawn\s*\(\s*["'`](?:sh|bash|cmd)/,
    /os\.system\s*\(/,
    /subprocess\.(?:call|run|Popen)\s*\(\s*[^[\]]*\+/,
  ],
};

const SEVERITY_FOR_RULE = {
  eval_detection: "high",
  sql_injection: "critical",
  xss: "high",
  path_traversal: "medium",
  command_injection: "critical",
};

function _detectIssues(code) {
  const issues = [];

  for (const [rule, patterns] of Object.entries(SECURITY_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = code.match(
        new RegExp(pattern.source, pattern.flags + "g"),
      );
      if (matches) {
        for (const match of matches) {
          issues.push({
            rule,
            severity: SEVERITY_FOR_RULE[rule],
            match: match.slice(0, 80),
            pattern: pattern.source,
          });
        }
      }
    }
  }

  return issues;
}

export function reviewCode(db, { generationId, code, language } = {}) {
  if (!code) return { reviewId: null, reason: "missing_code" };

  const issues = _detectIssues(code);
  const securityIssues = issues.length;
  const severitySummary = {};
  for (const sev of Object.values(REVIEW_SEVERITY)) {
    severitySummary[sev] = 0;
  }
  for (const issue of issues) {
    severitySummary[issue.severity] =
      (severitySummary[issue.severity] || 0) + 1;
  }

  const id = _id();
  const now = _now();
  const codeHash = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex")
    .slice(0, 16);

  const entry = {
    id,
    generation_id: generationId || null,
    code_hash: codeHash,
    language: language || null,
    issues_found: issues.length,
    security_issues: securityIssues,
    severity_summary: JSON.stringify(severitySummary),
    issues_detail: JSON.stringify(issues),
    reviewed_at: now,
  };

  db.prepare(
    `INSERT INTO code_reviews (id, generation_id, code_hash, language, issues_found, security_issues, severity_summary, issues_detail, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.generation_id,
    codeHash,
    entry.language,
    entry.issues_found,
    entry.security_issues,
    entry.severity_summary,
    entry.issues_detail,
    now,
  );

  _reviews.set(id, entry);
  return {
    reviewId: id,
    issuesFound: issues.length,
    securityIssues,
    severitySummary,
  };
}

export function getReview(db, id) {
  const r = _reviews.get(id);
  return r ? { ...r } : null;
}

export function listReviews(db, { language, limit = 50 } = {}) {
  let revs = [..._reviews.values()];
  if (language) revs = revs.filter((r) => r.language === language);
  return revs
    .sort((a, b) => b.reviewed_at - a.reviewed_at)
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

/* ── Scaffold ───────────────────────────────────────────── */

const VALID_TEMPLATES = new Set(Object.values(SCAFFOLD_TEMPLATE));

export function createScaffold(
  db,
  { template, projectName, options, filesGenerated, outputPath } = {},
) {
  if (!template || !VALID_TEMPLATES.has(template))
    return { scaffoldId: null, reason: "invalid_template" };
  if (!projectName) return { scaffoldId: null, reason: "missing_project_name" };

  const id = _id();
  const now = _now();

  const entry = {
    id,
    template,
    project_name: projectName,
    options: options || null,
    files_generated: filesGenerated || 0,
    output_path: outputPath || null,
    created_at: now,
  };

  db.prepare(
    `INSERT INTO code_scaffolds (id, template, project_name, options, files_generated, output_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    template,
    projectName,
    entry.options,
    entry.files_generated,
    entry.output_path,
    now,
  );

  _scaffolds.set(id, entry);
  return { scaffoldId: id };
}

export function getScaffold(db, id) {
  const s = _scaffolds.get(id);
  return s ? { ...s } : null;
}

export function listScaffolds(db, { template, limit = 50 } = {}) {
  let scf = [..._scaffolds.values()];
  if (template) scf = scf.filter((s) => s.template === template);
  return scf
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((s) => ({ ...s }));
}

/* ── Stats ──────────────────────────────────────────────── */

export function getCodeAgentStats(db) {
  const gens = [..._generations.values()];
  const revs = [..._reviews.values()];
  const scfs = [..._scaffolds.values()];

  const totalIssues = revs.reduce((s, r) => s + (r.issues_found || 0), 0);
  const languages = new Set(
    gens.filter((g) => g.language).map((g) => g.language),
  );

  return {
    generations: {
      total: gens.length,
      totalTokens: gens.reduce((s, g) => s + (g.token_count || 0), 0),
      totalFiles: gens.reduce((s, g) => s + (g.file_count || 0), 0),
      uniqueLanguages: languages.size,
    },
    reviews: {
      total: revs.length,
      totalIssues,
      totalSecurityIssues: revs.reduce(
        (s, r) => s + (r.security_issues || 0),
        0,
      ),
      avgIssuesPerReview:
        revs.length > 0
          ? Math.round((totalIssues / revs.length) * 100) / 100
          : 0,
    },
    scaffolds: {
      total: scfs.length,
      byTemplate: scfs.reduce((acc, s) => {
        acc[s.template] = (acc[s.template] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _generations.clear();
  _reviews.clear();
  _scaffolds.clear();
}

/* ═════════════════════════════════════════════════════════ *
 *  Phase 86 V2 — Code Agent Maturity + Generation Job
 * ═════════════════════════════════════════════════════════ */

export const AGENT_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  RETIRED: "retired",
});

export const GEN_JOB_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
});

const AGENT_TRANSITIONS_V2 = new Map([
  ["draft", new Set(["active", "retired"])],
  ["active", new Set(["deprecated", "retired"])],
  ["deprecated", new Set(["active", "retired"])],
]);
const AGENT_TERMINALS_V2 = new Set(["retired"]);

const JOB_TRANSITIONS_V2 = new Map([
  ["queued", new Set(["running", "canceled", "failed"])],
  ["running", new Set(["succeeded", "failed", "canceled"])],
]);
const JOB_TERMINALS_V2 = new Set(["succeeded", "failed", "canceled"]);

export const CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER = 15;
export const CGA_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER = 3;
export const CGA_DEFAULT_AGENT_IDLE_MS = 60 * 86400000; // 60 days
export const CGA_DEFAULT_JOB_STUCK_MS = 15 * 60000; // 15 minutes

let _maxActiveAgentsPerOwnerV2 = CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER;
let _maxRunningJobsPerOwnerV2 = CGA_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER;
let _agentIdleMsV2 = CGA_DEFAULT_AGENT_IDLE_MS;
let _jobStuckMsV2 = CGA_DEFAULT_JOB_STUCK_MS;

function _positiveIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getDefaultMaxActiveAgentsPerOwnerV2() {
  return CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER;
}
export function getMaxActiveAgentsPerOwnerV2() {
  return _maxActiveAgentsPerOwnerV2;
}
export function setMaxActiveAgentsPerOwnerV2(n) {
  return (_maxActiveAgentsPerOwnerV2 = _positiveIntV2(
    n,
    "maxActiveAgentsPerOwner",
  ));
}
export function getDefaultMaxRunningJobsPerOwnerV2() {
  return CGA_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER;
}
export function getMaxRunningJobsPerOwnerV2() {
  return _maxRunningJobsPerOwnerV2;
}
export function setMaxRunningJobsPerOwnerV2(n) {
  return (_maxRunningJobsPerOwnerV2 = _positiveIntV2(
    n,
    "maxRunningJobsPerOwner",
  ));
}
export function getDefaultAgentIdleMsV2() {
  return CGA_DEFAULT_AGENT_IDLE_MS;
}
export function getAgentIdleMsV2() {
  return _agentIdleMsV2;
}
export function setAgentIdleMsV2(ms) {
  return (_agentIdleMsV2 = _positiveIntV2(ms, "agentIdleMs"));
}
export function getDefaultJobStuckMsV2() {
  return CGA_DEFAULT_JOB_STUCK_MS;
}
export function getJobStuckMsV2() {
  return _jobStuckMsV2;
}
export function setJobStuckMsV2(ms) {
  return (_jobStuckMsV2 = _positiveIntV2(ms, "jobStuckMs"));
}

const _agentsV2 = new Map();
const _jobsV2 = new Map();

export function registerAgentV2(
  _db,
  { agentId, ownerId, name, initialStatus, metadata } = {},
) {
  if (!agentId) throw new Error("agentId is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (_agentsV2.has(agentId))
    throw new Error(`Agent ${agentId} already exists`);
  const status = initialStatus || AGENT_MATURITY_V2.DRAFT;
  if (!Object.values(AGENT_MATURITY_V2).includes(status))
    throw new Error(`Invalid initial status: ${status}`);
  if (AGENT_TERMINALS_V2.has(status))
    throw new Error(`Cannot register in terminal status: ${status}`);
  if (status === AGENT_MATURITY_V2.ACTIVE) {
    if (getActiveAgentCount(ownerId) >= _maxActiveAgentsPerOwnerV2)
      throw new Error(
        `Owner ${ownerId} reached active-agent cap (${_maxActiveAgentsPerOwnerV2})`,
      );
  }
  const now = Date.now();
  const record = {
    agentId,
    ownerId,
    name: name || agentId,
    status,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
    lastInvokedAt: now,
  };
  _agentsV2.set(agentId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getAgentV2(agentId) {
  const r = _agentsV2.get(agentId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setAgentMaturityV2(_db, agentId, newStatus, patch = {}) {
  const record = _agentsV2.get(agentId);
  if (!record) throw new Error(`Unknown agent: ${agentId}`);
  if (!Object.values(AGENT_MATURITY_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = AGENT_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === AGENT_MATURITY_V2.ACTIVE) {
    if (getActiveAgentCount(record.ownerId) >= _maxActiveAgentsPerOwnerV2)
      throw new Error(
        `Owner ${record.ownerId} reached active-agent cap (${_maxActiveAgentsPerOwnerV2})`,
      );
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function activateAgent(db, id, reason) {
  return setAgentMaturityV2(db, id, AGENT_MATURITY_V2.ACTIVE, { reason });
}
export function deprecateAgent(db, id, reason) {
  return setAgentMaturityV2(db, id, AGENT_MATURITY_V2.DEPRECATED, { reason });
}
export function retireAgent(db, id, reason) {
  return setAgentMaturityV2(db, id, AGENT_MATURITY_V2.RETIRED, { reason });
}

export function touchAgentInvocation(agentId) {
  const record = _agentsV2.get(agentId);
  if (!record) throw new Error(`Unknown agent: ${agentId}`);
  record.lastInvokedAt = Date.now();
  record.updatedAt = record.lastInvokedAt;
  return { ...record, metadata: { ...record.metadata } };
}

export function enqueueGenJobV2(
  _db,
  { jobId, ownerId, agentId, prompt, metadata } = {},
) {
  if (!jobId) throw new Error("jobId is required");
  if (!ownerId) throw new Error("ownerId is required");
  if (!agentId) throw new Error("agentId is required");
  if (!prompt) throw new Error("prompt is required");
  if (_jobsV2.has(jobId)) throw new Error(`Job ${jobId} already exists`);
  const now = Date.now();
  const record = {
    jobId,
    ownerId,
    agentId,
    prompt,
    status: GEN_JOB_V2.QUEUED,
    metadata: metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  _jobsV2.set(jobId, record);
  return { ...record, metadata: { ...record.metadata } };
}

export function getGenJobV2(jobId) {
  const r = _jobsV2.get(jobId);
  return r ? { ...r, metadata: { ...r.metadata } } : null;
}

export function setGenJobStatusV2(_db, jobId, newStatus, patch = {}) {
  const record = _jobsV2.get(jobId);
  if (!record) throw new Error(`Unknown job: ${jobId}`);
  if (!Object.values(GEN_JOB_V2).includes(newStatus))
    throw new Error(`Invalid status: ${newStatus}`);
  const allowed = JOB_TRANSITIONS_V2.get(record.status) || new Set();
  if (!allowed.has(newStatus))
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  if (newStatus === GEN_JOB_V2.RUNNING) {
    if (getRunningJobCount(record.ownerId) >= _maxRunningJobsPerOwnerV2)
      throw new Error(
        `Owner ${record.ownerId} reached running-job cap (${_maxRunningJobsPerOwnerV2})`,
      );
    if (!record.startedAt) record.startedAt = Date.now();
  }
  record.status = newStatus;
  record.updatedAt = Date.now();
  if (patch.reason !== undefined) record.lastReason = patch.reason;
  if (patch.metadata)
    record.metadata = { ...record.metadata, ...patch.metadata };
  return { ...record, metadata: { ...record.metadata } };
}

export function startGenJob(db, id, reason) {
  return setGenJobStatusV2(db, id, GEN_JOB_V2.RUNNING, { reason });
}
export function succeedGenJob(db, id, reason) {
  return setGenJobStatusV2(db, id, GEN_JOB_V2.SUCCEEDED, { reason });
}
export function failGenJob(db, id, reason) {
  return setGenJobStatusV2(db, id, GEN_JOB_V2.FAILED, { reason });
}
export function cancelGenJob(db, id, reason) {
  return setGenJobStatusV2(db, id, GEN_JOB_V2.CANCELED, { reason });
}

export function getActiveAgentCount(ownerId) {
  let n = 0;
  for (const r of _agentsV2.values()) {
    if (r.status !== AGENT_MATURITY_V2.ACTIVE) continue;
    if (ownerId && r.ownerId !== ownerId) continue;
    n++;
  }
  return n;
}

export function getRunningJobCount(ownerId) {
  let n = 0;
  for (const r of _jobsV2.values()) {
    if (r.status !== GEN_JOB_V2.RUNNING) continue;
    if (ownerId && r.ownerId !== ownerId) continue;
    n++;
  }
  return n;
}

export function autoRetireIdleAgents(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _agentsV2.values()) {
    if (
      r.status === AGENT_MATURITY_V2.ACTIVE ||
      r.status === AGENT_MATURITY_V2.DEPRECATED
    ) {
      if (now - r.lastInvokedAt > _agentIdleMsV2) {
        r.status = AGENT_MATURITY_V2.RETIRED;
        r.updatedAt = now;
        r.lastReason = "idle_timeout";
        flipped.push(r.agentId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckGenJobs(_db, nowMs) {
  const now = nowMs ?? Date.now();
  const flipped = [];
  for (const r of _jobsV2.values()) {
    if (r.status === GEN_JOB_V2.RUNNING) {
      const anchor = r.startedAt || r.createdAt;
      if (now - anchor > _jobStuckMsV2) {
        r.status = GEN_JOB_V2.FAILED;
        r.updatedAt = now;
        r.lastReason = "job_timeout";
        flipped.push(r.jobId);
      }
    }
  }
  return { flipped, count: flipped.length };
}

export function getCodeAgentStatsV2() {
  const agentsByStatus = {};
  for (const s of Object.values(AGENT_MATURITY_V2)) agentsByStatus[s] = 0;
  const jobsByStatus = {};
  for (const s of Object.values(GEN_JOB_V2)) jobsByStatus[s] = 0;
  for (const r of _agentsV2.values()) agentsByStatus[r.status]++;
  for (const r of _jobsV2.values()) jobsByStatus[r.status]++;
  return {
    totalAgentsV2: _agentsV2.size,
    totalJobsV2: _jobsV2.size,
    maxActiveAgentsPerOwner: _maxActiveAgentsPerOwnerV2,
    maxRunningJobsPerOwner: _maxRunningJobsPerOwnerV2,
    agentIdleMs: _agentIdleMsV2,
    jobStuckMs: _jobStuckMsV2,
    agentsByStatus,
    jobsByStatus,
  };
}

export function _resetStateV2() {
  _maxActiveAgentsPerOwnerV2 = CGA_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER;
  _maxRunningJobsPerOwnerV2 = CGA_DEFAULT_MAX_RUNNING_JOBS_PER_OWNER;
  _agentIdleMsV2 = CGA_DEFAULT_AGENT_IDLE_MS;
  _jobStuckMsV2 = CGA_DEFAULT_JOB_STUCK_MS;
  _agentsV2.clear();
  _jobsV2.clear();
}

// =====================================================================
// code-agent V2 governance overlay (iter19)
// =====================================================================
export const CDAGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const CDAGOV_EDIT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  EDITING: "editing",
  EDITED: "edited",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cdagovPTrans = new Map([
  [
    CDAGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CDAGOV_PROFILE_MATURITY_V2.ACTIVE,
      CDAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CDAGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CDAGOV_PROFILE_MATURITY_V2.STALE,
      CDAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CDAGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      CDAGOV_PROFILE_MATURITY_V2.ACTIVE,
      CDAGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CDAGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cdagovPTerminal = new Set([CDAGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _cdagovJTrans = new Map([
  [
    CDAGOV_EDIT_LIFECYCLE_V2.QUEUED,
    new Set([
      CDAGOV_EDIT_LIFECYCLE_V2.EDITING,
      CDAGOV_EDIT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CDAGOV_EDIT_LIFECYCLE_V2.EDITING,
    new Set([
      CDAGOV_EDIT_LIFECYCLE_V2.EDITED,
      CDAGOV_EDIT_LIFECYCLE_V2.FAILED,
      CDAGOV_EDIT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CDAGOV_EDIT_LIFECYCLE_V2.EDITED, new Set()],
  [CDAGOV_EDIT_LIFECYCLE_V2.FAILED, new Set()],
  [CDAGOV_EDIT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cdagovPsV2 = new Map();
const _cdagovJsV2 = new Map();
let _cdagovMaxActive = 6,
  _cdagovMaxPending = 15,
  _cdagovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cdagovStuckMs = 60 * 1000;
function _cdagovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cdagovCheckP(from, to) {
  const a = _cdagovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cdagov profile transition ${from} → ${to}`);
}
function _cdagovCheckJ(from, to) {
  const a = _cdagovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cdagov edit transition ${from} → ${to}`);
}
function _cdagovCountActive(owner) {
  let c = 0;
  for (const p of _cdagovPsV2.values())
    if (p.owner === owner && p.status === CDAGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _cdagovCountPending(profileId) {
  let c = 0;
  for (const j of _cdagovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CDAGOV_EDIT_LIFECYCLE_V2.QUEUED ||
        j.status === CDAGOV_EDIT_LIFECYCLE_V2.EDITING)
    )
      c++;
  return c;
}
export function setMaxActiveCdagovProfilesPerOwnerV2(n) {
  _cdagovMaxActive = _cdagovPos(n, "maxActiveCdagovProfilesPerOwner");
}
export function getMaxActiveCdagovProfilesPerOwnerV2() {
  return _cdagovMaxActive;
}
export function setMaxPendingCdagovEditsPerProfileV2(n) {
  _cdagovMaxPending = _cdagovPos(n, "maxPendingCdagovEditsPerProfile");
}
export function getMaxPendingCdagovEditsPerProfileV2() {
  return _cdagovMaxPending;
}
export function setCdagovProfileIdleMsV2(n) {
  _cdagovIdleMs = _cdagovPos(n, "cdagovProfileIdleMs");
}
export function getCdagovProfileIdleMsV2() {
  return _cdagovIdleMs;
}
export function setCdagovEditStuckMsV2(n) {
  _cdagovStuckMs = _cdagovPos(n, "cdagovEditStuckMs");
}
export function getCdagovEditStuckMsV2() {
  return _cdagovStuckMs;
}
export function _resetStateCodeAgentGovV2() {
  _cdagovPsV2.clear();
  _cdagovJsV2.clear();
  _cdagovMaxActive = 6;
  _cdagovMaxPending = 15;
  _cdagovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cdagovStuckMs = 60 * 1000;
}
export function registerCdagovProfileV2({
  id,
  owner,
  language,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cdagovPsV2.has(id))
    throw new Error(`cdagov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    language: language || "javascript",
    status: CDAGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cdagovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCdagovProfileV2(id) {
  const p = _cdagovPsV2.get(id);
  if (!p) throw new Error(`cdagov profile ${id} not found`);
  const isInitial = p.status === CDAGOV_PROFILE_MATURITY_V2.PENDING;
  _cdagovCheckP(p.status, CDAGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cdagovCountActive(p.owner) >= _cdagovMaxActive)
    throw new Error(`max active cdagov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CDAGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleCdagovProfileV2(id) {
  const p = _cdagovPsV2.get(id);
  if (!p) throw new Error(`cdagov profile ${id} not found`);
  _cdagovCheckP(p.status, CDAGOV_PROFILE_MATURITY_V2.STALE);
  p.status = CDAGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCdagovProfileV2(id) {
  const p = _cdagovPsV2.get(id);
  if (!p) throw new Error(`cdagov profile ${id} not found`);
  _cdagovCheckP(p.status, CDAGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CDAGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCdagovProfileV2(id) {
  const p = _cdagovPsV2.get(id);
  if (!p) throw new Error(`cdagov profile ${id} not found`);
  if (_cdagovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cdagov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCdagovProfileV2(id) {
  const p = _cdagovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCdagovProfilesV2() {
  return [..._cdagovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCdagovEditV2({ id, profileId, target, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cdagovJsV2.has(id)) throw new Error(`cdagov edit ${id} already exists`);
  if (!_cdagovPsV2.has(profileId))
    throw new Error(`cdagov profile ${profileId} not found`);
  if (_cdagovCountPending(profileId) >= _cdagovMaxPending)
    throw new Error(
      `max pending cdagov edits for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    target: target || "",
    status: CDAGOV_EDIT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cdagovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function editingCdagovEditV2(id) {
  const j = _cdagovJsV2.get(id);
  if (!j) throw new Error(`cdagov edit ${id} not found`);
  _cdagovCheckJ(j.status, CDAGOV_EDIT_LIFECYCLE_V2.EDITING);
  const now = Date.now();
  j.status = CDAGOV_EDIT_LIFECYCLE_V2.EDITING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeEditCdagovV2(id) {
  const j = _cdagovJsV2.get(id);
  if (!j) throw new Error(`cdagov edit ${id} not found`);
  _cdagovCheckJ(j.status, CDAGOV_EDIT_LIFECYCLE_V2.EDITED);
  const now = Date.now();
  j.status = CDAGOV_EDIT_LIFECYCLE_V2.EDITED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCdagovEditV2(id, reason) {
  const j = _cdagovJsV2.get(id);
  if (!j) throw new Error(`cdagov edit ${id} not found`);
  _cdagovCheckJ(j.status, CDAGOV_EDIT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CDAGOV_EDIT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCdagovEditV2(id, reason) {
  const j = _cdagovJsV2.get(id);
  if (!j) throw new Error(`cdagov edit ${id} not found`);
  _cdagovCheckJ(j.status, CDAGOV_EDIT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CDAGOV_EDIT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCdagovEditV2(id) {
  const j = _cdagovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCdagovEditsV2() {
  return [..._cdagovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleCdagovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cdagovPsV2.values())
    if (
      p.status === CDAGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cdagovIdleMs
    ) {
      p.status = CDAGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCdagovEditsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cdagovJsV2.values())
    if (
      j.status === CDAGOV_EDIT_LIFECYCLE_V2.EDITING &&
      j.startedAt != null &&
      t - j.startedAt >= _cdagovStuckMs
    ) {
      j.status = CDAGOV_EDIT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCodeAgentGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CDAGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cdagovPsV2.values()) profilesByStatus[p.status]++;
  const editsByStatus = {};
  for (const v of Object.values(CDAGOV_EDIT_LIFECYCLE_V2)) editsByStatus[v] = 0;
  for (const j of _cdagovJsV2.values()) editsByStatus[j.status]++;
  return {
    totalCdagovProfilesV2: _cdagovPsV2.size,
    totalCdagovEditsV2: _cdagovJsV2.size,
    maxActiveCdagovProfilesPerOwner: _cdagovMaxActive,
    maxPendingCdagovEditsPerProfile: _cdagovMaxPending,
    cdagovProfileIdleMs: _cdagovIdleMs,
    cdagovEditStuckMs: _cdagovStuckMs,
    profilesByStatus,
    editsByStatus,
  };
}
