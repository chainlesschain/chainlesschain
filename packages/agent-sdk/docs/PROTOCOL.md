# ChainlessChain Agent Protocol — v1

The language-neutral wire contract behind `@chainlesschain/agent-sdk`.
TypeScript consumers (VS Code extension, web-panel) get these shapes as
types from `@chainlesschain/agent-sdk/protocol`; non-TypeScript consumers
(the JetBrains plugin's `ChatEvents.java` / `AgentChatSession.java`) implement
this document directly. **The protocol — not any SDK — is the contract.**

Source of truth in the CLI:

| Surface | CLI module |
| --- | --- |
| stream-json duplex | `packages/cli/src/runtime/headless-stream.js` |
| background-session pipe | `packages/cli/src/lib/background-session-transport.js` |
| bg-\* WS relay | `packages/cli/src/gateways/ws/background-agent-protocol.js` |

Versioning: this file describes **protocol v1**. Any field/type change in the
CLI modules above must bump `PROTOCOL_VERSION` in `src/protocol.ts` and be
reflected here in the same commit.

---

## 1. stream-json duplex (interactive agent session)

Spawn:

```
cc agent --input-format stream-json --output-format stream-json \
         [--include-partial-messages] [--interactive-approvals] \
         [--resume <sessionId>] [--fork-session] \
         [--permission-mode plan|acceptEdits|bypassPermissions|auto] \
         [--model <m>] [--provider <p>]
```

- One JSON object per line, both directions. stdout = protocol events,
  stderr = human-readable trace (never parse it).
- On Windows run via `cmd.exe /c` (npm `.cmd` shim) and set env
  `NoDefaultCurrentDirectoryInExePath=1` (blocks repo-local `cc.bat`
  hijack). Kill with `taskkill /T /F` to reap the grandchild.
- Line framing MUST use a carry buffer — a chunk boundary can split a line.

### 1.1 Client → CLI (stdin events)

| Event | Shape | Notes |
| --- | --- | --- |
| user turn | `{"type":"user","text":str,"images":[path...]?,"llm":{provider,model,baseUrl?,apiKey?}?}` | ≤ 8 images honored; `llm` switches this turn's model only |
| interrupt | `{"type":"interrupt"}` | aborts in-flight turn, session survives |
| compact | `{"type":"compact"}` | manual history compaction between turns |
| approval verdict | `{"type":"approval","id":str,"approve":bool}` | answers an `approval_request` |
| question answer | `{"type":"answer","id":str,"answer":str\|str[]\|null}` | `null` cancels |
| plan control | `{"type":"plan","action":"enter"\|"approve"\|"reject","review":{"snapshot":str}?}` | plan-mode UI; approve/reject may carry an IDE review snapshot for audit/replay |
| feedback | `{"type":"feedback","turn_id":str?,"kind":"positive"\|"negative"\|"correction","comment":str?}` | PDH self-learning |
| assist resume | `{"type":"resume","token":str?,"action":"completed"\|"skip"}` | PDH guided collection |

### 1.2 CLI → client (stdout events)

| `type` | Key fields |
| --- | --- |
| `system` (`subtype:"init"`) | `session_id` (resume id — persist this), `model`, `provider`, `permission_mode`, `tools[]`, `resumed_messages` |
| `system` (`subtype:"end"`) | `turns` |
| `stream_event` | `event.type:"content_block_delta"`, `event.delta` = `{type:"text_delta",text}` or `{type:"thinking_delta",thinking}` |
| `tool_use` | `tool`, `args` |
| `tool_result` | `tool`, `is_error`, `error?`, `result?` |
| `token_usage` | `usage:{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}` |
| `approval_request` | `id`, `session_id`, `tool`, `command`, `risk`, `rule`, `reason` — tool is BLOCKED until answered; CLI fails closed after `CC_APPROVAL_TIMEOUT_MS` (default 120 s) |
| `approval_resolved` | `id`, `approved`, `via` (`"user"`/`"timeout"`) — settle UI cards on this |
| `question_request` / `question_resolved` | `id`, `question`, `options?`, `multiSelect?` (needs env `CC_INTERACTIVE_QUESTIONS=1`) |
| `plan_update` | `active`, `state`, `items[]{id,title,tool,impact,status}`, `risk{level,totalScore}` |
| `compaction` | history-trim stats |
| `stream_retry` | provider retry notice |
| `iteration_warning` / `iteration_budget_exhausted` | `message` / `budget` |
| `raw` | non-protocol stdout; `subtype:"provider_fallback"` / `"version_skew"` |
| `user` | echo of accepted input (`--replay-user-messages`) |
| `feedback_ack` / `resume_ack` | PDH round-trip acks |
| `result` | terminal per turn: `subtype:"success"\|"error"\|"blocked"\|"interrupted"`, `is_error`, `result`, `session_id`, `num_turns`, `duration_ms`, `tool_calls`, `usage`, `denials?` |

Unknown `type`s MUST be ignored (forward compatibility), not treated as errors.

### 1.3 SDK contracts built on this

- **Approval callback**: supplying an approval handler implies
  `--interactive-approvals`; each `approval_request` is answered with
  `{"type":"approval",...}`; a handler failure answers `approve:false`
  (fail closed, matching the CLI's own timeout behavior).
- **Session resume**: persist `session_id` from `system/init`; pass it back
  as `--resume <id>` (optionally `--fork-session`). `resumed_messages > 0`
  confirms the transcript was restored.
- **Checkpoints**: workspace file snapshots via
  `cc checkpoint create|list|show|restore --json`.
- **Session listing**: `cc session list --json`, `cc session show <id> --json`.

## 2. Background-session pipe (attach to a running agent)

Endpoint: Windows named pipe `\\.\pipe\cc-bg-<id>` / POSIX socket
`~/.chainlesschain/background-agents/<id>.sock`. Token comes from the 0600
state file `~/.chainlesschain/background-agents/<id>.json` → `transport.token`.

- client → worker: `{"type":"hello","token"}` · `{"type":"prompt","text"}` ·
  `{"type":"status"}` · `{"type":"stop"}` · `{"type":"detach"}`
- worker → client: `{"type":"hello",...status}` · `{"type":"accepted","queued"}` ·
  `{"type":"status",...}` · `{"type":"stopping"}` · `{"type":"error","message"}` ·
  `{"type":"turn-started","turn","prompt"}` · `{"type":"turn-ended","turn","exitCode"}` ·
  `{"type":"idle","turn"}` · `{"type":"closing"}`

Handshake: send `hello` within 5 s of connecting or the worker drops the
socket. Wrong token → immediate destroy.

## 3. bg-\* WebSocket relay (web-panel)

Request/reply routes on the CLI's WS gateway: `bg-list` · `bg-view` ·
`bg-attach` · `bg-prompt {bgId,text}` · `bg-stop-turn` · `bg-detach` ·
`bg-stop` · `bg-rename` · `bg-resume`.

Unsolicited pushes while attached:
`{"type":"bg-event","bgId","event":<worker event>}` and
`{"type":"bg-log","bgId","chunk"}`.

Security: `transport.token` never crosses the WS boundary — the gateway
performs the pipe handshake itself and exposes only `interactive:true|false`.
