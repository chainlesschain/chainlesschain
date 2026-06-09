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

## Headless / Print Mode (`agent -p`)

Claude Code `claude -p` 对标:`cc agent` 的**单轮非交互**执行——进 CI / 管道 /
脚本。绕过交互 REPL,prompt 来自 `-p` 值 / 位置参数 / stdin 管道,跑完即退出
(agent 内部仍可多轮工具循环)。

```bash
chainlesschain agent -p "fix the bug in x.js"             # 单轮执行后退出
chainlesschain agent -p "review @src/x.js"                # 支持 @path 文件引用
echo "task" | chainlesschain agent -p                     # 从 stdin 读取任务
chainlesschain agent -p "..." --output-format json        # text(默认) | json | stream-json
chainlesschain agent -p "..." --max-turns 5               # 限制 agent 循环迭代上限
chainlesschain agent -p "..." --allowed-tools "read_file,git"     # 工具白名单
chainlesschain agent -p "..." --disallowed-tools "run_shell"      # 工具黑名单
chainlesschain agent -p "..." --permission-mode bypassPermissions # 见下表
chainlesschain agent -p "..." --add-dir ../lib            # 额外工作根 (可重复)
chainlesschain agent -p "..." --goal <id>                 # 绑定 cc goal,每轮对照推进 (见 Goal 节)
chainlesschain agent -p "..." --goal --goal-assess        # 自动选活跃目标 + 跑完自评进度
```

**输出格式**(`--output-format`):
- `text`(默认)——最终回答 → stdout;工具轨迹 → stderr(保证管道纯净)。
- `json`——单个结果信封 `{ type:"result", subtype, is_error, result, session_id,
  num_turns, duration_ms, tool_calls[], usage }`。
- `stream-json`——逐事件 NDJSON:首行 `{type:"system",subtype:"init",...}`,
  随后 `tool_use` / `tool_result` / `token_usage`,末行 `{type:"result",...}`。

**权限模式**(`--permission-mode`,映射 ApprovalGate 层级;headless 无法弹窗,
故默认 **fail-closed**):

| mode | 层级 | 行为 |
| ---- | ---- | ---- |
| (默认) | STRICT | 拒绝中/高危 shell(confirm 自动否决);文件编辑放行 |
| `plan` | STRICT | 同上,且**工具收窄为只读集**(read_file/search_files/list_dir/...) |
| `acceptEdits` | TRUSTED | 高危 shell 仍拒,中危放行 |
| `bypassPermissions` | AUTOPILOT | 全放行,不确认 |

退出码:成功 `0`;`--max-turns` 耗尽(`error_max_turns`)或错误 `1`。
会话恢复:`--resume <id>` / `--continue`(恢复最近一次)+ JSONL 持久化。

## Cost — 估算 $ 花费

在 `session usage`（token 计数）之上叠加价格层（`src/lib/llm-pricing.js`）。读取
同一份 JSONL `token_usage` 事件，所以无新数据采集——纯报表视图。

```bash
chainlesschain cost                        # 全局花费汇总 (按 provider/model 拆分)
chainlesschain cost <sessionId>            # 单会话花费
chainlesschain cost --json                 # 机器可读
chainlesschain cost --limit 500            # 全局汇总最多扫描的会话数
```

规则：
- 本地 provider（`ollama` / `local` / `llamacpp` / `mediapipe`）= **免费**（matched + free）。
- 未知模型 → **`unpriced`**（不臆测），其 token **排除**出 `cost.totalCost` 并在 `unpriced[]` 单列。
- 价格是公开 list 价的**估算**（USD / 1M tokens），内置覆盖 anthropic / openai /
  deepseek / volcengine(doubao)。

`--json` 输出形状（在 `session usage` 聚合上加 cost 字段）：

```jsonc
{
  "total":  { "inputTokens", "outputTokens", "totalTokens", "calls" },
  "byModel": [ { "provider", "model", "inputTokens", "outputTokens",
                 "cost", "currency": "USD", "matched", "free" } ],
  "cost":    { "totalCost", "currency": "USD", "unpricedCount" },
  "unpriced": [ { "provider", "model", "totalTokens" } ]
}
```

