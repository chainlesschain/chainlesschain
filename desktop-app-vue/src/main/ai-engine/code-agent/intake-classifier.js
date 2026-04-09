/**
 * intake-classifier — Phase E of the canonical coding workflow.
 *
 * Decides whether a user request should execute via `$ralph` (single-agent,
 * sequential) or `$team` (fan-out across sub-runtimes), implementing the
 * routing rules from ADR §8.1:
 *
 *   - Single file or one directory → $ralph
 *   - Two or more clearly-bounded directories → $team
 *   - Verification >> implementation → bias toward tester roles
 *
 * The classifier is PURE: it takes the request text plus optional hints
 * (scopePaths, tasks.json payload, file list) and returns a decision
 * object. It has no I/O and no side effects, so it composes cleanly with:
 *
 *   - `$deep-interview` handler (after parsing intent, classify before
 *     suggesting next command)
 *   - `workflow-session-ipc.js` (exposes it as a read-only channel so the
 *     renderer can preview the recommended agent mode)
 *   - CLI (imports directly for `$intake` pre-flight)
 *
 * Heuristics are intentionally simple and explainable. They do NOT use an
 * LLM — the goal is deterministic, testable routing, not clever reasoning.
 */

// Top-level directories that delineate clear scope boundaries in this repo.
// A task touching ≥2 of these is almost always a "team" candidate.
const MONOREPO_BOUNDARIES = [
  "desktop-app-vue/src/main",
  "desktop-app-vue/src/renderer",
  "desktop-app-vue/src/preload",
  "desktop-app-vue/tests",
  "packages/cli/src",
  "packages/cli/__tests__",
  "backend/project-service",
  "backend/ai-service",
  "android-app",
  "ios-app",
  "docs",
];

// Fallback: if no monorepo boundary matches, fall back to the first
// two path segments as a "bounded directory" proxy.
function bucketByBoundary(scopePath) {
  if (!scopePath || typeof scopePath !== "string") {
    return null;
  }
  const normalized = scopePath.replace(/\\/g, "/").replace(/^\/+/, "");
  for (const boundary of MONOREPO_BOUNDARIES) {
    if (normalized === boundary || normalized.startsWith(`${boundary}/`)) {
      return boundary;
    }
  }
  // Fallback: first two segments (e.g. "src/main")
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || null;
}

// Signal groups pulled from request text. Order matters only for reporting.
const CROSS_CUTTING_PHRASES = [
  /\b(main\s+and\s+renderer|frontend\s+and\s+backend|ui\s+and\s+api)\b/i,
  /\b(across|throughout|every|all)\s+(modules?|packages?|layers?)\b/i,
  /\bboth\s+\w+\s+and\s+\w+\b/i,
];

const TEST_HEAVY_PHRASES = [
  /\b(add|write|expand)\s+(unit|integration|e2e)\s+tests?\b/i,
  /\btest\s+coverage\b/i,
  /\bverify|verification|regression\b/i,
];

const TRIVIAL_PHRASES = [
  /\b(typo|rename|comment|docstring|whitespace)\b/i,
  /\bfix\s+(a\s+)?(typo|comment)\b/i,
];

const MULTI_MODULE_KEYWORDS = [
  /\bmain\b/i,
  /\brenderer\b/i,
  /\bpreload\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i,
  /\bcli\b/i,
  /\bandroid\b/i,
  /\bios\b/i,
];

function countDistinctScopes(scopePaths) {
  if (!Array.isArray(scopePaths) || scopePaths.length === 0) {
    return 0;
  }
  const buckets = new Set();
  for (const p of scopePaths) {
    const b = bucketByBoundary(p);
    if (b) {
      buckets.add(b);
    }
  }
  return buckets.size;
}

function detectTextModules(text) {
  if (!text || typeof text !== "string") {
    return [];
  }
  const hits = new Set();
  for (const re of MULTI_MODULE_KEYWORDS) {
    const m = text.match(re);
    if (m) {
      hits.add(m[0].toLowerCase());
    }
  }
  return Array.from(hits);
}

function anyMatch(text, regexes) {
  if (!text || typeof text !== "string") {
    return false;
  }
  return regexes.some((re) => re.test(text));
}

/**
 * Collect scope paths from a tasks.json-shaped payload. Returns a flat
 * deduped array of scope path strings.
 */
function collectTaskScopes(tasksPayload) {
  if (!tasksPayload || !Array.isArray(tasksPayload.tasks)) {
    return [];
  }
  const out = new Set();
  for (const t of tasksPayload.tasks) {
    if (Array.isArray(t.scopePaths)) {
      for (const s of t.scopePaths) {
        out.add(s);
      }
    }
  }
  return Array.from(out);
}

