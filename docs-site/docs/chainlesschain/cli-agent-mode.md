# Agent 模式命令大全（`cc agent`）

> 本章系统介绍 **`cc agent` 模式下可用的全部命令与旗标**——从无头执行、权限网关、检查点回滚，到 MCP / IDE / 设备桥接、循环自动化、结构化输出。
>
> 想看 `agent` 命令的内部架构（工具系统 / Context Engineering / Plan Mode / 自主模式 / Persona）请读 [代理模式 (agent)](./cli-agent) 详细参考；想看去中心化 Agent 网络请读 [Agent 网络](./cli-agent-network)。

`cc agent` 是 ChainlessChain CLI 的**代理式 AI 会话**——对标 Claude Code 的 `claude` / `claude -p`。它在你的终端里跑一个能读写文件、执行命令、搜索代码库、调用技能、联网搜索的智能体，并配有一整套**伴生命令**（`cc cost` / `cc checkpoint` / `cc permissions` / `cc loop` …）围绕它构建可观测、可控制、可脚本化的工作流。

::: tip 两个入口，一套能力
- **交互 REPL**：`cc agent`（短别名 `cc a`）——进入对话式会话，支持排队输入、Esc 中断、`/rewind` 回退、斜杠命令。
- **Headless 无头**：`cc agent -p "<任务>"`——单轮非交互执行后退出，进 CI / 管道 / 脚本。

两个入口共享同一套工具循环、权限规则、记忆体系与桥接发现，只是交互层不同。
:::

---

## 快速开始

```bash
# 1) 交互会话（读 ~/.chainlesschain/config.json 的 llm 配置作默认）
cc agent

# 2) 单轮无头执行
cc agent -p "修复 src/x.js 里的空指针 bug"

# 3) 指定 provider / model（显式旗标永远优先于 config 默认）
cc agent --provider volcengine --model doubao-seed-1-6-251015
cc agent -p "审查这个改动" --provider openai --model gpt-4o

# 4) 从 stdin 读任务、机器可读输出
echo "总结本目录的语言构成" | cc agent -p --output-format json
```

> **配置默认**：不带 `--provider/--model` 的裸 `cc agent` 会读取 `config.json` 的 `llm` 段（provider / model / apiKey / baseUrl），与 `cc chat`、桌面端一致；显式旗标仍然优先。无配置时回落本地 Ollama。

---

## 命令速查表

`cc agent` 之外，下面这些**伴生命令**专为 agent 工作流设计，每条都有独立章节展开：

| 命令 | 用途 |
| --- | --- |
| `cc agent` / `cc agent -p` | 代理会话（交互 / 无头），见下 |
| `cc cost` | 估算 token $ 花费（按 provider / model 拆分） |
| `cc checkpoint` | 文件态快照 / 回滚（agent 改动出问题可还原） |
| `cc compact` | 压缩存档会话的上下文历史 |
| `cc loop` | 定时 / 自适应重复跑一条 prompt 或命令 |
| `cc goal` | 跨会话持久目标 / OKR，agent 每轮对照推进 |
| `cc permissions` | `.claude/settings.json` 权限规则 allow / ask / deny |
| `cc hook` | 生命周期钩子（可拦截工具调用、注入上下文） |
| `cc mcp` | MCP server 管理 + 远程 OAuth 授权 |
| `cc ide` | IDE 桥接发现 / 诊断（连接编辑器 MCP server） |
| `cc pdh` | 设备数据桥接发现 / 诊断（连接安卓 App 采集 server） |
| `cc output-style` | 输出风格 persona（explanatory / learning / 自定义） |
| `cc statusline` | REPL 自定义状态栏 |
| `cc session` | 会话列表 / 查看 / 续接 / 导出 |
| `cc memory` / `cc init` | 项目记忆（`cc.md`）+ 项目盘点 |

---

## 两种运行模式

### 交互 REPL（`cc agent`）

进入对话式会话。除了直接对话，还有这些**会话内能力**：

