# ChainlessChain IDE Bridge (JetBrains)

Phase 3 of the IDE bridge (`docs/design/modules/98_IDE桥接对标方案.md`). The
JetBrains counterpart of the [VS Code extension](../vscode-extension/): it lets
the ChainlessChain **`cc` agent CLI** read editor context and propose native
diffs inside IntelliJ-platform IDEs (IDEA, PyCharm, WebStorm, …).

**The CLI needs zero changes** — this plugin writes the _same_ lockfile and
speaks the _same_ MCP protocol as the VS Code extension; only `ide` differs
(`"jetbrains"`).

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

Set `CC_IDE_CONTEXT=0` to turn the automatic sharing off.

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
chat/control/resume journey in stock IntelliJ 2024.2 and 2025.2 across Windows,
Linux, and macOS. Live-provider and remote-host journeys remain separate
release-environment checks.

## Status

- Protocol core (server/lockfile/tools/JSON): covered by unit and cross-language
  interop tests against the CLI client.
- IntelliJ glue (facade/lifecycle/actions): covered by Gradle build, smoke and
  plugin-package verification gates.
- Stock-IDE chat/control/resume is a required real-host matrix with immutable
  evidence. Remote Development, Marketplace installation, live-provider, Diff,
  and Preview journeys are not replaced by that deterministic test.

<!-- chainlesschain-public-ide-capabilities:start -->

## Public capability contract (generated)

This summary is pinned to the repository's versioned, secret-free
[`PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json`](../../docs/cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json).
The base IDE/Doctor contract requires `cc >= 0.162.47`; feature-specific sections below may require a newer CLI.

- JetBrains actions: **33** registered entries
- Doctor entries: `chainlesschain.ide.DiagnoseBridge`
- Bridge capability schema: **v1** (19 mapped tools)
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
- `chainlesschain.usage.Show`
- `chainlesschain.artifacts.Browse`
- `chainlesschain.policy.Viewer`
- `chainlesschain.plugins.Manage`
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
