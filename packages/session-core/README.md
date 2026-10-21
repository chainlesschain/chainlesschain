# Session Core

Shared session lifecycle, trace, agent definition, memory, approval, sandbox,
evolution receipt, and recovery primitives used by ChainlessChain Desktop and
the CLI.

## Release 0.3.21

Fixes Windows PowerShell ACL operations for long local paths by using extended
Windows paths internally while preserving the caller-facing paths. CLI
0.166.111 pins this release for signed local Quick Ask evidence storage.

## Release 0.3.20

Publishes the governed goal drafting, evidence, extension proposal, and draft
import APIs as public package entry points. These exports keep host-owned
authorization and completion checks in the calling application.

The `0.3.15` release candidate adds business-object contracts, controlled task
description actions and readers, offline risk rules and saved project risk
reviews. CLI `0.166.90` pins this exact version. At candidate preparation, npm
latest is `0.3.14`, which supplies monotonic ApprovalGate policy revisions and
synchronous revision events. The release workflow requires exact-commit CI,
publishes the child before the CLI and verifies the public archive byte-for-byte.

The package exports its public modules through `package.json`, including
`./runtime-claims`, `./evolvable-artifact`,
`./structured-evolution-memory`, and the session, approval, policy, and
recovery contracts used by the host products.

The unreleased DMM foundation adds public `./scheduler-contract`,
`./scheduler-service`, `./scheduler-runtime`, `./scheduler-store`,
`./scheduler-source-path`, `./private-storage` and `./host-storage-environment`
entry points for CommonJS hosts and ESM consumers. CLI compatibility entries
retain their original Graph, configuration, home and native driver assembly.
The shared runtime requires live authorization and an injected Graph Authority
or explicitly selected legacy Graph mode. The shared store requires a host
driver, a separate database file and synchronous storage protection before and
after opening. `./scheduler-authority-resolver` supplies the shared policy
binding, non-mutating availability checks and durable reservations. These
entries do not load the CLI Graph or configuration stack.

`./goal-contract` and `./goal-repository` define bounded, versioned goal records
and storage adapters with compare-and-swap updates. `./project-goal-service`
stores personal project goals in the host's existing native SQLite database,
rechecking current host identity and project ownership within immediate
transactions. Metadata IPC cannot launch work or claim verified completion.
Budgets and authorization references describe intent; execution must still use
the host's current authorization and usage ledger. Completion verification is
disabled unless the host supplies an independent trusted checker. See the
[implementation progress](../../docs/research/agents/dots-muse-mods-implementation-progress-2026-10-07.md)
for the current boundary, legacy compatibility and test evidence.

`./project-goal-monitoring` provides explicitly enabled personal-project risk
checks through the shared scheduler. Native project transactions commit each
review, occurrence-bound check evidence and goal usage together. A separate
scheduler ledger can recover a committed check without another review or debit.
Per-goal run/time limits, current principal policy and current project ownership
are rechecked before work and before domain commit. Manual request IDs bind
durably to a goal/control/policy version; fresh intents can bind a new policy
without changing prior replay identities. Timer periods coalesce after downtime.
Historical and terminal results revalidate the saved authorized risk evidence.

The desktop host protects its separate scheduler database, drains work on exit,
and derives monitoring identity from successful main-process password/UKey login
handlers. Locking or removing a UKey and logging out revoke the relevant session.
Loading a default DID does not authenticate a session. The project risk panel
exposes explicit start/stop/check/status controls and saved evidence. This first
adapter runs deterministic rules with zero model usage; business writes,
notifications and independent goal completion remain separate work.

The source also exports `./business-object-contract`: immutable references for
Project, Task, Document, Person, Decision and ActionRun; version-bound action
requests; and action run records containing evidence references. Content versions
use SHA-256 over bounded JSON with sorted object keys. Action identity binds the
source, scope, target revision and input digest; reuse of an idempotency key with
different action content is rejected by `assertBusinessActionReplay`.

