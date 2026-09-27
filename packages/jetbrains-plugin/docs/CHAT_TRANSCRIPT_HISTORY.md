# Saved conversation history

Chat loads saved message pages when a restored conversation is opened or selected.
**Older** browses a separate read-only pane; **Live** returns to the retained live
transcript. **Latest** reads and merges verified saved updates into the live view.
Sending input returns to the live pane. Each conversation owns its own history
requests and transcripts, including background completions.

The reader runs `cc session show --json --history --page-size 50 [--before cursor]
-- session-id`. It uses the v2 display-history contract, validates the session,
event/item IDs, revision, ordering and navigation boundaries, and never starts an
Agent or dispatches saved messages as protocol events. A CLI without this contract
shows a load error with the existing live transcript retained.

Reads run outside the EDT in a shared pool of two workers with 32 queue slots.
Query stdout is limited to 2 MiB; stderr retains at most 16 KiB while draining the
rest. Nonzero exits, incomplete/invalid JSON, malformed UTF-8, timeout and oversized
output are errors. Capture has a 35-second timeout after binary resolution and a
cancellation check; failed queries terminate through the existing observed-process
tree mechanism. This does not claim Job Object/cgroup containment or discovery of
already detached descendants.

Request ownership (including the originating child), a view epoch, session ID
and live revision gate results. An active turn defers reading; a late read cannot overwrite newer live output,
reset content or a disposed tab. Automatic refresh preserves text selection and
scroll position away from the bottom. Errors, interruptions and exit diagnostics
remain unassociated live text during merging. History updates do not
reissue semantic accessibility announcements or restore execution rights to cards.

The whole validated page remains readable even when it exceeds the live
transcript's 200K character cap: history is bounded to 100 rows / 1 MiB of text plus
headings, with 200K characters per row. The next live append resumes the live cap.
History is plain selectable text, including explicit notices for shortened rows.
Canonical compaction keeps prior original messages. New CLI timeline rewinds can
retain verified ancestors through indexed compaction sources and summary parent
digests, while invalidating old cursors and excluding discarded paths. New CLI
timeline branches carry their selected display archive independently of the
parent, including complete text stored in chunks, and support subsequent rewind
or nested branching. The view still applies its normal page rendering limits.
New CLI timeline summaries retain original rows and page cursors after verifying
the source head/count/range and exact rewrite, including durable system tags.
System-summary dependencies also participate in later rewind/branch checks;
unknown or crossing dependencies cannot establish a retained history prefix.
Older or unverifiable rewinds and summaries, legacy replacements and
old or unverifiable snapshot branches display **History begins at a saved snapshot**. Earlier coverage limits
are retained after a verified rewind. See the shared [CLI history contract and
bounds](../../vscode-extension/docs/CHAT_TRANSCRIPT_HISTORY.md); complete ancestry
across the remaining legacy boundaries is not claimed.

Latest v2 pages provide a sync cursor. Subsequent reads use the CLI's
[verified update contract](../../cli/docs/SESSION_TRANSCRIPT_CHANGES.md),
`--history --after cursor`, with at most eight 50-row batches per refresh; Latest
continues from the last successfully applied batch. Older navigation has a
separate cursor and pane. Only a nonzero exit containing the exact stale-error
schema, expected session and stale code reloads a baseline. Integrity, invalid
UTF-8, parser and process errors keep the old cursor and readable text.

Input receipts and terminal `transcript_refs` establish candidates bound to the
original child/session and client message ID. Only verified event/item/role IDs
associate the user and final assistant segment with saved rows. Repeated equal
text from different events remains separate; retries and duplicate receipts do
not duplicate identified rows. Intermediate output, tool activity and diagnostics
remain live-only. A CLI without references can show both an unassociated live
row and a saved row; matching by text would lose valid repeated messages.

User rows are reserved on the EDT before writing stdin on the send worker,
allowing even an immediate receipt to find its input. Error/budget results with
saved references associate their final text separately from the stop diagnostic.
Rewind baseline merges remove discarded saved rows while retaining unassociated
diagnostics. No history update sends input, reruns tools, restores approvals or
reissues completion announcements.

Styled document ranges preserve unchanged text and selection. Conflicting
replacement/deletion/reordering waits for selection collapse, rechecks request
ownership and live revision, then applies before advancing the cursor. A selection
that prevents budget eviction also defers the batch. History text stays within
100 saved rows and 1 MiB plus 16,384 heading characters; live appends retain the existing 200K cap,
and range metadata is limited to 4,096 entries (saved ranges are evicted as text,
never silently reclassified as live-only). Evicted saved content remains accessible
through saved-history pagination. A final assistant run selected during completion
keeps its plain Markdown text; delayed Markdown restyling is not implemented.

Verification includes shared real CLI page and incremental fixtures also consumed by VS Code,
real Java subprocess output/error/cancellation/timeout tests, Swing component
tests for reconstruction, background completion, session replacement, paging,
selection, errors and oversized pages, plus the plugin's test/smoke/build tasks.
These are local tests; real IntelliJ GUI journeys, screen-reader listening and
current cross-platform host acceptance still require separate evidence.
