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
