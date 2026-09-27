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

Legacy compact snapshots, rewind and snapshot branches establish an explicit
history boundary. The view says **History begins at a saved snapshot**. Earlier
ancestry is not inferred from matching text, and withdrawn messages are not added
back. Full ancestor recovery across these boundaries remains pending.

Each page retains at most 100 rows / 1 MiB of row JSON, with 200,000 characters per
row. The host requests 50 rows and caps CLI output at 2 MiB. Full hash-chain and
anti-rollback verification still scans the transcript. This is bounded snapshot
paging, not an indexed query or durable/live incremental merge. During an active
turn the host retains its bounded live cache, then reloads the canonical snapshot.

Local tests cover real temporary JSONL storage and Kernel compaction, summary
replacement, rewind invalidation, fork isolation, tampering, cursor validation,
bounded traversal and host reconstruction. JetBrains uses the same v2 page
contract; see [its history reader](../../jetbrains-plugin/docs/CHAT_TRANSCRIPT_HISTORY.md).
Real VS Code and JetBrains journeys and cross-platform acceptance remain pending.
