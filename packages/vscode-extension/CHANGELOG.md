# Changelog — ChainlessChain IDE Bridge (VS Code)

All notable changes to this extension are documented here.

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
  an `'error'` event with no listener as an *uncaught* exception. A persistent
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
  editor left the agent waiting until you *also* dismissed the notification. The
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
  tool failure; instead you get a quiet note: *"couldn't ask interactively in the
  panel — proceeding autonomously"*. Real tool errors still show as failures.

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
  `401`) until you opened a *new* conversation. Now, once the Configure-LLM
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
