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
blind retry. The combined contract tests now cover 22 cases. This remains an
interface, not a durability claim: the v2 file/WORM head-store implementation,
witness checkpoint publication, crash-point tests, and v1 migration are still
required.

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

## Observed baseline

At commit `1613df9fdad5bc9a7fc6c5c6ee0ec26b52588b11`, the three-platform smoke
run `34309940597` passed 100 append/reopen/corruption events and six forced
process-exit recovery rounds. The formal run `34310624758` failed on Linux,
Windows, and macOS during its 10,000-event seed. Each runner reached the
one-hour seed deadline before the reopen, corruption, fault-campaign, or
aggregate phases. Ubuntu reached 6,200 events and showed increasing time per
100-event interval.

The present file backend deliberately lists, opens, hashes, and authenticates
the complete immutable anchor and segment prefix before and after each append.
It therefore provides prompt detection of an out-of-band mutation, but its
per-append work grows with ledger length. Raising the deadline would hide this
property and is not an acceptable remediation.

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
   backend. Preserve v1 read/export and provide a journaled, resumable,
   witness-bound migration; no in-place rewrite.
3. Define batch admission separately from normal append. A batch has one
   prepare/finalize authority and exposes per-event receipts only after the
   manifest and witness commit. Test all crash points and duplicate/idempotent
   re-entry.
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
