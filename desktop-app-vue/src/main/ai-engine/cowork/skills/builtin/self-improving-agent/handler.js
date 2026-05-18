/**
 * Self-Improving Agent Skill Handler (v2.0)
 *
 * Tracks errors, corrections, and patterns to enable continuous improvement.
 * Enhanced: confidence scoring, skill extraction (Claudeception pattern),
 * learnings directory, knowledge verification, instinct system, auto-capture.
 *
 * Persists data to {userData}/.chainlesschain/self-improving/
 */

const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");

const _deps = { fs, path };

let dataDir = null;
let historyPath = null;
let learningsPath = null;
let history = {
  errors: [],
  corrections: [],
  stats: { totalRecorded: 0, patternsDetected: 0, lastAnalysis: null },
};
let learnings = {
  instincts: [],
  skills: [],
  meta: { version: 2, totalExtractions: 0 },
};

function _resetState() {
  dataDir = null;
  historyPath = null;
  learningsPath = null;
  history = {
    errors: [],
    corrections: [],
    stats: { totalRecorded: 0, patternsDetected: 0, lastAnalysis: null },
  };
  learnings = {
    instincts: [],
    skills: [],
    meta: { version: 2, totalExtractions: 0 },
  };
}

function getDataDir() {
  if (dataDir) {
    return dataDir;
  }
  const appData = process.env.APPDATA || process.env.HOME || "/tmp";
  dataDir = _deps.path.join(appData, ".chainlesschain", "self-improving");
  return dataDir;
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!_deps.fs.existsSync(dir)) {
    _deps.fs.mkdirSync(dir, { recursive: true });
  }
  historyPath = _deps.path.join(dir, "history.json");
  learningsPath = _deps.path.join(dir, "learnings.json");
}

function loadHistory() {
  ensureDataDir();
  try {
    if (_deps.fs.existsSync(historyPath)) {
      const raw = _deps.fs.readFileSync(historyPath, "utf-8");
      history = JSON.parse(raw);
    }
  } catch (err) {
    logger.warn("[SelfImprove] Failed to load history:", err.message);
  }
}

function saveHistory() {
  ensureDataDir();
  try {
    _deps.fs.writeFileSync(
      historyPath,
      JSON.stringify(history, null, 2),
      "utf-8",
    );
  } catch (err) {
    logger.error("[SelfImprove] Failed to save history:", err.message);
  }
}

function loadLearnings() {
  ensureDataDir();
  try {
    if (_deps.fs.existsSync(learningsPath)) {
      const raw = _deps.fs.readFileSync(learningsPath, "utf-8");
      learnings = JSON.parse(raw);
    }
  } catch (err) {
    logger.warn("[SelfImprove] Failed to load learnings:", err.message);
  }
}

function saveLearnings() {
  ensureDataDir();
  try {
    _deps.fs.writeFileSync(
      learningsPath,
      JSON.stringify(learnings, null, 2),
      "utf-8",
    );
  } catch (err) {
    logger.error("[SelfImprove] Failed to save learnings:", err.message);
  }
}

// ── Confidence Scoring ────────────────────────────

