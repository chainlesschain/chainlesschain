# JetBrains glue TODO — wire the 0.22.0 pure layers into IntelliJ

The pure logic for VS Code extension 0.22.0's four features is ported and tested
(`com.chainlesschain.ide.{ConversationManager,PreviewDetect,MultiDiff}`,
`PureLogicSmokeMain` — 56 assertions, `javac --release 8`). What's left is the
**IntelliJ-SDK glue** in `com.chainlesschain.ide.intellij.*`.

> ⚠️ All of this is **SDK-gated**: it needs a Mac/Linux + IntelliJ Platform SDK
> to `./gradlew buildPlugin` and `runIde` (can't build/verify on the current
> Windows box — same constraint as iOS). Per the dead-panel lesson (0.9.0/0.10.0),
> every UI piece must be **manually verified in a `runIde` sandbox** before publish,
> not just compiled.

---

## 1. Conversation tabs — wire `ConversationManager`
Today `ChatToolWindowFactory` is single-session (one child, `stopBtn`/`newBtn`).

- [ ] Add a tab strip to the chat tool window — `JBTabbedPane` (simple) or
      `JBEditorTabs` + `TabInfo` (native look). Render from `ConversationManager.list()`.
- [ ] Hold one `AgentChatSession` per tab via `ConversationManager.setSession(id, …)`;
      route each session's events to **that** conversation's turn state, and only
      render the **active** tab's transcript (mirror VS Code `_postFrom`/`_makeOnEvent`).
- [ ] `+` button → `create()`; tab close (×/middle-click) → `close()` (activates the
      neighbor, never empties); tab click → `switchTo()`.
- [ ] Restore per-tab transcript on switch (keep a per-tab `JTextPane`/document, swap
      on activate) — VS Code buffers `log.innerHTML`; here keep N documents.
- [ ] Persist per-tab resume ids in `PropertiesComponent` (extend the existing single
      session-id resume) so tabs survive IDE restart. Optional, matches VS Code.
- [ ] On tool-window/project dispose → stop every `allSessions()`.

## 2. App Preview — wire `PreviewDetect`
All new (no preview glue exists yet).

- [ ] Actions `chainlesschain.preview.start` + `.stop` in `plugin.xml`
      (`<action>` + a tool-window/editor-toolbar button).
- [ ] Read `<project.getBasePath()>/package.json` → parse `scripts` → `PreviewDetect.pickDevScript`.
- [ ] Spawn `npm run <script>` via `GeneralCommandLine` + `OSProcessHandler`
      (or reuse the `AgentChatSession` ProcessBuilder pattern); feed each output line
      through `PreviewDetect.detectServerUrl` until the first hit.
- [ ] On URL → embedded preview: `JBCefBrowser` (JCEF) inside a tool-window `Content`
      (check `JBCefApp.isSupported()`; fall back to `BrowserUtil.browse(url)` if not).
- [ ] `.stop` → kill the process tree (`OSProcessHandler.destroyProcess` /
      taskkill `/T` on Win, process group on POSIX — mirror VS Code `_killTask`).
- [ ] Idempotent start (re-focus the existing preview) + status via a balloon/`StatusBar`.

## 3. Inline diff comments (Request changes…) — extend `openDiff`
`IntellijEditorFacade.openDiff` exists but is **show-only** (`DiffManager.showDiff`
+ `SimpleDiffRequest`) — no blocking Accept/Reject yet.

- [ ] First make `openDiff` **block on a decision** (Accept / Reject) — e.g. a modal
      `DiffRequestPanel` in a `DialogWrapper`, or show + a follow-up confirm.
- [ ] Add the third outcome **"Request changes…"**: capture line-anchored notes
      (selected line range in the right pane + an input dialog, loop for several).
- [ ] Return `{outcome:"changes-requested", comments:[{line,endLine,lineText,note}], reviewedText}`
      from `openDiff` — **same shape as VS Code** so the CLI's `requestIdeDiffApproval`
      handles it unchanged (the agent/CLI side needs **no** change — it already
      understands `changes-requested`).

## 4. Batch multi-file diff (openMultiDiff) — wire `MultiDiff`
New tool; `MultiDiff` model is ready.

- [ ] Add `openMultiDiff(files, title)` to the `EditorFacade` interface +
      `IntellijEditorFacade` impl. Build the changeset via `MultiDiff.changesetSummary`.
- [ ] Show a native multi-file diff — `DiffManager.showDiff` with a
      `SimpleDiffRequestChain` of per-file `DiffContent`s (or the combined-diff editor
      where available).
- [ ] Decision: **Accept all** / **Pick files…** (`MultiDiff.fileLabel` rows in a
      checkbox dialog) / **Reject** → `MultiDiff.selectWrites(files, picked)` →
      write chosen files in a `WriteCommandAction` via VFS.
- [ ] Expose `openMultiDiff` as a tool in `IdeTools.java` (a new `BaseTool`, conditional
      like VS Code) → becomes `mcp__ide__openMultiDiff` for the agent.

## 5. Older backlog (pre-0.22.0, separate)
**Pure layers already ported** (no glue): event **mapping** is a complete twin in
`ChatEvents.java` (all 11 kinds incl. `plan_update`→"plan",
`approval_request/_resolved`→"approval"/"approval_done"); the `@`-mention
completion logic (detect token, rank files, IDE pseudo-mentions, format/dedupe
workspace symbols) is in `Mentions.java` (`1ef021c5x`). What remains is the IntelliJ
**rendering/interaction** glue:

- [ ] Plan card (items + Approve/Reject) rendered from the "plan" UI event.
- [ ] Approval cards (confirm-tier → Approve/Deny) — finish the `approval` handling.
- [ ] Panel slash commands: `/new /plan /approve /reject /stop /cost /context`.
- [ ] Selection actions: **Explain** / **Refactor** (editor right-click → seed chat
      with `@selection`).
- [ ] `@`-mention completion **glue**: feed `Mentions.filterFiles` from project files
      and `Mentions.formatSymbolItems` from a PSI symbol search
      (`GotoSymbolModel`/`ChooseByNameContributor`); wire `detectAtToken`/`applyMention`
      to the input field's completion popup. (Pure logic done — just wire it.)
- [ ] Keybindings: quick-launch tool window + insert `@file` reference.

## Build / verify / publish
- [ ] `./gradlew buildPlugin` (needs IntelliJ SDK) → `./gradlew runIde` sandbox, manually
      exercise each feature (mandatory per `feedback_full_test_pyramid_before_publish`).
- [ ] Bump plugin version; publish via `.github/workflows/ide-extensions.yml` JetBrains
      job — tag `ide-jetbrains-v*` + `JETBRAINS_PUBLISH_TOKEN` secret.

---

_Pure layers landed `1ef021c52` (2026-06-15). VS Code reference: the same four
features shipped in extension 0.22.0 (see `packages/vscode-extension/src/`
`chat/conversation-manager.js`, `preview.js`/`preview-detect.js`, `multi-diff.js`,
`vscode-facade.js` `openMultiDiff`, and the `changes-requested` path in
`vscode-facade.js` + CLI `ide-context.js`)._
