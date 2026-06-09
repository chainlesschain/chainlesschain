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
chainlesschain agent -p "..." --output-format stream-json --include-partial-messages  # 逐 token 增量 (见下)
chainlesschain agent -p "..." --mcp-config ./mcp.json     # 临时挂载 MCP server (见 MCP 节)
chainlesschain agent -p "..." --no-mcp                    # 不自动连 cc mcp add --auto-connect 的服务
chainlesschain agent -p "..." --mcp-config ./m.json --permission-prompt-tool mcp__auth__approve  # 审批交 MCP 工具
chainlesschain agent -p "..." --settings ./run.json       # 一次性 settings:权限 + model/env 覆盖 (见 Permissions)
chainlesschain agent -p "..." --input-format stream-json  # 持续从 stdin 喂多轮 NDJSON 用户事件
```

**输出格式**(`--output-format`):
- `text`(默认)——最终回答 → stdout;工具轨迹 → stderr(保证管道纯净)。
- `json`——单个结果信封 `{ type:"result", subtype, is_error, result, session_id,
  num_turns, duration_ms, tool_calls[], usage }`。
- `stream-json`——逐事件 NDJSON:首行 `{type:"system",subtype:"init",...}`,
  随后 `tool_use` / `tool_result` / `token_usage`,末行 `{type:"result",...}`。

**逐 token 增量**(`--include-partial-messages`,仅 `--output-format stream-json`):
在常规事件之外额外 emit `{type:"stream_event",event:{type:"content_block_delta",
delta:{type:"text_delta",text}}}`——assistant 文本实时流出,适合转发 UI。真增量目前
对 **ollama**(本地默认)+ **anthropic / OpenAI 兼容**(openai/deepseek/dashscope/
mistral/gemini/volcengine)全部生效(含流式 tool-call 重组);其它 provider 静默退回整段。

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

## Compaction — 上下文自动压缩 + `cc compact`

Claude Code `/compact` 对标。长会话(尤其 `--resume`)的消息历史会一直增长直到撞
provider 的 context window。两条路:**运行中自动压缩**(headless 默认开)+ **手动压缩
存档会话**(`cc compact`)。引擎是现成的 `PromptCompressor`(snip+dedup+collapse+
truncate),**离线确定性**(不接 LLM 摘要,无网络调用)。`0.162.33+` 出。

### 运行中自动压缩(`agent -p` / `--resume`)

`agentLoop` 在每轮迭代顶部(LLM 调用**之前**、工具对完整的干净边界)检查历史是否超过
压缩器阈值,超了就就地压缩。

- **默认开**,由 `PROMPT_COMPRESSOR` 开关 + 大小阈值(按 `--model`/`--provider` 的
  context window 自适应)守门——只对真正大的上下文触发。
- **退出**:`options.autoCompact === false`。交互式 REPL 走这条(它按自己的节奏压缩)。
- **工具对安全**:截断 / snip 绝不会留下孤儿 `tool` 结果或无应答的 `tool_calls`
  (`compress(msgs, { preserveToolPairs:true })` → `sanitizeToolPairs()` 修复配对),
  否则严格 API 会 400。
- **`--resume` 持久化**:压缩后**自动写一条 `compact` 事件**到 JSONL 会话,下次
  `--resume` 直接从压缩后的短历史重建。**仅当会话已落盘**(session 文件存在)才写——
  一次性 `cc agent -p`(不建会话文件)什么都不写。
- `stream-json` 输出 `{ "type":"compaction", "stats":{ strategy, originalMessages,
  compressedMessages, originalTokens, compressedTokens, saved, ratio }, runId }`;
  `text` 态打印 `⊟ compacted context: 54→6 msgs (saved 879 tokens, dedup)`;`json`
  态只出最终 result 信封,看不到中间事件。

```bash
# 长会话续跑——历史超阈值时本轮自动压缩并写 compact 事件,LLM 拿到的是压缩后上下文
chainlesschain agent -p "继续" --resume <id> --output-format stream-json
#   → ...{"type":"compaction","stats":{"strategy":"dedup","originalMessages":54,
#         "compressedMessages":6,"saved":879,...}}...
```

### `cc compact <session-id>` — 手动压缩存档会话

不进 REPL 直接压缩一个已存会话(脚本化 / resume 前预压缩 / 批量维护)。重建会话 →
跑压缩器 → 追加 `compact` 事件;`rebuildMessages()` 认最后一条 compact 事件,所以之后
`cc agent --resume <id>` 自动拿短历史。

```bash
chainlesschain compact <session-id>                 # 压缩并持久化
chainlesschain compact <session-id> --dry-run       # 只预览缩减量,不写
chainlesschain compact <session-id> --json          # 机读
chainlesschain compact <session-id> --model <m> --provider <p>   # 自适应阈值按指定模型
chainlesschain compact <session-id> --max-tokens <n> --max-messages <n>  # 硬阈值覆盖
```

- 默认按会话**记录的** model/provider 给压缩器定 context-window 阈值;`--model`/
  `--provider` 或硬 `--max-tokens`/`--max-messages` 覆盖。
- 历史已在阈值内 → 报 `Nothing to compact` 且**不写**任何事件。
- 区别于 `cc checkpoint`(文件状态)与 `cc workflow checkpoint`(执行状态)。

## MCP — 把工具喂给 agent 循环

两条路把 MCP server 的工具暴露给 LLM,工具名统一 `mcp__<server>__<tool>`,经 agent-core
默认分派走 `mcpClient.callTool()`。**headless + 交互** 都支持,二者合并进**同一个 client**
(同名时 ad-hoc 优先)。

```bash
# 1) 临时(ad-hoc):一次性从 JSON 文件挂载 —— Claude Code --mcp-config 对标
chainlesschain agent -p "纽约天气?" --mcp-config ./mcp.json
#   mcp.json 形如 { "mcpServers": { "weather": { "command": "npx",
#                     "args": ["-y","@modelcontextprotocol/server-weather"] } } }