function calculateConfidence(instinct) {
  let score = 0.5; // Base

  // Verification bonus
  if (instinct.verified) {
    score += 0.2;
  }

  // Usage frequency bonus (capped at 0.2)
  const usageBonus = Math.min(0.2, (instinct.usageCount || 0) * 0.04);
  score += usageBonus;

  // Recency bonus (0.1 if used in last 7 days)
  if (instinct.lastUsed) {
    const daysSince =
      (Date.now() - new Date(instinct.lastUsed).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSince < 7) {
      score += 0.1;
    }
  }

  // Success rate bonus
  if (instinct.successCount > 0 && instinct.failureCount >= 0) {
    const successRate =
      instinct.successCount / (instinct.successCount + instinct.failureCount);
    score += successRate * 0.1;
  }

  // Penalty for failures
  if (instinct.failureCount > 2) {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

// ── Instinct System ───────────────────────────────

function handleCaptureInstinct(description, trigger, solution) {
  if (!description) {
    return {
      success: false,
      action: "capture-instinct",
      error:
        "Description required. Usage: capture-instinct <description> trigger: <when> solution: <what>",
    };
  }

  loadLearnings();

  const instinct = {
    id: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    description,
    trigger: trigger || null,
    solution: solution || null,
    confidence: 0.5,
    verified: false,
    usageCount: 0,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    tags: extractKeywords(
      description + " " + (trigger || "") + " " + (solution || ""),
    ),
  };

  instinct.confidence = calculateConfidence(instinct);
  learnings.instincts.push(instinct);
  learnings.meta.totalExtractions++;
  saveLearnings();

  return {
    success: true,
    action: "capture-instinct",
    result: { instinct },
    message: `Captured instinct "${description.substring(0, 60)}" (confidence: ${instinct.confidence})`,
  };
}

function handleVerifyInstinct(instinctId, success) {
  loadLearnings();

  const instinct = learnings.instincts.find((i) => i.id === instinctId);
  if (!instinct) {
    return {
      success: false,
      action: "verify-instinct",
      error: `Instinct "${instinctId}" not found.`,
    };
  }

  instinct.verified = true;
  instinct.lastUsed = new Date().toISOString();
  instinct.usageCount++;
  if (success) {
    instinct.successCount++;
  } else {
    instinct.failureCount++;
  }
  instinct.confidence = calculateConfidence(instinct);
  saveLearnings();

  return {
    success: true,
    action: "verify-instinct",
    result: { instinct },
    message: `Instinct "${instinct.description.substring(0, 40)}" ${success ? "verified as successful" : "marked as failed"} (confidence: ${instinct.confidence})`,
  };
}

function handleListInstincts(minConfidence) {
  loadLearnings();

  const threshold = minConfidence || 0;
  const filtered = learnings.instincts
    .filter((i) => i.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);

  return {
    success: true,
    action: "list-instincts",
    result: {
      instincts: filtered,
      total: learnings.instincts.length,
      filtered: filtered.length,
    },
    message: `${filtered.length} instinct(s)${threshold > 0 ? ` (confidence >= ${threshold})` : ""} of ${learnings.instincts.length} total.`,
  };
}

// ── Skill Extraction (Claudeception) ──────────────

function handleExtractSkill(
  name,
  description,
  triggerConditions,
  solution,
  verification,
) {
  if (!name || !description) {
    return {
      success: false,
      action: "extract-skill",
      error:
        "Name and description required. Usage: extract-skill <name> desc: <description> trigger: <conditions> solution: <steps> verify: <how>",
    };
  }

  loadLearnings();

  // Check for duplicate
  if (
    learnings.skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
  ) {
    return {
      success: false,
      action: "extract-skill",
      error: `Skill "${name}" already exists. Use update-skill to modify.`,
    };
  }

  const skill = {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    triggerConditions:
      triggerConditions || "When a similar problem is encountered",
    solution: solution || "",
    verification: verification || "",
    timestamp: new Date().toISOString(),
    confidence: 0.5,
    usageCount: 0,
    version: "1.0.0",
    tags: extractKeywords(description + " " + name),
    relatedInstincts: [],
  };

  // Link related instincts by keyword overlap
  const skillKeywords = new Set(skill.tags);
  for (const instinct of learnings.instincts) {
    const overlap = (instinct.tags || []).filter((t) =>
      skillKeywords.has(t),
    ).length;
    if (overlap >= 2) {
      skill.relatedInstincts.push(instinct.id);
    }
  }

  learnings.skills.push(skill);
  learnings.meta.totalExtractions++;
  saveLearnings();

  return {
    success: true,
    action: "extract-skill",
    result: { skill },
    message: `Extracted skill "${name}" (${skill.relatedInstincts.length} related instinct(s))`,
  };
}

function handleListSkills() {
  loadLearnings();

  const skills = learnings.skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description.substring(0, 80),
    confidence: s.confidence,
    usageCount: s.usageCount,
    version: s.version,
  }));

  return {
    success: true,
    action: "list-skills",
    result: { skills, total: skills.length },
    message: `${skills.length} extracted skill(s).`,
  };
}

