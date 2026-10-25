# Bundled changelog parity recovery

The exact `35cb1a379ddf80003c46efe315de5dac88b19731` Linux CLI CI unit
shard 3/4 failed the existing complete-content changelog parity test: a new
canonical release note had not been regenerated into the committed offline
package data. The job recorded 10,007 passing tests, one failure and 29 skips.
Its original log and digest-verified JUnit ZIP are retained here.

The standard `packages/cli/scripts/build-changelog.mjs` generator updates only
`packages/cli/src/data/changelog.json`. The existing parity test reproduces the
failure before generation and passes afterward. A second generator invocation
produces identical bytes; command manifest, help index and completion checks
also pass. Executable runtime, the canonical changelog, parser, assertions,
deadlines and workflow definitions remain unchanged.

Windows unit shards 3/16 and 4/16 passed on the preceding source, including the
previously failing shard. Its workflow uploads JUnit artifacts only on failure,
so no passing individual-case duration or nonexistent ZIP is claimed. These
completed components and the earlier 64 related runtime controls cannot qualify
the replacement commit. Remaining old gates were cancelled; all eight complete
gate groups, including the original 7,200-second Formal profile, must pass again
on the new exact source. No release or new online model-task acceptance is
claimed.
