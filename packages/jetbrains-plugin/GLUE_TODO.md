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
- [ ] Sync the 官网 ide page / README to the 0.4.0 features (mirror VS Code copy).

## ✅ Also done
- [x] @-mention **class + method/function symbols** via PSI search
      (`PsiShortNamesCache` getAllClassNames/getAllMethodNames, bounded 800 each,
      resolved to file → `Mentions.formatSymbolItems`) — classes 0.4.2, methods
      0.4.3, both runIde-verified + published.

---

_Glue landed 2026-06-16 (§1–§6). Pure layers: `1ef021c52` + `84a562149` +
`formatInsertReference`. VS Code reference: extension 0.22–0.30 (`packages/
vscode-extension/src/`)._
