/**
 * AST-based Merger (Level 2)
 * Semi-automatic merge using AST parsing (<2s)
 * Function-level independent merge, import union/dedup, Markdown section merge
 *
 * @module git/conflict-resolution/ast-merger
 * @version 1.2.0
 */

const { logger } = require("../../utils/logger.js");
const { MERGE_RESULT } = require("./rule-merger");

/**
 * ASTMerger - Level 2 conflict resolution
 * Uses AST parsing for code-aware merging
 */
class ASTMerger {
  constructor(options = {}) {
    this.supportedLanguages = options.supportedLanguages || [
      "javascript",
      "typescript",
      "markdown",
    ];

    // Try to load acorn parser
    this._acorn = null;
    try {
      this._acorn = require("acorn");
      logger.info("[ASTMerger] acorn parser loaded");
    } catch (_e) {
      logger.warn(
        "[ASTMerger] acorn not available, code AST merge will be limited",
      );
    }
  }

  /**
   * Attempt AST-based merge
   *
   * @param {Object} conflict
   * @param {string} conflict.base
   * @param {string} conflict.local
   * @param {string} conflict.remote
   * @param {string} conflict.filePath
   * @returns {{ result: string, merged: string|null, strategy: string, confidence: number }}
   */
  merge(conflict) {
    const { filePath } = conflict;
    const language = this._detectLanguage(filePath);

    switch (language) {
      case "javascript":
      case "typescript":
        return this._mergeCode(conflict);

      case "markdown":
        return this._mergeMarkdown(conflict);

      default:
        return {
          result: MERGE_RESULT.CONFLICT,
          merged: null,
          strategy: "ast-unsupported",
          confidence: 0,
        };
    }
  }

  /**
   * Merge JavaScript/TypeScript code using AST analysis
   */
  _mergeCode(conflict) {
    const { base, local, remote } = conflict;

    // Try import merge first
    const importResult = this._mergeImports(base, local, remote);
    if (importResult.success && importResult.fullyResolved) {
      return {
        result: MERGE_RESULT.MERGED,
        merged: importResult.content,
        strategy: "ast-import-merge",
        confidence: 0.9,
      };
    }

    // Try function-level merge
    const funcResult = this._mergeFunctions(base, local, remote);
    if (funcResult.success) {
      let merged = funcResult.content;

      // If imports were also merged, combine them
      if (importResult.success) {
        merged = this._replaceImportSection(merged, importResult.imports);
      }

      return {
        result: MERGE_RESULT.MERGED,
        merged,
        strategy: "ast-function-merge",
        confidence: 0.85,
      };
    }

    return {
      result: MERGE_RESULT.CONFLICT,
      merged: null,
      strategy: "ast-conflict",
      confidence: 0,
    };
  }

  /**
   * Merge import/require statements
   * Union of all imports with deduplication
   */
  _mergeImports(base, local, remote) {
    const baseImports = this._extractImports(base);
    const localImports = this._extractImports(local);
    const remoteImports = this._extractImports(remote);

    // Union all imports
    const mergedImports = new Map();

    // Start with base imports
    for (const imp of baseImports) {
      mergedImports.set(imp.key, imp);
    }

    // Add local imports (new ones)
    for (const imp of localImports) {
      mergedImports.set(imp.key, imp);
    }

    // Add remote imports (new ones)
    for (const imp of remoteImports) {
      if (!mergedImports.has(imp.key)) {
        mergedImports.set(imp.key, imp);
      }
    }

    // Sort imports
    const sortedImports = Array.from(mergedImports.values()).sort((a, b) => {
      // Sort: packages first, then local imports
      const aLocal = a.source.startsWith(".");
      const bLocal = b.source.startsWith(".");
      if (aLocal !== bLocal) {
        return aLocal ? 1 : -1;
      }
      return a.source.localeCompare(b.source);
    });

    // Check if only imports changed
    const localBody = this._removeImports(local);
    const remoteBody = this._removeImports(remote);
    const fullyResolved = localBody.trim() === remoteBody.trim();

    const importLines = sortedImports.map((imp) => imp.line);

    return {
      success: true,
      imports: importLines,
      content: fullyResolved
        ? importLines.join("\n") + "\n\n" + localBody
        : null,
      fullyResolved,
    };
  }

