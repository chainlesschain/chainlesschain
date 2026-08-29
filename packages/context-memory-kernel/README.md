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
