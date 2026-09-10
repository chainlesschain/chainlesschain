# Evolution Ledger Capacity Remediation

## Decision status

Proposed after the 2026-09-09 GitHub Actions capacity result. This document is
not evidence that the capacity gate has passed.

The first contract-only delivery is now implemented in
`evolution-immutable-ledger-segment-store.js`. It separates a branded external
retention store from its branded proof verifier, binds every proof to the exact
tenant/ledger/epoch/range/content/storage version, and requires authenticated
same-version readback before returning an immutable receipt. Its 13 adversarial
unit tests pass. It is intentionally not wired into the current ledger or file
backend yet, so this checkpoint does not remediate or waive the observed
capacity failure.

The next v2 core delivery is implemented in `evolution-ledger-manifest-chain.js`.
It creates fixed-size canonical digest payloads, retains and reads back each
payload through the immutable-store contract, then signs a linked manifest and
head. It verifies only the new segment when sealing and verifies every segment
during an explicit audit. Its 19 combined contract tests pass. It intentionally
does not persist a manifest/head CAS, publish a witness checkpoint, write live
events, or migrate v1 data; those remain required before this core can become a
backend or be measured by the capacity gate.

`evolution-ledger-manifest-head-store.js` now defines the next required CAS
boundary. It accepts only branded manifest authorities and exact scoped heads;
after a compare-and-set acknowledgement it rereads and re-verifies the signed
head before reporting commit. A lost, malformed, substituted, asynchronous, or
unreadable acknowledgement is `COMMIT_UNKNOWN`, requiring reopen rather than a
blind retry. `evolution-ledger-file-manifest-head-store.js` now supplies the
concrete local implementation: strict cross-process locking, expected-head CAS,
owner-only staging, file and directory fsync, atomic rename, exact durable
readback, hard-link/symlink rejection, and explicit before/after-rename fault
tests. It is marked `localOnly`; the production WORM/object-lock head authority
and v1 migration are still required.

The v2 checkpoint bridge is now implemented in
`evolution-ledger-manifest-witness-adapter.js`. It verifies the exact signed
manifest/head pair, maps it to the existing durable `EvolutionFileWitness`
snapshot, and performs witness-digest CAS followed by authenticated durable
readback. It rejects mismatched manifest/head bindings and stale witness
digests; any acknowledgement loss, malformed acknowledgement, substitution, or
readback failure is `COMMIT_UNKNOWN`. The real file-witness composition and
related ledger suite now pass 164 tests. The current adapter deliberately
requires distinct manifest and witness key identities but does not itself
provision an external witness fault domain, so production qualification and
physical-fault evidence remain open.

`evolution-ledger-v2-manifest-backend.js` now composes the four v2 durability
contracts for sealed digest segments: immutable retain plus same-version
readback, manifest-directory CAS plus readback, signed-head CAS plus readback,
witness-digest CAS plus durable readback, and a final coherent directory/head/
witness read. The directory's normal path reads only its signed latest manifest;
its explicit `list()` operation validates full manifest linkage for audit. It
returns a normal segment receipt only after all confirmations. A stale
precondition returns an explicit conflict before retention; after a directory
CAS begins, any failed or ambiguous later phase is `COMMIT_UNKNOWN` and
requires reopening instead of retrying. Reopen now treats the authenticated,
append-only catalog manifest as a durable prepare record: it verifies the full
immutable segment chain, deterministically derives the missing signed head, and
resumes head CAS and witness checkpoint. Tests cover lost catalog and head
acknowledgements plus a transient witness conflict. This is still a sealed-
digest-segment backend, not live v2 event storage, v1 migration, or an assertion
that its local file catalog/head and file witness are independent production
fault domains.

`evolution-ledger-file-manifest-catalog.js` now supplies a concrete local
directory backend for the catalog contract. It guards compare-and-append with
the repository's strict cross-process file lock, writes a private staged file,
fsyncs the file and directory where supported, atomically renames it, and
compares exact bytes on readback. This closes the local catalog durability test
gap but is deliberately marked `localOnly`: a private mutable filesystem is
not external immutable retention authority and cannot qualify the fast path or
the production capacity claim.

The current v1 file ledger now also exposes bounded `appendBatch()` and
`appendDomainEventBatch()` entry points with a maximum of 1,024 events. The
complete input, Wiki admission, artifact evidence, event signatures, anchors,
and duplicate set are prepared before the first filesystem mutation. Each
event retains the existing witness-before-HEAD recovery invariant; no per-event
receipt is released until the final authenticated batch readback succeeds. A
later crash returns `COMMIT_UNKNOWN`, and reopen retains only the witnessed
prefix. The reliability worker uses 256-event batches, reducing full-prefix
authentication from once per event to once per batch without claiming that the
mutable local backend is an immutable store.

Cold snapshot verification still reads and hashes every mutable local anchor
and segment. It now holds one authenticated directory identity for the complete
scan and compares file bytes directly with the signed canonical snapshot bytes,
instead of repeating all boundary and JSON parsing work per file. This preserves
old-segment corruption detection. On 2026-09-11, a local Windows test-only run
completed 10,000-event seed in 2,007,300 ms, reopened in a fresh PID in 29,911
ms with 359,356 KiB peak RSS, and rejected both earliest-segment and witness
corruption. The associated 100-round six-phase process-exit campaign passed in
145,245 ms with zero false-success receipts. These are local diagnostics, not
the required exact-SHA Linux/Windows/macOS aggregate.

## Observed baseline