function handleExportLearnings() {
  loadLearnings();
  loadHistory();

  const exported = {
    version: 2,
    exportDate: new Date().toISOString(),
    instincts: learnings.instincts,
    skills: learnings.skills,
    errorHistory: history.errors.slice(-50),
    corrections: history.corrections.slice(-50),
    stats: {
      totalInstincts: learnings.instincts.length,
      totalSkills: learnings.skills.length,
      totalErrors: history.errors.length,
      totalCorrections: history.corrections.length,
      avgConfidence:
        learnings.instincts.length > 0
          ? Math.round(
              (learnings.instincts.reduce((sum, i) => sum + i.confidence, 0) /
                learnings.instincts.length) *
                100,
            ) / 100
          : 0,
    },
  };

  return {
    success: true,
    action: "export",
    result: exported,
    message: `Exported ${exported.stats.totalInstincts} instinct(s), ${exported.stats.totalSkills} skill(s), ${exported.stats.totalErrors} error(s).`,
  };
}

// ── Original Actions ──────────────────────────────

function handleRecordError(errorDesc, fix) {
  if (!errorDesc) {
    return {
      success: false,
      action: "record-error",
      error:
        "Please provide an error description. Usage: record-error <description> fix: <correction>",
    };
  }

  loadHistory();

  const entry = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    error: errorDesc,
    fix: fix || null,
    category: categorizeError(errorDesc),
    keywords: extractKeywords(errorDesc + " " + fix),
  };

  history.errors.push(entry);
  history.stats.totalRecorded = history.errors.length;

  if (fix) {
    history.corrections.push({
      errorId: entry.id,
      timestamp: entry.timestamp,
      original: errorDesc,
      correction: fix,
      category: entry.category,
    });
  }

  saveHistory();

  // Auto-capture instinct if fix is provided
  let autoInstinct = null;
  if (fix && fix.length > 20) {
    loadLearnings();
    autoInstinct = {
      id: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: entry.timestamp,
      description: `Fix for ${entry.category}: ${errorDesc.substring(0, 60)}`,
      trigger: errorDesc.substring(0, 100),
      solution: fix.substring(0, 200),
      confidence: 0.4,
      verified: false,
      usageCount: 0,
      successCount: 0,
      failureCount: 0,
      lastUsed: null,
      tags: entry.keywords,
    };
    learnings.instincts.push(autoInstinct);
    learnings.meta.totalExtractions++;
    saveLearnings();
  }

  return {
    success: true,
    action: "record-error",
    entry,
    result: {
      recorded: true,
      totalEntries: history.errors.length,
      autoInstinct: autoInstinct ? autoInstinct.id : null,
    },
    message: `Recorded error "${errorDesc.substring(0, 60)}${errorDesc.length > 60 ? "..." : ""}" with ${fix ? "correction" : "no correction"}.${autoInstinct ? " Auto-captured as instinct." : ""}`,
  };
}

function handleAnalyzePatterns() {
  loadHistory();

  if (history.errors.length === 0) {
    return {
      success: true,
      action: "analyze-patterns",
      patterns: [],
      message: "No errors recorded yet. Use record-error to start tracking.",
    };
  }

  const categoryCount = {};
  for (const err of history.errors) {
    const cat = err.category || "unknown";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  const keywordFreq = {};
  for (const err of history.errors) {
    for (const kw of err.keywords || []) {
      keywordFreq[kw] = (keywordFreq[kw] || 0) + 1;
    }
  }

  const recurring = findRecurringErrors(history.errors);
  const timeAnalysis = analyzeTimeline(history.errors);

  const patterns = [];

  const sortedCategories = Object.entries(categoryCount).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [cat, count] of sortedCategories) {
    if (count >= 2) {
      patterns.push({
        type: "category-concentration",
        category: cat,
        count,
        percentage: Math.round((count / history.errors.length) * 100),
      });
    }
  }

  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topKeywords.length > 0) {
    patterns.push({
      type: "frequent-keywords",
      keywords: topKeywords.map(([kw, count]) => ({ keyword: kw, count })),
    });
  }

  for (const group of recurring) {
    patterns.push({
      type: "recurring-error",
      description: group.representative,
      occurrences: group.count,
      errors: group.ids,
    });
  }

  if (timeAnalysis.peakHour !== null) {
    patterns.push({
      type: "time-pattern",
      peakHour: timeAnalysis.peakHour,
      peakDay: timeAnalysis.peakDay,
    });
  }

  history.stats.patternsDetected = patterns.length;
  history.stats.lastAnalysis = new Date().toISOString();
  saveHistory();

  return {
    success: true,
    action: "analyze-patterns",
    patterns,
    summary: {
      totalErrors: history.errors.length,
      totalCorrections: history.corrections.length,
      categories: sortedCategories.length,
      recurringGroups: recurring.length,
    },
    message: `Found ${patterns.length} pattern(s) from ${history.errors.length} recorded error(s).`,
  };
}

