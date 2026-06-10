# Changelog — ChainlessChain IDE Bridge (JetBrains)

## [0.1.1] — 2026-06-11

- Document the CLI's new **automatic awareness** behaviors that pair with this
  bridge (cc ≥ 0.162.39): the editor selection / open tabs are shared with
  every prompt as an ephemeral `<ide-context>` block, post-edit diagnostics
  flow back into the agent loop, and REPL `@` tab-completion ranks open tabs
  first. `CC_IDE_CONTEXT=0` opts out. No functional change in the plugin
  itself — the existing `getSelection` / `getOpenEditors` / `getDiagnostics`
  tools now get called automatically by the CLI.

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
