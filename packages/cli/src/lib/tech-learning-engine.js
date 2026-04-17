/**
 * Tech Learning Engine — CLI port of Phase 62 tech-learning-engine
 * (docs/design/modules/34_技术学习引擎系统.md).
 *
 * The Desktop build runs auto-scans, extracts patterns from open-source
 * corpora and builds a knowledge graph. Those parts depend on long-running
 * crawlers and graph infrastructure the CLI doesn't have. The CLI port
 * ships the tractable pieces:
 *
 *   - analyzeTechStack(path)   — static parse of package.json /
 *                                requirements.txt / pyproject.toml /
 *                                Cargo.toml / go.mod with a built-in
 *                                classifier (framework/library/db/tool).
 *   - detectAntiPatterns(file) — heuristic file scan (god_object /
 *                                long_method / magic_numbers /
 *                                tight_coupling / spaghetti_code).
 *   - recordPractice / listPractices — hand-curated practice store.
 *   - getRecommendations(stack) — pairs analyzed stack with practices
 *                                 table to surface relevant items.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

/* ── Constants ─────────────────────────────────────────────── */

export const TECH_TYPES = Object.freeze({
  LANGUAGE: "language",
  FRAMEWORK: "framework",
  LIBRARY: "library",
  DATABASE: "database",
  TOOL: "tool",
  PATTERN: "pattern",
});

export const PRACTICE_LEVELS = Object.freeze({
  BEGINNER: "beginner",
  INTERMEDIATE: "intermediate",
  ADVANCED: "advanced",
  EXPERT: "expert",
});

export const ANTI_PATTERNS = Object.freeze({
  GOD_OBJECT: "god_object",
  LONG_METHOD: "long_method",
  MAGIC_NUMBERS: "magic_numbers",
  TIGHT_COUPLING: "tight_coupling",
  SPAGHETTI_CODE: "spaghetti_code",
  PREMATURE_OPTIMIZATION: "premature_optimization",
});

const VALID_TECH_TYPES = new Set(Object.values(TECH_TYPES));
const VALID_LEVELS = new Set(Object.values(PRACTICE_LEVELS));

/* ── Classifier catalog ────────────────────────────────────── */

// Lowercased lookup. Entries missing here default to LIBRARY.
const TECH_CLASSIFIER = Object.freeze({
  // Languages
  typescript: TECH_TYPES.LANGUAGE,
  javascript: TECH_TYPES.LANGUAGE,
  python: TECH_TYPES.LANGUAGE,
  rust: TECH_TYPES.LANGUAGE,
  go: TECH_TYPES.LANGUAGE,
  java: TECH_TYPES.LANGUAGE,
  kotlin: TECH_TYPES.LANGUAGE,

  // Frameworks (Node / Python / JVM / Rust / Go)
  react: TECH_TYPES.FRAMEWORK,
  vue: TECH_TYPES.FRAMEWORK,
  "@vue/core": TECH_TYPES.FRAMEWORK,
  angular: TECH_TYPES.FRAMEWORK,
  "@angular/core": TECH_TYPES.FRAMEWORK,
  svelte: TECH_TYPES.FRAMEWORK,
  next: TECH_TYPES.FRAMEWORK,
  nuxt: TECH_TYPES.FRAMEWORK,
  express: TECH_TYPES.FRAMEWORK,
  fastify: TECH_TYPES.FRAMEWORK,
  koa: TECH_TYPES.FRAMEWORK,
  "@nestjs/core": TECH_TYPES.FRAMEWORK,
  flask: TECH_TYPES.FRAMEWORK,
  django: TECH_TYPES.FRAMEWORK,
  fastapi: TECH_TYPES.FRAMEWORK,
  rocket: TECH_TYPES.FRAMEWORK,
  actix: TECH_TYPES.FRAMEWORK,
  gin: TECH_TYPES.FRAMEWORK,
  fiber: TECH_TYPES.FRAMEWORK,
  electron: TECH_TYPES.FRAMEWORK,
  "spring-boot": TECH_TYPES.FRAMEWORK,

  // Databases / stores
  "better-sqlite3": TECH_TYPES.DATABASE,
  sqlite3: TECH_TYPES.DATABASE,
  pg: TECH_TYPES.DATABASE,
  mysql: TECH_TYPES.DATABASE,
  mysql2: TECH_TYPES.DATABASE,
  mongodb: TECH_TYPES.DATABASE,
  mongoose: TECH_TYPES.DATABASE,
  redis: TECH_TYPES.DATABASE,
  ioredis: TECH_TYPES.DATABASE,
  psycopg2: TECH_TYPES.DATABASE,
  sqlalchemy: TECH_TYPES.DATABASE,
  diesel: TECH_TYPES.DATABASE,
  sqlx: TECH_TYPES.DATABASE,

  // Tools / bundlers / test runners
  webpack: TECH_TYPES.TOOL,
  vite: TECH_TYPES.TOOL,
  rollup: TECH_TYPES.TOOL,
  esbuild: TECH_TYPES.TOOL,
  typescript_tool: TECH_TYPES.TOOL,
  eslint: TECH_TYPES.TOOL,
  prettier: TECH_TYPES.TOOL,
  vitest: TECH_TYPES.TOOL,
  jest: TECH_TYPES.TOOL,
  mocha: TECH_TYPES.TOOL,
  pytest: TECH_TYPES.TOOL,
});