**配置价格覆盖**（无需改源码）——`config.llm.pricing`，同名 `match` 替换内置、
新 provider 追加、畸形条目跳过：

```jsonc
// .chainlesschain/config.json
{ "llm": { "pricing": {
  "openai":     [ { "match": "gpt-4o", "in": 2.5, "out": 10 } ],
  "myprovider": [ { "match": "custom", "in": 2,   "out": 8  } ]
} } }
```

## Checkpoint — 文件状态快照 / 回滚

Claude Code "rewind" 的 CLI 对标：有风险的 agent 运行前给文件拍快照，出问题再还原。
**区别于 `cc workflow checkpoint`**（后者是工作流**执行态**，存 DB，不是文件）。

**双引擎**（按 cwd 自动选）：
- **git-plumbing（默认，git 仓内）** `src/lib/checkpoint-store.js` — 整工作树快照，
  经**临时 index**（`GIT_INDEX_FILE`）写成 `refs/cc-checkpoints/<session>/<id>` 下的
  shadow commit，**捕获时不碰真 index / 工作区**；内容寻址（未改文件零成本）、遵守
  `.gitignore`；还原能准确处理 改/增（删除快照后新建的）/删（重建快照里被删的）。
- **copy-based（fallback，非 git 仓）** `src/lib/file-checkpoint.js` — 快照你指定的
  **显式路径**到 `~/.chainlesschain/checkpoints/<id>/<sha256>`。

```bash
# git 仓内：create 拍整工作树（不需路径）；非 git 仓：必须给 <paths...>
chainlesschain checkpoint create [paths...] [--label <l>]   # 快照
chainlesschain checkpoint list                              # 列出 (最新在前)
chainlesschain checkpoint show <id>                         # 清单（文件 + 字节数）
chainlesschain checkpoint show <id> --diff [--stat]         # 与当前对比 (git: patch/--stat;copy: 列表)
chainlesschain checkpoint restore <id> --dry-run            # 预览将变更的文件
chainlesschain checkpoint restore <id> --force              # 还原 (别名 rewind;非交互必须 --force)
chainlesschain checkpoint delete <id> [--force]             # 删一个快照 (别名 rm)
chainlesschain checkpoint clear [--force]                   # 删整个 session 的快照
```

公共选项：`-d, --dir <dir>`（目标目录，默认 `.`）、`-s, --session <id>`（git 引擎的
ref 命名空间，默认 `default`）、`--json`。

语义与安全：
- `restore` **有破坏性**（覆盖当前文件）：非 TTY 无 `--force` 拒绝执行；TTY 弹确认。
- 还原前**自动给当前态拍 safety checkpoint** → 回滚本身可再回滚
  (`cc checkpoint restore <safetyId>`)。
- git 引擎按 `-s/--session` 分组；copy 引擎不分 session。
- copy 引擎跳过 `node_modules`/`.git`/`dist`/`build`/`.chainlesschain` 等重目录，
  `maxFiles` 默认 2000 防误快照整盘。

### 自动快照（agent 工具循环）

`cc agent --checkpoint`（git 仓内）在**每个会改文件的工具调用前**自动快照工作树，
出问题用 `cc checkpoint restore <id>` 回滚到该工具调用之前：

```bash
cc agent --checkpoint -p "重构 auth 模块"
#   每个 write_file/edit_file/run_shell/run_code 前打印  ⎌ checkpoint cpNNNN (before <tool>)
cc checkpoint list
cc checkpoint restore cp0003           # 回到第 3 个工具调用之前（先自动拍 safety）
```

- 只读工具（`read_file`/`search_files`/`list_dir`/`list_skills`/`search_sessions`）跳过。
- 快照落在 `refs/cc-checkpoints/<agent-sessionId>/`；连续工具未改文件时去重（不堆冗余 ref）。
- best-effort：快照失败绝不阻塞工具；非 git 仓静默 no-op。
- stream-json 输出对应事件：`{ "type":"checkpoint", "id":"cpNNNN", "tool":"write_file" }`。

