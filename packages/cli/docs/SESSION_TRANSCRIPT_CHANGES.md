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

## Terminal message references

The stream-json runtime adds optional `transcript_refs` to a terminal `result`
after the assistant message writer returns a synchronous committed append receipt:

```json
{
  "schema": "chainlesschain.session-transcript-references/v1",
  "sessionId": "session-1",
  "assistantEventId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "userEventId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "clientMessageId": "client-1"
}
```

`assistantEventId` is required when the object is present. `userEventId` is
optional and comes from this turn's committed user append or validated input
receipt. `clientMessageId` is optional and echoes this turn's supplied input ID.
Hashes identify events, not stream chunks or tool output. The reference is absent
for ephemeral sessions, duplicate-input acknowledgements, missing/unconfirmed or
failed assistant appends and early terminal paths without an assistant append.
A budget/error result can still reference a saved final answer. Reference
presence does not change `is_error`, execution outcome or input acceptance.

Before associating a live final answer, consumers must check the originating
child, current session/request/view ownership and equality between the outer
`result.session_id`, `transcript_refs.sessionId` and expected session. The schema
validates shape; it cannot prove these ownership relationships. Read verified
history and match the referenced event and role, then use the returned full row
ID (`sessionId:eventId:itemIndex`). A missing, superseded, truncated or omitted
row is not permission to invent its text or silently discard unmatched live
output. A final-answer reference does not label every earlier assistant fragment
or tool card. Deduplicate verified rows by identity, never equal text. Keep
unassociated live diagnostics and partial output distinguishable from saved rows.

VS Code and JetBrains currently use snapshot replacement and have not yet
connected this update API or terminal references to their live transcripts.
Guarded merging and UI preservation remain required before claiming durable/live
deduplication. References grant no execution or recovery authority and do not
replace an input receipt.

Local verification uses real temporary JSONL storage, Kernel compaction, timeline
summary/rewind, fork isolation, invalid cursors, oversized rows, corrupt tails and
an actual subprocess running the repository CLI entry point. A separate runtime
test uses real canonical storage with an injected model loop: three identical
inputs/answers produce distinct event identities that resolve to the correct six
verified history rows, including turns with and without client input IDs. It does
not prove an installed release, real IDE journeys or cross-platform acceptance.
