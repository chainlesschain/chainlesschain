# JetBrains glue — VS Code parity status

The IntelliJ-SDK glue that wires the pure layers
(`com.chainlesschain.ide.{ConversationManager,PreviewDetect,MultiDiff,Mentions,
SessionArgs,IntrospectArgs}`) into visible features. **Sections 1–6 are now
implemented and build-verified** (0.4.0).

> ✅ **CORRECTION (2026-06-16):** the earlier "can't build on Windows" assumption
> was wrong. `./gradlew.bat buildPlugin` builds fine on the Windows box with
> `JAVA_HOME` = Eclipse Adoptium **JDK 17** (the IntelliJ 2024.2 SDK downloads on
> first run, ~1 GB; rebuilds are cached). The pure layers smoke-test with
> `javac --release 8 -encoding UTF-8` (**must** pass `-encoding UTF-8` — raw javac
> defaults to GBK on Windows and chokes on the `—`/`…` in comments).

> ⚠️ **Still SDK-gated for VERIFICATION, not building.** Per the dead-panel lesson
> (0.9.0/0.10.0, [[feedback_full_test_pyramid_before_publish]]), every UI piece
> must be exercised in a `./gradlew runIde` sandbox before publish — compilation
> alone does not prove the panels render. That manual GUI pass is the remaining
> gate (a headless agent can build but cannot click through the sandbox).

> ✅ **Pure-core CI gate (2026-07-05):** `./gradlew smokeTest` runs
> PureLogicSmokeMain (300+ assertions, exit 1 on failure) and the
> `ide-extensions.yml` jetbrains job runs it on every push touching the plugin —
> the pure layers are no longer a manual-javac-only check. The runIde GUI gate
> above still applies to the SDK glue.

---

## ✅ Landed glue (build-verified, 0.4.0)

- [x] **§1 Conversation tabs** — `JBTabbedPane` of `ConversationView`s, one live
      child per tab, `+ New chat` / per-tab `×` / instant switch / per-tab resume
      ids in `PropertiesComponent` (migrates the legacy single key).
- [x] **§2 App Preview** — `PreviewService` spawns `npm run <devScript>`
      (`PreviewDetect.pickDevScript`), detects the URL (`detectServerUrl`), embeds
      `JBCefBrowser` (external-browser fallback) in a new preview tool window;
      Start/Stop actions; stop kills the process tree.
- [x] **§3 Inline diff "Request changes…"** — `openDiff` is Accept / Request
      changes… / Reject; returns `{outcome:"changes-requested", comments, reviewedText}`.
- [x] **§4 Batch multi-file diff** — `openMultiDiff` (EditorFacade + IntelliJ impl +
      `IdeTools` tool → `mcp__ide__openMultiDiff`): `SimpleDiffRequestChain` +
      Accept all / Choose files… (`MultiDiff.fileLabel` checkboxes) / Reject.
- [x] **§5 Selection actions + @file ref** — editor-popup Explain / Refactor
      (seed `@selection`); Insert File Reference (`Ctrl/Cmd+Alt+K`) → `@path#L<a>-<b>`
      via the new pure `Mentions.formatInsertReference`. Panel slash commands
      `/new /stop /cost /context /help`.
- [x] **§6 VS Code 0.30.0 parity** — approval-mode `/auto·/bypass·/normal` +
      extended-thinking `/think·/ultrathink·/think-off` (spawn-time restart),
      context-window indicator (`IntrospectArgs` + `AgentChatSession.runCapture`),
      new (`Ctrl/Cmd+Alt+N`) / reopen-closed (`Ctrl/Cmd+Shift+T`) actions.

## ✅ Polish (also landed)

- [x] **@-mention completion popup** — typing `@` pops a `JBPopup` chooser of
      `@selection`/`@diagnostics` + project content files (lazy, bounded to 3000,
      speed-search filtered); choosing splices via `Mentions.detectAtToken` +
      `applyMention`. (Workspace-symbol entries via PSI search remain a future add;
      file + IDE-mention completion is wired.)
- [x] **Interactive plan / approval cards** — approval (`Approve`/`Deny` →
      `{type:approval,id,approve}`) and plan (`Approve`/`Reject` →
      `{type:plan,action}`) cards above the input, same stdin protocol as VS Code;
      `/plan` `/approve` `/reject` slash commands too.

