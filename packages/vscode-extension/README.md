# ChainlessChain IDE Bridge for VS Code

Bring the ChainlessChain `cc` agent into VS Code-compatible editors with a
streaming chat workspace, editor-native review controls, canonical session
coordination, and a localhost IDE bridge.

## Current release

| Component                 | Current status                                               |
| ------------------------- | ------------------------------------------------------------ |
| VS Code extension         | **0.37.64**; immutable tag-gated Open VSX release            |
| Recommended CLI           | **`chainlesschain@0.165.8`** public npm release              |
| Base bridge compatibility | `cc >= 0.162.190`; newer features can require a newer CLI    |
| Editor compatibility      | VS Code `>= 1.85.0` and compatible Open VSX editors          |
| Distribution              | Open VSX; not published on the Microsoft VS Code Marketplace |

The recommended CLI `0.165.8` includes the governed Automation/Routine commands,
the released Automation Center v3 projection, scoped permission and side-effect
authority, and shared permission/budget enforcement. Version `0.37.64` accepts
only the exact v2/schemaVersion 2 or v3/schemaVersion 3 pair; unknown and
cross-paired versions fail closed. With v3 it shows sanitized run incidents and
bounded live scheduler occurrences. Incident retry/cancel and cooperative
occurrence pause/resume appear only when the CLI supplies an exact
revision/fence-gated action preview. The extension refreshes the projection and
rechecks that preview before execution; it never derives argv from display data.

Version `0.37.64` also consumes only strict, CLI-issued multi-agent merge-review
evidence. It displays stable file/hunk choices, persistent conflict explanations,
and exact apply/rollback previews, then refreshes the evidence before executing
the exact argv. It never runs or derives `git merge`, `merge-tree`, or
history-rewriting rollback commands. CLI `0.165.8` supplies the corresponding
governed `team merge-review` command and exact evidence contract.

The paired CLI `0.165.8` contains the audited Artifact access, managed-copy
deletion settlement, orphan recovery, and durable workflow authorities used by
`0.37.64`. The extension continues to fail closed when an older CLI cannot
provide the exact projection or refreshed action evidence.

CLI `0.165.8` also bounds durable-session event backlogs and sidecars, routes
project storage through canonical path authority, prevents Windows append-writer
starvation under concurrent session activity, converges isolated local and
remote execution state, and stabilizes cross-platform browser evidence. Its
release-gate fix keeps the simulated operating-system home,
`CHAINLESSCHAIN_HOME`, workspace, and rollback-resistant security anchor
separate so the production fail-closed layout is exercised safely.

The `0.165.7` candidate was never published. Its changes are included in
`0.165.8`, whose exact release commit passed the complete Linux, Windows, and
macOS CLI CI and Strict Sandbox matrices, npm publication, and public-registry
readback. For that reason, `0.165.8` is the preferred CLI for this extension.

