/**
 * The IDE tools exposed to the agent (server `ide` → mcp__ide__*):
 *   getSelection / getActiveFile / getDiagnostics / getOpenEditors / openDiff
 *   (+ executeCode, only when the host editor can run notebook code)
 *
 * Each tool delegates to an injected `editor` facade so this module stays free
 * of any `vscode` dependency and is unit-testable with a fake facade. The real
 * facade (vscode-facade.js) wraps the VS Code API. Handlers return plain data;
 * the MCP server wraps it into a `content` result.
 *
 * Facade contract (all may be async):
 *   getSelection()                      -> { file, languageId?, selection, text } | null
 *   getActiveFile()                     -> { file, languageId?, isDirty?, cursor? } | null
 *   getDiagnostics({ path? })           -> [{ file, severity, message, line, character, source? }]
 *   getOpenEditors()                    -> [{ file, active, languageId?, isDirty? }]
 *   openDiff({ path, originalText?, modifiedText, title? }) -> { shown, ... }
 *   executeCode?({ code, timeoutMs? })  -> { success, outputs:[{mime,text}] }
 *     OPTIONAL — when absent (e.g. the JetBrains plugin, or a VS Code host
 *     without notebook support) the executeCode tool is simply not exposed,
 *     so every existing 4-tool consumer keeps working unchanged.
 *   lsp?                                -> semantic navigation capability
 *     OPTIONAL — an object of raw language-server queries (see the contract
 *     in semantic-tools.js). When present, the semantic tools (getHover,
 *     goToDefinition, findReferences, renamePreview, getCallHierarchy,
 *     getSymbolInfo, getProjectModel) are exposed; when absent nothing
 *     changes for existing consumers.
 */

const { buildSemanticTools } = require("./semantic-tools");
const { validateIdeToolPath } = require("./ide-path-guard");
const { buildDiffReviewAudit } = require("./diff-review-audit");

/**
 * Resolve the workspace folders that bound where the path-taking IDE tools
 * (openDiff / openMultiDiff / getDiagnostics) may operate. Priority:
 *   1. options.getWorkspaceFolders — explicit injection (tests, other hosts)
 *   2. editor.getWorkspaceFolders() — facades that expose folders directly
 *   3. editor.lsp.workspaceRoots() — the VS Code facade's semantic capability
 *   4. the live `vscode` API — lazy require so this module stays vscode-free
 *      and unit-testable outside a VS Code host
 * Returns an array of folder paths, [] when a provider exists but no folder
 * is open (fail-closed: everything is rejected), or null when NO provider is
 * reachable at all — only pure-logic test hosts hit that, and they keep the
 * historical unguarded behavior.
 */
