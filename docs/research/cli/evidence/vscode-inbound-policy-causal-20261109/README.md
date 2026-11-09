# Cached VS Code inbound-policy controls and conditioned native journey (2026-11-09)

Two independent, bounded **18-pair** cross-runtime runs agree for **both IPv4 and IPv6**:

| Listener / client     | Node 24   | Installed Code 1.96.2 | Cached Code 1.145.2 |
| --------------------- | --------- | --------------------- | ------------------- |
| Node 24               | Pass      | Pass                  | Pass                |
| Installed Code 1.96.2 | Pass      | Pass                  | Pass                |
| Cached Code 1.145.2   | ETIMEDOUT | ETIMEDOUT             | ETIMEDOUT           |

All 18 listeners bind in each run. Each pass includes server accept, nonce receipt, ACK write and client verification; cached listeners receive no accept event. Cached Code outbound connections work, so an external Node consumer does not bypass its unreachable listener. Executable SHA-256 and runtime versions are retained; paths are normalized. The frozen worker matches both recorded worker hashes. An initial syntax-error attempt is excluded from these counts.

Read-only policy inspection found active **Public** profiles, enabled firewall/default inbound **Block**, existing inbound Allow rules for installed Code and Node, and no exact cached-Code application rule. Its Microsoft Authenticode signature validates. Existing logging/auditing cannot supply a drop receipt. Third-party WFP callouts are present but their decisions are not established; raw system/WFP snapshots stay private.

A narrow, authorized **IPv4 A/B/A** intervention then retained the **same cached process and TCP listener port 50434**:

1. Before: timeout.
2. During one exact-executable/Public/TCP/port-50434 rule with local and remote `127.0.0.1`: nonce/ACK verified.
3. After removing only that rule: timeout again.

The [rule receipt](ipv4-rule.json) records **ActiveStore**, `persisted:false`, `removed:true`. This establishes that application inbound authorization causally changes the observed boundary; it does not identify an exclusive Defender-versus-third-party packet-drop mechanism. The [Microsoft cmdlet reference](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule?view=windowsserver2025-ps) describes the program/address/port/profile conditions used. The separate `::1` rule was rejected by the CIM address validator before creation, so IPv6 causal intervention remains unverified. No broader address scope was substituted.

Source **ae2372cd82c4d1ca870378c202da7f41366006dc** subsequently passed the complete **VS Code 1.145.2 / Windows x64** installed-VSIX real-DOM journey under a temporary **exact-executable, Public, TCP, local/remote `127.0.0.1`** ActiveStore rule. IDE ports are ephemeral, so this run's rule covered that application's local TCP ports. Two roots, 19 commands, two simultaneous bridges, chat controls, Workbench, canonical text/image drafts and restart passed. **100 needs-input samples, P95 1414 ms**, gate 2000 ms. This separate fixture-model timing/recovery run is not a comparative benchmark against earlier host versions.

The [native rule receipt](native-rule.json) confirms exit 0, unchanged executable hash, **rule removed**, and **no persistent rule**. The post-cleanup standalone probe again times out on both address families, and no diagnostic rule remains in ActiveStore or PersistentStore. Default firewall policy and security products were not disabled or changed. This is **conditioned acceptance**, not an unconditional stock-host repair.

The [receipt](receipt.json) binds eight repository source files and 23 artifacts, including the original full-native evidence identity, selected recovery artifacts and frozen intervention source snapshots. Private profiles/vaults, raw WFP/system logs, request/answer text and VSIX bytes are excluded. The original application self-probe is retained. Persistent host configuration, IPv6 intervention, complete real-provider IDE/desktop tasks and exact-head three-system release acceptance remain open; `paidReady:false`.
