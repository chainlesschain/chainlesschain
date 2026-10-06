# Session Core

Shared session lifecycle, trace, agent definition, memory, approval, sandbox,
evolution receipt, and recovery primitives used by ChainlessChain Desktop and
the CLI.

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
