# forensics-bridge

> Python sidecar for ChainlessChain Personal Data Hub — see [`docs/design/Personal_Data_Hub_Python_Sidecar.md`](../../docs/design/Personal_Data_Hub_Python_Sidecar.md).

## Status

**v0.1.0** (Phase 4.5.1) — IPC skeleton only:

- `sidecar.ping` — health check
- `sidecar.capabilities` — declare available methods/parsers
- JSON-lines envelope on stdio
- pino-style log on stderr

Parser implementations land in subsequent sub-phases (4.5.2 system data → Phase 5+ per-app parsers).

## Run

```bash
python -m forensics_bridge.ipc_server
```

Then send a JSON request on stdin:

```
{"id":"req-001","method":"sidecar.ping","params":{}}
```

Sidecar responds on stdout:

```
{"id":"req-001","type":"result","data":{"version":"0.1.0","pythonVersion":"3.12.x"}}
```

## Develop

```bash
# Install in editable mode + test deps
pip install -e ".[test]"

# Run tests
pytest

# Run with stderr-side logging
PYTHONUNBUFFERED=1 python -m forensics_bridge.ipc_server
```

## Architecture

- Process is **spawned by Node hub** (`SidecarSupervisor` in `packages/personal-data-hub/lib/sidecar/supervisor.js`)
- No network ports — stdio JSON-lines only
- No persistent state — supervisor restarts on crash
- No credentials — hub injects secrets per-request, sidecar zeroes after use

## License

MIT (compatible with upstream [sjqz](https://github.com/example/mobile-forensics)).