function _classify(name) {
  const key = String(name).toLowerCase();
  return TECH_CLASSIFIER[key] || TECH_TYPES.LIBRARY;
}

/* ── In-memory stores ─────────────────────────────────────── */

const _profiles = new Map(); // projectPath → profile
const _practices = new Map(); // practiceId → practice
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureTechLearningTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tech_stack_profiles (
      profile_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      tech_stack TEXT NOT NULL,
      dependencies TEXT,
      languages TEXT,
      frameworks TEXT,
      analysis_timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS learned_practices (
      practice_id TEXT PRIMARY KEY,
      tech_type TEXT NOT NULL,
      tech_name TEXT NOT NULL,
      pattern_name TEXT NOT NULL,
      level TEXT NOT NULL,
      description TEXT,
      code_example TEXT,
      usage_count INTEGER DEFAULT 0,
      score REAL DEFAULT 0.0,
      source TEXT,
      learned_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_learned_practices_tech_type ON learned_practices(tech_type)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_learned_practices_level ON learned_practices(level)`,
  );
}

/* ── Parsers for dependency manifests ──────────────────────── */

function _readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function _parsePackageJson(text) {
  if (!text) return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const deps = {
    ...(json.dependencies || {}),
    ...(json.devDependencies || {}),
    ...(json.peerDependencies || {}),
  };
  return {
    language: "javascript",
    deps: Object.keys(deps).map((name) => ({
      name,
      version: deps[name],
    })),
  };
}

function _parseRequirementsTxt(text) {
  if (!text) return null;
  const deps = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    // Strip environment markers + extras; grab "name" + optional version.
    const match = line.match(/^([A-Za-z0-9_.\-[\]]+)\s*([<>=!~].*)?$/);
    if (!match) continue;
    const name = match[1].replace(/\[.*\]/, "").toLowerCase();
    const version = match[2] ? match[2].trim() : null;
    deps.push({ name, version });
  }
  return { language: "python", deps };
}

function _parseCargoToml(text) {
  if (!text) return null;
  const deps = [];
  // Only mine the [dependencies] / [dev-dependencies] tables.
  const tables = text.split(/^\[/m);
  for (const chunk of tables) {
    if (!/^dependencies]|^dev-dependencies]/.test(chunk)) continue;
    const body = chunk.replace(/^[^\]]+\]\s*/, "");
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("[")) continue;
      const match = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*(.+)$/);
      if (!match) continue;
      const version = match[2].match(/"([^"]+)"/);
      deps.push({
        name: match[1].toLowerCase(),
        version: version ? version[1] : match[2].trim(),
      });
    }
  }
  return { language: "rust", deps };
}

function _parseGoMod(text) {
  if (!text) return null;
  const deps = [];
  const requireBlock = text.match(/require\s*\(([\s\S]*?)\)/);
  const lines = requireBlock
    ? requireBlock[1].split(/\r?\n/)
    : text.split(/\r?\n/).filter((l) => l.trim().startsWith("require "));
  for (const raw of lines) {
    const line = raw.replace(/^\s*require\s+/, "").trim();
    if (!line || line.startsWith("//")) continue;
    const match = line.match(/^(\S+)\s+(\S+)/);
    if (!match) continue;
    deps.push({ name: match[1].toLowerCase(), version: match[2] });
  }
  return { language: "go", deps };
}

export function analyzeTechStack(db, projectPath = process.cwd(), opts = {}) {
  const absPath = path.resolve(projectPath);
  const manifests = [
    ["package.json", _parsePackageJson],
    ["requirements.txt", _parseRequirementsTxt],
    ["Cargo.toml", _parseCargoToml],
    ["go.mod", _parseGoMod],
  ];
  const languages = new Set();
  const deps = [];
  for (const [file, parser] of manifests) {
    const text = _readIfExists(path.join(absPath, file));
    const parsed = parser(text);
    if (parsed) {
      languages.add(parsed.language);
      for (const d of parsed.deps) deps.push({ ...d, sourceFile: file });
    }
  }

  const classified = deps.map((d) => ({ ...d, type: _classify(d.name) }));
  const frameworks = classified
    .filter((d) => d.type === TECH_TYPES.FRAMEWORK)
    .map((d) => d.name);
  const databases = classified
    .filter((d) => d.type === TECH_TYPES.DATABASE)
    .map((d) => d.name);
  const tools = classified
    .filter((d) => d.type === TECH_TYPES.TOOL)
    .map((d) => d.name);
  const libraries = classified
    .filter((d) => d.type === TECH_TYPES.LIBRARY)
    .map((d) => d.name);

  const now = Number(opts.now ?? Date.now());
  const profileId = crypto.randomUUID();
  const profile = {
    profileId,
    projectPath: absPath,
    languages: [...languages],
    frameworks,
    databases,
    tools,
    libraries,
    totalDependencies: deps.length,
    analysisTimestamp: now,
    createdAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };

  _profiles.set(absPath, profile);

  if (db) {
    db.prepare(
      `INSERT INTO tech_stack_profiles (profile_id, project_path, tech_stack, dependencies, languages, frameworks, analysis_timestamp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      profileId,
      absPath,
      JSON.stringify(classified),
      JSON.stringify(deps),
      JSON.stringify(profile.languages),
      JSON.stringify(frameworks),
      now,
      now,
      now,
    );
  }

  const { _seq: _omit, ...rest } = profile;
  void _omit;
  return rest;
}

