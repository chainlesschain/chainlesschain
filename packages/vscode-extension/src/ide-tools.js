/**
 * The IDE tools exposed to the agent (server `ide` → mcp__ide__*):
 *   getSelection / getDiagnostics / getOpenEditors / openDiff
 *   (+ executeCode, only when the host editor can run notebook code)
 *
 * Each tool delegates to an injected `editor` facade so this module stays free
 * of any `vscode` dependency and is unit-testable with a fake facade. The real
 * facade (vscode-facade.js) wraps the VS Code API. Handlers return plain data;
 * the MCP server wraps it into a `content` result.
 *
 * Facade contract (all may be async):
 *   getSelection()                      -> { file, languageId?, selection, text } | null
 *   getDiagnostics({ path? })           -> [{ file, severity, message, line, character, source? }]
 *   getOpenEditors()                    -> [{ file, active, languageId? }]
 *   openDiff({ path, originalText?, modifiedText, title? }) -> { shown, ... }
 *   executeCode?({ code, timeoutMs? })  -> { success, outputs:[{mime,text}] }
 *     OPTIONAL — when absent (e.g. the JetBrains plugin, or a VS Code host
 *     without notebook support) the executeCode tool is simply not exposed,
 *     so every existing 4-tool consumer keeps working unchanged.
 */

function buildIdeTools(editor) {
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
      name: "getDiagnostics",
      description:
        "Return current diagnostics (errors/warnings from linters, type " +
        "checkers, etc.). Optionally scope to a single file via `path`.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute file path to scope diagnostics to (optional).",
          },
        },
      },
      handler: async (args = {}) => {
        const diags = await editor.getDiagnostics({ path: args.path });
        return { diagnostics: Array.isArray(diags) ? diags : [] };
      },
    },
    {
      name: "getOpenEditors",
      description:
        "List the files currently open in editor tabs, flagging the active one.",
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
          path: { type: "string", description: "Absolute path of the file to diff." },
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
        const res = await editor.openDiff({
          path: args.path,
          modifiedText: args.modifiedText,
          originalText: args.originalText,
          title: args.title,
        });
        // Fail-safe: a facade that returns nothing is treated as "not applied".
        return res || { outcome: "rejected", path: args.path };
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
                throw new Error("openMultiDiff requires a non-empty `files` array");
              }
              const res = await editor.openMultiDiff({
                files: args.files,
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
  ];
}

module.exports = { buildIdeTools };
