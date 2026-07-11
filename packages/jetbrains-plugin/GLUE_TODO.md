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

## 🔧 Managed CLI runtime (gap #2, unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Pure core (`ManagedCli`/`ManagedCliRuntime`) is fixture-locked against the VS
Code twin (JUnit `ManagedCliTest` + smoke `managedCli()` with a
fixture-drift guard) — no GUI gate. The SDK glue needs the usual
`./gradlew runIde` pass before the next publish:

- [ ] **Install flow** — Tools → "ChainlessChain: Install Managed CLI…" on a
      machine with node but no global cc: ONE confirm dialog shows version +
      size + target dir (`~/.chainlesschain/ide/managed-cli-jetbrains`);
      background task reports resolve/download/verify/extract/install; success
      dialog names the shim command; a new chat tab then spawns via the
      managed copy (`cc-managed.cmd` on Windows).
- [ ] **Settings toggle** — Settings → Tools → ChainlessChain IDE: uncheck
      "use a plugin-managed cc CLI" → with no global cc the panel goes back to
      the missing-CLI hint (managed no longer consulted); recheck → recovers
      without an IDE restart.
- [ ] **Rollback** — after installing two versions, Tools → "Roll Back
      Managed CLI" confirms `current → previous`, flips the shim, and a second
      rollback is refused ("no previous version"). With no managed install the
      action says there is nothing to roll back.
- [ ] **No-node diagnostic** — with node absent from PATH (or too old), the
      install action refuses BEFORE downloading with the exact
      no-node/node-too-old message (Node >= 22.12.0).
- [ ] **Explicit-path supremacy (iron rule)** — set an explicit (even broken)
      cc path in Settings; verify every spawn keeps using it and the managed
      copy is never substituted; clear the path → managed kicks in only after
      the cc/chainlesschain/clc/clchain probes fail.

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
Marketplace verifier post-publish. 0.4.53 Marketplace verifier flagged 1
scheduled-for-removal usage (`TerminalToolWindowManager.createLocalShellWidget`
in WorktreeTasksAction, Approved/Compatible on all verified IDEs) → migrated to
`createShellWidget(dir, tab, focus, defer)` + `TerminalWidget.sendCommandToExecute`
post-publish (`a234f53e9a`, compileJava clean on 2024.2 baseline). TerminalTextReader
audited same day: already on the current API
(`getTerminalWidgets()`/`toShellJediTermWidgetOrThrow`), no change needed.
0.4.54 verifier outcome (2026-07-10): scheduled-for-removal flag CLEARED, but
`createShellWidget` itself is now plain-**deprecated** on 2026.x — Marketplace
shows "Approved / Compatible, 1 usage of deprecated API" (2026.2 rc + 2026.1.4;
IDE-run verification Success, no issues). **Deliberately accepted, do not chase**:
the blessed replacement `com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager`
(`createTabBuilder()…createTab()`) is `@ApiStatus.Experimental`, only exists since
~2025.3 (intellij-community first commit 2025-10-04, IJPL-211122), and exposes no
`sendCommandToExecute` on the shown surface — migrating would mean reflection
against an Experimental API on our 242.0+ baseline, the exact failure class that
broke 0.4.4. Call site is Throwable-guarded with a copy-the-command dialog
fallback (`WorktreeTasksAction.runInTerminal`), so removal in a future IDE
degrades gracefully. Revisit when TabsManager loses `@ApiStatus.Experimental`
AND the verifier escalates createShellWidget to scheduled-for-removal.

VS Code twin audited the same day (2026-07-10) for the same class of problem —
**clean, no change needed**: zero hits across `src/**` (incl. `chat/`, `ui/`,
`vendor/` agent-sdk) for deprecated VS Code APIs (`rootPath`,
`extensionPath`/`storagePath`/`logPath`, `scm.inputBox`, `TextEditor.show/hide`,
legacy `new vscode.Task(...)`), proposed APIs (no `enabledApiProposals`, no
`onDidWriteTerminalData`), and Node runtime deprecations (`new Buffer()`,
`url.parse`, `crypto.createCipher`, `fs.rmdir`, `process.binding`). Only note:
`vscode-facade.js` subscribes to shell-integration events (stable since 1.93 >
engines ^1.85.0) behind an existence guard — deliberate graceful degradation,
keep the guard. Risk class is inherently lower there: VS Code never removes
stable APIs, so only proposed APIs / above-engines usage can break.

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

## 🌐 Localized action labels (unreleased) — code-complete, NOT yet runIde-verified (2026-07-08)

