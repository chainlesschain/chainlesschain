# Saved conversation history

Chat loads saved message pages when a restored conversation is opened or selected.
**Older** browses a separate read-only pane; **Live** returns to the retained live
transcript. **Latest** explicitly replaces the view with the newest saved page.
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

Request ownership, a view epoch, session ID and live revision gate results. An
active turn defers replacement; a late read cannot overwrite newer live output,
reset content or a disposed tab. Automatic refresh preserves text selection and
scroll position away from the bottom. Errors, interruptions and exit diagnostics
stay readable until an explicit saved-history load. History replacement does not
reissue semantic accessibility announcements or restore execution rights to cards.

The whole validated page remains readable even when it exceeds the live
transcript's 200K character cap: history is bounded to 100 rows / 1 MiB of text plus
headings, with 200K characters per row. The next live append resumes the live cap.
History is plain selectable text, including explicit notices for shortened rows.
Canonical compaction keeps prior original messages. Rewind, legacy replacement
and snapshot branches display **History begins at a saved snapshot**; complete
ancestor mapping and durable/live incremental merging remain pending.

Verification includes a shared real CLI page fixture also consumed by VS Code,
real Java subprocess output/error/cancellation/timeout tests, Swing component
tests for reconstruction, background completion, session replacement, paging,
selection, errors and oversized pages, plus the plugin's test/smoke/build tasks.
These are local tests; real IntelliJ GUI journeys, screen-reader listening and
current cross-platform host acceptance still require separate evidence.