function handleSuggestImprovements() {
  loadHistory();

  if (history.errors.length === 0) {
    return {
      success: true,
      action: "suggest-improvements",
      suggestions: [],
      message: "No errors recorded yet.",
    };
  }

  const suggestions = [];
  const categoryCount = {};
  for (const err of history.errors) {
    const cat = err.category || "unknown";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  const topCategory = Object.entries(categoryCount).sort(
    (a, b) => b[1] - a[1],
  )[0];
  if (topCategory) {
    const categoryAdvice = {
      "type-error":
        "Add type checking or use TypeScript strict mode. Consider null/undefined guards.",
      "reference-error":
        "Check variable scoping and ensure imports/requires are correct.",
      "syntax-error":
        "Use a linter (ESLint) and enable format-on-save in your editor.",
      "network-error":
        "Add retry logic, timeouts, and fallback handling for network calls.",
      "permission-error":
        "Implement proper permission checks and user-friendly error messages.",
      "database-error":
        "Add input validation, use parameterized queries, check connection pooling.",
      "logic-error":
        "Increase unit test coverage, especially edge cases and boundary conditions.",
      "async-error":
        "Ensure all promises are awaited, add try/catch to async functions.",
      unknown:
        "Review the error descriptions and add more specific categorization.",
    };

    suggestions.push({
      priority: "high",
      area: topCategory[0],
      count: topCategory[1],
      suggestion: categoryAdvice[topCategory[0]] || categoryAdvice.unknown,
    });
  }

  const corrections = history.corrections || [];
  if (corrections.length > 0) {
    const fixPatterns = {};
    for (const c of corrections) {
      const fixLower = (c.correction || "").toLowerCase();
      if (
        fixLower.includes("null check") ||
        fixLower.includes("optional chaining") ||
        fixLower.includes("undefined")
      ) {
        fixPatterns["null-safety"] = (fixPatterns["null-safety"] || 0) + 1;
      }
      if (
        fixLower.includes("try") ||
        fixLower.includes("catch") ||
        fixLower.includes("error handling")
      ) {
        fixPatterns["error-handling"] =
          (fixPatterns["error-handling"] || 0) + 1;
      }
      if (
        fixLower.includes("import") ||
        fixLower.includes("require") ||
        fixLower.includes("dependency")
      ) {
        fixPatterns["dependencies"] = (fixPatterns["dependencies"] || 0) + 1;
      }
      if (
        fixLower.includes("async") ||
        fixLower.includes("await") ||
        fixLower.includes("promise")
      ) {
        fixPatterns["async-handling"] =
          (fixPatterns["async-handling"] || 0) + 1;
      }
    }

    for (const [pattern, count] of Object.entries(fixPatterns)) {
      if (count >= 2) {
        suggestions.push({
          priority: "medium",
          area: pattern,
          count,
          suggestion: `You've applied "${pattern}" fixes ${count} times. Consider adding a project-wide linting rule or utility function to prevent these.`,
        });
      }
    }
  }

  const recurring = findRecurringErrors(history.errors);
  for (const group of recurring) {
    if (group.count >= 3) {
      suggestions.push({
        priority: "high",
        area: "recurring-error",
        count: group.count,
        suggestion: `Error "${group.representative}" has occurred ${group.count} times. Create an automated check or test to prevent recurrence.`,
      });
    }
  }

  if (
    history.errors.length >= 20 &&
    corrections.length < history.errors.length * 0.5
  ) {
    suggestions.push({
      priority: "low",
      area: "correction-coverage",
      suggestion: `Only ${corrections.length} of ${history.errors.length} errors have recorded corrections. Record fixes to build better improvement patterns.`,
    });
  }

  return {
    success: true,
    action: "suggest-improvements",
    suggestions,
    result: suggestions,
    message: `Generated ${suggestions.length} improvement suggestion(s).`,
  };
}

function handleShowHistory(limit) {
  loadHistory();
  const entries = history.errors.slice(-limit).reverse();
  return {
    success: true,
    action: "show-history",
    entries,
    stats: history.stats,
    result: { entries, stats: history.stats },
    message: `Showing ${entries.length} of ${history.errors.length} total entries.`,
  };
}

function handleClearHistory() {
  history = {
    errors: [],
    corrections: [],
    stats: { totalRecorded: 0, patternsDetected: 0, lastAnalysis: null },
  };
  saveHistory();
  return {
    success: true,
    action: "clear-history",
    result: { cleared: true },
    message: "All history cleared.",
  };
}

// ── Helpers ───────────────────────────────────────

function categorizeError(desc) {
  const lower = (desc || "").toLowerCase();
  if (
    lower.includes("typeerror") ||
    lower.includes("type error") ||
    lower.includes("cannot read property") ||
    lower.includes("is not a function")
  ) {
    return "type-error";
  }
  if (
    lower.includes("referenceerror") ||
    lower.includes("is not defined") ||
    lower.includes("reference error")
  ) {
    return "reference-error";
  }
  if (
    lower.includes("syntaxerror") ||
    lower.includes("syntax error") ||
    lower.includes("unexpected token")
  ) {
    return "syntax-error";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused")
  ) {
    return "network-error";
  }
  if (
    lower.includes("permission") ||
    lower.includes("eacces") ||
    lower.includes("forbidden") ||
    lower.includes("unauthorized")
  ) {
    return "permission-error";
  }
  if (
    lower.includes("database") ||
    lower.includes("sqlite") ||
    lower.includes("query") ||
    lower.includes("sql")
  ) {
    return "database-error";
  }
  if (
    lower.includes("async") ||
    lower.includes("promise") ||
    lower.includes("unhandled rejection") ||
    lower.includes("await")
  ) {
    return "async-error";
  }
  if (
    lower.includes("null") ||
    lower.includes("undefined") ||
    lower.includes("nan")
  ) {
    return "type-error";
  }
  return "logic-error";
}

function extractKeywords(text) {
  const STOP = new Set([
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "have",
    "are",
    "was",
    "not",
    "but",
    "been",
    "can",
    "will",
  ]);
  return (text || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 15);
}

function findRecurringErrors(errors) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < errors.length; i++) {
    if (used.has(i)) {
      continue;
    }
    const group = {
      representative: errors[i].error,
      count: 1,
      ids: [errors[i].id],
    };

    for (let j = i + 1; j < errors.length; j++) {
      if (used.has(j)) {
        continue;
      }
      if (similarity(errors[i].error, errors[j].error) > 0.6) {
        group.count++;
        group.ids.push(errors[j].id);
        used.add(j);
      }
    }

    if (group.count >= 2) {
      groups.push(group);
    }
    used.add(i);
  }

  return groups.sort((a, b) => b.count - a.count);
}

