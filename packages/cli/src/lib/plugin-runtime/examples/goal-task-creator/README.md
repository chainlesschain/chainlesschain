# Goal task creator (source-only)

This declaration-only plugin exports task-creation requests or submits pending
creation drafts through separately authorized native connections. It requires a matching source build of the CLI,
Session Core and desktop app. The compatibility floor in plugin.json does not
mean the published CLI 0.166.142 already contains this command.

From the repository root:

```powershell
cc plugin add packages/cli/src/lib/plugin-runtime/examples/goal-task-creator --scope project --json
cc plugin trust goal-task-creator --scope project
cc plugin consent goal-task-creator --scope project --grant --json
cc goal draft-create-request <goal-id> --connection "<summary-connection.json>" --plugin goal-task-creator --scope project --source "<current-native-creation-proposal-id>" --request-id "<stable-id>" --title "Delivery follow-up" --task-type analyze_data --description-file "<description.txt>" --out "<new-create-request.json>" --json
```

Use a separately authorized goal summary connection to read the exact goal
reference. Copy a current `task.create` risk proposal ID from the desktop;
description proposal IDs cannot substitute for creation sources. Supported task
types are `create_file`, `edit_file`, `query_info`, `analyze_data`, `export_file`
and `deploy_project`. The file is an untrusted request, with no native draft,
approval or task created by export. Existing output files are never overwritten.

In the desktop's external-request panel, choose this request with the native file
picker. Review the full description, task type and source before adopting it.
Adoption stores only this pending draft under a native importer identity;
the plugin name in the file is metadata, not proof of its origin. Task creation
still requires a fresh native preview and a second explicit native confirmation.
Creating the pending task does not execute it or prove the original risk resolved.

Keep the same exported file after an uncertain adoption; reopen its saved record
instead of exporting a new request identity. Revocation retains history and does
not re-enable the old file. Online v3 description connections, the old description
file schema and the combined assistant 0.2.0 do not gain creation permission.
Matching source IDE builds provide **Export task creation request…** with a native
type selector. There is no autonomous generation.

For online pending drafts, allow goal creation suggestions and run a fresh risk
check. Export a separate creation access file and select it from the desktop's
**另行授权在线创建任务待审连接** control. Inspect the native consent and save a
new private v6 connection:

```powershell
cc goal draft-create-access --plugin goal-task-creator --scope project --out "<new-creation-access.json>" --json
cc goal draft-create-sources <goal-id> --connection "<creation-v6.json>" --plugin goal-task-creator --scope project --json
cc goal draft-create-send <goal-id> --connection "<creation-v6.json>" --plugin goal-task-creator --scope project --source "<current-creation-source-id>" --request-id "<stable-id>" --title "Delivery follow-up" --task-type analyze_data --description-file "<description.txt>" --record "<new-submission.json>" --json
cc goal draft-create-receipt <goal-id> --connection "<creation-v6.json>" --plugin goal-task-creator --scope project --record "<submission.json>" --json
```

Only a pending draft is saved. Actual task creation requires desktop preview and
individual native confirmation. Preserve the same submission reference after
an unknown response; an existing reference only queries, even on `not-found`.
Task-type changes conflict with that request identity. Disconnect keeps drafts;
native grant revocation invalidates unconfirmed work and preserves completed
receipts. v3 description authority cannot substitute for v6 creation consent.
Both source IDEs expose **Export online creation access…**, **Submit pending
creation…** and **Look up creation receipt…** with native selectors. Creation
results require successful exit and independent schema/action validation. After
an interruption, use the same saved reference to query, without a new send.
File export remains available. This requires matching unpublished source builds.