These contracts do not execute actions or grant permissions. Hosts still need
authoritative identity, current permission and approval checks, an atomic version
comparison, durable idempotency and authorized evidence readers. Matching request
digests do not permit replay when the previous outcome is unknown. A structurally
valid run record does not authenticate its evidence or prove business success.

`./task-description-action-service` adds the first concrete business action:
`TaskDescriptionActionService` updates `project_tasks.description` for pending
tasks in personal draft/active projects. The native SQLite host supplies its
current DID and a private strict/high ApprovalGate with native user confirmation.
The service checks ownership and the complete row version again after approval,
then commits the edit and ActionRun evidence atomically. Organization/workspace
tasks and non-native database fallbacks are unsupported. Repeated invocations
return durable receipts; interrupted running receipts remain unresolved and are
never automatically replayed. Receipt reads recheck current ownership.

The service also supplies bounded `listTasks`, `readTask`, and `listRuns`
readers for the live project task panel. Metadata and receipt reads do not load
large task result payloads. An unresolved run blocks a new action for the same
task, even with a new idempotency key; replaying the original request only reads
its durable receipt. Workspace resource associations are refused by this
personal-only adapter alongside organization fields.

The same module's `createTaskDescriptionPreview` prepares a request from an
offline snapshot and explicitly labels its authority `unverified-snapshot`.
The CLI exposes this preparation path, while the desktop host exposes the live
action through separate IPC/preload methods. Existing task editors and legacy
CRUD paths are not all converted. See the
[controlled action guide](../../docs/research/palantir/controlled-task-description-action.md)
for the boundary, invocation examples, receipt semantics, and focused host tests.

`./project-risk-evaluation` exports `evaluateProjectRiskSnapshot`, a deterministic
offline evaluation of complete, bounded project/task snapshots. Its rule version,
input digest and content-versioned references support reproducible comparisons.
Its risk-specific references are selected-field projections, not the complete
database-row versions required by controlled actions. Evaluation neither
authenticates the snapshot nor approves an action or predicts project delivery.

`./project-risk-review-service` adds an authorized desktop reader and durable
rule review. `ProjectRiskReviewService({ db, getActor })` reads the current
owner's personal project in one native SQLite transaction, evaluates selected
task fields, and stores the source snapshot and result. `evaluate({ projectId })`
and `getReview({ reviewId })` return `{ review, sourceSnapshot, evaluation }`.
Historical reads recheck current ownership and verify stored content against
the deterministic evaluator. Missing columns or excessive task counts remain
explicitly incomplete; a failed SQL read never becomes an empty successful
evaluation. Reviews are not approvals and are not yet bound to action receipts.
See the [project task workbench guide](../../docs/research/palantir/project-task-review-workbench.md).

```bash
npm test --workspace packages/session-core
```

The working tree also exports `./goal-extension-proposal-contract` and
`./project-goal-extension-queue`. The shared proposal contract maps SDK
`task.description.update` to native `task.update-description` explicitly.
`ProjectGoalExtensionQueue` requires a trusted native `ProjectGoalWorkflow` and a
synchronous live admission callback. It stores pending suggestions, binding the
current actor, goal revision/control generation, native risk proposal and exact
review digest. Repeated request IDs replay the same draft; changed input conflicts.
Reads recheck source and admission, including after disable/re-enable.

Trusted hosts can call `prepareDraft({ id })` to bind a persisted draft to one
immutable conversion, native request and intent ID. Reopening after a crash or
retrying a lost response resumes those IDs. Native preview, explicit approval
and action evidence retain the exact draft/conversion digests in `extensionRef`.
Install a synchronous `verifyExtensionIntent` callback on `ProjectGoalWorkflow`
and delegate it to `queue.verifyIntentInTransaction(context)` before use; missing
or asynchronous verifiers cannot admit converted work. Ordinary intent APIs also
recheck current grants and source for pending work. Existing running/terminal
receipts remain readable after revocation without executing again.

