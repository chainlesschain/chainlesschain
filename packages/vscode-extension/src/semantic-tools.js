/**
 * Semantic navigation tools for the IDE bridge (gap-analysis #7 "deeper IDE
 * semantic tools"): getHover / goToDefinition / findReferences / renamePreview
 * / getCallHierarchy / getSymbolInfo / getProjectModel.
 *
 * Pure module — no `vscode` dependency. Every tool delegates raw language
 * queries to an injected `lsp` facade (vscode-facade.js implements it via
 * `vscode.commands.executeCommand('vscode.execute…Provider', …)`), so the
 * validation / shaping / capping logic here is unit-testable with fakes.
 *
 * Conventions:
 *  - Tool INPUT positions are 1-based (line 1 = first line, column 1 = first
 *    character) — the human/editor convention. They are converted to the
 *    0-based positions the lsp facade (and VS Code) expects.
 *  - Tool OUTPUT locations are `{ uri, range }` where `uri` is workspace-
 *    relative (forward slashes) when the file is under a workspace root, and
 *    `range` is 1-based `{ startLine, startCol, endLine, endCol }`.
 *
 * lsp facade contract (all async; positions here are 0-based):
 *   hover({ path, line, character })                -> Hover[]
 *   definition({ path, line, character })           -> (Location|LocationLink)[]
 *   references({ path, line, character })           -> Location[]
 *   prepareCallHierarchy({ path, line, character }) -> CallHierarchyItem[]
 *   incomingCalls(item)                             -> CallHierarchyIncomingCall[]
 *   outgoingCalls(item)                             -> CallHierarchyOutgoingCall[]
 *   documentSymbols({ path })                       -> (DocumentSymbol|SymbolInformation)[]
 *   workspaceRoots()                                -> [{ name, path }]
 *   openEditorLanguages()                           -> [{ file, languageId }]
 *   listFiles({ max })                              -> string[] (file paths)
 *
 * buildSemanticTools' optional `getContextMetadata({ file, tool })` callback
 * supplies additive `cc-ide-context/v2` metadata. Missing/failed providers
 * preserve the legacy payload byte-for-byte.
 */

const MAX_HOVER_CHARS = 8000;
const MAX_REFERENCES = 200;
const MAX_CALL_NODES = 100;
const MAX_FROM_RANGES = 20;
const MAX_PROJECT_FILES = 5000;
const MAX_SYMBOL_DEPTH = 64;

// VS Code SymbolKind enum (0-based, unlike the 1-based LSP wire form).
const SYMBOL_KIND_NAMES = [
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum-member",
  "struct",
  "event",
  "operator",
  "type-parameter",
];

function symbolKindName(kind) {
  return SYMBOL_KIND_NAMES[kind] || `symbol-${kind}`;
}

/**
 * Validate `{ path, line, column }` tool input (1-based line/column) and
 * convert to the 0-based `{ path, line, character }` the lsp facade expects.
 */
function requirePosition(args, tool) {
  const a = args || {};
  if (typeof a.path !== "string" || a.path.length === 0) {
    throw new Error(`${tool} requires \`path\` (absolute file path)`);
  }
  if (!Number.isInteger(a.line) || a.line < 1) {
    throw new Error(`${tool} requires an integer \`line\` >= 1 (1-based)`);
  }
  if (!Number.isInteger(a.column) || a.column < 1) {
    throw new Error(`${tool} requires an integer \`column\` >= 1 (1-based)`);
  }
  return { path: a.path, line: a.line - 1, character: a.column - 1 };
}

/** `uri` may be a vscode.Uri (fsPath), an LSP-style object, or a string. */
function uriToPath(uri) {
  if (uri == null) return "";
  if (typeof uri === "string") return uri;
  return uri.fsPath || uri.path || "";
}

/**
 * Make a path workspace-relative (forward slashes) when it lives under one of
 * the workspace roots; otherwise return it unchanged so it stays openable.
 */
