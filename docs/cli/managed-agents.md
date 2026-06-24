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
chainlesschain agent -p "..." --think                     # Anthropic 扩展思考 (见下「扩展思考」)
chainlesschain agent -p "..." --ultrathink                # = --think ultra (最高强度)
chainlesschain agent -p "..." --think --thinking-budget 8000  # legacy Claude 的思考 token 预算
chainlesschain agent --image shot.png -p "这张图里是什么?"     # 多模态 / 图像输入 (可重复 --image,见下)
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

| mode                | 层级      | 行为                                                             |
| ------------------- | --------- | ---------------------------------------------------------------- |
| (默认)              | STRICT    | 拒绝中/高危 shell(confirm 自动否决);文件编辑放行                 |
| `plan`              | STRICT    | 同上,且**工具收窄为只读集**(read_file/search_files/list_dir/...) |
| `acceptEdits`       | TRUSTED   | 高危 shell 仍拒,中危放行                                         |
| `bypassPermissions` | AUTOPILOT | 全放行,不确认                                                    |

退出码:成功 `0`;`--max-turns` 耗尽(`error_max_turns`)或错误 `1`。
会话恢复:`--resume <id>` / `--continue`(恢复最近一次)+ JSONL 持久化。

**`--fork-session`**(配 `--resume`/`--continue`):把被恢复的会话**分叉成一个新 id**,原
transcript 原封不动保留,本轮起所有新 turn 写进分叉副本(Claude-Code `--fork-session` 对标)。
分叉副本带完整历史 + 一条 `[Forked from session <id>]` 标记,故 `--resume <新id>` 能端到端重放
整条分支。stderr 打印 `Forked session <id> → <新id>`。一个 chokepoint 覆盖 headless / stream-json /
交互三入口(都读 `options.session`);仅对 JSONL transcript 有效,源会话无落盘记录时打印提示并继续
原会话(不分叉)。无 `--resume` 时为静默 no-op(新跑本身就是新会话)。

```bash
chainlesschain agent -p "走另一种方案" --resume <id> --fork-session   # 不污染原会话,开新分支
```

### 扩展思考(`--think` / `--ultrathink` / `--thinking-budget`)

Anthropic extended thinking 的 opt-in 开关(其它 provider 自动忽略;o-series /
DeepSeek-reasoner 由模型自身决定)。强度从 `--think` 的可选值取:

- `--think`(裸用)→ 默认强度;`--think hard` / `--think ultra` 指定强度;`--ultrathink` = `--think ultra`。
- **自适应思考模型**(Opus 4.6/4.7/4.8、Sonnet 4.6)→ 走 `output_config.effort`(`--think` 的强度映射成 effort)。
- **legacy 思考模型**(Sonnet 4.5、Opus 4.0–4.5 及更早)→ 走 `enabled + budget_tokens`;`--thinking-budget <n>` 设预算(clamp 到 `max_tokens` 之下)。自适应模型忽略 `--thinking-budget`。
- 思考决策是单一真相源(agent-core `_anthropicThinkingParams`),按 model 自动选自适应 / legacy / 关闭(如 Haiku)。

### 多模态 / 图像输入(`--image <path>`)

给视觉模型附图(headless;可重复 `--image` 传多张):

```bash
chainlesschain agent --image a.png --image b.jpg -p "对比这两张图" --provider volcengine --model doubao-seed-1-6-251015
```

- 支持扩展名:`png` / `jpg` / `jpeg` / `gif` / `webp`;不支持的扩展名会**立刻报错**而非发出坏请求。
- 内部统一成 OpenAI 形状的多模态消息(`image_url` data-URL),再按 provider 转换:
  **OpenAI 兼容**(volcengine/doubao、openai、…)原样透传;**ollama** 转成 `{content, images:[base64]}`;
  **anthropic** 转成 `image` content block(base64 source)。纯文本运行的请求形状**字节不变**。
- 仅 headless 路径生效(`-p` / 位置参数 / stdin 管道);交互会话传 `--image` 会被忽略并给出提示。

### 自动识别消息里的图片路径(Claude-Code 平价)

除了显式 `--image`,**消息里直接写一个本地图片路径**就会被自动当成视觉输入读图(和 Claude Code 一致),无需任何参数:

```bash
echo "描述这张图 ./shot.png" | chainlesschain agent --input-format stream-json --output-format stream-json
# 交互 REPL 里同理:直接打 "描述 C:\Users\me\shot.png"
```

- **生效范围**:headless stream-json 输入、交互 REPL,以及 **VS Code / JetBrains 聊天面板**(面板就是经 `cc agent --input-format stream-json` 驱动,因此零改插件即生效)。
- **识别规则**:只把**磁盘上真实存在**且扩展名受支持(`png/jpg/jpeg/gif/webp`)的 token 当图片;识别后把路径文本从消息里剥掉。不存在的路径、不支持的扩展名、`http(s)://` / `data:` 远程地址都**不会**被附图。
- **路径形式**:`C:\Users\…`、`C:/Users/…`、Git-Bash 形 `/c/Users/…`、`~/…`、以及 IDE 拖拽给的 `file:///C:/Users/…`(含 `%20` 转义)都能识别。
- **自动切视觉模型**:命中图片的回合会**切到视觉模型**(`config.llm.visionModel`,未配则用内置默认 `doubao-seed-2-0-lite-260215`;只换模型,provider/key/baseUrl 不变),stderr 打印 `[image] N attached → vision model X`。
- **开关**:`CC_AUTO_IMAGE=0` 关闭自动识别(仍可用显式 `--image` / 粘贴)。

> 配套:面板里 **Ctrl/Cmd+V 粘贴截图**走的是另一条(粘贴真图数据)路径;视觉模型可在 `cc config set llm.visionModel <model>` 或编辑器的「配置图片识别模型」入口里改。

### 备用模型链(`--fallback-model`)

无人值守运行时,当主模型调用失败就按顺序切到备用模型重试(Claude-Code 2.1.166/2.1.152 平价):

```bash
# 可重复传,或逗号分隔;最多 3 个,按序尝试
chainlesschain agent -p "..." --fallback-model backup-a --fallback-model backup-b
chainlesschain agent -p "..." --fallback-model "backup-a,backup-b,backup-c"
```

- **触发条件**:① 瞬时错误(overload / rate-limit / 5xx / 网络抖动 `isRetryableModelError`);② **主模型 not-found**(404 / "model not found" / "unknown model" / "does not exist" `isModelNotFoundError`)——配置的模型 id 被下线或拼错时也能自动切。普通 4xx(认证 / 配额 / 坏请求)**不**重试,直接抛出。
- **同 provider**:每跳只换 `model`,保留 provider / baseUrl / apiKey(跨 provider fallback 是更大的特性,未做)。
- **链式**:主 → 备1 → 备2 → 备3,逐个尝试直到成功或链耗尽(抛最后一个错误)。与刚试过的模型相同的备用项会被跳过(不浪费一次往返)。
- **默认链**:不传 flag 时读 `config.llm.fallbackModels`(数组或逗号串)/ 旧式 `config.llm.fallbackModel`(单个),无人值守运行无需带 flag。flag 永远优先于 config。
- **交互 REPL 也生效**:会话内 LLM 调用失败时同样按链重试,黄字提示每一跳。
- 实现:纯模块 `src/runtime/fallback-model.js`(挂在 agentLoop 的 `options.chatFn` seam 上,runner 零改动);提示走 stderr 保持 stdout 干净。

## Cost — 估算 $ 花费

在 `session usage`（token 计数）之上叠加价格层（`src/lib/llm-pricing.js`）。读取
同一份 JSONL `token_usage` 事件，所以无新数据采集——纯报表视图。

```bash
chainlesschain cost                        # 全局花费汇总 (按 provider/model 拆分)
chainlesschain cost <sessionId>            # 单会话花费
chainlesschain cost --json                 # 机器可读
chainlesschain cost --limit 500            # 全局汇总最多扫描的会话数
```

