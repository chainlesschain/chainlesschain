# Governed Skill marketplace CLI

The governed Skill commands coexist with the existing remote-service marketplace commands. They do not change service publishing, invocation recording, purchasing or billing.

## Availability and deployment

These commands require a deployment-owned `marketplaceHost`. Without it, they report `unavailable`; they do not create a local mock registry or use test signing keys.

The public CLI loads this dependency through the existing signed evolution deployment descriptor:

- `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR`: absolute descriptor path.
- `CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT`: absolute Ed25519 public-key path.
- The signed descriptor's command allowlist must include `marketplace`.
- The authenticated single-file deployment module exports `createChainlessChainCommandDependencies({ commandName, descriptor, factories })` and returns `{ marketplaceHost }` for this command.

The loader supplies `factories.createGovernedSkillMarketplaceLedgerAdapter` and `factories.createGovernedSkillMarketplaceCliHost`. The deployment constructs real ArtifactPorts/Ledger/witness storage and passes the resulting same-tenant adapter to the host, together with:

- A fixed `{ model, os, tool, runtime }` target.
- `catalog.resolve({ tenantId, skillName, version })`, returning the exact signed marketplace manifest (`version: null` selects the catalog's current version).
- `ports.verifySignature`, `ports.adapt`, `ports.verifyPilot`, `ports.verifyRevocation` and `ports.transition`, implementing the existing `GovernedSkillMarketplace` contracts.

The verification ports must resolve and independently authenticate receipt references. The CLI passes `--receipt` as `pilotReceipt` or `revocationReceipt`; a reference alone is not proof. The transition port must apply the exact request durably and support its deterministic request digest. Real PKI, catalog, package/SBOM generation, target adapter and Pilot authorities remain deployment responsibilities; this feature supplies no default production authority.

## Candidate workflow

First inspect a signed listing for the deployment's target:

```text
cc marketplace inspect safe-refactor --version 2.0.0
```

Use the returned manifest digest to pin the candidate:

```text
cc marketplace install safe-refactor --version 2.0.0 --manifest sha256:<digest>
cc marketplace state safe-refactor
```

`install` only persists a governed candidate state. Its response is `status: "candidate-staged"`, `activated: false`. It does **not** install runtime files or change the active release. Physical package materialization and Desktop marketplace integration are not supplied by this CLI host.

For an update, include `--expected-state sha256:<current-state-digest>`. Missing or stale baselines cannot overwrite existing state. Retrying the same candidate request recovers the durable state without another Ledger event. A manifest revoked anywhere in that Skill's recorded history cannot be staged again.

After the deployment has produced an independently verifiable receipt for the next stage:

```text
cc marketplace rollout safe-refactor --expected-state sha256:<current-state-digest> --receipt receipt:<pilot-reference>
```

Each call advances only one step: `candidate → shadow → canary → active`. Use the new state digest on the next call. There is no `--force`, client-selected target or direct stage jump. Actual release changes depend on the deployment's durable transition authority.

To revoke:

```text
cc marketplace revoke safe-refactor --expected-state sha256:<current-state-digest> --receipt receipt:<revocation-reference>
```

The authority must verify revocation for the same manifest and durably apply rollback before the governed state becomes `rolled-back`. If a transition command reports an error after an uncertain external acknowledgement, read `state` and reconcile with the deployment's transition authority; do not assume no effect occurred.

## Local verification

The marketplace ledger tests use real ArtifactStore/Ledger files and witness reopening, with test-only catalog signatures and target/Pilot/transition fixtures. They are not production deployment acceptance.

```text
cd packages/cli
vitest run __tests__/unit/governed-skill-marketplace-ledger-adapter.test.js __tests__/unit/governed-skill-marketplace.test.js __tests__/unit/evolution-deployment-loader.test.js __tests__/unit/lazy-dispatch.test.js
```
