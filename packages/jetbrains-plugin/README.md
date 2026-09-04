# ChainlessChain IDE Bridge (JetBrains)

Phase 3 of the IDE bridge (`docs/design/modules/98_IDE桥接对标方案.md`). The
JetBrains counterpart of the [VS Code extension](../vscode-extension/): it lets
the ChainlessChain **`cc` agent CLI** read editor context and propose native
diffs inside IntelliJ-platform IDEs (IDEA, PyCharm, WebStorm, …).

**The bridge needs no IDE-specific CLI transport fork** — this plugin writes
the _same_ lockfile and speaks the _same_ MCP protocol as the VS Code
extension; only `ide` differs (`"jetbrains"`). Feature controls still require
the corresponding exact-gated CLI command, as documented below.

## Release compatibility

### What's new in 0.4.111

- **Slow foreground commands no longer make the persistent IDE Agent appear
  dead.** CLI `0.166.22` keeps the host lease heartbeat responsive and permits
  the unchanged live owner to recover safely after an event-loop stall.
- If npm lookup is unavailable or stale, the plugin still treats `0.166.22` as
  the recommended upgrade target and shows
  `npm i -g chainlesschain@latest` to users on an older CLI.

- **Evolution Workbench** presents CLI-owned candidate history, evidence and
  diffs, and sends only exact, explicitly confirmed review or rollback argv.
- **Skill Retrieval** displays the canonical CLI search result with witnessed
  outcome/vector evidence and preserves a visible abstain state for ambiguous
  matches.
- The paired **CLI 0.166.22** adds encrypted tenant-scoped evolution knowledge,
  durable human merge decisions, reviewer-key revocation, and dependency
  settlement. Trust, approval, and publication authority stay in the CLI host;
  the plugin receives bounded projections only.

Plugin **0.4.111** is the current release candidate that re-certifies the read-only
Context Center, canonical Context/Memory projection, and runtime
permission/side-effect evidence while carrying
forward governed automatic ghost-text completion and the Automation Center for
CLI-owned, versioned Automation and Routine projections. It shows preflight and history, then routes
run-now, failed-run retry, pause/resume, disable, delete, and revision-CAS
create/edit operations through exact CLI-issued arguments. Cron, one-shot,
webhook, and GitHub triggers share the same fail-closed surface.

Candidate CLI `0.166.22` routes Graph, Team, distributed-team, Cowork, Scheduler,
and App Server entry points through persisted Graph Kernel cutover authority.
It fences stale writers and takeover/recovery receipts, preserves explicitly
read-only legacy history, and fails closed on retired mutation paths. It also
carries forward the bounded Agent IPC child-process admission, pending
interactions, outbound requests, JSONL frames, stderr diagnostics, and stdin
backpressure. Structured overload responses include retry hints, and all
initialization, heartbeat, disconnect, and late-response paths have finite
cleanup fences.

The recommended public CLI is `chainlesschain@0.166.22`. Candidate CLI
`0.166.22` contains the governed Automation/Routine commands, Automation Center
v3 projection, scoped permission and side-effect authority, and shared
permission/budget enforcement. Version `0.4.111` accepts only the exact
v2/schemaVersion 2 or v3/schemaVersion 3 pair; unknown and cross-paired versions
fail closed. With v3 it shows sanitized run incidents and bounded live scheduler
occurrences. Incident retry/cancel and cooperative occurrence pause/resume
appear only when the CLI supplies an exact revision/fence-gated action preview.
The plugin refreshes the projection and rechecks that preview before execution;
it never derives argv from display data or imports scheduler payload, authority,
or checkpoint evidence.

Version `0.4.111` also consumes only strict, CLI-issued multi-agent merge-review
evidence. It displays stable file/hunk choices, persistent conflict explanations,
and exact apply/rollback previews, then refreshes the evidence before executing
the exact argv. It never runs or derives `git merge`, `merge-tree`, or
history-rewriting rollback commands. Candidate CLI `0.166.22` provides the
governed `team merge-review` command and exact evidence contract.

