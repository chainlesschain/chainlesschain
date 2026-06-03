/**
 * Regex Playground Skill Handler
 *
 * Test, match, replace, explain regular expressions, access a common-pattern
 * library, and extract matches from files.
 * Modes: --test, --replace, --explain, --library, --extract
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Built-in pattern library ────────────────────────────────────────

const PATTERN_LIBRARY = {
  email: {
    pattern: "^[\\w.+-]+@[\\w-]+\\.[\\w.]+$",
    description: "Email address",
    example: "user@example.com",
  },
  url: {
    pattern: "https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+",
    description: "HTTP(S) URL",
    example: "https://example.com",
  },
  ipv4: {
    pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
    description: "IPv4 address",
    example: "192.168.1.1",
  },
  phone_cn: {
    pattern: "1[3-9]\\d{9}",
    description: "Chinese mobile phone",
    example: "13812345678",
  },
  date_iso: {
    pattern: "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])",
    description: "ISO date (YYYY-MM-DD)",
    example: "2026-01-15",
  },
  time_24h: {
    pattern: "(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?",
    description: "24-hour time",
    example: "14:30:00",
  },
  hex_color: {
    pattern: "#(?:[0-9a-fA-F]{3}){1,2}\\b",
    description: "Hex color code",
    example: "#FF5733",
  },
  uuid: {
    pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    description: "UUID v4",
    example: "550e8400-e29b-41d4-a716-446655440000",
  },
  password_strong: {
    pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&]).{8,}$",
    description: "Strong password (8+ chars, upper, lower, digit, special)",
    example: "P@ssw0rd!",
  },
  chinese: {
    pattern: "[\\u4e00-\\u9fff]+",
    description: "Chinese characters",
    example: "你好世界",
  },
  html_tag: {
    pattern: "<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*>.*?</\\1>",
    description: "HTML tag pair",
    example: "<div>content</div>",
  },
  json_key: {
    pattern: '"([^"]+)"\\s*:',
    description: "JSON key",
    example: '"name":',
  },
};

// ── Regex explanation map ───────────────────────────────────────────

const _EXPLAIN_MAP = [
  { re: /\\\\/g, desc: "literal backslash" },
  { re: /\\d/g, desc: "digit [0-9]" },
  { re: /\\D/g, desc: "non-digit" },
  { re: /\\w/g, desc: "word char [a-zA-Z0-9_]" },
  { re: /\\W/g, desc: "non-word char" },
  { re: /\\s/g, desc: "whitespace" },
  { re: /\\S/g, desc: "non-whitespace" },
  { re: /\\b/g, desc: "word boundary" },
  { re: /\\B/g, desc: "non-word boundary" },
  { re: /\\\./g, desc: "literal dot" },
  { re: /(?<!\\)\./g, desc: "any character" },
  { re: /\\^/g, desc: "start of string" },
  { re: /\\\$/g, desc: "literal dollar" },
  { re: /(?<!\\)\$/g, desc: "end of string" },
  { re: /\(\?=/g, desc: "positive lookahead" },
  { re: /\(\?!/g, desc: "negative lookahead" },
  { re: /\(\?<=/g, desc: "positive lookbehind" },
  { re: /\(\?<!/g, desc: "negative lookbehind" },
  { re: /\(\?:/g, desc: "non-capturing group" },
  { re: /\(/g, desc: "group start" },
  { re: /\)/g, desc: "group end" },
  { re: /\{(\d+),(\d+)\}/g, desc: "$1 to $2 times" },
  { re: /\{(\d+),\}/g, desc: "$1 or more times" },
  { re: /\{(\d+)\}/g, desc: "exactly $1 times" },
  { re: /(?<!\\)\+\?/g, desc: "one or more (lazy)" },
  { re: /(?<!\\)\+/g, desc: "one or more" },
  { re: /(?<!\\)\*\?/g, desc: "zero or more (lazy)" },
  { re: /(?<!\\)\*/g, desc: "zero or more" },
  { re: /(?<!\\)\?/g, desc: "optional" },
  { re: /(?<!\\)\|/g, desc: "OR" },
  { re: /\[([^\]]+)\]/g, desc: "character class [$1]" },
];

