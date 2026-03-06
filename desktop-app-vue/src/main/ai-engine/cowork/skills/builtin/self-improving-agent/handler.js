/**
 * Self-Improving Agent Skill Handler
 *
 * Tracks errors, corrections, and patterns to enable continuous improvement.
 * Persists data to {userData}/.chainlesschain/self-improving/history.json.
 */

const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");

const _deps = { fs, path };

let dataDir = null;
let historyPath = null;
let history = { errors: [], corrections: [], stats: { totalRecorded: 0, patternsDetected: 0, lastAnalysis: null } };

function _resetState() {
  dataDir = null;
  historyPath = null;
  history = { errors: [], corrections: [], stats: { totalRecorded: 0, patternsDetected: 0, lastAnalysis: null } };
}

function getDataDir() {
  if (dataDir) return dataDir;
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
    _deps.fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");
  } catch (err) {
    logger.error("[SelfImprove] Failed to save history:", err.message);
  }
}

module.exports = {
  _deps,
  _resetState,
  async init(skill) {
    loadHistory();
    logger.info("[SelfImprove] Initialized with %d recorded entries", history.errors.length);
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
        default:
          return { success: false, error: `Unknown action: ${parsed.action}. Use: record-error, analyze-patterns, suggest-improvements, show-history, clear-history` };
      }
    } catch (error) {
      logger.error("[SelfImprove] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "show-history", limit: 20 };
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "show-history").toLowerCase();

  const limitMatch = trimmed.match(/--limit\s+(\d+)/);
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : 20;

  // Parse error description and fix from input
  // Format: record-error "error desc" fix: "correction"
  let errorDesc = "";
  let fix = "";

  if (action === "record-error") {
    const fixIdx = trimmed.toLowerCase().indexOf("fix:");
    if (fixIdx !== -1) {
      errorDesc = trimmed.substring(parts[0].length, fixIdx).trim().replace(/^["']|["']$/g, "");
      fix = trimmed.substring(fixIdx + 4).trim().replace(/^["']|["']$/g, "");
    } else {
      errorDesc = parts.slice(1).join(" ").replace(/^["']|["']$/g, "");
    }
  }

  return { action, errorDesc, fix, limit };
}

function handleRecordError(errorDesc, fix) {
  if (!errorDesc) {
    return { success: false, action: "record-error", error: "Please provide an error description. Usage: record-error <description> fix: <correction>" };
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

  return {
    success: true,
    action: "record-error",
    entry,
    result: { recorded: true, totalEntries: history.errors.length },
    message: `Recorded error "${errorDesc.substring(0, 60)}${errorDesc.length > 60 ? "..." : ""}" with ${fix ? "correction" : "no correction"}.`,
  };
}

function handleAnalyzePatterns() {
  loadHistory();

  if (history.errors.length === 0) {
    return { success: true, action: "analyze-patterns", patterns: [], message: "No errors recorded yet. Use record-error to start tracking." };
  }

  // Analyze by category
  const categoryCount = {};
  for (const err of history.errors) {
    const cat = err.category || "unknown";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  // Analyze by keyword frequency
  const keywordFreq = {};
  for (const err of history.errors) {
    for (const kw of (err.keywords || [])) {
      keywordFreq[kw] = (keywordFreq[kw] || 0) + 1;
    }
  }

  // Find recurring errors (similar descriptions)
  const recurring = findRecurringErrors(history.errors);

  // Time-based analysis
  const timeAnalysis = analyzeTimeline(history.errors);

  const patterns = [];

  // Category patterns
  const sortedCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCategories) {
    if (count >= 2) {
      patterns.push({ type: "category-concentration", category: cat, count, percentage: Math.round((count / history.errors.length) * 100) });
    }
  }

  // Keyword patterns
  const topKeywords = Object.entries(keywordFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topKeywords.length > 0) {
    patterns.push({ type: "frequent-keywords", keywords: topKeywords.map(([kw, count]) => ({ keyword: kw, count })) });
  }

  // Recurring patterns
  for (const group of recurring) {
    patterns.push({ type: "recurring-error", description: group.representative, occurrences: group.count, errors: group.ids });
  }

  // Time patterns
  if (timeAnalysis.peakHour !== null) {
    patterns.push({ type: "time-pattern", peakHour: timeAnalysis.peakHour, peakDay: timeAnalysis.peakDay });
  }

  history.stats.patternsDetected = patterns.length;
  history.stats.lastAnalysis = new Date().toISOString();
  saveHistory();

  return {
    success: true,
    action: "analyze-patterns",
    patterns,
    summary: { totalErrors: history.errors.length, totalCorrections: history.corrections.length, categories: sortedCategories.length, recurringGroups: recurring.length },
    message: `Found ${patterns.length} pattern(s) from ${history.errors.length} recorded error(s).`,
  };
}

function handleSuggestImprovements() {
  loadHistory();

  if (history.errors.length === 0) {
    return { success: true, action: "suggest-improvements", suggestions: [], message: "No errors recorded yet. Record some errors first to get suggestions." };
  }

  const suggestions = [];

  // Category-based suggestions
  const categoryCount = {};
  for (const err of history.errors) {
    const cat = err.category || "unknown";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  const topCategory = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0];
  if (topCategory) {
    const categoryAdvice = {
      "type-error": "Add type checking or use TypeScript strict mode. Consider null/undefined guards.",
      "reference-error": "Check variable scoping and ensure imports/requires are correct.",
      "syntax-error": "Use a linter (ESLint) and enable format-on-save in your editor.",
      "network-error": "Add retry logic, timeouts, and fallback handling for network calls.",
      "permission-error": "Implement proper permission checks and user-friendly error messages.",
      "database-error": "Add input validation, use parameterized queries, check connection pooling.",
      "logic-error": "Increase unit test coverage, especially edge cases and boundary conditions.",
      "async-error": "Ensure all promises are awaited, add try/catch to async functions.",
      unknown: "Review the error descriptions and add more specific categorization.",
    };

    suggestions.push({
      priority: "high",
      area: topCategory[0],
      count: topCategory[1],
      suggestion: categoryAdvice[topCategory[0]] || categoryAdvice.unknown,
    });
  }

  // Correction-based suggestions
  const corrections = history.corrections || [];
  if (corrections.length > 0) {
    const fixPatterns = {};
    for (const c of corrections) {
      const fixLower = (c.correction || "").toLowerCase();
      if (fixLower.includes("null check") || fixLower.includes("optional chaining") || fixLower.includes("undefined")) {
        fixPatterns["null-safety"] = (fixPatterns["null-safety"] || 0) + 1;
      }
      if (fixLower.includes("try") || fixLower.includes("catch") || fixLower.includes("error handling")) {
        fixPatterns["error-handling"] = (fixPatterns["error-handling"] || 0) + 1;
      }
      if (fixLower.includes("import") || fixLower.includes("require") || fixLower.includes("dependency")) {
        fixPatterns["dependencies"] = (fixPatterns["dependencies"] || 0) + 1;
      }
      if (fixLower.includes("async") || fixLower.includes("await") || fixLower.includes("promise")) {
        fixPatterns["async-handling"] = (fixPatterns["async-handling"] || 0) + 1;
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

  // Recurrence-based suggestions
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

  // General suggestions based on volume
  if (history.errors.length >= 20 && corrections.length < history.errors.length * 0.5) {
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
    message: `Generated ${suggestions.length} improvement suggestion(s) based on ${history.errors.length} recorded error(s).`,
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
  history = { errors: [], corrections: [], stats: { totalRecorded: 0, patternsDetected: 0, lastAnalysis: null } };
  saveHistory();

  return {
    success: true,
    action: "clear-history",
    result: { cleared: true },
    message: "All history cleared.",
  };
}

function categorizeError(desc) {
  const lower = (desc || "").toLowerCase();
  if (lower.includes("typeerror") || lower.includes("type error") || lower.includes("cannot read property") || lower.includes("is not a function")) return "type-error";
  if (lower.includes("referenceerror") || lower.includes("is not defined") || lower.includes("reference error")) return "reference-error";
  if (lower.includes("syntaxerror") || lower.includes("syntax error") || lower.includes("unexpected token")) return "syntax-error";
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("timeout") || lower.includes("econnrefused")) return "network-error";
  if (lower.includes("permission") || lower.includes("eacces") || lower.includes("forbidden") || lower.includes("unauthorized")) return "permission-error";
  if (lower.includes("database") || lower.includes("sqlite") || lower.includes("query") || lower.includes("sql")) return "database-error";
  if (lower.includes("async") || lower.includes("promise") || lower.includes("unhandled rejection") || lower.includes("await")) return "async-error";
  if (lower.includes("null") || lower.includes("undefined") || lower.includes("nan")) return "type-error";
  return "logic-error";
}

function extractKeywords(text) {
  const STOP = new Set(["the", "and", "for", "that", "this", "with", "from", "have", "are", "was", "not", "but", "been", "can", "will"]);
  return (text || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 15);
}

function findRecurringErrors(errors) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < errors.length; i++) {
    if (used.has(i)) continue;
    const group = { representative: errors[i].error, count: 1, ids: [errors[i].id] };

    for (let j = i + 1; j < errors.length; j++) {
      if (used.has(j)) continue;
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
  if (!a || !b) return 0;
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
      // Skip entries with invalid timestamps
    }
  }

  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const peakDay = dayCounts.indexOf(Math.max(...dayCounts));
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return { peakHour, peakDay: dayNames[peakDay] };
}
