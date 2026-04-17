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
