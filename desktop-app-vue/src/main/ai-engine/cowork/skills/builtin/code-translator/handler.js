/**
 * Code Translator Skill Handler
 *
 * Translates code between programming languages (JS↔TS, Python↔JS).
 * Modes: --translate, --detect, --preview
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Language detection ──────────────────────────────────────────────

const LANG_SIGNATURES = {
  typescript: {
    extensions: [".ts", ".tsx"],
    patterns: [
      /:\s*(string|number|boolean|any|void|never)\b/,
      /interface\s+\w+/,
      /type\s+\w+\s*=/,
      /<\w+>/,
      /as\s+\w+/,
    ],
  },
  javascript: {
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    patterns: [/require\s*\(/, /module\.exports/, /const\s+\w+\s*=/, /=>\s*\{/],
  },
  python: {
    extensions: [".py"],
    patterns: [
      /\bdef\s+\w+\s*\(/,
      /\bimport\s+\w+/,
      /\bclass\s+\w+:/,
      /\bself\b/,
      /\bprint\s*\(/,
    ],
  },
  vue: {
    extensions: [".vue"],
    patterns: [
      /<template>/,
      /<script/,
      /defineComponent/,
      /ref\s*\(/,
      /computed\s*\(/,
    ],
  },
};

const MODULE_SYSTEMS = {
  commonjs: [/require\s*\(/, /module\.exports/],
  esm: [/\bimport\s+.*from\s+/, /\bexport\s+(default|const|function|class)/],
};

function detectLanguage(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();

  for (const [lang, info] of Object.entries(LANG_SIGNATURES)) {
    if (info.extensions.includes(ext)) {
      const patternMatches = info.patterns.filter((p) =>
        p.test(content),
      ).length;
      return {
        language: lang,
        confidence: 0.7 + patternMatches * 0.06,
        extension: ext,
      };
    }
  }

  // Fallback: pattern-based detection
  let bestLang = "unknown";
  let bestScore = 0;
  for (const [lang, info] of Object.entries(LANG_SIGNATURES)) {
    const score = info.patterns.filter((p) => p.test(content)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }
  return { language: bestLang, confidence: bestScore * 0.2, extension: ext };
}

function detectModuleSystem(content) {
  for (const [system, patterns] of Object.entries(MODULE_SYSTEMS)) {
    if (patterns.some((p) => p.test(content))) {
      return system;
    }
  }
  return "unknown";
}

function detectFeatures(content) {
  const features = [];
  if (/async\s+/.test(content)) {
    features.push("async/await");
  }
  if (/=>\s*[{(]/.test(content)) {
    features.push("arrow functions");
  }
  if (/`[^`]*\$\{/.test(content)) {
    features.push("template literals");
  }
  if (/\.\.\.\w+/.test(content)) {
    features.push("spread operator");
  }
  if (/\bclass\s+\w+/.test(content)) {
    features.push("classes");
  }
  if (/\bdecorator|@\w+/.test(content)) {
    features.push("decorators");
  }
  if (/\bPromise\b/.test(content)) {
    features.push("promises");
  }
  if (/\bgenerator|function\*/.test(content)) {
    features.push("generators");
  }
  return features;
}

// ── Translation rules ───────────────────────────────────────────────