Closes the most visible "中英文混乱" gap: 17 action titles/descriptions were
bilingual "English (中文)". Now resolved from `messages/CcBundle.properties`
(English) + `CcBundle_zh.properties` via `action.<id>.text`/`.description`, with
`<resource-bundle>messages.CcBundle</resource-bundle>` in plugin.xml (actions
carry no inline `text=`). Verified: `smokeTest` **545/0** (+104 — `bundleParity`
checks every action id has en+zh keys, en/zh key sets match, and no zh value was
left equal to the English base); `buildPlugin` + `buildSearchableOptions` clean
(the headless plugin load resolves the bundle); packaged jar has both
`.properties` under `messages/` and the Chinese UTF-8 survived.

Glue-layer (needs the next pre-release runIde pass):

- [ ] **Menu labels localize by IDE language** — with an English IDE, Tools menu
      shows "ChainlessChain IDE: Restart Bridge" etc. (no "(中文)"); install the
      Chinese Language Pack (or set the IDE language to 中文) and the same items
      read "ChainlessChain IDE：重启桥接" etc. Editor right-click shows
      Explain/Refactor Selection localized too. No blank/missing menu items in
      either language (the `bundleParity` gate guards the keys, but confirm the
      platform actually renders them).

## 🔗 Deep-link handler (unreleased) — code-complete, NOT yet runIde-verified (2026-07-08)

Closes the top verified parity gap (JB had no `jetbrains://` handler vs VS
Code's `registerUriHandler`). Pure `DeepLink` parser smoke-tested — `smokeTest`
**441/0** (+11); `compileJava` clean against the SDK (`perform(target, params,
fragment)` override); `buildPlugin` zip verified (`jbProtocolCommand` EP in the
packaged plugin.xml, `DeepLink` + `CcProtocolCommand` classes in the jar). The
platform declares the EP `dynamic="true"`, so no restart needed at install.

Glue-layer (needs the next pre-release runIde pass):

- [ ] **Deep link opens the chat** — with a project open, invoke
      `jetbrains://idea/chainlesschain/open?prompt=hello%20world` (paste into a
      browser, or `cmd /c start "" "jetbrains://…"` on Windows): IDE focuses,
      the ChainlessChain tool window activates, and the active conversation's
      input is seeded with "hello world" (not sent). Without `?prompt` it just
      focuses the tool window. An unsupported action
      (`…/chainlesschain/delete`) is ignored (the platform shows its own
      "unsupported" notice), and with no open project the platform surfaces the
      "no open project to focus" message rather than throwing.

## ✨ Quick-win parity batch (unreleased) — code-complete, NOT yet runIde-verified (2026-07-08)

Three cheap parity gaps closed (backlog head after the 0.4.46 audit). Pure
cores smoke-tested — `smokeTest` **372/0** (+24: WhatsNew section + /retry
catalog); `buildPlugin` zip verified (both actions registered in the packaged
plugin.xml, all 3 new classes in the jar).

Glue-layer (needs the next pre-release runIde pass):

- [ ] **What's New action** — Tools → "ChainlessChain: What's New (cc 更新说明)"
      with cc ≥ 0.162.151 installed → scrollable monospace dialog listing the
      last 5 CLI releases, the installed one marked "← installed"; with an old
      cc → info dialog naming the min version + upgrade command.
- [ ] **`/retry`** — send a prompt, then type `/retry`: the same prompt is
      re-sent as a fresh turn; `/retry` before any send → "nothing to retry"
      hint; `/` autocomplete lists it between /review and /rewind.
- [ ] **Restart Bridge action** — Tools → "ChainlessChain IDE: Restart Bridge
      (重启桥接)" → info dialog with the NEW port; status-bar widget refreshes;
      `~/.chainlesschain/ide/<port>.json` lockfile rewritten (old port's file
      gone). IDE stays responsive during the restart (off-EDT).
- [ ] **Diagnose Bridge action** — Tools → "ChainlessChain IDE: Diagnose
      Bridge (诊断桥接)" → scrollable monospace dialog with 4 parts: this
      project's port, then `cc ide status` / `doctor` / `jetbrains` verbatim;
      with cc missing → three "(no output …)" placeholders, no hang (15s
      timeouts, all off-EDT).
- [ ] **Team Monitor action** — Tools → "ChainlessChain: Team Monitor
      (团队任务监控)" → file chooser (remembers last path) → dialog rendering a
      `cc team run --state <file>` snapshot: header "N% done · x/y tasks",
      status-ordered task list with holder/⇠deps/×attempts, "(stale)" on an
      expired lease; Refresh button re-reads the file. Bad/empty file → clean
      message, no throw.
- [ ] **`/rewind` diff preview + confirm** — `/rewind` → pick a checkpoint →
      modal shows its diff (`cc checkpoint show --diff`) with Restore / Cancel;
      Cancel writes nothing ("cancelled — nothing restored"); Restore proceeds
      and reports the file count. A checkpoint with no textual diff (copy
      engine) shows "(no textual diff available)" but still gates on confirm.
- [ ] **Show Activity action** — with the bridge running, have the agent use
      an IDE tool (open the chat, ask something that reads the selection /
      diagnostics), then Tools → "ChainlessChain IDE: Show Activity" → dialog
      lists the calls newest-first with ✓/✗ + totals; Refresh picks up new
      ones. Bridge stopped → "bridge stopped" + "no tool calls yet".
- [ ] **Dashboard tool window (DashboardToolWindowFactory)** — Tools → "Open
      Dashboard" (or the ChainlessChain Dashboard stripe, right) opens a JCEF
      webview: status dot Running/Stopped, cards (port / tool calls /
      connections / errors), workspace line, and a live tool-call stream. Have
      the agent use an IDE tool → new rows appear within ~1s WITHOUT full-page
      flicker (re-renders only on change). Bridge stopped → "Stopped" + em-dash
      port + "No tool calls yet". Dark theme stays readable. On a runtime without
      JCEF → monospace text fallback (same content as Show Activity).
- [ ] **Settings page (CcConfigurable / CcSettings)** — Settings → Tools →
      "ChainlessChain IDE" shows a cc-CLI-path field + a context-indicator
      checkbox. Set a bogus path → chat "needs cc" (resolveBinary honors it, no
      probing); clear it → auto-detect returns. Uncheck the indicator → the chat
      panel's "⊟ context …" line disappears; re-check → it comes back next turn.
      Values persist across an IDE restart (chainlesschain-ide.xml). zh IDE shows
      the localized labels.
- [ ] **Inline completion / ghost-text (CcInlineCompletionProvider +
      TriggerCompletionAction)** — in an editor, type a partial line and press
      **Alt+\\** → a gray ghost suggestion appears at the caret; Tab accepts it,
      Esc dismisses. Confirm it fires ONLY on the shortcut, never on ordinary
      typing (no per-keystroke requests). With `cc` uninstalled / LLM
      unconfigured → no suggestion and no error popup (fails quiet). Verify the
      request carries the caret's prefix/suffix + language (a mid-file caret
      completes sensibly, not just append-at-EOF). The action is rebindable in
      Settings → Keymap ("ChainlessChain: Trigger Inline Completion"); the pure
      `CcCompletion` request/parse layer is already JUnit-covered — the runIde
      gate is the ghost-text rendering + Tab-accept + manual-only trigger.

