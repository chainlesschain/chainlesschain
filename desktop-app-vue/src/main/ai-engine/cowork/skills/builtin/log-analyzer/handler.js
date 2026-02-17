/**
 * Log Analyzer Skill Handler
 *
 * Parses, filters, and analyzes log files. Auto-detects common formats
 * (JSON, Apache, nginx, syslog, generic timestamped).
 * Modes: --analyze, --errors, --filter, --stats, --search, --tail
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Constants ───────────────────────────────────────────────────────

const LOG_LEVELS = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "WARNING",
  "ERROR",
  "FATAL",
  "CRITICAL",
];
const LEVEL_REGEX = new RegExp(`\\b(${LOG_LEVELS.join("|")})\\b`, "i");
const TIMESTAMP_REGEX = /\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}/;
const JSON_LOG_REGEX = /^\s*\{.*"level".*\}/;
const MAX_LINES = 100000;

function categorizeLevel(level) {
  if (!level) {
    return "UNKNOWN";
  }
  const u = level.toUpperCase();
  if (u === "WARNING") {
    return "WARN";
  }
  if (u === "CRITICAL") {
    return "FATAL";
  }
  return LOG_LEVELS.includes(u) ? u : "UNKNOWN";
}

// ── Line parsing ────────────────────────────────────────────────────

function parseLine(line) {
  if (!line || !line.trim()) {
    return null;
  }
  if (JSON_LOG_REGEX.test(line)) {
    try {
      const o = JSON.parse(line.trim());
      return {
        timestamp: o.timestamp || o.time || o["@timestamp"] || null,
        level: categorizeLevel(o.level || o.severity || ""),
        message: o.message || o.msg || o.text || line.trim(),
        raw: line,
      };
    } catch (_e) {
      /* fall through */
    }
  }
  const tsMatch = line.match(TIMESTAMP_REGEX);
  const lvlMatch = line.match(LEVEL_REGEX);
  let message = line;
  if (lvlMatch) {
    message =
      line
        .substring(lvlMatch.index + lvlMatch[0].length)
        .replace(/^[\s:\-\]]+/, "")
        .trim() || line;
  } else if (tsMatch) {
    message =
      line
        .substring(tsMatch.index + tsMatch[0].length)
        .replace(/^[\s:\-\]]+/, "")
        .trim() || line;
  }
  return {
    timestamp: tsMatch ? tsMatch[0] : null,
    level: lvlMatch ? categorizeLevel(lvlMatch[1]) : "UNKNOWN",
    message,
    raw: line,
  };
}

// ── Format detection ────────────────────────────────────────────────

function detectFormat(lines) {
  const sample = lines.slice(0, 50).filter((l) => l.trim());
  let json = 0,
    apache = 0,
    syslog = 0,
    ts = 0;
  const apacheRe =
    /^\S+\s+\S+\s+\S+\s+\[[\d/\w:+ ]+\]\s+"[A-Z]+\s+\S+\s+HTTP\//;
  const syslogRe = /^[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\S+/;
  for (const l of sample) {
    if (JSON_LOG_REGEX.test(l)) {
      json++;
    }
    if (apacheRe.test(l)) {
      apache++;
    }
    if (syslogRe.test(l)) {
      syslog++;
    }
    if (TIMESTAMP_REGEX.test(l)) {
      ts++;
    }
  }
  const t = sample.length || 1;
  if (json / t > 0.5) {
    return "json";
  }
  if (apache / t > 0.5) {
    return "apache";
  }
  if (syslog / t > 0.5) {
    return "syslog";
  }
  if (ts / t > 0.5) {
    return "timestamped";
  }
  return "generic";
}

// ── Helpers ─────────────────────────────────────────────────────────

function readLogFile(filePath) {
  const allLines = fs.readFileSync(filePath, "utf-8").split("\n");
  const truncated = allLines.length > MAX_LINES;
  return {
    lines: truncated ? allLines.slice(0, MAX_LINES) : allLines,
    truncated,
    totalLines: allLines.length,
  };
}

function resolveLogPath(input, projectRoot) {
  const parts = input.split(/\s+/);
  let skip = false;
  for (const p of parts) {
    if (skip) {
      skip = false;
      continue;
    }
    if (/^--(level|after|before|contains|pattern|lines|format)$/i.test(p)) {
      skip = true;
      continue;
    }
    if (p.startsWith("--")) {
      continue;
    }
    if (p) {
      return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
    }
  }
  return null;
}

function fmtEntry(e) {
  return (
    "  L" +
    e.lineNumber +
    (e.timestamp ? " [" + e.timestamp + "]" : "") +
    " " +
    e.level +
    ": " +
    e.message.substring(0, 80)
  );
}

// ── Actions ─────────────────────────────────────────────────────────

function analyzeLog(lines, totalLines, truncated) {
  const fmt = detectFormat(lines);
  const lvlC = {},
    hrC = {},
    errM = {};
  let firstTs = null,
    lastTs = null;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) {
      continue;
    }
    lvlC[p.level] = (lvlC[p.level] || 0) + 1;
    if (p.timestamp) {
      if (!firstTs) {
        firstTs = p.timestamp;
      }
      lastTs = p.timestamp;
      const hm = p.timestamp.match(/(\d{2}):\d{2}:\d{2}/);
      if (hm) {
        hrC[hm[1] + ":00"] = (hrC[hm[1] + ":00"] || 0) + 1;
      }
    }
    if (p.level === "ERROR" || p.level === "FATAL") {
      const k = p.message.substring(0, 80).trim();
      if (k) {
        errM[k] = (errM[k] || 0) + 1;
      }
    }
  }
  const busiestHours = Object.entries(hrC)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([h, c]) => ({ hour: h, count: c }));
  const topErrors = Object.entries(errM)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([m, c]) => ({ message: m, count: c }));
  return {
    totalLines,
    analyzedLines: lines.length,
    truncated,
    format: fmt,
    levelDistribution: lvlC,
    timeRange: { from: firstTs, to: lastTs },
    busiestHours,
    topErrors,
  };
}

