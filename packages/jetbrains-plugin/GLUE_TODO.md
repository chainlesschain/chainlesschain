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

## 🔌 `@folder/` completion — code-complete, NOT yet runIde-verified

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

## 🔌 IDEA built-in MCP auto-connect (server `idea`) — code-complete, NOT published

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