## 🗂 Background Agents panel (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

Tools → "ChainlessChain: Background Agents" (`BackgroundAgentsAction`): session
picker + detail/log text area + Refresh / Send prompt… / Stop turn / Stop
session / Rename… / Resume…. Pure cores smoke-tested (`BackgroundAgents` list
/ stale correction / tail; `BackgroundSessionPipeClient` one-shot transport —
**live-verified against a REAL worker on Windows**: hello auth → prompt →
`accepted` → the worker actually ran turn 2 with the prompt). runIde gate:
dialog layout, combo refresh keeping selection, input dialogs, EDT-off
pipe/CLI actions appending results, zh/en bundle labels.

## 🗂 Plan Review + session index round (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **Plan Review editor tab (ConversationView + PlanReview)** — start plan
      mode, receive a `plan_update` → a Markdown editor tab opens with the
      plan; edit it, next plan_update keeps your edits; plan card buttons:
      Request changes / Regenerate send the edited review text back as a
      prompt; Approve / Reject send `{type:"plan",action,review}` with a
      snapshot (verify via `cc session show` transcript).
- [ ] **/sessions two-step picker (runSessions + showSessionActions)** —
      `/sessions` popup rows show `id · store · status · updatedAt · title ·
    workspace` and speed-search matches workspace; choosing a row opens
      Resume / Rename… / Delete…. Resume = old behavior (note + next message
      resumes). Rename… input dialog → picker shows the new title on reopen
      (also for a CLI-only session). Delete… Yes/No confirm → `cc session
    list` no longer shows it, `~/.chainlesschain/ide/session-index.json`
      entry gone, and a tab that pointed at the id loses its resume id (next
      message starts fresh, no --resume error).
- [ ] **getActiveFile bridge tool (IdeTools + IntellijEditorFacade)** — with
      a file open and cursor placed, have the agent call `getActiveFile` →
      path/language/dirty/cursor line+column match the editor state; no open
      editor → empty/absent fields, no exception.

## 🗂 Remote handoff round (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **/handoff (ConversationView.runHandoff)** — in a tab with history,
      `/handoff` → input dialog (default "Continue the current task.") → the
      live child stops, `cc daemon status` (or Tools → Background Agents)
      shows a new bg agent on the SAME session id; the transcript note names
      the bg id; web-panel Background Agents can send it a follow-up prompt.
      A fresh tab (no session yet) → "nothing to hand off yet". Cancel the
      dialog → nothing spawns.
