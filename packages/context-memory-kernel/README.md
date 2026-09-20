# Context/Memory Kernel

Current npm package: `@chainlesschain/context-memory-kernel@0.1.5`. This
release includes the checked-in contracts, schemas, fixtures, inventory, and
documentation that are verified byte-for-byte before the paired CLI publishes.

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
- `checkpointTaskProgress(request)` — synchronous session-port revision/CAS settlement for bounded task progress; host Markdown files are rebuildable projections, not memory authority.

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

The default remains keyword retrieval, not dictionary segmentation or synonym search. Hosts may optionally pass bounded `semanticCandidates` produced by an embedding/index port. Every score is bound to `memoryId`, `revision`, and the canonical record digest; stale evidence fails closed. The kernel applies lifecycle, expiry, scope, and allowed-sink gates before a semantic score can affect recall, so an external index cannot bypass memory governance. The kernel itself still performs no embedding calls, persistent indexing, or record migration.

Hybrid ranking uses the stronger of lexical and semantic relevance as the existing 65% retrieval component. This preserves lexical-only ranking exactly while allowing a governed semantic candidate to recover a lexical miss. Existing record digests remain valid; recall-result digests can change when selected results or scores change. The existing first-2048-token-occurrence lexical boundary remains in place.

From a **repository checkout root**, run the small synthetic comparison (stdout JSON) and its contracts:

```sh
node packages/context-memory-kernel/scripts/lexical-retrieval-eval.mjs
node --test packages/context-memory-kernel/test/lexical-retrieval-eval.test.js
```

The fixed fixture compares Recall@k, MRR, and negative-query false recall against the previous exact-token matcher through the same governance filters. It does not certify natural-language quality, production capacity, or a release. See [G06 implementation and validation](../../docs/reports/implementation/claude-code-codex/CLAUDE_CODE_CODEX_GAP_G06_IMPLEMENTATION_2026-09-12.md) for evidence and remaining limits.

## Operational gates

- `npm test` validates contracts, conformance, privacy/recovery, inventory, and release evidence.
- `npm run check:writers` emits a clean-HEAD-bound static/runtime writer receipt.
- `npm run benchmark:quick` / `benchmark:release` emit the §18 capacity receipt.
- `npm run test:soak:quick` / `test:soak:release` exercise multi-compaction and restart recovery through CLI, Desktop, VS Code, and JetBrains fixed-capability host adapters.

Deletion receipts cover the canonical authority plus registered online content, index, cache, replica, and migrated legacy purge ports. External backups and historical offline files that were never admitted through a Kernel adapter remain deployment-retention responsibilities and are not represented as purged by the receipt.
