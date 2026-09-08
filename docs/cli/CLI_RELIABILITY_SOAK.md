# CLI reliability soak

`packages/cli/scripts/cli-reliability-soak.mjs` is the canonical artifact
producer for the CLI disk/pipe/TTY/SSH/MCP/resource-lifecycle matrix. It
exercises the real CLI entrypoint against a loopback fake Ollama server and a
real stdio MCP child; it does not replace the production runtime with an
injected unit seam.

The JSON artifact schema is `chainlesschain.cli-reliability-soak.v2`. Each run
records the exact checkout SHA, platform/architecture/Node identity, cleanup
deadline, per-scenario p95, RSS, I/O where the host exposes it, FD or handle
delta and high-water mark, process-descendant counts, and bounded content-free
diagnostics. Duplex latency storage is a bounded rolling window; the artifact
reports both the total observations and retained sample count.

## Profiles

- `smoke`: intended for pull requests and local validation. Defaults to 5
  seconds, 10 duplex turns, 3 concurrent Agents, 2 broken/slow pipe cases, and
  1 terminal-disconnect case.
- `formal`: intended for scheduled and manually dispatched evidence. The
  script refuses weaker values than 2 hours, 1,000 duplex turns, 20 concurrent
  Agents, 20 broken/slow pipe cases, 5 TTY/SSH disconnects, and a 2-second slow
  consumer stall.

Both profiles use the production 10-second cleanup ceiling. A configured value
can tighten this ceiling but cannot extend it.

Run a local smoke:

```powershell
npm run test:cli-reliability-soak
```

Set `CC_CLI_RELIABILITY_OUTPUT` to retain the JSON artifact at a chosen path.
`CC_CLI_RELIABILITY_SCENARIOS=disk,mcpOutput,pipe,tty` can narrow a local
diagnostic run; CI does not set this option and therefore runs every scenario.

The v2 artifact is checkpointed atomically at run start, before/after every
scenario, and periodically during the duplex soak. Set
`CC_CLI_RELIABILITY_RESUME=1` with the same output path to recover only passed
scenarios from an interrupted artifact. Schema, exact SHA, platform,
architecture, and complete profile must match. A running or failed scenario is
always rerun, so partial work cannot be promoted to passed evidence.

## Matrix truthfulness

The three-platform workflow is
`.github/workflows/cli-reliability-soak.yml`. Linux provisions an actual
localhost OpenSSH server and executes the CLI through `ssh -tt`; Windows and
macOS report SSH as `target-not-configured` unless a real target is supplied.
Linux also mounts dedicated tmpfs fixtures: one remounted read-only for a real
EROFS syscall and one filled to capacity for real ENOSPC. The gate requires
both host errno and the real CLI's content-free persistence projection, with
zero model calls before failure. All three platforms execute broken and slow
pipe consumers, native PTY success/disconnect, oversized stdio MCP output,
concurrent-Agent, and duplex resource scenarios. The MCP probe returns more
than 1 MiB containing a private canary and requires the real CLI to replace it
with `CC_MCP_TOOL_RESULT_TOO_LARGE`; the canary must be absent from the next
model request, stdout/stderr, and the bounded artifact, and the MCP server PID
must retire by the cleanup deadline. Linux additionally disconnects a live
`ssh -tt` client and verifies the observed remote PID retires within the
cleanup deadline.

A local smoke or a successful unit test is not formal evidence. Closure
requires the scheduled/manual Linux, Windows, and macOS artifacts on the same
exact SHA. Screen-reader behavior and Windows/macOS clipboard and keyboard
layouts still require their separate interactive accessibility/device matrix.

## Disk commit-state contract

ENOSPC and EROFS use the public schema
`chainlesschain.session-persistence-failure.v1`:

- `not-committed`: the requested transcript event is known not to have been
  published. EROFS before append has this state.
- `unknown`: a short write or post-append settlement failure may have published
  bytes. ENOSPC is never blindly retried in this state; transcript verification
  decides recovery.
- `committed`: returned by a successful transcript append.

