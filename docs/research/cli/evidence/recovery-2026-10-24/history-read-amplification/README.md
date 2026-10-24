# History read amplification recovery

The base source `927ddab4493021c61947c1eb344d44d88a3b398a` is not eligible for
publication. Its original Windows Formal job exceeded the existing 60-second
result deadline on input 198 after 197 successful results. The original archive,
job log, receipt, and SHA-256 manifest are retained here. The other operating
systems were cancelled after that failure; their checkpoint archives are partial
diagnostic observations and do not establish completed qualification.

The unchanged local Windows diagnostic used Node 22.12.0, the actual worktree
workspace dependencies, and the reliability script's original fake model and
duplex scenario. It retained the 60-second turn deadline and 10-second cleanup
deadline. Its 40 results succeeded, while turn time increased from about 7.8
seconds on turn 2 to 29.5 seconds on turn 40. Local HTTP response time stayed near
2 milliseconds. Passive counters identified repeated immutable ledger reads and
whole-index reads during history recovery. The counter instrumentation is a
diagnostic and is not a Formal qualification result.

The valid main-thread CPU profile is identified in
`local-unchanged-cpu-summary.json`. An earlier fixed-name CPU output was
overwritten by a credential transport worker profile and was excluded from CPU
hotspot conclusions. Its raw diagnostic remains in the local `.work` directory.

The repair gives original implementations a sealed whole-history read. Every
payload is still freshly read with its complete physical identity checks,
digest, envelope signature, and current authority checks. The operation returns
no intermediate result or caller callback between its internal groups. Before
returning the result array, it reopens the full index and checks every decision
lease against the final release clock. The existing public chunk callback API
and custom store/subclass behavior retain their original path.

A synchronous directory scope also shares one authenticated parent descriptor
for direct child reads. Each file keeps the same bounded read, EOF probe,
full-precision metadata, owner, link-count, pathname, and descriptor checks. The
scope rechecks the held parent before returning, rejects asynchronous callbacks,
and invalidates readers that escape the scope. It retains no file contents or
permission decision between calls.

The repair does not migrate the persistent ledger format, split a session's
authenticated Run, substitute metadata for content verification, or change the
Formal profile. Publication still requires a fresh exact-commit matrix and public
package verification. Local checks and cancelled checkpoints do not replace that
gate or change the separate model-task admission status.

Original Run composition also allocates the next sequence inside one fresh
ledger operation and reuses its post-publication head proof only within that
operation. Custom filesystem, lock, publisher and fault-hook compositions keep
the existing path. Conflict detection, complete content authentication, durable
acknowledgement and final readback remain required.

An uncommitted second candidate produced an Evolution ingress error on result
17 and exited; the harness subsequently timed out awaiting result 18. Its
preserved source and storage manifests do not establish the nested cause. A
later 40-result diagnostic and two shorter storage stress runs did not reproduce
the error and do not resolve it. Copied storage cannot establish the original
physical incarnation. Diagnostic homes and signing keys remain local.

The frozen diagnostic adds allowlisted storage cause codes and fixed artifact
type/phase markers to the existing
error path. It never retains arbitrary error text, paths, getter values or
unknown codes, and it does not change error classification or retry behavior.
This is observability, not a root-cause repair. Publication remains blocked by
the unresolved failure even if this diagnostic's checks pass. A worker-reading
prototype is feasibility evidence only; it is not part of this diagnostic.
