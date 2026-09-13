# Evolution Ledger v2 payload journal and cutover

This is a repository construction contract, not an external deployment or
physical durability acceptance report. V2 is explicitly enabled by the signed
host; missing authorities never cause a local-key or digest-only fallback.

## Production construction

`createAgentEvolutionRuntimeComposition` accepts an optional `ledgerV2` record:

```js
ledgerV2: {
  minimumRetainedUntil: "2036-09-09T00:00:00.000Z",
  createBackend({ authority, descriptor }) {
    // Host constructs the existing branded v2 backend using its genuine
    // retention-proof verifier/store, manifest signing authority, catalog,
    // head store, and independent witness adapter. No credentials go here.
    return host.openManifestBackend({ authority, descriptor });
  },
}
```

`authority` is the authenticated V1 ledger identity/epoch/store-marker and
witness projection. `descriptor` contains `tenantId`, `artifactTenantId`, and
`audience`. The returned object must be created by
`createEvolutionLedgerV2ManifestBackend`; structural objects and asynchronous
factories are rejected. The host owns actual key, trust, retention, storage,
and witness configuration. The root supplies its real artifact ports and
passes the same construction contract when opening a source Run for cache
evidence. All root-owned ledger consumers receive the journal wrapper.

The lower-level `createEvolutionLedgerFileBackend` accepts `manifestV2` with
the same two fields plus `artifactPorts` and `descriptor`. It returns the
existing branded file-backend shape, with `ledger` replaced by the branded
v2 journal. The underlying V1 write capability is not exposed by that wrapper.
`createEvolutionLedgerV2Journal` is available for already-constructed, branded
source/target components. There is no implicit deployment-loader authority.

Before the first migration marker, omitting V2 preserves V1 behavior. Once the
signed migration intent exists, a file backend opened without V2 fails with
`CC_EVOLUTION_LEDGER_V2_REQUIRED`; already-open V1 ledger objects also refuse
ordinary appends. Old read-only V1 APIs and signed receipts remain compatible.

## Event payload and live finalization

V2 segments can now carry complete signed event objects under
`chainlesschain.evolution-ledger-event-payload/v2`. Canonical bytes include the
event body, signature, source/subject refs, tenant, identity, sequence and
previous-event digest. Bounds, canonical event digest, sequence and scope are
checked before retention. Manifest signatures bind the complete content digest
and event digest list; a signed head and independent witness bind the segment.
`readEvents()` resolves immutable bytes and revalidates the entire chain.
It refuses digest-only segments. The legacy low-level `eventDigests` API remains
available for existing callers, but cannot supply this production journal.

The journal additionally compares every recovered event byte-for-byte against
the authenticated V1 source. Thus manifest authentication does not silently
substitute for verification of the original ledger signer/artifact authority.

`append`, `appendBatch`, `appendDomainEvent`, and `appendDomainEventBatch` keep
their existing V1 receipt formats. They return only after V2 finalization and
full payload readback. A successful live batch must fit one configured segment;
oversized batches are rejected before writing. A single successful batch makes
one segment-retention call, one manifest publication, one head CAS, and one
witness checkpoint (not one V2 checkpoint per event).

`finalizeBatch` and `finalizeDomainEventBatch` additionally return:

```js
{
  schema: ("chainlesschain.evolution-ledger-v2-finalization/v2",
    receipt, // Existing authenticated V1 batch receipt.
    checkpoint); // V2 append receipt, signed manifest/head/witness, retention proof.
}
```

The checkpoint's manifest digest list equals the batch receipt's event list;
its witness binds that manifest and head. It is not an atomic multi-store
transaction: partial catalog/head/witness commits use existing recovery and
unknown-commit semantics. A failed V1 batch may have durably committed a prefix,
as before. Such calls return `CC_EVOLUTION_LEDGER_V2_JOURNAL_COMMIT_UNKNOWN` with
the original error as `cause`, and no success receipt. Reopen recovers only the
authenticated prefix; it neither invents the uncommitted suffix nor promises
whole-batch rollback. Retry by querying/recovering the original event IDs;
duplicate live event IDs remain conflicts rather than silently repeated writes.

## Restartable migration

Migration and live operations hold a strict cross-process cutover lock, separate
from the existing V1 ledger lock. The journal is made of signed V1 domain events
and authenticated, ledger-retained `evolution-ledger-v2-journal` artifacts:

1. `evolution.ledger-v2.migration-intent` binds the original source prefix,
   identity, epoch, physical store-marker identities, tenant, retention bound,
   segment limit, and a digest of the target manifest/retention/witness authority
   descriptors. Ordinary callers cannot append reserved migration events.
2. Reopen verifies the V2 payload as an exact prefix of V1, then copies the
   remaining suffix in bounded segments. The manifest chain is the progress
   journal; a lost response does not require a mutable local progress counter.
3. `evolution.ledger-v2.cutover-completed` is appended only after the initial
   prefix has been read back from V2. It binds the intent and witnessed source
   frontier; the completion event is itself then copied to V2.
4. Reopen resumes an unacknowledged intent/completion or partial checkpoint.
   Duplicate/mismatched markers, another authority binding, a divergent target,
   or a V2 target behind the signed completed frontier fail closed. A completed
   cutover cannot silently seed an empty replacement backend.

Read/query/audit/receipt operations on the wrapper first finish recovery and
validate both stores. `read` and query results return the recovered V2 payload;
legacy authority/receipt projections retain their V1 schema. A failed or
unavailable V2 read cannot fall back to V1 success.

## Verified scope and remaining limits

Tests use explicitly labeled test-only HMAC authorities and on-disk segment,
catalog, head, artifact, V1 ledger and witness files. Fresh Node processes check
exact payload/witness recovery; injected response loss and process termination
exercise migration markers, catalog/head/witness publication and partial live
WAL commits. These are repository-level fault injections, not production PKI
or WORM proofs.

V1 remains the retained signed WAL and compatibility receipt authority. This
cutover does not delete V1 events or reduce their per-event signing/fsync/witness
cost. Recovery currently validates full prefixes; this implementation makes no
250,000-event throughput, bounded-total-memory, or compaction claim. Artifact
ports retain their existing persistence/readback semantics, which are not a
physical power-loss proof. Missing or lost artifacts fail closed.

Not performed here: 250k load acceptance, actual disk-full/power-loss testing,
independent WORM retention validation, KMS/HSM/PKI operations, or three-platform
deployment acceptance. Old binaries that predate cutover admission must be
excluded by deployment governance; the repository cannot revoke an independently
running obsolete writer or manufacture an independent storage authority.