Candidate CLI `0.166.22` contains the audited Artifact access, managed-copy
deletion settlement, orphan recovery, and durable workflow authorities used by
`0.4.111`. The plugin continues to fail closed when an older CLI cannot provide
the exact projection or refreshed action evidence.

Public CLI `0.166.22` supersedes `0.166.18`, whose public npm dependency graph
could report `unknown command 'agent'` because Session Core's structured
evolution-memory export was absent from the immutable `0.3.9` package. The
fixed release publishes `@chainlesschain/session-core@0.3.10` first and proves
`cc agent --capabilities` from a fresh registry install. It also retains the
earlier fix for startup that could incorrectly require an available Docker
sandbox and could select Docker
Desktop's extensionless POSIX shim before `docker.exe`. The fixed release
restores Docker-optional normal startup, resolves native `PATHEXT` executables
first, and preserves fail-closed behavior for explicit sandbox and
managed-policy requests. It also pairs the CLI with
`@chainlesschain/session-core@0.3.10`, including the published
`./runtime-claims` and `./structured-evolution-memory` entry points.

Candidate CLI `0.166.22` also adds lease-bound real-time teammate send/receive/ack and
follow-up tools with durable, retry-safe TeamMailbox v3 receipts. The native
Team Monitor reports only bounded delivery health (retained, pending,
processed, dead-letter, follow-up, recipient, byte, and pressure metadata);
message subjects/bodies and attempt credentials are never retained or rendered.

## Governed ghost-text completion

Press **Alt+\\** for an explicit completion at the caret. Automatic ghost text
is independently opt-in under **Settings → Tools → ChainlessChain IDE** and is
off by default to prevent surprise model cost. Once enabled it uses a 650 ms
debounce, platform cancellation, exact-context in-flight dedupe and TTL cache,
bounded local context, independent hourly request/context-character budgets,
and length/line/prose quality fallback. Rolling metrics evaluate a fixed
P50 <= 2 s / P95 <= 5 s visible-latency SLO after 20 samples; results slower
than five seconds fail quiet and do not interrupt editing or the main Agent.

## Automatic awareness (cc ≥ 0.162.39)

With a current `cc` CLI the agent doesn't just _have_ the bridge tools — it
uses them on its own:

- **Your selection rides along with every prompt** as an ephemeral
  `<ide-context>` block (active file, open tabs, selected text); never written
  into the saved session.
- **Post-edit diagnostics feed back into the loop** — after the agent edits a
  file, the IDE's fresh errors/warnings are attached to the tool result so the
  model fixes what it just broke in the same run.
- **REPL `@` tab-completion prefers your open tabs.**
- **`@context` expands the live `cc-context-center/v1` projection** with a
  deterministic 4,096-token budget, per-chip source/scope/freshness/range,
  allocation status, and inclusion reason. `@selection`, `@diagnostics`, and
  `@terminal` remain available for focused references.
- **Tools → ChainlessChain: Context Center** opens the project chip list with
  pin/unpin, remove/restore, refresh, and fixed-budget controls. Preferences
  persist in project state and become the default for `getContextCenter`. The
  list includes VCS change-list hunks, bounded project instruction files, and
  connected MCP resource metadata; it never reads MCP resource bodies
  automatically.

Set `CC_IDE_CONTEXT=0` to turn the automatic sharing off.

## Remote Control network exposure

Tools → **ChainlessChain: Remote Control** starts direct mode on loopback by
default. Its local-only URI is shown as local pairing details and is not
rendered as a phone QR. To pair another device, open **Connection settings…**
and configure an E2EE relay, or explicitly choose **Allow LAN (trusted
networks only)**. The LAN choice is off by default, persists application-wide,
and is the only IDE setting that adds `--allow-lan`; direct LAN transport uses
plaintext `ws://` and may require a firewall rule.

