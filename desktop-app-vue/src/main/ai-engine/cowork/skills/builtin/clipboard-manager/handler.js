/**
 * Clipboard Manager Skill Handler
 *
 * Clipboard operations with history tracking, search, pinning,
 * and sensitive content filtering. Electron clipboard with platform fallbacks.
 * Actions: --read, --write, --history, --search, --pin, --unpin, --pins, --clear
 */

const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

const history = []; // Array of { text, timestamp, pinned }
const MAX_HISTORY = 100;

const SENSITIVE_PATTERNS = [
  { name: "API Key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i },
  { name: "Password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i },
  { name: "Token", pattern: /(?:token|secret)\s*[:=]\s*\S+/i },
  {
    name: "Credit Card",
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  },
];

function readClipboard() {
  try {
    return require("electron").clipboard.readText();
  } catch (_e) {
    /* fallback below */
  }
  const p = process.platform;
  try {
    const cmd =
      p === "win32"
        ? "powershell -command Get-Clipboard"
        : p === "darwin"
          ? "pbpaste"
          : "xclip -selection clipboard -o";
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
  } catch (err) {
    throw new Error("Failed to read clipboard: " + err.message);
  }
}

function writeClipboard(text) {
  try {
    require("electron").clipboard.writeText(text);
    return;
  } catch (_e) {
    /* fallback */
  }
  const p = process.platform;
  try {
    const cmd =
      p === "win32"
        ? "clip"
        : p === "darwin"
          ? "pbcopy"
          : "xclip -selection clipboard";
    execSync(cmd, { input: text, encoding: "utf-8", timeout: 5000 });
  } catch (err) {
    throw new Error("Failed to write clipboard: " + err.message);
  }
}

function addToHistory(text) {
  if (!text || (history.length > 0 && history[0].text === text)) {
    return;
  }
  history.unshift({ text, timestamp: new Date().toISOString(), pinned: false });
  while (history.length > MAX_HISTORY) {
    const idx = history.findLastIndex((e) => !e.pinned);
    if (idx === -1) {
      break;
    }
    history.splice(idx, 1);
  }
}

function trunc(text, n) {
  return !text ? "" : text.length <= n ? text : text.substring(0, n) + "...";
}

function detectSensitive(text) {
  return SENSITIVE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    (p) => p.name,
  );
}

function fmtEntry(e, i) {
  const pin = e.pinned ? " [pinned]" : "";
  const ts = e.timestamp.replace("T", " ").substring(0, 19);
  return "[" + i + "] " + trunc(e.text, 50) + pin + " (" + ts + ")";
}

function validIndex(input, flag) {
  const m = input.match(new RegExp("--" + flag + "\\s+(\\d+)", "i"));
  if (!m) {
    return {
      error: "No index provided",
      message: "Usage: /clipboard-manager --" + flag + " <index>",
    };
  }
  const idx = parseInt(m[1], 10) - 1;
  if (idx < 0 || idx >= history.length) {
    return {
      error: "Index out of range",
      message:
        "Index " + (idx + 1) + " out of range (1-" + history.length + ").",
    };
  }
  return { idx };
}

function handleRead() {
  const text = readClipboard();
  addToHistory(text);
  const warnings = detectSensitive(text);
  const result = { text, length: text.length, type: "text" };
  let msg =
    "Clipboard Content\n" +
    "=".repeat(30) +
    "\nType: text | Length: " +
    text.length +
    " chars\n";
  if (warnings.length > 0) {
    result.sensitiveWarnings = warnings;
    msg +=
      "WARNING: Possible sensitive content detected: " +
      warnings.join(", ") +
      "\n";
  }
  msg += "\n" + trunc(text, 500);
  return { success: true, result, message: msg };
}

function handleWrite(input) {
  const m = input.match(/--write\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (!m) {
    return {
      success: false,
      error: "No text provided",
      message: 'Usage: /clipboard-manager --write "text"',
    };
  }
  const text = m[1] || m[2] || m[3];
  writeClipboard(text);
  addToHistory(text);
  return {
    success: true,
    result: { written: true, text, length: text.length },
    message: "Written to clipboard: '" + trunc(text, 100) + "'",
  };
}

function handleHistory(input) {
  const lm = input.match(/--limit\s+(\d+)/i);
  const limit = lm ? Math.min(parseInt(lm[1], 10), MAX_HISTORY) : 20;
  const entries = history.slice(0, limit);
  if (entries.length === 0) {
    return {
      success: true,
      result: { entries: [], total: 0 },
      message: "Clipboard history is empty.",
    };
  }
  let msg =
    "Clipboard History\n" +
    "=".repeat(30) +
    "\nShowing " +
    entries.length +
    " of " +
    history.length +
    " entries\n\n";
  entries.forEach((e, i) => {
    msg += fmtEntry(e, i + 1) + "\n";
  });
  return {
    success: true,
    result: {
      entries: entries.map((e, i) => ({
        index: i + 1,
        text: trunc(e.text, 200),
        timestamp: e.timestamp,
        pinned: e.pinned,
      })),
      total: history.length,
      showing: entries.length,
    },
    message: msg,
  };
}

function handleSearch(input) {
  const m = input.match(/--search\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (!m) {
    return {
      success: false,
      error: "No search query provided",
      message: 'Usage: /clipboard-manager --search "query"',
    };
  }
  const query = (m[1] || m[2] || m[3]).toLowerCase();
  const matches = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].text.toLowerCase().includes(query)) {
      matches.push({ index: i + 1, ...history[i] });
    }
  }
  let msg =
    "Search Results\n" +
    "=".repeat(30) +
    "\nQuery: '" +
    query +
    "' | Found: " +
    matches.length +
    " entries\n\n";
  matches.slice(0, 20).forEach((e) => {
    msg +=
      "[" +
      e.index +
      "] " +
      trunc(e.text, 50) +
      (e.pinned ? " [pinned]" : "") +
      "\n";
  });
  if (matches.length > 20) {
    msg += "... and " + (matches.length - 20) + " more\n";
  }
  return {
    success: true,
    result: {
      query,
      matches: matches
        .slice(0, 50)
        .map((e) => ({
          index: e.index,
          text: trunc(e.text, 200),
          timestamp: e.timestamp,
          pinned: e.pinned,
        })),
      matchCount: matches.length,
    },
    message: msg,
  };
}