async function resolveWorkspaceFolders(editor, options) {
  if (typeof options.getWorkspaceFolders === "function") {
    try {
      const v = await options.getWorkspaceFolders();
      return Array.isArray(v) ? v : [];
    } catch {
      return []; // provider exists but failed → fail-closed
    }
  }
  if (editor && typeof editor.getWorkspaceFolders === "function") {
    try {
      const v = await editor.getWorkspaceFolders();
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  if (editor && editor.lsp && typeof editor.lsp.workspaceRoots === "function") {
    try {
      const roots = await editor.lsp.workspaceRoots();
      return (Array.isArray(roots) ? roots : [])
        .map((r) => (typeof r === "string" ? r : r && r.path))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  try {
    // `vscode` is only resolvable inside an extension host; unit tests fall
    // through to the catch.
    const vscode = require("vscode");
    const folders = vscode?.workspace?.workspaceFolders;
    if (!Array.isArray(folders)) return [];
    return folders.map((f) => f?.uri?.fsPath).filter(Boolean);
  } catch {
    return null; // no boundary provider (pure-logic host)
  }
}

function buildIdeTools(editor, options = {}) {
  /**
   * Enforce the workspace path boundary for a tool-supplied path. Returns the
   * resolved path to forward to the facade; throws an Error (which the MCP
   * server surfaces as an isError result — same shape as the existing
   * argument-validation throws, never a transport crash) when the path is
   * outside the workspace. `access` distinguishes the read/write wording.
   */
  async function guardToolPath(rawPath, access, tool) {
    const folders = await resolveWorkspaceFolders(editor, options);
    if (folders === null) return rawPath; // no boundary provider (see above)
    const v = validateIdeToolPath(rawPath, folders);
    if (!v.ok) {
      throw new Error(
        access === "read"
          ? `${tool}: unsafe read path rejected: ${v.reason}`
          : `${tool}: unsafe write target rejected: ${v.reason}`,
      );
    }
    return v.resolved;
  }
  return [
    {
      name: "getSelection",
      description:
        "Return the active editor's current selection: file path, language, " +
        "the selected range, and the selected text (empty selection returns " +
        "the cursor position with no text). Returns null when no editor is active.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const sel = await editor.getSelection();
        return sel || null;
      },
    },
    {
      name: "getActiveFile",
      description:
        "Return the active editor's file path, language, dirty state, and " +
        "cursor position without including selected text. Use this when you " +
        "only need the current file context.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        if (typeof editor.getActiveFile === "function") {
          return (await editor.getActiveFile()) || null;
        }
        const sel = await editor.getSelection();
        if (!sel) return null;
        return {
          file: sel.file || null,
          languageId: sel.languageId,
          cursor: sel.selection?.start || null,
        };
      },
    },
    {
      name: "getDiagnostics",
      description:
        "Return current diagnostics (errors/warnings from linters, type " +
        "checkers, etc.). Optionally scope to a single file via `path`.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute file path to scope diagnostics to (optional).",
          },
        },
      },
      handler: async (args = {}) => {
        let scopePath = args.path;
        if (scopePath !== undefined && scopePath !== null && scopePath !== "") {
          scopePath = await guardToolPath(scopePath, "read", "getDiagnostics");
        }
        const diags = await editor.getDiagnostics({ path: scopePath });
        return { diagnostics: Array.isArray(diags) ? diags : [] };
      },
    },
    {
      name: "getOpenEditors",
      description:
        "List the files currently open in editor tabs, flagging the active " +
        "one and whether each has unsaved changes (isDirty: the on-disk copy " +
        "is stale, so read it from the editor or ask the user to save first).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const eds = await editor.getOpenEditors();
        return { editors: Array.isArray(eds) ? eds : [] };
      },
    },
    {
      name: "openDiff",
      description:
        "Open a native side-by-side diff in the editor for the user to review " +
        "a proposed change, then BLOCK until they decide. `path` is the target " +
        "file; `modifiedText` is the proposed new content; `originalText` " +
        "defaults to the file's current content. The user can accept (the " +
        "possibly-edited text is written to the file), reject, or request " +
        "changes by annotating specific lines. Returns " +
        "{ outcome: 'accepted'|'rejected'|'changes-requested', path, " +
        "finalText?, comments? } — on 'changes-requested' the file is NOT " +
        "written and `comments` carries the reviewer's line-anchored revision " +
        "notes to act on. This call can take a while, that is expected.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the file to diff.",
          },
          modifiedText: {
            type: "string",
            description: "Proposed new file content (right-hand side).",
          },
          originalText: {
            type: "string",
            description:
              "Original content (left-hand side); defaults to the file on disk.",
          },
          title: { type: "string", description: "Diff tab title (optional)." },
        },
        required: ["path", "modifiedText"],
      },
      handler: async (args = {}) => {
        if (!args.path || typeof args.modifiedText !== "string") {
          throw new Error("openDiff requires `path` and `modifiedText`");
        }
        // Write-capable tool: the target must live inside the workspace.
        const safePath = await guardToolPath(args.path, "write", "openDiff");
        const res = await editor.openDiff({
          path: safePath,
          modifiedText: args.modifiedText,
          originalText: args.originalText,
          title: args.title,
        });
        // Fail-safe: a facade that returns nothing is treated as "not applied".
        const result = res || { outcome: "rejected", path: safePath };
        const publicResult = { ...result };
        const auditBaselineText =
          typeof args.originalText === "string"
            ? args.originalText
            : typeof publicResult._auditBaselineText === "string"
              ? publicResult._auditBaselineText
              : undefined;
        delete publicResult._auditBaselineText;
        return {
          ...publicResult,
          audit: buildDiffReviewAudit({
            path: safePath,
            originalText: auditBaselineText,
            proposedText: args.modifiedText,
            result: publicResult,
            host: "vscode",
          }),
        };
      },
    },
    // Conditional: batch multi-file diff review. Only exposed when the facade
    // supports it (VS Code; the JetBrains plugin reviews one file at a time).
    ...(typeof editor.openMultiDiff === "function"
      ? [
          {
            name: "openMultiDiff",
            description:
              "Review MULTIPLE proposed file changes together in one native " +
              "multi-file diff, then BLOCK until the user decides. Prefer this " +
              "over several openDiff calls when a change spans several files — " +
              "the user sees the whole changeset at once and can Accept all, " +
              "pick a subset, or Reject. `files` is a list of " +
              "{ path, modifiedText, originalText? } (originalText defaults to " +
              "the file on disk). Accepted files are written for you. Returns " +
              "{ outcome:'accepted'|'rejected', applied?, total?, files? }.",
            inputSchema: {
              type: "object",
              properties: {
                files: {
                  type: "array",
                  description: "The proposed file changes to review together.",
                  items: {
                    type: "object",
                    properties: {
                      path: {
                        type: "string",
                        description: "Absolute path of the file.",
                      },
                      modifiedText: {
                        type: "string",
                        description: "Proposed new content for this file.",
                      },
                      originalText: {
                        type: "string",
                        description:
                          "Original content; defaults to the file on disk.",
                      },
                    },
                    required: ["path", "modifiedText"],
                  },
                },
                title: {
                  type: "string",
                  description: "Multi-diff tab title (optional).",
                },
              },
              required: ["files"],
            },
            handler: async (args = {}) => {
              if (!Array.isArray(args.files) || args.files.length === 0) {
                throw new Error(
                  "openMultiDiff requires a non-empty `files` array",
                );
              }
              // Write-capable tool: EVERY target must live inside the
              // workspace — one bad path rejects the whole batch (no partial
              // silent drop).
              const safeFiles = [];
              for (const f of args.files) {
                const safePath = await guardToolPath(
                  f && f.path,
                  "write",
                  "openMultiDiff",
                );
                safeFiles.push({ ...f, path: safePath });
              }
              const res = await editor.openMultiDiff({
                files: safeFiles,
                title: args.title,
              });
              return res || { outcome: "rejected" };
            },
          },
        ]
      : []),
    // Conditional: recent terminal commands + output (shell integration).
    // Only exposed when the facade supports it (VS Code 1.93+ host).
    ...(typeof editor.getTerminalOutput === "function"
      ? [
          {
            name: "getTerminalOutput",
            description:
              "Return the most recent shell commands run in the editor's " +
              "integrated terminal and their output (and exit code) — so you " +
              "can see what the user just ran and how it failed, without " +
              "asking them to paste it. `limit` caps how many recent commands " +
              "(default 3). Empty if the host has no shell integration or no " +
              "command has run yet.",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description:
                    "How many recent terminal commands to return (default 3).",
                },
              },
            },
            handler: async (args = {}) => {
              const res = await editor.getTerminalOutput({ limit: args.limit });
              return res && Array.isArray(res.terminals)
                ? res
                : { terminals: [] };
            },
          },
        ]
      : []),
    // Conditional: App Preview state (dev server URL + recent output).
    ...(typeof editor.getPreviewState === "function"
      ? [
          {
            name: "getPreviewState",
            description:
              "Return the App Preview dev server's state: whether it is " +
              "running, its served URL, the npm script, the last exit code " +
              "and the recent server output (build/runtime errors included) " +
              "— so you can diagnose the preview without asking the user to " +
              "paste the terminal. Fetch the URL yourself if you need the " +
              "page content.",
            inputSchema: { type: "object", properties: {} },
            handler: async () => {
              const res = await editor.getPreviewState();
              return res && typeof res === "object"
                ? res
                : { running: false, url: null, script: null, output: "" };
            },
          },
        ]
      : []),
    // Conditional 5th tool: notebook code execution (Claude-Code
    // mcp__ide__executeCode parity). Only exposed when the facade supports it.
    ...(typeof editor.executeCode === "function"
      ? [
          {
            name: "executeCode",
            description:
              "Execute code in the kernel of the ACTIVE Jupyter notebook " +
              "and return its outputs. Kernel state persists across calls " +
              "(variables stay defined). Requires an open notebook with a " +
              "running kernel; fails with a clear error otherwise.",
            inputSchema: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description: "The code to execute in the notebook kernel.",
                },
                timeout_ms: {
                  type: "number",
                  description:
                    "Cancel the execution after this many ms (default 120000).",
                },
              },
              required: ["code"],
            },
            handler: async (args = {}) => {
              if (typeof args.code !== "string" || !args.code.length) {
                throw new Error("executeCode requires `code`");
              }
              const res = await editor.executeCode({
                code: args.code,
                timeoutMs: args.timeout_ms,
              });
              return res || { success: false, outputs: [] };
            },
          },
        ]
      : []),
    // Conditional: semantic navigation tools (hover / definition / references
    // / rename preview / call hierarchy / containing symbols / project model)
    // backed by the host's language providers. Only exposed when the facade
    // supplies the `lsp` capability object (VS Code); the tool logic lives in
    // the pure semantic-tools.js module.
    ...(editor.lsp && typeof editor.lsp === "object"
      ? buildSemanticTools(editor.lsp)
      : []),
  ];
}

module.exports = { buildIdeTools };
