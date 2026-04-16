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
