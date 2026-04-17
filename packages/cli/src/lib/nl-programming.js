/**
 * Natural Language Programming — CLI port of Phase 28
 * (docs/design/modules/28_自然语言编程.md).
 *
 * Desktop uses SpecTranslator (9-step pipeline with LLM enhancement),
 * RequirementParser (intent classification + entity extraction),
 * and ProjectStyleAnalyzer (6-category code style learning).
 * CLI port ships:
 *
 *   - Translation recording with intent classification and spec
 *   - Heuristic intent classification (keyword-based)
 *   - Heuristic entity extraction (noun phrases)
 *   - Convention/style recording and retrieval
 *   - Completeness scoring and ambiguity tracking
 *
 * What does NOT port: LLM-driven translation, real AST analysis,
 * KG context integration, instinct memory patterns, live project
 * style analysis, spec refinement with feedback loops.
 */

import crypto from "crypto";

/* ── Constants ──────────────────────────────────────────── */

export const INTENT = Object.freeze({
  CREATE_COMPONENT: "create_component",
  ADD_FEATURE: "add_feature",
  FIX_BUG: "fix_bug",
  REFACTOR: "refactor",
  ADD_API: "add_api",
  ADD_TEST: "add_test",
  UPDATE_STYLE: "update_style",
  CONFIGURE: "configure",
  GENERAL: "general",
});

export const TRANSLATION_STATUS = Object.freeze({
  DRAFT: "draft",
  COMPLETE: "complete",
  REFINED: "refined",
});

export const STYLE_CATEGORY = Object.freeze({
  NAMING: "naming",
  ARCHITECTURE: "architecture",
  TESTING: "testing",
  STYLE: "style",
  IMPORTS: "imports",
  COMPONENTS: "components",
});

/* ── State ──────────────────────────────────────────────── */

let _translations = new Map();
let _conventions = new Map();

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

export function ensureNlProgrammingTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS nl_programs (
    id TEXT PRIMARY KEY,
    input_text TEXT NOT NULL,
    intent TEXT,
    entities TEXT,
    tech_stack TEXT,
    spec TEXT,
    completeness_score REAL DEFAULT 0.0,
    ambiguities TEXT,
    status TEXT DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS nl_program_conventions (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    pattern TEXT NOT NULL,
    examples TEXT,
    confidence REAL DEFAULT 0.5,
    source_files TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  _loadAll(db);
}

function _loadAll(db) {
  _translations.clear();
  _conventions.clear();

  const tables = [
    ["nl_programs", _translations, "id"],
    ["nl_program_conventions", _conventions, "id"],
  ];
  for (const [table, map, key] of tables) {
    try {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        const r = _strip(row);
        map.set(r[key], r);
      }
    } catch (_e) {
      /* table may not exist */
    }
  }
}

/* ── Intent Classification (heuristic) ──────────────────── */

const INTENT_KEYWORDS = {
  create_component: [
    "create",
    "new",
    "build",
    "make",
    "scaffold",
    "generate",
    "创建",
    "新建",
    "生成",
  ],
  add_feature: [
    "add",
    "implement",
    "include",
    "extend",
    "添加",
    "实现",
    "增加",
    "给",
  ],
  fix_bug: [
    "fix",
    "repair",
    "resolve",
    "debug",
    "patch",
    "修复",
    "修改",
    "解决",
    "bug",
  ],
  refactor: [
    "refactor",
    "restructure",
    "reorganize",
    "clean",
    "重构",
    "整理",
    "优化",
  ],
  add_api: ["api", "endpoint", "route", "接口", "端点"],
  add_test: ["test", "spec", "测试", "单元测试"],
  update_style: [
    "style",
    "css",
    "theme",
    "color",
    "样式",
    "主题",
    "颜色",
    "UI",
  ],
  configure: ["config", "setting", "setup", "配置", "设置", "安装"],
};

export function classifyIntent(text) {
  if (!text) return { intent: "general", confidence: 0 };

  const lower = text.toLowerCase();
  let bestIntent = "general";
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const confidence = bestScore > 0 ? Math.min(1, bestScore * 0.3) : 0;
  return {
    intent: bestIntent,
    confidence: Math.round(confidence * 1000) / 1000,
  };
}

/* ── Entity Extraction (heuristic) ──────────────────────── */