- **排队输入**：turn 进行中继续打字回车不会触发并发回合，而是 FIFO 排队（灰字 `⏸ queued (N)`），当前 turn 结束自动逐条续跑。
- **Esc 中断**：turn 进行中按 Esc 立即中止本轮（partial 对话保留），排队的输入照常续跑。
- **`/rewind` + 双 Esc**：列出最近 user 轮次，`/rewind <n>` 把对话截断回该轮之前并把原文回填到输入行（改完重发）；空闲时双击 Esc 是快捷键。只回滚对话态，文件态用 `cc checkpoint restore`。
- **REPL 前缀**：`! <cmd>` 直接跑 shell（输出回灌对话上下文）；`# <note>` 一键记到项目 `cc.md`。
- **斜杠命令**：`/cost`、`/permissions`、`/ide`、`/output-style`、`/mcp`、`/rewind` 等会话内即时视图。

### Headless 无头（`cc agent -p`）

单轮非交互执行——进 CI / 管道 / 脚本。prompt 来自 `-p` 值、位置参数或 stdin 管道，跑完即退出（agent 内部仍可多轮工具循环）。

```bash
cc agent -p "fix the bug in x.js"               # 单轮执行后退出
cc agent -p "review @src/x.js"                   # 支持 @path 文件引用
echo "task" | cc agent -p                        # 从 stdin 读取任务
cc agent -p "..." --output-format json           # text(默认) | json | stream-json
cc agent -p "..." --max-turns 5                   # 限制 agent 循环迭代上限
cc agent -p "..." --allowed-tools "read_file,git" # 工具白名单
cc agent -p "..." --disallowed-tools "run_shell"  # 工具黑名单
cc agent -p "..." --add-dir ../lib                # 额外工作根（可重复）
```

**输出格式**（`--output-format`）：

- `text`（默认）——最终回答 → stdout；工具轨迹 → stderr（保证管道纯净）。
- `json`——单个结果信封 `{ type:"result", subtype, is_error, result, session_id, num_turns, duration_ms, tool_calls[], usage }`。
- `stream-json`——逐事件 NDJSON：首行 `system/init`，随后 `tool_use` / `tool_result` / `token_usage`，末行 `result`。加 `--include-partial-messages` 还能拿到逐 token 增量（适合转发 UI）。

**权限模式**（`--permission-mode`，headless 无法弹窗故默认 fail-closed）：

| mode | 层级 | 行为 |
| --- | --- | --- |
| （默认） | STRICT | 拒绝中/高危 shell；文件编辑放行 |
| `plan` | STRICT | 同上，且工具收窄为只读集 |
| `acceptEdits` | TRUSTED | 高危 shell 仍拒，中危放行 |
| `bypassPermissions` | AUTOPILOT | 全放行，不确认 |

退出码：成功 `0`；`--max-turns` 耗尽或错误 `1`。

### 扩展思考与多模态

```bash
cc agent -p "..." --think                  # Anthropic 扩展思考（其它 provider 自动忽略）
cc agent -p "..." --ultrathink             # = --think ultra（最高强度）
cc agent -p "..." --think --thinking-budget 8000   # legacy Claude 的思考 token 预算
cc agent --image shot.png -p "这张图里是什么?" --provider volcengine --model doubao-seed-1-6-251015
```

- **扩展思考**：`--think` / `--think hard` / `--think ultra`（= `--ultrathink`）；自适应思考模型走 effort，legacy 模型走 budget_tokens。
- **图像输入**：`--image`（可重复）给视觉模型附图（png/jpg/jpeg/gif/webp）。**消息里直接写一个本地图片路径**也会被自动识别为视觉输入（命中图片的回合自动切到视觉模型 `config.llm.visionModel`），`CC_AUTO_IMAGE=0` 关闭。

### 备用模型链（`--fallback-model`）

无人值守运行时主模型失败就按序切备用模型重试：

```bash
cc agent -p "..." --fallback-model backup-a --fallback-model backup-b   # 可重复
cc agent -p "..." --fallback-model "backup-a,backup-b,backup-c"          # 或逗号分隔，最多 3 个
```

触发条件：瞬时错误（overload / rate-limit / 5xx / 网络抖动）或**主模型 not-found**（被下线 / 拼错）。普通 4xx（认证 / 配额）不重试。不传旗标时读 `config.llm.fallbackModels`。

---

## 斜杠命令速查（交互 REPL）

