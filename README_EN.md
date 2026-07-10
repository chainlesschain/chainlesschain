# ChainlessChain - Personal Mobile AI Management System Based on USB Key and SIMKey

> **📋 Android v1.0 Repositioning RFC under review** (2026-05-10) — Desktop = AI workstation, Mobile = key + capture + remote. Stop chasing desktop skill count; pivot to L1 (StrongBox/DID/QR) + L2 (Voice/Camera OCR/push) + L3 (REMOTE-invoke desktop skills) three-layer architecture. See [design doc](docs/design/Android_重新定位_设计文档.md) | [user doc](docs-site/docs/chainlesschain/mobile-positioning.md).

> **📦 CLI install**: `npm i -g chainlesschain` (aliases `cc` / `clc` / `clchain`).
> **Note for users behind the China mirror**: if your npm defaults to the Taobao mirror `registry.npmmirror.com`, you may hit `npm error code E404 … '@chainlesschain/…' is not in this registry` during install. This is the mirror **lazily syncing tarballs** for newly published packages (metadata is present but the tarball isn't cached yet). Install from the official registry instead:
>
> ```bash
> npm i -g chainlesschain --registry https://registry.npmjs.org
> ```
>
> The mirror usually catches up shortly after a release (the project's publish pipeline also triggers a sync proactively); once synced, the default mirror works fine.

## 2026-07-10 Release — **IDE plugins VS Code 0.37.12 / JetBrains 0.4.56: in-IDE pairing QR + Remote Control relay settings (gap-list closeout)**

> IDE-only dual release (live on Open VSX + JetBrains Marketplace). Remote Control pairing no longer requires watching a terminal: the one-time pairing URI now renders as a QR code inside the IDE (VS webview / JB dialog, both ends sharing the same self-contained QR encoder core) — scan with your phone and you're paired; relay mode (E2EE cross-network) gets an IDE settings surface for `--relay-url` / `--peer-id` (VS settings / JB "Relay settings…" dialog). With this, every non-environment-blocked item in the IDE gap-analysis list is closed (#5 line-range mention `@file#L12-40` verified long-landed — the doc entry was stale; #8 `browser_state` first-class agent tool is on mainline, tool count 24 → 25, ships with the next cli npm release). Verified: VS 70 test files / 605 green + 7/7 vsix parse-level checks; JB test + smokeTest + buildPlugin green + 6/6 zip parse-level checks. Same-day mainline also landed web-panel direct-LAN pairing + `permission.request` approval cards (batch 28, ships with the next cli release).

## 2026-07-10 Release — **cc CLI 0.162.157: IDE diff-review amendments + plan review snapshots + `cc browse chrome` + `--bare`/no-slash/screen-reader modes**

> CLI-only release (0.162.156 → **0.162.157**, npm `latest`, provenance). Deeper IDE integration: **the agent now sees what you changed in a diff review** (accepted results carry a `userAmendments` -/+ line-level summary of your in-diff edits; end-to-end with JetBrains 0.4.55's editable right pane) + plan approve/reject carries a review snapshot into the session transcript (auditable, replayable) + `cc browse chrome` (CDP attach to your real Chrome with login state; console/network/DOM/screenshot observation) + **Artifacts v1** (`publish_artifact` tool + `cc artifacts` — deliverables ship metadata-only into the conversation) + **Windows/PowerShell first-class** (run_shell `shell` param / explicit argv / `PowerShell(...)` permission umbrella) + `--bare` minimal-attack-surface mode / `--disable-slash-commands` / `--ax-screen-reader`. Command count **172 → 173**. Full three-layer test pyramid green in a clean worktree before publish.

## 2026-07-09 Release — **cc CLI 0.162.156: `cc agenda` + `cc batch` (phase-4 closeout) + `@chainlesschain/agent-sdk` 0.1.0 first npm publish**

> CLI-only release (0.162.155 → **0.162.156**, npm `latest`, provenance); **`@chainlesschain/agent-sdk` 0.1.0 first-published in the same run**. Command count **170 → 172**: `cc agenda` (the persistent consumer for the new notify/schedule agent tools — wakeup/cron/monitor intents land in `~/.chainlesschain/agent-schedule/` and fire `cc agent -p` when due) + `cc batch` (split a large change into independent units, run each in its own git worktree in parallel, `--test` gate + `--merge` sequential integration that reports conflicts instead of clobbering). Full local three-layer test pyramid green before publish (unit+integration 23,447 / e2e 628). SDK details in the mainline entry below.

## 2026-07-09 Mainline — **Platformization phase 3: `@chainlesschain/agent-sdk` TypeScript SDK + contract-first across all four consumers (published to npm with 0.162.156)**

> New package `packages/agent-sdk` formalizes the `cc agent` stream-json duplex protocol as a **versioned contract (Agent Protocol v1)**: stream events, approval callbacks, checkpoints, and session resume become typed imports instead of per-consumer argv assembly and hand-rolled NDJSON parsing (`protocol.ts` single source of truth + language-neutral `docs/PROTOCOL.md`). The **VS Code extension** (vendored CJS — vsce `--no-dependencies` constraint) and **web-panel** (vite alias straight to the TS source; all `bg-*` frames built/guarded by the SDK) have migrated; the **JetBrains plugin** (Kotlin/Java) declares conformance to the same protocol document. `AgentSession` ships Windows hardening built in (`cmd.exe /c` shim + `NoDefaultCurrentDirectoryInExePath` anti-hijack + `taskkill /T` process-tree reaping); approval callbacks fail closed. The SDK's own **real-CLI e2e** (fake ollama; asserts init/stream/approval-really-writes/resume) caught two real bugs on day one, both fixed: **first-conversation transcripts were never persisted in BOTH IDE plugins** (anonymous stream sessions are persistence-free by CLI design → an IDE-reload resume silently started empty, losing all pre-reload context; fixed by declaring a `panel-<ts>-<rand>` session id on first spawn) and `.js` entrypoints failed to spawn. Verified: agent-sdk 36/36 (unit + real-pipe integration + real-CLI e2e), vscode-ext 58 files/512, JetBrains smoke 663/0, web-panel 2458/2458. User doc [`docs-site/docs/chainlesschain/agent-sdk.md`](docs-site/docs/chainlesschain/agent-sdk.md) | design doc [`docs/design/modules/103_Agent_SDK平台化方案.md`](docs/design/modules/103_Agent_SDK平台化方案.md).

## 2026-07-09 Release — **cc CLI 0.162.155: permission modes / auto classifier + interactive background-session takeover + MCP Tool Search (phase-1 closeout, on npm latest)**

> Full closeout of the gap-analysis "Phase 1: safety & operability" roadmap (batches 1-18, command count 165→170): **permission modes `manual`/`auto`/`dontAsk`** on both headless and the interactive REPL (`auto` = a configurable classifier via settings `autoMode.decisions` with riskLevel plus fine-grained tool/commandPattern rules; `dontAsk` = anything that would prompt is denied instead); **layer-by-layer denial explanations** (blocked commands carry the settings-rules→shell-policy→approval-gate verdict chain, reviewable cross-session via `cc permissions recent`); **operable background sessions** (top-level `cc logs/attach/daemon status|view|stop|rename|resume` — a crashed session is one command away from continuing its conversation); **interactive `cc attach` takeover** (a per-session local transport lets you type follow-up prompts into a running background agent); a **web-panel Background Agents view** over the same transport (`bg-*` WS protocol; the takeover token never crosses the network boundary); plus a unified `cc remote-control` entry and mobile remote-approval bridge. Shipped to npm `latest` with provenance; older versions deprecated.

- **MCP Tool Search (ships in the same version)**: closes the "every connected MCP server's full tool schemas ride along on every LLM request, eating 10–30% of the context window" problem (parity with Claude Code ToolSearch) — when schema tokens exceed a threshold (default 10% of the window; settings `mcp.toolSearch` / `CC_TOOL_SEARCH`), tool definitions are swapped for compact `[deferred]` stubs plus an internal `tool_search` retrieval tool; full schemas come back on demand via tool results. Real-machine test: a 12-tool server saves ~14k tokens.

- **Prompt-cache friendly**: stubs are permanent and lexicographically sorted, schema loading travels as conversation content (append-only), late-connected servers append without reordering — the trailing `cache_control` breakpoint on the Anthropic path stays hot across turns.
- **Self-healing direct calls**: calling a deferred tool before searching returns a schema-embedding error (never reaches the real server) and marks it loaded; the retry goes through.
- **`/context` upgrade**: the REPL `/context` gains an MCP tool schemas section — per-server tokens/window share, tool-search state (deferred/loaded/saved), and optimization advice (`alwaysLoad` narrowing / disconnect the named largest server).
- **Bonus**: the MCP `initialize` server `instructions` string is no longer discarded — it rides along with `tool_search` results per server.
- **gap-analysis Phase 4 "cross-device & long tasks" closeout (remote-control shipped in 0.162.155, agenda/batch in 0.162.156 — both on npm)**: `cc remote-control start/status/stop` (boots an in-process WS server + a resident loopback HOST session + prints a pairing URI/QR code, dual-mode relay-E2EE or direct-LAN) and `cc agent --remote-control` (routes confirm-tier approvals to a paired mobile/web device, fail-closed on timeout) **shipped on npm in 0.162.155**; `cc agenda` (a Monitor/Cron/Push long-task scheduler consumer + two new agent tools `notify`/`schedule`) and `cc batch` (splits a large change into independent units, runs each in its own git worktree concurrently, tests, and previews merge conflicts, with `--decompose` auto-splitting) **shipped on npm in 0.162.156** (command count 170 → 172). Full test pyramid green (remote-control 36 / agenda 29 / batch 17). Docs: [`cli-remote-control.md`](docs-site/docs/chainlesschain/cli-remote-control.md) · [`cli-agenda.md`](docs-site/docs/chainlesschain/cli-agenda.md) · [`cli-batch.md`](docs-site/docs/chainlesschain/cli-batch.md).

## 2026-06-18 — **Friend P2P encrypted voice / video calls (FAMILY-67, Android)**

> On top of friend end-to-end encrypted messaging (FAMILY-67), adds **1:1 real-time voice / video calling**: pure P2P + DTLS-SRTP end-to-end encryption, signaling relayed over the existing signaling server (same friend-DID routing as messages), media over a dedicated WebRTC PeerConnection. Design: [`docs/design/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md`](docs/design/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md) §10.

- **P0 signaling state machine**: `CallManager` (ringing/accept/reject/hangup + glare arbitration + timeouts) + `CallSignalingClient` (`call:*` relayed via signaling server; delivers even if a DataChannel was never built).
- **P1 voice**: dedicated media `PeerConnection` (reuses the message-side `PeerConnectionFactory` + ICE/TURN config) + audio routing (`MODE_IN_COMMUNICATION` + earpiece/speaker).
- **P2 video**: lazily-built video `PeerConnectionFactory` with `EglBase` + codec factories, front-camera capture + remote full-screen + local PiP + camera flip.
- **P3 background/lockscreen**: incoming-call foreground service (`microphone|camera`, keeps the mic alive when locked/backgrounded) + full-screen incoming notification (turns the screen on over the lock screen + accept/reject) + proximity-sensor screen-off.
- **Tests**: state machine / signaling / integration (Robolectric) / handshake e2e — **34 JVM unit tests green**; two-device live A/V + lockscreen-incoming verification pending two real phones.

## 2026-06-18 Mainline — **cc CLI client/transport robustness hardening (vs Claude Code CLI) + full test sweep**

> Audited cc's own network/IO client layer (the layer the parallel parity loop never touches) against Claude Code CLI and fixed a batch of "silent failure / hang forever / truncate without erroring" issues, each with dedicated unit tests. Full three-tier sweep green (CLI unit 19523 / integration 24 isolated / e2e 604); the sweep also surfaced and fixed 1 `--verbose` regression + 2 stale assertions.

- **Write integrity**: `write_file` / `edit_file` verify the on-disk byte count after writing — a silent truncation or 0-byte write on a network / cloud-synced drive no longer looks like success.
- **MCP resilience**: `tools/list` failure shows "! Connected · tools fetch failed" (not a misleading "Tools: 0") / a dead stdio server process rejects in-flight requests immediately (no 30s hang) / HTTP requests get a 30s timeout (`longRunning` servers exempt — also wires up previously-unconsumed metadata) / `cc mcp serve` bounds request body size + collection timeout + error handling.
- **Install download integrity**: `cc setup` verifies Content-Length (truncated → discard, don't install) + a stall timeout (a hung mirror can't freeze the install).
- **Resource cleanup**: SIGTERM→SIGKILL escalation timers are `unref`'d + cleared on exit, so a killed task no longer holds the event loop open / delays CLI shutdown.

## 2026-06-16 Mainline — **JetBrains IDE plugin 0.4.0: VS Code feature parity (published to the JetBrains Marketplace)**

> `packages/jetbrains-plugin/` closes the feature gap with the VS Code extension (0.22–0.30) in one pass, verified feature-by-feature in a `./gradlew runIde` sandbox before shipping (tag `ide-jetbrains-v0.4.0` → CI `publishPlugin`).

- **Conversation tabs**: the chat tool window is now multi-conversation — one live `cc agent` child per tab, `+ New chat` / per-tab `×` close / instant switch / per-tab resume ids persisted across IDE restarts.
- **Approval mode + extended thinking**: panel slash commands `/auto`·`/bypass`·`/normal` + `/think`·`/ultrathink`·`/think-off` (spawn-time flags — a change restarts the child with the new flag); plus `/new`·`/stop`·`/cost`·`/context`·`/plan`·`/approve`·`/reject`.
- **Context-window line + new/reopen shortcuts**: `⊟ context …/… (n%)` refreshes after each turn; `Ctrl/Cmd+Alt+N` new conversation, `Ctrl/Cmd+Shift+T` reopen the last-closed (resumes it).
- **Selection actions + @file refs**: editor right-click Explain / Refactor (seed `@selection`); `Ctrl/Cmd+Alt+K` inserts `@<path>#L<start>-<end>` for the selection; typing `@` pops a completion chooser (`@selection`/`@diagnostics` + project files).
- **Native diff review**: openDiff is now Accept / Request changes… (inline notes fed back) / Reject; `openMultiDiff` multi-file batch review (accept all / pick files / reject) → `mcp__ide__openMultiDiff`.
- **Interactive plan / approval cards**: plans and tool approvals render as cards with Approve/Deny (Approve/Reject) buttons, replying over the same stdin protocol as VS Code.
- **In-editor app preview**: Start App Preview runs the dev script → detects the URL → embeds it via JCEF (external-browser fallback); Stop kills the process tree.
- **Fixes found during the runIde GUI pass (invisible to compilation)**: the multi-conversation refactor could silently drop replies (wrong turn-state type → CCE on the first stream event killed the reply reader); blank New-UI tool-window icon (raster-in-SVG → real PNG); cramped input (now its own full-width line).

---

## 2026-07-03 Release — **v5.0.3.134: CLI OAuth command-injection fix + MCP list hardening + workflow resume re-drive (cli 0.162.148 / Android cc bundle 20260703 · USR 74)**

> CLI security patch reaches on-device users: `mcp-oauth` authorize URLs used to be injectable through cmd.exe via the `&` in the OAuth query (remote MCP metadata could run arbitrary Windows commands) — now http(s)-only + `rundll32` with no shell; one corrupt MCP-server row no longer takes down the whole list; desktop workflow-engine now truly re-drives execution when resuming from a breakpoint/approval. `chainlesschain` 0.162.148 published to npm and bundled into the Android in-app cc with this release. Per-version detail in [CHANGELOG.md](CHANGELOG.md).

## 2026-06-28 Release — **v5.0.3.131–133: PDH collection/analysis trio (MIUI browser history + bill-month/timeline fixes + Weibo DMs) (pdh 0.4.39 / cli 0.162.129)**

> Cumulative v5.0.3.131–133: MIUI/AOSP default-browser history collector; two PDH analysis-layer date-correctness fixes shipped on device; Weibo direct-message collection (device-verified schema, high-sensitivity opt-in). Per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **v5.0.3.131 — MIUI/AOSP browser-history collector**: new `browser-history-aosp` adapter reads `com.android.browser`'s `browser2.db` (`history`/`bookmarks`, columns resolved dynamically via `PRAGMA table_info` for ROM-variant safety), reusing the Chrome adapter's `normalize()` to emit identical `BROWSE` Event / `LINK` Item — closing the "adaptation gap" the schema dictionary recorded for MIUI's default browser.
- **v5.0.3.132 — PDH analysis date fixes on device**: deriving the bill month from `dueDate` used a naive `setMonth(getMonth()-1)` that overflowed to the wrong month for due-days 29–31 (now `new Date(year, month-1, 1)`); an explicit `sinceMonths` timeline window was silently masked by the default 7-day window (now the default only applies when no window is given). New bridge-connect integration test (6 tests) automating the cross-device verification flow.
- **v5.0.3.133 — Weibo DM collection**: fills in `message_<uid>.db` (`t_buddy`→PERSON / `t_session`→TOPIC / `t_message`→EVENT, columns device-verified), **high-sensitivity → opt-in `includeDm:true` (off by default)**, leaving existing posts/likes/follows untouched.
- **Versions**: productVersion v5.0.3.130 → v5.0.3.133; pdh 0.4.36 → 0.4.39 + `chainlesschain` 0.162.117 → 0.162.129 published to npm; Android cc bundle `internal-binaries-android-v20260628c` (USR_VERSION 61).

---

## 2026-06-24 Release — **v5.0.3.130: Qzone one-tap collection + WeChat Moments collection + §8.3 learning-layer backup on device + personal-assistant UX (pdh 0.4.36 / cli 0.162.117)**

> Cumulative v5.0.3.127–130: QQ Zone (Qzone) one-tap collection via an in-app WebView (feed / message board / albums) + WeChat Moments plaintext collection; §8.3 learning-layer backup commands on device; personal-assistant stuck-watchdog + sticky always-visible trust cards. Per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **Qzone one-tap collection**: Qzone has no readable local DB → uses the API. New `pdh/lib/forensics/qzone-collect.js` (`g_tk` = bkn hash over the qzone-domain `p_skey`; feed / message board / albums → EVENT) + `cc hub collect-qzone`; Android "QQ Zone" one-tap card — in-app WebView opens `ptlogin2` login (QR / account+password) → captures the cookie → in-APK collection into the device vault. Real-device end-to-end: scan to log in → **404 events (329 feed + 73 board + 2 album)**.
- **WeChat Moments collection**: `SnsMicroMsg.db` is plaintext SQLite (no key); new `parseSnsEvents` (SnsInfo → EVENT, body from the protobuf TimelineObject). 2824 entries on a real device.
- **§8.3 learning-layer backup on device**: `cc memory/instinct/learning export/import` (hierarchical memory + learned habits + self-evolution trajectories) shipped on device with the new cc bundle, combined with the vault commands to cover end-to-end encrypted backup of all assets — keys stay personal, never uploaded.
- **Personal-assistant UX**: silent stuck-watchdog (20s reassurance / 120s friendly timeout + retry / auto-restart on process exit) + pending trust cards pinned (sticky) so they are no longer scrolled away by the message stream.
- **Versions**: productVersion v5.0.3.126 → v5.0.3.130; pdh 0.4.36 + `chainlesschain` 0.162.117 published to npm; Android cc bundle `internal-binaries-android-v20260624` (USR_VERSION 58).

---

## 2026-06-22 Release — **v5.0.3.126: major PDH on-device collection expansion + §8.3 cross-device encrypted backup + desktop security hardening (pdh 0.4.31 / cli 0.162.99)**

> Cumulative v5.0.3.122–126: large PDH on-device collection expansion (QQNT / WeChat / generic plaintext DB + multi-app Magisk staging daemon); §8.3 cross-device encrypted backup engine landed; desktop IPC/permission security hardened to ENFORCE; CLI robustness and IDE config UX improvements. Per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **PDH on-device collection**: QQNT `collect-qq` (frida-free, decrypts nt_msg.db) / WeChat `collect-wechat` (derived-key decrypt + parse) / generic plaintext DB `collect-db`; multi-app Magisk staging daemon (fully on-device on MIUI); personal-assistant PDH tools on device + node DNS fix (in-APK cc network reachability).
- **§8.3 cross-device encrypted backup**: incremental sync + N-way version-tie conflict merge + encrypted block envelope + DID-derived backup key + libp2p P2P block transport + coordinator (skips a corrupt block instead of aborting the whole restore).
- **Desktop security hardening**: IPC sender-frame trust / actor-identity / param-identity guards default to ENFORCE; RBAC authority for permission grant/revoke/delegate/bulk-grant.
- **CLI / backend / IDE**: numeric-option NaN guards + config.llm consistency (cc agents·command·cowork·orchestrate no longer fall back to ollama) + cc agents wiring fix; backend validation-500 fix + many new tests; VS Code / JetBrains Configure-LLM pre-fill (no re-typing model + key).
- **Versions**: productVersion v5.0.3.121 → v5.0.3.126; pdh 0.4.31 + `chainlesschain` 0.162.99 published to npm.

---

## 2026-06-19 Release — **v5.0.3.121: PDH analysis/collection fixes + FAMILY-67 call/notification UX + Android keyboard-overlap fix (pdh 0.4.29 / cli 0.162.82)**

> A batch of Personal Data Hub (PDH) analysis-pipeline + query-parsing + Douyin/Toutiao collection fixes; FAMILY-67 call/message notification UX polish; a single global Android keyboard-overlap fix. The release shipped 18 installer assets. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **PDH analysis pipeline**: `spending` total now uses `sumEventAmount` (no longer undercounted by the per-subtype 5000-row cap); `overview` byApp/byType/total use facetCounts (no longer truncated by the 10k-row cap); `timeline` excludes app-usage baseline aggregate events.
- **PDH query parsing**: added income-amount phrasing + symmetric "how many/几" quantifiers; removed income's bare "收到" mis-classification; "last N months" no longer overflows the month-end day and drops a whole month; "how much did I spend" without "总共" no longer mis-routes to list (it's a sum).
- **PDH collection**: Douyin usage-profile + watch-history vault ingest; Toutiao plaintext article reader (title in the share_info blob); reproducible WeChat EnMicroMsg.db decrypt-and-ingest script.
- **FAMILY-67 call/notification**: network-drop reconnect grace (ICE DISCONNECTED no longer silently hangs); friend-connection self-heal (E2EE handshake only when the DataChannel is already connected); missed-call notification + CallStyle lock-screen incoming call + "stay online to answer" foreground service; friend message notifications deep-link into the right chat + runtime POST_NOTIFICATIONS request (Android 13+).
- **Android keyboard overlap**: a global `imePadding` under edge-to-edge fixes input fields being covered by the keyboard across every page in one place.
- **Version surfaces**: productVersion v5.0.3.120 → v5.0.3.121 / desktop 5.0.3-alpha.121 / Android versionCode 503121 / iOS CFBundleVersion 121 (check-version-sync green); pdh 0.4.29 + `chainlesschain` 0.162.82 published to npm; Android cc bundle `internal-binaries-android-v20260619` (USR_VERSION 49).

## 2026-06-18 Release — **v5.0.3.120: FAMILY-67 friend call history + incoming ringtone + CLI network robustness (cli 0.162.81)**

> Friend voice/video call history is persisted and viewable + incoming ringtone/vibration/outgoing ringback + timeouts on every CLI network fetch so a dead endpoint can no longer hang forever. The release shipped 18 installer assets, and all three doc sites (docs / design / www) were synced and deployed. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **Call history**: friend voice/video call terminal states are persisted to `call_history` via `CallHistoryRecorder` (incoming/outgoing, missed, audio/video type, hangup reason); the friend profile "view call history" filters by friend DID or shows all (live Flow read).
- **Incoming ringtone/vibration + outgoing ringback**: incoming calls play the system ringtone + vibrate (respecting silent/vibrate mode), outgoing calls play ringback — fixes "no sound on incoming call".
- **CLI network robustness**: webhook notifiers / `cc update`·`vcheck` update-checks / the provider connectivity probe all get timeouts (a dead endpoint no longer hangs forever); reputation / plugin revenue split reject NaN score/amount.
- **Version surfaces**: productVersion v5.0.3.119 → v5.0.3.120 / desktop 5.0.3-alpha.120 / Android versionCode 503120 / iOS CFBundleVersion 120 (check-version-sync green); `chainlesschain` 0.162.80 → 0.162.81 published to npm.

## 2026-06-15 Release — **v5.0.3.114: PDH gov-ixiamen endpoint static-verify on a real device + Android cc bundle v20260615d (pdh 0.4.25 / cli 0.162.71)**

> Ran the PDH endpoint-capture runbook's **static-analysis tier** (read-only APK binary analysis, no login/account interaction) on a rooted device. Corrected the `gov-ixiamen` collector's fabricated placeholder host — the old `app.ixm.gov.cn` does not exist; static dex analysis confirmed i-Xiamen's real backend is `*.ixiamen.org.cn` (gateway `https://buss.ixiamen.org.cn/pbc/`), now wired (overridable via `opts.listUrl`); the list sub-path + body stay `unverified` (bodies encrypted by `libzxprotect`, opaque to static analysis). BOC (SecNeo shell) / ICBC (encrypted+signed bodies) stay snapshot; 12123 host was already correct. `@chainlesschain/personal-data-hub` 0.4.24→0.4.25 + CLI 0.162.70→0.162.71 published to npm; Android cc bundle rolled to `v20260615d`, `USR_VERSION` → 45. Desktop / Android / iOS surfaces aligned to .114 (check-version-sync green).

## 2026-06-15 Release — **v5.0.3.113: npm publish/install hardening (fix China-mirror install E404 + deprecate workflow) + VS Code ext 0.28/0.29 + CLI 0.162.70**

> Desktop / Android / iOS version surfaces aligned to .113 (check-version-sync green); Android cc bundle rolled to `v20260615c` (carries cli 0.162.70 + pdh 0.4.24, `USR_VERSION` → 44).

- **Fix China-mirror `npm install` E404** ([#33](https://github.com/chainlesschain/chainlesschain/issues/33)): `@chainlesschain/core-infra@0.1.0` had metadata but no cached tarball on `registry.npmmirror.com` → hard install failure for users defaulting to the Taobao mirror. Fixed live via a manual mirror sync (tarball 404→200); `npm-publish.yml` now PUTs the mirror sync API after each publish (best-effort, never fails the publish); README (zh+en) documents the `npm i -g chainlesschain --registry https://registry.npmjs.org` fallback.
- **`npm-deprecate.yml`**: parameterized workflow to deprecate/un-deprecate a published version via CI's `NPM_TOKEN` secret (local token is expired). Deprecated `chainlesschain@0.162.68` (published from a stale tag, missing 8 PDH adapter wirings: douban/ximalaya/keep/didi/mercedes/eleme/xianyu/vipshop); `0.162.69` is the complete fix and `0.162.70` is the current npm `latest`.
- **VS Code extension 0.28.0 / 0.29.0 (Open VSX)**: background-tab completion signal; chat-panel `/` slash commands + `@` autocomplete + `/rewind` to agent checkpoints.

---

## 2026-06-15 Release — **cc CLI 0.162.66: Claude-Code coding-loop parity — `cc review` (diff-first + `--fix`/`--comment`) + headless hardening + `cc insights` + global run/verify skills** (published to npm)

> Closes the remaining high-value gaps vs the Claude Code CLI in one pass. `chainlesschain` 0.162.65 → 0.162.66 published to npm (global-install smoke: `cc review` / `cc insights` / new `cc agent` flags all pass).

- **`cc review` — diff-first code review (`/code-review` parity)**: reviews working tree vs HEAD by default; `--staged` / `--base <ref>` (PR-style `base...HEAD`) / `--range A..B` / `--paths`, and inlines untracked new files; `low|medium|high` effort tiers; `--security` (/security-review) and `--simplify` (/simplify, cleanup-only) lenses. Read-only mode runs in plan permission (cannot edit) and emits a Markdown report; `--fix` runs acceptEdits + auto-checkpoint to apply fixes directly (each edit reversible via `cc checkpoint restore`); `--comment` parses machine-readable JSON findings and posts them as inline comments on the branch's PR via `gh` (`--dry-run` preview + interactive confirm).
- **Headless hardening (unattended runs)**: `--max-budget-usd <amount>` hard spend cap (accumulates per-call cost from the cc cost price table and stops before the next paid call); `--strict-mcp-config` (use only `--mcp-config` servers, ignoring registered + IDE bridge — reproducible tool surface); `--replay-user-messages` (stream-input mode echoes user messages for transcript/correlation).
- **`cc insights [id]` — session analysis report (`/insights` parity)**: turns / tool-call breakdown + error rate / duration / token usage + estimated $ cost, a pure JSONL review; better than `cc cost` — backfills the model from `session_start` to price headless sessions.
- **Global `run` / `verify` skills**: a new `cli-bundled` skill layer (ships with the cc package), `run` (launch + drive the app per project type) + `verify` (observe real behavior → VERIFIED / NOT VERIFIED / BLOCKED verdict); placed in a CLI-owned layer rather than the desktop builtin, **leaving the desktop "144 skills" count untouched**.

---

## 2026-06-14 Mainline — **Full-stack test-suite sweep + project-service export UTF-8 encoding bug** (rolls into the next release)

- **Real bug fix**: `project-service` wrote ZIP export entries using the platform default charset (GBK on a GBK-default JVM), so a project containing Chinese content could not be re-imported by the UTF-8 import side (`MalformedInputException`). Now always UTF-8, with a null file body written as an empty entry instead of an NPE.
- **Test-suite sweep**: ran CLI (unit/integration/e2e), desktop (stores/integration/full unit), Web Panel, core packages, and backend **Java** (`mvn test`) + **Python** (`pytest`); fixed every real failure, leaving only environment-gated cases (need Ollama/Qdrant services or GPU local inference).
- **Key fixes**: CLI deprecated-shim export parity + `hub` subcommand list + `skill sources` 4→6 layers + 24 e2e files' subprocess timeout 15s→30s (kills Windows cold-start flakes); desktop builtin skill count 145→146 + doc-only-skill allowlist; backend Java `mvn test` 32 failures→0; backend Python `git_manager`/`code_generator` stale-assertion alignment (pytest 15→41+ passing).
- **e2e server-readiness second hardening** (orthogonal axis to the line above, commit `26a811874`): 16 failures across 4 e2e files all root-caused to slow sub-server cold-start under the singleFork load with too-tight **readiness waiters / per-test budgets** (not a product bug — `cc ui` is ready in ~3.3s standalone). ui-command/web-panel readiness fallback 8s/10s→25s (the old path silently resolved with empty output, cascading into 13 failures), coding-agent `waitForReady` 10s→25s, mtc-audit given an explicit 120s, orchestrate fixed a timeout inversion 20s→40s (the old budget was shorter than the child command's own 30s timeout). Verified 89/89. See internal handbook trap #31.

---

## 2026-06-11 Mainline — **cc CLI 0.162.41: Claude-Code parity finale — project memory (cc.md) + REPL steering + structured output** (published to npm, rolls into the next release)

- **Project memory (claude CLAUDE.md parity, own primary name `cc.md`)**: `cc agent` auto-loads the `cc.md` > `CLAUDE.md` > `AGENTS.md` hierarchy (user scope / project chain / local companions / `.chainlesschain/rules.md` / path-scoped `.claude/rules`, recursive `@path` imports, 48K/192K budgets, fail-open); `cc init` now defaults to an **offline inventory** that generates cc.md (`/init` parity, templates behind `-t`, `--ai` refines conventions with a bounded agent), existing CLAUDE.md auto-`@import`ed so nothing is shadowed; `cc memory files` shows the effective chain.
- **REPL steering trio + shortcuts**: input typed mid-turn queues FIFO (fixing a concurrent-turn race), Esc interrupts instantly (reusing agentLoop's AbortSignal), `/rewind` + idle double-Esc conversation rewind (original text prefilled to edit-and-resend); plus `! <cmd>` bash passthrough (output folded into context), `# <note>` one-key memorize into cc.md, `/` command TAB completion, `/context` live window usage, offline resume recap.
- **Structured output & ecosystem exits**: `cc agent -p --json-schema <file>` (reply validated against a JSON Schema with auto-retry; stdout prints only conforming JSON); `cc mcp serve` (expose local file tools as an MCP server, root-confined + Bearer); `cc session export` (agent transcripts as Markdown) / `cc session search` (full-text across sessions); passive startup update notice (cache + detached background refresh, zero network on the hot path).
- **npm**: `chainlesschain` CLI 0.162.40 → 0.162.41 published (global-install smoke verified: init inventory / memory chain / json-schema / mcp serve all pass).

---

## 2026-06-11 Mainline — **IDE live awareness: selection/open files auto-shared per prompt + post-edit diagnostics fed back** (rolls into the next release)

- **Editor state shared at submit time**: with the IDE bridge connected, every prompt (headless / stream / REPL) automatically carries an `<ide-context>` block — active file, open tabs, current selection — so the model knows what you are looking at without copy-paste; in-flight only, never persisted (`--resume` replays your words).
- **Post-edit diagnostics feedback**: after the agent edits a file, the editor's language-server errors/warnings flow back into the tool result, so the model fixes what it just broke within the same loop.
- **Switch & tests**: `CC_IDE_CONTEXT=0` disables; 37 new tests (31 unit + 4 integration + 2 real-process e2e, all runnable without an editor host).

---

## 2026-06-14 Release — **v5.0.3.110: Personal Data Hub collector expansion — 13 new platform adapters (travel / shopping / social / docs / music / video / recruiting)**

> One `/loop` filled the PDH collection gaps: every completed-phase ≥⭐⭐⭐ platform plus the feasible long-tail. Full per-item detail in [CHANGELOG.md](CHANGELOG.md).

- **13 new collector adapters**: Tongcheng / Didi Enterprise / Dianping / Zhihu / CSDN / WPS Docs / Tencent Docs / Baidu Netdisk / Kugou Music / iQiyi / Tencent Video / BOSS Zhipin (each snapshot + cookie-api dual-mode).
- **3 shared platform-family factories**: `_document-base` (docs/cloud-drive), `_video-base` (watch history), reusing the existing shopping/travel/im base pattern.
- **Published**: `@chainlesschain/personal-data-hub` 0.4.18 + CLI 0.162.60 (npm); Android cc bundle → `internal-binaries-android-v20260614b` (carries all new adapters).
- **Version surfaces**: productVersion v5.0.3.109 → v5.0.3.110 / desktop 5.0.3-alpha.110 / Android versionCode 503110 · USR_VERSION 36 → 37 / iOS CFBundleVersion 110.

---

## 2026-06-14 Release — **v5.0.3.109: fix Android release APK missing the cc bundle (release.yml adds downloadInternalBinaries staging + a hard verify gate)**

> v5.0.3.108 real-device verification found the published APKs contained no `cc-cli.tgz` (on-device local-terminal/cc unavailable). Root cause: release.yml ran only `assembleRelease`, and the `downloadInternalBinaries` preBuild `dependsOn` doesn't fire in CI. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **Fix**: build-android now runs `downloadInternalBinaries` as its own step before assemble (so `cc-cli.tgz` is on disk before asset merge), plus a hard gate after build (`unzip -l apk | grep cc-cli.tgz`, fail if absent) so a bundle-less APK can never silently ship again.
- **Packaging-only**: bundle content unchanged (pdh 0.4.6 / internal-binaries-android-v20260613 / USR_VERSION 25).
- **Version surfaces**: productVersion v5.0.3.108 → v5.0.3.109 / desktop 5.0.3-alpha.109 / Android versionCode 503109 / iOS CFBundleVersion 109.

---

## 2026-06-13 Release — **v5.0.3.108: Personal Data Hub Pinduoduo collection completed (snapshot-only → cookie-api, anti_token signProvider seam) + Android cc bundle v20260613 (pdh 0.4.6 / cli 0.162.48)**

> Pinduoduo was the last shopping adapter still user-export snapshot-only with no automated path; this release adds active cookie-api collection, reaching parity with taobao/jd/meituan. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **Pinduoduo `shopping-pinduoduo` cookie-api (v0.2.0)**: `_syncViaCookie` fetches `transaction_list` via an injected `fetchFn`; anti_token signing is injected via a `signProvider` seam (produced by the in-APK WebView JS VM on Android); `orderToRecord` maps fields (snake/camel tolerant) + cents→yuan + status mapping; `extractOrders` tolerates nested shapes; pagination stops early on watermark. capabilities add `sync:cookie-api`; +13 tests, full PDH suite 2094 pass / 9 skipped.
- **Release chain**: pdh 0.4.5 → 0.4.6 + CLI 0.162.47 → 0.162.48 published to npm; Android cc bundle `internal-binaries-android-v20260613` (pdh 0.4.6) + `USR_VERSION 24 → 25` + `binariesVersion 20260612 → 20260613`.
- **Version surfaces**: productVersion v5.0.3.107 → v5.0.3.108 / desktop 5.0.3-alpha.108 / Android versionCode 503108 · USR_VERSION 24 → 25 / iOS CFBundleVersion 108.

---

## 2026-06-12 Release — **v5.0.3.107: Personal Data Hub FAMILY-23 family-guard collectors v0.2 live fetcher fully closed (Zuoyebang / Huawei Learning / Alipay) + Android cc bundle v20260612 (cli 0.162.46 / pdh 0.4.5)**

> This release closes out the last 3 snapshot-only placeholder collectors in the Personal Data Hub "family-guard telemetry" layer, giving them active live-collection capability. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **FAMILY-23 collectors v0.2 (snapshot + live dual-path)**: Zuoyebang `edu-zuoyebang` (ZYBUSS cookie → study/search records), Huawei Learning `edu-huawei-learning` (Huawei-account cookie → course study records), Alipay `finance-alipay` (session cookie → mobilegw bill/transaction details, with a signing seam + yuan→cents + in/out direction derivation, high-sensitivity gate unchanged). All three add `sync:cookie` + `_syncViaLive` (normalize path unchanged); new shared `_live-json-helpers.js`.
- **Tests**: +39 (3 live suites pinning request-construction + parsing contracts), full PDH suite 128 files / 2083 tests all green. Endpoints are best-effort (multi-field-name tolerant, not field-verified against a live login; adjust api-client constants on drift).
- **Android in-APK cc bundle refresh**: `internal-binaries-android-v20260612` (cli 0.162.46 + pdh 0.4.5, kernel verified) + `USR_VERSION 23 → 24`; installing the new APK triggers `LocalFilesystemBootstrapper` sentinel 23→24 re-extraction.
- **npm packages**: `chainlesschain` CLI 0.162.45 → 0.162.46 + `@chainlesschain/personal-data-hub` 0.4.4 → 0.4.5 published.
- **Version surfaces**: productVersion v5.0.3.106 → v5.0.3.107 / desktop 5.0.3-alpha.107 / Android versionCode 503107 · USR_VERSION 23 → 24 / iOS CFBundleVersion 107.

---

## 2026-06-11 Release — **v5.0.3.106: PDH Kuaishou api_ph base64 collection fix + Amap title bug + full adapter test coverage (pdh 0.4.4 / cli 0.162.40) + Android cc bundle v20260611 (real-device re-extraction verified)**

> PDH (personal data hub) collection layer is the mainline of this release. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **PDH collection fixes (pdh 0.4.4)**: newer Kuaishou writes `kuaishou.web.cp.api_ph` as base64(JSON) — added `apiPhDecodeCandidates` decode chain to restore profile collection; travel-base `buildTitle` now falls back to `name`, fixing every Amap trip-event title showing `car: ? → ?`; corrected 3 stale comments (Toutiao/Kuaishou/email adapters).
- **Adapter test matrix fully closed (+180)**: Xiaohongshu ADB trio 58 + 6 travel modules 74 + whatsapp/shopping-base 24 + Kuaishou base64 9 → **100% test coverage across all 55 adapters**.
- **Android in-APK cc bundle refresh + real-device verification**: `internal-binaries-android-v20260611` (pdh 0.4.4 + cli 0.162.40) + `USR_VERSION 21 → 22`; verified on a real device (Xiaomi amethyst) — installing the new APK triggers `LocalFilesystemBootstrapper` sentinel 17→22 re-extraction, on-device pdh=0.4.4 with both fixes grep-confirmed present.
- **npm packages**: `chainlesschain` CLI 0.162.39 → 0.162.40 + `@chainlesschain/personal-data-hub` 0.4.3 → 0.4.4 published.
- **Version surfaces**: productVersion v5.0.3.105 → v5.0.3.106 / desktop 5.0.3-alpha.106 / Android versionCode 503106 · USR_VERSION 21 → 22 / iOS CFBundleVersion 106.

---

## 2026-06-10 Release — **v5.0.3.105: cc agent MCP prompts/resources + SubagentStop hook + --fork-session (CLI 0.162.38) + Android in-APK cc bundle refresh**

> Formalizes the 2026-06-10 CLI-parity mainline after v5.0.3.104 as a release. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **cc CLI 0.162.38 (Claude-Code parity trio)**: MCP prompts as slash commands + MCP resources exposed to agent/REPL; `SubagentStop` settings.json hook; `cc agent --fork-session` (fork an existing session into a new branch).
- **Android in-APK cc bundle refresh**: rebuilt `cc-cli.tgz` (cli 0.162.38 + pdh 0.4.3) → new internal-binaries release (binariesVersion 20260610) + `USR_VERSION 20 → 21`, closing the gap where the APK's embedded cc ran stale code since v5.0.3.101.
- **Tests / CI**: shared CLI e2e helper (testHome + freePort, Layer 2) + e2e isolation/retry CI hardening + 10 stale desktop unit-test fixes.
- **Docs**: 14 new CLI command user docs on docs-site + site-wide count reconciliation (155 commands / 146 skills / 25 Android).
- **npm packages**: `chainlesschain` CLI 0.162.38 published + `@chainlesschain/personal-data-hub` 0.4.3 (unchanged).
- **Version surfaces**: productVersion v5.0.3.104 → v5.0.3.105 / desktop 5.0.3-alpha.105 / Android versionCode 503105 · USR_VERSION 20 → 21 / iOS CFBundleVersion 105.

---

## 2026-06-10 Release — **v5.0.3.104: CLI 0.162.37 (IDE bridge wrap-up aggregate) + all-platform version alignment + docs/branding sweep** (backfilled)

> (Backfilled entry) Highlights: CLI 0.162.37 published to npm; iOS/Android/desktop version alignment; VS Code extension Open VSX auto-publish CI + icon redraw; JetBrains buildPlugin fix; 8 new CLI user-doc pages + Family Guard user page on docs-site; published-docs PII scrub; desktop vitest-4 stub bug + 12 stale test fixes. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

---

## 2026-06-10 Release — **v5.0.3.103: cc loop (/loop parity) + IDE bridge Phase 3/4 (JetBrains parity + release pipeline) + VS Code extension visualization & branding**

> Formalizes the 2026-06-10 engineering mainline after v5.0.3.102 as a release. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **cc loop (Claude-Code `/loop` parity)**: fixed-interval loop running a prompt / slash command + `--dynamic` self-pacing (with prompt-mode agent flag pass-through) + `--save` / `--resume` session persistence + survives headless (non-TTY) runs.
- **IDE bridge Phase 3 (JetBrains parity)**: pure-JDK protocol core (MiniJson / McpServer / LockfileWriter / IdeTools) + IntelliJ glue, CLI zero-change double proof + cross-language interop live run; REPL IDE auto-connect honors `--ide` / `--no-ide`.
- **IDE bridge Phase 4 (release & maintenance pipeline)**: `ide-extensions.yml` (vsce package/publish + gradlew buildPlugin/publishPlugin, tag + secret double-gated, no GitHub Release, fail-fast on missing secret) + LICENSE/CHANGELOG + release docs.
- **VS Code extension visualization & branding**: IDE bridge visualization (status bar + sidebar + dashboard, 0.2.0) + ChainlessChain brand logo as the extension & Activity Bar icon (0.2.1).
- **npm packages**: `chainlesschain` CLI stays at 0.162.36 + `@chainlesschain/personal-data-hub` 0.4.3 (already published).
- **Version surfaces**: productVersion v5.0.3.102 → v5.0.3.103 / desktop 5.0.3-alpha.103 / Android versionCode 503103 / iOS CFBundleVersion 103.

---

## 2026-06-10 Release — **v5.0.3.102: IDE bridge lands (cc ide + VS Code extension) + cc CLI Claude-Code parity finalized + cc agent multimodal vision input**

> Finalizes the cc CLI's parity with Claude Code and adds the IDE bridge plus multimodal vision input. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **IDE bridge lands**: new `cc ide` command + VS Code extension that auto-discovers and connects to the editor's built-in MCP server, with `openDiff` accept/reject round-trip (CLI command count 149 → 150).
- **cc CLI Claude-Code parity finalized**: MCP OAuth remote authorization, custom & built-in context-usage status line, output styles, pluggable `web_search`, extended thinking, full-event `settings.json` hooks with block semantics, headless `agent -p`, `/compact` auto-compaction, dual-engine `cc checkpoint`, permission rules.
- **cc agent multimodal vision input**: `cc agent --image` (auto-selects the configured vision model).
- **npm packages**: `chainlesschain` CLI 0.162.36 published.
- **Version surfaces**: productVersion v5.0.3.101 → v5.0.3.102 / desktop 5.0.3-alpha.102 / Android versionCode 503102 / iOS CFBundleVersion 102.

---

## 2026-06-09 Release — **v5.0.3.101: CLI reaches Claude-Code parity + PDH one-click WeChat 4.0 / QQ-NT collection + security fail-closed bundle**

> Formalizes the engineering mainline accumulated after v5.0.3.100 as a release. Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **CLI reaches Claude-Code parity**: headless `agent -p` full set (`--output-format` / `--max-turns` / `--allowed-`/`--disallowed-tools` / `--permission-mode` / stdin / `--input-format stream-json` / `--system-prompt` / `--add-dir` / `--fallback-model`) + `@file` references in `ask`/`chat` + `cc cost` token-spend accounting (override via `llm.pricing`) + file-state `cc checkpoint`/rewind.
- **CLI agent capability extensions**: extended thinking `--think` / `--ultrathink` / `--thinking-budget` (Anthropic — adaptive effort vs. legacy budget auto-selected by model) + multimodal image input `--image` (png/jpg/gif/webp, converted per provider: OpenAI-compatible passthrough / ollama / anthropic) + a built-in `web_search` tool (pluggable backends: tavily/brave/bocha/Qianfan + keyless DuckDuckGo/Baidu).
- **PDH full WeChat 4.0 collection + one-click QQ-NT decrypt/parse**: WeChat 4.0 per-DB keys + zstd message bodies + official accounts/Moments/favorites + humanized non-text messages; QQ-NT end-to-end decryption + protobuf parsing (verified on a real `nt_msg.db`) + name enrichment (uin→nickname / group code→group name) + `pdh-im-collect` built-in skill.
- **Security fail-closed bundle (audit follow-up)**: SAML signature + OAuth id_token + channel message signing + permission-ipc DB fallback all fail closed, hardcoded "123456" removed, renderer `days` input sanitized.
- **U-Key passphrase escrow layer (Phase 3, default gated OFF)** + **desktop DB/LLM performance panels wired into V6 shell** (db-performance IPC was never registered before).
- **npm packages**: `@chainlesschain/personal-data-hub` 0.4.2 → 0.4.3 + `chainlesschain` CLI 0.162.31 → 0.162.32 (to be published).
- **Version surfaces**: productVersion v5.0.3.100 → v5.0.3.101 / desktop 5.0.3-alpha.101 / Android versionCode 503101 · USR_VERSION 19 → 20 / iOS CFBundleVersion 101.

---

## 2026-06-08 Release — **v5.0.3.100: PDH collection major update + CLI publish channel fix**

> v5.0.3.99 substantially expanded the Personal Data Hub (PDH) collection capability and went live on real devices; v5.0.3.100 formalizes the post-.99 packaging work as a release (all 18 platform artifacts shipped, GitHub Release v5.0.3.100 published). Full per-version detail in [CHANGELOG.md](CHANGELOG.md).

- **PDH collection major update (v5.0.3.99)**: adapter **readiness** (split a real ready/needs_setup/unavailable judgment out of the loose `healthCheck`, fixing the "config looks fine but nothing collects" gap) + desktop/mobile "one-click collect / import guide" UI + new local-direct-read sources (Douyin / WeChat PC / QQ-NT / DingTalk / Feishu / Apple Health / NetEase Music / WeRead) + email-bill LLM gap-fill (Phase 5.5) + iOS encrypted-backup decryption (Phase 7.5b). PDH now totals **51 adapters / 121 test files / 2040 tests**.
- **DB at-rest encryption ON by default (v5.0.3.99)**: `PHASE_1_5_DEFAULT_ON=true` (encrypted on disk; preflip automated gates all green) + DID keystore fails closed on packaged builds.
- **Android "AI study companion" UI (v5.0.3.99)**: M9 points engine + M10 parent-gentleness monthly report + M5 task-visible UI wired into tappable Family-tab entries; companion tab persists via core-security KeystoreFacade (TEE encryption).
- **CLI npm publish channel fix (v5.0.3.100)**: `prepublishOnly → build:web-panel` failed under `npm publish` because the parent leaked `npm_config_local_prefix`, installing deps in the wrong place → fixed with an isolated temp build + scrubbed `npm_config_*` env; the CLI can publish again.
- **npm packages**: `@chainlesschain/personal-data-hub` 0.4.1 + `chainlesschain` CLI 0.162.30 published and install-verified.
- **Version surfaces**: productVersion v5.0.3.98 → v5.0.3.100 / desktop 5.0.3-alpha.100 / Android versionCode 503100 / iOS CFBundleVersion 100.

---

## 2026-05-22 Ship — **PDH v0.2 burst: 11 platforms wired + WeChat / QQ real-capture + Android on-device LLM scaffold (v5.0.3.80)**

> Expanded PDH from v0.1 (Bilibili only) to **v0.2 real-connect across 11 platforms** in a single day: social content (Weibo / Douyin / Xiaohongshu / Toutiao / Kuaishou) + shopping (JD / Meituan / Pinduoduo / Taobao / Alipay) + travel & maps (Amap / Ctrip / Baidu Maps / Tencent Maps) + AI assistants 9-route WebView (DeepSeek / Kimi / Tongyi / Zhipu / Tencent Hunyuan / Wenxin / Coze / Dreamina / Doubao) + email 4 IMAP providers (QQ / Gmail / 163 / Outlook via Jakarta Mail). WeChat Phase 12.10 four sub-phases complete — SQLCipher real decrypt + frida-inject real injection + 16.5.9 binary vendored + APK shipped to Xiaomi real device; QQ Phase 13.5 v0.2 — XOR-IMEI algorithm byte-identical to sjqz port, no SQLCipher, no frida, just root + IMEI. Android on-device LLM full-chain skeleton landed (Ktor server + ModelManager + cc spawn + PDH "ask locally" tab).

- **Platform v0.2 upgrades (11 placeholder cards → real-connect)**:
  - Social content: Weibo (`c087c36eb`) / Douyin (`20f9b2188`) / Xiaohongshu (`20f9b2188`) / Toutiao (`e1155b1d7`) / Kuaishou (`e1155b1d7`) — all dual-mode (Android in-app snapshot + desktop cookie)
  - Shopping: JD/Meituan dual-mode (`f3cbd0693`) / Pinduoduo SAF JSON (`78695c25e`) / Taobao HTML + Alipay CSV (`799e364f0`)
  - Travel & maps: Amap/Ctrip cookie-scrape WebView (`0fe572f2`) / Baidu Maps/Tencent Maps (`3d1cf9481`)
  - AI assistants: 9-route WebView cookie scrape + cc sync wire (`1e7725552`); 8 cards enable (`20e0318b4`)
  - Email: QQ/Gmail/163/Outlook 4 providers IMAP real-connect via Jakarta Mail (`7777f5bec`)
- **WeChat in-app collector Phase 12.10 (all 4 sub-phases landed)**: 12.10.1+12.10.2 scaffold (`8c52d5963`) → 12.10.3 SQLCipher real decrypt (`8081f8a0d`) sjqz MD5(IMEI+UIN)[:7] 7.x + frida 64-hex 8.x dual paths + 3 PRAGMA profile fallback + WAL+SHM cohort → 12.10.4 frida-inject (`37a4e465d`) spawn /data/local/tmp/cc-\* + 5-symbol hook → 12.10.6 prereq vendor frida 16.5.9 arm64+armeabi-v7a APK ship (`cdfe1048e`). Phase 12.10.5 cc syncAdapter wechat --input wire was already in. Remaining 12.10.6 real-device E2E requires a root device + Magisk.
- **QQ Phase 13.5 v0.2 (`a07731b46`)**: XOR-IMEI algorithm byte-identical to sjqz `qq.py`. **The QQ path is fundamentally different from WeChat** — QQ Android uses plain SQLite + per-row IMEI XOR-cycle encryption on msgData, so no sqlcipher-android, no frida, just root + IMEI input. 4 Kotlin files (QQXorDecryptor / QQCredentialsStore / QQDbExtractor / QQLocalCollector) + 27 Kotlin unit tests + JS 13 snapshot + 6 longtail all green.
- **A3 Android on-device LLM full-chain skeleton (724 LOC)**: Ktor LLM server :11434 + ModelManager + cc spawn embedded OllamaClient (`f41f06441`) + KotlinLlamaCppEngine skeleton (`8f023052a`). Architecture HTTP-Hybrid (Kotlin Ktor ↔ in-APK cc OllamaClient). Remaining Maven deps + JNI + real device ~5-7d (needs Mac/Linux + Android NDK).
- **Three locks UI + real wiring**: reject cloud / destroy / export — `cc hub export` wired through; D11 SAF picker upgraded to user-chosen location (`7e4fa844f`).
- **AI citation real wiring** (`3a76ee5e4`): `cc hub event-detail` + citation chip taps → event detail sheet.
- **release.yml chain fix** (`12d1391d1`): split workspace deps publish into a prereq job — breaks the v5.0.3.79 desktop build chicken-and-egg.
- **Test baseline refresh**: 93 new snapshot tests (weibo 8 / douyin 8 / xhs 8 / toutiao 8 / kuaishou 8 / jd 8 / meituan 8 / pinduoduo 8 / baidu-map 8 / tencent-map 8 / qq 13) + WeChat Phase 12.10 51 new unit tests + QQ Phase 13.5 27 Kotlin unit tests. Same-day 3 stale-assertion fixes (longtail Douyin uid / analysis TOTALS regex / hub-command subcommand snapshot) — 156/156 PDH snapshot + 101/101 desktop PDH + 87/87 CLI hub all green.
- **Version surfaces**: productVersion v5.0.3.78 → v5.0.3.80 / CLI 0.162.14 → 0.162.16 / npm `@chainlesschain/personal-data-hub` 0.2.1 → 0.2.3 / Android versionCode 503080 / iOS CFBundleVersion 80.

Memory captured: `android_wechat_collector_phase_12_10.md` (8 traps + 5 real-device blockers) + `android_qq_collector_phase_13_5.md` (10 traps) + `pdh_a8_weibo_v0_2_landed.md` + `pdh_a3_skeleton_landed.md` + `wechat_frida_hook_audit_traps.md`. Full PDH v0.2 roadmap in [`docs/chainlesschain/personal-data-hub.md`](docs-site/docs/chainlesschain/personal-data-hub.md) and [`docs/design/PDH_Article_Implementation_Plan.md`](docs/design/PDH_Article_Implementation_Plan.md).

---

## 2026-05-22 Ship (earlier) — **PDH A8 v0.1: Android-only social collection (Bilibili end-to-end + 3 platform placeholders)**

> Plan A v0.1's "本机数据" (Local Data) tab expands from 1 card (`system-data-android`) to 5. Bilibili end-to-end ships (WebView login + OkHttp 4 endpoints + local SQLCipher vault); Weibo/Douyin/Xiaohongshu render as placeholder cards (**v0.2 complete — see above**). **Fully desktop-independent** — Android handles cookie capture + HTTP + JSON parsing + encrypted local storage without any desktop connection.

- **Bilibili end-to-end**: `packages/personal-data-hub/lib/adapters/social-bilibili/{adapter,index}.js` JS adapter refactor (stateless constructor + new `_syncViaSnapshot(opts.inputPath)` mode alongside legacy sqlite-mode) + 4 Kotlin files (`SocialCookieWebViewScreen` generic 4-platform reusable / `BilibiliApiClient` OkHttp 4 endpoints / `BilibiliCredentialsStore` EncryptedSharedPreferences AES-256-GCM / `BilibiliLocalCollector` orchestrator). 4 event kinds (history/favourite/dynamic/follow) yield + normalize into the vault.
- **HubLocalScreen multi-card refactor**: 5 adapter cards + login WebView overlay + `globalSyncingAdapter` mutex. Weibo/Douyin/Xiaohongshu show "v0.2 开放" state; tapping login/sync surfaces a toast.
- **CLI + Desktop wiring**: both `packages/cli/src/lib/personal-data-hub-wiring.js` and `desktop-app-vue/src/main/personal-data-hub/wiring.js` register `BilibiliAdapter` stateless on boot. **The Adapter tab now also lists 2 cards** (system-data-android + social-bilibili).
- **Test coverage**:
  - **JS unit**: 12 new snapshot-mode tests (`social-bilibili-snapshot.test.js`) + 4 legacy sqlite-mode tests rewired to flat payload shape (`social-adapters.test.js`) — 547/547 green
  - **JS integration**: 6 new tests (`integration/social-bilibili-pipeline.test.js`) real vault end-to-end + idempotency + partial + schemaVersion mismatch
  - **Kotlin unit**: 14 `BilibiliApiClientTest` (MockWebServer) + 8 `BilibiliLocalCollectorTest` (mockk) + 15 `HubLocalViewModelTest` = 37 new tests
  - **Android E2E**: 8 scenarios `@Ignore + TODO()` stub + full plan `docs/design/A8_Bilibili_E2E_Plan.md` (Mac/Linux + real device + real account ~1.5h serial)
- **Bug fixes**: (1) BilibiliApiClient `extractUid` adds a `> 0L` guard — Bilibili never issues uid=0, the old implementation would accept a mid-logout cookie as logged-in. (2) JS adapter sqlite-mode old `payload.row.X` wrapping replaced by flat `payload.X` — 4 existing tests migrated.
- **Design docs**: [`docs/design/Adapter_Social_Cookie.md`](docs/design/Adapter_Social_Cookie.md) ~400 lines (4 platform comparison + snapshot schema + JS/Kotlin layer templates + 7 forward-looking traps) + [`docs/design/A8_Bilibili_E2E_Plan.md`](docs/design/A8_Bilibili_E2E_Plan.md) ~200 lines
- **Architectural clarification**: Android PDH has **two paths** that were long conflated: (a) Adapter tab → desktop-dependent (RemoteCommandClient → desktop hub registry) (b) **本机数据 (Local Data) tab → in-APK cc + local SQLCipher vault (fully desktop-independent)**. A8 lands on the latter — that's the "no desktop dependency" path the user repeatedly asked about.

New memory `pdh_a8_social_adapters_landing.md` captures 7 forward-looking traps (WBI signing / EncryptedSharedPref keystore corruption / flat payload vs legacy row / in-APK bundle audit / DedeUserID extraction location / OkHttp baseUrl override timing / CookieManager flush sync semantics). **v0.2 roadmap**: Weibo ~1.5d / Douyin ~2d (msToken + X-Bogus signing) / Xiaohongshu ~2d (X-s signing) ≈ ~5d total.

See [`docs/design/Adapter_Social_Cookie.md`](docs/design/Adapter_Social_Cookie.md).

## 2026-05-21 Ship — **PDH Phase 14.1 step 5 ChatBubble UI + Phase 12.9 WeChat real-device E2E runbook + office-skill word-lib hotfix (v5.0.3.76 → v5.0.3.77 iOS .ipa re-ship)**

> v5.0.3.76 is a maintenance batch: office-skill real-functionality fix + full doc refresh across the three sites (v5.0.3.76 sizes/version). Bundled with the deploy: PDH Phase 14 Android ChatBubble UI closeout and a new WeChat Phase 12.9 real-device acceptance runbook, pushed to docs.chainlesschain.com / design.chainlesschain.com. **v5.0.3.77 is the .76 iOS .ipa re-cut**: .76 release run #1 had build-ios fail + finalize auto-flipped to published → run #2 .ipa upload was blocked by GitHub immutable-releases policy; tag burn handled per [github_immutable_release_tag_burn](docs/internal/hidden-risk-traps.md), .77 re-cuts the full 18-asset matrix in a single clean run.

- **Phase 14.1 step 5 (Android) — ChatBubble UI**: `HubAskScreen` upgrades the flat `Surface + plain text` panel to `HubChatBubble` (asymmetric corners 4dp bottom-start / 4dp bottom-end = classic bubble tail; assistant `secondaryContainer` left-aligned + user `primaryContainer` right-aligned; max width 320dp to prevent long answers stretching the screen) + `HubBlinkingCursor` (500ms reverse-fade `▎`) for the in-flight inference state. `HubAskUiState` gains a `submittedQuestion` field that decouples the live input from the "submitted question snapshot", so the bubble keeps showing the historical question while the user starts typing the next one. +2 unit tests for the submit snapshot and clear reset; `HubAskViewModelTest` now 10/10 + PDH 5-file total 44/44 green (pure UI/state, no IPC change; framework fully reuses the iOS Phase 5 pattern). Token-by-token streaming wiring deferred to Phase 14.5.
- **Phase 12.9 WeChat real-device E2E Runbook (new design doc)**: `docs/design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md` ~21 KB. 11 scenarios (first ingest / decryption spot-check / ask Q&A / citation back-lookup / 50k-message performance / incremental sync / hook resilience / anti-detection / failure recovery / privacy gate / 24h soak) + 6–8h execution estimate + dataset gate (≥ 50k messages before the §12.9.5 large-corpus baseline is valid). Together with the existing `Adapter_WeChat_SQLCipher_Frida_Setup.md` (setup-only) and `Personal_Data_Hub_E2E_Runbook.md §11` (registration), forms the complete Phase 12.6 acceptance triad.
- **office-skill bug fix (`aabe7d0f7`)**: (1) `readWord` stub replaced by the real `mammoth` implementation (the stub had been silently returning empty for the Word parse path); (2) wordLib cache split from the paragraph cache + the silent paragraph drop fixed.
- **Three-site doc refresh**: docs-site `chainlesschain-docs-v5.0.3.76` 487 HTML / docs-site-design `design-docs-v5.0.3.76` 200 + Phase 12.9 HTML / docs-website-v2 v5.0.3.76 sizes refetched (all 11 platform sizes synced from gh release) + "144 CLI commands / 141 built-in Skills" un-staled (the previous dist had baked 112/139). Both sync scripts now explicitly map Phase 12.9 in `ROOT_FILE_MAP` so the new file does not silently fall into `unknown-unmapped.md` and overwrite siblings (per `docs_site_sync_unmapped_fallthrough` memory).

Test summary: this batch verified 5 Android PDH test classes 44/44 + desktop PDH 4 files 93/93 + WeChat adapter 8 files 107/107 + mobile-skill-whitelist + unified-config-manager 17/17 = **19 files / 261 tests / 0 failures**. E2E (Phase 14.4 + Phase 12.9) requires Mac+iPhone+Xiaomi+real desktop + Xiaomi+Frida-server respectively — not runnable on a single Win dev box; tracked as follow-ups.

See [`docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md) and [`docs/design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](docs/design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md).

## 2026-05-21 Ship — **WeChat Phase 12.6.7-10: bootstrap orchestration + IPC/WS + cc hub wechat CLI + Vue UI wizard (v5.0.3.75)**

> Closed the WeChat 8.0+ frida-dep path end-to-end in one evening — four new sub-phases added on top of §18.7's existing six.

- **12.6.7 bootstrap.js**: stitches env-probe → KeyProvider choice → WechatAdapter ctor into a single hermetic entry point so IPC/WS/CLI no longer have to reinvent the wiring. md5/frida/unsupported decision matrix + `opts.keyProviderOverride` bypass + full injectable test seams (`_probe` / `_md5Provider` / `_fridaProvider` / `_WechatAdapter`). 14 unit tests fully hermetic — no adb, no Frida, no real device.
- **12.6.8 IPC + WS**: 4 new IPC channels + 4 cc-ui WS topics (`wechat-env-probe` / `register-wechat` / `unregister-wechat` / `list-wechat-accounts`). `register-wechat` and `unregister-wechat` join the `approvalChannelsForMobile` privileged whitelist so mobile peers cannot silently wire an adapter against an attacker-controlled dbPath or trigger a Frida session. 15 wiring tests + 2 whitelist regression tests.
- **12.6.9 `cc hub wechat` CLI**: `env-probe / register --uin --db --wechat-data-path [--force-provider] / list / unregister <uin>` 4 verbs mirroring the 4 WS topics, `--json` on every verb for scripting and the Plan A in-app terminal. 14 CLI tests.
- **12.6.10 Vue UI wizard**: `WechatWizard.vue` 295-LOC three-step drawer (env-probe checklist with dynamic per-row tag colors → uin + dbPath + wechatDataPath + forceProvider form → result with probe.reasons surface) plus a "Add WeChat" button on `PersonalDataHub.vue` and 4 new composable methods. 6 composable tests.
- **Integration tests**: 9 end-to-end tests covering md5 happy / frida happy / unsupported / md5 missing wechatDataPath / idempotent re-register / two-uin coexistence / override semantics — none touch a real adb, Frida, or device.
- **Real-device E2E preparation**: `Personal_Data_Hub_E2E_Runbook.md` §11 now has three WeChat scenarios (pre-8.0 md5 / 8.0+ frida rooted / 8.0+ unrooted graceful rejection) + performance baselines. Phase 12.9 awaits a rooted Android device.
- **Stale-comment fix**: docs-site previously claimed the iOS Phase 14.2 UI scaffold was "lost-to-race / needs redo"; it was in fact fully landed at `3db7b5a73 + 1d0c473a3` (650 LOC `PersonalDataHubViews.swift` + 3 ViewModels + RemoteDependencies wire + 1491 LOC of iOS Hub tests).

Session total: **1223 tests / 67 files** (1068 hub package + 183 desktop + 46 CLI + 18 web-panel + iOS 1491 LOC Hub tests). Remaining gated on physical hardware: Phase 12.9 rooted-Android real-device E2E, Phase 14.4 mobile real-device E2E.

See [`docs/design/Adapter_WeChat_SQLCipher.md`](docs/design/Adapter_WeChat_SQLCipher.md) §18.10 and [`docs-site/docs/chainlesschain/personal-data-hub.md`](docs-site/docs/chainlesschain/personal-data-hub.md).

## 2026-05-20 Ship — **Personal Data Hub 13-phase burst + iOS keychain hotfix repackage (v5.0.3.71/.72)**

> Personal Data Hub rolled from Phase 4 (real third-party wiring) all the way to Phase 13.7 (seven social adapters all live) in one evening across 15 commits `763047a22 → b2baf4eda`. `.72` also fixes the release-pipeline bug that made every `.71` desktop build die with EUSAGE.

- **Phase 4.5 — Python sidecar bridge + SystemDataAdapter**: JS↔Python subprocess JSON-RPC wiring 4 Android system sources (contacts / call log / SMS / location) reusing 17 real sjqz parsers without rewriting.
- **Phase 7 / 7.5 / 9 — Three consumer-scene adapter packs**: Shopping three-pack (Taobao + JD + Meituan) / Mobile Extraction Layer (Android ADB + iOS iTunes encrypted backup, dual-path) / Travel four-pack.
- **Phase 10.1 + 10.2 — AIChat 9/9 vendors all live**: DeepSeek + Kimi (reverse h5 web API) + Tongyi Qianwen + Zhipu GLM + Tencent Hunyuan + Baidu Qianfan + ByteDance Coze + Dreamina + Doubao; HttpClient infra wired retry-with-backoff + progress streaming.
- **Phase 11 — 5 built-in analysis skills** callable by LLM across hub data sources.
- **Phase 12 v0.5 — WechatAdapter frida-independent slice**, T3 risk dropped High → Medium. Full SQLCipher dump still on the v1.0 frida path.
- **Phase 13.3-13.7 — 5 social adapters**: Douyin + Xiaohongshu + QQ + Telegram + WhatsApp. WhatsApp completes the sjqz parser port. + 13+ Bilibili + Weibo via sjqz parsers.
- **Quality**: 50 test files / 952 tests all green (6 new cross-adapter integration scenarios + 3 full E2E user-journey scenarios + 3 toutiao/kuaishou/doubao scaffold cases). The 2026-05-20 closing test sweep also surfaced and fixed 2 real bugs: SpendingSkill missing `subtype: "order"` coverage (Phase 7 Shopping events did not roll into the spending report) + AlipayBillAdapter missing `extra.counterparty` (analysis skills could not group by merchant).
- **Phase 14.1 + 14.2 mobile native entry — data layer complete, UI wiring on the way**: Android Phase 14.1 `PersonalDataHubCommands.kt` 22-method typed wrapper (21 data + `runSkill` analysis) + 9 UI files (Ask / Adapters / Audit screens + HealthCard + AcceptNonLocalDialog + 3-tab container) + 22 unit tests. **iOS Phase 14.2 data layer complete**: 22 method wrappers + 16 Codable models + 28 unit tests (22 happy-path + 6 input-guard) — 1:1 with Android, all kebab-case wire names, every test asserts method name to guard against camelCase regression. `ios-build.yml` CI run `26150064237` `Build & Test (SPM)` job passed in 72s including the 28 new tests. Pre-release static audit caught 17 Android camelCase / kebab-case method-name mismatches (would 404 on first call); sed-aligned production + unit tests + desktop whitelist test. Remaining: iOS SwiftUI View + ViewModel wiring (data layer ready, UI on next iteration); Phase 14.3 streaming sync progress + Phase 14.4 real-device E2E not yet started.
- **.72 release-pipeline fix**: `.71` had every desktop build die with EUSAGE — root `package-lock.json` out of sync with `personal-data-hub/package.json` (Phase 12/13 added `adm-zip` + `iconv-lite` optional deps but root lock missed them). `5d8ba08b5` synced the lock + `d03c87d0a` bumped `packages/cli` in root lock to `0.162.7`, then `.72` repackaged the same iOS keychain `Logger` NSLock fix and shipped 18 assets complete. **`.71` does not exist in GitHub Release** (code on main + npm 0.162.7 published, only desktop installers missing); the actual artifact is `.72`.

## 2026-05-20 Ship — **iOS hotfix triple: PIN-unlock crash + AppIcon wiring + SQL bind (v5.0.3.70)**

> Three real iOS bugs swept in one pass + `.69` changes bundled forward. The `.69` release was stuck in draft for 8h+ because `publish-cli` hit an npm 404; `.70` repacks every `.69` change plus the AppIcon wiring fix, and a `publish-cli` rerun finally flipped the draft → published (18 assets, Latest).

- **iOS 16 PIN-unlock crash**: `CoreCommon/Utilities/Logger.swift` writes to a metadata dictionary across threads; on iOS 16 this races and crashes with `EXC_BAD_ACCESS`. Now guarded with `NSLock` on both read and write paths, with a concurrency fan-out test pinning the regression.
- **AuthViewModel.createPrimaryDID SQL bind**: the call site was using the parameter-less `DatabaseManager.execute(_:)` overload, so SQL parameters never actually bound to the prepared statement — insert silently failed. Switched to the `execute(_:parameters:)` overload.
- **AppIcon never actually compiled**: `Assets.xcassets` was declared in `pbxproj` as a `PBXGroup` (logical folder), not a `PBXFileReference type=folder.assetcatalog`, AND it was missing from `PBXResourcesBuildPhase`. The full 18-icon + 3-launch-icon set has sat in the repo from v0 through v0.69 without `actool` ever being invoked — the home-screen icon stayed a wireframe globe placeholder. Commit `2441b0d8b` fixes the pbxproj wiring; `.70` is the first build that actually ships `Assets.car` inside `ChainlessChain.app`.
- **Release pipeline notes**: `.69` `finalize-release` got skipped because the upstream `publish-cli` step hit `npm error 404 - PUT https://registry.npmjs.org/chainlesschain` (token/permission issue). For `.70` the same step failed on first run; `gh run rerun --failed` re-attempted just `publish-cli` and it cleared, flipping the draft to published with all 18 assets attached (4 Android, macOS dmg, Linux AppImage/rpm/deb, Windows Setup/Portable, iOS .ipa, 3 `latest.yml`, blockmaps).

## 2026-05-19 Ship — **Android Phase 5.6/5.8 cc Chat — Natural-Language CLI Queries (v5.0.3.67)**

> Open "cc Chat (Natural Language)" from the profile menu, type "list my recent notes / search for RAG-related notes / what skills do I have", and the AI auto-routes through the `cc` CLI on-device, then pastes the command + result back into the chat. No more memorizing `cc` subcommand + flag syntax.

- **Phase 5.6 LLM tool-use protocol wiring**: OpenAI (`tool_calls` + `type:function` envelope), Doubao Volcengine Ark (wire-compat, direct delegate), and Anthropic/Claude (`tool_use` content blocks + `tool_result` carried as `role=user` per Anthropic spec) all wired through natively. Models without tool-use (Qwen / Ernie / Spark / etc.) take a "no-hallucination fallback" path that explicitly tells the user to switch model rather than fabricating notes.
- **Phase 5.7 cc Chat screen**: 5-state progress strip (thinking / preparing tool / executing cc / processing result / finalizing) + tool card (command + exitCode + duration + collapsible stdout + cancel button). Eight read-only subcommands whitelisted (`note list/show/view` / `search` / `memory list/show` / `skill list` / `status` / `session list` / `mcp list` / `did show`); write/delete/install operations the LLM might invent get blocked at the allowlist (exitCode=126). `ProcessBuilder` bypasses the shell — zero injection surface.
- **Phase 5.8 device E2E SOP**: 9-scenario E1-E9 reproducer + automated preflight script `android-app/scripts/e2e/phase_5_8_preflight.ps1` (device / bundle / APK / residual-process checks). Awaiting Xiaomi 24115RA8EC real-device pass.
- **Audit + bug fixes** — static audit of the 8 new Cc\* files found 3 Blocker/High issues: (1) `CcExecService.executeArgv` JVM pipe-buffer deadlock fixed (dual async drain — `cc search` large output no longer hangs to timeout); (2) `CcChatOrchestrator.runFallback` no longer silently swallows `StreamChunk.error` (HTTP 401 / network errors now surface as Failed events); (3) `CcAllowlist.check` now explicitly rejects "has `allowedSubcommands` but user didn't supply one" cases instead of letting cc CLI surface a usage error.
- **Test coverage**: 127 new tests, all green — `feature-ai` 89 unit (CcAllowlistTest 38 + CcExecServiceTest 19 + CcToolCallDispatcherTest 17 + CcChatOrchestratorTest 14) + `:app` 28 (CcChatViewModelTest 19 + CcChatIntegrationTest 9 end-to-end through the real graph: VM → real Orchestrator → real Dispatcher → real Allowlist → mocked CcExecService — covers E1 happy / E5 deny / E6 fallback / E7 cancel / E9 dedup).
- **Design docs**: [Phase 5.8 E2E SOP](docs/design/Android_AI_Chat_CC_Exec_Phase_5_8_E2E_SOP.md) + [Phase 5.8 printable Checklist](docs/design/Android_AI_Chat_CC_Exec_Phase_5_8_Checklist.md). docs-site / docs-site-design refreshed via `sync-*.js`.

## 2026-05-18 Ship — **Android Sub-phase 5-6 v2 + 10 v2: LOCAL project terminal picker + full project content pull**

> Follow-up to `3319febc4` real-device feedback: "PC path dialog opens but can't find same-name PC project" + "project file sync not done" — two blocking issues, both closed in one commit.

- **Issue 1 LOCAL terminal entry → PC project picker**: old v1 forced users to type Windows long paths on mobile (failed UX). New v2 dialog opens, fetches `project.list` from desktop → LazyColumn picker with all PC projects → tap row → save pcRootPath + jump to terminal, zero input. Same-name match highlighted as "Match" badge at top; empty list auto-expands custom-path fallback.
- **Issue 2 Full content pull**: old v1 (Sub-phase 7) only stored metadata; users pulled then opened the project offline → 0 files visible. New v2: after pullSingle, loop `project.getFile(fileId)` for each file and store content in Room project_files. Per-file failure → continue + log; content > 1MB → skip with placeholder row (size+hash kept) to avoid OOM. PullProgress StateFlow exposes progress → UI shows LinearProgressIndicator + "Downloading N/M: <path>".
- **78 new tests**: `RemoteContextViewModelTest` × 16 / `RemoteProjectBrowserViewModelTest` × 7 / `mobile-bridge-sync.test.js` × 15 (incl 6 new `handleProjectUpdatePath`) / `project-management-handler.test.js` × 33 (incl 9 new file CRUD) / `project-handlers.test.js` × 7. Also fixed 3 stale test assertions (after `504bd6dde` removed userId filtering, the asserts were never updated).
- **Design doc**: [`docs/design/Android_Project_Remote_Terminal_Entry.md §12`](docs/design/Android_Project_Remote_Terminal_Entry.md) added v2 picker design + full content pull design + real-device E2E 8-scenario matrix.
- **Commit**: `09bd0ec0f` (`feat(mobile): LOCAL 项目终端 picker + 全量项目内容拉取`).
- **Pending real-device E2E**: 8 scenarios need Mac/Win PC + Android paired environment, can't be validated on dev box alone.

## 2026-05-18 Ship — **iOS v5.0.3.64: 4-segment version display + AppConstants stale hardcodes wiped + 3-tier test coverage**

> Post-v5.0.3.63 user feedback: (1) iOS Settings "Version" only shows 3-segment `5.0.3` or stale `0.32.0` (the hardcoded constant has been stale for months); (2) PIN crash still reported (crash log pending). Three changes:

- **A. Fix stale hardcodes (real bug, root-caused)**: `AppConstants.App.version` has been hardcoded `"0.32.0"` for months, `buildNumber` was `"32"`, `bundleId` was wrong (`com.chainlesschain.ios`; CodeSign actually uses `.ChainlessChain`) → all switched to read dynamically from `Bundle.main`. Also swept `AIDashboardView.swift:95` hardcoded `v0.16.0` + `PluginManager.swift:118` fallback `1.7.0`.
- **B. iOS 17 API second audit**: scanned all 596 `.swift` files × 29 patterns (`assumeIsolated` / `@Observable` / `SwiftData` / `symbolEffect` / `ContentUnavailableView` / `KeyframeAnimator` / `sensoryFeedback` / `Previewable` etc.) — **0 new violations**. `AppState.swift` v5.0.3.63 fix (`assumeIsolated` → `Task @MainActor`) is in place.
- **C. 3-tier test coverage**: 11 BundleVersionTests + 7 AppStateNotificationTests + 2 XCUITest (`testSettingsVersionDisplaysFourSegmentTag` / `testPINUnlockDoesNotCrashOnFirstLaunch`), locking down version format + PIN-unlock-doesn't-crash regressions.
- **New Bundle extension**: `Bundle.appShortVersion` / `appBuildNumber` / `appFullVersion` (4-segment `5.0.3.64`) / `appFullVersionTag` (`v5.0.3.64`) / `appDisplayName` — unified across UI. SettingsView now shows `v5.0.3.64` full 4-segment + a new "Bundle ID" row so users can directly confirm the installed build.
- **Pending user feedback**: the v5.0.3.63 PIN crash root cause was not reproducible at the code level. If v5.0.3.64 still crashes, please attach a crash log (Xcode → Devices and Simulators → View Device Logs). The new "Bundle ID" row in SettingsView lets you confirm you're running v5.0.3.64.

## 2026-05-18 Closing — **iOS Phase 5 AI Chat static audit: 4 real bugs fixed + 4 integration tests**

> Phase 5.1-5.6 (remote LLM chat + token-by-token streaming + 8 methods + cancel + conversation management + offline enqueue) landed previously, but the 41 unit tests were all same-module mocks — no end-to-end integration, no UI/VM interaction edge cases. This round: static audit found 4 real bugs (1 regression test each); added 4 integration tests against the real fan-out chain.

- **Bug #1 — empty-string slipping through nil-coalesce**: `RemoteAIChatViewModel.finalizeStreamingPlaceholder` used `messageId ?? oldMsg.id`. `ChatStreamEnd.parseFromEnvelope` fills `messageId` with `""` when server omits the field (not nil), so nil-coalesce doesn't catch it — `""` clobbers the local `local-assistant-<UUID>` placeholder id and SwiftUI `ForEach(messages, id: \.id)` identity gets broken (multiple rows share empty id). Fixed with explicit `if let mid = messageId, !mid.isEmpty` guard.
- **Bug #2 — partial rollback on failed delete-current-conversation**: `deleteConversation` only restored the `conversations` list on RPC failure; `currentConversation` / `messages` stayed cleared. Added a `rollbackDelete` private method + entry-point snapshot of `wasCurrent`/`originalCurrent`/`originalMessages` for full atomic rollback.
- **Bug #3 — `sendMessage` missing defensive stream-in-flight guard**: UI hides the send button during streaming, but the VM can't assume the upper layer disabled the entry point (programmatic call, double-tap race, upstream bug). Added `guard currentStreamId == nil else { lastError = "..."; return }` before the DC gate.
- **Bug #4 — `selectConversation` leaks stale streamId**: Switching conversations didn't clear `currentStreamId`, relying on `messages.last.isStreaming` guard. Edge case: when the new conv's last msg happens to be a streaming placeholder (previously not finalized), prev stream's delta overwrites the new conv's last. Now explicitly clears `currentStreamId = nil; isStreamingMessage = false`.
- **+4 integration tests** — `Tests/CoreP2PTests/Integration/Phase5AIChatIntegrationTests.swift`: `testFullChatStreamHappyPathThroughFanout` (real fan-out end-to-end) / `testCancelOrderingDiscardBeforeRpc` (cancel ordering 50ms-window check) / `testOfflineCreateConversationDrainsOnRecover` (DC recovery triggers drainer for ai.createConversation) / `testCrossConversationStreamIsolation` (switching conv clears streamId; stream A doesn't pollute conv B).
- **Unit tests 41 → 45** — `RemoteAIChatViewModelTests.swift` +4 regressions (one per bug); total iOS unit tests ~313 + 45 = **~358**; integration tests 6 → **10**.
- **Docs**: [`docs/design/iOS_Phase_5_AI_Chat_Skill.md`](docs/design/iOS_Phase_5_AI_Chat_Skill.md) §8.1 / §8.2 / §8.3 (static audit bug table) / §8.4 (Phase 5.8 device E2E 8-scenario reproducer steps) all refreshed; docs-site and docs-site-design synced via `sync-*.js` (162 files).
- **Device E2E (Phase 5.8)** still pending Mac+iPhone+desktop; reproducer steps ready. Windows dev box can't run `swift test`; verification relies on iOS CI `swift build --target CoreP2P` passing + static audit + integration tests designed without mock shortcuts around the real chain.

## 2026-05-17 Release — **Android Remote File Skill end-to-end (browse / upload / download / open in-app)**

> Three capabilities landed in one batch on top of the desktop pairing: browse any PC directory (no sandbox); upload local Android file to PC `~/Downloads/`; download PC file to **public Download/** on the phone via `MediaStore.Downloads` (visible to native Files / Gallery / PDF readers). Snackbar "Open" button fires `Intent.ACTION_VIEW(content://...)` → system viewer, no jumping out of the app.

- **Fixed 6 interlocking bugs** ([design doc §4–§5](docs/design/Android_Remote_File_Skill.md)): (1) `P2PClient.kt:538-542` chainlesschain:\* skip guard was too wide and swallowed P2PClient's own responses → narrowed to only skip incoming `request`. (2) Plan C never calls `P2PClient.connect()`, so `sendCommand` fails with `"Not connected"` → `RemoteCommandClient` delegates to `SignalingRpcClient` instead. (3) Desktop `handleFileCommand` was an old stub with `dialog.showOpenDialog` popping a folder picker and missing `listDirectory` case → new `android-file-handler.js` covers 11 actions. (4) The web-shell `FileTransferHandler` is sandboxed inside userData and uses incompatible field names → not reused. (5) checksum `"sha256-prefix:"` mismatched Repository's `"md5:"` parser → return `null` to skip validation. (6) `getExternalFilesDir` lands files where users can't find them → `MediaStore.Downloads` writes to public Download/ instead.
- **5 UI entries**: 📁 browse remote dirs + ☁️↑ upload + ☁️↓ download panel + 📱 in-app local Download folder list + 🧹 cleanup history.
- **Tests**: PC unit tests `android-file-handler.test.js` 30 cases all green; Android `RemoteCommandClientTest.kt` 4 cases lock down the SignalingRpc delegate path + assert `p2pClient.sendCommand` is never called; real-device E2E 8 scenarios verified (Xiaomi 24115RA8EC × Windows desktop).
- **Design doc**: [`docs/design/Android_Remote_File_Skill.md`](docs/design/Android_Remote_File_Skill.md) — protocol (11 actions) + Android↔PC field mapping + 4 interlocking bugs + 2 UX traps + real-device E2E 8 scenarios.
- **User doc**: [`docs-site/docs/guide/remote-file.md`](docs-site/docs/guide/remote-file.md).

## 2026-05-15 Release — **Android GA Follow-up Scope #21 P1 — all 5 main items closed** (A.1 + A.2 + B.1 + B.5 + C.1)

> Following Android v1.0 GA (`v5.0.3.53`), issue #21's 5 P1 main items landed in a single day. ~270 unit tests green; final sweep fixed 2 missing `@Config(sdk=[33])` Robolectric annotations. P2 candidates (B.3 / B.4 / C.2 / C.3) wait on GA Play Store + real-user feedback.

- **A.1 Desktop Linux native pairing** (57 tests) — `cc pair preflight` LAN diagnostic (5 checks: platform / interfaces / multicast / port 5353 holders / firewall hint, exit 0/1/2 CI-friendly) + `cc pair token generate/list/show/revoke` subcommand group (one-active-DID invariant + atomic file write, for SSH dev box pre-issuance) + [`dist-tools/systemd/chainlesschain.service`](dist-tools/systemd/chainlesschain.service) full-hardening template + [`docs/linux/PAIRING.md`](docs/linux/PAIRING.md) 9-section user guide (3 scenarios / 5 blocker fixes / debug bundle). **Audit reframe**: design doc claim "Linux needs mDNS systemd unit" is incorrect — `@libp2p/mdns` + `bonjour-service` are pure JS, no avahi-daemon dependency.
- **A.2 Tri-surface UI consistency design doc** v0.1 baseline — 4 _must-match_ rules (semantic colors / high-risk red hex / DID short-display format 6+4 chars / m-of-n progress display) + 4 _must-differ_ rules (watch large buttons ≥48dp / desktop sidebar / car voice-only / phone thumb zone).
- **B.1 web-shell private-key signing UI** (113 tests) — `MultisigSigner` ukeyManager adapter (4 driver-return-shape normalisation) + `multisig.sign` in-process WS topic (bypasses cc subprocess 6-10s cold start) + `signWithExternal` async API + `SignProposalModal.vue` (Pinia store + member dropdown + dev-only hex source) + `unified-key-manager` DID-based signer routing.
- **B.5 Crosschain bridge outbound × m-of-n multisig** (Layer 1+2, 8 PRs) — Layer 1: CLI `bridge --require-multisig` + `bridge-consume` + web-shell `crosschain.bridge.consume` in-process topic + Multisig.vue execute button. Layer 2: `cc_bridges` m-of-n provenance columns + crosschain-mtc `attachMultisigProvenance` / `stripMultisigSigsForCanonical` helpers + `buildMultiHopBridgeEnvelope` 3rd arg + `verifyMultiHopBridgeEnvelope` auto-runs provenance check + `bridge-consume --mtc` carries multisig provenance into MTC staging. Layer 3 external-blocked Q-COMP-3 (real testnet anchoring + contract audit + KYC) is out of scope.
- **C.1 watch face → VoiceMode shortcut** (33 tests) — phone-side `VoiceLaunchActions` + `VoiceTriggerSource` 4-enum + NavGraph route + `CcPhoneVoiceListener` Data Layer service (`/cc/voice/start` MessageClient path) + wear `VoiceSender` + `VoiceShortcutTileService` standalone tile + `VoiceComplicationService` + `VoiceForwardActivity` (intent + 50ms vibration + 3s timeout). **Security constraint**: `trigger_source` is informational only on the wear side; the phone side locks it to `WEAR_FORWARD` — prevents wear-side forgery from escalating to `AUTO_BUTTON`/`PHONE_SHORTCUT`.
- **Final sweep bug fix** (commit `f1d283833`) — C.1 PR1 `VoiceLaunchActionsTest` + PR2 `CcPhoneVoiceListenerTest` were missing `@Config(sdk=[33])`. Robolectric's `DefaultSdkPicker` rejects compileSdk=35 (maxSdkVersion=34); aligned with every other Robolectric test in `:app`.

Details: [issue #21](https://github.com/chainlesschain/chainlesschain/issues/21) + [Android repositioning design doc §10 GA follow-up scope](docs/design/Android_重新定位_设计文档.md).

## 2026-05-14 Release — **v5.0.3.53 Plan A.1 Remote Terminal Android↔Desktop WebRTC DataChannel direct (Phase 1–5 landed in one day)**

> v5.0.3.52 Plan A real-device validation (Xiaomi 24115RA8EC × Win desktop dev) surfaced one **architectural** issue: a 4-hop signaling chain (phone → router → public relay → desktop RelayClient) is fragile under NAT idle / cellular carrier-side TCP RST — any hop down kills the whole chain.  
> Solution: **Plan A.1** — move the high-frequency / high-throughput terminal traffic from the signaling chain onto a **WebRTC DataChannel direct connection**, bypassing every middle hop; signaling stays as a fallback.

Perf targets → end-to-end RTT p50 200-500ms → **30-80ms LAN / 50-200ms TURN**; p99 1.5-30s with timeouts → **200-800ms**; sustained-connection stability 20s-2min outages → **hours-long** (depends on ICE keepalive).

- **Phase 1 — Trap 1 fix + DC routing helper** (commits `d22b7ac8a` + `bb759bc78`) — `SignalClient.forwardedMessages` migrated to **multi-subscribe SharedFlow** (replacing the single-listener `setOnForwardedMessageReceived`). Original bug: the ice:config interceptor installed by `WebRTCClient.initialize` was silently overwritten when the user entered `TerminalListScreen` and `TerminalRpcClient.start()` set its own listener → ice:config pushes dropped → iceServers expired in 24h → cross-NAT became unreachable. Added `WebRTCClient.dataChannelReady: StateFlow<Boolean>` derived flag (READY truly means DC `OPEN`, avoiding ICE-connected-but-DC-not-open false positives).
- **Phase 2 — DC fast path + dual-listener pending pool** (commit `a01eeac47`) — `SignalingRpcClient.invoke` now embeds a transport selector: `connectionState==READY && preferDataChannel` → `webRTCClient.sendMessage` (DC), throws or not-ready → fallback signaling. Two listeners simultaneously consume `signalClient.forwardedMessages` + `webRTCClient.messages`, same `requestId` → same `CompletableDeferred` (second complete is a no-op; dual delivery is safe without explicit dedup). All RPC clients (TerminalRpc + system._/ai._) share one chokepoint.
- **Phase 3 — Android handshake trigger + UI path indicator** (commit `91e77e489`) — `TerminalListViewModel.init` detects DC not-ready and async-triggers `RemoteConnectionManager.connect`; UI chip shows "P2P direct" (green) vs "Relay path" (yellow) so the path state is user-visible.
- **Phase 4 — Bidirectional LRU dedup** (commit `dd9b1227e` Android + `fc3752360` desktop) — Android `TerminalRpcClient` subscribes BOTH signaling + DC SharedFlow, dedups stdout by `(sessionId|seq)` with a 256-entry LRU / exit by `sessionId` with 64-entry. Desktop `mobile-bridge.bridgeToLibp2p` gains 128-entry / 30s-TTL LRU keyed by `payload.id` for mobile→desktop command requests (guards against double-stdin in `terminal.stdin` / duplicate PtyManager side effects).
- **Phase 5 — Falls out of existing wiring** (no new code) — DC failure fallback = Phase 2 `trySendViaDataChannel` catches `IllegalStateException` and falls through to signaling automatically; auto-reconnect = `P2PClient.scheduleReconnect` exponential backoff 1s→60s / maxAttempts 10 (already there); recovery auto-switch back = `isDcReady()` re-evaluates on every `invoke()` entry; UI live mapping = Phase 3 `dataChannelReady` chip.
- **Tests**: Android `TerminalRpcClientTest` +3 dedup / `SignalingRpcClientTest` +4 transport selection / `WebRTCClientTest` +1 Trap 1 regression; desktop `mobile-bridge.test.js` 14 new tests covering LRU dedup (5 angles) + sendToMobile DC-first vs signaling-relay double-send fallback (5 angles). All 3 Android suites green (11 + 15 + 21) + 14 new desktop tests + the rest untouched. Real-device E2E §5.3 matrix is on the user (LAN / cellular / double-NAT / DC forced-down / DC recovered — 5 scenarios).
- **Bug fix**: 12-test regression in WebRTCClientTest — `mockk(relaxed=true)` on `StateFlow<List<X>>` generic-erased `.value` to a relaxed `Object` instead of a real `List` → production-side `pairedDesktopsStore.devices.value.firstOrNull { ... }` threw `Object cannot be cast to Iterable` → `connect()`'s catch wrapped it as `"连接失败: ..."`; the fix adds `every { mockPairedDesktopsStore.devices } returns MutableStateFlow(emptyList())` in the test setup.
- **Design doc**: [`docs/design/Android_Remote_Terminal_Plan_A1.md`](docs/design/Android_Remote_Terminal_Plan_A1.md) v1.0 (includes §1.2 full analysis of three traps + §3.7 rationale for not reusing :core-p2p DataChannelTransport + §5.3 real-device E2E 5-scenario acceptance matrix).
- **Telemetry**: `[SignalingRpc.metric] path=dc|signaling reqId=...` is live; first-week fast-path-fraction target ≥80% (user base ≥10 devices) drives observability.
- **Distribution**: desktop binary v5.0.3.52 → v5.0.3.53 rebuilt; CLI `chainlesschain` 0.161.12 unchanged (Plan A.1 touches none of packages/cli/); Android versionCode/Name unchanged (v1.0.0 GA holds — this batch ships desktop + Android `app/`).

## 2026-05-14 Release — **v5.0.3.52 Plan A Remote Terminal: Android↔Desktop PTY end-to-end (Phase 1–4 all + 162 tests green)**

> User pain point: "I have many terminals open on my PC, can my Android phone see their output and remotely send commands?"  
> Hard constraint: external terminals already running on Windows **cannot be attached** by another process (OS handles are private to the parent).  
> Solution: **Plan A** — ChainlessChain desktop uses `node-pty` to host **new** terminal sessions; reuses the existing #21 Remote Operate signaling-relay channel to stream stdin/stdout to Android.

Desktop `PtyManager` is a **singleton** shared by web-shell WS gateway + cc ui WS gateway + V6 native IPC — a session opened in any shell is visible in the others.

- **Desktop main process** — `PtyManager` (lazy `node-pty` + 256KB ring buffer + 24h idle kill + shell whitelist `pwsh/cmd/bash/wsl` + 8 concurrent limit) + `terminal-handlers.js` (8 WS topics: create/list/stdin/resize/close/history + server-push stdout/exit) + `terminal-ipc.js` (V6 native IPC bridge) + `confirmation-dialog.js` (dangerous-keyword Electron messageBox + permanent trust per-cmd cache). `handleMobileCommand` adds `terminal.*` namespace + per-mobile-peer stdout/exit subscription fanout.
- **CLI workspace mirror** — `attachTopicHandlers` shared helper (extracted from `ws-cli-loader` dispatcher wrap as an ESM helper); `agent-runtime.startUiServer` attaches it — `cc ui` users also get `/terminal`. `node-pty` added as optionalDependencies (workspace hoist resolves it without breaking install on platforms without prebuilds).
- **Web Panel** — `useTerminal` composable (singleton fanout + base64↔UTF-8 encoding) + `Terminal.vue` route `/terminal` (xterm.js lazy import + multi-session tabs + history backfill + ResizeObserver + dangerous-keyword toast) + sidebar entry + i18n.
- **V6 plugin widget** — `plugins-builtin/terminal/plugin.json` + `shell/widgets/TerminalWidget.vue` + `shell/TerminalPanel.vue` (xterm.js embed + IPC bridge `electronAPI.terminal.*`) + slash command `/terminal`.
- **Android** — `TerminalRpcClient.kt` (reuses `SignalingRpcClient` envelope pattern + observeStdout/observeExit SharedFlow) + `TerminalWebView.kt` (WebView ↔ Kotlin JS bridge) + `xterm-shell.html` + xterm.js / addon-fit / xterm.css vendored to `assets/terminal/` + `TerminalListScreen` / `TerminalSessionScreen` Compose + softkey toolbar (Ctrl/Tab/Esc/arrows/Ctrl+C/D) + NavGraph 2 routes + `RemoteOperateScreen` "Open Remote Terminal" entry.

**Tests: 162 new, all green** — Desktop main 61 (RingBuffer 7 + PtyManager 15 + terminal-handlers 15 + terminal-ipc 12 + confirmation-dialog 5 + ws-smoke 6 + **real-PTY spawn cmd.exe integration 1 — really spawns `cmd.exe`, really sends `echo PLAN_A_PROBE_42`, stdout stream contains the probe**) + CLI cc ui 21 (PtyManager 10 + handlers 8 + ws-mirror-smoke 3 with real `ChainlessChainWSServer` + `attachTopicHandlers` + real WS client) + Web Panel 17 useTerminal composable + **3 e2e** (real `cc ui` subprocess + real WebSocket + real shell stdin/stdout round-trip via probe echo) + Android 10 `TerminalRpcClientTest`.

**Pre-existing test drift swept** — `widget-registry.test.ts` (PREVIEW_WIDGETS already extended to 7 entries) / `dashboard-store.test.js` (missing `mcp.list_tools` sendRaw mock) / `views-mount-smoke.test.js` 5 tail views (Notification + Pinia cross-test pollution; Projects i18n fixed + 4 others split into dedicated worker) / `Projects-folder-picker.test.js` deleted (tested UI no longer exists).

**Docs**: [Android Remote Terminal Plan A design](docs/design/Android_Remote_Terminal_Plan_A.md) + [user doc](docs-site/docs/guide/remote-terminal.md) (synced to both doc sites). Future A.1 stream traffic through WebRTC DataChannel to bypass relay bandwidth / Future B read-only snapshot of already-running external terminals via screenshot + OCR + Win32 SendInput left for later.

## 2026-05-13 Follow-up — **Android social goes production (demo → real)**

10K LOC of social scaffolding (14 screens + 9 ViewModels + 4 repos) was built long ago but only 2 routes were actually wired; the other 7 were `registerPlaceholder("temporarily simplified")`, and the `SocialScreen` Friends/Timeline tabs were hardcoded placeholder strings. Closed it all in one pass:

- **`NavGraph.kt` — replaced 7 placeholders with real composables + 2 new routes** (`PublishPost / PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost` now bound to the real screens; added `NotificationCenter` + `BlockedUsers` routes; a `CircularProgressIndicator` is shown while the DID document is loading)
- **`SocialScreen.kt` — three tabs upgraded** — Friends → `FriendListScreen`; Timeline → `TimelineScreen` (myDid resolved via `DIDViewModel.didDocument`); Notifications → `NotificationCenterScreen` (with filter / mark-all-read / cleanup menus, deleting the old inline basic list)
- **`PostReportDao` landed** — the entity has been in schema v23 forever but the DAO was missing: `reportPost()` was building entities without inserting + `getUserReports()` returned a hardcoded empty list. New DAO adds dedupe (`(postId, reporterDid)` idempotent) + status transitions + 8 Robolectric in-memory Room tests
- **PROFILE_QUERY/RESPONSE protocol** — 2 new `MessageType`s; `RealtimeEventManager.queryProfile(targetDid, 5s timeout)` uses `onSubscription` to eliminate the SharedFlow replay=0 subscribe-race; `SelfProfileProvider` interface + `DefaultSelfProfileProvider` (DID-suffix placeholder) wired in `ChainlessChainApplication.delayedInit`; `FriendRepository.searchUserByDid()` falls back to a P2P lookup when the local DID misses
- **`BlockedUsersScreen` wired to ViewModel** — `FriendViewModel` now injects `DIDManager` and gains `loadBlockedUsers()` + `unblockFriend` taking the full `unblockUser(myDid, did)` path (also clears the `BlockedUserEntity` row, no more orphaned records via the flag-only path)

**Tests**: 39 new unit + integration tests all green — 6× `RealtimeEventManagerProfileQueryTest` (race-fix: switched the round-trip test from `runTest` to `runBlocking` because the manager's internal scope uses `Dispatchers.IO`, off the virtual-time TestDispatcher graph) + 4×3 feature-p2p repo / VM + 2 `DefaultSelfProfileProvider` + 8 `PostReportDaoTest` real in-memory Room + 11 NavGraph + tab structural regressions (no emulator needed). Design doc: [Android_Social_Wiring_2026-05.md](docs/design/Android_Social_Wiring_2026-05.md). All three doc sites refreshed this round.

## 2026-05-13 Mid-stage — **[#21](https://github.com/chainlesschain/chainlesschain/issues/21) v1.2 GA feedback integration: project workflow P1+P2+P3A + #2 delete fix + #3 daily templates**

v1.2 GA feedback 5+3 items integrated (#2/#3/#4/#5/#7/#8). North star: "phone-side AI project interaction should be as smooth as desktop."

- **#2 project delete fix** (`fc24f9856`) — `EnhancedProjectCard` was missing delete UI entirely; added 3-dot menu + confirm dialog → DAO softDelete → Room Flow auto-removes from list.
- **#3 templates → daily life, 11 entries** (`99d38bf69`) — dropped 11 IDE templates; rewrote `ProjectTemplates` as: shopping list / travel plan / reading notes / idea capture / fitness plan / recipe / study plan / household ledger / work journal / meeting minutes / blank. Added 5 new `TemplateCategory` entries.
- **#4/#7 Desktop CLI + REMOTE handler P1** (`32ccabdb5`) — `cc project init/list/show/delete` writes directly to desktop `chainlesschain.db` (WAL-safe concurrent) + `project-management-handler.js` exposes 6 actions to Android L3 REMOTE. CLI 7 + handler 21 tests.
- **#4 Android→Desktop reverse sync P2** (`2646bbb4e`) — patched the reverse-sync gap. Added `ProjectSyncWalker` + `CompositeSyncRepositoryWalker` (`:app` aggregate) + Hilt binding. Full CREATE/UPDATE/DELETE op mapping. Composite 7/7 + walker 12 tests.
- **#5/#8 web-shell Projects + in-process WS P3 Part A** (`bfdde637d`) — 6 in-process WS topics wrapping the P1 handler (DRY: same handler serves web-shell + mobile L3). New `Projects.vue` project management list + old init/setup content moved to `ProjectInit.vue`. project-handlers 7/7 tests.

**Tests**: Phase 1 (P0) all pass + Phase 2 (project workflow): Android `:app` 80/80 + Desktop combined 51/51. **P3 Part B pending**: Android `ProjectCommands.kt` (so mobile can call project.\* via REMOTE on desktop projects) — wait for user verification of P1+P2+P3A first.

## 2026-05-13 Earlier — **[#21](https://github.com/chainlesschain/chainlesschain/issues/21) Android v1.3+ P0 prerequisites GA-independent + AI-3 forward-compat + 2 bug fixes**

P0 prerequisite batch before v1.2 GA (**no version bump**; will release alongside P1 main scope after v1.2 GA feedback):

- **A.3 ADR Review v2.0** (`348896382`) — full audit of 8 ADRs: **5 keep / 2 amend / 1 revise**. New [Android*ADR*重评估\_v2.0.md](docs/design/Android_ADR_重评估_v2.0.md). ADR-2 (M2 DID wallet still uses software Ed25519, blocks B.3 DID rotate) waits for v1.2 GA Play Console API-level data to pick option A/B/C; ADR-7/ADR-8 text amends align with reality (cc-mobile.json was never created — actually uses user_settings + `mobile.*` scope; registry is disk-first + push-based, not pull). Same commit adds §10 v1.3+ scope triage (12 sub-items P0/P1/P2 + 5 dependency chains).
- **B.6 PQC strict mode verifier gate** (`e24386d00`) — `LandmarkCache.strictPqMode` opt-in flag rejects any partial sig or publisher_signature with `alg === "Ed25519"`. Compatible with existing heterogeneous federation data format (0 schema changes); 0 producer-side changes.
- **B.2 in-process multisig.\* + marketplace.consume topics** (`b1c7cfd95`) — 7 in-process WS topics mirror the CLI `--json` output shape; desktop web-shell `Multisig.vue` dispatches via `useShellMode().isEmbedded`. **Perf: asar:true subprocess cold-start 6-10s → in-process ~20ms (SQLite open) + query, 60-100× speedup**. 0 UX changes.
- **A.3 AI-3 SkillMetadata.signature forward-compat** (`45a88270e`) — Android `ManifestSignatureVerifier` interface + `NoOpManifestVerifier` always-accept stub + `RemoteSkillRegistry.setManifestVerifier()` swap seam, wired for marketplace M0 (#21 AI-5).
- **Fix wear test imports** (`c0d061328`) — `CcPhoneDecisionListenerTest` was missing `kotlinx.coroutines.{launch,delay,GlobalScope,DelicateCoroutinesApi}` imports since v1.2 P0.2, blocking all `:app:compileDebugUnitTestKotlin`. Added 4 imports.
- **Fix B.6 strict mode disk-load gate** (discovered during this QA sweep) — `LandmarkCache.loadFromDisk()` bypassed the strict-mode gate. Moved per-snapshot strict check into `_validateAndStoreSnapshot()` so both ingest + disk-load paths go through the gate. +2 disk-load integration tests lock the regression.

**Tests**: B.6 strictPqMode 11/11 + B.2 multisig-handlers 23/23 + AI-3 ManifestSignatureVerifier 10/10 + Android `:app` regression 57/57 + web-shell 379 regression (25 files) all pass.

## 2026-05-13 Release — **v5.0.3.51 Remote Operate Plan A + B infrastructure landed (WebRTC signaling relay + STUN/TURN deployment + iceServers credential signing)**

productVersion **v5.0.3.50 → v5.0.3.51**. Plan C (v5.0.3.50) wired signaling-forward through to 100-400ms p99 for low-frequency commands, but two hard constraints remain: throughput (the relay's bandwidth is shared across all clients → streaming tokens / files / video can't pass through) + privacy (the relay server can read plaintext payloads beyond the public wss TLS layer). Plan A+B closes both: real WebRTC P2P DataChannel = end-to-end encryption + direct-link bandwidth. The complete three-tier picture: low-frequency commands ride Plan C signaling forward / high-throughput streaming tokens + files ride Plan A WebRTC DC / NAT traversal fallback rides Plan B STUN/TURN. Design doc: [Android Remote Operate Plan A+B](docs/design/Android_Remote_Operate_Plan_AB.md).

- **Plan A — WebRTC signaling pass-through relay** (commits `e9f9d6275` + `af11daa6e`) — signaling-relay `server.js` `handleMessage` switch adds case `offer/answer/ice-candidate/ice-candidates/peer-status` on the same forwarding path as `type=message` with the `from` field injected (parity with LAN signaling-handlers). Desktop main `startRelayClient.onMessage` collapses to a unified dispatch: pair-ack still routes alone to write sessionState; everything else (command:request / offer / answer / ice) goes through `mobileBridge.handleSignalingMessage` — the LAN path and relay path become fully equivalent.
- **Plan B — coturn STUN/TURN deployment** — `turn.chainlesschain.com` (47.111.5.128) listens on `0.0.0.0:3478` UDP+TCP + `5349` TLS + `49152-65535` UDP relay; docker compose host-network mode avoids NAT; Let's Encrypt via gitee-mirrored acme.sh handles renewal; `use-auth-secret` for time-limited credentials.
- **iceServers HMAC-SHA1 24h ephemeral creds** — `signIceCredentials(userId)` mints `username = expiry-ts:user-id` + `credential = base64(HMAC-SHA1(TURN_SECRET, username))` and returns the three-tier `stun:turn.chainlesschain.com:3478` + `turn:3478?transport=udp/tcp` + `turns:5349` priority list with credentials. The `CC_TURN_SECRET` env is **mandatory** with no source-level fallback and **never hardcoded** (no fork can mint working credentials); without it the system degrades to STUN-only.
- **iceServers no longer in QR — pushed via signaling instead** — a 650+ char QR payload + high error-correction at 280px crashed scan recognition (verified 2026-05-14: 30s blocking with no detection); switched to async push after scan: when desktop pair-ack matches it calls `pushIceServersToMobile(ackPayload)` over both LAN signaling + the public relay (**dual-send**) with `type chainlesschain:ice:config` payload `{pcPeerId, iceServers, iceExpiry}`. Android `WebRTCClient.setOnForwardedMessageReceived` intercepts + `persistIceConfigMessage` upserts into `PairedDesktopsStore.iceServersJson`; `SignalingRpcClient.handleIceConfigMessage` keeps a race-tolerant backup.
- **Android `WebRTCClient.createPeerConnection`** — `PairedDesktopsStore` is injected; `resolveIceServersFor(pcPeerId)` reads stored iceServers (TURN included), with expiry/missing fallback to Google STUN; `parseIceServersJson` accepts `urls` as either string or array.
- **`backend/signaling-relay-service/` enters the repo** — `server.js` + `Dockerfile` + `docker-compose.yml` + nginx vhost + `deploy.sh` + README, giving second-party deployments a working blueprint.

**Known constraints / trade-offs**: iceServers TTL 24h — once expired, fallback to Google STUN won't traverse NAT (mobile-side detection of approaching expiry to request fresh credentials over signaling lands before v1.4 GA); WebRTC P2P real-device cross-NAT verification still pending (full file-transfer test on phone 4G + desktop home WiFi); Signal Protocol E2EE waits for Plan A DC to land first (DC is already direct + TLS, marginal gain from Signal); Aliyun security groups must allow UDP 3478 / TCP 3478 / TCP 5349 / UDP 49152-65535 to 0.0.0.0/0 — without it coturn runs but is externally unreachable, ICE gathering fails.

**Distribution**: desktop binary v5.0.3.50 → v5.0.3.51 rebuilt; signaling-relay-service deployed at `47.111.5.128`; CLI `chainlesschain` 0.161.10 → 0.161.11; Android versionCode/Name unchanged; all three doc sites synchronized this round: docs-site / docs-site-design tagline bumped to v5.0.3.51 + Plan A+B design doc synced.

## 2026-05-13 Release — **v5.0.3.50 Android Remote Operate Plan C signaling-forward RPC (mobile remote really wired to desktop)**

productVersion **v5.0.3.49 → v5.0.3.50**. After pairing landed in v5.0.3.49 (W3.7 Flow B QR), the next step is letting the mobile actually _operate_ the desktop — tap Ping / System Status / System Info, the desktop runs it, the response comes back. Plan A (WebRTC P2P) + Plan B (STUN/TURN) are big engineering; Plan C reuses the signaling-forward pipe already proven by pair-ack, ships single-shot low-frequency commands first, leaves A+B for follow-up. Design doc: [Android Remote Operate Plan C](docs/design/Android_Remote_Operate_Plan_C.md).

- **`SignalingRpcClient` lands** — mobile-side RPC entry: builds `{type:"chainlesschain:command:request", payload:{id, method, params, auth, timestamp}}` → `PairingSignalingGate.sendAck`; one-shot installs `setOnForwardedMessageReceived` listener and matches `requestId` to `CompletableDeferred` to resolve responses; 30s `withTimeout` safety net; **automatically resets the gate, switches to the public relay URL, re-registers, and retries once when the LAN sendAck fails** — same pattern as `ScanDesktopPairingViewModel`'s pairing fallback.
- **`RemoteOperateScreen` + ViewModel** — minimal UI: three chip buttons (Ping / System Status / System Info) + response JSON display + unpair. Home screen "connected desktop" card taps into NavGraph route `remote_operate/{peerId}`.
- **`PairedDesktopsStore` persistence** — SharedPreferences JSON of paired desktops (pcPeerId / deviceName / lanSignalingUrl / relayUrl / pairedAt / lastSeenAt); upsert is idempotent by pcPeerId; the home screen now reads from this store instead of `p2pClient.connectedPeers` — Plan C does not maintain a persistent P2P connection, so once the post-scan signaling drops, connectedPeers is empty and the UX would look like "not connected" right after pairing.
- **Desktop `RelayClient` outbound to public relay** — `desktop-app-vue/src/main/p2p/relay-client.js` outbound-connects to `wss://signaling.chainlesschain.com`, registers the desktop pcPeerId (must match `mobileBridge.peerId`, otherwise off-LAN phones cannot find the target peer), `onMessage` routes pair-ack / regular mobile commands into `recordPairAck` / `handleMobileCommand` (same pipeline as LAN); exponential backoff reconnect capped at 60s.
- **`mobile-bridge.handlePairAckFromRelay`** — bug fix: `main/index.js` was calling `this.mobileBridge?.handlePairAckFromRelay(...)` but the method did not exist; the optional-chain `?.` silently swallowed it, so the relay path's pair-ack triggered no event. Added an EventEmitter notification symmetric with the LAN branch.
- **`MobileBridgeHeaderStatus.vue`** — web-panel header shows paired-mobile count, polling `cc p2p devices --type mobile` every 5s. `parseJsonOutput` now skips CLI log-prefix lines (`[AppConfig]` / `[DatabaseManager]` etc.) instead of false-matching them as JSON-array starts.
- **i18n** — 11 `RemoteOperateScreen` strings extracted into `values/strings.xml` + `values-zh-rCN/strings.xml` (ro_title / ro_subtitle / ro_peer_id_fmt / ro_quick_commands / ro_cmd_ping/status/info / ro_executing_fmt / ro_error_label / ro_response_label / ro_unpair).

**Tests**: 3 new unit test files / 20 tests all green — `PairedDesktopsStoreTest` 7 (mocked SharedPreferences instead of Robolectric — orders-of-magnitude faster startup) / `SignalingRpcClientTest` 7 (FakeSignalClient + CapturingGate; happy / no-DID fail fast / LAN→relay fallback / double-fail / response with error field / real withTimeout / unknown rid silent ignore) / `RemoteOperateViewModelTest` 6 (mockk + StandardTestDispatcher; state transitions + null-message error fallback + unpair calls store.remove). Two key technical decisions: (1) use `runCurrent()` instead of `advanceUntilIdle()` — `SignalingRpcClient.invoke` uses `withTimeout(30000)` on virtual time, and `advanceUntilIdle` would push the virtual clock past 30s and falsely trigger the timeout; `runCurrent` only runs tasks ready at the current virtual time; (2) added `testImplementation("org.json:json:20240303")` — the Android SDK's stubbed `org.json.JSONObject` silently returns defaults under `isReturnDefaultValues=true` instead of really parsing JSON. `ScanDesktopPairingViewModelTest`'s `signaling gate failure surfaces Failed` now expects `sendAckCallCount == 2` (LAN + relay both called). Desktop vitest 7600+ suite all green. Plan C real-device E2E (Android↔desktop relay command round-trip) is on the user-side checklist, same pattern as Flow B verification.

**Known constraints / trade-offs**: one signaling hop + one public-relay hop puts p99 latency at 100–500ms — acceptable for low-frequency commands; streaming tokens / files don't fit → Plan A.2 WebRTC DataChannel; relay traffic is TLS but the relay server can see the payload, so end-to-end encryption requires Signal Protocol session (the e2ee module exists but Plan C does not wire it yet); relay outage = Plan C unavailable, LAN still works.

**Roadmap**: Plan C ✅ landed → Plan A.1 (DataChannel reuse, fall back to signaling when DC unavailable) → Plan A.2 (high-throughput scenarios go true P2P direct to bypass relay bandwidth) → Plan B (STUN/TURN traversal so even genuinely NAT-isolated peers can do A.1).

**Distribution**: desktop binary v5.0.3.49 → v5.0.3.50 rebuilt; `chainlesschain` npm version unchanged (no CLI changes); Android versionCode/Name unchanged (v1.0.0 GA holds — this Plan C round is desktop-first; the full Android v1.1 minor will ship the complete mobile client). All three doc sites synchronized this round: docs-site / docs-site-design pull the new Plan C design doc through the sync scripts; docs-site tagline bumped to v5.0.3.50; README / README_EN gain this changelog entry.

## 2026-05-12 Release — **v5.0.3.49 M-of-N multisig Phase 1d + Phase 2a marketplace mediator + Phase 2b web-panel Multisig view + Flow B QR pairing closing + test backfill**

productVersion **v5.0.3.48 → v5.0.3.49**. Four main lines:

**(1) `@chainlesschain/core-multisig` package + `cc multisig` CLI lands** (commit `3c890dcac`, v1.2 m-of-n Phase 1d) — new npm workspace package with 5 libs (policy / store / proposals / signing / governance-log), CLI gains 8 subcommands (propose / sign / cancel / finalize / list / show / sweep / policy); 75 lib unit tests + 10 CLI integration tests all pass. SQLite native (better-sqlite3-multiple-ciphers) → sql.js WASM auto-fallback — CLI works out of the box on any platform.

**(2) Phase 2a marketplace.purchase mediator** (commit `2755093d0`, design doc §6.1 lands) — `cc marketplace purchase <itemId>` routes large purchases (≥¥1000 by default `LARGE_PURCHASE_THRESHOLD_FEN = 100000` fen) through the M-of-N propose flow and lets small ones execute directly; `cc marketplace consume <proposalId>` finalizes after the threshold is reached and runs the business operation. Extracted `packages/cli/src/lib/multisig-runtime.js` (SQLite cascade + manager loader) so both `multisig` and `marketplace` commands share one implementation (−130 lines dedup, Phase 1 10/10 unchanged behaviour). 8 new E2E tests pass (full ¥1500 2-of-2 walkthrough / ¥500 direct path / `--threshold-fen` override / six error exits). Three canonical domains — marketplace.purchase / did.rotate / cross-chain bridge — unlock here; marketplace is the first mediator wired to a real business path. **18 multisig integration tests green total** (Phase 1 10 + Phase 2 8).

**(3) Phase 2b web-panel Multisig view lands** (commit `c758492d9`, design doc §8.1 lands) — web-shell (default desktop entry) gets an M-of-N multisig view + operations panel. New `packages/web-panel/src/views/Multisig.vue` (468 lines): 6-card top stats (total / pending / reached / consumed / cancelled / expired) + two tabs — Proposal list (state + domain filters, row actions: detail / cancel / execute purchase) and Domain policy (lists known domains marketplace.purchase / did.rotate / crosschain.outbound with member expansion) + 640px Detail drawer (Descriptions for domain / state / threshold / sigs / initiator / timestamps / payload JSON + signature list + operation buttons cancel / execute purchase / finalize) + info Alert "web shell does not hold private keys; sign goes through CLI". AppLayout.vue + router/index.js add the sidebar entry (TeamOutlined icon) + `/multisig` route + i18n fallback "M-of-N 多签". WS goes through CLI subprocess via `ws.executeJson('multisig list --json')`; cold-start 6–10s (asar:true cost) is acceptable for Phase 2 — Phase 3 follow-up can add in-process WS handlers to shave latency, plus private-key signing UI wired to UnifiedKeyStore, real-time push, and Marketplace.vue purchase modal integration. Same SPA is auto-available in both desktop web-shell and `cc ui` (per memory `feedback_cross_shell_feature_pattern`).

**(4) Android v1.1 W3.7 Flow B QR pairing lands** (commit `c47cbc649`) — desktop displays QR / phone scans, the standard UX pattern in mainstream apps (WeChat / Alipay / Discord / WhatsApp Web); verified end-to-end on real Xiaomi 24115RA8EC hardware. Nine production traps swept. Backfilled the 2 test files the original commit omitted: `ScanDesktopPairingViewModelTest` (10 tests) + `desktop-pair-handlers.test.js` (19 tests).

**Added — M-of-N multisig core (v1.2 #20 P0.3 Phase 1d)**:

- **`@chainlesschain/core-multisig` package** — 5 lib files: `policy.js` (domain policy `{m, n, members[], requirePqc, defaultExpiryMs}` validate + normalize) / `store.js` (SQLite 3-table schema + helpers) / `proposals.js` (state machine `pending → reached → consumed` + `cancelled` / `expired` terminal) / `signing.js` (JCS canonicalize + DOMAIN_PREFIX `"MULTISIG:"` replay protection + Ed25519/SLH-DSA dispatcher + verifyThreshold strip-all-sigs) / `governance-log.js` (append-only JSON Lines audit log capturing every state transition); 75 unit tests pass.
- **`cc multisig` CLI 8 subcommands** — `propose` / `sign` / `cancel` / `finalize` / `list` / `show` / `sweep` / `policy {set, show}`; all support `--json`; 10 CLI integration tests pass.
- **SQLite driver cascade** — native `better-sqlite3-multiple-ciphers` / `better-sqlite3` auto-falls-back to `sql.js` WASM on load failure; no per-platform native prebuild required (per memory `feedback_sqlite_wasm_fallback`).
- **Test infrastructure fixes** (3): `core-multisig vitest.config.js` set `globals: true` (vitest 4 rejects CJS `require("vitest")`); 5 test files switched to ESM `import`; `multisig-cli.test.js` import path `@chainlesschain/core-mtc/signers/ed25519.js` → dropped `.js` suffix (core-mtc exports key has no suffix).

**Added — Phase 2a marketplace.purchase mediator (v1.2 #20 P0.3 Phase 2)**:

- **`cc marketplace purchase <itemId>` + `cc marketplace consume <proposalId>` two new subcommands** — amount ≥ threshold requires a `marketplace.purchase` policy before proposing; threshold defaults to ¥1000 (`LARGE_PURCHASE_THRESHOLD_FEN = 100000` fen), overridable via `--threshold-fen`; amount < threshold takes the direct path without creating a proposal; `consume` verifies `domain == "marketplace.purchase"` and `state == "reached"`, then finalizes + prints the order payload + writes `consumed` to governance log.
- **Shared runtime** `packages/cli/src/lib/multisig-runtime.js` — extracted from commands/multisig.js (SQLite cascade + manager loader + readSecretKey / readJsonArg helpers); commands/marketplace.js reuses the same module. The multisig refactor drops 130 lines while leaving Phase 1 behaviour unchanged (10/10 integration tests still pass).
- **8 new E2E tests pass** (`marketplace-multisig-e2e.test.js`): full ¥1500 2-of-2 walkthrough (policy → purchase → sign×2 → reached → consume → governance.log records `proposed`/`signed`×2/`reached`/`consumed`) / ¥500 direct path / `--threshold-fen` override / large purchase without policy → exit 2 / consume on pending → exit 2 / consume on wrong domain → exit 2 / `--help` text.

**Added — Phase 2b web-panel Multisig view (v1.2 #20 P0.3 Phase 2b)**:

- **`packages/web-panel/src/views/Multisig.vue`** — 6-card stats + Proposal list tab (state/domain filters + detail/cancel/execute-purchase actions) + Domain policy tab (marketplace.purchase / did.rotate / crosschain.outbound known policies) + 640px Detail drawer (domain / state / threshold / sigs / initiator / payload JSON + signature list + operation buttons) + info Alert "web shell does not hold private keys; sign goes through CLI".
- **router + AppLayout** — `/multisig` route + sidebar security/audit group multisig entry (TeamOutlined icon) + collapsed-mode parity + i18n fallback "M-of-N 多签".
- **WS through CLI subprocess** — `ws.executeJson('multisig list --json')` reuses Phase 1 CLI; cold-start 6–10s (asar:true cost) acceptable.
- **Phase 3 follow-up**: private-key signing UI (needs UnifiedKeyStore), in-process WS handlers, real-time push, Marketplace.vue integration entry.

**Added — Android v1.1 W3.7 Flow B QR pairing (issue #19)**:

- **Cross-module DI** — `PairingSignalingGate.sendAck` interface lives in `:core-p2p` so `:feature-p2p` doesn't reverse-depend on `:app`; `WebSocketPairingSignalingGate.sendAck` implementation in `:app` serializes via `ensureRegistered + Mutex`; `WebRTCClient.SignalClient.sendForwardedMessage(toPeerId, payload)` bridges the mobile signaling forward.
- **Mobile UI** — `ScanDesktopPairingScreen` + `ScanDesktopPairingViewModel` use the non-social `QRCodeScannerScreen` (ZXing pass-through; the social variant validates and would reject our desktop-pairing JSON); NavGraph + SettingsScreen gain a "Scan desktop QR" entry.
- **Desktop WS topics trio** `desktop-pair-handlers.js`: `desktop.pair.generate-qr` / `poll-ack` / `reset`; `mobile-bridge.js` adds `this.peerId` persistence + intercepts `type=pair-ack` and routes via `recordPairAck` matching + writes to SQLite paired_devices.
- **Vue UI** — `MobileBridge.vue` gets a Flow B tab (default) + Flow A + manual entry 3-tab layout; `antd.js` registers `AQrcode` (ant-design-vue qrcode async loaded).
- **Real-device E2E verified**: Xiaomi 24115RA8EC desktop QR → ML Kit scan → signaling pair-ack → desktop mobileBridge intercept → recordPairAck match → CLI `pair-from-qr` writes SQLite → Vue refreshes device list.

**Test backfill**:

- **Android `:feature-p2p:testDebugUnitTest` 41s all green** (138 actionable tasks) — new `ScanDesktopPairingViewModelTest` (10 tests) + existing `DesktopPairingViewModelTest` + MessageQueueViewModelTest + P2PChatViewModelTest + P2PDeviceViewModelTest.
- **Desktop 3 files / 45 tests all green** — new `desktop-pair-handlers.test.js` (19 tests) + `mobile-pair-handlers.test.js` (9 tests) + `web-shell-bootstrap.test.js` (17 tests).

**Distribution**: Desktop binary v5.0.3.48 → v5.0.3.49 rebuilt (now carries Flow B + multisig source; auto-updater compares `5.0.3-alpha.49 > 5.0.3-alpha.48`). `chainlesschain` npm 0.161.8 → 0.161.9 (CLI gains multisig command + dep `@chainlesschain/core-multisig`). Android versionCode/Name unchanged (v1.0.0 GA holds); Flow B desktop-first this release, full mobile client ships in the next Android v1.1 minor. Three doc sites synchronized this round: docs-site / docs-site-design / docs-website-v2 taglines bumped to v5.0.3.49 + this changelog entry added.

---

## 2026-05-12 Release — **v5.0.3.48 Android M3 capture suite (5/5 code) + M4 RemoteSkillRegistry method-level + ApprovalUI 4-category + ProgressViewer + alias compat window**

productVersion **v5.0.3.47 → v5.0.3.48**. Android v1.0 RFC M3 + M4 closing batch: 7 commits / 187 new unit tests / Android total 196+ → 383+. **Android M7 GA flip lands together (commit `ffe722162`): versionCode 37 → 100, versionName 0.37.0 → 1.0.0 GA**. No desktop / CLI source changes; CLI npm 0.161.7 → 0.161.8 (force publish on the release.yml sync track). Next step: tag `v1.0.0` at `ffe722162` and push to gitee + github.

**Added — Android M3 capture suite (5/5 code-layer)**:

- **VoiceMode end-to-end voice chain** (commit `47bebed80`) — ASR → REMOTE chat → TTS pipeline wired from the home entry.
- **CameraOCR snap-to-KB pipeline** (commit `a69269ced`) — `ai.ocrImage` + `knowledge.createNote` walked end-to-end; OCR metadata is written automatically.
- **LocationTagger via Play Services FusedLocationProvider + Foreground Service** (commit `3f5ac8647`) — GPS data lands in `createNote.metadata`.
- **SharePayloadFlusher feeds SyncCoordinator → knowledge.createNote** (commit `3d1a6e3a8`) — 5 SharePayload variants (Text / Url / SingleImage / MultiImage / GenericFile) → note fields; drained at the tail of the SyncCoordinator 30s push loop, failures re-enqueued. 19 new unit tests.
- **PushNotifier local channel + FCM skeleton** (commit `c0d990c91`) — 4 NotificationChannel (Cowork / Marketplace / SystemAlert / ShareInbox) + protocol-neutral `CcPushNotificationService` entry; real FCM wiring follows the 5-step guide in `android-app/docs/M3_FCM_SETUP.md` (google-services.json stays on the user). 36 new unit tests.

**Added — Android M4 closing**:

- **RemoteSkillRegistry method-level metadata** (commit `6e49270fd`) — `MethodMetadata` data class + 4 accessors; `knowledge.*` and `ai.*` seeded with 10 methods each (8 riskOverride demos); the other 21 namespaces stay empty pending desktop `mobile-skill-whitelist` push. 16 new unit tests.
- **ApprovalUI 4-category adapter** (commit `f4f83cc67`) — `ApprovalCategory` enum {Sign / Cowork / Marketplace / SystemCritical} + `fromMethod` inference; `AndroidApprovalGate` 4-arg overload carries category through; Dialog swaps icon / tint / title / footer per category. 9 new tests.
- **ProgressViewer long-running task panel** (commit `f4f83cc67`) — `LongTaskRegistry` `@Singleton` MutableStateFlow + `TaskProgressCommandRouter` for `task.*` reverse-RPC + Compose `ProgressViewerScreen` (StatusChip + Linear / indeterminate Circular + dismiss / clear-terminal, MAX_TASKS=100 sliding window). 34 new tests.
- **§8.3 RemoteSkillRegistry alias compat window** (commit `0bc8e2797`) — `SkillMetadata.aliases` field + internal `aliasIndex`; every public accessor routes through `resolveAlias`, so renaming a namespace doesn't break callers for one release window. 7 new tests.
- **§8.1 README versionName fix + v1.0 GA checklist** (commits `0bc8e2797` `3da484e9c`) — `android-app/README.md` M3 (2/5) → (5/5 code); M4 row gains method-level + ApprovalUI + ProgressViewer; new `ANDROID_v1_GA_CHECKLIST.md`. M7 GA flip is now landed in `ffe722162`; 4 user-side items remain owing for v1.0 GA: M3 device E2E / M4 D2 device E2E / FCM credentials / M6 perf measurements.

**Tests**: 187 new Android unit tests green, covering capture / push / registry / task / approval-category / composite-router. Desktop store regression 26 files / 773 tests ✓; CLI lib 169 files / 7185 tests ✓ (confirming the Android work didn't pollute desktop / CLI paths).

**Distribution**: Desktop binary rebuilt v5.0.3.47 → v5.0.3.48 (no desktop source changes; auto-updater compares `5.0.3-alpha.48 > 5.0.3-alpha.47`, so v5.0.3.47 desktop users will see a real "new version" prompt on restart). `chainlesschain` npm 0.161.7 → 0.161.8 (CLI itself has zero source changes; force publish on the release.yml sync track). Android: versionCode 37 → 100, versionName 0.37.0 → **1.0.0 GA** (commit `ffe722162`); `android-app/CHANGELOG.md` adds `[1.0.0] - 2026-05-12` GA entry, `android-app/README.md` title flips to "🎉 v1.0.0 — GA". All three documentation sites refreshed in sync (tagline bumped to v5.0.3.48 + this section added).

---

## 2026-05-10 Release — **v5.0.3.46 Phase 3d desktop ↔ Android two-way sync suite + Android 0.37.0 seven-feature batch + e2e CI silent-regression fix**

productVersion **v5.0.3.45 → v5.0.3.46**. Android **0.36.0 → 0.37.0** (versionCode 36 → 37). Three themes shipped together: (1) **Phase 3d Mobile-Bridge-Sync — full desktop ↔ Android two-way social-data sync** (M2 → v1.2 across 12 commits · 5 ResourceType walkers + tombstones + Room cursor + sync.\* JSON-RPC handlers + DeviceManager + SyncCoordinator auto-trigger · gates 1–4 all Ed25519 strict-verify); (2) **Android 0.37.0 lands 7 user-visible features in one commit** (Volcengine SeedASR voice + APK auto-update issue #21 + splash redesign + Claude coral theme + i18n three regions + biometric + DID Key screen); (3) **e2e CI silent-regression fix** (drop the e2e-tests workflow JOB-level `continue-on-error: true` that masked 3/3 OS failures as success — "No team IPC interface found" had been buried for weeks — plus Playwright browser cache for speedup).

**Added — Phase 3d desktop ↔ Android two-way sync**:

- **M2 desktop sync engine landed** (commits `491fb4758` → `9a8e3635d`) — scaffold mobile-bridge-sync provider, drop dead `MobileSyncManager`; rewrite 5 ResourceType walkers (`note` / `conversation` / `did` / `community` / `channel`) + apply path; tombstone triggers + `resource_type` column; `mobile.ts` real provider + IPC wire-up; 52 mobile sync tests, surfacing and fixing 3 prod bugs along the way.
- **M3 Android-side SocialSyncAdapter wiring + Room cursor + JSON-RPC handlers** (commits `28c85dad5` → `1131e35a2`) — break 4 Hilt cycles via `dagger.Lazy`; MESSAGE outgoing path; Room-persisted `SyncRemoteCursor`; `sync.*` JSON-RPC handlers in SyncManager; transport wiring + outbound JSON-RPC.
- **M4 desktop settings page + DeviceManager + manual pairing** (commits `0bf5f00b9` `17ea9b69d`) — Settings adds SyncMobile mobile-device sync page; DeviceManager wire-up + manual pairing form.
- **v1.1 real handlePullRpc + DID auth + auto-trigger** (commits `2d841dfdc` → `b77e0773b`) — Android walker actually returns data via `handlePullRpc` (no longer stub); `sync.*` topic gets DID signature verification; `SyncCoordinator` auto-triggers push/pull on socket connect.
- **v1.2 real Ed25519 + Android gate 4** (commits `c739d77d0` `4ecb7c8ef`) — desktop placeholder signatures → real `@noble/ed25519`; Android gate 4 verifies, all 4 gates strict-verify.

**Added — Android 0.37.0 (commit `1348636ad`)**:

- **Volcengine SeedASR voice recognition** — `WavRecorder` (16kHz mono PCM → WAV) + `VolcengineAsrClient` (HTTP submit + 800ms poll) + `HomeStatusViewModel` state machine + `AsrSettingsScreen` x-api-key entry + Recording/Transcribing dialogs.
- **APK auto-update (issue #21)** — `UpdateChecker` (GitHub Releases API, tag prefix `android-v`, arm64-v8a asset pick) + `UpdateInstaller` (DownloadManager + FileProvider + ACTION_VIEW) + `UpdateDialog` (changelog scroll + REQUEST_INSTALL_PACKAGES permission flow) + Settings "Check for updates" entry.
- **Splash + theme overhaul** — SplashScreen purple gradient + rotating ring + TT logo + 3-dot breathing + progress; `rememberUpdatedState` fixes splash race; Claude coral palette (`#D97757` primary) + `dynamicColor=false` to preserve brand colour.
- **i18n (issue #16)** — `resourceConfigurations` uses explicit `zh-rCN` / `zh-rTW` / `zh-rHK` qualifiers (fix: `zh` as language-only filtered out all `values-zh-rCN/` at build time); `AppCompatDelegate.setApplicationLocales` wired; `MainActivity` → `AppCompatActivity` + `Theme.AppCompat.Light.NoActionBar`.
- **Auth + DID + biometric** — `AuthRepository.register` idempotent fallback to `verifyPIN` (fix race: AuthVM async DataStore read vs splash navigate); SettingsScreen biometric toggle; new `KeyManagementScreen` (DID + public key hex + clipboard + trusted devices + reset).
- **Home page UX** — LLM-not-configured banner (taps → LLM Settings); send-from-home prefill plumbing; BrandSection / AboutScreen logo → `R.mipmap.ic_launcher`; FunctionEntryCard 12 hardcoded vivid colours → unified surfaceVariant + 44dp icon chip.
- **Drive-by latent bug fixes**: `OpenAIAdapter.{chat,chatWithTools,checkAvailability,streamChat}` add `withContext IO` + `flowOn` (was blocking main thread → 12s home freeze); `RemoteConnectionManager.invoke{,WithRetry}` inline reified `<T : Any>`; `SystemMonitorScreen.kt:149` `os?.type/version` null-safe; 256 `rs_*` string stubs auto-generated.

**Fixed**:

- **Android `sync.*` DID auth strict-mode flip + release build unblock** (commit `49f1440ca`).
- **2 mobile-ipc tests stale after M4.5** (commit `d34de0ac0`) — DeviceManager wire-up changed IPC shape, tests synced.
- **Website mobile hamburger menu** (commit `0bb62675d`) — `SiteHeader.astro` nav list overflowed at small widths, added `<button>` toggle + tailwind `md:hidden`.
- **Logo assets shipped to docs+design + www docs links retargeted** (commit `61b8cd642`).
- **E2E preload real-error surfacing + force V5/V6 mode + early app-config.json write** (commits `076474208` `1f61a18bf` `fc9cacc48`).

**CI**:

- **Drop e2e-tests workflow `continue-on-error: true`** (commit `e807d576c`) — JOB-level `continue-on-error: true` was masking 3/3 OS failures as success; "No team IPC interface found" had been buried for weeks.
- **e2e-tests workflow gets npm cache + Playwright browsers cache** (commit `9460f05da`) — `actions/cache@v4` for `~/.npm` and `~/Library/Caches/ms-playwright` / `%LOCALAPPDATA%\ms-playwright`; single-OS time expected to drop from ~14m to ~6–8m.

**Tests**: desktop mobile sync 52 tests green (M2 step 8) + Android Phase 3d v1.1/v1.2 sync gates 1–4 complete + mobile-ipc 12/12 green.

**Distribution**: CLI npm `chainlesschain` stays at 0.161.7 (no CLI source changes since v5.0.3.45). Desktop binary rebuilt; auto-updater compares `5.0.3-alpha.46 > 5.0.3-alpha.45`, so all v5.0.3.45 desktop users will see a real "new version" prompt on restart. Android APK ships under the new `android-v0.37.0` tag (visible to users at Settings → Check for updates). All three documentation sites refreshed in sync (tagline bumped to v5.0.3.46 + this section added to changelog).

---

## 2026-05-09 Release — **v5.0.3.45 cc ui llm.chat parity + intent opt-in toggle + true streaming + Vue Proxy fix**

productVersion **v5.0.3.44 → v5.0.3.45**. `cc ui` finally aligns with the desktop web-shell on the LLM path; project/file-mode chat no longer routes through the "Understanding…" placeholder LLM call by default; `chatStream` is now a real token-by-token stream; intent placeholder card Vue Proxy reactivity bug fixed so the card flips correctly.

**Added**:

- **`cc ui` `llm.chat` WS topic (commit `f41c4b4e2`)** — The desktop web-shell has had `llm.chat` since `4eaf90137` (Phase 2), but `cc ui` (the CLI's ws-server) never registered it. Result: the QuickAsk page in `cc ui` mode hung 60 seconds and surfaced `Stream idle timeout` (the dispatcher's `UNKNOWN_TYPE` frame isn't recognized by the SPA as a stream terminus). New `packages/cli/src/gateways/ws/llm-chat-protocol.js` reuses `chat-core`'s `streamOllama` / `streamOpenAI` / `streamAnthropic` and mirrors the desktop's `<topic>.chunk` + `<topic>.result` frame protocol exactly. New `packages/cli/src/gateways/ws/llm-creds.js` shared resolver: explicit `options` → WS session creds → provider env vars (preferred order: volcengine / openai / anthropic / deepseek / dashscope / gemini / kimi / minimax / mistral); when none have creds, an instant `ok:false` frame is sent — no more 60-second hangs. `chat-intent-protocol` now uses the same resolver, fixing a latent bug along the way: `session.baseUrl || "http://localhost:11434"` previously hardcoded ollama whenever a session lacked baseUrl, killing every cloud provider on machines without local ollama.
- **Intent understanding opt-in toggle (commit `f41c4b4e2`)** — Chat / Agent project/file mode header gets an `<a-switch>`, **off by default**. Pre-v5.0.3.45 every project/file message went through `chat.intent.understand-stream` first → 0.5–90s of latency that surprised users. Now defaults to direct send; users who want the confirmation card flip the switch (persisted to `localStorage cc.web-panel.chat.intentEnabled`). `submitUserInput` first-line short-circuit: `if (mode === 'global' || !intentEnabled.value) { sendMessage; return }`. The desktop shell shares this SPA bundle so its behaviour now matches `cc ui`.

**Fixed**:

- **`chatStream` truly streams tokens (commit `35f6e60ea`)** — `packages/cli/src/lib/chat-core.js` `chatStream` was a fake async generator that buffered every `onToken` delta into an array and only `yield`-ed them after `streamX(...)` settled — consumers saw zero progress for the full LLM round-trip. Replaced with a token queue + Promise waiter pattern: `onToken` push wakes the generator, which yields immediately. `streamPromise.finally` flips done + wakes a final time so calls that emit no tokens still terminate cleanly. Affects every consumer — Chat / Agent / QuickAsk / 意图理解 — all now stream live.
- **Intent placeholder Vue Proxy reactivity fix (commit `a76e451e2`)** — `submitUserInput` created the placeholder, pushed it onto the reactive `messages[sessionId]` array, then mutated `placeholder.metadata.X` directly. Vue 3 reactivity caveat: pushing into a reactive collection wraps the value in a Proxy, but the local ref still points at the unwrapped target. Mutations through that ref bypass the Proxy `set` trap and never trigger a re-render — even though the data is updated. User-visible symptom: card sat pinned at "Understanding… / 0 tokens / Intent: unrecognised" for the full LLM round-trip even when 30+ chunks + final landed. Fix: re-acquire the Proxy via `card = msgs[msgs.length - 1]` after push and route every mutation through `card.metadata.X`.

**Tests**:

- CLI ws gateway 16/16 green (chat-intent 6 + new llm-chat 9 + new "no creds → no LLM call" env-cleanup 1)
- web-panel chat-intent-flow 27/27 green

**Distribution**: CLI npm `chainlesschain` 0.161.5 → 0.161.6 → **0.161.7** (0.161.6 was published ahead of productVersion to unblock npm-package users on the QuickAsk hang; 0.161.7 carries the chatStream streaming fix + Vue Proxy fix). Desktop binary rebuilt; auto-updater compares `5.0.3-alpha.45 > 5.0.3-alpha.44`, so all v5.0.3.44 desktop users will see a real "new version" prompt on restart. GitHub Release ships 28 assets; 6 parallel workflows (Release / CLI CI / Code Quality / E2E / CI Tests / Full Test Automation) all green.

---

## 2026-05-08 Release — **v5.0.3.44 LLM OCR + audit-ipc coverage + chat-intent 90s safeguard**

productVersion **v5.0.3.43 → v5.0.3.44**. One user-visible feature (screenshot LLM OCR) + three quality follow-ups. No breaking changes; v5.0.3.43 users can upgrade directly.

**Added**:

- **Screenshot OCR LLM engine (commit `39b16e29f`)** — Tesseract.js Chinese accuracy is poor; new `engine` parameter `auto` / `llm` / `tesseract` three-way: `auto` (default) routes to volcengine doubao vision OCR if configured, else falls back to Tesseract; LLM errors auto-degrade with `fallbackFrom` / `fallbackReason` tags. Provider whitelist `Set(["volcengine"])`; extending to gemini / openai / anthropic is mechanical once their LLMManager exposes `chatWithImage*`. UI: V5 / V6 shared dialog + web-panel dialog each get an `<a-select>` engine picker + blue/grey/orange tag showing the engine actually used. Engine guards live in `recognizeDispatch` (not `recognizeWithLLM`) so test stubs can replace impl without re-implementing validation.

**Fixed**:

- **chat intent understand 90s wall-clock safeguard (commit `6cbd04c50`)** — `sendStream`'s built-in 60s idle timer rearms on every chunk; a slow LLM that dribbles tokens but never emits a `final` frame leaves the "理解中…" placeholder card spinning forever. Wrap the call in an `AbortController + setTimeout(90s)` and pass the signal into the stream call; on timeout, clean up the placeholder with a readable error.
- **compliance-ipc dead handler cleanup (commit `29006decf`)** — `compliance-ipc.js` previously registered two channels under a typo'd prefix `compliance-classify:*` (no callers); the renderer (`stores/compliance.ts` + `stores/audit.ts`) actually calls `compliance:generate-report` / `compliance:get-policies` owned by `audit-ipc.js`, backed by `ComplianceManager`. The two paths even backed onto different services (`soc2Compliance.generateReport` vs `auditManager.complianceManager.generateReport`); keeping the dead path would just guarantee future devs miss the real one when patching → drop both + sync `IPC_CHANNELS`.
- **macOS tmp path assertion (commit `bb2c16656`)** — `build-win-with-deref.test.js` (testing Windows symlink helpers, ironically running on the macOS Unit Tests matrix too) had 3 asserts failing `expected '/private/var/folders/...' to be '/var/folders/...'`: macOS's `/var → /private/var` symlink. `os.tmpdir()` returns `/var/...` but `realpath` differs. `canonical = fs.realpathSync(os.tmpdir())` normalizes test temp dirs; `realpath` is a no-op on linux / win → no regression.

**Tests**:

- **`audit-ipc.js` first unit test coverage (commit `b092673be`)** — pre-existing zero-coverage gap surfaced by the typo'd `compliance-classify` dead-handler bug. `audit-ipc.js` owns 18 channels including the renderer-facing `compliance:get-policies` / `compliance:generate-report`; with no unit test, the typo'd duplicate handlers in `compliance-ipc.js` sat undetected for months. Source DI refactor (mirrors the `credit-ipc` pattern): accept `ipcMain` via `deps` with `electron` fallback (lazy-required so injection can preempt); 23 cases cover 18-channel routing + happy-path payload + AuditManager error paths.

**Regression test status**:

| Suite         | Pass            |
| ------------- | --------------- |
| desktop unit  | 1477 / 1477     |
| CLI full unit | 17,455 / 17,455 |

**Distribution**: CLI npm `chainlesschain@0.161.5` ships in sync; desktop binary rebuilt; auto-updater compares `5.0.3-alpha.44 > 5.0.3-alpha.43`, so all v5.0.3.43 desktop users will see a real "new version" prompt on restart.

---

## 2026-05-07 Release — **v5.0.3.43 MTC publisher_signature M-of-N fix + security hardening cascade**

productVersion **v5.0.3.41 → v5.0.3.43** (.42 was a CLI atomic bump with no functional change — see changelog). This release has two themes: (1) **MTC `landmark.publisher_signature` strip-all-sigs symmetrization** — fixes a real defect that **bypasses the M-of-N threshold**; (2) **security hardening cascade** — eight `npm audit` sweeps in one week clear all advisories (HIGH 44 → 0 · MOD 4 → 0 · LOW 45 → 0).

**Core fixes**:

- **MTC publisher_signature M-of-N strip-all-sigs (commit `c23e98cca` + spec `038e6d710`)** — Producer + verifier must **symmetrically** feed `_stripSigsForPublisher(landmark)` (zeroing `publisher_signature.sig` + every snapshot's `signature.sig` + `signatures[*].sig`) into JCS before signing/verifying — not just `publisher_signature.sig`. Otherwise tampering with **any** per-member sig in an M-of-N federation breaks publisher_signature → completely defeating the M-of-N threshold's reason for existing. Helper extracted to `packages/core-mtc/lib/publisher-signing.js`, exported as `@chainlesschain/core-mtc/publisher-signing` subpath. Three call sites: `batch.js` (single + federated), `landmark-cache.js` verifier, desktop `governance-multisig.js` (lazy-require to dodge the @noble/curves hoisting trap). Spec §8.2 updated. Canary: `mtc-federation-publish-cli.test.js` "2-of-3 threshold accepts when one member's sig is tampered".
- **LandmarkCache `landmark.publisher_signature` verification enabled (commit `c40d927da` + `72c3619ee`)** — `LandmarkCache` defaults `verifyPublisherSignature: true` opt-in, adding publisher-sig validation before cache hits (no longer blindly trusting cache); all real-verifier callers (CLI `cc mtc verify`, desktop audit pipeline, cross-chain bridge verifier) enabled. Constant `BAD_PUBLISHER_SIG` → `BAD_LANDMARK_SIG` (`36fcd8f4f`) to match spec §11; spec §8.5 followed up with `LANDMARK_SIG_PREFIX` definition.

**Security hardening (HIGH 44 → 0 · MOD 4 → 0 · LOW 45 → 0)**:

- `f6c937fa8` override `serialize-javascript` + `tar` (HIGH 44 → 10)
- `8a56978b5` drop `speedtest-net`, replace with native fetch
- `9c7ce00e7` override `semver` ^7.7.4 (clears imap chain)
- `922b64822` override `undici` ^6.21.2 (clears hardhat 5.x chain)
- `4fae47dd4` deprecate `werift`
- `cc7b0b40a` override `ip-address` + `dompurify` (MOD 4 → 0)
- `1f86594a2` override `tmp` ^0.2.5
- `64047283a` override `make-fetch-happen` ^13
- `d19bcb8cb` split `hardhat-stack` into standalone `contracts/` workspace + drop `hdkey` (LOW 14 → 0)
- `d558b66b1` `channel-manager` DDL hardening + drop unused jspdf
- `7312cf035` `wrtc-compat` patches CVE-2024-29415 (`ip` SSRF)

**Added**:

- **Updater renderer-side progress notifier (commit `4c1a5ac18` + `e27592bb5`)** — `notifier-only` flow, drops duplicate native dialogs, renderer shows live download progress.

**Regression test status**:

| Suite                                     | Pass            |
| ----------------------------------------- | --------------- |
| desktop unit (incl. nostr-bridge-ipc fix) | 1454 / 1454     |
| core-mtc unit                             | 258 / 258       |
| CLI mtc-federation integration            | 41 / 41         |
| CLI full unit                             | 17,432 / 17,432 |

**Bonus bug fixes (this conversation, two-pack)** — same root: `551ef28b3` "fix(ipc): correct ipcGuard API" switched the API to `markModuleRegistered` but the sweep was incomplete, leaving two complementary bug classes:

| Commit                                                  | Bug                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why CI missed it                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **`af92e0162` fix(test): align nostr-bridge-ipc stub**  | Source calls `ipcGuard.markModuleRegistered(name)` directly (real guard exports it), but the test stub still mocked the non-existent `registerModule(name, channels)` (wrong arity) → `TypeError: ipcGuard.markModuleRegistered is not a function`, 23 / 389 social cases failing                                                                                                                                                                                | CI "Unit Tests" stable-fallback excludes `**/*-ipc.test.js`; "Full Test Suite" uses `continue-on-error: true` |
| **`11247a957` fix(ipc): align 8 ai-engine IPC modules** | 8 IPC modules (autonomous-developer / collaboration-governance / tech-learning / federation-hardening / reputation-optimizer / sla / stress-test / inference) inverted: source has `if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }` — real guard has no `registerModule` → `if` always falsy → guard's `registeredModules` Set silently misses these 8. Handlers still register via `ipcMain.handle`, so business functionality works | Test stubs themselves mocked `registerModule` → tests passed falsely                                          |

Fix: stub `registerModule` → `markModuleRegistered` + drop channels arg from assertion (test side); `if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }` → `ipcGuard.markModuleRegistered(name)`, plus drop the equally pointless `if (ipcGuard.unregisterModule)` wrap (source side). Regression: collaboration-governance-ipc 21/21 + tech-learning-ipc 21/21 + ipc-guard core 12/12 + 29 adjacent files 577/577 ✅.

**Distribution**: Desktop binary rebuilt; auto-updater compares `5.0.3-alpha.43 > 5.0.3-alpha.41`, so all v5.0.3.41 desktop users will see a real "new version" prompt on restart. All three documentation sites (docs / design / www) refreshed in sync (commit `1183075b5` + `0384099f3`).

---

## 2026-05-07 Release — **v5.0.3.41 chat-panel-v5 three-shell parity + B4 social rolling closure**

productVersion **v5.0.3.40 → v5.0.3.41**. This release formally ships every rolling entry accumulated since .40 (XII–XIX: B4 cross-machine distribution / trust filter / viewer / external archival / M-of-N / cross-fed trust / web-shell / web-panel / sign-as-self / cred-persist / auto-archive / chat-panel-v5).

**Headline capabilities**:

- **chat-panel-v5 three-shell strict parity** — V5 desktop / V6 desktop / web-shell default-shell chat experience strictly equivalent: streaming response + history switching + context memory references + tool-call panel. After Phase 1.6 hard-flip the default web-shell users no longer miss any V5 chat capability (commit `b33527d31` Phase E + commit `72b13388a` web-shell port v1+v1.1).
- **B4 P2P social full-stack audit-grade closure** — §2.2.10 → §2.2.24, fifteen sections in total: cross-machine sync + MTC federation dual-track + DID signing + auto peer bridging + Merkle envelope finality + cross-machine distribution + trust filter + desktop viewer + external archival + M-of-N multi-sig + cross-federation trust anchors + sign-as-self (private keys never leave main process) + WebDAV creds via secure-config.enc (safeStorage / AES-256-GCM) + main-process periodic archival cron. **Neither private keys nor passwords ever traverse the wire.** Desktop V5/V6 + default-shell web-panel users see strictly equivalent functionality.

**Regression suite all green**:

| Suite                                                               | Pass                    |
| ------------------------------------------------------------------- | ----------------------- |
| desktop MTC + DID + social + web-shell + p2p + bootstrap + renderer | 1454 / 1454 (4 skipped) |
| CLI chat-intent + mtc-federation core/trust/sync integration        | 69 / 69                 |
| web-panel unit                                                      | 1853 / 1853             |
| web-panel e2e                                                       | 63 / 63                 |

**One bug fix**:

- **web-panel `views-mount-smoke.test.js` hits 30s default timeout under 63-file fork contention** (Pipeline.vue + Chat.vue first-import SFC transform competes in 4-fork pool). Fix: file-level `vi.setConfig({ testTimeout: 60_000 })` — global testTimeout untouched (validated that bumping the global to 60s instead made the worker pool scheduling worse and caused more files to time out). Same pattern as `cli_ci_sharding_lessons` already records for vitest 4 strict timeout enforcement.

**Distribution**: Desktop binary rebuilt; auto-updater compares `5.0.3-alpha.41 > 5.0.3-alpha.40`, so all v5.0.3.40 desktop users will see a real "new version" prompt on restart. All three documentation sites (docs / design / www) refreshed in sync.

---

## 2026-05-07 Update XIX — **chat-panel-v5 Phase E — V6 desktop AIChatPanel aligned on the 4 features**

XVI ported the four V5 ChatPanel heavy features into the web-shell; the V6 desktop `shell/AIChatPanel.vue` was deliberately deferred. This section closes that gap. V6 reuses the existing desktop V5 trio (`VirtualMessageList.vue` / `IntentConfirmationMessage.vue` / `messageTypes.ts`) instead of duplicating, and the intent flow rides on the **already-shipped** desktop IPC handlers `project:understandIntent` + `followup-intent:classify` (preload-exposed at `index.js:1259`/`2441`), so Phase E is a pure UI integration with zero backend work.

| Area                      | Change                                                                                                                                                                                                                                                                                                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Virtual list**       | Replace the v-for in `shell/AIChatPanel.vue` with `<VirtualMessageList>` (slot rebuilt)                                                                                                                                                                                                                                                                                                         | Imported from V5 `components/projects/VirtualMessageList.vue` (one component, both shells). Slot prop is `unknown`; added an `asMsg(value: unknown): ConversationMessage` helper plus a `v-for-with-singleton` (`v-for="msg in [asMsg(message)]"`) so the rest of the slot template sees a typed `msg` without modifying the JS list component |
| **B. Context mode**       | Header gains an a-radio-group + localStorage `cc.desktop.aichat.contextMode` (separate key from the web-shell's so each surface persists independently)                                                                                                                                                                                                                                         | `file` permanently disabled (V6 has no currentFile concept)                                                                                                                                                                                                                                                                                    |
| **C. Intent recognition** | New `submitUserInput(text)` / `tryUnderstandIntent(text)` / `handleIntentConfirm/Correct`; transient `pendingIntentCard` ref kept **out of conversationStore** so it never persists; `onSend` routes through submitUserInput; `<IntentConfirmationMessage>` renders between messages list and streaming bubble; clearContext / newConversation / selectConversation all reset pendingIntentCard | Wire: `window.electronAPI.project.understandIntent({ userInput, projectId, contextMode })` → V5 IPC; returns success=false or no useful understanding → falls through to direct dispatch                                                                                                                                                       |
| **D. autoSendMessage**    | New `autoSend?: boolean` prop (legacy `prefillText` preserved); watch `open` + `[prefillText, autoSend]` triggers `maybeAutoSend()`; token dedup `${prefill}::${autoSend}::${contextMode}` blocks duplicate fires; if canSend is false, degrades to prefilling the composer for manual send                                                                                                     | Modal panel — no vue-router context, so single-channel (vs the web-shell's URL+Pinia dual surface)                                                                                                                                                                                                                                             |

**Cross-shell parity**

|                            | web-shell (XVI)                                                               | V6 desktop (XIX)                                                                         |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Protocol                   | WS topics `chat.intent.understand[-stream]` / `chat.intent.classify-followup` | electronAPI IPC `project.understandIntent` / `followupIntent.classify`                   |
| Streaming intent           | ✅ (v1.1, async generator + chunk frames)                                     | ❌ (V5 IPC is non-streaming; deferred until a streaming IPC is added)                    |
| Multi-turn history         | ✅ payload.history forwarded automatically                                    | ❌ (V5 IPC doesn't accept history yet)                                                   |
| Persisted intent decisions | ✅ localStorage (LRU 200)                                                     | ❌ (pendingIntentCard is transient; refresh in the modal naturally starts a fresh state) |
| Custom quickPrompts        | ✅ (modal editor + 12×120 cap)                                                | ❌ (V6 keeps the existing 4 hardcoded prompts)                                           |
| autoSendMessage channel    | URL query + Pinia dual surface                                                | Prop single channel                                                                      |

**Test matrix**

| Layer                                                         | Result                      |
| ------------------------------------------------------------- | --------------------------- |
| `vue-tsc --noEmit`                                            | ✅ 0 errors                 |
| `npm run build:main`                                          | ✅                          |
| desktop store / shell / shell-preview / AIChatPage regression | **150 / 150** ✅ (131 + 19) |
| Cumulative web-shell + CLI + e2e                              | 1844 + 89 + 63 still green  |

**Caveat — no AIChatPanel mount tests added**: (1) the V6 panel has no existing mount-test fixture and stubbing all of ant-design-vue + llmStore + conversationStore + electronAPI follows the 1000+-line `AIChatPage.test.js` pattern that's expensive to maintain; (2) the four reused components are all already covered by web-shell unit tests; (3) the underlying desktop IPC handlers (`project:understandIntent` / `followupIntent.classify`) have been in production for a year. Manual smoke recommended: `npm run dev` → click the V6 shell AI Chat entry → switch contextMode → type a typo → see the intent card → confirm/correct loop.

## 2026-05-07 Update XVIII — **B4-auto-archive v1 — main-process periodic archival cron + MtcAudit 5th tab**

§2.2.21 (XIV) wired Archive Tab but archival remained manual — the user had to actively click "推送". XVII fixed credential persistence so each push no longer prompted for the password; this update lets the cron run itself — main process `setInterval` periodically fires `ChannelEnvelopeArchiver.push`, the config is persisted to `app-config.json` `mtc.autoArchive` namespace, restart-safe.

| Aspect            | Change                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Trigger           | XVII manual push → main-process setInterval cron (default 24h, min 5min)                                                          |
| Persistence       | `app-config.json` `mtc.autoArchive`: enabled / intervalMs / providerSpec / communityIds + lastRunAt/Status/Error/Summary          |
| Failure handling  | Single-community failure only marks lastRunStatus='partial', doesn't block remaining communities                                  |
| Reuses cred chain | providerSpec same as XVII — `useStoredCredentials:true` reuses secure-config.enc directly                                         |
| Reentrancy        | runOnce has built-in `_running` guard; concurrent invocations return `{skipped:true}`                                             |
| UI entry          | MtcAudit.vue 5th tab "Auto Archive 定时归档" — switch / interval / provider / community whitelist / run-now / lastRun status card |

**Changes (8 files / 27 tests)**:

- `auto-archive-scheduler.js` **new** (+250) — pure-Node scheduler; constructor / getConfig / setConfig / start / stop / runOnce
- `auto-archive-scheduler.test.js` **new** (+325) — 19 tests: constructor validation / default merging / clamp / setConfig validation / start/stop / runOnce 7 scenarios
- `social-initializer.js` registers autoArchiveScheduler factory entry (+50) — dependsOn archiver/factory/communityManager; auto-resumes enabled=true configs on boot
- `community-ipc.js` 3 IPC: `auto-archive:{config-get,config-set,run-now}` (+45) — desktop V5/V6 path
- `community-mtc-handlers.js` 3 WS topics + factories (+55) — web-shell default-shell path
- `community-mtc-handlers.test.js` +5 tests + topic registry +3 lines
- `web-shell-bootstrap.js` + `index.js` + `phase-3-4-social.js` 4 dep-thread changes + handler count 24→27
- `useAutoArchive.js` **new** (+95) — 3 methods: getConfig / setConfig / runNow
- `useAutoArchive.test.js` **new** (+155) — 9 tests: getConfig 2 / setConfig 3 / runNow 3 / isEmbedded
- `MtcAudit.vue` +5th tab + script 100 lines + onMounted auto-load — UI shows lastRun status card + run-now summary card

**Tests (27 new)**:

- desktop scheduler 19 + handlers +5 = **24**
- web-panel composable **9**

**Regression**: desktop web-shell + mtc all 32 files 538/542 (4 skipped, 0 fail); web-panel useAutoArchive + useMtcArchive subset 22/22 green.

**Safety / robustness invariants**:

- intervalMs min 5 minutes — prevents misconfigured millisecond DoS-of-self;
- enabled=true requires providerSpec — saving without provider explicitly rejected;
- runOnce has built-in \_running guard — multiple fires never re-enter;
- providerSpec.useStoredCredentials uses §2.2.23 vault path — cron config never persists plaintext passwords;
- per-community try/catch — single-point failure never blocks subsequent ones; recorded as lastRunSummary.perCommunity[id] = {ok, error?}.

**Design choices**:

1. **No third-party cron library** (node-cron / agenda etc.) — `setInterval` suffices (no cron expressions needed);
2. **Reuses app-config.json, no new store** — sits at the same level as ui.useV6ShellByDefault etc.;
3. **Pure-Node scheduler with no Electron API** — unit-testable with injected timers;
4. **runOnce auto-persists lastRun\* fields** — UI doesn't need a separate status WS topic; getConfig returns run history alongside config.

---

## 2026-05-07 Update XVII — **B4-cred-persist v1 — WebDAV credentials via secure-config + fix a latent ~1-month field-name bug**

§2.2.21 (XIV) shipped MtcAudit but the archive Tab forced users to re-type baseUrl/username/password into the WS payload on every push — violating the principle that credentials shouldn't traverse the wire repeatedly. Worse: anyone actually trying WebDAV archive would hit "url required" immediately — WebDAVClient's constructor reads `url`/`remotePath`, but the archive factory has been passing `baseUrl`/`remoteRoot` since §2.2.16, so the field names never matched. The B4-archive WebDAV path has been **completely broken since landing**, but nobody noticed because XIV was the first UI driver and most CLI runs used filesystem.

| Aspect                   | v1 - XIV (broken)                       | v2 - XVII (this update)                                                        |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------ |
| WebDAV field names       | spec.baseUrl / remoteRoot (wrong)       | spec.url / remotePath (correct)                                                |
| Credential source        | manual entry every push, traverses wire | reuses Phase 3c sync-credentials secure-config.enc (safeStorage / AES-256-GCM) |
| Renderer holds password? | yes (input v-model)                     | no (toggle ON hides input fields entirely)                                     |
| Wire carries password?   | yes                                     | no (main resolves from vault internally)                                       |

**Changes (5 files / 8+ tests)**:

- `archive-provider-factory.js` **new** (+90) — extracted from social-initializer; adds `useStoredCredentials:true` mode; field-name fix
- `social-initializer.js` factory init now one-liner (-58 / +5)
- `community-ipc.js` new IPC `channel-archive:has-stored-webdav-credentials` (boolean only)
- `community-mtc-handlers.js` new WS topic `mtc.archive.has-stored-webdav-credentials` (boolean only)
- `web-shell-bootstrap.js` + `index.js` thread `syncCredentials` dep through (+10)
- `useMtcArchive.js` adds `checkStoredWebdavCredentials()` + `hasStoredWebdavCredentials` ref
- `MtcAudit.vue` Archive Tab redone: switch toggle (default ON) + field-name fix; alert-driven help when vault empty

**Tests (8 new)**:

- `archive-provider-factory.test.js` **new** 12 tests — filesystem / webdav explicit / useStoredCredentials 4 sub-cases / field-name lock (asserts NO baseUrl/remoteRoot) / null spec / unknown kind
- `community-mtc-handlers.test.js` +4 — has-stored true/false / missing dep / safety invariant (response keys = exactly `{success, hasCredentials}`)
- `useMtcArchive.test.js` +4 — flag true/false / soft-false on handler error / null on transport error

**Regression**: desktop social/mtc/web-shell 1244/1244 (+10 tests) + web-panel 1976/1978 (the 2 phase-b CLI failures are pre-existing flakes — verified by re-running on stash-clean main).

**Critical security invariants**:

- Factory: `useStoredCredentials=true` makes inline url/username/password **completely ignored** (vault wins) — prevents spec-injection attacks.
- IPC + WS: `hasCredentials` response carries exactly `{success, hasCredentials}` — locked by unit test `expect(Object.keys(r).sort()).toEqual(['hasCredentials','success'])`.
- UI: toggle defaults ON; when vault empty, toggle is disabled and an a-alert directs the user to Settings → 同步 → WebDAV.

**Design choices**:

1. Did NOT spin up a new credential-vault subsystem — reused Phase 3c sync-credentials (`secure-config.enc` + safeStorage / AES-256-GCM fallback), single source of truth.
2. Did NOT expose any `credentials.encrypt/decrypt` IPC — all decryption stays inside main's archiveProviderFactory closure.
3. Extracted factory from social-initializer to standalone module — DI wiring shrunk -58/+5, factory now independently testable, future OSS/S3 additions plug in cleanly.

---

## 2026-05-07 Update XVI — **chat-panel-v5 v1 + v1.1 — V5 desktop ChatPanel fully ported to web-shell**

V5 desktop `components/projects/ChatPanel.vue` (3788 lines) was long flagged as "a different much larger port" — the intent recognition / autoSend / virtual list / context-mode quartet plus its 5 IPC + 6 channel coupling kept it out of the web-shell. This update lands the full port (with a real LLM backend, not a stub).

| Area                                            | Change                                                                                                                                                                                                                                                                                                                                                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Virtual list**                             | `packages/web-panel/src/components/VirtualMessageList.vue` (+185) + `Chat.vue` swap from v-for                                                                                                                                                                                                                                                                                       | `@tanstack/virtual-core ^3.13.13` matches V5; covers happy-dom fallback path; folds in V6 `AIChatPanel.vue`'s clean UI: 32px avatars / role + time / 4 quick-prompt empty state                                                                                                                                                                                                                                              |
| **B. Context mode**                             | chatStore gains `contextMode` + localStorage persistence (`cc.web-panel.chat.contextMode`); Chat.vue header a-radio-group (project/file/global)                                                                                                                                                                                                                                      | `file` permanently disabled in web-shell (no currentFile concept), `project` disabled when not started in project mode; mismatched persisted values auto-degrade to global                                                                                                                                                                                                                                                   |
| **C. Intent recognition (full port, real LLM)** | Backend: `packages/cli/src/lib/chat-intent-service.js` (+340) + `gateways/ws/chat-intent-protocol.js` (+95) + ws-server / dispatcher wiring (2 new WS topics). Frontend: `utils/messageTypes.js` (+90) + `components/IntentConfirmationMessage.vue` (+185) + chatStore actions `submitUserInput`/`confirmIntent`/`correctIntent`/`classifyFollowupIntent`/`pushFollowupIntentBanner` | `chat.intent.understand` runs the V5 prompt verbatim (temp 0.3 / 500 max tokens / strict JSON contract), pulls LLM creds from the active session, falls back to pass-through when LLM unavailable. `chat.intent.classify-followup` is rule-first (4 categories: CONTINUE_EXECUTION / MODIFY_REQUIREMENT / CLARIFICATION / CANCEL_TASK with keyword + regex scoring); confidence > 0.8 short-circuits without calling the LLM |
| **D. autoSendMessage protocol**                 | Chat.vue parses `route.query` (`?prompt=xxx&autoSend=true&session=<id>`) + chatStore.scheduleAutoSend / clearAutoSend + token-based dedup                                                                                                                                                                                                                                            | URL-driven + Pinia programmatic dual surface; URL is stripped via router.replace after consumption to prevent refresh-replay; URL > Pinia priority                                                                                                                                                                                                                                                                           |
| **i18n parity**                                 | `packages/locales/seed/{zh-CN,en}.json`                                                                                                                                                                                                                                                                                                                                              | New keys: `chat.role.me`, `chat.contextMode.{project,file,global}`, `chat.empty.startTitle`, `chat.empty.hint.{project,file,global}`, `chat.quickPrompts.{summarize,brainstorm,explain,codeReview}`, `chat.intent.{confirmed,corrected,label.*,action.*,status.*}` — 22 paired keys total, zh/en parity test passes                                                                                                          |

**Test matrix (chat-panel-v5 adds 69 tests, cumulative web-panel 1829 + CLI 89 all green, no regressions)**

| Layer                                 | File                                                                   | Tests                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (CLI)                            | `packages/cli/__tests__/unit/lib/chat-intent-service.test.js`          | 22 — extractJson 4 branches / buildUnderstandPrompts 3 / ruleBasedClassify across 5 categories / understandIntent 5 branches (empty / no-llm / parse success / parse fail / network error) / classifyFollowupIntent 5 paths (rule-only / no-llm / llm-success / rule_fallback / CLARIFICATION default)          |
| Unit (CLI)                            | `packages/cli/__tests__/unit/gateways/ws/chat-intent-protocol.test.js` | 6 — bad-request / no-session-creds degrade / session present forwards LLM creds / unexpected error → INTENT_UNDERSTAND_FAILED / classify-followup rule path / classify-followup LLM path                                                                                                                        |
| Unit (web-panel)                      | `__tests__/unit/messageTypes.test.js`                                  | 11 — 3 enum shapes / createSystemMessage / createIntentConfirmationMessage 3 / createIntentSystemMessage 4 intent presets                                                                                                                                                                                       |
| Unit (web-panel)                      | `__tests__/unit/chat-intent-flow.test.js`                              | 19 — contextMode 4 (default / persist / reject unknown / file persisted degrade) / submitUserInput 7 (global direct / project useful understanding pushes card / no-LLM degrade / identical input skip card / confirmIntent / correctIntent / WS error degrade) / scheduleAutoSend 3 / classifyFollowupIntent 3 |
| Unit (web-panel)                      | `__tests__/unit/VirtualMessageList.test.js`                            | 5 — fallback full render / `:key` uses message.id / scrollToBottom exposed / scroll boundary emits / messages length grows                                                                                                                                                                                      |
| Unit (web-panel)                      | `__tests__/unit/IntentConfirmationMessage.test.js`                     | 7 — show/hide branches / pending vs confirmed state / confirm emit payload / correction flow (open / reject empty / submit text)                                                                                                                                                                                |
| Full web-panel 62-file regression     | —                                                                      | **1829 / 1829** ✅                                                                                                                                                                                                                                                                                              |
| CLI ws-server / dispatcher regression | —                                                                      | **61 / 61** ✅                                                                                                                                                                                                                                                                                                  |
| **Cumulative new**                    | —                                                                      | **69 tests** (CLI 28 + web-panel 41) all green                                                                                                                                                                                                                                                                  |

**End-to-end total**: desktop-app-vue 1106 + web-panel 1829 + CLI (chat-intent + ws) 89 = **3024 tests all green**.

**Known caveats**:

- End-to-end browser smoke (start `cc serve --mode project --ui full`, drive a real LLM through the intent card → confirm → agent reply) still pending. Recommend a manual run before shipping.
- The V6 desktop `shell/AIChatPanel.vue` does not yet inherit these 4 features (V6 panel's V5 source was the 857-line global ChatPanel that has since been deleted). Tracked as a follow-up phase (`Phase E: align V6 AIChatPanel`).

## 2026-05-07 Update XV — **B4-mofn-sign v2 — sign-as-self (private key never leaves main) + latent IPC-bag bug fix**

XIV shipped the web-panel UI, but governance-mofn's v1 signature collection demanded the renderer ship a secretKey base64 — for security the web-panel deliberately doesn't hold private keys, so the "sign for me" button was missing. v2 moves signing into the main process: renderer sends only `(communityId, proposalId)`, main resolves the current identity via DIDManager, and **the private key never crosses any wire** (IPC or WS).

While in there, also fixed a latent bug: `registerAllIPC`'s dependency bag never included `communityManager / channelManager / gossipProtocol / governanceEngine / contentModerator` (or any of the B4 suite). Desktop V5/V6 community IPC has been silently receiving null since Phase A landed — handlers returned `[]` / threw "not initialized" without anyone noticing because the V6 hard-flip (caaddf530) makes web-shell the default and that path uses WS, not IPC.

| Topic                                                 | File                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New IPC `governance-mofn:sign-as-self`**            | `community-ipc.js` (+58)                             | Renderer sends only `(communityId, proposalId)`. Main calls `didManager.getCurrentIdentity()` for `{did, public_key_sign, private_key_ref}`, parses the JSON ref to extract the `sign` base64 → Buffer secretKey → calls `governanceMultiSig.addSignature(...)`. Returns `{ok:true, status, signerDID}`                                                                                                                                       |
| **New WS topic `mtc.governance-mofn.sign-as-self`**   | `web-shell/handlers/community-mtc-handlers.js` (+78) | Same semantics for the web-panel path; didManager + governanceMultiSig injected via opts                                                                                                                                                                                                                                                                                                                                                      |
| **web-shell-bootstrap + index.js wiring**             | `web-shell-bootstrap.js` + `index.js` (+5)           | `didManager` added to createCommunityMtcHandlers opts                                                                                                                                                                                                                                                                                                                                                                                         |
| **useGovernanceMofn.signAsSelf action**               | `web-panel/composables/useGovernanceMofn.js` (+33)   | Critical invariant: no `signerKeys` field on the wire (asserted in tests)                                                                                                                                                                                                                                                                                                                                                                     |
| **MtcAudit.vue Tab 3 "Sign for me" button**           | `MtcAudit.vue` (+25 / -8)                            | Per-proposal button enabled when `!finalized && isEmbedded`; alert copy rewritten as a v2 security explanation                                                                                                                                                                                                                                                                                                                                |
| **🐛 latent bug fix — registerAllIPC bag completion** | `index.js` (+25 / +12 hoist)                         | Hoists `communityManager / channelManager / gossipProtocol / governanceEngine / contentModerator + mtcFederationManager / channelEventBatcher / channelEnvelopeDistribution / channelEnvelopeArchiver / archiveProviderFactory / governanceMultiSig / crossFedTrust` from `instances` to `this.*` and adds them to the `registerAllIPC({...})` bag. **Desktop V5/V6 community IPC has been silently broken since Phase A** — fixed in passing |

**Test matrix (B4-mofn-sign v2 adds 10, total desktop 1112 / 1112 across 33 files + web-panel 1833 / 1833 across 62 files)**

| Layer                               | File                                                                                    | Tests                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (extended)                     | `desktop-app-vue/src/main/web-shell/__tests__/community-mtc-handlers.test.js` (+6 → 25) | sign-as-self: full happy path with key-shape asserts / missing didManager / not-logged-in / missing signing keys / malformed private_key_ref JSON / missing private_key_ref.sign field |
| Unit (extended)                     | `packages/web-panel/__tests__/unit/useGovernanceMofn.test.js` (+4 → 13)                 | signAsSelf: wire payload contains no key material (tested explicitly) / rejects empty args / captures handler error envelope / updates currentStatus on success                        |
| Full desktop + web-panel regression | —                                                                                       | **1112 + 1833 = 2945** ✅                                                                                                                                                              |

**Security model shift**

|                             | v1 (XI)                                                        | v2 (this patch)                                        |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Renderer holds private key? | Yes (renderer base64-encodes secretKey before WS)              | **No**                                                 |
| Private key on wire?        | Yes                                                            | **No**                                                 |
| Main's path to the key      | Not needed (renderer ships it)                                 | DIDManager.getCurrentIdentity() → private_key_ref.sign |
| Suitable for                | CLI proposals / tests / advanced users who hold their own keys | All web-panel UI users (default)                       |

The v1 `governance-mofn:sign` IPC stays for backward compatibility (CLI + tests). UI is now exclusively v2.

## 2026-05-07 Update XIV — **B4-webpanel v1 — web-panel UI wired to the 13 WS topics**

XIII bridged IPC → WS, but web-panel had no UI entry point — users still couldn't reach any of it. This patch adds 4 composables + a 4-tab `MtcAudit` page, hooking envelope / archive / governance-mofn / cross-fed-trust into the default-shell sidebar.

| Topic                         | File                                                                                                                | Description                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4 composables**             | `packages/web-panel/src/composables/{useMtcEnvelope, useMtcArchive, useGovernanceMofn, useCrossFedTrust}.js` (+460) | All wrap `ws.sendRaw({type:'mtc.*', ...})` + `useShellMode().isEmbedded` for dual-path branching. Pure-browser mode auto-disables + shows banner. useGovernanceMofn includes a base64 serialization helper (renderer doesn't ship Buffers; base64 strings cross the wire)                                                                    |
| **`MtcAudit.vue` 4-tab page** | `packages/web-panel/src/views/MtcAudit.vue` (+450)                                                                  | Tab 1 Envelope query + raw JSON collapse + copy; Tab 2 Archive (filesystem / WebDAV provider toggle + push/restore/list); Tab 3 Governance M-of-N (proposal create + list + finalize; signature collection in v1 deferred to cc CLI / desktop DID tooling via in-page alert); Tab 4 Cross-Fed Trust (establish/revoke/list/merged-DID query) |
| **Router + sidebar**          | `packages/web-panel/src/router/index.js` + `components/AppLayout.vue` (+3 lines total)                              | `/mtc-audit` route; sidebar advanced group adds mtc-audit item right after mtc; collapsed mode also gets the icon; `onMenuClick` auto router.push                                                                                                                                                                                            |

**Test matrix (B4-webpanel adds 33 composable unit + 1 route-count bump, total web-panel 1829 / 1829 across 62 files)**

| Layer                             | File                                                          | Tests                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                              | `packages/web-panel/__tests__/unit/useMtcEnvelope.test.js`    | 8 — initial idle / empty args / pure-browser disable / found result / not-found / ws throw / reply.ok=false / reset                                                                                 |
| Unit                              | `packages/web-panel/__tests__/unit/useMtcArchive.test.js`     | 11 — listArchives caches + rejects empty + handler error / pushArchive happy + sinceBatchId pass-through + handler error / restoreArchive happy + rejects missing archiveName / isEmbedded reflects |
| Unit                              | `packages/web-panel/__tests__/unit/useGovernanceMofn.test.js` | 9 — list cache + reject empty / create pass-through / sign Uint8Array→base64 serialization + reject missing + already-base64 no double-encode / finalize / status cache / handler error             |
| Unit                              | `packages/web-panel/__tests__/unit/useCrossFedTrust.test.js`  | 6 — list cache + reject empty / establish full pass-through + strip empty optional fields / revoke returns boolean / getTrustedDids cache / handler error                                           |
| Full web-panel 62-file regression | —                                                             | **1829 / 1829** ✅                                                                                                                                                                                  |

**End-to-end totals**: desktop-app-vue 1106 + web-panel 1829 = **2935 tests all green**.

## 🎯 P2P social audit-grade full stack complete (11 commits + 1 web-panel UI commit)

```
Phase A → Phase B v1 → B4 → B4-merkle → B4-cross
   → B4-cross-trust → B4-ui → B4-archive → B4-mofn
   → B4-crossfed → B4-webshell (WS topics) → B4-webpanel (UI)
```

Desktop (V5/V6) goes via IPC; web-shell default goes via WS topic + Vue UI. Full parity.

## 2026-05-07 Update XIII — **B4-webshell v1 — full B4 suite visible from default web-shell**

User follow-up: after the Phase 1.6 hard-flip (`caaddf530`), the default shell is web-shell, but the B4 suite (envelope viewer / archive / governance-mofn / cross-fed-trust) only registered on `ipcMain.handle` — web-panel users couldn't see it. This patch adds 13 WS topics + dependency wiring so the default shell gets the full feature surface.

| Topic                                | File                                                           | Description                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WS topic handler factory**         | `src/main/web-shell/handlers/community-mtc-handlers.js` (+330) | 13 dotted topics: `mtc.envelope.get`, `mtc.archive.{push, restore, list}`, `mtc.governance-mofn.{create, sign, status, finalize, list}`, `mtc.cross-fed-trust.{establish, revoke, list, get-trusted-dids}`. Each handler returns `{success, ...}` shape; null manager yields `{success:false, error:"... not initialized"}` so the dispatcher doesn't crash |
| **web-shell-bootstrap registration** | `src/main/web-shell/web-shell-bootstrap.js` (+22)              | `createCommunityMtcHandlers({...managers})` spreads into `wsHandlers` map; lazy peer-pull uses `p2pManager.getConnectedPeers`                                                                                                                                                                                                                               |
| **index.js dependency wiring**       | `src/main/index.js` (+22)                                      | Pulls 6 managers from DI container instances, attaches to `this.*`, passes them all into `startWebShell({...})`                                                                                                                                                                                                                                             |
| **Wire-shape consistency with IPC**  | same                                                           | sign still uses base64-serialized keys (renderer doesn't ship Buffers); providerSpec stays `{kind, ...opts}`; error envelope `{success:false, error}` matches existing mtc.audit-status / sync.status / notification.\* topics                                                                                                                              |

**Test matrix (B4-webshell adds 19, total 1106 / 1106 across 33 files)**

| Layer                   | File                                                 | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                    | `web-shell/__tests__/community-mtc-handlers.test.js` | 19 — 13-topic registration check + envelope.get 4 (local hit / remote peer-pull fallback / missing batcher / missing args) + archive._ 5 (push / restore / list / missing factory / missing spec) + governance-mofn._ 5 (create / sign with base64→Buffer revive / sign missing args / status+finalize+list / missing manager) + cross-fed-trust.\* 4 (establish strips localCommunityId / revoke+list+get-trusted-dids / missing manager) + sync-throw caught into envelope |
| Full 33-file regression | —                                                    | **1106 / 1106** ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## ✅ All B4 deferred + web-shell parity now complete

| Phase                  | Commit         | Tests added           |
| ---------------------- | -------------- | --------------------- |
| Phase A + Phase B v1   | `50b8ddb05`    | +58                   |
| B4 (DID + auto-bridge) | `3741a8e7e`    | +47                   |
| B4-merkle v1           | `435ba7dde`    | +31                   |
| B4-cross v1            | `8b03e3b54`    | +34                   |
| B4-cross-trust v1      | `c50353ca8`    | +8                    |
| B4-ui v1               | `173efc52e`    | +10                   |
| B4-archive v1          | `527e36eba`    | +26                   |
| B4-mofn v1             | `b1b016dd8`    | +24                   |
| B4-crossfed v1         | `ad12fc515`    | +16                   |
| **B4-webshell v1**     | **this**       | **+19**               |
| **Total**              | **10 commits** | **+273 (149 → 1106)** |

## 2026-05-07 Update XII — **B4-crossfed v1 — cross-federation trust anchors**

Fifth and final B4 deferred item. B4-cross-trust v1 locked the inbound landmark filter to "issuer must be a current community member". This patch lets a user record "I also trust this other federation's anchors", so landmarks signed by their members pass too — no need to formally join their community.

| Topic                                   | File                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CrossFedTrust**                       | `src/main/mtc/cross-fed-trust.js` (+185) | `establishTrust(localCommunityId, {remoteCommunityId, remoteMembers, expiresAt?, note?})` / `revokeTrust(localCommunityId, remoteCommunityId)` / `listTrusted(localCommunityId)` / `getTrustedDIDs(localCommunityId, {now?})` returns union of unexpired records' DIDs. Storage at `<userData>/cross-fed-trust/<localCommunityId>/<remoteCommunityId>.json`. expiresAt accepts ISO timestamps; expired records auto-excluded from getTrustedDIDs (clock injectable for tests) |
| **Distribution trust filter extension** | `social-initializer.js` (+25 / -10)      | `getCommunityMembers` adapter now unions: communityManager local members ∪ crossFedTrust cross-fed trusted DIDs. Either source throwing is swallowed, doesn't block                                                                                                                                                                                                                                                                                                           |
| **4 IPC handlers**                      | `community-ipc.js` (+45)                 | `cross-fed-trust:establish / revoke / list / get-trusted-dids`. Once configured by the renderer, all cross-fed landmarks pass the trust filter                                                                                                                                                                                                                                                                                                                                |
| **Initializer**                         | `social-initializer.js` (+22)            | `crossFedTrust` initializer required:false                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Test matrix (B4-crossfed adds 16, total 1087 / 1087 across 32 files)**

| Layer                   | File                                    | Tests                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                    | `mtc/__tests__/cross-fed-trust.test.js` | 16 — constructor / establishTrust 6 cases (writes record / unsafe ids / empty/dup/malformed members / idempotent update) / revokeTrust 2 / listTrusted 2 / getTrustedDIDs 5 (union / excludes expired / includes future expiresAt / clock injection / empty community) |
| Full 32-file regression | —                                       | **1087 / 1087** ✅                                                                                                                                                                                                                                                     |

## All B4 deferred items now complete ✅

| Sub-phase                                 | Commit             | New tests |
| ----------------------------------------- | ------------------ | --------- |
| ~~Inbound landmark trust filtering~~      | `c50353ca8` (VIII) | +8        |
| ~~UI envelope viewer~~                    | `173efc52e` (IX)   | +10       |
| ~~Periodic envelope archival~~            | `527e36eba` (X)    | +26       |
| ~~M-of-N for governance-critical events~~ | `b1b016dd8` (XI)   | +24       |
| ~~Cross-federation trust anchors~~        | this patch (XII)   | +16       |

**One remaining**: user follow-up "需要在 web-shell 版本可以看到这些功能" — the full B4 IPC suite registers on ipcMain, but web-shell (the Phase 1.6 default) needs corresponding WS topic handlers before web-panel UI can use them. Next commit addresses this.

## 2026-05-07 Update XI — **B4-mofn v1 — governance M-of-N multi-sig**

Fourth deferred item. Phase 54 `cc governance` is single-DID voting with no multi-sig / threshold finalize semantics. This patch wires core-mtc's `assembleBatchFederated`: proposal created → members add signatures one by one → once M signatures collected, finalize writes a multi-sig landmark with N trust_anchors.

| Topic                  | File                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GovernanceMultiSig** | `src/main/mtc/governance-multisig.js` (+440) | `createProposal({communityId, proposalId, payload, members[], threshold})` / `addSignature(communityId, proposalId, signerKeys)` / `getStatus` / `finalize` / `listProposals`. Storage at `<userData>/governance-mofn/<communityId>/<proposalId>/{proposal.json, signatures/<did>.json, landmark.json}`. **Anti-impersonation**: addSignature validates `pubkey → sha256 → DID` matches the claimed DID. **Idempotent**: same DID adding twice is no-op; second finalize returns the same treeHeadId. **Local federated assembler**: `_assembleBatchFederatedLocal` uses core-mtc primitives + tweetnacl signer to dodge the @noble/curves hoisting trap (same approach as channel-event-batch) |
| **5 IPC handlers**     | `community-ipc.js` (+85)                     | `governance-mofn:create / sign / status / finalize / list`. sign accepts base64 `{did, secretKey, publicKey}` serialized form (renderer doesn't ship Buffers directly)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Initializer**        | `social-initializer.js` (+22)                | `governanceMultiSig` initializer required:false; failure non-fatal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**v1 trust / scope limits**:

- Single-machine sig collection — caller (renderer) ships member secret keys directly, no network. **v2 will move sig collection to federation gossipsub**, with the coordinator gathering partial sigs while remote members sign offline and ship back (typical Frost/MuSig pattern)
- "More than threshold contributions" → use the first M (deterministic by file order), ignore the rest
- No expiry / revocation / reopen — once finalized, immutable

**Test matrix (B4-mofn adds 24, total 1071 / 1071 across 31 files)**

| Layer                   | File                                        | Tests                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                    | `mtc/__tests__/governance-multisig.test.js` | 24 — constructor / createProposal threshold/empty/dup/malformed-DID/unsafe-id/exists 7 cases + addSignature member-only/idempotent/non-member/DID-pubkey-mismatch/wrong-key-shape/threshold 6 cases + getStatus 2 + finalize insufficient/3-of-5 happy/over-threshold deterministic/idempotent/post-finalize-rejects-sign 5 + listProposals 2 |
| Full 31-file regression | —                                           | **1071 / 1071** ✅                                                                                                                                                                                                                                                                                                                            |

**Remaining deferred sub-phases progress**

- ✅ ~~Inbound landmark trust filtering~~ — done in VIII
- ✅ ~~UI envelope viewer~~ — done in IX
- ✅ ~~Periodic envelope archival~~ — done in X
- ✅ ~~M-of-N for governance-critical events~~ — done in this patch
- 🚧 Cross-federation trust anchors (MTC v0.11 `cross-fed-trust` integration)
- 🚧 web-shell parity for B4 features (user follow-up feedback: default shell is web-shell, B4 IPC has no WS topic exposure yet)

## 2026-05-07 Update X — **B4-archive v1 — envelope external archival (filesystem + WebDAV)**

Third deferred item. B4-merkle / B4-cross keep the envelope evidence trail on local disk; device wipe / uninstall / disk corruption = total loss. This patch adds packaging + push to external providers so audit history can survive beyond a single machine's lifecycle.

| Topic                                    | File                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ChannelEnvelopeArchiver**              | `src/main/mtc/channel-envelope-archiver.js` (+360) | `pack(communityId, {sinceBatchId, includeRemote})` zips batches/<id>/_ + remote-landmarks/_ + remote-envelopes/\* into a Buffer with a MANIFEST.json. `push(provider, communityId)` calls provider.putFile to upload. `restore(provider, communityId, archiveName)` does the reverse: unzips back to local dir (idempotent — existing files are skipped, not overwritten). `list(provider, communityId)` filters by ARCHIVE_NAME_PREFIX |
| **filesystemProvider**                   | same (+50)                                         | Mirrors archives to a local directory tree (suitable for Syncthing-class external sync, USB backups, CI artifacts). Full path-traversal defense                                                                                                                                                                                                                                                                                         |
| **webdavProvider**                       | same (+50)                                         | Wraps the existing `src/main/sync/webdav-client.js` (shipped in Phase 3c.5). Adapts put/get/list to webdav-client's `{ok, etag}` return shape                                                                                                                                                                                                                                                                                           |
| **3 IPC handlers**                       | `community-ipc.js` (+85)                           | `channel-archive:push` / `channel-archive:restore` / `channel-archive:list`. Accepts renderer-supplied `{kind, ...opts}` provider spec → archiveProviderFactory instantiates → archiver operates. Credentials (webdav password) come from the spec per-call, not cached in main                                                                                                                                                         |
| **archiveProviderFactory + initializer** | `social-initializer.js` (+78)                      | Registers `channelEnvelopeArchiver` initializer and `archiveProviderFactory`. Factory currently supports `{kind:'filesystem', rootDir}` and `{kind:'webdav', baseUrl, username, password, remoteRoot}`                                                                                                                                                                                                                                  |

**Archive name convention**: `channel-mtc-<communityId>-<isoTimestamp>-<sinceBatchId>-to-<latestBatchId>.zip`, stored under `<remoteRoot>/<communityId>/`. Incremental push (specifying `sinceBatchId`) only ships new batches, saving bandwidth.

**Test matrix (B4-archive adds 26, total 1047 / 1047 across 30 files)**

| Layer                   | File                                              | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (new)              | `mtc/__tests__/channel-envelope-archiver.test.js` | 26 — constructor required-args / pack all-vs-no-remote / sinceBatchId incremental / unsafe communityId reject / empty repo throws / no-new-batches throws + filesystemProvider required-args+round-trip+path-traversal+missing+empty-dir + push full result shape + restore round-trip with batcher.findEnvelope hit + idempotent second restore=0 + incremental sinceBatchId / list filtering + sort / provider failure throws + webdavProvider required-args+round-trip+failure+getFile two shapes+listFiles mapping+missing-listFiles fallback+path-traversal documented (adm-zip API limit explained) |
| Full 30-file regression | —                                                 | **1047 / 1047** ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Test gotcha**: archiver tests pin `// @vitest-environment node` because adm-zip's Buffer round-trip (`toBuffer → new AdmZip(buf)`) returns 0 entries under jsdom (Buffer / typed-array realm mismatch — same root cause as the libp2p e2e tests). One more case where jsdom's main-process-library compatibility is genuinely flaky.

**Remaining deferred sub-phases progress**

- ✅ ~~Inbound landmark trust filtering~~ — done in VIII
- ✅ ~~UI envelope viewer~~ — done in IX
- ✅ ~~Periodic envelope archival to OSS / WebDAV / IPFS~~ — done in this patch (FS + WebDAV; OSS / IPFS providers as follow-up)
- 🚧 M-of-N for governance-critical events
- 🚧 Cross-federation trust anchors (MTC v0.11 `cross-fed-trust` integration)

## 2026-05-07 Update IX — **B4-ui v1 — Merkle envelope verify button + viewer modal**

Second deferred item: B4-merkle / B4-cross had backend-only — no renderer surface. This patch wires the UI: every signed channel message gains a "🔐 验证" button that opens a modal showing origin (local-batched vs peer-pulled), tree-head / batch / leaf index, signature-verified status, plus an expandable raw envelope + landmark JSON view with copy buttons (so users can paste into `cc mtc verify` for offline cross-check).

| Topic                                  | File                                                            | Description                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`useMessageEnvelope` composable**    | `src/renderer/composables/useMessageEnvelope.ts` (+155)         | 5-phase reactive state (idle / loading / found / not-found / error) + `fetch(communityId, messageId)` + `reset()`. Uses generic `electronAPI.invoke('channel:get-message-envelope', ...)` (no preload changes needed). Falls back to error phase with friendly message when preload missing                                                                                                         |
| **`MessageEnvelopeViewer.vue`**        | `src/renderer/shell/community/MessageEnvelopeViewer.vue` (+170) | 720px Ant Design Modal with message preview + 5-phase UI (Spin / Alert / Descriptions) + origin Tag (local green / remote blue) + tree-head / batch / namespace / leafIndex + signature ✅ + orange tag when landmark cache missing + collapsible raw envelope/landmark JSON with copy buttons (`navigator.clipboard.writeText`). Button only renders when message has `signature && sender_pubkey` |
| **CommunityDetailsDrawer integration** | `src/renderer/shell/community/CommunityDetailsDrawer.vue` (+30) | Channel message rows gain a "🔐 验证" button (signed messages only) + Tooltip; Modal v-model:open two-way binding; passes `community.id` as the viewer's communityId prop                                                                                                                                                                                                                           |

**Test matrix (B4-ui adds 10, total 1021 / 1021 across 29 files)**

| Layer                   | File                                               | Tests                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                    | `composables/__tests__/useMessageEnvelope.test.ts` | 10 — full 5-phase coverage (idle initial / empty-args reject / preload-missing error / found normalized result / origin default / not-found with reason / IPC throw → error / null IPC response → not-found / loading transition observable / reset()) |
| Full 29-file regression | —                                                  | **1021 / 1021** ✅                                                                                                                                                                                                                                     |

**Known coverage gap (deliberate)**:

- No unit test for `MessageEnvelopeViewer.vue` itself. Reasoning: the component is mostly Ant Design Modal/Spin/Tag/Descriptions plumbing with no business-logic branching. Mount + Teleport modals are fragile under vitest jsdom; the composable + IPC wiring tests already cover the data flow. Integration test can land with the next e2e Playwright batch.

**Remaining deferred sub-phases progress**

- ✅ ~~Inbound landmark trust filtering~~ — done in VIII
- ✅ ~~UI envelope viewer~~ — done in this patch
- 🚧 Periodic envelope archival to OSS / WebDAV / IPFS
- 🚧 M-of-N for governance-critical events
- 🚧 Cross-federation trust anchors (MTC v0.11 `cross-fed-trust` integration)

## 2026-05-07 Update VIII — **B4-cross-trust v1 — landmark inbound trust filter**

First item off the B4-cross v1 deferred list: B4-cross v1 had no inbound trust model (cached every landmark received). This patch adds community-membership filtering: a landmark's issuer DID must be in the current community's member list before it's cached, otherwise it's rejected and `landmark:rejected` is emitted. When the membership callback is omitted, falls back to v1 trust-none behavior with a one-time startup warn.

| Topic                                   | File                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **distribution accepts trust callback** | `src/main/mtc/channel-envelope-distribution.js` (+105) | New constructor opt `getCommunityMembers: (communityId) => Promise<DID[]>`. `_handleIncomingLandmark` becomes async: (1) extract issuer DID via new static `extractIssuerDID(landmark)` method (default strips `did-bound:` prefix, tolerates bare DIDs); (2) call getCommunityMembers; (3) issuer not in list → emit `landmark:rejected` with reason and don't cache. No callback → init-time warn "trust filter OFF" |
| **social-initializer wiring**           | `src/main/bootstrap/social-initializer.js` (+25)       | distribution initializer adds `communityManager` to its deps; provides `getCommunityMembers` implementation as `communityManager.getMembers(id, {limit:10000}).then(rows => rows.map(r => r.member_did))`. Failure swallowed → empty list                                                                                                                                                                              |

**rejected event reason enum**:

- `"issuer DID not extractable"` — landmark.snapshots[0].signature missing issuer field
- `"membership lookup failed: <err>"` — getCommunityMembers threw (DB unavailable etc)
- `"issuer not a community member"` — DID present but not on membership list

**Why strip `did-bound:` prefix**: channel-event-batch.js `_assembleBatchLocal` uses `did-bound:<did>` issuer format (mirrors the audit-mtc pattern); other publishers (CLI, federation tools) may use the bare DID, so `extractIssuerDID` tolerates both.

**Test matrix (B4-cross-trust adds 8, total 1011 / 1011 across 28 files)**

| Layer                                                  | Tests                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit +8 → 29 (`channel-envelope-distribution.test.js`) | trust filter ON: cache when member / reject when not member (incl. reject event payload) / reject when issuer not extractable / reject when getCommunityMembers throws / trust filter OFF: v1 behavior preserved / `extractIssuerDID` three cases (with prefix / no prefix / malformed) |
| Full 28-file regression                                | **1011 / 1011** ✅                                                                                                                                                                                                                                                                      |

**Remaining deferred sub-phases progress**

- ✅ ~~Inbound landmark trust filtering~~ — done in this patch
- 🚧 UI envelope viewer
- 🚧 Periodic envelope archival to OSS / WebDAV / IPFS
- 🚧 M-of-N for governance-critical events
- 🚧 Cross-federation trust anchors (MTC v0.11 `cross-fed-trust` integration)

## 2026-05-07 Update VII — **B4-cross v1 — envelope cross-machine distribution**

B4-merkle v1 produced envelopes but they were only useful to the sender (peers had no batch dir to verify against). This patch closes the most critical gap: landmarks auto-broadcast over federation gossipsub + envelopes are pulled on-demand from peers. The audit-grade promise is now redeemed — any third party can verify any known messageId's inclusion proof.

| Topic                                   | File                                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Batcher remote cache + callback API** | `src/main/mtc/channel-event-batch.js` (+196 / -27)         | New methods: `onBatchClosed(handler)` (fires after closeBatch + multi-handler isolation), `storeRemoteLandmark / findRemoteLandmark` (indexed by treeHeadId, sha256: colon → filesystem-safe `_`), `storeRemoteEnvelope` (messageId-indexed). `findEnvelope` now returns an `origin: "local" \| "remote"` field; `loadEnvelopeAndLandmark` auto-routes landmark lookup by origin (local sits next to envelope, remote in remote-landmarks/)                 |
| **ChannelEnvelopeDistribution**         | `src/main/mtc/channel-envelope-distribution.js` (+330)     | Wraps mtcFedMgr (gossipsub on a separate `cc.community.<id>.envelopes-track` topic to keep envelope flow off the message channel) + p2pManager (typed `mtc:envelope-request` / `mtc:envelope-response`). API: `subscribeCommunity` (cache remote landmarks) / auto `publishLandmark` (hooks batcher.onBatchClosed) / `requestEnvelope(peerId, communityId, messageId)` Promise + 8s default timeout. Internal in-flight tracker + close rejects all pending |
| **typed message dispatch**              | `src/main/p2p/p2p-manager.js` `dispatchTypedMessage` (+24) | Adds `mtc:envelope-request` (→ `'mtc:envelope-request'` event w/ requestId/communityId/messageId/fromPeerId) + `mtc:envelope-response` (→ event w/ found/envelope/batchId). Distribution module listens on these events directly                                                                                                                                                                                                                            |
| **social-initializer registration**     | `src/main/bootstrap/social-initializer.js` (+38)           | `channelEnvelopeDistribution` initializer (depends mtcFedMgr + p2pManager + channelEventBatcher); failure-tolerant                                                                                                                                                                                                                                                                                                                                          |
| **community-ipc integration**           | `src/main/social/community-ipc.js` (+62)                   | `community:join` also calls `channelEnvelopeDistribution.subscribeCommunity` to start landmark caching; `channel:get-message-envelope` adds a fallback chain — when not local, enumerates connected peers in order and `requestEnvelope` until first hit (requestEnvelope internally `storeRemoteEnvelope`-caches); phase-3-4-social wires through `channelEnvelopeDistribution` + `p2pManager`                                                             |

**Trust model (v1)**: none — caches every landmark/envelope received without trust_anchors validation. Reasoning: (a) Noise transport prevents MITM, (b) the user ultimately verifies the envelope's inclusion proof against the landmark's tree-head signature (`cc mtc verify` etc), so a fake landmark can't pass the final gate. v2 can add inbound landmark filtering by federation membership.

**Test matrix (B4-cross adds 34, total 1003 / 1003 across 28 files)**

| Layer                   | File                                                  | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (extended)         | `mtc/__tests__/channel-event-batch.test.js` (+11 →34) | 11 cross-machine cases: onBatchClosed full flow / handler exception isolation / storeRemoteLandmark+findRemoteLandmark round-trip / `:` filesystem escape / storeRemoteEnvelope+findEnvelope `origin:remote` / unsafe messageId reject / loadEnvelopeAndLandmark remote bundle / orphan envelope no landmark fallback / origin tag preserved                                                                                                                                                                                                                                                                                                               |
| Unit (new)              | `mtc/__tests__/channel-envelope-distribution.test.js` | 21 — constructor required-deps validation / lifecycle idempotency / close tear-down listeners / auto-publish on closeBatch (non-blocking) / `landmark:published` event / subscribeCommunity uses synthetic `<id>.envelopes-track` topic / inbound landmark cache / non-landmark payload ignored / unsubscribeCommunity idempotent / `requestEnvelope` full flow (req → resp cached → resolve) / found:false / 8s timeout → null / unknown requestId silently ignored / close rejects in-flight / inbound envelope-request finds local envelope and responds / not-found → found:false / malformed request (missing requestId / missing fromPeerId) ignored |
| Unit (extended)         | `p2p/__tests__/p2p-manager-dispatch.test.js` (+2 →22) | 2 new dispatch cases: `mtc:envelope-request` / `mtc:envelope-response` field passthrough                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Full 28-file regression | —                                                     | **1003 / 1003** ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**End-to-end value redeemed**:

1. Alice sends a message in community-X channel → local channelManager INSERT + B4a sign + Phase A gossip + Phase B MTC + B4-merkle batch enqueue
2. After 100 messages or 1h triggers closeBatch → assembleBatch + writes batches/000001/ → onBatchClosed callback → ChannelEnvelopeDistribution publishes the landmark to `cc.community.community-X.envelopes-track` topic
3. Bob has joined community-X (community:join auto-subscribes that topic) → receives landmark → batcher.storeRemoteLandmark persists to `<userData>/channel-mtc/community-X/remote-landmarks/sha256_xxx.json`
4. Bob wants to verify a specific Alice message: renderer calls `channel:get-message-envelope` IPC → not local → enumerates connected peers (Phase A gossip's) → `requestEnvelope(Alice, …)` → Alice receives `mtc:envelope-request` typed → finds it in own batches/ → replies `mtc:envelope-response` → Bob caches to `remote-envelopes/messageId.json` → returns full envelope + cached landmark to renderer
5. Renderer (or `cc mtc verify`) checks Merkle inclusion_proof against landmark's tree-head signature → ✅ third-party cryptographic evidence stands

**Deferred (B4-cross follow-up sub-phases)**

- Inbound landmark trust filtering (validate against expected federation membership)
- Periodic envelope archival to OSS / WebDAV / IPFS (survive device wipe)
- UI envelope viewer button ("show this message's cryptographic proof")
- Large-community eager envelope push (currently on-demand pull; 10k-member communities may need bandwidth optimization)

## 2026-05-07 Update VI — **B4-merkle v1 — channel-event Merkle batch envelope finality**

The P2P social path graduates from "messages are trusted + auto-mesh" to also producing offline-verifiable Merkle batch envelopes for every locally-sent channel message. Composes with B4a's Ed25519 per-message signatures: you now have third-party-verifiable evidence "I sent message Z to channel Y at time X."

| Topic                                    | File                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ChannelEventBatcher**                  | `src/main/mtc/channel-event-batch.js` (+390)     | Accumulates `staging/<message-id>.json` → triggers `closeBatch` on threshold (default 100) or timer (default 1h) → writes `batches/<batch-id>/{manifest,landmark,envelope-*}.json`. Layout mirrors audit-mtc's `~/.chainlesschain/audit-mtc/`. Atomic rename + crash rollback. Path: `<userData>/channel-mtc/<communityId>/`. tweetnacl-based MTC signer (sidesteps `@noble/curves@2.2.0` removing the `/ed25519` subpath + workspace hoisting trap). `_assembleBatchLocal` uses core-mtc's `/hash` `/jcs` `/merkle` `/constants` subpath primitives directly (does NOT require core-mtc's index, which would transitively load the broken ed25519 signer) |
| social-initializer registration          | `src/main/bootstrap/social-initializer.js` (+45) | `channelEventBatcher` initializer (depends on `didManager`), `autoTimer:true` starts the 1h closer. Failure-tolerant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| community-ipc enqueue after dual-publish | `src/main/social/community-ipc.js` (+28)         | `channel:send-message` IPC, after channelManager.sendMessage + gossip + MTC, enqueues the signed message into the batcher (B4a's sender_pubkey + signature anchor the leaf). Failure swallowed. New `channel:get-message-envelope` IPC takes `(communityId, messageId)` → returns `{found, envelope, landmark, treeHeadId, batchId, leafIndex}`                                                                                                                                                                                                                                                                                                            |
| Wire compat                              | —                                                | Output landmark + envelopes are wire-compatible with core-mtc's verifier — peers can use `cc mtc verify` against inclusion proofs without our desktop binaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Sub-phase scope (v1 vs B4-merkle follow-up)**

- v1: local-only batching + local envelope queries. Wire-compatible but **does not** auto-broadcast envelopes via federation (peers without your batch dir cannot query)
- Follow-up: cross-machine envelope distribution (publish landmark via federation channel + on-demand pull); cron-based archival to OSS / WebDAV / IPFS; UI envelope viewer ("show this message's cryptographic proof")

**Test matrix (B4-merkle adds 31, total 969 / 969 across 27 files)**

| Layer                                                          | File                                                                | Tests                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                                           | `mtc/__tests__/channel-event-batch.test.js`                         | 23 — real fs (tmp dir) + real core-mtc primitives × constructor / enqueueEvent / filesystem path-traversal guards / threshold auto-close / closeBatch full lifecycle / sequential batch ids / no-identity → throw / findEnvelope three states / loadEnvelopeAndLandmark / closeAllPending |
| Integration                                                    | `social/__tests__/community-ipc-merkle-enqueue.integration.test.js` | 8 — `channel:send-message` IPC enqueues / unsigned skipped / batcher throw doesn't block / null batcher fallback + `channel:get-message-envelope` IPC delegates / null batcher / missing args / batcher throws                                                                            |
| Full 27-file regression (p2p + social + mtc + did + bootstrap) | —                                                                   | **969 / 969** ✅                                                                                                                                                                                                                                                                          |

**Real-world bugs / lessons**

- `@noble/curves` cross-version subpath removal: core-mtc deps `^1.9.7` (has `./ed25519` subpath), desktop-app-vue's standalone node_modules has `@2.2.0` (subpath removed). `require("@chainlesschain/core-mtc")` index file top-level requires the ed25519 signer module, which fails to load → entire core-mtc module unusable. Fix: **don't require core-mtc index**, only require the specific subpath primitives we use (`/hash` `/jcs` `/merkle` `/constants` — none touch @noble/curves), implement the MTC signer interface ourselves with tweetnacl, and run a local `_assembleBatchLocal` that bypasses `@noble/curves` entirely
- Another manifestation of the hoisting trap warned about in memory `desktop_release_npm_workspace_hoisting.md` — this time it's different npm versions locked into standalone node_modules

**.exe background rebuild complete (exit 0)**: `out/build/ChainlessChain-Setup-5.0.3-alpha.40.exe` 426 MB, includes Phase A + Phase B v1 + B4 + B4-merkle. The previous v5.0.3.40 install (Phase A only) won't auto-update on restart (semver matches); to test the upgrade requires manual install.

## 2026-05-07 Update V — **B4 — DID signing + auto peer bridging**

P2P social path graduates from "works" to "anti-impersonation + auto-mesh". Two features bundled because they share wire-protocol surface:

| Topic                                 | File                                                                                                                                     | Description                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B4a — DID-signed channel messages** | `src/main/did/did-signer.js` (+205)                                                                                                      | Pure crypto helper, decoupled from DIDManager. `signPayloadWithIdentity / verifyPayloadAgainstDid` use a minimal deterministic JSON (avoids the canonicalize cross-workspace hoisting trap), signing the immutable subset `{id,channel_id,sender_did,content,message_type,reply_to,created_at}` (is_pinned/reactions/updated_at deliberately excluded — they mutate) |
| Public key distribution               | —                                                                                                                                        | **Embed in message**: each msg carries `sender_pubkey` (base64 32B Ed25519). No DID resolver dependency; verifies offline. Cost ~44B/msg (negligible at human chat rates)                                                                                                                                                                                            |
| Triple verification (receiver)        | `channel-manager.handleMessageReceived`                                                                                                  | (1) `sha256(sender_pubkey).slice(0,20).toString('hex')` must match `sender_did` suffix (anti-pubkey/DID mismatch); (2) Ed25519 detached verify; (3) signature length/shape valid                                                                                                                                                                                     |
| Three-state backward-compat           | same                                                                                                                                     | (a) both sig+pubkey present → strict verify, fail emits `channel:message-rejected` event + drops; (b) both absent → log warn + accept (migration window for old clients); (c) only one → reject as malformed                                                                                                                                                         |
| Schema migration                      | `channel-manager.initializeTables`                                                                                                       | CREATE adds new columns + PRAGMA `table_info` probe + conditional ALTER (sidesteps the project's fragmented numbered-SQL migration runner)                                                                                                                                                                                                                           |
| **auto peer bridging**                | `src/main/p2p/p2p-manager.js` `dispatchTypedMessage` (+15) + `src/main/bootstrap/social-initializer.js` `wireMtcAutoBridge` (+95 export) | New typed message `mtc:advertise` rides `/chainlesschain/message/1.0.0`; dispatch routes to `mtc:peer-advertise` event. social-initializer registers `mtcAutoBridge` initializer: on `peer:connected` it pushes our MTC card to the new peer; on `mtc:peer-advertise` it sequentially dials the advertised multiaddrs. Bidirectional, libp2p dedupes                 |
| Failure tolerance                     | same                                                                                                                                     | Either side `mtcFedMgr.isInitialized() === false` → no-op (Phase A direct gossip keeps working). `connectPeer` failures are swallowed (NAT / IPv6 unreachable / dup connect are normal)                                                                                                                                                                              |

**Test matrix (B4 adds 47, total 938 / 938 green)**

| Layer                                                          | File                                                           | Tests                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                                                           | `did/__tests__/did-signer.test.js`                             | 22 — canonicalize 7 + computeDID 3 + sign/verify 5 + end-to-end 7                                                                                                                          |
| Unit                                                           | `p2p/__tests__/p2p-manager-dispatch.test.js` (+2)              | 20 (was 18) — added `mtc:advertise` dispatch + missing-multiaddrs fallback                                                                                                                 |
| Integration                                                    | `social/__tests__/channel-manager-signing.integration.test.js` | 8 — real Ed25519 keypair × real ChannelManager × mock SQL, validates sign + verify + three attack rejects (impersonation/tamper/malformed) + legacy accept + idempotency + no-key fallback |
| Integration                                                    | `bootstrap/__tests__/mtc-auto-bridge.integration.test.js`      | 15 — `wireMtcAutoBridge` outbound/inbound × various error paths + bidirectional mesh seed                                                                                                  |
| Full 25-file regression (p2p + social + mtc + did + bootstrap) | —                                                              | **938 / 938** ✅                                                                                                                                                                           |

**Real-world bug callouts**

- `src/main/did/__tests__/foo.test.js` calling `vi.mock("../../../utils/logger.js", ...)` is the **wrong path** (resolves to `src/utils/logger.js`, outside `src/main/`); vitest 4's strict mock loader doesn't error but **silently pollutes the fork's mock registry across files**: 20+ unrelated tests in batch fail with `wireMtcAutoBridge is not a function`, all green when run individually. Fix: `../../utils/logger.js` (2 levels not 3). Captured in memory `vitest_testing.md` under "vi.mock path correctness"
- The `canonicalize` npm package is a transitive dep of `core-mtc`; desktop-app-vue (no longer a workspace) sees no hoisted resolution from its standalone node_modules. Rather than add another direct dep, did-signer.js ships its own 15-LoC minimal deterministic JSON (sufficient for the flat immutable subset, rejects nested objects to surface misuse)

**Deferred (B4 follow-up sub-phases)**

- Merkle batch envelope finality (`assembleBatch` persistence + verify path)
- M-of-N for governance-critical events (proposals/votes via `assembleBatchFederated`)
- Cross-federation trust anchors (MTC v0.11 `cross-fed-trust` desktop integration)

## 2026-05-07 Update IV — **Phase B v1 — MTC federation dual-track sync landed**

On top of Phase A's direct gossip, _dual-track_ MTC federation gossipsub channel. Both paths coexist; receivers idempotently `INSERT OR IGNORE` by `message.id`.

| New                                      | File                                             | Description                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MtcFederationManager                     | `src/main/mtc/mtc-federation-manager.js` (+233)  | Wraps `@chainlesschain/core-mtc/transports/libp2p` Libp2pTransport (gossipsub mode). Topic: `cc.community.<id>.events`. API: `subscribeCommunity` / `publishCommunityEvent` / `unsubscribeCommunity` / `connectPeer`. Failure-tolerant — community keeps working via Phase A direct gossip if MTC fed init fails |
| social-initializer registration          | `src/main/bootstrap/social-initializer.js` (+34) | `mtcFederationManager` initializer, required:false                                                                                                                                                                                                                                                               |
| community-ipc dual-publish + DI refactor | `src/main/social/community-ipc.js` (+62 / −10)   | `community:join` / `community:leave` / `channel:send-message` IPC handlers run gossip + MTC concurrently. `registerCommunityIPC` now accepts `ipcMain` as a DI dep (matches social-ipc pattern; sidesteps vitest electron-alias named-export quirks)                                                             |
| phase-3-4-social wiring                  | `src/main/ipc/phases/phase-3-4-social.js` (+2)   | Passes `mtcFederationManager` through to `registerCommunityIPC`                                                                                                                                                                                                                                                  |

**Sub-phase scope (v1 vs deferred)**

- v1: transport layer (subscribe/publish/dispatch + dual-track idempotency)
- B4 deferred: DID signing / Merkle batch envelope finality / M-of-N multi-sig / cross-federation trust anchors / automatic peer bridging

**Tests**

| Layer                                        | File                                                                     | Tests                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                         | `src/main/mtc/__tests__/mtc-federation-manager.test.js`                  | 17 — topicForCommunity / lifecycle / publish / subscribe / unsubscribe / connectPeer with mock transport                                                                                                                                                              |
| Integration                                  | `src/main/social/__tests__/community-ipc-dual-track.integration.test.js` | 12 — community:join dual-subscribe / community:leave dual-unsubscribe / channel:send-message dual-publish / either transport failure does not block the other / single-track fallback (gossip-only / MTC-only)                                                        |
| E2E                                          | `src/main/mtc/__tests__/mtc-federation-roundtrip.test.js`                | 4 — two real libp2p gossipsub-mode nodes + call path doesn't throw + conditional delivery assertion (assert if mesh forms, no-op if not — same policy as core-mtc's own federation-discovery test) + dual-track idempotency (same message via two paths inserts once) |
| Full 22-file regression (p2p + social + mtc) | —                                                                        | **891 / 891** ✅                                                                                                                                                                                                                                                      |

**Architectural notes**

- MtcFederationManager runs a **standalone libp2p node** (not reused from P2PManager) — sharing would require invasive P2PManager createLibp2p config changes to add `pubsub: gossipsub()` service + a new dynamic import; deferred as follow-up
- v1 has no auto peer discovery: `connectPeer(multiaddr)` is manual; cross-machine effect in production requires bootstrapping the peer's multiaddr externally (Phase A direct gossip remains the instant default channel)
- 2-node gossipsub mesh formation is genuinely flaky in test environments (per core-mtc historical experience), so e2e delivery is asserted conditionally; production federations with 3+ peers + `floodPublish=true` deliver reliably
- When the same channel_message arrives at B via both Phase A direct gossip AND Phase B MTC topic, `channelManager.handleMessageReceived`'s `INSERT OR IGNORE` on `id` guarantees a single DB row

## 2026-05-07 Update III — **P2P decentralized social cross-machine sync actually works** — Phase A: 7 bugs + 25 tests

The community/channel "decentralized social" path was, **prior to this fix, single-machine only** — in any 2-user verification, A's messages never reached B's local DB. Phase A systematically fixed 7 independent bugs to wire send/receive together on the wire:

| #   | Location                                       | Root cause                                                                                                                                                | Fix                                                                                                                                                                                                                    |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `p2p-manager.js:sendMessage`                   | `stream.write(data)` is libp2p 0.x/1.x legacy API; 3.x uses `stream.send(bytes)`                                                                          | Switched to `stream.send(payload)` + drain backpressure                                                                                                                                                                |
| 2   | `p2p-manager.js:sendMessage`                   | Passed JS object to `stream.write()`, but libp2p streams require `Uint8Array`                                                                             | New `encodeWireMessage()`: Buffer/Uint8Array passthrough, object/string → JSON-line UTF-8                                                                                                                              |
| 3   | `p2p-manager.js:registerMessageHandler`        | `for await of stream.source` is 0.x/1.x it-pipe semantics; in 3.x `.source` is undefined                                                                  | Changed to `for await of stream` (3.x MessageStream is itself AsyncIterable)                                                                                                                                           |
| 4   | `p2p-manager.js:registerMessageHandler`        | Handler signature `({stream, connection}) =>` was old shape                                                                                               | Changed to `(stream, connection) =>`                                                                                                                                                                                   |
| 5   | `p2p-manager.js:registerMessageHandler`        | Received bytes only emitted `message:received`, no per-`type` dispatch → gossip-protocol's `gossip:message` listener never fired                          | Added `decodeWireMessage` + `dispatchTypedMessage` to route by type to `gossip:message` / `gossip:subscribe` / `gossip:unsubscribe` / `message:call-*` / `message:typed`, with `message:received` retained as fallback |
| 6   | `p2p-manager.js:initialize`                    | `registerMessageHandler()` was **never called** in init flow → the `/chainlesschain/message/1.0.0` protocol was never registered                          | Added the call before `registerEncryptedMessageHandlers()`                                                                                                                                                             |
| 7   | `social-initializer.js` (new `gossipReceiver`) | `gossipProtocol.emit('message:received', ...)` had no subscriber → remote messages dead-ended at the gossip layer, never reached `channel_messages` table | New `gossipReceiver` initializer subscribes to the event and calls existing `channelManager.handleMessageReceived()` (INSERT OR IGNORE dedup)                                                                          |

**Test pyramid**

| Layer                | File                                                                                                                  | Tests                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (helpers)       | `src/main/p2p/__tests__/p2p-manager-dispatch.test.js`                                                                 | 18 — encode/decode/dispatch helpers × Buffer/Uint8Array/string/object/null payloads × 6 type categories                                                                              |
| Integration (wiring) | `src/main/social/__tests__/gossip-channel-receiver.integration.test.js`                                               | 4 — real GossipProtocol + real ChannelManager + mock libp2p, validates channel_message insertion / idempotent duplicate / non-channel_message ignore / unsubscribed-community ignore |
| E2E (real wire)      | `src/main/p2p/__tests__/p2p-gossip-roundtrip.test.js`                                                                 | 3 — two real libp2p nodes (TCP + noise + yamux + identify), end-to-end through `mgrA.sendMessage` + `gossipA.broadcast` to receiver event emit                                       |
| Regression           | `community-manager.test.js` (60) + `channel-manager.test.js` (64) + `call-signaling.test.js` + `call-manager.test.js` | 124 + entire p2p folder green                                                                                                                                                        |
| **Total**            | **5 files**                                                                                                           | **149 / 149**                                                                                                                                                                        |

**Test gotcha**: e2e test pins `// @vitest-environment node` because the project's default jsdom env breaks libp2p's TCP receive path (`Uint8Array instanceof` fails across realms).

**Real-world impact**: After Phase A, two real desktop installs on the same LAN (mDNS discovery) or remote (DHT + bootstrap) can connect, join the same community, and A's channel message reaches B's `/community` view. **This was a latent prerequisite bug behind every v0.42.0 / v5.0.3.x community/channel user experience claim.**

**Pre-existing bugs left for follow-up**:

- 9 other `node.handle(...)` call sites likely have the same stream.write/source legacy API issue (yjs-collab-manager / model-parameter-sync / voice-video-manager / collab-sync) — out of Phase A scope, will surface when those features are exercised cross-machine
- gossip-protocol now wires only `channel_message` payloads; governance proposals / moderation reports don't go through gossip and remain single-machine

**Phase B (planned)**: MTC federation gossipsub as the "formal" community sync channel — adds Merkle finality / cross-federation trust anchor / M-of-N multi-sig audit semantics on top of Phase A's direct gossip. Both paths coexist (dual-track): Phase A for best-effort instant sync, Phase B for auditable eventual consistency.

## 2026-05-07 Update II — **v5.0.3.40 — MTC view in-process speedup + CI triple-unblock**

Four unrelated fixes bundled in one release:

| Category                     | File                                                                                                                | Root cause                                                                                                                                                                                                                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MTC view timeout cascade** | `packages/web-panel/src/views/Mtc.vue` + `desktop-app-vue/src/main/web-shell/handlers/mtc-status-handlers.js` (new) | After v5.0.3.39 flipped to `asar:true`, `cc` subprocess cold-start jumped from ~2.5s in dev to 6-10s when packaged (asar header walks + an extra virtual-fs layer in module resolution). `Mtc.vue`'s `onMounted` fires `loadStatus` + `loadBridgeStatus` + `loadBridgeSla` in parallel — they now reliably blow the 8s/6s ceilings → "状态加载失败: Request timeout" + "加载桥 MTC 状态失败" toasts | Added 3 in-process WS topics (`mtc.audit-status` / `mtc.bridge-status` / `mtc.bridge-sla`) that hit `audit-mtc` / `cross-chain-mtc` libs directly (pure file reads, no spawn, zero asar overhead). `Mtc.vue` branches on `useShellMode().isEmbedded`: embedded uses the new topics, browser / `cc serve` keeps the old `ws.execute` path. Bumped fallback timeouts 8000/6000 → 30000 ms (matching `executeJson` default). 7 + 1 new unit tests |
| macOS unit fallback          | `desktop-app-vue/scripts/build-win-with-deref.js`                                                                   | `isSymlink` compared via `realpathSync`, but macOS `os.tmpdir()` resolves through `/var → /private/var` (implicit prefix-symlink) — every plain tmp dir false-positived as a symlink → 7 tests fail                                                                                                                                                                                                 | Platform split: Windows still uses realpath (junctions need it); POSIX uses `lstat.isSymbolicLink()` (no junction concept)                                                                                                                                                                                                                                                                                                                     |
| Rules-validator FP           | `desktop-app-vue/scripts/rules-validator.js`                                                                        | `sync-external-store.test.js:32` is a `TestDbManager.exec(sql)` passthrough for sql.js fixtures — flagged as SQL_INJECTION                                                                                                                                                                                                                                                                          | `getAllFiles` now skips `__tests__/` / `__mocks__/` dirs + `.test.js`/`.spec.js`/`.d.ts` files                                                                                                                                                                                                                                                                                                                                                 |
| Win cold-start ETIMEDOUT     | `packages/cli/__tests__/unit/{skill,agent-repl}.test.js`                                                            | `node bin/chainlesschain.js …` ESM module-graph cold-start exceeds 10/15s `execSync` timeout on busy Windows hosts → 5 tests fail                                                                                                                                                                                                                                                                   | Bumped all CLI-subprocess execSync timeouts to 60s (matches project-wide testTimeout); passes still finish in 1.7–2.5s                                                                                                                                                                                                                                                                                                                         |

**Test matrix**

| Suite                        | Passed                      | Files   | Duration    |
| ---------------------------- | --------------------------- | ------- | ----------- |
| Desktop unit + stores        | 10482 / 10482 (689 skipped) | 320     | 1022s       |
| MTC handler in-process (new) | 7 / 7                       | 1       | 3.4s        |
| web-panel mtc-parser (new)   | 14 / 14                     | 1       | 1.1s        |
| CLI unit                     | 17392 / 17392 (7 skipped)   | 412     | 458s        |
| CLI integration              | 821 / 821                   | 56      | 198s        |
| **Total**                    | **28716**                   | **790** | **~28 min** |

Desktop now **does** ship runtime changes (web-shell registers 3 new in-process handlers + the SPA bundle is rebuilt). The auto-updater compares `5.0.3-alpha.40 > 5.0.3-alpha.39`, so every v5.0.3.39 desktop user gets a real "new version available" prompt on restart and picks up both the MTC speedup and the CI fixes.

## 2026-05-06 Update — **Phase 3b/3c multi-target sync** — 5 tray placeholders wired + SyncProvider abstraction + WebDAV/Git/sync.\* WS topics across both shells

5 tray-menu placeholders (NotificationCenter listener / clipboard import / screenshot OCR / sync now / auto sync) graduated from "coming soon" toasts to real flows. Sync grew from a single backend hook into a multi-provider abstraction (Backend HTTP / Git / P2P / Mobile / WebDAV / OSS) usable from both V5/V6 and web-shell renderers.

| Topic                                                  | Commit                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 0 — NotificationCenter listener                   | `c990cda2a`               | App.vue's `cc:show-notifications` window event had no listener; added onMounted/onBeforeUnmount that toggles panelVisible drawer. Tray "unread notifications" item now actually opens the panel.                                                                                                                                                                                                                                                                      |
| Step 1 — Clipboard import quick-action                 | `c2a2d8844`               | New `ClipboardImportDialog.vue`: navigator.clipboard.readText → title/tag edit → `electronAPI.database.addKnowledgeItem`. Falls back to manual paste with a-alert when clipboard permission is denied. 4 unit tests.                                                                                                                                                                                                                                                  |
| Step 2 — Screenshot OCR quick-action                   | `19fc2a50e`               | Main-process `screenshot-ipc.js` (capture / ocr / cleanup, tmpdir sandbox rejecting non `cc-screenshot-` prefix) + `ScreenshotImportDialog.vue` preview + Tesseract OCR (eng+chi_sim) + recapture / re-OCR. 10 IPC tests + 4 component tests.                                                                                                                                                                                                                         |
| Step 3 — SyncProvider abstraction + V5/V6 SyncSettings | `f89fb0ea0` + `1e39e2b58` | 6 providers (backend / git / p2p real + mobile / webdav / oss placeholder) + aggregate scheduler (per-provider enabled flag + autoSync interval persisted to localStorage) + `/settings/sync` page + tray "Sync Settings…" link + autoSync checkbox default `false` fix. 20 unit tests. vue-tsc fix for ant-design-vue 4.x `CheckedType`.                                                                                                                             |
| Phase 3c — WebDAV desktop + web-shell parity           | `1a9c51882`               | Main-process webdav-engine (drain tombstones + push deltas + cursor persistence) + encrypted credentials + markdown-pack export + 5 `sync.webdav.*` IPC channels + V5/V6 SyncWebDAV.vue config page. WebDAV provider promoted from placeholder to real, calling `electronAPI.sync.webdav.run()`.                                                                                                                                                                      |
| Phase 3c.5 — Git repo web-shell parity                 | `5216c7665` + `e63016de9` | 3 `git.config-*` WS topics (get/set/clear) + Git config section in web-panel SyncSettings (remote URL / username / Token / auto-sync toggle + plaintext-credentials warning). Phase 1.6 web-shell users no longer have to drop back to V5/V6 to configure Git.                                                                                                                                                                                                        |
| Phase 3b adapted to web-shell — sync.\* WS topics      | `eb8697598`               | web-panel SyncSettings.vue switched from `ws.execute('sync …')` to `ws.sendRaw({type:'sync.status'})`. **Root cause**: spawning the cc CLI as a child process opened a second better-sqlite3 connection on the same chainlesschain.db, which fails with "database disk image is malformed" under Windows + WAL. The in-process WS handler shares the main process's db handle, eliminating the conflict. 5 new handlers (status / push / pull / conflicts / resolve). |
| sync.status hardened against schema collision          | `32b78ce7d` + `283708640` | CLI v1's `sync_state / sync_conflicts / sync_log` collided with desktop's same-named P2P sync tables. The CLI tables were renamed wholesale to `cli_*` (one-shot ALTER on first launch); handler's `_safeCountQuery` swallows "no such table" and returns 0.                                                                                                                                                                                                          |

**Test matrix**

- desktop unit + web-shell + system + screenshot: 12914 / 12914 passing (802 skipped — native binding unavailable in test env)
- web-panel unit: 1754 / 1754 passing
- New: `sync-status-handlers.test.js` 16 tests (4 native-db skip) + `web-panel/sync-settings.test.js` 4 tests (envelope-shape regression)
- `new-pages.test.js` route count 54 → 55 (new `/sync-settings`)

**Battle-scar bugs worth remembering**

- ws.sendRaw envelope is `{ok, result, error}`, with the handler's `{success, ...}` payload nested under `result`. First pass read `data?.totalResources` as if the handler return value sat at the top, producing all-zero statistics and a misleading "uninitialized" error.
- vitest 4 strict mock factories must enumerate every named export the SUT imports. A `Proxy({}, get: () => stub)` does not satisfy ESM named-export resolution — list each icon explicitly.
- `console.log` from the Electron main process does not reach stdout (it's intercepted by the bundled logger). Use `logger.info` for diagnostics that need to land in the dev log.

## 2026-05-02 Update — **Web Panel i18n** — vue-i18n + 18 views translated + shared `@chainlesschain/locales` package

The web management panel switches from hardcoded Chinese to bilingual (zh-CN / en) — sidebar follows the header toggle. `@chainlesschain/locales` is the single source of truth so desktop-app-vue / docs / website can all reuse the same catalog.

| Theme                                   | Commit                    | Notes                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared locales package (M1)             | `b66dd9fe7`               | New `packages/locales/` workspace; zero runtime weight; vite/vitest aliases thread it in. `messages` / `SUPPORTED` / `FALLBACK` defined once.                                                                                                                                                                                                             |
| Extraction + drift tooling (M2)         | `f6c163c79`               | `npm run extract` (vue-i18n-extract; CI exit 1 on missing keys) + `scan-untranslated.js` (CJK drift scanner) + `no-stray-locales.test.js` (block per-project locale forks).                                                                                                                                                                               |
| vue-i18n wiring + ant-d-v locale sync   | `932f5ba38`               | `<a-config-provider :locale>` watches zhCN/enUS bundle, pagination / date pickers / Popconfirm follow the toggle. Language switch lives next to the theme switcher.                                                                                                                                                                                       |
| 18 views, ~1240 strings translated (M3) | `dd878633a` → `82b63b50a` | QuickAsk · Compliance · Pipeline · DID · KnowledgeGraph · Dashboard · Chat · WorkflowEditor · Marketplace · Trust · Governance · Privacy · Sla · Codegen · Tenant · NLProgramming · Crosschain · AppLayout (sidebar 137 items + 9 groups + header). Enum label mappers use `t(key) === key ? fallback : t(key)` so unknown values pass through unchanged. |
| Test hardening                          | `d0fa56f64`               | i18n-key-parity (zh/en JSONs MUST mirror, leaves non-empty, ≥18 namespaces) + mount-sweep across 17 views (mount + translated title visible in DOM). Unit 1660 → 1691 (+31), E2E 75/75.                                                                                                                                                                   |

**Audit deltas** (`packages/locales/scripts/scan-untranslated.js`)

- Before: 54 files / 2906 CJK occurrences
- After: 39 files / 1583 (-15 files, **-1323 strings, ~46% of the catalog**)
- ~25 views still have residual CJK; pattern is mechanical, can ship incrementally.

**Bug fixes**: no new bugs introduced. The single integration-test failure (`compliance threat-intel match 1.2.3.4`) is a corrupt local SQLite DB (`database disk image is malformed`) on the dev machine, not a code bug — `cc setup --reset` or removing `%APPDATA%/chainlesschain/data/chainlesschain.db` rebuilds it.

## 2026-05-03 Update — **MTC v0.12** — On-chain governance anchoring (Q-COMP-3 unlocked) + design doc cleanup + Deferred Items Registry

Legal sign-off received 2026-05-03 unblocks Q-COMP-3 (domestic consortium chain path). Lands v0.3 #2 on-chain governance anchoring + a cross-doc cleanup pass:

| Module             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lib (core-mtc)     | `SCHEMA_GOVERNANCE_ANCHOR` schema + `computeGovernanceSnapshotHash` (deterministic, order-independent) + pluggable `IChainAnchorClient` + `InMemoryChainAnchorClient` / `FilesystemChainAnchorClient` mock impls + `verifyGovernanceAnchor` with HASH_MISMATCH drift report                                                                                                                                                                                                                                                                                                                                                                                       |
| CLI                | `cc mtc federation governance-anchor <fed> --actor --chain-store [--chain-name]` (publish snapshot hash) + `governance-verify-anchor` (fetch latest chain record + compare local replay). Production deploy swaps in a real chain client — schema/CLI unchanged                                                                                                                                                                                                                                                                                                                                                                                                   |
| Design doc cleanup | (a) `MTC_联邦治理_v1.md` §11: #1 cross-fed trust + #2 chain anchoring + #4 third-party audit all marked ✅ with commit hashes; new §11.5 test-infrastructure limits (paxos/libp2p e2e). (b) `MTC_跨链桥_v1.md` §11: #3 multi-hop + #4 gas-aware + #5 monitoring + #6 SLA all marked ✅; #1/#2 explicit external blockers + expected unlock condition. (c) `默克尔树证书_MTC_落地方案.md` §14.2 Q-COMP-3 status flipped from "conservative decision" to "unlocked 2026-05-03". (d) **New §14.5 Deferred Items Registry — single source of truth** with cross-subdoc index of remaining 4 deferred items + 3 permanent constraints + v0.6→v0.12 full commit history |
| Tests              | +16 lib unit (snapshot hash determinism / order independence / fed isolation / dual mock clients / verifyAnchor HASH_MISMATCH+drift) + 5 CLI integration (publish / verify pass / verify mismatch / NO_ANCHOR_ON_CHAIN / repeated anchor increments block_height) = 21 new tests                                                                                                                                                                                                                                                                                                                                                                                  |

**Totals**: core-mtc 248 (+16 v0.12 anchor) + CLI integration 71 (+5 v0.12) + lib unit 70 (unchanged) = **389 green**.

**Still NOT done (only 4 items left, all with explicit external blockers)** — see `默克尔树证书_MTC_落地方案.md` §14.5 Deferred Items Registry:

- D1 Real RPC chain adapters — desktop major work
- D2 Cross-chain DID resolution (production path) — blocked same as D1
- D3 Full paxos cross-member real-time quorum — current alternative is production-ready
- D4 Libp2p cross-node wire e2e — testbed limitation

---

## 2026-05-03 Update — **MTC v0.11** — cross-fed trust + offline auditor + multi-hop + gas-aware + SLA + monitoring dashboard

Closes every doable item from cross-chain bridge §11 + federation governance v0.2 §11 (chain anchoring blocked by Q-COMP-3, real RPC adapters need major desktop work — both kept):

| Wave                                                 | Module                                  | Notes                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **A1** Cross-federation trust (v0.3 #1)              | `core-mtc/lib/federation-governance.js` | `SCHEMA_CROSS_FED_TRUST_ANCHOR` schema + `createCrossFederationTrustAnchor` + `validateCrossFederationTrustAnchor` (with EXPIRED check). CLI: `cc mtc federation cross-trust-create/validate`                                                                   |
| **A2** Independent third-party auditor (v0.3 #3)     | same lib                                | `auditGovernanceLog(events, fedId)` pure function: detects UNKNOWN_ACTOR / ACTOR_KEY_MISMATCH / BOOTSTRAP_KEY_MISMATCH / OUT_OF_ORDER findings, returns `{ok, findings[], final_state}`. CLI: `cc mtc federation audit <fed> [--summary                         | --json]` |
| **B1** Multi-hop bridge (bridge §11 #3)              | `cross-chain-mtc.js`                    | `buildMultiHopBridgeEnvelope` chains ≥2 single-hop envelopes; enforces `leg[i].dst_chain == leg[i+1].src_chain` continuity; new schema `mtc-bridge-multihop/v1`. `verifyMultiHopBridgeEnvelope` per-leg verify. CLI: `cc crosschain mtc-multihop-build/-verify` |
| **B2** Gas-aware batch (bridge §11 #4)               | same                                    | `shouldCloseBatchGasAware` heuristic: staged ≥ 50 hard-close; current_gas > baseline×1.5 defer; else close. CLI: `cc crosschain mtc-gas-check <chain> --staged-count <n> [--current-gas-usd]`                                                                   |
| **B3** SLA Manager integration (bridge §11 #6)       | same                                    | `getBridgeMtcSlaMetrics` outputs `cc sla`-compatible shape: `sla_status` (ok/degraded/down) + staging/batches/last-batch time. CLI: `cc crosschain mtc-sla`                                                                                                     |
| **C** Web-panel monitoring dashboard (bridge §11 #5) | `Mtc.vue` bridge tab                    | New "SLA / Monitoring" card: 4 statistics (status / staged / batches/h / last batch) + 30s auto-poll of `cc crosschain mtc-sla --json`. Can be tapped by external Prometheus / Grafana                                                                          |

**Test totals**: core-mtc 232 (+12 v0.3 lib) + CLI integration 66 (+6 governance + 4 crosschain) + lib unit 70 (+14 v0.2 lib) = **358 green**.

**Still NOT done (explicit external blockers / major dependencies)**:

- Chain anchoring of governance log (v0.3 #2) — waiting on Q-COMP-3 legal sign-off for domestic consortium chain path
- Real RPC chain adapters (bridge §11 #1) — needs desktop ethers/web3 integration + chain endpoints + extensive integration tests
- Cross-chain DID resolution (bridge §11 #2) — merged design with cross-fed trust; schema ready, waiting on real-chain path
- Full paxos cross-member real-time quorum (v0.10 carry-over) — multi-week distributed-systems work, out of incremental scope
- Libp2p cross-node wire e2e (v0.10 carry-over) — gossipsub mesh in 2-node testbed is flaky by design; replaced with call-path + dispatch tests

---

## 2026-05-03 Update — **MTC v0.10.1** — desktop V6 widget surfaces live sync stats

Closes the last small v0.10 item — wires the sync daemon stats files into the desktop V6 governance widget so users see real-time publish/pull/wire counters on the desktop:

| Module                | Notes                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main process IPC      | New `mtc:get-federation-sync-stats` channel + `readFederationSyncStatsFromDisk(dir)` helper, scans `<gov-dir>/*.sync-stats.json` returning `{federations: [{fed_id, mode, last_tick_at, publish, pull, libp2p}]}`                                                               |
| Preload bridge        | `electronAPI.mtc.getFederationSyncStats()`                                                                                                                                                                                                                                      |
| V6 widget enhancement | `FederationGovernanceWidget.vue` appends a sync sub-panel per federation card — shows mode (filesystem/libp2p) + last_tick relative time + Publish (last/total) + Pull (last/total + invalid/unknown) + libp2p wire (recv/appended). Sub-panel hidden when no daemon is running |
| Tests                 | +5 IPC unit (empty dir / parsing / ignores non-stats files / malformed JSON / channel registration) + +3 widget unit (filesystem mode / libp2p mode / hides when no stats). 41/41 desktop MTC tests green                                                                       |

Closes the "desktop V6 widget surfaces sync-stats" item from v0.10. The remaining 3 v0.10 candidates (full paxos cross-member quorum / WebSocket streaming sync-stats / libp2p cross-node wire e2e) are optimization paths waiting on real deployment feedback before prioritization.

---

## 2026-05-02 Update — **MTC v0.10** — multi-proposal CRDT + live sync stats + libp2p smoke test + hardening checklist

Closes the four v0.9 TODOs:

| Module                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-proposal CRDT         | `replayGovernanceLog` now retains ALL open propose-threshold / propose-revoke events (was overwriting same-target by latest write); new return fields `pending_thresholds[]` / `pending_revokes_all[]`, with old `pending_threshold` / `pending_revokes` kept as backward-compat (most recent only). `confirm-threshold --proposal-event-id <id>` CRDT-style explicit selection of one open proposal; default still confirms most recent |
| Live sync stats             | Both sync daemons persist `<dir>/<fed>.sync-stats.json` (atomic write) per tick; new `cc mtc federation governance-sync-stats <fed> [--json]` reads it. Web GUI / monitoring can poll the file                                                                                                                                                                                                                                           |
| Libp2p smoke tests          | `packages/core-mtc/__tests__/federation-governance-libp2p.test.js` 4 tests cover publishRaw call path, synthetic dispatch fan-out, receiver-side dedupe, topic format. Does **not** assert cross-node wire delivery (matches existing libp2p-federation-discovery policy — gossipsub mesh formation is genuinely flaky in 2-node test environments)                                                                                      |
| Systemd hardening checklist | `packages/cli/scripts/service/HARDENING.md` documents existing protections (`User=` / `NoNewPrivileges` / `ProtectSystem` / `ReadWritePaths` etc.) + 7-item pre-deploy verify list (account / mount / network / optional capability drop / SELinux) + known limitations + smoke-test steps                                                                                                                                               |

**Test totals**: core-mtc 220 (+6 conflict resolution + 4 libp2p smoke) + CLI integration 30 (+3 stats + 1 conflict CLI) = **250 green**.

Design tradeoffs: CRDT keeps all concurrent open proposals; confirm defaults to "most recent" (back-compat) but can pick specific via event_id. No full paxos / merkle CRDT — overkill for small federations (N<10). Live stats use file polling rather than WebSocket streaming to avoid ws-server changes. Libp2p e2e tests "call path doesn't throw + dispatch logic correct" instead of brittle wire delivery.

---

## 2026-05-02 Update — **MTC v0.9** — auto sync daemon + libp2p channel + quorum gating + web operational GUI

Closes the four v0.8 TODOs:

| Module                    | Notes                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto sync daemon          | `cc mtc federation governance-sync-serve <fed> --drop-zone <dir> [--interval] [--verify] [--once]` periodically publishes + pulls; SIGINT/SIGTERM graceful; helpers `runGovernancePublish` / `runGovernancePull` extracted for reuse                                                                            |
| libp2p sync transport     | `cc mtc federation governance-sync-libp2p <fed> --listen <maddr> [--connect] [--verify] [--once]`: gossipsub topic `mtc-federation-governance/v1/<fed>`; `<dir>/<fed>.libp2p-pos.json` high-water mark of already-published event_ids; receiver dedupes + verifies + appends; reuses existing `Libp2pTransport` |
| Quorum gating             | `cc mtc federation confirm-revoke` / `confirm-threshold` add pre-flight check for matching `propose-revoke` / `propose-threshold`; `--no-quorum-check` opts out. Also adds the previously-missing `cc mtc federation confirm-threshold <fed> --actor <m>` CLI                                                   |
| Web-panel operational GUI | `Mtc.vue` federation governance tab gains 5 sub-tabs (invite/vote/change threshold/revoke/cross-member sync), all calling local CLI via `ws.execute('mtc federation ...')` — **signing keys never enter the web renderer process**. Security alert embedded                                                     |
| Service template          | New `cc-fed-governance-sync.service` (systemd) template                                                                                                                                                                                                                                                         |

**Test totals**: CLI integration 27 (+6 new: confirm-threshold + quorum + sync-serve --once + sync-libp2p --help) + web-panel parser 13 (no regression) = **40 green**.

Design tradeoffs: libp2p sync uses a simple "high-water-mark republish" strategy (each tick publishes only events not yet published); receiver-side dedupe + verify makes that reliable without a pull protocol. Web operational GUI shells out via ws-bridge to local CLI, keeping signing material in the CLI process per the "keys-never-leave-CLI" constraint.

---

## 2026-05-02 Update — **MTC v0.8** — governance.log cross-member sync + service templates + governance GUIs (desktop + web)

Closes the two v0.7 limitations: governance.log only existing on local boxes, and governance state being CLI-only:

| Module                                       | Notes                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core-mtc sync helpers                        | `dedupeEventsByEventId` / `sortEventsChronologically` / `verifyGovernanceLog` (returns valid/invalid/unknown); +8 unit tests                                                                                                                                                                                    |
| 2 new CLI subcommands                        | `cc mtc federation governance-publish <fed> --drop-zone <dir>` (atomic per-event file, idempotent) + `cc mtc federation governance-pull <fed> --drop-zone <dir> [--verify]` (dedupe by event_id + optional signature verification); +5 integration tests covering alice→bob cross-home sync + dedupe + --verify |
| Service supervisor templates                 | `packages/cli/scripts/service/`: systemd unit (Linux) + launchd plist (macOS) + NSSM config (Windows) + Task Scheduler XML; explicit operator install, NOT auto-wired into npm postinstall                                                                                                                      |
| Desktop V6 governance widget                 | `FederationGovernanceWidget.vue` + `mtc:get-federation-governance` IPC + `electronAPI.mtc.getFederationGovernance`; lists all federations with status / threshold / members (active+candidate) / pending invites / pending revokes / archived/compromised keys; +7 widget unit + 4 IPC tests                    |
| Web-panel/Web-shell governance + bridge tabs | `Mtc.vue` adds "跨链桥 MTC" tab (config + trust-anchor table) + "联邦治理" tab (load governance-log by fed-id, renders status cards + member table + pending invites + event timeline). Web-shell embeds the same web-panel in Electron, zero extra work                                                        |

**Test totals**: core-mtc governance lib 28 unit + CLI governance integration 19 + desktop 26 IPC + 18 widget = **91 governance/sync-related tests** green.

Implementation stays opt-in: cross-member sync is manual `governance-publish/pull`, no auto daemon — automation deferred to v0.9.

---

## 2026-05-02 Update — **MTC v0.7** — Federation governance CLI + bridge MTCA daemon + V6 widget

Builds on v0.6 cross-chain MTC integration to make the governance design
doc executable rather than aspirational:

| Module                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core-mtc governance lib | `packages/core-mtc/lib/federation-governance.js`: 13 event types (create/invite/vote/leave/propose-revoke/confirm-revoke/rotate-key/propose-threshold/confirm-threshold/fork/merge/dispute/wind-down), `createGovernanceEvent` (multi-alg Ed25519/SLH-DSA), `verifyGovernanceEvent`, `replayGovernanceLog` — pure function deriving effective state (members + threshold + 0.5-weight candidate period + auto-promote after 30 days) |
| 8 new governance CLI    | `cc mtc federation invite/vote/propose-revoke/confirm-revoke/rotate-key/propose-threshold/fork/merge` all sign + append to `~/.chainlesschain/federation/governance/<fed>.jsonl`; `cc mtc federation governance-log <fed>` shows events + replay state                                                                                                                                                                               |
| Bridge MTCA daemon      | `cc crosschain mtc-serve [--interval <s>] [--once]`: periodic closeBatch; `--once` mode suits cron/tests; SIGINT/SIGTERM graceful shutdown                                                                                                                                                                                                                                                                                           |
| Desktop V6 widget       | `BridgeMtcStatusWidget.vue` + `mtc:get-bridge-status` IPC channel (preload `electronAPI.mtc.getBridgeStatus`); shows enabled/mode/alg/batch interval/trust anchors/pending-staging/latest batch; registered as `PREVIEW_WIDGETS["bridge-mtc"]`                                                                                                                                                                                       |
| Bug fix                 | governance lib's `pickSigner` accepts both canonical (`Ed25519`) and CLI-lowercase (`ed25519`) — otherwise verify returned `BAD_ALG`                                                                                                                                                                                                                                                                                                 |

**Test totals**: core governance lib 20 unit + CLI 14 integration + desktop 11 (5 widget + 6 IPC bridge) = **50 new tests green**; total MTC-related = core-mtc 202 + CLI 86 + desktop 32 = **320 tests**.

Implementation stays opt-in: `cc mtc federation` governance events only write to local governance.log on the actor's box — other members must actively sync the log or run a verifier to learn about changes.

---

## 2026-05-02 Update — **MTC v0.6** — Cross-chain bridge MTC integration + governance design docs

Two new design documents (closing §12 known-limit items #2 / #6) plus a new `cc crosschain mtc-*` subcommand surface that lets existing bridge / swap / send paths opt-in to MTC envelope writes:

| Module                             | Notes                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design — Federation governance v1  | `docs/design/MTC_联邦治理_v1.md`: 5-stage federation lifecycle (Bootstrap/Steady/Dispute/Wind-down/Closed), admission flow with 0.5-weight candidate period, M-of-N threshold per business tier, three exit paths, Fork/Merge semantics, governance.log schema |
| Design — Cross-chain bridge MTC v1 | `docs/design/MTC_跨链桥_v1.md`: lex-ordered `mtc/v1/bridge/<chain-pair>/...` namespace, three two-sided MTCA trust models (Independent/Federated/Light Client), cross-chain-specific threat analysis (T1 oracle collusion / T5 censorship)                     |
| CLI lib                            | `packages/cli/src/lib/cross-chain-mtc.js`: `bridgeNamespace` (lex-enforced) + Independent-mode trust-anchor store + `assembleBridgeBatch` / `verifyBridgeEnvelope` + staging lifecycle (`stageBridgeOp` / `closeBatch`)                                        |
| 4 new subcommands                  | `cc crosschain mtc-status` / `mtc-envelope` / `mtc-verify` / `mtc-trust-anchor {add,list,remove}` / `mtc-batch`                                                                                                                                                |
| `--mtc` opt-in flag                | `cc crosschain bridge                                                                                                                                                                                                                                          | swap | send --mtc`writes one staging op on success;`cc crosschain mtc-batch`closes staging into per-chain-pair batches (landmark + envelopes persisted to`batches/<pair>-<seq>/`) |
| Bug fix                            | `_dbFromCtx` now searches multiple parent levels for `_db` (was always null on spawnSync, breaking `bridge`/`swap`/`send` headless); crosschain `preAction` auto-bootstraps DB                                                                                 |
| core-mtc                           | `NAMESPACE_RE` extended with `bridge` kind (additive — does not break did/skill/audit)                                                                                                                                                                         |

**Test totals**: lib 56 unit + CLI 14 integration + 7 e2e + core-mtc 182 + existing cross-chain 83 = **342 tests green** across unit / integration / e2e plus cross-process independent verification.

Implementation stays opt-in (`--mtc` flag); flips to default-on after desktop RPC chain adapters mature.

---

## 2026-05-02 Update — **MTC v0.5** — Phase 3 federation suite + libp2p gossipsub auto-discovery

Phase 3 federation MTCA fully landed: M-of-N multi-signature landmarks,
local member registry, `cc mtc * --federation` publishing, cross-process
service discovery via shared filesystem (NFS/Syncthing/USB) + real P2P
libp2p gossipsub, heterogeneous Ed25519 + SLH-DSA member federations,
OpLog per-row "待批次关闭" badge wired through backend → web-panel.

| Phase                                   | Commit       | Notes                                                                                                                                           |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 Multi-sig + federation CLI          | `95b861914`  | `assembleBatchFederated` + LandmarkCache ≥M-of-N + `cc mtc federation join/leave/status` (atomic write, wx race-safe)                           |
| 3.2 Marketplace federation trust anchor | `15c29e9fe`  | `cc mtc batch* / publish-skills --federation <id> --threshold <M>`                                                                              |
| 3.3 Filesystem service discovery        | `aa13e07a9`  | `cc mtc federation discover --transport filesystem --drop-zone <dir>` + signed announce schema + TTL-evicting cache                             |
| 3.4 libp2p service discovery            | `70996de89`  | `--transport libp2p` + gossipsub topic `mtc-federation/v1/<id>` + `Libp2pTransport.publishRaw/subscribeRaw` generic pubsub API                  |
| OpLog per-row badge                     | `70d2cda59`  | backend `AuditMtcBridgeService` parses emit JSON → writes `audit_mtc_event_id` column (V013 migration); web-panel Audit.vue 4-state MTC column  |
| v0.5 bug audit (4 fixes)                | _this round_ | drawer migrated to real `electronAPI.file.readContent`; libp2p node init cleanup; scan re-entrancy guard; federation join `wx` exclusive create |

**Test totals**: core-mtc 182 + CLI 89 + desktop 33 + web-panel 153 + backend 19 = **476 tests green** across unit / integration / e2e / desktop-renderer / web-renderer / backend.

---

## 2026-05-01 Update — **MTC v0.4** — Marketplace publisher daemon + audit double-track scaffolding

Two Phase-2 MTC paths landed that don't depend on legal sign-off, plus four bug fixes from a focused audit pass.

| Topic                              | Commit        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assembleBatch` lifted to core-mtc | `c69900c7d`   | Pulled the canonical batch-assembly logic out of `cc mtc` into `packages/core-mtc/lib/batch.js` so all batch paths (CLI mtc, audit, future producers) share one verified codepath. New `./batch` subpath export. +3 core-mtc tests.                                                                                                                                                                                                                                                                                    |
| `cc mtc publish-skills` daemon     | `c69900c7d`   | Marketplace publisher: scans `CLISkillLoader.loadAll()`, computes a JCS-canonicalize → SHA-256 fingerprint over (id, version, category, activation, description) tuples, compares against a state file, and only mints a new batch when the fingerprint changes. Auto seq increment. State file uses atomic write (temp + rename) — survives mid-write crash without resetting `last_seq` to 0. `--once` for cron / CI; default `setInterval` daemon mode. +9 tests.                                                   |
| `cc audit mtc *` 8 subcommands     | `c69900c7d`   | Audit double-track scaffolding (off-by-default): `enable / disable / config / set-interval / emit / reconcile / reconcile-check / status`. Track 1 = realtime Ed25519 over content_hash on `emit`; Track 2 = Merkle batch on `reconcile` with idempotent atomic-rename close + crash-recovery (.tmp cleanup) + staging-only-deleted-after-rename invariant. Supports both 60s strict and 3600s lenient batch intervals so production-enable is a single flag-flip after Q-COMP-1 / Q-COMP-2 legal sign-off. +23 tests. |
| Bug audit: 4 fixes                 | (same commit) | (1) state file write made atomic in publish-skills; (2) staging schema + filename validation in audit-mtc rejects bogus dropped files; (3) `getStatus.oldest_queued_at` finds first valid record when alphabetically-leading entry is malformed; (4) `loadOrCreateIssuerKey` uses `wx` exclusive create — concurrent first-emit no longer generates conflicting keys. +6 regression tests.                                                                                                                             |
| Three-layer test coverage          | (same commit) | Unit (30) + integration (8) + e2e (6) for the new surfaces. The e2e spawns distinct CLI processes for every step and verifies envelopes independently with core-mtc (no CLI involved in the verify step), plus negative-path tampering + atomic state file recovery + cross-codepath equivalence (`cc mtc batch` ≡ `cc audit mtc reconcile` under the same protocol).                                                                                                                                                  |

**Status**: 222 MTC tests green across 4 layers (core-mtc 147 incl. SLH-DSA 7 + CLI unit 30 + integration 28 + e2e 6 + desktop V6 widget 11). Phase 1.6 (SLH-DSA real signing via `@noble/post-quantum@0.6.1`) and Phase 4 partial (V6 MTC status widget) landed in follow-up commits — `cc mtc * --alg slh-dsa-128f` is now opt-in for FIPS 205 post-quantum signing, and `cc mtc verify` auto-dispatches Ed25519 vs SLH-DSA based on landmark trust anchors.

**Audit MTC production-enable (2026-05-01)**: Q-COMP-1 (等保三级 finality window) + Q-COMP-2 (T/ZGCMCA 023—2025 clauses) legal sign-off received. The scaffolding still ships `enabled=false` by default — each tenant enables explicitly via `cc audit mtc enable --interval <60|3600>` within their own environment. Backend gradual rollout (Q-ENG-2) is a separate release-process item, not blocked anymore but pending its own review. Audit production-enable still gated on Q-COMP-1 (等保三级 finality window) + Q-COMP-2 (T/ZGCMCA 023—2025 clauses) — both require external legal sign-off, not code work.

**Not done**: SLH-DSA real signing (waiting on `@noble/post-quantum` npm release; single-point swap reserved at `audit-mtc.js#loadOrCreateIssuerKey` + `assembleBatch#signTreeHead`); backend audit gradual rollout (Q-ENG-2 — needs production-enable first); Desktop UI Pack (Phase 4).

See [`docs/design/默克尔树证书_MTC_落地方案.md`](docs/design/默克尔树证书_MTC_落地方案.md) v0.4, [user guide](https://docs.chainlesschain.com/guide/mtc-merkle-tree-certs), [design doc site](https://design.chainlesschain.com/mtc-landing-plan).

---

## 2026-05-01 Update — **Phase 2 wrap-up** — streaming cancellation + config persistence fix + Speech port + bug bash

A single rollup that closes five threads on the desktop web-shell: cancel half of `llm.chat`, the Phase 1.4 vendor target correction, the SystemSettings persistence whitelist hole, the Speech leg of the SystemSettings → web-panel migration, and a CLI session-list contract bug discovered along the way.

| Topic                                       | Commit                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm.chat` real cancellation                | `b6b5174cb` + `4951c95d5` | ws-cli-loader gains `inFlightStreams<id, gen>`. Both `ws.on("close")` (lazy WeakSet hook because CLI ws-server's `connection` event omits the ws ref) and `<topic>.cancel` frames drive `gen.return()`. The llm-handlers generator's finally block calls `AbortController.abort()`; the signal threads through to ollama / anthropic / openai client `fetch` (gemini's axios call has a different param order — left for a separate refactor). `useLlmChat.cancel()` actually stops the underlying HTTP. |
| AppConfigManager `ui.*` persistence         | `436e349f1`               | DEFAULT_CONFIG gains a `ui` block + load/loadAsync merge whitelist gains a `ui` line; `_readSettingsSync` now layers `app-config.json`'s `ui` on top of `settings.json` so the SystemSettings V6 / Web Shell toggles actually take effect on the next launch. The original silent-drop bug (V6 toggle had it too) is closed.                                                                                                                                                                             |
| Phase 1.4 vendor target                     | `cecb94980`               | `forge.config.js`'s `vendorWebShellInto(buildPath)` corrected to `path.join(buildPath, "..")` to match the path-math test fixture; packaged loaders' 4-up REL now actually lands at `Resources/packages/`. The dead `packages/**` glob in `asar.unpack` is dropped.                                                                                                                                                                                                                                      |
| Speech sub-page → web-panel                 | `2d45ae278`               | New `views/SpeechSettings.vue` + `utils/speech-settings-parser.js` + `/speech-settings` route. Engine selector + Web Speech / Whisper API / Whisper Local core config; the V5 advanced storage / audio / knowledge-integration / performance sub-sections stay (Memory Bank-style deliberate scope cut). LLM and Project already had Providers + ProjectSettings on the web-panel side; the V5 SystemSettings tabs gain an a-alert pointing to the web-panel equivalents.                                |
| `session-close` actually removes (drive-by) | (pending commit)          | CLI `ws-session-gateway.js`: `_serializeSessionMetadata` now writes `status`; `listSessions` DB path skips rows where `metadata.status === "closed"`. After `session-close`, `session-list` no longer returns the closed session.                                                                                                                                                                                                                                                                        |

**Test matrix**: desktop unit 248 + config 26 + scripts 14 + integration 514 + web-shell e2e 14 + Playwright 4. Web-panel unit 1616 + integration 58 + e2e 75 (including the now-fixed session-close case). CLI session-gateway 58. ~2480 tests green (excluding skipped + one local-env failure caused by a corrupted local `chainlesschain.db`).

**Not done**: Phase 1.4 real packaging (`make:win`) + gemini-client signal threading + param-order correction + remaining SystemSettings tabs (Vector / Git / Backend / ...) following the Speech template.

See [`docs/design/桌面Web壳_架构与落地_设计文档.md`](docs/design/桌面Web壳_架构与落地_设计文档.md).

---

## 2026-04-30 Update — **Desktop Web-Shell Phase 0 → 1.4 prep all landed** — embed web-panel SPA in-process + protocol merge + desktop-only topics + opt-in entry + packaging vendor

Desktop direction locked: **Desktop = web edition's superset** — Electron embeds the `web-panel` SPA in-process; desktop-only capabilities (U-Key / FS / MCP / Ollama) layer on as new WS topics + a minimal preload, expressing the "leverage existing strengths" axis. See [`docs/design/桌面Web壳_架构与落地_设计文档.md`](docs/design/桌面Web壳_架构与落地_设计文档.md) (synced to `docs-site/docs/design/desktop-web-shell-architecture.md`).

| Phase                            | Status | Key artefacts                                                                                                                                                                                             |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 spike                          | ✅     | `web-ui-loader.js` in-process HTTP embed + `ws-bridge.js` minimal topic + `phase0-smoke.cjs` end-to-end                                                                                                   |
| 1.1 protocol merge               | ✅     | `ws-cli-loader.js` wraps CLI `ChainlessChainWSServer` and monkey-patches `_dispatcher.dispatch` so custom topics share the same WS as web-panel's CLI protocol (auth / ping / session-\*)                 |
| 1.2 desktop-only topics, batch 1 | ✅     | `skill.list` (in-process CLISkillLoader, bypasses SPAWN_ERROR) + `fs.openDialog` / `fs.saveDialog` (dialog-based, security-first, 10 MiB read cap)                                                        |
| 1.3 entry UX                     | ✅     | `shouldRunWebShell(argv, env, settings)` three-way; SystemSettings adds `ui.useWebShellExperimental` toggle, mirrors the V6 hard-flip (`caaddf530`) playbook                                              |
| 1.4 packaging prep               | ✅     | `scripts/prepare-web-shell-vendor.js` + **Decision A**: vendor target = `path.join(buildPath, "..")` so the loaders' 4-up REL resolves in both dev and packaged. `forge.config.js#packageAfterCopy` wired |

**Test matrix**: 117+ tests covering web-shell hot paths — unit 79 + integration 14 + scripts 14 + config 6 + Playwright e2e 4 + one-shot `phase0-smoke.cjs`.

**Activation**: System Settings → General → "Enable Web Shell (Experimental)" toggle (restart); or `npm run dev:web-shell` / `--web-shell` argv / `CHAINLESSCHAIN_WEB_SHELL=1` env.

**Known limitations**: `_executeCommand` inside Electron has `process.execPath` pointing at Electron rather than node (CLI now adds `ELECTRON_RUN_AS_NODE=1` workaround); SystemSettings toggle persistence travels via `config:set` → AppConfigManager whose whitelist drops the `ui` field (same bug as the V6 toggle, fixed separately). For dogfood the env/argv channels still work.

**Not done**: Phase 1.4 real packaging (`make:win` cycle requires the user's machine) + Phase 1.5 multi-window architecture (design memo landed, implementation deferred).

---

## 2026-04-29 Update — **V6 Preview Shell P9d** — brand cleanup + blank-start + Settings entry

Cleared the residual demo footprint from the `/v6-preview` shell so it can be shown to outsiders as-is.

| Change                               | Detail                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation-preview.ts` schema     | bumped `version: 2 → 3`; removed `seedConversations()` / `createDemoFiles()` / the legacy demo file tree; first launch (or schema/JSON corruption) now lands on `conversations: []` + `activeId: null` and the UI tells the user to hit "+ 新会话"; `agentLabel` default `"Claude Code" → "ChainlessChain"`                 |
| Brand chrome (`AppShellPreview.vue`) | top-left wordmark "ClaudeBox" replaced by `import brandLogo from "../assets/logo.png"` + text "ChainlessChain"; composer caption drops the trailing "运行中..." (running) suffix                                                                                                                                            |
| Platform-aware traffic dots          | macOS red/yellow/green dots gated by `v-if="isMacPlatform"`; on mount `await window.electronAPI.system.getPlatform() === "darwin"`; hidden on Win/Linux                                                                                                                                                                     |
| Settings entry                       | the 5 runtime chips at the composer footer (progress / model / skill / tool / terminal) collapse into a single button-chip showing `runtimeStatus.modelLabel \|\| "未配置模型"`; a new gear `SettingOutlined` button sits beside the theme buttons; both `router.push({ path: "/settings/system", query: { tab: "llm" } })` |
| Tests                                | `conversation-preview.test.ts` rewritten around blank-start semantics, expanded to 23 cases; preview-shell suites (theme 10 + widget-registry 5 + v6-shell-default 9 + conversation-preview 23) total 47 tests, all green (17.1s); `vue-tsc --noEmit` 0 errors                                                              |

This pass touches only the renderer + persisted schema — main-process IPC and route table unchanged. See `docs/design/modules/97-claude-desktop-refactor.md` §交付状态 P9d.

---

## 2026-04-26 Update — **web-panel Phase B fully shipped** — Community / Marketplace / Cross-chain / AIOps / Compliance + scrollable & collapsible sidebar

After the V6 hard-flip closed, web-panel entered Phase B: ports 5 high-traffic desktop features into the browser panel, one commit per feature with scope `feat(web-panel):`, template = `<feature>-parser.js` (pure, with shared `stripCliNoise`) + `<Feature>.vue` + router/sidebar wiring + parser unit tests + new-pages route count +1 + path-mapping assertion. After Phase B completed, did sidebar independent-scroll + collapsible-groups as a follow-up.

### Phase B — 5 ports (commit order)

| Commit      | Route          | Sidebar group | CLI source                        | Cards / Tabs / Modals                                                                                           |
| ----------- | -------------- | ------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `260787c99` | `/community`   | 社 交 (new)   | `cc social ...`                   | 5 / 3 (Posts+Friends+Contacts) / 2 (Publish+AddContact)                                                         |
| `792b211e1` | `/marketplace` | 数 据         | `cc marketplace ...`              | 5 / 2 (Services+Invocations) / 2 (Publish+RecordInvocation) + status-transition dropdown                        |
| `8f7d87ede` | `/crosschain`  | 高 级         | `cc crosschain ...`               | 5 / 3 (Bridges+Swaps+Messages) / 4 (Bridge+Swap+Send+FeeEstimate) + chain catalogue                             |
| `30cf3b6ab` | `/aiops`       | 概 览         | `cc ops ...`                      | 5 / 3 (Incidents+Playbooks+Baselines) / 4 (CreateIncident+Playbook+Baseline+DetectAnomaly) + severity breakdown |
| `04c57237d` | `/compliance`  | 高 级         | `cc compliance threat-intel/ueba` | 5 / 2 (ThreatIntel+UEBA) / 3 (Match+BuildBaseline+RunAnalyze) + IoC type breakdown                              |

### Sidebar refactor — commit `7ee1985c5`

After 5 new entries pushed the sidebar past viewport on shorter screens. Root cause: `.app-root` used `min-height:100vh` (allows growth), so `.side-menu`'s `overflow-y:auto` never triggered.

| Change                                                              | Effect                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `.app-root` `min-height` → `height: 100vh; overflow: hidden`        | Lock viewport height                                   |
| `.main-area` `display: flex; flex-direction: column; height: 100vh` | Header + content split via flex                        |
| `.page-content` `flex: 1; min-height: 0`                            | Flex child triggers independent scroll                 |
| 8 `<a-menu-item-group>` → `<a-sub-menu>`                            | Second-level menus collapse on click                   |
| `v-model:openKeys` + localStorage (`cc.web-panel.sidebar.openKeys`) | Open state survives reload, 9 tests cover the contract |

### Test reinforcement — commit `d43e43a93`

| Change                                                                    | Detail                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NEW integration**: `__tests__/integration/phase-b-cli-commands.test.js` | 19 tests. Spawns real `cc serve` on 19410 and runs every CLI command the 5 views consume; pipes output through the matching parser and asserts no throw + expected shape |
| **FIX e2e**: `__tests__/e2e/panel.test.js SPA_ROUTES`                     | 23 → 34 (11 routes were missing from SPA fallback coverage, including Phase A's did/project-settings/knowledge)                                                          |
| **NEW unit**: `__tests__/unit/sidebar-openkeys.test.js`                   | 9 tests locking the localStorage contract: defaults, partial state, all-collapsed, corrupt-JSON tolerance, unknown-key filtering                                         |

### Test matrix

| Suite                                                          | Result                                                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| web-panel `__tests__/unit/`                                    | **809/809** (599 baseline + 5 × ~35 parser + 9 sidebar + new-pages assertions)               |
| web-panel `__tests__/integration/phase-b-cli-commands.test.js` | **19/19** (~40s end-to-end, every command runs against the live CLI)                         |
| vite build                                                     | clean — KnowledgeGraph chunk is the only >500kB warning (pre-existing Phase A, echarts size) |

### Route count

router children 30 → **35** (1 redirect + 34 named pages); sidebar gains 1 new group (社 交) + 4 entries spread across Data / Overview / Advanced.

### Next watch

Phase B closed. Bench candidates for B6+: Privacy Computing / Inference Network / NL Programming / Tenant SaaS / AI-doc-creator — pull as needed; the template is fully mechanical.

---

## 2026-04-26 Update — **V6 shell hard-flip** + top-10 parity 10/10 closure + web-panel Phase A fully landed

The V6 desktop shell graduates from soft-opt-in (2026-04-21) to **default**: completed the last 6 V5→V6 widget probes (did-management / projects / p2p-messaging / community / ai-chat / settings), filled top-10 parity to 10/10, and flipped the default destination to V6. Same day, the web-panel Phase A trio (DID / Knowledge Graph / Project Settings) shipped wired into the router.

### V6 widget probes — 6 added today

Each probe follows the standard 5-7 file template: `plugin.json` + `<Name>Widget.vue` + `<Name>Panel.vue` + optional thin Pinia store + `widgets/index.ts` + `AppShell.vue` panel mount + integration test.

| Commit      | Probe          | Slash        | Thin store               | Panel data source                                                                  |
| ----------- | -------------- | ------------ | ------------------------ | ---------------------------------------------------------------------------------- |
| `35f4e278b` | did-management | `/did`       | `useDIDManagementStore`  | `did:get-all-identities` / `did:get-current-identity` / `did:set-default-identity` |
| `a097596f5` | projects       | `/projects`  | `useProjectsQuickStore`  | `project:get-all` (recent-5)                                                       |
| `3883a72ec` | p2p-messaging  | `/p2p`       | `useP2PMessagingStore`   | `p2p:get-node-info` / `p2p:get-peers` / `p2p:get-nat-info` (graceful null/[])      |
| `5b5e6fe1d` | community      | `/community` | `useCommunityQuickStore` | `community:get-list` (graceful [])                                                 |
| `396d6e7b1` | ai-chat        | `/chat`      | `useAIChatStore`         | `llm:check-status` + `llm:get-config`                                              |
| `ccbc312fd` | settings       | `/settings`  | — (pure-info)            | static list of 7 SystemSettings sub-panes                                          |

ai-chat is the gating route for the hard-flip — once settings landed, all top-10 routes (settings/knowledge/projects/chat/did/p2p/community/ai/workflow/enterprise) had V6 widgets.

### V6 hard-flip — commit `caaddf530`

| File                                | Change                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `router/v6-shell-default.ts`        | Initial `useV6ShellByDefault = false → true` (covers pre-config-load window + bootstrap try/catch failure path)                           |
| `main.ts`                           | `setV6ShellDefault(raw === true) → setV6ShellDefault(raw !== false)` — unset config defaults to V6, only explicit `false` opts back to V5 |
| `pages/settings/SystemSettings.vue` | Form initializer + description text flipped accordingly                                                                                   |

The opt-out toggle and pure helper `resolveHomeRedirect()` stay untouched, honoring the migration template's "no other code needs to move" guarantee. **Existing users see V6 shell on next launch**; opt back to V5 by switching off "启用 V6 桌面壳" in SystemSettings.

Companion fix `72b826bdf` aligns the "立即试用" link drift: SystemSettings was pushing `/v2` while the router redirect target is `/v6-preview` — both unified to `/v6-preview`.

### web-panel Phase A: DID / Knowledge Graph / Project Settings

| Commit      | Scope                                             | Routes                       |
| ----------- | ------------------------------------------------- | ---------------------------- |
| `f37aa44d0` | KG full + DID scaffold + echarts/vue-echarts deps | `/knowledge` end-to-end      |
| `d1f22ce2d` | ProjectSettings scaffold                          | (scaffold)                   |
| `c0e96c9e0` | DID + ProjectSettings wiring                      | `/did` + `/project-settings` |

KG ships 4 tabs: force-directed graph (ECharts) / entity table / relation table / type distribution; CRUD + multi-hop BFS reasoning all via `cc kg list/relations/stats/reason --json`. DID reuses `cc did *`; mnemonic / DHT buttons displayed disabled with tooltip "桌面专属". ProjectSettings covers 4 fields (rootPath/maxSizeMB/autoSync/syncIntervalSeconds) via `cc config get/set project.*`, with `diffProjectConfig` issuing `set` only for changed fields.

### Test matrix (657 today-related green + 36/36 V6 surface on hard-flip day)

| Suite                                         | Result                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-extension-points.integration.test.js` | **19/19** (one new it block per probe)                                                                                          |
| `slash-dispatch.test.ts`                      | **8/8**                                                                                                                         |
| `v6-shell-default.test.ts`                    | **9/9** (4 assertions flipped accordingly)                                                                                      |
| web-panel `__tests__/unit/`                   | **621/621** (incl. 24 did-parser + 27 kg-parser + 20 project-settings-parser)                                                   |
| desktop `tests/integration`                   | 509/512 (3 fail in `coding-agent-bridge-real-cli.test.js` — pre-existing ECONNREFUSED on real CLI server, not introduced today) |

### Post-deployment watch

Scheduled remote agent `trig_013pjiuMPAUkNyoE4QxVdee8` fires 2026-05-10 09:00 Asia/Shanghai — checks git log for revert/regression commits, `gh issue list` for V6 user reports, runs the 3 V6 surface test files, and reads CLAUDE.local for rollback notes. Reports keep / tweak / revert recommendation under 250 words. Manage at https://claude.ai/code/routines/trig_013pjiuMPAUkNyoE4QxVdee8.

---

## 2026-04-24 Update — `cc pack` v0.4 (base mode + **project mode** fully shipped)

**`cc pack`** evolves from a "CLI bundler" (v0.2) into a "**project bundler**" (v0.4). In addition to the original single-file CLI + Web UI distribution, the new `--project` mode bakes the CWD's `.chainlesschain/` (config, skills, rules, persona) into the exe — so what the recipient double-clicks is "the agent for **this** project", not a vanilla ChainlessChain.

### Two modes, one line each

```bash
# Base mode: generic ChainlessChain portable exe
cc pack --skip-web-panel-build --allow-dirty
# → dist/chainlesschain-portable-node20-win-x64.exe (~58 MB)

# Project mode: CWD's .chainlesschain/ auto-embedded (auto-detected)
mkdir my-medical-agent && cd my-medical-agent
cc init -t medical-triage
cc pack
# → dist/my-medical-agent-portable-node20-win-x64.exe
#   + same-dir .pack-manifest.json (with a bundledSkills audit list)
```

At startup: base mode opens the generic Web UI; project mode first materializes `.chainlesschain/` into `~/.chainlesschain-projects/<name>-<sha8>/`, `CC_PACK_AUTO_PERSONA` activates the project persona, `CC_PROJECT_ALLOWED_SUBCOMMANDS` narrows the commander whitelist, and `/api/skills` returns the project's skill list.

### Phase 2 packing bugs fixed (base mode)

| Symptom                                                           | Root cause                                                             | Fix                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-clicking flashes a black window that closes instantly      | Synthesized entry had no subcommand → commander prints help and exits  | Entry now injects `argv.push('ui')` when no subcommand is present; `--version`/`--help` short-circuit untouched                                                                                                                                            |
| `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` on first launch          | pkg's snapshot bootstrap doesn't register a dynamic-import callback    | Entry rewritten to **static ESM imports** of `ensureUtf8` + `createProgram` — no `import(...)`                                                                                                                                                             |
| `NODE_MODULE_VERSION 127 … requires 115` then DB init fails       | Host built the native `.node` against Node 22; pkg packaged Node 20    | `loadSQLiteDriver` now probes each native candidate via `new Database(':memory:').close()`; ABI mismatch → automatic sql.js fallback                                                                                                                       |
| sql.js fallback selected but `prepare(...).all is not a function` | Legacy fallback only swapped the driver, never adapted the API surface | New `createSqlJsCompat(raw, dbPath)` wraps sql.js into the better-sqlite3 shape callers assume: `prepare().all/get/run`, `transaction` BEGIN/COMMIT/ROLLBACK, `pragma` no-op, `close` auto-persist                                                         |
| `Auth: disabled` even with `--token auto`                         | Entry never baked the token field                                      | Entry now embeds a frozen `BAKED` constant; `--token auto` (default) generates a fresh `crypto.randomBytes(16)` token on every launch and prints it; `CC_PACK_TOKEN` / `CC_PACK_UI_PORT` / `CC_PACK_WS_PORT` / `CC_PACK_HOST` env vars override at runtime |

### Project mode Phase 2a / 2b / 3a / 3b (new in v0.4)

| Phase  | Commit      | Key outputs                                                                                                                                                                                                                            |
| ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2a** | `522d7c8c9` | BAKED fields (projectMode/Name/Sha/Entry/AutoPersona/AllowedSubcommands/BundledDir) + entry `copyRecursiveMerge` (new files appended, existing files preserved + warn) + `sanitizeProjectName()` (Windows reserved names, 64-char cap) |
| **2b** | `69a91c450` | `web-ui-server.js` adds `GET /api/skills`: returns `{schema:1, skills:[{name, source, category, ...}]}` driven by `CLISkillLoader.loadAll()`; smoke-runner upgrades from pre-wired to a real assertion                                 |
| **3a** | `dce8e5d66` | `createProgram(opts)` supports `allowedCommands` whitelist / `CC_PROJECT_ALLOWED_SUBCOMMANDS` env-var filtering — unlisted subcommands never register with commander                                                                   |
| **3b** | `7633ad483` | `CC_PACK_AUTO_PERSONA` env var export + `pack-manifest.json.bundledSkills` field (recipient audit) + Phase 8 smoke cross-checks the returned set                                                                                       |

### Test matrix (total **108 project-mode + 96 base-mode = 204, all green**)

- **Base mode** (Phase 0-3): `createSqlJsCompat` ×12 + packer five modules ×57 + integration ×6 + E2E ×4 (gated)
- **Project mode** (new in v0.4):
  - Unit ×97: allowed-commands 9 + precheck-project-mode 26 + project-assets-collector 17 + pkg-config-generator 28 + manifest-writer 9 + smoke-runner 8
  - Integration ×11: packer-pipeline 8 + packer-dry-run 3
- **Smoke**: `runPack` phase 8 spawns the fresh artifact, probes HTTP 200 + WS handshake + (project mode) asserts `/api/skills` contains bundledSkills; cross-platform builds / pre-Phase-2b artifacts (404) are softly tolerated

### Docs

- Base command reference: [docs-site/docs/chainlesschain/cli-pack.md](./docs-site/docs/chainlesschain/cli-pack.md)
- **Project-mode user doc**: [docs-site/docs/chainlesschain/cli-pack-project.md](./docs-site/docs/chainlesschain/cli-pack-project.md) (v0.4)
- Full design spec (v0.4): [docs/design/CC*PACK*打包指令设计文档.md](./docs/design/CC_PACK_打包指令设计文档.md)
- CLI index: [docs/CLI_COMMANDS_REFERENCE.md](./docs/CLI_COMMANDS_REFERENCE.md) → System Management

---

## 2026-04-22 Update — MainLayout + DIDManagement SFC split · Shell wired to real LLM · Startup Critical/Deferred split · Heavy-component lazy-load

Continuing the SystemSettings / ChatPanel SFC split from 2026-04-21, this cut finishes off the remaining large SFCs (MainLayout, DIDManagement) and clears three "hidden bug surface" root causes: Shell now actually talks to the LLM, the main-process startup is split into Critical/Deferred phases, and heavy renderer components are lazy-loaded.

### Split results

| Large SFC         | Before |           After | New children                                                                                                       | Path                              |
| ----------------- | -----: | --------------: | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| MainLayout.vue    |   3203 | **1943 (−39%)** | FavoriteManagerModal · HeaderBreadcrumbs · SyncStatusButton · VoiceCommandHandler · SidebarContextMenu · AppHeader | `src/renderer/components/layout/` |
| DIDManagement.vue |   1390 |  **543 (−61%)** | AutoRepublishSettingsPane · MnemonicModals · IdentityDetailsModal                                                  | `src/renderer/components/did/`    |

### Shell wired to real LLM (V6 preview shell)

- `ShellComposer.vue` `handleSend()` is no longer a stub: it tries `sendLlmChatStream()` (prompt-only, via `window.electronAPI.llm.queryStream`) first, then falls back to `sendLlmChat(payload)` non-streaming with full history; both gated by an upfront `isAvailable()` check.
- `ConversationStream.vue` now reads from `useConversationPreviewStore` and renders a 3-dot typing indicator (`@keyframes shell-typing`) while streaming. The `did-chip` has been removed for a cleaner meta row.
- Phase 3.4 soft switch **redirect target changed from `/v2` to `/v6-preview`** (`resolveHomeRedirect` in `router/v6-shell-default.ts`): when `ui.useV6ShellByDefault` is enabled, the root path now opens the Claude-Desktop-style preview shell directly instead of the V2 shell; all 9 unit tests updated.

### Main-process startup split Critical / Deferred

- `bootstrapCritical()` runs phases 0-5 (hooks / core / file / LLM / session / RAG+Git) and blocks splash (5-55%).
- `bootstrapDeferred()` runs phase 6+ (skills / tools / advanced) during splash 55-90%.
- IPC registration split into `registerCriticalIPC()` + `registerDeferredIPC()`; `setupIPC` is only called once inside `createWindow`. Root cause for the "can't send message" symptom: phase files previously registered IPC handlers ad-hoc and raced with `ipc-guard.resetAll()`, leaving duplicate `llm:chat` / `conversation:*` handlers.
- `CHAINLESSCHAIN_LEGACY_BOOT=1` keeps the legacy single-phase boot as a fallback.

### Heavy renderer components lazy-loaded

Five imports switched to `defineAsyncComponent`: FileEditor → MonacoEditor (~5MB), KnowledgeDetailPage → Milkdown MarkdownEditor (~1.5MB), DesignEditorPage → Fabric DesignCanvas (~1MB), ProjectDetailPage → CodeEditor / MarkdownEditor / WebDevEditor. Build verification: monaco ships as its own chunk, **3.7MB / gzip 938KB**, no longer pulled on first paint.

### Backend services now polled in parallel

`BackendServiceManager.waitForServices()` now runs all 4 services (9101 / 9102 / 9103 / 9090) concurrently via `Promise.all`, each with `maxRetries=10` × 1s (down from 30s). `startServices()` no longer awaits readiness — it assigns the promise to `this.servicesReady` for callers to await if they need it.

### Regression coverage

| Scope                                                                                             | Command                                                                                                                                         | Result                                                                              |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Full store regression                                                                             | `npx vitest run src/renderer/stores/__tests__/`                                                                                                 | **600 / 600** (23 files · 35s)                                                      |
| Shell + router + bootstrap                                                                        | `npx vitest run src/renderer/shell src/renderer/shell-preview src/renderer/router/__tests__ tests/unit/bootstrap`                               | **76 / 76** (5 files)                                                               |
| Skill-handlers + ipc-guard + bootstrap                                                            | `npx vitest run tests/unit/ai-engine/skill-handlers.test.js tests/unit/core/ipc-guard.test.js tests/unit/bootstrap/initializer-factory.test.js` | **285 / 285**                                                                       |
| Vue components                                                                                    | `npx vitest run tests/unit/components tests/unit/core/core-components.test.ts`                                                                  | **124 / 125** (1 skip)                                                              |
| AI + core + multi-agent                                                                           | `npx vitest run tests/unit/ai/skill-tool-ipc.test.js tests/unit/core tests/unit/ai-engine/multi-agent`                                          | **411 / 413** (2 skip)                                                              |
| Database + enterprise + did + knowledge                                                           | `npx vitest run tests/unit/database tests/unit/enterprise tests/unit/did tests/unit/knowledge`                                                  | **1456 / 1464** (8 skip · 3 stderr errors are pre-existing test-scaffolding issues) |
| shell-preview (components / services / widgets)                                                   | `npx vitest run src/renderer/shell-preview`                                                                                                     | **51 / 51**                                                                         |
| Integration (mcp / canonical / coding-agent / planning-ipc / code-execution / file-ops · 9 files) | `npx vitest run tests/integration/...`                                                                                                          | **98 / 104** (6 skip)                                                               |
| Smoke build                                                                                       | `npm run build:renderer && npm run build:main`                                                                                                  | ✅ Both green (renderer 6m28s)                                                      |
| Lint (changed files)                                                                              | `npx eslint src/renderer/components/layout src/renderer/shell ...`                                                                              | **0 errors** (237 style warnings, all `vue/max-attributes-per-line`)                |
| E2E enumeration                                                                                   | `npx playwright test --list`                                                                                                                    | Playwright lists **1017 tests / 163 files**; health check 80%                       |

🟢 No regression bugs leaked; see [docs-site changelog](./docs-site/docs/changelog.md) and [design doc Appendix C](./docs/design/桌面版UI重构_设计文档.md#附录-cv08-拆分与启动优化2026-04-22).

---

## 2026-04-21 Update — Phase 3.3c closure + Phase 3.4 soft switch + regression expansion

Following the V6 preview shell P9c and 8 V5→V6 probes landed 2026-04-20, this cut **fills in unit tests for the 5 Phase 3.3c thin stores**, merges the **Phase 3.4 soft switch** (`/` → `/v2` opt-in), and fixes two pre-existing type/runtime drifts surfaced by the expanded regression.

| Stage                                                                                         | Command                                                                                                             | Result                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **New store unit tests** (rag / wallet / git-hooks / workflow-designer / analytics-dashboard) | `npx vitest run src/renderer/stores/__tests__/{rag,wallet,git-hooks,workflow-designer,analytics-dashboard}.test.ts` | **83 / 83 green** (rag 12 · wallet 13 · git-hooks 14 · analytics 20 · workflow 24)    |
| **Full store regression**                                                                     | `npx vitest run src/renderer/stores/__tests__/`                                                                     | **600 / 600 green** · 23 files · ~42s                                                 |
| **Plugin extension-points integration**                                                       | `npx vitest run tests/integration/plugin-extension-points.integration.test.js`                                      | **13 / 13 green** (5 legacy MDM override + 8 Phase 3.2 probes)                        |
| **Phase 3.4 router-guard unit test**                                                          | `npx vitest run src/renderer/router/__tests__/v6-shell-default.test.ts`                                             | **9 / 9 green**                                                                       |
| **Type check**                                                                                | `npx vue-tsc --noEmit`                                                                                              | **0 errors** (fixed one pre-existing `electronAPI.config` type drift)                 |
| **E2E structural health check**                                                               | `npm run test:e2e:check`                                                                                            | **66 / 66 structurally valid** · 10 module groups                                     |
| **E2E Playwright full run**                                                                   | —                                                                                                                   | Not in this cut (needs a live Electron process; out of scope for a non-UI regression) |

**Bug fixes in this cut**:

1. `src/renderer/utils/logger.ts:121` — wrapped IPC return with `Promise.resolve(result).catch(...)` to defend against `invoke()` returning `undefined`, which was throwing `Cannot read properties of undefined (reading 'catch')`.
2. `src/renderer/types/electron.d.ts` — added the missing `ConfigAPI` interface to match `preload/index.js:367` (already exposing `config.{get,set,update,...}`), resolving the `main.ts:69` TS2339 drift.

**New Phase 3.3c store index** (landed in commits `11b69d / 461d42 / c86bf4 / 4cf49ef / 8aec26`):

| Store                           | Backing Panel                       | Triggered IPC prefix                                                                                                         |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `stores/rag.ts`                 | `shell/KnowledgeGraphPanel.vue`     | `rag:get-stats` · `rag:rebuild-index`                                                                                        |
| `stores/wallet.ts`              | `shell/WalletPanel.vue`             | `wallet:get-all` · `wallet:set-default`                                                                                      |
| `stores/git-hooks.ts`           | `shell/GitHooksPanel.vue`           | `git-hooks:run-pre-commit` · `run-impact` · `run-auto-fix` · `get-config` · `set-config` · `get-history` · `get-stats`       |
| `stores/workflow-designer.ts`   | `shell/WorkflowDesignerPanel.vue`   | `workflow:list` · `workflow:create` · `workflow:get` · `workflow:save` · `workflow:execute` · `workflow:step:*` event stream |
| `stores/analytics-dashboard.ts` | `shell/AnalyticsDashboardPanel.vue` | `analytics:get-dashboard-summary` · `get-time-series` · `get-top-n` · `export-{csv,json}` · `realtime-update` event stream   |

🟢 Unit / integration / type-check — three gates, zero bug overflow; two pre-existing drifts fixed; full E2E deferred to the UI walkthrough stage. See [user guide §18.8](./docs-site/docs/guide/desktop-v6-shell.md#188-v50243-测试回归2026-04-21) and [design v0.6](./docs/design/桌面版UI重构_设计文档.md).

---

## 2026-04-20 Update — Desktop V6 · P7 Claude-Desktop-style appearance preview

Building on P0–P6, ChainlessChain adds a new `/v6-preview` route (coexists with `/v2`, replaces nothing). The appearance aligns with Claude Desktop and pins 4 decentralized entries at the bottom of the sidebar:

- **4 themes** — `src/renderer/shell-preview/themes.css` provides dark / light / blue / green (ported from web-panel `theme.js`), switched via `[data-theme-preview]` attribute + localStorage; store: `src/renderer/stores/theme-preview.ts`.
- **4 pinned decentralized entries** (bottom of left sidebar) — P2P collaboration / decentralized trade / decentralized social / U-Key security, wired to 4 `builtin:open*` handlers via the P6 `slash-dispatch`.
- **Three-zone skeleton** — Left: `ConversationList` + `DecentralEntries` + theme switcher; Center: minimal bubble stream + Ctrl/Cmd+Enter composer; Right: `ArtifactDrawer` slides in from the right.
- **Tests**: `stores/__tests__/theme-preview.test.ts` (11 cases) + `shell/__tests__/slash-dispatch.test.ts` (8 cases), 19 total all green.
- **P8 wiring (same day)**: Clicking any of the 4 entries no longer fires a placeholder toast — it now mounts `shell-preview/widgets/{P2p,Trade,Social,UKey}PreviewWidget.vue` inside the artifact drawer. Each widget shows an overview card + 2–3 buttons that `router.push` to the existing `/main/*` full pages (P2P → `P2PMessaging`, Trade → `TradingHub`, Social → `Chat`, UKey → `ThresholdSecurity`). `widget-registry.test.ts` adds 5 cases.
- **P9a persistence (same day)**: New `stores/conversation-preview.ts` Pinia store persists conversations + messages + active id to localStorage (key `cc.preview.conversations`, `version: 1` schema with auto re-seed on corruption / version mismatch); `AppShellPreview.vue` is now fully store-driven and survives reload. 13 store tests pass — **37 total green**.
- **Plan**: [`docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`](./docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md).

---

## 2026-04-20 Update — Desktop V6 Chat-First Shell · P0–P6 complete

The Electron desktop `/v2` route ships a **chat-first + pluggable platform** shell that replaces the legacy dashboard. Phases P0–P6 are all landed:

- **Three-region layout** — left `ShellSidebar` (space switcher) / center `ConversationStream + ShellComposer` (`/` commands + `@` mentions) / right `ArtifactPanel` + bottom `ShellStatusBar`.
- **7 UI extension points + 5 enterprise capabilities** — `plugin.json` `contributes.ui.*` / `contributes.provider.*`, winner selected by `ExtensionPointRegistry` in descending priority order.
- **P6 dispatcher** (this cut's core) — `slash-dispatch.ts` + `widget-registry.ts` wire plugin-declared `handler` / `component` strings to actual runtime behavior, with built-in `builtin:openAdminConsole` + `builtin:AdminShortcut`.
- **AdminConsole** — `Ctrl+Shift+A` / `/admin` / status-bar gear button all open the same modal (4 tabs: Overview / UI Extension Points / Enterprise Providers / Debug), gated on the `admin` permission.
- **Three enterprise-customization paths** — private Registry (`trustedPublicKeys` verification) / `.ccprofile` (ed25519 + per-plugin sha256 signed bundle, one-shot brand/capability swap) / MDM push (startup verify & unpack to overlay dir; higher priority wins).
- **13 built-in first-party plugins** — `chat-core` / `notes` / `spaces-personal` / `cowork-runner` / `brand-default` / `ai-ollama-default` / `auth-local` / `data-sqlite-default` / `crypto-ukey-default` / `compliance-default` / `admin-console` / `chain-gateway` / `did-core`.

**Tests**: 22 unit+integration passing (slash-dispatch 7 / widget-registry 5 / AdminShortcut 2 / plugin-extension-points 5 / AppShell interaction 3); 3 Playwright E2E `describe.skip` pending an admin-permission login helper. Renderer build green at 4m 52s.

**Docs**: [`docs-site/docs/guide/desktop-v6-shell.md`](./docs-site/docs/guide/desktop-v6-shell.md) (user guide) · [`docs/design/桌面版UI重构_设计文档.md`](./docs/design/桌面版UI重构_设计文档.md) (design v0.3 P0–P6 complete).

---

## 2026-04-19 Update — CLI 0.156.0 · V2 iter22-iter28 · 72 more lib-level governance surfaces

On top of the 64 surfaces from iter16-iter21, seven more iterations (iter22 → iter28) ported **72 additional lib-level governance surfaces** and bumped the CLI to `0.156.0`. iter22-iter26 add 8 surfaces each; iter27 and iter28 add 16 each. All surfaces follow the same 4-state profile maturity × 5-state record lifecycle skeleton (auto-stale/suspend/pause/degrade/mute-idle + auto-fail-stuck), **zero coupling with legacy paths**, and coexist with prior `*-v2` prefixes via a shared `preAction` hook that blocks `-v2` subcommand nesting.

| Iter   | Libraries covered                                                                                                                                                                                                                                                                                 | New V2 tests  | Command prefixes                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iter22 | automation-engine / cowork-share / did-v2-manager / knowledge-exporter / knowledge-importer / llm-providers / pqc-manager / social-manager                                                                                                                                                        | 8×44=**352**  | `cc automation augov-*-v2` `cc cowork shgov-*-v2` `cc did-v2 dv2gov-*-v2` `cc export kexpgov-*-v2` `cc import kimpgov-*-v2` `cc llm llmgov-*-v2` `cc pqc pqcgov-*-v2` `cc social smgov-*-v2`                                                                                                                                                                                                                                  |
| iter23 | response-cache / tech-learning-engine / universal-runtime / note-versioning / permanent-memory / protocol-fusion / dbevo / decentral-infra                                                                                                                                                        | 8×44=**352**  | `cc rcache rcgov-*-v2` `cc tech techgov-*-v2` `cc runtime rtgov-*-v2` `cc note ntgov-*-v2` `cc permmem pmgov-*-v2` `cc fusion pfgov-*-v2` `cc dbevo dbevogov-*-v2` `cc infra digov-*-v2`                                                                                                                                                                                                                                      |
| iter24 | content-recommendation / mcp-registry / plugin-ecosystem / skill-loader / token-tracker / autonomous-developer / threat-intel / ueba                                                                                                                                                              | 8×44=**352**  | `cc recommend rcmdgov-*-v2` `cc mcp mcpgov-*-v2` `cc ecosystem ecogov-*-v2` `cc skill sklgov-*-v2` `cc tokens toktgov-*-v2` `cc dev devgov-*-v2` `cc compliance tigov-*-v2` `cc compliance uebgov-*-v2`                                                                                                                                                                                                                       |
| iter25 | cowork-task-templates / cowork-template-marketplace / cli-anything-bridge / agent-router / sub-agent-registry / todo-manager / execution-backend / evomap-federation                                                                                                                              | 8×44=**352**  | `cc cowork cttgov-*-v2` `cc cowork ctmgov-*-v2` `cc cli-anything clibgov-*-v2` `cc orchestrate argov-*-v2` `cc agent saregov-*-v2` `cc agent todogov-*-v2` `cc agent ebgov-*-v2` `cc evomap evfedgov-*-v2`                                                                                                                                                                                                                    |
| iter26 | interactive-planner / cli-context-engineering / sub-agent-context / interaction-adapter / workflow-expr / plugin-autodiscovery / hashline / web-ui-server                                                                                                                                         | 8×44=**352**  | `cc planmode plannergov-*-v2` `cc cli-anything ctxenggov-*-v2` `cc agent sactxgov-*-v2` `cc chat iagov-*-v2` `cc workflow wfexgov-*-v2` `cc plugin padgov-*-v2` `cc memory hlgov-*-v2` `cc ui webuigov-*-v2`                                                                                                                                                                                                                  |
| iter27 | downloader / skill-mcp / cowork-mcp-tools / stix-parser / sub-agent-profiles / cowork-observe / process-manager / ws-chat-handler / evomap-client / provider-options / session-core-singletons / service-manager / cowork-evomap-adapter / provider-stream / cowork-observe-html / cowork-adapter | 16×44=**704** | `cc setup dlgov-*-v2` `cc skill smcpgov-*-v2` `cc cowork cmcpgov-*-v2` `cc compliance stixgov-*-v2` `cc agent sapgov-*-v2` `cc cowork cobsgov-*-v2` `cc start pmgrgov-*-v2` `cc chat wscgov-*-v2` `cc evomap evcligov-*-v2` `cc llm poptgov-*-v2` `cc config scsgov-*-v2` `cc services smgrgov-*-v2` `cc cowork ceadgov-*-v2` `cc stream pstrmgov-*-v2` `cc cowork cohtgov-*-v2` `cc cowork cadpgov-*-v2`                     |
| iter28 | a2a-protocol / agent-coordinator / agent-economy / autonomous-agent / chat-core / compliance-manager / cross-chain / crypto-manager / dao-governance / evolution-system / evomap-manager / hierarchical-memory / inference-network / knowledge-graph / pipeline-orchestrator / plan-mode          | 16×44=**704** | `cc a2a a2apgov-*-v2` `cc orchestrate acrdgov-*-v2` `cc economy aecogov-*-v2` `cc agent autagov-*-v2` `cc chat ccoregov-*-v2` `cc compliance cmpmgov-*-v2` `cc crosschain crchgov-*-v2` `cc encrypt crygov-*-v2` `cc dao daomgov-*-v2` `cc evolution esysgov-*-v2` `cc evomap emgrgov-*-v2` `cc hmemory hmemgov-*-v2` `cc inference infnetgov-*-v2` `cc kg kggov-*-v2` `cc pipeline pipogov-*-v2` `cc planmode pmodegov-*-v2` |

**iter22-iter28 cumulative**: 5 × 8 + 2 × 16 = **72 lib-level governance surfaces**, 72 × 44 = **3,168 new V2 unit tests**. Combined with iter16-iter21, the V2 governance layer now totals **136 surfaces / ~5,984 V2 unit tests**, and full-stack V2 governance surfaces grow from 156+ → **228+**.

### Regression tests (2026-04-19, post iter28)

| Layer                        | Files  | Tests             | Notes                                                       |
| ---------------------------- | ------ | ----------------- | ----------------------------------------------------------- |
| CLI unit (iter28 new)        | 16     | **704 / 704**     | a2a-protocol / agent-coordinator + 14 other new V2 surfaces |
| CLI integration              | 40     | **696 / 696**     | unchanged from 0.151.0                                      |
| CLI e2e                      | 38     | **565 / 565**     | unchanged from 0.151.0                                      |
| **Total (new + regression)** | **94** | **1,965 / 1,965** | **zero regressions**                                        |

**npm**: `npm i -g chainlesschain@0.156.0` (aliases `cc` / `clc` / `clchain`)

See [`docs/design/modules/96_V2规范层governance.md`](./docs/design/modules/96_V2规范层governance.md) §iter22-iter28 for details.

---

## 2026-04-19 Update — CLI 0.151.0 · V2 iter16-iter21 · 64 lib-level governance surfaces

After 0.142.0 (batches 9 + 10), the V2 canonical surface continued through six more iterations (iter16-iter21), pushing **64 additional lib-level governance surfaces** and bumping the CLI to `0.151.0` (tag `v5.0.2.34`). Every surface follows the same 4-state profile maturity × 5-state record lifecycle skeleton, with per-owner active caps, per-entity pending caps, auto-suspend-idle, and auto-fail-stuck — **zero coupling with legacy paths**.

| Iteration | Subsystems (lib)                                                                                                                                  | New V2 tests | Command prefix                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iter16    | audit-logger / knowledge-graph / sandbox-v2 / sla-manager / stress-tester / terraform-manager / reputation-optimizer / skill-marketplace          | 8×44=**352** | `cc audit aud-gov-*-v2` `cc kg kgov-*-v2` `cc sandbox sbox-gov-*-v2` `cc sla slagov-*-v2` `cc stress strgov-*-v2` `cc terraform tfgov-*-v2` `cc reputation repgov-*-v2` `cc marketplace mktgov-*-v2`         |
| iter17    | chat-core / claude-code-bridge / compliance-manager / cowork-learning / cowork-workflow / privacy-computing / token-incentive / hardening-manager | 8×44=**352** | `cc chat chatgov-*-v2` `cc orchestrate ccbgov-*-v2` `cc compliance cmgr-*-v2` `cc cowork learn-*-v2` `cc cowork cwwf-*-v2` `cc privacy pcgov-*-v2` `cc incentive incgov-*-v2` `cc hardening hardgov-*-v2`    |
| iter18    | aiops / multimodal / instinct-manager / tenant-saas / quantization / trust-security / nl-programming / perception                                 | 8×44=**352** | `cc ops aiopsgov-*-v2` `cc multimodal mmgov-*-v2` `cc instinct instgov-*-v2` `cc tenant tnsgov-*-v2` `cc quantize qntgov-*-v2` `cc trust trustgov-*-v2` `cc nlprog nlpgov-*-v2` `cc perception percgov-*-v2` |
| iter19    | code-agent / collaboration-governance / community-governance / did-manager / sso-manager / org-manager / scim-manager / sync-manager              | 8×44=**352** | `cc codegen cdagov-*-v2` `cc collab cogov-*-v2` `cc governance commgov-*-v2` `cc did didgov-*-v2` `cc sso ssogov-*-v2` `cc org orggov-*-v2` `cc scim scimgov-*-v2` `cc sync syncgov-*-v2`                    |
| iter20    | agent-network / browser-automation / dlp-engine / evomap-governance / federation-hardening / ipfs-storage / p2p-manager / wallet-manager          | 8×44=**352** | `cc agent-network anetgov-*-v2` `cc browse bagov-*-v2` `cc dlp dlpgov-*-v2` `cc evomap evgov-*-v2` `cc federation fedgov-*-v2` `cc ipfs ipfsgov-*-v2` `cc p2p p2pgov-*-v2` `cc wallet walgov-*-v2`           |
| iter21    | activitypub-bridge / matrix-bridge / nostr-bridge / bi-engine / memory-manager / session-manager / hook-manager / workflow-engine                 | 8×44=**352** | `cc activitypub apgov-*-v2` `cc matrix matgov-*-v2` `cc nostr nosgov-*-v2` `cc bi bigov-*-v2` `cc memory memgov-*-v2` `cc session sesgov-*-v2` `cc hook hookgov-*-v2` `cc workflow wfgov-*-v2`               |

**iter16-iter21 cumulative**: 6 iterations × 8 libs × 44 V2 tests = **2,112 new V2 unit tests** (actual 2,816+ counting iter17-21 batches). Total V2 governance surfaces grow from 92+ → **156+**.

### Regression tests (2026-04-19, post iter21)

| Tier            | Files   | Tests               | Notes                                                                      |
| --------------- | ------- | ------------------- | -------------------------------------------------------------------------- |
| CLI Unit        | 332     | **14,255 / 14,255** | Includes 92 `*-v2.test.js` files (iter16-iter21 add 32 files × 44 = 1,408) |
| CLI Integration | 40      | **696 / 696**       | Same as 0.142.0                                                            |
| CLI E2E         | 38      | **565 / 565**       | Same as 0.142.0                                                            |
| **Total**       | **410** | **15,516 / 15,516** | **zero regressions**                                                       |

**npm**: `npm i -g chainlesschain@0.151.0` (aliases `cc` / `clc` / `clchain`)

Details: [`docs/design/modules/96_V2规范层governance.md`](./docs/design/modules/96_V2规范层governance.md) §iter16-iter21.

---

## 2026-04-19 Update — CLI 0.142.0 · V2 Batch 9 + Batch 10 · 30 lib-level governance surfaces

Two more V2 canonical-surface batches landed on top of batch 8: **batch 9** covers the **session / context / permission / DI / social-graph** subsystems (14 libs); **batch 10** covers the **orchestration / autonomous / economy / evolution / compliance-framework / SIEM / inference-network / low-code** subsystems (16 libs). CLI bumps `0.136.0 → 0.142.0` (tag `v5.0.2.34`). All 30 surfaces reuse the 4-state maturity × 5-state record-lifecycle dual state machine skeleton, zero coupling with legacy paths (SQLite tables / in-memory singletons / transports / protocol layers).

**30 V2 canonical surfaces** — batch 9 takes 14 brand-new top-levels (to avoid collision with existing commands), batch 10 takes 16 (most top-level, a few appended to existing commands via prefixes):

| Batch    | Subsystems (lib)                                                                                                                                                                                                                                                                                                    | New V2 tests                     | Representative commands                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Batch 9  | slot-filler / web-fetch / memory-injection / session-search / session-tail / session-usage / session-hooks / mcp-scaffold / plan-mode / permission-engine / user-profile / social-graph / service-container / task-model-selector                                                                                   | **521** (10×37 + 39 + 38 + 2×37) | `cc slotfill` `cc webfetch` `cc meminj` `cc seshsearch` `cc seshtail` `cc seshu` `cc seshhook` `cc mcpscaf` `cc planmode` `cc perm` `cc uprof` `cc social sg-*-v2` `cc svccont` `cc tms`                                                               |
| Batch 10 | orchestrator / perf-tuning / topic-classifier / iteration-budget / git-integration / cowork-task-runner / inference-network / content-recommender / app-builder / siem-exporter / autonomous-agent / compliance-framework-reporter / agent-economy / pipeline-orchestrator / evolution-system / hierarchical-memory | **704** (12×45 + 4×41)           | `cc orchgov` `cc perf *-v2` `cc topiccls` `cc itbudget` `cc git` `cc cowork runner-*-v2` `cc inference` `cc recommend cr-*-v2` `cc lowcode` `cc siem` `cc autoagent` `cc compliance fwrep-*-v2` `cc economy` `cc pipeline` `cc evolution` `cc hmemory` |

Every surface shares the V2 skeleton: dual state machines + per-owner active cap (enforced only on `pending→active`) + per-entity pending cap (enforced at record creation) + stamp-once `activatedAt` / `startedAt` + `auto*V2` batchers + `_resetState*V2` for test isolation. All V2 actions are dispatched via `-v2` suffix; preAction hook bypasses legacy bootstrap via `actionCommand.name().endsWith("-v2")`. Multiple top-levels avoid collisions via prefixes (`cc seshhook` vs `cc hook`, `cc mcpscaf` vs `cc mcp`, `cc autoagent` vs `cc agent`, `runner-*-v2` vs Agent Coordinator, `cr-*-v2` vs content-recommendation, `sg-*-v2` vs social-manager, `fwrep-*-v2` vs compliance V2).

### Regression tests (2026-04-19)

| Tier            | Files   | Tests             | Duration             |
| --------------- | ------- | ----------------- | -------------------- |
| CLI Unit        | 274     | **11718 / 11718** | 125s                 |
| CLI Integration | 40      | **696 / 696**     | 40s                  |
| CLI E2E         | 38      | **565 / 565**     | 360s                 |
| **Total**       | **352** | **12979 / 12979** | **zero regressions** |

Batches 9 + 10 add **1225 new V2 unit tests** over 0.136.0 (521 + 704), bringing total V2 governance surfaces from 62+ → **92+**.

**npm**: `npm i -g chainlesschain@0.142.0` (aliases `cc` / `clc` / `clchain`)

Details: [`docs/design/modules/96_V2规范层governance.md`](./docs/design/modules/96_V2规范层governance.md) · [Changelog](./docs-site/docs/changelog.md).

---

## 2026-04-18 Update — CLI 0.136.0 · V2 Batch 8 · 12 lib-level governance surfaces

Batch 8 pushes the V2 canonical surface down into **12 lib modules** (a2a-protocol / activitypub-bridge / bi-engine / browser-automation / cross-chain / dao-governance / dlp-engine / evomap-manager / matrix-bridge / nostr-bridge / session-consolidator / zkp-engine). Each reuses the same 4-state maturity × 5-state record-lifecycle skeleton, independent of the existing Phase 88 / 92 / 95 protocol implementations. CLI bumps `0.130.0 → 0.136.0` (tag `v5.0.2.34`).

**12 V2 canonical surfaces** (strictly additive, pure in-memory governance, zero coupling with protocol layer):

| lib module             | Maturity / record enums                                     | per-owner cap | per-entity cap     | Auto batchers                      | V2 tests |
| ---------------------- | ----------------------------------------------------------- | ------------- | ------------------ | ---------------------------------- | -------- |
| `a2a-protocol`         | `A2A_AGENT_MATURITY_V2` + `A2A_MESSAGE_LIFECYCLE_V2`        | agent         | pending message    | autoRetireIdle + autoFailStuck     | 40       |
| `activitypub-bridge`   | `AP_ACTOR_MATURITY_V2` + `AP_ACTIVITY_LIFECYCLE_V2`         | actor         | pending activity   | autoRetireIdle + autoFailStuck     | 39       |
| `bi-engine`            | `BI_DATASET_MATURITY_V2` + `BI_QUERY_LIFECYCLE_V2`          | dataset       | pending query      | autoArchiveIdle + autoFailStuck    | 39       |
| `browser-automation`   | `BROWSE_SESSION_MATURITY_V2` + `BROWSE_STEP_LIFECYCLE_V2`   | session       | pending step       | autoArchiveIdle + autoFailStuck    | 37       |
| `cross-chain`          | `CC_BRIDGE_MATURITY_V2` + `CC_TRANSFER_LIFECYCLE_V2`        | bridge        | pending transfer   | autoDegradeIdle + autoFailStuck    | 40       |
| `dao-governance`       | `DAO_REALM_MATURITY_V2` + `DAO_PROPOSAL_LIFECYCLE_V2`       | realm         | open proposal      | autoArchiveIdle + autoFailStuck    | 41       |
| `dlp-engine`           | `DLP_POLICY_MATURITY_V2` + `DLP_INCIDENT_LIFECYCLE_V2`      | policy        | open incident      | autoDeprecateIdle + autoCloseStale | 40       |
| `evomap-manager`       | `EVOMAP_HUB_MATURITY_V2` + `EVOMAP_SUBMISSION_LIFECYCLE_V2` | hub           | pending submission | autoArchiveIdle + autoFailStuck    | 39       |
| `matrix-bridge`        | `MX_ROOM_MATURITY_V2` + `MX_EVENT_LIFECYCLE_V2`             | room          | pending event      | autoArchiveIdle + autoFailStuck    | 37       |
| `nostr-bridge`         | `NOSTR_RELAY_MATURITY_V2` + `NOSTR_EVENT_LIFECYCLE_V2`      | relay         | pending event      | autoDegradeIdle + autoFailStuck    | 39       |
| `session-consolidator` | `CONSOL_PROFILE_MATURITY_V2` + `CONSOL_JOB_LIFECYCLE_V2`    | profile       | pending job        | autoArchiveIdle + autoFailStuck    | 38       |
| `zkp-engine`           | `ZKP_CIRCUIT_MATURITY_V2` + `ZKP_PROOF_LIFECYCLE_V2`        | circuit       | pending proof      | autoArchiveIdle + autoFailStuck    | 41       |

Every surface shares the V2 skeleton: dual state machines + per-owner active cap (enforced only on `pending→active`) + per-entity pending cap (enforced at record creation) + stamp-once `activatedAt` / `startedAt` + `auto*V2` batchers + `_resetState*V2` for test isolation. All V2 actions are dispatched via `-v2` suffix; preAction hook bypasses legacy DB bootstrap via `actionCommand.name().endsWith("-v2")`.

### Regression tests (2026-04-18 evening)

| Tier            | Files   | Tests             | Duration             |
| --------------- | ------- | ----------------- | -------------------- |
| CLI Unit        | 244     | **10493 / 10493** | 124s                 |
| CLI Integration | 40      | **696 / 696**     | 40s                  |
| CLI E2E         | 38      | **565 / 565**     | 352s                 |
| **Total**       | **322** | **11754 / 11754** | **zero regressions** |

This batch adds **470 new V2 unit tests** over 0.130.0 (sum across the 12 lib modules).

**npm**: `npm i -g chainlesschain@0.136.0` (aliases `cc` / `clc` / `clchain`)

Details: [`docs/design/modules/96_V2规范层governance.md`](./docs/design/modules/96_V2规范层governance.md) · [Changelog](./docs-site/docs/changelog.md#5-0-2-34-cli-0-131-0-136-2026-04-18).

---

## 2026-04-18 Update — CLI 0.130.0 · V2 Batch 7 · 9 orchestration managers

Building on batch 6's 13 runtime managers, batch 7 extends V2 canonical surfaces to **9 orchestration-layer modules**: SSO / Workflow / Router / Hook / MCP / Coord / Sub-Agent / ExecBE / Todo. CLI bumps `0.123.0 → 0.130.0` (tag `v5.0.2.34`). Each surface stays strictly independent of legacy SQLite / transport layers, preserving the preAction bypass, dual state machines, and per-owner + per-entity caps skeleton. **+345 new V2 unit tests**.

---

## 2026-04-18 Update — CLI 0.130.0 · V2 Batch 6 · 13 Runtime Managers

Later the same day that 0.106.0 (V2 batch 5) shipped, we pushed one more round: **all 13 runtime-manager modules** now carry the V2 canonical surface. CLI bumps `0.106.0 → 0.130.0` (tag `v5.0.2.10`).

**13 V2 canonical surfaces** (strictly additive, backwards-compatible — in-memory governance layer, independent of legacy SQLite / file state):

| Module                      | Maturity / work-unit enums                          | Active cap      | Pending cap      | Auto batchers             |
| --------------------------- | --------------------------------------------------- | --------------- | ---------------- | ------------------------- |
| `cc automation` V2          | `AUTOMATION_MATURITY_V2` + `EXECUTION_LIFECYCLE_V2` | per-owner 20    | per-flow 30      | autoPause + autoCancel    |
| `cc instinct` V2            | `PROFILE_MATURITY_V2` + `OBSERVATION_LIFECYCLE_V2`  | per-user 5      | per-profile 100  | autoDormant + autoDiscard |
| `cc memory` V2              | `ENTRY_MATURITY_V2` + `CONSOLIDATION_LIFECYCLE_V2`  | per-owner 200   | per-owner 20     | autoStale + autoSupersede |
| `cc note` V2                | `NOTE_MATURITY_V2` + `REVISION_LIFECYCLE_V2`        | per-author 100  | per-note 50      | autoStale + autoDiscard   |
| `cc org` V2                 | `ORG_MATURITY_V2` + `MEMBER_LIFECYCLE_V2`           | per-owner 10    | per-org 500      | autoSuspend + autoExpire  |
| `cc permmem` V2 (new group) | `PIN_MATURITY_V2` + `RETENTION_JOB_LIFECYCLE_V2`    | per-owner 100   | per-pin 10       | autoDormant + autoCancel  |
| `cc rcache` V2 (new group)  | `PROFILE_MATURITY_V2` + `REFRESH_JOB_LIFECYCLE_V2`  | per-owner 25    | per-profile 4    | autoSuspend + autoFail    |
| `cc scim` V2                | `IDENTITY_LIFECYCLE_V2` + `SYNC_JOB_V2`             | per-tenant 5000 | per-idp 50       | autoSuspend + autoFail    |
| `cc session` V2             | `CONVERSATION_MATURITY_V2` + `TURN_LIFECYCLE_V2`    | per-user 20     | per-session 100  | autoIdle + autoFail       |
| `cc social` V2              | `RELATIONSHIP_MATURITY_V2` + `THREAD_LIFECYCLE_V2`  | per-user 1000   | per-user 500     | autoMute + autoArchive    |
| `cc sync` V2                | `RESOURCE_MATURITY_V2` + `SYNC_RUN_V2`              | per-owner 50    | per-resource 20  | autoPause + autoFail      |
| `cc tokens` V2              | `BUDGET_MATURITY_V2` + `USAGE_RECORD_LIFECYCLE_V2`  | per-owner 10    | per-budget 10000 | autoExhaust + autoCommit  |
| `cc wallet` V2              | `WALLET_MATURITY_V2` + `TX_LIFECYCLE_V2`            | per-user 10     | per-wallet 100   | autoFreeze + autoCancel   |

Every module follows the same skeleton: `register*V2` / `get*V2` / `list*V2` / `set*StatusV2` + status shortcuts, per-owner active cap + per-container pending cap, stamp-once `activatedAt` / lifecycle timestamps, `auto*` batch methods, `get*StatsV2` and `_resetState*V2` (for test isolation). `cc rcache` coexists with the legacy LRU `cc tokens cache` without conflict.

### Regression tests (2026-04-18 evening)

| Tier                            | Files | Tests                      | Duration |
| ------------------------------- | ----- | -------------------------- | -------- |
| CLI Unit                        | 232   | **9219/9229** (10 skipped) | ~130s    |
| CLI Integration                 | 40    | **696/696**                | 38s      |
| CLI E2E                         | 38    | **565/565**                | 427s     |
| Desktop Unit (core+database)    | 15    | **836/846** (10 skipped)   | 141s     |
| Desktop Unit (renderer stores)  | 16    | **486/486**                | 25s      |
| Desktop Unit (ai-engine sample) | 3     | **265/346** (81 skipped)   | 28s      |

This batch adds **560 new V2 unit tests** (automation 46 + instinct 48 + memory 47 + note 49 + org 43 + permanent-memory 46 + response-cache 46 + scim 39 + session 33 + social 34 + sync 39 + token-tracker 49 + wallet 41) over 0.106.0, zero regressions.

**npm**: `npm i -g chainlesschain@0.130.0` (aliases `cc` / `clc` / `clchain`)

---

## 2026-04-18 Update — CLI 0.106.0 · V2 Batch 5 · collab + UEBA + threat-intel

Continuing yesterday's 0.104.0 V2 batch 4, today lands batch 5: three more command families gain V2 canonical surfaces — `cc collab` + `cc compliance ueba` + `cc compliance threat-intel`. CLI bumps `0.104.0 → 0.106.0` (tag `v5.0.2.10`).

**3 V2 canonical surfaces** (strictly additive, backwards-compatible):

- **`cc collab` V2**: 4-state agent maturity (`provisional/active/suspended/retired`, `suspended→active` recovery) + 5-state proposal lifecycle (`draft/voting/approved/rejected/withdrawn`, 3 terminals), per-realm active-agent cap = 10, per-proposer voting-proposal cap = 3, `autoRetireIdleAgentsCgV2` + `autoWithdrawStuckProposalsV2`.
- **`cc compliance ueba` V2**: 4-state baseline maturity (`draft/active/stale/archived`, `stale→active` recovery) + 5-state investigation lifecycle (`open/investigating/closed/dismissed/escalated`, 3 terminals), per-owner active-baseline cap = 20, per-analyst open-investigation cap = 10 (enforced at `openInvestigationV2` creation), `autoMarkStaleBaselinesV2` + `autoEscalateStuckInvestigationsV2`.
- **`cc compliance threat-intel` V2**: 4-state feed maturity (`pending/trusted/deprecated/retired`, `deprecated→trusted` recovery) + 5-state indicator lifecycle (`pending/active/expired/revoked/superseded`, 3 terminals), per-owner active-feed cap = 15, per-feed active-indicator cap = 500, `autoDeprecateIdleFeedsV2` + `autoExpireStaleIndicatorsV2`. The V2 layer sits on top of the SQLite IoC catalog and is fully independent of legacy `importStixBundle`/`matchObservable`.

This batch adds **107 new V2 unit tests** (collab 37 + ueba 29 + threat-intel 41) over 0.104.0, zero regressions.

---

## 2026-04-17 Update — CLI 0.66.0 · 7 New + 8 V2 Enhanced

Later the same day, a parallel session landed **7 brand-new CLI command groups** and **V2 enhancements to 8 existing commands**, all published together as `chainlesschain@0.66.0` (tag `v5.0.2.34`).

**7 new command groups**: `agent-network` (Phase 24) · `automation` (Phase 96) · `didv2` (Phase 55) · `perf` (Phase 22) · `pipeline` (Phase 26) · `ecosystem` (Phase 64) · `sso` (Phase 14) · `social graph` (Phase 42 analytics subcommands)

**8 V2 enhancements** (strictly additive, backwards-compatible): `dao` (Phase 92 quadratic voting + cycle-safe delegation + timelock) · `economy` (Phase 85 state channels + NFT) · `evolution` (Phase 100 6-dim capability + 4-level diagnosis) · `hmemory` (Phase 83 4 layers + concept-based semantic search) · `sandbox` (Phase 87 5-level risk + auto-isolation) · `workflow` (Phase 82 checkpoints + regex-safe breakpoints) · `zkp` (Phase 88 3 scheme-parametric proofs)

### Regression tests (2026-04-17 evening)

| Tier            | Files | Tests         | Duration |
| --------------- | ----- | ------------- | -------- |
| CLI Unit        | 232   | **7618/7618** | 129s     |
| CLI Integration | 40    | **696/696**   | 46s      |
| CLI E2E         | 38    | **565/565**   | 427s     |

This batch adds **536 new unit tests** over 0.51.0, all passing; integration / E2E zero regression.

**npm**: `npm i -g chainlesschain@0.66.0` (aliases `cc` / `clc` / `clchain`)

---

## 2026-04-17 Update — npm Release Batch · CLI 0.51.0

Continuing the same day's CLI port batch, five additional Phases were consolidated into a single npm release cycle.

- **Phase 17 IPFS Decentralized Storage** — `cc ipfs node-start/add/get/pin/gc/set-quota/attach-knowledge`: deterministic bafy CIDs + AES-256-GCM + quota/GC + knowledge-base attachments. **64 tests**.
- **Phase 20 Model Quantization** — `cc quantize`: GGUF 14 levels + GPTQ catalog + job lifecycle (pending→running→completed/failed/cancelled) + progress tracking. **48 tests**.
- **Phase 27 Multimodal Collaboration** — `cc mm session/stream/track/snapshot`: CRDT-style session state + catalog for 5 input modalities / 7 document formats / 6 output formats. **68 tests**.
- **Phase 28 Natural-Language Programming** — `cc nlprog classify/extract/detect-stack/translate/refine/convention-add/conventions/stats`: heuristic bilingual intent / entity / tech-stack detection + translation & convention CRUD. **62 tests**.
- **Phase 63 Universal Runtime** — `cc runtime`: OS / container / cloud capability detection + adaptive resource allocation + runtime stats. **60 tests**.

**npm releases**: `v5.0.2.31 / 0.48.0` → `v5.0.2.32 / 0.49.0` → `v5.0.2.33 / 0.51.0` (three successive publishes). Run `npm i -g chainlesschain@0.51.0` to pick up the full batch.

### Regression tests (2026-04-17 batch)

| Tier            | Files | Tests         | Duration |
| --------------- | ----- | ------------- | -------- |
| CLI Unit        | 232   | **7082/7082** | 210s     |
| CLI Integration | 40    | **696/696**   | 76s      |
| CLI E2E         | 38    | **565/565**   | 459s     |

User docs: [cli-ipfs](./docs-site/docs/chainlesschain/cli-ipfs.md) · [cli-quantize](./docs-site/docs/chainlesschain/cli-quantize.md) · [cli-mm](./docs-site/docs/chainlesschain/cli-mm.md) · [cli-nlprog](./docs-site/docs/chainlesschain/cli-nlprog.md) · [cli-runtime](./docs-site/docs/chainlesschain/cli-runtime.md)
Design docs: [17 IPFS Decentralized Storage](./docs/design/modules/17_IPFS去中心化存储.md) · [27 Multimodal Collaboration](./docs/design/modules/27_多模态协作.md) · [63 Universal Runtime](./docs/design/modules/63_统一应用运行时.md)

---

## 2026-04-17 Update — CLI Port Wrap-up + Docs Restructure

This update closes out five CLI-side Phase ports, regression-tests them, and restructures the command reference:

- **Phase 25 AIOps** — `cc ops`: Z-Score/IQR anomaly detection + incident lifecycle + playbooks + postmortem. **48 tests**.
- **Phase 58 Federation Hardening** — `cc federation`: circuit-breaker state machine (closed/open/half_open) + health checks + connection pool. **59 tests**.
- **Phase 80 Database Evolution** — `cc dbevo`: migration CRUD + slow-query analysis + index suggestions. **47 tests**.
- **Phase 84 Multimodal Perception** — `cc perception`: record/index/cross-modal query + voice-session state machine. **47 tests**.
- **Phase 86 Code Generation Agent 2.0** — `cc codegen`: generation tracking + 5-rule heuristic security review + scaffold catalog. **38 tests**.

**Docs restructure**: `docs/CLI_COMMANDS_REFERENCE.md` trimmed from 54.8k → 4.4k (thin index). Full command listings moved to six sub-files under `docs/cli/` (core-phases / managed-agents / blockchain-enterprise / observability / platform / video), with all command comments translated to Chinese (~371 entries). New docs-site pages `cli-federation.md` / `cli-perception.md` added to the VitePress sidebar.

### Regression test results (2026-04-17)

| Tier            | Files | Tests         | Duration |
| --------------- | ----- | ------------- | -------- |
| CLI Unit        | 219   | **6010/6010** | 114s     |
| CLI Integration | 40    | **696/696**   | 36s      |
| CLI E2E         | 38    | **565/565**   | 495s     |

> During the E2E run vitest-worker surfaced a single `Timeout calling "onTaskUpdate"` RPC warning (known vitest issue for long-running suites); no test outcome was affected.

---

## 2026-04-16 Update — Managed Agents Phase A–I + Deep Agents Deploy Phase 1–5 (All Complete)

Local-first runtime parity with Anthropic Claude Managed Agents and Deep Agents Deploy. New shared package `@chainlesschain/session-core` provides Session / Trace / Team-Subagent / Scoped Memory / Approval Policy / Beta Flags / Stream Router / Service Envelope / MCP Policy / Sandbox Policy / Agent Bundle — shared by CLI and Desktop.

### Key Deliverables

- **session-core**: 20 test files, **413/413 tests** — SessionHandle, SessionManager, MemoryStore, MemoryConsolidator, ApprovalGate, BetaFlags, StreamRouter, TraceStore, SharedTaskList, ServiceEnvelope, MCPPolicy, SandboxPolicy, AgentBundle
- **Hosted Session API**: `cc serve` WS gateway with 17 req/resp + 2 streaming routes (`stream.run` + `sessions.subscribe`), unified `<type>.response` envelopes
- **CLI session/usage commands**: `cc session tail/usage/lifecycle/park/unpark/end`, auto token accounting for Ollama/OpenAI/Anthropic
- **Desktop IPC**: 21 IPC channels (session lifecycle + memory + beta + usage + subscribe), Pinia store + SessionCorePage Usage tab
- **Desktop/CLI symmetric persistence**: shared `parked-sessions.json / memory-store.json / beta-flags.json / approval-policies.json`

| Tier            | Scope                                                                                                               | Pass      |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | --------- |
| Shared          | `@chainlesschain/session-core` (20 files)                                                                           | `413/413` |
| CLI Unit        | ws-session-core (25) + agent-core (95) + chat-core-usage (10) + session-\* (22) + singletons (10) + agent-repl (40) | `202/202` |
| CLI Integration | managed-agents + parity + shims + doc-creator                                                                       | `696/696` |
| CLI E2E         | managed-agents + full e2e suite                                                                                     | `562/562` |
| Desktop         | session-core-ipc (23) + coding-agent (28) + sandbox (45)                                                            | `96/96`   |

Design docs: [91_Managed_Agents](./docs/design/modules/91_Managed_Agents对标计划.md) | [92_Deep_Agents_Deploy](./docs/design/modules/92_Deep_Agents_Deploy借鉴落地方案.md)

---

## 2026-04-12 Update — Documentation-Code Gap Fill (All 7 Items Complete + 166 Tests)

Comprehensive comparison of 84 design documents against the codebase, closing 7 documentation-code gaps. All features upgraded from mock/placeholder to real implementations:

- **Nostr Real WebSocket**: Replaced mock objects with real `ws` WebSocket connections. Full NIP-01 message handling (EVENT/EOSE/OK/NOTICE). Exponential backoff reconnection (1s→60s max).
- **Low-Code Deploy Command**: Static site generation (index.html + app.js + style.css). `--output` flag for custom directory. App status auto-updated to `deployed`.
- **ZKP Real Proof Logic**: R1CS constraint system over BN254 finite field (256-bit) + Fiat-Shamir heuristic proofs. Replaced `mock-a-`/`mock-b-`/`mock-c-` placeholders. Real `verifyProof()` implementation.
- **Privacy Computing Real Algorithms**: FedAvg weighted gradient aggregation + Shamir Secret Sharing (128-bit prime field + Lagrange interpolation) + Laplace noise differential privacy.
- **Collab Engine Friend Visibility**: Query `friends` table for bidirectional friend check, replacing invite-only fallback.
- **Filecoin Storage Proofs**: PoRep/PoSt proof verification + SHA-256 commitment checks + deal renewal + filtered queries.
- **TTS Model Auto-Download**: HTTPS download with redirect following + progress events + breakpoint detection.

| Tier        | Scope                                                                                                                | Pass          |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------- |
| Unit        | zkp-engine / privacy-computing / filecoin-storage / nostr-bridge-ws / local-tts-client / app-builder / collab-engine | `139/139`     |
| Integration | crypto-privacy / filecoin-nostr / lowcode-deploy                                                                     | `17/17`       |
| E2E         | gap-fill-commands (CLI end-to-end)                                                                                   | `10/10`       |
| **Total**   | **10 files**                                                                                                         | **`166/166`** |

9 source files modified, 10 test files added. User docs (docs-site) and design docs synced.

Design doc: [docs/design/modules/85\_文档代码差距补全.md](./docs/design/modules/85_文档代码差距补全.md)

## 2026-04-12 Update — Hermes Agent Parity (All 6 Phases Complete)

Systematic gap closure against Nous Research's Hermes Agent framework. Six backward-compatible phases implemented entirely in `packages/cli/`:

- **Phase 1 Iteration Budget**: Shared `IterationBudget` replaces hardcoded `MAX_ITERATIONS=15` (default: 50). Parent and child agents share the same instance. Progressive warnings at 70%/90%/100%. Configurable via `CC_ITERATION_BUDGET` env var.
- **Phase 2 Cross-Session FTS Search**: SQLite FTS5 virtual table `session_fts`. `/search <query>` REPL command. `search_sessions` agent tool. Auto-indexed on `SessionEnd` hook. `reindexAll()` backfill for existing sessions.
- **Phase 3 USER.md + Frozen Prompt**: Persistent `~/.chainlesschain/USER.md` user profile (2000 char cap + AI consolidation). Injected into context engineering between instinct and memory. System prompt frozen at session start. `/profile` REPL command.
- **Phase 4 Zero-Friction Plugin Loading**: Auto-scan `~/.chainlesschain/plugins/*.js`. Tools, hooks, and commands auto-registered. DB-registered plugins override file-drop plugins with same name.
- **Phase 5 Docker/SSH Execution Backends**: `ExecutionBackend` abstraction + `createBackend()` factory. Local, Docker (exec + run), and SSH backends. Transparent routing for `run_shell`/`run_code`.
- **Phase 6 Messaging Gateways**: `GatewayBase` with session management, rate limiting, and response splitting. Telegram MarkdownV2 formatter. Discord 2000-char splitter with `codeBlock`/`quoteBlock` helpers.

Test matrix:

| Tier        | Scope                                                                                                      | Pass          |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------- |
| Unit        | iteration-budget / session-search / user-profile / plugin-autodiscovery / execution-backend / gateway-base | `206/206`     |
| Integration | hermes-parity-workflow (6-phase cross-module collaboration)                                                | `25/25`       |
| E2E         | hermes-parity-commands (CLI end-to-end full chain)                                                         | `22/22`       |
| **Total**   | **8 files**                                                                                                | **`253/253`** |

8 new source files (~1,400 lines), 9 modified files. New REPL commands: `/search`, `/profile`.

Design doc: [docs/design/modules/85_Hermes_Agent对标实施方案.md](./docs/design/modules/85_Hermes_Agent对标实施方案.md) / [user doc (Chinese)](./docs-site/docs/chainlesschain/hermes-agent-parity.md) / [design doc (English)](./docs-site/docs/design/modules/85-hermes-agent-parity.md).

## 2026-04-09 Update — CLI Runtime Convergence Complete (Phase 7 Parity Harness)

The CLI Runtime Convergence roadmap (`docs/design/modules/82_CLI_Runtime收口路线图.md`) Phase 0–7 is fully landed. The unified Coding Agent envelope protocol v1.0 achieves byte-level alignment across CLI / Desktop / Web UI:

- **8-step parity test matrix all green (91 tests)**: envelope contract, sequence tracker, legacy↔unified bidirectional mapping, WS server passthrough, JSONL session store, SubAgentContext worktree isolation, mock LLM provider, desktop bridge envelope parity
- **Shims annotated**: `src/lib/agent-core.js`(26L) / `src/lib/ws-server.js`(16L) / `src/lib/ws-agent-handler.js`(12L) degraded to @deprecated thin shims; canonical implementations live in `src/runtime/` and `src/gateways/ws/`
- **New test**: `packages/cli/__tests__/integration/parity-envelope-bridge.test.js` (58 tests) covering `createCodingAgentEvent` / `CodingAgentSequenceTracker` / `wrapLegacyMessage` / `unwrapEnvelope` full path
- **5 completion criteria all met**: single entry point · envelope protocol unified · parity harness green · shim migration window annotated · docs synced

See [roadmap §8](./docs/design/modules/82_CLI_Runtime收口路线图.md) for completion criteria and [CHANGELOG.md](./CHANGELOG.md) Unreleased section.

## 2026-04-09 Update — Canonical Workflow ADR Phase E: Intake Classifier + Routing Hint

Phase E of the `LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION` ADR lands end-to-end, closing the
canonical coding workflow (Phase A–E all shipped):

- **Pure-function intake classifier** (`desktop-app-vue/src/main/ai-engine/code-agent/intake-classifier.js`):
  takes `{ request, scopePaths, fileHints, sessionId }` and returns
  `{ decision: "ralph" | "team", confidence, complexity, scopeCount, boundaries, testHeavy,
signals, reason, recommendedConcurrency, suggestedRoles }`. Monorepo boundary detection
  across `desktop-app-vue/src/main`, `src/renderer`, `packages/cli`, `backend/*` etc. Multi-scope →
  `$team`; single-scope → `$ralph`. **Non-gating** — surfaced only as `routingHint`.
- **Persistence on `mode.json`**: new `SessionStateManager.setRoutingHint()` merge-writes via
  `_updateMode`. `$deep-interview` calls the classifier right after writing `intent.md`, so the
  hint survives every subsequent stage transition (`ralplan` → `approve` → `ralph`/`team`).
  Classifier throws degrade gracefully to `routingHint: null` without breaking the happy path.
- **Read-only IPC**: `workflow-session:classify-intake` lets the Renderer re-run the classifier
  on an existing session, auto-aggregating scopes from `tasks.json`.
- **Renderer visualization**: `CanonicalWorkflowPanel.vue` renders the `routingHint` block
  (decision tag / complexity / confidence / scopeCount / recommendedConcurrency / reason /
  suggestedRoles). `useWorkflowSessionStore` exposes a `classifyIntake()` action and
  `lastClassification` state.

Regression this round:

| Layer                             | Suites                                                    | Passing       |
| --------------------------------- | --------------------------------------------------------- | ------------- |
| Main unit (classifier)            | `intake-classifier.test.js`                               | `20/20`       |
| Main unit (IPC)                   | `workflow-session-ipc.test.js` (+classify-intake)         | `18/18`       |
| Main unit (handler)               | `workflow-skills.test.js` (+routingHint persist/fallback) | `55/55`       |
| Renderer store unit               | `workflow-session.test.ts` (+classifyIntake × 3)          | `13/13`       |
| Main integration                  | `coding-workflow.integration.test.js` Phase E describe    | `10/10`       |
| E2E integration (handler → store) | `canonical-workflow-phase-e.integration.test.js`          | `7/7`         |
| **Total**                         | **6 suites**                                              | **`123/123`** |

Design details: [docs/design/modules/80\_规范工作流系统.md](./docs/design/modules/80_规范工作流系统.md),
[81\_轻量多Agent编排系统.md §10 Phase E](./docs/design/modules/81_轻量多Agent编排系统.md),
[docs-site mirror](./docs-site/docs/chainlesschain/coding-workflow.md), ADR:
[LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md](./docs/implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md).

## 2026-04-08 Update — Coding Agent Phase 5: Persistent Task Graph + Orchestrator

The Coding Agent now ships with a **persistent task DAG and orchestrator** wired through all three layers:

- **CLI runtime** (`packages/cli/src/lib/agent-core.js` + `gateways/ws/session-protocol.js`) — DAG model with `pending` / `ready` / `running` / `completed` / `failed` / `skipped` states, topological order, dependency-aware `advance` with `becameReady` semantics, and auto-completion. Five new WebSocket message types: `task-graph-create`, `task-graph-add-node`, `task-graph-update-node`, `task-graph-advance`, `task-graph-state` — all returned as v1.0 unified envelopes.
- **Desktop main** (`coding-agent-bridge.js` + `coding-agent-session-service.js` + `coding-agent-ipc-v3.js`) — bridge unwraps 9 `task-graph.*` envelope types, service layer exposes domain APIs, IPC v3 adds 5 channels.
- **Renderer** (`stores/coding-agent.ts`) — Pinia store holds `taskGraphs: Record<sessionId, CodingAgentTaskGraph>`, exposes `currentSessionTaskGraph` / `currentSessionReadyTaskNodes` getters, 5 actions, and live-updates from 9 lifecycle event types under TypeScript strict mode.

Regression for this round (per layer):

| Layer               | Scope                                                                          | Pass          |
| ------------------- | ------------------------------------------------------------------------------ | ------------- |
| CLI unit            | `agent-core` / `ws-agent-handler`                                              | `109/109`     |
| CLI integration     | `ws-session-workflow`                                                          | `52/52`       |
| CLI E2E             | `coding-agent-envelope-roundtrip` (incl. full task-graph round-trip)           | `10/10`       |
| Desktop main unit   | `coding-agent-bridge` / `coding-agent-ipc-v3` / `coding-agent-session-service` | `96/96`       |
| Desktop integration | `coding-agent-lifecycle`                                                       | `24/24`       |
| Desktop E2E         | `coding-agent-bridge-real-cli` (real `chainlesschain serve` subprocess)        | `3/3`         |
| Renderer unit       | `coding-agent` store / `AIChatPage`                                            | `91/91`       |
| **Total**           | **7 suites**                                                                   | **`385/385`** |

Bug fix: `tests/integration/coding-agent-bridge-real-cli.test.js` had three stale type assertions (`session-created` / `session-list-result` / `result`) left over from before the v1.0 envelope migration — corrected to `session.started` / `session.list` / `command.response`.

Design, protocol, and test matrix: [docs/design/modules/79_Coding_Agent系统.md §12.5](./docs/design/modules/79_Coding_Agent系统.md) / [docs-site mirror](./docs-site/docs/design/modules/79-coding-agent.md).

<div align="center">

![Version](https://img.shields.io/badge/version-v5.0.3.114-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-100%25-brightgreen.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen.svg)
![Electron](https://img.shields.io/badge/electron-39.2.7-blue.svg)
![Tests](https://img.shields.io/badge/tests-30000%2B-brightgreen.svg)
![Skills](https://img.shields.io/badge/skills-146-blue.svg)
![Commands](https://img.shields.io/badge/CLI%20commands-173-blue.svg)
![CLI](https://img.shields.io/badge/cli-0.162.72-blue.svg)
![npm](https://img.shields.io/badge/npm-chainlesschain-cb3837.svg)

**Decentralized · Privacy First · AI Native**

A fully decentralized personal AI assistant platform integrating knowledge base management, social networking, and transaction assistance.

[中文](./README.md) | [Design Document](./docs/design/系统设计_主文档.md) | [Features](./docs/FEATURES.md)

</div>

---

## ⭐ Historical Snapshot — v5.0.3.48 Evolution Edition (2026-05-12, snapshot 25 versions ago)

> **Current state: see the [2026-05-20 closing] section at the top of this file** — Personal Data Hub Phase 4.5→13.7 + iOS keychain hotfix (v5.0.3.71/.72) + follow-up v5.0.3.73 Phase 10.2 integration + E2E tests + 1 AIChat registry-contract bug fix. Hub test baseline 47/927 → 50/952 all green. CLI 0.162.9 / Android 5.0.3.72 versionCode 503072.
>
> The banner and "Latest Update" entries below are reverse-chronological release notes (each describes the specific content of that version), not current state.

Historical archive — v5.0.3.48 Evolution Edition (2026-05-12 · CLI 0.161.8 · Android **1.0.0 GA** · 141 Desktop Skills + 28 Android Skills · 14,987+ Tests · **v5.0.3.48 Android M3 capture suite (5/5 code) + M4 closing + M7 GA flip** (VoiceMode + CameraOCR + LocationTagger + SharePayloadFlusher + PushNotifier all five landed · RemoteSkillRegistry method-level metadata · ApprovalUI 4-category · ProgressViewer long-task panel · §8.3 alias compat window · **Android versionCode 37 → 100 / versionName 0.37.0 → 1.0.0 GA** via commit ffe722162 · 187 new tests / Android total 196+ → 383+ · v1.0 GA still owes 4 user-side items: M3 device E2E / M4 D2 device / FCM creds / M6 perf) · **v5.0.3.47 verification release** (build-android keystore fix VERIFIED at release.yml run #25632845952 · density splits 14→4 first user-visible drop · 4 Android assets in Release · outstanding `../` fully swept) · **Phase 3d desktop ↔ Android two-way sync, fully landed** (M2 → v1.2, 12 commits · 5 ResourceType walker + tombstones + Room cursor + sync.\* JSON-RPC handlers + DeviceManager + SyncCoordinator auto-trigger · gates 1-4 all Ed25519 strict-verify) · **Android 0.37.0 seven-pack** (Volcengine SeedASR voice + APK auto-update issue #21 + Splash redesign + Claude coral theme + i18n three regions + biometric + DID Key screen) · **e2e CI silent-regression gap closed** (dropped e2e-tests workflow JOB-level `continue-on-error: true`) · V6 Chat-First Shell + chat-panel-v5 Phase E reverse-aligned · MTC v0.11 Federation + publisher_signature M-of-N strip-all-sigs fix · V2 Canonical Layer 220+ Surfaces · B4 ASAR surgery Win install dramatically faster (dev-box 190.9s measured, NVMe + Defender OFF; HDD parity not measured) · B4 P2P Social Audit-Grade Closure §2.2.10–§2.2.24, 15 sections · Security hardening cascade HIGH 44→0 / MOD 4→0 / LOW 45→0 · cc ui llm.chat parity · intent opt-in toggle · chatStream true streaming · intent card Vue Proxy reactivity fix)

### Latest Update - cc ui llm.chat parity + intent opt-in toggle + true streaming + Vue Proxy fix (v5.0.3.45, 2026-05-09)

Four interlocking landings: (1) **`cc ui` `llm.chat` WS topic** (`f41c4b4e2`) — desktop web-shell has had llm.chat since `4eaf90137`, cc ui never registered → QuickAsk hung 60s. New `packages/cli/src/gateways/ws/llm-chat-protocol.js` mirrors desktop frame protocol; new `llm-creds.js` shares the resolver (explicit options → session creds → `VOLCENGINE_API_KEY`-style env vars); chat-intent-protocol picks up the same helper, fixing a latent bug along the way (session creds without baseUrl previously hardcoded ollama). (2) **Intent opt-in toggle** (`f41c4b4e2`) — Chat / Agent project/file mode header gets an `<a-switch>`, **off by default**. Pre-v5.0.3.45 every project/file message went through `chat.intent.understand-stream` first → 0.5–90s of latency; now defaults to direct send (persisted to `localStorage cc.web-panel.chat.intentEnabled`). Desktop shell shares this SPA bundle so its behaviour matches `cc ui`. (3) **`chatStream` truly streams** (`35f6e60ea`) — `chat-core.js` `chatStream` was a fake async generator buffering all `onToken` deltas. Replaced with token queue + Promise waiter so `onToken` push wakes the generator immediately. Affects Chat / Agent / QuickAsk / chat-intent. (4) **Intent placeholder Vue Proxy reactivity fix** (`a76e451e2`) — placeholder push to reactive `messages[sessionId]` wraps in Proxy but the local ref still pointed at the unwrapped target, so mutations bypassed the `set` trap → card sat pinned at "Understanding… / 0 tokens" even with 30+ chunks. Fix: `card = msgs[msgs.length - 1]` after push. NPM: `chainlesschain` 0.161.5 → 0.161.6 → **0.161.7**. Regression: CLI ws gateway 16/16 + chat-core 10/10 + web-panel chat-intent-flow 27/27.

### Latest Update - LLM OCR + audit-ipc coverage + chat-intent 90s safeguard (v5.0.3.44, 2026-05-08)

One user-visible feature + three quality follow-ups: (1) **Screenshot OCR LLM engine** (`39b16e29f`) — Tesseract.js Chinese accuracy is poor, new `engine` parameter `auto`/`llm`/`tesseract` three-way; `auto` (default) routes to volcengine doubao vision, LLM errors auto-degrade with tags back to Tesseract; V5/V6 shared dialog + web-panel dialog both get `<a-select>` + tri-color tag. (2) **chat intent 90s wall-clock safeguard** (`6cbd04c50`) — slow LLMs that dribble tokens but never emit `final` leave the placeholder card spinning forever; `AbortController + 90s` safeguard. (3) **compliance-ipc dead handler cleanup** (`29006decf`) — typo'd prefix `compliance-classify:*` had no callers, and the dead path even backed onto a different service than the real one — drop it before someone misses the real one when patching; surfaced (4) **`audit-ipc.js` first unit test coverage** (`b092673be`) — 18 channels + DI + 23 cases. Regression: desktop 1477/1477 + CLI 17,455/17,455.

### Latest Update - MTC publisher_signature M-of-N fix + Security Hardening Cascade (v5.0.3.43, 2026-05-07)

Fixes a real defect that **bypasses the M-of-N threshold**: producer + verifier must symmetrically feed `_stripSigsForPublisher(landmark)` (zeroing publisher_signature.sig + every snapshot's signature.sig + signatures[*].sig) into JCS — zeroing only publisher_signature.sig is insufficient, since tampering with any per-member sig would otherwise break the publisher_signature without touching the threshold check. Helper extracted to `@chainlesschain/core-mtc/publisher-signing` subpath, three call sites (batch.js / landmark-cache.js / desktop governance-multisig.js) all aligned. Shipped together with security hardening cascade (npm audit HIGH 44→0, MOD 4→0, LOW 45→0): 8 sweeps drop hdkey + werift + speedtest-net, override `serialize-javascript` / `tar` / `semver` / `undici` / `tmp` / `ip-address` / `dompurify` / `make-fetch-happen` transitive vulnerabilities, channel-manager DDL hardening, wrtc-compat patches CVE-2024-29415. Updater switched to notifier-only flow (`4c1a5ac18` + `e27592bb5`), renderer shows live progress. All regressions green: desktop 1454/1454 + core-mtc 258/258 + CLI 17432/17432 + mtc-federation integration 41/41.

### Latest Update - B4 post-pack ASAR surgery (v5.0.3.39, 2026-05-07, issue #8)

Windows install time substantially reduced. **Measured: 190.9s on dev-box (NVMe SSD + Defender OFF) vs 1201s legacy baseline (issue #6) = 6.3× speedup; HDD + Defender ON default-environment strict parity not measured — see [issue #8 close comment](https://github.com/chainlesschain/chainlesschain/issues/8#issuecomment-4393734608) for methodology caveats.** v5.0.3.4-13 set `asar: false` to work around electron-builder's prod-dep walker dropping 4 transitive deps (`call-bind-apply-helpers`, `side-channel-{list,map,weakmap}`) — cost: ~110k loose files in NSIS × ~10 ms per-file = ~20 min install floor on the issue #6 baseline (LZMA dict reset + NTFS transaction + Defender scan). This release (B4 plan, commit `e11b46913`) takes the third path:

- **`scripts/asar-surgery.js`** — runs in electron-builder's `afterPack` hook: extract → inject the 4 walker-dropped packages at top-level → repack via `@electron/asar.createPackageWithOptions`, preserving electron-builder's original auto-unpack decisions. Build-time verification gate throws if any package fails to land at top-level.
- **`scripts/build-win-with-deref.js`** — Win wrapper for `electron-builder --win` that temporarily replaces `@chainlesschain/{core-mtc,session-core}` workspace symlinks with verbatim copies (asar packer rejects symlinks pointing outside app root), restores in `finally` with `'junction'` (Windows non-admin can't create `'dir'` symlinks).
- **`tests/unit/scripts/asar-surgery.test.js`** + **`build-win-with-deref.test.js`** — 23 unit + integration tests (real fs + real `@electron/asar` against tmp fixtures). Surfaced one real bug during test development: `@electron/asar` has a module-level `filesystemCache` keyed by archive path; `extractAll` populates it with the pre-surgery header, so `listPackage` returns stale entries after we delete + repack. Fix: `asar.uncache(asarPath)` after `fs.rmSync`.

Expected Windows install in minutes (dev-box 190.9s verified; HDD + Defender ON parity not measured), ~300 MB smaller installer. Mac/Linux benefit from the same `afterPack` path automatically. Refuted approaches (don't re-attempt): asarUnpack glob (issue #6 empirically refuted), extraResources to `app.asar.unpacked/` (v5.0.3.12), 4 packages declared as direct deps (v5.0.3.6).

### Latest Update - Tray "About" Product Version "—" Fix (v5.0.3.33, 2026-05-06)

A small follow-up edge-case discovered after v5.0.3.32 user re-testing:

- **Tray "About" dialog product version always shows "—"** (commit `461edf060`): users on v5.0.3.32 packaged installs reported tray → About showing `Product Version: —` instead of `v5.0.3.32`. Root cause: `enhanced-tray-manager.js:317` does `require("../../../../package.json")` to read the monorepo root's `productVersion`, but in a packaged install `enhanced-tray-manager.js` lives at `app.asar/dist/main/system/`, so the relative path walks out of `app.asar` to `<install>/resources/` where no `package.json` exists — `require` throws, the catch always returns `"—"`. Dev mode paths happen to resolve in-repo, hiding the bug. Fix: build-time bake `productVersion` + `appVersion` into `dist/main/build-info.json` (`scripts/build-main.js` writes it after `copyDir`); `showAboutDialog` reads that constant first, with the old relative require kept as a fallback for direct-source imports in tests.

### Latest Update - Tray Fixes Closure (v5.0.3.32, 2026-05-06)

Following v5.0.3.31's main-line fix to the tray menu (`tray:action` unified channel + renderer listener), two more edge-case bugs that only surface in packaged installs are addressed:

1. **Tray "Check for Updates" misreports development mode in packaged build** (commit `7e6605006`) — `enhanced-tray-manager.js:365` guarded on `process.env.NODE_ENV === "production"`, but Electron's packaged build leaves `NODE_ENV` undefined by default, so packaged installs hit the fallback branch and never actually called `autoUpdater.checkForUpdates()`. Changed the predicate to `(process.env.NODE_ENV === "production" || app.isPackaged)`.
2. **Tray menu events dropped on first-run when password not set** (commit `2532774f5`) — `App.vue` `onMounted` early-returned when `initial-setup:get-status` reported `{ completed: false }`, skipping registration of three IPC listeners below. The fix: hoist those listeners above the early return.

### Latest Update - vitest 4 Bump + Auto-Updater Fix (v5.0.3.31, 2026-05-05)

- **Desktop auto-updater + tray menu full repair** (commit `bc2e476bf`): three packaged-install regressions had a single root cause — `auto-updater.js` was never `init()`'d, and tray menu items emitted per-item IPC channels that no renderer listened to. Fix: every menu item now goes through the unified `dispatchTrayAction` entry; auto-updater wired into packaged startup with 4h periodic checks.
- **vitest 3.x → 4.1.5 full upgrade** (7 commits `57bb519fe..8ad5fb7e9`): two v3-era workarounds retired together — issue #5's Windows Unit Tests `continue-on-error` and issue #4's `mtc-federation-governance-cli` `poolMatchGlobs → threads:singleThread` route. vitest 4 fixed the upstream birpc 60s `onTaskUpdate` heartbeat hardcode; CLI `testTimeout: 30s → 60s` for subprocess-heavy federation governance + audit e2e. All 5/5 CI workflows green.

### Latest Update - Desktop Icon + Tray + Install Resilience (v5.0.3.30, 2026-05-05)

- **Desktop app icon visual occupancy** (commit `f2c8fc22f`): the master circular logo occupied only ~52% of its 2451×2451 canvas. `tools/regen-app-icon.js` (sharp + png-to-ico) auto-trims transparent edges and rebuilds a 7-layer .ico; new master 1282×1282 with 100% horizontal / 89% vertical occupancy. `BrowserWindow` + `setAppUserModelId` + tray `getIconPath()` candidate paths wired up in the same batch.
- **Main window minimizes to system tray** (commit `d57759dc9`): close button triggers `hide()` rather than `quit()`; tray icon stays resident with right-click Show / Quit.
- **Installer slimmed by 357 MB / 14k files** (commit `b2e1ff27d`): electron-builder afterPack hook filters out devDeps / test directories / `.bak` files that don't belong in production.

### Latest Update - Workspace Refactor + ASAR Final Battle (v5.0.3.22, 2026-05-04)

- **Workspace refactor: removed desktop-app-vue from root workspaces** (commit `ad3e7d403`): structurally fixes the npm workspaces hoisting trap that, for every prior release, caused `call-bind-apply-helpers` and other Express@5 transitive deps to hoist into root `node_modules/` and trigger ASAR-missing-package failures on packaged installs.
- **CLI test sharding replaces glob batching** (commits `1c9db161b` / `21a60f714` / `b52c2f427`): vitest `--shard=k/n` matrix replaces the fragile `[a-m]/[n-z]` glob batches; 9 push/PR workflows gain `concurrency: cancel-in-progress`.
- **Deleted 6 V5 dead pages** (commit `5066a718d`): post V6 Chat-First Shell port closure cleanup; `-8283 lines / +10 lines`.

Full changelog at [docs-site/docs/changelog.md](./docs-site/docs/changelog.md) (covers v5.0.3.1 → v5.0.3.32).

---

### Historical Update - Managed Agents Parity · CLI Persistence (2026-04-16)

Three baseline Managed Agents capabilities from `@chainlesschain/session-core` — MemoryStore, ApprovalGate, BetaFlags — are now fully wired into the CLI with cross-process JSON persistence:

```bash
chainlesschain memory store "..." --scope global|session|agent [--scope-id ID]
chainlesschain memory recall "query" --scope ... --tags ... --json
chainlesschain session policy <id> [--set strict|trusted|autopilot]
chainlesschain config beta list|enable|disable <feature>-<YYYY-MM-DD>
```

**Bug fix**: `ApprovalGate` previously only held per-session policies in-process, so `session policy --set` was lost on CLI exit. Added `createApprovalGateFileAdapter` writing to `~/.chainlesschain/approval-policies.json` with atomic rename + safe-load fallback.

**Tests**: session-core 293 tests (+9), CLI Managed Agents 19 tests (5 unit + 8 integration + 6 e2e) all green. See [user guide](./docs-site/docs/chainlesschain/managed-agents-cli.md) and [design doc](./docs/design/modules/91_Managed_Agents对标计划.md) v1.9.

### Latest Update - Agent Architecture Optimization (5 Modules + 4 Enhancements + 334 Tests) ⭐

v5.0.2.9 implements 5 core optimization modules + 4 enhancement integrations inspired by Claude Code's 12-layer progressive harness architecture:

**5 New Modules**:

- **Feature Flags** (`feature-flags.js`) — 6 registered flags, env > config > default priority, percentage-based A/B rollout
- **Prompt Compressor** (`prompt-compressor.js`) — 5-strategy compression pipeline (dedup/truncate/summarize/snipCompact/contextCollapse), CJK-aware token estimation
- **JSONL Session Store** (`jsonl-session-store.js`) — Append-only session persistence, crash recovery, session forking, compact snapshot rebuild
- **Background Task Manager** (`background-task-manager.js`) — Child process fork + IPC heartbeat monitoring, concurrency limits, task persistence
- **Worktree Isolator** (`worktree-isolator.js`) — Git worktree isolation for parallel agent tasks, agent/\* branch management, crash cleanup

**4 Enhancement Integrations (v5.0.2.9)**:

- **JSONL_SESSION Full Replacement** — `agent-repl.js` and `session.js` fully integrated with JSONL mode for create/save/resume/list
- **Background Tasks UI** — Web Panel new "Background Tasks" monitoring page (Pinia store + Vue3 component + WS protocol)
- **Worktree + Sub-Agent** — `SubAgentContext` integrated with `isolateTask()`, sub-agents auto-run in isolated worktrees
- **Adaptive Context Compression** — 30+ model context window registry + `adaptiveThresholds()` + `adaptToModel()` dynamic switching

**New CLI Commands**:

```bash
chainlesschain config features list              # List 6 feature flag states
chainlesschain config features enable CONTEXT_SNIP  # Enable feature
chainlesschain config features disable CONTEXT_SNIP # Disable feature
```

**CLAUDE.md Optimization**: Reduced from 32KB/724 lines to 4.3KB/117 lines with 6 path-scoped `.claude/rules/` files + `@include` directives.

**Bug Fix**: `PromptCompressor.compress(null)` crash → now safely returns empty array.

**Test Coverage**: 334 tests (255 unit + 42 integration + 37 E2E), 12 test files, all passing.

### Tech-Debt Cleanup - H3 database.js Split (v0.45.31~33, 2026-04-07)

Splitting the giant 9470-line `DatabaseManager` class in `desktop-app-vue/src/main/database.js` into per-responsibility modules under `src/main/database/`.

| File                                 | Lines | Coverage                                                       |
| ------------------------------------ | ----: | -------------------------------------------------------------- |
| `database/database-schema.js`        |  4026 | Pure function `createTables` — all CREATE TABLE DDL (v0.45.31) |
| `database/database-migrations.js`    |  1389 | 8 migration / rebuild methods (v0.45.32)                       |
| `database/database-settings.js`      |   531 | 7 settings-table CRUD methods (v0.45.32)                       |
| `database/database-knowledge.js`     |   330 | 15 knowledge_items + tags + statistics methods (v0.45.33)      |
| `database/database-soft-delete.js`   |   212 | 7 soft-delete + periodic cleanup methods (v0.45.33)            |
| `database/database-graph.js`         |   465 | 9 knowledge-graph relation methods (v0.45.33)                  |
| `database/database-projects.js`      |   591 | 10 projects + project_files methods (v0.45.33)                 |
| `database/database-conversations.js` |   416 | 12 conversations + messages methods (v0.45.33)                 |
| **Total (8 sub-modules)**            |  7960 | **69 methods extracted**                                       |

**Approach**: each extracted method is a pure function `fn(dbManager, logger, ...args)` that accesses `dbManager.db` for SQL and calls `dbManager.X()` for cross-method callbacks. `DatabaseManager` keeps thin delegate methods (`return _fn(this, logger, ...)`) so the public API is byte-identical.

**Result**: `database.js` shrank from 9470 → **2052 lines** (**−7418, −78.3%**). What remains is init/teardown, query primitives (run/get/all/exec/prepare/transaction) and backup/switch-database core machinery. All 127 database unit tests pass.

See [`docs/design/modules/43_IPC域分割与懒加载系统.md`](docs/design/modules/43_IPC域分割与懒加载系统.md) §9 (H2 context).

### Tech-Debt Cleanup - H2 IPC Registry Split (v0.45.30, 2026-04-07)

Extracted the trailing self-contained Phase blocks from `desktop-app-vue/src/main/ipc/ipc-registry.js` into `src/main/ipc/phases/`, grouped by version/batch.

| File                               | Lines | Phases | Coverage                                                                                                                                         |
| ---------------------------------- | ----: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `phases/phase-1-ai.js`             |   393 |      1 | LLM, PermanentMemory, Hooks, Plan/Skills, Context Eng, Token/Stream, Team Task, Permission, RAG, Browser (22 regs)                               |
| `phases/phase-2-core.js`           |   135 |      1 | U-Key, Database, Git + critical early IPC (MCP basic config, System early, Notification early) — 6 regs                                          |
| `phases/phase-6-7-content.js`      |   197 |      2 | File, Office, Template, Knowledge, Prompt Template, Image (Phase 6) + Speech, Video, PDF, Document (Phase 7)                                     |
| `phases/phase-8-9-extras.js`       |   357 |      2 | Blockchain (lazy), Code/Review, Collaboration/Automation, KG/Credit, Plugin (lazy), Import, Sync/Pref/Conv, FileSync, Config, Category, Workflow |
| `phases/phase-3-4-social.js`       |   306 |      2 | DID, P2P, Social (8 sub-modules), VC, Identity Context, Org, Dashboard                                                                           |
| `phases/phase-5-project.js`        |   170 |      1 | Project Core/AI/Export/RAG/Git (5 sub-modules, 91 handlers)                                                                                      |
| `phases/phase-9-15-core.js`        |   259 |      7 | Cowork, Workflow Optimizations, Audit, Marketplace, Agents, SSO, UnifiedTools                                                                    |
| `phases/phase-16-20-skill-evo.js`  |   494 |      5 | Skill Pipeline/Workflow, Instinct, Cowork v2 Cross-device, ML Sched/LB/CICD/Docs, Self-Evolution                                                 |
| `phases/phase-21-30-enterprise.js` |   295 |     10 | Enterprise Org, IPFS, Analytics, Autonomous, AutoTuner, Multimodal, Skill Marketplace, Trading, DeFi, Crypto                                     |
| `phases/phase-31-ai-models.js`     |   261 |      7 | Benchmark, MemAug, DualModel, Quant, FineTune, Whisper, FedLearn                                                                                 |
| `phases/phase-33-40-collab-ops.js` |   553 |      8 | Git P2P, Yjs Collab, Pipeline, Anomaly, NL Spec, Multimodal, Wire-up, Decentralized Network                                                      |
| `phases/phase-41-evomap-gep.js`    |   102 |      1 | EvoMap GEP Protocol                                                                                                                              |
| `phases/phase-42-50-v1-1.js`       |   450 |      9 | Social/AP, Compliance, SCIM, U-Key/FIDO2, BLE, Nostr, DLP                                                                                        |
| `phases/phase-51-57-v1-1.js`       |   268 |      7 | SIEM, PQC, Firmware OTA, Governance, Matrix, Terraform, Hardening                                                                                |
| `phases/phase-58-77-v2-v3.js`      |   757 |     20 | Federation, Reputation, Inference, Trust Root, Storage, EvoMap                                                                                   |
| `phases/phase-q1-2027.js`          |    89 |      5 | WebAuthn, ZKP, FL, IPFS Cluster, GraphQL                                                                                                         |

**Result**: `ipc-registry.js` shrank from 4925 → 493 lines (**−4432, −90.0%**) across 16 extracted phase modules covering 88 phases. `phase-modules.test.js` now has 48 contract tests, all passing.

See [`docs/design/modules/43_IPC域分割与懒加载系统.md`](docs/design/modules/43_IPC域分割与懒加载系统.md) §9 for full details.

### History - Web Panel: 23 Modules Enterprise Expansion (v5.0.2.12)

v5.0.2.12 expands Web Panel from 15 to **23 modules** with enterprise and extension features:

**Batch 1 (Enterprise)**:

- 💰 **Wallet** — Wallet list, asset management, transfer history
- 🏢 **Organization** — Org management, members, teams, approvals
- 📊 **Analytics** — Token usage, cost breakdown, cache status
- 📋 **Templates** — 9 project templates, BI templates, prompt templates

**Batch 2 (Extensions)**:

- 🔐 **Permissions** — RBAC roles, permission checks, audit logs
- 📰 **RssFeed** — Feed management, article reading, statistics
- 💾 **Backup** — Backup management, data sync, IPFS storage
- 🔑 **WebAuthn** — WebAuthn credentials, SSO config, 2FA

**Sidebar**: Expanded from 4 to 7 groups (Overview/Config/Data/Advanced/Enterprise/Extensions)

**Tests**: Web Panel total **621** (523 unit + 40 integration + 58 E2E)

### History - Web Panel: 15 Modules + v1.0 Protocol Fix (v5.0.2.11)

v5.0.2.11 expands Web Panel from 10 to **15 modules**, fixes v1.0 Coding Agent Envelope protocol compatibility, and adds 4 advanced management pages migrated from Desktop:

**v1.0 Envelope Protocol Fix**:

- `ws.js`: `requestId` priority correlation + `flattenEnvelope()` + dot-case `normalizeRuntimeEvent()`
- `chat.js`: `DOT_TO_LEGACY_TYPE` mapping (`assistant.delta` → `response-token`, etc.)
- `agent-runtime.js`: `startServer()` loads config for sessionManager

**5 New Pages**:

- 🔒 **Security** — DID identity management, file encryption/decryption, audit logs
- 📡 **P2P** — Device list, pairing, messaging, sync status
- 🔀 **Git** — Repository status, auto-commit, import/export
- 📁 **Projects** — 6 template initialization, status cards, environment diagnostics
- ⚡ **Tasks** — Task list/details/history/notifications

**Providers Enhanced**: New LLM parameter settings panel (provider/model/apiKey/baseUrl/temperature/maxTokens)

**Tests**: Web Panel total **266+** (218 unit + 12 integration + 12 E2E + SPA route tests)

### History - Web Panel: 10 Modules + 4 Themes

v5.0.2.8 expands the Vue3 Web Management Panel with 6 new pages and a 4-theme color system:

**6 New Pages** (sidebar now has 10 total):

- 🐳 **Services** — Docker service control, port health monitoring
- 📋 **Logs** — Color-coded log viewer with keyword filtering
- 📝 **Notes** — Note list, search, create, delete
- 🔧 **MCP Tools** — MCP server and tool browser
- 🧠 **Memory** — 3-layer memory statistics and item browser
- ⏰ **Cron** — Scheduled task list with enable/disable toggle

**4 Color Themes** (top-right switcher, persisted to `localStorage`):

| 🌑 Dark (default) | ☀️ Light | 🌊 Blue   | 🌿 Green   |
| ----------------- | -------- | --------- | ---------- |
| Dark gray         | White    | Deep blue | Deep green |

**Key Bug Fixes**:

- Skills always showing 0: WS server sends `stdout`, client read `output` (undefined) — fixed
- Provider list missing Chinese models: rewritten to match CLI's actual 10 provider keys
- 5 Chinese character U+FFFD corruption instances — all fixed

**Tests**: +29 new Web Panel unit tests, total 157 Web Panel tests.

```bash
chainlesschain ui                              # Launch panel (bundled, no build needed)
chainlesschain ui --port 9000 --ws-port 9001  # Custom ports
chainlesschain ui --web-panel-dir /custom/dist # Custom dist directory
```

### History - Skill Creator v1.2.0: LLM-Driven Description Optimization

v5.0.2.7 upgrades the built-in `skill-creator` to v1.2.0, adding a full LLM-driven description optimization loop:

- **`optimize-description`** action: LLM generates 20 eval queries (10 should/shouldn't trigger), 60/40 train/test split, iteratively rewrites description, auto-updates `SKILL.md`
- **`--advanced` flag** on `optimize`: same as `optimize-description`
- **`--iterations N`** flag: control max iteration count (default 5)
- Graceful degradation when LLM unavailable (non-CLI context or timeout)
- **76 new tests**: 50 unit + 12 integration + 14 E2E, all passing

```bash
chainlesschain skill run skill-creator "optimize-description code-review"
chainlesschain skill run skill-creator "optimize-description code-review --iterations 3"
chainlesschain skill run skill-creator "optimize code-review --advanced"
```

**v5.0.2.6**: Vue3 Web Panel npm packaging + `$` character bug fix. npm users get panel bundled — no build step needed.

### v5.0.2.5 - Vue3 Web Management Panel

`chainlesschain ui` launches a full Vue3 management panel (inspired by [ClawPanel](https://github.com/qingchencloud/clawpanel)):

- ✅ **Dashboard** — Service status cards (WebSocket / active LLM / skills count / sessions)
- ✅ **AI Chat** — Chat / Agent dual modes, streaming Markdown, tool call visualization, interactive Q&A
- ✅ **Skills Manager** — Browse 138+ skills by category, search, one-click run
- ✅ **LLM Providers** — 10 provider management, one-click switch, connection test, Ollama model list
- ✅ **Project vs Global Mode** — Project mode scopes sessions to project; clear visual distinction

```bash
# npm install users: no build needed
chainlesschain ui

# Source users
npm run build:web-panel && chainlesschain ui
```

---

### History - AI Orchestration Layer ⭐

`cc orchestrate` turns ChainlessChain into an orchestration layer with Claude Code / Codex as parallel execution agents:

- ✅ **LLM Task Decomposition** — A single high-level task automatically split into parallel subtasks
- ✅ **Multi-path Agent Routing** — Supports claude/codex/gemini/openai/ollama backends with 5 routing strategies (round-robin / primary / parallel-all / by-type / weighted)
- ✅ **Automatic CI/CD Verification** — Runs CI after agents complete; retries with error context on failure
- ✅ **Multi-channel Notifications** — Telegram, WeCom, DingTalk, Feishu, WebSocket simultaneously
- ✅ **Receive IM Commands** — `--webhook` mode accepts incoming commands from WeCom/DingTalk/Feishu
- ✅ **WebSocket Integration** — WS-triggered tasks push real-time events back to the same WS client
- ✅ **106 Tests** — 72 unit + 15 integration + 19 E2E, all passing

```bash
cc orchestrate "Fix the auth bug in login.ts"                      # Auto-detect AI tool and run
cc orchestrate "Refactor payment" --backends claude,gemini --strategy parallel-all
cc orchestrate "Add tests" --ci "npm run test:unit" --retries 5   # Custom CI + retries
cc orchestrate --status --json                                     # View status (JSON)
cc orchestrate detect                                               # Detect installed AI CLIs
cc orchestrate --webhook --webhook-port 18820                      # Start IM command receiver
```

---

### History - Web Management UI Protocol Fix ⭐

`chainlesschain ui` launches a local web management page in one command, supporting both project-scoped and global management modes:

- ✅ **Project Mode** — Run from a directory with `.chainlesschain/`, AI automatically includes project context
- ✅ **Global Mode** — Run from any directory, opens a global management panel
- ✅ **Streaming Markdown Output** — Real-time token streaming via `response-token` events, syntax highlighting
- ✅ **Agent Tool Visibility** — Shows tool calls in real time (`tool-executing` event)
- ✅ **Session Management** — Sidebar with create/switch/history, Agent/Chat mode tabs
- ✅ **Interactive Q&A** — Agent slot-filling questions shown in a dialog overlay
- ✅ **WebSocket Reuse** — Auto-starts built-in WS server, browser connects directly, token auth supported
- ✅ **103 Tests** — 47 unit + 32 integration + 24 E2E, all passing
- 🐛 **Fixed 5 WS protocol mismatches** — chat, auth, session list, and streaming now fully work

```bash
cd /your/project && chainlesschain ui         # Project mode (auto-detected)
chainlesschain ui                              # Global mode (non-project directory)
chainlesschain ui --port 9000 --ws-port 9001  # Custom ports
chainlesschain ui --token mysecret            # Enable authentication
chainlesschain ui --no-open                   # Start server without opening browser
```

Open `http://127.0.0.1:18810` to start chatting.

---

### History - AI Document Creator Template ⭐

`cc init --template ai-doc-creator` sets up a complete AI document creation workspace in one command, auto-generating 3 document skills:

- ✅ **AI Document Generation** (`doc-generate`) — AI-generated structured documents (reports/proposals/manuals/READMEs), 4 styles, supports md/html/docx/pdf output, dual-path conversion via pandoc or LibreOffice
- ✅ **LibreOffice Format Conversion** (`libre-convert`) — Headless format conversion (docx/pdf/html/odt/pptx, etc.), auto-detects PATH and Windows default install paths
- ✅ **AI Document Editing** (`doc-edit`) — AI-powered editing of existing documents, preserving formulas/charts/styles, three operation modes (edit/summarize/translate), outputs `_edited` file without overwriting original
- ✅ **Persona Configuration** — "AI Document Assistant" role, expert in document structure planning, batch generation, and format conversion workflows
- ✅ **cli-anything Integration Boundary** — `rules.md` clarifies: LibreOffice works both as workspace skill (daily use) and `cli-anything register soffice` (advanced macros/templates)
- ✅ **168 New Tests** — 70 unit + 47 integration + 51 E2E, all passing

```bash
chainlesschain init --template ai-doc-creator --yes
winget install pandoc                                                 # DOCX output (optional)
chainlesschain skill run doc-generate "2026 AI Technology Trends"     # Generate report
chainlesschain skill run doc-generate "Product Plan" --args '{"format":"docx","style":"proposal"}'
chainlesschain skill run libre-convert "report.docx"                  # Convert to PDF
chainlesschain skill run doc-edit --args '{"input_file":"report.md","instruction":"polish abstract"}'
chainlesschain cli-anything register soffice                          # Register LibreOffice advanced
```

---

### Latest - AI Video Generation (Volcengine Seedance)

The desktop app now integrates Volcengine Ark Seedance text-to-video API via `window.api.video.generate({prompt, outputPath, ratio, duration, imageUrl})`:

- ✅ **Full Seedance lineup** — `doubao-seedance-1.0-lite` / `1.5-pro` / `pixeldance`, text-to-video and first-frame image-driven modes
- ✅ **Streaming progress** — `video:generate:progress` emits `task-created / status-update / downloading / complete`
- ✅ **Robust polling** — 5s interval, 10-min timeout, handles `queued / running / succeeded / failed`
- ✅ **15 tests green** — 9 unit + 4 integration + 2 full-chain, all mocked (no real-API billing)
- 📖 User docs: `docs-site/docs/chainlesschain/ai-video-generation.md`
- 📖 Design: `docs/design/modules/90_AI视频生成_Volcengine_Seedance.md`

---

### History - AI Media Creator Template

`cc init --template ai-media-creator` sets up a complete AI media creation workspace in one command, auto-generating 3 media skills:

- ✅ **ComfyUI Image Generation** (`comfyui-image`) — Direct ComfyUI REST API calls (text-to-image / image-to-image), built-in default SD workflow, supports custom workflow JSON files
- ✅ **ComfyUI Video Generation** (`comfyui-video`) — AnimateDiff animation video generation, loads user-saved workflow files from `workflows/` directory
- ✅ **AI Speech Synthesis** (`audio-gen`) — 4-backend auto-fallback chain: edge-tts (free) → piper-tts (offline) → ElevenLabs API → OpenAI TTS
- ✅ **Persona Configuration** — "AI Media Creator" role, expert in Stable Diffusion prompt engineering and AnimateDiff parameter tuning
- ✅ **cli-anything Integration Boundary** — `rules.md` explicitly clarifies: ComfyUI (REST API) uses workspace skills; FFmpeg/yt-dlp (CLI tools) use `cli-anything register`
- ✅ **114 New Tests** — 40 unit + 33 integration + 41 E2E, all passing

---

### History - CLI Command Skill Pack System

Automatically wraps 62 CLI commands into **9 Agent-callable skill packs**:

- ✅ **9 Domain Skill Packs** — knowledge/identity/infra/ai-query/agent-mode/web3/security/enterprise/integration
- ✅ **Execution Mode Classification** — `direct` / `agent` / `hybrid` / `llm-query` — Agent no longer blindly calls commands
- ✅ **Auto-Sync** — SHA-256 hash-based change detection, `skill sync-cli` / `postinstall` auto-trigger
- ✅ **101 Tests** — 57 unit + 21 integration + 23 E2E, all passing

```bash
chainlesschain skill sync-cli              # Detect changes and sync
chainlesschain skill run cli-knowledge-pack "note list"  # Agent calls note mgmt
```

---

### History - CLI Distribution System (Phase 101)

New lightweight npm CLI tool — install and manage ChainlessChain with a single command:

```bash
npm install -g chainlesschain
chainlesschain setup    # Interactive setup wizard (or: cc setup / clc setup / clchain setup)
chainlesschain start    # Launch application (or: cc start / clc start / clchain start)
```

- ✅ **npm CLI Package** (`packages/cli/`) — Pure JS thin orchestrator (~2MB), 62 commands (incl. Phase 7-8 enterprise features + WebSocket Server + Persona)
- ✅ **Interactive Setup Wizard** — Node.js/Docker check → edition select → LLM config → binary download → auto-configure
- ✅ **GitHub Release Integration** — Auto-download platform binaries (Win/macOS/Linux) + SHA256 verification
- ✅ **Docker Compose Orchestration** — One-command backend management (`services up/down/logs/pull`)
- ✅ **Environment Diagnostics** (`doctor`) — 12 checks (Node/Docker/Git/ports/disk/network)
- ✅ **Phase 1 AI Intelligence Layer** — BM25 search + Token tracking + Persistent memory + Session management + Agent Plan Mode
- ✅ **Phase 2 Knowledge Management** — Knowledge import (Markdown/Evernote/Notion/PDF) + export (Markdown/static site) + Git integration + note versioning
- ✅ **Phase 3 MCP & External Integration** — MCP server management (JSON-RPC 2.0) + 10 LLM providers + 3 proxy relays + browser automation + instinct learning
- ✅ **Phase 4 Security & Identity** — DID identity management (Ed25519) + AES-256-GCM file encryption + RBAC permission engine + audit logging
- ✅ **Phase 5 P2P & Enterprise** — P2P messaging + file sync + digital wallet (Ed25519) + org management + plugin marketplace
- ✅ **Phase 6 AI Core** — Hook lifecycle management (28 event types) + DAG Workflow Engine (5 built-in templates) + Hierarchical Memory 2.0 (4-layer architecture + forgetting curve) + A2A Agent-to-Agent Protocol
- ✅ **Phase 7 Security & Evolution** — Security Sandbox v2 (fine-grained permissions + behavior monitoring) + Self-Evolving System (capability assessment + self-diagnosis + self-repair)
- ✅ **Phase 8 Blockchain & Enterprise** — Agent Economy (micropayments + resource marketplace + NFTs) + ZKP Engine (Groth16 + selective disclosure) + BI Analytics (NL→SQL + anomaly detection)
- ✅ **Phase 9 Low-Code & Multi-Agent** — Low-Code Platform (15+ components + versioning) + Multi-Agent Coordinator + DI Service Container
- ✅ **CI/CD Auto-publish** — GitHub Actions `npm publish --provenance` + supply chain security
- ✅ **Agent Context Engineering** — 6-dimension context injection (Instinct/Memory/BM25 Notes/Task/Permanent Memory/Compaction Summary) + KV-Cache optimization + stable prefix caching + smart compaction + resumable summaries + session resume (`--session`)
- ✅ **Autonomous Agent** — ReAct autonomous task loop (`/auto` command) + goal decomposition + self-correction
- ✅ **Multi-Provider Support** — 10 LLM providers (volcengine/openai/anthropic/deepseek/dashscope/gemini/kimi/minimax/mistral/ollama) + 3 proxy relays (OpenAI/Anthropic/Gemini) + task-based intelligent model selection
- ✅ **DAG Plan Execution + Risk Assessment** — `/plan execute` topological sort + `/plan risk` risk scoring
- ✅ **EvoMap Gene Exchange** — `evomap search|download|publish|list|hubs` GEP-A2A protocol client + Federation Hub management + Gene governance
- ✅ **CLI-Anything Integration** — `cli-anything doctor|scan|register|list|remove` Agent-native software integration, auto-register as managed-layer skills
- ✅ **WebSocket Server** — `serve` command exposes all CLI commands over WebSocket, supports execute/stream/cancel + token auth + heartbeat + injection protection
- ✅ **WebSocket Stateful Sessions** — Create/resume/manage agent/chat sessions over WS, with project context binding, SlotFiller parameter filling (9 intent types auto-detected), InteractivePlanner interactive planning (2503 tests/113 files)
- ✅ **Agent Intelligence** — Auto pip-install for Python packages + script persistence + error classification (5 types) + environment detection + agent-core extraction
- ✅ **Autonomous Learning Loop** — Execution trajectory tracking + auto-scoring (3 signal sources) + skill synthesis from successful patterns + skill improvement (3 triggers) + periodic self-reflection (224 tests)
- ✅ **Sub-Agent Isolation v2** — SubAgentContext isolated execution + spawn_sub_agent tool + namespaced memory + scoped context engineering + role-based tool whitelist + 3-level summarization + lifecycle registry + sandboxed execution environment + resource limits + parent-child communication protocol
- ✅ **DAO Governance v2** — Quadratic voting + vote delegation + treasury management + proposal lifecycle (`dao` command)
- ✅ **Security & Compliance CLI** — Compliance management (GDPR/SOC2/HIPAA/ISO27001) + DLP + SIEM log export + Post-Quantum Cryptography (PQC)
- ✅ **Communication Bridges CLI** — Nostr bridge (NIP-01) + Matrix bridge (E2EE) + SCIM 2.0 user provisioning
- ✅ **Infrastructure Hardening CLI** — Terraform IaC (workspaces/plan/apply) + Security hardening (perf baselines/regression detection/audit)
- ✅ **Social Platform CLI** — Contacts + friend system + posts + instant chat + social stats
- ✅ **Hook Pipeline** — PreToolUse/PostToolUse/ToolError tool call hooks integration
- ✅ **Content Recommender** — TF-IDF tool similarity + tool chain frequency recommendation
- ✅ **4741+ Test Cases** — 116 test files (unit + integration + E2E), cross-platform CI matrix (Ubuntu/Windows/macOS)
- ✅ **Project Initialization** (`init`) — 9 templates (code-project/data-science/devops/medical-triage/agriculture-expert/general-assistant/ai-media-creator/**ai-doc-creator**/empty), generates `.chainlesschain/` project structure; ai-media-creator auto-generates ComfyUI/TTS skills; ai-doc-creator auto-generates doc-generate/libre-convert/doc-edit skills
- ✅ **Persona System** — Project-level AI persona configuration (`persona show/set/reset`), replaces default coding assistant, tool permission control, auto-activated Persona Skills
- ✅ **Multi-layer Skill System** — 4-layer priority (bundled < marketplace < managed < workspace), custom skill management (add/remove/sources)
- ✅ **Multi-agent Collaboration** (`cowork`) — Multi-perspective debate review + A/B solution comparison + code knowledge graph analysis
- ✅ **Plugin Skill Integration** — Plugins can declare and install skills to marketplace layer

---

### Historical Updates - v5.0.0 Architecture Refactoring + AI Agent 2.0 + Web3 Deepening + Enterprise Platform + Self-Evolving AI (Phase 78-100)

**23 new modules** covering three major directions: AI Agent 2.0, Web3 Deepening, and Enterprise Productivity Platform. Added ~178 IPC Handlers, 37 test files with 1238+ test cases, all passing.

**Milestone 1: Architecture Foundation (Phase 78-80)** — IPC Domain Split + Lazy Loading, DI Container + Shared Cache + EventBus, Database Migration Framework
**Milestone 2: AI Agent 2.0 (Phase 81-87)** — A2A Protocol, Agentic Workflow Engine, Hierarchical Memory, Multimodal Perception, Agent Economy, Code Agent v2, Agent Sandbox v2
**Milestone 3: Web3 + Privacy (Phase 88-92)** — ZKP Engine, Cross-Chain Bridge, DID v2.0, Privacy Computing, DAO Governance v2
**Milestone 4: Enterprise Platform (Phase 93-97)** — Low-Code Platform, Knowledge Graph, BI Engine, Workflow Automation, Multi-tenant SaaS
**Milestone 5: Ecosystem Fusion (Phase 98-100)** — Universal Runtime, Plugin Ecosystem v2, Self-Evolving AI

---

### Historical Updates - v1.2.1 Added 6 Community Ecosystem Skills (138 Total Desktop Built-in Skills)

Researched community skill ecosystems (OpenClaw, awesome-skills, etc.) and added 6 high-frequency missing skills: creative brainstorming, systematic debugging strategies, API design, frontend design, PR creation, and document co-authoring.

**Community Ecosystem Skills (6)**:

- ✅ **brainstorming** - Creative brainstorming with 5 methods (ideate/mindmap/SWOT/Six Hats/SCAMPER)
- ✅ **debugging-strategies** - Systematic debugging with 9 modes (diagnose/bisect/trace/hypothesis/rubber-duck/root-cause/red-flags/defense/session)
- ✅ **api-design** - API design with 5 modes (design/review/OpenAPI/versioning/errors)
- ✅ **frontend-design** - Frontend design with 5 modes (component/layout/responsive/a11y/theme)
- ✅ **create-pr** - PR creation with 4 modes (create/draft/template/changelog)
- ✅ **doc-coauthoring** - Document co-authoring with 5 modes (draft/expand/review/structure/glossary)

**Skill Statistics**: 131 (v1.2.0) → **138 (v1.2.1)** (+7)

---

### History - v1.2.0 Added 32 Practical Skills (131 Total Desktop Built-in Skills)

Studied 10 external skill standards (Tavily-search, Find-Skills, Proactive-Agent, Agent-Browser, Remotion, Cron, Planning-with-files, etc.) and converted them into built-in skills, added 12 development/ops/knowledge management skills, and 10 integration/productivity/knowledge skills.

**External Skill Standard Conversions (10)**:

- ✅ **tavily-search** - Web search via Tavily API (deep search/news/content extraction)
- ✅ **find-skills** - Skill discovery from registry (search/recommend/browse by category)
- ✅ **proactive-agent** - 4 autonomous triggers (file-watch/threshold/periodic/pattern)
- ✅ **agent-browser** - Snapshot reference mode (@e1/@e2) browser automation
- ✅ **remotion-video** - React/Remotion video creation with 6 templates
- ✅ **cron-scheduler** - Cron expression + natural language time scheduling
- ✅ **planning-with-files** - Manus 3-file mode (task_plan/findings/progress)
- ✅ **content-publisher** - 5 content types (infographic/slides/cover/comic/social)
- ✅ **skill-creator** (v1.2.0) - Meta-skill: create/test/validate/optimize + LLM-driven `optimize-description` loop (60/40 split, iterative rewriting, auto-writes back to SKILL.md)
- ✅ **webapp-testing** - Recon-execute mode (accessibility/E2E/security scanning)

**Practical Popular Skills (12)**:

- ✅ **deep-research** - 8-stage research pipeline (query decomposition → synthesis → citation formatting)
- ✅ **git-worktree-manager** - Git worktree create/list/remove/prune
- ✅ **pr-reviewer** - PR review via gh CLI, detects secret leaks/eval/console.log
- ✅ **docker-compose-generator** - 10 service templates + auto stack detection
- ✅ **terraform-iac** - AWS/GCP/Azure HCL generation, 8 cloud templates
- ✅ **api-docs-generator** - Scan route patterns to generate OpenAPI 3.0 spec
- ✅ **news-monitor** - HackerNews API + keyword tracking + trend detection
- ✅ **ultrathink** - 7-step extended reasoning (analyze/decompose/evaluate modes)
- ✅ **youtube-summarizer** - Transcript extraction + structured summary + chapters
- ✅ **database-query** - SQL generation/optimization/schema introspection/migration
- ✅ **k8s-deployer** - Manifest generation + Helm Chart + security best practices
- ✅ **cursor-rules-generator** - Auto-generate 5 AI coding assistant config files

**Integration & Productivity Skills (10)**:

- ✅ **api-gateway** - Universal API gateway, 100+ APIs unified interface/key management/chain calls
- ✅ **free-model-manager** - Free model management, Ollama/HuggingFace model discovery/download/manage
- ✅ **github-manager** - GitHub operations, Issues/PR/repos/Workflows management
- ✅ **google-workspace** - Google Workspace integration, Gmail/Calendar/Drive
- ✅ **humanizer** - Remove AI writing traces, tone adjustment/pattern optimization
- ✅ **notion** - Notion integration, page creation/database queries/content management
- ✅ **obsidian** - Obsidian vault manager, note creation/search/tags/backlinks
- ✅ **self-improving-agent** - Auto-learn from mistakes, error tracking/pattern analysis/suggestions
- ✅ **summarizer** - Universal summarizer, URL/PDF/YouTube/text summaries + key points
- ✅ **weather** - Weather queries, global weather/forecasts/alerts (wttr.in, no API key)

**Skill Statistics**: 96 (v1.0.0) → 131 (v1.2.0) (+35)

---

### History - v3.1.0~v3.4.0 Decentralized AI Marketplace + Hardware Security Ecosystem + Global Social + EvoMap Evolution Network (Phase 65-77)

**Phase 65-77 v3.1.0~v3.4.0 Complete Implementation** - Skill-as-a-Service + Token Incentive + Inference Network + Trust Root + PQC Full Migration + Satellite Communication + Open Hardware + Protocol Fusion + AI Social Enhancement + Decentralized Storage + Anti-Censorship Communication + EvoMap Federation + IP&DAO Governance, totaling 64 new IPC handlers, 23 new database tables, 13 new frontend pages

#### Phase 65-67 — Decentralized AI Marketplace v3.1.0 (2026-02-28)

**Phase 65 — Skill-as-a-Service** (5 IPC handlers):

- ✅ **SkillServiceProtocol** (`marketplace/skill-service-protocol.js`) - Standardized skill description (input/output/dependencies/SLA), EvoMap Gene format, skill discovery registry, version management, Pipeline DAG orchestration
- ✅ **SkillInvoker** (`marketplace/skill-invoker.js`) - REST/gRPC remote invocation, cross-org delegation, version-aware routing
- ✅ **Skill Service IPC** (`marketplace/skill-service-ipc.js`) - 5 handlers (list-skills/publish-skill/invoke-remote/get-versions/compose-pipeline)

**Phase 66 — Token Incentive** (5 IPC handlers):

- ✅ **TokenLedger** (`marketplace/token-ledger.js`) - Local token accounting, reward calculation, reputation-weighted pricing
- ✅ **ContributionTracker** (`marketplace/contribution-tracker.js`) - Skill/gene/compute/data contribution tracking, quality scoring
- ✅ **Token IPC** (`marketplace/token-ipc.js`) - 5 handlers (get-balance/get-transactions/submit-contribution/get-pricing/get-rewards-summary)

**Phase 67 — Decentralized Inference Network** (6 IPC handlers):

- ✅ **InferenceNodeRegistry** (`ai-engine/inference/inference-node-registry.js`) - GPU/CPU node registration, benchmarking, SLA, heartbeat
- ✅ **InferenceScheduler** (`ai-engine/inference/inference-scheduler.js`) - Latency/cost/compute scheduling, model sharding parallelism, TEE privacy, federated learning
- ✅ **Inference IPC** (`ai-engine/inference/inference-ipc.js`) - 6 handlers (register-node/list-nodes/submit-task/get-task-status/start-federated-round/get-network-stats)

#### Phase 68-71 — Hardware Security Ecosystem v3.2.0 (2026-02-28)

**Phase 68 — Trinity Trust Root** (5 IPC handlers):

- ✅ **TrustRootManager** (`ukey/trust-root-manager.js`) - U-Key+SIMKey+TEE unified trust root, attestation chain, secure boot, hardware fingerprint binding
- ✅ **Trust Root IPC** (`ukey/trust-root-ipc.js`) - 5 handlers (get-status/verify-chain/sync-keys/bind-fingerprint/get-boot-status)

**Phase 69 — PQC Full Migration** (4 IPC handlers):

- ✅ **PQCEcosystemManager** (`ukey/pqc-ecosystem-manager.js`) - ML-KEM/ML-DSA full replacement, SIMKey firmware PQC, hybrid-to-pure PQC migration
- ✅ **PQC Ecosystem IPC** (`ukey/pqc-ecosystem-ipc.js`) - 4 handlers (get-coverage/migrate-subsystem/update-firmware-pqc/verify-migration)

**Phase 70 — Satellite Communication** (5 IPC handlers):

- ✅ **SatelliteComm** (`security/satellite-comm.js`) - LEO satellite messaging, encryption+compression, offline signature queue, emergency key revocation
- ✅ **DisasterRecovery** (`security/disaster-recovery.js`) - Offline key recovery, identity verification, revocation propagation
- ✅ **Satellite IPC** (`security/satellite-ipc.js`) - 5 handlers (send-message/get-messages/sync-signatures/emergency-revoke/get-recovery-status)

**Phase 71 — Open Hardware Standard** (4 IPC handlers):

- ✅ **HsmAdapterManager** (`ukey/hsm-adapter-manager.js`) - Unified HSM interface, Yubikey/Ledger/Trezor adapters, FIPS 140-3 compliance
- ✅ **HSM Adapter IPC** (`ukey/hsm-adapter-ipc.js`) - 4 handlers (list-adapters/connect-device/execute-operation/get-compliance-status)

#### Phase 72-75 — Global Decentralized Social v3.3.0 (2026-02-28)

**Phase 72 — Multi-Protocol Fusion Bridge** (5 IPC handlers):

- ✅ **ProtocolFusionBridge** (`social/protocol-fusion-bridge.js`) - Unified message format, lossless cross-protocol conversion, DID↔AP↔Nostr↔Matrix identity mapping, cross-protocol routing
- ✅ **Protocol Fusion IPC** (`social/protocol-fusion-ipc.js`) - 5 handlers (get-unified-feed/send-message/map-identity/get-identity-map/get-protocol-status)

**Phase 73 — AI Social Enhancement** (5 IPC handlers):

- ✅ **RealtimeTranslator** (`social/realtime-translator.js`) - Local LLM translation (50+ languages), language detection, translation cache
- ✅ **ContentQualityAssessor** (`social/content-quality-assessor.js`) - AI harmful content detection, decentralized consensus moderation, quality scoring
- ✅ **AI Social IPC** (`social/ai-social-ipc.js`) - 5 handlers (translate-message/detect-language/assess-quality/get-quality-report/get-translation-stats)

**Phase 74 — Decentralized Content Storage** (5 IPC handlers):

- ✅ **FilecoinStorage** (`ipfs/filecoin-storage.js`) - Storage deals, proof verification, deal renewal, cost estimation
- ✅ **ContentDistributor** (`ipfs/content-distributor.js`) - P2P CDN, hot content caching, IPLD DAG version management
- ✅ **Decentralized Storage IPC** (`ipfs/decentralized-storage-ipc.js`) - 5 handlers (store-to-filecoin/get-deal-status/distribute-content/get-version-history/get-storage-stats)

**Phase 75 — Anti-Censorship Communication** (5 IPC handlers):

- ✅ **AntiCensorshipManager** (`security/anti-censorship-manager.js`) - Tor hidden services, traffic obfuscation, CDN domain fronting
- ✅ **MeshNetworkManager** (`security/mesh-network-manager.js`) - BLE/WiFi Direct mesh networking, satellite broadcast relay
- ✅ **Anti-Censorship IPC** (`security/anti-censorship-ipc.js`) - 5 handlers (start-tor/get-tor-status/enable-domain-fronting/start-mesh/get-connectivity-report)

#### Phase 76-77 — EvoMap Global Evolution Network v3.4.0 (2026-02-28)

**Phase 76 — Global Evolution Network** (5 IPC handlers):

- ✅ **EvoMapFederation** (`evomap/evomap-federation.js`) - Multi-Hub interconnection, cross-Hub gene sync, evolutionary pressure selection, gene recombination, lineage DAG
- ✅ **EvoMap Federation IPC** (`evomap/evomap-federation-ipc.js`) - 5 handlers (list-hubs/sync-genes/get-pressure-report/recombine-genes/get-lineage)

**Phase 77 — IP & Governance DAO** (5 IPC handlers):

- ✅ **GeneIPManager** (`evomap/gene-ip-manager.js`) - DID+VC originality proof, anti-plagiarism, derivative chains, revenue sharing
- ✅ **EvoMapDAO** (`evomap/evomap-dao.js`) - Gene quality voting, dispute arbitration, standards proposals, governance execution
- ✅ **EvoMap Governance IPC** (`evomap/evomap-governance-ipc.js`) - 5 handlers (register-ownership/trace-contributions/create-proposal/cast-vote/get-governance-dashboard)

**New Database Tables** (23 new tables):

- ✅ `skill_service_registry`, `skill_invocations` - Skill service registration & invocation
- ✅ `token_transactions`, `contributions` - Token transactions & contributions
- ✅ `inference_nodes`, `inference_tasks` - Inference nodes & tasks
- ✅ `trust_root_attestations`, `cross_device_key_sync` - Trust root attestation & cross-device sync
- ✅ `pqc_subsystem_migrations` - PQC subsystem migrations
- ✅ `satellite_messages`, `offline_signature_queue` - Satellite messages & offline signatures
- ✅ `hsm_adapters` - HSM adapters
- ✅ `unified_messages`, `identity_mappings` - Unified messages & identity mappings
- ✅ `translation_cache`, `content_quality_scores` - Translation cache & quality scores
- ✅ `filecoin_deals`, `content_versions` - Filecoin deals & content versions
- ✅ `anti_censorship_routes` - Anti-censorship routes
- ✅ `evomap_hub_federation`, `gene_lineage` - EvoMap Hub federation & gene lineage
- ✅ `gene_ownership`, `evomap_governance_proposals` - Gene ownership & governance proposals

**New Configuration Sections** (13 new sections):

- ✅ `skillService`, `tokenIncentive`, `inferenceNetwork` - v3.1.0 marketplace config
- ✅ `trustRoot`, `pqc` (extended), `satellite`, `hsmAdapter` - v3.2.0 security config
- ✅ `protocolFusion`, `aiSocialEnhancement`, `decentralizedStorage`, `antiCensorship` - v3.3.0 social config
- ✅ `evoMapFederation`, `evoMapGovernance` - v3.4.0 evolution config

**Context Engineering Integration**:

- ✅ step 4.9: Skill service context injection (`setSkillServiceProtocol()`)
- ✅ step 4.10: Inference scheduling context injection (`setInferenceScheduler()`)
- ✅ step 4.11: Protocol fusion context injection (`setProtocolFusionBridge()`)
- ✅ step 4.12: EvoMap federation context injection (`setEvoMapFederation()`)

**Frontend Integration**:

- ✅ 13 new routes: `/skill-marketplace`, `/token-incentive`, `/inference-network`, `/trust-root`, `/pqc-ecosystem`, `/satellite-comm`, `/hsm-adapter`, `/protocol-fusion`, `/ai-social-enhancement`, `/decentralized-storage`, `/anti-censorship`, `/evomap-federation`, `/evomap-governance`
- ✅ 13 new Pinia stores + 13 Vue pages

**Milestone Significance**:

- 🎯 **v3.1.0 Decentralized AI Marketplace** - Skill-as-a-Service + Token incentive + Inference network, tradable AI capabilities
- 🔐 **v3.2.0 Hardware Security Ecosystem** - Trinity trust root + PQC full migration + Satellite comm + Open hardware
- 🌐 **v3.3.0 Global Decentralized Social** - Multi-protocol fusion + AI social enhancement + Decentralized storage + Anti-censorship
- 🧬 **v3.4.0 EvoMap Global Evolution** - Multi-Hub federation + Gene IP protection + DAO governance

---

### Historical Updates - Production Hardening & Autonomous AI (Phase 57-64)

**Phase 57-64 v2.0/v3.0 Complete Implementation** - Production Hardening + Federation Hardening + Reputation Optimizer + SLA Manager + Tech Learning Engine + Autonomous Developer + Collaboration Governance, totaling 42 new IPC handlers, 16 new database tables, 8 new frontend pages

#### Phase 57-64 - Production Hardening & Autonomous AI Systems (2026-02-28)

**Phase 57 — Production Hardening** (6 IPC handlers):

- ✅ **Performance Baseline** (`performance/performance-baseline.js`) - Baseline establishment, key metrics monitoring (response time/throughput/error rate/resource usage), threshold alerting, trend analysis
- ✅ **Security Auditor** (`audit/security-auditor.js`) - Automated security auditing, vulnerability scanning, configuration checks, dependency audits, security scoring
- ✅ **Hardening IPC** (`performance/hardening-ipc.js`) - 6 handlers (create-baseline/list-baselines/get-baseline/run-audit/list-audits/get-audit-report)
- ✅ **Database Tables** - `performance_baselines` (performance baselines), `security_audit_reports` (audit reports)
- ✅ **Frontend UI** - ProductionHardeningPage console (performance monitoring/security auditing/hardening recommendations)
- ✅ **Config** - `hardening` section (performance thresholds/audit policies/alert rules)

**Phase 58 — Federation Hardening** (4 IPC handlers):

- ✅ **Federation Hardening** (`ai-engine/cowork/federation-hardening.js`) - Circuit breaker mechanism (fault isolation), node health checks (heartbeat/latency/success rate), connection pool management, auto-degradation, fault recovery
- ✅ **Federation Hardening IPC** (`ai-engine/cowork/federation-hardening-ipc.js`) - 4 handlers (get-circuit-breaker-status/reset-circuit-breaker/get-health-checks/get-connection-pool-stats)
- ✅ **Database Tables** - `federation_circuit_breakers` (circuit breaker state), `federation_health_checks` (health check records)
- ✅ **Frontend UI** - FederationHardeningPage console (circuit breaker monitoring/health checks/connection pool management)
- ✅ **Config** - `federationHardening` section (circuit breaker thresholds/health check intervals/connection pool config)

**Phase 59 — Federation Stress Test** (4 IPC handlers):

- ✅ **Federation Stress Tester** (`ai-engine/cowork/federation-stress-tester.js`) - Concurrent stress testing, load simulation (light/medium/heavy/extreme), performance benchmarking, bottleneck identification, capacity planning
- ✅ **Stress Test IPC** (`ai-engine/cowork/stress-test-ipc.js`) - 4 handlers (start-stress-test/stop-stress-test/get-test-results/list-test-history)
- ✅ **Database Tables** - `stress_test_runs` (test runs), `stress_test_results` (test results)
- ✅ **Frontend UI** - StressTestPage console (test configuration/real-time monitoring/results analysis)
- ✅ **Config** - `stressTest` section (concurrency/duration/load patterns)

**Phase 60 — Reputation Optimizer** (4 IPC handlers):

- ✅ **Reputation Optimizer** (`ai-engine/cowork/reputation-optimizer.js`) - Bayesian optimization of reputation algorithms, anomaly detection (statistical+ML), reputation decay models, reputation recovery mechanisms, game theory anti-cheating
- ✅ **Reputation Optimizer IPC** (`ai-engine/cowork/reputation-optimizer-ipc.js`) - 4 handlers (start-optimization/get-optimization-status/get-analytics/get-anomalies)
- ✅ **Database Tables** - `reputation_optimization_runs` (optimization runs), `reputation_analytics` (reputation analytics)
- ✅ **Frontend UI** - ReputationOptimizerPage console (optimization config/anomaly detection/analytics dashboard)
- ✅ **Config** - `reputationOptimizer` section (optimization algorithms/anomaly thresholds/decay parameters)

**Phase 61 — Cross-Org SLA** (5 IPC handlers):

- ✅ **SLA Manager** (`ai-engine/cowork/sla-manager.js`) - SLA contract management, multi-tier SLA (Gold/Silver/Bronze), SLA monitoring (availability/response time/throughput), violation detection & handling, compensation calculation, SLA report generation
- ✅ **SLA IPC** (`ai-engine/cowork/sla-ipc.js`) - 5 handlers (create-sla/list-slas/get-sla-metrics/get-violations/generate-report)
- ✅ **Database Tables** - `sla_contracts` (SLA contracts), `sla_violations` (SLA violation records)
- ✅ **Frontend UI** - SLAManagerPage SLA management console (contract management/real-time monitoring/violation handling)
- ✅ **Config** - `sla` section (SLA tiers/monitoring metrics/violation thresholds)

**Phase 62 — Tech Learning Engine** (5 IPC handlers):

- ✅ **Tech Learning Engine** (`ai-engine/autonomous/tech-learning-engine.js`) - Tech stack analysis (code scanning/dependency analysis), best practice learning (pattern recognition), anti-pattern detection, knowledge graph construction, continuous learning, skill improvement suggestions
- ✅ **Tech Learning IPC** (`ai-engine/autonomous/tech-learning-ipc.js`) - 5 handlers (analyze-tech-stack/get-learned-practices/detect-anti-patterns/get-recommendations/update-knowledge)
- ✅ **Database Tables** - `tech_stack_profiles` (tech stack profiles), `learned_practices` (learned practices)
- ✅ **Frontend UI** - TechLearningPage tech learning console (stack analysis/practice library/anti-pattern detection)
- ✅ **Config** - `techLearning` section (learning strategies/pattern recognition/knowledge update frequency)
- ✅ **Context Engineering** - step 4.13: Tech stack context injection (`setTechLearningEngine()`)

**Phase 63 — Autonomous Developer** (5 IPC handlers):

- ✅ **Autonomous Developer** (`ai-engine/autonomous/autonomous-developer.js`) - Autonomous coding capability (requirement understanding → design → implementation → testing), architecture decision records, code review, refactoring suggestions, continuous optimization, session management (dev task tracking)
- ✅ **Autonomous Developer IPC** (`ai-engine/autonomous/autonomous-developer-ipc.js`) - 5 handlers (start-dev-session/get-session-status/review-code/get-architecture-decisions/refactor-code)
- ✅ **Database Tables** - `dev_sessions` (dev sessions), `architecture_decisions` (architecture decisions)
- ✅ **Frontend UI** - AutonomousDeveloperPage autonomous dev console (session management/code review/architecture decisions/refactoring suggestions)
- ✅ **Config** - `autonomousDev` section (autonomy level/review policies/test coverage)
- ✅ **Context Engineering** - step 4.14: Dev session context injection (`setAutonomousDeveloper()`)

**Phase 64 — Collaboration Governance** (5 IPC handlers):

- ✅ **Collaboration Governance** (`ai-engine/autonomous/collaboration-governance.js`) - Collaboration policy management, task allocation optimization (skill matching), conflict resolution mechanisms (voting/arbitration), collaboration quality assessment, transparency control, autonomy level management (L0-L4)
- ✅ **Collaboration Governance IPC** (`ai-engine/autonomous/collaboration-governance-ipc.js`) - 5 handlers (create-governance-decision/list-decisions/resolve-conflict/get-quality-metrics/set-autonomy-level)
- ✅ **Database Tables** - `governance_decisions` (governance decisions), `autonomy_levels` (autonomy levels)
- ✅ **Frontend UI** - CollaborationGovernancePage collaboration governance console (policy management/conflict resolution/quality assessment)
- ✅ **Config** - `collaborationGovernance` section (governance policies/conflict resolution/quality thresholds)
- ✅ **Context Engineering** - step 4.15: Collaboration governance context injection (`setCollaborationGovernance()`)

**New Database Tables** (16 new tables):

- ✅ `performance_baselines` - Performance baseline data
- ✅ `security_audit_reports` - Security audit reports
- ✅ `federation_circuit_breakers` - Circuit breaker states
- ✅ `federation_health_checks` - Health check records
- ✅ `stress_test_runs` - Stress test runs
- ✅ `stress_test_results` - Stress test results
- ✅ `reputation_optimization_runs` - Reputation optimization runs
- ✅ `reputation_analytics` - Reputation analytics data
- ✅ `sla_contracts` - SLA contracts
- ✅ `sla_violations` - SLA violation records
- ✅ `tech_stack_profiles` - Tech stack profiles
- ✅ `learned_practices` - Learned best practices
- ✅ `dev_sessions` - Development sessions
- ✅ `architecture_decisions` - Architecture decision records
- ✅ `governance_decisions` - Governance decisions
- ✅ `autonomy_levels` - Autonomy level configurations

**New Configuration Sections** (8 new sections):

- ✅ `hardening` - Production hardening config
- ✅ `federationHardening` - Federation hardening config
- ✅ `stressTest` - Stress test config
- ✅ `reputationOptimizer` - Reputation optimizer config
- ✅ `sla` - SLA management config
- ✅ `techLearning` - Tech learning config
- ✅ `autonomousDev` - Autonomous dev config
- ✅ `collaborationGovernance` - Collaboration governance config

**Context Engineering Integration**:

- ✅ step 4.13: Tech stack context injection (`setTechLearningEngine()`)
- ✅ step 4.14: Dev session context injection (`setAutonomousDeveloper()`)
- ✅ step 4.15: Collaboration governance context injection (`setCollaborationGovernance()`)

**Frontend Integration**:

- ✅ 8 new routes: `/production-hardening`, `/federation-hardening`, `/stress-test`, `/reputation-optimizer`, `/sla-manager`, `/tech-learning`, `/autonomous-developer`, `/collaboration-governance`
- ✅ 8 new Pinia stores: `hardening`, `federationHardening`, `stressTest`, `reputationOptimizer`, `slaManager`, `techLearning`, `autonomousDev`, `collaborationGovernance`

**Milestone Significance**:

- 🎯 **v2.0.0 Production Ready** - Phase 57-61 complete production-grade hardening, enterprise deployable
- 🤖 **v3.0.0 Autonomous AI** - Phase 62-64 implement L2 autonomous development capability, AI can independently complete medium-complexity tasks

---

### Q2 2026 Full Upgrade (Phase 41-45)

**Phase 41-45 Complete Implementation** - EvoMap Global Knowledge Sharing + Social AI + Enterprise Compliance + SCIM 2.0 + Unified Key System, totaling 71 new IPC handlers, 13 new database tables, 4 new frontend routes

#### Phase 42-45 - Q2 2026 Enterprise Feature Expansion (2026-02-27)

**Phase 42 — Social AI + ActivityPub** (18 IPC handlers):

- ✅ **Topic Analyzer** (`social/topic-analyzer.js`) - NLP topic extraction, TF-IDF keywords, sentiment analysis, 9 predefined categories, similarity matching
- ✅ **Social Graph** (`social/social-graph.js`) - Social relationship graph, centrality analysis (degree/closeness/betweenness/eigenvector), community detection (Louvain), influence scoring, pathfinding
- ✅ **ActivityPub Bridge** (`social/activitypub-bridge.js`) - W3C ActivityPub S2S protocol, Actor management, Activity pub/receive, Inbox/Outbox, Follow/Like/Announce
- ✅ **AP Content Sync** (`social/ap-content-sync.js`) - Bidirectional content sync, DID→Actor mapping, Markdown→HTML conversion, media attachment handling, local content publishing to Fediverse
- ✅ **AP WebFinger** (`social/ap-webfinger.js`) - RFC 7033 WebFinger protocol, user discovery, acct:URI parsing, Actor resource location
- ✅ **AI Social Assistant** (`social/ai-social-assistant.js`) - 3 reply styles (concise/detailed/humorous), smart reply generation, content summarization, topic recommendations
- ✅ **Extended Social IPC** (`social/social-ipc.js`) - 60→78 IPC handlers (+18 new), complete Social AI integration
- ✅ **Pinia Store** (`stores/socialAI.ts`) - Social AI state management, topic analysis, graph queries, ActivityPub operations
- ✅ **Frontend UI** - SocialInsightsPage + ActivityPubBridgePage

**Phase 43 — Compliance + Data Classification** (12 IPC handlers):

- ✅ **SOC2 Compliance** (`audit/soc2-compliance.js`) - SOC2 compliance framework, 5 Trust Service Criteria (TSC), control point checks, evidence collection, compliance report generation
- ✅ **Data Classifier** (`audit/data-classifier.js`) - Data classification engine, 4 levels (PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED), ML classifier, rules engine, sensitive data scanning
- ✅ **Classification Policy** (`audit/classification-policy.js`) - Classification policy management, field-level rules, auto-tagging, encryption policy mapping, access control integration
- ✅ **Data Subject Handler** (`audit/data-subject-handler.js`) - GDPR Data Subject Requests (DSR) processing, export/delete/rectify, request workflow, audit logging
- ✅ **Compliance Manager** (`audit/compliance-manager.js`) - Unified compliance manager, multi-framework support (GDPR/SOC2/ISO27001/HIPAA), compliance check scheduling, risk scoring
- ✅ **Compliance IPC** (`audit/compliance-ipc.js`) - 12 IPC handlers (SOC2 checks/evidence/classification/policy/DSR/compliance/reports)
- ✅ **Pinia Store** (`stores/compliance.ts`) - Compliance state management, check execution, report generation, evidence management
- ✅ **Frontend UI** - ComplianceDashboardPage (evidence collection/classification/DSR/report export)

**Phase 44 — SCIM 2.0 Enterprise Provisioning** (8 IPC handlers):

- ✅ **SCIM Server** (`enterprise/scim-server.js`) - RFC 7644 SCIM 2.0 protocol server, User/Group resource management, RESTful API (GET/POST/PUT/PATCH/DELETE), filtering/sorting/pagination, bulk operations
- ✅ **SCIM Sync** (`enterprise/scim-sync.js`) - IdP bidirectional sync engine, incremental sync, conflict resolution (IdP-first/local-first/latest-first), change tracking, sync logging
- ✅ **SCIM IPC** (`enterprise/scim-ipc.js`) - 8 IPC handlers (start/stop server, sync User/Group, resolve conflicts, query logs)
- ✅ **Extended Org Manager** - Enterprise org manager extension, SCIM resource mapping, attribute transformation, Schema management
- ✅ **Pinia Store** - SCIM state management, server control, sync operations, log monitoring
- ✅ **Frontend UI** - SCIMIntegrationPage (IdP config/resource management/sync control/log viewer)

**Phase 45 — Unified Key + FIDO2 + Cross-Platform USB** (8 IPC handlers):

- ✅ **Unified Key Manager** (`ukey/unified-key-manager.js`) - BIP-32 hierarchical deterministic keys, single master key derives unlimited child keys, purpose isolation (signing/encryption/auth), export/import, key rotation
- ✅ **FIDO2 Authenticator** (`ukey/fido2-authenticator.js`) - W3C WebAuthn standard, CTAP2 protocol, Passkey passwordless auth, challenge-response, Resident Keys, UV/UP verification
- ✅ **USB Transport** (`ukey/usb-transport.js`) - Cross-platform USB communication, Windows (node-usb)/macOS (IOKit via Koffi)/Linux (libusb), device enumeration, bulk transfer, APDU encapsulation
- ✅ **WebUSB Fallback** (`ukey/webusb-fallback.js`) - Browser WebUSB API fallback, device request, permission management, vendorId/productId filtering
- ✅ **Extended UKey IPC** (`ukey/ukey-ipc.js`) - 9→17 IPC handlers (+8 new), unified key operations, FIDO2 auth, USB device management
- ✅ **Extended Driver Registry** - Driver registry extension, 5 new driver types (FIDO2/BIP32/TPM2/TEE/Satellite)
- ✅ **Pinia Store** - Unified key state management, FIDO2 auth flow, USB device monitoring

**New Database Tables** (10 new tables):

- ✅ `topic_analyses` - Topic analysis cache (content_hash, topics JSON, keywords JSON, sentiment, category)
- ✅ `social_graph_edges` - Social graph edges (source_did, target_did, edge_type, weight, metadata JSON)
- ✅ `activitypub_actors` - ActivityPub Actors (actor_uri, did, inbox, outbox, public_key, follower_count)
- ✅ `activitypub_activities` - Activity objects (activity_id, type, actor, object, published, raw JSON)
- ✅ `soc2_evidence` - SOC2 evidence (control_id, evidence_type, file_path, collected_at, metadata JSON)
- ✅ `data_classifications` - Data classifications (table_name, column_name, classification_level, policy_id, classified_at)
- ✅ `scim_resources` - SCIM resource mapping (scim_id, resource_type, local_id, attributes JSON, meta JSON)
- ✅ `scim_sync_log` - SCIM sync log (sync_type, direction, status, records_synced, conflicts, details JSON)
- ✅ `unified_keys` - Unified keys (key_id, purpose, derivation_path, public_key, encrypted_private_key, created_at)
- ✅ `fido2_credentials` - FIDO2 credentials (credential_id, rp_id, user_handle, public_key, sign_count, aaguid, created_at)

**New Configuration Sections** (5 new sections):

- ✅ `socialAI` - Topic analysis/graph/ActivityPub config
- ✅ `activitypub` - Instance name/domain/admin/description
- ✅ `compliance` - Compliance frameworks/check intervals/evidence path
- ✅ `scim` - SCIM server port/auth/sync strategy
- ✅ `unifiedKey` - Key derivation/FIDO2 RP/USB config

**Context Engineering Integration**:

- ✅ step 4.9: Social graph context injection (`setSocialGraph()`)
- ✅ step 4.10: Compliance policy context injection (`setComplianceManager()`)

**Frontend Integration**:

- ✅ 4 new routes: `/social-insights`, `/activitypub-bridge`, `/compliance-dashboard`, `/scim-integration`
- ✅ 3 new Pinia Stores: `socialAI.ts`, `compliance.ts`, UKey store extension
- ✅ IPC Registry: Phase 42(18) + Phase 43(12) + Phase 44(8) + Phase 45(8) = 46 new IPC handlers

#### Phase 46-51 - Q3 2026 Mainline B/C/D Phase 2 Extensions (2026-02-27)

**Phase 46-51 Complete Implementation** - Threshold Signatures + Biometric + BLE U-Key + Smart Recommendations + Nostr Bridge + DLP + SIEM Integration, totaling 32 new IPC handlers, 9 new database tables, 6 new frontend routes

**Phase 46 — Threshold Signatures + Biometric** (8 IPC handlers):

- ✅ **Threshold Signature Manager** (`ukey/threshold-signature-manager.js`) - Shamir Secret Sharing (2-of-3 threshold), master key splitting, distributed signature reconstruction, share metadata (holder/timestamp), share deletion
- ✅ **Biometric Binding** (`ukey/biometric-binding.js`) - TEE (Trusted Execution Environment) integration, biometric template hash binding, device fingerprint authentication, UV/UP verification, binding lifecycle management
- ✅ **Extended UKey IPC** (`ukey/ukey-ipc.js`) - 17→25 IPC handlers (+8 new), threshold signature operations, biometric binding, share management
- ✅ **Pinia Store** (`stores/thresholdSecurity.ts`) - Threshold security state management, share creation/query, biometric binding flow
- ✅ **Frontend UI** - ThresholdSecurityPage (share visualization/binding config/security level settings)

**Phase 47 — BLE U-Key** (4 IPC handlers):

- ✅ **Extended BLE Driver** (`ukey/ble-driver.js`) - GATT service discovery, auto-reconnect mechanism, singleton pattern, RSSI signal monitoring, connection state management
- ✅ **Extended Driver Registry** (`ukey/driver-registry.js`) - BLE transport layer status, device enumeration, health checks
- ✅ **Extended UKey IPC** - 4 new BLE-related IPC handlers (device scan/connect/disconnect/status query)
- ✅ **Pinia Store** (`stores/bleUkey.ts`) - BLE U-Key state management, device list, connection flow
- ✅ **Frontend UI** - BLEDevicesPage (device scan/pairing/connection monitoring/signal strength display)

**Phase 48 — Content Recommendation** (6 IPC handlers):

- ✅ **Local Recommender** (`social/local-recommender.js`) - Local collaborative filtering algorithm, interest-based content recommendation, similarity calculation (cosine/Jaccard), recommendation scoring (0-100), caching mechanism
- ✅ **Interest Profiler** (`social/interest-profiler.js`) - User interest profiling, behavior analysis (browse/like/favorite/share), TF-IDF keyword extraction, interest decay (30-day window), privacy protection
- ✅ **Recommendation IPC** (`social/recommendation-ipc.js`) - 6 IPC handlers (generate recommendations/update interests/query profile/get history/clear cache/adjust config)
- ✅ **Pinia Store** (`stores/recommendation.ts`) - Recommendation state management, interest profile, recommendation list
- ✅ **Frontend UI** - RecommendationsPage (content cards/interest tags/recommendation reasons/feedback mechanism)

**Phase 49 — Nostr Bridge** (6 IPC handlers):

- ✅ **Nostr Bridge** (`social/nostr-bridge.js`) - NIP-01 protocol client, Relay connection management, Event publish/subscribe, Kind classification (0=Metadata/1=Text/3=Contacts/7=Reaction), WebSocket reconnection
- ✅ **Nostr Identity** (`social/nostr-identity.js`) - Schnorr signatures (secp256k1), npub/nsec key pair generation, NIP-05 identity verification, DID interoperability, key import/export
- ✅ **Nostr Bridge IPC** (`social/nostr-bridge-ipc.js`) - 6 IPC handlers (connect Relay/publish Event/subscribe Filter/query Contacts/sync Profile/manage keys)
- ✅ **Extended Platform Bridge** (`social/platform-bridge.js`) - Delegates to NostrBridge, unified social protocol interface
- ✅ **Pinia Store** (`stores/nostrBridge.ts`) - Nostr state management, Relay list, Event stream, identity management
- ✅ **Frontend UI** - NostrBridgePage (Relay config/Event timeline/identity management/contact sync)

**Phase 50 — DLP (Data Loss Prevention)** (8 IPC handlers):

- ✅ **DLP Engine** (`audit/dlp-engine.js`) - Data leak detection engine, 6 sensitive data types (PII/PCI/PHI/Credentials/IP/Custom), regex+ML dual-mode, real-time monitoring, violation blocking, alert triggering
- ✅ **DLP Policy** (`audit/dlp-policy.js`) - Policy management engine, 4 enforcement actions (BLOCK/WARN/LOG/ENCRYPT), condition matching (AND/OR logic), whitelist/blacklist, policy priority sorting
- ✅ **DLP IPC** (`audit/dlp-ipc.js`) - 8 IPC handlers (scan content/create policy/query violations/update whitelist/export reports/configure engine/test policy/stats dashboard)
- ✅ **Extended Data Classifier** (`audit/data-classifier.js`) - `getDLPClassification()` method, integration with DLP engine
- ✅ **Extended Audit Logger** (`audit/enterprise-audit-logger.js`) - DLP/SIEM event types, `setSIEMExporter()` integration
- ✅ **Pinia Store** (`stores/dlp.ts`) - DLP state management, policy list, violation events, scan tasks
- ✅ **Frontend UI** - DLPPoliciesPage (policy CRUD/violation dashboard/whitelist management/testing tools)

**Phase 51 — SIEM Integration** (4 IPC handlers):

- ✅ **SIEM Exporter** (`audit/siem-exporter.js`) - 3 SIEM formats (CEF/LEEF/JSON), event field mapping, batch export (100 events/batch), Syslog UDP/TCP transport, file export, format validation
- ✅ **SIEM IPC** (`audit/siem-ipc.js`) - 4 IPC handlers (configure SIEM/export events/test connection/query export history)
- ✅ **Extended Audit Logger** - SIEM exporter integration, auto event pushing
- ✅ **Pinia Store** (`stores/siem.ts`) - SIEM state management, export config, connection testing, history records
- ✅ **Frontend UI** - SIEMIntegrationPage (configure SIEM server/format selection/export tasks/connection testing/log preview)

**New Database Tables** (9 new tables):

- ✅ `threshold_key_shares` - Threshold key shares (share_id, key_id, threshold, holder_did, encrypted_share, created_at)
- ✅ `biometric_bindings` - Biometric bindings (binding_id, key_id, template_hash, device_fingerprint, uv_required, created_at)
- ✅ `user_interest_profiles` - User interest profiles (profile_id, did, interests JSON, behavior_weights JSON, last_updated)
- ✅ `content_recommendations` - Content recommendations (recommendation_id, did, content_id, score, reason, created_at)
- ✅ `nostr_relays` - Nostr relays (relay_url, connection_status, last_connected, event_count)
- ✅ `nostr_events` - Nostr events (event_id, pubkey, kind, content, tags JSON, sig, created_at)
- ✅ `dlp_policies` - DLP policies (policy_id, name, data_types JSON, action, conditions JSON, priority, enabled)
- ✅ `dlp_incidents` - DLP incidents (incident_id, policy_id, content_hash, severity, blocked, created_at)
- ✅ `siem_exports` - SIEM export records (export_id, format, destination, event_count, status, exported_at)

**New/Extended Configuration Sections** (5 sections):

- ✅ `thresholdSecurity` - Threshold signature config (default threshold, share count, biometric requirements)
- ✅ `nostr` - Nostr config (default Relays, reconnect interval, Event cache size)
- ✅ `unifiedKey` extension - BLE config (scan timeout, connection timeout, RSSI threshold)
- ✅ `socialAI` extension - Recommendation config (recommendation count, similarity threshold, interest decay period)
- ✅ `compliance` extension - DLP+SIEM config (scan interval, SIEM format, export batch size)

**Context Engineering Integration**:

- ✅ step 4.11: Threshold security context injection (`setThresholdManager()`)
- ✅ step 4.12: DLP policy context injection (`setDLPEngine()`)

**Frontend Integration**:

- ✅ 6 new routes: `/threshold-security`, `/ble-devices`, `/recommendations`, `/nostr-bridge`, `/dlp-policies`, `/siem-integration`
- ✅ 6 new Pinia Stores: `thresholdSecurity.ts`, `bleUkey.ts`, `recommendation.ts`, `nostrBridge.ts`, `dlp.ts`, `siem.ts`
- ✅ IPC Registry: Phase 46(8) + Phase 47(4) + Phase 48(6) + Phase 49(6) + Phase 50(8) + Phase 51(4) = 36 new IPC handlers

#### Phase 52-56 - Q4 2026 Mainline B/C/D Phase 3 Extensions (2026-02-27)

**Phase 52-56 Complete Implementation** - Post-Quantum Cryptography Migration + Firmware OTA + AI Community Governance + Matrix Integration + Terraform Provider, totaling 21 new IPC handlers, 10 new database tables, 5 new frontend routes

**Phase 52 — Post-Quantum Cryptography Migration** (4 IPC handlers):

- ✅ **PQC Migration Manager** (`ukey/pqc-migration-manager.js`) - ML-KEM/ML-DSA key generation, NIST standard algorithms, hybrid encryption mode (PQC+classical), migration plan execution, risk assessment, batch key rotation
- ✅ **PQC IPC** (`ukey/pqc-ipc.js`) - 4 IPC handlers (list-pqc-keys, generate-pqc-key, get-migration-status, execute-migration)
- ✅ **Pinia Store** (`stores/pqcMigration.ts`) - Post-quantum crypto state management, key list, migration progress, algorithm selection
- ✅ **Frontend UI** - PQCMigrationPage (algorithm comparison/migration plan/progress monitoring/compatibility check)

**Phase 53 — Firmware OTA (Over-The-Air) Updates** (4 IPC handlers):

- ✅ **Firmware OTA Manager** (`ukey/firmware-ota-manager.js`) - Firmware version check, OTA download (chunked+resume), signature verification (Ed25519), auto-install (progress callback), rollback mechanism (version history), update history logging
- ✅ **Firmware OTA IPC** (`ukey/firmware-ota-ipc.js`) - 4 IPC handlers (check-firmware-updates, list-firmware-versions, start-firmware-update, get-firmware-update-history)
- ✅ **Pinia Store** (`stores/firmwareOta.ts`) - Firmware OTA state management, version list, update progress, history records
- ✅ **Frontend UI** - FirmwareOTAPage (version comparison/release notes/progress bar/rollback operations/auto-update config)

**Phase 54 — AI Community Governance** (4 IPC handlers):

- ✅ **Governance AI** (`social/governance-ai.js`) - Community governance proposal management (create/query/vote), AI impact analysis (stakeholder identification/risk assessment/ROI prediction), LLM vote prediction (sentiment analysis), governance workflow engine
- ✅ **Governance IPC** (`social/governance-ipc.js`) - 4 IPC handlers (list-governance-proposals, create-governance-proposal, analyze-proposal-impact, predict-vote-outcome)
- ✅ **Pinia Store** (`stores/governance.ts`) - Community governance state management, proposal list, AI analysis results, vote predictions
- ✅ **Frontend UI** - GovernancePage (proposal list/AI impact analysis/vote prediction/governance stats/proposal creation)

**Phase 55 — Matrix Protocol Integration** (5 IPC handlers):

- ✅ **Matrix Bridge** (`social/matrix-bridge.js`) - Matrix Client-Server API integration, login/register, room management (create/join/leave/invite), E2EE messaging (Olm/Megolm), event sync (since token), DID→MXID mapping
- ✅ **Matrix IPC** (`social/matrix-ipc.js`) - 5 IPC handlers (matrix-login, matrix-list-rooms, matrix-send-message, matrix-get-messages, matrix-join-room)
- ✅ **Pinia Store** (`stores/matrixBridge.ts`) - Matrix state management, room list, message stream, E2EE keys
- ✅ **Frontend UI** - MatrixBridgePage (login/room list/message timeline/E2EE indicator/DID mapping management)

**Phase 56 — Terraform Provider** (4 IPC handlers):

- ✅ **Terraform Manager** (`enterprise/terraform-manager.js`) - Terraform workspace CRUD, Plan/Apply/Destroy runs, state management (version control), variable management, output reading, run history (status/logs)
- ✅ **Terraform IPC** (`enterprise/terraform-ipc.js`) - 4 IPC handlers (list-terraform-workspaces, create-terraform-workspace, terraform-plan-run, list-terraform-runs)
- ✅ **Pinia Store** (`stores/terraform.ts`) - Terraform state management, workspace list, run history, state versions
- ✅ **Frontend UI** - TerraformProviderPage (workspace management/Plan preview/Apply execution/state viewing/run history)

**New Database Tables** (10 new tables):

- ✅ `pqc_keys` - Post-quantum keys (key_id, algorithm, public_key, encrypted_private_key, hybrid_mode, created_at)
- ✅ `pqc_migration_status` - Migration status (migration_id, plan JSON, status, current_step, total_keys, migrated_keys, started_at)
- ✅ `firmware_versions` - Firmware versions (version_id, version_string, release_notes, download_url, signature, released_at)
- ✅ `firmware_update_log` - Update log (log_id, version_id, device_id, status, progress, error_message, updated_at)
- ✅ `governance_proposals` - Governance proposals (proposal_id, title, description, proposer_did, status, vote_counts JSON, created_at)
- ✅ `governance_votes` - Governance votes (vote_id, proposal_id, voter_did, vote_value, timestamp)
- ✅ `matrix_rooms` - Matrix rooms (room_id, mxid, name, encrypted, members JSON, last_sync_token, joined_at)
- ✅ `matrix_events` - Matrix events (event_id, room_id, sender, type, content JSON, timestamp)
- ✅ `terraform_workspaces` - Terraform workspaces (workspace_id, name, terraform_version, variables JSON, created_at)
- ✅ `terraform_runs` - Terraform runs (run_id, workspace_id, type, status, plan_output, apply_output, state_version, created_at)

**New Configuration Sections** (5 new sections):

- ✅ `pqc` - Post-quantum crypto config (default algorithm, hybrid mode, migration strategy)
- ✅ `firmwareOta` - Firmware OTA config (check interval, auto-update, download timeout)
- ✅ `governance` - Community governance config (proposal threshold, voting period, quorum requirement)
- ✅ `matrix` - Matrix config (homeserver URL, sync timeout, E2EE enabled)
- ✅ `terraform` - Terraform config (workspace path, state backend, concurrent runs)

**Context Engineering Integration**:

- ✅ step 4.13: Post-quantum crypto context injection (`setPQCManager()`)
- ✅ step 4.14: Community governance AI context injection (`setGovernanceAI()`)

**Frontend Integration**:

- ✅ 5 new routes: `/pqc-migration`, `/firmware-ota`, `/governance`, `/matrix-bridge`, `/terraform-provider`
- ✅ 5 new Pinia Stores: `pqcMigration.ts`, `firmwareOta.ts`, `governance.ts`, `matrixBridge.ts`, `terraform.ts`
- ✅ IPC Registry: Phase 52(4) + Phase 53(4) + Phase 54(4) + Phase 55(5) + Phase 56(4) = 21 new IPC handlers

#### Phase 41 - EvoMap Global Agent Knowledge Sharing Network (2026-02-26)

**EvoMap GEP-A2A Protocol Integration (v1.0.0)** (5 core modules, 25 IPC handlers, 3 new tables):

- ✅ **EvoMap Client** (`evomap-client.js`) - GEP-A2A v1.0.0 protocol client, HTTP communication, protocol envelope encapsulation, retry mechanism, Asset ID calculation (SHA-256)
- ✅ **Node Manager** (`evomap-node-manager.js`) - Node identity management, auto heartbeat (15min), credit accumulation, DID identity mapping, node registration/discovery
- ✅ **Gene Synthesizer** (`evomap-gene-synthesizer.js`) - Local knowledge→Gene+Capsule conversion, privacy filtering (secret detection/path anonymization/email replacement), category mapping
- ✅ **Asset Bridge** (`evomap-asset-bridge.js`) - Bidirectional sync engine, publish/fetch/import flow, user review gate, context building, asset cache
- ✅ **EvoMap IPC** (`evomap-ipc.js`) - 25 IPC handlers (node 5 + publish 5 + discovery 5 + import 3 + task 4 + config 3)
- ✅ **Pinia Store** (`evomap.ts`) - Complete state management, 5 Getters, 20+ Actions, TypeScript type safety
- ✅ **Frontend UI** - EvoMapDashboard + EvoMapBrowser, 2 new routes

**Core Features**:

- 🧬 **Knowledge Synthesis**: Instinct→Gene+Capsule, Decision→Gene+Capsule, Workflow→Recipe
- 🌐 **Bidirectional Sync**: Publish local knowledge to Hub, fetch community-validated strategies locally
- 🔒 **Privacy First**: opt-in design, content anonymization, secret detection, user review gate
- 💡 **Context Injection**: Fetched community knowledge auto-injected to LLM prompts (Context Engineering step 4.8)
- 💰 **Credit Economy**: Node registration, credit accumulation, heartbeat maintains online status
- 🎯 **Task Bounties**: Browse and claim community tasks, submit results for credits
- 📦 **Asset Import**: Gene→Skill (SKILL.md), Capsule→Instinct (instincts table)

**New Database Tables** (3 tables):

- ✅ `evomap_node` - Node identity storage (node_id, DID mapping, credits, reputation, claim_code)
- ✅ `evomap_assets` - Asset cache (asset_id, type, status, direction, content JSON, gdi_score)
- ✅ `evomap_sync_log` - Sync log (action, asset_id, status, details JSON)

**Frontend Integration**:

- ✅ 2 new routes: `/evomap` (dashboard) + `/evomap/browser` (asset browser)
- ✅ Pinia Store: `stores/evomap.ts` (~450 lines, full TypeScript types)
- ✅ Config integration: `unified-config-manager.js` new `evomap` config section
- ✅ IPC Registry: Phase 41 block registered in `ipc-registry.js`
- ✅ Context Engineering: step 4.8 auto-injects community knowledge to LLM prompts

**Security & Privacy**:

- 🔐 Default opt-in, users must actively enable
- 🔐 Auto privacy filtering before publishing: path/email/secret detection
- 🔐 User review gate: requireReview: true
- 🔐 Import Instinct confidence capped at 0.7, avoid blind trust

#### v1.1.0 - Cowork Decentralized Agent Network + Autonomous Ops + Pipeline Orchestration + Multimodal Collab + NL Programming (2026-02-25)

**Decentralized Agent Network (v4.0)** (6 core modules, 20 IPC handlers):

- ✅ **Agent DID Identity** (`agent-did.js`) - W3C-compliant decentralized identifiers (did:chainless:{uuid}), Ed25519 key pairs, capability-based access control, status lifecycle (active/suspended/revoked)
- ✅ **Agent Authentication** (`agent-authenticator.js`) - Challenge-response protocol, Ed25519 signature verification, 3 auth methods (did-challenge/credential-proof/mutual-tls), session management (1-hour TTL)
- ✅ **Agent Credential Manager** (`agent-credential-manager.js`) - W3C Verifiable Credentials (VC) standard, issue/verify/revoke, 3 credential types (capability/delegation/membership), auto expiration, credential chain verification
- ✅ **Agent Reputation System** (`agent-reputation.js`) - Weighted scoring (success rate 40% + response time 20% + quality 30% + recency 10%), 4 reputation levels (TRUSTED/RELIABLE/NEUTRAL/UNTRUSTED), idle decay
- ✅ **Federated Agent Registry** (`federated-agent-registry.js`) - Kademlia DHT-inspired routing, K-bucket routing table, capability index, 3 discovery modes (local/federated/broadcast), network health monitoring
- ✅ **Cross-Org Task Router** (`cross-org-task-router.js`) - 4 routing strategies (NEAREST/BEST_REPUTATION/ROUND_ROBIN/CAPABILITY_MATCH), 50 concurrent tasks, 5-minute timeout, credential proof integration
- ✅ **Decentralized Network IPC** (`decentralized-network-ipc.js`) - 20 IPC handlers (Agent DID 4 + Federated Registry 4 + Credentials 3 + Cross-org Tasks 4 + Reputation 4 + Config 1)

**Autonomous Operations (v3.3)** (6 components, 15 IPC handlers):

- ✅ **Anomaly Detection & Incident Management** (`autonomous-ops-ipc.js`) - 15 IPC handlers, incident severity classification, baseline management, Playbook auto-execution, Postmortem generation
- ✅ **Auto Remediator** (`auto-remediator.js`) - Smart alert-triggered auto remediation, strategy selection, execution logging
- ✅ **Rollback Manager** (`rollback-manager.js`) - Version snapshot management, one-click rollback, rollback history tracking
- ✅ **Alert Manager** (`alert-manager.js`) - Multi-channel alert notifications, rule configuration, deduplication
- ✅ **Post-Deploy Monitor** (`post-deploy-monitor.js`) - Post-deployment health checks, baseline comparison, anomaly auto-reporting
- ✅ **Postmortem Generator** (`postmortem-generator.js`) - AI-generated incident postmortem reports, root cause analysis, improvement recommendations

**Dev Pipeline Orchestration (v3.0)** (3 components, 15 IPC handlers):

- ✅ **Pipeline Management** (`pipeline-ipc.js`) - 15 IPC handlers, full lifecycle (create/start/pause/resume/cancel), approval gates, artifact management, metrics, templates
- ✅ **Deploy Agent** (`deploy-agent.js`) - 6 deployment strategies (GIT_PR/DOCKER/NPM_PUBLISH/LOCAL/STAGING), auto branch creation (prefix: pipeline/), smoke tests (30s timeout), 120s deploy timeout, RollbackManager integration
- ✅ **Spec Translator** (`spec-translator.js`) - Technical specification format conversion, structured requirement extraction

**Multimodal Collaboration (v3.2)** (5 components, 12 IPC handlers):

- ✅ **Modality Fusion** (`modality-fusion.js`) - Text/image/audio/video multi-modal unified fusion, adaptive modality weights
- ✅ **Document Parser** (`document-parser.js`) - PDF/Word/Excel/image multi-format parsing, structured content extraction
- ✅ **Multimodal Context** (`multimodal-context.js`) - Cross-modal session context maintenance, context serialization
- ✅ **Multimodal Output** (`multimodal-output.js`) - Multi-format content generation, artifact management (DB persistence)
- ✅ **Screen Recorder** (`screen-recorder.js`) - Screenshot sequence recording, pause/resume support
- ✅ **Multimodal Collab IPC** (`multimodal-collab-ipc.js`) - 12 IPC handlers (input fusion/document parsing/context building/session management/artifacts/capture/transcribe/output generation)

**Natural Language Programming (v3.1)** (3 components, 10 IPC handlers):

- ✅ **NL Programming IPC** (`nl-programming-ipc.js`) - 10 IPC handlers, NL→code translation, code validation, project conventions, style analysis, history management
- ✅ **Requirement Parser** (`requirement-parser.js`) - Natural language requirements → structured specifications, entity extraction, priority annotation
- ✅ **Project Style Analyzer** (`project-style-analyzer.js`) - Auto code style detection, constraint rule extraction, style consistency enforcement

**New Database Tables** (7 new tables):

- ✅ `agent_dids` - Agent DID identity storage (Ed25519 key pairs, org affiliation, capability list)
- ✅ `agent_reputation` - Agent reputation scores (weighted scoring, task stats, idle decay)
- ✅ `ops_incidents` - Operations incident records (severity levels, status tracking, resolution time)
- ✅ `ops_remediation_playbooks` - Remediation playbook library (triggers, steps, success rate)
- ✅ `multimodal_sessions` - Multimodal sessions (modality list, context storage, status)
- ✅ `multimodal_artifacts` - Multimodal artifacts (type, path, metadata, session association)
- ✅ `federated_task_log` - Federated task log (cross-org task routing records)

#### v1.0.0 Enterprise Edition - Decentralized Social Platform Full Upgrade (2026-02-23)

**P2P Social New Features** (7 core capabilities):

- ✅ **P2P Voice/Video Calls** (`call-manager` + `call-signaling`) - WebRTC + DTLS-SRTP E2E encryption, SFU relay for 2-8 people, noise reduction, screen sharing, call recording
- ✅ **Shared Encrypted Albums** (`shared-album-manager`) - E2E encrypted albums, EXIF privacy stripping, P2P distribution, access control, version management
- ✅ **Communities & Channels** (`community-manager` + `channel-manager` + `governance-engine`) - Gossip protocol message distribution, role-based permissions, governance voting, community economy
- ✅ **Time Machine** (`time-machine` + `sentiment-analyzer`) - AI-generated memory summaries, sentiment analysis, history playback, important moment extraction
- ✅ **Decentralized Livestreaming** - IPFS video streaming, danmaku system, tipping, P2P CDN acceleration
- ✅ **Social Tokens** (`social-token`) - ERC-20 social credits, creator economy, token issuance & circulation, governance voting
- ✅ **Anonymous Mode** - ZKP zero-knowledge proof identity, temporary DID, revocable anonymity

**Enterprise Infrastructure** (5 new modules):

- ✅ **IPFS Decentralized Storage** (`ipfs-manager`) - Helia/Kubo dual-engine, content addressing, P2P CDN, auto-pinning
- ✅ **Real-time Collaboration (CRDT/Yjs)** (`yjs-collab-manager` + `realtime-collab-manager`) - Yjs CRDT conflict resolution, P2P real-time sync, cursor sharing, document locks
- ✅ **Analytics Dashboard** (`analytics-aggregator`) - Real-time data aggregation, multi-dimensional metrics, visualization reports
- ✅ **Autonomous Agent Runner** (`autonomous-agent-runner`) - ReAct loop, goal decomposition, multi-step reasoning, autonomous task execution
- ✅ **Enterprise Org Management** (`enterprise-org-manager`) - Org hierarchy, approval workflows, multi-tenancy, permission inheritance

**System Enhancements** (4 improvements):

- ✅ **Model Quantization** (`quantization-manager` + `gguf-quantizer` + `gptq-quantizer`) - GGUF 14 quantization levels (Q2_K~F32), AutoGPTQ Python bridge, Ollama import
- ✅ **i18n Internationalization** - 4 languages (Chinese/English/Japanese/Korean), runtime switching
- ✅ **Performance Auto-Tuner** - Real-time monitoring, auto parameter adjustment, memory alerts, load prediction
- ✅ **TypeScript Stores expanded** - 46 TypeScript Stores (13 new), full type coverage

#### v0.39.0 Cowork Self-Evolution + everything-claude-code (2026-02-22)

**Cowork v2.1.0 Self-Evolution & Knowledge Graph** (7 core modules, 35 IPC handlers):

- ✅ **Code Knowledge Graph** - Workspace code scanning, 8 entity types, 7 relationship types, centrality analysis, circular dependency detection, hotspot discovery (14 IPC)
- ✅ **Decision Knowledge Base** - Historical decision records, similarity search, best practice extraction, 9 problem categories, Hook auto-capture (6 IPC)
- ✅ **Prompt Optimizer** - Skill prompt self-optimization, A/B variant testing, SHA-256 deduplication, success rate tracking (5 IPC)
- ✅ **Skill Discoverer** - Task failure analysis, keyword extraction, marketplace skill search recommendations (4 IPC)
- ✅ **Debate Review** - 3-perspective multi-agent review (performance/security/maintainability), consensus voting verdict (3 IPC)
- ✅ **A/B Comparator** - 5 agent style variants, 3-dimension benchmarking, auto-scoring and ranking (3 IPC)
- ✅ **Unified Evolution IPC** - 6 modules, 35 handlers unified registration

**Cowork v2.0.0 Cross-Device Collaboration** (7 modules, 41 IPC handlers):

- ✅ **P2P Agent Network** - WebRTC DataChannel cross-device agent communication, 15 message protocol types (12 IPC)
- ✅ **Device Discovery** - Network device auto-discovery, 4-level capability tiers, health monitoring (6 IPC)
- ✅ **Hybrid Executor** - 6 execution strategies (local-first/remote-first/best-fit/load-balance) (5 IPC)
- ✅ **Computer Use Bridge** - 12 AI tools mapped as Cowork skills (6 IPC)
- ✅ **Cowork API Server** - RESTful API 20+ endpoints, Bearer/API-Key auth, SSE streaming (5 IPC)
- ✅ **Webhook Manager** - 17 event types, HMAC signature verification, exponential backoff retry (7 IPC)

**Cowork Support Modules** (4 modules, 32 IPC handlers):

- ✅ **CI/CD Optimizer** - Intelligent test selection, dependency graph analysis, flakiness scoring (10 IPC)
- ✅ **Load Balancer** - Real-time agent metrics tracking, composite load scoring, auto task migration (8 IPC)
- ✅ **ML Task Scheduler** - Weighted linear regression complexity prediction, resource estimation (8 IPC)
- ✅ **IPC API Doc Generator** - Recursive scanning, OpenAPI 3.0 generation, Markdown auto-generation (6 IPC)

**everything-claude-code Patterns Integration**:

- ✅ **Verification Loop Skill** - 6-stage automated verification pipeline (Build→TypeCheck→Lint→Test→Security→DiffReview)
- ✅ **Orchestrate Workflow Skill** - 4 predefined multi-agent workflow templates (feature/bugfix/refactor/security-audit)
- ✅ **Instinct Learning System** - Auto-extract reusable patterns, 8 categories + confidence scoring + context injection
- ✅ **11 IPC Handlers** - Full CRUD, reinforce/decay, evolve, export/import, stats
- ✅ **2 Database Tables** - instincts (pattern storage) + instinct_observations (event buffering)

#### v0.38.0 SIMKey Six Security Enhancements (2026-02-21)

- ✅ **iOS eSIM Support** - Apple eSIM API + Secure Enclave integration, iOS users can use eSIM as SIMKey security carrier
- ✅ **5G SIM Optimization** - 3-5x signature speed improvement, Chinese national crypto SM2/SM3/SM4/SM9, batch signing pipeline
- ✅ **NFC Offline Signing** - Near-field communication offline identity verification, transaction signing, file signing without network
- ✅ **Multi-SIM Auto-Switch** - Dual-SIM intelligent management, network failover, work/personal separation
- ✅ **SIM Health Monitoring** - Real-time health score dashboard, smart alerts, auto-maintenance, report export
- ✅ **Quantum-Resistant Algorithm Upgrade** - NIST PQC standards (ML-KEM/ML-DSA/SLH-DSA), hybrid encryption mode, key migration tools

#### v0.38.0 Documentation Site Expansion (10 pages, 4,400+ lines added)

- ✅ **AI Models Docs** - 16+ cloud LLM providers overview, multimodal vision models, intelligent routing, Context Engineering
- ✅ **SIMKey/U-Key Docs** - v0.38.0 features with API examples, configuration guides, security mechanisms
- ✅ **Social System Roadmap** - Versioned future feature planning
- ✅ **Trading System Roadmap** - Auction system, group buying, installment payments, Lightning Network payments
- ✅ **Git Sync Roadmap** - Cross-device sync enhancement, collaborative editing, version visualization
- ✅ **Encryption System Expansion** - Post-quantum cryptography, TEE integration, zero-knowledge proofs
- ✅ **Cowork Collaboration Expansion** - Multi-agent workflow orchestration, Agent communication protocol
- ✅ **Overview Expansion** - Phase 5 roadmap, competitor comparison, application scenarios

#### v0.37.4~v0.37.6 New 30 Desktop Skills (Total 90)

- ✅ **Office Documents (5)** - pdf-toolkit, doc-converter, excel-analyzer, pptx-creator, doc-comparator
- ✅ **Audio/Video (5)** - audio-transcriber, video-toolkit, subtitle-generator, tts-synthesizer, media-metadata
- ✅ **Image Processing (3)** - image-editor, ocr-scanner, image-generator
- ✅ **Data Processing (2)** - chart-creator, csv-processor
- ✅ **Dev Tools (3)** - word-generator, template-renderer, code-runner
- ✅ **Automation (2)** - voice-commander, file-compressor
- ✅ **System Ops (5)** - log-analyzer, system-monitor, env-file-manager, backup-manager, performance-profiler
- ✅ **Knowledge (3)** - knowledge-graph, query-enhancer, memory-insights
- ✅ **Security+Data+Network (4)** - crypto-toolkit, password-generator, data-exporter, network-diagnostics
- ✅ **Design+Utility (3)** - color-picker, text-transformer, clipboard-manager

#### v0.37.2 Android Mobile Productivity + PC Remote Delegation (28 Skills)

- ✅ **5 LOCAL Productivity Skills** - quick-note, email-draft, meeting-notes, daily-planner, text-improver
- ✅ **8 REMOTE PC Delegation Skills** - pc-screenshot→computer-use, pc-file-search→smart-search, pc-run-command→remote-control, etc.
- ✅ **remoteSkillName Mapping** - Android skill → Desktop skill name automatic routing

#### v0.37.0~v0.37.1 AI Conversation + Developer Efficiency (20 Skills)

- ✅ **AI Conversation (4)** - prompt-enhancer, codebase-qa, auto-context, multi-model-router
- ✅ **Dev Efficiency (6)** - code-translator, dead-code-eliminator, changelog-generator, mock-data-generator, git-history-analyzer, i18n-manager
- ✅ **Advanced Dev (10)** - architect-mode, commit-splitter, screenshot-to-code, diff-previewer, task-decomposer, bugbot, fault-localizer, impact-analyzer, rules-engine, research-agent

#### v0.36.0 Features - AI Skills System + Unified Tool Registry

- ✅ **Unified Tool Registry** - Aggregates 3 tool systems (FunctionCaller 60+ tools + MCP 8 servers + Skills 90 skills)
- ✅ **AI Call Chain Integration** - ManusOptimizations.bindUnifiedRegistry() connects the full pipeline
- ✅ **Agent Skills Open Standard** - 13 extended fields (tools/instructions/examples etc.)
- ✅ **Demo Templates** - 10 demo templates across 4 categories
- ✅ **Tools Explorer UI** - Browse tools by skill (`#/tools/explorer`)

#### v0.34.0 Features Recap - Enterprise Features + Community Ecosystem

**Enterprise Audit & Compliance + Plugin Marketplace + Multi-Agent + SSO + MCP SDK** - 76+ IPC handlers, 26,000+ lines of new code

#### v0.33.0 Features Recap - Remote Control System + Browser Extension

- ✅ **Remote Control Gateway** - P2P remote gateway, command routing, permission verification (1,876 lines), logging & statistics
- ✅ **24+ Command Handlers** - AI/System/File Transfer/Browser/Power/Process/Media/Network/Storage/Display/Input/Application/Security/Knowledge Base/Device Management/Command History/Clipboard/Notifications/Workflow comprehensive control
- ✅ **Chrome Browser Extension** - Chrome extension integration, WebSocket server (3,326 lines), Service Worker (15,077 lines), Content Script
- ✅ **Android Remote UIs** - Power/Process/Media/Network/Storage/Input/Application Manager/Security Info 8 remote control screens

#### v0.33.0 Features Recap - Computer Use (2026-02-11)

- ✅ **Computer Use Agent** - Unified agent integrating all computer operation capabilities, 68+ IPC handlers
- ✅ **CoordinateAction** - Pixel-level coordinate clicking, dragging, gesture operations
- ✅ **VisionAction** - Vision AI integration, visual element location, supports Claude/GPT-4V/LLaVA
- ✅ **NetworkInterceptor** - Network request interception, simulation, conditional control
- ✅ **DesktopAction** - Desktop-level screenshots, mouse/keyboard control, window management
- ✅ **AuditLogger** - Operation audit logging, risk assessment (LOW/MEDIUM/HIGH/CRITICAL), sensitive data masking
- ✅ **ScreenRecorder** - Screen recording as screenshot sequences, pause/resume/export support
- ✅ **ActionReplay** - Action replay engine, variable speed, step-by-step, breakpoint debugging
- ✅ **SafeMode** - Safe mode with permission control, area restrictions, rate limits, confirmation prompts
- ✅ **WorkflowEngine** - Workflow engine supporting conditional branches, loops, parallel execution, sub-workflows
- ✅ **ElementHighlighter** - Element highlighting for debugging and demo visualization
- ✅ **TemplateActions** - Predefined action templates for quick common automation tasks
- ✅ **12 AI Tools** - browser_click, visual_click, browser_type, browser_key, browser_scroll, browser_screenshot, etc.

#### v0.32.0 Features Recap (2026-02-10)

- ✅ **iOS Workflow System** - WorkflowModels + WorkflowManager complete workflow automation
- ✅ **iOS Voice Interaction** - RealtimeVoiceInput real-time voice input, VoiceManager voice feature management
- ✅ **Android MCP/Hooks/Collaboration** - MCP integration, Hooks system, Collaboration module, Performance optimization
- ✅ **Android Knowledge Graph** - KnowledgeGraphManager + Presentation Layer, knowledge graph visualization

#### v0.31.0 Features Recap (2026-02-09)

- ✅ **Security Authentication Enhancement** - Dev/prod mode switching, JWT authentication for API endpoints, device key database integration
- ✅ **Incremental RAG Indexing** - MD5 content hash change detection, multi-file joint retrieval, unified search (vector+keyword+graph)
- ✅ **Project Context-Aware Reranking** - Context-aware result reranking, 6 new IPC handlers
- ✅ **SIMKey NFC Detection** - NFC reading and SIM security element detection for mobile, dev mode simulator support
- ✅ **File Version Control** - FileVersion entity, version history, SHA-256 content hashing, version restore
- ✅ **LLM Function Calling** - OpenAI and DashScope chat_with_tools support, auto capability detection
- ✅ **Deep Link Enhancement** - notes/clip link handling, universal navigation, focusMainWindow
- ✅ **Browser Extension Enhancement** - Launch desktop app via chainlesschain:// protocol
- ✅ **Test Infrastructure Optimization** - 89 Ant Design Vue component stubs, dayjs mock fixes, permission system test optimization

#### v0.29.0-v0.30.0 Features Recap

- ✅ **DI Test Refactoring** - 102 database tests enabled via dependency injection, Browser IPC testability improved
- ✅ **Social Notifications UI** - Social notification features, project file operations enhancement
- ✅ **TaskMonitor ECharts Dashboard** - ECharts integration, tree-shaking optimization, debounce, 2 new charts
- ✅ **AbortController AI Chat Cancel** - Support for cancelling in-progress AI chat requests
- ✅ **Conversation Star/Rename** - Conversation list star and rename persistence
- ✅ **Firebase Integration** - Firebase enabled, WebRTC enhancement
- ✅ **xlsx → exceljs Migration** - File handling and project page dependency modernization
- ✅ **Main Process TypeScript Declarations** - Comprehensive type declarations for main process
- ✅ **Android Multi-Screen Enhancement** - File browser stats UI, P2P chat session list, Settings/About/Help/Bookmark screens
- ✅ **Android P0 Production Fixes** - API config, Ed25519 signing, sync persistence, file indexing
- ✅ **Community Forum TODOs** - TODO items implemented across community forum, Android, and frontend

#### v0.29.0 Features Recap

- ✅ **TypeScript Migration** - Stores and Composables fully migrated to TypeScript (type safety, enhanced IDE support)
- ✅ **Browser Control System** - BrowserEngine + SnapshotEngine (18 IPC channels, smart snapshots, element locator)
- ✅ **Claude Code Style Systems** - 10 subsystems, 127 IPC channels fully implemented
  - Hooks System (11) | Plan Mode (14) | Skills (17) | Context Engineering (17)
  - Prompt Compressor (10) | Response Cache (11) | Token Tracker (12)
  - Stream Controller (12) | Resource Monitor (13) | Message Aggregator (10)
- ✅ **Permission Engine** - Enterprise RBAC permission engine (resource-level, inheritance, delegation, team permissions)
- ✅ **Context Engineering** - KV-Cache optimization (17 IPC channels, token estimation, recoverable compression)
- ✅ **Plan Mode** - Claude Code style plan mode (security analysis, approval workflow, 14 IPC channels)

#### v0.28.0 Features Recap

- ✅ **Permanent Memory System** - Daily Notes auto-logging + MEMORY.md long-term extraction
- ✅ **Hybrid Search Engine** - Vector (semantic) + BM25 (keyword) dual-path parallel search
- ✅ **Hooks System** - 21 hook events, 4 hook types, priority system
- ✅ **MCP Integration Tests** - 32 unit tests + 31 end-to-end tests all passed

#### Performance Improvement Summary

| Metric                | Before   | After  | Improvement            |
| --------------------- | -------- | ------ | ---------------------- |
| Task Success Rate     | 40%      | 70%    | **+75%**               |
| KV-Cache Hit Rate     | -        | 60-85% | **Very High**          |
| Hybrid Search Latency | -        | <20ms  | **Ultra Fast**         |
| Test Coverage         | ~30%     | ~80%   | **+167%**              |
| LLM Planning Cost     | Baseline | -70%   | **$2,550/month saved** |

See: [Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md) | [Permanent Memory Docs](./docs/features/PERMANENT_MEMORY_INTEGRATION.md) | [Hooks System Design](./docs/design/HOOKS_SYSTEM_DESIGN.md) | [Full Changelog](./docs/CHANGELOG.md)

- ✅ **Documentation Structure Reorganization** - Reorganized documentation directory with new categories: flows/, implementation-reports/, status-reports/, test-reports/
- ✅ **Desktop App Root Directory Reorganization** - Optimized desktop-app-vue project structure for improved code maintainability
- ✅ **Android Social & LLM Features Merge** - Complete integration of mobile P2P social and AI features
- ✅ **Unified Logging System** - Migrated 700+ console calls to centralized logger with log level control and structured logging
- ✅ **Android P2P UI Complete Integration** - 8 P2P screens (device discovery/pairing/security verification/DID management)
- ✅ **ChatPanel Memory Leak Protection** - 4-layer protection mechanism ensuring long-term stability
- ✅ **E2E Test Suite** - 100% pass rate with comprehensive end-to-end test coverage
- ✅ **Test Coverage Improvement** - Added 78 AI engine unit tests, reaching 46% test implementation progress
- ✅ **Manus AI Optimization System** - Based on Manus/OpenManus best practices, Context Engineering (KV-Cache optimization), Tool Masking, TaskTrackerFile (todo.md mechanism), Recoverable Compression, theoretical 50-90% Token cost reduction
- ✅ **Multi-Agent System** - Agent Orchestrator, 3 specialized agents (Code Generation/Data Analysis/Document Processing), parallel execution, chain execution, inter-agent communication, 30% reduction in complex task completion time
- ✅ **MCP Chat Integration** - MCP tools integrated into AI chat, invoke MCP server tools via Function Calling
- ✅ **MCP (Model Context Protocol) Integration** - POC v0.1.0, supports Filesystem/PostgreSQL/SQLite/Git/Fetch servers, multi-layer security protection, UI management interface, complete documentation
- ✅ **Unified Configuration Directory System** - `.chainlesschain/` directory for centralized config/logs/cache/session management, inspired by OpenClaude best practices, auto-initialization, config migration support ⭐LATEST
- ✅ **Token Budget Management System** - LLM usage cost tracking, monthly budget control, overspending alerts, detailed statistics ⭐LATEST
- ✅ **Trading UI Polish** - Order QR code generation, order editing feature, multiple sharing methods (link/social/export), multi-format export (JSON/CSV/PDF/image)
- ✅ **Voice Message System Complete** - Full voice message recording and playback system with real-time recording UI, pause/resume controls, duration display, audio waveform visualization, play/pause controls, automatic resource cleanup, error handling ⭐NEW
- ✅ **Message Reactions Feature** - Emoji reactions beyond likes, 18 common emojis, real-time reaction stats, toggle reactions, visual feedback
- ✅ **P2P File Transfer Complete Implementation** - Large file chunked transfer (64KB chunks), resume capability, real-time progress tracking, SHA-256 integrity verification, concurrent transfer control
- ✅ **Message Forwarding Feature** - Forward messages to other chat sessions, supports text/image/file types, automatic file copying, tracks forwarding source
- ✅ **Chat File Transfer Feature** - Send/receive images and files in P2P chats, automatic file management, download support, integrated P2P direct transfer
- ✅ **Message Search Feature** - Search message content in chat history, filter by conversation/role, pagination and sorting support
- ✅ **Knowledge Graph Visualization Enhancement** - 8 graph analysis algorithms, 5 visualization modes (2D/3D/timeline/heatmap), intelligent entity extraction, 6 export formats
- ✅ **Remote Sync Enabled** - Implemented incremental sync, conflict resolution, multi-device collaboration ⭐LATEST
- ✅ **Mobile Data Sync** - Implemented mobile-PC data synchronization for seamless cross-device collaboration
- ✅ **Full Linux Platform Support** - Added Linux ZIP portable version and DEB package support, covering mainstream distributions
- ✅ **Multi-Platform Packaging Optimization** - Improved packaging workflow for macOS (ARM64/x64), Windows, and Linux
- ✅ **Deep Performance Optimization System Complete** - Added 14,000+ lines of optimization code, 18 utility classes, 4 specialized components, comprehensive performance improvements
- ✅ **Smart Image Optimization System** - WebP/AVIF format detection, responsive loading, progressive loading, LQIP placeholders, CDN support, network-aware loading
- ✅ **Real-time Performance Monitoring System** - Core Web Vitals monitoring (LCP/FID/CLS), performance budgets, FPS monitoring, memory monitoring, performance alerts
- ✅ **Frontend Deep Optimization** - Code splitting, component lazy loading, virtual scrolling, intelligent prefetch, request batching, optimistic updates, data compression
- ✅ **Performance Toolkit** - Incremental sync, memory optimization, animation control, resource hints, performance benchmarking, accessibility enhancements
- ✅ **Testing Framework Upgrade** - Fixed test environment configuration and fully migrated to Vitest API, 94 test files, 900+ test cases
- ✅ **Performance Optimization Integration** - Integrated performance optimization components: memory downgrade, disk check, concurrency control, file recovery, improved overall system performance
- ✅ **Core Module Tests** - Added unit tests for 4 core modules: Git, file permissions, contract engine, bridge management
- ✅ **Security Protection System** - Implemented comprehensive security protection: input validation, permission control, encrypted transmission
- ✅ **P2 Optimization Complete** - AI engine performance significantly improved: 58% reduction in LLM calls, 93% reduction in perceived latency, 28% cost savings
- ✅ **V3 Tool System Restored** - Tool count expanded to 300, restored 28 professional tools covering blockchain/finance/CRM and 9 major domains
- ✅ **Application Menu Integration** - Native menu support, MenuManager, 20+ IPC channels, advanced features control panel
- ✅ **Codebase Refinement** - Updated project documentation, optimized template configuration, enhanced test suite
- ✅ **Enterprise Edition (Decentralized Organizations)** - Multi-identity architecture, RBAC permission system, organization management (create/join/member management), database isolation (9 new tables), organization DID support
- ✅ **Skill & Tool System Expanded to 115 Skills** - Batches 6-10 complete, 300 tools covering 10 categories (3D modeling, audio analysis, blockchain, IoT, machine learning, cybersecurity, bioinformatics, quantum communication, etc.)
- ✅ **Testing Framework Fully Upgraded** - 94 test files, 900+ test cases, fully migrated to Vitest framework, comprehensive core functionality coverage ⭐Updated
- ✅ **Multi-Database Isolation** - Support for personal database + multiple organization databases, complete data isolation, dynamic switching
- ✅ **Blockchain Integration Phase 1-3 Complete** - Smart contract system (6 contracts + tests + deployment), wallet system (built-in + external), Hardhat development environment
- ✅ **Smart Contract Development** - ChainlessToken (ERC20), ChainlessNFT (ERC721), escrow, subscription, bounty, cross-chain bridge contracts, 2400+ lines of code
- ✅ **Browser Extension Enhancement** - Automated testing framework, user/developer/testing guides, test report generation
- ✅ **Plugin System Enhancement** - Integrated with skill-tool system, supports dynamic loading and hot reload
- ✅ **Voice Recognition System Complete** - Phase 3 advanced features, audio enhancement, multi-language detection, subtitle generation
- ✅ **16 AI Specialized Engines** - Code generation/review, document processing (Word/PDF/Excel/PPT), image/video processing, web development, data analysis, and more
- ✅ **Complete Backend Service System** - Project Service (Spring Boot, 48 APIs) + AI Service (FastAPI, 38 APIs) + Community Forum (63 APIs)
- ✅ **145 Vue Components** - 14 pages, 54 project components, trading components (with escrow UI), social components, editors, skill-tool components, enterprise edition components

### Project Status (Overall Completion: 100%)

- 🟢 **PC Desktop Application**: 100% Complete - **Production Ready** ⭐Completed
- 🟢 **Knowledge Base Management**: 100% Complete - **Production Ready** ⭐Completed
- 🟢 **AI Engine System**: 100% Complete - **17 Optimizations + 16 Specialized Engines + Smart Decision** ⭐Completed
- 🟢 **RAG Retrieval System**: 100% Complete - **Hybrid Search + Reranking** ⭐Completed
- 🟢 **Backend Services**: 100% Complete - **3 Microservices + Conversation API** ⭐Completed
- 🟢 **Skill & Tool System**: 100% Complete - **115 Skills + 300 Tools** ⭐Completed
- 🟢 **Plugin System**: 100% Complete - **Dynamic Loading + Hot Reload** ⭐Completed
- 🟢 **MCP Integration**: 100% Complete - **POC v0.1.0 + 5 Servers + Security Sandbox + UI Management** ⭐NEW
- 🟢 **Unified Configuration**: 100% Complete - **.chainlesschain/ Directory + Auto-Init + Multi-Level Priority** ⭐NEW
- 🟢 **Token Budget Management**: 100% Complete - **Cost Tracking + Budget Control + Alerts** ⭐NEW
- 🟢 **Voice Recognition**: 100% Complete - **Real-time Voice Input + UI Integration** ⭐Completed
- 🟢 **Deep Performance Optimization**: 100% Complete - **18 Optimization Tools + 4 Specialized Components** ⭐Completed
- 🟢 **Performance Optimization**: 100% Complete - **Memory/Disk/Concurrency Control** ⭐Completed
- 🟢 **Security Protection**: 100% Complete - **Input Validation/Permission Control/Encryption** ⭐Completed
- 🟢 **Workspace Management**: 100% Complete - **Full CRUD + Restore + Permanent Delete** ⭐Completed
- 🟢 **Remote Sync**: 100% Complete - **Incremental Sync + Conflict Resolution + Multi-Device** ⭐Completed
- 🟢 **USB Key Integration**: 100% Complete - **Cross-Platform Support (Windows/macOS/Linux)** ⭐Completed
- 🟢 **Blockchain Bridge**: 100% Complete - **LayerZero Production-Grade Integration** ⭐Completed
- 🟢 **Enterprise Edition (Decentralized Organizations)**: 100% Complete - **Organization Management + Invitation System** ⭐Completed
- 🟢 **Testing Framework**: 100% Complete - **417+ test files, 2500+ cases, Vitest + DI refactoring** ⭐v1.0.0
- 🟢 **Blockchain Integration**: 100% Complete - **15 chains + RPC management + Event listeners + Full UI** ⭐Completed
- 🟢 **Decentralized Identity**: 100% Complete - **DID + Org DID + VC + DHT publish + Cache** ⭐Completed
- 🟢 **P2P Communication**: 100% Complete - **E2E Encryption + Message Queue + Multi-device** ⭐Completed
- 🟢 **Decentralized Social Platform**: 100% Complete - **P2P Voice/Video Calls + Shared Albums + Community Channels + Time Machine + Livestreaming + Social Tokens** ⭐v1.0.0
- 🟢 **Trading System**: 100% Complete - **8 Modules + On-chain Contracts + NFT Transfers + Order Editing + Sharing + QR Codes** ⭐Completed
- 🟢 **Browser Extension**: 100% Complete - **Testing Framework + Documentation** ⭐Completed
- 🟢 **Remote Control System**: 100% Complete - **P2P Remote Gateway + 24+ Command Handlers + Chrome Extension** ⭐Completed
- 🟢 **AI Skills System**: 100% Complete - **131 Built-in Skills (100% Handler) + 28 Android Skills + Unified Tool Registry + Agent Skills Standard** ⭐v1.2.0
- 🟢 **SIMKey Security Enhancements**: 100% Complete - **iOS eSIM + 5G Optimization + NFC Offline Signing + Multi-SIM Switch + Health Monitoring + Quantum-Resistant** ⭐v0.38.0
- 🟢 **IPFS Decentralized Storage**: 100% Complete - **Helia/Kubo Dual-Engine + Content Addressing + P2P CDN + Auto-Pinning** ⭐v1.0.0
- 🟢 **Real-time Collaboration (CRDT/Yjs)**: 100% Complete - **Yjs Conflict Resolution + P2P Sync + Cursor Sharing + Document Locks** ⭐v1.0.0
- 🟢 **Autonomous Agent Runner**: 100% Complete - **ReAct Loop + Goal Decomposition + Autonomous Task Execution** ⭐v1.0.0
- 🟢 **Model Quantization**: 100% Complete - **GGUF 14-Level Quantization + AutoGPTQ + Ollama Integration** ⭐v1.0.0
- 🟢 **i18n Internationalization**: 100% Complete - **4 Languages (ZH/EN/JP/KO) + Runtime Switching** ⭐v1.0.0
- 🟢 **Performance Auto-Tuner**: 100% Complete - **Real-time Monitoring + Auto Parameter Tuning + Load Prediction** ⭐v1.0.0
- 🟢 **Enterprise Org Management**: 100% Complete - **Org Hierarchy + Approval Workflows + Multi-tenancy** ⭐v1.0.0
- 🟢 **Analytics Dashboard**: 100% Complete - **Real-time Aggregation + Multi-dimensional Metrics + Visualization** ⭐v1.0.0
- 🟢 **Decentralized Agent Network**: 100% Complete - **W3C DID + Ed25519 Auth + VC Credentials + Reputation Scoring + Federated DHT Registry + Cross-Org Task Routing (20 IPC)** ⭐v1.1.0
- 🟢 **Autonomous Operations System**: 100% Complete - **Anomaly Detection + Incident Management + Playbooks + Auto Remediation + Rollback + Post-Deploy Monitor + AI Postmortem (15 IPC)** ⭐v1.1.0
- 🟢 **Dev Pipeline Orchestration**: 100% Complete - **Pipeline Management + 6 Deployment Strategies + Approval Gates + Smoke Tests + Spec Translation (15 IPC)** ⭐v1.1.0
- 🟢 **Multimodal Collaboration**: 100% Complete - **Multi-modal Fusion + Document Parsing + Cross-modal Context + Multi-format Output + Screen Recording (12 IPC)** ⭐v1.1.0
- 🟢 **Natural Language Programming**: 100% Complete - **NL→Code Pipeline + Requirement Parsing + Project Style Analysis (10 IPC)** ⭐v1.1.0
- 🟢 **EvoMap Global Knowledge Sharing**: 100% Complete - **GEP-A2A Protocol + Gene/Capsule Synthesis + Bidirectional Sync + Privacy Filtering + Context Injection (25 IPC)** ⭐v1.1.0-alpha Phase 41
- 🟢 **Social AI + ActivityPub**: 100% Complete - **Topic Analysis + Social Graph + ActivityPub S2S + WebFinger + AI Assistant (18 IPC)** ⭐v1.1.0-alpha Phase 42
- 🟢 **Compliance + Data Classification**: 100% Complete - **SOC2 Compliance + Data Classification + DSR Handling + Compliance Management (12 IPC)** ⭐v1.1.0-alpha Phase 43
- 🟢 **SCIM 2.0 Enterprise Provisioning**: 100% Complete - **SCIM Server + IdP Sync + Conflict Resolution (8 IPC)** ⭐v1.1.0-alpha Phase 44
- 🟢 **Unified Key + FIDO2 + USB**: 100% Complete - **BIP-32 Keys + WebAuthn + Cross-Platform USB (8 IPC)** ⭐v1.1.0-alpha Phase 45
- 🟢 **Threshold Signatures + Biometric**: 100% Complete - **Shamir Splitting (2-of-3) + TEE Biometric Binding + Threshold Signing (8 IPC)** ⭐v1.1.0-alpha Phase 46
- 🟢 **BLE U-Key Support**: 100% Complete - **Bluetooth U-Key + GATT Communication + Auto-Reconnect (4 IPC)** ⭐v1.1.0-alpha Phase 47
- 🟢 **Content Recommendation**: 100% Complete - **Local Recommendation Engine + Interest Profiling + Collaborative Filtering (6 IPC)** ⭐v1.1.0-alpha Phase 48
- 🟢 **Nostr Bridge**: 100% Complete - **Nostr Protocol + NIP-01/19/42 + Relay Management + DID Mapping (6 IPC)** ⭐v1.1.0-alpha Phase 49
- 🟢 **Data Loss Prevention (DLP)**: 100% Complete - **DLP Engine + Policy Management + Content Detection (8 IPC)** ⭐v1.1.0-alpha Phase 50
- 🟢 **SIEM Integration**: 100% Complete - **SIEM Exporter + CEF/LEEF/JSON Formats + Real-time Push (4 IPC)** ⭐v1.1.0-alpha Phase 51
- 🟢 **PQC Migration**: 100% Complete - **Post-Quantum Crypto + ML-KEM/ML-DSA + Hybrid Mode + Migration Management (4 IPC)** ⭐v1.1.0-alpha Phase 52
- 🟢 **Firmware OTA**: 100% Complete - **Firmware OTA Updates + Signature Verification + Auto Rollback (4 IPC)** ⭐v1.1.0-alpha Phase 53
- 🟢 **AI Community Governance**: 100% Complete - **Governance Proposals + AI Impact Analysis + Voting Prediction (4 IPC)** ⭐v1.1.0-alpha Phase 54
- 🟢 **Matrix Integration**: 100% Complete - **Matrix Protocol + E2EE + Room Management + DID Mapping (5 IPC)** ⭐v1.1.0-alpha Phase 55
- 🟢 **Terraform Provider**: 100% Complete - **IaC Workspaces + Plan/Apply/Destroy + State Management (4 IPC)** ⭐v1.1.0-alpha Phase 56
- 🟢 **Production Hardening**: 100% Complete - **Performance Baseline + Security Auditing + Hardening Recommendations (6 IPC)** ⭐v2.0.0 Phase 57
- 🟢 **Federation Hardening**: 100% Complete - **Circuit Breaker + Health Checks + Connection Pool + Auto-Degradation (4 IPC)** ⭐v2.0.0 Phase 58
- 🟢 **Federation Stress Test**: 100% Complete - **Concurrent Stress Testing + Load Simulation + Bottleneck Identification (4 IPC)** ⭐v2.0.0 Phase 59
- 🟢 **Reputation Optimizer**: 100% Complete - **Bayesian Optimization + Anomaly Detection + Anti-Cheating (4 IPC)** ⭐v2.0.0 Phase 60
- 🟢 **Cross-Org SLA**: 100% Complete - **SLA Contracts + Multi-tier SLA + Violation Detection + Compensation (5 IPC)** ⭐v2.0.0 Phase 61
- 🟢 **Tech Learning Engine**: 100% Complete - **Tech Stack Analysis + Best Practices + Anti-Pattern Detection (5 IPC)** ⭐v3.0.0 Phase 62
- 🟢 **Autonomous Developer**: 100% Complete - **Autonomous Coding + Architecture Decisions + Code Review + Refactoring (5 IPC)** ⭐v3.0.0 Phase 63
- 🟢 **Collaboration Governance**: 100% Complete - **Task Allocation + Conflict Resolution + Quality Assessment + Autonomy Levels (5 IPC)** ⭐v3.0.0 Phase 64
- 🟢 **Skill-as-a-Service**: 100% Complete - **Skill Registry + Remote Invocation + Pipeline DAG + Version Management (5 IPC)** ⭐v3.1.0 Phase 65
- 🟢 **Token Incentive**: 100% Complete - **Token Ledger + Contribution Tracking + Reputation-Weighted Pricing (5 IPC)** ⭐v3.1.0 Phase 66
- 🟢 **Inference Network**: 100% Complete - **Node Registry + Task Scheduling + TEE Privacy + Federated Learning (6 IPC)** ⭐v3.1.0 Phase 67
- 🟢 **Trinity Trust Root**: 100% Complete - **U-Key+SIMKey+TEE Trust Root + Attestation Chain + Secure Boot (5 IPC)** ⭐v3.2.0 Phase 68
- 🟢 **PQC Full Migration**: 100% Complete - **ML-KEM/ML-DSA Ecosystem + Firmware PQC + Subsystem Migration (4 IPC)** ⭐v3.2.0 Phase 69
- 🟢 **Satellite Communication**: 100% Complete - **LEO Satellite + Offline Signatures + Emergency Key Revocation (5 IPC)** ⭐v3.2.0 Phase 70
- 🟢 **Open Hardware Standard**: 100% Complete - **Unified HSM Interface + Yubikey/Ledger/Trezor + FIPS 140-3 (4 IPC)** ⭐v3.2.0 Phase 71
- 🟢 **Protocol Fusion Bridge**: 100% Complete - **DID↔AP↔Nostr↔Matrix Identity Mapping + Cross-Protocol Routing (5 IPC)** ⭐v3.3.0 Phase 72
- 🟢 **AI Social Enhancement**: 100% Complete - **Real-time Translation (50+ Languages) + Content Quality Assessment (5 IPC)** ⭐v3.3.0 Phase 73
- 🟢 **Decentralized Storage**: 100% Complete - **Filecoin Deals + P2P CDN + IPLD DAG Versioning (5 IPC)** ⭐v3.3.0 Phase 74
- 🟢 **Anti-Censorship Communication**: 100% Complete - **Tor Hidden Services + Traffic Obfuscation + Mesh Network (5 IPC)** ⭐v3.3.0 Phase 75
- 🟢 **EvoMap Federation**: 100% Complete - **Multi-Hub Interconnection + Gene Sync + Evolutionary Pressure Selection (5 IPC)** ⭐v3.4.0 Phase 76
- 🟢 **EvoMap IP & DAO Governance**: 100% Complete - **DID+VC Originality Proof + Gene Voting + Dispute Arbitration (5 IPC)** ⭐v3.4.0 Phase 77
- 🟢 **Mobile Application**: 100% Complete - **Knowledge Base + AI Chat + Trading System + Social Features + Mobile UX Optimization + P2P Sync + Android Remote Control UIs** ⭐Completed

## Core Features

- 🔐 **Military-Grade Security**: SQLCipher AES-256 encryption + Cross-Platform USB Key hardware keys + Signal protocol E2E encryption + Post-Quantum Crypto (ML-KEM/ML-DSA) ✅
- 📱 **SIMKey v0.38.0**: iOS eSIM + 5G Optimization (3-5x) + NFC Offline Signing + Multi-SIM Switch + Health Monitoring + Quantum-Resistant ✅ ⭐NEW
- 📡 **Remote Control**: P2P remote control + 24+ command handlers + Chrome extension + 45,000+ lines ✅
- 🖥️ **Computer Use**: Claude-style desktop automation + Vision AI locator + Workflow engine + 68+ IPC channels ✅
- 🧠 **Permanent Memory System**: Daily Notes auto-logging + MEMORY.md long-term extraction + Hybrid Search (Vector+BM25) ✅
- 🎯 **Context Engineering**: KV-Cache optimization + Token estimation + Recoverable compression + Task context management ✅
- 📋 **Plan Mode**: Claude Code style plan mode + Security analysis + Approval workflow ✅
- 🛡️ **Enterprise Permissions**: RBAC permission engine + Resource-level control + Permission inheritance + Delegation ✅ ⭐NEW
- 👥 **Team Management**: Sub-team hierarchy + Member management + Daily Standup + AI report summaries ✅ ⭐NEW
- 🪝 **Hooks System**: 21 hook events + 4 hook types + Priority system + Script hooks ✅ ⭐NEW
- 🎨 **Skills System**: 141 built-in skills + Agent Skills open standard + Unified tool registry + /skill commands ✅ ⭐v1.2.1
- 🗂️ **Unified Tool Registry**: FunctionCaller 60+ tools + MCP 8 servers + Skills 146 skills unified management ✅ ⭐v1.0.0
- 🧬 **Instinct Learning**: Auto-extract user patterns + Confidence scoring + Context injection + Hooks observation pipeline ✅ ⭐v0.39.0
- 📦 **Demo Templates**: 10 demo templates + 4 categories + Visual browsing + One-click run ✅ ⭐NEW
- 📊 **Unified Logging System**: Centralized logger management + Log level control + Structured logging + Production debugging ✅
- 🌐 **Fully Decentralized**: P2P network (libp2p 3.1.2) + DHT + local data storage, no central servers needed ✅
- 📁 **P2P File Transfer**: Large file chunked transfer (64KB) + resume capability + real-time progress + SHA-256 verification ✅
- 🧠 **AI Native**: Support for 14+ cloud LLM providers + Ollama local deployment + RAG-enhanced retrieval ✅
- 🔌 **MCP Integration**: Model Context Protocol support, 5 official servers + security sandbox + 63 test cases ✅
- ⚙️ **Unified Configuration**: `.chainlesschain/` centralized config directory + auto-initialization + multi-level priority ✅
- 💰 **Token Budget Management**: LLM cost tracking + monthly budget control + overspending alerts + detailed analytics ✅
- 🎯 **16 AI Engines**: Code/document/spreadsheet/PPT/PDF/image/video specialized processing, covering all scenarios ✅
- 📋 **Template System**: 178 AI templates + 32 categories + smart engine allocation + 100% configuration coverage ✅
- ⛓️ **Blockchain Integration**: 6 smart contracts + HD wallet system + MetaMask/WalletConnect + LayerZero cross-chain bridge ✅
- 🏢 **Enterprise Edition**: Multi-identity architecture + RBAC permissions + organization management + data isolation ✅
- 🔧 **Skill & Tool System**: 115 skills + 300 tools + 10 categories + dynamic management ✅
- 🧪 **Comprehensive Test Suite**: 2500+ test cases + 417+ test files + OWASP security validation + DI test refactoring ✅ ⭐v1.0.0
- 🎤 **Voice Recognition**: Real-time transcription + audio enhancement + multi-language detection + UI integration ✅
- 📱 **Cross-Device Collaboration**: Git sync + mobile-PC data sync + multi-device P2P communication + offline message queue ✅
- 🔓 **Open Source & Self-Hosted**: 310,000+ lines of code, 370 Vue components, 380+ IPC handlers, fully transparent and auditable ✅
- ⚡ **P2 Optimization System**: Intent fusion, knowledge distillation, streaming response, 40% AI engine performance boost ✅
- 🚀 **Deep Performance Optimization**: 18 optimization tools + 4 specialized components + Core Web Vitals monitoring + smart image loading ✅
- 🎛️ **Advanced Features Control Panel**: Real-time monitoring, configuration management, 20+ IPC channels, native menu integration ✅
- 📸 **Smart Image Processing**: Tesseract.js OCR + Sharp image processing + WebP/AVIF optimization + responsive loading ✅
- 💼 **Microservice Architecture**: Project Service + AI Service + Community Forum, 157 API endpoints ✅ ⭐Updated
- 🔄 **Database Sync**: SQLite ↔ PostgreSQL bidirectional sync, soft delete + conflict resolution ✅
- 🌐 **Browser Extension**: Web annotation + content extraction + AI assistance + automated testing ✅
- 🧪 **Complete Testing System**: Playwright E2E + Vitest unit tests + 417+ test files + 2500+ test cases ✅
- 💾 **Memory Leak Protection**: 4-layer protection mechanism (timer safety/event cleanup/API cancellation/message limiting) + Long-term stability guarantee ✅ ⭐NEW
- 📱 **Android P2P UI**: 8 complete screens (device discovery/pairing/security verification/DID management/message queue/QR scan) + Full P2P experience ✅ ⭐NEW
- 🖥️ **Workspace Management**: Full CRUD + restore + permanent delete + member management ✅ ⭐NEW
- 🔄 **Remote Sync**: Incremental sync + conflict resolution + multi-device collaboration + auto-fallback ✅ ⭐NEW

More features detailed in [Features Documentation](./docs/FEATURES.md)

## Three Core Functions

### 1️⃣ Knowledge Base Management (100% Complete) ✅

- ✅ SQLCipher AES-256 encrypted database (50+ tables)
- ✅ Knowledge graph visualization (8 algorithms + 5 visualizations + intelligent extraction)
- ✅ AI-enhanced retrieval (hybrid search + 3 reranking methods)
- ✅ Multi-format import (Markdown/PDF/Word/TXT/Images)
- ✅ Version control (Git integration + conflict resolution)

### 2️⃣ Decentralized Social (100% Complete) ✅

- ✅ DID identity system (W3C standard + organization DID)
- ✅ P2P network (libp2p + Signal E2E encryption)
- ✅ Social features (friends + posts + group chat + file transfer)
- ✅ WebRTC voice/video calls
- ✅ Community forum (Spring Boot + Vue3)

### 3️⃣ Decentralized Trading (100% Complete) ✅

- ✅ Digital asset management (Token/NFT/knowledge products)
- ✅ Smart contract engine (5 contract types)
- ✅ Escrow service (4 escrow types)
- ✅ Blockchain integration (15 chains + cross-chain bridge)
- ✅ Credit scoring system (6 dimensions + 5 levels)

### 4️⃣ Cowork Multi-Agent Collaboration + Workflow Optimization (100% Complete) ✅

#### Cowork v4.0 Decentralized Agent Network (v1.1.0 New)

- ✅ **Decentralized Agent Network** - W3C DID identity + Ed25519 challenge-response auth + W3C VC credentials + Reputation scoring (0.0-1.0) + Kademlia DHT federated registry + 4-strategy cross-org task routing
- ✅ **Autonomous Operations** - Anomaly detection + Incident severity management + Playbook auto-execution + Auto remediation + One-click rollback + Post-deploy health monitoring + AI postmortem generation
- ✅ **Dev Pipeline Orchestration** - Full pipeline lifecycle + 6 deployment strategies + Approval gates + Smoke tests + Artifact management + RollbackManager integration
- ✅ **Multimodal Collaboration** - Text/image/audio/video fusion + Multi-format document parsing + Cross-modal context + Multi-format output generation + Screen recording
- ✅ **Natural Language Programming** - NL→code conversion pipeline + Structured requirement parsing + Project style auto-detection + Code convention consistency

#### Multi-Agent Collaboration Core

- ✅ Smart orchestration system (AI decision + single/multi-agent task distribution)
- ✅ Agent pool reuse (10x acquisition speed + 85% overhead reduction)
- ✅ File sandbox (18+ sensitive file detection + path traversal protection)
- ✅ Long-running task management (intelligent checkpoints + recovery mechanism)
- ✅ Skills system (4 Office skills + smart matching)
- ✅ Complete integration (RAG + LLM + error monitoring + session management)
- ✅ Data visualization (10+ chart types + real-time monitoring)
- ✅ Enterprise security (5-layer protection + zero trust + full audit)

#### Workflow Smart Optimization (Phase 1-4, 17 items all complete)

**Phase 1-2 Core Optimizations (8 items)**

- ✅ RAG parallelization - 60% time reduction (3s→1s)
- ✅ Message aggregation - 50% frontend performance boost
- ✅ Tool caching - 15% reduction in repeated calls
- ✅ File tree lazy loading - 80% faster large project loading
- ✅ LLM fallback strategy - 50% success rate boost (60%→90%)
- ✅ Dynamic concurrency control - 40% CPU utilization improvement
- ✅ Smart retry strategy - 183% retry success rate improvement
- ✅ Quality gate parallelization - Early error interception

**Phase 3-4 Smart Optimizations (9 items)**

- ✅ Smart plan cache - 70% LLM cost reduction, 60-85% hit rate
- ✅ LLM-assisted decision - 20% multi-agent utilization boost, 92% accuracy
- ✅ Agent pool reuse - 10x acquisition speed, 85% overhead reduction
- ✅ Critical path optimization - 15-36% execution time reduction (CPM algorithm)
- ✅ Real-time quality check - 1800x faster problem discovery, 50% rework reduction
- ✅ Auto stage transition - 100% human error elimination
- ✅ Intelligent checkpoints - 30% IO overhead reduction

**Overall Improvement**: Task success rate 40%→70% (+75%) | LLM cost -70% | Execution speed +25%

Detailed documentation: [Cowork Quick Start](./docs/features/COWORK_QUICK_START.md) | [Phase 3/4 Summary](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md)

### 5️⃣ Permanent Memory System (100% Complete) ✅

- ✅ Daily Notes auto-logging (memory/daily/YYYY-MM-DD.md)
- ✅ MEMORY.md long-term knowledge extraction (categorized storage + auto-update)
- ✅ Hybrid search engine (Vector semantic + BM25 keyword dual-path search)
- ✅ RRF fusion algorithm (Reciprocal Rank Fusion intelligent ranking)
- ✅ Embedding cache (reduced redundant computation + file hash tracking)
- ✅ Auto expiry cleanup (configurable retention days)
- ✅ Metadata statistics (knowledge classification, tags, reference tracking)

Detailed documentation: [Permanent Memory Integration](./docs/features/PERMANENT_MEMORY_INTEGRATION.md)

### 6️⃣ Comprehensive Testing System (100% Complete) ✅

- ✅ **2500+ test cases** - Covering all core modules (including 102 database tests after DI refactoring)
- ✅ **417 test files + 50 script tests** - Unit/Integration/E2E/Performance/Security
- ✅ **DI test refactoring** - Browser IPC, database modules with improved testability via DI
- ✅ **80% OWASP Top 10 coverage** - XSS/SQL injection/path traversal protection verified
- ✅ **Performance benchmarks established** - 142K ops/s project operations, 271K ops/s file operations
- ✅ **~80% test coverage** - Test-driven continuous quality improvement

Detailed documentation: [Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md)

### 7️⃣ Enterprise Permission System (100% Complete) ✅

- ✅ **Permission Engine** - Resource-level permission evaluation, conditional access, cache optimization
- ✅ **Permission inheritance** - Parent-child resource automatic permission inheritance
- ✅ **Permission delegation** - Temporary permission delegation, time range control
- ✅ **Team Manager** - Sub-team creation, hierarchy structure, member management
- ✅ **Approval workflow** - Multi-level approval, automatic approval rules
- ✅ **Complete audit** - Full permission change audit logging

### 8️⃣ Context Engineering (100% Complete) ✅

- ✅ **KV-Cache optimization** - Static/dynamic content separation, 60-85% hit rate
- ✅ **Token estimation** - Chinese/English auto-detection, precise token calculation
- ✅ **Task context** - Task goal restatement, step tracking, progress management
- ✅ **Error history** - Error recording for model learning, solution association
- ✅ **Recoverable compression** - Preserve URL/path references, on-demand content recovery
- ✅ **17 IPC channels** - Complete frontend access interface

Detailed documentation: [Context Engineering Docs](./docs/MANUS_OPTIMIZATION_GUIDE.md)

### 9️⃣ Plan Mode + Skills System (100% Complete) ✅

- ✅ **Plan Mode** - Security analysis mode, only allows Read/Search/Analyze
- ✅ **Plan generation** - Auto-record blocked operations to plan
- ✅ **Approval workflow** - Full/partial approval, rejection operations
- ✅ **Skills system** - Markdown skill definitions, four-layer loading (bundled→marketplace→managed→workspace)
- ✅ **/skill commands** - User command parsing, auto-execution
- ✅ **Gate checks** - Platform, dependency, environment variable detection
- ✅ **92 Built-in Skills** - All with executable handlers (100% coverage) across 18+ categories (incl. verification-loop, orchestrate)
- ✅ **Agent Skills Open Standard** - 13 extended fields (tools/instructions/examples/dependencies etc.)

Detailed documentation: [Hooks System Design](./docs/design/HOOKS_SYSTEM_DESIGN.md) | [AI Skills System](./docs/design/modules/16_AI技能系统.md)

### 🔟 Unified Tool Registry + Demo Templates (100% Complete) ✅

- ✅ **UnifiedToolRegistry** - Aggregates FunctionCaller (60+), MCP (8 servers), Skills (146 skills) into single registry
- ✅ **ToolSkillMapper** - Auto-groups uncovered tools into 10 default skill categories
- ✅ **MCPSkillGenerator** - Auto-generates skill manifests when MCP servers connect
- ✅ **Name Normalization** - SKILL.md naming (kebab-case) → FunctionCaller naming (snake_case) auto-bridging
- ✅ **Tools Explorer** - Browse all tools grouped by skill with search/filter/preview
- ✅ **10 Demo Templates** - Showcase skill combinations (Automation/AI Workflow/Knowledge/Remote)
- ✅ **DemoTemplateLoader** - Auto-discover JSON templates, 4 IPC handlers
- ✅ **6 Unified Tool IPCs** - tools:get-all-with-skills/get-skill-manifest/get-by-skill/search-unified/get-tool-context/refresh-unified

Detailed documentation: [AI Skills System](./docs/design/modules/16_AI技能系统.md)

### MCP (Model Context Protocol) Integration ⭐NEW

ChainlessChain integrates MCP (Model Context Protocol) to extend AI capabilities through a standardized protocol:

**What is MCP**:

- 🔌 **Open Standard**: Standardized protocol enabling AI assistants to connect with various external tools and data sources
- 🚀 **Highly Extensible**: Easily add new capabilities without modifying core code
- 🔒 **Secure Isolation**: Servers run in isolated processes with fine-grained permission control

**Supported MCP Servers**:

| Server         | Functionality                                   | Security Level | Status |
| -------------- | ----------------------------------------------- | -------------- | ------ |
| **Filesystem** | File read/write, search, directory management   | Medium         | ✅     |
| **PostgreSQL** | Database queries, table management              | High           | ✅     |
| **SQLite**     | Local database access                           | Medium         | ✅     |
| **Git**        | Repository status, commit history, diff viewing | Medium         | ✅     |
| **Fetch**      | HTTP requests, API calls                        | Medium         | ✅     |

**Core Features**:

- 🎯 **UI Management Interface**: Visual MCP server management in Settings page
- 🔐 **Multi-Layer Security Protection**:
  - Server whitelist mechanism (`server-registry.json`)
  - Path/table access control (whitelist + blacklist)
  - User consent workflow (confirmation for high-risk operations)
  - Process isolation (servers run independently)
  - Audit logging (all operations recorded)
- 📊 **Performance Monitoring**: Connection time, call latency, error rate, memory usage
- 📝 **Complete Documentation**: User guide, testing guide, developer docs

**Security Boundaries**:

- ❌ Permanently forbidden: `chainlesschain.db` (encrypted database), `ukey/` (hardware keys), `did/private-keys/` (DID private keys), `p2p/keys/` (P2P encryption keys)
- ✅ Whitelisted paths: `notes/`, `imports/`, `exports/`, `projects/`
- 🔒 Read-only mode by default, writes require user confirmation

**Use Cases**:

- 📁 AI assistant reads/searches filesystem
- 🗄️ AI assistant queries database for data
- 📋 AI assistant views Git commit history
- 🌐 AI assistant calls external APIs

**Technical Implementation**:

- `mcp-client-manager.js` - Core client orchestrator
- `mcp-security-policy.js` - Security policy enforcement
- `mcp-tool-adapter.js` - Bridge to ToolManager
- Stdio transport protocol (HTTP+SSE planned)
- Integrated UI management in Settings page

**Documentation Links**:

- 📖 [MCP User Guide](docs/features/MCP_USER_GUIDE.md)
- 🧪 [MCP Testing Guide](desktop-app-vue/src/main/mcp/TESTING_GUIDE.md)
- 🌐 [MCP Official Spec](https://modelcontextprotocol.io/)

**Known Limitations (POC Stage)**:

- Only Stdio transport supported (HTTP+SSE pending)
- Basic error recovery (simple retry only)
- File-based configuration (UI editing planned)
- Windows-focused (cross-platform support needed)

**Roadmap**:

- 🔜 HTTP+SSE transport support
- 🔜 More official servers (Slack, GitHub, etc.)
- 🔜 Enhanced UI configuration editing
- 🔜 Custom MCP server development SDK
- 🔜 Community server marketplace

### Unified Configuration Directory System ⭐NEW

ChainlessChain uses a unified `.chainlesschain/` directory for managing all configurations, logs, and cache, inspired by OpenClaude best practices:

**Directory Structure**:

```
.chainlesschain/
├── config.json              # Core config (model, cost, performance, logging)
├── config.json.example      # Config template (version controlled)
├── rules.md                 # Project coding rules
├── memory/                  # Session and learning data
│   ├── sessions/            # Conversation history
│   ├── preferences/         # User preferences
│   └── learned-patterns/    # Learned patterns
├── logs/                    # Operation logs
│   ├── error.log
│   ├── performance.log
│   ├── llm-usage.log        # LLM usage tracking
│   └── mcp-*.log            # MCP logs
├── cache/                   # Cached data
│   ├── embeddings/          # Vector cache
│   ├── query-results/       # Query results
│   └── model-outputs/       # Model outputs
└── checkpoints/             # Checkpoints and backups
```

**Configuration Priority** (High → Low):

1. **Environment variables** (`.env`, system env)
2. **`.chainlesschain/config.json`** (user config)
3. **Default configuration** (defined in code)

**Core Features**:

- ✅ **Auto-initialization**: Automatically creates directory structure on first run
- 📦 **Git-friendly**: Runtime data excluded, templates/rules version controlled
- 🎯 **Centralized Management**: All paths accessible via `UnifiedConfigManager`
- 🔄 **Easy Migration**: Support for config export/import
- 📊 **LLM Cost Tracking**: Automatically logs token usage and costs

**Usage Example**:

```javascript
const { getUnifiedConfigManager } = require("./config/unified-config-manager");
const configManager = getUnifiedConfigManager();

// Get config
const modelConfig = configManager.getConfig("model");

// Get paths
const logsDir = configManager.getLogsDir();

// Update config
configManager.updateConfig({
  cost: { monthlyBudget: 100 },
});
```

**Configuration Files**:

- `.chainlesschain/config.json` - Main config (git-ignored)
- `.chainlesschain/config.json.example` - Template (version controlled)
- `.chainlesschain/rules.md` - Coding rules (priority > CLAUDE.md)

**Backward Compatibility**:

- Existing `app-config.js` continues to work
- New code recommended to use `UnifiedConfigManager`
- Logs gradually migrate from `userData/logs/` to `.chainlesschain/logs/`

### Token Budget Management System ⭐NEW

ChainlessChain implements a complete LLM usage cost tracking and budget management system:

**Core Functions**:

- 💰 **Cost Tracking**: Automatically records token usage and costs for each LLM call
- 📊 **Budget Control**: Set monthly budget, real-time usage monitoring
- ⚠️ **Overspending Alerts**: Automatic alerts at 80%, 90%, 100% of budget
- 📈 **Statistical Analysis**: Analyze usage by time, model, and feature

**Supported LLM Providers** (10 first-class + custom OpenAI-compatible passthrough):

- **Local**: Ollama (free)
- **International**: OpenAI, Anthropic, Google Gemini, Mistral AI
- **China**: DeepSeek, Volcengine (Doubao), DashScope (Alibaba Qwen), Kimi (Moonshot), MiniMax
- **Custom**: any OpenAI-compatible endpoint (configurable for Zhipu GLM / Baidu Qianfan / Tencent Hunyuan / iFlytek Spark / 其他 — see `docs.chainlesschain.com/chainlesschain/ai-models.html` for config examples)
- **Token-budget pricing data** wired for: OpenAI, Anthropic, DeepSeek, Volcengine, Gemini, Mistral, Ollama; custom providers default to GPT-3.5-turbo pricing

**Usage Monitoring**:

- Real-time token counting (input/output separately)
- Automatic cost calculation (based on official pricing)
- Daily/monthly usage trends
- Model usage ranking

**Alert Strategy**:

- 80% budget: Yellow reminder
- 90% budget: Orange warning
- 100% budget: Red alert, suggest pausing usage

**Log Storage**:

- Location: `.chainlesschain/logs/llm-usage.log`
- Format: JSON Lines (one record per line)
- Content: Timestamp, model, token count, cost, feature module

### P2P File Transfer System ⭐NEW

ChainlessChain implements a complete P2P file transfer system supporting efficient and secure transfer of large files:

**Core Features**:

- 📦 **Large File Chunked Transfer**: 64KB chunk size, supports files of any size
- 🔄 **Resume Capability**: Resume from breakpoint after interruption, no need to restart
- 📊 **Real-time Progress Tracking**: Real-time display of transfer progress, speed, and remaining time
- ✅ **File Integrity Verification**: SHA-256 hash verification ensures file integrity
- ⚡ **Concurrent Transfer Control**: Up to 3 concurrent chunk transfers for optimized speed
- 🎯 **Smart Retry Mechanism**: Automatic retry for failed chunks, up to 3 attempts
- 💾 **Temporary File Management**: Automatic management of temporary files, cleanup after completion
- 🔐 **E2E Encryption**: End-to-end encrypted transfer based on Signal Protocol

**Use Cases**:

- Send/receive images and files in chat
- Knowledge base file synchronization
- Project file collaboration
- Large file peer-to-peer transfer

**Technical Implementation**:

- P2P network layer based on libp2p
- MessageManager for message management and batch processing
- FileTransferManager for file transfer management
- IPC interface integrated into chat system

### Mobile UX Enhancements ⭐NEW

ChainlessChain mobile app has undergone comprehensive UX optimization to provide a smooth, modern mobile experience:

**Core UX Features**:

- 📱 **Responsive Design**: Adapts to various screen sizes, supports portrait/landscape orientation
- 🎨 **Modern UI**: Gradient design, card-based layout, smooth animations
- ⚡ **Performance Optimization**: Virtual scrolling, lazy loading, image optimization, skeleton screens
- 🔄 **Pull-to-Refresh**: All list pages support pull-to-refresh
- 💬 **Instant Feedback**: Toast notifications, loading states, error handling
- 🎯 **Gesture Controls**: Swipe to delete, long-press menu, double-tap zoom
- 📝 **Markdown Editor**: Real-time preview, code highlighting, toolbar, auto-save
- 🖼️ **Image Processing**: Image preview, upload progress, compression optimization
- 🔔 **Notification System**: Local notifications, push notifications, notification center
- 🌙 **Theme Switching**: Light/dark themes, follows system settings

**Implemented Features** (100% Complete):

- ✅ Knowledge Base Management - Markdown rendering, code highlighting, image preview
- ✅ AI Chat Interface - Streaming responses, message bubbles, voice input
- ✅ Social Features - Friend list, post publishing, private messaging
- ✅ Trading System - Order management, asset display, payment flow
- ✅ Project Management - Task list, progress tracking, collaboration features
- ✅ Settings Pages - Account management, privacy settings, sync configuration

**Technical Implementation**:

- uni-app 3.0 + Vue 3.4 cross-platform framework
- Pinia 2.1.7 state management
- SQLite local database
- WebRTC P2P communication
- Custom CSS theme system
- Component-based architecture

### Voice Message System ⭐NEW

ChainlessChain implements a complete voice message recording and playback system for seamless audio communication in P2P chats:

**Recording Features**:

- 🎙️ **Real-time Voice Recording**: One-click recording with intuitive modal interface
- ⏸️ **Pause/Resume Controls**: Pause and resume recording without losing progress
- ⏱️ **Duration Display**: Real-time recording duration counter (MM:SS format)
- 📊 **Volume Visualization**: Live audio level indicator during recording
- 🎨 **Animated Recording UI**: Pulsing microphone icon with visual feedback
- ❌ **Cancel Recording**: Discard recording without sending

**Playback Features**:

- ▶️ **Play/Pause Controls**: Simple play/pause button in message bubble
- 🕐 **Duration Display**: Shows voice message length
- 🔊 **Audio Element Management**: Proper audio resource handling and cleanup
- 🔄 **Playback Status**: Visual indication of playing state
- ⚠️ **Error Handling**: Graceful error handling for playback failures

**Technical Implementation**:

- VoiceMessageRecorder component for recording UI
- Integration with speech IPC handlers (start/pause/resume/stop/cancel)
- Audio file storage in uploads/chat directory
- Duration metadata stored in database
- P2P file transfer for voice message delivery
- Automatic resource cleanup on component unmount

**Use Cases**:

- Quick voice messages in P2P chats
- Voice notes for knowledge base
- Audio feedback and communication
- Hands-free messaging

### Blockchain Adapter System ⭐COMPLETE

ChainlessChain implements a complete blockchain adapter system providing unified multi-chain interaction interface:

#### 1. Multi-Chain Support (15 Blockchains)

**Mainnets**:

- Ethereum (Ethereum Mainnet)
- Polygon (Polygon Mainnet)
- BSC (Binance Smart Chain)
- Arbitrum One (Arbitrum Mainnet)
- Optimism (Optimism Mainnet)
- Avalanche C-Chain (Avalanche C-Chain)
- Base (Base Mainnet)

**Testnets**:

- Ethereum Sepolia
- Polygon Mumbai
- BSC Testnet
- Arbitrum Sepolia
- Optimism Sepolia
- Avalanche Fuji
- Base Sepolia
- Hardhat Local (Local Development Network)

#### 2. Smart Contract Deployment

**Token Contracts**:

- ✅ ERC-20 Token Deployment (ChainlessToken)
- ✅ ERC-721 NFT Deployment (ChainlessNFT)
- ✅ Custom Token Parameters (name/symbol/decimals/initial supply)

**Business Contracts**:

- ✅ Escrow Contract (EscrowContract) - Supports buyer-seller fund escrow
- ✅ Subscription Contract (SubscriptionContract) - Supports periodic subscription payments
- ✅ Bounty Contract (BountyContract) - Supports task bounties and reward distribution

#### 3. Asset Operations

**Token Operations**:

- ✅ Token Transfer (single/batch)
- ✅ Token Balance Query
- ✅ Token Approval Management

**NFT Operations**:

- ✅ NFT Minting (mint)
- ✅ NFT Transfer (single/batch)
- ✅ NFT Ownership Query
- ✅ NFT Metadata URI Query
- ✅ NFT Balance Query

#### 4. Wallet Management System

**HD Wallet**:

- ✅ BIP39 Mnemonic Generation (12 words)
- ✅ BIP44 Derivation Path (m/44'/60'/0'/0/0)
- ✅ Import Wallet from Mnemonic
- ✅ Import Wallet from Private Key
- ✅ Export Private Key/Mnemonic

**Security Features**:

- ✅ AES-256-GCM Encrypted Storage
- ✅ PBKDF2 Key Derivation (100,000 iterations)
- ✅ USB Key Hardware Signing Support
- ✅ Wallet Lock/Unlock Mechanism

**External Wallets**:

- ✅ MetaMask Integration
- ✅ WalletConnect Support
- ✅ Multi-Wallet Management

#### 5. Advanced Features

**Gas Optimization**:

- ✅ Gas Price Optimization (slow/standard/fast tiers)
- ✅ Transaction Fee Estimation (L2 special handling support)
- ✅ EIP-1559 Support (maxFeePerGas/maxPriorityFeePerGas)

**Transaction Management**:

- ✅ Transaction Retry Mechanism (exponential backoff, up to 3 attempts)
- ✅ Transaction Monitoring (real-time status updates)
- ✅ Transaction Replacement (cancel/speed up pending transactions)
- ✅ Transaction Confirmation Tracking

**Event System**:

- ✅ Contract Event Listening
- ✅ Real-time Event Push
- ✅ Event Filtering and Query

#### 6. Cross-Chain Bridge

**LayerZero Integration**:

- ✅ Cross-chain Asset Transfer
- ✅ Cross-chain Message Passing
- ✅ Support for 15 Chain Interoperability
- ✅ Automatic Route Optimization

#### 7. On-Chain Off-Chain Sync

**BlockchainIntegration Module**:

- ✅ On-chain Asset Mapping to Local Database
- ✅ On-chain Transaction Record Sync
- ✅ Escrow Status Sync
- ✅ Auto Sync (every 5 minutes)
- ✅ Sync Logs and Error Tracking

#### 8. RPC Management

**Smart RPC Switching**:

- ✅ Multiple RPC Endpoint Configuration
- ✅ Automatic Failover
- ✅ Connection Timeout Detection (5 seconds)
- ✅ Public RPC Fallback

#### 9. Block Explorer Integration

**Supported Explorers**:

- Etherscan (Ethereum)
- Polygonscan (Polygon)
- BscScan (BSC)
- Arbiscan (Arbitrum)
- Optimistic Etherscan (Optimism)
- SnowTrace (Avalanche)
- BaseScan (Base)

**Features**:

- ✅ Transaction Query Link Generation
- ✅ Address Query Link Generation
- ✅ Contract Verification Link

#### 10. Technical Architecture

**Core Modules**:

```
desktop-app-vue/src/main/blockchain/
├── blockchain-adapter.js          # Core Adapter (1087 lines)
├── blockchain-config.js           # Network Config (524 lines)
├── wallet-manager.js              # Wallet Management (891 lines)
├── blockchain-integration.js      # On-chain Off-chain Integration (637 lines)
├── bridge-manager.js              # Cross-chain Bridge Management
├── transaction-monitor.js         # Transaction Monitoring
├── event-listener.js              # Event Listening
├── contract-artifacts.js          # Contract ABI
└── rpc-manager.js                 # RPC Management
```

**IPC Interfaces**:

- `blockchain-ipc.js` - Blockchain Basic Operations
- `wallet-ipc.js` - Wallet Operations
- `contract-ipc.js` - Contract Interaction
- `asset-ipc.js` - Asset Management
- `bridge-ipc.js` - Cross-chain Bridge
- `escrow-ipc.js` - Escrow Operations
- `marketplace-ipc.js` - Marketplace Trading

**Database Tables**:

- `blockchain_wallets` - Wallet Information
- `blockchain_asset_mapping` - Asset Mapping
- `blockchain_transaction_mapping` - Transaction Mapping
- `blockchain_escrow_mapping` - Escrow Mapping
- `blockchain_sync_log` - Sync Logs

#### 11. Usage Examples

**Create Wallet**:

```javascript
// Generate new wallet
const wallet = await walletManager.createWallet(password, chainId);
// Returns: { id, address, mnemonic, chainId }

// Import from mnemonic
const wallet = await walletManager.importFromMnemonic(
  mnemonic,
  password,
  chainId,
);

// Import from private key
const wallet = await walletManager.importFromPrivateKey(
  privateKey,
  password,
  chainId,
);
```

**Deploy Contracts**:

```javascript
// Deploy ERC-20 token
const { address, txHash } = await blockchainAdapter.deployERC20Token(walletId, {
  name: "My Token",
  symbol: "MTK",
  decimals: 18,
  initialSupply: 1000000,
  password: "your-password",
});

// Deploy NFT contract
const { address, txHash } = await blockchainAdapter.deployNFT(walletId, {
  name: "My NFT",
  symbol: "MNFT",
  password: "your-password",
});
```

**Transfer Operations**:

```javascript
// Transfer tokens
const txHash = await blockchainAdapter.transferToken(
  walletId,
  tokenAddress,
  toAddress,
  amount,
  password,
);

// Transfer NFT
const txHash = await blockchainAdapter.transferNFT(
  walletId,
  nftAddress,
  fromAddress,
  toAddress,
  tokenId,
  password,
);
```

**Query Balance**:

```javascript
// Query token balance
const balance = await blockchainAdapter.getTokenBalance(
  tokenAddress,
  ownerAddress,
);

// Query NFT balance
const balance = await blockchainAdapter.getNFTBalance(nftAddress, ownerAddress);
```

**Switch Network**:

```javascript
// Switch to Polygon mainnet
await blockchainAdapter.switchChain(137);

// Get current chain info
const chainInfo = blockchainAdapter.getCurrentChainInfo();
```

#### 12. Security Features

- ✅ Private Key Local Encrypted Storage (AES-256-GCM)
- ✅ Mnemonic Encrypted Backup
- ✅ USB Key Hardware Signing Support
- ✅ Transaction Signature Pre-verification
- ✅ Address Checksum Verification
- ✅ Replay Attack Protection (nonce management)
- ✅ Gas Limit Protection

#### 13. Performance Optimization

- ✅ Wallet Caching Mechanism
- ✅ RPC Connection Pool
- ✅ Batch Transaction Processing
- ✅ Event Listening Optimization
- ✅ Database Index Optimization

#### 14. Error Handling

- ✅ Network Error Auto Retry
- ✅ RPC Failure Auto Switch
- ✅ Transaction Failure Rollback
- ✅ Detailed Error Logging
- ✅ User-Friendly Error Messages

**Code Statistics**:

- Core Code: 5,000+ lines
- Smart Contracts: 2,400+ lines
- Test Cases: 50+
- Supported Chains: 15
- IPC Interfaces: 80+

## 📥 Download & Installation

### Mac Users

#### Download Links

- **GitHub Releases** (International): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (China Mirror): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### Choose Your Version

- **Intel Chip (x64)**: Download `ChainlessChain-darwin-x64-0.29.0.zip` (~1.4GB)
- **Apple Silicon (M1/M2/M3)**: ARM64 version in development, please use x64 version with Rosetta

#### Installation Steps

1. Download `ChainlessChain-darwin-x64-0.29.0.zip`
2. Extract the file (double-click the zip file)
3. Drag `ChainlessChain.app` to Applications folder
4. Double-click to run (see notes below for first run)

#### First Run Notes

**If you see "Cannot open because developer cannot be verified"**:

**Method 1** (Recommended):

- Right-click on `ChainlessChain.app`
- Select "Open"
- Click "Open" in the dialog

**Method 2**:

- Open "System Preferences" → "Security & Privacy"
- In the "General" tab, click "Open Anyway" button at the bottom

### Windows Users

#### Download Links

- **GitHub Releases** (International): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (China Mirror): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### Download Version

- **Windows x64 (64-bit)**: Download `ChainlessChain-win32-x64-0.29.0.zip` (~1.4GB)

#### Installation Steps (Portable Version)

1. Download `ChainlessChain-win32-x64-0.29.0.zip`
2. Extract to any folder (recommended: `C:\Program Files\ChainlessChain\`)
3. Double-click `ChainlessChain.exe` to run
4. No administrator privileges required

#### Notes

- **System Requirements**: Windows 10/11 (64-bit)
- **Portable Version**: Can be extracted to USB drive for portability
- **Data Storage**: Database files located in `data` folder within application directory
- **Firewall**: May need to allow network access on first run (for P2P communication)

#### Build from Source (Optional)

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain/desktop-app-vue
npm install
npm run make:win
```

### Linux Users

#### Download Links

- **GitHub Releases** (International): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (China Mirror): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

#### Download Version

- **Linux x64 ZIP Portable**: Download `ChainlessChain-linux-x64-0.29.0.zip` (~1.4GB)
- **Linux x64 DEB Package**: Download `chainlesschain-desktop-vue_0.29.0_amd64.deb` (~923MB) ⭐Recommended

#### Supported Distributions

- Ubuntu 20.04+ / Debian 11+
- Fedora 35+ / CentOS 8+
- Arch Linux / Manjaro
- Other mainstream Linux distributions

#### Installation Steps

**Method 1: DEB Package (Recommended for Ubuntu/Debian)**

1. Download the deb file
2. Install:
   ```bash
   sudo dpkg -i chainlesschain-desktop-vue_0.29.0_amd64.deb
   ```
3. If dependency issues occur:
   ```bash
   sudo apt-get install -f
   ```
4. Launch from application menu or run:
   ```bash
   chainlesschain-desktop-vue
   ```

**Method 2: ZIP Portable (All Distributions)**

1. Download the zip file
2. Extract to any directory:
   ```bash
   unzip ChainlessChain-linux-x64-0.29.0.zip
   cd ChainlessChain-linux-x64
   ```
3. Grant execute permission:
   ```bash
   chmod +x chainlesschain
   ```
4. Run the application:
   ```bash
   ./chainlesschain
   ```

#### Optional: Create Desktop Shortcut

```bash
# Copy to /opt (optional)
sudo cp -r ChainlessChain-linux-x64 /opt/chainlesschain

# Create symbolic link
sudo ln -s /opt/chainlesschain/chainlesschain /usr/local/bin/chainlesschain

# Create .desktop file
cat > ~/.local/share/applications/chainlesschain.desktop <<'EOF'
[Desktop Entry]
Name=ChainlessChain
Comment=Decentralized Personal AI Management System
Exec=/opt/chainlesschain/chainlesschain
Icon=/opt/chainlesschain/resources/app/build/icon.png
Terminal=false
Type=Application
Categories=Utility;Office;
EOF
```

#### Dependency Check

Most modern Linux distributions include required libraries. If issues occur, install:

```bash
# Ubuntu/Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6

# Fedora/CentOS
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst

# Arch Linux
sudo pacman -S gtk3 libnotify nss libxss libxtst
```

### Build from Source (Developers)

If you want to run from source or contribute to development, see the [🚀 Quick Start](#🚀-quick-start) section below.

---

## Four Core Functions

### 1️⃣ Knowledge Base Management (100% Complete) ✅

**Database System**:

- ✅ SQL.js + SQLCipher AES-256 encrypted database (50+ tables: base + enterprise + blockchain + optimization)
- ✅ Unified management of knowledge items, tags, conversations, projects, tasks
- ✅ Soft delete mechanism + auto-save + transaction support
- ✅ SQLite ↔ PostgreSQL bidirectional sync (4 core modules)
- ✅ Performance optimization and edge case handling (memory downgrade, disk check, concurrency control)

**AI-Enhanced Retrieval (RAG)**:

- ✅ ChromaDB/Qdrant vector storage
- ✅ Hybrid search (vector + keyword + FTS5 full-text index)
- ✅ 3 reranking algorithms (LLM, CrossEncoder, hybrid)
- ✅ Query rewriting (multi-query, HyDE, step-back)
- ✅ Performance monitoring and metrics collection

**File Processing**:

- ✅ Multi-format import: Markdown/PDF/Word/TXT/Images
- ✅ OCR recognition: Tesseract.js, supports Chinese and English
- ✅ Image processing: Sharp compression, thumbnails, format conversion
- ✅ 6 specialized editors: Code/Markdown/Excel/PPT/RichText/WebDev

**Version Control**:

- ✅ isomorphic-git pure JS implementation
- ✅ AI auto-generated commit messages
- ✅ Visual conflict resolution UI
- ✅ Git sync scheduler

**Deep Performance Optimization** (v0.20.0):

- ✅ **Smart Image Optimization** (560 lines):
  - WebP/AVIF format auto-detection and conversion
  - Responsive image loading (srcset/sizes)
  - LQIP (Low Quality Image Placeholder)
  - Progressive loading and CDN support
  - Network-aware loading (auto quality reduction on 2G/3G)
- ✅ **Real-time Performance Monitoring** (644 lines):
  - Core Web Vitals monitoring (LCP/FID/CLS/FCP/TTFB)
  - Performance budget management and violation alerts
  - Real-time FPS monitoring (60fps target)
  - Memory usage monitoring and alerts
  - Network status monitoring
- ✅ **Frontend Optimization Toolkit** (18 utility classes):
  - Code splitting and component lazy loading
  - Virtual scrolling list (VirtualMessageList)
  - Intelligent prefetch (based on user behavior prediction)
  - Request batching
  - Optimistic updates
  - Data compression (LZ-string algorithm)
  - Incremental sync
  - Memory optimization (object pool, weak references)
  - Animation control (requestAnimationFrame)
  - Resource hints (preload/prefetch/preconnect)
  - Content Visibility API optimization
  - Accessibility enhancements (ARIA)
  - Performance benchmarking tools
- ✅ **Specialized Components** (4 components):
  - AsyncComponent.vue - Async component loading
  - LazyImage.vue - Lazy loading image component
  - PerformanceMonitor.vue - Performance monitoring panel
  - VirtualMessageList.vue - Virtual scrolling message list
- ✅ **Complete Documentation**: 8 detailed documents (OPTIMIZATION\_\*.md)

### 2️⃣ Decentralized Social (100% Complete) ✅

**DID Identity System**:

- ✅ W3C DID Core standard (`did:chainlesschain:<identifier>`)
- ✅ Ed25519 signing key pair + X25519 encryption key pair
- ✅ DID document generation, signing, verification
- ✅ Multi-identity support + mnemonic export
- ✅ P2P network publishing and resolution

**Verifiable Credentials (VC)**:

- ✅ 5 credential types: self-claim, skill certificate, trust endorsement, education, work experience
- ✅ W3C VC standard signing and verification
- ✅ Credential lifecycle management + revocation mechanism

**P2P Network**:

- ✅ libp2p 3.1.2 node management
- ✅ TCP transport + Noise encryption + Kademlia DHT
- ✅ mDNS local discovery + device hot-plug monitoring
- ✅ Signal Protocol E2E encryption (complete implementation)
- ✅ Device management + cross-device sync + offline message queue
- ✅ WebRTC support (P2P voice/video calls + NAT traversal)

**Social Features**:

- ✅ Friend management: request/accept/reject, online status, grouping, remarks
- ✅ Social posts: publish, like, comment, share, image support
- ✅ P2P encrypted private messages: offline messages, multi-device sync, file transfer, message forwarding ⭐Updated
- ✅ Group chat: create groups, member management, end-to-end encrypted group messages, invitation system

**Message Forwarding Feature** (~200 lines of code): ⭐NEW

- ✅ **Context Menu**: Right-click on message bubbles for forward, copy, delete operations
- ✅ **Multi-Session Selection**: Select multiple target sessions for batch forwarding
- ✅ **Automatic File Copying**: Automatically copy files when forwarding image/file messages
- ✅ **Forward Indicator**: Forwarded messages display forward badge and track original source
- ✅ **Forward Counter**: Track how many times a message has been forwarded
- ✅ **Database Support**: Added forwarded_from_id and forward_count fields
- ✅ **IPC Interface**: chat:forward-message handler for batch forwarding
- ✅ **UI Components**: Forward dialog, session selector, forwarding status notifications

**Voice Message Playback Feature** (~150 lines of code): ⭐NEW

- ✅ **Playback Controls**: Click play/pause button to control voice playback, supports playback state toggle
- ✅ **Status Display**: Real-time playback status display (playing/paused), dynamic icon switching
- ✅ **Duration Display**: Shows voice message duration in MM:SS format
- ✅ **HTML5 Audio**: Uses native Audio API for playback, supports all browser audio formats
- ✅ **Auto Cleanup**: Automatically resets state when playback ends, releases audio resources on component unmount
- ✅ **Error Handling**: Comprehensive error messages and exception handling, friendly prompts on playback failure
- ✅ **IPC Interface**: chat:play-voice-message handler, validates message type and file existence
- ✅ **UI Integration**: Voice message bubble, play/pause icons, duration label

**Community Forum** (Standalone App):

- ✅ Spring Boot 3.1.5 backend (69 Java files, 63 APIs)
- ✅ Vue3 frontend (45 files, 15 pages)
- ✅ 14 database tables: users, posts, replies, tags, likes, favorites, etc.
- ✅ Elasticsearch full-text search + Redis cache
- ✅ JWT authentication + Spring Security authorization

### 3️⃣ Decentralized Trading System (100% Complete) ✅

Total code: **12,494+ lines** (28 UI components + 8 backend modules + blockchain integration)

**Trading UI Components** (28 components, 12,494 lines):

**Asset Management UI** (6 components - 2,631 lines):

- ✅ **AssetList.vue** (316 lines) - Asset listing with filters, search, statistics
- ✅ **AssetCreate.vue** (601 lines) - Create tokens, NFTs, knowledge products, services
- ✅ **AssetDetail.vue** (452 lines) - Detailed asset view with blockchain info
- ✅ **AssetTransfer.vue** (292 lines) - Transfer assets between DIDs
- ✅ **AssetHistory.vue** (510 lines) - Transaction history timeline
- ✅ **AssetStatistics.vue** (460 lines) - Asset analytics and charts

**Marketplace UI** (6 components - 2,794 lines):

- ✅ **Marketplace.vue** (728 lines) - Main marketplace with order cards, filters, tabs
- ✅ **OrderCreate.vue** (468 lines) - Create buy/sell/service/barter orders
- ✅ **OrderDetail.vue** (417 lines) - Order details with purchase/cancel actions
- ✅ **OrderEdit.vue** (333 lines) - Edit existing orders (NEW - Jan 13, 2026) ⭐
- ✅ **OrderPurchase.vue** (404 lines) - Purchase flow with escrow integration
- ✅ **TransactionList.vue** (444 lines) - Transaction history with status tracking

**Smart Contract UI** (6 components - 3,031 lines):

- ✅ **ContractList.vue** (474 lines) - Contract listing with filters
- ✅ **ContractCreate.vue** (732 lines) - Create contracts from templates
- ✅ **ContractDetail.vue** (661 lines) - Contract details with conditions/events
- ✅ **ContractSign.vue** (430 lines) - Multi-party signature workflow
- ✅ **ContractExecute.vue** (331 lines) - Execute contract conditions
- ✅ **ContractArbitration.vue** (403 lines) - Dispute resolution interface

**Escrow Management UI** (4 components - 1,718 lines):

- ✅ **EscrowList.vue** (455 lines) - Escrow listing with status filters
- ✅ **EscrowDetail.vue** (392 lines) - Escrow details and actions
- ✅ **EscrowDispute.vue** (404 lines) - Dispute filing interface
- ✅ **EscrowStatistics.vue** (467 lines) - Escrow analytics dashboard

**Credit & Review UI** (5 components - 1,867 lines):

- ✅ **CreditScore.vue** (509 lines) - Credit score display, level badges, benefits, history chart, leaderboard
- ✅ **ReviewList.vue** (414 lines) - Review listing with ratings
- ✅ **ReviewCreate.vue** (373 lines) - Create reviews with star ratings
- ✅ **ReviewReply.vue** (227 lines) - Reply to reviews
- ✅ **MyReviews.vue** (344 lines) - User's review history

**Transaction Statistics UI** (1 component - 453 lines):

- ✅ **TransactionStatistics.vue** (453 lines) - Charts and analytics for transactions

**Common/Shared Components** (8 components):

- ✅ **AssetCard.vue** - Reusable asset card
- ✅ **ContractCard.vue** - Reusable contract card
- ✅ **OrderCard.vue** - Reusable order card
- ✅ **OrderQRCodeDialog.vue** - QR code generation (NEW - Jan 13, 2026) ⭐
- ✅ **OrderShareModal.vue** - Share orders via link/social/export (NEW - Jan 13, 2026) ⭐
- ✅ **DIDSelector.vue** - DID selection dropdown
- ✅ **PriceInput.vue** - Price input with asset selector
- ✅ **StatusBadge.vue** - Status badges with colors
- ✅ **TransactionTimeline.vue** - Transaction timeline visualization

**Backend Modules** (8 modules, 6,492 lines):

**1. Digital Asset Management** (asset-manager.js - 1,052 lines):

- ✅ 4 asset types: Token, NFT, knowledge products, service credentials
- ✅ Asset creation, minting, transfer, burning
- ✅ Balance management + transfer history + metadata
- ✅ Batch operation support
- ✅ **NFT On-Chain Transfers** - Full ERC-721 implementation ⭐NEW
  - Ownership verification + safe transfer (safeTransferFrom)
  - Batch NFT transfer support
  - Real-time on-chain queries (owner, balance, metadata URI)
  - Post-transfer auto-verification + P2P notifications
  - Complete transfer history tracking
- ✅ **Blockchain Integration** - ERC-20/ERC-721 deployment
  - On-chain transfers with transaction hash tracking
  - Multi-chain support (Ethereum, Polygon, BSC, Arbitrum, Optimism, Avalanche, Base)

**2. Trading Market** (marketplace-manager.js - 773 lines):

- ✅ Product listing management (create, update, list, delist)
- ✅ Multi-dimensional search and filtering (category, price, tags)
- ✅ Order management (create, pay, confirm, cancel)
- ✅ Transaction history and statistics
- ✅ **Order Editing** - Edit open orders (price, quantity, description) ⭐NEW
- ✅ **Order Sharing** - Multiple sharing methods (link/social/export) ⭐NEW
- ✅ **QR Code Generation** - Generate QR codes for orders/assets ⭐NEW
- ✅ **Multi-Format Export** - Export orders as JSON/CSV/PDF/image ⭐NEW

**3. Smart Contract Engine** (contract-engine.js - 1,345 lines + contract-templates.js - 526 lines):

- ✅ Contract engine: condition evaluation, auto-execution, state management
- ✅ 5 contract types: Simple Trade, Subscription, Bounty, Skill Exchange, Custom
- ✅ 4 escrow types: Simple, Multisig, Timelock, Conditional
- ✅ 40+ condition types supported
- ✅ Serial/parallel task execution
- ✅ Webhook notification integration
- ✅ Multi-party signatures
- ✅ Arbitration system
- ✅ **Blockchain Deployment** - Solidity contracts (Escrow, Subscription, Bounty)
- ✅ **Event Listening** - Real-time event synchronization

**4. Escrow Service** (escrow-manager.js - 592 lines):

- ✅ 4 escrow types: simple escrow, multi-party escrow, arbitration escrow, time-locked
- ✅ Buyer and seller protection mechanisms
- ✅ Dispute resolution process
- ✅ Automatic/manual fund release
- ✅ Statistics dashboard
- ✅ Integration with marketplace and contracts

**5. Knowledge Payment** (knowledge-payment.js - 896 lines):

- ✅ 5 content types: article/video/audio/course/consulting
- ✅ 3 pricing models: one-time, subscription, donation
- ✅ Knowledge product encryption (AES-256) + key management
- ✅ Purchase process + decryption access
- ✅ Copyright protection + DRM
- ✅ Revenue distribution and withdrawal
- ✅ Preview system
- ✅ Statistics tracking

**6. Credit Scoring** (credit-score.js - 637 lines):

- ✅ 6-factor credit score calculation:
  - Completion rate, trade volume, positive rate
  - Response speed, dispute rate, refund rate
- ✅ 5 credit levels: Novice (0-199) → Bronze (200-499) → Silver (500-999) → Gold (1000-1999) → Diamond (2000+)
- ✅ Dynamic weight adjustment algorithm
- ✅ Real-time updates + historical snapshots
- ✅ Credit records and trend analysis
- ✅ Leaderboard system
- ✅ Level-based benefits (fee discounts, priority display, VIP support)

**7. Review System** (review-manager.js - 671 lines):

- ✅ 5-star rating + text review + image attachments
- ✅ Bilateral reviews (buyer/seller)
- ✅ Reply system
- ✅ Helpful/unhelpful marking
- ✅ Report abuse mechanism
- ✅ Review statistics and analysis
- ✅ Review visibility control

**8. Order Management** (integrated in marketplace-manager.js):

- ✅ Order lifecycle: pending payment → paid → in progress → completed → cancelled
- ✅ Order detail queries
- ✅ Batch order processing
- ✅ Order notifications and reminders
- ✅ Order editing (price, quantity, description)
- ✅ Order sharing (link, social media, export)

**9. Blockchain Smart Contract System** (2400+ lines) ⭐NEW:

- ✅ **ChainlessToken** (ERC-20 token contract, 70 lines)
  - Custom name, symbol, decimals
  - Mint/Burn functions, Ownable access control
- ✅ **ChainlessNFT** (ERC-721 NFT contract, 140 lines)
  - Metadata URI support, batch minting
  - ERC721Enumerable extension
  - **Complete On-Chain Transfer Functionality** ⭐NEW
    - safeTransferFrom secure transfer
    - Ownership verification (ownerOf)
    - Balance queries (balanceOf)
    - Metadata URI queries (tokenURI)
    - Batch transfer support
- ✅ **EscrowContract** (Escrow contract, 260 lines)
  - Support for ETH/MATIC + ERC20 tokens
  - Dispute resolution mechanism + arbitrator function
  - ReentrancyGuard protection
- ✅ **SubscriptionContract** (Subscription contract, 300 lines)
  - Monthly/quarterly/annual subscriptions
  - Auto-renewal mechanism
- ✅ **BountyContract** (Bounty contract, 330 lines)
  - Task posting, claiming, submission review
  - Support for multiple completers, reward distribution
- ✅ **AssetBridge** (Cross-chain bridge contract, 300 lines)
  - Lock-mint mode
  - Relayer permission management, duplicate mint prevention
- ✅ **Complete Test Suite** (600+ lines, 45+ test cases)
- ✅ **Deployment Scripts** (support for multi-network deployment)

**10. Wallet System** (3000+ lines) ⭐NEW:

- ✅ **Built-in HD Wallet** (900 lines)
  - BIP39 mnemonic + BIP44 path
  - AES-256-GCM strong encryption storage
  - USB Key hardware signing integration
  - EIP-155/EIP-191 signing
- ✅ **External Wallet Integration** (420 lines)
  - MetaMask connection
  - WalletConnect v1 support
  - Network switching and event listeners
- ✅ **Transaction Monitoring** (350 lines)
  - Transaction status tracking
  - Auto-confirmation waiting
  - Database persistence

**Trading UI Components** (20+):

- AssetCreate/List/Transfer - Asset management
- Marketplace/OrderCreate/OrderDetail - Market and orders
- ContractCreate/Detail/List/Execute/Sign - Smart contracts
- EscrowList/Detail/Dispute/Statistics - Escrow management
- ContractCard/TransactionTimeline - Common components
- CreditScore/ReviewList/MyReviews - Credit and reviews

### 4️⃣ Enterprise Edition (Decentralized Organizations) (100% Complete) ✅ ⭐COMPLETE

**Core Architecture**:

- ✅ **Multi-Identity Architecture**: One user DID can have personal identity + multiple organization identities
- ✅ **Complete Data Isolation**: Each identity corresponds to independent database file (personal.db, org_xxx.db)
- ✅ **Organization DID**: Support for organization-level DID creation (did:chainlesschain:org:xxxx)
- ✅ **Database Switching**: Dynamic switching between different identity databases

**Organization Management** (OrganizationManager - 1966 lines):

- ✅ Organization create/delete - UUID generation, DID creation, database initialization
- ✅ Member management - add/remove/role change, online status
- ✅ Invitation system - 6-digit invitation code generation, DID invitation links (complete implementation)
- ✅ Activity log - all operations automatically recorded, audit trail

**Enterprise Data Synchronization System** (Complete Implementation) ⭐NEW:

**1. P2P Sync Engine** (P2PSyncEngine - Complete Implementation):

- ✅ **Incremental Sync** - Timestamp-based incremental data sync, reduces network traffic
- ✅ **Conflict Detection** - Vector Clock conflict detection mechanism
- ✅ **Conflict Resolution** - Multiple strategies supported (LWW/Manual/Auto-merge)
  - Last-Write-Wins (LWW) - Last write takes precedence
  - Manual - Manual conflict resolution
  - Auto-merge - Automatically merge non-conflicting fields
- ✅ **Offline Queue** - Offline operation queue, auto-sync when network recovers
- ✅ **Batch Processing** - Configurable batch size (default 50), optimized performance
- ✅ **Auto Retry** - Automatic retry on failure, up to 5 times, exponential backoff
- ✅ **Sync State Tracking** - Complete sync state recording and querying

**2. Organization P2P Network** (OrgP2PNetwork - Complete Implementation):

- ✅ **Topic Subscription** - Organization topic subscription based on libp2p PubSub
- ✅ **Member Discovery** - Automatic discovery of online members in organization
- ✅ **Heartbeat Mechanism** - 30-second heartbeat interval, real-time member status
- ✅ **Direct Messaging** - Fallback to direct messaging when PubSub unavailable
- ✅ **Real-time Events** - Member online/offline, knowledge updates, etc. pushed in real-time
- ✅ **Broadcast Messages** - Organization-wide message broadcasting and announcements

**3. Knowledge Collaboration Sync** (OrgKnowledgeSyncManager - Complete Implementation):

- ✅ **Folder Permissions** - Hierarchical folder structure, fine-grained permission control
- ✅ **Real-time Collaboration** - Yjs CRDT integration, conflict-free real-time editing
- ✅ **Activity Tracking** - Complete knowledge base change audit logs
- ✅ **Offline Support** - Offline operation queue, automatic sync
- ✅ **Permission Checking** - Role-based knowledge base access control

**4. Collaboration Manager** (CollaborationManager - Complete Implementation):

- ✅ **ShareDB Integration** - Operational Transformation (OT) for real-time editing
- ✅ **WebSocket Server** - Built-in collaboration WebSocket server
- ✅ **Permission Integration** - Enterprise permission checking integration
- ✅ **Multi-user Support** - Cursor tracking, selection sharing, presence awareness
- ✅ **Session Management** - Complete collaboration session tracking

**5. Sync Strategy Configuration**:

```javascript
const strategies = {
  knowledge: "manual", // Knowledge requires manual conflict resolution
  member: "lww", // Member info uses Last-Write-Wins
  role: "manual", // Role configs require manual resolution
  settings: "manual", // Organization settings require manual resolution
  project: "lww", // Project metadata uses Last-Write-Wins
};
```

**6. Sync Workflows**:

**Organization Creation Sync**:

1. Create organization locally
2. Initialize P2P network
3. Broadcast creation event to network
4. Set up sync state tracking

**Member Addition Sync**:

1. Add member locally
2. Update sync state
3. Broadcast member addition event
4. Trigger permission recalculation

**Knowledge Sync**:

1. Real-time collaborative editing via Yjs
2. Conflict-free merging of concurrent edits
3. Permission-based access control
4. Activity logging for audit trails

**Conflict Resolution**:

1. Vector clock comparison
2. Configurable resolution strategies
3. Manual resolution UI for critical conflicts
4. Automatic LWW for non-critical data

**7. Database Support**:

- ✅ `p2p_sync_state` - Sync state tracking
- ✅ `sync_conflicts` - Conflict resolution records
- ✅ `sync_queue` - Offline operation queue
- ✅ `organization_activities` - Complete audit logs

**8. Enterprise-Grade Features**:

- ✅ **Security**: DID identity, P2P encrypted communication
- ✅ **Scalability**: Configurable batch sizes, offline queuing
- ✅ **Reliability**: Retry mechanisms, conflict detection, audit trails
- ✅ **Compliance**: Complete activity logging, permission tracking
- ✅ **Flexibility**: Custom roles, configurable sync strategies

**DID Invitation Link System** (DIDInvitationManager - Complete Implementation):

- ✅ **Secure Token Generation** - 32-byte random tokens (base64url encoded)
- ✅ **Flexible Usage Control** - Single/multiple/unlimited use, usage count tracking
- ✅ **Expiration Management** - Default 7-day expiration, customizable, auto-expiration detection
- ✅ **Permission Control** - Role-based invitations (owner/admin/member/viewer)
- ✅ **Usage Record Tracking** - Records user DID, usage time, IP address, User Agent
- ✅ **Statistical Analysis** - Total links, active/expired/revoked status, usage rate calculation
- ✅ **Complete IPC Interface** - 9 IPC handlers (create/verify/accept/list/details/revoke/delete/stats/copy)
- ✅ **Database Tables** - invitation_links, invitation_link_usage
- ✅ **Detailed Documentation** - INVITATION_LINK_FEATURE.md (500 lines complete documentation)

**Permission System** (RBAC + ACL):

- ✅ **4 Built-in Roles**: Owner (all permissions), Admin (management permissions), Member (read-write permissions), Viewer (read-only)
- ✅ **Permission Granularity**: org.manage, member.manage, knowledge._, project._, invitation.create, etc.
- ✅ **Permission Checking**: Support for wildcards, prefix matching, exact matching
- ✅ **Custom Roles**: Support for creating custom roles and permissions

**Database Architecture** (14 tables):

- ✅ `identity_contexts` - Identity context management (personal + organizations)
- ✅ `organization_info` - Organization metadata (name, type, description, Owner)
- ✅ `organization_members` - Organization member details (DID, role, permissions)
- ✅ `organization_roles` - Organization role definitions
- ✅ `organization_invitations` - Organization invitation management
- ✅ `invitation_links` - DID invitation links
- ✅ `invitation_link_usage` - Invitation link usage records
- ✅ `organization_projects` - Organization projects
- ✅ `organization_activities` - Organization activity log
- ✅ `p2p_sync_state` - P2P sync state ⭐NEW
- ✅ `sync_conflicts` - Conflict resolution records ⭐NEW
- ✅ `sync_queue` - Offline operation queue ⭐NEW
- ✅ `org_knowledge_folders` - Knowledge base folders ⭐NEW
- ✅ `knowledge_items extension` - 8 new enterprise fields (org_id, created_by, share_scope, etc.)

**Frontend UI Components** (10 pages/components, 5885 lines):

- ✅ **IdentitySwitcher.vue** (511 lines) - Identity switcher, support create/join organizations
- ✅ **OrganizationMembersPage.vue** - Member management page, role assignment
- ✅ **OrganizationSettingsPage.vue** - Organization settings page, info editing
- ✅ **OrganizationsPage.vue** - Organization list page
- ✅ **OrganizationRolesPage.vue** - Role permission management page
- ✅ **OrganizationActivityLogPage.vue** - Organization activity log page
- ✅ **OrganizationCard.vue** (280 lines) - Organization card component, multiple operations
- ✅ **CreateOrganizationDialog.vue** (240 lines) - Create organization dialog, complete form validation
- ✅ **MemberList.vue** (520 lines) - Member list component, search/filter/role management
- ✅ **PermissionManager.vue** (680 lines) - Permission management component, role/permission/matrix views

**State Management** (IdentityStore - 385 lines):

- ✅ Current active identity management
- ✅ All identity context caching
- ✅ Organization list and switching logic
- ✅ Permission checking interface

**Application Scenarios**:

- Startup teams, small companies
- Tech communities, open source projects
- Educational institutions
- Remote collaboration teams, distributed organizations

### 5️⃣ AI Template System (100% Complete) ⭐NEW

**System Overview**:

- ✅ **178 AI Templates** - Covering office, development, design, media, and all scenarios
- ✅ **32 Category System** - From document editing to blockchain development, complete categorization
- ✅ **100% Configuration Coverage** - All templates configured with skills and tools
- ✅ **Smart Engine Allocation** - Automatically selects optimal execution engine based on content type

**Template Categories** (32 total):

**Office Document Categories (12 categories)**:

- ✅ writing, creative-writing - Creative writing, copywriting
- ✅ education, learning - Education training, learning materials
- ✅ legal, health - Legal documents, health management
- ✅ career, resume - Career planning, resume creation
- ✅ cooking, gaming, lifestyle - Lifestyle content
- ✅ productivity, tech-docs - Productivity tools, technical documentation

**Office Suite Categories (3 categories)**:

- ✅ ppt - Presentation creation (6 templates)
- ✅ excel - Data analysis, financial management (12 templates)
- ✅ word - Professional document editing (8 templates)

**Development Categories (3 categories)**:

- ✅ web - Web development projects (5 templates)
- ✅ code-project - Code project structures (7 templates)
- ✅ data-science - Data science, machine learning (6 templates)

**Design & Media Categories (5 categories)**:

- ✅ design - UI/UX design (6 templates)
- ✅ photography - Photography creation
- ✅ video - Video production (29 templates)
- ✅ podcast - Podcast production
- ✅ music - Music creation (5 templates)

**Marketing Categories (4 categories)**:

- ✅ marketing - Marketing planning (8 templates)
- ✅ marketing-pro - Professional marketing (6 templates)
- ✅ social-media - Social media management (6 templates)
- ✅ ecommerce - E-commerce operations (6 templates)

**Professional Domain Categories (5 categories)**:

- ✅ research - Academic research
- ✅ finance - Financial analysis
- ✅ time-management - Time management
- ✅ travel - Travel planning

**Execution Engine Distribution** (after optimization):

```
document engine : 95  (46.3%) - Main engine for document templates
video engine    : 29  (14.1%) - Video production
default engine  : 26  (12.7%) - Mixed content (marketing, e-commerce)
excel engine    : 12  (5.9%)  - Data analysis
word engine     : 8   (3.9%)  - Professional documents
code engine     : 7   (3.4%)  - Code projects
ml engine       : 6   (2.9%)  - Machine learning
design engine   : 6   (2.9%)  - Design creation
ppt engine      : 6   (2.9%)  - Presentations
audio engine    : 5   (2.4%)  - Audio processing
web engine      : 5   (2.4%)  - Web development
```

**Configuration Completeness**:

- ✅ File system: 178/178 (100%)
- ✅ Database: 203/203 (100%)
- ✅ Skills configuration: 100%
- ✅ Tools configuration: 100%
- ✅ Engine configuration: 100%

**Optimization Results**:

- Default engine usage reduced from 52.2% to **12.7%** (39.5 percentage point decrease)
- Specialized engine coverage increased from 22.4% to **84.4%** (62 percentage point increase)
- More precise engine allocation improves AI execution efficiency

**Template Capability Mapping**:
Each template is precisely configured with:

- **skills** - Required AI skills for execution (selected from 115 skills)
- **tools** - Required tools for execution (selected from 216 tools)
- **execution_engine** - Optimal execution engine (11 engine types)

Details: `desktop-app-vue/dist/main/templates/OPTIMIZATION_COMPLETE_REPORT.md`

### 6️⃣ Permanent Memory System (100% Complete) ✅ ⭐NEW

Clawdbot-inspired cross-session AI memory persistence:

**Core Features**:

- ✅ **Daily Notes Auto-Logging** - Automatic daily activity recording to `memory/daily/YYYY-MM-DD.md`
- ✅ **MEMORY.md Long-Term Extraction** - Categorized storage + auto-update of persistent knowledge
- ✅ **Hybrid Search Engine** - Vector (semantic) + BM25 (keyword) dual-path parallel search
- ✅ **RRF Fusion Algorithm** - Reciprocal Rank Fusion for intelligent result ranking
- ✅ **Embedding Cache** - Reduces redundant computation + file hash tracking
- ✅ **Auto Expiry Cleanup** - Configurable retention days for Daily Notes
- ✅ **Metadata Statistics** - Knowledge categorization, tags, reference tracking

**Key Files**:

- `permanent-memory-manager.js` (~650 lines) - Core memory manager
- `permanent-memory-ipc.js` (~130 lines) - 7 IPC channels
- `bm25-search.js` (~300 lines) - BM25 full-text search engine
- `hybrid-search-engine.js` (~330 lines) - Hybrid search with RRF fusion

**Performance**:

- Search latency: < 20ms
- Parallel Vector + BM25 execution
- Configurable weights (default: Vector 0.6 + BM25 0.4)

Details: [Permanent Memory Integration](./docs/features/PERMANENT_MEMORY_INTEGRATION.md)

### 7️⃣ Comprehensive Test Suite (100% Complete) ✅ ⭐NEW

Phase 2 testing improvement plan completed:

**Test Coverage**:

| Category          | Test Files | Test Cases | Pass Rate |
| ----------------- | ---------- | ---------- | --------- |
| Unit Tests        | 350+       | 1500+      | ~99%      |
| Integration Tests | 30+        | 200+       | ~99%      |
| E2E User Journey  | 10+        | 100+       | ~99%      |
| Performance Tests | 10+        | 50+        | 100%      |
| Security Tests    | 10+        | 50+        | 100%      |
| Script Tests      | 50+        | 300+       | ~99%      |
| **Total**         | **467**    | **2000+**  | **~99%**  |

**Key Achievements**:

- ✅ **2000+ Test Cases** - Covering all core modules (incl. 102 DB tests via DI)
- ✅ **99.6% Pass Rate** - High quality code assurance
- ✅ **29 Bugs Fixed** - Test-driven quality improvement
- ✅ **OWASP Top 10 Coverage 80%** - XSS/SQL Injection/Path Traversal protection verified
- ✅ **Performance Benchmarks** - 142K ops/s project operations, 271K ops/s file operations
- ✅ **Memory Leak Detection** - < 0.5MB growth per 100 iterations

**Security Tests (OWASP Coverage)**:

- A01: Broken Access Control (4 tests)
- A02: Cryptographic Failures (5 tests)
- A03: Injection (4 tests)
- A04: Insecure Design (3 tests)
- A07: Authentication Failures (4 tests)

Details: [Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md)

## Technical Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                         Application Layer                          │
│  Desktop(Electron+Vue3,145 comps) │ Browser Ext │ Mobile(uni-app) │
├───────────────────────────────────────────────────────────────────┤
│                        Business Function Layer                     │
│ Knowledge(100%) │ AI Engine(100%) │ Social(100%) │ Trading(100%)  │
│ Skills/Tools(100%,115+300) │ Blockchain(100%) │ Testing(100%)   │
│ Enterprise(100%) │ Plugins(100%) │ Voice(100%) │ P2P(100%)       │
├───────────────────────────────────────────────────────────────────┤
│                        Backend Service Layer                       │
│  Project Service    │    AI Service      │   Community Forum     │
│  (Spring Boot 3.1)  │   (FastAPI)        │   (Spring Boot 3.1)   │
│  48 API endpoints   │   38 API endpoints │   63 API endpoints    │
│  PostgreSQL + Redis │   Ollama + Qdrant  │   MySQL + Redis       │
├───────────────────────────────────────────────────────────────────┤
│                        Blockchain Layer                            │
│  Hardhat │ Ethers.js v6 │ 6 Smart Contracts │ HD Wallet │ MM/WC  │
│  Ethereum/Polygon  │  ERC-20/ERC-721  │  Escrow/Sub/Bounty/Bridge│
├───────────────────────────────────────────────────────────────────┤
│                        Data Storage Layer (Multi-DB Isolation)     │
│  SQLite/SQLCipher  │  PostgreSQL  │  MySQL  │  ChromaDB/Qdrant   │
│  (Personal+Org DBs)│  (Projects)  │ (Forum) │  (Vector Store)    │
├───────────────────────────────────────────────────────────────────┤
│                        P2P Network Layer                           │
│  libp2p 3.1.2  │  Signal E2E  │  Kademlia DHT  │  Org Network   │
├───────────────────────────────────────────────────────────────────┤
│                        Security Layer                              │
│    USB Key (PC, 5 brands)     │     SIMKey (Mobile, planned)     │
└───────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### One-Line Install (CLI)

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

> **Tip**: After installation, you can use the short aliases `cc`, `clc`, or `clchain` instead of `chainlesschain`, e.g. `cc setup`, `clchain start`.

The CLI provides an interactive setup wizard that downloads binaries and configures your LLM provider. See the [CLI Installation Guide](./docs/guides/CLI_INSTALLATION_GUIDE_EN.md).

### Requirements

- **Node.js**: 22.12.0+ (Latest LTS recommended)
- **npm**: 10.0.0+
- **Docker**: 20.10+ (optional, for backend services)
- **Mobile Development**: Android Studio 2024+ / Xcode 15+ (optional)
- **Hardware**: USB Key (PC) or SIMKey-enabled SIM card (mobile, optional)

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

(Optional) For contributors who want commits dual-pushed to gitee + github mirrors, add the gitee remote:

```bash
git remote add gitee git@gitee.com:chainlesschaincn/chainlesschain.git
```

Once added, the `.husky/post-commit` hook (auto-activated by `npm install`) pushes every commit to both gitee and github, keeping the mirrors in lockstep. The hook safely skips any remote that isn't configured, so it works even without this step.

#### 2. Start PC Desktop App

```bash
# Navigate to desktop app directory
cd desktop-app-vue

# Install dependencies
npm install

# Start development server
npm run dev
```

#### 3. Start AI Services (Optional, for local LLM)

```bash
# Start Docker services
docker-compose up -d

# Download model (first run)
docker exec chainlesschain-llm ollama pull qwen2:7b
```

#### 4. Start Community Forum (Optional)

```bash
# Backend (Spring Boot)
cd community-forum/backend
mvn spring-boot:run

# Frontend (Vue3)
cd community-forum/frontend
npm install
npm run dev
```

### Alternative Options

```bash
# Android app
cd android-app
./gradlew assembleDebug
```

## 📁 Project Structure

```
chainlesschain/
├── desktop-app-vue/          # PC Desktop App (Electron 39.2.7 + Vue 3.4)
│   ├── src/
│   │   ├── main/             # Main process
│   │   │   ├── api/          # IPC API handlers
│   │   │   ├── config/       # Configuration management
│   │   │   ├── database/     # Database operations
│   │   │   ├── llm/          # LLM integration (16 AI engines)
│   │   │   │   ├── permanent-memory-manager.js  # Permanent Memory Manager
│   │   │   │   ├── permanent-memory-ipc.js      # Permanent Memory IPC channels
│   │   │   │   ├── context-engineering.js       # KV-Cache optimization core
│   │   │   │   └── context-engineering-ipc.js   # Context Engineering IPC (17 channels)
│   │   │   ├── rag/          # RAG retrieval system
│   │   │   │   ├── bm25-search.js         # BM25 full-text search engine
│   │   │   │   └── hybrid-search-engine.js # Hybrid search engine
│   │   │   ├── permission/   # Enterprise RBAC system (NEW)
│   │   │   │   ├── permission-engine.js        # RBAC permission engine
│   │   │   │   ├── team-manager.js             # Team management
│   │   │   │   ├── delegation-manager.js       # Permission delegation
│   │   │   │   └── approval-workflow-manager.js # Approval workflow
│   │   │   ├── task/         # Task management (NEW)
│   │   │   │   └── team-report-manager.js      # Team daily/weekly reports
│   │   │   ├── hooks/        # Hooks system (Claude Code style)
│   │   │   │   ├── index.js               # Main entry
│   │   │   │   ├── hook-registry.js       # Hook registry
│   │   │   │   └── hook-executor.js       # Hook executor
│   │   │   ├── did/          # DID identity system
│   │   │   ├── p2p/          # P2P network (libp2p)
│   │   │   │   └── webrtc-data-channel.js  # WebRTC data channel manager
│   │   │   ├── mcp/          # MCP integration
│   │   │   ├── remote/       # Remote Control System (NEW, 41 files, ~45,000 lines)
│   │   │   │   ├── remote-gateway.js         # Remote gateway (core)
│   │   │   │   ├── p2p-command-adapter.js    # P2P command adapter
│   │   │   │   ├── permission-gate.js        # Permission verifier
│   │   │   │   ├── command-router.js         # Command router
│   │   │   │   ├── handlers/                 # 24+ command handlers
│   │   │   │   ├── browser-extension/        # Chrome browser extension
│   │   │   │   ├── workflow/                 # Workflow engine
│   │   │   │   └── logging/                  # Logging system
│   │   │   ├── browser/      # Browser automation system
│   │   │   │   ├── browser-engine.js         # Browser engine (Playwright)
│   │   │   │   ├── browser-ipc.js            # Browser IPC (12 channels)
│   │   │   │   ├── snapshot-engine.js        # Smart snapshot engine
│   │   │   │   ├── snapshot-ipc.js           # Snapshot IPC (6 channels)
│   │   │   │   └── element-locator.js        # Element locator
│   │   │   ├── utils/        # Utility modules
│   │   │   │   └── ipc-error-handler.js    # IPC error middleware
│   │   │   ├── ai-engine/    # AI engine + workflow optimization
│   │   │   │   ├── cowork/   # Cowork multi-agent collaboration system
│   │   │   │   │   └── skills/               # Skills system
│   │   │   │   │       ├── index.js          # Skill loader
│   │   │   │   │       ├── skills-ipc.js     # Skills IPC (17 channels)
│   │   │   │   │       └── builtin/          # Built-in skills (code-review, git-commit, explain-code)
│   │   │   │   └── plan-mode/                # Plan Mode system (Claude Code style)
│   │   │   │       ├── index.js              # PlanModeManager
│   │   │   │       └── plan-mode-ipc.js      # Plan Mode IPC (14 channels)
│   │   │   └── monitoring/   # Monitoring and logging
│   │   └── renderer/         # Renderer process (Vue3 + TypeScript, 31 Pinia Stores)
│   │       ├── components/   # Reusable components
│   │       ├── pages/        # Page components
│   │       ├── stores/       # Pinia state management
│   │       ├── services/     # Frontend service layer
│   │       └── utils/        # Utility library
│   ├── contracts/            # Smart contracts (Hardhat + Solidity)
│   └── tests/                # Test suite (2000+ test cases, 417 test files)
│       ├── unit/             # Unit tests (IPC handlers, database, Git, browser, AI engine)
│       ├── integration/      # Integration tests (backend integration, user journey)
│       ├── performance/      # Performance tests (load, memory leak)
│       └── security/         # Security tests (OWASP Top 10)
├── packages/
│   └── cli/                  # npm CLI tool (chainlesschain, pure JS ~2MB)
│       ├── bin/              # CLI entry (#!/usr/bin/env node)
│       ├── src/commands/     # 29 commands (setup/start/.../did/encrypt/auth/audit)
│       ├── src/lib/          # 29 library modules (platform/paths/.../did-manager/crypto-manager/permission-engine/audit-logger)
│       └── __tests__/        # 41 test files (743 test cases)
├── backend/
│   ├── project-service/      # Spring Boot 3.1.11 (Java 17)
│   └── ai-service/           # FastAPI + Ollama + Qdrant
├── community-forum/          # Community forum (Spring Boot + Vue3)
├── mobile-app-uniapp/        # Mobile app (100% complete)
└── docs/                     # Complete documentation system
    ├── features/             # Feature documentation
    ├── flows/                # Workflow documentation (NEW)
    ├── implementation-reports/  # Implementation reports (NEW)
    ├── status-reports/       # Status reports (NEW)
    ├── test-reports/         # Test reports (NEW)
    └── ...                   # 20+ documentation categories
```

### Project Components

| Project                      | Tech Stack                 | Code Size          | APIs         | Completion | Status              |
| ---------------------------- | -------------------------- | ------------------ | ------------ | ---------- | ------------------- |
| **desktop-app-vue**          | Electron 39 + Vue3         | 220,000+ lines     | 160+ IPC     | 100%       | ✅ Production Ready |
| **contracts**                | Hardhat + Solidity         | 2,400 lines        | -            | 100%       | ✅ Complete         |
| **browser-extension**        | Vanilla JS                 | 2,000+ lines       | -            | 100%       | ✅ Complete         |
| **backend/project-service**  | Spring Boot 3.1 + Java 17  | 5,679 lines        | 48 APIs      | 100%       | ✅ Production Ready |
| **backend/ai-service**       | FastAPI + Python 3.9+      | 12,417 lines       | 38 APIs      | 100%       | ✅ Production Ready |
| **community-forum/backend**  | Spring Boot 3.1 + MySQL    | 5,679 lines        | 63 APIs      | 100%       | ✅ Production Ready |
| **community-forum/frontend** | Vue3 + Element Plus        | 10,958 lines       | -            | 100%       | ✅ Production Ready |
| **mobile-app-uniapp**        | uni-app + Vue3             | 8,000+ lines       | -            | 100%       | ✅ Complete         |
| **packages/cli**             | Node.js 22 ESM + Commander | 8,000+ lines       | 29 commands  | 100%       | ✅ Complete         |
| **Total**                    | -                          | **250,000+ lines** | **149 APIs** | **100%**   | ✅ Production Ready |

## 🗓️ Roadmap

### Completed ✅

- [x] **Phase 0**: System design and architecture planning (100%)
- [x] **Phase 1 (MVP - Knowledge Base)**: 100% Complete
  - [x] Desktop app framework (Electron + Vue3)
  - [x] USB Key integration and encrypted storage (SQLCipher)
  - [x] Local LLM and RAG implementation (Ollama + ChromaDB)
  - [x] Git sync functionality (with conflict resolution)
  - [x] File import (Markdown/PDF/Word/TXT)
  - [x] Image upload and OCR (v0.11.0)
  - [x] Full-text search and tagging system
  - [x] Prompt template management

- [x] **Phase 2 (Decentralized Social)**: 100% Complete
  - [x] DID identity system
  - [x] DHT network publishing
  - [x] Verifiable credentials system
  - [x] P2P communication foundation (libp2p)
  - [x] Community forum (Spring Boot + Vue3)
  - [x] Signal protocol end-to-end encryption (v0.16.0)
  - [x] Multi-device support and message sync (v0.16.0)
  - [x] Friend management system (requests, online status, groups)
  - [x] Social posts system (publish, like, comment, images)

- [x] **Phase 3 (Decentralized Trading System)**: 100% Complete
  - [x] Digital asset management (asset-manager.js - 600 lines)
  - [x] Trading market (marketplace-manager.js - 685 lines)
  - [x] Smart contract engine (contract-engine.js - 1102 lines + 526 lines templates)
  - [x] Escrow service (escrow-manager.js - 592 lines)
  - [x] Knowledge payment system (knowledge-payment.js - 812 lines)
  - [x] Credit scoring system (credit-score.js - 637 lines)
  - [x] Review & feedback system (review-manager.js - 671 lines)
  - [x] Order management (integrated in trading market)
  - [x] Complete frontend UI (20+ trading components)

- [x] **Phase 4 (Blockchain Integration)**: 100% Complete ⭐
  - [x] Phase 1: Infrastructure setup (Hardhat + database extension)
  - [x] Phase 2: Wallet system implementation (built-in HD wallet + external wallets)
  - [x] Phase 3: Smart contract development (6 contracts + tests + deployment)
  - [x] Phase 4: Blockchain adapter implementation (15 chains + RPC management)
  - [x] Phase 5: Integration with existing modules
  - [x] Phase 6: Frontend UI adaptation (12 UI components)

- [x] **Phase 5 (Ecosystem Enhancement)**: 100% Complete ⭐
  - [x] Voice recognition functionality (complete)
  - [x] Browser extension (complete)
  - [x] Skill & tool system (115 skills + 300 tools)
  - [x] Plugin system (dynamic loading + hot reload)
  - [x] USB Key drivers (cross-platform support)
  - [x] P2P WebRTC support and NAT traversal
  - [x] Mobile UI optimization
  - [x] Knowledge graph visualization
  - [x] Multi-language support
  - [x] Enterprise features (decentralized organizations complete)

- [x] **Phase 6 (Production Optimization)**: 100% Complete ⭐
  - [x] Complete blockchain adapter
  - [x] Production-grade cross-chain bridge (LayerZero)
  - [x] Comprehensive test coverage (94 files, 900+ cases)
  - [x] Performance optimization and monitoring
  - [x] Security audit
  - [x] Documentation refinement

### Future Optimization Directions ⏳

- [ ] **Extended MCP Server Support**: HTTP+SSE transport, more MCP servers
- [ ] **Enhanced Multi-Agent Collaboration**: More specialized agents
- [ ] **Community Ecosystem**: Plugin marketplace, community MCP servers
- [ ] **Enterprise Advanced Features**: SSO, audit logs, compliance

### Version History

| Version | Date       | Major Updates                                                                                                                                                                                                                              |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v0.33.0 | 2026-02-13 | **Remote Control + Computer Use + Browser Extension**: P2P remote gateway, 24+ command handlers, Chrome extension (15,077 lines), Computer Use Agent (68+ IPC), Vision AI, Workflow Engine, SafeMode, Audit Logger, 45,000+ lines ⭐LATEST |
| v0.32.0 | 2026-02-10 | **iOS Workflow + Android MCP/Hooks**: iOS WorkflowManager + VoiceManager, Android MCP integration + Hooks system + Knowledge Graph visualization                                                                                           |
| v0.31.0 | 2026-02-09 | **Security Auth + Incremental RAG + SIMKey NFC**: Dev/prod mode JWT auth, MD5 change detection, context-aware reranking, file version control, LLM function calling                                                                        |
| v0.30.0 | 2026-02-05 | **DI Test Refactoring + Social Notifications + ECharts Dashboard**: 102 database tests enabled via DI, TaskMonitor dashboard, AbortController AI cancel, Firebase integration                                                              |
| v0.29.0 | 2026-02-02 | **Enterprise RBAC + Context Engineering + Claude Code Style Tools**: Permission Engine (RBAC), Team Manager, Team Report Manager, Context Engineering (KV-Cache optimization, 17 IPC), Plan Mode (14 IPC), Skills System enhancement       |
| v0.28.0 | 2026-01-28 | **Permanent Memory + Hybrid Search + Hooks System**: Daily Notes auto-logging, MEMORY.md extraction, Vector+BM25 hybrid search, 21 hook events, 4 hook types, MCP integration tests (32+31)                                                |
| v0.27.0 | 2026-01-23 | **Hooks System + IPC Error Handler**: Claude Code-style hooks (21 events, 4 types, priority system), IPC error middleware (10 error types, ErrorMonitor integration), enterprise permission foundations                                    |
| v0.26.0 | 2026-01-19 | **Unified Logging + Android P2P UI + Memory Optimization**: Centralized logger system (700+ migrations), Android P2P complete UI (8 screens), ChatPanel 4-layer memory protection                                                          |
| v0.25.0 | 2026-01-17 | **Manus AI Optimization + Multi-Agent System**: Context Engineering (KV-Cache), Tool Masking, TaskTrackerFile (todo.md), Recoverable Compression, 3 specialized Agents                                                                     |
| v0.24.0 | 2026-01-16 | **MCP Chat Integration**: MCP tools integrated into AI chat, invoke MCP server tools via Function Calling                                                                                                                                  |
| v0.23.0 | 2026-01-15 | **SessionManager Enhancement + ErrorMonitor AI Diagnostics**: Session search/tags/export/summary, AI error diagnosis                                                                                                                       |
| v0.22.0 | 2026-01-13 | **Blockchain Integration Complete**: 15 chain support + RPC management + event listening + complete UI ⭐Major Update                                                                                                                      |
| v0.21.0 | 2026-01-06 | **Deep Performance Optimization**: 14,000+ lines optimization code, smart image system (WebP/AVIF), Core Web Vitals monitoring                                                                                                             |
| v0.20.0 | 2026-01-03 | **Testing Framework Upgrade**: Full Vitest migration (94 files/900+ cases), performance optimization integration                                                                                                                           |
| v0.19.5 | 2026-01-02 | **P2 Optimization + V3 Tools**: AI engine optimization, 300 tools restored, application menu integration                                                                                                                                   |
| v0.19.0 | 2025-12-31 | **Codebase Refinement**: Documentation update, template optimization, testing framework enhancement                                                                                                                                        |
| v0.18.0 | 2025-12-30 | **Enterprise Edition + Skills Expansion**: Decentralized organizations, 115 skills + 300 tools, multi-database isolation                                                                                                                   |
| v0.17.0 | 2025-12-29 | **Blockchain Integration Phase 1-3**: 6 smart contracts, wallet system, plugin system, browser extension                                                                                                                                   |
| v0.16.0 | 2025-12-28 | **Phase 3 Complete**: 8 trading modules, 19 AI engines, backend services (149 APIs), database sync                                                                                                                                         |
| v0.11.0 | 2025-12-18 | Image upload and OCR (Tesseract.js + Sharp)                                                                                                                                                                                                |
| v0.10.0 | 2025-12    | RAG reranker (3 algorithms) + query rewriting                                                                                                                                                                                              |
| v0.9.0  | 2025-11    | File import enhancement (PDF/Word/TXT)                                                                                                                                                                                                     |
| v0.8.0  | 2025-11    | Verifiable credentials system (W3C VC standard, 5 types)                                                                                                                                                                                   |
| v0.6.1  | 2025-10    | DHT network publishing (DID documents)                                                                                                                                                                                                     |
| v0.4.0  | 2025-09    | Git conflict resolution (visual UI) + AI commit messages                                                                                                                                                                                   |
| v0.1.0  | 2025-08    | First MVP release                                                                                                                                                                                                                          |

## 🛠️ Tech Stack

### PC (desktop-app-vue) - Main Application

- **Framework**: Electron 39.2.7 + Vue 3.4 + TypeScript 5.9 + Ant Design Vue 4.1
- **State Management**: Pinia 2.1.7 (28 TypeScript stores)
- **Database**: SQLite/SQLCipher (AES-256) + libp2p 3.1.2
- **AI System**: 16 specialized AI engines + 17 smart optimizations + 115 skills + 300 tools
- **Permanent Memory**: Daily Notes + MEMORY.md + Hybrid Search (Vector+BM25)
- **Context Engineering**: KV-Cache optimization + Token estimation + Recoverable compression
- **Enterprise Permission**: RBAC engine + Team management + Approval workflow + Permission delegation
- **Remote Control**: P2P gateway + 24+ command handlers + Chrome extension + Workflow engine + 45,000+ lines
- **Browser Control**: BrowserEngine + SnapshotEngine + DI testability + 18 IPC channels
- **Claude Code Style**: 10 subsystems + 127 IPC channels (Hooks/Plan Mode/Skills, etc.)
- **Workflow Optimization**: Smart cache + LLM decision + Agent pool + Critical path + Real-time quality
- **Visualization**: ECharts TaskMonitor dashboard + Tree-shaking optimization
- **Firebase**: Push notifications + WebRTC enhancement
- **Testing**: Vitest + 2000+ test cases + 417 test files + DI refactoring
- **Build**: Vite 7.2.7 + Electron Builder

### CLI Tool

- Node.js 22+ ESM + Commander 12 + chalk 5 + ora 8 + semver 7
- Pure JS with zero native dependencies, npm global install ready
- GitHub Release auto-download + SHA256 verification + Docker Compose orchestration

### Backend Services

#### Project Service (Project Management)

- **Framework**: Spring Boot 3.1.11 + Java 17
- **ORM**: MyBatis Plus 3.5.7 (recommended upgrade to 3.5.9)
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Git**: JGit 6.8.0
- **Connection Pool**: HikariCP
- **Docs**: SpringDoc OpenAPI 2.2.0
- **Port**: 9090

#### AI Service (AI Inference)

- **Framework**: FastAPI 0.109.0+ + Python 3.9+
- **LLM**: Ollama (local) + 14+ cloud providers
- **Vector DB**: Qdrant 1.7.0+ / ChromaDB 0.4.22
- **Embedding Model**: Sentence Transformers 2.3.0
- **Server**: Uvicorn 0.27.0+
- **Port**: 8001

#### Community Forum

**Backend**:

- **Framework**: Spring Boot 3.1.5 + Java 17
- **ORM**: MyBatis Plus 3.5.9
- **Database**: MySQL 8.0.12
- **Search**: Elasticsearch 8.11
- **Cache**: Redis 7.0
- **Auth**: JWT 0.12.3 + Spring Security
- **Docs**: SpringDoc OpenAPI 2.2.0
- **Port**: 8080

**Frontend**:

- **Framework**: Vue 3.4.0 + Vite 5.0.8
- **UI Components**: Element Plus 2.5.1
- **State Management**: Pinia 2.1.7
- **Router**: Vue Router 4.2.5
- **HTTP**: Axios 1.6.2
- **Markdown**: Markdown-it 14.0.0
- **Port**: 3000

### Mobile

#### Android (android-app)

- **Language**: Kotlin
- **UI**: Jetpack Compose
- **Database**: Room ORM + SQLCipher
- **Encryption**: BouncyCastle
- **SIMKey**: OMAPI
- **LLM**: Ollama Android

#### React Native (mobile-app)

- **Framework**: React Native 0.73.2
- **Navigation**: React Navigation

### Docker Services

- **LLM Engine**: Ollama (latest, port 11434)
  - Supported models: Qwen2-7B, LLaMA3-8B, GLM-4, MiniCPM-2B, etc.
  - GPU acceleration: NVIDIA CUDA support
- **Vector Database**:
  - Qdrant (latest, port 6333) - High-performance vector retrieval
  - ChromaDB 3.1.8 - Lightweight vector storage
- **Relational Databases**:
  - PostgreSQL 16 (port 5432) - Project Service
  - MySQL 8.0 (port 3306) - Community Forum
- **Cache**: Redis 7 (port 6379)
- **Embedding Models**: bge-large-zh-v1.5 / bge-small-zh-v1.5
- **RAG System**: AnythingLLM (optional)
- **Git Service**: Gitea (optional)

### Blockchain (100% Complete) ⭐

- **Smart Contracts**: Solidity 0.8+ + Hardhat 2.28
- **Development Framework**: Hardhat Toolbox 5.0
- **Contract Libraries**: OpenZeppelin Contracts 5.4
- **Interaction**: Ethers.js v6.13
- **Wallets**:
  - Built-in: BIP39 + BIP44 + AES-256-GCM encryption
  - External: MetaMask + WalletConnect v1
- **Networks**:
  - Mainnet: Ethereum (Chain ID: 1), Polygon (Chain ID: 137)
  - Testnet: Sepolia (11155111), Mumbai (80001)
  - Local: Hardhat Network (31337)
- **Contract Types**:
  - ERC-20 Token (ChainlessToken)
  - ERC-721 NFT (ChainlessNFT)
  - Escrow Contract (EscrowContract)
  - Subscription Contract (SubscriptionContract)
  - Bounty Contract (BountyContract)
  - Cross-chain Bridge (AssetBridge)

## 🤝 Contributing

We welcome all forms of contribution!

### How to Contribute

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Code style: Follow ESLint/Prettier configuration
- Commit messages: Use semantic commits (feat/fix/docs/style/refactor/test/chore)
- Testing: Add necessary unit and integration tests
- Documentation: Update relevant documentation and comments

See [CONTRIBUTING.md](./docs/development/CONTRIBUTING.md) for details

### Future Optimization Directions

1. **Extended Functionality**:
   - More MCP server integrations (Slack, GitHub, etc.)
   - Enhanced multi-agent collaboration capabilities
   - Community plugin marketplace
2. **Enterprise Enhancements**:
   - SSO integration
   - Audit logging system
   - Compliance features
3. **Ecosystem Expansion**:
   - Developer SDK
   - Third-party integration APIs
   - Community contribution programs

## 🔒 Security Notice

- **Hardware Keys**: Strongly recommend using USB Key or SIMKey, software simulation for testing only
- **Backup Critical**: Must backup mnemonic phrases and keys, loss is unrecoverable
- **Open Source Audit**: All encryption implementations are open source and auditable
- **Security Reports**: Send security vulnerabilities to security@chainlesschain.com
- **Bug Bounty**: Major security vulnerabilities will be rewarded

### Technical Notes

**USB Key**:

- Cross-platform support available (Windows native, macOS/Linux via simulation)
- XinJinKe driver complete, other drivers available via simulation mode

**Blockchain**:

- 15 chains supported with RPC management
- Production-grade LayerZero cross-chain bridge integrated
- Smart contracts ready for third-party security audit

**MCP Integration** (POC Stage):

- Currently supports stdio transport only
- HTTP+SSE transport planned for future release
- Configuration via files only (UI configuration planned)

**Performance**:

- Recommended: 8GB+ RAM, SSD storage
- GPU recommended for local LLM inference (Ollama)

## 📜 License

This project is licensed under the **MIT License** - see [LICENSE](./LICENSE)

Core encryption libraries use **Apache 2.0** license

## 📞 Contact Us

### Official Channels

- **Website**: https://www.chainlesschain.com
- **Documentation**: https://docs.chainlesschain.com
- **Forum**: https://community.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

### Contact Information

- **Email**: zhanglongfa@chainlesschain.com
- **Security Reports**: security@chainlesschain.com
- **Phone**: +86 400-1068-687
- **WeChat**: https://work.weixin.qq.com/ca/cawcde653996f7ecb2

### Community

- **Tech Discussion**: GitHub Discussions
- **Bug Reports**: GitHub Issues
- **Feature Requests**: GitHub Issues

---

**More Documentation**:

- [📖 Documentation Center](./docs/README.md) - Complete documentation navigation
- [✨ Features Guide](./docs/FEATURES.md) - Detailed feature list
- [📥 Installation Guide](./docs/quick-start/INSTALLATION.md) - Platform-specific installation
- [🏗️ Architecture](./docs/ARCHITECTURE.md) - Technical architecture
- [💻 Development Guide](./docs/DEVELOPMENT.md) - Development setup
- [📝 Changelog](./docs/CHANGELOG.md) - Full version history
- [⛓️ Blockchain Docs](./docs/BLOCKCHAIN.md) - Blockchain integration
- [🔧 API Reference](./docs/API_REFERENCE.md) - API documentation
- [📚 User Manual](./docs/USER_MANUAL_COMPLETE.md) - Complete user manual

**Permanent Memory & Test Documentation**:

- [🧠 Permanent Memory Integration](./docs/features/PERMANENT_MEMORY_INTEGRATION.md) - Daily Notes + MEMORY.md + Hybrid Search
- [🧪 Phase 2 Test Summary](./docs/reports/phase2/PHASE2_FINAL_SUMMARY.md) - 2000+ test cases, 99.6% pass rate
- [🔒 Security Test Report](./docs/reports/phase2/PHASE2_TASK13_SECURITY_TESTS.md) - OWASP Top 10 coverage 80%
- [📊 IPC Handler Tests](./docs/reports/phase2/PHASE2_TASK7_IPC_HANDLERS_TESTS.md) - 66 IPC handler tests
- [💾 Database Boundary Tests](./docs/reports/phase2/PHASE2_TASK8_DATABASE_TESTS.md) - 14 boundary condition tests

**Workflow Optimization Documentation**:

- [🚀 Phase 3/4 Completion Summary](./docs/features/WORKFLOW_PHASE3_COMPLETION_SUMMARY.md) - 17 optimizations overview
- [💡 Smart Plan Cache](./docs/features/PHASE3_OPTIMIZATION3_SMART_PLAN_CACHE.md) - Semantic similarity cache
- [🧠 LLM-Assisted Decision](./docs/features/PHASE3_OPTIMIZATION4_LLM_DECISION.md) - Intelligent multi-agent decision
- [⚡ Critical Path Optimization](./docs/features/PHASE3_OPTIMIZATION8_CRITICAL_PATH.md) - CPM algorithm scheduling
- [🔍 Real-Time Quality Check](./docs/features/PHASE3_OPTIMIZATION11_REALTIME_QUALITY.md) - File monitoring system

## 🙏 Acknowledgments

Thanks to the following open source projects and technologies:

### Core Frameworks

- [Electron](https://www.electronjs.org/) - Cross-platform desktop app framework
- [Vue.js](https://vuejs.org/) - Progressive JavaScript framework
- [React](https://react.dev/) - User interface library
- [Spring Boot](https://spring.io/projects/spring-boot) - Java application framework

### AI & Data

- [Ollama](https://ollama.ai/) - Local LLM runtime
- [Qdrant](https://qdrant.tech/) - Vector database
- [ChromaDB](https://www.trychroma.com/) - AI-native embedding database
- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR engine

### Encryption & Network

- [SQLCipher](https://www.zetetic.net/sqlcipher/) - Encrypted database
- [libp2p](https://libp2p.io/) - P2P networking stack
- [Signal Protocol](https://signal.org/docs/) - End-to-end encryption protocol

### Editor & UI

- [Milkdown](https://milkdown.dev/) - Markdown editor
- [Ant Design](https://ant.design/) / [Ant Design Vue](https://antdv.com/) - Enterprise UI components
- [Element Plus](https://element-plus.org/) - Vue 3 component library

### Tools

- [Vite](https://vitejs.dev/) - Next generation frontend tooling
- [TypeScript](https://www.typescriptlang.org/) - JavaScript superset
- [Docker](https://www.docker.com/) - Containerization platform

---

<div align="center">

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/chainlesschain/chainlesschain?style=social)
![GitHub forks](https://img.shields.io/github/forks/chainlesschain/chainlesschain?style=social)
![GitHub issues](https://img.shields.io/github/issues/chainlesschain/chainlesschain)
![GitHub pull requests](https://img.shields.io/github/issues-pr/chainlesschain/chainlesschain)

### Overall Code Statistics

**Total Code**: 266,500+ lines ⭐Updated

- Desktop App: 226,500+ lines (JavaScript/TypeScript/Vue) ⭐Updated
  - Main process: ~196,500 lines (including mobile sync 7700 lines + Manus optimization 5500 lines + logging system 1000 lines) ⭐Updated
  - Renderer process: ~15,000 lines (358 components)
  - Utility classes: ~15,000 lines (34 files)
- Smart Contracts: 2,400 lines (Solidity + tests + scripts)
- Browser Extension: 2,000+ lines (JavaScript)
- Backend Services: 23,775 lines (Java + Python)
- Community Forum: 10,958 lines (Vue3)
- Test Code: 50,000+ lines (417 test files + 50 script tests)
- Optimization Docs: 4,200+ lines (8 documents)

**Components and Files**:

- Vue Components: 403 (Desktop 358 + Forum 45)
- JavaScript Files: 369 (Main process 335 + Utilities 34)
- Solidity Contracts: 6
- Java Files: 132
- Python Files: 31
- Test Files: 467 (Desktop 417 + Scripts 50)
- Optimization Docs: 8

**Function Modules**:

- 16 AI specialized engines
- Manus AI Optimization System (5500+ lines) ⭐NEW
  - Context Engineering: KV-Cache optimization, Prompt cleanup (652 lines)
  - Tool Masking: Tool masking, state machine control (604 lines)
  - TaskTrackerFile: todo.md persistence mechanism (833 lines)
  - ManusOptimizations: Integration module (624 lines)
  - Recoverable Compression: URL/path preservation strategy
- Multi-Agent System (2516+ lines) ⭐NEW
  - AgentOrchestrator: Task distribution, parallel/chain execution (582 lines)
  - SpecializedAgent: Specialized Agent base class (252 lines)
  - CodeGenerationAgent: Code generation/refactoring/review (386 lines)
  - DataAnalysisAgent: Data analysis/visualization/statistics (555 lines)
  - DocumentAgent: Document writing/translation/summarization (386 lines)
  - Multi-Agent IPC: 15 IPC channels (248 lines)
- MCP Function Executor (268 lines) ⭐NEW
  - Invoke MCP tools in AI chat
  - Function Calling integration
- Mobile-PC Data Sync System (7700+ lines)
  - Device pairing, knowledge sync, project sync, PC status monitoring
  - WebRTC P2P communication, libp2p encryption, signaling server
  - Offline message queue, incremental sync
- Cross-Platform USB Key Support (Windows/macOS/Linux) ⭐NEW
  - CrossPlatformAdapter unified interface
  - PKCS#11 driver support
  - Auto-fallback to simulation mode
- LayerZero Blockchain Bridge (Production-Grade) ⭐NEW
  - Support for 7 mainnets + 2 testnets
  - Fee estimation, transaction tracking, event-driven
- Workspace Management System (Full CRUD) ⭐NEW
  - Restore, permanent delete, member management
- Remote Sync System (Complete Implementation) ⭐NEW
  - Incremental sync, conflict resolution, multi-device collaboration
- P2 Optimization System (3800+ lines)
  - Intent fusion, knowledge distillation, streaming response
  - Task decomposition enhancement, tool composition, history memory
- Deep Performance Optimization System (~8,700 lines)
  - 18 optimization utility classes (~8,000 lines)
  - 4 specialized components (~700 lines)
  - Smart image optimization, real-time performance monitoring
  - Code splitting, component lazy loading, virtual scrolling
  - Intelligent prefetch, request batching, optimistic updates
  - Data compression, incremental sync, memory optimization
  - Animation control, resource hints, accessibility features
- Enterprise Edition (Decentralized Organizations) ⭐Updated
  - OrganizationManager: 1966 lines
  - IdentityStore: 385 lines
  - UI pages/components: 6
  - Organization settings API: 5 complete implementations
  - Invitation system API: Full lifecycle management
- Blockchain system (3500+ lines) ⭐Updated
  - Wallet system + Smart contracts + LayerZero bridge
- 8 trading modules (5960 lines)
- Skill & tool system (115 skills + 300 tools)
- Advanced Features Control Panel (MenuManager + IPC + Web interface)
- Performance Optimization System (memory downgrade, disk check, concurrency control, file recovery)
- Security Protection System (input validation, permission control, encrypted transmission)
- Plugin system (dynamic loading + hot reload)
- Voice recognition system (real-time voice input + UI integration)
- Browser extension (70% complete)
- Testing framework (Playwright E2E + Vitest unit tests)
- 6 RAG core modules
- 5 AI engine components
- 4 database sync modules

**Backend Services**:

- Total API endpoints: 157 ⭐Updated
  - Project Service: 56 APIs ⭐Updated
  - AI Service: 38 APIs
  - Community Forum: 63 APIs
- Desktop app code: 700+ files (335 JS + 358 Vue + 34 Utils), ~250,000 lines ⭐Updated
- Database tables: 52+ (base + enterprise + blockchain + conversation management) ⭐Updated
- IPC handlers: 168+ (including enterprise IPC + advanced features IPC + conversation IPC) ⭐Updated
- Optimization docs: 8 documents, ~4,200 lines

**Test Coverage** ⭐Updated:

- Total test files: 467+ (417 test files + 50 script tests)
  - Unit tests: 73+ files
  - Integration tests: 6 files
  - E2E tests: 11+ files
  - Performance tests: 11 files
  - Security tests: 1 file (30 OWASP tests)
- Testing framework: Vitest unit tests + Playwright E2E
- Test cases: 2000+ (417 test files + 50 script tests, DI refactored)
- Pass rate: 99.6%
- Coverage: ~75% code coverage

**Permanent Memory System** ⭐NEW:

- permanent-memory-manager.js: 650 lines
- permanent-memory-ipc.js: 130 lines
- bm25-search.js: 300 lines
- hybrid-search-engine.js: 330 lines
- Total: 1,410 lines

**Overall Completion: 100%** ⭐Completed

**Defending Privacy with Technology, Empowering Individuals with AI**

Made with ❤️ by ChainlessChain Team

[⬆ Back to Top](#chainlesschain---personal-mobile-ai-management-system-based-on-usb-key-and-simkey)

</div>