**交互 REPL `/cost`**（Claude-Code 平价）：在 `chainlesschain agent` 会话里输入 `/cost` 看**本会话至今**的 token 花费 + 估算 $（按 provider/model 拆分）。与 `cc cost` 复用同一 `llm-pricing` 价格表 + `config.llm.pricing` 覆盖,但**内存累计**每轮 usage——不依赖会话持久化,匿名会话也能用。

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
{
  "llm": {
    "pricing": {
      "openai": [{ "match": "gpt-4o", "in": 2.5, "out": 10 }],
      "myprovider": [{ "match": "custom", "in": 2, "out": 8 }],
    },
  },
}
```

## 流式韧性与 Prompt 缓存(`cc agent` + `cc chat`/`cc ask` 一致)

两套流式实现(agent-core 给 `cc agent`、chat-core 给 `cc chat`/`cc ask`)在以下维度行为一致;可重试分类器走共享 `src/lib/stream-retry.js`(单一真相源)。

**流式韧性**(API 接受连接后中途静默 / 瞬态断流):

| 行为 | 阈值(默认) | 调节 |
|---|---|---|
| 静默提示 "⏳ waiting for API response"(stderr,不中断) | 20s | agent:无单独 env(常量 `STREAM_STALL_MS`);chat:`CC_CHAT_STALL_HINT_MS` |
| 硬不活动超时 → 取消 + **重试**(retryable 错) | 180s | agent:`config.llm.streamStallTimeoutMs`(0=关);chat:`CC_CHAT_STALL_MS` |
| 瞬态连接 drop 自动重试(ECONNRESET / fetch failed / socket hangup 等) | 最多 2 次 | — |

- **重试只在“零 token 已输出”时发生**——一旦有 token 流到用户,再发会重复可见输出,故改为保留 partial(agent)/原样抛(chat)。HTTP/auth 错(4xx/5xx)与 180s stall abort **不**重试。
- 180s 硬超时对慢首 token 的本地模型足够宽松;云端 provider 长时间静默≈死连接,自动重发恢复。

**Anthropic Prompt 缓存**(`cc agent`,默认开):system prompt + ~18 个工具 schema 是每轮重发的大而稳定前缀。cc 给最后一个 tool + system 块各打一个 `cache_control:{type:"ephemeral"}` 断点 → Anthropic 从缓存供该前缀(≈10% input 成本、更低延迟)。前缀低于模型最小可缓存尺寸时 Anthropic 自动忽略,**永远安全**。

- **关闭**:`CC_PROMPT_CACHE=0`(env)或 `options.promptCaching:false`(给会拒该字段的自定义 anthropic 兼容网关)。关闭时请求字节级回到原样。

**缓存 token 成本核算**(`cc cost` / `cc session usage` / `/cost`):Anthropic(`cache_read_input_tokens`/`cache_creation_input_tokens`)与 OpenAI-兼容 provider(OpenAI/volcengine 的 `prompt_tokens_details.cached_tokens`、DeepSeek 的 `prompt_cache_hit_tokens`,均**含在** `prompt_tokens` 内 → 拆出避免重复计价)的缓存 token 被单独捕获并按各 provider 缓存读倍率计价(Anthropic ≈0.1×、OpenAI ≈0.5×、DeepSeek ≈0.25×;写 ≈1.25× 仅 Anthropic)。无缓存时与旧行为字节级一致。

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

**git 仓内默认开启**（Claude-Code 同款默认；shadow-commit 引擎零触工作区/真索引）：
在**每个会改文件的工具调用前**自动快照工作树，出问题用 `cc checkpoint restore <id>`
回滚到该工具调用之前。`--no-checkpoint` 关闭；非 git 目录默认关（copy 引擎写真实文件,
不做静默默认），显式 `--checkpoint` 可强制开：

```bash
cc agent -p "重构 auth 模块"                 # git 仓内默认就有自动快照
cc agent --no-checkpoint -p "..."           # 本次关闭
cc agent --checkpoint -p "..."              # 非 git 目录强制开（copy 引擎）
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

`--goal-assess` 在一次 `--goal` 运行结束后,**额外**让模型从运行轨迹(任务 + 最终回答 + 用到的工具)判断目标是否推进,并把结果落盘:进度、关键结果 current/done、一条 agent 署名的进度 note、以及 drift 标记。**因为多花一次 completion 所以默认关闭**。

```bash
chainlesschain agent -p "实现登录接口" --goal <id> --goal-assess
#   跑完后:◎ goal <id>: advanced (45%)   ← 自动写回目标
chainlesschain goal show <id>            # 能看到 agent 署名的进度 note + KR 更新
```