The adapter currently accepts description suggestions only: `task.create` still
needs a task-type contract. Plugins receive only the pending enqueue port; the
queue has no execution port. Native descriptions are limited to 8192 UTF-8 bytes
before conversion; conversion records are limited to 8 KiB.
Storage is bounded to 100 drafts per actor/goal/plugin, 48 KiB per record and 20
candidates per page. The desktop's fixed built-in rule uses a separate native
consent namespace; it does not establish CLI plugin trust or a live CLI project
connection. These exports require a corresponding Session Core child release
before downstream CLI or desktop distribution.

The working tree also exports `./project-goal-evidence-reader` and
`./goal-evidence-contract`. `ProjectGoalEvidenceReader({ db, getActor, clock })`
offers `readSummary(goalRef)` and `read(goalRef)` for an exact active personal
project goal. It reuses native goal, risk-check and action-receipt integrity
validators through an internal read-only SQLite facade. Native statement
`readonly`/`reader` flags are required; only deferred read transactions run.
Construction and reads never initialize schemas, recover actions or settle usage.

Evidence contains the newest persisted check (including incomplete results) and
the last 20 real action receipts ordered by native run insertion, with `hasMore`.
Recent drafts cannot hide receipts. Missing stores remain unavailable, unknown
risk remains null, and running actions remain unresolved. Projections contain
bounded metadata only, explicitly historical, with no task bodies or approvals.
The shared contract strictly validates fields and formats bounded plaintext.
Hosts must still provide current authenticated identity and explicit evidence
consent; the desktop uses a distinct capability-bound connection rather than
expanding an existing summary lease. These exports are not yet published.

`./goal-draft-request-contract` and `./project-goal-draft-imports` add explicit
offline request handoff. The strict envelope contains a declared plugin label,
declaration digest and exact versioned description proposal, with a 16 KiB total
and 8192 UTF-8 byte description limit. Neither digest authenticates plugin code.
`ProjectGoalDraftImports` requires a trusted native workflow and confirmation
callback. It binds each adoption to the current native actor, source and exact
payload; the queue uses a fixed native importer identity with `user-edited`
origin. Metadata cannot select a privileged plugin or grant.

Adoption and pending draft insertion share one native immediate transaction via
the queue's trusted `enqueueInTransaction` composition entry. Reimport is
idempotent, conflicting payloads are rejected, and lost responses/restarts reuse
the same persisted identity. Revocation advances the per-record epoch and cannot
be undone by importing again. Pending conversion/execution verifies the exact
adoption payload and epoch; completed history stays available. Native hosts must
route verified imported drafts to this verifier and preserve the ordinary native
preview/approval flow. The desktop provides explicit import/list/read/prepare/
revoke endpoints; no online write authority is added to existing read leases.

`./goal-draft-connection-contract` and `./project-goal-external-drafts` add the
independent v3 online pending-draft capability. `ProjectGoalExternalDrafts`
requires a native `ProjectGoalWorkflow`; only the trusted host may call
`grant({ goalRef, access, expectedEpoch })` after native consent. Grants persist
across disconnect/restart and bind actor/store/project/goal/full plugin identity,
declaration digest and epoch. CAS prevents delayed consent from undoing revoke.
Revocation invalidates old pending drafts and converted intents, while completed
action history remains readable under existing business permissions.

`sourcePage` scans at most 20 native proposal IDs with unavailable counts.
`enqueue` inserts pending drafts only, atomically and idempotently; current native
source and authorization checks still apply. `submissionReceipt` validates exact
request/digest and current grant epoch without requiring the source to remain
fresh. These read operations use deferred transactions and support SQLite
`query_only`; writes use immediate transactions. Unknown/corrupt evidence fails.
Native list/read/prepare methods continue the existing conversion and action
workflow; no HTTP caller receives prepare, approval or execute authority.

The contract also validates body-free, credential-free submission references.
Clients must persist the exact request identity before dispatch and reconcile
unknown outcomes without automatic resend. Metadata hashes ensure consistency,
not plugin code authentication. These exports remain unpublished; downstream
distribution requires a corresponding child-package release first.
