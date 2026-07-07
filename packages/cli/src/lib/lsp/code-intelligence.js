/**
 * CodeIntelligence — the high-level, agent- and CLI-facing API for semantic
 * code navigation. Wraps LSPManager and normalizes every LSP result shape into
 * a flat `{ file, line, col, endLine?, endCol?, snippet? }` form with 1-based
 * positions and native paths. Callers never see raw LSP URIs or 0-based ranges.
 *
 * Every method degrades gracefully: when no language server is installed for the
 * file, it returns `{ available: false, reason }` instead of throwing, so the
 * agent can fall back to text search (`search_files`).
 */

import fs from "fs";
import path from "path";
import { LSPManager, toLspPosition, fromLspPosition } from "./lsp-manager.js";
import { fileUriToPath } from "./lsp-client.js";
import { ensurePluginLspServers } from "../plugin-runtime/lsp.js";

export const _deps = { readFileSync: fs.readFileSync };

const SYMBOL_KIND_NAMES = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum-member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type-parameter",
};

const DIAGNOSTIC_SEVERITY = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint",
};

export class CodeIntelligence {
  constructor(opts = {}) {
    // Register any plugin-contributed language servers (.lsp.json) for this
    // project before the first query — once per root, best-effort. This is how
    // a plugin extends code_intelligence to a new language with no core change.
    try {
      ensurePluginLspServers({ cwd: opts.projectRoot || process.cwd() });
    } catch {
      /* plugin LSP contributions are best-effort */
    }
    this.manager =
      opts.manager || new LSPManager({ projectRoot: opts.projectRoot });
    this._ownsManager = !opts.manager;
    // One-shot callers (the `cc code-intel` CLI) spawn a cold server per run and
    // must wait for the project to load before querying; the long-lived agent
    // session keeps servers warm and leaves this off for latency.
    this._ensureOpts = opts.coldStart ? { waitReady: true } : {};
  }

  _ensure(filePath) {
    return this.manager.ensureFor(filePath, this._ensureOpts);
  }

  /** Resolve the symbol under a 1-based position to its definition location(s). */
  async definition(filePath, line, col) {
    return this._locationQuery("textDocument/definition", filePath, line, col);
  }

  /** Find references to the symbol under a 1-based position. */
  async references(filePath, line, col, { includeDeclaration = true } = {}) {
    const ready = await this._ensure(filePath);
    if (ready.unavailable) return unavailable(ready.reason);
    const result = await this._readRequest(
      ready.client,
      "textDocument/references",
      {
        textDocument: { uri: ready.uri },
        position: toLspPosition({ line, col }),
        context: { includeDeclaration },
      },
    );
    return { available: true, locations: this._normalizeLocations(result) };
  }

  /** Hover / type info at a 1-based position. */
  async hover(filePath, line, col) {
    const ready = await this._ensure(filePath);
    if (ready.unavailable) return unavailable(ready.reason);
    const result = await this._readRequest(ready.client, "textDocument/hover", {
      textDocument: { uri: ready.uri },
      position: toLspPosition({ line, col }),
    });
    return { available: true, contents: extractHoverText(result) };
  }

  /** Symbols declared in one document (hierarchical or flat). */
  async documentSymbols(filePath) {
    const ready = await this._ensure(filePath);
    if (ready.unavailable) return unavailable(ready.reason);
    const result = await this._readRequest(
      ready.client,
      "textDocument/documentSymbol",
      {
        textDocument: { uri: ready.uri },
      },
    );
    return {
      available: true,
      symbols: this._normalizeSymbols(result, ready.uri),
    };
  }

  /** Workspace-wide symbol search by name. */
  async workspaceSymbols(query, { anyFile } = {}) {
    // Need a running server; bootstrap one via any known file in the project.
    const seed = anyFile || (await this._anyProjectFile());
    if (!seed) return unavailable("no indexable file found to start a server");
    const ready = await this.manager.ensureFor(seed, this._ensureOpts);
    if (ready.unavailable) return unavailable(ready.reason);
    const result = await this._readRequest(ready.client, "workspace/symbol", {
      query,
    });
    return { available: true, symbols: this._normalizeSymbols(result) };
  }

