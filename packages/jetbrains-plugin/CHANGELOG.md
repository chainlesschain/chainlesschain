# Changelog — ChainlessChain IDE Bridge (JetBrains)

## [0.3.0] — 2026-06-12

- **In-IDE chat tool window** ("ChainlessChain", right dock) — first slice of
  parity with the VS Code extension's chat panel. Chat with the `cc` agent
  without leaving the IDE: streaming replies (token deltas), tool-call trace,
  Stop (interrupts the in-flight turn, session survives), New (fresh session).
  The agent child inherits this window's bridge port/token, so selection
  context, diagnostics feedback and native diff review light up automatically.
  Protocol core (`AgentChatSession`/`ChatEvents`, the Java twin of the VS Code
  panel's session/event modules — same stream-json duplex, same delta-dedup)
  is pure JDK and headless-smoked against a fake NDJSON agent (14 checks).
- **Conversation resume across restarts**: the chat session id is stored
  per-project (PropertiesComponent) and passed back as `--resume`, so
  reopening the IDE continues the same conversation (a resume note shows the
  restored message count). **New** clears the stored id for a fresh start.
- Verification status: the protocol core is headless-tested (14 checks
  against a live NDJSON child); the Swing tool window itself is
  compile-verified against the 2024.2 SDK but not yet hand-tested in a
  sandbox IDE — if the panel misbehaves, the bridge/terminal features above
  are unaffected. Please report issues on GitHub.

## [0.2.0] — 2026-06-11

- **Guided LLM setup**: Tools → **ChainlessChain: Configure LLM** walks
  provider → model → API key → base URL (10 presets: volcengine/doubao,
  Ollama, Anthropic, OpenAI, DeepSeek, DashScope, Kimi, Gemini, Mistral,
  MiniMax), writes through `cc config set` (single source of truth:
  ~/.chainlesschain/config.json, shared with the CLI and the VS Code
  extension — the key never enters IDE settings) and verifies with
  `cc llm test`. Pure-JDK core (LlmConfig) + thin SDK dialog glue.

## [0.1.2] — 2026-06-11

- Document the CLI 0.162.41 batch available in the IDE terminal through the
  bridge's injected env, with zero plugin changes: **project memory**
  (`chainlesschain init` → cc.md auto-loaded by every agent run,
  `memory files` to inspect the chain), **REPL steering** (queued input, Esc
  interrupt, `/rewind` double-Esc, `!` bash passthrough, `#` quick-memorize,
  `/` TAB completion, resume recap) and **scripted runs** (`--json-schema`
  structured output, `mcp serve`).

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
