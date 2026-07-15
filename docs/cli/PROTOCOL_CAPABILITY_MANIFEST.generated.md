# Agent Protocol Capability Manifest (generated)

Protocol version **1** (negotiates down to **1**).

## Negotiable wire features

| Feature | Min version | Line field | Description |
| ------- | ----------- | ---------- | ----------- |
| `event_seq` | 1 | `seq` | every stream-json stdout line carries a monotonic per-run `seq` |
| `tool_use_id` | 1 | `tool_use_id` | tool_use / tool_result lines carry a pairing `id` ("tu-<n>") |
| `trace_id` | 1 | `trace_id` | each line carries a run-scoped, caller-injectable `trace_id` for IDE ↔ CLI correlation |

## Permission modes

`default`, `manual`, `auto`, `dontAsk`, `plan`, `acceptEdits`, `bypassPermissions`