function jsToTs(content) {
  const mappings = [];
  let result = content;

  // Add types to function parameters
  result = result.replace(
    /function\s+(\w+)\s*\(([^)]*)\)/g,
    (match, name, params) => {
      if (!params.trim()) {
        return match;
      }
      const typedParams = params.split(",").map((p) => {
        const paramName = p.trim().replace(/\s*=.*$/, "");
        if (!paramName) {
          return p;
        }
        const defaultVal = p.includes("=") ? p.split("=")[1].trim() : null;
        let type = "any";
        if (defaultVal) {
          if (/^['"]/.test(defaultVal)) {
            type = "string";
          } else if (/^\d/.test(defaultVal)) {
            type = "number";
          } else if (/^(true|false)$/.test(defaultVal)) {
            type = "boolean";
          } else if (/^\[/.test(defaultVal)) {
            type = "any[]";
          } else if (/^\{/.test(defaultVal)) {
            type = "Record<string, any>";
          }
        }
        mappings.push("param " + paramName + " → " + type);
        return p.includes("=")
          ? " " + paramName + ": " + type + " = " + defaultVal
          : " " + paramName + ": " + type;
      });
      return "function " + name + "(" + typedParams.join(",") + ")";
    },
  );

  // Convert const arrow functions
  result = result.replace(
    /const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g,
    (match, name, params) => {
      if (!params.trim()) {
        return match;
      }
      const typedParams = params.split(",").map((p) => {
        const pName = p.trim();
        if (!pName || pName.includes(":")) {
          return p;
        }
        mappings.push("arrow param " + pName + " → any");
        return " " + pName + ": any";
      });
      const asyncPrefix = match.includes("async") ? "async " : "";
      return (
        "const " +
        name +
        " = " +
        asyncPrefix +
        "(" +
        typedParams.join(",") +
        ") =>"
      );
    },
  );

  // Convert require to import
  result = result.replace(
    /const\s+\{?\s*([^}]+)\}?\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    (match, names, modPath) => {
      const isDestructured = match.includes("{");
      mappings.push("require → import: " + modPath);
      if (isDestructured) {
        return "import { " + names.trim() + ' } from "' + modPath + '"';
      }
      return "import " + names.trim() + ' from "' + modPath + '"';
    },
  );

  // Convert module.exports
  result = result.replace(/module\.exports\s*=\s*/, "export default ");
  if (/module\.exports/.test(content)) {
    mappings.push("module.exports → export default");
  }

  return { code: result, mappings, targetExt: ".ts" };
}

function tsToJs(content) {
  const mappings = [];
  let result = content;

  // Remove type annotations from parameters
  result = result.replace(
    /(\w+)\s*:\s*(\w+[[\]<>,\s|&]*)/g,
    (match, name, type) => {
      if (
        /^(const|let|var|function|class|import|export|return|if|for|while)$/.test(
          name,
        )
      ) {
        return match;
      }
      mappings.push("remove type: " + name + ": " + type.trim());
      return name;
    },
  );

  // Remove interface declarations
  result = result.replace(/\binterface\s+\w+\s*\{[^}]*\}\n?/g, (match) => {
    mappings.push("remove interface");
    return "";
  });

  // Remove type aliases
  result = result.replace(/\btype\s+\w+\s*=\s*[^;]+;\n?/g, (match) => {
    mappings.push("remove type alias");
    return "";
  });

  // Remove generic type params
  result = result.replace(/<\w+(?:,\s*\w+)*>/g, () => {
    mappings.push("remove generic");
    return "";
  });

  // Remove 'as Type' assertions
  result = result.replace(/\s+as\s+\w+/g, () => {
    mappings.push("remove type assertion");
    return "";
  });

  return { code: result, mappings, targetExt: ".js" };
}

