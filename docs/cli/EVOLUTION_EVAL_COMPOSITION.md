# Production Eval construction contract

`releaseTrain.domain.eval` requires exactly `descriptor`, `createComposition`,
`planRef`, `expectedReceipt`, and `usage`. The Agent runtime constructs the child
evidence store on its own ArtifactStore, signed EvolutionLedger and witness.
`createComposition` is synchronous and receives `{ descriptor, childReceiptStore }`.
It must return an object created by `createEvolutionEvalRuntimeComposition` using
that exact store. Missing authorities, copied objects, prototype impersonation,
cross-tenant/run bindings and replacement stores fail with
`CC_EVOLUTION_EVAL_COMPOSITION_UNAVAILABLE` before the train is admitted.

The deployment's `descriptor` contains `authorityId`, positive `revision`, and
`handlerArtifactDigest`. The runtime adds `tenantId` and `runId`. The child store
descriptor uses `streamId: runId`; its other identity fields match the composition
descriptor. These exact fields participate in the matrix authority root and must
be included when the host prepares its authenticated matrix plan.

An authenticated single-file deployment receives these built-in factories:

- `createEvolutionEvalGate(options)`
- `createEvolutionEvalReceiptVerifier(options)`
- `createEvolutionEvalProcessSupervisor(options)`
- `createEvolutionEvalRuntimeComposition(options)`

The last factory checks `descriptor.handlerArtifactDigest` against the module
bytes verified by the deployment loader. The process supervisor factory retains
its existing module digest binding. Gate and verifier options must supply the
actual authority descriptors, policies and callable ports required by those
constructors; the factories provide no keys, permissive verifiers, corpus,
graders, replay reservations or isolation fallback.

```js
eval: {
  descriptor: {
    authorityId: deploymentEvalAuthorityId,
    revision: deploymentEvalRevision,
    handlerArtifactDigest: deploymentDescriptor.moduleDigest,
  },
  createComposition: ({ descriptor, childReceiptStore }) =>
    factories.createEvolutionEvalRuntimeComposition({
      descriptor,
      aggregatorOptions: {
        ...hostMatrixOptions,
        tenantId: descriptor.tenantId,
        childReceiptStore,
      },
      verificationLimits: {
        maximumReceiptTtlMs: approvedReceiptTtlMs,
        maximumVerificationMs: approvedVerificationDeadlineMs,
      },
      durabilityOptions: hostAuthenticatedDurabilityOptions,
    }),
  planRef: authenticatedMatrixPlanRef,
  expectedReceipt: expectedMatrixReceiptBindings,
  usage: approvedStageUsage,
}
```

`hostMatrixOptions` has the existing `SkillTargetMatrixEvalAggregator` contract:
dependency lock, runtime manifest, target matrix and expected environment
bindings; every cell's branded Gate and receipt verifier; authenticated plan
resolver and trust; evidence verifier; reservation/finalization authority;
matrix supervisor; matrix signer/verifier and trust; trusted clock; all associated
policies; maximum matrix wall time. The runtime child store must also be supplied
to the host's process supervisor when constructing its invocation/revocation
evidence ports. The matrix's cell Gates and receipt verifiers must be genuine
constructed instances, not objects inheriting their prototypes.

The composition constructs its matrix receipt verifier from the aggregator's
exact signer descriptor, verifier, receipt trust, supervisor and clock. Only
verification time/TTL limits are separately configurable. Its public
`receiptVerifier` and `receiptResolver` can be supplied to the evaluated-promotion
provider so downstream reads reuse the same authorities. `durabilityOptions`
uses the existing `createSkillEvaluatedPromotionDurabilityAdapter` contract:
`authority`, `maximumEvidenceAgeMs`, `maximumGracePeriodMs`, `maximumOperationMs`,
and trusted `now`. Its authority must include signed retain/resolve operations,
attestation verification, active/grace trust and revocation state. The host is
responsible for providing its deployed authority and trusted time source.
The stage verifies an accepted matrix receipt, authenticates the durability
receipt, and only then commits the stage output. Recovery repeats verification
and durable retention before returning success.

Tests exercise two real Gate cells, matrix aggregation/verification, authenticated
durability with test-only keys, actual signed artifact/ledger/witness storage,
and exact child/matrix/stage-output recovery in another Node process. Corrupted
persisted evidence and invalid durability signatures are rejected. The Windows
test filesystem adapter does not prove physical power-loss durability. External
grader/corpus acceptance, all three platform isolation deployments, live PKI
rotation/revocation exercises and production deployment acceptance remain host
responsibilities; these repository tests do not claim those outcomes.