At commit `1613df9fdad5bc9a7fc6c5c6ee0ec26b52588b11`, the three-platform smoke
run `34309940597` passed 100 append/reopen/corruption events and six forced
process-exit recovery rounds. The formal run `34310624758` failed on Linux,
Windows, and macOS during its 10,000-event seed. Each runner reached the
one-hour seed deadline before the reopen, corruption, fault-campaign, or
aggregate phases. Ubuntu reached 6,200 events and showed increasing time per
100-event interval.

Single-event append on the present mutable file backend still deliberately
lists, opens, hashes, and authenticates the complete anchor and segment prefix.
The bounded batch path amortizes that authentication while withholding receipts
until final readback; snapshot reopen still reads and hashes every historical
file. Raising either deadline remains an unacceptable substitute for these
measured changes.

## Invariants that must not regress

1. A receipt must never be issued against an unverified or substituted history.
2. An attacker must not replace, truncate, reorder, or modify a prior segment
   and receive a later successful append receipt.
3. A process crash at every write phase must remain recoverable or fail closed.
4. Existing immutable event/anchor records and audit exports remain readable;
   a migration cannot rewrite historical evidence in place.
5. The production trust claim must be explicit. A test HMAC, ordinary mutable
   filesystem, cache hit, or process-local lock cannot be presented as a
   production immutable-storage authority.

## Rejected shortcuts

- Do not make `#cachedPrefix()` trust in-memory fingerprints without an
  independently authenticated immutable-storage guarantee. That would allow a
  modified old segment to survive until an arbitrary later full audit.
- Do not increase the 60-minute seed deadline or lower the formal event count.
  Either action turns an observed capacity failure into a slower test.
- Do not introduce a bulk method that emits normal per-event durable receipts
  before the entire batch is authenticated and committed.
- Do not reuse a state snapshot as proof that its referenced files are still
  immutable. A snapshot is evidence about a previously verified prefix, not an
  ongoing filesystem-integrity monitor.

## Required architecture change

Introduce a separate, branded `ImmutableLedgerSegmentStore` durability port.
The port owns the assertion that a content-addressed segment, once retained,
cannot be replaced at the same identity and resolves it with an authenticated
content digest and storage-version/retention proof. A production implementation
may use WORM/object-version retention or an equivalent external authority; the
current mutable local filesystem backend must continue to use full readback and
cannot claim this capability.

With that port, the next ledger format can use bounded segment manifests:

```
event records (fixed-size immutable segment)
        -> signed segment manifest (range, event digests, root)
        -> signed manifest chain head
        -> independent witness checkpoint
```

An append verifies the bounded active segment, its latest manifest/head, and
the current witness. Historical segments are referenced through the immutable
store proof instead of re-hashing every file for every append. A normal read or
offline audit still resolves and cryptographically verifies the full requested
history. If the store cannot provide the immutable proof, the ledger falls back
to current full-prefix verification or rejects the operation; it must never
silently use the fast path.

## Delivery sequence

1. Define the typed segment-store proof and reject unbranded/mutable adapters.
   Add adversarial tests for replacement, deletion, stale version, foreign
   tenant, proof replay, and cross-ledger substitution.
2. Add a versioned manifest-chain ledger backend beside the current file
   backend. The sealed-segment compose layer and branded directory contract
   are implemented; preserve v1 read/export and provide concrete durable
   directory/head stores plus a journaled, resumable, witness-bound migration;
   no in-place rewrite.
3. Define batch admission separately from normal append. A batch has one
   prepare/finalize authority and exposes per-event receipts only after the
   manifest and witness commit. The v1 compatibility batch and its crash/
   duplicate tests are implemented; the single-finalize v2 event batch and
   idempotent migration re-entry remain.
4. Add capacity evidence that records elapsed time, peak RSS, disk bytes,
   checkpoint latency, and event counts even on failure. Run 10,000 first, then
   250,000 only on a provisioned target with explicit resource bounds.
5. Run the existing Linux/Windows/macOS smoke and formal matrix, plus target
   environment disk-full, physical power-loss, witness-fault-domain, KMS/HSM,
   and PKI exercises. Only the complete evidence set may update EVO-P0-5.

## Acceptance criteria for the next code batch

- No API using the current mutable file backend reports the new immutable-store
  capability.
- Any proof failure causes `CC_EVOLUTION_LEDGER_*` fail-closed behavior before
  an append receipt.
- Replacement of an old segment is rejected both during normal append and
  reopen/audit tests.
- The existing 100-event and six-phase process-kill regression remains green.
- The 10,000-event matrix completes under a predeclared bound with a complete
  three-platform aggregate. Its result is still test-only unless the deployed
  immutable-store authority is part of the tested configuration.

The local Windows run satisfies the implementation-side timing regression, and
the 100-round local campaign is green. GitHub Actions formal run
[`34534369747`](https://github.com/chainlesschain/chainlesschain/actions/runs/34534369747)
then completed the exact-commit `a44514b712045acd82e425e2e96f5907113575e2`
Linux/Windows/macOS 10,000-event matrix and its `Test-only Evolution Ledger
three-OS aggregate`: every platform passed append/reopen/corruption and
100-round process-kill recovery, and the aggregate verified the matching SHA,
platform, formal profile, and test-authority declarations. This closes the
three-platform 10k test-only acceptance criterion; it does not authenticate the
mutable local backend as a production immutable store. 250,000 events,
disk-full/power-loss, independent witness fault domains, and production
KMS/HSM/PKI remain separate target-environment gates.
