# Chat draft recovery (unreleased, 2026-09-27)

Workspace chat saves composer text and validated attachment snapshots in the
extension's workspace storage. Tabs retain a stable draft identity across
Webview and Extension Host reloads. The composer shows saving or storage errors;
an error does not authorize sending or silently remove attachments. A small,
text-only Webview backup covers keystrokes waiting for host acknowledgement.
Images are kept in bounded files, not VS Code Memento values. Wait for image
loading/saving to finish before closing the editor.

Sending first saves a separate submission record. The composer clears only after
that record is saved. With a CLI advertising `input_receipts.version=1`, the
extension sends a stable client message ID and marks acceptance only after a
matching receipt. The record is set to unknown **before** writing stdin, covering
EPIPE and process loss. Acceptance proves input storage, not task completion.
An older CLI can still receive input, but the saved record remains unconfirmed.

“Check acceptance” and reload perform only `session show --input-receipt` reads.
They never start an agent or retry a submission. “Copy to composer” creates an
editable copy; users must check the conversation before intentionally sending
an input whose outcome is unknown. Accepted inputs cannot be copied via this
action. Missing or changed image files block sending until the attachments are
replaced or explicitly discarded.

“Recover saved drafts” opens the existing chat with saved local input without
starting its CLI process. This also finds drafts from closed or reset tabs.
The reopen-closed shortcut preserves the same draft identity. Discarding saved
input releases its unreferenced images; clearing an empty record releases its
storage directory.

Limits: 100,000 characters per text; four images, 20 MiB total, 40MP per image;
eight unresolved submissions per draft; 128 stored drafts and a 100 MiB storage
budget. Serial storage work is bounded to 64 operations and 40 MiB of queued
image payloads. Metadata uses a flushed temporary file followed by rename.
This does not claim filesystem power-loss durability or coordination between
multiple concurrent Extension Hosts writing the same workspace storage.

Question cards also save partially entered text, checkboxes and supported MCP
form controls. Recovery matches the session, request, complete interaction
binding and question/schema digest. A live request has a separate host-owned
instance identity; reusing a request ID cannot revive an old card. A recreated
Webview can recover the same live instance. After a host restart, automatic field
restoration requires an authoritative reissued request with the same binding
and digest. Bindingless legacy questions recover only inside the original host
instance. Recovery never submits an answer or an approval.

Canceled, replaced, stopped and completed blocking questions retain editable
answer text under “Recover saved drafts.” Deferred questions remain live across
turn results. “Copy answer text to composer” copies text for editing and requires
an empty composer; it does not answer the old question. Delayed edits cannot
reactivate an archived question. Password/write-only fields and unsupported JSON
schema fallback values are excluded from disk and Webview backup. Ordinary free
text is saved locally; these records are not a credential vault.

An answer is reserved once and saved before delivery. Cards show “waiting for
agent confirmation” until the CLI resolves the question. Pipe errors or rejected
responses remain unresolved and are never retried automatically. URL elicitation
uses the host-owned reviewed URL and original session, rechecking ownership
after opening the browser. Switching tabs cannot redirect its response.

The App Server native text and choice dialogs save input/filter/selection changes
using the same serial workspace store. Interrupted requests can recover their
fields after an exactly matching reissue. Canceling or accepting archives the
text; a later dialog does not preselect archived answers. Native schema responses
and password inputs are not persisted. The native dialog returning a value is
not a claim that the server accepted it; that surface has no acceptance receipt UI.

Question limits: 16 records per draft, 128 fields, 32K characters per field,
64 KiB normalized field payload and 128 KiB per record. Host request tracking is
bounded to 256 instances. Webview backup holds at most 16 edited forms and 64K
JSON characters, and protects newer local edits from delayed recovery. Wait for
storage before closing the host; this does not promise zero loss on forced exit.

JetBrains question-draft parity, native structured-schema review and current real IDE host
acceptance remain separate work in IDE-DRAFT. No approvals are saved or replayed
by this draft store. Empty windows without workspace storage keep in-memory
question state and explicit response routing, without disk draft recovery.