Persistent headless modes fail before model/tool execution when the user turn
cannot be persisted. If assistant persistence fails after model/tool work, the
answer remains in the result for recovery, but the result subtype is
`error_persistence`, exit status is non-zero, and the content-free persistence
projection is attached.

## EvolutionLedger repository checks

The separate `test:evolution-ledger-reliability-soak` command exercises the
EvolutionLedger file backend. It is a repository-local check, not the formal
CLI release matrix described above. Run from the repository root:

```powershell
npm --prefix packages/cli run test:evolution-ledger-reliability-soak -- --events 1000
npm --prefix packages/cli run test:evolution-ledger-reliability-soak -- --fault-rounds 100
```

`--events` accepts 1–10,000 (default 1,000). The writer uses the real append
path for every event, persists a signed state snapshot, and exits. A fresh
process verifies the same head and first/middle/last events, then separate
processes must reject old-segment corruption and a tampered witness signature.
All children have a 256 MiB V8 heap limit; cold reopen must finish within 60
seconds with peak RSS below 512 MiB. This is not a total process-memory limit
for the seed run. Seed timing is reported without asserting production write
throughput; large runs may take tens of minutes. The seed process has a
one-hour deadline; other child processes have a 60-second deadline and bounded
combined stdout/stderr.

`--fault-rounds` accepts 1–1,000 and cycles through six forced-exit points:

| Exit point                             | Expected fresh-process recovery                                |
| -------------------------------------- | -------------------------------------------------------------- |
| Segment hard link or completed segment | Preserve the previous witnessed head; discard uncommitted tail |
| Anchor hard link or completed anchor   | Preserve the previous witnessed head; discard uncommitted tail |
| Witness commit or HEAD replacement     | Recover the committed next event exactly once                  |

Each round seeds a separate temporary store, exits with code 86 inside the
real append path, verifies recovery in a new process, and reopens once more to
prove the recovered head/witness and event count do not change. All temporary
files belong to that run and are removed after children settle. A failed run
exits nonzero and must not be counted as passed.

Both modes use actual file stores, process locks and separate OS processes,
but use test-only HMAC authorities and a test artifact resolver. The Windows
test filesystem tolerates unavailable directory fsync. Process exit is not
power loss; these runs do not establish production PKI, independent witness
failure domains, physical durability, DB/Hook/Eval fault coverage or automatic
Skill-promotion acceptance. The ordinary regression suite runs only the
small-scale driver and recovery cases; the long workload is explicit.

The report also exposes `seedVerificationCounts` and
`reopenVerificationCounts`, keyed by authority and verification purpose.
These are call counts, not evidence that production keys were used.
Local Windows diagnostic runs on 2026-09-05 recorded 1,697 historical witness
verifications for 25 events and 5,872 for 50 events. Their seed timings were
5.70 and 14.98 seconds; other validation was running concurrently, so these
are not isolated throughput benchmarks. The increasing verification work
matches the current full-history validation on each witness read. Cold
reopen still invoked the snapshot verifier and no historical domain-event
verifier in both runs. Any optimization must preserve current authority
revalidation and detection of changed history; passing these small workloads
does not establish the 250,000-event capacity boundary.

The subsequent file-witness optimization caches canonical messages, digests
already checked against those messages, and canonical record encodings only
after full validation. Reuse requires the exact scalar fields and signature,
not just a supplied digest or file timestamp. Every historical and current
record still calls the current verifier on every read, with fresh message and
signature inputs. Revoking an old signature therefore rejects the store even
when its latest signature remains authorized. Cache admission is bounded by
1,024 records and a conservative 16 MiB retained-text budget; entry overhead
is separately bounded by the record count, not included in a process-RSS
claim. Oversized or later records use the uncached validation path. Publishing
preserves the existing canonical store bytes, fsync and atomic-replace steps.
This reduces repeated encoding and hashing, not the full-history verifier
call count or its asymptotic growth.

The final cache implementation passed 129 related tests (six files), including
51 file-witness cases. Warm-read tests assert zero repeated SHA-256 construction
while preserving all verifier calls; negative cases exercise old-key revocation,
field/signature substitution, same-size edits with restored mtime, input
mutation and both cache admission limits. A subsequent 50-event run passed
with seed 13.42 seconds, cold reopen 1.03 seconds and cold peak RSS 56,676 KiB;
the 5,872 historical witness verifications were unchanged. It ran alongside
regression and the 1,000-event soak, so neither this timing nor the earlier
diagnostics establishes an isolated or fixed-factor throughput improvement.

