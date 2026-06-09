# ChainlessChain IDE Bridge (JetBrains)

Phase 3 of the IDE bridge (`docs/design/modules/98_IDE桥接对标方案.md`). The
JetBrains counterpart of the [VS Code extension](../vscode-extension/): it lets
the ChainlessChain **`cc` agent CLI** read editor context and propose native
diffs inside IntelliJ-platform IDEs (IDEA, PyCharm, WebStorm, …).

**The CLI needs zero changes** — this plugin writes the *same* lockfile and
speaks the *same* MCP protocol as the VS Code extension; only `ide` differs
(`"jetbrains"`).

## Architecture

The code is split into two layers:

| Layer | Package | IntelliJ SDK? | Verified |
|-------|---------|---------------|----------|
| Protocol core | `com.chainlesschain.ide` | **No — pure JDK** | ✅ compiled + interop-tested |
| Editor glue | `com.chainlesschain.ide.intellij` | Yes | ⏳ build needs the SDK |

- **`MiniJson`** — dependency-free JSON parse/serialize.
- **`McpServer`** — Streamable-HTTP MCP server (`com.sun.net.httpserver`), the
  same wire protocol the CLI MCP client POSTs (initialize / tools/list /
  tools/call) + bearer auth.
- **`LockfileWriter`** — writes `~/.chainlesschain/ide/<port>.json` (0600/0700,
  `ide:"jetbrains"`), read by the CLI's Phase-0 discovery.
- **`IdeTools` / `EditorFacade`** — the 4 tools (`getSelection`,
  `getDiagnostics`, `getOpenEditors`, `openDiff`) against an editor facade.
- **`intellij.*`** — `IntellijEditorFacade` (Editor/PSI/Diff APIs),
  `IdeBridgeService` (lifecycle), `IdeBridgeStartup` (postStartupActivity),
  `IdeBridgeTerminalCustomizer` (env injection), `ShowStatusAction`.

## Verification

The protocol core is **not** taken on faith. On a machine with no IntelliJ SDK
(and no Kotlin), it was compiled with `javac --release 8` and driven by the
**real Node CLI MCP client** as a cross-language interop probe:

```bash
# from packages/jetbrains-plugin/
OUT=$(mktemp -d)
javac -encoding UTF-8 --release 8 -d "$OUT" src/main/java/com/chainlesschain/ide/*.java
javac -encoding UTF-8 --release 8 -cp "$OUT" -d "$OUT" src/test/java/com/chainlesschain/ide/InteropSmokeMain.java
java -cp "$OUT" com.chainlesschain.ide.InteropSmokeMain   # prints PORT=/TOKEN=/READY
node interop-smoke.mjs <port> <token>                     # drives it with the CLI client
```

Result: the CLI client lists all 4 tools, calls `getSelection`/`openDiff` and
gets correct results, and a wrong bearer token is rejected — proving a non-Node
editor server satisfies the protocol with no CLI change.

## Building the plugin (needs the IntelliJ SDK)

```bash
./gradlew buildPlugin     # downloads the IntelliJ Platform SDK, produces a .zip
./gradlew runIde          # launch a sandbox IDE with the plugin
```

The editor-glue layer (`com.chainlesschain.ide.intellij`) compiles only against
the SDK, so it has not been built on the (SDK-less) dev box that produced the
rest — it is code-complete, build-pending a JetBrains SDK environment, the same
way the VS Code extension is runtime-pending an Extension Host.

## Status

- ✅ Protocol core (server/lockfile/tools/JSON) — compiled + cross-language
  interop-tested against the CLI client.
- ⏳ IntelliJ glue (facade/lifecycle/terminal) — code-complete, SDK build pending.
- ⏳ `getDiagnostics` markup traversal + `LocalTerminalCustomizer` signature may
  need tuning against the target platform version.
