# P1-10 physical host enrollment and trust boundary

The checked-in registry is intentionally empty. This is a fail-closed production
state, not a sample configuration and not evidence that P1-10 has been closed.
Repository tests validate the protocol only; they never enroll a runner, create a
production key, synthesize a metric, or substitute a virtual machine for physical
execution.

## Required external deployment

Closing P1-10 requires six independently registered physical self-hosted GitHub
Actions runners: Linux, macOS, and Windows, with fixed `a` and `b` host slots on
each platform. Every registry entry must bind a unique GitHub runner registration
ID and name, a unique externally verified `hardwareIdentityDigest`, platform/slot
labels, enrollment validity,
the fixed producer workflow and protected environment, and a unique local
attester identity and `attesterMeasurementDigest`. The signed execution receipt
must also contain a per-boot `bootIdDigest`; all six values must be globally
independent and stable across that host's scenario reports. Two GitHub runner
registrations, labels, key pairs, or aliases on one physical machine do not
satisfy the independent-host requirement. GitHub labels do not prove physical
independence; these hardware/attester measurements are enrollment trust roots
that operators must verify outside the repository.

Every enrollment also pins a platform `inputManifestDigest`. That manifest is a
non-secret, operator-reviewed deployment artifact with schema
`chainlesschain.p1-10-protected-input-manifest/v1`. It binds the exact commit,
matrix and scenario-contract digests; reviewed checkout fixture paths, sizes and
SHA-256 digests; fixed workload/payload profiles; source and target migration
runtimes and expected states; packaged Electron artifact/signature; and the soak
operation profile. Both slots on one platform must use byte-identical manifests.
The runner path is only a locator: the builder reads one regular file descriptor,
checks the protected digest, stages those exact bytes, and the local attester
independently validates the same digest before it executes the workload.

Each host must run an administrator-owned local attester whose Ed25519 private
key is non-exportable and unavailable to the Actions job account. The checked-in
public key identifies the host. The registry and protected environment pin the
attester/supervisor executable digest and version. The attester, not checkout
code, launches the fixed-digest harness, records wall and monotonic bounds,
collects the versioned scenario event chain, enforces OS containment, confirms
tree exit, clears inherited secrets, and signs both the execution receipt and
every raw host report.

Required containment is platform specific:

- Linux: a delegated cgroup v2 scope that denies daemon escape and is observed
  empty before signing.
- macOS: an administrator-owned strong process-tree supervisor that prevents or
  detects re-parenting/daemonization and proves the supervised tree empty.
- Windows: a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, including
  termination and wait confirmation for failures before job assignment.

Plain Unix process groups are cleanup aids only and are not accepted as strong
containment because a child can escape with `setsid(2)`.

## Protected GitHub configuration

The `p1-10-external-conformance` environment must pin the SHA-256 digests for the
checked-in registry, all three platform harnesses, and all three local attesters.
It must also pin all three protected input-manifest digests and configure the
corresponding administrator-managed local manifest paths.
It must require trusted reviewers, restrict deployment to protected `main`, and
prevent self-review and administrator bypass. Runner path variables may locate enrolled binaries,
but a path is never a trust root: bytes, enrollment identity, and protected digest
must all agree. No private-key path or exportable signing secret is permitted in a
job environment.

The close environment must independently pin the same digests and require trusted
review with self-review disabled. It accepts only attempt-scoped artifact IDs from an exact successful
producer REST run and validates hosted OIDC certificate claims for protected main,
the signer workflow/digest, and the exact run-attempt invocation URI. The hosted,
attempt-scoped challenge artifact is a separate trust root from the evidence
subject. Repository or environment administrators who can replace all of these
controls remain outside the protocol trust boundary and must be governed by the
organization's access, audit, and break-glass policy.

## Enrollment, rotation, and revocation

Enrollment must be performed out of band by authorized operators after verifying
hardware, runner registration, labels, attester build provenance, non-exportable
key storage, OS containment, protected candidate/runtime/fixture manifest, and
clock health. Add the public entry in a reviewed
change, update the protected registry digest only after approval, and perform a
real challenged dry run. Never copy keys between slots or enroll test/placeholder
keys.

For rotation, overlap narrowly bounded old/new validity only when operationally
necessary, deploy and verify the new attester/key first, then update the registry
and protected digest together. For suspected compromise, disable the runner and
environment immediately, revoke/remove the registry entry, rotate its key and
attester credential, update the protected digest, and treat evidence whose signed
window intersects the compromise interval as invalid. Historical artifacts do not
override revocation or enrollment validity.

## Current blocker

`.github/p1-10-physical-host-registry.json` currently contains `"hosts": []`.
Therefore the producer is intentionally unable to resolve any physical runner or
sign trusted evidence. P1-10 remains externally blocked until operators deploy and
enroll all six real machines, configure the protected environments and digest
pins and platform input manifests, run the full physical scenarios (including the 30-minute soak), and obtain a
fresh hosted close receipt. No repository-only change can honestly satisfy that
physical/external requirement.
