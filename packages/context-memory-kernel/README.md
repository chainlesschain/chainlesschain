# Context/Memory Kernel

Canonical, host-neutral Context/Memory Kernel for ChainlessChain. The package owns deterministic context planning, compaction invariants/CAS, scoped memory lifecycle, tombstone fencing, deletion reconciliation, and writer cutover authority.

The package intentionally performs no filesystem, database, provider, embedding, or network I/O. Hosts implement `SessionContextPort`, `MemoryPort`, `ContentPort`, and purge/reconciliation ports. Shadow mode is observation-only and cannot mutate authority state.

Public operations:

- `planContext(request)`
- `compactContext(request)`
- `recallMemory(request)`
- `proposeMemory(request)`
- `decideMemory(command)`
- `deleteMemory(request)`
- `reconcile(operationId)`

See `schema/context-memory-kernel.schema.json` for the wire contract and `inventory/writers.v1.json` for migration ownership.

Operational gates:

- `npm test` validates contracts, conformance, privacy/recovery, inventory, and release evidence.
- `npm run check:writers` emits a clean-HEAD-bound static/runtime writer receipt.
- `npm run benchmark:quick` / `benchmark:release` emit the §18 capacity receipt.
- `npm run test:soak:quick` / `test:soak:release` exercise multi-compaction and restart recovery through CLI, Desktop, VS Code, and JetBrains fixed-capability host adapters.

Deletion receipts cover the canonical authority plus registered online content, index, cache, replica, and migrated legacy purge ports. External backups and historical offline files that were never admitted through a Kernel adapter remain deployment-retention responsibilities and are not represented as purged by the receipt.
