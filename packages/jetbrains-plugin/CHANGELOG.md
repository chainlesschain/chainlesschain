# Changelog — ChainlessChain IDE Bridge (JetBrains)

## [0.4.9] — 2026-06-18 — fix: chat tool window uses your configured LLM provider

- **Fix: the chat tool window now deterministically uses the provider you
  configured (`cc config` / Configure LLM), instead of occasionally drifting to
  a different provider and failing with a cryptic `Anthropic error: 401`.** The
  panel reads `~/.chainlesschain/config.json` and passes the provider/model
  **explicitly** to `cc agent`, so it always matches the terminal `cc`. Mirrors
  the VS Code 0.31.1 fix.

## [0.4.8] — 2026-06-18 — `/compact` manual compaction (Claude-Code IDE parity)

- **`/compact` in the chat tool window.** Typing `/compact` trims the live
  conversation history in the panel's `cc agent` child between turns (shortens
  large old tool results, preserves recent turns + tool pairs, no extra LLM
  call) and reports `compacted: saved <N> tokens`. Mirrors the VS Code 0.31.0
  feature and reuses the same `{type:"compact"}` CLI streaming control event.
  `AgentChatSession.compact()` sends the control event; the existing
  `compaction`-event renderer shows the result. Added to `/help`.

## [0.4.7] — 2026-06-16 — clear 2026.x verifier flags (scheduled-for-removal + deprecated)

The Marketplace Plugin Verifier flagged more on 2026.x builds than on 2025.2:
- **Scheduled-for-removal**: `SimpleListCellRenderer.create(String, Function)` (the
  @-mention popup renderer) → replaced with a plain Swing `DefaultListCellRenderer`
  (core Swing, never deprecated — bulletproof across IDE versions).
- **Deprecated**: `LocalTerminalCustomizer` (the terminal env-injector) → **removed**
  `IdeBridgeTerminalCustomizer` entirely. The bridge already writes a discovery
  lockfile (`~/.chainlesschain/ide/<port>.json`), so a `cc` launched in any terminal
  still auto-connects — the env injection was redundant. Also dropped the
  `org.jetbrains.plugins.terminal` plugin dependency (no terminal API left).
- Build now compiles PSI symbols against `com.intellij.java` explicitly (was coming
  in transitively via the terminal plugin); plugin.xml does **not** depend on Java,
  so it still loads on non-Java IDEs (symbol lookup is try/catch-guarded).
- Verifier now configured against 2025.2 **and** 2026.1.

## [0.4.6] — 2026-06-16 — newer-IDE compatibility (clear deprecated-API usage)

- Cleared the remaining **deprecated-API** usages the JetBrains Plugin Verifier
  flagged on newer IDE builds (2025.2+):
  - `PreviewService` — `ProcessAdapter` → `ProcessListener` (the adapter is
    deprecated; the listener interface now has default methods).
  - `ConfigureLlmAction` — deprecated `Messages.showChooseDialog` → a small
    `DialogWrapper` + `JComboBox` provider chooser.
- Combined with 0.4.5 (which removed the internal / scheduled-for-removal terminal
  API), the Plugin Verifier now reports **Compatible — 0 internal, 0
  scheduled-for-removal, 0 deprecated** API usages against 2025.2.
- Added a `verifyPlugin` Gradle config (`pluginVerification` + `pluginVerifier()`)
  so future changes are checked against newer IDEs before release.

## [0.4.5] — 2026-06-16 — revert getTerminalOutput (cross-version stability)

- **Reverted the 0.4.4 `getTerminalOutput` tool.** The JetBrains terminal API it
  relied on (`TerminalToolWindowManager.getWidgets()` → `JBTerminalWidget.
  getTerminalTextBuffer()` / jediterm) is **not stable across IDE versions** (the
  2024.3+ "reworked terminal" changed it), which caused errors on some builds.
  0.4.5 is functionally identical to 0.4.3 (5 IDE tools: getSelection /
  getDiagnostics / getOpenEditors / openDiff / openMultiDiff). A robust
  cross-version terminal read may return later behind reflection + version guards.

## [0.4.4] — 2026-06-16 — getTerminalOutput tool (reverted in 0.4.5)

- New `getTerminalOutput` tool (`mcp__ide__getTerminalOutput`): the agent can read
  the integrated terminal's recent text — so it can see what you just ran and how
  it failed without asking you to paste it. **Best-effort** raw screen text per
  terminal (JetBrains has no VS-Code-style shell integration, so no per-command
  structure / exit codes); reads on the EDT with the jediterm buffer locked, and
  returns no terminals if none are open or the API varies.

## [0.4.3] — 2026-06-16 — @-mention method symbols

- The `@`-mention symbol completion now also includes **methods/functions**
  (`getAllMethodNames` / `getMethodsByName`, bounded), not just classes — type a
  method name to insert an `@file` reference to where it's defined.