function toWorkspaceRelative(fsPath, roots) {
  const p = String(fsPath || "");
  for (const r of Array.isArray(roots) ? roots : []) {
    const root = String((r && r.path) || "");
    if (!root) continue;
    if (p === root) return ".";
    if (p.startsWith(root + "/") || p.startsWith(root + "\\")) {
      return p.slice(root.length + 1).replace(/\\/g, "/");
    }
  }
  return p;
}

/** 0-based vscode Range → 1-based `{ startLine, startCol, endLine, endCol }`. */
function shapeRange(range) {
  if (!range || !range.start || !range.end) return null;
  return {
    startLine: (range.start.line ?? 0) + 1,
    startCol: (range.start.character ?? 0) + 1,
    endLine: (range.end.line ?? 0) + 1,
    endCol: (range.end.character ?? 0) + 1,
  };
}

/** Location OR LocationLink → `{ uri, range }` (workspace-relative, 1-based). */
function shapeLocation(loc, roots) {
  if (!loc) return null;
  const p = uriToPath(loc.targetUri || loc.uri);
  if (!p) return null;
  const range = loc.targetSelectionRange || loc.targetRange || loc.range;
  return { uri: toWorkspaceRelative(p, roots), range: shapeRange(range) };
}

/**
 * Flatten hover results to one plain string. `Hover.contents` can be a
 * MarkdownString (`{ value }`), a MarkedString (`{ language, value }` →
 * rendered as a fenced code block), a plain string, or an array of any of
 * those — and the provider command returns an ARRAY of Hovers. Truncated to
 * `maxChars` (default 8k).
 */
function flattenHoverContents(hovers, maxChars = MAX_HOVER_CHARS) {
  const parts = [];
  const list = Array.isArray(hovers) ? hovers : hovers != null ? [hovers] : [];
  for (const h of list) {
    const contents = h && h.contents != null ? h.contents : h;
    const items = Array.isArray(contents) ? contents : [contents];
    for (const c of items) {
      if (c == null) continue;
      if (typeof c === "string") {
        if (c.trim()) parts.push(c);
        continue;
      }
      if (typeof c.value === "string" && c.value.trim()) {
        parts.push(
          c.language ? "```" + c.language + "\n" + c.value + "\n```" : c.value,
        );
      }
    }
  }
  const text = parts.join("\n\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function positionInRange(range, pos) {
  if (!range || !range.start || !range.end) return false;
  const { line, character } = pos;
  if (line < range.start.line || line > range.end.line) return false;
  if (line === range.start.line && character < range.start.character) {
    return false;
  }
  if (line === range.end.line && character > range.end.character) return false;
  return true;
}

function rangeSpan(range) {
  if (!range || !range.start || !range.end) return Number.MAX_SAFE_INTEGER;
  return (
    (range.end.line - range.start.line) * 100000 +
    (range.end.character - range.start.character)
  );
}

/**
 * The chain of symbols containing a 0-based position, outermost → innermost.
 * Handles BOTH shapes executeDocumentSymbolProvider can return: nested
 * DocumentSymbol[] (with `children`) and flat SymbolInformation[] (with
 * `location`, sorted here by span so the widest symbol comes first).
 */
function symbolChainAt(symbols, pos) {
  const list = Array.isArray(symbols) ? symbols : [];
  if (list.length && list[0] && list[0].location) {
    return list
      .filter((s) => positionInRange(s.location && s.location.range, pos))
      .sort(
        (a, b) => rangeSpan(b.location.range) - rangeSpan(a.location.range),
      );
  }
  const chain = [];
  let level = list;
  for (let depth = 0; depth < MAX_SYMBOL_DEPTH; depth++) {
    const hit = (level || []).find((s) => s && positionInRange(s.range, pos));
    if (!hit) break;
    chain.push(hit);
    level = hit.children;
  }
  return chain;
}

function shapeHierarchyItem(item, roots) {
  if (!item) return null;
  return {
    name: item.name,
    kind: symbolKindName(item.kind),
    ...(item.detail ? { detail: item.detail } : {}),
    uri: toWorkspaceRelative(uriToPath(item.uri), roots),
    range: shapeRange(item.selectionRange || item.range),
  };
}

async function getRoots(lsp) {
  if (typeof lsp.workspaceRoots !== "function") return [];
  return (await lsp.workspaceRoots()) || [];
}

async function withContext(payload, file, tool, getContextMetadata) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof getContextMetadata !== "function"
  ) {
    return payload;
  }
  try {
    const context = await getContextMetadata({ file, tool });
    return context && typeof context === "object"
      ? { ...payload, context }
      : payload;
  } catch {
    // Context metadata is additive; semantic answers remain usable when a
    // host cannot inspect a document/version (old host, closed file, etc.).
    return payload;
  }
}

