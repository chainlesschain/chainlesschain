# Official MCP reference Tasks acceptance — Windows, 2026-11-09

This is an independent **reference implementation on loopback**, not a remote production deployment. It exercises the new explicit `2026-07-28` HTTP polling path in the production client and durable runtime. Legacy protocol defaults remain unchanged. Overall gap Item 4 remains partial.

- [receipt.json](receipt.json): six separate client processes, a separate unmodified server process, real Windows DPAPI, forced SIGKILL after durable acceptance, restart/watch/delivery, duplicate delivery and original-session transcript verification, then cancellation of a second task followed by a distinct status query.
- [reference-package.json](reference-package.json): npm package `@modelcontextprotocol/server-everything@2.2.1`, registry tarball SHA-512, all 59 published files byte-matched with the installed server, and 94 dependency version/integrity records. The package itself requires Node 24; this run used Node 24.12.0 on Windows x64.
- [regression-tests.xml](regression-tests.xml): **563/563 in 42 files**, including stateless Tasks, legacy clients, transport cancellation/limits, real SQLite configuration migration, canonical journal/delivery and caller-abort boundaries. Hostnames and repository paths are normalized. Subset results overlap this total.

Wire observation: `tools/call:2` represents two distinct tasks; `tasks/cancel:1`, `tasks/get:8`. Six processes each discover server/tools/resources/prompts. All 41 requests use POST, without session headers. No initialize, legacy task result/list, standalone GET or DELETE was sent. The first task is never recreated after client death. A second deliver returns the original delivery ID, and verification confirms exactly one external assistant reference with the expected synthetic topic, zero user/tool messages and no synthetic tool-call identity.

The watch regression was reproduced before repair: two 100ms deadlines exceeded the 1500ms test bounds during a stalled network request/60-second interval, and an already-aborted caller incorrectly delivered a cached result. A single deadline now bounds queue, request and interval waits; cancellation is checked before cached publication. Additional tests cover expiry while queued and caller abort between observation and delivery. Local timeout does not send remote cancellation or repeat creation.

Additional checks: egress inventory/closure **9/9**; the existing legacy native DPAPI fixture passes again, including three forced termination windows, canonical resume and the offline product CLI. Its compact result is in the receipt. That handwritten legacy server remains fixture evidence, separate from the official independent reference.

Reproduction from the repository root (isolated install; root manifests remain untouched):

```powershell
npm install --prefix .tmp/mcp-everything-2.2.1 --no-save --no-package-lock --ignore-scripts --no-audit --no-fund @modelcontextprotocol/server-everything@2.2.1
node packages/cli/scripts/probe-mcp-task-reference.mjs .tmp/mcp-everything-2.2.1 .tmp/mcp-reference-acceptance
```

The probe runs only on Windows and creates an isolated temporary session/security/vault directory. It stops its own child/server processes. Published evidence excludes credentials, raw request/result bodies, local storage paths and vault contents; synthetic opaque task/session IDs and delivery digests remain.

The receipt binds source files by SHA-256; it also records the parent commit and normalized test/package artifact hashes. Local success is not exact-commit multi-OS CI. The old `52a24ee` CLI matrix was cancelled and skipped its three system tests, so it supplies no release gate.

Still unverified: remote production third-party services, real model continuation, input-required interaction, actual expiry/revocation, Linux/macOS secret stores, dual IDE/desktop and paid/production admission. Existing unit fixtures for those boundaries are not upgraded to independent real-service evidence. `paidReady:false`.

Implementation: [progress](../../../cli-ide/implementation/cli-ide-mcp-stateless-reference-progress-2026-11-09.md). User workflow: [MCP Tasks](../../../../cli/mcp-tasks.md). PR: [#569](https://github.com/chainlesschain/chainlesschain/pull/569).