## Project memory & REPL steering (cc ≥ 0.162.41)

The bridge injects `CHAINLESSCHAIN_IDE_PORT/TOKEN` into the IDE terminal, so
the CLI's 0.162.41 batch works there with zero plugin changes:

- **Project memory**: `chainlesschain init` inventories the project into a
  `cc.md` that every `chainlesschain agent` run auto-loads (`cc.md` >
  `CLAUDE.md` > `AGENTS.md` + path-scoped `.claude/rules`); inspect the chain
  with `chainlesschain memory files`.
- **REPL steering**: queued input while a turn runs, Esc interrupt,
  `/rewind` + idle double-Esc conversation rewind, `! <cmd>` bash
  passthrough, `# <note>` quick-memorize into cc.md, `/` command TAB
  completion, offline resume recap.
- **Scripted runs**: `chainlesschain agent -p --json-schema <file>` returns
  schema-validated JSON only; `chainlesschain mcp serve` exposes local file
  tools to other MCP clients.

## Configure the LLM (first run)

Tools → **ChainlessChain: Configure LLM** — pick a provider (10 presets),
enter model/API key/base URL (defaults prefilled); the wizard writes
`~/.chainlesschain/config.json` via `cc config set` and verifies with
`cc llm test`. One config shared by the CLI, this plugin, and the VS Code
extension; the key never enters IDE settings.

## Architecture

The code is split into two layers:

| Layer         | Package                           | IntelliJ SDK?     | Verified                        |
| ------------- | --------------------------------- | ----------------- | ------------------------------- |
| Protocol core | `com.chainlesschain.ide`          | **No — pure JDK** | compiled + interop-tested       |
| Editor glue   | `com.chainlesschain.ide.intellij` | Yes               | Gradle test/smoke/package gates |

**Wire contract**: the protocol core implements Agent Protocol v1 as
documented in [`packages/agent-sdk/docs/PROTOCOL.md`](../agent-sdk/docs/PROTOCOL.md)
— the same contract the TypeScript consumers (VS Code extension, web-panel)
get as types from `@chainlesschain/agent-sdk`. Kotlin/Java consumes the
protocol directly; the protocol document, not the SDK, is the compatibility
surface. `AgentChatSession` / `ChatEvents` must track that document.

- **`MiniJson`** — dependency-free JSON parse/serialize.
- **`McpServer`** — Streamable-HTTP MCP server (`com.sun.net.httpserver`), the
  same wire protocol the CLI MCP client POSTs (initialize / tools/list /
  tools/call) + bearer auth.
- **`LockfileWriter`** — writes `~/.chainlesschain/ide/<port>.json` (0600/0700,
  `ide:"jetbrains"`), read by the CLI's Phase-0 discovery.
- **`IdeTools` / `EditorFacade`** — the editor bridge tools against an editor
  facade; the complete tool-to-feature map is pinned by the generated public
  capability contract below.
- **`intellij.*`** — `IntellijEditorFacade` (Editor/PSI/Diff APIs),
  `IdeBridgeService` (lifecycle), `IdeBridgeStartup` (postStartupActivity),
  `IdeBridgeTerminalCustomizer` (env injection), `ShowStatusAction`.

## Verification

The protocol core is **not** taken on faith. On a machine with no IntelliJ SDK
(and no Kotlin), it was compiled with `javac --release 17` and driven by the
**real Node CLI MCP client** as a cross-language interop probe:

```bash
# from packages/jetbrains-plugin/
OUT=$(mktemp -d)
javac -encoding UTF-8 --release 17 -d "$OUT" src/main/java/com/chainlesschain/ide/*.java
javac -encoding UTF-8 --release 17 -cp "$OUT" -d "$OUT" src/test/java/com/chainlesschain/ide/InteropSmokeMain.java
java -cp "$OUT" com.chainlesschain.ide.InteropSmokeMain   # prints PORT=/TOKEN=/READY
node interop-smoke.mjs <port> <token>                     # drives it with the CLI client
```

