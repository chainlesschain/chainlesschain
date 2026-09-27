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

This change covers the VS Code composer and normal input receipts. Question
form drafts, native question-review dialogs, JetBrains parity and current real
IDE host acceptance remain separate work in IDE-DRAFT. No approvals are saved
or replayed by this draft store. Empty windows without workspace storage keep
the existing in-memory behavior.
