# VS Code host lock selection rerun (2026-11-09)

The Host runner was rebuilt with lock selection preferring the current Extension Host PID and then the newest `started_at` value. The rerun no longer selected the stale same-workspace lock, but the fresh advertised port still timed out. This separates stale-lock selection from the remaining Extension Host listener reachability issue.