export function getProfile(projectPath) {
  const absPath = path.resolve(projectPath);
  const profile = _profiles.get(absPath);
  if (!profile) return null;
  const { _seq: _omit, ...rest } = profile;
  void _omit;
  return rest;
}

/* ── Anti-pattern detection (heuristics) ─────────────────── */

function _maxIndentDepth(source) {
  let max = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^[\t ]+/);
    if (!match) continue;
    const leading = match[0];
    const tabs = leading.match(/\t/g)?.length || 0;
    const spaces = leading.length - tabs;
    const depth = tabs + Math.floor(spaces / 2);
    if (depth > max) max = depth;
  }
  return max;
}

function _countFunctions(source) {
  const matches = source.match(
    /\b(?:function|def|fn|async\s+function|public\s+\w+\s+\w+\s*\(|private\s+\w+\s+\w+\s*\()\b/g,
  );
  return matches ? matches.length : 0;
}

function _countImports(source) {
  const es =
    source.match(/^\s*import\s+[^;]*from\s+['"][^'"]+['"];?/gm)?.length || 0;
  const req =
    source.match(/\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g)?.length || 0;
  const py = source.match(/^\s*(?:from\s+\S+\s+)?import\s+/gm)?.length || 0;
  return es + req + py;
}

function _findLongMethods(source, threshold = 80) {
  const lines = source.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\b(function|=>\s*\{|def\s+\w+|fn\s+\w+)/.test(line)) continue;
    const openIdx = line.indexOf("{");
    let startLine = i;
    if (openIdx === -1) {
      // Python: indent-based. Measure until dedent.
      if (/^\s*def\s+/.test(line)) {
        const indent = (line.match(/^(\s*)/) || ["", ""])[1].length;
        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
          const body = lines[j];
          if (!body.trim()) continue;
          const leading = (body.match(/^(\s*)/) || ["", ""])[1].length;
          if (leading <= indent) break;
          end = j;
        }
        const bodyLen = end - startLine;
        if (bodyLen > threshold) {
          findings.push({ startLine: startLine + 1, length: bodyLen });
        }
        i = end;
      }
      continue;
    }
    // Brace-based: count matching braces.
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length; j++) {
      const body = lines[j];
      for (const ch of body) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (depth === 0 && j > i) {
        end = j;
        break;
      }
      end = j;
    }
    const bodyLen = end - startLine;
    if (bodyLen > threshold) {
      findings.push({ startLine: startLine + 1, length: bodyLen });
    }
    i = end;
  }
  return findings;
}

