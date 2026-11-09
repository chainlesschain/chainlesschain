# Windows installed VS Code native recovery (2026-11-09)

At source `dc69b751845b9a264f82c8743566c2b023fc7037`, the freshly packaged VSIX **0.37.182** passed the full real-DOM journey on the explicitly selected, already-installed **VS Code 1.96.2**, Windows x64. Its engine requirement is `^1.85.0`. The runner verifies the requested version against the adjacent application manifest, hashes the executable and manifest, and installs into a fresh profile. The default downloaded stable/insiders CI path is unchanged; this is a separate diagnostic target.

Verified scope:

- Two ordered workspace roots, 19 registered commands, and two simultaneous windows with distinct live production bridges.
- Real Webview main-world interactions: send/stream, retry, plan approval, permission, interruption, Workbench dispatch/reply/artifact projection, and IDE restart.
- Production canonical store and actual CLI persistence with a deterministic model fixture: background completion while another conversation is active, stable history identities after restart, unsent Chinese/emoji text and PNG/GIF draft recovery, rejected attachment bounds, and no automatic input replay. Conversation A intentionally sends the same prompt twice; four distinct saved row IDs are expected.
- **100 measured needs-input transitions**, plus one warmup: P95 **1936 ms**, maximum **2166 ms**, gate P95 **2000 ms**. This is one local loopback-fixture run, with no external provider network in the measurement.
- A separate development-host model-input diagnostic passed command registration, a real CLI child process fixture and native plaintext editor rendering, with raw source excluded. This is not a canonical real-provider task journey.
- Runner/release-contract regression: **65/65**, source-bound JUnit included.

The [receipt](receipt.json) binds 15 source files and 21 archived artifacts. The original full journey returned exit 0, `result:passed`, `evidenceComplete:true`, and digest `sha256:7bbbb82bfaa978567a48eb4a8a2f8f14ddc8b5ed884b9adbcc996c989c25edab`. This public archive is an allowlisted subset; the original VSIX, private profiles, canonical store and unrelated host logs are excluded. Original evidence completeness is not a claim that this subset contains the entire bundle.

The independent [runtime controls](runtime-controls.json) retain both results: standalone Node and installed Code 1.96.2 connect on IPv4/IPv6; cached Code **1.145.2** times out on both without loading any extension. Different version and executable path are confounded; neither version nor firewall is established as the cause. Read-only typed firewall inspection found the installed Code rules were **Allow**, correcting an earlier numeric-enum hypothesis. No firewall or security policy was changed.

Reproduce the native recovery target from the extension package, substituting an actual installed executable:

```powershell
$env:CC_UI_CONVERSATION_RECOVERY = '1'
node test/extension-host/run.cjs --vsix chainlesschain-ide-0.37.182.vsix --vscode-version 1.96.2 --vscode-executable '<absolute native Code executable>' --artifact-dir '<new evidence directory>' --release-commit dc69b751845b9a264f82c8743566c2b023fc7037
```

Items 2, 3 and 7 remain partial. Current stable 1.145.2, JetBrains/desktop, real-provider task attribution, upgrade/accessibility and the exact-head three-system GitHub matrices remain separate gates. No release or production admission is asserted.
