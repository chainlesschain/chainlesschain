# Changelog — ChainlessChain IDE Bridge (VS Code)

All notable changes to this extension are documented here.

## [0.27.0] — 2026-06-15

- **`@terminal` mention** — the chat panel's `@`-completion now offers `@terminal`
  alongside `@selection`/`@diagnostics`. It pulls the recent integrated-terminal
  commands + output into your prompt on demand (needs cc ≥ 0.162.67).
- **App Preview crash recovery** — if the dev server exits on its own, the preview
  now reports it as a crash and offers a one-click **Restart** (instead of silently
  going quiet).

## [0.26.0] — 2026-06-15

- **`ChainlessChain: Upgrade CLI` command** — a command-palette action that runs
  `npm i -g chainlesschain@latest` in a terminal, so you can update the `cc` CLI
  from the IDE **on demand** — any time, not only when the version-sync check
  detects you're below the minimum.

## [0.25.0] — 2026-06-15

- **Fix: conversation tabs keep interactive cards alive across switches.** Each
  inactive tab's transcript is now retained as detached DOM nodes instead of an
  `innerHTML` string, so a pending approval card's Approve/Deny (and other in-place
  buttons) still work after you switch tabs and come back.

## [0.24.0] — 2026-06-15

- **CLI version-sync** — the extension and the `chainlesschain` CLI ship on
  separate tracks (Open VSX vs npm), and newer panel features need a recent
  enough `cc`. On activation the extension now checks `cc --version`; if it's
  older than the extension needs, it offers a one-click **Upgrade cc** (runs
  `npm i -g chainlesschain@latest` in a terminal) or **Don't show again**.
  Best-effort and quiet when `cc` is up to date, missing, or unreadable.

## [0.23.0] — 2026-06-15

- **Terminal-context sharing (Claude Code parity)** — a new `getTerminalOutput`
  IDE tool (`mcp__ide__getTerminalOutput`). The agent can see the recent commands
  you ran in the integrated terminal — their output and exit code — so it knows
  what just happened (and how it failed) without you pasting it. Backed by VS
  Code's shell-integration API (VS Code 1.93+; on older hosts the tool simply
  returns nothing). Output is capped to the most recent chars per command (errors
  live at the end), keeping the last few commands.

## [0.22.1] — 2026-06-15

- **Docs only (no code change)** — refreshes the Open VSX listing:
  - Clarify the extension is published to **Open VSX only**, **not** the Microsoft
    VS Code Marketplace, with install instructions (VSCodium/Cursor/… search, or
    install the `.vsix` in stock VS Code).
  - Bring the README feature list up to date with 0.22.0 (conversation tabs, App
    Preview, "Request changes…" inline diff comments, `openMultiDiff` multi-file
    diff, plus the 0.18–0.21 additions) and fix the tool count (6, incl.
    `openMultiDiff`).

## [0.22.0] — 2026-06-14

- **Conversation tabs (Claude Code parity)**: the chat panel now holds multiple
  conversations at once. A tab bar shows each one with a title and a close (×);
  `+` opens a fresh tab. Each tab owns its own `cc agent` process and resume id,
  switching tabs restores that conversation's transcript, and a background tab's
  output never bleeds into the visible one. Closing a tab activates a neighbor
  and the panel is never left empty.
- **App Preview (Claude Code preview-pane parity)**: **Start App Preview** finds
  your project's dev script (`dev` / `start` / `serve` … or any script running
  vite/next/cra/webpack/astro/…), runs it, detects the served URL, and opens it
  in VS Code's built-in Simple Browser — the dev server's own HMR handles live
  reload on edits. **Stop App Preview** kills it.
- **Inline diff comments (Claude Code parity)**: the native diff review now has a
  third choice beyond Accept/Reject — **Request changes…** — to annotate specific
  lines with revision notes. The file isn't written; your line-anchored notes go
  back to the agent so it revises and re-proposes.
- **Batch multi-file diff (`openMultiDiff`)**: the agent can now present a whole
  changeset spanning several files in one native multi-file diff for review —
  **Accept all**, pick a subset, or reject — instead of one file at a time.

## [0.21.0] — 2026-06-14

- **Workspace symbol @-mentions (Claude Code parity)**: typing `@` in the chat
  input now also suggests workspace symbols (functions, classes, methods, …),
  not just files — so you can find the right file by a symbol's name even when
  the filename differs. Picking a symbol inserts the file that contains it as an
  `@<path>` reference (the CLI expands `@path` server-side), labelled
  `<kind> <name> · <path>` in the dropdown. Suggestions are gated to ≥2 typed
  characters and deduped by the inserted path, so a symbol whose file already
  matched by path search doesn't show twice.

