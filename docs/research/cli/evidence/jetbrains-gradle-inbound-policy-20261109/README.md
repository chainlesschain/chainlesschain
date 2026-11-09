# Java inbound authorization and standard JetBrains Gradle build (2026-11-09)

A signed **Temurin JDK21.0.13** process retained the same IPv4 listener on port **55305** across three controls: timeout before a rule, nonce/ACK verified during one temporary Allow, then timeout after removal. The rule was restricted to the exact `java.exe`, Public inbound TCP, that port and local/remote `127.0.0.1`, in ActiveStore only. This establishes a Java application inbound-authorization boundary, extending the separate [cached Code experiment](../vscode-inbound-policy-causal-20261109/README.md). Individual WFP/security-product decisions remain unassigned; IPv6 intervention is not established.

Under the same executable/profile/address restriction, with ephemeral ports permitted for the Gradle daemon, the existing standard command completed:

```text
gradlew.bat smokeTest test buildPlugin --offline --no-daemon --stacktrace --no-configuration-cache
```

The diagnostic selected the existing cached JDK/toolchain and dependencies, disabled toolchain auto-download, and used a 240-second process deadline. Gradle **8.7** exited **0**, reporting **BUILD SUCCESSFUL in 2m26s**, **20 actionable tasks executed**. Its single-use daemon communicates even with `--no-daemon`; that flag alone had not resolved the earlier transport failure. The observed daemon listener was `127.0.0.1`. No address scope was broadened.

- Smoke harness: **1455 passed, 0 failed**.
- JUnit: **120 suites, 1031 tests, 0 failures, 0 errors, 3 skipped**; 1028 executed. The summary was independently parsed from all raw XML reports, with their hashes retained in [junit-summary.json](junit-summary.json). Smoke and JUnit overlap and are not added together.
- `buildPlugin`: **chainlesschain-ide-bridge-0.4.198.zip**, 1,600,321 bytes, SHA-256 `6efd52b835c0a30a047c3a70bfae88c8a71765ecc90ef25a7419a5121295d632`. The [ZIP/JAR inventory](zip-inventory.json) commits both packaged JARs and every payload. No package was published.

The three skips are the existing POSIX-only checks `IdePathGuardTest.symlinkEscapeIsCaught`, `LockfileAclTest.posixModesAreExactForDirectoryAndPublishedFile` and `LockfileAclTest.compatibilityProbeDoesNotPretendWindowsAclExistsOnPosix`. Their source assumptions exclude this Windows run; the result does not establish those checks on Linux/macOS.

The [receipt](receipt.json) binds current tracked build/main/test/protocol sources to immutable source reference **ae2372cd82c4d1ca870378c202da7f41366006dc**; it does not claim that the whole checkout remained at that commit while documentation advanced. The earlier 198-file native source/resource comparison also remains unchanged. Compilation, generated plugin metadata, patched plugin XML, manifest and searchable options ran through Gradle. Bytecode instrumentation is disabled by the existing build configuration; the diagnostic did not change it.

The retained stderr includes IntelliJ registry/theme/shared-index warnings, a headless JCEF warning, and a Marketplace update parser error during searchable-options generation. Gradle still exited 0 and produced both JARs. `--offline` applies to Gradle dependency resolution; it does not establish that the launched IDE made no background network attempts. These messages are preserved rather than presenting the build as warning-free.

The [cleanup receipt](cleanup-verification.json) confirms **zero diagnostic rules in ActiveStore and PersistentStore**. Both experiment rules were removed and were nonpersistent. Default policy, security products and provider settings were unchanged. An initial slash-form executable path was rejected before rule creation; its private failure receipt hash is retained. The temporary rule allowed Gradle to cross the previously failing daemon connection, but it did not permanently repair the stock host.

This completes the **conditional local Windows standard-build subgate** alongside the separately verified [native diagnostic action](../jetbrains-canonical-native-readback-20261109/README.md). It does not complete a full native task/recovery journey, remote-robot acceptance, independent real-provider IDE tasks, exact-head three-system CI or release approval. All relevant plan items remain partial and `paidReady:false`. No model calls were made. Public logs normalize local paths and line endings and escape undecodable native bytes; raw XML, thread/system dumps, private profiles and ZIP binaries remain excluded.
