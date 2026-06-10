# ChainlessChain IDE Bridge (VS Code)

Bridges the ChainlessChain **`cc` agent CLI** to VS Code. When this extension is
active, running `cc agent` inside the editor's integrated terminal lets the
agent read your editor context and propose changes as native diffs.

It implements **Phase 1** of the IDE bridge design
(`docs/design/modules/98_IDE桥接对标方案.md`). The CLI-side discovery layer is
Phase 0 (already shipped in `packages/cli`).

## How it works

The extension runs a tiny **MCP server** (Model Context Protocol) on
`127.0.0.1` and advertises it two ways:

1. **Lockfile** — `~/.chainlesschain/ide/<port>.json` (file `0600`, dir `0700`)
   with the URL, a per-session bearer token, and the workspace folders.
2. **Terminal env** — `CHAINLESSCHAIN_IDE_PORT` / `CHAINLESSCHAIN_IDE_TOKEN` are
   injected into integrated terminals so `cc` locks onto *this* window
   deterministically (no scanning).

`cc agent` discovers the server, connects as the reserved MCP server **`ide`**,
and the editor tools become callable by the model as `mcp__ide__*`:

| Tool | What it does |
|------|--------------|
| `getSelection` | active file + selected range + text |
| `getDiagnostics` | errors/warnings (optionally scoped to a file) |
| `getOpenEditors` | open tabs, active one flagged |
| `openDiff` | open a native side-by-side diff for review |

The token + `127.0.0.1` binding stop other local processes from driving your
editor.

## Try it

1. Run the extension (F5 → Extension Development Host), open a folder.
2. In that window's integrated terminal: `cc ide status` should show the
   bridge, then `cc agent -p "what's selected?"` will see your selection.
3. `cc ide doctor` explains discovery if something is off.

> No-extension self-check: the whole protocol is covered by
> `packages/cli/__tests__/unit/vscode-ext-ide-bridge.test.js`, which drives this
> extension's MCP server with the real CLI MCP client.

## Visualization (0.2.0)

The bridge surfaces live state three ways, all fed by one activity log
(`onActivity` hook on the MCP server → status bar / tree / dashboard):

- **Status bar** (bottom-right): `◉ IDE :<port> →N` — running + port + tool-call
  count, flashes the active tool on each call. Click opens the dashboard.
- **Sidebar** (Activity Bar → *ChainlessChain IDE*): a tree of status, workspace
  folders, the 4 tools, and the recent tool-call log.
- **Dashboard** (*ChainlessChain IDE: Open Dashboard*): status cards + a live
  tool-call stream + a Restart button.

The bearer token is never displayed in any of these.

## Status

- ✅ MCP server + lockfile + env injection + 4 tools, wired and tested.
- ✅ Status bar + sidebar tree + webview dashboard + live activity log (0.2.0).
- ✅ `openDiff` blocks for review and returns
  `{ outcome: 'accepted' | 'rejected', path, finalText? }`. On accept the
  (possibly user-edited) right-hand text is written to the file (Phase 2).
- ⏳ Hunk-level partial accept + a close-the-diff = reject event hook are future
  polish.
- ⏳ JetBrains parity is Phase 3; Marketplace publish is Phase 4.

## Packaging

```bash
npx @vscode/vsce package --no-dependencies   # produces a .vsix
```
The extension has no runtime npm dependencies (pure Node + the VS Code API).