Result: the core interop probe lists and calls its baseline tools (including
`getSelection` and `openDiff`) and rejects an invalid bearer credential. The
full registered capability surface is guarded separately by the generated
manifest below.

## Building the plugin (needs the IntelliJ SDK)

```bash
./gradlew buildPlugin     # downloads the IntelliJ Platform SDK, produces a .zip
./gradlew runIde          # launch a sandbox IDE with the plugin
```

The editor-glue layer (`com.chainlesschain.ide.intellij`) compiles against the
SDK downloaded by Gradle. Repository release gates run the unit/smoke suites,
package the plugin, verify the archive, and run a deterministic production-path
chat/control plus canonical Sessions Workbench journey in stock IntelliJ
2024.2 and 2025.2 across Windows, Linux, and macOS. The gate closes the first
IDE, launches a second process, and verifies persisted artifact/PR recovery.
Live-provider and remote-host journeys remain separate release-environment
checks.

## Status

- Protocol core (server/lockfile/tools/JSON): covered by unit and cross-language
  interop tests against the CLI client.
- IntelliJ glue (facade/lifecycle/actions): covered by Gradle build, smoke and
  plugin-package verification gates.
- Stock-IDE chat/control, Workbench lifecycle, and restart recovery are a
  required real-host matrix with immutable evidence. Remote Development,
  Marketplace installation, live-provider, Diff, and Preview journeys are not
  replaced by that deterministic test.

<!-- chainlesschain-public-ide-capabilities:start -->

## Public capability contract (generated)

This summary is pinned to the repository's versioned, secret-free
[`PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json`](../../docs/cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json).
The base IDE/Doctor contract requires `cc >= 0.162.190`; feature-specific sections below may require a newer CLI.

- JetBrains actions: **37** registered entries
- Doctor entries: `chainlesschain.ide.DiagnoseBridge`
- Bridge capability schema: **v1** (20 mapped tools)
- Drift check: `npm run ide:capabilities:check` from the repository root

<details><summary>JetBrains actions</summary>

- `chainlesschain.ide.ShowStatus`
- `chainlesschain.ide.ShowActivity`
- `chainlesschain.ide.OpenDashboard`
- `chainlesschain.team.Monitor`
- `chainlesschain.session.PrStatus`
- `chainlesschain.bg.Agents`
- `chainlesschain.remote.Control`
- `chainlesschain.sessions.Workbench`
- `chainlesschain.automation.Center`
- `chainlesschain.usage.Show`
- `chainlesschain.artifacts.Browse`
- `chainlesschain.policy.Viewer`
- `chainlesschain.context.Center`
- `chainlesschain.plugins.Manage`
- `chainlesschain.skills.Retrieve`
- `chainlesschain.evolution.Workbench`
- `chainlesschain.worktree.Tasks`
- `chainlesschain.chrome.Connector`
- `chainlesschain.workspace.ScanAutoExec`
- `chainlesschain.managedCli.Install`
- `chainlesschain.managedCli.Rollback`
- `chainlesschain.ide.DiagnoseBridge`
- `chainlesschain.ide.ExportDiagnostics`
- `chainlesschain.ide.RestartBridge`
- `chainlesschain.cli.whatsNew`
- `chainlesschain.ide.ConfigureLlm`
- `chainlesschain.ide.ConfigureVisionModel`
- `chainlesschain.chat.newConversation`
- `chainlesschain.chat.reopenClosedConversation`
- `chainlesschain.completion.trigger`
- `chainlesschain.chat.explainSelection`
- `chainlesschain.chat.refactorSelection`
- `chainlesschain.chat.insertFileReference`
- `chainlesschain.memory.init`
- `chainlesschain.memory.files`
- `chainlesschain.preview.start`
- `chainlesschain.preview.stop`

</details>
<!-- chainlesschain-public-ide-capabilities:end -->