  /**
   * Diagnostics for a file. Prefers PULL diagnostics (`textDocument/diagnostic`,
   * LSP 3.17) — a synchronous request the server answers only after the project
   * is loaded, which avoids the push-model race where tsserver emits an empty
   * set first and republishes real errors later. Falls back to the push model
   * (wait-for-publish + settle) for servers without pull support.
   */
  async diagnostics(filePath, { timeoutMs = 5000 } = {}) {
    const ready = await this._ensure(filePath);
    if (ready.unavailable) return unavailable(ready.reason);
    const raw = await this._collectDiagnostics(ready, filePath, timeoutMs);
    return {
      available: true,
      diagnostics: raw.map((d) => this._normalizeDiagnostic(d)),
    };
  }

  /** Notify the server a file changed on disk (call after an edit), then re-diagnose. */
  async refreshFile(filePath, { timeoutMs = 5000 } = {}) {
    const ready = await this.manager.didChangeFile(filePath, this._ensureOpts);
    if (ready.unavailable) return unavailable(ready.reason);
    const raw = await this._collectDiagnostics(ready, filePath, timeoutMs);
    return {
      available: true,
      diagnostics: raw.map((d) => this._normalizeDiagnostic(d)),
    };
  }

  async _collectDiagnostics(ready, filePath, timeoutMs) {
    const caps = ready.client.serverCapabilities || {};
    if (caps.diagnosticProvider) {
      try {
        const report = await this._readRequest(
          ready.client,
          "textDocument/diagnostic",
          { textDocument: { uri: ready.uri } },
          { timeoutMs },
        );
        // full report → { kind:"full", items:[...] }; unchanged → keep last push
        if (report && Array.isArray(report.items)) return report.items;
      } catch {
        // server advertised but errored — fall back to the push model
      }
    }
    return this.manager.waitForDiagnostics(filePath, { timeoutMs });
  }

  /**
   * Preview a rename: returns the WorkspaceEdit as a flat list of per-file text
   * edits WITHOUT applying anything. Applying is left to the caller (agent
   * edit_file / a future apply step) so the change stays reviewable.
   */
  async renamePreview(filePath, line, col, newName) {
    const ready = await this._ensure(filePath);
    if (ready.unavailable) return unavailable(ready.reason);
    const result = await this._readRequest(
      ready.client,
      "textDocument/rename",
      {
        textDocument: { uri: ready.uri },
        position: toLspPosition({ line, col }),
        newName,
      },
    );
    return { available: true, edits: this._normalizeWorkspaceEdit(result) };
  }

  async dispose() {
    if (this._ownsManager) await this.manager.disposeAll();
  }

  // ---- internals ----

