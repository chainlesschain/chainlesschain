# Changelog — ChainlessChain IDE Bridge (JetBrains)

## [Unreleased] — Sessions workbench + PSI-backed semantic tools (2026-07-11)

- **Artifacts drawer (gap #9).** New Tools → "ChainlessChain: Artifacts"
  dialog browses the agent-published deliverable store (`cc artifacts list
  --json` — reports/patches/screenshots/logs published by the
  `publish_artifact` tool): searchable, kind-filterable metadata table
  (title/kind/human size/MIME/relative created — payload bytes are never read
  for listing), with per-row actions derived from previewability: Open puts
  text and images into the IDE editor (it has an image viewer) and sends HTML
  to the external browser, Reveal in folder / Copy path always work, and
  Remove confirms then runs `cc artifacts remove <id>` off-EDT and refreshes.
  Binary artifacts (zip/pdf) get reveal/copy only. Parsing (tolerant of
  malformed JSON), filtering, previewability classification and action
  derivation live in the pure `Artifacts` core (JUnit + smoke, SDK-free);
  the list load and every cc spawn run off-EDT; en+zh localized.
- **Permissions and Policy viewer (gap #10).** New Tools → "ChainlessChain:
  Permissions and Policy" read-only monospace dialog joins the four cc policy
  surfaces off-EDT: the merged `permissions.{allow,ask,deny}` ruleset grouped
  deny→ask→allow with each rule's source file and managed-policy badges
  (`cc permissions list --json`), recent policy denials most-recent first
  with count/mode/relative time (`cc permissions recent --json`), the
  auto-mode risk→decision matrix plus fine-grained `autoMode.decisions`
  rules and customized/defaults classifier state (`cc auto-mode config
  --json`), and the built-in decision precedence chain (`cc auto-mode
  defaults`). A summary counts line tops the view; a Refresh button
  re-gathers in place; a failed or malformed source degrades to a warning
  entry while the other sections still render. All parsing/shaping/rendering
  lives in the pure `PolicyViewer` core (JUnit + smoke, SDK-free); en+zh
  localized.
- **Unified Sessions Workbench tool window (gap #3).** New "ChainlessChain
  Sessions" tool window (Tools → "ChainlessChain: Sessions Workbench")
  aggregates every session surface into one searchable table: saved chat
  sessions (`cc session list --json`), the cross-IDE session index
  (`~/.chainlesschain/ide/session-index.json`, incl. `waiting_approval`
  status), `cc agent --bg` background agents (with the CLI's stale-heartbeat
  display correction) and `cc remote-control` pairing hosts. A background
  agent running chat session X absorbs/annotates that chat row (the
  background row wins and carries the session id); rows sort
  waiting-approval → running → last activity, and the search field filters
  title/workspace/id case-insensitively. Per-row actions route to the
  existing paths: resume (chat) opens a new chat tab via the deep-link
  take-over path, attach sends a one-shot session-transport prompt (same
  path as the Background Agents panel), rename/delete/stop/resume spawn the
  matching `cc session`/`cc daemon`/`cc remote-control` commands off-EDT,
  and logs/status render read-only dialogs. The table auto-refreshes every
  15s while visible (never when hidden); a failed source degrades to a
  visible warning row and the panel still renders. All
  aggregation/dedup/sort/filter/time formatting lives in the pure
  `SessionsWorkbench` core (JUnit + smoke, SDK-free, en+zh localized glue).
- **Seven new `mcp__ide__*` semantic tools (gap #7).** The bridge now exposes
  the IDE's semantic index to the cc agent: `getHover` (quick-doc, HTML
  stripped + capped), `goToDefinition` (declaration locations — never navigates
  the user's editor), `findReferences` (Find-Usages engine, `max` capped,
  default 100 / hard cap 200), `renamePreview` (per-file occurrence counts of a
  would-be rename — **strictly read-only, no refactoring runs**),
  `getCallHierarchy` (one level of callers/callees for Java methods, capped per
  direction; other languages degrade with a `reason`), `getSymbolInfo`
  (name/kind/containing class/package/owner) and `getProjectModel` (modules,
  source roots, dependencies, project JDK). Positions are **1-based**
  line/column, documented in every tool schema. All shaping/caps/validation
  live in the pure `SemanticTools` core (JUnit + smoke, SDK-free); the PSI glue
  (`PsiSemanticFacade`) runs everything inside read actions off the EDT,
  answers "still indexing" cleanly in dumb mode, and keeps `com.intellij.java`
  compile-time-only so non-Java IDEs still load the plugin. Tools register
  conditionally, same pattern as `getTerminalOutput`.

## [0.4.56] — Remote Control: in-IDE pairing QR + relay settings (2026-07-10)

- **In-IDE pairing QR.** The Remote Control pairing dialog now renders the
  one-time pairing URI as a QR code above the note, and a new "Show pairing
  QR" menu item reopens it while the host is running — no more switching to a
  CLI terminal or pasting the URI by hand to pair a phone. The plugin bundles
  no QR library, so this adds a self-contained pure encoder
  (`com.chainlesschain.ide.QrCode`: byte mode, ECC M, auto version 1–40,
  ISO 18004 masking) that asserts the same fixtures as the VS Code twin —
  both IDEs render identical, decode-verified symbols. The QR is drawn
  black-on-white regardless of IDE theme (scanners need the contrast); URIs
  beyond QR capacity fall back to the text-only dialog.
- **Relay (E2EE cross-network) settings.** New "Relay settings…" option in the
  Remote Control dialog (relay server URL + optional stable peer id, persisted
  application-wide): pairing across networks no longer requires CLI
  env/config. The start dialog shows the current pairing mode; values apply to
  the next host start as `--relay-url`/`--peer-id`, blank values defer to the
  CLI's own resolution chain (`CC_REMOTE_SESSION_RELAY_URL` →
  `remoteControl.relayUrl`), and the peer id works independently of the relay
  URL.

## [0.4.55] — diff review: your in-viewer edits are captured + line-anchored notes (2026-07-10)

- **Diff review captures your in-viewer edits (gap #4 close-out).** The right
  pane of the openDiff review is now editable (`createEditable`), and every
  decision path — Accept, Pick hunks…, Request changes… — reads the pane back,
  so a proposal you amended inside the native diff viewer is what actually gets
  written (and what the agent sees as `finalText`/`reviewedText`). Previously
  the original proposal was silently written and your edits were lost. When the
  pane is untouched the CLI's byte-exact text is kept (the diff document
  normalizes line separators).
- **Line-anchored review notes.** A "Request changes…" note can now anchor to
  lines of the reviewed text with a `12:` or `12-15:` prefix (1-based, as shown
  in the diff gutter; full-width `：` accepted) — parsed by the new pure
  `ReviewNote` core into the same `{line, endLine, lineText, note}` shape the
  VS Code twin emits from selections, so the CLI renders both identically. An
  out-of-range or invalid prefix degrades to a general note (never an invented
  anchor). Prompts localized (en/zh). JUnit `ReviewNoteTest` (11) + smoke
  assertions.

## [0.4.54] — P2 hardening: deep-link parity, Remote/WSL Doctor, auto-exec config guard (2026-07-10)

- **Deep link parity — full parameter set (P2 #11).** `jetbrains://…/chainlesschain/open`
  now accepts `session` (resume), `file`, `line`, `workspace` and `mode` on top
  of `prompt` — so a doc, script or the CLI can hand off into the IDE at an exact
  file/line and resume a specific conversation. The order matches the VS Code
  twin (resume → mode → prompt → file). Security: the prompt is only SEEDED
  (never auto-sent); `mode` accepts only the safe approval modes and NEVER
  `bypassPermissions` (an untrusted link can't arm auto-approval); the session id
  is shape-validated and `workspace` is checked against the open project (a link
  for another repo is ignored). Windows/中文/space paths round-trip verbatim.
  Pure core `DeepLink` (JUnit + smoke).
- **Auto-exec config guard (P2 #13).** New `AutoExecGuard` pure core + Tools →
  "ChainlessChain: Scan Workspace for Auto-Exec Config": recognizes workspace
  files that can run code without an explicit action — MCP configs, git/husky
  hooks, shell profiles, VS Code tasks/launch, JetBrains run configs, `.idea/` —
  and lets you Trust the workspace (persisted per project path). The agent's own
  per-write gates still apply; this is the IDE-layer heads-up that the OPEN
  workspace already CONTAINS such files. VS Code twin:
  `chainlesschain.workspace.scanAutoExec` + an activation advisory.
- **Remote / WSL Doctor (P2 #12).** "Diagnose Bridge" now appends a Remote/WSL
  section (pure `RemoteDoctor`): detects a WSL/remote session, and reports WSL2
  mirrored-networking, a missing/outdated cc on this host, and a stopped/
  unreachable bridge port — each with a COPYABLE fix command. VS Code twin:
  `chainlesschain.remote.doctor`.
- **Terminal API future-proofing.** Worktree Tasks' "New isolated task…" now
  opens its integrated terminal via `TerminalToolWindowManager.createShellWidget`
  - `TerminalWidget.sendCommandToExecute` instead of the scheduled-for-removal
    `createLocalShellWidget` the 0.4.53 Marketplace verifier flagged (Approved/
    Compatible on all verified IDEs — informational only). No behavior change;
    the Terminal-plugin-absent fallback to the command dialog is untouched.
    `TerminalTextReader` audited in the same pass: already on the current API
    (`getTerminalWidgets()` / `toShellJediTermWidgetOrThrow`), no change.

## [0.4.53] — IDE workflows: plan review, session manager, handoff, managers, Chrome connector (2026-07-10)

- **Chrome Connector (Tools → ChainlessChain: Chrome Connector).** Drives
  the new `cc browse chrome` CLI surface: launch a debuggable Chrome (a
  DEDICATED profile — sign in once there and the login state persists),
  then capture the active tab's state — console messages and failed/
  4xx-5xx requests observed over a watch window ("Capture with Reload" for
  load-time output), DOM snapshot size, and a screenshot — into a
  monospace report naming the exact CLI command the agent can reproduce.
  Pure core `ChromeConnector` (JUnit-covered); VS Code twin:
  `chainlesschain.chrome.connector`. (Needs a cc with `browse chrome`,
  unreleased at the time of writing.)
- **Worktree Tasks dialog (Tools → ChainlessChain: Worktree Tasks).** Lists
  the repo's agent task worktrees (cc-agent-_ / batch/_ / agent/\*) with
  change footprint (+ins −del, commits ahead), a working/dirty flag, and a
  merge-conflict preview computed with `git merge-tree --write-tree` (older
  git shows "unknown" instead of guessing). Actions: **New isolated task…**
  (runs `cc agent --worktree -p …` in the integrated terminal when the
  Terminal plugin is present, else hands you the command), **Merge** back
  (a conflicted merge is aborted immediately), and **Discard…** (worktree
  remove + branch delete, confirmed — unmerged commits are lost). Pure core
  `WorktreeTasks` (JUnit-covered); VS Code twin:
  `chainlesschain.worktree.tasks` (webview form).
- **Plugin & MCP manager (Tools → ChainlessChain: Manage Plugins & MCP).** A
  three-tab dialog over the CLI's --json surface: runtime plugins with scope
  - manifest validity (Trust / Untrust / Uninstall — per-row scope,
    confirmed — / Add from a local directory or a --registry source), MCP
    servers with policy annotations (Test connect / Remove), and a filterable
    read-only skills listing. Every action shells out to the CLI off-EDT and
    re-lists. Pure core `PluginManager` (JUnit-covered); VS Code twin:
    `chainlesschain.plugins.manage` (webview form).
- **Inline completion hardening (parity audit).** Cancelling a suggestion
  (typing on / dismissing) now interrupts the blocking backend call
  (`runInterruptible`) and KILLS the in-flight `cc complete` child instead
  of blocking up to 12 s for a result nobody will render — mirroring the
  VS Code twin's cancellation-kills-child wiring. Trigger stays manual-only
  (Alt+\); the context sent is still only ±4 000 chars of the current
  document around the caret (no selection, no other files).
- **Token Usage report (Tools → ChainlessChain: Show Token Usage).** A
  monospace dialog joining `cc session usage --json` with the session list:
  all-time totals, activity-window buckets (last 24 h / 7 d / 30 d —
  bucketed by each session's last activity, stated openly as an
  approximation), per-provider/model rollup and top sessions with titles.
  Pure core `UsageReport` (JUnit-covered); VS Code twin:
  `chainlesschain.usage.show`.
- **`getPreviewState` bridge tool.** The agent can now read the App
  Preview dev server's state — running flag, served URL, npm script, last
  exit code and the recent server output tail (16k; build/runtime errors
  keep being captured after the URL is detected) — so it diagnoses the
  preview and fetches the page itself instead of asking you to paste the
  output. (VS Code twin ships the same tool.)
- **`getTerminalOutput` bridge tool (VS Code parity).** The agent can now
  read the integrated terminal's recent output — each entry is one terminal
  tab's buffer tail (16k cap) — so it sees what you just ran and how it
  failed without you pasting it. Same tool name and fields as the VS Code
  twin; the JetBrains terminal has no per-command shell-integration API, so
  `command`/`exitCode` stay null and `output` is the buffer tail. Exposed
  conditionally; with the Terminal plugin disabled the tool reports no
  terminals (no hard plugin dependency added).
- **`/handoff` — hand a conversation off to a background agent.** Stops the
  tab's child and relaunches the SAME session detached (`cc agent --bg
--resume <id>`), so it keeps running without the IDE and can be continued
  from the web panel's Background Agents view (browser/phone), `cc attach
<id>`, or Tools → Background Agents. Pick the session again later to
  re-attach it to a tab.
- **Remote Control action (Tools → ChainlessChain: Remote Control).** Starts
  a `cc remote-control` pairing host as a long-running child of the IDE,
  shows the one-time pairing URI (copyable dialog) so a phone or web panel
  can pair and drive this machine's agent sessions
  (observe/prompt/approve/interrupt), lists discovered hosts
  (`status --json --prune`), and stops them gracefully (CLI stop first,
  process-tree destroy fallback). Pure core `RemoteHandoff` (JUnit-covered);
  VS Code twin: `chainlesschain.remote.control`.
- **Plan Review as a real editor tab.** An active plan now opens (and keeps
  in sync) a Markdown editor tab, preserving your edits across plan updates.
  The plan card offers Approve, Request changes, Regenerate, Reject —
  Approve/Reject sends a review snapshot (`{type:"plan",action,review}`)
  written into the session transcript for audit/replay; Request-changes/
  Regenerate feed your edited review text back to the agent. (VS Code twin
  ships the same workflow.)
- **Shared IDE session index + session manager picker.** JetBrains and
  VS Code both maintain `~/.chainlesschain/ide/session-index.json`
  (metadata only), so `/sessions` now merges CLI sessions with sessions
  started in either IDE — including status and workspace in the popup rows
  (speed-searchable, cross-workspace). Choosing a session now offers
  **Resume / Rename… / Delete…**: rename overlays a title via the shared
  index (works for CLI-only sessions too), delete runs
  `cc session delete --force`, prunes the shared index and clears a tab
  still pointing at the deleted id (Yes/No confirm first).
- **`getActiveFile` bridge tool.** The IDE MCP bridge now exposes the active
  file's path, language, dirty state and cursor position directly. (Also in
  VS Code.)

## [0.4.52] — Background Agents panel (2026-07-10)

- **Background Agents panel (Tools → ChainlessChain: Background Agents)**:
  list `cc agent --bg` supervisor sessions straight from the state dir
  (display-only stale-heartbeat correction, phase/turn/elapsed, log tail),
  send a follow-up prompt or stop the current turn over the session
  transport (one-shot named-pipe/unix-socket connections — the same NDJSON
  protocol `cc attach` speaks; live-verified against a real worker on
  Windows), and stop / rename / resume via `cc daemon … --json`. Pure cores
  `BackgroundAgents` + `BackgroundSessionPipeClient` (smoke-tested); dialog
  form is VS Code `chainlesschain.background.agents` parity (webview there,
  Refresh-driven dialog here). Note: a Windows named pipe handle does NOT
  support concurrent read/write threads — the client uses strictly
  sequential write→read alternation with a watchdog-close timeout.

## [0.4.51] — first conversation survives an IDE restart (2026-07-10)

- **Fix: the first conversation now survives an IDE restart.** Anonymous
  stream sessions are persistence-free by CLI design, so a chat tab's FIRST
  conversation (spawned with no session id) was never written to the session
  store — after an IDE restart the tool window's `--resume` of the id
  captured from `system/init` silently started an EMPTY session, losing all
  pre-restart context. `ConversationView.ensureSession` now declares a
  `panel-<ts>-<rand>` id (`SessionArgs.newPanelSessionId()`) on the very
  first spawn, so the CLI creates and persists the transcript from turn one.
  (Uncovered by the agent-sdk real-CLI e2e; same fix in the VS Code twin.)
- **Docs: the protocol core (`AgentChatSession` / `ChatEvents`) now declares
  Agent Protocol v1 (`packages/agent-sdk/docs/PROTOCOL.md`) as its wire
  contract** — the protocol document, not the TypeScript SDK, is the
  compatibility surface for this plugin.

## [0.4.50] — ghost-text forward-compat: non-deprecated platform APIs (2026-07-09)

- **Fix (forward compatibility): the ghost-text code now uses only non-deprecated,
  non-override-only platform APIs.** The JetBrains Marketplace verifier (which
  checks against newer IDEs than the local 2025.2 gate — 2026.2 EAP / 2026.1.4)
  flagged two API usages in 0.4.49's inline-completion code: `ReadAction.compute`
  (deprecated for removal in 2026.2) and a direct `AnAction.actionPerformed` call
  (an `@ApiStatus.OverrideOnly` API — meant to be overridden, never called). The
  provider now reads the caret context via the coroutine-native suspend
  `readAction {}`, and the trigger action fires the platform's inline-completion
  action through the stable `ActionManager.tryToExecute` instead. No behavior
  change — purely to stay compatible with 2026.x releases. verifyPlugin is now
  clean (no deprecated-API / override-only usages).

## [0.4.49] — inline ghost-text completion + JCEF dashboard + Settings page (2026-07-09)

- **Inline completion (ghost-text).** A manual-trigger inline code completion,
  matching the VS Code `InlineCompletionItemProvider`: press **Alt+\\** (the
  "ChainlessChain: Trigger Inline Completion" action, rebindable in Settings →
  Keymap) and the code around the caret is sent to `cc complete --json`, whose
  reply renders as a gray ghost suggestion you accept with Tab. Manual only —
  nothing runs on ordinary typing, so there is no per-keystroke LLM traffic. It
  shares the same `cc complete` backend as the VS Code extension, so it honors
  the user's configured LLM/provider/key with no new auth (a fast local FIM model
  like `qwen2.5-coder` just makes it snappier). The spawn + request/response
  glue is pure-JDK and JUnit-tested ([`CcCompletion`]); only the thin provider
  adapter is Kotlin, because the platform's inline-completion API is a Kotlin
  `suspend`/`Flow` surface that can't be implemented from Java. Fails quiet: a
  backend hiccup yields no suggestion, never an editor error.
- **Live dashboard tool window (JCEF).** Tools → "ChainlessChain IDE: Open
  Dashboard" (or the ChainlessChain Dashboard tool-window stripe) opens a rich
  webview — status cards (port / tool calls / connections / errors) and a live
  tool-call stream — matching the VS Code `chainlesschain.ide.openDashboard`
  webview instead of the plain-text "Show Activity" dialog. It re-renders only
  when bridge activity changes (no reload churn), is theme-aware (Darcula/light),
  and falls back to a monospace text view when JCEF isn't available on the
  runtime. ("Show Activity" stays as the lightweight dialog alternative.)
- **Settings page — Settings → Tools → ChainlessChain IDE.** The plugin finally
  has a real IDE settings panel (VS Code parity), instead of only a Tools-menu
  wizard. Two options: an explicit **cc CLI path** (the `chainlesschain.cli.path`
  equivalent) for when `cc` is installed somewhere the IDE's PATH doesn't cover —
  it takes precedence over auto-detection and applies without an IDE restart; and
  a toggle for the chat panel's **context-window indicator**
  (`chat.contextIndicator` parity). Settings persist across restarts and are
  localized (en/zh).
- **Localization residuals swept.** The three LLM provider preset labels in the
  configure dialog (Volcengine / Doubao, Ollama, Aliyun Bailian / Tongyi) were
  the last bilingual "English (中文)" display strings; the SDK-free `LlmConfig`
  can't reach the resource bundle, so they now read as clean English, matching
  the "one language per IDE" pass. (A stale `DiffHunks` javadoc example was
  corrected to the actual English `lines …` header shape.)

## [0.4.48] — full localization: one language per IDE + deep link (2026-07-08)

- **Full localization — the plugin follows the IDE language.** Nothing in the UI
  reads as bilingual "English (中文)" anymore. Both the menu/action labels AND
  the runtime dialogs (the LLM-configure wizard, the chat panel's ⚙ LLM menu and
  status hints, "check for updates", "What's New", bridge-restart) now resolve
  from a resource bundle (`messages/CcBundle.properties` English base +
  `CcBundle_zh.properties` via a `CcBundle` `DynamicBundle`), so an English IDE
  shows English and a 中文 IDE (e.g. with the Chinese Language Pack) shows 中文 —
  one language, not both. The few SDK-free (pure) layers that can't reach the
  bundle now emit clean English instead of mixed strings. A smoke gate
  (`PureLogicSmokeMain` `bundleParity`) fails the build if any `plugin.xml`
  action lacks a `.text`/`.description` key, if the en/zh key sets drift, or if a
  zh value was left equal to the English base.
- **Deep link — `jetbrains://idea/chainlesschain/open`.** A doc button, a
  script, or the `cc` CLI can now open
  `jetbrains://idea/chainlesschain/open?prompt=fix%20the%20bug` to focus the
  ChainlessChain chat tool window and (optionally) seed a prompt — VS Code
  `registerUriHandler` parity. Registered via the platform's dynamic
  `jbProtocolCommand` extension point; the URL parsing lives in the SDK-free,
  smoke-tested `DeepLink` (twin of the VS extension's `uri-handler.js`), so an
  unsupported link is ignored rather than misfiring.

## [0.4.47] — feature batch: IDE affordances (2026-07-08)

New Tools-menu capabilities surfacing the `cc` CLI's newer features and
catching up to the VS Code extension. All shipped with the pure-core smoke
gate (PureLogicSmokeMain 430/0).

- **Show Activity — the bridge's tool-call stream.** New Tools action
  "ChainlessChain IDE: Show Activity (工具调用记录)" shows the IDE bridge's
  recent tool calls (getSelection / openDiff / getDiagnostics …) newest-first
  with ✓/✗ status and running totals (calls / errors), plus a Refresh button.
  Every `tools/call` is recorded into a bounded ring buffer. VS Code dashboard
  parity (dialog form — the VS side uses a webview).
- **`/rewind` previews the diff before restoring.** Picking a checkpoint now
  shows its diff (`cc checkpoint show --diff`) in a modal preview with
  Restore / Cancel — the old flow restored the instant you picked, with no way
  to see what would change. Cancel writes nothing; a confirmed restore still
  snapshots your current state first, so it stays undoable.
- **Team Monitor (read-only).** New Tools action "ChainlessChain: Team Monitor
  (团队任务监控)": pick a `cc team run --state <file>` snapshot and view the
  parsed task graph — per-task status, lease holder (stale flag when its lease
  expired), dependencies, retry count — plus progress and status counts, with
  a Refresh button. The CLI runs the team; this window watches. VS Code
  chainlesschain.team.monitor parity (dialog form).
- **Diagnose Bridge.** New Tools action "ChainlessChain IDE: Diagnose Bridge
  (诊断桥接)": this project's bridge state plus the CLI's own discovery view
  (`cc ide status` / `cc ide doctor` / `cc ide jetbrains`) in one scrollable
  report — when a terminal `cc agent` won't auto-connect, the WHY lives on the
  CLI side and used to be invisible from the IDE.
- **What's New is now live from the CLI.** New Tools-menu action
  "ChainlessChain: What's New (cc 更新说明)" renders `cc changelog --json`
  (ships offline with the npm package, needs cc ≥ 0.162.151) in a scrollable
  dialog with your installed version marked — VS Code 0.37.3 parity; the static
  Marketplace change-notes only ever covered the plugin, not the CLI.
- **`/retry` regenerates the last prompt.** New slash command re-sends this
  tab's last successfully-sent prompt as a fresh turn (VS Code parity); listed
  in the `/` autocomplete and `/help`.
- **Restart Bridge is now a real action.** Tools-menu "ChainlessChain IDE:
  Restart Bridge (重启桥接)" tears down + re-listens the bridge MCP server and
  rewrites its discovery lockfile — previously only reachable indirectly via an
  LLM reconfigure, leaving no recovery path for a port conflict / stale
  lockfile.

## [0.4.46] — fix: security + correctness audit batch (P0/P1/P2) + performance

### P0/P1

- **A repo can no longer run its own `cc.bat` when you open the chat panel
  (Windows).** Our spawns run `cmd.exe /c cc …` with the working directory set to
  the open project root, and cmd.exe resolves a bare command name from the
  current directory before PATH — so a cloned/untrusted repo shipping
  `cc.bat`/`cc.cmd` at its root was executed just from opening the panel or a
  version probe. Every spawn now sets `NoDefaultCurrentDirectoryInExePath`.
- **Stop no longer freezes the whole IDE on a hung agent.** The Stop button's
  interrupt/force-kill did blocking stdin I/O on the EDT under the session lock;
  a child whose stdin buffer was full (exactly the hung case the two-click
  escalation targets) froze the UI and the second click could never dispatch.
  The blocking work now runs off the EDT.
- **A second message's pasted image is no longer deleted before it's sent.**
  Sent-image temp files are tracked per-message (FIFO) and each turn deletes
  only its own batch, instead of the first turn deleting every pending temp —
  which destroyed a queued message's image before its turn started.
- **A gcc `cc` on PATH is no longer mistaken for the CLI.** The version-probe
  cache now requires a strict bare-semver first line (like binary resolution),
  so a C-compiler `cc (GCC) 12.2.0` banner is not cached and reported as an
  installed, up-to-date CLI.
- **A mode change (`/auto` etc.) fired mid-spawn is no longer lost.** The
  child-restart is serialized on the tab's send worker, and the shared session
  fields are `volatile`, so a mode change racing a spawn reliably applies on the
  next message instead of silently reusing the old-mode child.

### P2

- **No spurious "agent exited" banner after a deliberate action.** Stopping,
  a mode/thinking change, `/sessions` resume, and LLM reconfigure no longer
  print a misleading `── agent exited ──` line right after their own status
  message — the exit banner now shows only for an exit you didn't trigger.
- **One-shot `cc` captures (`/sessions`, `/rewind`, context) can't return torn
  text.** The capture buffer is thread-safe, so a chatty child still writing
  when the read timeout elapses no longer yields truncated output silently
  parsed as "no saved sessions".
- **A `NaN`/`Infinity` in a tool result can't break the whole response.** The
  JSON writer emits `null` for non-finite numbers (they have no JSON form)
  instead of an unparseable bare `NaN`.
- **An over-size MCP request gets a real HTTP 413**, not a dropped connection
  the CLI can't tell apart from a dead bridge.
- **Crash-left lockfile temp files are cleaned up.** The stale-lock sweep now
  also removes orphaned `*.json.tmp-<pid>` atomic-write temps whose owning
  process is gone (they used to accumulate forever).

### Performance

- **You can scroll back through the transcript while a reply streams.** New
  output only sticks to the bottom when you're already there — scrolling up to
  read no longer yanks you back down on every delta.
- **Faster first message.** The chat spawn reads `~/.chainlesschain/config.json`
  once for all four LLM fields instead of four times (and, when a field was
  absent, up to four sequential `cc config get` calls) — noticeably quicker
  before the first turn.
- **`@`-mention completion picks up new files.** The file/symbol caches refresh
  in the background after 30s instead of living for the whole tab, so files
  created mid-conversation become mentionable without reopening the tab.

## [0.4.45] — feat: live token tally + iteration warnings (VS Code parity) + bug sweep (B1–B9) + polish

- **Live token counter while the agent works.** Each LLM call's `token_usage`
  now accumulates into the status line above the composer —
  `thinking… · 12k→456 tokens (900 cached)` — instead of being invisible until
  the turn ends; the turn's final total shows as `ready · in→out tokens` until
  the context indicator refreshes. Same contract as the VS Code panel.
- **Iteration-budget warnings are visible**: the CLI's `iteration_warning` now
  renders as a `⚠` line in the transcript instead of being silently dropped.
- **Stop can force-kill a hung agent**: the Stop button still interrupts
  first; clicking it again while the same child is running hard-stops the
  whole process tree (interrupt rides stdin, which a hung child never reads).
- **Pasted/dropped image temp files are cleaned up eagerly** — discarded
  attachments on clear, sent ones once their turn completes — instead of
  accumulating in the OS temp dir for the IDE's (long) lifetime.
- **Theme-aware colors**: transcript code/thinking styles, the warning amber
  and the context indicator's red/gray now use `JBColor` pairs, so they stay
  readable under Darcula.
- **Polish**: the IDE-bridge lockfile is published atomically (temp +
  `ATOMIC_MOVE`, so the CLI can never read a half-written JSON); the bridge's
  HTTP executor shuts down with the server; Bearer-token comparison is
  constant-time; `cc --version` probes are cached process-wide (new tabs no
  longer re-spawn them; the manual "检查 cc 更新" action refreshes the cache);
  panel worker threads ride the IDE thread pool instead of bare `new Thread`.

Also in this release — process-lifecycle, EDT and keymap bug sweep (B1–B9).
⌨ **Note: three default shortcuts changed** (see below — the old ones collided
with IDEA built-ins):

- **No more orphaned `cc agent` processes** (Windows): stopping a tab's child —
  mode/thinking switches (`/auto` `/bypass` `/think*`), LLM reconfigure,
  `/sessions` resume, closing a tab/project — now kills the whole process tree
  (the old `destroy()` only ended the `cmd.exe` shim, leaving the real agent
  running mid-turn, burning tokens and holding its DB lock).
- **`/rewind` / `/sessions` / context indicator no longer stall**: one-shot
  `cc` captures drain stderr, so a chatty CLI can't block on a full pipe and
  eat the whole timeout (they showed "unavailable" after a long hang).
- **First message no longer freezes the UI**: session spawn (config read +
  binary probe + process start) runs on a background worker, with double-Enter
  protection; the composer clears only once the send is confirmed.
- **`@`-mention completion**: the project symbol/file scan runs in the
  background (first `@` in a big project used to freeze typing for seconds),
  and an empty scan during indexing is no longer cached forever — symbols now
  appear once indexing finishes.
- **Diagnostics for a specific file work on Windows**: the path filter now
  tolerates backslashes and drive-letter case (it silently returned an empty
  list before).
- **Resume ids no longer silently drop**: session-id persistence hops to the
  UI thread instead of racing tab close from the reader thread.
- **Installing the CLI mid-session recovers**: a failed binary probe is no
  longer cached until IDE restart.
- **⌨ Default shortcuts changed** (the old ones collided with IDEA built-ins —
  Inline, Go to Test, Commit and Push): new chat `Ctrl+Alt+Shift+D`, reopen
  closed chat `Ctrl+Alt+Shift+R`, insert `@file` reference `Ctrl+Alt+Shift+K`
  (macOS: same with ⌘). Rebindable in Settings → Keymap.
- **Robustness**: the embedded JSON parser caps nesting depth (a hostile or
  corrupt payload could previously kill the chat reader thread with a
  StackOverflowError, leaving the panel permanently unresponsive).

## [0.4.44] — feat: drag-drop images + project-memory actions

- **Drag-drop images into the chat** (VS Code 0.37.0 parity): drop image files
  (png/jpg/jpeg/gif/webp/bmp) — or a raw image from another app — onto the
  composer or transcript to attach them to the next message (vision), same
  4-image cap as paste; non-image files are ignored and plain-text drops still
  land at the caret.
- **Two new Tools-menu actions** (VS Code palette parity):
  _Generate Project Memory (cc.md)_ — mode chooser (offline census, or
  `--ai` refine via a bounded headless agent), runs `chainlesschain init` as a
  background task and shows the summary; _Show Project Memory Files_ — the
  effective memory-file chain from `chainlesschain memory files`.

## [0.4.43] — feat: /rewind, /sessions, and hunk-level partial diff accept

- **`/rewind`** — roll the work tree back to an agent auto-checkpoint (the agent
  snapshots before each file edit, cc ≥ 0.162.70): pick a checkpoint from a
  popup chooser; the current state is snapshotted first, then
  `cc checkpoint restore` runs scoped to this tab's session (VS Code panel
  parity).
- **`/sessions`** — resume any saved session in the current tab: pick from
  `cc session list` (id · store · date · title); the live child stops and the
  next message respawns with `--resume <picked>`.
- **Hunk-level partial accept in diff review** — the openDiff decision gains a
  **Pick hunks…** option: change blocks appear as pre-checked checkboxes
  (`行 12-14 (-3 +5) — preview`); unchecked blocks keep the original lines, and
  cancelling writes nothing (fail-safe). Mirrors the VS Code extension's
  hunk picker; the accepted-result shape (`appliedHunks`/`totalHunks`) matches,
  so the CLI handles it unchanged.
- Both new commands appear in the `/` autocomplete and `/help`.

## [0.4.42] — feat: status-bar widget shows bridge state + approval mode

- **A status-bar widget now shows the IDE bridge at a glance** (VS Code
  status-bar parity): `CC :<port>` while the MCP bridge is running, `CC off`
  when it's down — hover for the endpoint, click for the status dialog.
- **The chat's approval mode is finally visible outside the panel:** the widget
  appends `✓auto` (accept edits) or `⚠bypass` (skip all approvals) so an
  elevated mode set via `/auto` · `/bypass` can't go unnoticed; the normal mode
  stays quiet. It updates live on mode changes and when switching conversation
  tabs (tabs can differ in mode).

## [0.4.41] — feat: offer @folder/ completions in the chat @-mention dropdown

- **The chat `@`-mention dropdown now offers workspace folders, not just files**
  (parity with the VS Code extension). As you type `@`, matching folders appear
  alongside files; picking one inserts `@path/` which the `cc` CLI expands to a
  depth-capped recursive tree, letting you hand the agent a whole subtree in a
  single reference instead of attaching files one by one. Requires
  `cc` ≥ 0.162.143 (already published) for the tree expansion.
- _Maintenance:_ synced the in-tree `META-INF/plugin.xml` `<version>` to
  `0.4.41` (it had lagged at `0.4.30`). No behavior change — the gradle
  IntelliJ plugin already patched the version at build time, so shipped
  artifacts were always correct; this only aligns the source of truth.

## [0.4.40] — feat: auto-connect IntelliJ IDEA's built-in MCP server

- **The agent can now use IntelliJ IDEA's own built-in MCP server (IDEA 2025.2+,
  Settings | Tools | MCP Server).** When that server is running, the plugin
  locates its endpoint and hands it to the `cc agent` it spawns, which connects
  it as the `idea` server (`mcp__idea__*`) — so the agent calls the IDE's
  indexed operations (find usages, file-by-path, search, run configs, VCS) as
  tools instead of reading and grepping files itself: **fewer tokens, faster**
  (it rides IntelliJ's index). This is separate from, and complements, the
  plugin's own bridge (selection / diagnostics / native diff). **Best-effort and
  fail-safe:** if the IDE is older than 2025.2 or the MCP server is disabled,
  nothing is injected and the agent behaves exactly as before. Requires
  `cc` ≥ 0.162.125.

## [0.4.39] — fix: stopping App Preview kills the whole dev-server tree

- **Stopping App Preview now terminates the actual dev server, not just the
  `cmd`/`npm` wrapper** (parity with the VS Code extension). `npm run dev` runs
  the dev server as a grandchild (`cmd.exe`/`sh` → `npm` → `node`), but
  `OSProcessHandler.destroyProcess()` only ends the immediate process — leaving
  the dev server orphaned, still holding the port. `stop()` now kills the whole
  descendant tree (`Process.descendants()`) before destroying the handler, so the
  port is freed and no `node` process is leaked.

## [0.4.38] — fix: clean up lockfiles left by crashed instances

- **Stale IDE lockfiles from crashed or force-killed IDE instances are now swept
  on bridge start** (parity with the VS Code extension). Normal shutdown removes
  its lockfile, but a crash leaves it behind — and since each run binds an
  ephemeral port, those orphans (`~/.chainlesschain/ide/<port>.json`) accumulated
  indefinitely. `LockfileWriter.pruneStale()` now removes any lock whose owning
  process is gone (via `ProcessHandle`) or whose file is corrupt, while preserving
  a live sibling IDE's bridge. Mirrors Claude Code's automatic cleanup of leaked
  registrations.

## [0.4.37] — feat: surface unsaved-buffer state in getOpenEditors

- **The `getOpenEditors` tool now reports `isDirty` per open file**
  (`FileDocumentManager.isFileModified`) so the agent can tell that a file has
  unsaved changes in the editor — meaning the on-disk copy it would read is stale.
  Mirrors the VS Code panel and Claude Code IDE's `checkDocumentDirty`.
  Backward-compatible (a new field on each entry).

## [0.4.36] — perf: cap the chat transcript to bound long-session memory

- **Perf: the chat panel now keeps the transcript document under ~200k
  characters instead of growing it without bound.** A long session used to
  append every message, stream chunk and tool line to the `JTextPane` document
  forever — steadily increasing memory. `insertStyled` now trims the oldest text
  from the front once the cap is exceeded, mirroring the VS Code panel's
  transcript cap (`chainlesschain-ide` 0.36.5) and Claude Code 2.1.191's "reduced
  long-session memory growth". Trimming never cuts into the currently-streaming
  assistant run — its absolute offset (`assistantRunStart`) is shifted by exactly
  what was removed, so markdown re-styling at run-end stays correct — and the
  caret stays pinned to the bottom, so what you're reading doesn't jump. The cap
  arithmetic lives in a pure `TranscriptCap` helper (13 new smoke assertions).

## [0.4.35] — fix: pass the full LLM block so cloud providers don't fall through to ollama

- **Fix: the chat panel now passes your endpoint + API key (`--base-url` /
  `--api-key`), not just `--provider` / `--model`.** Pinning only provider/model
  made the CLI drop a cloud provider's baseUrl + key (it skips config resolution
  when `--provider` is explicit), so a volcengine / openai / … setup fell through
  to local ollama → "provider 配置与 baseUrl 不一致，已按 baseUrl 切换到
  ollama → fetch failed", recurring no matter what you configured. The chat spawn
  now reads the **full `llm` block** from `~/.chainlesschain/config.json`
  (provider / model / baseUrl / apiKey). Pairs with the CLI's 0.162.122 self-heal
  as a complete fix.

## [0.4.34] — docs: publish the 0.4.33 "What's New" that was omitted

- No code change — 0.4.33 shipped without its changelog, so the Marketplace
  "What's New" stopped at 0.4.32. This re-release carries the 0.4.33 entry below.

## [0.4.33] — fix: LLM stays configured across `cc` / npm updates

- **Fix: the plugin no longer asks you to re-configure the LLM after every
  `npm i -g chainlesschain` update.** "Is the LLM configured?" used to be
  detected by running `cc config get llm.provider`. Right after a CLI update,
  `cc` is frequently broken for a moment (native-module rebuild / `EBUSY` file
  lock / PATH shim), so that command exits non-zero — and the plugin wrongly
  concluded "not configured", popped the setup card, and made you re-enter
  provider / model / key, **even though `~/.chainlesschain/config.json` was
  completely intact**. Detection now reads that config file **directly** (the
  same file `cc config set` writes), and only falls back to `cc config get`
  when the file is missing. A transient `cc` failure can no longer wipe the
  plugin's view of your configuration. Also fixes base-URL / API-key values
  that contain `=` being truncated by the old parser.

## [0.4.32] — default Volcengine model updated to doubao-seed-2-1-pro-260628

- **The Configure-LLM wizard now defaults the Volcengine (火山引擎/豆包) text
  model to `doubao-seed-2-1-pro-260628`** instead of the older
  `doubao-seed-1-6-251015`. New setups pick the current pro model out of the
  box; existing configs are untouched. The vision model default
  (`doubao-seed-2-0-lite-260215`) is unchanged.

## [0.4.31] — fix: Configure LLM / chat find `cc` even when the IDE PATH lacks it

- **Fix: "Configure LLM" no longer fails with `'cc' is not recognized as an
internal or external command`.** When IntelliJ is launched from a Start-menu /
  desktop shortcut — or was already running when `npm i -g chainlesschain`
  updated PATH — the GUI process never inherits npm's global bin directory
  (`%APPDATA%\npm`), so a plain `cmd /c cc …` can't find the shim. The plugin now
  augments the spawned process's PATH with the usual npm / node bin directories
  (npm global prefix, `Program Files\nodejs`, nvm / volta / fnm, Homebrew,
  `~/.npm-global/bin`, …), so `cc` resolves without you having to fix PATH and
  restart. Applies to **both the LLM-config wizard and the chat panel**.
- When `cc` genuinely can't be located, the error now gives actionable install
  guidance — including the **Node.js >= 22.12.0** requirement (`npm i -g
chainlesschain` aborts on older Node with an unexplained `EBADENGINE` error).
- New pure-JDK `CliLauncher` (PATH merge + missing-CLI detection), covered by the
  smoke suite; `LlmConfig.runCli` now also resolves `cc` / `chainlesschain` so a
  `cc` shadowed by the C compiler doesn't break the wizard.

## [0.4.30] — same fix as 0.4.29 + the Marketplace change-note 0.4.29 omitted

- Identical code to 0.4.29 (Configure-LLM pre-fill / keep-key). 0.4.29 shipped the
  fix but its `plugin.xml` `<change-notes>` wasn't updated, so the Marketplace
  "What's New" wouldn't show it. 0.4.30 adds the change-note (and supersedes the
  in-review 0.4.29, since Marketplace versions are immutable).

## [0.4.29] — fix: Configure LLM pre-fills config — no more re-typing model+key

- **Fix: re-running "Configure LLM" no longer makes you re-enter everything.**
  The wizard now pre-fills the **current model, base URL, and vision model**, and
  pre-selects your **current provider** (marked `✓ 当前`). When you keep the same
  provider, the **API-key dialog can be left blank to keep the stored key** —
  it's only required when there's no key yet or you switch to a new keyed
  provider. The key value is never read into the UI (only its presence), so
  "blank = keep" stays secure. Mirrors the VS Code 0.34.0 fix.
- New `LlmConfig` helpers `getConfiguredModel` / `getConfiguredBaseUrl` /
  `hasConfiguredApiKey`; `buildConfigSetArgs` already omits a blank key so the
  stored one is preserved. (Also fixed a stale smoke-test call to
  `buildConfigSetArgs` that predated the visionModel parameter.)

## [0.4.28] — 2026-06-20 — Marketplace "What's New" now lists every release

- **Fix: the plugin's `<change-notes>` (the Marketplace / IDE "What's New") had
  silently stopped at 0.4.19** — it was hand-written and never synced past that,
  so 0.4.20–0.4.27 (the `/review` command, Configure-LLM restart, update notices,
  interactive `ask_user_question`, the cc-conflict fix, deprecation cleanup) were
  all missing from the update notes. Added every release back in. No code change.

## [0.4.27] — 2026-06-20 — clear the 2 Marketplace deprecated-API warnings

- **Removed the 2 deprecated-API usages** the Marketplace Plugin Verifier flagged
  (so the plugin stays compatible with future IntelliJ releases): the npm-update
  check now uses `URI.create(...).toURL()` instead of the deprecated
  `new URL(String)` constructor, and the single-choice question dialog uses a
  `DialogBuilder` + combo box instead of the deprecated `Messages.showChooseDialog`.
  No behavior change — verifier report goes from "2 deprecated API usages" to clean.

## [0.4.26] — 2026-06-20 — fix: "cc not installed" false alarm + cc-name conflict

- **Fix: the panel no longer cries "未检测到 cc CLI" when `cc` IS installed.** Two
  causes: (1) the version probe timed out on a cold start (Windows node + npm
  `.cmd` shim can take >5s) — bumped to 12s; (2) **`cc` is also the C compiler's
  name**, so if PATH resolved `cc` to gcc/clang the probe got a non-chainlesschain
  banner. The plugin now **resolves the binary with fallback** — it tries
  `cc` → `chainlesschain` → `clc` → `clchain` and picks the first whose
  `--version` prints a bare chainlesschain version (skipping a shadowed `cc`),
  then uses that binary for both the chat spawn and all probes. So a `cc` clash
  no longer breaks the plugin.

- **`ask_user_question` is now interactive** (matches VS Code 0.33.7). When the
  agent asks, the chat tool window pops a dialog — a single-choice picker, a
  multi-select checkbox dialog, or a free-text input — and sends your answer
  back, so the agent can clarify instead of guessing. Cancelling simply lets it
  proceed (0.4.24's graceful behavior). **Requires `cc` ≥ 0.162.95** for the
  round-trip; an older `cc` keeps the 0.4.24 behavior (the panel opts in via
  `CC_INTERACTIVE_QUESTIONS`, which an old `cc` ignores).

## [0.4.24] — 2026-06-20 — no more scary "✗ ask_user_question"

- **Fix.** When the agent tried to ask a clarifying question, the chat showed a
  red **`✗ ask_user_question`** even though nothing broke — there's no
  interactive question round-trip yet, so the CLI degrades gracefully
  (`user_not_reachable`) and the model proceeds on its own. That benign
  degradation (and `user_timeout`) no longer renders as a failure; instead a
  quiet note appears: 「面板暂不支持交互提问 —— 已按最佳判断继续」. Real tool
  errors still show as failures.

## [0.4.23] — 2026-06-20 — check-version menu item + "cc not installed" hint

- **New ⚙ LLM menu item: "检查 cc 更新…".** The 0.4.22 update hint only appeared
  automatically when the tool window opened; now you can check on demand — it
  **always** reports (tells you `cc X 已是最新`, or offers to copy the upgrade
  command when a newer version is published), ignoring the once-per-version
  throttle.
- **The panel now hints up front when `cc` isn't installed.** The chat tool
  window needs the `cc` CLI on PATH; if it's missing it now shows
  「未检测到 cc CLI —— 请先安装:npm i -g chainlesschain」 instead of the
  misleading "未配置 LLM" hint.

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
  (e.g. `401`) until you opened a _new_ conversation. Now the panel restarts the
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
  - the **⚙ LLM** button in the chat panel opens a small menu — _Configure LLM_
    (the full wizard) **or** _Vision model…_ (just `llm.visionModel`);
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
  `code` / inline `code` (monospace amber) and **bold** instead of showing
  raw markers — VS Code parity. Streaming stays responsive (plain text as it
  arrives, then the completed reply snaps to styled). The transcript moved from
  `JTextArea` to `JTextPane`; all other lines (headers, tool trace, info) are
  unchanged. Tiny dependency-free `MarkdownLite` tokenizer (unclosed markers
  degrade to plain text, never losing characters).

## [0.4.12] — 2026-06-18 — "Fix with ChainlessChain" intention (VS Code parity)

- **Fix-with-cc quick-fix.** On a line carrying an error or warning, the
  lightbulb (Alt+Enter) now offers _"Fix with ChainlessChain"_ — it reveals the
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
  _"Read access is allowed from inside read-action only"_ (flagged by the
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
