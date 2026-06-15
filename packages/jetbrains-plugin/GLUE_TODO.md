# JetBrains glue TODO — wire the 0.22.0 pure layers into IntelliJ

The pure logic for VS Code extension 0.22.0's four features (+ the older-backlog
@-mention completion) is ported and tested
(`com.chainlesschain.ide.{ConversationManager,PreviewDetect,MultiDiff,Mentions}`,
`PureLogicSmokeMain` — 81 assertions, `javac --release 8`). What's left is the
**IntelliJ-SDK glue** in `com.chainlesschain.ide.intellij.*`.

> 🚫 **RELEASE HELD (decided 2026-06-15).** Do NOT publish a JetBrains release for
> these pure layers alone — they are internal logic with **no user-facing change**
> until the glue below is wired. Bumping/tagging now would ship users nothing new.
> **Cut the next `ide-jetbrains-v*` release only after the glue lands and is
> sandbox-verified.** (The VS Code 0.22.0 features are already live on Open VSX.)

> ⚠️ All of this is **SDK-gated**: it needs a Mac/Linux + IntelliJ Platform SDK
> to `./gradlew buildPlugin` and `runIde` (can't build/verify on the current
> Windows box — same constraint as iOS). Per the dead-panel lesson (0.9.0/0.10.0),
> every UI piece must be **manually verified in a `runIde` sandbox** before publish,
> not just compiled.

---

## ✅ Done — pure logic layers (committed, tested)
These are finished and `javac --release 8`-tested (81 assertions in
`PureLogicSmokeMain`); the glue below builds on them.

- [x] `ConversationManager.java` — conversation-tabs model (`1ef021c52`)
- [x] `PreviewDetect.java` — App Preview dev-script + URL detection (`1ef021c52`)
- [x] `MultiDiff.java` — multi-file diff changeset model (`1ef021c52`)
- [x] `Mentions.java` — @-mention completion logic (`84a562149`)
- [x] `ChatEvents.java` — stream-event mapping (already complete, all 11 kinds — verified)
- [x] `SessionArgs.java` — `--permission-mode` selector arg builder (VS Code 0.30.0 #1)
- [x] `IntrospectArgs.java` — cost/context args (`--json`) + context-window parser (0.30.0 #2)
- [x] `ConversationManager` — per-conversation `mode` + `thinking` fields + setters (0.30.0)
- [x] `SessionArgs` — extended-thinking toggle (`--think`/`--ultrathink`) 5-arg overload

(0.30.0 pure layers tested in `PureLogicSmokeMain` — now **111 assertions**, `javac --release 8`.)

## ⏳ Remaining — IntelliJ glue (SDK-gated; what's below is NOT done)

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
workspace symbols) is in `Mentions.java` (`84a562149`). What remains is the IntelliJ
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

## 6. VS Code 0.30.0 parity (pure layers ported; glue pending)
Mirrors the three features that shipped in VS Code extension 0.30.0. The pure
logic is done (`SessionArgs`, `IntrospectArgs`, `ConversationManager.mode`); what
remains is IntelliJ glue in the chat tool window.

- [ ] **Approval-mode selector** (`/auto`=acceptEdits, `/bypass`=bypassPermissions,
      `/normal`=default): a mode control (toolbar combo or slash commands) →
      `ConversationManager.setMode(id, mode)`; spawn the per-tab `AgentChatSession`
      with `SessionArgs.build(provider, model, resume, conv.mode)` as `extraArgs`.
      Since `--permission-mode` is spawn-time, a mode change must stop the live
      child so the next message respawns with the new flag (resume id preserved).
      Depends on section 1 (per-tab sessions).
- [ ] **Persistent context-window indicator**: after each turn (result event),
      best-effort run `cc context <id> --json` (build args via
      `IntrospectArgs.build("context", id, model, provider, true)`), parse with
      `IntrospectArgs.parseContextStatus`, and render a subtle status line
      (`⊟ context 12.3k / 200k (6%)`, red on overflow) under the chat — e.g. a
      `JBLabel` in the tool-window south bar. Gate behind a setting + active tab.
- [ ] **New-conversation / reopen-closed actions + keybindings**: action
      `chainlesschain.chat.newConversation` (→ `ConversationManager.create()`,
      reveal tool window) and `chainlesschain.chat.reopenClosedSession` (remember
      the last `close().conv` and re-`create(title, sessionId, true)` to resume).
      Register keymap defaults (avoid `Ctrl+Shift+Esc` — OS-reserved on Windows;
      VS Code used `Ctrl/Cmd+Alt+N` and `Ctrl/Cmd+Shift+T`).
- [ ] **Extended-thinking toggle** (`/think`=on, `/ultrathink`=max, `/think-off`):
      a control (slash commands or toolbar) → `ConversationManager.setThinking(id,
      level)`; spawn carries `SessionArgs.build(..., conv.thinking)` →
      `--think`/`--ultrathink`. Same spawn-time restart story as the approval
      mode. Anthropic-only (other providers ignore the flag). Depends on §1.

## Build / verify / publish — 🚫 HELD now, but ⚠️ MUST publish once glue lands
**Release is on hold** (decided 2026-06-15) — but **held ≠ cancelled.** Once the
sections 1–6 glue is implemented AND `runIde`-verified, **publishing the JetBrains
version is the required final deliverable** (user re-emphasized 2026-06-15: "glue
上线后记得发 JetBrains 版本"). Don't finish the glue and forget to ship it.
(Currently live on JetBrains Marketplace: **0.3.3**, no 0.22 features.)

- [ ] (gate) Sections 1–6 glue implemented + manually verified in `./gradlew runIde`.
- [ ] `./gradlew buildPlugin` (needs Mac/Linux + IntelliJ SDK) → `./gradlew runIde` sandbox,
      manually exercise each feature (mandatory per `feedback_full_test_pyramid_before_publish`).
- [ ] **Then publish (required, not optional)**: bump plugin version + tag
      `ide-jetbrains-v*` → CI `.github/workflows/ide-extensions.yml` JetBrains job
      `publishPlugin` with `JETBRAINS_PUBLISH_TOKEN` to JetBrains Marketplace.
- [ ] Sync the JetBrains changelog/README + 官网 ide page to the shipped features
      (mirror the VS Code 0.22.x copy).

---

_Pure layers landed `1ef021c52` + `84a562149` (2026-06-15). VS Code reference: the same four
features shipped in extension 0.22.0 (see `packages/vscode-extension/src/`
`chat/conversation-manager.js`, `preview.js`/`preview-detect.js`, `multi-diff.js`,
`vscode-facade.js` `openMultiDiff`, and the `changes-requested` path in
`vscode-facade.js` + CLI `ide-context.js`)._
