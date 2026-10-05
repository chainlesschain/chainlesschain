# Session Core

Shared session lifecycle, trace, agent definition, memory, approval, sandbox,
evolution receipt, and recovery primitives used by ChainlessChain Desktop and
the CLI.

At candidate preparation, the latest npm package was
`@chainlesschain/session-core@0.3.13`. That release adds
the checked-in skill invocation receipt compatibility policy and keeps
unsupported receipt histories fail closed. The release workflow publishes the
child package before the CLI and compares the exact local tarball with the
public npm archive before CLI publication.

The `0.3.14` source is a release candidate. Its ApprovalGate records a
monotonic policy revision per session and sends synchronous revision events to
subscribers. CLI `0.166.81` depends on this exact child version; neither
candidate is ready to publish without the required exact-commit CI and public
registry readback sequence.

The package exports its public modules through `package.json`, including
`./runtime-claims`, `./evolvable-artifact`,
`./structured-evolution-memory`, and the session, approval, policy, and
recovery contracts used by the host products.

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

```bash
npm test --workspace packages/session-core
```
