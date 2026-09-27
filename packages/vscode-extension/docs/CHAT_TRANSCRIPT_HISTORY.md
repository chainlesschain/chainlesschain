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

Legacy compact snapshots, rewinds without verifiable prefix ancestry, timeline
summary actions and snapshot branches establish an explicit history boundary.
The view says **History begins at a saved snapshot**. Equal text does not establish
ancestry. A verified rewind retains any earlier snapshot coverage restriction.
Complete ancestry across the remaining boundaries is still pending.

Each page retains at most 100 rows / 1 MiB of row JSON, with 200,000 characters per
row. The host requests 50 rows and caps CLI output at 2 MiB. Full hash-chain and
anti-rollback verification still scans the transcript. This is bounded snapshot
paging, not an indexed query or durable/live incremental merge. During an active
turn the host retains its bounded live cache, then reloads the canonical snapshot.
Optional rewind origin tracking retains at most 32,768 active messages / 8 MiB of
message JSON; larger contexts lose this mapping and use the snapshot on rewind.
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
