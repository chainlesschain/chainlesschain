# Changelog — ChainlessChain IDE Bridge (JetBrains)

## [0.4.22] — 2026-06-20 — notify when a newer cc CLI is available

- **You're now told when a newer `cc` is published.** The plugin and the
  `chainlesschain` CLI ship on independent tracks (JetBrains Marketplace vs npm),
  so a working-but-old `cc` would silently miss newer panel features. When the
  chat tool window opens it checks the npm `latest` release against your
  installed `cc` (off the EDT, best-effort) and, if you're behind, dim-hints the
  upgrade command (`npm i -g chainlesschain@latest`) in the transcript — at most
  once per new version. Any probe/network failure stays quiet.

## [0.4.21] — 2026-06-20 — fix: Configure-LLM now restarts the running chat

- **Fix.** After you reconfigured the LLM (⚙ LLM → provider / model / API key, or
  the vision model), the chat tab you were in kept using the **old** config — the
  provider/model are pinned when the `cc` child starts, so it would keep erroring
  (e.g. `401`) until you opened a *new* conversation. Now the panel restarts the
  tab's child once the wizard closes, so your next message respawns with the
  fresh config. No more "配置完还没用 / 新开一个对话才行."

## [0.4.20] — 2026-06-20 — `/review` panel command (review the current diff)

- **New `/review` slash command in the chat tool window.** Type `/review` to ask
  the agent to review your uncommitted git changes — it inspects the working-tree
  diff (`git diff` / `git diff --staged`) with this window's IDE context
  (selection, diagnostics, open editors) riding along, flags correctness bugs
  first and simplifications/cleanups second, and cites `file:line`. It does not
  edit files unless you ask. Local sugar that seeds a turn (re-enters the input
  with a canned prompt — no new plumbing); discoverable in the `/` autocomplete
  popup and `/help`. Mirrors the VS Code panel's 0.33.2 `/review`.

## [0.4.19] — 2026-06-19 — fix: suggested vision model matches the CLI default

- **Fix.** The vision-model wizard/menu prefilled `doubao-seed-1-6-vision-250815`,
  but the CLI's actual default is `doubao-seed-2-0-lite-260215` (a newer,
  natively-multimodal model). The suggestion now mirrors the CLI, so the
  prefilled value equals what `cc agent --image` would use.

## [0.4.18] — 2026-06-19 — dedicated vision-model entry

- **You can now set the image-recognition (vision) model on its own.** It used
  to only appear as the last step of the full Configure-LLM wizard, so changing
  it meant re-walking provider → model → API key → base URL. Now:
  - the **⚙ LLM** button in the chat panel opens a small menu — *Configure LLM*
    (the full wizard) **or** *Vision model…* (just `llm.visionModel`);
  - **Tools → ChainlessChain: Configure Vision Model** does the same from the
    menu bar.
  The dialog prefills the current value (or the configured provider's
  suggestion); leaving it blank clears it (revert to the text model / CLI
  default). No API-key re-entry.

## [0.4.17] — 2026-06-19 — first-run LLM-setup nudge

- **First-run nudge.** When the chat panel opens and no LLM provider is
  configured yet (`cc config get llm.provider` is empty), the transcript now
  shows a dim hint pointing at the **⚙ LLM** button — instead of staying blank
  until the first turn fails with a `401`. The probe runs off the UI thread and
  is best-effort. Matches the VS Code panel's onboarding setup card.

## [0.4.16] — 2026-06-18 — chat panel LLM UX (paste · quick config · vision model)

- **Screenshot/image paste.** Press **Ctrl/Cmd+V** with an image on the
  clipboard and it attaches to your next message (📷 indicator by the Send
  button) — sent to a vision-capable model alongside your text, the same as the
  VS Code panel. Up to 4 images per turn; image-only turns are allowed. The CLI
  switches to the vision model automatically when images are present.
- **Quick LLM-config entry + hint.** A **⚙ LLM** button now sits next to Send
  and opens the provider/model wizard directly from the chat — no hunting in the
  Tools menu. When a turn fails with what looks like an auth/key problem
  (401/403, missing/expired key), the transcript adds a dimmed hint pointing at
  the button.
- **Configurable vision model.** The wizard now has a dedicated
  image-recognition (vision) model step (written to `llm.visionModel`), so the
  text model and the vision model can differ — e.g. a text LLM plus
  `doubao-seed-1-6-vision` for screenshots. Leave it blank to reuse the text
  model / the CLI default.

## [0.4.15] — 2026-06-18 — multi-line chat composer

- **Multi-line input.** The chat input is now a wrapping multi-line composer
  (was a single-line field): **Enter** sends, **Shift+Enter** inserts a newline —
  matching the VS Code panel. Lets you compose longer, structured prompts.
  CJK IME composition is unaffected (candidates confirm before Enter reaches the
  send handler).

## [0.4.14] — 2026-06-18 — extended-thinking reasoning shown dimmed

- **Thinking-stream display.** With `/think` (or `/ultrathink`) on, the model's
  extended-thinking reasoning now streams into the transcript in a dimmed italic
  gray, set apart from the answer — VS Code parity. `ChatEvents` maps the
  `thinking_delta` stream event to a "thinking" line; the JTextPane renders it
  with the dim style (not markdown). Previously thinking deltas were dropped.

## [0.4.13] — 2026-06-18 — Markdown rendering in the chat transcript

- **Markdown in assistant replies.** The chat transcript now renders fenced
  ```code``` / inline `code` (monospace amber) and **bold** instead of showing
  raw markers — VS Code parity. Streaming stays responsive (plain text as it
  arrives, then the completed reply snaps to styled). The transcript moved from
  `JTextArea` to `JTextPane`; all other lines (headers, tool trace, info) are
  unchanged. Tiny dependency-free `MarkdownLite` tokenizer (unclosed markers
  degrade to plain text, never losing characters).

## [0.4.12] — 2026-06-18 — "Fix with ChainlessChain" intention (VS Code parity)

- **Fix-with-cc quick-fix.** On a line carrying an error or warning, the
  lightbulb (Alt+Enter) now offers *"Fix with ChainlessChain"* — it reveals the
  chat tool window and seeds it with a fix request scoped to this file (as an
  `@file` reference the agent expands) plus the problems on that line. Mirrors
  the VS Code 0.19 Fix-with-cc QuickFix. Pure prompt construction in `FixWithCc`.

## [0.4.11] — 2026-06-18 — slash-command autocomplete in the chat input

- **Slash-command autocomplete (VS Code parity).** Typing `/` at the start of
  the chat input now pops a chooser of the panel's slash commands (`/new`,
  `/compact`, `/think`, `/plan`, `/cost`, …) with one-line descriptions,
  filtered as you type — the same discoverability the VS Code panel already had.
  Picking one fills the input ready to send. Mirrors the existing `@`-mention
  popup. Pure catalog/filter logic in `SlashCommands` (15 commands, kept in sync
  with the command switch).

## [0.4.10] — 2026-06-18 — fix: read-action compliance for diff review (2026.2)

- **Fix: wrap the diff-review document reads in a read action.** `openDiff` /
  `openMultiDiff` read the on-disk file's text on the EDT to build the "Current"
  side of the diff. Since IntelliJ 2026.2 the EDT no longer grants implicit read
  access to the document model, so an unwrapped `Document.getText()` there threw
  *"Read access is allowed from inside read-action only"* (flagged by the
  Marketplace Plugin Verifier). Both reads now go through a `runReadAction`
  helper. No behavior change on 2025.x; fixes the crash when reviewing a
  proposed file edit on 2026.2+.

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