export function extractEntities(text) {
  if (!text) return { entities: [], count: 0 };

  // Simple heuristic: extract quoted strings and capitalized phrases
  const entities = [];

  // Quoted strings
  const quotedMatches = text.match(/["'`]([^"'`]+)["'`]/g);
  if (quotedMatches) {
    for (const m of quotedMatches) {
      entities.push({ type: "quoted", value: m.slice(1, -1) });
    }
  }

  // Chinese noun phrases (after keywords like 给/的/个)
  const cnMatches = text.match(/(?:给|的|个|一个)([^\s,，。、]+)/g);
  if (cnMatches) {
    for (const m of cnMatches) {
      const value = m.replace(/^(?:给|的|个|一个)/, "").trim();
      if (value.length > 1) entities.push({ type: "noun_phrase", value });
    }
  }

  // Technical terms (PascalCase, kebab-case patterns)
  const techMatches = text.match(/\b[A-Z][a-zA-Z]+(?:[A-Z][a-z]+)+\b/g);
  if (techMatches) {
    for (const m of techMatches) {
      entities.push({ type: "technical", value: m });
    }
  }

  // Deduplicate
  const seen = new Set();
  const unique = entities.filter((e) => {
    const key = `${e.type}:${e.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { entities: unique, count: unique.length };
}

/* ── Tech Stack Detection (heuristic) ───────────────────── */

const TECH_PATTERNS = {
  vue: ["vue", "Vue", "组件", "component", "composable"],
  react: ["react", "React", "jsx", "tsx", "hook"],
  typescript: ["typescript", "TypeScript", "ts", "类型"],
  javascript: ["javascript", "js", "JavaScript"],
  python: ["python", "Python", "pip", "django", "flask", "fastapi"],
  java: ["java", "Java", "spring", "Spring"],
  go: ["golang", "go", "Go"],
  rust: ["rust", "Rust", "cargo"],
};

export function detectTechStack(text) {
  if (!text) return { detected: [], primary: null };

  const lower = text.toLowerCase();
  const detected = [];

  for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
    for (const p of patterns) {
      if (lower.includes(p.toLowerCase())) {
        detected.push(tech);
        break;
      }
    }
  }

  return { detected: [...new Set(detected)], primary: detected[0] || null };
}

/* ── Completeness Scoring ───────────────────────────────── */

export function scoreCompleteness(spec) {
  if (!spec) return { score: 0, missing: ["spec"] };

  let score = 0;
  const missing = [];
  const total = 6;

  if (spec.intent && spec.intent !== "general") score += 1;
  else missing.push("intent");

  if (spec.entities && spec.entities.length > 0) score += 1;
  else missing.push("entities");

  if (spec.techStack && spec.techStack.length > 0) score += 1;
  else missing.push("tech_stack");

  if (spec.inputText && spec.inputText.length > 10) score += 1;
  else missing.push("detailed_input");

  if (!spec.ambiguities || spec.ambiguities.length === 0) score += 1;
  else missing.push("no_ambiguities");

  if (spec.conventions && spec.conventions.length > 0) score += 1;
  else missing.push("conventions");

  return {
    score: Math.round((score / total) * 1000) / 1000,
    missing,
    fulfilled: total - missing.length,
    total,
  };
}

/* ── Translation CRUD ───────────────────────────────────── */

const VALID_STATUSES = new Set(Object.values(TRANSLATION_STATUS));

export function translate(
  db,
  { text, intent, entities, techStack, spec, ambiguities } = {},
) {
  if (!text) return { translated: false, reason: "missing_text" };

  const id = _id();
  const now = _now();

  // Auto-classify if not provided
  const classified = intent || classifyIntent(text).intent;
  const extracted = entities || JSON.stringify(extractEntities(text).entities);
  const stack = techStack || JSON.stringify(detectTechStack(text).detected);
  const entitiesJson =
    typeof extracted === "string" ? extracted : JSON.stringify(extracted);
  const stackJson = typeof stack === "string" ? stack : JSON.stringify(stack);
  const specJson = spec
    ? typeof spec === "string"
      ? spec
      : JSON.stringify(spec)
    : null;
  const ambigJson = ambiguities
    ? typeof ambiguities === "string"
      ? ambiguities
      : JSON.stringify(ambiguities)
    : null;

  // Score completeness
  const completeness = scoreCompleteness({
    intent: classified,
    entities: JSON.parse(entitiesJson),
    techStack: JSON.parse(stackJson),
    inputText: text,
    ambiguities: ambigJson ? JSON.parse(ambigJson) : [],
  });

  const entry = {
    id,
    input_text: text,
    intent: classified,
    entities: entitiesJson,
    tech_stack: stackJson,
    spec: specJson,
    completeness_score: completeness.score,
    ambiguities: ambigJson,
    status: "draft",
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO nl_programs (id, input_text, intent, entities, tech_stack, spec, completeness_score, ambiguities, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    text,
    entry.intent,
    entry.entities,
    entry.tech_stack,
    entry.spec,
    entry.completeness_score,
    entry.ambiguities,
    "draft",
    now,
    now,
  );

  _translations.set(id, entry);
  return {
    translated: true,
    translationId: id,
    intent: classified,
    completeness: completeness.score,
  };
}

export function getTranslation(db, id) {
  const t = _translations.get(id);
  return t ? { ...t } : null;
}

export function listTranslations(db, { intent, status, limit = 50 } = {}) {
  let results = [..._translations.values()];
  if (intent) results = results.filter((t) => t.intent === intent);
  if (status) results = results.filter((t) => t.status === status);
  return results
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map((t) => ({ ...t }));
}

export function updateTranslationStatus(db, id, status) {
  const t = _translations.get(id);
  if (!t) return { updated: false, reason: "not_found" };
  if (!VALID_STATUSES.has(status))
    return { updated: false, reason: "invalid_status" };

  const now = _now();
  t.status = status;
  t.updated_at = now;

  db.prepare(
    "UPDATE nl_programs SET status = ?, updated_at = ? WHERE id = ?",
  ).run(status, now, id);

  return { updated: true, status };
}

export function refineTranslation(
  db,
  id,
  { spec, ambiguities, feedback } = {},
) {
  const t = _translations.get(id);
  if (!t) return { refined: false, reason: "not_found" };

  const now = _now();
  if (spec) t.spec = typeof spec === "string" ? spec : JSON.stringify(spec);
  if (ambiguities)
    t.ambiguities =
      typeof ambiguities === "string"
        ? ambiguities
        : JSON.stringify(ambiguities);
  t.status = "refined";
  t.updated_at = now;

  // Rescore completeness
  const completeness = scoreCompleteness({
    intent: t.intent,
    entities: JSON.parse(t.entities || "[]"),
    techStack: JSON.parse(t.tech_stack || "[]"),
    inputText: t.input_text,
    ambiguities: t.ambiguities ? JSON.parse(t.ambiguities) : [],
  });
  t.completeness_score = completeness.score;

  db.prepare(
    "UPDATE nl_programs SET spec = ?, ambiguities = ?, completeness_score = ?, status = 'refined', updated_at = ? WHERE id = ?",
  ).run(t.spec, t.ambiguities, t.completeness_score, now, id);

  return { refined: true, completeness: completeness.score };
}

export function removeTranslation(db, id) {
  const t = _translations.get(id);
  if (!t) return { removed: false, reason: "not_found" };

  _translations.delete(id);
  db.prepare("DELETE FROM nl_programs WHERE id = ?").run(id);

  return { removed: true };
}

/* ── Conventions ────────────────────────────────────────── */

const VALID_CATEGORIES = new Set(Object.values(STYLE_CATEGORY));

export function addConvention(
  db,
  { category, pattern, examples, confidence, sourceFiles } = {},
) {
  if (!category || !VALID_CATEGORIES.has(category))
    return { added: false, reason: "invalid_category" };
  if (!pattern) return { added: false, reason: "missing_pattern" };

  const id = _id();
  const now = _now();
  const examplesJson = examples
    ? typeof examples === "string"
      ? examples
      : JSON.stringify(examples)
    : null;
  const sourceJson = sourceFiles
    ? typeof sourceFiles === "string"
      ? sourceFiles
      : JSON.stringify(sourceFiles)
    : null;
  const conf = confidence != null ? Math.max(0, Math.min(1, confidence)) : 0.5;

  const entry = {
    id,
    category,
    pattern,
    examples: examplesJson,
    confidence: conf,
    source_files: sourceJson,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO nl_program_conventions (id, category, pattern, examples, confidence, source_files, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, category, pattern, examplesJson, conf, sourceJson, now, now);

  _conventions.set(id, entry);
  return { added: true, conventionId: id };
}

export function getConvention(db, id) {
  const c = _conventions.get(id);
  return c ? { ...c } : null;
}

export function listConventions(db, { category, limit = 50 } = {}) {
  let results = [..._conventions.values()];
  if (category) results = results.filter((c) => c.category === category);
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
    .map((c) => ({ ...c }));
}

export function removeConvention(db, id) {
  const c = _conventions.get(id);
  if (!c) return { removed: false, reason: "not_found" };

  _conventions.delete(id);
  db.prepare("DELETE FROM nl_program_conventions WHERE id = ?").run(id);

  return { removed: true };
}

/* ── Stats ──────────────────────────────────────────────── */

export function getNlProgrammingStats(db) {
  const translations = [..._translations.values()];
  const conventions = [..._conventions.values()];

  const byIntent = {};
  for (const i of Object.values(INTENT)) byIntent[i] = 0;
  for (const t of translations)
    byIntent[t.intent] = (byIntent[t.intent] || 0) + 1;

  const byStatus = {};
  for (const s of Object.values(TRANSLATION_STATUS)) byStatus[s] = 0;
  for (const t of translations)
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;

  const byCategory = {};
  for (const c of Object.values(STYLE_CATEGORY)) byCategory[c] = 0;
  for (const c of conventions)
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;

  const avgCompleteness =
    translations.length > 0
      ? Math.round(
          (translations.reduce((s, t) => s + t.completeness_score, 0) /
            translations.length) *
            1000,
        ) / 1000
      : 0;

  return {
    translations: {
      total: translations.length,
      byIntent,
      byStatus,
      avgCompleteness,
    },
    conventions: {
      total: conventions.length,
      byCategory,
    },
  };
}

/* ── Reset (tests) ──────────────────────────────────────── */

export function _resetState() {
  _translations.clear();
  _conventions.clear();
}