在 `cc agent` 交互会话里，输入 `/` 触发 **TAB 补全**会列出全部内置斜杠命令。当前共 **43 个内置斜杠命令**，按类别整理如下（输入 `/help` 看会话内即时帮助）：

### 会话与导航

| 命令 | 说明 |
| --- | --- |
| `/help` | 列出全部可用命令与用法 |
| `/clear` | 清空对话历史（可经 `/rewind clear` 恢复） |
| `/exit` · `/quit` | 退出会话 |
| `/session [resume <id>]` | 显示当前会话 id + 消息数；`resume <id>` 切到另一会话 |
| `/sessions` | 列出最近可续接的会话（只读） |
| `/rewind [n｜clear]` | 回退到第 N 个 user 轮次（空闲双击 Esc 同款列表）；只回滚对话态 |
| `/search <query>` | 全文搜索过往会话（BM25，需 DB） |
| `/export [path]` | 导出对话为 Markdown 文件 |
| `/copy [code]` | 复制最后一条回答到剪贴板；`/copy code` 取最后一个代码块 |

### 模型与思考

| 命令 | 说明 |
| --- | --- |
| `/model [name]` | 显示 / 切换模型（提示弃用模型） |
| `/provider [name]` | 显示 / 切换 provider（ollama / anthropic / openai / deepseek / dashscope / mistral / gemini / volcengine） |
| `/think [on｜off｜hard｜ultra]` | 开关 Anthropic 扩展思考 |
| `/ultrathink` | = `/think ultra`（最高强度） |

### 上下文与记忆

| 命令 | 说明 |
| --- | --- |
| `/context` | 按角色（system / user / assistant / tool）显示实时上下文窗口占用 |
| `/compact` | 智能压缩对话历史（PromptCompressor） |
| `/microcompact` | 就地裁剪 OLD 大型工具结果（保留 recent + 流程） |
| `/memory` | 显示已加载的项目记忆文件（cc.md 层级 + import） |
| `/reindex` | 重建项目笔记 BM25 索引 |
| `/stats` | 显示 Context Engine 统计（笔记 / 错误 / 任务） |
| `/task [objective｜clear]` | 设置 / 清除任务目标（注入上下文） |
| `/todos` | 查看本会话 TODO 列表（agent 用 `todo_write` 工具维护的多步任务） |
| `/profile [show｜set｜clear｜path]` | 查看 / 编辑 `USER.md` 用户画像 |

### 显示与编辑偏好

| 命令 | 说明 |
| --- | --- |
| `/theme [auto｜dark｜light｜mono]` | 切换配色主题（mono = 无色），持久化 |
| `/vim [on｜off]` | 开关 vim 行编辑模式 |
| `/statusline [on｜off]` | 开关提示符上方的上下文用量状态栏 |
| `/output-style [name｜list｜none]` | 切换回答人格（explanatory / learning / 自定义） |
| `/terminal-setup [--apply]` | 配置终端（VS Code Shift+Enter→换行） |
| `/cd [dir]` | 会话中途切换工作目录（补全 / 记忆跟随） |

### 工具与可观测

| 命令 | 说明 |
| --- | --- |
| `/cost` | 本会话 token 花费 + 估算 $（按 model 拆分） |
| `/doctor` | 会话健康检查（provider / key / IDE / MCP / 权限 / hooks） |
| `/config [key｜key=val]` | 查看 / 读写有效配置 |
| `/permissions [tier｜denials]` | 查看 allow/ask/deny 规则；设档位；`denials` 回看被拦调用 |
| `/hooks` | 查看已加载的 `.claude/settings.json` hooks（observe-only DB hooks 用 `cc hook`） |
| `/ide` | IDE 桥接连接状态（编辑器 / 工具 / 诊断） |
| `/mcp [server]` | 已连 MCP server 及其工具 |
| `/review [low｜medium｜high] [--security｜--simplify] [--fix]` | diff-first 代码评审 |
| `/reload-skills` | 不重启重新扫描技能层 |

### 自主与多智能体