const POSITION_PROPS = {
  path: { type: "string", description: "Absolute file path." },
  line: {
    type: "number",
    description: "1-based line number (first line = 1).",
  },
  column: {
    type: "number",
    description: "1-based column number (first character = 1).",
  },
};

const POSITION_REQUIRED = ["path", "line", "column"];

/**
 * Build the semantic tool declarations (same shape as ide-tools.js entries).
 * ide-tools spreads these in only when the editor facade exposes `lsp`.
 */
function buildSemanticTools(lsp, getContextMetadata) {
  return [
    {
      name: "getHover",
      description:
        "Return the hover documentation (type signature, docs) the language " +
        "server shows at a position — the fastest way to learn a symbol's " +
        "type without reading its definition. `line`/`column` are 1-based. " +
        "Markdown is flattened to a plain string (truncated at 8k chars); " +
        "`hover` is null when the language server has nothing to show.",
      inputSchema: {
        type: "object",
        properties: POSITION_PROPS,
        required: POSITION_REQUIRED,
      },
      handler: async (args = {}) => {
        const target = requirePosition(args, "getHover");
        const roots = await getRoots(lsp);
        const hovers = await lsp.hover(target);
        const text = flattenHoverContents(hovers);
        return withContext(
          {
            uri: toWorkspaceRelative(target.path, roots),
            line: args.line,
            column: args.column,
            hover: text || null,
          },
          target.path,
          "getHover",
          getContextMetadata,
        );
      },
    },
    {
      name: "goToDefinition",
      description:
        "Return the definition location(s) of the symbol at a position — " +
        "this only RETURNS locations, it does not navigate the user's " +
        "editor. `line`/`column` are 1-based. Each result is " +
        "{ uri (workspace-relative when possible), range " +
        "{ startLine, startCol, endLine, endCol } (1-based) }.",
      inputSchema: {
        type: "object",
        properties: POSITION_PROPS,
        required: POSITION_REQUIRED,
      },
      handler: async (args = {}) => {
        const target = requirePosition(args, "goToDefinition");
        const roots = await getRoots(lsp);
        const defs = (await lsp.definition(target)) || [];
        const definitions = defs
          .map((d) => shapeLocation(d, roots))
          .filter(Boolean);
        return withContext(
          { definitions, total: definitions.length },
          target.path,
          "goToDefinition",
          getContextMetadata,
        );
      },
    },
    {
      name: "findReferences",
      description:
        "Find all references to the symbol at a position (semantic, via the " +
        "language server — more precise than text search). `line`/`column` " +
        "are 1-based; results use 1-based ranges and workspace-relative " +
        "uris. Capped at " +
        MAX_REFERENCES +
        " results (`limit` can only lower the cap); `truncated` is true " +
        "and `total` carries the real count when the cap was hit.",
      inputSchema: {
        type: "object",
        properties: {
          ...POSITION_PROPS,
          limit: {
            type: "number",
            description:
              "Max references to return (default and max " +
              MAX_REFERENCES +
              ").",
          },
        },
        required: POSITION_REQUIRED,
      },
      handler: async (args = {}) => {
        const target = requirePosition(args, "findReferences");
        const roots = await getRoots(lsp);
        const cap =
          Number.isInteger(args.limit) && args.limit > 0
            ? Math.min(args.limit, MAX_REFERENCES)
            : MAX_REFERENCES;
        const refs = (await lsp.references(target)) || [];
        const references = refs
          .slice(0, cap)
          .map((r) => shapeLocation(r, roots))
          .filter(Boolean);
        return withContext(
          {
            references,
            total: refs.length,
            truncated: refs.length > references.length,
          },
          target.path,
          "findReferences",
          getContextMetadata,
        );
      },
    },
    {
      name: "renamePreview",
      description:
        "Preview the blast radius of renaming the symbol at a position: " +
        "per-file occurrence counts derived from the language server's " +
        "references. NOTHING is renamed or modified — use this to judge a " +
        "rename's scope before editing. `line`/`column` are 1-based; " +
        "counting is capped at " +
        MAX_REFERENCES +
        " occurrences (`truncated` reports the cap).",
      inputSchema: {
        type: "object",
        properties: {
          ...POSITION_PROPS,
          newName: {
            type: "string",
            description:
              "The proposed new name (echoed back; optional, not applied).",
          },
        },
        required: POSITION_REQUIRED,
      },
      handler: async (args = {}) => {
        const target = requirePosition(args, "renamePreview");
        const roots = await getRoots(lsp);
        const refs = (await lsp.references(target)) || [];
        const counted = refs.slice(0, MAX_REFERENCES);
        const byFile = new Map();
        for (const r of counted) {
          const s = shapeLocation(r, roots);
          if (!s) continue;
          byFile.set(s.uri, (byFile.get(s.uri) || 0) + 1);
        }
        const files = [...byFile.entries()].map(([uri, occurrences]) => ({
          uri,
          occurrences,
        }));
        return withContext(
          {
            ...(typeof args.newName === "string" && args.newName
              ? { newName: args.newName }
              : {}),
            files,
            fileCount: files.length,
            totalOccurrences: refs.length,
            truncated: refs.length > counted.length,
            applied: false,
          },
          target.path,
          "renamePreview",
          getContextMetadata,
        );
      },
    },
    {
      name: "getCallHierarchy",
      description:
        "Return one level of the call hierarchy for the function/method at " +
        "a position: `callers` (who calls it) and `callees` (what it calls), " +
        "each with name, kind, location and the call-site ranges. " +
        "`line`/`column` are 1-based. Capped at " +
        MAX_CALL_NODES +
        " combined nodes (callers fill first; `truncated` reports the cap). " +
        "`item` is null when the language server has no hierarchy here.",
      inputSchema: {
        type: "object",
        properties: POSITION_PROPS,
        required: POSITION_REQUIRED,
      },
      handler: async (args = {}) => {
        const target = requirePosition(args, "getCallHierarchy");
        const roots = await getRoots(lsp);
        const items = (await lsp.prepareCallHierarchy(target)) || [];
        if (items.length === 0) {
          return withContext(
            { item: null, callers: [], callees: [], truncated: false },
            target.path,
            "getCallHierarchy",
            getContextMetadata,
          );
        }
        const item = items[0];
        const incoming = (await lsp.incomingCalls(item)) || [];
        const outgoing = (await lsp.outgoingCalls(item)) || [];
        const shapeCall = (node, ranges) => ({
          ...shapeHierarchyItem(node, roots),
          fromRanges: (ranges || [])
            .slice(0, MAX_FROM_RANGES)
            .map(shapeRange)
            .filter(Boolean),
        });
        const callers = incoming
          .slice(0, MAX_CALL_NODES)
          .map((c) => shapeCall(c.from, c.fromRanges));
        const callees = outgoing
          .slice(0, Math.max(0, MAX_CALL_NODES - callers.length))
          .map((c) => shapeCall(c.to, c.fromRanges));
        return withContext(
          {
            item: shapeHierarchyItem(item, roots),
            callers,
            callees,
            truncated:
              incoming.length > callers.length ||
              outgoing.length > callees.length,
          },
          target.path,
          "getCallHierarchy",
          getContextMetadata,
        );
      },
    },
    {
      name: "getSymbolInfo",
      description:
        "Return the chain of symbols CONTAINING a position (outermost → " +
        "innermost, e.g. class → method), from the document's symbol tree — " +
        'answers "which function/class owns this line?". `line`/`column` ' +
        "are 1-based; `symbol` is the innermost containing symbol (null " +
        "when the position is outside every symbol).",
      inputSchema: {
        type: "object",
        properties: POSITION_PROPS,
        required: POSITION_REQUIRED,
      },
      handler: async (args = {}) => {
        const target = requirePosition(args, "getSymbolInfo");
        const roots = await getRoots(lsp);
        const symbols =
          (await lsp.documentSymbols({ path: target.path })) || [];
        const chain = symbolChainAt(symbols, target).map((s) => ({
          name: s.name,
          kind: symbolKindName(s.kind),
          range: shapeRange(
            s.selectionRange || s.range || (s.location && s.location.range),
          ),
        }));
        return withContext(
          {
            uri: toWorkspaceRelative(target.path, roots),
            chain,
            symbol: chain.length ? chain[chain.length - 1] : null,
          },
          target.path,
          "getSymbolInfo",
          getContextMetadata,
        );
      },
    },
    {
      name: "getProjectModel",
      description:
        "Return a cheap structural overview of the workspace: workspace " +
        "folders, the language ids of currently open editors, and workspace " +
        "file counts grouped by extension (scan capped at " +
        MAX_PROJECT_FILES +
        " files, common build dirs excluded). Note: VS Code has no " +
        "language-level module/project model (unlike JetBrains), so this is " +
        "a file-system-shaped approximation.",
      inputSchema: {
        type: "object",
        properties: {
          maxFiles: {
            type: "number",
            description:
              "Max files to scan for the extension histogram (default and " +
              "max " +
              MAX_PROJECT_FILES +
              ").",
          },
        },
      },
      handler: async (args = {}) => {
        const roots = await getRoots(lsp);
        const maxFiles =
          Number.isInteger(args.maxFiles) && args.maxFiles > 0
            ? Math.min(args.maxFiles, MAX_PROJECT_FILES)
            : MAX_PROJECT_FILES;
        const open =
          typeof lsp.openEditorLanguages === "function"
            ? (await lsp.openEditorLanguages()) || []
            : [];
        const files =
          typeof lsp.listFiles === "function"
            ? (await lsp.listFiles({ max: maxFiles })) || []
            : [];
        const filesByExtension = {};
        for (const f of files) {
          const base = String(f).replace(/\\/g, "/").split("/").pop() || "";
          const dot = base.lastIndexOf(".");
          const ext = dot > 0 ? base.slice(dot).toLowerCase() : "(none)";
          filesByExtension[ext] = (filesByExtension[ext] || 0) + 1;
        }
        return withContext(
          {
            workspaceFolders: roots.map((r) => ({
              name: r.name,
              path: r.path,
            })),
            openEditors: open.map((d) => ({
              file: toWorkspaceRelative(d.file, roots),
              languageId: d.languageId,
            })),
            filesByExtension,
            scannedFiles: files.length,
            fileScanTruncated: files.length >= maxFiles,
          },
          null,
          "getProjectModel",
          getContextMetadata,
        );
      },
    },
  ];
}

module.exports = {
  buildSemanticTools,
  flattenHoverContents,
  toWorkspaceRelative,
  symbolChainAt,
  symbolKindName,
  shapeRange,
  shapeLocation,
  requirePosition,
  MAX_HOVER_CHARS,
  MAX_REFERENCES,
  MAX_CALL_NODES,
  MAX_PROJECT_FILES,
};