- [ ] **Remote Control action (RemoteControlAction)** — Tools → Remote
      Control → Start host → pairing dialog appears with the URI (Copy URI &
      Close puts it on the clipboard); re-invoking shows Copy/Status/Stop;
      Status lists the host as running (port/pid/session); Stop this host →
      `cc remote-control status` shows nothing (state file removed); killing
      the IDE hard leaves a stale state file that the next Status (--prune)
      cleans. Pair the web panel with the URI → it can observe/prompt the
      machine's sessions. Host crash (kill the node child) → warning dialog
      offers restart guidance.

## 🗂 getTerminalOutput bridge tool (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **getTerminalOutput (IntellijEditorFacade + TerminalTextReader)** —
      open the integrated terminal, run a failing command (e.g. `npm run
    nope`), then have the agent call `getTerminalOutput` → the reply lists
      the terminal tab (name + buffer tail containing the command and its
      error). Multiple tabs → `limit` caps entries. No terminal open →
      `{terminals: []}`. Classic terminal engine gives text; the reworked
      terminal (if the IDE defaults to it) yields the tab name with empty
      output — check which engine 2024.2 uses and note it here. Disable the
      Terminal plugin → tool still answers with an empty list (no
      NoClassDefFoundError in idea.log).

## 🗂 getPreviewState bridge tool (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **getPreviewState (PreviewService.stateMap + IntellijEditorFacade)** —
      Tools → Start Preview on a project with a dev script; after the URL is
      detected, have the agent call `getPreviewState` → running=true, the
      URL, script name, and the server banner in `output`. Introduce a build
      error → the error text appears in `output` on the next call. Stop
      Preview → running=false with the last exit code; before any start →
      running=false, empty output. Restart resets the tail.

## 🗂 Token Usage report (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **ShowUsageAction** — after a few panel conversations, Tools →
      "ChainlessChain: Show Token Usage" → dialog shows all-time totals
      matching `cc session usage`, non-zero Last-24h window, the provider/
      model rows, and top sessions with the panel tabs' titles. With cc
      missing → info dialog (no exception). zh IDE shows the localized
      action label.

## 🗂 Completion cancellation (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **runInterruptible cancel (CcInlineCompletionProvider)** — trigger
      Alt+\ with a SLOW model configured, then immediately type another
      character (platform cancels the session) → the `cc complete` child
      process disappears from the process list within ~1s (was: lingered up
      to 12s). Ghost text still renders normally when you wait; Esc
      dismisses; Tab accepts.

## 🗂 Plugin & MCP manager (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **PluginManagerAction** — Tools → "Manage Plugins & MCP" → three tabs.
      Plugins: rows show ✔/✖ + version + [scope]; select one → Trust /
      Untrust round-trips (re-list), Uninstall asks Yes/No then the row
      disappears and `cc plugin installed` agrees; Add… with a local plugin
      dir installs it (and with a registry URL fetches). MCP: rows show
      transport/endpoint/[blocked: reason]; Test connect writes the result
      into the status line; Remove asks then drops the row. Skills: filter
      box narrows live; >200 matches shows the "narrow the filter" tail row.
      No selection + action button → "Select a row first." cc missing → all
      tabs show "(could not read CLI output)". zh IDE shows localized label.

## 🗂 Worktree Tasks (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **WorktreeTasksAction** — Tools → "Worktree Tasks" in a git project.
      New isolated task… with a real task → an integrated terminal tab opens
      running `cc agent --worktree -p …` (Terminal plugin present); Refresh
      lists the new cc-agent-\* row with +ins −del / ↑commits / merge risk.
      A conflicting branch shows "merge: conflict (file +N)". Merge on a
      clean row fast-succeeds and the status names the base branch; Merge on
      a conflicted row reports FAILED-and-aborted and `git status` in the
      main checkout stays clean. Discard… asks Yes/No, then the worktree dir
      and branch are gone. Non-git project → "(not a git repository…)".
      Terminal plugin disabled → New task falls back to the command dialog.
      Note: the terminal path was migrated post-0.4.53 from the
      scheduled-for-removal `createLocalShellWidget` to `createShellWidget` +
      `sendCommandToExecute` (`a234f53e9a`) — the runIde pass must exercise the
      NEW open-terminal-and-run path, not just the fallback dialog.