/**
 * Core classifier.
 *
 * @param {object} input
 * @param {string} [input.request]       Raw user request text
 * @param {string[]} [input.scopePaths]  Explicit scope paths (from intent / tasks)
 * @param {object}   [input.tasks]       tasks.json-shaped payload (optional)
 * @param {string[]} [input.fileHints]   Additional file paths (e.g. from git diff)
 * @param {number}   [input.concurrency] Desired concurrency cap for $team (default 3)
 *
 * @returns {{
 *   decision: "ralph" | "team",
 *   confidence: "low" | "medium" | "high",
 *   complexity: "trivial" | "simple" | "moderate" | "complex",
 *   scopeCount: number,
 *   boundaries: string[],
 *   testHeavy: boolean,
 *   signals: string[],
 *   reason: string,
 *   recommendedConcurrency: number,
 *   suggestedRoles: string[],
 * }}
 */
function classifyIntake(input = {}) {
  const request = typeof input.request === "string" ? input.request : "";
  const providedScopes = Array.isArray(input.scopePaths)
    ? input.scopePaths
    : [];
  const taskScopes = collectTaskScopes(input.tasks);
  const fileHints = Array.isArray(input.fileHints) ? input.fileHints : [];

  const allScopes = [...providedScopes, ...taskScopes, ...fileHints];
  const boundaries = Array.from(
    new Set(allScopes.map((p) => bucketByBoundary(p)).filter(Boolean)),
  );
  const scopeCount = boundaries.length;

  const signals = [];
  const textModules = detectTextModules(request);
  if (textModules.length >= 2) {
    signals.push(`text mentions ${textModules.length} modules`);
  }
  if (anyMatch(request, CROSS_CUTTING_PHRASES)) {
    signals.push("cross-cutting phrase in request");
  }
  const testHeavy = anyMatch(request, TEST_HEAVY_PHRASES);
  if (testHeavy) {
    signals.push("test-heavy request");
  }
  const trivial = anyMatch(request, TRIVIAL_PHRASES);
  if (trivial) {
    signals.push("trivial edit");
  }

  // ── decision ────────────────────────────────────────────────────────
  let decision = "ralph";
  let reason;
  let confidence = "medium";

  if (scopeCount >= 2) {
    decision = "team";
    reason = `touches ${scopeCount} distinct scopes: ${boundaries.join(", ")}`;
    confidence = "high";
  } else if (
    scopeCount === 0 &&
    (textModules.length >= 2 || anyMatch(request, CROSS_CUTTING_PHRASES))
  ) {
    // Text-only evidence — weaker signal
    decision = "team";
    reason = `request text implies multiple modules (${textModules.join(", ") || "cross-cutting"})`;
    confidence = "low";
  } else if (trivial) {
    decision = "ralph";
    reason = "request looks trivial (typo / rename / comment)";
    confidence = "high";
  } else {
    decision = "ralph";
    reason =
      scopeCount === 1
        ? `single scope: ${boundaries[0]}`
        : "no multi-scope signals detected";
    confidence = scopeCount === 1 ? "high" : "medium";
  }

  // ── complexity tier ────────────────────────────────────────────────
  let complexity;
  if (trivial) {
    complexity = "trivial";
  } else if (scopeCount === 0 && request.length < 160) {
    complexity = "simple";
  } else if (scopeCount <= 1) {
    complexity = "moderate";
  } else {
    complexity = "complex";
  }

  // ── concurrency hint ───────────────────────────────────────────────
  const requestedConcurrency =
    typeof input.concurrency === "number" && input.concurrency > 0
      ? Math.min(input.concurrency, 6)
      : 3;
  const recommendedConcurrency =
    decision === "team" ? Math.min(scopeCount || 2, requestedConcurrency) : 1;

  // ── suggested roles ────────────────────────────────────────────────
  const suggestedRoles = [];
  if (decision === "team") {
    // Map boundaries to role hints. Falls back to "executor" when unknown.
    for (const b of boundaries) {
      if (b.includes("src/main")) {
        suggestedRoles.push("executor/main");
      } else if (b.includes("src/renderer")) {
        suggestedRoles.push("executor/ui");
      } else if (b.includes("backend")) {
        suggestedRoles.push("executor/backend");
      } else if (b.includes("tests")) {
        suggestedRoles.push("tester/unit");
      } else if (b.includes("cli")) {
        suggestedRoles.push("executor/cli");
      } else {
        suggestedRoles.push("executor");
      }
    }
    if (testHeavy && !suggestedRoles.some((r) => r.startsWith("tester"))) {
      suggestedRoles.push("tester/unit");
    }
  } else {
    suggestedRoles.push(testHeavy ? "tester/unit" : "executor");
  }

  return {
    decision,
    confidence,
    complexity,
    scopeCount,
    boundaries,
    testHeavy,
    signals,
    reason,
    recommendedConcurrency,
    suggestedRoles: Array.from(new Set(suggestedRoles)),
  };
}

module.exports = {
  classifyIntake,
  bucketByBoundary,
  countDistinctScopes,
  collectTaskScopes,
  MONOREPO_BOUNDARIES,
};