function _countMagicNumbers(source) {
  // Exclude 0, 1, -1, 2, 10, 100 (common benign numbers).
  const benign = new Set(["0", "1", "-1", "2", "10", "100"]);
  // Strip strings and comments to avoid false positives.
  const cleaned = source
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const numbers = cleaned.match(/(?<![A-Za-z_])-?\d+(?:\.\d+)?\b/g) || [];
  let count = 0;
  for (const n of numbers) {
    if (!benign.has(n)) count++;
  }
  return count;
}

export function detectAntiPatterns(filePath, opts = {}) {
  const source = opts.source ?? _readIfExists(filePath);
  if (source == null) throw new Error(`File not found: ${filePath}`);
  const lines = source.split(/\r?\n/).length;
  const findings = [];

  const functionCount = _countFunctions(source);
  if (lines > 500 || functionCount > 20) {
    findings.push({
      type: ANTI_PATTERNS.GOD_OBJECT,
      severity: lines > 800 || functionCount > 40 ? "high" : "medium",
      detail: `file has ${lines} lines and ${functionCount} function declarations`,
    });
  }

  const longMethods = _findLongMethods(source, opts.longMethodThreshold || 80);
  for (const m of longMethods) {
    findings.push({
      type: ANTI_PATTERNS.LONG_METHOD,
      severity: m.length > 160 ? "high" : "medium",
      detail: `function at line ${m.startLine} spans ${m.length} lines`,
      startLine: m.startLine,
    });
  }

  const importCount = _countImports(source);
  if (importCount > (opts.tightCouplingThreshold || 20)) {
    findings.push({
      type: ANTI_PATTERNS.TIGHT_COUPLING,
      severity: importCount > 40 ? "high" : "medium",
      detail: `${importCount} imports in single file`,
    });
  }

  const magicCount = _countMagicNumbers(source);
  if (magicCount > (opts.magicNumberThreshold || 10)) {
    findings.push({
      type: ANTI_PATTERNS.MAGIC_NUMBERS,
      severity: magicCount > 25 ? "high" : "medium",
      detail: `${magicCount} magic numbers detected`,
    });
  }

  const indentDepth = _maxIndentDepth(source);
  if (indentDepth > (opts.spaghettiDepthThreshold || 6)) {
    findings.push({
      type: ANTI_PATTERNS.SPAGHETTI_CODE,
      severity: indentDepth > 9 ? "high" : "medium",
      detail: `max nesting depth ${indentDepth}`,
    });
  }

  return {
    filePath,
    lines,
    functionCount,
    importCount,
    magicNumberCount: magicCount,
    maxIndentDepth: indentDepth,
    totalFindings: findings.length,
    findings,
  };
}

/* ── Practice store ─────────────────────────────────────────── */