## 🗂 Chrome Connector (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **ChromeConnectorAction** — needs a cc build with `browse chrome`.
      Tools → "Chrome Connector" with no debug Chrome → Launch offer →
      Chrome opens with the dedicated profile; sign in to a site, run the
      action again → "Connected: Chrome/1xx" → Capture → report shows the
      tab URL/title, console + network issues (Capture with Reload catches
      load-time errors), DOM size, screenshot path (file exists). Cancel
      paths do nothing. cc without `browse chrome` → capture fails with the
      CLI error surfaced, no exception.

## 🗂 P2 batch (unreleased) — code-complete, NOT yet runIde-verified (2026-07-10)

- [ ] **Deep link extended params (P2 #11, `CcProtocolCommand` + `ChatPanel`
      resumeSession/openFileAtLine/applyApprovalMode).** From a terminal:
      `jetbrains://idea/chainlesschain/open?prompt=hi&file=<abs .java>&line=20`
      → the IDE focuses the chat tool window, opens that file at line 20, and
      seeds "hi" (NOT sent). Add `&session=<an existing id>` → a new tab is
      created resuming that id (next message continues it). Add
      `&mode=acceptEdits` → the active conversation flips to accept-edits (info
      line, next message applies). `&mode=bypassPermissions` → mode UNCHANGED
      (dropped by the parser). `&workspace=<some other path>` → the whole link
      is ignored with the "different workspace" message. Windows/中文/space paths
      open correctly.
