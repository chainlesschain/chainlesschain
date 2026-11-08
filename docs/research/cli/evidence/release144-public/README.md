# CLI 0.166.144 release evidence

Status: **pending full exact-source CLI CI and Strict Sandbox; unpublished**.

The immutable `v-npm-0-166-144` tag targets `6b8a39e27d4e59fdf81891ce8d3ee1f6f5bc76c7` (tree `7cd55b2ff1d71f6593aaa26f1fee7bc946da7838`). Its complete tree matches the earlier candidate `1ac18717f603a84a75dcb11ea9069907b6d43c18`; checks from that candidate cannot replace checks for the tagged merge commit.

The original main matrices were canceled. [Tag-bound full CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/42441293875) and [tag-bound Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/42441297198) are pending. [Three-OS memory query measurement](https://github.com/chainlesschain/chainlesschain/actions/runs/42431440827) and [Background Interaction E2E](https://github.com/chainlesschain/chainlesschain/actions/runs/42431440874) passed for the tagged merge commit.

[OIDC publication](https://github.com/chainlesschain/chainlesschain/actions/runs/42438360843) was safely blocked at its exact-source gate before package publication. Retry that immutable push run only after all required matrices pass; independent public byte/provenance readback is still required. Session Core 0.3.27 must be public before CLI 0.166.144; both public IDE payloads must be verified before product v5.0.3.146.

The release excludes later main MCP/diagnostics/Memory work. CI and publication add no model-task acceptance. **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain; Microsoft Marketplace remains deferred.

See [machine-readable progress](progress.json).
