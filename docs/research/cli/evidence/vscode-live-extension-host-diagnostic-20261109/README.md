# VS Code bridge self-probe diagnostics (2026-11-09)

A rebuilt packaged VS Code 1.145.2 Host ran the production bridge self-probe five times. Every attempt returned `ETIMEDOUT` while connecting to the freshly bound `127.0.0.1` port. Startup therefore failed closed and published no lockfile. The same production HTTP server succeeds in a standalone Node loopback probe, so this evidence isolates the remaining failure to the Extension Host process boundary.
