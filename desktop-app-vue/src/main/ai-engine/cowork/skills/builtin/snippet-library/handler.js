/**
 * Snippet Library Skill Handler
 *
 * Manages a personal code snippet library: save, search, organize,
 * and reuse code snippets with automatic language detection, tagging,
 * and categorization. Snippets stored as JSON in .chainlesschain/.
 * Modes: --save, --get, --search, --list, --delete, --export, --import, --stats
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Helpers ─────────────────────────────────────────────────────────

function getSnippetsPath(projectRoot) {
  return path.join(projectRoot, ".chainlesschain", "snippets.json");
}

function loadSnippets(projectRoot) {
  const filePath = getSnippetsPath(projectRoot);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    logger.warn("[snippet-library] Failed to load snippets:", err.message);
  }
  return [];
}

function saveSnippets(projectRoot, snippets) {
  const filePath = getSnippetsPath(projectRoot);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(snippets, null, 2), "utf-8");
}

function detectLanguage(code) {
  if (!code) {
    return "text";
  }

  // HTML / JSX
  if (/<\/?[a-zA-Z][^>]*>/.test(code)) {
    if (/className\s*=|import\s+React/.test(code)) {
      return "jsx";
    }
    return "html";
  }
  // Python
  if (/\bdef\s+\w+\s*\(/.test(code) || /\bimport\s+\w+/.test(code)) {
    if (/\bclass\s+\w+.*:/.test(code) || /\bself\b/.test(code)) {
      return "python";
    }
    if (/\bdef\s+/.test(code)) {
      return "python";
    }
  }
  // Rust
  if (/\bfn\s+\w+/.test(code) || /\blet\s+mut\b/.test(code)) {
    return "rust";
  }
  // Go
  if (/\bfunc\s+\w+/.test(code) || /\bpackage\s+\w+/.test(code)) {
    return "go";
  }
  // Java / Kotlin
  if (/\bpublic\s+class\b/.test(code) || /\bSystem\.out\.print/.test(code)) {
    return "java";
  }
  if (/\bfun\s+\w+/.test(code) || /\bval\s+\w+/.test(code)) {
    return "kotlin";
  }
  // TypeScript
  if (
    /:\s*(string|number|boolean|any|void)\b/.test(code) ||
    /\binterface\s+\w+/.test(code)
  ) {
    return "typescript";
  }
  // JavaScript (broad patterns, check after TS)
  if (
    /\bfunction\s+\w+/.test(code) ||
    /\bconst\s+\w+\s*=/.test(code) ||
    /=>/.test(code)
  ) {
    return "javascript";
  }
  // CSS / SCSS
  if (/\{[^}]*:\s*[^;]+;/.test(code) && /[.#@]\w+/.test(code)) {
    return "css";
  }
  // SQL
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b/i.test(code)) {
    return "sql";
  }
  // Shell / Bash
  if (
    /^#!\/bin\/(bash|sh)/.test(code) ||
    /\b(echo|grep|awk|sed|chmod)\b/.test(code)
  ) {
    return "bash";
  }
  // YAML
  if (/^\w+:\s+.+/m.test(code) && !/{/.test(code)) {
    return "yaml";
  }
  // JSON
  if (/^\s*[[{]/.test(code)) {
    try {
      JSON.parse(code);
      return "json";
    } catch (_e) {
      /* not json */
    }
  }
  // C / C++
  if (/\b#include\s+[<"]/.test(code) || /\bint\s+main\s*\(/.test(code)) {
    return "c";
  }
  // C#
  if (/\busing\s+System\b/.test(code) || /\bnamespace\s+\w+/.test(code)) {
    return "csharp";
  }
  // Ruby
  if (
    /\bdo\s*\|/.test(code) ||
    (/\bend\b/.test(code) && /\bdef\s+/.test(code))
  ) {
    return "ruby";
  }
  // PHP
  if (/^<\?php/.test(code) || /\$\w+\s*=/.test(code)) {
    return "php";
  }

  return "text";
}

// ── Argument parsing helpers ────────────────────────────────────────