The immutable publication tag for this package is
[`ide-vscode-v0.37.64`](https://github.com/chainlesschain/chainlesschain/releases/tag/ide-vscode-v0.37.64).
The tag workflow validates the exact packaged VSIX in stable and minimum VS Code
hosts on Windows, Linux, and macOS before publishing it to Open VSX and reading
the public registry artifact back. Registry availability can be checked on the
[Open VSX listing](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide).

## Highlights

- **Interactive Context Center** - inspect deterministic, versioned context
  chips with source, scope, freshness, token allocation, and inclusion reason;
  persist workspace pin/remove choices and collect bounded Git diff, project
  memory, and metadata-only MCP resource evidence without importing resource
  payloads or credential values.

- **Permission and Side-effect Center** - review CLI-authoritative filesystem,
  network, process/runtime, credential-name, irreversibility, decision-source,
  call-chain, and per-resource recovery evidence through a bounded projection;
  create or revoke workspace-scoped permission rules through generation- and
  revision-bound CLI commands without letting the IDE edit authority state.
  Public CLI `0.165.8` provides the exact `permissions activity`, `scoped`, and
  `revoke` contracts consumed by these surfaces.

- **Governed multi-agent merge review** - inspect CLI-owned cross-branch
  evidence, select stable files or hunks, publish one fast-forward commit, and
  use retained-history rollback without granting the IDE direct merge authority.

- **Governed Automation Center** - inspect CLI-owned, versioned Automation and
  Routine projections, preflight and history; run now, retry failures,
  pause/resume, disable, or delete through revision-checked CLI actions. Cron,
  one-shot, webhook, and GitHub triggers share the same fail-closed surface.
  Canonical v3 projections also expose CLI-governed incident recovery and
  cooperative live-occurrence pause/resume without exposing scheduler payload,
  authority, or checkpoint evidence to the webview.

- **Sidebar Chat and editor-native inline chat** — stream answers and tool
  activity, use multiple conversation tabs, paste images, mention files or
  symbols, and copy, insert, replace, explain, refactor, fix, document, or test
  code without leaving the editor.
- **Governed ghost-text completion** — keep Alt+\\ manual completion, or opt
  into automatic suggestions with debounce, cancellation, exact-context
  dedupe/cache, independent hourly request/context budgets, bounded local
  context, quality fallback, and a P50 <= 2 s / P95 <= 5 s visible-latency SLO.
- **Plan and permission review** — inspect or revise plans before execution,
  answer structured MCP elicitation forms, and approve or deny risky actions in
  explicit UI cards.
- **Native change review** — review single-file or multi-file diffs, accept
  selected hunks, attach line comments, request revisions, and rewind or fork
  through the CLI-owned checkpoint timeline.
- **Canonical Sessions Workbench** — project local, background, remote, team,
  and workflow sessions with their owner, worktree, pending-input, artifact,
  and pull-request state. Replies and delivery actions are sent through the
  authenticated CLI transport and fail closed if the projection is stale.
- **Delivery and collaboration surfaces** — coordinate GitHub, Gitee,
  configured-remote, or manual handoff workflows; monitor background agents,
  Agent Teams, worktree tasks, artifacts, PR status, usage, plugins, policy,
  and remote control from dedicated views.
- **Live editor intelligence** — automatically share the current selection,
  open editors, diagnostics, terminal output, tests, coverage, debugger state,
  notebook state, and semantic code information with the agent when allowed.
- **Operational tooling** — configure the LLM, manage or upgrade the CLI,
  inspect What's New, run IDE and remote doctors, scan workspace auto-execution
  configuration, start App Preview, and use the Chrome connector.

## Install

### 1. Install the stable CLI

Node.js `>= 22.12.0` and npm `>= 10.0.0` are required.

```bash
npm i -g chainlesschain@0.165.8
cc --version
```

Using `@0.165.8` reproduces the preferred, fully gated public CLI pairing,
including Automation Center v3, scoped permission controls, and the durable
session, execution-location, and browser-evidence stability fixes described
above. Use `@latest` only when you intentionally want a newer published CLI.

### 2. Install the extension

The extension is published on
[Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide).

- In VSCodium and other Open VSX-compatible editors, search for
  **ChainlessChain IDE** (`chainlesschain.chainlesschain-ide`).
- In stock Microsoft VS Code, download the `.vsix` from Open VSX and run
  **Extensions: Install from VSIX...**. The extension is not currently listed
  on the Microsoft VS Code Marketplace.
- JetBrains users can install the sibling plugin from the
  [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge).

### 3. Configure and verify

1. Run **ChainlessChain: Configure LLM** from the Command Palette.
2. Open **ChainlessChain IDE > Chat** and send a prompt, or run `cc agent` in a
   new integrated terminal.
3. Run `cc ide status` and `cc ide doctor` if the bridge does not connect.

The extension also supports a custom binary through `chainlesschain.cli.path`.

## Everyday workflows

### Chat with editor context

The Chat view maintains a persistent `cc agent` stream-json process per
conversation. Prompts can include `@file`, `@file#L5-10`, `@selection`,
`@diagnostics`, `@terminal`, `@context` (the deterministic fixed-budget Context
Center projection), images, and workspace symbols. Sessions survive
editor restarts and are visible across supported IDEs through the shared IDE
session index.

Run **ChainlessChain: Context Center** to inspect the live chips, their source,
scope, freshness, token allocation, and inclusion reason. Pin/remove choices
and the fixed token budget persist per workspace; explicit MCP arguments can
still override them for one request. Sources include the built-in Git API's
uncommitted patch, bounded workspace instruction files, and the connected MCP
resource catalog. MCP chips contain metadata only; resource bodies are never
read automatically.

Set `CC_IDE_CONTEXT=0` to disable automatic context injection while keeping the
explicit `mcp__ide__*` tools available.

### Work inline

Use the inline chat command or its configured keybinding at the cursor or over
a selection. The inline session is isolated from sidebar conversations and can
stream an answer, then copy, insert, or replace generated code. Dedicated
commands also cover Explain, Refactor, Fix, Generate Documentation, and
Generate Tests.

Press **Alt+\\** for an explicit ghost-text request. Automatic ghost text is
independently opt-in and off by default. When enabled, continued typing cancels
pending work, identical contexts are deduplicated and cached, hourly request
and context-character budgets are enforced separately from manual completion,
and low-quality or slower-than-5-second results fail quiet. Rolling metrics
evaluate the published P50 <= 2 s and P95 <= 5 s SLO after 20 samples.

### Review edits and plans

File writes that require review open an editor-native diff. Accept the complete
change, select hunks, add line-level revision notes, or reject it. Closing or
timing out a required review does not silently approve the write. Plan mode
likewise keeps execution blocked until the plan is approved.

### Coordinate long-running work

Open **ChainlessChain: Sessions Workbench** to inspect canonical session state,
answer a pending question, resume or attach to work, inspect artifacts and pull
requests, and continue a delivery workflow. The CLI remains authoritative for
all mutations; the extension rechecks session, item, effect, and projection
revisions before sending an action.

## IDE bridge

Each trusted editor window starts a small MCP HTTP server on `127.0.0.1`. It
publishes an owner-protected lockfile under
`~/.chainlesschain/ide/<port>.json` and injects
`CHAINLESSCHAIN_IDE_PORT` / `CHAINLESSCHAIN_IDE_TOKEN` into new integrated
terminals. This lets `cc agent` select the correct window without ambiguous
port scanning.

The negotiated bridge currently maps 19 editor tools:

| Area                       | Tools                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Editor context             | `getSelection`, `getActiveFile`, `getDiagnostics`, `getOpenEditors`                                                     |
| Change review              | `openDiff`, `openMultiDiff`                                                                                             |
| Runtime context            | `getTerminalOutput`, `getPreviewState`, `getTestResults`, `getCoverage`, `getDebugState`, `executeCode`                 |
| Semantic code intelligence | `getHover`, `goToDefinition`, `findReferences`, `renamePreview`, `getCallHierarchy`, `getSymbolInfo`, `getProjectModel` |

The server binds only to loopback and requires a random per-window bearer
token. Tokens are omitted from UI and sanitized diagnostics. Untrusted VS Code
workspaces do not activate the bridge, lockfile publication is owner-only and
fail-closed, and stale or mismatched session actions are rejected instead of
being retried with broader authority.

## Commands and settings

Common Command Palette entries include:

- **Open Chat / New Conversation / Reopen Closed Session**
- **Open Inline Chat / Explain / Refactor / Fix / Generate Docs / Generate Tests**
- **Show Bridge Status / Restart Bridge / Diagnose Bridge**
- **Open Sessions Workbench / Background Agents / Team Monitor / Worktree Tasks**
- **Show Artifacts / PR Status / Usage / Plugins / Policy / Remote Control**
- **Configure LLM / Upgrade CLI / Check for CLI Updates / What's New**

Important settings:

| Setting                                       | Purpose                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| `chainlesschain.ide.enabled`                  | Enable the localhost IDE bridge                              |
| `chainlesschain.cli.path`                     | Select a custom `cc` executable                              |
| `chainlesschain.cli.managed.enabled`          | Enable managed CLI lifecycle support                         |
| `chainlesschain.chat.provider` / `.model`     | Override the CLI's default chat model                        |
| `chainlesschain.chat.contextIndicator`        | Show context-window usage                                    |
| `chainlesschain.chat.leanContext`             | Reduce automatically attached chat context                   |
| `chainlesschain.codeLens.enabled`             | Show Explain and Refactor CodeLens actions                   |
| `chainlesschain.completion.enabled`           | Enable manual ghost-text completion                          |
| `chainlesschain.completion.automatic.enabled` | Opt into governed automatic ghost text                       |
| `chainlesschain.completion.automatic.*`       | Tune debounce, cache, budget and quality                     |
| `chainlesschain.remote.relayUrl` / `.peerId`  | Configure E2EE remote-control discovery                      |
| `chainlesschain.remote.allowLan`              | Explicitly expose direct mode to trusted LANs (default: off) |

Remote Control direct mode is loopback-only by default. A loopback pairing
URI is shown as local-only and is never rendered as a phone QR. To pair
another device, configure an E2EE relay or explicitly enable
`chainlesschain.remote.allowLan`; direct LAN transport is plaintext `ws://`
and should be used only on a trusted network.

The generated capability contract at the end of this README is the exhaustive
command list and is checked against `package.json`, runtime registration, the
bridge tool map, and the CLI compatibility source.

## Release validation

Version `0.37.49` carries forward the release-host journey added across the
`0.37.38` to `0.37.47` line:

- an immutable packaged VSIX is exercised in real stable and minimum VS Code
  hosts on Windows, Linux, and macOS;
- local, background, remote, team, and workflow sessions complete dispatch,
  `needs_input`, reply, artifact/PR readback, and full IDE restart recovery;
- multi-root and multi-window tests require distinct Extension Host processes,
  bridge ports, and tokens, with both windows reachable at the same time; and
- publication is tied to the exact tag and followed by Open VSX registry
  readback. Microsoft Marketplace publishing remains a separate opt-in path
  and has not been performed.
- native ARM64 VS Code and JetBrains evidence is bound into the same exact
  11-cell aggregate before either paired version can be tagged.

## Build and verify from source

```bash
# From the repository root
npm run ide:capabilities:check
npm --prefix packages/vscode-extension run test:unit

# Package the extension
cd packages/vscode-extension
npx @vscode/vsce package --no-dependencies
node scripts/verify-vsix.mjs chainlesschain-ide-0.37.64.vsix
```

The extension has no runtime npm dependencies; it uses Node.js and the VS Code
API. Release publication must use the repository workflow and its exact-tag,
cross-platform host, immutable-artifact, and registry-readback gates.

For the complete user guide, architecture, configuration, troubleshooting, and
security notes, see
[`docs-site/docs/chainlesschain/ide-plugin.md`](../../docs-site/docs/chainlesschain/ide-plugin.md).

<!-- chainlesschain-public-ide-capabilities:start -->

## Public capability contract (generated)

This summary is pinned to the repository's versioned, secret-free
[`PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json`](../../docs/cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json).
The base IDE/Doctor contract requires `cc >= 0.162.190`; feature-specific sections below may require a newer CLI.

- VS Code commands: **52** registered entries
- Doctor entries: `chainlesschain.ide.doctor`, `chainlesschain.remote.doctor`
- Bridge capability schema: **v1** (20 mapped tools)
- Drift check: `npm run ide:capabilities:check` from the repository root

<details><summary>VS Code commands</summary>

- `chainlesschain.ide.showStatus`
- `chainlesschain.ide.restart`
- `chainlesschain.ide.openDashboard`
- `chainlesschain.complete.trigger`
- `chainlesschain.ide.doctor`
- `chainlesschain.ide.exportDiagnostics`
- `chainlesschain.team.monitor`
- `chainlesschain.session.prStatus`
- `chainlesschain.background.agents`
- `chainlesschain.sessions.workbench`
- `chainlesschain.automation.center`
- `chainlesschain.remote.control`
- `chainlesschain.usage.show`
- `chainlesschain.plugins.manage`
- `chainlesschain.worktree.tasks`
- `chainlesschain.chrome.connector`
- `chainlesschain.artifacts.show`
- `chainlesschain.policy.show`
- `chainlesschain.context.show`
- `chainlesschain.workspace.scanAutoExec`
- `chainlesschain.remote.doctor`
- `chainlesschain.lens.explain`
- `chainlesschain.lens.refactor`
- `chainlesschain.diff.accept`
- `chainlesschain.diff.reject`
- `chainlesschain.memory.init`
- `chainlesschain.memory.files`
- `chainlesschain.llm.configure`
- `chainlesschain.llm.configureVision`
- `chainlesschain.chat.insertReference`
- `chainlesschain.chat.fixDiagnostics`
- `chainlesschain.chat.explainSelection`
- `chainlesschain.chat.refactorSelection`
- `chainlesschain.chat.newConversation`
- `chainlesschain.chat.reopenClosedSession`
- `chainlesschain.inlineChat.open`
- `chainlesschain.inlineChat.explain`
- `chainlesschain.inlineChat.refactor`
- `chainlesschain.inlineChat.fix`
- `chainlesschain.inlineChat.generateDocs`
- `chainlesschain.inlineChat.generateTests`
- `chainlesschain.plan.approve`
- `chainlesschain.plan.requestChanges`
- `chainlesschain.plan.regenerate`
- `chainlesschain.plan.reject`
- `chainlesschain.preview.start`
- `chainlesschain.preview.stop`
- `chainlesschain.cli.upgrade`
- `chainlesschain.cli.checkUpdate`
- `chainlesschain.cli.whatsNew`
- `chainlesschain.cli.installManaged`
- `chainlesschain.cli.rollbackManaged`

</details>
<!-- chainlesschain-public-ide-capabilities:end -->
