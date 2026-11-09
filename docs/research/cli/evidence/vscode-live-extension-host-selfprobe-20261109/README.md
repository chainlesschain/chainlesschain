# VS Code host bridge self-probe (2026-11-09)

The extension was rebuilt with a bounded self-probe before publishing its lockfile. In the real VS Code 1.145.2 Extension Host, the self-probe could not connect to the freshly bound `127.0.0.1` listener, so startup failed closed and no dead lock was published. This is stronger evidence of an Extension Host lifecycle/socket boundary; the direct production server probe remains successful outside the host.
