# Changelog — ChainlessChain IDE Bridge (VS Code)

All notable changes to this extension are documented here.

## [0.2.0] — 2026-06-10

Visualization — the bridge now has a UI instead of being terminal-only:

- **Status bar** indicator (bottom-right): running state + port + tool-call
  count; briefly flashes the active tool on each call. Click → dashboard.
- **Sidebar tree view** (Activity Bar → ChainlessChain IDE): status, workspace
  folders, the 4 tools, and a live recent-tool-call log.
- **Webview dashboard** (*Open Dashboard*): status cards (port / tool calls /
  connections / errors) + a live tool-call stream + a Restart action.
- Driven by a shared in-memory activity log fed by a new `onActivity` hook on
  the MCP server (emits on connect + every tool call). The token is never shown.

## [0.1.0] — 2026-06-10

Initial release. Bridges the ChainlessChain `cc` agent CLI to VS Code.

- Localhost MCP server (Streamable HTTP + bearer auth) advertised via a lockfile
  (`~/.chainlesschain/ide/<port>.json`) and integrated-terminal env vars
  (`CHAINLESSCHAIN_IDE_PORT` / `CHAINLESSCHAIN_IDE_TOKEN`).
- Four tools exposed to the agent as `mcp__ide__*`: `getSelection`,
  `getDiagnostics`, `getOpenEditors`, `openDiff`.
- `openDiff` opens a native diff with an editable proposal pane and blocks until
  the user accepts (applies the change) or rejects.
- Commands: *Show Bridge Status*, *Restart Bridge*; setting
  `chainlesschain.ide.enabled`.