function extractErrors(lines) {
  const errors = [],
    groups = {};
  for (let i = 0; i < lines.length; i++) {
    const p = parseLine(lines[i]);
    if (!p || (p.level !== "ERROR" && p.level !== "FATAL")) {
      continue;
    }
    errors.push({
      lineNumber: i + 1,
      timestamp: p.timestamp,
      level: p.level,
      message: p.message,
    });
    const pat = p.message
      .replace(/\d+/g, "N")
      .replace(/0x[0-9a-fA-F]+/g, "0xN")
      .substring(0, 80)
      .trim();
    if (!groups[pat]) {
      groups[pat] = { pattern: pat, count: 0, example: p.message };
    }
    groups[pat].count++;
  }
  return {
    errors,
    totalErrors: errors.length,
    topPatterns: Object.values(groups)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
  };
}

function filterLines(lines, opts) {
  const results = [];
  const lvl = opts.level ? opts.level.toUpperCase() : null;
  for (let i = 0; i < lines.length; i++) {
    const p = parseLine(lines[i]);
    if (!p) {
      continue;
    }
    if (lvl && p.level !== categorizeLevel(lvl)) {
      continue;
    }
    if (opts.after && p.timestamp && p.timestamp < opts.after) {
      continue;
    }
    if (opts.before && p.timestamp && p.timestamp > opts.before) {
      continue;
    }
    if (opts.contains && !p.raw.includes(opts.contains)) {
      continue;
    }
    results.push({
      lineNumber: i + 1,
      timestamp: p.timestamp,
      level: p.level,
      message: p.message,
    });
  }
  return results;
}

function computeStats(lines, totalLines) {
  const lvlC = {};
  let withTs = 0,
    firstTs = null,
    lastTs = null;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) {
      continue;
    }
    lvlC[p.level] = (lvlC[p.level] || 0) + 1;
    if (p.timestamp) {
      withTs++;
      if (!firstTs) {
        firstTs = p.timestamp;
      }
      lastTs = p.timestamp;
    }
  }
  const ne = lines.filter((l) => l.trim()).length || 1;
  const dist = {};
  for (const [l, c] of Object.entries(lvlC)) {
    dist[l] = { count: c, percentage: Math.round((c / ne) * 1000) / 10 };
  }
  let lpm = null;
  if (firstTs && lastTs && firstTs !== lastTs) {
    const mins =
      (new Date(lastTs.replace("/", "-")).getTime() -
        new Date(firstTs.replace("/", "-")).getTime()) /
      60000;
    if (mins > 0) {
      lpm = Math.round(ne / mins);
    }
  }
  return {
    totalLines,
    nonEmptyLines: ne,
    withTimestamp: withTs,
    distribution: dist,
    timeRange: { from: firstTs, to: lastTs },
    linesPerMinute: lpm,
  };
}

