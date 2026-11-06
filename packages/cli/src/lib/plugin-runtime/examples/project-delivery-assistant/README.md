# Project delivery assistant 0.3.0 (source-only)

This data-only scenario package combines evidence panels, bounded observations,
retained event replay, user-selected task-description drafts and separately
adopted task-creation request files, with separate CLI online creation drafts. It runs through
the existing CLI and both IDE plugin managers. Requires CLI 0.166.143, Session
Core 0.3.25 and a matching desktop build with the separately authorized goal
connections. Paired IDE releases are Open VSX 0.37.179 and JetBrains 0.4.196.
The version ranges in the manifest are compatibility floors; each operation
still needs its native source authorization.

This 0.3.0 source package requires matching local CLI and IDE builds. Its host
version floors do not add creation controls to the already published products.
The package contains no hooks, binaries, arbitrary code or autonomous scheduler.
It exports creation requests or saves pending creation drafts; the desktop
requires a current preview and individual native confirmation before creating a
pending task. It does not execute that task or mark a goal complete.

From the repository root, install at the scope you will use:

```powershell
cc plugin add packages/cli/src/lib/plugin-runtime/examples/project-delivery-assistant --scope project --json
cc plugin trust project-delivery-assistant --scope project
cc plugin consent project-delivery-assistant --scope project --grant --json
```

Consent covers the full declared capability set. Each command still needs its
own selected source and separate desktop authorization:

| Entry                                                                                           | Source and result                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal panels`                                                                                   | A separately authorized evidence connection; objective/status and historical risk/receipt summary. A summary-only connection cannot supply evidence fields. |
| `goal watch` with a connection                                                                  | A v4 event connection; risk-check and action-receipt observations for a bounded interval. Polling can miss intermediate changes.                            |
| `goal watch` without a connection                                                               | A standalone CLI goal; status changes only. This does not subscribe to native project status.                                                               |
| `goal replay`                                                                                   | A v5 retained-history connection and explicit new/resume checkpoint; one page per invocation.                                                               |
| `goal draft-create-request`                                                                     | A selected goal connection, current native creation proposal ID, explicit task type and body; exports a file for separate per-file desktop adoption.        |
| `goal draft-access`, `draft-sources`, `draft-send`, `draft-receipt`                             | A separate v3 pending-draft authorization bound to this plugin/version/declaration. The user selects a current native source and a UTF-8 description file.  |
| `goal draft-create-access`, `draft-create-sources`, `draft-create-send`, `draft-create-receipt` | Separate native v6 creation consent, current creation source, explicit task type and durable reference; saves pending only.                                 |

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

For creation, enable the goal's creation suggestion scope and run a fresh risk
check. Copy a current creation proposal ID from the desktop, then export:

```powershell
cc goal draft-create-request <goal-id> --connection "<summary-connection.json>" --plugin project-delivery-assistant --scope project --source "<current-native-creation-proposal-id>" --request-id "<stable-request-id>" --title "Delivery follow-up" --task-type analyze_data --description-file "<description.txt>" --out "<new-creation-request.json>" --json
```

In either IDE use **Export task creation request…** and select the task type,
connection, source ID, description and new output file through native controls.
The IDE checks a separate creation export result and only reports success after
the CLI exits successfully. Import the same request in the desktop, inspect its
full body and task type, adopt it, then build and confirm the native preview.
An interrupted or failed export may have created the output file; inspect and
reuse it explicitly. Do not replace its request identity to recover an unknown
adoption outcome. Online v3 description grants never authorize creation.

For online creation, use the same commands from the
[creation example](../goal-task-creator/README.md) with
`--plugin project-delivery-assistant`. Export a creation access file and obtain
independent native v6 consent; the v3 description connection cannot substitute.
Keep the submission reference to query unknown outcomes without resending.
Both source IDEs expose dedicated online creation access/send/receipt controls
with native connection, source, task type and reference selections. File export
remains available; source builds require matching local CLI/Core/desktop code.

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

Upgrading from 0.2.0 requires trust for 0.3.0 and additional consent for
`proposal:task.create`. Previous consents cannot silently grant that capability.
Real IDE/Electron GUI journeys, automatic drafting,
independent business-effect evaluation and release gates remain pending.
