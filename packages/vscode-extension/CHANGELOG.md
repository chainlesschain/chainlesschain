# Changelog — ChainlessChain IDE Bridge (VS Code)

All notable changes to this extension are documented here.

## [0.37.14] — Protocol hardening, diff/connection safety, capability negotiation (2026-07-12)

- **Diff-apply safety.** Optimistic-concurrency guard (a target file that
  drifted on disk _or_ in an unsaved editor buffer during review is
  re-compared and, by default, cancelled rather than blindly overwritten —
  content comparison, so edit-then-undo does not false-positive) plus a
  binary-file guard (NUL probe; UTF-8 中文 never misflagged). `extensionKind:
  ["workspace"]` pins the extension and its injected terminal to the repo host
  for deterministic Remote/WSL/Dev-Container behavior.
- **Connection safety.** MCP tool-path boundary guard rejects `..`, UNC,
  out-of-workspace and prefix-confusion paths; the Windows lockfile carrying
  the bridge bearer token is written owner-only (icacls ACL, fail-open).
- **Protocol v1 hardening (additive — older CLIs degrade gracefully).** The
  event→UI mapping is now machine-enforced against a cross-language fixture
  contract shared with the JetBrains panel. The vendored Agent Protocol SDK
  (0.1.5) carries the additive per-line fields (`tool_use_id`, event `seq`,
  run-scoped `trace_id`), bg-\* WS relay event-seq gap detection + replay and
  outbound backpressure, and **bidirectional capability negotiation with
  N/N-1 downgrade** (a client `hello` narrows the wire features / protocol
  version; the CLI echoes `system/negotiated` and steps down on disagreement).
  `PROTOCOL_VERSION` stays 1; consumers ignore fields they do not use.

## [0.37.13] — Sessions workbench, semantic tools, managed CLI, artifacts/policy/quality panels (2026-07-11)

- **Sessions Workbench (`ChainlessChain: Sessions Workbench`).** One panel
  aggregating chat sessions, cross-IDE session index, background agents and
  remote-control hosts: search, status pills, waiting-approval-first sort,
  per-kind actions (resume into the chat view, attach via the Background
  Agents panel, daemon resume/stop/rename, remote stop). A failing source
  degrades to a warning row instead of a blank panel; auto-refresh only while
  visible.
- **Semantic tools for the agent.** The IDE bridge now advertises 12 new
  `mcp__ide__*` tools — `getHover`, `goToDefinition`, `findReferences`,
  `renamePreview` (reference-derived, never mutates), `getCallHierarchy`,
  `getSymbolInfo`, `getProjectModel` and friends — so `cc` can navigate
  symbols and project structure instead of only reading files. 1-based
  line/column contract documented per tool; results capped (200 refs /
  100 hierarchy nodes / 8k hover chars).
- **Managed CLI runtime.** When no usable global `cc` exists the extension
  can download, integrity-verify (sha512), cache and roll back its own copy
  of the `chainlesschain` npm package under global storage — first-start
  usable without touching PATH. An explicitly configured `chainlesschain.cli.path`
  is never silently replaced (a broken one surfaces an error and managed is
  only *offered*); exact diagnostics for managed-disabled / no-node-on-PATH /
  node-too-old. New setting `chainlesschain.cli.managed.enabled` (default on),
  commands `Install Managed CLI` / `Roll Back Managed CLI`.
- **Artifacts drawer (`ChainlessChain: Artifacts`).** Browse `cc` artifacts
  with kind filter and mime-aware preview (markdown preview, images inline,
  HTML only via external browser, SVG deliberately as text), plus download /
  copy path / reveal / remove. Only metadata is listed — bodies are never
  inlined.
- **Permissions & Policy viewer (`ChainlessChain: Permissions & Policy`).**
  Read-only visualization of what the agent may do and why: allow/ask/deny
  rules with source file + managed badge, recent denials, auto-mode
  risk→decision matrix with fine-grained rules and the precedence chain,
  and MCP servers when the CLI database is available.
- **Plugin/LSP quality board.** The Plugin & MCP manager gains a Quality
  section: per-plugin contributed component counts, broken (validate
  errors), LSP available/unavailable/unknown from the `cc code-intel`
  probe — unknown is reported honestly, never fabricated — and a
  conservative unused flag that never fires on LSP-only plugins.
- **Remote/WSL Doctor one-click fixes.** Diagnosis now offers a Fix… flow:
  safe fixes apply after one explicit confirmation (allowlisted npm upgrade,
  bridge restart) in a visible terminal; admin-required Windows Firewall
  fixes generate a reviewable `.ps1` (elevation header + idempotency guard,
  hostile check text can never reach the script); `.wslconfig` changes are
  copy-only. The extension never executes admin operations itself.
- **Usage report: attribution + cost hints.** With a new-enough CLI the
  usage report breaks tokens down by origin (main/sub-agent/skill), skill,
  sub-agent and tool/MCP-server call rollups, and adds actionable hints
  (sub-agent-heavy, cache-miss ratio, long-context average) — only when the
  underlying fields actually exist. With an older CLI the report is
  byte-identical to before.
- **CI hardening.** Every packaged `.vsix` now passes a 17-check metadata
  parse gate (publisher/name/version coherence, icon/README/LICENSE/main
  actually packed, vsixmanifest Identity agreement) before it can be
  uploaded or published; the verifier's own selftest runs first.

## [0.37.12] — Remote Control: in-IDE pairing QR + relay settings (2026-07-10)

- **In-IDE pairing QR.** The Remote Control pairing notice gains a "Show QR"
  button and the menu a "Show pairing QR" item: the one-time pairing URI is
  rendered as a QR code right in the IDE (static no-script webview) — no more
  switching to a CLI terminal or pasting the URI by hand to pair a phone.
  The extension ships no QR library, so this adds a self-contained pure
  encoder (byte mode, ECC M, auto version 1–40, ISO 18004 masking), decode-
  verified against the independent jsQR decoder and cross-checked against the
  reference npm `qrcode` implementation; the JetBrains twin asserts the same
  fixtures, so both IDEs render identical symbols. The QR stays black-on-white
  in both themes (scanners need the contrast), the URI is HTML-escaped, and
  the panel closes automatically when the host stops or dies — a stale
  one-time URI never stays scannable. URIs beyond QR capacity fall back to
  copy guidance.
- **Relay (E2EE cross-network) settings.** New `chainlesschain.remote.relayUrl`
  and `chainlesschain.remote.peerId` settings (en/zh descriptions): pairing
  across networks no longer requires CLI env/config. Values are read at each
  host start (a settings change applies to the next start, no reload) and are
  passed as `--relay-url`/`--peer-id`; blank values defer to the CLI's own
  resolution chain (`CC_REMOTE_SESSION_RELAY_URL` → `remoteControl.relayUrl`),
  and the peer id works independently of the relay URL (the relay may come
  from env/config).

## [0.37.11] — P2 hardening: deep-link parity, Remote/WSL Doctor, auto-exec config guard (2026-07-10)