## [0.20.0] — 2026-06-14

- **Explain / Refactor selection (Claude Code parity)**: select code and
  right-click → **Explain Selection** or **Refactor Selection** seeds the chat
  panel with a request referencing `@selection` (the CLI expands it to the live
  editor selection through the bridge) plus a pointer to the file and lines.
  Explain is ready to send; Refactor leaves the caret ready for you to describe
  the change. Both also appear in the command palette; the context-menu items
  show only when there is a selection.
- **`/cost` and `/context` panel commands (REPL parity)**: type `/cost` for this
  conversation's estimated token spend + cost, or `/context` for its
  context-window usage. Both defer to the CLI (`cc cost <id>` / `cc context
  <id>`) for this panel's session — the same source of truth the REPL uses —
  and render in a monospaced block. `/help` now lists them.

## [0.19.0] — 2026-06-14

- **Fix with ChainlessChain (Claude Code parity)**: a QuickFix lightbulb now
  appears on any error or warning. Choosing **Fix with ChainlessChain** reveals
  the chat panel and seeds the input with a fix request scoped to that file
  (referenced as `@<path>`, so the CLI attaches its contents) and those exact
  problems (severity-labelled, 1-based line numbers, capped at 10). The same
  command is on the editor right-click menu and the command palette — with no
  lightbulb args it gathers the active editor's problems near the cursor or
  selection. You review/edit the seeded prompt, then hit Send.

## [0.18.0] — 2026-06-13

- **Keyboard shortcuts (Claude Code parity)**: `Ctrl/Cmd+Esc` focuses the chat
  panel from anywhere, and `Ctrl/Cmd+Alt+K` (with the editor focused) inserts
  the active file as an `@<path>` reference into the chat input — the CLI then
  expands it server-side. New command **ChainlessChain: Insert File Reference
  into Chat (@file)** is also available from the command palette. The webview
  now posts a `ready` signal so a reference inserted before the panel finishes
  loading is queued and flushed (no first-open race).
- **`@selection` / `@diagnostics` completions in the chat input**: typing `@`
  now suggests the two IDE pseudo-mentions (ranked ahead of files) — the CLI
  expands `@selection` to the active selection and `@diagnostics` to the whole
  workspace's problems — so the feature is discoverable, not just typeable.
- **Editor right-click → Insert File Reference into Chat**: the
  insert-reference command is now also on the editor context menu (mouse parity
  with the keybinding).

## [0.17.1] — 2026-06-12

- Docs only: the marketplace README now covers everything shipped today —
  markdown replies + GFM tables/task lists, diff-tab-close = reject,
  `@` file mentions, screenshot paste (vision), and mid-session IDE
  hot-reconnect. No code changes.

## [0.17.0] — 2026-06-12

- **Markdown tables & task lists in chat** (md-lite GFM extensions):
  `| a | b |` tables render as bordered grids (cells keep inline formatting
  and escaping), and `- [ ]` / `- [x]` task items render as ☐ / ☑. The
  whitelist invariant is unchanged — output is still attribute-less tags
  over escaped text, so the panel stays XSS-safe by construction.

## [0.16.0] — 2026-06-12 (requires cc ≥ 0.162.47)

- **Paste images into the chat** (vision input): paste a screenshot into the
  input box — it shows as a removable 📷 chip and rides the next message.
  The extension writes attachments to temp files and the CLI feeds them
  through the same pipeline as `cc agent --image` (up to 4 per message;
  data-URL whitelist, junk is dropped). Requires a vision-capable chat model
  (`chainlesschain.chat.model` or `cc config set llm.visionModel …`) and
  cc ≥ 0.162.47 (stream-json `images` support) — older CLIs silently drop
  pasted images: `npm i -g chainlesschain` to update.

## [0.15.0] — 2026-06-12

- **@file mentions in the chat input**: typing `@` (at start of a word) pops
  a ranked dropdown of workspace files — basename-prefix hits first, then
  path-prefix, then substring. Arrow keys navigate, Tab/Enter accepts
  (inserting `@relative/path `), Esc closes the dropdown without
  interrupting the running turn. The CLI already expands `@path` references
  in stream-json turns server-side, so the inserted mention pulls the file's
  content into the conversation with zero protocol changes. The workspace is
  scanned once per session (5k files cap, heavy dirs excluded) and filtered
  per keystroke; **New** rescans.