# 2) 注册(持久):cc mcp add --auto-connect 的 server 每次 cc agent 自动连
chainlesschain mcp add weather -c npx -a "-y,@modelcontextprotocol/server-weather" --auto-connect
chainlesschain agent -p "纽约天气?"            # weather 工具自动可用
chainlesschain agent -p "..." --no-mcp          # 跳过注册的自动连接(--mcp-config 仍生效)
```

**`--permission-prompt-tool <mcp__server__tool>`**(需配 `--mcp-config`):headless 默认对中/高危
工具 fail-closed,本旗标把每个 CONFIRM 档审批交给一个 MCP 工具裁决——它收 `{tool_name, input}`,
返回 `{behavior:"allow"|"deny"}`(任何非 allow / 出错都 fail-closed)。

## Subagents — `cc agents` + spawn_sub_agent 委派

`.chainlesschain/agents/*.md`(原生,优先)或 `.claude/agents/*.md`(Claude Code 可移植)
定义命名子代理:**正文 = system prompt**,frontmatter 声明 `description` / `tools`(白名单)/ `model`。
`review/security.md` → 子代理 `review:security`。

```bash
chainlesschain agents list                                  # 列出发现的子代理
chainlesschain agents show review:security [--json]         # 看元数据 + system prompt
chainlesschain agents run review:security "审计这个 diff"   # 以该子代理身份单轮 headless 跑
chainlesschain agents new reviewer --tools "read_file,search_files"   # 脚手架(默认 .chainlesschain/,--claude 落 .claude/)
```

`cc agents run` 把子代理(正文=system prompt + frontmatter tools/model)映射到 `runAgentHeadless`,
所以一份 Claude Code agent 定义可原样跑。

**主 agent 主动委派**:agent 循环里的 `spawn_sub_agent` 工具新增 `agent` 参数——传子代理名即
加载它的 system prompt + 工具白名单 + `model:`(子代理继承父的 provider/key,只覆盖 model);
显式 `role`/`tools` 仍优先;给了 `agent` 时 `role` 可省。

## Context — `cc context` 上下文窗口占用

Claude Code `/context` 对标:看某存档会话把模型上下文窗口占了多少,按角色拆分。

```bash
chainlesschain context [<sessionId>]            # 省略=最近一次 headless 会话
chainlesschain context <id> --json
chainlesschain context <id> --model claude-sonnet-4-6   # 按指定窗口估
```

按 system / user / assistant / tool(含 tool_calls)分桶给 token 数 + 占比 + 剩余余量;
默认从会话 `session_start` 头自动识别 model/provider(`--model`/`--provider` 覆盖)。复用自动压缩
的 token 估算器 + 窗口表,不采新数据。补足 `cc cost`($)+ `cc session usage`(裸 token 数)。

## Permissions — `.claude/settings.json` 规则 (allow / ask / deny)

Claude Code `permissions.{allow,ask,deny}` 对标。给 `cc agent`(headless + 交互
REPL)加一层**用户可编辑的 glob 规则**网关:在工具真正执行前,按规则 `deny` 硬拦 /
`ask` 要确认 / `allow` 预授权。无 settings.json 时行为**逐字不变**(回落到既有的
risk-tier / ApprovalGate / plan-mode 逻辑)。引擎零依赖(自写 glob→regex)。

### 规则语法 `Tool(pattern)`

裸 `Tool` 匹配该工具的所有调用;`Tool(pattern)` 按工具类型匹配实参。工具名两种写法
都吃——Claude-Code 伞名或本 CLI 原名(双向别名):

| 伞名 | 本 CLI 工具 | `pattern` 匹配对象 | 例 |
| ---- | ----------- | ------------------ | -- |
| `Bash` | `run_shell` | 命令字符串 | `Bash(git push:*)`、`Bash(npm run test:*)` |
| `Read` | `read_file` / `list_dir` | 解析后的绝对路径 | `Read(./src/**)` |
| `Edit` | `edit_file` / `edit_file_hashed` | 路径 | `Edit(//etc/**)`(`//`=绝对) |
| `Write` | `write_file` | 路径 | `Write(./build/**)` |
| `WebFetch` | `web_fetch` | URL host | `WebFetch(domain:example.com)` |
| `Task` | `spawn_sub_agent` | — | `Task` |

- **命令**:`prefix:*` 前缀语义(`Bash(git push:*)` 命中 `git push` 及其后任意参数);
  纯 `*` 当 glob;无 `*` 则精确匹配。
- **路径**:`./x` 相对 cwd、`//abs` 绝对、`~/x` home;`*` 不跨 `/`、`**` 跨。
- 未知工具名(如 MCP `mcp__srv__do`)按精确名匹配。

### 文件层级与合并

按优先级**并集**合并(高层只增规则,`deny` 永不被稀释);坏 JSON **fail-open**(告警跳过,
绝不让 agent 卡死):

```
~/.claude/settings.json            # user(所有项目)
<project>/.claude/settings.json    # project(签入)
<project>/.claude/settings.local.json   # 个人覆盖(gitignored)
--settings <file>                  # cc agent 显式传入
CC_PERMISSIONS_ALLOW / _ASK / _DENY      # env kill-switch(逗号分隔)
```

### 判定顺序(most-restrictive-wins,denies 先于任何 prompt)

1. **settings `deny`** → 拦。
2. **host policy `deny`**(`hostManagedToolPolicy`,桌面运行时同步,CLI 通常无)→ 拦。
   settings `allow` **永不** relax host deny;settings `deny` 盖 host `allow` → **任一 deny 即拦**。
3. **settings `ask`** → 确认。**在两个 deny 之后**才到——host-denied 工具不会白白弹一次
   确认。headless 无确认器 → fail-closed。
4. **settings `allow`** → 预授权:短路 plan-mode 拦截 + `run_shell` 的 ApprovalGate 档位
   确认。**安全不变量**:`allow` 不会重开 shell 硬黑名单(`curl`/`rm` 等仍被
   shell-policy 拦)。

### `cc agent --settings`

`--settings <file>` 合并一份 `.claude/settings.json` 形状的文件,作用于本次运行。
除权限规则外,还能做**原生配置覆盖**(`model` + `env`),无需改 `.chainlesschain/config.json`:

```bash
chainlesschain agent -p "跑测试" --settings ci-perms.json
#   ci-perms.json 形如 { "permissions": { "allow": ["Bash(npm run test:*)"],
#                                          "deny": ["Bash(rm:*)"] } }
chainlesschain agent -p "大重构" --settings run.json
#   run.json 形如 { "model": "claude-opus-4-8",
#                   "env": { "OLLAMA_HOST": "http://gpu-box:11434" } }
```

- **`model`**:填本次运行模型——仅当未显式给 `--model` 时生效(`--model` 优先)。
- **`env`**:逐 key 设进 `process.env`,agent 循环 + 子进程工具都继承。
- 优先级与权限一致:`~/.claude` < 项目 `.claude` < `.local` < `--settings` 文件(后者覆盖前者,
  `env` 逐 key 合并)。`--permission-mode` 仍叠加在权限规则**之后**(规则未命中才看档位)。

### `cc permissions` — 查看 / 干跑 / 编辑

```bash
chainlesschain permissions list [--json]                    # 合并后规则集 + 每条来源文件
chainlesschain permissions test run_shell "git push origin main"   # 干跑:命中哪条规则→什么判定
chainlesschain permissions test read_file src/app.js --json
chainlesschain permissions add deny "Bash(rm:*)"            # 追加规则(默认 project)
chainlesschain permissions add allow "Read(./**)" --local   # → settings.local.json(个人)
chainlesschain permissions add allow "Read" --user          # → ~/.claude/settings.json
```

- `test` 是调规则的杀手锏——执行前看清某调用会被哪条规则、哪个文件决定(`fallthrough`=
  无规则命中,回落档位逻辑)。伞名 `Bash` 会解析成具体工具 `run_shell`。
- `perm` 已被 RBAC Permission Engine V2 占用,故权限规则命令用全名 `permissions`。

### 交互式 "always allow"(REPL)

REPL 里 `run_shell` 撞 ApprovalGate 风险确认时,提示是 **`[y]es once / [a]lways allow /
[N]o`**。选 `[a]`:从该调用推导一条规则(`git push origin main` → `Bash(git push:*)`),
写入 `.claude/settings.local.json` 并即时更新内存规则集 → **本/未来 session 不再问**(经
上面的 `allow` 短路)。显式 `ask` 规则保持 y/N(asking 是声明意图;且 deny>ask>allow 下
allow 也盖不过 ask)。

## Hooks — `.claude/settings.json` `hooks` 块 (Claude-Code 协议)

Claude Code hooks 对标。两个来源,职责不同:

- **DB hooks**(`cc hook add` → SQLite)—— **observe-only**,触发即记录,不参与决策(行为不变)。
- **`.claude/settings.json` `hooks` 块** —— **决策型**:走 stdin-JSON + 退出码/JSON-stdout 协议,可**拦截**工具调用。本节讲后者。

### Schema

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "./guard.sh", "timeout": 60 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "./fmt.sh" } ] }
    ]
  }
}
```

- `matcher`:工具名匹配,支持精确 / `Edit|Write` 管道 / `*` 通配 / `/regex/`。对**伞名**(`Bash`)和**本 CLI 原名**(`run_shell`)都测——两种写法都命中。
- hooks 数组**跨层级拼接**(user < project < .local < `--settings`),有序、不去重。
- `timeout` 秒(默认 60)。

### 协议(命令 hook)

事件 payload 以 **JSON 写入命令 stdin**(`{ hook_event_name, tool_name, tool_input, cwd, session_id }`)。判定:

| hook 返回 | 含义 |
| --------- | ---- |
| **exit 2** | **block**(reason = stderr)——标准"拒绝"路径 |
| exit 0 + stdout `{"decision":"block"\|"approve"\|"ask","reason"}` | 按之 |
| exit 0 + `{"hookSpecificOutput":{"permissionDecision":"deny"\|"allow"\|"ask"}}` | PreToolUse 专用 |
| exit 0 + `{"continue":false,"stopReason"}` | block |
| exit 0(无 JSON)| continue(放行;stdout 可作 `additionalContext`)|
| 其它非零 / spawn 失败 / 超时 | **非阻塞**(surface,不拦——坏 hook 不卡 agent)|

多个命中的 hook 按序跑,**首个 block/ask 短路**。

### `cc hook test` — 干跑

```bash
chainlesschain hook test PreToolUse run_shell "git push origin main"   # 列出会触发的 hook(不执行)
chainlesschain hook test PreToolUse run_shell "git push" --run         # 真执行 + 显示 decision/reason/exit
chainlesschain hook test PreToolUse write_file "x" --json
chainlesschain hook list                                                # DB hooks + settings.json hooks(标来源)
```

默认**只列命中**(安全,不执行用户脚本);`--run` 才真跑并显示判定。是调 hook 的杀手锏。

### 已接入的事件(在 `cc agent` 真实执行中强制)

| 事件 | 触发点 | 能力 |
| ---- | ------ | ---- |
| **PreToolUse** | 每个工具调用前(权限解析之后) | `block`→拦工具 / `ask`→确认 / context |
| **PostToolUse** | 工具跑完后 | `block` 的 reason 作 `hookFeedback` 回喂模型 |
| **UserPromptSubmit** | 每轮用户 prompt 提交前(headless + REPL) | `block`→中止本轮 / 非 block stdout(JSON `additionalContext` 或纯文本)→注入为上下文 |
| **SessionStart** | 会话起点(headless + REPL) | 非 block stdout → 注入为一条 `system` 上下文消息(observe-only,无 block);`source`=startup/resume 即 matcher 目标 |

UserPromptSubmit payload:`{ hook_event_name, prompt, cwd, session_id }`;block 在 headless 退出码 `2`、在 REPL 跳过本轮。SessionStart payload:`{ hook_event_name, source, cwd, session_id }`。settings/host `deny`(权限规则)先于 hook 短路,被拒的工具调用不会 spawn hook 进程。

> **剩余事件**:`SessionEnd` / `Stop` / `PreCompact` —— loader 与 dispatcher(`settings-hook-events.cjs` 的 `runObserveHooks`)已支持,但还未接到各自的 seam(agentLoop 收尾 / 会话结束 / 压缩前)。

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