The optimized 1,000-event run subsequently completed successfully on
2026-09-05: seed PID 6376, reopen PID 10028, seed 1,202.369 seconds, cold reopen
6.988 seconds, and cold peak RSS 120,464 KiB (about 117.6 MiB). All children
retained the 256 MiB V8 heap limit; old-segment and witness tampering were
rejected. Seed historical-witness verification calls were 2,017,022; cold
reopen calls were 4,012, with one snapshot verification and no historical
domain-event verification. The same process was observed to completion,
without restarting it on an observation timeout. These are exact report
metrics, not production authority, physical-durability or 250,000-event
capacity evidence. The earlier 1,612.04-second result measured a whole test
group, so it is not directly comparable to this seed-only duration.

### Segmented file-witness storage (0.166.35 candidate)

The file witness still reads legacy v1 stores. The first successful append
that would exceed 256 records moves complete 256-record prefixes into
`<witness-file>.segments-v2/<sha256>.json` and publishes a v2 head containing
the ordered segment digests and 1–256 tail records. Complete prefix files are
never rewritten on subsequent appends. Each prefix is fsynced, published and
read back before the head can reference it. A crash before head publication
leaves the old head authoritative; a complete unreferenced prefix can be
reused only after exact-byte comparison and another durability confirmation.

Back up the head and its referenced sidecar directory together. Older CLI
versions cannot open a v2 witness; deploy compatible readers and writers
before allowing migration. There is no automatic downgrade. Corrupt orphans
are not overwritten or treated as committed history. Temporary/orphan files
are outside the committed-history size accounting and need separately
managed storage retention.

`maximumBytes` remains the per-file limit (default 64 MiB).
`maximumHistoryBytes` limits the sum of the actual head and all referenced
segment bytes and defaults to `maximumBytes`, preserving the prior aggregate
limit. Reads charge the remaining budget before allocating a segment buffer.
The file backend exposes the latter as `witnessMaximumHistoryBytes`; increasing
it is an explicit deployment choice. The manifest also rejects more than
262,144 records. These limits are rejection boundaries, not a measured
250,000-event capacity guarantee.

Every read reopens and rehashes every referenced prefix, including warm reads.
An authenticated, stable verifier trust epoch permits reuse of validated
segment summaries; changing the epoch revalidates historical signatures.
Without that capability every signature is revalidated. The summary cache
has a separate 16 MiB retained-text budget and at most 1,024 entries; this is
not a whole-process RSS bound. Cross-segment ancestry and discarded-anchor
fences remain authenticated. Authority methods and input snapshots are
captured before callbacks execute.

Regression cases cover legacy conversion, immutable prefixes, old-byte
tampering, trust revocation, malformed manifests, four publication-failure
windows, discard boundaries, silent write loss and aggregate capacity.
The initial four-file local regression passed 95/95 on Windows with Node
22.22.2. After integrating the Windows device-projection compatibility fix,
the final six-file regression passed 101/101, including a segmented-witness
reopen under the affected projection and the aggregate-capacity checks.
ESLint and formatting checks passed.

The concurrent 1,000-event diagnostic subsequently passed: seed PID 11784,
reopen PID 10244, seed 1,646.861 seconds, cold reopen 10.745 seconds and
peak cold RSS 123,940 KiB, with the 256 MiB child heap limit. Historical
witness signature checks were 1,002 during seed and 1,002 during cold reopen;
the cold path performed one snapshot verification and no historical
domain-event verification. Old ledger-segment and witness tampering were
rejected. This process started before the final readback/capacity changes
and ran alongside other tests, so it is diagnostic evidence, not
final-commit acceptance or an isolated performance comparison.
The implementation bounds tail rewriting and segment parsing, but each read
still scans historical bytes. Production throughput, the full 250,000-event
ledger workload, physical power-loss behavior and an independent witness
failure domain remain open acceptance work.
