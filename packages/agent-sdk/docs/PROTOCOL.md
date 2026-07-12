# ChainlessChain Agent Protocol — v1

The language-neutral wire contract behind `@chainlesschain/agent-sdk`.
TypeScript consumers (VS Code extension, web-panel) get these shapes as
types from `@chainlesschain/agent-sdk/protocol`; non-TypeScript consumers
(the JetBrains plugin's `ChatEvents.java` / `AgentChatSession.java`) implement
this document directly. **The protocol — not any SDK — is the contract.**

Source of truth in the CLI:

| Surface                 | CLI module                                                  |
| ----------------------- | ----------------------------------------------------------- |
| stream-json duplex      | `packages/cli/src/runtime/headless-stream.js`               |
| background-session pipe | `packages/cli/src/lib/background-session-transport.js`      |
| bg-\* WS relay          | `packages/cli/src/gateways/ws/background-agent-protocol.js` |

Versioning: this file describes **protocol v1**. Any BREAKING field/type
change in the CLI modules above must bump `PROTOCOL_VERSION` in
`src/protocol.ts` and be reflected here in the same commit. Additive
OPTIONAL fields stay on the current version — consumers MUST tolerate
their absence and MUST ignore unknown fields.

Cross-language conformance: the fixtures under `__fixtures__/protocol/`
(NDJSON event samples + `expected.json` UI-mapping table) are asserted by
BOTH the TypeScript side (`__tests__/protocol-fixtures.test.ts`, which also
drives the VS Code extension's `chat-events.js`) and the JetBrains twin
(`packages/jetbrains-plugin/.../ProtocolFixturesTest.java` against
`ChatEvents.java`). A protocol change lands with a fixture update in the
same commit.

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

| Event            | Shape                                                                                           | Notes                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| capability hello | `{"type":"hello","protocol_version":int?,"min_protocol_version":int?,"features":[str...]?}`     | optional first line; negotiates a common level — see 1.2.2. CLI replies `system/negotiated` |
| user turn        | `{"type":"user","text":str,"images":[path...]?,"llm":{provider,model,baseUrl?,apiKey?}?}`       | ≤ 8 images honored; `llm` switches this turn's model only                      |
| interrupt        | `{"type":"interrupt"}`                                                                          | aborts in-flight turn, session survives                                        |
| compact          | `{"type":"compact"}`                                                                            | manual history compaction between turns                                        |
| approval verdict | `{"type":"approval","id":str,"approve":bool}`                                                   | answers an `approval_request`                                                  |
| question answer  | `{"type":"answer","id":str,"answer":str\|str[]\|null}`                                          | `null` cancels                                                                 |
| plan control     | `{"type":"plan","action":"enter"\|"approve"\|"reject","review":{"snapshot":str}?}`              | plan-mode UI; approve/reject may carry an IDE review snapshot for audit/replay |
| feedback         | `{"type":"feedback","turn_id":str?,"kind":"positive"\|"negative"\|"correction","comment":str?}` | PDH self-learning                                                              |
| assist resume    | `{"type":"resume","token":str?,"action":"completed"\|"skip"}`                                   | PDH guided collection                                                          |

### 1.2 CLI → client (stdout events)

| `type`                                             | Key fields                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system` (`subtype:"init"`)                        | `session_id` (resume id — persist this), `model`, `provider`, `permission_mode`, `tools[]`, `resumed_messages`                                                               |
| `system` (`subtype:"negotiated"`)                  | `protocol_version` (agreed, or null), `features[]`, `downgraded`, `disabled_features[]?`, `ok`, `reason?` — reply to a `hello`, see 1.2.2                                     |
| `system` (`subtype:"end"`)                         | `turns`                                                                                                                                                                      |
| `stream_event`                                     | `event.type:"content_block_delta"`, `event.delta` = `{type:"text_delta",text}` or `{type:"thinking_delta",thinking}`                                                         |
| `tool_use`                                         | `tool`, `args`, `id?` (`tu-<n>`, additive — see 1.2.1)                                                                                                                       |
| `tool_result`                                      | `tool`, `is_error`, `error?`, `result?`, `id?` (pairs with the `tool_use` of the same `id`)                                                                                  |
| `token_usage`                                      | `usage:{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`                                                                                     |
| `approval_request`                                 | `id`, `session_id`, `tool`, `command`, `risk`, `rule`, `reason` — tool is BLOCKED until answered; CLI fails closed after `CC_APPROVAL_TIMEOUT_MS` (default 120 s)            |
| `approval_resolved`                                | `id`, `approved`, `via` (`"user"`/`"timeout"`) — settle UI cards on this                                                                                                     |
| `question_request` / `question_resolved`           | `id`, `question`, `options?`, `multiSelect?` (needs env `CC_INTERACTIVE_QUESTIONS=1`)                                                                                        |
| `plan_update`                                      | `active`, `state`, `items[]{id,title,tool,impact,status}`, `risk{level,totalScore}`                                                                                          |
| `compaction`                                       | history-trim stats                                                                                                                                                           |
| `stream_retry`                                     | provider retry notice                                                                                                                                                        |
| `iteration_warning` / `iteration_budget_exhausted` | `message` / `budget`                                                                                                                                                         |
| `raw`                                              | non-protocol stdout; `subtype:"provider_fallback"` / `"version_skew"`                                                                                                        |
| `user`                                             | echo of accepted input (`--replay-user-messages`)                                                                                                                            |
| `feedback_ack` / `resume_ack`                      | PDH round-trip acks                                                                                                                                                          |
| `result`                                           | terminal per turn: `subtype:"success"\|"error"\|"blocked"\|"interrupted"`, `is_error`, `result`, `session_id`, `num_turns`, `duration_ms`, `tool_calls`, `usage`, `denials?` |

Unknown `type`s MUST be ignored (forward compatibility), not treated as errors.

#### 1.2.1 Additive v1 fields (`seq`, `trace_id`, tool-call `id`)

Advertised in `cc agent --capabilities` → `features.event_seq` /
`features.trace_id` / `features.tool_use_id`. All are **optional** —
consumers MUST tolerate their absence (older CLIs never send them) and MUST
NOT change behavior solely because they are missing.

- **`seq`** (every stdout line): 1-based, monotonically increasing emit
  sequence number, unique within one session process. Use it to order /
  de-duplicate relayed lines; do NOT require gap-free numbering across
  reconnects or transports that re-frame lines.
- **`trace_id`** (every stdout line): a run-scoped correlation id repeated
  unchanged on every line of the run. Callers MAY inject it via `--trace-id`
  or the `CC_TRACE_ID` env var to trace one run end-to-end across their own
  logs, the CLI, the transcript and diagnostic bundles; otherwise the CLI
  mints one per process. It is distinct from `session_id` (which a resume
  reuses across processes) — two runs resuming the same session get
  different `trace_id`s. An injected id is sanitized to a single safe token
  (`[A-Za-z0-9._:-]`, ≤128 chars).
- **`tool_use.id` / `tool_result.id`**: per-session tool-call correlation
  id (`tu-<n>`, 1-based). A `tool_result` carries the id of the
  `tool_use` it settles, so UIs can pair calls without relying on
  adjacency. Without ids, pairing stays adjacency-based (a `tool_result`
  follows its `tool_use`), exactly as before.

#### 1.2.2 Capability negotiation + N / N-1 downgrade

The manifest above is one-directional (the CLI states what it can do). A
client MAY instead **negotiate**: send a `hello` as its first stdin line
declaring the protocol range and the wire features (1.2.1) it understands,
and the CLI picks a common level, stepping DOWN when the two disagree, then
honors it for the rest of the run. This is what lets a v1-only client stay
correct once a v2 line shape ships. It is fully optional — a client that
never sends `hello` gets full current-version behavior, byte-for-byte
unchanged.

- **`protocol_version`** = highest the client can parse; **`min_protocol_version`**
  = lowest it will accept (defaults to `protocol_version`). The CLI advertises
  its own range as `protocol_version` / `min_protocol_version` in
  `cc agent --capabilities`.
- **Agreed version** = `min(client.max, server.max)`. If that is below
  `max(client.min, server.min)` the ranges don't overlap → the CLI replies
  `ok:false` and keeps its own baseline (it never emits a shape the client
  can't read).
- **`features`** narrows the additive fields: send the array to accept only a
  subset (e.g. `["trace_id"]` → the CLI stops stamping `seq`); omit it to
  accept whatever the agreed version offers. A field whose minimum version is
  above the agreed version is dropped (an N-only field on an N-1 session).
- The CLI echoes the outcome once as `system/negotiated`
  (`protocol_version`, `features[]`, `downgraded`, `disabled_features[]`,
  `ok`, `reason?`). `downgraded:true` means the agreed version or feature set
  is below the CLI's own maximum.

Source of truth: `packages/cli/src/lib/capability-negotiation.js`
(`negotiateProtocol`), mirrored by the JetBrains twin
`CapabilityNegotiation.java`; both are pinned to the shared fixture
`packages/cli/__tests__/fixtures/capability-negotiation-cases.json`.

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

Unsolicited pushes while attached, each stamped with a per-attachment
monotonic 1-based `seq` (additive — older clients ignore it):
`{"type":"bg-event","bgId","seq","event":<worker event>}` and
`{"type":"bg-log","bgId","seq","chunk"}`.

Gap replay (reconnect resilience): a client tracks the last `seq` it saw and,
on a re-attach after a WS blip, sends `bg-attach {bgId, sinceSeq}`. If the relay
is still live, it re-pushes the frames after `sinceSeq` (bounded buffer) and the
`bg-attach` reply carries `latestSeq`, `replayed` (count) and `replayTruncated`.
`replayTruncated:true` means the missed range was already evicted — the client
must full-resync from the log tail. Every `bg-attach` reply carries `latestSeq`;
a fresh (non-`reattached`) reply means a new relay whose `seq` restarts at 1, so
the client resets its gap tracker. Symmetric to the control-plane
`RemoteCommandLedger` (`replaySince(cursor)`); shared core in
`packages/cli/src/lib/event-seq-replay.js` (`EventReplayBuffer` producer +
`SeqGapTracker` consumer).

Backpressure: if the client drains too slowly (`ws.bufferedAmount` over a high
water), the relay sheds droppable frames (`bg-log`) while always delivering
critical ones (`bg-event`). Dropped frames are still recorded, so the seq gap on
the next delivered frame trips the `sinceSeq` replay above. The relay marks the
episode with `{"type":"bg-lag","bgId","lagging":true}` and its end with
`{"type":"bg-lag","bgId","lagging":false,"dropped","latestSeq"}` (no `seq` —
out-of-band control). A client SHOULD surface a "catching up" affordance on lag
and MAY eagerly `bg-attach {sinceSeq}` on recovery. Policy core:
`packages/cli/src/lib/backpressure-policy.js`.

Security: `transport.token` never crosses the WS boundary — the gateway
performs the pipe handshake itself and exposes only `interactive:true|false`.
