# CLI — Managed Agents & Hosted Session API

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)

## Managed Agents Parity (session-core)

Phase D–H — shared with Desktop via `@chainlesschain/session-core`.
All persist under `~/.chainlesschain/`; Desktop reads the same files from `<userData>/.chainlesschain/`.

```bash
# 作用域记忆 (MemoryStore — memory-store.json)
chainlesschain memory store "Prefers TypeScript" --scope global --category preference
chainlesschain memory store "Asked about P2P" --scope session --scope-id sess_123 --tags p2p,q
chainlesschain memory store "Likes Rust" --scope user --scope-id u_alice --category preference
chainlesschain memory recall "typescript" --scope global --json
chainlesschain memory recall "rust" --scope user --scope-id u_alice --json
chainlesschain memory recall --tags p2p --limit 20

# 将 JSONL 会话轨迹整合进 MemoryStore (Phase G)
chainlesschain memory consolidate --session sess_123 --scope agent --agent-id coder
chainlesschain memory consolidate --session sess_123 --dry-run --json

# 按会话的审批策略 (ApprovalGate — approval-policies.json)
chainlesschain session policy sess_123                        # 显示当前策略
chainlesschain session policy sess_123 --set trusted          # strict | trusted | autopilot
chainlesschain session policy sess_123 --json

# Beta 功能开关 (BetaFlags — beta-flags.json)
# 开关格式: <feature>-<YYYY-MM-DD>
chainlesschain config beta list [--json]
chainlesschain config beta enable idle-park-2026-05-01
chainlesschain config beta disable idle-park-2026-05-01

# 会话生命周期 (SessionManager — parked-sessions.json) · Phase H
chainlesschain session lifecycle                              # 列出运行中和已驻留的会话
chainlesschain session lifecycle --status parked --json
chainlesschain session park sess_123                          # 标记空闲并驻留
chainlesschain session unpark sess_123                        # 恢复已驻留会话
chainlesschain session end sess_123 --consolidate             # 关闭会话并写入轨迹到 MemoryStore
chainlesschain agent --session sess_123                       # 启动时自动恢复驻留会话
chainlesschain agent --no-park-on-exit                        # 退出时关闭句柄而非驻留

# 可脚本化的 StreamRouter (stdout 输出 NDJSON) · Phase H
chainlesschain stream "summarize file X"                      # 每行一个 {type,ts,...}
chainlesschain stream "..." --text                            # collect() 拼接后的文本
chainlesschain stream "..." --provider openai --model gpt-4o

# Phase I — 会话 tail + 用量汇总
chainlesschain session tail sess_123                          # 跟随实时 JSONL 事件 (NDJSON)
chainlesschain session tail sess_123 --from-start             # 从字节 0 重放
chainlesschain session tail sess_123 --type tool_call,assistant_message
chainlesschain session tail sess_123 --since 1712000000000 --once
chainlesschain session usage sess_123                         # 单会话 token 汇总
chainlesschain session usage                                  # 全局汇总
chainlesschain session usage --json --limit 500
```

## Hosted Session API (Phase I)

`cc serve` exposes session-core over WebSocket. Route types (dot-case)
return `<type>.response` envelopes with `{ ok, ... }`:

| Type                    | Payload fields                                          |
| ----------------------- | ------------------------------------------------------- |
| `sessions.list`         | `agentId?`, `status?` → `{ sessions[] }`                |
| `sessions.show`         | `sessionId` → `{ session, source: "live"\|"parked" }`   |
| `sessions.park`         | `sessionId` → `{ parked: true }`                        |
| `sessions.unpark`       | `sessionId` → `{ resumed: true }`                       |
| `sessions.end`          | `sessionId`, `consolidate?`, `scope?`, `scopeId?`, `agentId?` |
| `sessions.policy.get`   | `sessionId` → `{ policy }`                              |
| `sessions.policy.set`   | `sessionId`, `policy` (strict/trusted/autopilot)        |
| `memory.store`          | `content`, `scope?`, `scopeId?`, `tags?`, `category?`   |
| `memory.recall`         | `query?`, `scope?`, `tags?`, `limit?` → `{ results[] }` |
| `memory.delete`         | `id` → `{ deleted: true }`                              |
| `memory.consolidate`    | `sessionId`, `scope?`, `dryRun?`                        |
| `beta.list` / `beta.enable` / `beta.disable` | `flag` (format `<feature>-YYYY-MM-DD`) |
| `usage.session`         | `sessionId` → `{ usage }`                               |
| `usage.global`          | `limit?` → `{ usage: { sessions[], total, byModel[] } }` |

Streaming routes emit intermediate `stream.event` envelopes followed by a
terminal `<type>.end` envelope:

| Type         | Payload fields                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `stream.run` | `prompt`, `provider?`, `model?`, `baseUrl?`, `apiKey?` → events `{type:"stream.event", event}`, end `{ok, text}` |
| `sessions.subscribe` | `events?:string[]` (default: all lifecycle) → events `{type:"stream.event", event:{type:"session.<lifecycle>", session}}`, end `{ok, unsubscribed:true, events}` |

Lifecycle values forwarded by `sessions.subscribe`: `created`, `adopted`,
`touched`, `idle`, `parked`, `resumed`, `closed`.

Cancel a streaming request by sending `{type:"cancel", id}` — the server
calls `AbortController.abort()` which detaches listeners (`sessions.subscribe`)
or aborts the in-flight fetch (`stream.run`).
