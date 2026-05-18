/**
 * Query Enhancer Skill Handler
 *
 * Optimizes search queries for RAG retrieval using NLP heuristics:
 * synonym expansion, query type detection, entity extraction, HyDE generation.
 * Actions: --rewrite, --multi, --hyde, --decompose, --expand, --analyze
 */

const { logger } = require("../../../../../utils/logger.js");

// Built-in synonym map (term -> alternatives)
const SYNONYMS = {
  error: ["exception", "failure", "bug", "issue"],
  fix: ["resolve", "repair", "patch", "correct"],
  create: ["generate", "build", "make", "produce"],
  delete: ["remove", "destroy", "erase", "drop"],
  update: ["modify", "change", "alter", "edit"],
  search: ["find", "query", "lookup", "retrieve"],
  fast: ["quick", "performant", "efficient", "optimized"],
  slow: ["sluggish", "bottleneck", "degraded", "lagging"],
  database: ["db", "datastore", "storage", "persistence"],
  api: ["endpoint", "interface", "service", "handler"],
  cache: ["memoize", "store", "buffer"],
  permission: ["access control", "authorization", "RBAC"],
  authentication: ["auth", "login", "identity", "credential"],
  embedding: ["vector", "representation", "encoding"],
  retrieval: ["search", "fetch", "recall", "lookup"],
  context: ["prompt", "window", "token budget"],
  model: ["LLM", "language model", "AI"],
  skill: ["plugin", "extension", "module"],
  agent: ["assistant", "bot", "worker"],
  hook: ["callback", "listener", "middleware"],
};

// Query type detection patterns
const QT = {
  who: /^who\b|\bwho\s+(is|are|was|created|wrote)\b/i,
  what: /^what\b|\bwhat\s+(is|are|does|do)\b/i,
  when: /^when\b|\bwhen\s+(did|does|was|will)\b/i,
  where: /^where\b|\bwhere\s+(is|are|does|can)\b/i,
  why: /^why\b|\bwhy\s+(does|do|did|is|are)\b/i,
  how: /^how\b|\bhow\s+(to|do|does|can|is|many|much)\b/i,
  boolean: /^(is|are|does|do|can|will|should|has|have)\b/i,
  comparison: /\b(vs|versus|compared to|difference between)\b/i,
  procedural: /\b(how to|steps to|guide|tutorial|set up|configure)\b/i,
};

const ANSWER_TYPE = {
  who: "entity/person",
  what: "definition/explanation",
  when: "temporal/date",
  where: "location/path",
  why: "causal/reasoning",
  how: "procedural/tutorial",
  boolean: "yes/no",
  comparison: "comparative analysis",
  procedural: "step-by-step guide",
};

const STOP = new Set(
  "the a an is are was were be been have has had do does did will would could should may might can to of in for on with at by from as and but or not no so yet it its my your i this that".split(
    " ",
  ),
);

// -- Helpers --

