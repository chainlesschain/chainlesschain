# Chat draft recovery (development branch)

The chat composer saves text and image snapshots in the IDE configuration
directory under `chainlesschain/chat-drafts/<workspace hash>`. Project properties
store only tab titles, session IDs and stable draft keys. Image bytes and message
text are kept outside the project repository. Drafts are local plaintext recovery
data, not a credential vault or execution authority.

## Sending and acceptance

Typing schedules a coalesced save after 250 ms. Sending queues preservation of
the current composer before binary probing or agent startup. Storage failures
prevent dispatch. The host then waits for CLI initialization, saves a separate
submission, and records `unknown` before writing to stdin. Only after saving that
submission may the unchanged composer be cleared. Programmatic edits made during
delivery are kept separately.

A CLI advertising `input_receipts.version=1` receives a random `client_message_id`.
Acceptance requires a receipt from the owning child/session with the matching
saved ID and well-formed input/event hashes. The CLI computes its input digest
after parsing, which may discover typed image paths; the IDE does not substitute
its local wire digest for that authoritative value. A pipe write, turn result or
legacy CLI response alone never marks an input accepted. Acceptance proves input
storage, not completion of the requested work.

**Saved inputs** can check acceptance through the read-only
`session show <id> --json --input-receipt <client-id>` command. This action never
starts an agent or retries the input. Non-accepted submissions can be copied into
an empty composer for editing. Inspect the conversation before deliberately
resending an unknown delivery. Accepted inputs are removed from this recovery
list before a later send only when the host observes no pending turn; attachments
remain available until then. Explicit record discard is blocked while the live
session has pending turns.

## Recovery

Tabs retain their draft keys across restart and reopen. **Recover drafts** finds
saved input from closed tabs and opens it without launching a CLI process. Legacy
session-only tab settings migrate to the new metadata format.

Restore waits for attachment verification. Late restore cannot replace newer
text; a conflict remains visible and blocks sending until reviewed. If that tab
is closed without resolving the conflict, the newer input is saved as a separate
recoverable draft. Missing or changed attachments also block sending. Their text
can still be edited and saved without silently discarding the attachment
metadata; **Clear attachments** explicitly removes that requirement.

Normal tab disposal queues a final save and releases owned temporary image files
after storage work. Wait for the saved status before quitting. A forced process
exit during debounce or I/O is not guaranteed to preserve the last keystroke.

## Storage and validation boundaries

- 100,000 characters per composer/input; four images, 20 MiB per message and
  40MP per image. Snapshots use bounded reads, file identity/size checks and SHA-256.
- Eight saved submissions per draft, 128 draft directories, 100 MiB total storage,
  and 2 MiB per metadata record. Failed saves keep the previous record and remove
  newly unreferenced snapshots. Corrupt metadata is not silently overwritten.
- A separate worker accepts at most 64 queued operations. Store operations are
  serialized within the IDE process; they do not wait on the agent stdin monitor.
- Metadata is flushed to a temporary file and atomically renamed. Unsupported
  atomic replacement fails rather than claiming success. This does not establish
  power-loss durability or multi-process coordination between independent IDEs
  sharing the same configuration directory.

## Question forms and response ownership

Normal questions and supported MCP forms appear inline, so deferred questions do
not block independent work in a modal dialog. Text, checkbox and select fields
save after 250 ms. Recovery identity covers the session, request ID, complete
interaction binding and question/schema content. After a host restart, fields
are restored only when the CLI issues that exact bound request again. Legacy
unbound questions retain edits within the same live request instance; their disk
records are available only as text recovery. Restoration never submits an answer.

Password and `writeOnly` fields are excluded from storage and copied recovery
text. Unsupported schemas use an explicit JSON fallback whose contents are never
saved. Ordinary answer text remains plaintext; the host does not detect every
secret the user may enter. Supported fields keep their declared order, choices
use collision-free keys, and coercion/validation occurs before submission.

Answer and Cancel reserve the original request once, save its recoverable fields
as archived, and then dispatch on the send worker to the original child and
generation. Duplicate clicks cannot enqueue another answer. Only a matching
`question_resolved` confirms resolution; pipe failures and explicit rejections
remain unknown and are not retried. Storage failure before dispatch permits an
explicit retry. Reused IDs with changed content cannot establish unambiguous
resolution. URL actions use the captured URL, require explicit HTTPS confirmation,
and recheck ownership after the confirmation dialog.

Blocking requests archive when their turn ends; deferred requests survive turn
completion. Stop, process replacement, exit and tab closure invalidate response
authority immediately. Archived fields can be copied from **Saved inputs** into
an empty composer or discarded there. Successful terminal saves remove the card;
if storage fails, the form stays readable with **Copy fields** and retry controls.
This protects in-memory edits while the tab remains open; closing or forcibly
exiting while storage is failing cannot guarantee recovery.

Each draft holds at most 16 question records, 128 fields, 32K characters per field,
64 KiB of projected fields and 128 KiB per question record. Reaching the limit
shows a save error; discard reviewed records under **Saved inputs** before retrying.
At most 256 request identities are retained per child so replayed terminal
requests cannot regain authority; restart the agent after that limit. Request
hashing/snapshots are bounded by depth, node count and bytes. Metadata writes
version 2 and reads versions 1/2; older hosts reject v2 instead of silently
discarding question records. No approval decision is saved or replayed.

JUnit covers real temporary files, snapshot recovery, changed/corrupt data,
rename failure, quotas, delayed restore, close during startup, newer input during
send, unknown/accepted transitions and attachment retention. Swing component
tests run without a live IntelliJ project. Actual IDE restart/interaction,
cross-platform host acceptance and accessibility listening remain outstanding.
Additional question tests cover real disk persistence, migration, secret-field
projection, duplicate dispatch, stale ownership, failed save/load retry, late
restore, deferred turn completion and native Swing form validation. These remain
local component/contract tests, not a real IDE lifecycle acceptance result.