## Publish — ✅ DONE (0.4.0 published 2026-06-16)

- [x] `./gradlew runIde` GUI pass — exercised in the sandbox; **caught + fixed 3
      real bugs** compilation missed: silent reply-drop (TurnState CCE), blank
      stripe icon (raster-in-SVG → real PNG), cramped input (own full-width line).
      User-confirmed: chat replies, icon shows, input on its own line.
- [x] **Published**: tag `ide-jetbrains-v0.4.0` → CI `ide-extensions.yml` JetBrains
      job `publishPlugin` ✓ (run 27604136165). Uploaded to the Marketplace; in
      JetBrains' auto-validation queue (updates API lists it minutes–hours later;
      was 0.3.3).
- [x] Synced the 官网 ide page + README zh/en to the 0.4.x features (`bb67cea60`,
      www deployed HTTP 200).
- [x] **Latest 0.4.7 — Plugin Verifier CLEAN on 2024.2 → 2026.x** (user-confirmed:
      no internal / scheduled-for-removal / deprecated). See "Compatibility" below.
- [~] Screenshots — **intentionally skipped** (decided 2026-06-16). Capture +
  dashboard upload are human-only (GUI staging + authed account); the listing is
  complete without them. Capture guide kept in `SCREENSHOTS.md` if ever wanted.

## ✅ COMPLETE

The JetBrains plugin is feature-aligned with the VS Code extension, runIde-verified,
Plugin-Verifier-clean across 2024.2 → 2026.x, and published (0.4.7). Nothing pending.

## 🔧 Bug-sweep batch B1–B9 (post-0.4.44, unreleased) — code-complete, NOT yet runIde-verified (2026-07-06)

Nine fixes from the 2026-07-06 audit. Verified: `compileJava` clean +
`smokeTest` **330/0** (322 baseline + 8 new: `chooseBinary` ×4, MiniJson
depth-cap ×4) + `buildPlugin` zip contains the updated plugin.xml keymaps.

Pure-layer (smoke-covered, no GUI gate):

- [x] **B1** `AgentChatSession.stop()` kills the descendant tree (Windows
      `cmd.exe /c cc` left the real node agent orphaned mid-turn — same
      grandchild-orphan trap `PreviewService.stop()` fixed) + closes stdin first.
