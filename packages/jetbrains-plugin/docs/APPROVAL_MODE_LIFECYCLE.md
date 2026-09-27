# Approval mode confirmation and agent replacement

The chat panel and status bar distinguish the requested approval mode from the
mode confirmed by the CLI. Selecting `/normal`, `/auto`, or `/bypass` invalidates
the previous request immediately. A pending or failed change retains the **last
confirmed** mode until the previous agent has been stopped. The IDE never derives
permission authority from the displayed mode.

## Confirmation

Each child receives a unique `CC_IDE_MODE_REQUEST_ID` and the requested mode in
`CC_IDE_REQUESTED_MODE`. A supporting CLI returns `permission_mode_state` in its
`system/init` event. `PermissionModeState` checks the child generation, session ID,
request ID, requested mode, effective mode, and policy digest before accepting it.
An organization policy may cause the effective mode to differ from the request.

Missing or invalid acknowledgement is shown as `unconfirmed`. An acknowledgement
that does not belong to the request is ignored. After 15 seconds without a valid
acknowledgement, a pending request becomes `unconfirmed`; old CLI versions do not
silently appear to have applied the requested mode. This is display evidence, not
an authorization to bypass CLI permission checks.

## Replacement ordering

`AgentChatSession.stopAndWait()` starts an independent termination worker. It
does not take the stdin writer monitor, so a blocked send cannot prevent process
termination. Concurrent stop callers share the same completion future. The
worker observes the root and descendants, sends termination requests, escalates
after 350 ms, and waits up to 5 seconds. Failed attempts retain observed handles
for retry. Inspection failures or the 1,024-handle limit prevent confirmation.

The conversation waits off the EDT before clearing the old session or launching
its replacement. Failure retains the handle and shows `failed`. Mode changes,
configuration reloads, forced stop, timeline restore, and conversation handoff use
this ordering. Queued inputs carry their mode revision; question and approval
responses carry the owning session and generation. Launch checks cancellation
again after binary resolution and environment preparation. A stopped or exited
session instance cannot be restarted.

If the mode changes while an input is being written, its text is retained in the
composer or Saved inputs with an unknown-delivery notice. Recovery and receipt reconciliation are
documented in [Chat draft recovery](CHAT_DRAFT_RECOVERY.md).

## Evidence and limits

JUnit exercises correlated acknowledgements, organization-policy overrides,
missing acknowledgements, rapid changes, delayed launch cancellation, forced
termination, retained descendant handles, and inspection failures. A real Java
root and child process verify that an 8 MiB blocked stdin write cannot prevent
their termination on the tested Windows host.

The barrier covers **observed process handles**. It is not an OS containment
boundary: detached or reparented descendants that escape before observation may
be missed, particularly if the wrapper has already exited. There is no Windows
Job Object or Linux cgroup ownership in this implementation. Real IDE interaction,
actual organization-policy configuration, Linux/macOS process probes, and full
cross-platform containment remain unverified. Root exit alone is not reported as
proof of full process-tree containment.

Run local checks with JDK 21 from `packages/jetbrains-plugin`:

```powershell
.\gradlew.bat test smokeTest
```

Current validation and outstanding acceptance conditions are recorded in the
[implementation ledger](../../../docs/research/cli-ide-gap-implementation-2026-09-27.md).