  /**
   * Extract import/require statements from code
   */
  _extractImports(code) {
    if (!code) {
      return [];
    }

    const imports = [];
    const lines = code.split("\n");

    for (const line of lines) {
      // ES6 import
      const esMatch = line.match(
        /^(import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]);?\s*$/,
      );
      if (esMatch) {
        imports.push({
          line: line.trim(),
          source: esMatch[2],
          key: `import:${esMatch[2]}`,
          type: "import",
        });
        continue;
      }

      // CommonJS require
      const cjsMatch = line.match(
        /^(const|let|var)\s+({[^}]*}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\);?\s*$/,
      );
      if (cjsMatch) {
        imports.push({
          line: line.trim(),
          source: cjsMatch[3],
          key: `require:${cjsMatch[3]}`,
          type: "require",
        });
        continue;
      }

      // Side-effect import
      const sideEffectMatch = line.match(/^import\s+['"]([^'"]+)['"]\s*;?\s*$/);
      if (sideEffectMatch) {
        imports.push({
          line: line.trim(),
          source: sideEffectMatch[1],
          key: `side-effect:${sideEffectMatch[1]}`,
          type: "side-effect",
        });
      }
    }

    return imports;
  }

  /**
   * Remove import section from code
   */
  _removeImports(code) {
    if (!code) {
      return "";
    }
    return code
      .split("\n")
      .filter((line) => {
        return !line.match(
          /^(import\s|const\s+\w+\s*=\s*require|let\s+\w+\s*=\s*require|var\s+\w+\s*=\s*require)/,
        );
      })
      .join("\n")
      .replace(/^\n+/, "");
  }

  /**
   * Replace import section in code
   */
  _replaceImportSection(code, importLines) {
    const body = this._removeImports(code);
    return importLines.join("\n") + "\n\n" + body;
  }

  /**
   * Function-level merge
   * Parse code into functions and merge independently
   */
  _mergeFunctions(base, local, remote) {
    const baseFuncs = this._extractFunctions(base);
    const localFuncs = this._extractFunctions(local);
    const remoteFuncs = this._extractFunctions(remote);

    if (!baseFuncs || !localFuncs || !remoteFuncs) {
      return { success: false };
    }

    const mergedFuncs = new Map();
    let hasConflict = false;

    // Collect all function names
    const allNames = new Set([
      ...baseFuncs.keys(),
      ...localFuncs.keys(),
      ...remoteFuncs.keys(),
    ]);

    for (const name of allNames) {
      const baseFunc = baseFuncs.get(name);
      const localFunc = localFuncs.get(name);
      const remoteFunc = remoteFuncs.get(name);

      // Both modified the same function differently
      if (localFunc && remoteFunc && baseFunc) {
        if (
          localFunc.body !== baseFunc.body &&
          remoteFunc.body !== baseFunc.body
        ) {
          if (localFunc.body !== remoteFunc.body) {
            // True conflict - same function modified differently
            hasConflict = true;
            break;
          }
        }
      }

      // Use local if it changed, otherwise remote, otherwise base
      if (localFunc && localFunc.body !== baseFunc?.body) {
        mergedFuncs.set(name, localFunc);
      } else if (remoteFunc && remoteFunc.body !== baseFunc?.body) {
        mergedFuncs.set(name, remoteFunc);
      } else if (localFunc) {
        mergedFuncs.set(name, localFunc);
      } else if (remoteFunc) {
        mergedFuncs.set(name, remoteFunc);
      }
    }

    if (hasConflict) {
      return { success: false };
    }

    // Reconstruct code from merged functions
    // Keep non-function code from local version
    const preamble = this._extractPreamble(local);
    const postamble = this._extractPostamble(local);

    const funcBodies = Array.from(mergedFuncs.values())
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((f) => f.fullText);

    const content = [preamble, ...funcBodies, postamble]
      .filter(Boolean)
      .join("\n\n");

    return { success: true, content };
  }

  /**
   * Extract functions from code using simple regex parsing
   * Falls back to regex when acorn is unavailable
   */
  _extractFunctions(code) {
    if (!code) {
      return new Map();
    }

    const functions = new Map();
    let order = 0;

    // Try acorn AST parsing first
    if (this._acorn) {
      try {
        const ast = this._acorn.parse(code, {
          ecmaVersion: "latest",
          sourceType: "module",
          allowImportExportEverywhere: true,
          allowReturnOutsideFunction: true,
        });

        for (const node of ast.body) {
          if (node.type === "FunctionDeclaration" && node.id) {
            const name = node.id.name;
            const fullText = code.slice(node.start, node.end);
            const body = code.slice(node.body.start, node.body.end);
            functions.set(name, { name, fullText, body, order: order++ });
          } else if (
            node.type === "ExportNamedDeclaration" &&
            node.declaration?.type === "FunctionDeclaration"
          ) {
            const name = node.declaration.id?.name || `anon_${order}`;
            const fullText = code.slice(node.start, node.end);
            const body = code.slice(
              node.declaration.body.start,
              node.declaration.body.end,
            );
            functions.set(name, { name, fullText, body, order: order++ });
          } else if (
            node.type === "VariableDeclaration" &&
            node.declarations[0]?.init?.type === "ArrowFunctionExpression"
          ) {
            const name = node.declarations[0].id?.name || `anon_${order}`;
            const fullText = code.slice(node.start, node.end);
            const body = code.slice(
              node.declarations[0].init.body.start,
              node.declarations[0].init.body.end,
            );
            functions.set(name, { name, fullText, body, order: order++ });
          }
        }

        return functions;
      } catch (parseError) {
        logger.warn(
          "[ASTMerger] AST parse failed, falling back to regex:",
          parseError.message,
        );
      }
    }

    // Regex fallback for function extraction
    const funcPattern =
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/gm;
    let match;

    while ((match = funcPattern.exec(code)) !== null) {
      const name = match[1];
      const startPos = match.index;

      // Find matching closing brace
      let braceCount = 0;
      let endPos = startPos;
      let inString = false;
      let stringChar = "";

      for (let i = match.index + match[0].length - 1; i < code.length; i++) {
        const ch = code[i];

        if (inString) {
          if (ch === stringChar && code[i - 1] !== "\\") {
            inString = false;
          }
          continue;
        }

        if (ch === '"' || ch === "'" || ch === "`") {
          inString = true;
          stringChar = ch;
          continue;
        }

        if (ch === "{") {
          braceCount++;
        } else if (ch === "}") {
          braceCount--;
          if (braceCount === 0) {
            endPos = i + 1;
            break;
          }
        }
      }

      const fullText = code.slice(startPos, endPos);
      const bodyStart = match[0].length - 1; // Position of opening brace
      const body = fullText.slice(bodyStart);

      functions.set(name, { name, fullText, body, order: order++ });
    }

    return functions;
  }

  /**
   * Extract code before the first function declaration
   */
  _extractPreamble(code) {
    if (!code) {
      return "";
    }
    const match = code.match(
      /^([\s\S]*?)(?:export\s+)?(?:async\s+)?function\s+\w+/,
    );
    return match ? match[1].trim() : "";
  }

  /**
   * Extract code after the last function declaration
   */
  _extractPostamble(code) {
    if (!code) {
      return "";
    }
    // Find the last closing brace that could be a function
    const lines = code.split("\n");
    let lastFuncEnd = -1;

    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].match(/^module\.exports|^export\s+/)) {
        lastFuncEnd = i;
        break;
      }
    }

    if (lastFuncEnd >= 0) {
      return lines.slice(lastFuncEnd).join("\n").trim();
    }
    return "";
  }

  // ==========================================
  // Markdown section-level merge
  // ==========================================

  /**
   * Merge Markdown files at section (heading) level
   */
  _mergeMarkdown(conflict) {
    const { base, local, remote } = conflict;

    const baseSections = this._parseMarkdownSections(base);
    const localSections = this._parseMarkdownSections(local);
    const remoteSections = this._parseMarkdownSections(remote);

    const mergedSections = [];
    let hasConflict = false;

    // Collect all section headings
    const allHeadings = new Set([
      ...baseSections.map((s) => s.heading),
      ...localSections.map((s) => s.heading),
      ...remoteSections.map((s) => s.heading),
    ]);

    for (const heading of allHeadings) {
      const baseSection = baseSections.find((s) => s.heading === heading);
      const localSection = localSections.find((s) => s.heading === heading);
      const remoteSection = remoteSections.find((s) => s.heading === heading);

      const baseContent = baseSection?.content || "";
      const localContent = localSection?.content || "";
      const remoteContent = remoteSection?.content || "";

      // Only local changed
      if (localContent !== baseContent && remoteContent === baseContent) {
        mergedSections.push(localSection || { heading, content: localContent });
        continue;
      }

      // Only remote changed
      if (localContent === baseContent && remoteContent !== baseContent) {
        mergedSections.push(
          remoteSection || { heading, content: remoteContent },
        );
        continue;
      }

      // Both changed to same thing
      if (localContent === remoteContent) {
        mergedSections.push(localSection || { heading, content: localContent });
        continue;
      }

      // Both changed differently - conflict at this section
      if (localContent !== baseContent && remoteContent !== baseContent) {
        hasConflict = true;
        break;
      }

      // No changes
      mergedSections.push(baseSection || { heading, content: baseContent });
    }

    if (hasConflict) {
      return {
        result: MERGE_RESULT.CONFLICT,
        merged: null,
        strategy: "markdown-section-conflict",
        confidence: 0,
      };
    }

    // Reconstruct Markdown
    const content = mergedSections
      .map((s) => {
        if (s.heading) {
          return `${s.headingLine || s.heading}\n\n${s.content}`;
        }
        return s.content;
      })
      .join("\n\n");

    return {
      result: MERGE_RESULT.MERGED,
      merged: content.trim() + "\n",
      strategy: "markdown-section-merge",
      confidence: 0.85,
    };
  }

  /**
   * Parse Markdown into sections by headings
   */
  _parseMarkdownSections(text) {
    if (!text) {
      return [];
    }

    const lines = text.split("\n");
    const sections = [];
    let currentSection = {
      heading: "",
      headingLine: "",
      content: "",
      lines: [],
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // Save current section
        if (currentSection.heading || currentSection.lines.length > 0) {
          currentSection.content = currentSection.lines.join("\n").trim();
          sections.push(currentSection);
        }
        // Start new section
        currentSection = {
          heading: headingMatch[2].trim(),
          headingLine: line,
          level: headingMatch[1].length,
          content: "",
          lines: [],
        };
      } else {
        currentSection.lines.push(line);
      }
    }

    // Save last section
    currentSection.content = currentSection.lines.join("\n").trim();
    sections.push(currentSection);

    return sections;
  }

  /**
   * Detect language from file path
   */
  _detectLanguage(filePath) {
    if (!filePath) {
      return "unknown";
    }
    const ext = filePath.split(".").pop()?.toLowerCase();

    const langMap = {
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
      md: "markdown",
      markdown: "markdown",
      py: "python",
    };

    return langMap[ext] || "unknown";
  }

  // ─── Public API wrappers for direct testing ──────────────────────────────

  /**
   * Public: merge import statements from two JS/TS files
   * @param {string} local - Local file content
   * @param {string} remote - Remote file content
   * @param {string} base - Base file content
   * @returns {string} Merged imports as string
   */
  mergeImports(local, remote, base) {
    const result = this._mergeImports(base, local, remote);
    return result.imports ? result.imports.join("\n") + "\n" : local;
  }

  /**
   * Public: merge markdown files by section heading
   * @param {string} base
   * @param {string} local
   * @param {string} remote
   * @returns {Object} { result, merged }
   */
  mergeMarkdown(base, local, remote) {
    return this._mergeMarkdown({ base, local, remote, filePath: "doc.md" });
  }

  /**
   * Public: merge JS function definitions
   * @param {string} local
   * @param {string} remote
   * @param {string} base
   * @returns {Object} { merged }
   */
  mergeFunctions(local, remote, base) {
    const result = this._mergeFunctions(base, local, remote);
    if (result.success) {
      return { merged: result.content };
    }
    return { merged: null };
  }
}

module.exports = {
  ASTMerger,
};