- [ ] **Auto-exec scan (P2 #13, `AutoExecScanAction`).** In a project that has
      `.vscode/tasks.json` + `.mcp.json` (+ a `.git/hooks/pre-commit` that is NOT
      `.sample`): Tools → "Scan Workspace for Auto-Exec Config" → dialog lists
      those files loudest-first (MCP/hook first) with "Trust workspace" →
      choosing it persists (re-running shows "currently trusted" + "Untrust").
      A clean project → "No auto-executable config found". No project → "Open a
      project first."
- [ ] **Remote/WSL Doctor section (P2 #12, `DiagnoseBridgeAction`).** Tools →
      "Diagnose Bridge" → the report ends with a "Remote / WSL Doctor" section:
      on a normal local project with the bridge up it shows ✓ cc present / ✓
      bridge listening; stop the bridge → ✗ bridge-stopped with the Restart hint;
      open a project over a `\wsl.localhost\…` path (or run the IDE in WSL) → the
      ⚠ WSL2 mirrored-networking advisory with the `.wslconfig` fix appears.

## 4b Diff review edit capture + line anchors (0.4.55) — code-complete, published, NOT yet runIde-verified (2026-07-10)

Gap-analysis #4 close-out (`5ac52a5b90`, released as 0.4.55). Pure `ReviewNote`
JUnit 11/0 + smoke (795/0, +20); `compileJava` clean against the 2024.2 SDK
(`DiffContentFactory.createEditable(project, text, null)` verified to exist);
`buildPlugin` zip verified (0.4.55 plugin.xml + change-notes, `ReviewNote` in
the jar, 3+3 en/zh `diff.requestChanges.*` bundle keys).

Glue-layer (needs the next pre-release runIde pass):

- [ ] **In-viewer edit survives Accept** — trigger an agent file edit → diff
      opens; TYPE an extra line into the right (Proposed) pane; close the diff
      window; choose Accept → the file on disk contains the typed line, and the
      agent's next turn references the amendment (with cc ≥ next release, its
      tool result carries `userAmendments`; with older cc just `userEdited`).
- [ ] **Untouched Accept is byte-exact** — same flow but don't type: the file
      matches the CLI's proposal byte-for-byte even when the proposal contains
      CRLF line endings (the normalize-then-compare guard picks the original).
- [ ] **Pick hunks after editing** — edit the right pane, then "Pick hunks…":
      the hunk list reflects the EDITED text; applying a subset keeps unpicked
      regions at the on-disk original.
- [ ] **Line-anchored note** — "Request changes…" → enter `2: rename this`:
      the agent's feedback block shows `line 2: rename this ⟪<that line's
    text>⟫`; enter a plain note → renders as `(general)`; enter `999: x` in a
      short file → arrives as a general note reading `999: x` (no fake anchor).
      Full-width `：` also anchors. Prompts render zh under the Chinese
      Language Pack (diff.requestChanges.\* keys).

## 🗂 PSI semantic bridge tools (unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Gap-analysis #7 「更深 IDE 语义工具」. Pure core `SemanticTools` (validation /
caps / shaping, JUnit `SemanticToolsTest` 30/0 + smoke 813/0, +18) is verified
headless; `compileJava` against the 2024.2 SDK proves the PSI APIs exist
(`LanguageDocumentation.allForLanguage`, `ReferencesSearch.search`,
`MethodReferencesSearch.search`, `PsiCallExpression.resolveMethod`,
`ModuleRootManager`). The glue `intellij/PsiSemanticFacade` needs a real IDE:

- [ ] **Tools advertised.** With the bridge up, `cc` in the project →
      `/ide` (or MCP tools/list) shows `mcp__ide__getHover`, `goToDefinition`,
      `findReferences`, `renamePreview`, `getCallHierarchy`, `getSymbolInfo`,
      `getProjectModel` alongside the existing tools.
- [ ] **getHover** on a JDK symbol (e.g. `String.format` usage, 1-based
      line/column) → rendered quick-doc text (HTML stripped, no tags); on a
      doc-less local variable → signature-ish fallback text; on whitespace →
      `found:false` with a reason.
- [ ] **goToDefinition** on a method usage → its declaration file/line/column
      (1-based) WITHOUT the user's editor navigating anywhere; on the
      declaration itself → the same location (self-definition).
- [ ] **findReferences** on a symbol with many usages → list capped at `max`
      (default 100), `total` + `truncated:true` when over; declaration NOT in
      the list.
- [ ] **renamePreview** on a widely-used symbol → per-file occurrence counts,
      declaration file flagged, `preview:true`, and — critically — NO file
      modified, no refactoring dialog, no undo entry.
- [ ] **getCallHierarchy** on a Java method → 1 level of callers + callees,
      each `Class#method` + file/line, capped; on a Kotlin function / non-method
      → empty lists + `reason` (graceful degrade, not an error).
- [ ] **getSymbolInfo** on a field → name/kind=field/containingClass/package/
      owner/file/line/language; on a local variable → kind reflects it.
- [ ] **getProjectModel** → the project's modules with source roots +
      dependency names (capped at 100 each) and the project JDK name/version.
- [ ] **Dumb mode.** Trigger reindexing (Invalidate Caches or open mid-index):
      hover/symbolInfo/callHierarchy return a "still indexing" reason,
      definition/references surface a friendly isError — nothing hangs or
      throws raw `IndexNotReadyException` at the CLI.
- [ ] **Non-Java IDE (optional).** In an IDE without the Java plugin the
      bridge still starts (compile-time-only dep) and callHierarchy degrades
      with the "requires the Java plugin" reason.

## 🗂 Sessions Workbench tool window (unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Gap-analysis #3 「跨端 Remote/Cloud Session 入口」. Pure core `SessionsWorkbench`
(source parsing / aggregate+dedup / sort / filter / action ids / relative time /
display columns; JUnit `SessionsWorkbenchTest` + smoke section) is verified
headless; `compileJava` proves the SDK glue compiles. The glue
(`intellij/SessionsWorkbenchToolWindowFactory` + `SessionsWorkbenchAction`,
tool window id `ChainlessChain Sessions`) needs a real IDE:

- [ ] **Open.** Tools → "ChainlessChain: Sessions Workbench" reveals the
      tool window (right stripe, ChainlessChain icon); the table renders with
      columns Kind / Title / Status / Workspace / Last activity and the count
      note at the bottom. zh IDE (Chinese Language Pack) shows the localized
      menu item, buttons and column headers.
- [ ] **Aggregation.** With ≥1 saved chat session, an IDE-index entry, a
      running `cc agent -p "…" --bg` and a `cc remote-control start` host all
      present, all four kinds appear; a background agent whose sessionId
      matches a chat session REPLACES that chat row (kind=background, session
      id shown in detail); waiting-approval rows sort above running rows,
      running above the rest.
- [ ] **Search.** Typing in the search field narrows rows by title/workspace/
      id case-insensitively; clearing restores; selection survives a refresh
      when the row still exists.
- [ ] **Auto-refresh.** Visible window refreshes every ~15s (watch a bg agent
      finish → row flips to finished actions); hiding the tool window stops
      the cc spawns (Process Explorer: no new `cc session list` children while
      hidden); closing the project disposes the timer (no leaked Alarm).
- [ ] **Buttons enable per row.** chat/ide row → Resume/Rename/Delete only;
      running background → Attach/Stop/Rename; finished background →
      Resume/Logs/Rename; remote host → Status/Stop; warning row → none.
- [ ] **Resume (chat).** Selecting a chat/ide row + Resume activates the chat
      tool window and opens a NEW tab that continues the picked session on the
      next message (same behavior as the deep-link `session=` param).
- [ ] **Attach (running bg).** Prompt dialog → the running agent receives the
      follow-up over the one-shot pipe (reply JSON lands in the note line);
      a non-interactive running agent shows the "no live session transport"
      info instead.
- [ ] **Rename.** Background row → `cc daemon rename` (title changes after
      refresh); chat/ide row → IDE-index overlay rename (title changes in this
      table AND in the chat panel's /sessions picker).
- [ ] **Delete (chat).** Confirm dialog → transcript removed
      (`cc session delete --force`) + index entry pruned; the row disappears.
- [ ] **Stop.** Running background row → `cc daemon stop`; remote row →
      `cc remote-control stop --port <n>` (state file pruned, row goes stale/
      disappears on refresh).
- [ ] **Logs / Status.** Finished background row → monospace log-tail dialog;
      remote row → hosts status dialog listing port/pid/mode/session.
- [ ] **Failure tolerance.** Rename `cc` off the PATH (or point ccPath at a
      bogus binary) → the chat + remote sources degrade to warning rows at the
      top, background + ide rows still render, no dialog spam, no EDT freeze.

## 🗂 Artifacts drawer (unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Gap-analysis #9. Pure core `Artifacts` (list JSON parsing / newest-first
shaping / kind+query filter / previewability classification / action
derivation / human size / stored-path derivation; JUnit `ArtifactsTest` +
smoke section) is verified headless; `compileJava` proves the SDK glue
(`intellij/ArtifactsAction`, dialog form like BackgroundAgentsAction —
deliberately NOT a tool window) compiles, incl. `RevealFileAction.openFile`,
`LocalFileSystem.refreshAndFindFileByNioFile` and `BrowserUtil.browse(File)`
on 2024.2. Needs a real IDE:

- [ ] **Open.** Tools → "ChainlessChain: Artifacts" opens the dialog; with
      ≥1 published artifact (`cc agent` publish_artifact or copy a row into
      `~/.chainlesschain/artifacts/index.jsonl` + `files/`) the table shows
      Title/Kind/Size/MIME/Created, newest first; zh IDE shows localized
      menu item, buttons, column headers and count note.
- [ ] **Filter.** Kind combo narrows to one kind; search field filters
      title/id/mime/source-path case-insensitively; count note updates
      "{shown} of {total}".
- [ ] **Buttons enable per row.** Markdown/log/json/png rows → Open enabled;
      html row → Open enabled (external); zip/pdf row → Open disabled,
      Reveal/Copy/Remove still enabled; no selection → all row actions
      disabled.
- [ ] **Open (text).** A .md/.log artifact opens read-write in the IDE
      editor from `artifacts/files/<id><ext>` (the stored copy, NOT the
      sourcePath).
- [ ] **Open (image).** A .png artifact opens in the IDE image viewer.
- [ ] **Open (html).** An .html artifact opens in the system browser.
- [ ] **Reveal / Copy path.** Reveal selects the stored copy in
      Explorer/Finder; Copy path puts the absolute stored path on the
      clipboard (note line echoes it).
- [ ] **Remove.** Confirm dialog → `cc artifacts remove <id>` runs off-EDT,
      the note shows the CLI JSON, and the row disappears on the follow-up
      refresh; `cc artifacts list` no longer shows the id.
- [ ] **Missing payload.** Delete a stored file behind the index row →
      Open/Reveal show the "Stored file not found" note instead of throwing.
- [ ] **Failure tolerance.** cc off the PATH → dialog still opens, note
      shows the load-failed message, no EDT freeze; CC_ARTIFACTS_DIR override
      is honored for Open/Reveal/Copy (paths must match the CLI's).

## 🗂 Permissions & Policy viewer (unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Gap-analysis #10. Pure core `PolicyViewer` (permissions-list / recent-denials
/ auto-mode-config / auto-mode-defaults parsing, malformed → null, describe()
per-source failure tolerance, summary counts line; JUnit `PolicyViewerTest` +
smoke section) is verified headless; `compileJava` proves the glue
(`intellij/PolicyViewerAction`, ShowUsageAction-style monospace dialog + a
Refresh button that re-gathers in place). Needs a real IDE:

- [ ] **Open.** Tools → "ChainlessChain: Permissions and Policy" shows the
      dialog with the summary line first ("permissions: X allow / Y ask /
      Z deny · N recent denials · auto-mode: …"), then the four sections;
      zh IDE shows the localized menu item / title / Refresh button.
- [ ] **Rules.** With rules in `.claude/settings.json` (+ `--user`/`--local`
      layers) the ruleset renders grouped deny → ask → allow, each rule
      showing its source file; with a managed policy file present the
      "[managed]" badge and the active restriction lines appear.
- [ ] **Denials.** After an agent run hits a deny rule, `cc permissions
      recent` entries render most-recent first with tool + summary + xN
      count + via:rule + mode + relative time and the reason line.
- [ ] **Auto-mode.** With `autoMode.decisions` customized in settings the
      matrix shows the overridden decisions with source `settings`, the
      fine-grained tool/commandPattern rules render above the matrix, and
      `classifyAllShell` reflects the effective value; unconfigured shows
      "trusted policy (defaults)".
- [ ] **Precedence.** The chain renders managed-settings >
      permission-rules.deny > … > hooks (from `cc auto-mode defaults`).
- [ ] **Refresh.** Add a rule via `cc permissions add …` while the dialog is
      open → Refresh re-gathers off-EDT (button disabled while in flight)
      and the new rule appears; no EDT freeze during the 4 cc spawns.
- [ ] **Failure tolerance.** cc off the PATH → all four sections degrade to
      "⚠ unavailable" warning entries, dialog still opens; with only one
      source broken (e.g. corrupt recent-denials store) the other sections
      still render.

## 🗂 Plugin / LSP quality board (unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Gap-analysis #11. Pure core `PluginQuality` (validate/status parsers, honest
lsp verdict derivation — unknown never fabricated, flag rules incl.
lsp-only-not-unused and the deliberate absence of a `slow` flag, text board
render + summary line; JUnit `PluginQualityTest` + smoke section) is verified
headless; `compileJava` proves the glue (new "Quality" tab in
`PluginManagerAction`, gathered off-EDT after the existing tabs). Needs a
real IDE:

- [ ] **Open.** Tools → "ChainlessChain: 管理插件与 MCP" now shows a
      Quality tab (zh IDE: 质量看板) between Plugins and MCP servers; while
      gathering it shows the loading line, then the board text + the counts
      summary label.
- [ ] **Counts.** With ≥1 runtime plugin installed the board lists each
      plugin's non-zero component counts ("skills 2 · lsp 1"); a plugin
      contributing nothing shows "(none)" + the `unused` flag.
- [ ] **Broken.** A plugin whose manifest fails validate shows `✖ broken`
      + the first errors; a plugin whose validate output can't be read
      (e.g. dir deleted behind the store) shows "validate failed: …" +
      "validity unknown" — NOT broken.
- [ ] **LSP verdicts.** A trusted plugin with a resolvable LSP server shows
      `lsp ok`; break the server binary (rename it) → `lsp unavailable`;
      untrust the plugin → `lsp unknown` (its server is no longer
      registered — the builtin row for the same language must NOT be used);
      with `cc code-intel status` failing, the board header warns and all
      lsp verdicts degrade to unknown.
- [ ] **Per-plugin tolerance.** One plugin with a corrupt manifest must not
      blank the section — the other rows still render.
- [ ] **Refresh.** The dialog-level Refresh button re-gathers the board too
      (quality fills after the three list tabs; no EDT freeze during the
      per-plugin validate spawns).

## 🗂 Remote / WSL Doctor one-click fixes (unreleased) — code-complete, NOT yet runIde-verified (2026-07-11)

Gap-analysis #12. Pure core `RemoteDoctorFixes` (three-tier classification,
strict npm allowlist, digits-validated port extraction, .ps1 generation
invariants, .wslconfig patch; JUnit `RemoteDoctorFixesTest` + smoke section)
+ the RemoteDoctor `jb-remote-dev` info check are verified headless;
`compileJava` proves the glue (fix buttons under the Diagnose Bridge report;
`FileSaverDescriptor` + `FileChooserFactory.createSaveFileDialog(…).save(
(VirtualFile) null, name)` and `TerminalToolWindowManager.createShellWidget`
compile on 2024.2). Needs a real IDE:

