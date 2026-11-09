# VS Code Electron loopback failure isolation (2026-11-09)

Source: `cc965340c158e15637ee1bf71da3b2e74ed38bf0`, Windows x64, Node 24.12.0, VS Code 1.145.2, VSIX 0.37.182. The real host runner was executed outside the network-restricted sandbox against a freshly installed VSIX and isolated two-root workspace.

The installed extension activated and registered 19 expected commands. Its bridge self-probe returned `ETIMEDOUT` five times; no discovery lockfile was published, and the journey exited 1 after bridge discovery timed out. The new failure handler then ran the same independent loopback probe in the runner's Node process and the exact VS Code executable in `ELECTRON_RUN_AS_NODE` mode:

| Runtime                                | IPv4      | IPv6      | Extension loaded by independent probe |
| -------------------------------------- | --------- | --------- | ------------------------------------- |
| Node 24.12.0                           | connected | connected | no                                    |
| VS Code Electron 43.8.3 / Node 24.22.1 | ETIMEDOUT | ETIMEDOUT | no                                    |

This reproduces a network failure without loading the extension or its VS Code proxy hooks. It narrows failure localization beyond the earlier extension-lifecycle hypothesis; it does **not** identify a firewall, OS policy, Electron defect, or other root cause. No security policy was changed. IDE/desktop acceptance remains open.

The runner now automatically captures these bounded diagnostics after failures. Successful journeys do not run them. Diagnostics retain the original failure and never promote it to acceptance. Only OS runtime variables reach the diagnostic child; receipts exclude environment, credentials, paths and port tokens.

Validation: `node --test test/extension-host-runner.test.cjs test/release-workflow-contract.test.cjs` in `packages/vscode-extension` passed **63/63** outside the sandbox. A sandbox-only attempt received `EACCES`, retained as an environment distinction rather than counted as a passing run. Prettier and `git diff --check` also passed.

The [receipt](receipt.json) binds source and diagnostic hashes. This archive contains an allowlisted subset of the original host evidence, including the actual automatic diagnostic outputs, activation trace and bridge-startup excerpt. It excludes the VSIX and unrelated host logs; `originalJourneyEvidenceComplete` describes the original local bundle, not a release-complete archive here. The complete local bundle is under `.tmp/gap-host-followup-integrated-evidence`.

PR: [#569](https://github.com/chainlesschain/chainlesschain/pull/569). This evidence closes a failure-localization subtask only; bridge repair, real dual-IDE/desktop journeys and cross-platform acceptance remain unproven.
