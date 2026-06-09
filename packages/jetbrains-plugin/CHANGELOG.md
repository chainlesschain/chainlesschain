# Changelog — ChainlessChain IDE Bridge (JetBrains)

## [0.1.0] — 2026-06-10

Initial release. Bridges the ChainlessChain `cc` agent CLI to JetBrains IDEs.

- Localhost MCP server (Streamable HTTP + bearer auth) advertised via the shared
  lockfile (`~/.chainlesschain/ide/<port>.json`, `ide:"jetbrains"`) and
  integrated-terminal env vars — the same protocol as the VS Code extension, so
  the CLI needs no changes.
- Four tools exposed to the agent as `mcp__ide__*`: `getSelection`,
  `getDiagnostics`, `getOpenEditors`, `openDiff` (native diff with
  accept/reject).
- Protocol core verified by a cross-language interop probe against the CLI MCP
  client; IntelliJ glue builds against the IntelliJ Platform SDK.