- [x] **B2** `runCaptureWith` drains stderr (a full unread stderr pipe blocked
      the child forever → `/rewind`//`sessions`//`context` ate their full timeout).
- [x] **B7** `resolveBinary()` no longer caches the all-candidates-failed
      fallback — installing the CLI mid-session now recovers without an IDE restart
      (`chooseBinary` extracted as the pure testable seam).
- [x] **B9** `MiniJson` nesting cap 512 → hostile/corrupt payloads throw a
      catchable `IllegalArgumentException` instead of `StackOverflowError` (an
      Error would kill the chat pump / MCP handler thread silently).

SDK glue (needs the usual runIde GUI pass before the next publish):

- [ ] **B3** first-message send chain (`ensureSession` + `send`) moved off the
      EDT onto a serial per-tab worker (`sendInFlight` guards double-Enter; composer
      clears only on confirmed send — same failure semantics as before).
      GUI check: cold-start first message doesn't freeze the UI; echo renders; a
      missing CLI still shows the "failed to start cc" hint.
- [ ] **B4** `@`-mention PSI/file scans now warm via
      `ReadAction.nonBlocking(...).inSmartMode()` in the background; dumb-mode/failed
      scans are NOT cached (previously indexing pinned an empty symbol list for the
      tab's life). GUI check: first `@` during indexing → files/symbols appear on a
      later `@` once indexed.
- [ ] **B5** `getDiagnostics` path filter normalizes separators + ignores case
      on Windows (raw equals never matched `C:\…` against the VFS forward-slash
      path → always-empty diagnostics for a targeted file).
- [ ] **B6** session-id persistence hops to the EDT (was mutating Swing-owned
      tab state from the stdout pump thread; a CME there silently dropped resume ids).
- [ ] **B8** default keymaps de-conflicted (all three collided with IDEA
      built-ins): new chat `Ctrl+Alt+N`→`Ctrl+Alt+Shift+D`, reopen closed
      `Ctrl+Shift+T`→`Ctrl+Alt+Shift+R`, insert file ref `Ctrl+Alt+K`→`Ctrl+Alt+Shift+K`
      (plugin.xml `<keyboard-shortcut>` only; Mac mirrors with ⌘).
      GUI check: no "shortcut conflict" balloon on first install; chords fire.

## ✅ ConversationView split (post-0.4.44, unreleased) — GUI-verified 2026-07-05

ConversationView 1405 → ~1030 lines by extracting three cohesive glue classes
(zero behavior change; published 0.4.44 zip was unaffected):
`ChatTranscript` (JTextPane + styles + markdown snap + TranscriptCap),
`ChatComposerImages` (paste/drag-drop/📷 indicator; policy stays in pure
ImageAttachments), `ChatMentionPopups` (`/` + `@` popups + lazy PSI/file
caches). ConversationView keeps one-line append\*() delegates so call sites
didn't churn. Verified: compileJava clean (zero warnings) + smokeTest 322/0 +
buildPlugin, and a **user GUI pass on a real IDEA 2025.3 install (build
IU-253.28294.334, plugin built from `e3ef95702e`)** covering the three moved
areas (transcript styling, image paste+drop, `/`+`@` popups) plus the full
0.4.42–0.4.44 feature sweep — all green, and no 2025.3 compatibility errors
surfaced (a build newer than the Plugin Verifier's local 2025.2 ceiling).
**The next publish needs no extra re-verification for the split.**

## ✅ Drag-drop images + project-memory actions (0.4.44) — runIde-verified + published 2026-07-05

- [x] **Pure layer** `ImageAttachments` (extension filter + 4-image cap shared
      with paste), `ProjectMemory` (init/memory-files args + mode rows).
      **PureLogicSmokeMain 322 passed** (`javac --release 17`).
- [x] **Glue wiring** — `installImageDropTarget(input/transcript)` via
      `java.awt.dnd.DropTarget` (NOT a TransferHandler swap — default paste/text
      behaviors survive; plain-text drops re-inserted at the caret);
      `GenerateProjectMemoryAction` (mode popup → `Task.Backgroundable`
      runCapture, 600s budget for `--ai`) + `ShowMemoryFilesAction`; both in
      the Tools menu. `gradlew compileJava` clean.
- [x] **runIde GUI pass (user-verified 2026-07-05)** — drop a png onto the composer
      (📷 counter increments, 5th file ignored), drop a .txt (ignored), drop
      selected text (lands at caret), send with image reaches the vision model;
      Tools → Generate Project Memory offline mode writes cc.md and shows the
      census tail; Show Project Memory Files lists the chain.

## ✅ /rewind + /sessions + hunk-level accept (0.4.43) — runIde-verified + published in 0.4.44 (2026-07-05)

VS Code panel parity trio: checkpoint restore, session picker, and partial diff
accept.

- [x] **Pure layer** `RewindCommands` (list/restore args + tolerant parsers +
      `restoreOk`), `SessionList` (list args + `_store` mapping parser),
      `DiffHunks` (LCS hunk computation + selective apply; invariants
      all==modified / none==original; 4M-cell guard degrades to one hunk).
      **PureLogicSmokeMain 304 passed** (`javac --release 17`).
- [x] **Glue wiring** — ConversationView `/rewind` + `/sessions` (off-EDT
      `runCapture`, `JBPopupFactory.createPopupChooserBuilder` chooser — NOT the
      deprecated `Messages.showChooseDialog`); `IntellijEditorFacade.openDiff`
      4-option dialog (Accept / Pick hunks… / Request changes… / Reject) with a
      pre-checked hunk checkbox DialogWrapper; SlashCommands catalog + /help
      updated. `gradlew compileJava` clean, zero deprecation warnings.
- [x] **runIde GUI pass (user-verified 2026-07-05)** — `/rewind` popup lists
      checkpoints and restore reports file count; `/sessions` popup resumes the
      picked id on the next message; openDiff "Pick hunks…" applies only the
      checked blocks (uncheck one, verify the original lines survive); Esc at
      each stage writes nothing.

## ✅ Status-bar widget (0.4.42) — runIde-verified + published in 0.4.44 (2026-07-05)

Always-visible status-bar widget: `CC :<port>` / `CC off` bridge state, plus the
active conversation's approval mode (`✓auto` / `⚠bypass`; normal stays quiet) so
an elevated mode can't go unnoticed (VS Code ui/status-bar.js parity — the
`createStatusBar` + `createModeStatusBar` pair collapsed into one widget).

- [x] **Pure layer** `StatusBarText` (label / modeSuffix / tooltip / modeLine).
      **PureLogicSmokeMain 263 passed** (`javac --release 17`).
- [x] **Glue wiring** — `BridgeStatusBarWidgetFactory` (`statusBarWidgetFactory`
      EP, pull-model `TextPresentation`, click = status dialog); refresh hooks in
      `IdeBridgeService.start/stop`, `ConversationView` `/auto·/bypass·/normal`,
      and `ChatToolWindowFactory` tab create/switch/close
      (`activeModeFor(project)` reads the active tab's mode). `gradlew
compileJava` clean against 2024.2.
- [x] **runIde GUI pass (user-verified 2026-07-05)** — confirm the widget renders in
      the status bar, shows the port after startup, flips to `⚠bypass` on
      `/bypass`, reverts on `/normal`, follows tab switches, and the click
      dialog opens. Per the dead-panel lesson this manual pass is required
      before publishing 0.4.42.

## ✅ `@folder/` completion — shipped in 0.4.41

Offer ancestor directories (as `@folder/`) in the `@`-mention popup, ahead of
files — typing `@src` surfaces the folder too; the CLI expands a folder ref into
a bounded recursive tree (Claude-Code `@folder/` parity).

- [x] **Pure layer** `Mentions.deriveFolders` (+ `filterFiles` ranks a
      trailing-slash item by its last segment). Java port of at-mention.js
      `deriveFolders`. **PureLogicSmokeMain 248 passed** (`javac --release 11`).
- [x] **Glue wiring** — `ConversationView.openMentionPopup` adds
      `Mentions.deriveFolders(projectRelativeFiles(), 2000)` items before the
      files. Compiles against the verified pure API.
- [ ] **runIde GUI pass (GATE before publish)** — confirm folders appear in the
      `@` popup, choosing one inserts `@path/`. Per the dead-panel lesson this
      manual pass is required before bumping the version.

VS Code parity already shipped (at-mention.js `deriveFolders` + chat-view.js
`_listWorkspaceFiles`; 23 vitest pass incl. the parse gate).

## ✅ IDEA built-in MCP auto-connect (server `idea`) — shipped in 0.4.40

Auto-connect IntelliJ IDEA's OWN built-in MCP server (IDEA **2025.2+**, Settings |
Tools | MCP Server) so the spawned `cc agent` gets the IDE's indexed ops (find
usages / file-by-path / search / run configs / VCS) as `mcp__idea__*` tools —
fewer tokens, faster (rides the index). This is **separate** from our own `ide`
bridge (that exposes selection/diagnostics/diff; this exposes IntelliJ's native
tools). Reserved cc server name `idea`.

- [x] **cc side (shipped to main, `cb249bb2ac`)** — `chainlesschain` reads
      `CHAINLESSCHAIN_JETBRAINS_MCP_URL` (+ `_TOKEN`/`_TRANSPORT`), connects it as
      `idea`. No URL = no connect (unsupported / disabled). `cc ide jetbrains`
      diagnoses. 20 tests; e2e-verified vs a real Streamable-HTTP MCP server.
- [x] **Pure layer** `com.chainlesschain.ide.JetbrainsMcpProbe` — `candidateUrls`
      (native 64342… before built-in 63342…, `/stream` before `/sse`/`/mcp`),
      `looksLikeMcpResponse`, `selectLiveUrl`. **PureLogicSmokeMain 242 passed.**
- [x] **Locator** `com.chainlesschain.ide.JetbrainsMcpLocator` — pure-JDK
      (`java.net.http` + daemon thread, cached, TTL 60s, off-EDT). Probes the
      candidates, caches the first live `/stream` endpoint. **compileJava OK.**
- [x] **Glue wiring** — `ConversationView` injects `CHAINLESSCHAIN_JETBRAINS_MCP_URL`
      from `JetbrainsMcpLocator.cachedUrl()` (mirrors the `CHAINLESSCHAIN_IDE_PORT`
      injection); `IdeBridgeService.start()` warms the locator off-EDT.
      **`./gradlew compileJava` BUILD SUCCESSFUL against IntelliJ 2024.2 SDK.**
- [ ] **runIde + live verify (GATE before publish)** — needs a running IDEA
      **2025.2+** with MCP enabled (port 64342/stream observed). Confirm: locator
      finds it → env injected → cc connects `idea` → `mcp__idea__*` usable. Per the
      dead-panel lesson this manual pass is required before publishing.
- [ ] **Publish** — bump version + CHANGELOG + tag `ide-jetbrains-v*`. **HELD**
      (user: don't publish until verified on a real 2025.2 IDE; cc side also
      unpublished — ship cc npm + plugin together). See memory
      `cli_jetbrains_idea_mcp_bridge`.
- Note: discovery is a port **probe** (IDEA writes no lockfile, doesn't publish
  its port). If a future IntelliJ API exposes the MCP port directly, prefer it.

## Compatibility (verifier history)

0.4.4 getTerminalOutput broke on 2024.3+ (terminal API) → reverted 0.4.5 → 0.4.6
cleared 2025.2 deprecated → 0.4.7 cleared 2026.x scheduled-for-removal + deprecated
(SimpleListCellRenderer→DefaultListCellRenderer, removed LocalTerminalCustomizer).
`./gradlew verifyPlugin` (2025.2) = Compatible/0 flags; 2026.x confirmed clean on the
Marketplace verifier post-publish.

## ⚠️ Reverted

- [x] ~~**getTerminalOutput** tool (0.4.4)~~ — **REVERTED in 0.4.5.** The terminal API
      (`TerminalToolWindowManager.getWidgets()` → `JBTerminalWidget.getTerminalTextBuffer()`
      / jediterm) compiled fine against 2024.2 and worked in that sandbox, but is **not
      stable across IDE builds** (2024.3+ reworked terminal) → errored on other versions
      (user-reported "多个版本idea出现了问题"). A robust version would need reflection +
      per-version guards. `executeCode` (Jupyter) also stays out — edition-gated.
- [x] @-mention **class + method/function symbols** via PSI search
      (`PsiShortNamesCache` getAllClassNames/getAllMethodNames, bounded 800 each,
      resolved to file → `Mentions.formatSymbolItems`) — classes 0.4.2, methods
      0.4.3, both runIde-verified + published.

---

_Glue landed 2026-06-16 (§1–§6). Pure layers: `1ef021c52` + `84a562149` +
`formatInsertReference`. VS Code reference: extension 0.22–0.30 (`packages/
vscode-extension/src/`)._

## 🔧 Token-parity + polish batch (post-B1–B9, unreleased) — code-complete, NOT yet runIde-verified (2026-07-06)

Live token tally / iteration warnings (VS Code 0.37.2 parity) + 8 audit polish
items. Verified: `compileJava` clean (no new deprecations) + `smokeTest`
**344/0** (330 baseline + 14 new `TokenTally` assertions: formatTokens ×5,
accumulate/statusLine/readyLine ×5, token_usage / iteration_warning event
mapping ×4) + `buildPlugin` OK.

Pure-layer (smoke-covered, no GUI gate):

- [x] `ChatEvents` maps `token_usage` → `{kind:usage}` and `iteration_warning`
      → `⚠ info`; new pure `TokenTally` (accumulate + `statusLine()`) and
      `formatTokens`/`readyLine` (VS Code `tokfmt` twins, `12k`/`2.3k` semantics).
- [x] `LockfileWriter.write` publishes atomically (temp + `ATOMIC_MOVE`,
      fallback to plain write); `.tmp-*` siblings never match the prune filter.
- [x] `McpServer`: `stop()` shuts the HTTP executor down; Bearer comparison is
      `MessageDigest.isEqual` (constant-time).

Glue-layer (needs the next pre-release runIde pass):

- [ ] **Token tally on the status line** — send a multi-tool-call turn; expect
      `thinking… · X→Y tokens (Z cached)` climbing per LLM call, then
      `ready · in→out tokens`, then the `⊟ context` line replacing it.
- [ ] **Iteration warning** — hard to trigger live; accept smoke coverage, but
      eyeball that ordinary turns show NO stray `⚠` lines.
- [ ] **Stop escalation** — click Stop once (interrupt note as before), click
      again on a live child → `⏹ force-stopped` + next message respawns.
- [ ] **Image temp cleanup** — paste a screenshot, send; after the turn the
      `cc-paste-*.png` under `%TEMP%` should be gone (and a paste discarded via
      tab reset should delete immediately). Drag-dropped REAL files must survive.
- [ ] **JBColor** — flip Darcula ↔ light: code amber / thinking gray / WARN
      amber / context red-gray all stay readable, no repaint artifacts.
- [ ] **Version-probe cache** — open 3 tabs: only the first probes
      `cc --version` (others reuse); ⚙ LLM → 检查 cc 更新 still re-probes fresh.

## 🔒 Security + correctness audit batch (P0/P1, unreleased) — code-complete, NOT yet runIde-verified (2026-07-06)

Fan-out audit of the plugin surfaced 5 P0/P1 items; fixed + `compileJava` clean +
`smokeTest` **345/0** (adds a `CliLauncher.augmentPath` hardening assertion).

Pure/structural (smoke- or compile-covered):

- [x] `CliLauncher.augmentPath` sets `NoDefaultCurrentDirectoryInExePath=1` on
      Windows (cmd.exe won't run a repo-local `cc.bat` before PATH). Single
      chokepoint — both `AgentChatSession` ProcessBuilder sites inherit it.
- [x] version-probe cache gated on `AgentChatSession.looksLikeCcVersion` (strict
      bare-semver) instead of `parseVersion`, so a gcc `cc` banner isn't cached.
- [x] `Conversation.session/sessionId/turnState/mode/thinking` → `volatile`;
      `restartForModeChange` teardown serialized on `sendExecutor`.
- [x] sent-image temps tracked per-message FIFO (`Deque<List<String>>`); each
      turn deletes only its own batch; dispose drains all + `images.clearAll()`.

Glue-layer (needs the next pre-release runIde pass):

- [ ] **Stop doesn't freeze the IDE** — send a big prompt to a hung/looping
      agent, click Stop; the UI must stay responsive and a second click must
      force-kill (`⏹ force-stopped`). No EDT freeze.
- [ ] **Mode change mid-spawn** — press Enter then immediately `/auto`; the next
      message must actually run in accept-edits mode (not silently stay normal).
- [ ] **Queued-message image** — send msg1, then send msg2 with a pasted image
      while turn 1 streams; msg2's image must attach (its `cc-paste-*.png` must
      survive turn 1's end and be gone only after turn 2).
- [ ] **cc.bat guard** — with a dummy `cc.bat` at a project root, opening the
      panel must NOT execute it (onboarding still finds the real cc on PATH).

## 🩹 P2 correctness batch (unreleased) — code-complete, NOT yet runIde-verified (2026-07-06)

Five lower-severity items from the same audit. `compileJava` clean + `smokeTest`
**348/0** (345 + 3 new MiniJson non-finite assertions).

Pure/structural (smoke- or compile-covered):

- [x] `MiniJson.stringify` emits `null` for `NaN`/`Infinity` (valid JSON).
- [x] `runCaptureWith` uses a thread-safe `StringBuffer` (no torn read on a
      chatty child that outlives the join timeout).
- [x] `LockfileWriter.pruneStale` also sweeps orphaned `*.json.tmp-<pid>` temps.

Glue-layer (needs the next pre-release runIde pass):

- [ ] **No stray "agent exited" banner** — `/auto`, `/sessions` resume, LLM
      reconfigure, force-stop each show ONLY their own status line (no
      `── agent exited ──` after). A REAL crash still shows the banner.
- [ ] **MCP 413** — POST a >4MB body to the bridge; expect an HTTP 413 JSON
      error, not a dropped connection.

## ⚡ Performance batch (unreleased) — code-complete, NOT yet runIde-verified (2026-07-06)

Three optimizations from the audit. `compileJava` clean + `smokeTest` **348/0**
(all glue-layer behavior — no new pure assertions).

Glue-layer (needs the next pre-release runIde pass):

- [ ] **Scroll-back while streaming** — during a long streamed reply, scroll UP;
      new deltas must NOT yank the viewport back to the bottom. When parked at
      the bottom, it still auto-follows.
- [ ] **Config read once** — `readConfiguredLlmBlock` now reads/parses
      `config.json` once for all 4 fields; first-message spawn should feel
      quicker. Sanity: the panel still uses the configured provider/model.
- [ ] **@-mention cache TTL** — create a new file, wait ~30s, type `@`; the new
      file should now appear (was unmentionable until the tab was recreated).
