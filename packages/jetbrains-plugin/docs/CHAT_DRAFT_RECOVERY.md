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

JUnit covers real temporary files, snapshot recovery, changed/corrupt data,
rename failure, quotas, delayed restore, close during startup, newer input during
send, unknown/accepted transitions and attachment retention. Swing component
tests run without a live IntelliJ project. Actual IDE restart/interaction,
cross-platform host acceptance and accessibility listening remain outstanding.
Question/elicitation form drafts and their request/schema binding are separate
unfinished work; this store never saves or replays approvals.
