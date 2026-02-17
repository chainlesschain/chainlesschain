/**
 * i18n Manager Skill Handler
 *
 * Manages internationalization: extract hardcoded strings, check
 * translation completeness, generate locale files, and report coverage.
 * Modes: --extract, --check, --add-locale, --stats
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const CODE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".cache",
  "locales",
  "i18n",
]);
const MAX_FILES = 2000;

// ── File collection ─────────────────────────────────────────────────

function collectSourceFiles(dir) {
  const results = [];
  function walk(d, depth) {
    if (results.length >= MAX_FILES || depth > 10) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const ent of entries) {
      if (results.length >= MAX_FILES) {
        return;
      }
      if (IGNORE_DIRS.has(ent.name)) {
        continue;
      }
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (CODE_EXTS.has(path.extname(ent.name).toLowerCase())) {
        results.push(full);
      }
    }
  }
  walk(dir, 0);
  return results;
}

// ── Hardcoded string detection ──────────────────────────────────────

const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g;
const ENGLISH_SENTENCE_RE = /["'`]([A-Z][a-z]+(?:\s+[a-z]+){2,})[."'`!?]/g;

// Patterns that indicate already-internationalized strings
const I18N_PATTERNS = [
  /\$t\s*\(/,
  /\bt\s*\(/,
  /i18n\.\w+/,
  /\{\{\s*\$t/,
  /intl\.formatMessage/,
  /FormattedMessage/,
  /useTranslation/,
];

// Patterns to skip (not user-facing strings)
const SKIP_PATTERNS = [
  /console\.(log|warn|error|info|debug)/,
  /logger\.\w+/,
  /\/\/.*$/,
  /\/\*[\s\S]*?\*\//,
  /require\s*\(/,
  /import\s+/,
  /^\s*\*/,
  /^\s*\/\//,
];