- **Deep link parity — full parameter set (P2 #11).**
  `vscode://chainlesschain.chainlesschain-ide/open` now accepts `session`
  (resume), `file`, `line`, `workspace` and `mode` on top of `prompt` — a doc,
  script or the CLI can hand off into the chat at an exact file/line and resume a
  specific conversation. Security: the prompt is only SEEDED (never auto-sent);
  `mode` accepts only the safe approval modes and NEVER `bypassPermissions` (an
  untrusted link, e.g. from a web page, can't arm auto-approval); the session id
  is shape-validated and `workspace` is checked against the open folder (a link
  for another repo is ignored). Windows / 中文 / space paths round-trip verbatim.
- **Auto-exec config guard (P2 #13).** New `ChainlessChain: Scan Workspace for
Auto-Exec Config` command + a one-time-per-workspace advisory on activation:
  recognizes workspace files that can run code without an explicit action — MCP
  configs (`.mcp.json`), git/husky hooks, shell profiles, `.vscode/tasks.json`
  and `launch.json`/`settings.json`, `.idea/` run configs — and lets you Trust
  the workspace (persisted). The cc agent's own per-write gates still apply; this
  is the heads-up that the freshly-opened workspace already CONTAINS such files
  (which the agent could trigger via tasks/hooks/MCP).
- **Remote / WSL Doctor (P2 #12).** New `ChainlessChain: Remote / WSL Doctor`
  command: diagnoses the environment signals that make the bridge flaky on
  WSL2 / Remote / SSH — mirrored networking, a missing/outdated cc on the remote
  host, a stopped or unreachable bridge port — each with a copyable fix, written
  to the output channel (with a Copy report action).
- **Deprecated-API audit (2026-07-10) — clean, no code change.** Prompted by
  the JetBrains twin's 0.4.53 Marketplace verifier flag, the extension was
  audited for the same class of problem: zero usages of deprecated VS Code
  APIs (`rootPath`, `extensionPath`/`storagePath`/`logPath`, `scm.inputBox`,
  `TextEditor.show/hide`, legacy `Task` constructor), no proposed APIs, and no
  deprecated Node runtime APIs (`new Buffer()`, `url.parse`, `crypto.createCipher`,
  `fs.rmdir`) across `src/**` including the vendored agent-sdk. The
  shell-integration events (stable since VS Code 1.93 > engines ^1.85.0) remain
  behind an existence guard and degrade gracefully on older IDEs.

## [0.37.10] — IDE workflows: plan review, session manager, handoff, managers, Chrome connector (2026-07-10)

- **Chrome Connector (ChainlessChain: Chrome Connector).** Drives the new
  `cc browse chrome` CLI surface: launch a debuggable Chrome (a DEDICATED
  profile — sign in once there and the login state persists; unlike
  `browse fetch` this sees your logged-in pages), then capture the active
  tab's state — console messages and failed/4xx-5xx requests observed over
  a watch window (use "Capture with reload" for load-time output), DOM
  snapshot size, and a screenshot — as a markdown report. The report names
  the exact CLI command so the agent can reproduce the same context itself
  (needs a cc with `browse chrome`, unreleased at the time of writing).
- **Worktree Tasks panel (ChainlessChain: Worktree Tasks).** Lists the
  repo's agent task worktrees (cc-agent-_ / batch/_ / agent/\*) with change
  footprint (+ins −del, commits ahead), a working/dirty state, and a
  merge-conflict preview computed with `git merge-tree --write-tree` (the
  same plumbing the CLI uses; older git shows "?" instead of guessing).
  Actions: **New isolated task…** (runs `cc agent --worktree -p …` in the
  integrated terminal — watchable and interruptible), **Merge** back into
  the main checkout (a conflicted merge is aborted immediately so your tree
  never stays half-merged), and **Discard** (worktree remove + branch
  delete, with a modal warning that unmerged commits are lost). (JetBrains
  twin: Tools → Worktree Tasks, dialog form.)
- **Plugin & MCP manager (ChainlessChain: Manage Plugins & MCP).** A webview
  over the CLI's --json surface: runtime plugins with scope badges and
  manifest validity (Trust / Untrust / Uninstall — per-row scope, confirmed —
  / Add from a local directory or a --registry source), MCP servers with
  policy annotations (Test connect / Remove), and a filterable read-only
  skills listing. Every action shells out to the CLI and re-lists, so the
  CLI store stays the single source of truth. (JetBrains twin: Tools →
  Manage Plugins & MCP, dialog form.)
- **Inline completion hardening (parity audit).** Cancelling a completion
  (typing on / dismissing) now KILLS the in-flight `cc complete` child
  instead of letting it finish an LLM call nobody will render; and the
  reply now goes through the same defensive clean as the JetBrains twin
  (strip accidental markdown fences and `<CURSOR>` echoes, 2 000-char cap,
  trailing-whitespace trim — leading indentation preserved). Trigger stays
  manual-only; the context sent is still only ±4 000 chars of the current
  document around the caret (no selection, no other files).
- **Token Usage report (ChainlessChain: Show Token Usage).** A markdown
  report joining `cc session usage --json` with the session list: all-time
  totals, activity-window buckets (last 24 h / 7 d / 30 d — bucketed by each
  session's last activity, stated openly as an approximation), per-provider/
  model rollup and top sessions with titles. Per-skill/plugin attribution
  needs CLI-side event tagging and is noted as such.
- **`getPreviewState` bridge tool.** The agent can now read the App
  Preview dev server's state — running flag, served URL, npm script, last
  exit code and the recent server output tail (16k; build/runtime errors
  keep being captured after the URL is detected) — so it diagnoses the
  preview and fetches the page itself instead of asking you to paste the
  terminal. (JetBrains twin ships the same tool.)
- **Bridge hardening (payload/token/trust audit).** The MCP bridge's bearer
  token is now compared in constant time (`crypto.timingSafeEqual`, matching
  the JetBrains twin); a client that disconnects during a long blocking
  `openDiff` no longer surfaces an unhandled rejection; and the extension
  now explicitly declares `capabilities.untrustedWorkspaces: false` — the
  bridge stays off until you trust the workspace (this was already the
  effective default; now it's declared).
- **`/handoff` — hand a conversation off to a background agent.** Stops the
  panel child and relaunches the SAME session detached (`cc agent --bg
--resume <id>`), so it keeps running without the IDE and can be continued
  from the web panel's Background Agents view (browser/phone), `cc attach
<id>`, or the IDE's Background Agents panel. Pick the session again later
  to re-attach it to a tab.
- **Remote Control command (ChainlessChain: Remote Control).** Starts a
  `cc remote-control` pairing host as a long-running child of this window,
  surfaces the one-time pairing URI (copy to clipboard) so a phone or web
  panel can pair and drive this machine's agent sessions
  (observe/prompt/approve/interrupt), lists discovered hosts
  (`status --json --prune`), and stops them gracefully (CLI stop first,
  taskkill tree fallback). If the host dies unexpectedly you're told —
  restarting issues a fresh pairing URI.
- **Plan Review as a real editor tab.** A `plan_update` now opens (and keeps
  in sync) an editable Markdown review document instead of only a chat card.
  Editor-title actions: Approve, Request changes, Regenerate, Reject.
  Approve/Reject sends a review snapshot (`{type:"plan",action,review}`)
  that the CLI writes into the session transcript for audit/replay;
  Request-changes/Regenerate feed your edited review text back to the agent
  as revision instructions. (JetBrains twin ships the same workflow.)
- **Shared IDE session index + session manager picker.** VS Code and
  JetBrains both maintain `~/.chainlesschain/ide/session-index.json`
  (metadata only), so `/sessions` now merges CLI sessions with sessions
  started in either IDE — including status (`running`, `waiting_approval`,
  `errored`, `stopped`, `completed`) and workspace, both searchable in the
  picker for cross-workspace lookup. Picking a session now offers
  **Resume / Rename / Delete**: rename overlays a title via the shared index
  (works for CLI-only sessions too — the CLI has no rename command), delete
  runs `cc session delete --force`, prunes the shared index and clears any
  tab still pointing at the deleted id (with a modal confirm first).
- **`getActiveFile` bridge tool.** The IDE MCP bridge now exposes the active
  file's path, language, dirty state and cursor position directly, so the
  agent no longer has to infer them from the selection. (Also in JetBrains.)

## [0.37.9] — Background Agents panel (2026-07-10)

- **Background Agents panel (ChainlessChain: Background Agents).** A new
  webview lists the `cc agent --bg` supervisor sessions read straight from
  the state dir (display-only stale-heartbeat / dead-pid correction,
  phase/turn/elapsed, and a live log tail). Attach to a session to send a
  follow-up prompt or stop the current turn over the session transport — the
  same NDJSON pipe protocol `cc attach` speaks, via the vendored
  `@chainlesschain/agent-sdk` client — with 500 ms log-delta streaming; stop
  / rename / resume go through `cc daemon … --json`. Run it from the command
  palette (`chainlesschain.background.agents`). Mirrored by the JetBrains
  0.4.52 twin (dialog form there).

## [0.37.8] — first conversation survives an IDE reload (2026-07-10)

- **Fix: the first conversation now survives an IDE reload.** Anonymous
  stream sessions are persistence-free by CLI design, so a chat tab's FIRST
  conversation (spawned with no session id) was never written to the session
  store — after a window reload the panel's `--resume` of the id captured
  from `system/init` silently started an EMPTY session, losing all
  pre-reload context. The panel now declares a `panel-<ts>-<rand>` session
  id on the very first spawn, so the CLI creates and persists the
  transcript from turn one. (Uncovered by the new agent-sdk real-CLI e2e;
  same fix in the JetBrains twin.)
- **Internal: protocol argv + NDJSON stream framing now come from the
  vendored `@chainlesschain/agent-sdk`** (`src/vendor/agent-sdk/`, synced by
  `scripts/sync-agent-sdk.mjs`) instead of hand-rolled copies — one contract
  (Agent Protocol v1) shared with web-panel and documented for JetBrains.

## [0.37.7] — inline ghost-text completion (2026-07-09)

- **Inline ghost-text completion (manual trigger).** Press **Alt+\\** (or run
  "ChainlessChain: Trigger Inline Completion") to get an inline suggestion at the
  caret, generated by `cc complete` using your configured LLM. It's manual-only
  by design — typing never calls the model, so there's no per-keystroke latency
  or cost; a fast local FIM model (e.g. ollama `qwen2.5-coder`) makes it snappier
  but any configured provider works. Turn it off with
  `chainlesschain.completion.enabled`. Needs a `cc` that has the `complete`
  command; on an older CLI the trigger simply yields no suggestion (no error).
- **Localization residuals swept.** A few user-facing strings still showed
  hardcoded Chinese regardless of the IDE language: the single-file hunk-picker
  prompt, the "could not read cc release notes" notice, the LLM unsafe-character
  errors, and the hunk-header label. The two glue-layer strings now go through
  `vscode.l10n.t` (with their translations added to the bundle, guarded by the
  `vscode-ext-l10n.test.js` gate); the pure/CLI-shared modules (`llm-config`,
  `diff-hunks`) emit clean English, matching the "one language per IDE" pass.

## [0.37.6] — proper localization: one language per IDE (2026-07-08)

- **Proper localization — the UI now follows your IDE language.** The extension's
  chrome no longer mixes English and Chinese. Command titles, settings labels,
  the sidebar/status-bar, and every dialog/notification/input are now localized:
  an English VS Code shows clean English, a 中文 VS Code shows 中文 — the old
  "English (中文)" double-labels are gone. Command/setting strings move to
  `package.nls.json` + `package.nls.zh-cn.json`; runtime messages go through
  `vscode.l10n.t` with an `l10n/bundle.l10n.zh-cn.json` translation bundle. A
  new test gate (`vscode-ext-l10n.test.js`) fails if a user-facing string is
  ever added without its translation. The webview panels — the chat setup card
  and the bridge dashboard — are localized too: since a webview can't call
  `vscode.l10n.t`, the host resolves the strings and injects them into the page
  (`CC_L10N` / the dashboard's `L`), so the chat setup card and dashboard chrome
  follow the IDE language along with everything else. No mixed-language UI
  remains.

## [0.37.5] — feature batch: IDE affordances (2026-07-08)

New IDE-side capabilities surfacing the `cc` CLI's newer features and closing
Copilot/Claude-Code affordance gaps. All shipped with tests (vscode-ext suite
55 files / 488 green).

- **`/rewind` previews the diff before restoring.** Picking a checkpoint now
  opens its diff (`cc checkpoint show --diff`) in a read-only editor tab and
  asks for a modal confirmation before touching your files — the old flow
  restored the instant you picked, with no way to see what would change.
  Cancel writes nothing; your current state is still snapshotted first, so a
  confirmed restore stays undoable.
- **Team Monitor (read-only).** New command "ChainlessChain: Team Monitor
  (团队任务监控)" watches a `cc team run --state <file>` snapshot in a webview:
  the task graph with per-task status, lease holder, dependencies and retry
  count, plus progress and live/stale-lease counts. Auto-refreshes when the
  file changes (the CLI rewrites it atomically after each task settles) —
  the CLI runs the team, this window watches. The picked file is remembered
  per workspace.
- **✨ Explain / Refactor CodeLens.** Functions, methods and classes get a
  one-click lens (via the language's own symbol provider — every language with
  document symbols, no CLI spawn): it selects the symbol's full range and seeds
  the same `@selection` prompt as the context-menu actions. Capped at 30
  symbols per file; `chainlesschain.codeLens.enabled` turns it off (applies to
  open editors without a reload).
- **Diagnose Bridge.** New command "ChainlessChain IDE: Diagnose Bridge
  (诊断桥接)" renders this window's bridge state plus the CLI's own discovery
  view (`cc ide status` + `cc ide doctor`) as one report — when a terminal
  `cc agent` won't auto-connect, the WHY lives on the CLI side and used to be
  invisible from the IDE.
- **Insert at Cursor on chat code blocks.** Every fenced code block in a reply
  now has an **Insert** button next to Copy: it splices the snippet into the
  active editor at the caret (replacing a non-empty selection) — no full agent
  edit turn needed (Copilot-Chat / Claude-Code parity).
- **perf: the context-window indicator no longer cold-spawns the CLI after
  every turn.** The live context size is derived locally from the stream's own
  `token_usage` events; `cc context --json` is probed ONCE per model (to learn
  the window size) and re-probed only after an LLM reconfigure. On Windows each
  cold `cc` spawn cost seconds per turn. Providers that emit no `token_usage`
  keep the old per-turn probe.

## [0.37.4] — fix: security + correctness audit batch (P0/P1/P2) + performance

### P0/P1

- **A repo can no longer run its own `cc.bat` when you open the chat panel
  (Windows).** Every `cc`/`npm` child is spawned through a shell, and cmd.exe
  resolves a bare command name from the current directory (the open workspace
  root) before PATH — so a cloned/untrusted repo shipping `cc.bat`/`cc.cmd` at
  its root was executed just by opening the panel or a version probe. All spawn
  sites now set `NoDefaultCurrentDirectoryInExePath`, so only PATH is searched.
- **Malicious workspace settings can't inject shell commands.** The
  window-scoped `chainlesschain.chat.model` / `.provider` settings (overridable
  in a workspace `.vscode/settings.json`) flowed unsanitized into a `shell:true`
  argv that runs after every turn — a value like `x & calc` would execute
  `calc`. Values with shell metacharacters are now dropped (the CLI default is
  used) with a one-time warning.
- **Chinese (multi-byte) content in large MCP payloads is no longer corrupted.**
  The MCP request body is decoded as UTF-8 across socket chunks, so a CJK
  character split at a 64KB boundary in an `openDiff` body is reassembled
  instead of being written to disk as `�` on Accept.
- **A question in a background chat tab no longer hangs the agent.** An
  `ask_user_question` that arrives while you're viewing another tab now flags
  that tab (dot + toast) and re-surfaces the card when you switch to it, instead
  of being silently dropped until the agent's answer-timeout.
- **A `/sessions` resume survives a window reload.** The picked session id is
  persisted immediately, so reloading before the next message no longer restores
  the tab's old session.
- **Configure-LLM now applies to every tab.** Running the wizard restarts every
  tab's child (they all shared the stale global config), not just the active
  tab's.

### P2

- **Reasoning no longer bleeds between tabs.** Switching tabs while one is
  mid-"thinking" stream used to append the incoming tab's reasoning into the
  outgoing tab's (now detached) block; the reasoning-block pointers are reset on
  switch.
- **`/retry` regenerates THIS tab's last prompt**, not whichever prompt was last
  typed in any tab (the last-prompt memory is now per-tab).
- **"New" lets the fresh chat re-name itself.** A new conversation started with
  "New" no longer keeps the previous conversation's auto-title — the title resets
  to a default so it re-derives from the new first message.
- **The "What's New" toast no longer fires on a downgrade.** Installing an older
  `cc` no longer shows "cc CLI updated → <older>" (and offers notes the older CLI
  can't produce); the nudge fires only on an actual version increase.
- **More conversation tabs survive a reload** (the restore bound was raised well
  above realistic tab counts, so tabs are no longer silently dropped).
- **A stdin write to a just-crashed agent can't take down the extension host.**
  An async `EPIPE` on the child's stdin is now handled instead of thrown
  uncaught.
- **A terminal killed mid-capture no longer leaks its buffered output** — the
  in-flight capture entry is dropped when the terminal closes.

### Performance

- **Faster activation.** `cc --version` is probed once per binary and shared
  across the startup checks (binary resolution + the missing/outdated/latest
  notices + the What's-New nudge), instead of up to ~5 cold ~12s-capped spawns.
- **Batch diff reviews no longer pile up editor tabs** — `openMultiDiff` closes
  its review tab after a decision, like the single-file `openDiff`.
- **The bridge dashboard coalesces updates.** A busy agent turn (a full snapshot
  per tool call) now rebuilds the activity table once per animation frame rather
  than on every event.

## [0.37.3] — feat: reload-surviving tabs, auto-named tabs, What's New panel + bug-sweep batch

- **Conversation tabs survive window reloads.** All tabs — title, resume id,
  approval mode, thinking level, and which one was active — are persisted per
  workspace and rebuilt on the next open (they used to collapse into a single
  tab). Each restored tab resumes its own session on its first message.
- **Tabs name themselves.** A tab's title becomes the first message you send
  in it (30-char cap) instead of staying "Chat N"; deliberate titles are never
  overwritten.
- **"What's New in cc CLI" panel.** `ChainlessChain: What's New` renders the
  CLI's own offline release notes (`cc changelog --json`, cc ≥ 0.162.151) as a
  markdown preview, and after a cc upgrade a one-shot toast offers it.
- **`@`-mention completion picks up new files.** The workspace file cache now
  refreshes after 30s instead of living for the whole session, so files
  created mid-conversation appear without hitting "New".

Also in this release — bug-sweep batch (keyboard diff review, process
cleanup, silent-failure hardening):

- **Diff Accept/Reject keybindings actually work.** The command callbacks
  referenced a variable scoped inside `startBridge()` — every keypress threw a
  `ReferenceError` (buttons were unaffected). Now wired through module state,
  with a new activation smoke test that invokes every registered command so
  this whole bug class fails in CI.
- **Stopping the chat agent kills the whole process tree on Windows.** The
  child is a `cmd.exe` shim; a plain `kill()` orphaned the real `cc` process,
  which kept running its turn (burning tokens, holding the SQLite lock). Now
  `taskkill /T /F`, same as the preview pane.
- **"Accepted" always means "on disk".** `applyEdit` rejections (e.g.
  read-only docs) resolve `false` without throwing; that used to be reported
  as `accepted` with no write — now it forces the direct file-write fallback.
- **App-preview URL detection survives chunk splits.** Dev-server output is
  now line-framed with per-stream carry buffers, so a URL straddling a stdout
  chunk boundary no longer leaves the preview stuck on "starting".
- **Concurrent diff reviews (multi-tab chat) no longer clobber each other.**
  Reviews stack; the Accept/Reject keys prefer the review whose diff tab is
  focused, and the keybinding context stays active while any review is open.
- **Pasted-image temp files are cleaned up** when the turn completes (and on
  panel dispose) instead of accumulating in the OS temp dir forever.
- **API key now also rides the child environment (`CC_API_KEY`)** instead of
  only argv (visible to every same-user process). `--api-key` is still passed
  for older CLIs; it will be dropped once the minimum CLI version includes the
  env fallback.
- **Dashboard CSP nonce is now actually random** (was a deterministic
  constant), and a bridge restart no longer stacks duplicate terminal-capture
  listeners. A truncated final output line from the agent (no trailing
  newline) is flushed instead of dropped.

## [0.37.2] — feat: live token tally + iteration warnings in the chat panel

- **Live token counter while the agent works.** Each LLM call's usage now
  accumulates into the status line — `thinking… · 12.3k→456 tokens (900
cached)` — instead of being invisible until the turn ends; the final
  `ready · in→out tokens` line uses the same compact formatting.
- **Iteration-budget warnings are visible.** When a turn approaches its
  iteration limit the CLI's warning now renders as a `⚠` line in the
  transcript instead of being silently dropped.

## [0.37.1] — chore: maintenance republish

- No functional changes since `0.37.0`. Version bumped to re-run the
  marketplace publish pipeline (Open VSX primary, VS Code Marketplace if
  configured) via the `ide-vscode-v0.37.1` release tag.

## [0.37.0] — feat: Claude Code chat parity (folder mentions, drag-drop, deep links)

A batch of chat-panel parity features aligning the bridge with the Claude Code
IDE experience:

- **`@folder/` mentions.** The chat `@`-picker now offers workspace folders
  (not just files); selecting one inserts `@path/` which the `cc` CLI expands to
  a depth-capped recursive tree, so you can hand the agent a whole subtree in one
  reference. (Needs `cc` ≥ 0.162.143, already published.)
- **Drag-and-drop images.** Drop an image file onto the chat to attach it for a
  vision turn — no need to type the path.
- **Session search.** The "Reopen Closed Chat" picker now matches on title and
  date, so you can find an old conversation by typing instead of scrolling.
- **Approval-mode status bar.** A status-bar item shows the chat's current
  approval mode (`approvals` / `auto-accept edits` / `bypass approvals`), with a
  warning background when approvals are bypassed; click it to switch.
- **Expand/collapse all reasoning.** `Ctrl/Cmd+O` (or the `/expand` chat command)
  toggles every reasoning block at once, instead of one at a time.
- **URI deep links.** `vscode://chainlesschain.chainlesschain-ide/open` focuses
  the chat; add `?prompt=…` to also seed the input. Lets other tools and docs
  link straight into a ChainlessChain chat.

## [0.36.16] — chore: publish to the official VS Code Marketplace

- **No functional changes** — same code as 0.36.15. This version exists to
  publish the extension to the **official VS Code Marketplace**
  (marketplace.visualstudio.com), in addition to Open VSX, now that a `VSCE_PAT`
  secret is configured. Real VS Code users can now find "ChainlessChain IDE
  Bridge" in the Extensions panel.

## [0.36.15] — fix: stopping App Preview kills the whole dev-server tree

- **Stopping App Preview (or closing the editor) now terminates the actual dev
  server, not just the `npm` wrapper.** `npm run dev` launches the dev server as
  a grandchild (`cmd`/`sh` → `npm` → `node`), so the previous `child.kill()` left
  it orphaned — still holding the port, causing "port already in use" on the next
  start and leaking `node` processes. The dev server is now spawned in its own
  process group (POSIX) and killed by tree: `taskkill /T /F` on Windows,
  `process.kill(-pid)` on POSIX. Tree-kill is an injected seam (defaults to
  `child.kill()`), so the controller stays host-free testable.

## [0.36.14] — fix: clean up lockfiles left by crashed instances

- **Stale IDE lockfiles from crashed or force-killed editor instances are now
  swept on bridge start.** Normal shutdown removes its lockfile, but a crash
  leaves it behind — and since each run binds an ephemeral port, those orphans
  (`~/.chainlesschain/ide/<port>.json`) accumulated indefinitely. `startBridge`
  now prunes any lockfile whose owning process is gone (or whose file is corrupt),
  while preserving a live sibling editor's bridge. Mirrors Claude Code's automatic
  cleanup of leaked registrations.

## [0.36.13] — fix: a late bridge-server error can't crash the extension

- **A server error after the bridge is listening no longer risks taking down the
  extension.** The start path removes its one-shot error listener once `listen()`
  succeeds, which left the HTTP server with no `error` handler — and Node throws
  an `'error'` event with no listener as an _uncaught_ exception. A persistent
  guard now absorbs any later server error (and surfaces it through the new
  `onError` hook, logged to the bridge output channel). Defensive hardening; the
  localhost ephemeral-port server rarely errors post-listen, but it must not be
  able to crash the host when it does.

## [0.36.12] — fix: the chat panel keeps its conversation when you switch sidebar views

- **The chat panel no longer loses its transcript when you switch to another
  sidebar view (Explorer, Source Control, …) and back.** The webview view provider
  is now registered with `retainContextWhenHidden`, so the panel's DOM is kept
  alive while hidden instead of being torn down and rebuilt empty (the panel never
  replayed the transcript, so the visible conversation just vanished). Also avoids
  re-running the view setup on every re-show. Retained memory stays bounded by the
  transcript node cap added in 0.36.5.

## [0.36.11] — fix: closing the multi-file review tab now rejects

- **Closing the multi-file review tab now unblocks the agent as rejected**,
  matching single-file `openDiff`. Previously `openMultiDiff` only resolved via
  the notification buttons (or the new keybindings), so closing the multi-diff
  editor left the agent waiting until you _also_ dismissed the notification. The
  tab is captured by reference when it opens, so closing it settles the review as
  rejected. Degrades to the previous button-only behavior on hosts without the
  `tabGroups` API.

## [0.36.10] — feat: keyboard accept/reject also covers the multi-file review

- **The Accept/Reject keybindings now work for the batch multi-file review
  (`openMultiDiff`), not just single-file diffs.** 0.36.9 only wired the
  single-file `openDiff`; a multi-file changeset still required clicking the
  notification button. `openMultiDiff` now registers on the same
  `chainlesschainDiffActive` handle, so **Cmd/Ctrl+Enter applies all** and
  **Cmd/Ctrl+Shift+Backspace rejects** the whole changeset. No new keys or
  commands — the existing bindings just cover both review types now.

## [0.36.9] — feat: keyboard accept/reject for diff review

- **You can now decide a diff review from the keyboard** instead of clicking the
  notification button: **Cmd/Ctrl+Enter accepts**, **Cmd/Ctrl+Shift+Backspace
  rejects** (mirrors Claude Code IDE). Both are scoped to a new
  `chainlesschainDiffActive` context key, so they're inert unless a review is
  actually open, and they're modifier-qualified so a bare Enter/Backspace still
  edits the (editable) proposal pane normally. Closing the diff tab still rejects,
  and the notification buttons still work — this just adds the keyboard path.
  Also available as the `ChainlessChain: Accept/Reject Diff Review` commands.

## [0.36.8] — fix: getOpenEditors lists all open tabs, not just visible ones

- **`getOpenEditors` now enumerates every open editor tab** (including background
  tabs) instead of only the split-visible editors. It previously read
  `visibleTextEditors`, which is just the 1–3 editors currently on screen, so the
  agent couldn't see the rest of the files you have open. It now walks
  `tabGroups.all` (VS Code 1.67+) and resolves each tab's `languageId`/`isDirty`
  from the matching open document — matching the JetBrains panel's `getOpenFiles`
  and Claude Code IDE. Non-text tabs (diff / webview / image) are skipped; older
  hosts without `tabGroups` fall back to the visible editors.

## [0.36.7] — feat: surface unsaved-buffer state in getOpenEditors

- **The `getOpenEditors` tool now reports `isDirty` per editor** so the agent can
  tell that a file has unsaved changes in the editor — meaning the on-disk copy it
  would read is stale. Previously it only returned `{ file, active, languageId }`,
  so the agent could silently read a stale file while you had unsaved edits open.
  Mirrors Claude Code IDE's `checkDocumentDirty`. Backward-compatible (a new field;
  always a boolean even on hosts that don't report dirtiness), and the tool
  description now tells the agent to read from the editor or ask you to save when a
  file is dirty.

## [0.36.6] — fix: close the stale diff tab after a button decision

- **Fix: a review diff tab is now closed once you decide via a button (Accept /
  Reject / Pick hunks… / Request changes…), not just when you close the tab
  yourself.** Previously only the close-the-tab gesture removed the diff; clicking
  a button left the now-stale side-by-side comparison open, so diff tabs piled up
  across a multi-edit agent session (the reason Claude Code ships
  `closeAllDiffTabs`). The cleanup runs in a `finally` **after** the chosen path
  has read the (possibly user-edited) right pane and applied it, so no in-pane
  edit is lost; "Request changes…" stays open while you annotate and closes once
  the notes are collected. Falls back to a no-op on editors without the
  `tabGroups` API.

## [0.36.5] — perf: cap the chat transcript to bound long-session memory

- **Perf: the chat panel now keeps at most the 800 most-recent transcript nodes
  instead of growing `#log` (and each tab's detached buffer) without bound.** A
  long session used to accumulate every message, stream block, tool line and card
  as a DOM node forever — steadily increasing memory and slowing scroll/reflow.
  `add()` now trims the oldest off-screen nodes once the cap is exceeded
  (`trimLog()` drops from the front), mirroring Claude Code 2.1.191's "reduced
  long-session memory growth". The webview is purely a view — conversation state
  for resume lives in the CLI — so this only trims old visual scrollback; nothing
  functional is lost. Because `add()` always re-pins to the bottom, trimming the
  oldest nodes never shifts what you're reading (no scroll jump), and the active
  stream block plus any pending approval/question card are always the newest
  nodes, so they're never removed.

## [0.36.4] — perf: coalesce streaming deltas to cut chat-panel CPU

- **Perf: the chat panel now renders streamed assistant text at most once per
  animation frame instead of once per token.** Each delta used to re-parse the
  entire growing markdown string (`mdLite`) and replace `innerHTML` — O(n²) work
  plus a DOM reflow on every token, which pinned CPU on fast streams. Deltas are
  now accumulated synchronously and the expensive render is batched into one
  `requestAnimationFrame` per burst (~60fps), mirroring Claude Code 2.1.191's
  "reduced CPU during streaming via text update coalescing". The block is flushed
  synchronously before it closes (tool call / question / approval / turn end /
  exit) so the final tokens are never lost, and a pending render is cancelled when
  its block is discarded (new conversation / tab switch). Output is byte-identical;
  only the render cadence changed.

## [0.36.3] — fix: pass the full LLM block so cloud providers don't fall through to ollama

- **Fix: the chat panel now passes your endpoint + API key (`--base-url` /
  `--api-key`), not just `--provider` / `--model`.** Pinning only provider/model
  made the CLI drop a cloud provider's baseUrl + key (it skips config resolution
  when `--provider` is explicit), so a volcengine / openai / … setup fell through
  to local ollama → "provider 配置与 baseUrl 不一致，已按 baseUrl 切换到
  ollama → fetch failed", recurring no matter what you configured. `resolveChatLlm`
  now resolves the **full `llm` block** from `~/.chainlesschain/config.json`
  (provider / model / baseUrl / apiKey) when the effective provider matches your
  config; a different explicit provider override carries neither (you own that
  endpoint/key). Pairs with the CLI's 0.162.122 self-heal as a complete fix.

## [0.36.2] — docs: publish the 0.36.1 changelog entry that was omitted

- No code change — 0.36.1 shipped without its changelog entry. This re-release
  carries the 0.36.1 entry below.

## [0.36.1] — fix: LLM stays configured across `cc` / npm updates

- **Fix: the panel no longer asks you to re-configure the LLM after every
  `npm i -g chainlesschain` update.** "Is the LLM configured?" used to be
  detected by running `cc config get llm.provider`. Right after a CLI update,
  `cc` is frequently broken for a moment (native-module rebuild / `EBUSY` file
  lock / PATH shim), so that command exits non-zero — and the extension wrongly
  concluded "not configured", popped the setup card, and made you re-enter
  provider / model / key, **even though `~/.chainlesschain/config.json` was
  completely intact**. Detection now reads that config file **directly** (the
  same file `cc config set` writes), and only falls back to `cc config get`
  when the file is missing. A transient `cc` failure can no longer wipe the
  panel's view of your configuration. Also fixes base-URL / API-key values
  that contain `=` being truncated by the old parser.

## [0.36.0] — default Volcengine model updated to doubao-seed-2-1-pro-260628

- **The Configure-LLM wizard now defaults the Volcengine (火山引擎/豆包) text
  model to `doubao-seed-2-1-pro-260628`** instead of the older
  `doubao-seed-1-6-251015`. New setups pick the current pro model out of the
  box; existing configs are untouched. The vision model default
  (`doubao-seed-2-0-lite-260215`) is unchanged.

## [0.35.0] — clearer setup: install guidance names the Node.js floor

- **Install / missing-`cc` messages now state the Node.js requirement
  (>= 22.12.0).** `npm i -g chainlesschain` aborts on older Node with an
  unexplained `EBADENGINE` error, so every "cc isn't installed / couldn't read
  the cc version / couldn't reach the agent" surface now spells out the floor.
- The **Configure-LLM wizard** now detects a "cc not found" write-failure and
  shows actionable install guidance (with the Node floor) instead of the raw
  shell error.
- New `version-check` helpers `MIN_NODE_VERSION` / `INSTALL_COMMAND` /
  `installGuidance` / `looksLikeMissingCli` (single source of truth), unit-tested.

## [0.34.0] — fix: Configure LLM pre-fills your config — no more re-typing model+key

- **Fix: re-running "Configure LLM" no longer makes you re-enter everything.**
  The wizard now pre-fills the **current model, base URL, and vision model**, and
  surfaces your **current provider first** (marked `✓ 当前`). When you keep the
  same provider, the **API-key box can be left blank to keep the stored key** —
  it's only required when there's no key yet or you switch to a new keyed
  provider. The key value is never read into the UI (only its presence), so
  "blank = keep" stays secure.
- **Why:** previously every reconfigure reset model/baseUrl to preset defaults
  and forced re-typing the API key — the reported "更新后又要重新配置模型和key"
  pain. Note the config itself was never lost (it lives in
  `~/.chainlesschain/config.json` and survives CLI updates); the wizard just
  didn't pre-fill it.
- New `llm-config` helpers `getConfiguredModel` / `getConfiguredBaseUrl` /
  `hasConfiguredApiKey`; `buildConfigSetArgs` already omits a blank key so the
  stored one is preserved. +3 tests.

## [0.33.9] — 2026-06-20 — fix: the question prompt now shows IN the panel

- **Fix: `ask_user_question` is answered with an in-panel card, not a native
  popup.** 0.33.7 used a native QuickPick/input box, which renders at the top of
  the window and **could silently fail to appear when the chat panel had focus**
  — leaving the agent stuck "thinking…". The question now renders as a card right
  in the chat (like the approval cards): clickable **option buttons** (single),
  **checkboxes + Submit** (multi-select), or a **text input** (free-text), plus a
  **Skip** button. Always visible, no focus dependency. Your click sends the
  answer back and the agent continues.

## [0.33.8] — 2026-06-20 — robust `cc` resolution (cc-name conflict) + cold-start

- **The panel no longer breaks when `cc` is shadowed by another tool.** `cc` is
  also the C compiler's name, so on a PATH where `cc` = gcc/clang the extension
  would spawn the wrong binary / mis-detect the CLI. It now **resolves the binary
  with fallback** — tries `cc` → `chainlesschain` → `clc` → `clchain` at
  activation and uses the first whose `--version` is a real chainlesschain
  version (a bare semver, not a compiler banner), for both the chat spawn and
  every probe. An explicit `chainlesschain.cli.path` still wins.
- **Fixed a false "cc not installed" on cold starts** — the version probe timed
  out at 5s (a cold Windows `cc` cold-start can take longer); bumped to 12s, and
  the missing-cc check now requires a bare chainlesschain version so a compiler
  `cc` isn't mistaken for the CLI. (Mirrors JetBrains 0.4.26.)

- **`ask_user_question` is now interactive.** Previously the panel couldn't
  answer the agent's questions, so it degraded to "proceeding autonomously"
  (0.33.6 just stopped showing that as an error). Now, when the agent asks, the
  panel pops a native **QuickPick** (multi-select supported) — or an input box
  for free-text — and sends your answer back, so the agent can clarify instead
  of guessing. The question is echoed into the transcript; cancelling (Esc) or
  not answering simply lets the agent proceed (no hang). **Requires `cc`
  ≥ 0.162.95** for the round-trip; an older `cc` keeps the graceful 0.33.6
  behavior (the panel opts in via `CC_INTERACTIVE_QUESTIONS`, which old `cc`
  ignores).

- **Fix.** When the agent tried to ask you a clarifying question, the panel
  showed a red **`✗ ask_user_question failed`** even though nothing actually
  broke — the panel has no interactive question round-trip yet, so the CLI
  degrades gracefully (`user_not_reachable`) and the model just proceeds on its
  own. That benign degradation (and `user_timeout`) is no longer rendered as a
  tool failure; instead you get a quiet note: _"couldn't ask interactively in the
  panel — proceeding autonomously"_. Real tool errors still show as failures.

## [0.33.5] — 2026-06-20 — check-version button + "cc not installed" warning

- **New command + button: "Check for CLI Updates".** The 0.33.4 update notice
  only fired automatically on startup; now there's a manual trigger in the chat
  view's title `⋯` menu (and the command palette) that **always** reports — tells
  you `cc X is up to date` or offers a one-click **Upgrade cc** — and ignores the
  once-per-version throttle / "don't show again". The existing **Upgrade CLI**
  command is now surfaced in the same menu too, so checking and upgrading the
  `cc` CLI no longer requires hunting through the command palette.
- **The panel now warns up front when `cc` isn't installed.** The chat panel
  needs the `cc` CLI on PATH; previously a missing CLI only surfaced when you
  sent your first message (spawn failure). On activation it now detects a
  missing/unusable `cc` and offers **Install cc** (`npm i -g chainlesschain`),
  **Set CLI path** (jumps to the `chainlesschain.cli.path` setting), or
  **Don't show again**.

## [0.33.4] — 2026-06-20 — notify when a newer cc CLI is available

- **You're now told when a newer `cc` is published.** The extension and the
  `chainlesschain` CLI ship on independent tracks (Open VSX vs npm), so a
  working-but-old `cc` would silently miss newer panel features. On activation
  the extension now checks the npm `latest` release against your installed `cc`
  and, if you're behind, shows a one-click **Upgrade cc** notification (runs
  `npm i -g chainlesschain@latest` in a terminal). Shown at most once per new
  version; **Don't show again** silences it for good. Best-effort and offline-
  safe — any probe/network failure stays quiet. (The existing hard-floor check —
  "your cc is too old for this extension" — is unchanged and takes priority.)

## [0.33.3] — 2026-06-20 — fix: Configure-LLM now restarts running chats

- **Fix.** After you reconfigured the LLM (⚙ provider / model / API key), the
  chat tab you were already in kept using the **old** config — a `cc` child is
  spawned with the LLM settings pinned at start, so it would keep erroring (e.g.
  `401`) until you opened a _new_ conversation. Now, once the Configure-LLM
  wizard closes, the panel stops every running child so the next message in each
  tab respawns with the fresh config. No more "I configured it but it still
  errors / only a new chat works."

## [0.33.2] — 2026-06-20 — `/review` panel command (review the current diff)

- **New `/review` slash command in the chat panel.** Type `/review` to ask the
  agent to review your uncommitted git changes — it inspects the working-tree
  diff (`git diff` / `git diff --staged`) with this window's IDE context
  (selection, diagnostics, open editors) riding along, flags correctness bugs
  first and simplifications/cleanups second, and cites `file:line`. It does not
  edit files unless you ask. Like `/retry`, it's local sugar that seeds a turn
  (no new control plumbing); discoverable in the `/` autocomplete and `/help`.
  Brings the panel closer to Claude Code's IDE review affordance.

## [0.33.1] — 2026-06-19 — fix: suggested vision model matches the CLI default

- **Fix.** The vision-model entry prefilled `doubao-seed-1-6-vision-250815`, but
  the CLI's actual default is `doubao-seed-2-0-lite-260215` (a newer,
  natively-multimodal model). The suggestion now mirrors the CLI (with a test
  guarding against future drift), so the prefilled value equals what
  `cc agent --image` would use. Verified live: the new model works and is faster
  / more accurate than the old one.

## [0.33.0] — 2026-06-19 — dedicated vision-model entry

- **You can now set the image-recognition (vision) model on its own.** It used
  to only appear as the last step of the full Configure-LLM wizard, so changing
  it meant re-walking provider → model → API key → base URL. New command
  **ChainlessChain: Configure Vision Model** (command palette, and in the chat
  view's title `⋯` menu) writes just `llm.visionModel` — prefilled with the
  current value (or the configured provider's suggestion); leave it blank to
  clear it. No API-key re-entry. (Matches the JetBrains 0.4.18 ⚙ LLM menu.)

## [0.32.1] — 2026-06-19 — guided-setup card now triggers on bare auth failures

- **Fix: a bare `401`/`403`/`Unauthorized`/`authentication failed` now surfaces
  the guided-setup card** (Configure LLM) instead of a raw error. The trigger
  previously only matched connection failures or messages containing the literal
  "api key", so a wrong/expired key that reported just `Anthropic error: 401`
  slipped through as a bare error. The detector (`looksLikeLlmConfigError`) now
  mirrors the JetBrains panel, so both editors react to the same failures.

## [0.32.0] — 2026-06-18 — configurable image-recognition (vision) model

- **Separate vision model.** The Configure-LLM wizard now has a dedicated
  image-recognition (vision) model step, written to `llm.visionModel`, so the
  text model and the vision model no longer have to be the same — e.g. a text
  LLM plus `doubao-seed-1-6-vision` for screenshots. The panel already switches
  to the vision model automatically when you paste a screenshot; this lets you
  pick which one. Leave it blank to reuse the text model / the CLI default.
  (Matches the JetBrains 0.4.16 wizard.)

## [0.31.1] — 2026-06-18 — fix: chat panel uses your configured LLM provider

- **Fix: the chat panel now deterministically uses the provider you configured
  (`cc config` / Configure LLM), instead of occasionally falling back to a
  different provider and failing with a cryptic `Anthropic error: 401`.** When
  the panel's own `chainlesschain.chat.provider` setting is empty, the panel now
  reads `~/.chainlesschain/config.json` and passes the provider/model
  **explicitly** to `cc agent` (`--provider`/`--model`), so it always matches the
  terminal `cc` and can't drift to a stale ambient default. A non-empty panel
  override still wins.

## [0.31.0] — 2026-06-18

- **`/compact` — manual conversation compaction in the chat panel (Claude-Code
  IDE parity).** Long conversations can now be trimmed on demand: typing
  `/compact` shortens large old tool results in the live history (preserving
  recent turns and tool pairs, no extra LLM call) and reports
  `compacted: saved <N> tokens`. Added to the slash-command autocomplete and
  `/help`. Built on a new `{type:"compact"}` control event in the CLI streaming
  protocol, so the compaction happens in the panel's `cc agent` child between
  turns without ending the conversation.

## [0.30.1] — 2026-06-16

- **Fix: CJK IME composition no longer cancels or submits mid-compose
  (Claude-Code 2.1.178 parity).** Pressing **Esc** to dismiss the IME candidate
  window used to also interrupt the running turn, and pressing **Enter** to
  confirm a candidate used to submit a half-composed message. The chat panel
  now tracks composition (`compositionstart`/`compositionend` plus
  `event.isComposing`/`keyCode 229`) and skips the Esc→interrupt and Enter→send
  paths while an IME composition is active. Affects Chinese/Japanese/Korean
  input.

## [0.30.0] — 2026-06-15

- **Approval-mode selector — `/auto`, `/bypass`, `/normal` (Claude-Code parity).**
  The chat panel can now run the agent hands-off. `/auto` auto-accepts file edits
  (`--permission-mode acceptEdits`), `/bypass` skips all approvals
  (`--permission-mode bypassPermissions`), and `/normal` returns to the default
  per-action approval flow. The mode is per-conversation; because the flag is set
  at spawn time, switching mode stops the live agent child and the next message
  respawns it with the new mode — resuming the same session so context carries
  over. Plan mode is unchanged (`/plan` still drives it live). All three are in
  the `/` autocomplete and `/help`.
- **New-conversation & reopen-closed keyboard shortcuts (Claude-Code parity).**
  `Cmd/Ctrl+Alt+N` reveals the panel and opens a fresh conversation tab from
  anywhere; `Cmd/Ctrl+Shift+T` (when the chat view is focused) reopens the most
  recently closed tab, **resuming its session** so you can pick the conversation
  back up. Both are also in the command palette, and a **＋** button now sits in
  the chat view's title bar. (`Ctrl+Shift+Esc` was avoided on Windows — the OS
  reserves it for Task Manager.)
- **Persistent context-window indicator (Claude-Code parity).** A subtle line
  under the chat now shows how full the model's context window is —
  `⊟ context 12.3k / 200k (6%)` — refreshed after every turn. It reuses the
  CLI's authoritative window math (`cc context --json`, same as `/context`), so
  it never diverges, and turns red with an "over, compaction needed" note on
  overflow. Disable with `chainlesschain.chat.contextIndicator: false`.
- **Extended-thinking toggle — `/think`, `/ultrathink`, `/think-off` (Claude-Code
  parity).** Turn on Anthropic extended thinking for the conversation: `/think`
  enables it, `/ultrathink` uses the maximum budget, `/think-off` turns it back
  off. Per-conversation; like the approval mode it takes effect on the next
  message (the agent child respawns with `--think`/`--ultrathink`, resuming the
  same session). Non-Anthropic providers ignore it. In the `/` autocomplete and
  `/help`. **The reasoning now renders** as a dimmed, italic **collapsible**
  block (a `▾ thinking` disclosure) above the answer, streamed live; it
  auto-collapses once the action/answer arrives and clicks open again — so you
  can glance at the reasoning or tuck it away.
- **Pending-approval tab indicator (Claude-Code parity).** When an approval
  request lands in a chat tab you're not looking at — the agent is blocked
  waiting on you — that tab now shows a **blue** dot (distinct from the green
  "finished in the background" dot) plus a toast. Switching to the tab
  re-surfaces the approval card (background-tab events were otherwise gated out),
  so you can actually act on it.
- **`@file#L5-10` line-range references (Claude-Code parity).** Insert File
  Reference (`Ctrl/Cmd+Alt+K`) now appends the selected line range — e.g.
  `@src/app.ts#L5-10` (or `#L7` for one line) — when you have a selection, and
  the CLI expands **just those lines** into the prompt instead of the whole file
  (needs cc ≥ 0.162.71). Plain `@file` (no selection) still pulls the full file.

## [0.29.0] — 2026-06-15

- **`/retry` — regenerate the last prompt.** A `/retry` panel command (in the
  slash menu) re-sends your last message as a fresh turn, so you can get another
  answer without retyping it.
- **Copy button on code blocks (Claude-Code panel parity).** Every fenced code
  block in an assistant reply now shows a hover **Copy** button (top-right) that
  copies the block's text to the clipboard. Added at the DOM level after rendering,
  so the markdown renderer stays a pure escape-first whitelist (XSS-safe).
- **`/` slash-command autocomplete in the chat panel.** Typing `/` now opens a
  completion dropdown of the panel commands (`/new`, `/sessions`, `/plan`,
  `/approve`, `/reject`, `/stop`, `/cost`, `/context`, `/rewind`, `/help`) with a
  one-line description each — filtered as you type, ↑/↓ to move, Tab/Enter to fill,
  Esc to dismiss. Reuses the same dropdown as `@`-mentions; the slash commands were
  previously invisible until you ran `/help`.
- **`/rewind` — roll back to an agent checkpoint (Claude-Code parity).** The chat
  panel now snapshots the work tree before each file-mutating tool (auto-checkpoint,
  needs **cc ≥ 0.162.70**) and a new `/rewind` command lists this session's
  checkpoints in a native QuickPick — pick one and the work tree is restored
  (`cc checkpoint restore`, which auto-snapshots the current state first, so a
  rewind is itself undoable). Scoped to the panel's own session, so it only offers
  this conversation's checkpoints. Uses the git shadow-commit engine (zero
  working-tree pollution; a no-op outside a git repo).
  - CLI side (cc 0.162.70): the streaming runner (`--input/output-format
stream-json`, which the panel drives) now threads `autoCheckpoint` through —
    previously only the one-shot `-p` and REPL paths checkpointed, so panel
    sessions never had restore points.

## [0.28.0] — 2026-06-15

- **Background-tab completion signal** — now that each conversation tab owns its
  own `cc agent` process, a turn finishing in a tab you are **not** looking at is
  no longer silent. The tab grows a green **● dot** (and its title goes bold), and
  a dismissible toast — `ChainlessChain · "<title>" finished` — offers a **Show**
  action that switches to that tab and reveals the panel. The dot clears the moment
  you switch to the tab. The active tab never flags itself (you're already watching
  it), and the toast is best-effort (never blocks the agent loop).

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
- **Webview dashboard** (_Open Dashboard_): status cards (port / tool calls /
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
- Commands: _Show Bridge Status_, _Restart Bridge_; setting
  `chainlesschain.ide.enabled`.