function similarity(a, b) {
  if (!a || !b) {
    return 0;
  }
  const setA = new Set(a.toLowerCase().split(/\W+/));
  const setB = new Set(b.toLowerCase().split(/\W+/));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function analyzeTimeline(errors) {
  const hourCounts = new Array(24).fill(0);
  const dayCounts = new Array(7).fill(0);

  for (const err of errors) {
    try {
      const date = new Date(err.timestamp);
      hourCounts[date.getHours()]++;
      dayCounts[date.getDay()]++;
    } catch (_e) {
      // Skip invalid timestamps
    }
  }

  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const peakDay = dayCounts.indexOf(Math.max(...dayCounts));
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  return { peakHour, peakDay: dayNames[peakDay] };
}

// ── Main Parser ───────────────────────────────────

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "show-history", limit: 20 };
  }
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "show-history").toLowerCase();

  const limitMatch = trimmed.match(/--limit\s+(\d+)/);
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : 20;

  // Parse description, trigger, solution, verification from input
  let errorDesc = "";
  let fix = "";
  let trigger = "";
  let solution = "";
  let verification = "";
  let name = "";
  let description = "";

  if (action === "record-error") {
    const fixIdx = trimmed.toLowerCase().indexOf("fix:");
    if (fixIdx !== -1) {
      errorDesc = trimmed
        .substring(parts[0].length, fixIdx)
        .trim()
        .replace(/^["']|["']$/g, "");
      fix = trimmed
        .substring(fixIdx + 4)
        .trim()
        .replace(/^["']|["']$/g, "");
    } else {
      errorDesc = parts
        .slice(1)
        .join(" ")
        .replace(/^["']|["']$/g, "");
    }
  }

  if (action === "capture-instinct") {
    const rest = trimmed.substring(parts[0].length).trim();
    const trigIdx = rest.toLowerCase().indexOf("trigger:");
    const solIdx = rest.toLowerCase().indexOf("solution:");

    if (trigIdx !== -1 && solIdx !== -1) {
      description = rest.substring(0, trigIdx).trim();
      trigger = rest.substring(trigIdx + 8, solIdx).trim();
      solution = rest.substring(solIdx + 9).trim();
    } else if (trigIdx !== -1) {
      description = rest.substring(0, trigIdx).trim();
      trigger = rest.substring(trigIdx + 8).trim();
    } else {
      description = rest;
    }
  }

  if (action === "verify-instinct") {
    const id = parts[1] || "";
    const successStr = parts[2] || "true";
    return {
      action,
      instinctId: id,
      verifySuccess: successStr.toLowerCase() !== "false",
      limit,
    };
  }

  if (action === "extract-skill") {
    const rest = trimmed.substring(parts[0].length).trim();
    const descIdx = rest.toLowerCase().indexOf("desc:");
    const trigIdx = rest.toLowerCase().indexOf("trigger:");
    const solIdx = rest.toLowerCase().indexOf("solution:");
    const verIdx = rest.toLowerCase().indexOf("verify:");

    if (descIdx !== -1) {
      name = rest.substring(0, descIdx).trim();
      const descEnd =
        trigIdx !== -1
          ? trigIdx
          : solIdx !== -1
            ? solIdx
            : verIdx !== -1
              ? verIdx
              : rest.length;
      description = rest.substring(descIdx + 5, descEnd).trim();
    } else {
      name = parts[1] || "";
      description = parts.slice(2).join(" ");
    }

    if (trigIdx !== -1) {
      const trigEnd =
        solIdx !== -1 ? solIdx : verIdx !== -1 ? verIdx : rest.length;
      trigger = rest.substring(trigIdx + 8, trigEnd).trim();
    }
    if (solIdx !== -1) {
      const solEnd = verIdx !== -1 ? verIdx : rest.length;
      solution = rest.substring(solIdx + 9, solEnd).trim();
    }
    if (verIdx !== -1) {
      verification = rest.substring(verIdx + 7).trim();
    }
  }

  const confMatch = trimmed.match(/--confidence\s+([\d.]+)/);
  const minConfidence = confMatch ? parseFloat(confMatch[1]) : 0;

  return {
    action,
    errorDesc,
    fix,
    limit,
    trigger,
    solution,
    verification,
    name,
    description,
    instinctId: "",
    verifySuccess: true,
    minConfidence,
  };
}

// ── Module Exports ────────────────────────────────

module.exports = {
  _deps,
  _resetState,

  async init(skill) {
    loadHistory();
    loadLearnings();
    logger.info(
      "[SelfImprove] Initialized (v2.0) with %d errors, %d instincts, %d skills",
      history.errors.length,
      learnings.instincts.length,
      learnings.skills.length,
    );
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "record-error":
          return handleRecordError(parsed.errorDesc, parsed.fix);
        case "analyze-patterns":
          return handleAnalyzePatterns();
        case "suggest-improvements":
          return handleSuggestImprovements();
        case "show-history":
          return handleShowHistory(parsed.limit);
        case "clear-history":
          return handleClearHistory();
        // New v2.0 actions
        case "capture-instinct":
          return handleCaptureInstinct(
            parsed.description,
            parsed.trigger,
            parsed.solution,
          );
        case "verify-instinct":
          return handleVerifyInstinct(parsed.instinctId, parsed.verifySuccess);
        case "list-instincts":
          return handleListInstincts(parsed.minConfidence);
        case "extract-skill":
          return handleExtractSkill(
            parsed.name,
            parsed.description,
            parsed.trigger,
            parsed.solution,
            parsed.verification,
          );
        case "list-skills":
          return handleListSkills();
        case "export":
          return handleExportLearnings();
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}.\n\nActions:\n- record-error, analyze-patterns, suggest-improvements, show-history, clear-history\n- capture-instinct, verify-instinct, list-instincts\n- extract-skill, list-skills\n- export`,
          };
      }
    } catch (error) {
      logger.error("[SelfImprove] Error:", error);
      return { success: false, error: error.message };
    }
  },
};