## [0.14.0] — 2026-06-12

- **Closing the diff tab now rejects the review immediately.** Closing the
  openDiff review tab is how most reviewers say no — the blocked tool call
  now unblocks at once as `rejected` (with `closedDiff: true`) instead of
  waiting for the lingering notification toast to also be dismissed. A late
  click on that stale toast is ignored (single-settle, fail-safe: nothing is
  ever applied after a close). Hosts older than VS Code 1.67 (no `tabGroups`
  API) keep the previous button-only behavior.

## [0.13.0] — 2026-06-12

- **Markdown rendering in the chat panel**: assistant replies now render
  fenced code blocks, inline code, bold/italic and headings (md-lite, a
  built-in whitelist renderer — escape-first, attribute-less tags only, so
  it is XSS-safe by construction under the panel's strict CSP). Streaming
  re-renders live; user messages, tool traces and errors stay plain text.

## [0.12.1] — 2026-06-11

- Fix: the **Pick hunks…** list no longer cancels when the window loses
  focus (alt-tab to compare code, screenshots). Found live — a screenshot
  killed the pick. Only OK or Esc ends the review now (ignoreFocusOut).

## [0.12.0] — 2026-06-11

- **Hunk-level partial accept** — the last roadmap item: the openDiff review
  prompt gains **Pick hunks…**, a native multi-select QuickPick of the
  change blocks (computed against the possibly user-edited right pane).
  Checked blocks are applied, unchecked ones keep the original text; Esc or
  an empty selection applies nothing (fail-safe). Pathologically large
  diffs collapse to a single all-or-nothing block instead of hanging.

## [0.11.1] — 2026-06-11

- Discoverability: a **⚙ gear button on the Chat panel title bar** opens the
  Configure-LLM wizard (it was command-palette-only, and easy to miss from
  the Settings page, which only lists plain settings).

## [0.11.0] — 2026-06-11

- **Guided LLM setup** — the missing onboarding: command
  `ChainlessChain: Configure LLM` walks provider → model → API key →
  base URL (10 presets: volcengine/doubao, Ollama, Anthropic, OpenAI,
  DeepSeek, DashScope, Kimi, Gemini, Mistral, MiniMax), writes through
  `cc config set` (single source of truth: ~/.chainlesschain/config.json,
  shared by CLI and panel; the key never enters VS Code settings) and
  verifies with `cc llm test`. The chat panel shows a setup card on first
  run when nothing is configured and whenever a turn fails with a
  connection error — one click opens the wizard.

## [0.10.1] — 2026-06-11

- **Hotfix: the chat panel was dead in 0.9.0/0.10.0** (Send did nothing,
  no message rendered). A 
 inside the page template became a real
  newline in the generated webview script — a load-time SyntaxError, so no
  event listener ever attached. Fixed; now guarded by a regression test
  that PARSES the generated script (substring smoke tests cannot catch
  this class of bug).

## [0.10.0] — 2026-06-11

- **Session picker**: `/sessions` (or `/resume`) opens a native QuickPick of
  saved conversations (`cc session list`) — pick one and the panel resumes
  it with full history on your next message. Complements the automatic
  per-workspace resume.

## [0.9.0] — 2026-06-11

- **Approve/Deny cards for risky actions** (cc >= 0.162.45): with the new
  `--interactive-approvals` the agent no longer silently denies confirm-tier
  actions (risky shell commands, settings `ask` rules) — the panel shows an
  inline approval card (tool + command + risk level) and the blocked tool
  waits for your verdict. Times out fail-closed after 120s
  (CC_APPROVAL_TIMEOUT_MS). With the IDE bridge connected, file-edit asks
  still prefer the native diff review.
- Panel slash commands: `/new` `/plan` `/approve` `/reject` `/stop` `/help`
  in the input box map to the existing controls.

## [0.8.0] — 2026-06-11

- **Project memory commands** (pairs with cc ≥ 0.162.41): palette
  **"ChainlessChain: Generate Project Memory (cc.md)"** runs
  `chainlesschain init` in the shared terminal (offline inventory, optional
  `--ai` refine via QuickPick), and **"ChainlessChain: Show Project Memory
  Files"** runs `chainlesschain memory files` — the chain (`cc.md` >
  `CLAUDE.md` > `AGENTS.md` + path-scoped rules) the agent auto-loads.
- README documents the 0.162.41 batch usable in the integrated terminal
  as-is: REPL steering (queued input / Esc interrupt / `/rewind` double-Esc),
  `!` bash passthrough, `#` quick-memorize, `/` TAB completion,
  `--json-schema` structured output.

