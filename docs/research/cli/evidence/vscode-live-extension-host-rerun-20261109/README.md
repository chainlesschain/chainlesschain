# VS Code live Extension Host rerun (2026-11-09)

The repository Extension Host runner used the existing packaged VSIX in a fresh VS Code 1.145.2 profile with `--host-api-only`. The installed VSIX was discovered and activated, and the extension log recorded a bridge listening on `127.0.0.1:65215`. The runner's same-host TCP probe still timed out on that advertised port, so the bridge journey remains failed. This is a reproducible live-host boundary, not an activation or packaging failure.

No credentials or provider calls were used. The run was local and was not pushed.