function tokenize(q) {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function detectType(q) {
  for (const [t, p] of Object.entries(QT)) {
    if (p.test(q)) {
      return t;
    }
  }
  return "general";
}

function findSyns(q) {
  const lo = q.toLowerCase(),
    r = {};
  for (const [t, s] of Object.entries(SYNONYMS)) {
    if (lo.includes(t)) {
      r[t] = s;
    }
  }
  return r;
}

function extractEntities(q) {
  const ents = new Set();
  (q.match(/["']([^"']+)["']/g) || []).forEach((m) =>
    ents.add(m.replace(/["']/g, "")),
  );
  const words = q.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/[^a-zA-Z0-9_-]/g, "");
    if (
      w.length > 1 &&
      /^[A-Z]/.test(w) &&
      !/^(The|A|An|In|On|At|To|For|Of|Is|It|And|Or|But|How|What|Why|When|Where|Who)$/.test(
        w,
      )
    ) {
      ents.add(w);
    }
  }
  (q.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []).forEach((m) =>
    ents.add(m),
  );
  (q.match(/\b[a-z]+(?:-[a-z]+){1,}\b/g) || [])
    .filter((m) => m.length > 4)
    .forEach((m) => ents.add(m));
  return [...ents];
}

function extractQ(raw) {
  let q = raw.trim();
  if (
    (q[0] === '"' && q.slice(-1) === '"') ||
    (q[0] === "'" && q.slice(-1) === "'")
  ) {
    q = q.slice(1, -1);
  }
  return q;
}

function rephrase(q, qt) {
  const c = q.replace(/[?!.]+$/, "").trim();
  if (qt === "how") {
    return (
      c
        .replace(/^how\s+(to|do|does|did|can|is|are)\s+/i, "")
        .replace(/^how\s+/i, "") + " implementation mechanism"
    );
  }
  if (qt === "what") {
    return (
      c.replace(/^what\s+(is|are|does|do)\s+/i, "").replace(/^what\s+/i, "") +
      " definition explanation"
    );
  }
  if (qt === "why") {
    return (
      c.replace(/^why\s+(does|do|did|is|are)\s+/i, "").replace(/^why\s+/i, "") +
      " reason cause"
    );
  }
  if (qt === "boolean") {
    return c
      .replace(/^(is|are|does|do|can|will|should|has|have)\s+/i, "")
      .trim();
  }
  return null;
}

function detectAspects(q) {
  const lo = q.toLowerCase(),
    aspects = [];
  const pa = {
    configuration: /\b(config|setup|setting|option)\b/,
    implementation: /\b(implement|code|logic|algorithm)\b/,
    usage: /\b(use|usage|example|guide)\b/,
    architecture: /\b(design|pattern|structure|module)\b/,
    performance: /\b(perform|speed|fast|slow|optim)\b/,
    security: /\b(secur|auth|permission|encrypt)\b/,
    testing: /\b(test|spec|mock|coverage)\b/,
    troubleshooting: /\b(error|debug|fix|issue|crash)\b/,
  };
  for (const [a, p] of Object.entries(pa)) {
    if (p.test(lo)) {
      aspects.push(a);
    }
  }
  return aspects;
}

function numbered(arr) {
  return arr.map((v, i) => "  " + (i + 1) + ") " + v).join("\n");
}

// -- Actions --

function rewriteQuery(query) {
  const tk = tokenize(query),
    syns = findSyns(query),
    ents = extractEntities(query),
    qt = detectType(query);
  const vars = [tk.join(" ")];
  const v2 = tk.map((t) => (syns[t] ? syns[t][0] : t)).join(" ");
  if (v2 !== vars[0]) {
    vars.push(v2);
  }
  if (ents.length) {
    vars.push(tk.join(" ") + " " + ents.join(" "));
  }
  const rep = rephrase(query, qt);
  if (rep && !vars.includes(rep)) {
    vars.push(rep);
  }
  const r = {
    original: query,
    action: "rewrite",
    variants: vars,
    synonymsUsed: syns,
    entities: ents,
    queryType: qt,
  };
  let m =
    "Query Rewrite\n" +
    "=".repeat(40) +
    "\nOriginal: " +
    query +
    "\nQuery type: " +
    qt +
    "\n\nVariants:\n" +
    numbered(vars);
  if (ents.length) {
    m += "\nEntities: " + ents.join(", ");
  }
  return { success: true, result: r, message: m };
}

function multiQuery(query) {
  const tk = tokenize(query),
    ents = extractEntities(query),
    syns = findSyns(query),
    qt = detectType(query);
  const qs = [tk.slice(0, 6).join(" ")];
  const q2 = tk
    .map((t) => (syns[t] ? syns[t][0] : t))
    .slice(0, 6)
    .join(" ");
  if (q2 !== qs[0]) {
    qs.push(q2);
  }
  if (ents.length) {
    qs.push(ents.join(" ") + " " + tk.slice(0, 3).join(" "));
  }
  const broader = Object.values(syns)
    .filter((s) => s.length > 1)
    .map((s) => s[1]);
  if (broader.length) {
    qs.push(tk.slice(0, 3).join(" ") + " " + broader.join(" "));
  }
  const rep = rephrase(query, qt);
  if (rep && !qs.includes(rep)) {
    qs.push(rep);
  }
  if (qs.length < 3) {
    qs.push(query.replace(/[?!.]+$/, "").trim());
  }
  const uq = [...new Set(qs)].slice(0, 5);
  const r = {
    original: query,
    action: "multi",
    queries: uq,
    count: uq.length,
    entities: ents,
    queryType: qt,
  };
  let m =
    "Multi-Query Expansion\n" +
    "=".repeat(40) +
    "\nOriginal: " +
    query +
    "\nGenerated " +
    uq.length +
    " queries:\n\n" +
    numbered(uq);
  if (ents.length) {
    m += "\nEntities: " + ents.join(", ");
  }
  return { success: true, result: r, message: m };
}

function hydeGenerate(query) {
  const tk = tokenize(query),
    ents = extractEntities(query),
    qt = detectType(query);
  const at = ANSWER_TYPE[qt] || "informational";
  const topic = tk.slice(0, 8).join(" "),
    eStr = ents.length ? ents.join(", ") : topic;
  const templates = {
    how:
      "To " +
      topic +
      ", follow these steps. First, configure the " +
      eStr +
      " component. Then initialize dependencies and set up parameters. The implementation uses a " +
      topic +
      " approach with sequential processing. Key functions include setup(), initialize(), and execute().",
    what:
      eStr +
      " is a component that handles " +
      topic +
      ". It provides functionality for managing related operations. The core implementation exposes several public methods and integrates with other components through well-defined interfaces.",
    why:
      "The reason for " +
      topic +
      " relates to " +
      eStr +
      ". This design decision improves performance and maintainability. Primary factors include scalability, backward compatibility, and multi-platform support.",
    comparison:
      "Comparing " +
      topic +
      ": " +
      eStr +
      " differ in key aspects. The first offers better performance for small datasets; the second scales better. Both provide similar APIs but differ in internal architecture.",
  };
  const passage =
    templates[qt] ||
    templates.how ||
    "Regarding " +
      topic +
      ", the system implements this through " +
      eStr +
      ". The architecture follows a modular design with validation at each stage and both sync and async APIs.";
  const r = {
    original: query,
    action: "hyde",
    hypotheticalPassage: passage,
    queryType: qt,
    expectedAnswerType: at,
    entities: ents,
    passageLength: passage.split(/\s+/).length,
  };
  let m =
    "HyDE - Hypothetical Document Embedding\n" +
    "=".repeat(40) +
    "\nOriginal: " +
    query +
    "\nQuery type: " +
    qt +
    " | Expected answer: " +
    at +
    "\nPassage (" +
    r.passageLength +
    " words):\n\n" +
    passage;
  if (ents.length) {
    m += "\n\nEntities: " + ents.join(", ");
  }
  return { success: true, result: r, message: m };
}

function decomposeQuery(query) {
  const ents = extractEntities(query),
    tk = tokenize(query),
    qt = detectType(query),
    subs = [];
  const clauses = query
    .split(/\s*(?:,\s*and\s+|\s+and\s+|,\s+|\s+then\s+|\s+also\s+)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 5);
  if (clauses.length > 1) {
    clauses.forEach((c) => subs.push(c.replace(/[?!.]+$/, "")));
  }
  if (ents.length > 1) {
    ents.forEach((e) =>
      subs.push(
        e +
          " " +
          tk
            .filter((t) => t.toLowerCase() !== e.toLowerCase())
            .slice(0, 4)
            .join(" "),
      ),
    );
  }
  const aspects = detectAspects(query);
  if (aspects.length) {
    const core = tk.slice(0, 5).join(" ");
    aspects.forEach((a) => subs.push(core + " " + a));
  }
  if (!subs.length) {
    subs.push(query.replace(/[?!.]+$/, "").trim());
    if (tk.length > 3) {
      subs.push(tk.slice(0, 3).join(" "));
      subs.push(tk.join(" ") + " example");
    }
  }
  const uq = [...new Set(subs)].slice(0, 6);
  const r = {
    original: query,
    action: "decompose",
    subQueries: uq,
    count: uq.length,
    entities: ents,
    queryType: qt,
  };
  let m =
    "Query Decomposition\n" +
    "=".repeat(40) +
    "\nOriginal: " +
    query +
    "\n" +
    uq.length +
    " sub-queries:\n\n" +
    numbered(uq);
  if (ents.length) {
    m += "\nEntities: " + ents.join(", ");
  }
  return { success: true, result: r, message: m };
}

function expandQuery(query) {
  const tk = tokenize(query),
    syns = findSyns(query),
    ents = extractEntities(query),
    aspects = detectAspects(query),
    added = [];
  for (const s of Object.values(syns)) {
    s.slice(0, 2).forEach((v) => {
      if (!tk.includes(v.toLowerCase())) {
        added.push(v);
      }
    });
  }
  aspects.forEach((a) => {
    if (!tk.includes(a)) {
      added.push(a);
    }
  });
  const expanded =
    query.replace(/[?!.]+$/, "").trim() +
    (added.length ? " " + added.join(" ") : "");
  const r = {
    original: query,
    action: "expand",
    expandedQuery: expanded,
    addedTerms: added,
    synonymsFound: syns,
    entities: ents,
    aspects,
    originalTokenCount: tk.length,
    expandedTokenCount: tokenize(expanded).length,
  };
  let m =
    "Query Expansion\n" +
    "=".repeat(40) +
    "\nOriginal: " +
    query +
    "\nExpanded: " +
    expanded +
    "\nTokens: " +
    r.originalTokenCount +
    " -> " +
    r.expandedTokenCount;
  if (added.length) {
    m += "\nAdded: " + added.join(", ");
  }
  if (aspects.length) {
    m += "\nAspects: " + aspects.join(", ");
  }
  return { success: true, result: r, message: m };
}

function analyzeQuery(query) {
  const tk = tokenize(query),
    ents = extractEntities(query),
    qt = detectType(query);
  const at = ANSWER_TYPE[qt] || "informational",
    syns = findSyns(query),
    aspects = detectAspects(query);
  const complexity =
    tk.length > 10 || ents.length > 2 || aspects.length > 2
      ? "complex"
      : tk.length > 5 || ents.length > 1
        ? "moderate"
        : "simple";
  const suggested = [];
  Object.values(syns).forEach((s) => suggested.push(...s.slice(0, 2)));
  const r = {
    original: query,
    action: "analyze",
    queryType: qt,
    expectedAnswerType: at,
    entities: ents,
    tokens: tk,
    tokenCount: tk.length,
    complexity,
    aspects,
    suggestedExpansions: [...new Set(suggested)].slice(0, 10),
  };
  let m =
    "Query Analysis\n" +
    "=".repeat(40) +
    "\nOriginal: " +
    query +
    "\nType: " +
    qt +
    " | Answer: " +
    at +
    " | Complexity: " +
    complexity +
    "\nTokens: " +
    tk.length;
  if (ents.length) {
    m += "\nEntities: " + ents.join(", ");
  }
  if (aspects.length) {
    m += "\nAspects: " + aspects.join(", ");
  }
  if (r.suggestedExpansions.length) {
    m += "\nSuggested expansions: " + r.suggestedExpansions.join(", ");
  }
  return { success: true, result: r, message: m };
}

// -- Handler --

module.exports = {
  async init(skill) {
    logger.info("[query-enhancer] init: " + (skill?.name || "query-enhancer"));
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();
    logger.info(
      "[query-enhancer] execute: projectRoot=" +
        projectRoot +
        " input=" +
        input.slice(0, 80),
    );

    try {
      const actions = {
        rewrite: rewriteQuery,
        multi: multiQuery,
        hyde: hydeGenerate,
        decompose: decomposeQuery,
        expand: expandQuery,
        analyze: analyzeQuery,
      };
      for (const [name, fn] of Object.entries(actions)) {
        const m = input.match(new RegExp("--" + name + "\\s+(.+)", "is"));
        if (m) {
          return fn(extractQ(m[1]));
        }
      }

      if (!input) {
        return {
          success: true,
          result: { actions: Object.keys(actions) },
          message:
            "Query Enhancer\n" +
            "=".repeat(40) +
            "\nOptimize search queries for better RAG retrieval.\n\nUsage:\n" +
            '  /query-enhancer --rewrite "<query>"     Rewrite with synonyms & variants\n' +
            '  /query-enhancer --multi "<query>"        Generate 3-5 diverse queries\n' +
            '  /query-enhancer --hyde "<query>"          Hypothetical document passage\n' +
            '  /query-enhancer --decompose "<query>"   Break into sub-queries\n' +
            '  /query-enhancer --expand "<query>"       Add related terms & synonyms\n' +
            '  /query-enhancer --analyze "<query>"      Analyze intent & entities\n\nExamples:\n' +
            '  /query-enhancer --rewrite "How does the permission system handle delegation?"\n' +
            '  /query-enhancer --hyde "How does hybrid search combine vector and BM25?"',
        };
      }

      // Default: treat bare input as rewrite
      return rewriteQuery(input);
    } catch (err) {
      logger.error("[query-enhancer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Query enhancer failed: " + err.message,
      };
    }
  },
};