  /**
   * Issue an idempotent READ request with a bounded ContentModified retry.
   * LSP -32801 (ContentModified) means "server state changed mid-request —
   * the result would be stale, ask again"; rust-analyzer emits it freely
   * while its index is still settling after didOpen. Read-only queries can
   * always be retried; mutating requests must NOT go through here.
   */
  async _readRequest(client, method, params, opts) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await client.request(method, params, opts);
      } catch (err) {
        const contentModified =
          err?.code === -32801 || /content modified/i.test(err?.message || "");
        if (!contentModified) throw err;
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async _locationQuery(method, filePath, line, col) {
    const ready = await this._ensure(filePath);
    if (ready.unavailable) return unavailable(ready.reason);
    const result = await this._readRequest(ready.client, method, {
      textDocument: { uri: ready.uri },
      position: toLspPosition({ line, col }),
    });
    return { available: true, locations: this._normalizeLocations(result) };
  }

  _normalizeLocations(result) {
    if (!result) return [];
    const arr = Array.isArray(result) ? result : [result];
    return arr
      .map((loc) => {
        // LocationLink has targetUri/targetRange; Location has uri/range.
        const uri = loc.uri || loc.targetUri;
        const range = loc.range || loc.targetSelectionRange || loc.targetRange;
        if (!uri || !range) return null;
        const file = fileUriToPath(uri);
        const start = fromLspPosition(range.start);
        const end = fromLspPosition(range.end);
        return {
          file,
          line: start.line,
          col: start.col,
          endLine: end.line,
          endCol: end.col,
          snippet: this._lineSnippet(file, start.line),
        };
      })
      .filter(Boolean);
  }

  _normalizeSymbols(result, docUri) {
    if (!Array.isArray(result)) return [];
    const out = [];
    const walk = (sym, container) => {
      // DocumentSymbol has .range/.selectionRange/.children; SymbolInformation
      // has .location.
      const uri = sym.location?.uri || docUri;
      const range = sym.selectionRange || sym.range || sym.location?.range;
      const file = fileUriToPath(uri);
      const start = range ? fromLspPosition(range.start) : { line: 1, col: 1 };
      out.push({
        name: sym.name,
        kind: SYMBOL_KIND_NAMES[sym.kind] || String(sym.kind),
        container: sym.containerName || container || null,
        file,
        line: start.line,
        col: start.col,
      });
      if (Array.isArray(sym.children)) {
        for (const child of sym.children) walk(child, sym.name);
      }
    };
    for (const sym of result) walk(sym, null);
    return out;
  }

  _normalizeDiagnostic(d) {
    const start = fromLspPosition(d.range?.start);
    const end = fromLspPosition(d.range?.end);
    return {
      severity: DIAGNOSTIC_SEVERITY[d.severity] || "error",
      message: d.message,
      line: start.line,
      col: start.col,
      endLine: end.line,
      endCol: end.col,
      source: d.source || null,
      code: d.code != null ? String(d.code) : null,
    };
  }

  _normalizeWorkspaceEdit(result) {
    const edits = [];
    if (!result) return edits;
    if (result.changes) {
      for (const [uri, textEdits] of Object.entries(result.changes)) {
        edits.push({
          file: fileUriToPath(uri),
          edits: textEdits.map(mapTextEdit),
        });
      }
    }
    if (Array.isArray(result.documentChanges)) {
      for (const dc of result.documentChanges) {
        if (dc.textDocument && Array.isArray(dc.edits)) {
          edits.push({
            file: fileUriToPath(dc.textDocument.uri),
            edits: dc.edits.map(mapTextEdit),
          });
        }
      }
    }
    return edits;
  }

  _lineSnippet(file, line) {
    try {
      const text = _deps.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      return (lines[line - 1] || "").trim();
    } catch {
      return "";
    }
  }

  async _anyProjectFile() {
    // Cheap heuristic: pick the manager's root and look for a common entry file.
    const root = this.manager.projectRoot;
    const candidates = [
      "src/index.ts",
      "src/index.js",
      "index.ts",
      "index.js",
      "main.py",
      "main.go",
    ];
    for (const c of candidates) {
      const full = path.join(root, c);
      try {
        _deps.readFileSync(full, "utf8");
        return full;
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

function mapTextEdit(te) {
  const start = fromLspPosition(te.range?.start);
  const end = fromLspPosition(te.range?.end);
  return {
    line: start.line,
    col: start.col,
    endLine: end.line,
    endCol: end.col,
    newText: te.newText,
  };
}

function extractHoverText(result) {
  if (!result || !result.contents) return "";
  const c = result.contents;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((x) => (typeof x === "string" ? x : x.value || "")).join("\n");
  }
  return c.value || "";
}

function unavailable(reason) {
  return { available: false, reason: reason || "language server unavailable" };
}
