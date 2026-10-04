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

Limits: 100,000 characters per text; four images, 20 MiB total, 40MP per image
and 40 million compositing canvas pixels across all frames and attachments;
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
using the same serial workspace store. Supported MCP schemas now use a native
field review with individual InputBox/QuickPick editors, Back navigation and an
explicit Submit action. The shared schema core validates and coerces text,
number/integer, boolean, single-select and multi-select values. Partial edits save
after 250 ms; final submission waits for storage. Interrupted requests recover
fields only after an exactly matching complete binding and schema reissue.
Canceling or submitting archives the fields, so later dialogs do not automatically
preselect those answers. Password/write-only values are excluded from both disk
and review previews. Unsupported schemas use an explicit, non-persistent JSON
object fallback. The CLI App Server preserves MCP form/URL metadata for this path.

Each native review belongs to an App Server connection generation. Expiry,
interrupt, process exit/replacement and completion of a blocking turn revoke its
UI immediately; deferred requests can remain live after their original turn.
Unfinished archival joins an in-flight final save rather than duplicating it.
Empty windows retain the same cancellation behavior without disk storage.
Native reviews share one display queue, with at most 128 waiting requests. A
whole form owns the QuickInput surface until it finishes; another question
cannot hide its current field. Waiting requests can expire or be canceled
without ever creating a control.
URL requests require explicit HTTPS confirmation and check ownership again before
and after opening the captured URL.

Returning an answer leaves the native request **awaiting** server confirmation.
Only a matching `question/resolved` notification changes it to **resolved**;
the status bar reports the transition, and the existing App Server status command
shows counts of reviews, pending confirmations and unconfirmed outcomes. Reused
IDs with different content cannot establish unambiguous resolution. Expiry or
connection failure stays **unknown**, and does not retry the answer. These are
in-memory lifecycle observations, not durable acceptance receipts or proof of
external effects occurring exactly once. Restart recovery preserves editable
fields, not a previous response authority.

The identity now distinguishes MCP form/URL mode independently of blocking/deferred
mode, and distinguishes password prompts. Older MCP field records without that
distinction remain available as editable text recovery; they are not automatically
restored into a differently identified live review.

Question limits: 16 records per draft, 128 fields, 32K characters per field,
64 KiB normalized field payload and 128 KiB per record. Host request tracking is
bounded to 256 instances. Webview backup holds at most 16 edited forms and 64K
JSON characters, and protects newer local edits from delayed recovery. Wait for
storage before closing the host; this does not promise zero loss on forced exit.

JetBrains and VS Code question draft implementations have local tests. Current
real IDE host lifecycle acceptance, accessibility listening and cross-platform
validation remain outstanding in IDE-DRAFT. No approvals are saved or replayed
by this draft store. The App Server remains an opt-in pilot.

## Bounded image previews

Host validation admits complete PNG/JPEG/GIF/WebP containers before acknowledging
the current page's attachment revision. Animations allow at most 200 frames per
image, with each frame charged for its full compositing canvas, including APNG's
separate still fallback. PNG also limits container fragmentation to 16,384 chunks.
WebP inner coded dimensions must match their outer frame. These are admission
checks, not a substitute for decoding.

After that ACK, a dedicated browser Worker uses `ImageDecoder` to decode every
frame and verify the actual frame count and dimensions. The worker closes each
decoded frame, producing a 40×40 `ImageBitmap` for the preview. The page draws
these bitmaps on an accessible canvas; it never passes the original compressed
bytes to a second DOM image decoder. Animation durations and repeat counts are
preserved, with a 20 ms minimum delay. A missing codec/API, malformed image or
decode timeout remains visible and blocks attachment sending.

Only the visible composer's bitmap cache is retained. Four images with 200
frames each give an upper bound of 1.28 million thumbnail pixels (5.12 MB of
RGBA payload, excluding browser/driver overhead). Switching tabs, hiding or
closing the page, removing images and late worker results release the bitmaps.
Worker operations have a five-second deadline; cancellation terminates the
worker and rejects its result. These are input, pixel, frame, thumbnail-cache
and operation-time bounds, not a hard browser decoder RSS or OS CPU quota.

For PNG preview decoding, non-raster ancillary metadata is removed, including
compressed ICC/text streams. IHDR, PLTE, tRNS, animation control/data and fixed-size
gAMA/cHRM/sRGB chunks remain. **Thumbnail previews do not guarantee custom ICC
color fidelity.** Saved and sent attachment bytes remain unchanged.

Node preparation uses an owned staging directory, exclusive promotion and
cleanup after timeout/cancellation. Saved attachments are read through one
descriptor, with an original-size-plus-one allocation and 64 KiB chunks. File
growth, truncation, replacement and observed modification reject the snapshot.
Java uses the same bounded-snapshot approach for draft storage and dropped-file
copies. File-read deadlines/cancellation are checked between I/O operations;
they do not interrupt a filesystem syscall stalled in the OS. JetBrains still
uses header admission and has no animated thumbnail codec path; this change
does not claim complete JetBrains codec acceptance.

The `image-decode-budget-browser.cjs` regression exercises real Chromium codecs,
including PNG/JPEG, GIF/APNG/WebP animation, separate APNG fallback, compressed
metadata with palette transparency, damaged IDAT, contradictory WebP dimensions
and worker timeout/cancellation. IDE Extensions runs it on Linux, Windows and
macOS using its existing Playwright installation and uploads raw JSON. Its
localhost browser result does not replace the packaged VS Code host journey,
which must verify secure-context APIs and worker CSP in the actual Webview.
