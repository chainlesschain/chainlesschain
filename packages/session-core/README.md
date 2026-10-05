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

```bash
npm test --workspace packages/session-core
```