// ── Helpers ─────────────────────────────────────────────────────────

function parseFlags(input) {
  const flagsMatch = input.match(/--flags\s+([gimsuy]+)/i);
  return flagsMatch ? flagsMatch[1] : "g";
}

function extractQuoted(input, flag) {
  // Match --flag "value" or --flag 'value' or --flag value
  const re = new RegExp(flag + '\\s+"([^"]*)"', "i");
  const m = input.match(re);
  if (m) {
    return m[1];
  }
  const re2 = new RegExp(flag + "\\s+'([^']*)'", "i");
  const m2 = input.match(re2);
  if (m2) {
    return m2[1];
  }
  const re3 = new RegExp(flag + "\\s+(\\S+)", "i");
  const m3 = input.match(re3);
  return m3 ? m3[1] : null;
}

function safeRegExp(pattern, flags) {
  try {
    return { regex: new RegExp(pattern, flags), error: null };
  } catch (err) {
    return { regex: null, error: err.message };
  }
}

function explainPattern(pattern) {
  const remaining = pattern;

  // Walk the pattern and describe each token
  const tokens = [];
  let i = 0;
  while (i < remaining.length) {
    // Escape sequences
    if (remaining[i] === "\\" && i + 1 < remaining.length) {
      const twoChar = remaining.substring(i, i + 2);
      const desc = getTokenDescription(twoChar);
      tokens.push({ token: twoChar, desc });
      i += 2;
      continue;
    }
    // Character class
    if (remaining[i] === "[") {
      const end = remaining.indexOf("]", i + 1);
      if (end !== -1) {
        const cls = remaining.substring(i, end + 1);
        tokens.push({ token: cls, desc: "character class " + cls });
        i = end + 1;
        continue;
      }
    }
    // Quantifiers with braces
    if (remaining[i] === "{") {
      const end = remaining.indexOf("}", i + 1);
      if (end !== -1) {
        const q = remaining.substring(i, end + 1);
        const qm = q.match(/^\{(\d+)(?:,(\d*))?\}$/);
        if (qm) {
          if (qm[2] === undefined) {
            tokens.push({ token: q, desc: "exactly " + qm[1] + " times" });
          } else if (qm[2] === "") {
            tokens.push({ token: q, desc: qm[1] + " or more times" });
          } else {
            tokens.push({ token: q, desc: qm[1] + " to " + qm[2] + " times" });
          }
          i = end + 1;
          continue;
        }
      }
    }
    // Lookahead / lookbehind / non-capturing group
    if (remaining[i] === "(" && remaining[i + 1] === "?") {
      if (remaining.substring(i, i + 3) === "(?=") {
        tokens.push({ token: "(?=...)", desc: "positive lookahead" });
        i += 3;
        continue;
      }
      if (remaining.substring(i, i + 3) === "(?!") {
        tokens.push({ token: "(?!...)", desc: "negative lookahead" });
        i += 3;
        continue;
      }
      if (remaining.substring(i, i + 4) === "(?<=") {
        tokens.push({ token: "(?<=...)", desc: "positive lookbehind" });
        i += 4;
        continue;
      }
      if (remaining.substring(i, i + 4) === "(?<!") {
        tokens.push({ token: "(?<!...)", desc: "negative lookbehind" });
        i += 4;
        continue;
      }
      if (remaining.substring(i, i + 3) === "(?:") {
        tokens.push({ token: "(?:...)", desc: "non-capturing group" });
        i += 3;
        continue;
      }
    }
    // Single characters
    const ch = remaining[i];
    const desc = getTokenDescription(ch);
    tokens.push({ token: ch, desc });
    i++;
  }

  return tokens;
}

