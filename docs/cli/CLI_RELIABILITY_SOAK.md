# CLI reliability soak

`packages/cli/scripts/cli-reliability-soak.mjs` is the canonical artifact
producer for the CLI disk/pipe/TTY/SSH/resource-lifecycle matrix. It exercises
the real CLI entrypoint against a loopback fake Ollama server; it does not
replace the production runtime with an injected unit seam.

The JSON artifact schema is `chainlesschain.cli-reliability-soak.v1`. Each run
records the exact checkout SHA, platform/architecture/Node identity, cleanup
deadline, per-scenario p95, RSS, I/O where the host exposes it, FD or handle
delta, process-descendant counts, and bounded content-free diagnostics.

## Profiles

- `smoke`: intended for pull requests and local validation. Defaults to 5
  seconds, 10 duplex turns, 3 concurrent Agents, and 2 real broken-pipe cases.
- `formal`: intended for scheduled and manually dispatched evidence. The
  script refuses weaker values than 2 hours, 1,000 duplex turns, 20 concurrent
  Agents, and 20 real broken-pipe cases.

Both profiles use the production 10-second cleanup ceiling. A configured value
can tighten this ceiling but cannot extend it.

Run a local smoke:

```powershell
npm run test:cli-reliability-soak
```

Set `CC_CLI_RELIABILITY_OUTPUT` to retain the JSON artifact at a chosen path.
`CC_CLI_RELIABILITY_SCENARIOS=pipe,tty` can narrow a local diagnostic run; CI
does not set this option and therefore runs every scenario.

## Matrix truthfulness

The three-platform workflow is
`.github/workflows/cli-reliability-soak.yml`. Linux provisions an actual
localhost OpenSSH server and executes the CLI through `ssh -tt`; Windows and
macOS report SSH as `target-not-configured` unless a real target is supplied.
All three platforms execute the real pipe, native PTY, concurrent-Agent, and
duplex resource scenarios.

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
