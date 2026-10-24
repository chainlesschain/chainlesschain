# Native module realm recovery

The exact `8775e738c870ac54ef392f8e3d1974d3c30dfd86` Windows CLI CI
unit shard 4/16 failed the resolver-drain test at its original 90-second
budget. The original failed job and its digest-verified results archive are
preserved here. Cancelling the remaining workflow does not change that job's
failure. A local, unchanged single-worker run naturally reproduced the timeout
in about 124 seconds.

The native ESM composition received a filesystem adapter created by Vitest's
module instance. Its private brand was correctly unrecognized, so storage kept
the custom PowerShell backend. Eleven explicit fixture call sites now select
the native helper's filesystem factory. Provider fixtures remain in their
original module instance, preserving the physically distinct SDK-copy test.
Foreign and modified filesystem adapters still take the custom path, including
their actual fault hooks.

Using the genuine adapter also exposed a production Koffi collision: named
native types share a process registry across module instances. A new regression
first reproduced the duplicate-type error while flushing a real directory
through both instances. Each API initialization now uses private unique type
names throughout its unchanged ABI declarations. Filesystem brands and API
caches remain module-local. Directory identity, owner, NTFS, flush and close
checks retain their existing behavior.

The final SDK and directory-durability suites pass 35/35; three original native
host controls also pass. The original resolver case completes in about 18
seconds. The related Desktop, provider, cache and IPC controls cover 29 unique
cases, recorded in `preparation.json`; overlapping runs must not be added as
independent coverage. Lock-matched dependencies were installed only in Temp and
supplied through the test process's `NODE_PATH`. A dependency overlay in this
worktree selects the existing real SQLite 12.11.1 module for Node ABI 127,
preserving the original junction and all shared package targets. Five original
dependency-load failures remain alongside their separate passing reruns.

ESLint comparison records zero new findings and four unchanged findings from
the base source. Raw JSON and PowerShell UTF-16LE stdout retain their original
bytes. All eight complete release gate groups must run on the new commit,
including the unchanged 7,200-second Formal profile. This preparation neither
qualifies nor publishes the candidate and claims no new online model-task
acceptance.