function extractHardcodedStrings(content, filePath) {
  const strings = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip already-internationalized lines
    if (I18N_PATTERNS.some((p) => p.test(line))) {
      continue;
    }
    // Skip non-user-facing lines
    if (SKIP_PATTERNS.some((p) => p.test(line))) {
      continue;
    }

    // Detect Chinese strings
    const chineseMatches = line.match(CHINESE_RE);
    if (chineseMatches) {
      for (const match of chineseMatches) {
        // Skip if in a comment or import
        if (/^\s*(\/\/|\/\*|\*|import|require)/.test(line)) {
          continue;
        }
        strings.push({
          text: match,
          file: filePath,
          line: i + 1,
          language: "zh",
          context: line.trim().substring(0, 100),
        });
      }
    }

    // Detect English sentences in templates (Vue)
    if (filePath.endsWith(".vue")) {
      const englishMatches = [];
      let m;
      const regex = new RegExp(
        ENGLISH_SENTENCE_RE.source,
        ENGLISH_SENTENCE_RE.flags,
      );
      while ((m = regex.exec(line)) !== null) {
        englishMatches.push(m[1]);
      }
      // Also check for label/placeholder/title attributes with plain text
      const attrMatch = line.match(
        /(?:label|placeholder|title|alt|aria-label)\s*=\s*["']([^"']{3,})["']/i,
      );
      if (attrMatch && !/\$t|\{\{/.test(attrMatch[1])) {
        englishMatches.push(attrMatch[1]);
      }
      for (const text of englishMatches) {
        strings.push({
          text,
          file: filePath,
          line: i + 1,
          language: "en",
          context: line.trim().substring(0, 100),
        });
      }
    }
  }

  return strings;
}

// ── Locale file handling ────────────────────────────────────────────

function findLocaleDir(projectRoot) {
  const candidates = [
    "src/locales",
    "src/i18n",
    "src/lang",
    "locales",
    "i18n",
    "lang",
    "src/renderer/locales",
    "src/renderer/i18n",
    "src/renderer/lang",
    "public/locales",
  ];
  for (const c of candidates) {
    const dir = path.join(projectRoot, c);
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

function loadLocaleFiles(localeDir) {
  const locales = {};
  if (!localeDir) {
    return locales;
  }

  let entries;
  try {
    entries = fs.readdirSync(localeDir, { withFileTypes: true });
  } catch (_e) {
    return locales;
  }

  for (const ent of entries) {
    if (ent.isFile() && ent.name.endsWith(".json")) {
      const localeName = path.basename(ent.name, ".json");
      try {
        locales[localeName] = JSON.parse(
          fs.readFileSync(path.join(localeDir, ent.name), "utf-8"),
        );
      } catch (_e) {
        /* skip */
      }
    }
    // Also check subdirectories (e.g., en/translation.json)
    if (ent.isDirectory()) {
      const subDir = path.join(localeDir, ent.name);
      try {
        const subFiles = fs
          .readdirSync(subDir)
          .filter((f) => f.endsWith(".json"));
        if (subFiles.length > 0) {
          const merged = {};
          for (const sf of subFiles) {
            try {
              Object.assign(
                merged,
                JSON.parse(fs.readFileSync(path.join(subDir, sf), "utf-8")),
              );
            } catch (_e) {
              /* skip */
            }
          }
          locales[ent.name] = merged;
        }
      } catch (_e) {
        /* skip */
      }
    }
  }

  return locales;
}

function flattenKeys(obj, prefix) {
  prefix = prefix || "";
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? prefix + "." + key : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function createLocaleTemplate(sourceLocale, newLocaleName) {
  const template = {};
  function copyStructure(src, dest) {
    for (const [key, value] of Object.entries(src)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        dest[key] = {};
        copyStructure(value, dest[key]);
      } else {
        dest[key] = "[TODO:translate] " + String(value);
      }
    }
  }
  copyStructure(sourceLocale, template);
  return template;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info("[i18n-manager] init: " + (_skill?.name || "i18n-manager"));
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

    const isExtract = /--extract/i.test(input);
    const isCheck = /--check/i.test(input);
    const addLocaleMatch = input.match(/--add-locale\s+(\S+)/i);
    const isStats = /--stats/i.test(input);

    try {
      if (isExtract) {
        const files = collectSourceFiles(projectRoot);
        const allStrings = [];
        const fileStats = {};

        for (const file of files) {
          try {
            const content = fs.readFileSync(file, "utf-8");
            const relPath = path.relative(projectRoot, file);
            const strings = extractHardcodedStrings(content, relPath);
            if (strings.length > 0) {
              allStrings.push(...strings);
              fileStats[relPath] = strings.length;
            }
          } catch (_e) {
            /* skip */
          }
        }

        const zhCount = allStrings.filter((s) => s.language === "zh").length;
        const enCount = allStrings.filter((s) => s.language === "en").length;
        const topFiles = Object.entries(fileStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        let msg = "Hardcoded Strings\n" + "=".repeat(30) + "\n";
        msg += "Scanned " + files.length + " files\n";
        msg +=
          "Found " +
          allStrings.length +
          " hardcoded strings (" +
          zhCount +
          " Chinese, " +
          enCount +
          " English)\n\n";
        if (topFiles.length > 0) {
          msg +=
            "Top files:\n" +
            topFiles
              .map(([f, c]) => "  " + f + " (" + c + " strings)")
              .join("\n") +
            "\n\n";
        }
        if (allStrings.length > 0) {
          msg +=
            "Samples:\n" +
            allStrings
              .slice(0, 15)
              .map(
                (s) =>
                  "  " +
                  s.file +
                  ":" +
                  s.line +
                  " [" +
                  s.language +
                  '] "' +
                  s.text.substring(0, 50) +
                  '"',
              )
              .join("\n");
        }

        return {
          success: true,
          result: {
            strings: allStrings.slice(0, 100),
            total: allStrings.length,
            chinese: zhCount,
            english: enCount,
            fileStats,
          },
          message: msg,
        };
      }

      if (isCheck || isStats) {
        const localeDir = findLocaleDir(projectRoot);
        if (!localeDir) {
          return {
            success: true,
            result: { localeDir: null, locales: {} },
            message:
              "No locale directory found. Searched: src/locales, src/i18n, locales, i18n, src/renderer/locales.",
          };
        }

        const locales = loadLocaleFiles(localeDir);
        const localeNames = Object.keys(locales);
        if (localeNames.length === 0) {
          return {
            success: true,
            result: { localeDir, locales: {} },
            message:
              "Locale directory found at " +
              path.relative(projectRoot, localeDir) +
              " but no JSON files found.",
          };
        }

        // Find all unique keys across all locales
        const allKeys = new Set();
        const localeKeys = {};
        for (const [name, data] of Object.entries(locales)) {
          const keys = flattenKeys(data);
          localeKeys[name] = new Set(keys);
          keys.forEach((k) => allKeys.add(k));
        }

        const totalKeys = allKeys.size;
        const coverage = {};
        const missingByLocale = {};

        for (const name of localeNames) {
          const keys = localeKeys[name];
          const missing = [...allKeys].filter((k) => !keys.has(k));
          coverage[name] = {
            total: keys.size,
            missing: missing.length,
            coverage:
              totalKeys > 0 ? Math.round((keys.size / totalKeys) * 100) : 100,
          };
          missingByLocale[name] = missing;
        }

        let msg =
          (isCheck ? "Translation Check" : "i18n Statistics") +
          "\n" +
          "=".repeat(30) +
          "\n";
        msg +=
          "Locale directory: " + path.relative(projectRoot, localeDir) + "\n";
        msg += "Total unique keys: " + totalKeys + "\n\n";
        msg += "Coverage:\n";
        for (const [name, stats] of Object.entries(coverage)) {
          msg +=
            "  " +
            name +
            ": " +
            stats.total +
            "/" +
            totalKeys +
            " (" +
            stats.coverage +
            "%)";
          if (stats.missing > 0) {
            msg += " — " + stats.missing + " missing";
          }
          msg += "\n";
        }

        if (isCheck) {
          for (const [name, missing] of Object.entries(missingByLocale)) {
            if (missing.length > 0) {
              msg +=
                "\nMissing in " +
                name +
                ":\n" +
                missing
                  .slice(0, 20)
                  .map((k) => "  - " + k)
                  .join("\n");
              if (missing.length > 20) {
                msg += "\n  ... and " + (missing.length - 20) + " more";
              }
            }
          }
        }

        return {
          success: true,
          result: {
            localeDir: path.relative(projectRoot, localeDir),
            totalKeys,
            coverage,
            missingByLocale,
          },
          message: msg,
        };
      }

      if (addLocaleMatch) {
        const newLocale = addLocaleMatch[1];
        const localeDir = findLocaleDir(projectRoot);
        if (!localeDir) {
          return {
            success: false,
            error: "No locale directory found",
            message: "No locale directory found.",
          };
        }

        const locales = loadLocaleFiles(localeDir);
        const sourceLocaleName = Object.keys(locales)[0];
        if (!sourceLocaleName) {
          return {
            success: false,
            error: "No existing locale files to copy from",
            message: "No existing locale files found.",
          };
        }

        const template = createLocaleTemplate(
          locales[sourceLocaleName],
          newLocale,
        );
        const totalKeys = flattenKeys(template).length;
        const outputPath = path.join(localeDir, newLocale + ".json");
        const relOutput = path.relative(projectRoot, outputPath);

        const content = JSON.stringify(template, null, 2);

        let msg = "New Locale Generated\n" + "=".repeat(30) + "\n";
        msg += "Source: " + sourceLocaleName + "\n";
        msg += "Target: " + newLocale + "\n";
        msg += "Keys: " + totalKeys + "\n";
        msg += "Output: " + relOutput + "\n";
        msg +=
          "All values marked as [TODO:translate] for manual translation.\n\n";
        msg += "Preview:\n" + content.substring(0, 1000);

        return {
          success: true,
          result: {
            locale: newLocale,
            sourceLocale: sourceLocaleName,
            totalKeys,
            outputPath: relOutput,
            content,
          },
          generatedFiles: [{ path: relOutput, content }],
          message: msg,
        };
      }

      // No mode
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "i18n Manager\n" +
            "=".repeat(20) +
            "\nUsage:\n  /i18n-manager --extract          Scan for hardcoded strings\n  /i18n-manager --check            Check translation completeness\n  /i18n-manager --add-locale <lang> Generate new locale file\n  /i18n-manager --stats            Show coverage statistics",
        };
      }

      // Default: extract
      return await module.exports.execute(
        { input: "--extract" },
        context,
        _skill,
      );
    } catch (err) {
      logger.error("[i18n-manager] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "i18n manager failed: " + err.message,
      };
    }
  },
};