- [ ] **No-op case.** All-ok report → no fix buttons at all under the text.
- [ ] **Apply safe fixes.** With an outdated cc (or cc off PATH) + stopped
      bridge, the button lists exactly what will run in ONE confirmation
      (npm line + restart line, zh IDE localized); Yes → the npm command
      runs in a VISIBLE "ChainlessChain Doctor" terminal tab (never hidden
      exec) and the bridge restarts via the existing service path with the
      usual restarted/failed message.
- [ ] **Terminal fallback.** With the Terminal plugin disabled, the npm fix
      degrades to "command copied to clipboard" info message instead of
      throwing.
- [ ] **Save .ps1.** With the firewall advisory present (remote session +
      unverified port), the save dialog defaults to
      cc-ide-firewall-fix.ps1; the saved file opens in the editor, first
      line `#Requires -RunAsAdministrator`, `$ports = @(<real port>)`, and
      running it unelevated refuses / elevated adds the rule and a second
      run prints "already exists - skipping". The plugin itself never runs
      netsh.
- [ ] **Copy .wslconfig patch.** Button copies exactly
      `[wsl2]\nnetworkingMode=mirrored\n` and the info message names
      %UserProfile%\.wslconfig + `wsl --shutdown`.
- [ ] **Remote Development check.** In a JetBrains Client / remote-dev
      frontend (system property `remote.development` or platform prefix
      `JetBrainsClient`), the report shows the ℹ jb-remote-dev advisory
      (install on HOST + docs link) without degrading the overall verdict;
      on a normal local IDE the check is absent.
