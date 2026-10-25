# Physical fixture filesystem recovery

The frozen `76491cc313d6057e4babee5223dc48033886e532` candidate naturally failed
the existing substituted-matrix-request test on Windows, Node 22.12.0, one worker
and its original 60-second budget. No cancellation or increased timeout produced
this failure. Native Vitest JSON retained a generic stack; the complete original
stdout explicitly reports the timeout. Some stdout files use PowerShell's
UTF-16LE encoding; their original bytes and hashes are preserved.

Synthetic directory descriptors and no-op directory flushing forced explicitly
injected filesystem dependencies. Those dependencies correctly kept the
PowerShell ACL backend and bypassed production-only repair reuse, making the
test fixture unnecessarily slow after genuine file-owner repair was enabled.

Physical persistence fixtures now use the original filesystem adapter.
Monitored wrappers keep inherited Node methods, an owned directory-flush method
and the original directory admission/fault hooks. Deliberate custom fault
filesystems remain explicit dependencies; their fsync fault assertions retain
the existing path. Production code, existing assertions and budgets are unchanged.

The failed case passes in about 6.7 seconds after repair. The complete matrix,
directory/journal boundaries and four new adapter-boundary controls pass 169
tests with two existing skips. Representative recovery tests pass 13/13 and
unchanged fault controls pass 3/3. The fixed single-case run overlaps the full
matrix and must not be added as a unique extra test.

The previous candidate's remaining Actions runs were cancelled and its passing
component results are not used to qualify the replacement. The final commit
requires all eight complete release gate groups again, including the unchanged
7,200-second Formal profile. This preparation does not publish anything or
claim real online model-task acceptance.
