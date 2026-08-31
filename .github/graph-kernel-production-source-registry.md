# Graph production source enrollment

The checked-in registry is intentionally empty, so the production producer fails closed. No physical Graph production runner, signing key, or authenticated production observer is enrolled. Test fixture keys are ephemeral and must never be copied here. P1-3/P1-12 therefore remain **yellow / externally blocked**, not closed.

## Required enrollment

A separately reviewed enrollment PR must add exactly one independent source for Linux, Windows, and macOS. Each source must contain:

- `enabled`, `validFrom`, and `validUntil`. A disabled key fails all verification. The validity window is checked against the signed collector window and the exact Actions job, not against the later close time, so retained evidence remains verifiable after key expiry.
- A distinct Ed25519 `keyId` and `publicKeySpki`. The private key must be non-exportable and held only by the independently operated collector/attester, never by the runner checkout or a GitHub Actions secret.
- A distinct registered physical runner ID, name, and complete canonical lower-case label set, including `self-hosted`, its platform, `physical`, and `graph-kernel-production`. The current-attempt Jobs API must independently show the same runner ID/name and all routing labels for the successful source job.
- Distinct `hardwareIdentityDigest` and `operatorIdentityDigest` values established during reviewed enrollment.
- Distinct attester `identityDigest` and append-only production `logAuthorityDigest`, plus a reviewed `measurementDigest`. These bind the independently operated observer implementation and its production ledger authority.
- A distinct credential-free HTTPS collector endpoint with no query string and a distinct protected credential digest. Linux, Windows, and macOS credentials must have independent custody.

The observer must derive signed raw-event receipts from real production data-plane logs and an append-only ledger. It must not sign job-supplied success metrics or timestamps. Its receipt key binds the exact repository/ref/commit, producer workflow/run/attempt/job, runner registration, hosted challenge, registry and manifest digests, hardware/operator/attester identities, collector wall/monotonic interval, raw hash chain, and Merkle root. The same physical boot identity must remain constant across all 23 receipts from one source, and the three sources must have distinct boot identities.

An Ed25519 signature and Merkle root prevent undetected transport or post-signing modification; they do **not** prove that a trusted key holder observed reality. The independent collector, its non-exportable key, attester measurement, and append-only production ledger are external trust roots. Their custody, retention, monitoring, and audit evidence must be reviewed outside this repository before enrollment.

## Protected configuration and lifecycle

After the enrollment PR merges, an environment administrator must:

1. Recompute the canonical registry digest and set `GRAPH_KERNEL_PRODUCTION_SOURCE_REGISTRY_DIGEST` independently on both `graph-kernel-production` and `graph-kernel-production-close`.
2. Provision only `GRAPH_KERNEL_PRODUCTION_COLLECTOR_TOKEN_LINUX`, `_WINDOWS`, and `_MACOS` on the producer environment. Each matrix job receives exactly one explicitly named platform secret, only in its collector fetch step.
3. Require protected-main review and no-administrator-bypass reviewers on both environments. A rotation PR enrolls the replacement public key and validity window before use; a compromise sets `enabled: false`, rotates the endpoint credential, updates the protected digest pin, and invalidates all evidence relying on that source until a new three-source run succeeds.
4. Verify the physical runners can execute `actions/checkout`, `actions/setup-node`, Node.js 22.12, and `actions/upload-artifact`. Source jobs do not require preinstalled Bash, `gh`, `jq`, npm dependencies, or an Administration-scoped token.

The registry and protected digest pin are separate trust boundaries. The fixed producer uses a GitHub-hosted random challenge, three current-attempt physical source jobs, and a GitHub-hosted aggregate. The close workflow verifies the aggregate attestation with `gh attestation verify --deny-self-hosted-runners`, exact main SHA/ref/workflow/run/attempt certificate fields, and a trusted Sigstore timestamp.

The hosted aggregate accepts source receipts only within the producer's three-hour matrix/aggregation SLA and exact random challenge. A later close replays freshness against the unforgeable verified attestation timestamp, not the operator's wall clock; the close must still occur before the 365-day artifact retention expires (the verifier caps trusted timestamp age at 370 days).

OIDC proves that the exact reviewed commit and workflow invocation produced the aggregate; it does not prove that the commit's policy is benevolent. Independent governance comes from protected-main review plus protected environment reviewers/admin-no-bypass. A separately governed immutable reusable trusted builder would be a future hardening step.