| 命令 | 说明 |
| --- | --- |
| `/auto [goal｜status｜pause｜resume｜cancel｜list]` | 自主目标执行（ReAct 循环） |
| `/plan [show｜approve｜reject｜execute｜risk｜interactive]` | Plan Mode：只读分析 → 审批 → DAG 执行 |
| `/cowork [debate｜compare｜graph｜decision]` | 多智能体协作（辩论 / A·B 对比 / 知识图谱 / 架构决策） |
| `/sub-agents` | 查看活跃 / 已完成子代理 + 注册表统计 |
| `/tasks [kill <id>｜kill-all]` | 列出 / 终止后台 shell 任务（`run_in_background`） |

### 非斜杠前缀

| 前缀 | 说明 |
| --- | --- |
| `! <cmd>` | 直接跑 shell（不经 LLM），输出回灌对话上下文 |
| `# <note>` | 一键记到项目 `cc.md`，本/下 session 生效 |
| `\`（行尾） | 多行输入续行 |

### 动态注册的斜杠命令

- **自定义宏**：`.claude/commands/*.md`（项目级 `[proj]` / 个人级 `[pers]`）每个文件就是一条 `/<name>` 命令，支持 `$ARGUMENTS` / `@文件` / `!bash` 展开，TAB 可补全——与 Claude Code 文件格式互通。
- **MCP prompts**：已连 MCP server 暴露的 prompt 自动成为 `/mcp__<server>__<prompt>` 斜杠命令。

---

## 权限与安全

`cc agent` 在工具真正执行前有一层**用户可编辑的 glob 规则**网关。无 `.claude/settings.json` 时行为逐字不变（回落到既有的 risk-tier / ApprovalGate 逻辑）。

### 规则语法 `Tool(pattern)`

工具名两种写法都吃——Claude-Code 伞名或本 CLI 原名（双向别名）：

| 伞名 | 本 CLI 工具 | `pattern` 匹配对象 | 例 |
| --- | --- | --- | --- |
| `Bash` | `run_shell` | 命令字符串 | `Bash(git push:*)`、`Bash(npm run test:*)` |
| `Read` | `read_file` / `list_dir` | 解析后的绝对路径 | `Read(./src/**)` |
| `Edit` | `edit_file` | 路径 | `Edit(//etc/**)`（`//`=绝对） |
| `Write` | `write_file` | 路径 | `Write(./build/**)` |
| `WebFetch` | `web_fetch` | URL host | `WebFetch(domain:example.com)` |
| `Agent` | `spawn_sub_agent` | 子 agent 类型 | `Agent(explorer)` |

**判定顺序**（most-restrictive-wins，denies 先于任何 prompt）：① settings `deny` → 拦 → ② host policy `deny` → 拦 → ③ settings `ask` → 确认 → ④ settings `allow` → 预授权（但**永不**重开 shell 硬黑名单 `curl`/`rm`）。

### `cc permissions` — 查看 / 干跑 / 编辑

```bash
cc permissions list [--json]                                  # 合并后规则集 + 每条来源文件
cc permissions test run_shell "git push origin main"          # 干跑：命中哪条规则→什么判定
cc permissions add deny "Bash(rm:*)"                          # 追加规则（默认 project）
cc permissions add allow "Read(./**)" --local                 # → settings.local.json（个人）
```

`--settings <file>` 还能一次性合并权限 + `model` / `env` 覆盖：

```bash
cc agent -p "跑测试" --settings ci-perms.json
#   ci-perms.json: { "permissions": { "allow": ["Bash(npm run test:*)"], "deny": ["Bash(rm:*)"] } }
```

交互 REPL 里 `run_shell` 撞风险确认时可选 **`[a]lways allow`**：自动推导一条规则写进 `settings.local.json`，本/未来 session 不再问。

### 凭据读取保护

Agent 不应把密钥静默吸进模型上下文。`read_file` / `run_shell` 读 `.env`、`~/.aws/credentials`、私钥（`*.pem`/`*.key`）、打印密钥型环境变量（`echo $ANTHROPIC_API_KEY`）等都被**确认优先 / headless fail-closed** 拦截。`CC_CREDENTIAL_GUARD=0` 关闭。`--safe-mode` **不**关闭此保护（安全面非自定义项）。

### Hooks — 生命周期钩子

`.claude/settings.json` 的 `hooks` 块走 **stdin-JSON + 退出码协议**，可在工具调用前后、prompt 提交、会话起止、压缩前等时点**拦截或注入上下文**：

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "./guard.sh" }] }],
    "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "./fmt.sh" }] }]
  }
}
```

hook `exit 2` = block（reason 来自 stderr）。已接入的事件：`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SessionStart` / `SessionEnd` / `Stop`（可 block→续跑）/ `PreCompact`（可 block→跳过压缩）/ `SubagentStop` / `Notification`。`cc hook test <event> <tool> [--run]` 干跑。

---

## 检查点与回滚

对标 Claude Code 的 "rewind"：有风险的 agent 运行前给文件拍快照，出问题再还原。**git 仓内默认开启**自动快照（shadow-commit 引擎零触工作区/真索引），出问题 `cc checkpoint restore <id>` 回滚到该工具调用之前。

```bash
cc agent -p "重构 auth 模块"          # git 仓内默认就有自动快照
cc agent --no-checkpoint -p "..."     # 本次关闭
cc agent --checkpoint -p "..."        # 非 git 目录强制开（copy 引擎）

cc checkpoint list                    # 列出（最新在前）
cc checkpoint show <id> --diff        # 与当前对比
cc checkpoint restore <id> --force    # 还原（别名 rewind；先自动拍 safety checkpoint）
```

只读工具跳过快照；还原**有破坏性**（非 TTY 必须 `--force`），且还原前自动给当前态拍 safety checkpoint → 回滚本身可再回滚。区别于 `cc workflow checkpoint`（工作流执行态，存 DB）。

---

## 会话、记忆与目标

### 会话续接

```bash
cc agent -p "实现登录" --resume <id>                 # 恢复会话
cc agent -p "继续" --continue                         # 恢复最近一次
cc agent -p "走另一种方案" --resume <id> --fork-session # 不污染原会话，开新分支
cc session list / show / export / search             # 会话管理 + 导出 Markdown + 全文搜索
```

### 项目记忆（`cc.md`）

对标 Claude Code 的 CLAUDE.md 体系。`cc agent` 启动时自动把文件式项目约定注入系统提示（`<project-instructions>` 块）：

| 范围 | 查找顺序（每位置取第一个存在的） |
| --- | --- |
| 用户级 | `~/.chainlesschain/cc.md` → `~/.claude/CLAUDE.md` |
| 项目级（git root → cwd 逐目录） | `cc.md` → `CLAUDE.md` → `AGENTS.md` |
| 本地伴随 | `cc.local.md` → `CLAUDE.local.md` |
| 脚手架规则 | `.chainlesschain/rules.md` |

```bash
cc init                  # 盘点当前文件夹 → 生成 cc.md + 最小 .chainlesschain/
cc memory files          # 查看 agent 自动加载的项目记忆链
```

文件内 `@相对路径` 递归 import（深度 ≤5）；`CC_PROJECT_MEMORY=0` 关闭。

### 目标 / OKR（`cc goal`）

超出 Claude Code 的扩展：一个长期目标，agent 跨多个会话朝它推进，每轮对照注入。

```bash
cc goal set "上线 v2 API" --kr "写完测试" --kr "迁移文档"   # 建目标 + 关键结果
cc agent -p "继续推进" --goal <id>                          # 显式绑定（不带值=自动解析活跃目标）
cc agent -p "实现登录接口" --goal <id> --goal-assess         # 跑完让模型自评进度并写回（opt-in）
```

---

## 上下文自动压缩

对标 Claude Code 的 `/compact`。长会话（尤其 `--resume`）的历史会增长直到撞 provider 的 context window。

- **运行中自动压缩**（headless 默认开）：`agentLoop` 在每轮迭代顶部检查历史是否超阈值，超了就就地压缩；`--resume` 时自动写一条 `compact` 事件，下次续跑直接从压缩后的短历史重建。`options.autoCompact=false` 退出（交互 REPL 走这条）。
- **手动压缩存档会话**（`cc compact <session-id>`）：脚本化 / resume 前预压缩 / 批量维护。

引擎离线确定性（snip + dedup + collapse + truncate，不接 LLM 摘要），且**工具对安全**（绝不留孤儿 tool 结果）。

```bash
cc agent -p "继续" --resume <id> --output-format stream-json   # 超阈值本轮自动压缩
cc compact <session-id> --dry-run                              # 只预览缩减量，不写
```

---

## 花费与状态栏

### `cc cost` — 估算 $ 花费

在 token 计数之上叠加价格层，读同一份 JSONL `token_usage` 事件（纯报表，无新数据采集）：

```bash
cc cost                  # 全局花费汇总（按 provider/model 拆分）
cc cost <sessionId>      # 单会话花费
cc cost --json           # 机器可读
```

本地 provider（ollama / local …）= 免费；未知模型 → `unpriced`（不臆测，单列）。可经 `config.llm.pricing` 覆盖价格。交互 REPL 里 `/cost` 看本会话至今的花费（内存累计，匿名会话也能用）。

### `cc statusline` — 自定义状态栏

对标 Claude Code 的 `statusLine`。REPL 每次提示前渲染一行用户自定义命令的输出（模型 / 分支 / 花费 / 任意）：

```jsonc
// .claude/settings.json
{ "statusLine": { "type": "command", "command": "./status.sh" } }
```

命令通过 stdin 收到 JSON 上下文，首行 stdout 即状态栏。best-effort：报错 / 超时（默认 5s）不显示，绝不卡 REPL。`cc statusline preview` 渲染预览。

---

## 工具生态（MCP / IDE / 设备 / 联网）

agent 循环可挂接四类外部工具源，工具名统一 `mcp__<server>__<tool>`，合并进同一 client。

### MCP — 把工具喂给 agent

```bash
cc agent -p "纽约天气?" --mcp-config ./mcp.json    # 临时挂载（Claude Code --mcp-config 对标）
cc mcp add weather -c npx -a "-y,@modelcontextprotocol/server-weather" --auto-connect  # 注册（持久）
cc agent -p "..." --no-mcp                          # 跳过注册的自动连接
cc agent --project-mcp -p "..."                     # 加载项目 .mcp.json（默认关，供应链安全）
cc mcp login https://mcp.example.com/mcp            # 远程 MCP server OAuth 授权（PKCE）
```

MCP 资源（`list_mcp_resources` / `read_mcp_resource`）与 prompts（交互 REPL 里的 `/mcp__server__prompt` 斜杠命令）也自动暴露。

### IDE 桥接 — 自动连接编辑器

运行中的编辑器扩展（VS Code / JetBrains）跑一个本地 MCP server，`cc agent` 在其集成终端里**自动发现并连接**（保留名 `ide`）。连上后 agent 主动感知编辑器状态：选区随 prompt 注入、编辑后诊断自动回喂、编辑审批走编辑器原生 diff。

```bash
cc agent -p "修下选区里的 bug"     # 在 IDE 集成终端内自动连接
cc agent -p "..." --ide / --no-ide # 强制启用 / 禁用
cc ide list / status / doctor       # 发现 / 诊断
```

完整安装见 [IDE 桥接](./ide-bridge)。交互 REPL 里 `/ide` 看本会话桥接状态。

### PDH 桥接 — 自动连接安卓 App 的设备数据采集

第四条 MCP 源搬到手机：安卓 App 跑一个"设备能力 MCP server"，`cc agent` 自动发现（保留名 `pdh`），**让 agent 第一次能主动指挥设备采集自己的数据**。

```bash
cc agent "采集本机系统数据入库"     # App 内置终端自动连接 → mcp__pdh__collect_system_data
cc agent --pdh / --no-pdh "..."     # 强制启用 / 禁用
cc pdh list / status / doctor        # 发现 / 诊断
```

完整说明见 [PDH Bridge 个人数据 IDE 桥接](./pdh-bridge)。

### Web Search — 联网搜索

agent 循环原生带 `web_search`（配合 `web_fetch`：先搜出 URL，再抓正文）。搜索后端可插拔，经 `.chainlesschain/config.json:webSearch` 配置（auto / tavily / brave / bocha / qianfan / duckduckgo / searxng / baidu，含免 key 源）。

---

## 循环与自动化（`cc loop`）

把**一件事**按固定间隔重复跑，直到停止条件命中或 Ctrl-C（对标 Claude Code `/loop`）：

```bash
cc loop "检查 CI 是否通过，失败就总结原因"          # 无 `--` → prompt，内部跑 cc agent -p
cc loop --every 30s -- npm test                    # 有 `--` → 外部命令
cc loop --every 30s --until-exit-zero -- npm test  # 测试一过就停
cc loop --every 1m --until "DONE" "轮询部署状态"     # 输出匹配正则就停
cc loop --dynamic "盯着部署，上线了就停"             # 每轮由输出里的指令决定下一步
cc loop --save ci-watch --every 1m -- npm test     # 持久成可续跑会话
```

`--dynamic` 模式下 agent 自报下次间隔（`[[loop:next 30s]]`）或收尾（`[[loop:stop]]`）。比 `cc ccron`（只治理状态机）和 `cc automation`（DB 持久 flow/trigger 引擎）都轻——只是给一条命令套个计时器。

---

## 输出风格与结构化输出

### `cc output-style` — 人格

对标 Claude Code 的 `/output-style`。给 agent 套一层命名、可复用的人格（追加到系统提示之后，保留编码能力、改变行为/语气）：

```bash
cc agent -p "..." --output-style explanatory   # headless 套人格（内置 explanatory / learning）
cc output-style list / show / new <name>        # 列出 / 查看 / 脚手架到 .claude/output-styles/
# .claude/settings.json: { "outputStyle": "learning" }   # 项目默认
```

### 结构化输出（`--json-schema`）

最终回答必须是通过 JSON Schema 校验的 JSON，校验失败带错误清单纠错重跑（共 3 次），stdout 只打印校验通过的 JSON。脚本消费 `cc agent -p` 从此不用 parse 自由文本：

```bash
cc agent -p "列出本目录的语言构成" --json-schema schema.json
```

与 `--output-format stream-json` 互斥。

---

## 配置与隔离

```bash
cc agent --safe-mode -p "..."     # 裸跑：禁用项目记忆 / settings hooks / 记忆召回 / IDE 上下文 / 状态栏 / 更新提醒（权限规则仍生效）
cc agent --worktree -p "..."      # 在新建的 git worktree 里跑（隔离分支，零改动自动移除）
cc agent --add-dir ../lib -p "..." # 额外工作根（可读/搜/编辑，可重复）
cc agent --max-budget-usd 0.50 -p "..."  # 硬性 $ 上限：到达预算前停止下一次付费 LLM 调用
```

常用环境开关：`CC_PROJECT_MEMORY=0`（关项目记忆）、`CC_CREDENTIAL_GUARD=0`（关凭据保护）、`CC_IDE_CONTEXT=0`（关 IDE 自动注入）、`CC_AUTO_IMAGE=0`（关图片自动识别）、`CC_PROMPT_CACHE=0`（关 Anthropic prompt 缓存）。

---

## 与 Claude Code 斜杠命令对比（差距清单）

下表把 **Claude Code 的主要内置斜杠命令**逐条对到 cc 的现状。结论：cc 的斜杠命令**并不少**（43 个内置 + 自定义宏 + MCP prompts），在自主 / 多智能体 / provider 切换 / 跨会话搜索等维度**超出** Claude Code；真正的差距是少数几个，已整理成下面的「待补清单」逐个完善。

> 图例：✅ 已有 ｜ 🔶 部分（仅旗标 / 仅 CLI / 不同命名）｜ ❌ 缺（计划补）｜ ⊘ N/A（Claude 产品 / 账号专属，cc 设计上不需要）

| Claude Code 命令 | cc 状态 | 说明 |
| --- | --- | --- |
| `/help` `/clear` `/exit` `/quit` | ✅ | 一一对应 |
| `/compact` | ✅ | `/compact`（另有 `/microcompact`） |
| `/context` | ✅ | `/context` |
| `/cost` | ✅ | `/cost`（+ `cc cost`） |
| `/config` | ✅ | `/config` |
| `/model` | ✅ | `/model`（+ `/provider`） |
| `/doctor` | ✅ | `/doctor` |
| `/export` | ✅ | `/export`（+ `/copy`） |
| `/memory` | ✅ | `/memory`（+ `#` 前缀记笔记） |
| `/mcp` | ✅ | `/mcp`（+ `cc mcp login` OAuth） |
| `/permissions` | ✅ | `/permissions`（+ `denials` 子视图） |
| `/output-style` | ✅ | `/output-style` |
| `/statusline` | ✅ | `/statusline` |
| `/terminal-setup` | ✅ | `/terminal-setup` |
| `/rewind` | ✅ | `/rewind`（+ 双 Esc + `cc checkpoint`） |
| `/review` | ✅ | `/review`（含 `--security`/`--simplify`/`--fix`） |
| `/ide` | ✅ | `/ide` |
| `/vim` | ✅ | `/vim` |
| `/resume` | ✅ | `/sessions`（列表）+ `/session resume <id>` |
| `/bashes` | ✅ | `/tasks`（列出 + kill 后台 shell 任务，命名不同） |
| 自定义 `.claude/commands/*.md` | ✅ | `/<name>`，proj/pers 作用域 |
| `/mcp__server__prompt` | ✅ | 已支持 |
| `/hooks` | ✅ | `/hooks`（查看已加载的 settings.json hooks；observe-only DB hooks 用 `cc hook`）— *2026-06-28 补* |
| `/todos` | ✅ | `/todos`（查看本会话 TODO 列表）— *2026-06-28 补* |
| `/add-dir` | 🔶 | cc 有 `--add-dir` 旗标，**无 `/add-dir` REPL 命令** → 可补 |
| `/init` | 🔶 | cc 有 `cc init` CLI，**无 `/init` REPL 命令** → 可补 |
| `/agents` | 🔶 | cc 有 `/sub-agents`（查看）+ `cc agents` CLI，**无交互式子代理管理/创建** → 可补 |
| `/status` | 🔶 | `/doctor` + `/config` 覆盖大半，**无单一账号/版本摘要** → 低优先 |
| `/pr-comments` | ❌ | 拉取 GitHub PR 评论，**cc 无等价** → 可补（feature） |
| `/release-notes` | ❌ | cc 无；可经 `cc update` / CHANGELOG → 低优先 |
| `/login` `/logout` | ⊘ | Claude 账号登录；cc 用 config api key（`cc mcp login` 是 MCP OAuth，不同） |
| `/bug` `/feedback` | ⊘ | 发会话给 Anthropic；cc 无账号体系 |
| `/usage` | ⊘ | Claude 订阅用量限额（账号）；cc 用 `/cost` 看花费 |
| `/privacy-settings` | ⊘ | Claude 产品/账号隐私设置 |
| `/install-github-app` | ⊘ | Claude GitHub App；cc 用 `cc-agent-mention.yml` workflow 替代 |

### 待补清单（roadmap，逐个完善）

按价值 / 成本排序，逐个补齐。已完成的划掉：

- ~~**`/hooks`** — REPL 内查看 settings.json hooks~~ ✅ **已补（2026-06-28）**
- ~~**`/todos`** — REPL 内查看当前会话 TODO 列表~~ ✅ **已补（2026-06-28）**
- **`/add-dir`**（🔶）— 会话中途加额外工作根（`--add-dir` 逻辑已有，包装成 REPL 命令）。
- **`/init`**（🔶）— 会话内触发项目盘点（`cc init` 已有）。
- **`/agents`**（🔶）— 交互式子代理配置 / 创建（当前 `/sub-agents` 仅查看）。
- **`/pr-comments`**（❌）— 拉取并注入 GitHub PR 评论（新 feature）。
- **`/status` / `/release-notes`**（🔶/❌，低优先）— 版本 / 环境摘要、发版说明。

> ⊘ 类（`/login`、`/bug`、`/usage`、`/privacy-settings`、`/install-github-app`）是 Claude Code 的产品 / 账号专属能力，cc 采用本地 config + 去中心化身份模型，设计上不对标。

---

## 相关文档

- [代理模式 (agent)](./cli-agent) — agent 命令的内部架构、Context Engineering、Plan Mode、自主模式、Persona、性能指标
- [Agent 网络 (agent-network)](./cli-agent-network) — 去中心化 Agent 节点注册、发现、信誉加权任务路由
- [IDE 桥接](./ide-bridge) — VS Code / JetBrains 扩展安装、发现协议、排错
- [PDH Bridge 个人数据 IDE 桥接](./pdh-bridge) — 安卓 App 设备数据采集桥接
- [CLI 命令总览](./cli) — 全部顶层命令
