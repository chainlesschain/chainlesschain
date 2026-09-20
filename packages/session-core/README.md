# Session Core

Shared session lifecycle, trace, agent definition, memory, approval, sandbox,
evolution receipt, and recovery primitives used by ChainlessChain Desktop and
the CLI.

Current npm package: `@chainlesschain/session-core@0.3.13`. This release adds
the checked-in skill invocation receipt compatibility policy and keeps
unsupported receipt histories fail closed. The release workflow publishes the
child package before the CLI and compares the exact local tarball with the
public npm archive before CLI publication.

The package exports its public modules through `package.json`, including
`./runtime-claims`, `./evolvable-artifact`,
`./structured-evolution-memory`, and the session, approval, policy, and
recovery contracts used by the host products.

```bash
npm test --workspace packages/session-core
```