function getTokenDescription(token) {
  const map = {
    "\\d": "digit [0-9]",
    "\\D": "non-digit",
    "\\w": "word char [a-zA-Z0-9_]",
    "\\W": "non-word char",
    "\\s": "whitespace",
    "\\S": "non-whitespace",
    "\\b": "word boundary",
    "\\B": "non-word boundary",
    "\\.": "literal dot",
    "\\\\": "literal backslash",
    "\\(": "literal (",
    "\\)": "literal )",
    "\\[": "literal [",
    "\\]": "literal ]",
    "\\{": "literal {",
    "\\}": "literal }",
    "\\+": "literal +",
    "\\*": "literal *",
    "\\?": "literal ?",
    "\\|": "literal |",
    "\\^": "literal ^",
    "\\$": "literal $",
    ".": "any character",
    "^": "start of string",
    $: "end of string",
    "*": "zero or more",
    "+": "one or more",
    "?": "optional",
    "|": "OR",
    "(": "group start",
    ")": "group end",
  };
  return map[token] || "literal '" + token + "'";
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[regex-playground] init: " + (_skill?.name || "regex-playground"),
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

    const isTest = /--test\s/i.test(input);
    const isReplace = /--replace\s/i.test(input);
    const isExplain = /--explain\s/i.test(input);
    const isLibrary = /--library/i.test(input);
    const isExtract = /--extract\s/i.test(input);
    const hasFile = /--file\s/i.test(input);

    try {
      // ── --test mode ─────────────────────────────────────────────
      if (isTest) {
        const pattern = extractQuoted(input, "--test");
        if (!pattern) {
          return {
            success: false,
            error: "Missing pattern",
            message:
              'Usage: --test "<pattern>" --text "<text>" or --file <path>',
          };
        }
        const flags = parseFlags(input);
        const { regex, error } = safeRegExp(pattern, flags);
        if (error) {
          return {
            success: false,
            error: "Invalid regex: " + error,
            message: "Invalid regex: " + error,
          };
        }

        let text;
        if (hasFile) {
          const filePath = extractQuoted(input, "--file");
          const absPath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(projectRoot, filePath);
          if (!fs.existsSync(absPath)) {
            return {
              success: false,
              error: "File not found: " + absPath,
              message: "File not found: " + absPath,
            };
          }
          text = fs.readFileSync(absPath, "utf-8");
        } else {
          text = extractQuoted(input, "--text");
        }
        if (text === null || text === undefined) {
          return {
            success: false,
            error: "Missing --text or --file",
            message: 'Provide --text "<text>" or --file <path>.',
          };
        }

        const matches = [];
        let m;
        // Reset lastIndex for global regex
        regex.lastIndex = 0;
        if (flags.includes("g")) {
          while ((m = regex.exec(text)) !== null) {
            const entry = {
              match: m[0],
              index: m.index,
              end: m.index + m[0].length,
            };
            if (m.length > 1) {
              entry.groups = m.slice(1);
            }
            if (hasFile) {
              const lineNum = text.substring(0, m.index).split("\n").length;
              entry.line = lineNum;
            }
            matches.push(entry);
            if (matches.length >= 500) {
              break;
            }
          }
        } else {
          m = regex.exec(text);
          if (m) {
            const entry = {
              match: m[0],
              index: m.index,
              end: m.index + m[0].length,
            };
            if (m.length > 1) {
              entry.groups = m.slice(1);
            }
            if (hasFile) {
              entry.line = text.substring(0, m.index).split("\n").length;
            }
            matches.push(entry);
          }
        }

        let msg = "Regex Test\n" + "=".repeat(30) + "\n";
        msg += "Pattern: /" + pattern + "/" + flags + "\n";
        msg += "Matches: " + matches.length + "\n\n";
        if (matches.length > 0) {
          const shown = matches.slice(0, 20);
          for (const mt of shown) {
            msg +=
              "  " +
              JSON.stringify(mt.match) +
              " (position " +
              mt.index +
              "-" +
              mt.end +
              ")";
            if (mt.line) {
              msg += " [line " + mt.line + "]";
            }
            if (mt.groups) {
              msg += " groups: " + JSON.stringify(mt.groups);
            }
            msg += "\n";
          }
          if (matches.length > 20) {
            msg += "  ... and " + (matches.length - 20) + " more matches\n";
          }
        } else {
          msg += "  No matches found.\n";
        }

        return {
          success: true,
          result: { pattern, flags, matches, total: matches.length },
          message: msg,
        };
      }

      // ── --replace mode ──────────────────────────────────────────
      if (isReplace) {
        const pattern = extractQuoted(input, "--replace");
        const replacement = extractQuoted(input, "--with");
        const text = extractQuoted(input, "--text");
        if (!pattern) {
          return {
            success: false,
            error: "Missing pattern",
            message:
              'Usage: --replace "<pattern>" --with "<replacement>" --text "<text>"',
          };
        }
        if (replacement === null || replacement === undefined) {
          return {
            success: false,
            error: "Missing --with",
            message: 'Provide --with "<replacement>".',
          };
        }
        if (text === null || text === undefined) {
          return {
            success: false,
            error: "Missing --text",
            message: 'Provide --text "<text>".',
          };
        }
        const flags = parseFlags(input);
        const { regex, error } = safeRegExp(pattern, flags);
        if (error) {
          return {
            success: false,
            error: "Invalid regex: " + error,
            message: "Invalid regex: " + error,
          };
        }

        // Count matches first
        const countRegex = new RegExp(
          pattern,
          flags.includes("g") ? flags : flags + "g",
        );
        const matchCount = (text.match(countRegex) || []).length;
        const result = text.replace(regex, replacement);

        let msg = "Regex Replace\n" + "=".repeat(30) + "\n";
        msg += "Pattern: /" + pattern + "/" + flags + "\n";
        msg += "Replacement: " + JSON.stringify(replacement) + "\n";
        msg += "Replacements made: " + matchCount + "\n\n";
        msg += "Original: " + JSON.stringify(text) + "\n";
        msg += "Result:   " + JSON.stringify(result) + "\n";

        return {
          success: true,
          result: {
            pattern,
            flags,
            replacement,
            original: text,
            result,
            count: matchCount,
          },
          message: msg,
        };
      }

      // ── --explain mode ──────────────────────────────────────────
      if (isExplain) {
        const pattern = extractQuoted(input, "--explain");
        if (!pattern) {
          return {
            success: false,
            error: "Missing pattern",
            message: 'Usage: --explain "<pattern>"',
          };
        }

        const tokens = explainPattern(pattern);
        let msg = "Regex Explanation\n" + "=".repeat(30) + "\n";
        msg += "Pattern: /" + pattern + "/\n\n";
        msg += "Breakdown:\n";
        for (const t of tokens) {
          msg += "  " + t.token.padEnd(12) + " -> " + t.desc + "\n";
        }

        // Validate the regex
        const { error } = safeRegExp(pattern, "");
        if (error) {
          msg += "\nWarning: This pattern is invalid — " + error + "\n";
        } else {
          msg += "\nPattern is valid.\n";
        }

        return {
          success: true,
          result: { pattern, tokens, valid: !error },
          message: msg,
        };
      }

      // ── --library mode ──────────────────────────────────────────
      if (isLibrary) {
        const nameMatch = input.match(/--library\s+(\S+)/i);
        const name = nameMatch ? nameMatch[1].toLowerCase() : null;

        if (name) {
          const entry = PATTERN_LIBRARY[name];
          if (!entry) {
            // Fuzzy search
            const matches = Object.entries(PATTERN_LIBRARY).filter(
              ([k, v]) =>
                k.includes(name) || v.description.toLowerCase().includes(name),
            );
            if (matches.length > 0) {
              let msg =
                "Library Search: " + name + "\n" + "=".repeat(30) + "\n";
              msg += matches.length + " pattern(s) found:\n\n";
              for (const [k, v] of matches) {
                msg +=
                  "  " +
                  k +
                  "\n    Pattern: " +
                  v.pattern +
                  "\n    Description: " +
                  v.description +
                  "\n    Example: " +
                  v.example +
                  "\n\n";
              }
              return {
                success: true,
                result: { query: name, matches: Object.fromEntries(matches) },
                message: msg,
              };
            }
            return {
              success: false,
              error: "Pattern not found: " + name,
              message:
                "Pattern '" + name + "' not found. Use --library to list all.",
            };
          }

          let msg = "Library: " + name + "\n" + "=".repeat(30) + "\n";
          msg += "Pattern:     " + entry.pattern + "\n";
          msg += "Description: " + entry.description + "\n";
          msg += "Example:     " + entry.example + "\n";

          return {
            success: true,
            result: { name, ...entry },
            message: msg,
          };
        }

        // List all patterns
        let msg = "Regex Pattern Library\n" + "=".repeat(30) + "\n\n";
        for (const [k, v] of Object.entries(PATTERN_LIBRARY)) {
          msg += "  " + k.padEnd(18) + " " + v.description + "\n";
        }
        msg += "\nUse --library <name> for details.";

        return {
          success: true,
          result: { patterns: PATTERN_LIBRARY },
          message: msg,
        };
      }

      // ── --extract mode ──────────────────────────────────────────
      if (isExtract) {
        const pattern = extractQuoted(input, "--extract");
        const filePath = extractQuoted(input, "--file");
        if (!pattern) {
          return {
            success: false,
            error: "Missing pattern",
            message: 'Usage: --extract "<pattern>" --file <path>',
          };
        }
        if (!filePath) {
          return {
            success: false,
            error: "Missing --file",
            message: "Provide --file <path>.",
          };
        }
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(projectRoot, filePath);
        if (!fs.existsSync(absPath)) {
          return {
            success: false,
            error: "File not found: " + absPath,
            message: "File not found: " + absPath,
          };
        }

        const flags = parseFlags(input);
        const { regex, error } = safeRegExp(
          pattern,
          flags.includes("g") ? flags : flags + "g",
        );
        if (error) {
          return {
            success: false,
            error: "Invalid regex: " + error,
            message: "Invalid regex: " + error,
          };
        }

        const content = fs.readFileSync(absPath, "utf-8");
        const allMatches = [];
        let m;
        regex.lastIndex = 0;
        while ((m = regex.exec(content)) !== null) {
          allMatches.push(m[0]);
          if (allMatches.length >= 1000) {
            break;
          }
        }

        // Count unique matches
        const counts = {};
        for (const mt of allMatches) {
          counts[mt] = (counts[mt] || 0) + 1;
        }
        const unique = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({ value, count }));

        let msg = "Regex Extract\n" + "=".repeat(30) + "\n";
        msg += "Pattern: /" + pattern + "/" + flags + "\n";
        msg += "File: " + path.relative(projectRoot, absPath) + "\n";
        msg += "Total matches: " + allMatches.length + "\n";
        msg += "Unique values: " + unique.length + "\n\n";
        const shown = unique.slice(0, 30);
        for (const u of shown) {
          msg += "  " + JSON.stringify(u.value) + " (" + u.count + "x)\n";
        }
        if (unique.length > 30) {
          msg += "  ... and " + (unique.length - 30) + " more unique values\n";
        }

        return {
          success: true,
          result: {
            pattern,
            flags,
            file: path.relative(projectRoot, absPath),
            total: allMatches.length,
            unique,
          },
          message: msg,
        };
      }

      // ── No mode — show usage ────────────────────────────────────
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "Regex Playground\n" +
            "=".repeat(20) +
            "\nUsage:\n" +
            '  /regex-playground --test "<pattern>" --text "<text>"     Test regex matches\n' +
            '  /regex-playground --test "<pattern>" --file <path>       Test regex in file\n' +
            '  /regex-playground --replace "<pat>" --with "<rep>" --text "<text>"  Find & replace\n' +
            '  /regex-playground --explain "<pattern>"                  Explain regex\n' +
            "  /regex-playground --library [name]                       Pattern library\n" +
            '  /regex-playground --extract "<pattern>" --file <path>    Extract matches from file\n\n' +
            "Options:\n" +
            "  --flags <gimsuy>  Set regex flags (default: g)\n",
        };
      }

      // Default: treat input as --explain
      return await module.exports.execute(
        { input: '--explain "' + input.replace(/"/g, '\\"') + '"' },
        context,
        _skill,
      );
    } catch (err) {
      logger.error("[regex-playground] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Regex playground failed: " + err.message,
      };
    }
  },
};
