# cc service templates

Templates for running long-lived `cc` daemons under a process supervisor.
Currently covers:

- `cc crosschain mtc-serve` — periodic bridge MTC batch closer
- `cc mtc serve` — federation libp2p verifier daemon (existing)
- `cc audit mtc reconcile` — periodic audit-mtc reconcile (use cron / supervisor)

Choose the file matching your platform:

| Platform                 | File                                  | Install                                                                                                       |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Linux (systemd)          | `cc-bridge-mtc.service`               | `cp cc-bridge-mtc.service /etc/systemd/system/ && systemctl enable --now cc-bridge-mtc`                       |
| macOS (launchd)          | `com.chainlesschain.bridge-mtc.plist` | `cp ... ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.chainlesschain.bridge-mtc.plist` |
| Windows (NSSM)           | `cc-bridge-mtc.nssm.txt`              | Run the listed `nssm install` commands in an elevated shell                                                   |
| Windows (Task Scheduler) | `cc-bridge-mtc.taskscheduler.xml`     | `schtasks /Create /XML cc-bridge-mtc.taskscheduler.xml /TN "cc bridge MTC"`                                   |

These are **samples** — adjust paths (`User=`, `WorkingDirectory=`, `cc` binary
location) for your install. None of them are wired into the npm package
postinstall — supervisor registration must be an explicit operator action.

## Health check

All `cc * serve` daemons emit a single JSON line per tick to stdout when
invoked with `--json`. Pipe to your log aggregator (journald / syslog /
Cloudwatch) and alert on absence of a tick within `interval × 2` seconds.

```jsonl
{"tick_at":"2026-05-02T10:00:00Z","batches":[{"pair":"ethereum-polygon","seq":7,"count":3,"namespace":"mtc/v1/bridge/ethereum-polygon/000007","treeHeadId":"sha256:...","dir":"..."}],"skipped":null}
{"tick_at":"2026-05-02T10:01:00Z","batches":[],"skipped":{"reason":"NO_STAGED_OPS"}}
```

## Graceful shutdown

`cc crosschain mtc-serve` and `cc mtc serve` handle `SIGINT` and `SIGTERM` —
clear the interval timer and exit 0. systemd / launchd / NSSM all default to
`SIGTERM` for stop, so no extra config is needed.