- 解析宽容:模型把 JSON 裹在散文 / ```代码围栏里也能提取(取首个配平`{...}`)。
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

## Loop — 定时重复跑一条命令 / agent prompt

`cc loop` 把**一件事**按固定间隔重复跑,直到停止条件命中或 Ctrl-C(Claude-Code `/loop`
对标)。比 `cc ccron`(只在内存里治理 profile 状态机,**不真正执行**)和 `cc automation`
(DB 持久的 flow/trigger 引擎)都轻——只是给一条命令套个计时器。

```bash
# 两种模式,用字面 `--` 分隔符区分:
chainlesschain loop "检查 CI 是否通过,失败就总结原因"     # 无 `--` → prompt,内部跑 `cc agent -p`
chainlesschain loop --every 30s -- npm test               # 有 `--` → 外部命令(shell 解析,Win 的 npm.cmd 也能跑)
chainlesschain loop --every 1m --max-iterations 10 -- npm test
chainlesschain loop --every 30s --until-exit-zero -- npm test   # 测试一过就停
chainlesschain loop --every 1m --until "DONE" "轮询部署状态"     # 输出匹配正则就停
chainlesschain loop --json --every 5m -- npm test         # 结束打印 JSON 汇总
```

- **间隔** `--every <dur>`:`30s` / `5m` / `1.5h` / `500ms`;裸数字按**秒**算(`--every 30` === `30s`)。
- **停止条件**(每轮跑完后判定,所以至少跑一次):`--max-iterations N` / `--until-exit-zero`
  (某轮退出码 0 就停)/ `--until <regex>`(某轮输出匹配 JS 正则就停)/ Ctrl-C(优雅停——
  跑完当前轮、杀掉子进程)。退出码镜像最后一轮。
- 轮间 sleep,**最后一轮后不 sleep**;`--until` 会捕获并 tee 子进程输出(既给你看实时输出,
  又能匹配)。

### Prompt 模式的 flag 透传

prompt 模式下,**首个 `-…` 形 token 之前**的操作数当 prompt,**从首个 `-…` 起**的全部
原样转发给 `cc agent`:

```bash
chainlesschain loop "review the diff" --think --provider openai
#   → cc agent -p "review the diff" --think --provider openai
```

loop 自己的 flag(`--every` 等)被 Commander 在 prompt 之前消费,放 prompt 前即可。

### `--dynamic` — 让每轮自定步调

每轮通过**输出里的指令**决定下一步,而不是固定间隔。loop 解析该轮输出:

| 指令                       | 含义                                               |
| -------------------------- | -------------------------------------------------- |
| `[[loop:next <interval>]]` | 下一轮在 `<interval>` 后跑(如 `30s` / `5m` / `1h`) |
| `[[loop:stop]]`            | 任务完成 → 停(`stop` 优先于 `next`)                |
| 都不发                     | 回退到 `--every` 默认间隔                          |

```bash
chainlesschain loop --dynamic "盯着部署,上线了就停"          # prompt 模式:prompt 被自动追加指令契约,agent 自己驱动节奏
chainlesschain loop --dynamic --every 30s -- ./poll.sh       # exec 模式:命令自己 println 指令;30s 是回退
```

- **prompt 模式**会把指令契约追加进 prompt,LLM 据此自报下次间隔或收尾;**exec 模式**由命令
  自己打印指令。
- `runLoop` 据此收到 `done`(停止理由 `done`)与逐轮 `nextDelayMs`;协议解析器
  `parseLoopDirectives` 独立可单测。

> ⚠️ **exec 模式用 `shell:true`**(让 `npm test` 这类 `.cmd` shim 能解析),因此**带空格的单个参数**
> 会被 shell 重新切分——这是标准 shell 行为。prompt 模式与 `--` 后的简单命令不受影响。

### `--save` / `--resume` — 会话持久化 + 续跑

把一个 loop 持久成 JSONL 会话(写到 `~/.chainlesschain/sessions/<id>.jsonl`),之后可续跑:

```bash
chainlesschain loop --save ci-watch --every 1m -- npm test   # 持久成可续跑会话
chainlesschain loop --resume ci-watch --max-iterations 20    # 续跑(累计计数)
```

- **`--save [id]`** 写三类事件:一条 `loop_config`(模式 / 操作数 / 间隔 / 停止条件)+ 每轮一条
  `loop_iteration`(退出码 / 耗时 / dynamic 字段,**不存输出体**,保持会话小)+ 收尾 `loop_end`。
  省略 `id` 时自动生成;结束时打印 `resume with: cc loop --resume <id>`,`--json` 里带 `sessionId`。
- **`--resume <id>`** 回放 `loop_config`(**重建原命令/prompt,不必重打**)、数已完成轮数,然后
  **累计续跑**——`--max-iterations` 跨续跑累计(saved 2 轮 + resume 到 4 = 再跑 2 轮)。
- **续跑时显式重传的 flag 覆盖存档**(如 `--max-iterations 20` 扩预算、`--every 30s` 改间隔),
  靠 Commander `getOptionValueSource` 区分"用户显式传"与"默认值";没传的继承存档。
- 纯函数 `summarizeLoopEvents(events) → {config, completedIterations, lastExitCode}` 独立可单测。

> 💡 **headless 必须真等待**:loop 的轮间 sleep 计时器**不 unref**,否则 stdin 非 TTY(管道 / CI /
> cron)时事件循环没东西吊着,会在第一轮后就退出。SIGINT 仍能经 abort signal 中断等待。

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

### 项目 `.mcp.json` — 团队共享配置(opt-in,默认关)

对标 Claude Code 的项目级 `.mcp.json`:在 git 项目根(从 cwd 向上找,与 `.claude`
各层一致)和 cwd 放一个 `.mcp.json`(`{ "mcpServers": { ... } }`),`cc agent` 合并两处
(同名时 **cwd 就近覆盖根**)。**安全默认关** —— 签入仓库的 `.mcp.json` 能 spawn 任意
命令,克隆任何仓库就跑等于供应链风险,故必须**显式 opt-in**:

```bash
chainlesschain agent --project-mcp -p "..."     # 仅本次运行加载项目 .mcp.json
CC_PROJECT_MCP=1 chainlesschain agent -p "..."  # 等价(整 shell 生效)
```

精度:`--mcp-config` 与注册 server **同名时优先**(先连者赢);加载顺序排在 IDE 自动发现
之前;`--strict-mcp-config` 下完全跳过(只用 `--mcp-config`);未 opt-in 时彻底 no-op。
与 Claude Code 不同,暂无逐 server 审批弹窗 —— env/flag 的 opt-in 即当前的安全闸。

### Resources — 把 MCP 资源喂给 agent

MCP 不止 tools。当任一连上的 server 暴露 **resource**(文档 / 文件 / 数据)时,agent
循环自动多两个通用工具(对标 Claude Code 的 `ListMcpResourcesTool` / `ReadMcpResourceTool`):

- `list_mcp_resources {server?}` → 列出所有(或某 server 的)资源 `{server, uri, name, ...}`
- `read_mcp_resource {uri, server?}` → 按 URI 读取内容;省略 `server` 时按 uri 自动定位归属

只有"存在资源"才注册这两个工具(无资源的纯工具 server 不会污染工具表);多批合并(`--mcp-config` + 注册 + IDE)只注册一次。CLI 侧对应 `cc mcp resources` / `cc mcp read-resource <uri>`(见 `docs/cli/core-phases.md`)。

### Prompts — server 提供的斜杠命令(交互 REPL)

MCP server 还可暴露 **prompt**(参数化的 prompt 模板)。交互 REPL 里它们就是斜杠命令
`/mcp__<server>__<prompt>`(对标 Claude Code):

```text
/mcp                              # 总览:列出所有已连 server 的资源 + prompt
/mcp__docs__summarize {"len":"short"}   # 取回该 server 渲染好的 prompt,作为本轮输入喂给 LLM
/mcp__docs__greet 直接跟一段文本         # 非 JSON 尾巴 → 作为 { input: "..." } 传入
```

CLI 侧对应 `cc mcp prompts` / `cc mcp get-prompt <name>`。

## IDE Bridge — 自动连接编辑器的 MCP server (Phase 0)

第三条 MCP 源:运行中的编辑器扩展(VS Code / JetBrains)可在内部跑一个本地 MCP server
(暴露 `ide_getSelection`/`ide_getDiagnostics`/`ide_openDiff` 等"IDE 工具"),并把它的端点写进
一个 **lockfile**。`cc agent` 自动发现并把它当保留名 `ide` 的 server 连上,工具即
`mcp__ide__getSelection` 等,与 `--mcp-config` / 注册 server 合并进同一 client。设计见
`docs/design/modules/98_IDE桥接对标方案.md`。**Phase 0 = 纯 CLI 发现层**(扩展为后续阶段)。

**发现两条路径**(`src/lib/ide-bridge.js`):

- **env 直连(主)**:扩展在它拥有的集成终端注入 `CHAINLESSCHAIN_IDE_PORT`(+ 可选
  `CHAINLESSCHAIN_IDE_TOKEN`)→ CLI 直接锁定该 port 的锁,免扫描、免歧义。
- **lockfile 扫描(兜底)**:扫 `~/.chainlesschain/ide/*.json`,按 `workspaceFolders[]` 与
  `cwd` 的**最长前缀**匹配挑一条(多匹配取 `started_at` 最新)。

**Lockfile**(`~/.chainlesschain/ide/<port>.json`,文件 `0600` / 目录 `0700`):

```jsonc
{
  "ide": "vscode",
  "transport": "sse",
  "url": "http://127.0.0.1:53690/sse",
  "port": 53690,
  "workspaceFolders": ["/abs/ws"],
  "token": "<bearer>",
  "pid": 12345,
  "started_at": 1718000000000,
}
```

约定:`url` 必须 `127.0.0.1`/`::1`;`transport` 仅 `sse`/`http`(client 当前不支持 `ws`);
连接注入 `Authorization: Bearer <token>`;`pid` 不存活且文件超 30s 视为 stale 跳过。

```bash
chainlesschain agent -p "修下选区里的 bug"     # 在 IDE 集成终端内自动连接
chainlesschain agent -p "..." --ide            # 强制启用(外部终端手动接)
chainlesschain agent -p "..." --no-ide         # 禁用 IDE 自动连接

chainlesschain ide list                        # 列出发现到的 IDE server(token 不显)
chainlesschain ide status [--ide]              # 此刻会连哪台 + 它的 MCP config(token 脱敏)
chainlesschain ide doctor [--ide]              # 解释发现为何成功/失败(无锁/stale/workspace 不匹配/…)
```

**交互 REPL `/ide`**(Claude-Code 平价):在 `chainlesschain agent` 交互会话里输入 `/ide` 查看**本会话**的桥接状态——已连则显示编辑器/端口/工作区 + 可用 `mcp__ide__*` 工具;未连则给发现诊断(几个锁、为何不匹配)+ 怎么连(从 IDE 集成终端跑、或 `--ide`)。等价于 `cc ide doctor` 的会话内即时版。

**保留名 `ide`**:若你已 `cc mcp add ide` 自建同名 server,**用户显式注册优先**,IDE 自动发现让位
并打印一次 WARN。

> 端到端自验(免扩展):`cc mcp scaffold` 生成一个 SSE MCP server 当"假 IDE",手写一条
> `<port>.json` 锁指向它,跑 `cc agent --ide` 即可确认 `mcp__ide__*` 工具进 loop + Bearer 鉴权通。

> **热重连**:窗口 reload / 扩展升级让 IDE 的 MCP server 换新端口+新 token 重启时,**不需要**
> 重跑 `cc agent`——下一次 `mcp__ide__*` 调用失败会自动重扫 lockfile、连上新实例并重试一次
> (选区/诊断自动注入同样恢复);IDE 彻底关掉则该次调用报错,工具级错误不会触发重连。
> headless(`agent -p`)、stream、交互 REPL 三个入口均已接 IDE 自动连接。

### IDE 实时上下文 + 编辑后诊断回喂(Claude-Code 平价)

IDE 桥连上后,agent 不再只是"有 IDE 工具可调",还会**主动感知编辑器状态**:

- **提交时自动共享选区/打开文件/终端输出**:每次提交 prompt(headless 单轮、stream 每轮、
  REPL 每条),CLI 自动调一次 `getSelection` + `getOpenEditors`(+ 连了终端工具时 `getTerminalOutput`),
  把活跃文件、打开的 tab、当前选中代码(截断到 2000 字符)、**最近 2 条终端命令 + 输出**
  (每条输出截断到 800 字符、保留末尾)作为 `<ide-context>` 块附进**本轮用户消息**——模型无须
  自己决定调工具(对标 Claude Code「把终端输出带进 prompt」)。该块是**短暂的**:只进在途消息,
  不写入会话持久化(resume 回放的是你的原话,不是过期的编辑器快照)。IDE 无响应时 1.5s 超时
  放弃,绝不阻塞回合。**终端输出可单独关**:`CC_IDE_TERMINAL=0` 只去掉终端(选区/编辑器仍注入),
  适合终端噪声大或含敏感信息时。
- **编辑后诊断自动回喂**:`write_file`/`edit_file`/`edit_file_hashed` 成功后,CLI 等
  语言服务器消化变更(默认 600ms,`CC_IDE_DIAG_SETTLE_MS` 可调,`0` 跳过),拉取该文件的
  **error/warning 诊断**(info/hint 不打扰),作为 `ideDiagnostics` 附在工具结果里——模型
  在**同一个循环**里就能看到自己刚引入的报错并修掉,而不是若干轮后才发现。最多列 10 条。

两者共用开关:`CC_IDE_CONTEXT=0` 一并禁用(IDE 工具本身仍可被模型显式调用)。

- **`@selection` / `@diagnostics` / `@terminal` at-mention(显式版)**:除了上面"每轮自动共享"的
  隐式注入,你也可以在 prompt 里**显式**写 `@selection` 把当前选区拼进本轮,或写 `@diagnostics`
  把**整个 workspace 的当前 error/warning 问题**拼进来(后者是自动注入没有的——自动诊断只针对
  刚编辑的单个文件),或写 `@terminal` 把**最近 5 条终端命令 + 输出**(每条截断 2000 字符,比每轮
  自动注入的 2 条/800 字符更全)拼进来。与 `@path` 文件引用同一语法边界(`foo@selection`、邮箱不会
  误匹配),在 headless 单轮、stream 每轮、交互 REPL 三入口均生效。展开同样**短暂**(只进在途消息,
  不写持久化)。未连 IDE / 无选区 / 无问题 / 无终端记录时,`@mention` 原样留在文中并打印一条 `@ide:`
  提示。与隐式注入不同,显式 at-mention **不受 `CC_IDE_CONTEXT=0` 影响**(它是你的直接请求)。

- **编辑审批走 IDE 原生 diff**:settings 权限规则对 `Write`/`Edit` 配了 `ask` 且在**交互
  REPL** 里(headless 保持 fail-closed 不弹)、IDE 已连时,确认不再是终端 y/N,而是编辑器
  弹出**原生并排 diff**(右侧可编辑)阻塞到你裁决:**Accept → IDE 自己把(可能被你顺手改过
  的)最终文本写盘,工具自身的写入被跳过**(审批替代执行,杜绝双写);Reject → 拒绝且文件
  不动;IDE 中途挂掉/无法计算拟议内容 → 自动回落终端确认。`CC_IDE_DIFF_APPROVAL=0` 关闭
  此路由(回终端 y/N)。
- **diff 行内批注(Request changes…)**:除 Accept/Reject/Pick hunks,diff 还有第三个选择
  **「Request changes…」**——在右侧改动 pane 选中要评论的行,逐条写修改意见(锚定所选行,
  空输入结束评审)。文件**不落盘**,这些行锚批注作为工具结果回喂 agent(`[IDE review] … the
user requested changes: • line N: <意见> ⟪锚文本⟫ … propose it again`),agent 据此修订后
  重新提案——对标 Claude Code 的 inline-review。零意见的评审降级为 Reject(不写文件,fail-safe)。

## PDH Bridge — 自动连接安卓 App 的设备能力 MCP server (module 101)

第四条 MCP 源,把 IDE 桥接的思路搬到**手机**:安卓 App 在本机跑一个"设备能力 MCP server"(暴露
`collect_system_data`/`collect_app_data`/`salvage_app_data`/`collect_files` 等**采集工具**),并把端点写进
lockfile。App 启动时拉起内置 cc 并注入 env,`cc agent` 自动发现、当保留名 `pdh` 的 server 连上,工具即
`mcp__pdh__collect_system_data` 等。**让 agent 第一次能主动指挥设备采集自己的数据**(进程模型从"App 把 cc 当
一次性子进程"反转为"App = server, cc = client")。设计见 `docs/design/modules/101_个人数据IDE桥接方案.md`。
**Phase 0(发现层+协议)+ Phase 1(L1–L4 采集工具)已落地**。

**发现两条路径**(`src/lib/pdh-bridge.js`):

- **env 直连(主)**:App 给内置 cc 注入 `CHAINLESSCHAIN_PDH_PORT`(+ 可选 `CHAINLESSCHAIN_PDH_TOKEN`)→ 直接锁定该
  port 的锁,免扫描。
- **lockfile 扫描(兜底)**:扫 `~/.chainlesschain/pdh-bridge/*.json`,取**最新存活**锁(一台设备只有一个 PDH
  server,无 IDE 那种 workspace 概念)。

**Lockfile**(`~/.chainlesschain/pdh-bridge/<port>.json`,文件 `0600` / 目录 `0700`):

```jsonc
{
  "kind": "pdh-bridge",
  "version": 1,
  "transport": "http",
  "url": "http://127.0.0.1:18510/mcp",
  "port": 18510,
  "device": "android",
  "appUid": 10367,
  "token": "<bearer>",
  "pid": 12345,
  "started_at": 1718000000000,
}
```

约定:`url` 必须 `127.0.0.1`/`::1`;`transport` 仅 `http`/`https`/`sse`(暂不支持 `ws`);连接注入
`Authorization: Bearer <token>`;`pid` 不存活且文件超 30s 视为 stale 跳过。该 server 标记 `longRunning`——
采集工具可在 `assist_required`(需你先在目标 App 登录/暖热)时阻塞等你完成再重试,免疫单次调用超时。

```bash
chainlesschain agent "采集本机系统数据入库"      # 在 App 内置终端内自动连接 → mcp__pdh__collect_system_data
chainlesschain agent --pdh "列出能采集哪些数据"  # 强制启用(外部终端手动接)→ mcp__pdh__list_collectors
chainlesschain agent --no-pdh "..."             # 禁用 PDH 自动连接

chainlesschain pdh list                          # 列出发现到的 PDH server(token 不显)
chainlesschain pdh status                        # 此刻会连哪台 + 它的 MCP config(token 脱敏)
chainlesschain pdh doctor                        # 解释发现为何成功/失败(无锁/stale/非 localhost/…)
```

**保留名 `pdh`**:若你已 `cc mcp add pdh` 自建同名 server,用户显式注册优先,PDH 自动发现让位。

**6 个设备工具**:`pdh_ping`(存活)/ `collect_files`(L1)/ `collect_system_data`(L2 联系人+应用,免 root/登录)/
`collect_app_data`(L3,7 源 weibo/bilibili/12306/douyin/xhs/toutiao/kuaishou,无凭证→`assist_required`)/
`salvage_app_data`(L4 root 内存打捞)/ `list_collectors`。采集衔接:Kotlin 产快照 → spawn
`cc hub sync-adapter <provider>` 入库。完整安装/协议/排错见用户文档 [PDH Bridge 个人数据 IDE 桥接](/chainlesschain/pdh-bridge)。

## Web Search — `web_search` 工具 + 可插拔搜索源

agent 循环原生带 `web_search`(配合 `web_fetch`:先搜出 URL,再抓正文)。返回归一化
`{ query, provider, count, results:[{title,url,snippet}], answer }`。搜索后端**可插拔**,
经 `.chainlesschain/config.json:webSearch` 配置——搜索源是一个配置开关,不是一次性写死的代码决定。

```jsonc
// .chainlesschain/config.json
{
  "webSearch": {
    "provider": "auto", // auto | tavily | brave | bocha | qianfan | duckduckgo | searxng | baidu
    "apiKey": "", // 通用 key;也可用 tavilyApiKey/braveApiKey/bochaApiKey/qianfanApiKey 分别指定
    "maxResults": 8,
    "instanceUrl": "", // 仅 searxng:自建实例地址(需开 json 输出格式)
    "qianfanApiKey": "", // 百度千帆 AI 搜索 Bearer token,完整 bce-v3/ALTAK-.../<secret> 形式(见下)
    "qianfanUrl": "", // 可选:覆盖千帆 AI 搜索 endpoint,默认 https://qianfan.baidubce.com/v2/ai_search
  },
}
```

- **`provider: auto`(默认)**:按 `tavily > brave > bocha > qianfan` 顺序选用**已配置 key** 的那个;
  都没 key 时退回**免 key** 的 DuckDuckGo(HTML 端点解析,质量/稳定性较弱)。
- **API key 来源**(优先级 options > config > env):`TAVILY_API_KEY` / `BRAVE_API_KEY`
  (兼容 `BRAVE_SEARCH_API_KEY`)/ `BOCHA_API_KEY` / `QIANFAN_API_KEY`。Bocha(博查)为国内可达的 AI 搜索源。
- **`baidu`(免 key,国内可达)**:抓 `www.baidu.com/s` HTML(浏览器 UA)。适合国内
  低频检索(DuckDuckGo 国内常被墙);但 Baidu 反爬激进,频繁请求会 302 跳验证码,此时
  返回明确的 `rate-limited / captcha` 错误而非静默失败。高频/稳定需求建议用 keyed 源。
- **`qianfan`(百度千帆 AI 搜索,keyed,国内可达稳定)**:Baidu 官方检索增强 API,
  比免 key 抓 HTML 稳定可靠(无验证码),适合 agent 高频检索。**配置**:把 Bearer token
  填进 `webSearch.qianfanApiKey`(或环境变量 `QIANFAN_API_KEY`);需要换 endpoint 时填
  `webSearch.qianfanUrl`。
  - 取 token:[百度智能云千帆控制台](https://console.bce.baidu.com/qianfan/) → 开通「AI 搜索」→
    创建 Bearer token。**必须是完整 `bce-v3/ALTAK-.../<secret>` 形式**;只填短 API Key 片段
    会 401 `InvalidHTTPAuthHeader: Fail to parse apikey authorization`。
  - 请求体固定为 `{messages:[{role:"user",content:query}], search_source:"baidu_search_v2",
resource_type_filter:[{type:"web",top_k:maxResults}]}`,解析返回的 `references[]`
    成 `{title,url,snippet}`(并捕获可能的 `answer`)。
  - 用法:`webSearch(q,{provider:"qianfan"})` 或 config `"provider":"qianfan"`。
    > ✅ RUNTIME-VERIFIED(2026-06-09):用真 `bce-v3/…` token 实测,"杭州亚运会举办时间" →
    > 5 条正确结果(`references[]` schema 解析正确,百度百科/一带一路网等),live 测试通过。
- **keyed 后端 live 测试**:`__tests__/integration/web-search-live.test.js` 对 tavily/brave/
  bocha/qianfan 各跑一条**真实查询**——**仅当对应 env key 存在时执行,否则自动 skip**(不失败)。
  例:`BOCHA_API_KEY=sk-xxx npx vitest run __tests__/integration/web-search-live.test.js`。
- 单次调用可用工具入参 `provider` 覆盖配置后端;`web_search` 属 `readonly`,plan-mode 允许,
  权限规则伞名 `WebSearch`(见上「Permissions」表)。
- 已注册的 `brave-search` MCP(`cc mcp`)是另一条搜索路径,但需逐用户安装+配 key;
  `web_search` 是内建、开箱即用的等价能力。

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

## Notebooks — `notebook_edit` + notebook-aware `read_file`(Claude-Code NotebookEdit/Read 平价)

Jupyter `.ipynb` 读写一对工具,补齐 cc agent 唯一缺的 Claude Code 工具。

**读**:`read_file` 对 `.ipynb` 自动渲染成**紧凑单元清单**(每格 index + id + type + source,outputs 只摘要不 dump),而非原始 JSON——避免 base64 输出把上下文撑爆/被 50k 截断藏住单元。传 `raw:true` 取底层 JSON。

```
Jupyter notebook — 2 cell(s), nbformat 4. Edit cells with the notebook_edit tool …

── Cell 0 [code id=c1] ──
x = 1
print(x)
  ⟨1 output(s) hidden⟩

── Cell 1 [markdown id=m1] ──
# Title
```

**写**:`notebook_edit` 改单个单元——

| 参数 | 说明 |
|---|---|
| `path` | `.ipynb` 路径(必填) |
| `edit_mode` | `replace`(默认)/ `insert` / `delete` |
| `cell_id` / `cell_index` | 目标定位(cell_id 优先;从渲染清单里读 id) |
| `cell_type` | `code` / `markdown`——`insert` 必填 |
| `new_source` | 新单元源文本(replace/insert 必填) |

- **replace**:覆盖目标格 source;若是 code 格,顺带清空 `outputs` + `execution_count`(旧输出会误导)。
- **insert**:在目标格**之后**插新格(无目标→插到**顶部**),自动生成 cell id。
- **delete**:移除目标格。
- 源以保留行尾 `\n` 的行数组存盘,1-space 缩进 + 尾换行重序列化(nbformat 习惯)。

**典型流程**:`read_file notebook.ipynb`(看到各格 id)→ `notebook_edit {path, cell_id, new_source}`。

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

REPL 内有同款 **`/context`**:对**当前活跃会话**(内存中的 messages)实时分桶,不用先存档。

## Session Export / REPL 补全 / 版本提醒(小件平价)

- **`cc session export <id|last> [-o file]`** — 会话导出 Markdown。主源仍是聊天 DB 会话;
  查不到时自动回退 **JSONL agent 会话**(`cc agent --resume` 那套):user/assistant/system 轮次 +
  tool_call/tool_result 围栏块(4K 截断,内嵌 ```自动升级围栏)+ compact 标记 + token 汇总。`last` 直接导最近一次 agent 会话(不碰 DB)。
- **交互 REPL `/export [path]`**(Claude-Code 平价) — 把**当前内存里的对话**导出为 Markdown
  (user/assistant/system 轮次 + tool_call 的 JSON 参数美化 + tool_result 围栏块 4K 截断 +
  多模态图片标 `[image]`)。区别于 `cc session export`(读持久化 JSONL)与 `cc export`(知识库导出):
  `/export` 抓的是此刻 context 里的内容,持久化与否都能导。省略路径时落
  `./chainlesschain-export-<时间戳>.md`。
- **交互 REPL `/config`**(Claude-Code 平价) — 显示**生效配置**(密钥安全):当前 LLM
  provider/model/baseUrl、key 是否设置(只显 `set (…后4位)`/`not set`,绝不打印明文)、
  web-search 后端、config 文件路径,以及本会话**实际生效**的 provider/model(经 `--provider`/
  settings 覆盖时标 `(overrides config)`)。读 `~/.chainlesschain/config.json`。
- **交互 REPL `/doctor`**(Claude-Code 平价) — 一屏**会话健康检查**:把 LLM provider/model、
  API key 是否设置、IDE 桥接、MCP 服务器、权限规则数、settings.json hooks 汇成一个
  ✓/⚠/· 列表,并标记最常见的"聊天没反应"成因(未配 provider、云 provider 缺 key)。
  比逐个 `/config`·`/ide`·`/mcp`·`/permissions` 更快定位 setup 问题。
- **交互 REPL `/sessions`**(Claude-Code `/resume` 平价的发现半边) — 列出**可恢复的历史会话**
  (跨 DB + JSONL 两库, 经 `listRecentSessions`):短 id / 来源 / 消息数 / 时间 / 标题, 标注当前会话。
  配合既有 `/session resume <id>`(会话内原地切换:重建消息+换 sessionId)= 完整 resume 体验。
  `/session`(单数)= 当前会话信息;`/sessions`(复数)= 列表。
- **交互 REPL `/memory`**(Claude-Code 平价) — 列出 agent **自动载入系统提示**的项目记忆文件
  (cc.md > CLAUDE.md > AGENTS.md 层级 + @import + 命中的 path-scoped rules),每个显
  scope/路径/字节 + 总计。`CC_PROJECT_MEMORY=0` 时标注"已禁用"。等价 `cc memory files` 的
  会话内即时版;区别于 `#`(往 cc.md 追加笔记)与 `cc memory recall`(scoped 记忆库)。
- **交互 REPL `/tasks`**(对照 Claude Code 后台任务面板) — 列出 agent 用
  `run_shell { run_in_background:true }` 起的**后台 shell 任务**(否则只有 agent 经 `check_shell`
  工具看得见):状态徽章(`● running`/`✓ exited (0)`/`✗ failed (code)`/`✗ error`)+ 运行时长 +
  命令。管理子命令:`/tasks kill <id>` 杀单个(POSIX 杀进程组 / Win `taskkill /T`)、
  `/tasks kill-all` 全杀。sub-agent 委派仍走 `/sub-agents`(另一注册表)。
- **交互 REPL `/review`**(Claude-Code `/code-review` 平价) — 在 `chainlesschain agent`
  会话里**对当前改动做 diff-first 代码评审**,无需退出 REPL 单独跑 `cc review`。复用同一套机制:
  收集 git diff 后跑**一轮聚焦 agent**,默认 plan 模式(只读、不改文件)输出 Markdown 报告。
  内联参数:`/review [low|medium|high]` 力度 · `--security`(安全专项)/`--simplify`(只清理不挑 bug)·
  `--fix`(直接改工作区,自动 checkpoint 可 `cc checkpoint restore` 撤销)· 范围 `--staged`/
  `--base <ref>`/`--range <A..B>`。跑在当前 `cwd`(跟随 `/cd`)+ 复用本会话 provider/model。
- **交互 REPL `/copy`**(Claude-Code `/copy` 平价) — 把**最后一条 assistant 回复**复制到系统剪贴板,
  无需鼠标选中。`/copy code` 只复制最后一个**围栏代码块**。跨平台:Windows 走 PowerShell
  `Set-Clipboard`(强制 UTF-8 输入解码,非 ASCII 不乱码;`clip` 兜底)、macOS `pbcopy`、Linux 依次
  尝试 `wl-copy`/`xclip`/`xsel`。无可用工具时给出安装提示。
- **交互 REPL `/theme`**(Claude-Code `/theme` 平价) — 切换 REPL 配色:`/theme` 列出可选项 +
  当前项,`/theme <auto|dark|light|mono>` 切换并持久化(config `cli.theme`,下次启动沿用)。cc REPL
  是 chalk-on-readline 而非全屏 TUI,故主题控制两件可见的事:`mono` 把 `chalk.level` 置 0**完全去色**
  (适合配色不可读的终端或纯文本抓取),`light` 用**蓝色提示符**(绿色在浅底不易读)、`dark`/`auto`
  用绿色。启动时先存基线色深再应用主题,`mono→auto` 可逆。
- **REPL `/` 命令 tab 补全** — 行首输入 `/he<TAB>` 补全注册的 REPL 命令(命令 token 期间生效,
  空格后不打扰参数);与 `@` 文件补全共存于同一 completer。
- **启动版本提醒** — 每次启动一次性同步读缓存(`~/.chainlesschain/update-check.json`),有新版时
  stderr 打一行灰字(仅 TTY,不污染管道/JSON);缓存 >24h 由 detached 子进程后台刷新供下次启动,
  热路径零网络。`CC_UPDATE_NOTICE=0` 关闭;完整检查仍走 `cc update`。

## Structured Output — `--json-schema <file>`(headless)

```bash
cc agent -p "列出本目录的语言构成" --json-schema schema.json
```

最终回答必须是通过该 JSON Schema(子集:type/properties/required/items/enum/const/
additionalProperties)校验的 JSON:模型回复自动提取(裸/围栏/嵌入三种形态),校验失败带错误
清单纠错重跑(共 3 次),stdout **只打印校验通过的 JSON**(中间过程进 stderr),耗尽返回退出码 1。
与 `--output-format stream-json` 互斥。脚本消费 `cc agent -p` 从此不用 parse 自由文本。

## GitHub Action — `@cc` 评论驱动 agent(claude-code-action 平价 v1)

`.github/workflows/cc-agent-mention.yml`:在 issue / PR 评论里写 `@cc <问题>`,
headless `cc agent` 以**只读工具**(read_file/list_dir/search_files)分析代码并回评。

- **触发门控**:仅 OWNER/MEMBER/COLLABORATOR 的评论触发(陌生人 prompt 注入到不了 agent);
  PR 评论自动 checkout PR 分支。
- **配置**:repo secret `CC_LLM_API_KEY`(必填,缺失时回评说明并真实失败,不假绿)+
  repo variables `CC_LLM_PROVIDER`/`CC_LLM_MODEL`(默认 volcengine/doubao)。
- **v1 边界**:只回答不改码(无 write 工具、`--no-checkpoint --no-mcp`,15 轮上限,15 分钟超时);
  改码+推 commit 是 v2。其它仓库复制该 workflow 文件即可用。

## REPL Steering — 排队输入 / Esc 中断 / rewind(Claude-Code 平价)

agent REPL 运行 turn 期间的三件交互能力:

- **排队输入**:turn 进行中继续打字回车,不再并发触发第二个 turn(旧行为是个 race),而是
  FIFO 排队(灰字 `⏸ queued (N)` 提示),当前 turn 结束自动逐条续跑。
- **Esc 中断**:turn 进行中按 Esc 立即中止本轮(走 agentLoop 既有 AbortSignal seam,每迭代
  检查),黄字提示、partial 对话保留、排队的输入照常 drain。方向键等转义序列不会误触。
- **`/rewind` + 双 Esc**:`/rewind` 列出最近 user 轮次(新在前带预览),`/rewind <n>` 把对话
  截断回该轮之前并把原文回填到输入行(改完重发);**空闲时双击 Esc** 是同款列表的快捷键。
  只回滚对话态;文件态用 `cc checkpoint restore`(配 `cc agent --checkpoint` 自动快照)。

## Project Memory — `cc.md` 项目记忆自动加载 + `cc init` 盘点

Claude Code CLAUDE.md 体系对标(主名用自家 `cc.md`,设计文档 `docs/design/modules/99_项目记忆与init对标方案.md`)。`cc agent` 启动时自动把文件式项目约定注入系统提示(`<project-instructions>` 块):

| 范围                          | 查找顺序(每位置取第一个存在的)                    |
| ----------------------------- | ------------------------------------------------- |
| 用户级                        | `~/.chainlesschain/cc.md` → `~/.claude/CLAUDE.md` |
| 项目级(git root → cwd 逐目录) | `cc.md` → `CLAUDE.md` → `AGENTS.md`               |
| 本地伴随(每目录)              | `cc.local.md` → `CLAUDE.local.md`                 |
| 脚手架规则(每目录)            | `.chainlesschain/rules.md`                        |

- 文件内 `@相对路径` / `@~/路径` 递归 import(深度 ≤5,环保护,跳过代码围栏;npm scope/邮箱等解析不到文件的 token 静默忽略)
- 预算:单文件 48KB / 总 192KB,超限截断标记;任何 I/O 错误 fail-open 不影响启动
- 关闭:`CC_PROJECT_MEMORY=0`(全局)

```bash
chainlesschain init              # 默认:盘点当前文件夹 → 生成 cc.md + 最小 .chainlesschain/(config + skills/)
chainlesschain init --force     # 覆盖已有 cc.md
chainlesschain init -t <模板> -y # 显式模板:老脚手架流(persona/skills/rules)
```

盘点为纯离线 census(语言构成 / lockfile 包管理器 / scripts / workspaces / 工具链标记 / CI / README 摘要),不读源码内容。已有 CLAUDE.md/AGENTS.md 时自动在生成的 cc.md 里 `@import` 引回,不会遮蔽手工维护的内容。

**REPL 配套前缀**:

- `! <cmd>` — 直接跑 shell(不经 LLM),输出回灌对话上下文(`<bash-input>/<bash-output>`)
- `# <note>` — 一键记到 git root 的 `cc.md`(`## Notes` 段,最新在上),本 session 立即生效、下 session 自动加载

## Permissions — `.claude/settings.json` 规则 (allow / ask / deny)

Claude Code `permissions.{allow,ask,deny}` 对标。给 `cc agent`(headless + 交互
REPL)加一层**用户可编辑的 glob 规则**网关:在工具真正执行前,按规则 `deny` 硬拦 /
`ask` 要确认 / `allow` 预授权。无 settings.json 时行为**逐字不变**(回落到既有的
risk-tier / ApprovalGate / plan-mode 逻辑)。引擎零依赖(自写 glob→regex)。

### 规则语法 `Tool(pattern)`

裸 `Tool` 匹配该工具的所有调用;`Tool(pattern)` 按工具类型匹配实参。工具名两种写法
都吃——Claude-Code 伞名或本 CLI 原名(双向别名):

| 伞名        | 本 CLI 工具                      | `pattern` 匹配对象 | 例                                         |
| ----------- | -------------------------------- | ------------------ | ------------------------------------------ |
| `Bash`      | `run_shell`                      | 命令字符串         | `Bash(git push:*)`、`Bash(npm run test:*)` |
| `Read`      | `read_file` / `list_dir`         | 解析后的绝对路径   | `Read(./src/**)`                           |
| `Edit`      | `edit_file` / `edit_file_hashed` | 路径               | `Edit(//etc/**)`(`//`=绝对)                |
| `Write`     | `write_file`                     | 路径               | `Write(./build/**)`                        |
| `WebFetch`  | `web_fetch`                      | URL host           | `WebFetch(domain:example.com)`             |
| `WebSearch` | `web_search`                     | —                  | `WebSearch`                                |
| `Task`/`Agent` | `spawn_sub_agent`             | 子 agent 类型      | `Agent(explorer)`、`Agent(executor,design)` |

- **命令**:`prefix:*` 前缀语义(`Bash(git push:*)` 命中 `git push` 及其后任意参数);
  纯 `*` 当 glob;无 `*` 则精确匹配。
- **路径**:`./x` 相对 cwd、`//abs` 绝对、`~/x` home;`*` 不跨 `/`、`**` 跨。
- **命名参数**(Claude-Code 2.1.178):`Tool(param:value)` 匹配任一具名实参,
  如 `Bash(command:rm*)`、`mcp__db__query(table:users)`。
- **子 agent 类型**(Claude-Code 2.1.186):`Agent(type)` / `Agent(typeA,typeB)`
  按 `spawn_sub_agent` 调用的类型(`profile` / 具名 `agent` / `role`,取其一)匹配——
  逗号列表任一命中即可、类型名大小写不敏感、支持 `*`/`?` glob。从 Claude-Code
  `settings.json` 直接移植的 `Agent(…)` 规则因此会被执行而非静默忽略。
  (`Task(profile:explorer)` 命名参数写法仍可用。)
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

**交互 REPL `/permissions`**（Claude-Code 平价）：在 `chainlesschain agent` 会话里输入 `/permissions` 查看**本会话生效**的 allow/ask/deny 规则（按 deny>ask>allow 优先级排列）+ 来源文件 + "危险 shell 命令永远需批准"提示。会话期间用 always-allow 现加的规则也即时反映。等价 `cc permissions list` 的会话内即时版。

- `test` 是调规则的杀手锏——执行前看清某调用会被哪条规则、哪个文件决定(`fallthrough`=
  无规则命中,回落档位逻辑)。伞名 `Bash` 会解析成具体工具 `run_shell`。
- `perm` 已被 RBAC Permission Engine V2 占用,故权限规则命令用全名 `permissions`。

### 交互式 "always allow"(REPL)

REPL 里 `run_shell` 撞 ApprovalGate 风险确认时,提示是 **`[y]es once / [a]lways allow /
[N]o`**。选 `[a]`:从该调用推导一条规则(`git push origin main` → `Bash(git push:*)`),
写入 `.claude/settings.local.json` 并即时更新内存规则集 → **本/未来 session 不再问**(经
上面的 `allow` 短路)。显式 `ask` 规则保持 y/N(asking 是声明意图;且 deny>ask>allow 下
allow 也盖不过 ask)。

## Credential 读取保护(Claude-Code 2.1.189 `sandbox.credentials` 平价)

cc 不做 OS 沙箱,但同样的意图在**工具层**落地:Agent 不应把用户的密钥静默吸进模型上下文
(可能被回显、写进转录、或被后续工具外泄)。两条读取路径被**确认优先 / headless fail-closed**
拦截(与 sensitive-file **写**保护同款):

- **`read_file`** 指向凭据文件:`.env`(及 `.env.local` / `.env.production` 等真实变体——但
  `.env.example` / `.env.sample` / `.env.template` 等模板**不拦**)、`~/.aws/credentials`、
  `~/.kube/config`、`~/.docker/config.json`、`~/.config/gh/hosts.yml`、`.npmrc` / `.netrc` /
  `.git-credentials` / `.pgpass`、私钥与证书材料(`*.pem` / `*.key` / `*.pfx` / `*.p12` /
  `*.jks` / `id_rsa` 等;`*.pub` / `*.crt` 公钥**不拦**)、`secrets.{json,yaml}`。
- **`run_shell`** 读凭据:用 `cat` / `type` / `Get-Content` / `head` … 读上述凭据文件;
  `echo $ANTHROPIC_API_KEY` / `printf "%s" "$AWS_SECRET_ACCESS_KEY"` / `echo %GITHUB_TOKEN%` /
  `Write-Host $env:DB_PASSWORD` / `printenv OPENAI_API_KEY` 这类**打印密钥型环境变量**;
  以及 `printenv` / `env` / `Get-ChildItem env:` 这类**全量 env dump**。复合命令的**每一段**
  都查(`echo hi && cat .env` 也会被拦)。仅**消费**密钥而不回显的命令(`mytool --token $API_TOKEN`)
  不拦——值不会落进输出。

旁路与开关:

- **显式 settings `allow` 规则**(`Read(./**)` / `Bash(cat:*)` 等)或交互确认 `ask` 已通过 →
  预授权,不再拦。
- 交互模式弹确认(一次按键);**headless 无确认器 → fail-closed 拒绝**,报
  `[Credential Guard] … requires confirmation — denied`。
- `CC_CREDENTIAL_GUARD=0`(/ `false` / `no` / `off`)整体关闭。
- **有意分歧**:`--safe-mode` **不**关闭本保护——和权限 deny 规则一样,这是**安全面**而非
  自定义项,"裸跑排查自定义"绝不能放宽 Agent 能读到的密钥。

## Hooks — `.claude/settings.json` `hooks` 块 (Claude-Code 协议)

Claude Code hooks 对标。两个来源,职责不同:

- **DB hooks**(`cc hook add` → SQLite)—— **observe-only**,触发即记录,不参与决策(行为不变)。
- **`.claude/settings.json` `hooks` 块** —— **决策型**:走 stdin-JSON + 退出码/JSON-stdout 协议,可**拦截**工具调用。本节讲后者。

### Schema

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "./guard.sh", "timeout": 60 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "./fmt.sh" }]
      }
    ]
  }
}
```

- `matcher`:工具名匹配,支持精确 / `Edit|Write` 管道 / `*` 通配 / `/regex/`。对**伞名**(`Bash`)和**本 CLI 原名**(`run_shell`)都测——两种写法都命中。
- hooks 数组**跨层级拼接**(user < project < .local < `--settings`),有序、不去重。
- `timeout` 秒(默认 60)。

### 协议(命令 hook)

事件 payload 以 **JSON 写入命令 stdin**(`{ hook_event_name, tool_name, tool_input, cwd, session_id }`)。判定:

| hook 返回                                                                       | 含义                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------- |
| **exit 2**                                                                      | **block**(reason = stderr)——标准"拒绝"路径     |
| exit 0 + stdout `{"decision":"block"\|"approve"\|"ask","reason"}`               | 按之                                           |
| exit 0 + `{"hookSpecificOutput":{"permissionDecision":"deny"\|"allow"\|"ask"}}` | PreToolUse 专用                                |
| exit 0 + `{"continue":false,"stopReason"}`                                      | block                                          |
| exit 0(无 JSON)                                                                 | continue(放行;stdout 可作 `additionalContext`) |
| 其它非零 / spawn 失败 / 超时                                                    | **非阻塞**(surface,不拦——坏 hook 不卡 agent)   |

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

| 事件                 | 触发点                                               | 能力                                                                                                                                              |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PreToolUse**       | 每个工具调用前(权限解析之后)                         | `block`→拦工具 / `ask`→确认 / context                                                                                                             |
| **PostToolUse**      | 工具跑完后                                           | `block` 的 reason 作 `hookFeedback` 回喂模型                                                                                                      |
| **UserPromptSubmit** | 每轮用户 prompt 提交前(headless + REPL)              | `block`→中止本轮 / 非 block stdout(JSON `additionalContext` 或纯文本)→注入为上下文                                                                |
| **SessionStart**     | 会话起点(headless + REPL)                            | 非 block stdout → 注入为一条 `system` 上下文消息(observe-only,无 block);`source`=startup/resume 即 matcher 目标                                   |
| **Stop**             | agentLoop 收尾(agent 给出最终答复,无工具调用)        | `block`→**强制续跑**(reason 作新指令注入,`stop_hook_active` 防死循环 + 迭代预算兜底);payload 含 `final_response`/`stop_hook_active`               |
| **SubagentStop**     | `spawn_sub_agent` 工具完成后(子 agent 已返回摘要)    | observe + feedback:子 agent 已结束故不"强制续跑",`block` 的 reason 作 `hookFeedback` 回喂**父** agent;payload 含 `subagent_response`/`session_id` |
| **PreCompact**       | 自动压缩前(`shouldAutoCompact` 命中)                 | `block`→**跳过本轮压缩**(emit `compaction-skipped`);payload 含 `trigger`/`message_count`                                                          |
| **SessionEnd**       | 会话结束(headless run 收尾 / stdin 关闭 / REPL 退出) | observe-only;payload 含 `reason`                                                                                                                  |
| **Notification**     | agent 需要用户注意时(REPL 弹权限/风险确认前)         | observe-only(响铃 / 桌面通知);payload 含 `message`。仅交互 REPL(headless 无人可通知)                                                              |

UserPromptSubmit payload:`{ hook_event_name, prompt, cwd, session_id }`;block 在 headless 退出码 `2`、在 REPL 跳过本轮。SessionStart payload:`{ hook_event_name, source, cwd, session_id }`。Stop/PreCompact 由 `agentLoop` 中心触发(覆盖三入口);SessionEnd 在各入口收尾触发;SubagentStop 与 PostToolUse 同在 `executeTool` 里触发(仅当工具名为 `spawn_sub_agent`)。settings/host `deny`(权限规则)先于 hook 短路,被拒的工具调用不会 spawn hook 进程。

> **全事件已接入**:工具(PreToolUse/PostToolUse)+ prompt(UserPromptSubmit)+ 会话(SessionStart/SessionEnd)+ Stop(可 block→续跑)+ PreCompact(可 block→跳过压缩)。SessionEnd 为 observe-only。

## Output Styles — `/output-style` 人格

Claude Code `/output-style` 对标。给 agent 套一层**命名、可复用的人格**(persona),
追加到系统提示之后——保留核心编码能力,但改变行为/语气。

样式 = 带 frontmatter(`name`/`description`)的 markdown,**body 追加到系统提示**
(在 base + `--append-system-prompt` 之后)。来源:`.chainlesschain/output-styles/`、
`.claude/output-styles/`(项目)、`~/.claude/output-styles/`(个人);另含内置
`default`(无叠加)/ `explanatory`(讲解 why+权衡)/ `learning`(留小块给用户写)。
生效优先级:`--output-style` > `.claude/settings.json` 的 `outputStyle` 默认。

```bash
chainlesschain agent -p "..." --output-style explanatory   # headless 套人格
chainlesschain output-style list [--json]                  # 内置 + 文件,标 * = settings 默认
chainlesschain output-style show explanatory
chainlesschain output-style new pirate --description "..."  # 脚手架到 .claude/output-styles/
# .claude/settings.json: { "outputStyle": "learning" }      # 项目默认
```

REPL 内:`/output-style`(列出 + 当前)、`/output-style <name>`(切换,即时重算系统
消息)、`/output-style none`(清除)。`--system-prompt` 仍可整体替换系统提示;output
style 是其上的人格叠加层。

## MCP OAuth — 远程 MCP server 授权

Claude Code 远程 MCP OAuth 对标。需要 OAuth 的远程 HTTP/SSE MCP server 用
`cc mcp login <url>` 授权一次,token 存盘并在每次连接时注入 `Authorization: Bearer …`
(过期自动 refresh)。已持有 token 的 server 仍可用静态 `-H "Authorization: Bearer …"`。

流程(标准 OAuth 2.0):RFC 9728/8414 元数据发现 → RFC 7591 动态客户端注册(或 `--client-id`)
→ RFC 7636 PKCE → 开浏览器授权 → localhost 回调接 code → 换 token → 落盘
`~/.chainlesschain/mcp-oauth.json`(按 server origin 索引)。

```bash
chainlesschain mcp login https://mcp.example.com/mcp           # 开浏览器授权(动态注册客户端)
chainlesschain mcp login <url> --scope "read write" --client-id <id>  # 预注册客户端 / 指定 scope
chainlesschain mcp login <url> --no-open --port 53682          # 打印授权 URL(不开浏览器)/ 自定义回调端口
chainlesschain mcp auth [--json]                               # 列出已存 token(valid/expired/+refresh)
chainlesschain mcp logout <url>                                # 删除 token
```

连接时:`setupMcpFromConfig` 对带 `url` 的 server,若有已存 token → `ensureValidToken`
(到期且有 refresh_token 则刷新)→ 注入 Bearer;**已显式给 `Authorization` 头则不覆盖**。

## Status Line — `statusLine` 自定义状态栏

Claude Code `statusLine` 对标。REPL **每次提示前**渲染一行用户自定义命令的输出
(模型 / 分支 / 花费 / 任意你想显示的)。配置在 `.claude/settings.json`:

```jsonc
{ "statusLine": { "type": "command", "command": "./status.sh", "padding": 0 } }
// 也接受裸字符串:"statusLine": "./status.sh"
```

命令通过 **stdin 收到 JSON 上下文** `{ session_id, model:{id,display_name}, provider,
workspace:{current_dir,project_dir}, cwd }`,其 **首行 stdout** 即状态栏。层级 last-wins;
`false` 可在高层禁用。**best-effort**:命令缺失 / 报错 / 超时(默认 5s)→ 不显示,绝不卡 REPL。

```bash
chainlesschain statusline preview [--model <m>] [--json]   # 渲染一次预览
chainlesschain statusline show [--json]                    # 显示解析后的配置
```

## Hosted Session API (Phase I)

`cc serve` exposes session-core over WebSocket. Route types (dot-case)
return `<type>.response` envelopes with `{ ok, ... }`:

| Type                                         | Payload fields                                                |
| -------------------------------------------- | ------------------------------------------------------------- |
| `sessions.list`                              | `agentId?`, `status?` → `{ sessions[] }`                      |
| `sessions.show`                              | `sessionId` → `{ session, source: "live"\|"parked" }`         |
| `sessions.park`                              | `sessionId` → `{ parked: true }`                              |
| `sessions.unpark`                            | `sessionId` → `{ resumed: true }`                             |
| `sessions.end`                               | `sessionId`, `consolidate?`, `scope?`, `scopeId?`, `agentId?` |
| `sessions.policy.get`                        | `sessionId` → `{ policy }`                                    |
| `sessions.policy.set`                        | `sessionId`, `policy` (strict/trusted/autopilot)              |
| `memory.store`                               | `content`, `scope?`, `scopeId?`, `tags?`, `category?`         |
| `memory.recall`                              | `query?`, `scope?`, `tags?`, `limit?` → `{ results[] }`       |
| `memory.delete`                              | `id` → `{ deleted: true }`                                    |
| `memory.consolidate`                         | `sessionId`, `scope?`, `dryRun?`                              |
| `beta.list` / `beta.enable` / `beta.disable` | `flag` (format `<feature>-YYYY-MM-DD`)                        |
| `usage.session`                              | `sessionId` → `{ usage }`                                     |
| `usage.global`                               | `limit?` → `{ usage: { sessions[], total, byModel[] } }`      |

Streaming routes emit intermediate `stream.event` envelopes followed by a
terminal `<type>.end` envelope:

| Type                 | Payload fields                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream.run`         | `prompt`, `provider?`, `model?`, `baseUrl?`, `apiKey?` → events `{type:"stream.event", event}`, end `{ok, text}`                                                 |
| `sessions.subscribe` | `events?:string[]` (default: all lifecycle) → events `{type:"stream.event", event:{type:"session.<lifecycle>", session}}`, end `{ok, unsubscribed:true, events}` |

Lifecycle values forwarded by `sessions.subscribe`: `created`, `adopted`,
`touched`, `idle`, `parked`, `resumed`, `closed`.

Cancel a streaming request by sending `{type:"cancel", id}` — the server
calls `AbortController.abort()` which detaches listeners (`sessions.subscribe`)
or aborts the in-flight fetch (`stream.run`).

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部。CLI Managed Agents & Hosted Session API：托管 agent + headless 命令。

### 2. 核心特性

cc agent headless / cost / checkpoint / loop / hooks / 权限。

### 3. 系统架构

见正文 / [系统架构](../design/系统设计_主文档.md)（三端 + 双后端 + P2P）。

### 4. 系统定位

ChainlessChain 的「CLI 托管 Agent」。

### 5. 核心功能

见正文各节。

### 6. 技术架构

Electron + Vue3 / Spring Boot + FastAPI / libp2p + Signal / SQLCipher（按需）。

### 7. 系统特点

见正文（步骤 / 版本 / 注意事项）。

### 8. 应用场景

见正文使用场景。

### 9. 竞品对比

见正文对比（如有）。

### 10. 配置参考

见正文配置 / 环境变量章节；`.chainlesschain/config.json`。

### 11. 性能指标

见正文性能 / 资源要求（如有）。

### 12. 测试覆盖

见正文验证步骤（如有）。

### 13. 安全考虑

见正文安全 / 密钥章节；本地加密 + U盾/SIMKey（如适用）。

### 14. 故障排除

见正文故障排查 / 常见问题章节。

### 15. 关键文件

见正文涉及的文件 / 目录。

### 16. 使用示例

见正文命令 / 操作示例。

### 17. 相关文档

[快速开始](./QUICK_START.md)、[安装指南](./INSTALLATION.md)、其它用户文档。