function pyToJs(content) {
  const mappings = [];
  let result = content;

  // def → function
  result = result.replace(
    /\bdef\s+(\w+)\s*\(([^)]*)\)\s*(?:->.*)?:/g,
    (match, name, params) => {
      mappings.push("def → function: " + name);
      return "function " + name + "(" + params + ") {";
    },
  );

  // class with colon
  result = result.replace(
    /\bclass\s+(\w+)(?:\(([^)]*)\))?\s*:/g,
    (match, name, parent) => {
      mappings.push("class: " + name);
      return "class " + name + (parent ? " extends " + parent : "") + " {";
    },
  );

  // print → console.log
  result = result.replace(/\bprint\s*\(/g, () => {
    mappings.push("print → console.log");
    return "console.log(";
  });

  // f-strings
  result = result.replace(/f["']([^"']+)["']/g, (match, content) => {
    mappings.push("f-string → template literal");
    return "`" + content.replace(/\{/g, "${") + "`";
  });

  // None/True/False
  result = result.replace(/\bNone\b/g, "null");
  result = result.replace(/\bTrue\b/g, "true");
  result = result.replace(/\bFalse\b/g, "false");

  // import
  result = result.replace(
    /^from\s+(\S+)\s+import\s+(.+)$/gm,
    (match, mod, names) => {
      mappings.push("import: " + mod);
      return "import { " + names.trim() + ' } from "' + mod + '";';
    },
  );
  result = result.replace(/^import\s+(\w+)$/gm, (match, mod) => {
    return "import " + mod + ' from "' + mod + '";';
  });

  // self → this
  result = result.replace(/\bself\./g, "this.");
  if (/\bself\./.test(content)) {
    mappings.push("self → this");
  }

  // Note: indentation-based blocks not fully converted (marked as untranslatable)
  const untranslatable = [];
  if (/^\s{4,}/m.test(content)) {
    untranslatable.push(
      "Indentation-based block structure requires manual review for closing braces",
    );
  }
  if (/\bwith\s+/.test(content)) {
    untranslatable.push("Python 'with' statement (context managers)");
  }
  if (/\byield\s+/.test(content)) {
    untranslatable.push("Python generators need manual conversion");
  }
  if (/\blist\s+comprehension|\[.*\bfor\b.*\bin\b.*\]/.test(content)) {
    untranslatable.push("List comprehensions");
  }

  return { code: result, mappings, targetExt: ".js", untranslatable };
}

function jsToPy(content) {
  const mappings = [];
  let result = content;

  // function → def
  result = result.replace(
    /\bfunction\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
    (match, name, params) => {
      mappings.push("function → def: " + name);
      return "def " + name + "(" + params + "):";
    },
  );

  // console.log → print
  result = result.replace(/console\.log\s*\(/g, () => {
    mappings.push("console.log → print");
    return "print(";
  });

  // null/true/false
  result = result.replace(/\bnull\b/g, "None");
  result = result.replace(/\btrue\b/g, "True");
  result = result.replace(/\bfalse\b/g, "False");

  // const/let/var → no keyword
  result = result.replace(/\b(const|let|var)\s+/g, () => {
    mappings.push("remove const/let/var");
    return "";
  });

  // this → self
  result = result.replace(/\bthis\./g, "self.");

  // Template literals
  result = result.replace(/`([^`]*)`/g, (match, content) => {
    mappings.push("template literal → f-string");
    return 'f"' + content.replace(/\$\{/g, "{") + '"';
  });

  // Remove semicolons
  result = result.replace(/;\s*$/gm, "");

  // Remove braces (simplified)
  result = result.replace(/^\s*\}\s*$/gm, "");

  const untranslatable = [
    "Block structure: closing braces removed but indentation not adjusted (manual review needed)",
  ];

  return { code: result, mappings, targetExt: ".py", untranslatable };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[code-translator] init: " + (_skill?.name || "code-translator"),
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

    const translateMatch = input.match(/--translate\s+(\S+)\s+--to\s+(\S+)/i);
    const detectMatch = input.match(/--detect\s+(\S+)/i);
    const previewMatch = input.match(/--preview\s+(\S+)\s+--to\s+(\S+)/i);

    try {
      if (detectMatch) {
        const filePath = path.isAbsolute(detectMatch[1])
          ? detectMatch[1]
          : path.resolve(projectRoot, detectMatch[1]);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found: " + filePath,
            message: "File not found: " + filePath,
          };
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const detection = detectLanguage(filePath, content);
        const moduleSystem = detectModuleSystem(content);
        const features = detectFeatures(content);
        const lineCount = content.split("\n").length;

        let msg = "Language Detection\n" + "=".repeat(30) + "\n";
        msg += "File: " + path.relative(projectRoot, filePath) + "\n";
        msg +=
          "Language: " +
          detection.language +
          " (confidence: " +
          (detection.confidence * 100).toFixed(0) +
          "%)\n";
        msg += "Module system: " + moduleSystem + "\n";
        msg += "Lines: " + lineCount + "\n";
        msg +=
          "Features: " +
          (features.length > 0 ? features.join(", ") : "none detected");

        return {
          success: true,
          result: { ...detection, moduleSystem, features, lineCount },
          message: msg,
        };
      }

      const isPreview = !!previewMatch;
      const match = translateMatch || previewMatch;
      if (!match) {
        if (!input) {
          return {
            success: true,
            result: {
              supportedTranslations: [
                "JS→TS",
                "TS→JS",
                "Python→JS",
                "JS→Python",
              ],
            },
            message:
              "Code Translator\n" +
              "=".repeat(20) +
              "\nUsage:\n  /code-translator --translate <file> --to <lang>\n  /code-translator --detect <file>\n  /code-translator --preview <file> --to <lang>\n\nSupported: JS↔TS, Python↔JS",
          };
        }
        return {
          success: false,
          error:
            "Invalid syntax. Usage: /code-translator --translate <file> --to <lang>",
          message: "Usage: /code-translator --translate <file> --to <lang>",
        };
      }

      const filePath = path.isAbsolute(match[1])
        ? match[1]
        : path.resolve(projectRoot, match[1]);
      const targetLang = match[2].toLowerCase();
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: "File not found: " + filePath,
          message: "File not found: " + filePath,
        };
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const detection = detectLanguage(filePath, content);

      // Select translation function
      const translatorKey = detection.language + "->" + targetLang;
      const translators = {
        "javascript->typescript": jsToTs,
        "javascript->ts": jsToTs,
        "typescript->javascript": tsToJs,
        "typescript->js": tsToJs,
        "python->javascript": pyToJs,
        "python->js": pyToJs,
        "javascript->python": jsToPy,
        "javascript->py": jsToPy,
      };

      const translator = translators[translatorKey];
      if (!translator) {
        return {
          success: false,
          error:
            "Unsupported translation: " +
            detection.language +
            " → " +
            targetLang,
          message:
            "Unsupported: " +
            detection.language +
            " → " +
            targetLang +
            ". Supported: JS↔TS, Python↔JS",
        };
      }

      const { code, mappings, targetExt, untranslatable } = translator(content);

      if (isPreview) {
        let msg = "Translation Preview\n" + "=".repeat(30) + "\n";
        msg +=
          "Source: " +
          path.relative(projectRoot, filePath) +
          " (" +
          detection.language +
          ")\n";
        msg += "Target: " + targetLang + "\n";
        msg +=
          "Mappings (" +
          mappings.length +
          "):\n" +
          mappings.map((m) => "  - " + m).join("\n");
        if (untranslatable && untranslatable.length > 0) {
          msg +=
            "\n\nUntranslatable (" +
            untranslatable.length +
            "):\n" +
            untranslatable.map((u) => "  ⚠ " + u).join("\n");
        }
        return {
          success: true,
          result: {
            sourceLanguage: detection.language,
            targetLanguage: targetLang,
            mappings,
            untranslatable: untranslatable || [],
          },
          message: msg,
        };
      }

      // Full translation
      const baseName = path.basename(filePath, path.extname(filePath));
      const targetPath = path.join(
        path.dirname(filePath),
        baseName + targetExt,
      );
      const relTarget = path.relative(projectRoot, targetPath);

      let msg = "Code Translation\n" + "=".repeat(30) + "\n";
      msg +=
        "Source: " +
        path.relative(projectRoot, filePath) +
        " (" +
        detection.language +
        ")\n";
      msg += "Target: " + relTarget + " (" + targetLang + ")\n";
      msg += "Mappings applied: " + mappings.length + "\n";
      if (untranslatable && untranslatable.length > 0) {
        msg +=
          "Untranslatable: " +
          untranslatable.length +
          " (manual review needed)\n";
      }
      msg += "\n--- Translated Code ---\n" + code.substring(0, 2000);
      if (code.length > 2000) {
        msg += "\n... (truncated, " + code.split("\n").length + " total lines)";
      }

      return {
        success: true,
        result: {
          sourceLanguage: detection.language,
          targetLanguage: targetLang,
          translatedCode: code,
          targetPath: relTarget,
          mappings,
          untranslatable: untranslatable || [],
        },
        message: msg,
      };
    } catch (err) {
      logger.error("[code-translator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Code translator failed: " + err.message,
      };
    }
  },
};
