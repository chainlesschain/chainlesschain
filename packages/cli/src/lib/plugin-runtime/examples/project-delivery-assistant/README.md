# Project delivery assistant 0.2.0

This data-only scenario package combines evidence panels, bounded observations,
retained event replay and user-selected task-description drafts. It runs through
the existing CLI and both IDE plugin managers. Requires CLI 0.166.142, Session
Core 0.3.25 and a matching desktop build with the separately authorized goal
connections. Paired IDE releases are Open VSX 0.37.178 and JetBrains 0.4.195.
The version ranges in the manifest are compatibility floors; each operation
still needs its native source authorization.

The package contains no hooks, binaries, arbitrary code or autonomous scheduler.
It does not create tasks, choose a description for you, approve actions or mark a
goal complete. Task creation remains a future extension surface.

From the repository root, install at the scope you will use:

```powershell
cc plugin add packages/cli/src/lib/plugin-runtime/examples/project-delivery-assistant --scope project --json
cc plugin trust project-delivery-assistant --scope project
cc plugin consent project-delivery-assistant --scope project --grant --json
```

Consent covers the full declared capability set. Each command still needs its
own selected source and separate desktop authorization:

| Entry                                                               | Source and result                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal panels`                                                       | A separately authorized evidence connection; objective/status and historical risk/receipt summary. A summary-only connection cannot supply evidence fields. |
| `goal watch` with a connection                                      | A v4 event connection; risk-check and action-receipt observations for a bounded interval. Polling can miss intermediate changes.                            |
| `goal watch` without a connection                                   | A standalone CLI goal; status changes only. This does not subscribe to native project status.                                                               |
| `goal replay`                                                       | A v5 retained-history connection and explicit new/resume checkpoint; one page per invocation.                                                               |
| `goal draft-access`, `draft-sources`, `draft-send`, `draft-receipt` | A separate v3 pending-draft authorization bound to this plugin/version/declaration. The user selects a current native source and a UTF-8 description file.  |

In the desktop goal area, export the relevant connection with its separate native
confirmation. Connections are short-lived and tied to the active identity and
goal revision; keep their private files local. One connection does not grant the
other surfaces. For example:

```powershell
cc goal panels <goal-id> --connection "<evidence.json>" --plugin project-delivery-assistant --scope project --json
cc goal watch <goal-id> --connection "<events-v4.json>" --plugin project-delivery-assistant --scope project --duration 60 --json
cc goal replay <goal-id> --connection "<history-v5.json>" --checkpoint "<checkpoint.json>" --checkpoint-mode new --plugin project-delivery-assistant --scope project --json
# Subsequent explicit page: use the same checkpoint and --checkpoint-mode resume.
cc goal replay <goal-id> --connection "<history-v5.json>" --checkpoint "<checkpoint.json>" --checkpoint-mode resume --plugin project-delivery-assistant --scope project --json
```

Replay scans at most 20 retained events per page. Exit zero confirms checkpoint
commit; output alone does not. Keep the checkpoint after interruption because it
may already have advanced. Delivery can repeat event IDs. The newest 1000
instrumented events are retained; pre-instrumentation history is not backfilled.
Retention gaps and database regression are reported, without automatic reset.

For a pending description draft, export this plugin's access request first:

```powershell
cc goal draft-access --plugin project-delivery-assistant --scope project --out "<new-access.json>" --json
```

In the desktop, choose the separate online-draft authorization and select that
access file. In either IDE select **Send online draft…** / **Submit pending
draft…**, pick the v3 connection, a current native source, the proposed description
and a new submission-record file. Alternatively use the CLI:

```powershell
cc goal draft-sources <goal-id> --connection "<draft-v3.json>" --plugin project-delivery-assistant --scope project --json
cc goal draft-send <goal-id> --connection "<draft-v3.json>" --plugin project-delivery-assistant --scope project --source "<source-id>" --request-id "<stable-request-id>" --title "Delivery follow-up" --description-file "<description.txt>" --record "<new-submission.json>" --json
cc goal draft-receipt <goal-id> --connection "<draft-v3.json>" --plugin project-delivery-assistant --scope project --record "<submission.json>" --json
```

A saved draft is pending. Open it in the desktop, inspect the current native
preview, then confirm through the existing action flow. Read the real receipt
and run a fresh risk check to assess the outcome; a description edit does not
prove that a deadline or dependency risk was resolved. If submission is unknown,
keep its record and look up the receipt before deciding whether to send again.

In VS Code / JetBrains choose this installed plugin, then **CLI goal panels…**,
**Observe desktop events…**, **Recover retained history…** or the draft controls.
Recovery uses native connection and new/resume checkpoint dialogs; **Read next
page / check again** is explicit. No automatic observation, retry or business
action starts when the package is installed or reinstalled.

Disable or uninstall using the normal plugin controls. New operations are refused,
and active observers stop when they recheck admission. Native goals, actions,
receipts and saved checkpoints stay in their existing stores. Reinstalling keeps
the existing trust/consent policy, and requires a new explicit command or IDE
action to read again; it does not reconnect by itself. Version changes require
project trust again, capability expansion requires new consent, and a changed
declaration/goal binding requires a matching new desktop authorization and an
explicit new checkpoint when the old binding no longer matches.

Real IDE/Electron GUI journeys, automatic drafting, task-creation proposals,
independent business-effect evaluation and release gates remain pending.