## [0.7.0] — 2026-06-11

- **Interrupt the current turn** (cc >= 0.162.44): the **Stop** button (and
  the Esc key) now aborts the in-flight turn only — the LLM call is
  cancelled, a "⏹ interrupted" marker is shown, and the SAME conversation
  keeps going with your next message. Killing the whole agent process moved
  to **New**. Claude-Code Esc parity.

## [0.6.0] — 2026-06-11

- **Plan mode in the chat panel** (cc >= 0.162.43): the **Plan** button puts
  the agent in read-only planning — its blocked write/execute attempts
  collect into a live plan card (items colored by impact, risk level shown).
  **Approve & run** unlocks the tools and the agent executes immediately;
  **Reject** discards the plan. Mirrors the REPL /plan verbs over the same
  stream protocol.
- Panel LLM now follows the CLI config defaults: with cc >= 0.162.43 a bare
  panel session uses your configured provider (e.g. volcengine/doubao)
  instead of assuming local ollama — fixes "fetch failed" on cloud setups.

## [0.5.0] — 2026-06-11

- **Chat session resume** (needs cc >= 0.162.40): the panel remembers this
  workspace's conversation and continues it across panel reloads, child
  exits, and editor restarts — the agent child is spawned with --resume and
  the CLI replays the persisted history. A small "resumed previous
  conversation (N messages)" note shows what came back. **New** still starts
  a clean session (and forgets the stored one).

## [0.4.2] — 2026-06-11

- Docs-only: refresh the marketplace README — the Status section had gone
  stale (JetBrains parity + marketplace publish shipped long ago; 5 tools,
  live awareness, diff approvals, and the chat panel are all ✅ now).

## [0.4.1] — 2026-06-11

- Chat panel polish: **New** button starts a fresh conversation (drops the
  agent child + clears the log); `chainlesschain.chat.provider` /
  `chainlesschain.chat.model` settings pick the panel's LLM (empty = the
  CLI's configured default).

## [0.4.0] — 2026-06-11

- **Chat panel** (sidebar → ChainlessChain IDE → Chat): talk to the agent
  without leaving the editor. The panel drives ONE persistent
  `cc agent --input/output-format stream-json --include-partial-messages`
  child over its pipes — streaming token-by-token replies, a live tool-call
  trace, and multi-turn conversation state in the same process. The child
  inherits this window's bridge port/token, so the agent automatically sees
  your selection/open tabs, feeds diagnostics back after edits, and (with
  `ask` permission rules) reviews edits as native diffs — the full live-
  awareness stack, now one sidebar away. Requires the `cc` CLI on PATH
  (`npm i -g chainlesschain`; override via `chainlesschain.cli.path`).
  Lazy spawn on first message; Stop kills the child; the next message
  restarts it.

## [0.3.0] — 2026-06-11

- New tool **`executeCode`** (Claude-Code `mcp__ide__executeCode` parity):
  execute code in the ACTIVE Jupyter notebook's kernel via the Jupyter
  extension's Kernel API and stream the outputs back to the agent. Kernel
  state persists across calls. Requires `ms-toolsai.jupyter` + a running
  kernel (and one-time kernel-access consent if prompted); fails with clear,
  actionable errors otherwise. Cancellable via `timeout_ms` (default 120s).
  The tool is exposed conditionally — hosts without notebook support (e.g.
  the JetBrains plugin) keep the classic 4-tool surface unchanged.

## [0.2.2] — 2026-06-11

- Document the CLI's new **automatic awareness** behaviors that pair with this
  bridge (cc ≥ 0.162.39): the editor selection / open tabs are shared with
  every prompt as an ephemeral `<ide-context>` block, post-edit diagnostics
  flow back into the agent loop, and REPL `@` tab-completion ranks open tabs
  first. `CC_IDE_CONTEXT=0` opts out. No functional change in the extension
  itself — the existing `getSelection` / `getOpenEditors` / `getDiagnostics`
  tools now get called automatically by the CLI.

## [0.2.1] — 2026-06-10

- Add the ChainlessChain brand logo as the extension icon (`media/logo.png`),
  and a monochrome version of the logo glyph for the Activity Bar
  (`media/logo-mark.png`, since VS Code tints Activity Bar icons).
- **First published release** — available on the
  [Open VSX Registry](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide)
  (`chainlesschain.chainlesschain-ide`), installable in VS Code-compatible
  editors (VSCodium / Cursor / Gitpod / …).

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
