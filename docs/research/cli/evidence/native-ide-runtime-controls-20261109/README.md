# Independent Java runtime loopback controls (2026-11-09)

Four existing Windows x64 Java runtimes ran the same standalone source-file probe, with **no Gradle, IDE or extension loaded**:

| Label  | Runtime                                          | IPv4 / IPv6                                       |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| java-1 | Zulu 11.0.29                                     | Listener binds; client `ConnectException` on both |
| java-2 | Zulu 17.0.18                                     | Listener binds; client `ConnectException` on both |
| java-3 | IntelliJ 2024.2 bundled JetBrains Runtime 21.0.3 | Listener binds; client `ConnectException` on both |
| java-4 | Existing cached Temurin 21.0.13                  | Listener binds; client `ConnectException` on both |

The [receipt](receipt.json) records each executable's SHA-256, exact Java version and both outcomes, plus the source SHA-256. Process exit 0 means the observation was captured; the connection result is **failure**, never a passed host acceptance. The source uses a new loopback listener, bounded 1500 ms connect/accept and closes sockets in every case.

Reproduce without changing security settings:

```text
node run-controls.mjs <new-output.json> <absolute-java-executable> [...]
```

This strengthens failure localization below [the Gradle/IntelliJ journey](../jetbrains-live-host-attempt-20261109/README.md). It does not establish a firewall cause, repair loopback, or replace live JetBrains UI acceptance. No firewall, security policy or installed runtime was modified. [Independent Node and VS Code controls](../vscode-installed-native-recovery-20261109/runtime-controls.json) connect in standalone Node and installed Code 1.96.2, while cached Code 1.145.2 times out. These results must not be collapsed into a universal networking failure.

Item 9 remains partial: JetBrains live task/recovery and independent desktop localization remain open.