## [0.4.2] — 2026-06-16 — @-mention workspace symbols

- The `@`-mention completion popup now includes **project class symbols** (PSI
  short-names cache, bounded) alongside `@selection` / `@diagnostics` and project
  files — type a class name to insert an `@file` reference to where it's defined.
  JVM-language best-effort; non-JVM projects still get files + IDE mentions.

## [0.4.1] — 2026-06-16 — Marketplace listing

- Expanded the plugin **description** and **what's-new** to cover the full 0.4.0
  feature set (conversation tabs, approval modes, interactive cards, selection
  actions, @-mentions, native diff review, multi-file diff, app preview). No
  functional change since 0.4.0.

## [0.4.0] — 2026-06-16 — VS Code feature parity (conversation tabs → app preview)

Brings the JetBrains plugin up to the VS Code extension's feature set (0.22–0.30).
All glue compiles + packages against the IntelliJ 2024.2 SDK; the pure logic layers
are smoke-tested (`PureLogicSmokeMain`, 116 assertions).

- **Conversation tabs** (§1): the chat tool window is now multi-conversation — a
  tab strip with one live `cc agent` child per tab, `+ New chat`, per-tab `×`
  close (activates the neighbor, never empties), instant switching, and per-tab
  resume ids persisted across IDE restarts (migrates the old single-session key).
- **Approval-mode + extended-thinking** (§6): panel slash commands `/auto`
  (accept edits), `/bypass`, `/normal`, and `/think` / `/ultrathink` / `/think-off`
  (Anthropic) — spawn-time flags, so a change restarts the child with the new flag.
- **Panel slash commands** (§5): `/new`, `/stop`, `/cost`, `/context`, `/help`.
- **Context-window indicator** (§6): a dimmed `⊟ context …/… (n%)` line refreshes
  after each turn (red on overflow).
- **New / reopen-closed actions** (§6): `Ctrl/Cmd+Alt+N` new conversation;
  `Ctrl/Cmd+Shift+T` reopen the last-closed conversation (resumes it).
- **Selection actions** (§5): editor right-click **Explain** / **Refactor** seed
  the chat with `@selection`; **Insert File Reference** (`Ctrl/Cmd+Alt+K`) inserts
  `@<path>#L<start>-<end>` for the current selection so `cc` expands only those lines.
- **Inline diff "Request changes…"** (§3): `openDiff` review is now Accept /
  Request changes… / Reject; requested changes return line-note comments to the agent.
- **Batch multi-file diff** (§4): new `openMultiDiff` tool / `mcp__ide__openMultiDiff`
  — a native multi-file diff with Accept all / Choose files… / Reject.
- **App Preview** (§2): **Start App Preview** runs the project's dev script, detects
  the server URL, and embeds it (JCEF) in a new preview tool window (external-browser
  fallback when JCEF is unavailable); **Stop App Preview** kills the process tree.
- **Interactive plan / approval cards** (§5): tool-permission approvals and plans
  now render as cards with **Approve / Deny** (resp. **Approve / Reject**) buttons
  above the input (same stdin protocol as VS Code); `/plan` `/approve` `/reject`
  panel commands too.
- **@-mention completion** (§5): typing `@` pops a chooser of `@selection` /
  `@diagnostics` + project files (speed-search filtered); choosing splices the
  reference into the input.

Verified in a `runIde` sandbox; fixes found during that GUI pass:
- Chat replies are no longer silently dropped (the multi-conversation refactor
  could leave a conversation's turn-state as the wrong type, throwing on the first
  stream event and killing the reply reader).
- Tool-window stripe icon renders again (switched the New-UI-incompatible
  raster-in-SVG icon to a real PNG of the same logo).
- The chat input now spans its own full-width line, with Send/Stop on a row below.

## [0.3.3] — 2026-06-12

- Tool window icon is now **pixel-exact** with the VS Code extension's
  activity-bar mark (`media/logo-mark.png` embedded directly; the dark-theme
  variant is the same pixels recolored to light gray with alpha preserved) —
  0.3.2's hand-traced vector approximation didn't match. Verified live on a
  real 2024.2 install (user-confirmed screenshot).

## [0.3.2] — 2026-06-12

- **Tool window icon**: the right-dock "ChainlessChain" stripe button now
  shows the same double-T mark as the VS Code extension's Activity Bar icon
  (13×13 SVG, light + dark variants) instead of the default placeholder.

## [0.3.1] — 2026-06-12

- **Marketplace icon**: same logo as the VS Code extension (the silver
  ChainlessChain mark) via `META-INF/pluginIcon.svg` (+ dark variant).
- Chat tool window now **verified live** in a sandbox IDE (streaming reply,
  editor-context awareness — the agent knew the open file — and CJK text
  all confirmed on a real machine), upgrading 0.3.0's compile-only caveat.

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