function handlePin(input) {
  const v = validIndex(input, "pin");
  if (v.error) {
    return { success: false, ...v };
  }
  history[v.idx].pinned = true;
  return {
    success: true,
    result: {
      index: v.idx + 1,
      text: trunc(history[v.idx].text, 200),
      pinned: true,
    },
    message:
      "Pinned entry #" +
      (v.idx + 1) +
      ": '" +
      trunc(history[v.idx].text, 50) +
      "'",
  };
}

function handleUnpin(input) {
  const v = validIndex(input, "unpin");
  if (v.error) {
    return { success: false, ...v };
  }
  history[v.idx].pinned = false;
  return {
    success: true,
    result: {
      index: v.idx + 1,
      text: trunc(history[v.idx].text, 200),
      pinned: false,
    },
    message:
      "Unpinned entry #" +
      (v.idx + 1) +
      ": '" +
      trunc(history[v.idx].text, 50) +
      "'",
  };
}

function handlePins() {
  const pinned = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].pinned) {
      pinned.push({ index: i + 1, ...history[i] });
    }
  }
  if (pinned.length === 0) {
    return {
      success: true,
      result: { pinned: [], count: 0 },
      message: "No pinned entries.",
    };
  }
  let msg =
    "Pinned Entries\n" +
    "=".repeat(30) +
    "\n" +
    pinned.length +
    " pinned entries\n\n";
  pinned.forEach((p) => {
    msg += "[" + p.index + "] " + trunc(p.text, 50) + "\n";
  });
  return {
    success: true,
    result: {
      pinned: pinned.map((p) => ({
        index: p.index,
        text: trunc(p.text, 200),
        timestamp: p.timestamp,
      })),
      count: pinned.length,
    },
    message: msg,
  };
}

function handleClear() {
  const pinnedItems = history.filter((e) => e.pinned);
  const removedCount = history.length - pinnedItems.length;
  history.length = 0;
  history.push(...pinnedItems);
  return {
    success: true,
    result: { removed: removedCount, remaining: history.length },
    message:
      "Cleared " +
      removedCount +
      " entries." +
      (pinnedItems.length > 0
        ? " Kept " + pinnedItems.length + " pinned entries."
        : ""),
  };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[clipboard-manager] init: " + (_skill?.name || "clipboard-manager"),
    );
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

    logger.info("[clipboard-manager] execute: " + trunc(input, 80), {
      projectRoot,
    });

    try {
      if (/--write\b/i.test(input)) {
        return handleWrite(input);
      }
      if (/--history\b/i.test(input)) {
        return handleHistory(input);
      }
      if (/--search\b/i.test(input)) {
        return handleSearch(input);
      }
      if (/--unpin\b/i.test(input)) {
        return handleUnpin(input);
      }
      if (/--pin\b/i.test(input)) {
        return handlePin(input);
      }
      if (/--pins\b/i.test(input)) {
        return handlePins();
      }
      if (/--clear\b/i.test(input)) {
        return handleClear();
      }
      if (/--read\b/i.test(input) || !input) {
        return handleRead();
      }

      return {
        success: true,
        result: {},
        message:
          "Clipboard Manager\n" +
          "=".repeat(20) +
          "\nUsage:\n" +
          "  /clipboard-manager --read                Read current clipboard\n" +
          '  /clipboard-manager --write "text"         Write to clipboard\n' +
          "  /clipboard-manager --history --limit N    View history\n" +
          '  /clipboard-manager --search "query"       Search history\n' +
          "  /clipboard-manager --pin <index>          Pin entry\n" +
          "  /clipboard-manager --unpin <index>        Unpin entry\n" +
          "  /clipboard-manager --pins                 View pinned entries\n" +
          "  /clipboard-manager --clear                Clear history (keep pinned)",
      };
    } catch (err) {
      logger.error("[clipboard-manager] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Clipboard operation failed: " + err.message,
      };
    }
  },
};
