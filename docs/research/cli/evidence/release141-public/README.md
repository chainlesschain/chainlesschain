# CLI 0.166.141 and paired IDE publication

Checked 2026-11-04T10:59:34.766935+00:00. Immutable runtime source `df9295e33ad04aec0aa74cab4dd242766d5556a4`; documentation reviewed main `a60b9cdb35d9d598202930cb3317117b651948fd`. CLI **0.166.141**, Open VSX **0.37.177** and JetBrains **0.4.194** are verified public. All original JetBrains payload entries match the official build; the outer ZIP may be repackaged.

- [CLI CI and Strict Sandbox](gates.json): 76/76 and6/6, every configured platform.
- [CLI public readback and signed provenance](cli.json), [Open VSX](open-vsx.json), [JetBrains](jetbrains.json).
- [Official workflow jobs/steps](workflows.json), [original CLI readback](chainlesschain-npm-readback.json), [publication evidence hashes](publication-readback.json).

Publisher child receipts remain under `publisher/`. CLI installation verification uses registry-only `--ignore-scripts` and Agent capability startup; this is not full native/postinstall validation. Microsoft Marketplace is deferred. No additional model-task retest was run. Historical Volcengine strict24/45, union36/45 with qualification limits, Sol original41/45, cross-revision45/45 and repaired-four2/4 remain separate. See [task ledger](../../verify01-36-plus-9-task-list.md).