function searchLog(lines, pattern) {
  let re;
  try {
    re = new RegExp(pattern, "i");
  } catch (_e) {
    return { matches: [], error: "Invalid regex: " + pattern };
  }
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      const ctx = [];
      if (i > 0 && lines[i - 1].trim()) {
        ctx.push({ lineNumber: i, text: lines[i - 1] });
      }
      ctx.push({ lineNumber: i + 1, text: lines[i], match: true });
      if (i < lines.length - 1 && lines[i + 1].trim()) {
        ctx.push({ lineNumber: i + 2, text: lines[i + 1] });
      }
      matches.push({ lineNumber: i + 1, line: lines[i], context: ctx });
    }
  }
  return { matches, totalMatches: matches.length };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info("[log-analyzer] init: " + (_skill?.name || "log-analyzer"));
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

    if (!input) {
      return {
        success: true,
        result: {},
        message:
          "Log Analyzer\n" +
          "=".repeat(30) +
          '\nUsage:\n  /log-analyzer --analyze <file>\n  /log-analyzer --errors <file>\n  /log-analyzer --filter <file> --level <level> --after "<time>"\n  /log-analyzer --stats <file>\n  /log-analyzer --search <file> --pattern "<regex>"\n  /log-analyzer --tail <file> --lines N',
      };
    }

    try {
      const logPath = resolveLogPath(input, projectRoot);
      if (!logPath) {
        return {
          success: false,
          error: "No file specified",
          message: "Please specify a log file path.",
        };
      }
      if (!fs.existsSync(logPath)) {
        return {
          success: false,
          error: "File not found",
          message: "Log file not found: " + logPath,
        };
      }

      const { lines, truncated, totalLines } = readLogFile(logPath);
      const fn = path.basename(logPath);

      // --tail
      if (/--tail/i.test(input)) {
        const lm = input.match(/--lines\s+(\d+)/i);
        const n = lm ? Math.min(parseInt(lm[1]), 1000) : 20;
        const all = fs.readFileSync(logPath, "utf-8").split("\n");
        const tail = all.slice(-n);
        return {
          success: true,
          result: { lines: tail, count: tail.length, file: fn },
          message:
            "Tail: " +
            fn +
            " (last " +
            n +
            " lines)\n" +
            "=".repeat(30) +
            "\n" +
            tail.join("\n"),
        };
      }

      // --errors
      if (/--errors/i.test(input)) {
        const { errors, totalErrors, topPatterns } = extractErrors(lines);
        let msg =
          "Error Analysis: " +
          fn +
          "\n" +
          "=".repeat(30) +
          "\n" +
          totalErrors +
          " errors found";
        if (truncated) {
          msg += " (first " + MAX_LINES + " of " + totalLines + " lines)";
        }
        msg += "\n";
        if (topPatterns.length > 0) {
          msg +=
            "\nTop error patterns:\n" +
            topPatterns
              .map(
                (p, i) =>
                  "  " +
                  (i + 1) +
                  ". " +
                  p.example.substring(0, 70) +
                  " (" +
                  p.count +
                  "x)",
              )
              .join("\n");
        }
        if (errors.length > 0) {
          msg +=
            "\n\nRecent errors:\n" + errors.slice(-10).map(fmtEntry).join("\n");
        }
        return {
          success: true,
          result: { totalErrors, topPatterns, recentErrors: errors.slice(-20) },
          message: msg,
        };
      }

      // --filter
      if (/--filter/i.test(input)) {
        const lm = input.match(/--level\s+(\S+)/i),
          am = input.match(/--after\s+"([^"]+)"/i);
        const bm = input.match(/--before\s+"([^"]+)"/i),
          cm = input.match(/--contains\s+"([^"]+)"/i);
        const opts = {
          level: lm?.[1] || null,
          after: am?.[1] || null,
          before: bm?.[1] || null,
          contains: cm?.[1] || null,
        };
        const results = filterLines(lines, opts);
        let msg =
          "Filter Results: " +
          fn +
          "\n" +
          "=".repeat(30) +
          "\n" +
          results.length +
          " entries match criteria\n";
        const fl = [];
        if (opts.level) {
          fl.push("level=" + opts.level);
        }
        if (opts.after) {
          fl.push("after=" + opts.after);
        }
        if (opts.before) {
          fl.push("before=" + opts.before);
        }
        if (opts.contains) {
          fl.push('contains="' + opts.contains + '"');
        }
        if (fl.length) {
          msg += "Filters: " + fl.join(", ") + "\n";
        }
        if (results.length > 0) {
          msg += "\n" + results.slice(0, 30).map(fmtEntry).join("\n");
          if (results.length > 30) {
            msg += "\n  ... and " + (results.length - 30) + " more";
          }
        }
        return {
          success: true,
          result: {
            matches: results.slice(0, 100),
            totalMatches: results.length,
          },
          message: msg,
        };
      }

      // --stats
      if (/--stats/i.test(input)) {
        const s = computeStats(lines, totalLines);
        let msg = "Log Statistics: " + fn + "\n" + "=".repeat(30) + "\n";
        msg +=
          "Total lines: " +
          s.totalLines +
          "\nNon-empty: " +
          s.nonEmptyLines +
          "\nWith timestamp: " +
          s.withTimestamp +
          "\n";
        if (s.timeRange.from) {
          msg +=
            "Time range: " + s.timeRange.from + " -> " + s.timeRange.to + "\n";
        }
        if (s.linesPerMinute !== null) {
          msg += "Avg lines/minute: " + s.linesPerMinute + "\n";
        }
        msg += "\nLevel distribution:\n";
        for (const [l, info] of Object.entries(s.distribution).sort(
          (a, b) => b[1].count - a[1].count,
        )) {
          msg += "  " + l + ": " + info.count + " (" + info.percentage + "%)\n";
        }
        if (truncated) {
          msg +=
            "\nNote: analyzed first " +
            MAX_LINES +
            " of " +
            totalLines +
            " lines";
        }
        return { success: true, result: { stats: s }, message: msg };
      }

      // --search
      if (/--search/i.test(input)) {
        const pm = input.match(/--pattern\s+"([^"]+)"/i);
        if (!pm) {
          return {
            success: false,
            error: "No pattern specified",
            message: 'Usage: /log-analyzer --search <file> --pattern "<regex>"',
          };
        }
        const r = searchLog(lines, pm[1]);
        if (r.error) {
          return { success: false, error: r.error, message: r.error };
        }
        let msg =
          "Search Results: " +
          fn +
          "\n" +
          "=".repeat(30) +
          "\n" +
          r.totalMatches +
          ' matches for "' +
          pm[1] +
          '"\n';
        if (r.matches.length > 0) {
          msg +=
            "\n" +
            r.matches
              .slice(0, 25)
              .map(
                (m) => "  L" + m.lineNumber + ": " + m.line.substring(0, 100),
              )
              .join("\n");
          if (r.totalMatches > 25) {
            msg += "\n  ... and " + (r.totalMatches - 25) + " more";
          }
        }
        return {
          success: true,
          result: {
            matches: r.matches.slice(0, 100),
            totalMatches: r.totalMatches,
          },
          message: msg,
        };
      }

      // --analyze (default)
      const a = analyzeLog(lines, totalLines, truncated);
      let msg = "Log Analysis: " + fn + "\n" + "=".repeat(30) + "\n";
      msg += "Format: " + a.format + "\nTotal lines: " + a.totalLines;
      if (a.truncated) {
        msg += " (analyzed first " + a.analyzedLines + ")";
      }
      msg += "\n";
      if (a.timeRange.from) {
        msg +=
          "Time range: " + a.timeRange.from + " -> " + a.timeRange.to + "\n";
      }
      const ne = lines.filter((l) => l.trim()).length || 1;
      msg += "\nLevel distribution:\n";
      for (const [l, c] of Object.entries(a.levelDistribution).sort(
        (x, y) => y[1] - x[1],
      )) {
        msg +=
          "  " +
          l +
          ": " +
          c +
          " (" +
          Math.round((c / ne) * 1000) / 10 +
          "%)\n";
      }
      if (a.busiestHours.length > 0) {
        msg +=
          "\nBusiest hours:\n" +
          a.busiestHours
            .map((h) => "  " + h.hour + " — " + h.count + " entries")
            .join("\n");
      }
      if (a.topErrors.length > 0) {
        msg +=
          "\n\nTop errors:\n" +
          a.topErrors
            .map(
              (e, i) =>
                "  " +
                (i + 1) +
                ". " +
                e.message.substring(0, 60) +
                " (" +
                e.count +
                "x)",
            )
            .join("\n");
      }
      return { success: true, result: { analysis: a }, message: msg };
    } catch (err) {
      logger.error("[log-analyzer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Log analysis failed: " + err.message,
      };
    }
  },
};