export function recordPractice(db, config = {}) {
  const techType = String(config.techType || "").toLowerCase();
  if (!VALID_TECH_TYPES.has(techType)) {
    throw new Error(
      `Unknown tech type: ${config.techType} (known: ${[...VALID_TECH_TYPES].join("/")})`,
    );
  }
  const level = String(config.level || "").toLowerCase();
  if (!VALID_LEVELS.has(level)) {
    throw new Error(
      `Unknown level: ${config.level} (known: ${[...VALID_LEVELS].join("/")})`,
    );
  }
  const techName = String(config.techName || "").trim();
  const patternName = String(config.patternName || "").trim();
  if (!techName) throw new Error("techName is required");
  if (!patternName) throw new Error("patternName is required");

  const now = Date.now();
  const practiceId = crypto.randomUUID();
  const practice = {
    practiceId,
    techType,
    techName,
    patternName,
    level,
    description: config.description || "",
    codeExample: config.codeExample || "",
    usageCount: 0,
    score: Number(config.score ?? 0),
    source: config.source || "manual",
    learnedAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _practices.set(practiceId, practice);

  if (db) {
    db.prepare(
      `INSERT INTO learned_practices (practice_id, tech_type, tech_name, pattern_name, level, description, code_example, usage_count, score, source, learned_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      practiceId,
      techType,
      techName,
      patternName,
      level,
      practice.description,
      practice.codeExample,
      0,
      practice.score,
      practice.source,
      now,
      now,
    );
  }

  const { _seq: _omit, ...rest } = practice;
  void _omit;
  return rest;
}

export function listPractices(opts = {}) {
  let rows = [..._practices.values()];
  if (opts.techType) {
    const t = String(opts.techType).toLowerCase();
    rows = rows.filter((p) => p.techType === t);
  }
  if (opts.techName) {
    const n = String(opts.techName).toLowerCase();
    rows = rows.filter((p) => p.techName.toLowerCase() === n);
  }
  if (opts.level) {
    const l = String(opts.level).toLowerCase();
    rows = rows.filter((p) => p.level === l);
  }
  rows.sort((a, b) => b.learnedAt - a.learnedAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map((p) => {
    const { _seq: _omit, ...rest } = p;
    void _omit;
    return rest;
  });
}

export function getRecommendations(opts = {}) {
  // stackNames comes either explicitly or inferred from the most recent
  // profile.
  let stackNames = opts.stackNames;
  if (!stackNames) {
    const latest = [..._profiles.values()].sort(
      (a, b) => b.analysisTimestamp - a.analysisTimestamp,
    )[0];
    if (!latest) {
      return {
        stackNames: [],
        recommendations: [],
        message:
          "No analyzed stack; call analyzeTechStack() or pass stackNames.",
      };
    }
    stackNames = [
      ...latest.languages,
      ...latest.frameworks,
      ...latest.databases,
      ...latest.tools,
    ];
  }
  const normalized = stackNames.map((n) => String(n).toLowerCase());
  const matches = [];
  for (const p of _practices.values()) {
    if (normalized.includes(p.techName.toLowerCase())) {
      const { _seq: _omit, ...rest } = p;
      void _omit;
      matches.push(rest);
    }
  }
  matches.sort((a, b) => {
    const levelRank = {
      beginner: 0,
      intermediate: 1,
      advanced: 2,
      expert: 3,
    };
    return levelRank[b.level] - levelRank[a.level] || b.score - a.score;
  });
  return {
    stackNames: normalized,
    totalPractices: _practices.size,
    totalMatches: matches.length,
    recommendations: matches.slice(0, opts.limit || 20),
  };
}

/* ── State reset (tests) ───────────────────────────────────── */

export function _resetState() {
  _profiles.clear();
  _practices.clear();
  _seq = 0;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Tech Learning Engine V2 (additive)
 * State machines + caps + auto-flip for tech profiles / learning runs
 * ═══════════════════════════════════════════════════════════════ */

export const PROFILE_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});

export const LEARNING_RUN_V2 = Object.freeze({
  QUEUED: "queued",
  STUDYING: "studying",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
  FAILED: "failed",
});

const _PROFILE_TRANS_V2 = new Map([
  [
    PROFILE_MATURITY_V2.DRAFT,
    new Set([PROFILE_MATURITY_V2.ACTIVE, PROFILE_MATURITY_V2.ARCHIVED]),
  ],
  [
    PROFILE_MATURITY_V2.ACTIVE,
    new Set([PROFILE_MATURITY_V2.STALE, PROFILE_MATURITY_V2.ARCHIVED]),
  ],
  [
    PROFILE_MATURITY_V2.STALE,
    new Set([PROFILE_MATURITY_V2.ACTIVE, PROFILE_MATURITY_V2.ARCHIVED]),
  ],
  [PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);

const _RUN_TRANS_V2 = new Map([
  [
    LEARNING_RUN_V2.QUEUED,
    new Set([
      LEARNING_RUN_V2.STUDYING,
      LEARNING_RUN_V2.ABANDONED,
      LEARNING_RUN_V2.FAILED,
    ]),
  ],
  [
    LEARNING_RUN_V2.STUDYING,
    new Set([
      LEARNING_RUN_V2.COMPLETED,
      LEARNING_RUN_V2.FAILED,
      LEARNING_RUN_V2.ABANDONED,
    ]),
  ],
  [LEARNING_RUN_V2.COMPLETED, new Set()],
  [LEARNING_RUN_V2.ABANDONED, new Set()],
  [LEARNING_RUN_V2.FAILED, new Set()],
]);

const _PROFILE_TERMINAL_V2 = new Set([PROFILE_MATURITY_V2.ARCHIVED]);
const _RUN_TERMINAL_V2 = new Set([
  LEARNING_RUN_V2.COMPLETED,
  LEARNING_RUN_V2.ABANDONED,
  LEARNING_RUN_V2.FAILED,
]);

export const TLE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER = 10;
export const TLE_DEFAULT_MAX_STUDYING_RUNS_PER_LEARNER = 5;
export const TLE_DEFAULT_PROFILE_STALE_MS = 60 * 24 * 60 * 60 * 1000;
export const TLE_DEFAULT_RUN_STUCK_MS = 7 * 24 * 60 * 60 * 1000;

let _tleMaxActiveProfiles = TLE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER;
let _tleMaxStudyingRuns = TLE_DEFAULT_MAX_STUDYING_RUNS_PER_LEARNER;
let _tleProfileStaleMs = TLE_DEFAULT_PROFILE_STALE_MS;
let _tleRunStuckMs = TLE_DEFAULT_RUN_STUCK_MS;

const _profilesV2 = new Map();
const _runsV2 = new Map();

function _posIntV2(n, label) {
  const v = Number.isInteger(n) ? n : Math.floor(n);
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveProfilesPerOwnerV2() {
  return _tleMaxActiveProfiles;
}
export function setMaxActiveProfilesPerOwnerV2(n) {
  _tleMaxActiveProfiles = _posIntV2(n, "maxActiveProfilesPerOwner");
  return _tleMaxActiveProfiles;
}
export function getMaxStudyingRunsPerLearnerV2() {
  return _tleMaxStudyingRuns;
}
export function setMaxStudyingRunsPerLearnerV2(n) {
  _tleMaxStudyingRuns = _posIntV2(n, "maxStudyingRunsPerLearner");
  return _tleMaxStudyingRuns;
}
export function getProfileStaleMsV2() {
  return _tleProfileStaleMs;
}
export function setProfileStaleMsV2(n) {
  _tleProfileStaleMs = _posIntV2(n, "profileStaleMs");
  return _tleProfileStaleMs;
}
export function getRunStuckMsV2() {
  return _tleRunStuckMs;
}
export function setRunStuckMsV2(n) {
  _tleRunStuckMs = _posIntV2(n, "runStuckMs");
  return _tleRunStuckMs;
}

export function getActiveProfileCountV2(owner) {
  if (!owner) throw new Error("owner is required");
  let c = 0;
  for (const p of _profilesV2.values()) {
    if (p.owner !== owner) continue;
    if (p.status === PROFILE_MATURITY_V2.ARCHIVED) continue;
    if (p.status === PROFILE_MATURITY_V2.DRAFT) continue;
    c++;
  }
  return c;
}

export function getStudyingRunCountV2(learner) {
  if (!learner) throw new Error("learner is required");
  let c = 0;
  for (const r of _runsV2.values()) {
    if (r.learner !== learner) continue;
    if (r.status !== LEARNING_RUN_V2.STUDYING) continue;
    c++;
  }
  return c;
}

export function createProfileV2({ id, owner, stackName, metadata }) {
  if (!id) throw new Error("id is required");
  if (!owner) throw new Error("owner is required");
  if (!stackName) throw new Error("stackName is required");
  if (_profilesV2.has(id)) throw new Error(`profile ${id} already exists`);
  const now = Date.now();
  const profile = {
    id,
    owner,
    stackName: String(stackName),
    status: PROFILE_MATURITY_V2.DRAFT,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    lastTouchedAt: now,
    metadata: metadata ? { ...metadata } : {},
  };
  _profilesV2.set(id, profile);
  return { ...profile, metadata: { ...profile.metadata } };
}

export function getProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}

export function listProfilesV2({ owner, status } = {}) {
  const out = [];
  for (const p of _profilesV2.values()) {
    if (owner && p.owner !== owner) continue;
    if (status && p.status !== status) continue;
    out.push({ ...p, metadata: { ...p.metadata } });
  }
  return out;
}

export function setProfileMaturityV2(
  id,
  nextStatus,
  { reason, metadata } = {},
) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  if (!_PROFILE_TRANS_V2.has(p.status))
    throw new Error(`unknown status ${p.status}`);
  const allowed = _PROFILE_TRANS_V2.get(p.status);
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `cannot transition profile ${id} from ${p.status} to ${nextStatus}`,
    );
  }
  if (nextStatus === PROFILE_MATURITY_V2.ACTIVE && p.owner) {
    const count = getActiveProfileCountV2(p.owner);
    const wasActive =
      p.status === PROFILE_MATURITY_V2.ACTIVE ||
      p.status === PROFILE_MATURITY_V2.STALE;
    if (!wasActive && count >= _tleMaxActiveProfiles) {
      throw new Error(
        `owner ${p.owner} exceeds max active profile cap ${_tleMaxActiveProfiles}`,
      );
    }
  }
  const now = Date.now();
  p.status = nextStatus;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (nextStatus === PROFILE_MATURITY_V2.ACTIVE && !p.activatedAt)
    p.activatedAt = now;
  if (reason) p.reason = reason;
  if (metadata) p.metadata = { ...p.metadata, ...metadata };
  return { ...p, metadata: { ...p.metadata } };
}

export function activateProfileV2(id, opts) {
  return setProfileMaturityV2(id, PROFILE_MATURITY_V2.ACTIVE, opts);
}
export function markProfileStaleV2(id, opts) {
  return setProfileMaturityV2(id, PROFILE_MATURITY_V2.STALE, opts);
}
export function archiveProfileV2(id, opts) {
  return setProfileMaturityV2(id, PROFILE_MATURITY_V2.ARCHIVED, opts);
}

export function touchProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  if (_PROFILE_TERMINAL_V2.has(p.status))
    throw new Error(`profile ${id} is terminal`);
  p.lastTouchedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}

export function enqueueRunV2({ id, learner, topic, metadata }) {
  if (!id) throw new Error("id is required");
  if (!learner) throw new Error("learner is required");
  if (!topic) throw new Error("topic is required");
  if (_runsV2.has(id)) throw new Error(`run ${id} already exists`);
  const now = Date.now();
  const run = {
    id,
    learner,
    topic: String(topic),
    status: LEARNING_RUN_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _runsV2.set(id, run);
  return { ...run, metadata: { ...run.metadata } };
}

export function getRunV2(id) {
  const r = _runsV2.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}

export function listRunsV2({ learner, status } = {}) {
  const out = [];
  for (const r of _runsV2.values()) {
    if (learner && r.learner !== learner) continue;
    if (status && r.status !== status) continue;
    out.push({ ...r, metadata: { ...r.metadata } });
  }
  return out;
}

export function setRunStatusV2(id, nextStatus, { reason, metadata } = {}) {
  const r = _runsV2.get(id);
  if (!r) throw new Error(`run ${id} not found`);
  if (!_RUN_TRANS_V2.has(r.status))
    throw new Error(`unknown status ${r.status}`);
  const allowed = _RUN_TRANS_V2.get(r.status);
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `cannot transition run ${id} from ${r.status} to ${nextStatus}`,
    );
  }
  if (nextStatus === LEARNING_RUN_V2.STUDYING) {
    const count = getStudyingRunCountV2(r.learner);
    if (count >= _tleMaxStudyingRuns) {
      throw new Error(
        `learner ${r.learner} exceeds max studying run cap ${_tleMaxStudyingRuns}`,
      );
    }
  }
  const now = Date.now();
  r.status = nextStatus;
  r.updatedAt = now;
  if (nextStatus === LEARNING_RUN_V2.STUDYING && !r.startedAt)
    r.startedAt = now;
  if (_RUN_TERMINAL_V2.has(nextStatus)) r.endedAt = now;
  if (reason) r.reason = reason;
  if (metadata) r.metadata = { ...r.metadata, ...metadata };
  return { ...r, metadata: { ...r.metadata } };
}

export function startRunV2(id, opts) {
  return setRunStatusV2(id, LEARNING_RUN_V2.STUDYING, opts);
}
export function completeRunV2(id, opts) {
  return setRunStatusV2(id, LEARNING_RUN_V2.COMPLETED, opts);
}
export function abandonRunV2(id, opts) {
  return setRunStatusV2(id, LEARNING_RUN_V2.ABANDONED, opts);
}
export function failRunV2(id, opts) {
  return setRunStatusV2(id, LEARNING_RUN_V2.FAILED, opts);
}

export function autoMarkStaleProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const out = [];
  for (const p of _profilesV2.values()) {
    if (p.status !== PROFILE_MATURITY_V2.ACTIVE) continue;
    if (t - p.lastTouchedAt > _tleProfileStaleMs) {
      p.status = PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      out.push(p.id);
    }
  }
  return out;
}

export function autoFailStuckRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const out = [];
  for (const r of _runsV2.values()) {
    if (r.status !== LEARNING_RUN_V2.STUDYING) continue;
    if (r.startedAt == null) continue;
    if (t - r.startedAt > _tleRunStuckMs) {
      r.status = LEARNING_RUN_V2.FAILED;
      r.endedAt = t;
      r.updatedAt = t;
      r.reason = r.reason || "auto-fail: stuck studying";
      out.push(r.id);
    }
  }
  return out;
}

export function getTechLearningStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(PROFILE_MATURITY_V2)) profilesByStatus[v] = 0;
  for (const p of _profilesV2.values()) profilesByStatus[p.status]++;
  const runsByStatus = {};
  for (const v of Object.values(LEARNING_RUN_V2)) runsByStatus[v] = 0;
  for (const r of _runsV2.values()) runsByStatus[r.status]++;
  return {
    totalProfilesV2: _profilesV2.size,
    totalRunsV2: _runsV2.size,
    maxActiveProfilesPerOwner: _tleMaxActiveProfiles,
    maxStudyingRunsPerLearner: _tleMaxStudyingRuns,
    profileStaleMs: _tleProfileStaleMs,
    runStuckMs: _tleRunStuckMs,
    profilesByStatus,
    runsByStatus,
  };
}

export function _resetStateV2() {
  _profilesV2.clear();
  _runsV2.clear();
  _tleMaxActiveProfiles = TLE_DEFAULT_MAX_ACTIVE_PROFILES_PER_OWNER;
  _tleMaxStudyingRuns = TLE_DEFAULT_MAX_STUDYING_RUNS_PER_LEARNER;
  _tleProfileStaleMs = TLE_DEFAULT_PROFILE_STALE_MS;
  _tleRunStuckMs = TLE_DEFAULT_RUN_STUCK_MS;
}
