# Chat history recovery

The chat host reads display-only history using:

```text
cc session show --json --history --page-size 50 [--before <cursor>] -- <session-id>
```

This requires a CLI with the v2 history page contract. Older CLIs report a load
error; the extension does not silently label active model context as complete
history. Recovery never starts an Agent, sends input or executes saved tools.

Canonical Kernel compaction retains original display messages while independently
updating model context. Stable row IDs combine the session, event hash and item
index. Identical text in separate events remains separate. Cursors bind the
session, history generation and a verified event-count/revision prefix, allowing
older pages to survive appends and canonical compaction. A full-copy fork has its
own row namespace and cannot use its parent's cursor.

New CLI timeline conversation/both restores persist a prefix certificate tied to
the transaction's current head and active message counts. History verifies that
exact prefix and follows indexed compaction sources and summary parent digests to
cut the original archive before the selected user turn. Retained rows keep their
IDs; rewinds invalidate old cursors. A rescan under the same lock can recover a
prefix older than the page buffer without reviving discarded paths.

New timeline `summary-from` / `summary-to` commits carry a v1 summary certificate
bound to the actual previous event hash, source message count and source range.
The reader reproduces the exact rewrite, including durable system provenance,
before retaining the original archive. Successful summaries keep row IDs,
generation and existing page cursors; active model context still contains the
summary. The planner and reader share the deterministic v1 transform. Changes to
that transform or its extractive formatter require versioning or a v1 reader;
an incompatible rewrite falls back to the saved snapshot.

Derived system messages carry conservative source spans through subsequent
summaries, Kernel compaction and branch imports. Rewind checks these dependencies
as well as visible messages; an unknown or crossing span prevents a prefix claim.
The range is an ancestry bound, not a claim that every fact survives extraction.
Unmarked systems are still excluded from newly authorized summaries, and
`summary-to` preserves the existing host-prompt/durable-system rules.

New timeline branches copy the selected display archive into their own verified
chain. Archive records are separate from model context and execution events;
permissions, input receipts, tool requests and usage authority are not inherited.
The copied context keeps the previous branch semantics. Context-origin markers
support later compaction, rewind and nested branches. Deleting the parent does
not remove the child's copied history, and each branch has its own row IDs.
Branches with mapped system-summary origins use branch-history descriptor v2;
other branches retain v1. The reader accepts both, requires durable provenance
for a system's v2 origin, and bounds it by the copied archive. Older readers reject
v2 instead of dropping those dependencies. Existing v1 system origins remain null.

Archive text is copied in 128K-character chunks, preserving surrogate pairs and
the full display text beyond the page's rendering cap. A logical row is identified
by its final chunk event; its provenance points to the immediate parent row.
Readers validate chunk ordering, source identity, counts, context message digests
and the complete creation digest. They assemble at most 16 MiB of text / 256 chunks
per row, within the canonical source-record bound. Images retain their display
placeholder; this is not a copy of all original media or tool-event payloads.

Creation streams under the source and destination locks and revalidates the
source. Exact crash prefixes can resume; incomplete copies remain unpublished,
and an existing higher authority anchor cannot be lowered. Existing legacy
snapshot branches remain idempotent and are not rewritten into new histories.
This requires several full scans and per-record durable appends; it does not
establish a branch-creation latency SLO.

Legacy compact snapshots, rewinds without verifiable prefix ancestry, old or
unverifiable summary actions and snapshot branches establish a history boundary.
The view says **History begins at a saved snapshot**. Equal text does not establish
ancestry. A verified rewind retains any earlier snapshot coverage restriction.
Complete ancestry across the remaining boundaries is still pending.

Each page retains at most 100 rows / 1 MiB of row JSON, with 200,000 characters per
row. Escaping can shorten a row further to meet its JSON byte budget; the row
remains present with `truncated=true`. The host requests 50 rows and caps CLI output at 2 MiB. Full hash-chain and
anti-rollback verification still scans the transcript. This is bounded snapshot
paging, not an indexed query or durable/live incremental merge. During an active
turn the host retains its bounded live cache, then reloads the canonical snapshot.
Optional origin tracking retains at most 32,768 active messages / 8 MiB of
message JSON; larger contexts lose this mapping and use the snapshot on rewind
or timeline summary. Summary verification temporarily reconstructs the rewrite
within that input bound; it does not introduce an index or a latency guarantee.
The selected archive has at most 16,384 disjoint ranges; exceeding that limit
reports an error. Compaction mapping uses the persisted source layout, and cannot
invent missing provenance for an incompatible layout or unknown summary parent.
These bounds exclude temporary parsing of one bounded canonical record. Rewinds
can require two full scans; this change makes no latency or indexed-query claim.

Local tests cover real temporary JSONL storage and Kernel compaction, summary
replacement, rewind invalidation, fork isolation, tampering, cursor validation,
bounded traversal, repeated rewind ancestry, identical text at different source
positions, the real CLI preview/confirm path and host reconstruction. JetBrains uses the same v2 page
contract; see [its history reader](../../jetbrains-plugin/docs/CHAT_TRANSCRIPT_HISTORY.md).
Real VS Code and JetBrains journeys and cross-platform acceptance remain pending.
