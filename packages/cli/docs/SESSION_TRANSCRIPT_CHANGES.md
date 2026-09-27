# Verified transcript updates

Read a latest display-history page to establish a baseline:

```text
cc session show --json --history --page-size 50 -- <session-id>
```

The existing `chainlesschain.session-transcript-page/v2` response adds an optional
`syncCursor`. It binds the session, display generation, verified event-count/head
prefix and the next display ordinal. A latest page represents the current tail
even when older rows are outside its rendering budget. `--before` navigation
returns `syncCursor: null`; browsing older pages must not advance the latest
view's update baseline. An older CLI without this field supports snapshot paging
only.

Request new rows with that cursor:

```text
cc session show --json --history --after <sync-cursor> --page-size 50 -- <session-id>
```

`--after` requires `--json --history`. It cannot be combined with `--before`,
`--input-receipt` or `--limit`. It only reads canonical JSONL sessions, never
starts an Agent, resumes a model or dispatches saved tools.

The response uses `chainlesschain.session-transcript-changes/v1`:

| Field                     | Meaning                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `sessionId`, `generation` | Session namespace and selected display-history generation                           |
| `revision`, `eventCount`  | Fully verified current canonical head and event count                               |
| `totalMessages`           | Current count of selected display messages                                          |
| `from`                    | The supplied sync cursor's next ordinal                                             |
| `messages`                | The first contiguous batch at or after `from`, using the existing v2 row identities |
| `nextCursor`              | Sync cursor immediately after the returned batch, always present                    |
| `hasMore`                 | More rows exist after that cursor in this response's verified snapshot              |
| `contextOnly`, `coverage` | `false` and the same explicit history coverage as v2 pages                          |

Rows retain `id = sessionId:eventId:itemIndex`; identical text in different rows
does not merge. The first ordinal is exactly `from`, with no gaps. A batch is
empty only when `from === totalMessages`. Metadata-only appends can advance
`revision`, `eventCount` and `nextCursor` without adding a row. Retrying the same
cursor on an unchanged chain returns the same batch; a concurrent append may add
more rows or advance its verified revision.

After applying a batch, retain `nextCursor` and request again while `hasMore` is
true. New appends between batches remain reachable. Advance the consumer cursor
only after applying rows successfully, and deduplicate retries by full row ID.
Keep Older navigation separate from this update cursor. Check the current
session/request/view ownership before applying asynchronous results.

The reader verifies the exact cursor prefix and final generation under the
existing canonical lock. Canonical Kernel compaction and verified timeline
summaries preserve the cursor. Rewind, an unverified context replacement or an
inconsistent cursor fails with `SESSION_TRANSCRIPT_CURSOR_STALE`; the CLI command
returns a `chainlesschain.session-transcript-changes-error/v1` JSON object with
`sessionId`, `code` and a bounded `error` message, and exits nonzero. Invalid
command combinations use `SESSION_TRANSCRIPT_CHANGES_FAILED`; a known unreadable
canonical namespace uses `SESSION_TRANSCRIPT_UNAVAILABLE`. Other storage errors
retain their existing error codes. Consumers must reload a latest baseline for a
stale cursor, not
append the replacement onto obsolete durable rows or conceal an integrity error
as ordinary cursor expiration. Cross-session cursors,
including a parent's cursor used on a fork, are rejected. Earlier snapshot
coverage restrictions persist after incremental updates.

Each batch retains at most 100 rows and 1 MiB of row JSON; individual display text
is capped at 200,000 characters and may be further shortened for JSON escaping.
A row that would exceed the remaining batch budget is deferred to the next batch;
later smaller rows cannot pass it. Complete source text remains in storage. The
reader still verifies the entire chain and anchor even after filling a batch.
Historical rewinds can require a second scan under the same lock. Origin mapping
and branch-import limits are unchanged. This is bounded output, with O(N) chain
validation, not an indexed or constant-time update API.

This contract provides durable row updates. It does not associate a streamed
partial answer with its eventual canonical row. VS Code and JetBrains currently
use snapshot replacement and have not yet connected this API to their live
transcripts. They must add explicit runtime-to-canonical message identities and
guarded merging before claiming durable/live deduplication. No text-equality
heuristic, new execution permission or input-delivery guarantee is introduced.

Local verification uses real temporary JSONL storage, Kernel compaction, timeline
summary/rewind, fork isolation, invalid cursors, oversized rows, corrupt tails and
an actual subprocess running the repository CLI entry point. It does not prove an
installed release, real IDE journeys or cross-platform acceptance.