function extractQuotedArg(input, flag) {
  const re = new RegExp(flag + '\\s+"([^"]+)"', "i");
  const match = input.match(re);
  if (match) {
    return match[1];
  }
  const reSingle = new RegExp(flag + "\\s+'([^']+)'", "i");
  const matchSingle = input.match(reSingle);
  if (matchSingle) {
    return matchSingle[1];
  }
  const reUnquoted = new RegExp(flag + "\\s+(\\S+)", "i");
  const matchUQ = input.match(reUnquoted);
  return matchUQ ? matchUQ[1] : null;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[snippet-library] init: " + (_skill?.name || "snippet-library"),
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

    const isSave = /--save\b/i.test(input);
    const isGet = /--get\b/i.test(input);
    const isSearch = /--search\b/i.test(input);
    const isList = /--list\b/i.test(input);
    const isDelete = /--delete\b/i.test(input);
    const isExport = /--export\b/i.test(input);
    const isImport = /--import\b/i.test(input);
    const isStats = /--stats\b/i.test(input);

    try {
      // ── Save ────────────────────────────────────────────────────
      if (isSave) {
        const name = extractQuotedArg(input, "--name");
        const code = extractQuotedArg(input, "--code");
        const langMatch = input.match(/--lang\s+(\S+)/i);
        const tagsMatch = input.match(/--tags\s+(\S+)/i);
        const desc = extractQuotedArg(input, "--desc");

        if (!name) {
          return {
            success: false,
            error: "Missing --name",
            message:
              'Usage: --save --name "name" --code "code" [--lang lang] [--tags t1,t2] [--desc "description"]',
          };
        }
        if (!code) {
          return {
            success: false,
            error: "Missing --code",
            message:
              'Usage: --save --name "name" --code "code" [--lang lang] [--tags t1,t2]',
          };
        }

        const snippets = loadSnippets(projectRoot);
        const existing = snippets.find((s) => s.name === name);
        if (existing) {
          return {
            success: false,
            error: "Duplicate name: " + name,
            message:
              "Snippet '" +
              name +
              "' already exists. Delete it first or use a different name.",
          };
        }

        const language = langMatch ? langMatch[1] : detectLanguage(code);
        const tags = tagsMatch
          ? tagsMatch[1]
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const now = new Date().toISOString();

        snippets.push({
          name,
          code,
          language,
          tags,
          description: desc || "",
          createdAt: now,
          updatedAt: now,
        });
        saveSnippets(projectRoot, snippets);

        return {
          success: true,
          result: { name, language, tags },
          message:
            "Saved snippet '" +
            name +
            "' (" +
            language +
            (tags.length ? ", tags: " + tags.join(", ") : "") +
            ")",
        };
      }

      // ── Get ─────────────────────────────────────────────────────
      if (isGet) {
        const name = extractQuotedArg(input, "--get");
        if (!name) {
          return {
            success: false,
            error: "Missing snippet name",
            message: "Usage: --get <name>",
          };
        }

        const snippets = loadSnippets(projectRoot);
        const snippet = snippets.find((s) => s.name === name);
        if (!snippet) {
          return {
            success: false,
            error: "Not found: " + name,
            message: "Snippet '" + name + "' not found.",
          };
        }

        let msg = "Snippet: " + snippet.name + "\n" + "=".repeat(30) + "\n";
        msg += "Language: " + snippet.language + "\n";
        if (snippet.tags.length) {
          msg += "Tags: " + snippet.tags.join(", ") + "\n";
        }
        if (snippet.description) {
          msg += "Description: " + snippet.description + "\n";
        }
        msg += "Created: " + snippet.createdAt + "\n\n";
        msg += snippet.code;

        return { success: true, result: snippet, message: msg };
      }

      // ── Search ──────────────────────────────────────────────────
      if (isSearch) {
        const query = extractQuotedArg(input, "--search");
        if (!query) {
          return {
            success: false,
            error: "Missing search query",
            message: "Usage: --search <query>",
          };
        }

        const snippets = loadSnippets(projectRoot);
        const lower = query.toLowerCase();
        const results = snippets.filter(
          (s) =>
            s.name.toLowerCase().includes(lower) ||
            s.code.toLowerCase().includes(lower) ||
            (s.description && s.description.toLowerCase().includes(lower)) ||
            s.tags.some((t) => t.toLowerCase().includes(lower)),
        );

        if (results.length === 0) {
          return {
            success: true,
            result: { matches: [], query },
            message: "No snippets found matching '" + query + "'.",
          };
        }

        let msg = "Search Results: '" + query + "'\n" + "=".repeat(30) + "\n";
        msg += results.length + " snippet(s) found\n\n";
        for (const s of results) {
          msg += "  " + s.name + " (" + s.language + ")";
          if (s.tags.length) {
            msg += " [" + s.tags.join(", ") + "]";
          }
          msg += "\n";
        }

        return {
          success: true,
          result: { matches: results, query },
          message: msg,
        };
      }

      // ── List ────────────────────────────────────────────────────
      if (isList) {
        const langFilter = input.match(/--lang\s+(\S+)/i);
        const tagFilter = input.match(/--tag\s+(\S+)/i);
        const snippets = loadSnippets(projectRoot);

        let filtered = snippets;
        if (langFilter) {
          const lang = langFilter[1].toLowerCase();
          filtered = filtered.filter((s) => s.language.toLowerCase() === lang);
        }
        if (tagFilter) {
          const tag = tagFilter[1].toLowerCase();
          filtered = filtered.filter((s) =>
            s.tags.some((t) => t.toLowerCase() === tag),
          );
        }

        if (filtered.length === 0) {
          return {
            success: true,
            result: { snippets: [], total: 0 },
            message: "No snippets found.",
          };
        }

        let msg = "Snippet Library\n" + "=".repeat(30) + "\n";
        msg += filtered.length + " snippet(s)\n\n";
        for (const s of filtered) {
          msg += "  " + s.name + " (" + s.language + ")";
          if (s.tags.length) {
            msg += " [" + s.tags.join(", ") + "]";
          }
          msg += "  " + s.createdAt.split("T")[0] + "\n";
        }

        return {
          success: true,
          result: {
            snippets: filtered.map((s) => ({
              name: s.name,
              language: s.language,
              tags: s.tags,
              createdAt: s.createdAt,
            })),
            total: filtered.length,
          },
          message: msg,
        };
      }

      // ── Delete ──────────────────────────────────────────────────
      if (isDelete) {
        const name = extractQuotedArg(input, "--delete");
        if (!name) {
          return {
            success: false,
            error: "Missing snippet name",
            message: "Usage: --delete <name>",
          };
        }

        const snippets = loadSnippets(projectRoot);
        const idx = snippets.findIndex((s) => s.name === name);
        if (idx === -1) {
          return {
            success: false,
            error: "Not found: " + name,
            message: "Snippet '" + name + "' not found.",
          };
        }

        snippets.splice(idx, 1);
        saveSnippets(projectRoot, snippets);

        return {
          success: true,
          result: { deleted: name },
          message: "Deleted snippet '" + name + "'.",
        };
      }

      // ── Export ──────────────────────────────────────────────────
      if (isExport) {
        const outputMatch = input.match(/--output\s+(\S+)/i);
        const outputFile = outputMatch
          ? path.isAbsolute(outputMatch[1])
            ? outputMatch[1]
            : path.resolve(projectRoot, outputMatch[1])
          : path.resolve(projectRoot, "snippets-export.json");

        const snippets = loadSnippets(projectRoot);
        if (snippets.length === 0) {
          return {
            success: true,
            result: { exported: 0 },
            message: "No snippets to export.",
          };
        }

        fs.writeFileSync(
          outputFile,
          JSON.stringify(snippets, null, 2),
          "utf-8",
        );
        const relPath = path.relative(projectRoot, outputFile);

        return {
          success: true,
          result: { exported: snippets.length, file: relPath },
          message: "Exported " + snippets.length + " snippet(s) to " + relPath,
        };
      }

      // ── Import ──────────────────────────────────────────────────
      if (isImport) {
        const fileArg = extractQuotedArg(input, "--import");
        if (!fileArg) {
          return {
            success: false,
            error: "Missing file path",
            message: "Usage: --import <file>",
          };
        }

        const filePath = path.isAbsolute(fileArg)
          ? fileArg
          : path.resolve(projectRoot, fileArg);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found: " + filePath,
            message: "File not found: " + filePath,
          };
        }

        let imported;
        try {
          imported = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (err) {
          return {
            success: false,
            error: "Invalid JSON: " + err.message,
            message: "Failed to parse import file: " + err.message,
          };
        }
        if (!Array.isArray(imported)) {
          return {
            success: false,
            error: "Expected JSON array",
            message: "Import file must contain a JSON array of snippets.",
          };
        }

        const snippets = loadSnippets(projectRoot);
        const existingNames = new Set(snippets.map((s) => s.name));
        let added = 0;
        let skipped = 0;

        for (const item of imported) {
          if (!item.name || !item.code) {
            skipped++;
            continue;
          }
          if (existingNames.has(item.name)) {
            skipped++;
            continue;
          }
          snippets.push({
            name: item.name,
            code: item.code,
            language: item.language || detectLanguage(item.code),
            tags: Array.isArray(item.tags) ? item.tags : [],
            description: item.description || "",
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || new Date().toISOString(),
          });
          existingNames.add(item.name);
          added++;
        }

        saveSnippets(projectRoot, snippets);

        return {
          success: true,
          result: { added, skipped, total: snippets.length },
          message:
            "Imported " +
            added +
            " snippet(s), skipped " +
            skipped +
            " (duplicate or invalid). Total: " +
            snippets.length,
        };
      }

      // ── Stats ───────────────────────────────────────────────────
      if (isStats) {
        const snippets = loadSnippets(projectRoot);
        if (snippets.length === 0) {
          return {
            success: true,
            result: { total: 0 },
            message: "Snippet library is empty.",
          };
        }

        const byLang = {};
        const byTag = {};
        let oldest = snippets[0].createdAt;
        let newest = snippets[0].createdAt;

        for (const s of snippets) {
          byLang[s.language] = (byLang[s.language] || 0) + 1;
          for (const t of s.tags) {
            byTag[t] = (byTag[t] || 0) + 1;
          }
          if (s.createdAt < oldest) {
            oldest = s.createdAt;
          }
          if (s.createdAt > newest) {
            newest = s.createdAt;
          }
        }

        let msg = "Snippet Library Stats\n" + "=".repeat(30) + "\n";
        msg += "Total: " + snippets.length + "\n";
        msg += "Oldest: " + oldest.split("T")[0] + "\n";
        msg += "Newest: " + newest.split("T")[0] + "\n\n";
        msg += "By language:\n";
        for (const [lang, count] of Object.entries(byLang).sort(
          (a, b) => b[1] - a[1],
        )) {
          msg += "  " + lang + ": " + count + "\n";
        }
        if (Object.keys(byTag).length > 0) {
          msg += "\nBy tag:\n";
          for (const [tag, count] of Object.entries(byTag).sort(
            (a, b) => b[1] - a[1],
          )) {
            msg += "  " + tag + ": " + count + "\n";
          }
        }

        return {
          success: true,
          result: {
            total: snippets.length,
            byLanguage: byLang,
            byTag,
            oldest,
            newest,
          },
          message: msg,
        };
      }

      // ── No mode / help ──────────────────────────────────────────
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "Snippet Library\n" +
            "=".repeat(20) +
            "\nUsage:\n" +
            '  /snippet-library --save --name "name" --code "code" [--lang lang] [--tags t1,t2] [--desc "desc"]\n' +
            "  /snippet-library --get <name>\n" +
            "  /snippet-library --search <query>\n" +
            "  /snippet-library --list [--lang <lang>] [--tag <tag>]\n" +
            "  /snippet-library --delete <name>\n" +
            "  /snippet-library --export [--output <file>]\n" +
            "  /snippet-library --import <file>\n" +
            "  /snippet-library --stats",
        };
      }

      // ── Fallback: treat input as search ─────────────────────────
      return await module.exports.execute(
        { input: "--search " + input },
        context,
        _skill,
      );
    } catch (err) {
      logger.error("[snippet-library] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Snippet library operation failed: " + err.message,
      };
    }
  },
};
