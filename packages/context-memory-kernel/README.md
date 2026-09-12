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

## Multilingual lexical recall

Recall preserves exact-word matching for non-Han text and adds contiguous multi-character Han keyword matching within Han runs. Mixed tokens such as `Vue开发` require every script component to match; they do not match `Vue部署` or `Python开发`. Components may match across the existing searchable category, tags, summary, and content fields. Space-separated query tokens retain fractional scoring, not phrase or all-terms semantics.

| Query         | Stored content            | Lexical match                                        |
| ------------- | ------------------------- | ---------------------------------------------------- |
| `确定性测试`  | `偏好使用确定性测试`      | Yes                                                  |
| `测`          | `偏好使用确定性测试`      | No: single Han characters require a whole script run |
| `get_user_id` | `使用get_user_id读取用户` | Yes                                                  |
| `get_user`    | `使用get_user_id读取用户` | No                                                   |
| `Vue开发`     | `使用Vue开发工具`         | Yes                                                  |
| `Vue开发`     | `Vue部署`                 | No                                                   |

This is keyword retrieval, not dictionary segmentation, synonym search, or semantic retrieval. It adds no embedding calls, persistent index, or record migration. Scope, allowed sinks, lifecycle/expiry filtering, revision/tombstone authority, ranking weights, and whole-record token budgets remain unchanged. Existing record digests remain valid; recall-result digests can change when the selected results or scores change. The existing first-2048-token-occurrence search boundary remains in place.

From a **repository checkout root**, run the small synthetic comparison (stdout JSON) and its contracts:

```sh
node packages/context-memory-kernel/scripts/lexical-retrieval-eval.mjs
node --test packages/context-memory-kernel/test/lexical-retrieval-eval.test.js
```

The fixed fixture compares Recall@k, MRR, and negative-query false recall against the previous exact-token matcher through the same governance filters. It does not certify natural-language quality, production capacity, or a release. See [G06 implementation and validation](../../docs/CLAUDE_CODE_CODEX_GAP_G06_IMPLEMENTATION_2026-09-12.md) for evidence and remaining limits.

## Operational gates

- `npm test` validates contracts, conformance, privacy/recovery, inventory, and release evidence.
- `npm run check:writers` emits a clean-HEAD-bound static/runtime writer receipt.
- `npm run benchmark:quick` / `benchmark:release` emit the §18 capacity receipt.
- `npm run test:soak:quick` / `test:soak:release` exercise multi-compaction and restart recovery through CLI, Desktop, VS Code, and JetBrains fixed-capability host adapters.

Deletion receipts cover the canonical authority plus registered online content, index, cache, replica, and migrated legacy purge ports. External backups and historical offline files that were never admitted through a Kernel adapter remain deployment-retention responsibilities and are not represented as purged by the receipt.
