/**
 * The four IDE tools exposed to the agent (server `ide` → mcp__ide__*):
 *   getSelection / getDiagnostics / getOpenEditors / openDiff
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
        "a proposed change. `path` is the target file; `modifiedText` is the " +
        "proposed new content; `originalText` defaults to the file's current " +
        "content. Returns once the diff is shown.",
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
        return res || { shown: true };
      },
    },
  ];
}

module.exports = { buildIdeTools };