## Goal — 跨会话持久目标 / OKR

`cc goal` 是**超出 Claude Code 的扩展**(Claude Code 无对应):一个长期目标,agent
跨多个会话朝它推进,每轮把目标注入到 agent 循环里对照。**区别于**:`cc session`
(短期上下文)、`cc memory`(事实)、`cc planmode`(单次运行的计划)、`cc workflow`
(执行态)。落盘在 `~/.chainlesschain/goals/<id>.json`(home 目录 → 天然跨会话)。

分三个 Phase 落地(`src/lib/goal-store.js` / `goal-context.js` / `goal-assess.js`):

### Phase 0 — 存储 + 命令

```bash
chainlesschain goal set "上线 v2 API" --kr "写完测试" --kr "迁移文档"  # 建目标 (+关键结果)
chainlesschain goal list [--status active] [--json]          # 列出 (含 >14 天无进展的 ⚠ stale 提示)
chainlesschain goal show <id>                                # 详情
chainlesschain goal kr add <id> "新 KR" --target 5           # 加关键结果 (可设数值目标)
chainlesschain goal kr set <id> <krId> --current 5           # current≥target 自动标 done
chainlesschain goal progress <id> --pct 60 --note "过半"      # 手动记进度
chainlesschain goal link <id> [sessionId]                    # 把会话挂到目标 (省略=最近会话)
chainlesschain goal pause|resume|close|abandon <id>          # 生命周期
chainlesschain goal active [--session <id>]                  # 看哪个目标会绑定到运行
chainlesschain goal rm <id> [--force]                        # 删除
```

进度自动从「已完成 KR / 总 KR」推导;手动 `--pct` 可覆盖。`done` 时进度补到 100%。

### Phase 1 — 注入 headless 运行(`--goal`)

`cc agent` 把解析到的活跃目标注入到 agent 循环,**每轮**追加一段简短的目标提醒
(目标 + 未完成 KR + 进度%),不污染会话历史(经 `prepareCall` 临时 system 补充,
**与默认 turn-context 合成而非替换**)。

```bash
chainlesschain agent -p "继续推进" --goal <id>      # 显式绑定某目标
chainlesschain agent -p "继续推进" --goal           # 不带值=自动解析活跃目标
```

**解析优先级**(`resolveActiveGoal`):① 显式 `--goal <id>`(任意状态)> ② 挂到当前
会话的活跃目标 > ③ 唯一一个活跃目标 > ④ 无(多个活跃且未挂会话时返回空,需显式指定)。
显式 `--goal <id>` 还会把会话 link 到目标,使后续 `--continue`/`--resume` 仍带该目标。
`stream-json` 的 init 信封含 `goal_id`。best-effort:绑定失败绝不影响运行。

### Phase 2 — 跑完自评进度(`--goal-assess`,opt-in)

`--goal-assess` 在一次 `--goal` 运行结束后,**额外**让模型从运行轨迹(任务 + 最终回答
+ 用到的工具)判断目标是否推进,并把结果落盘:进度、关键结果 current/done、一条
agent 署名的进度 note、以及 drift 标记。**因为多花一次 completion 所以默认关闭**。

```bash
chainlesschain agent -p "实现登录接口" --goal <id> --goal-assess
#   跑完后:◎ goal <id>: advanced (45%)   ← 自动写回目标
chainlesschain goal show <id>            # 能看到 agent 署名的进度 note + KR 更新
```

- 解析宽容:模型把 JSON 裹在散文 / ``` 代码围栏里也能提取(取首个配平 `{...}`)。
- 每个子更新独立 try/catch:坏的 KR id 不会连累进度 note 落盘。
- drift:本次运行未推进 → 记 `no-progress` 标记;模型给的 concerns 一并记入。
- `stream-json` 输出 `{ "type":"goal_assessment", "goal_id", "advanced", "progress", "note" }`。
- best-effort:自评失败绝不改变运行本身的退出码 / 结果。

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
