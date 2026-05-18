# 代理模式 (agent)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🤖 **Claude Code 风格**: 代理式 AI 会话，自主完成任务
- 🔧 **9 个内置工具**: 读写文件、执行命令、搜索代码库、代码执行
- 🎯 **138 个技能**: 集成全部内置技能
- 📋 **Plan Mode**: AI 制定计划，用户审批后执行
- 💾 **会话持久化**: 自动保存，支持 `--session` 断点恢复
- 🧠 **Context Engineering**: 6 维上下文注入（Instinct / Memory / BM25 Notes / Task / Permanent Memory / Compaction Summary）
- 🗜️ **智能压缩**: 基于重要性评分的对话压缩（替代硬编码截断）
- 🔗 **Hook 管道**: PreToolUse/PostToolUse/ToolError 钩子集成
- 🤖 **自主模式**: /auto 命令提交目标，AI 自动分解执行
- ⚠️ **DAG 执行 + 风险评估**: /plan execute 按依赖拓扑排序执行，/plan risk 显示风险评分
- 🎯 **SlotFiller 意图检测**: 自动检测用户消息中的缺失参数，交互式补全后再调用 LLM
- 🎭 **Persona 系统**: 项目级 AI 角色配置，自动替换默认编码助手，支持工具权限控制

## 系统架构

```
agent 命令 → agent.js (Commander) → agent-repl.js
                                         │
     ┌──────────┬──────────┬─────────────┼──────────────┬─────────────┬──────────┐
     ▼          ▼          ▼             ▼              ▼             ▼          ▼
  工具系统   Plan Mode  Hook管道   Context Engine    会话管理    Autonomous  Bootstrap
 (16 tools) (plan-mode) (hook-     (cli-context-    (session-    Agent     (bootstrap.js)
                        manager)    engineering.js)  manager)   (ReAct)        │
     │          │          │             │              │          │      7-stage init
     ▼          ▼          ▼             ▼              ▼          ▼        (DB/Config)
 read/write  只读→计划→  PreToolUse   6维注入:        自动保存   /auto
 edit/shell  审批→执行   PostToolUse  Instinct        到SQLite   目标分解
 search/code DAG执行     ToolError    Memory          断点恢复   ReAct循环
 skill/list  风险评估                 BM25 Notes               自动纠错
                                      Task重述
                                      Permanent Memory
                                      Compaction Summary
                          Multi-Provider (10 LLM)
                          Task Model Selector
```

## 概述

启动 Claude Code 风格的代理式 AI 会话。AI 可读写文件、执行命令、搜索代码库、运行代码脚本（Python/Node.js/Bash）、调用 138 个内置技能。
支持 8 个 LLM 提供商（ollama/anthropic/openai/deepseek/dashscope/mistral/gemini/volcengine）和自主模式（/auto）。Agent 模式下自动根据任务类型智能选择最佳模型。
通过 6 维 Context Engineering 自动注入用户偏好（Instinct）、相关记忆（Hierarchical Memory）、相关笔记（BM25 搜索）、任务目标提醒、跨会话持久记忆（Permanent Memory）和压缩摘要（Compaction Summary），使 AI 保持上下文聚焦。

**Persona 支持**: 当项目配置了 Persona（通过 `init --template medical-triage` 或 `persona set`），Agent 自动使用自定义角色替代默认编码助手，并按 `toolsDisabled` 过滤可用工具。详见 [Persona 命令](./cli-persona)。

## 命令参考

```bash
chainlesschain agent                    # 默认: Ollama qwen2.5:7b
chainlesschain a --model llama3         # 短别名
chainlesschain agent --provider openai --api-key sk-...
chainlesschain agent --session <id>     # 恢复历史会话
```

> `agent` 命令的短别名为 `a`，两者完全等价。

### 命令选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--model <model>` | LLM 模型名称 | `qwen2.5:7b` |
| `--provider <provider>` | LLM 提供商（ollama/anthropic/openai/deepseek/dashscope/mistral/gemini/volcengine） | `ollama` |
| `--base-url <url>` | API 基础 URL | `http://localhost:11434` |
| `--api-key <key>` | API 密钥 | — |
| `--session <id>` | 恢复历史会话 | — |

## 内置工具

代理模式提供 16 个内置工具（v0.47.0）：

| 工具                | 说明                 |
| ------------------- | -------------------- |
| `read_file`         | 读取文件内容（支持 `hashed: true` 返回带哈希锚点的内容） |
| `write_file`        | 写入文件             |
| `edit_file`         | 编辑文件（查找替换） |
| `edit_file_hashed`  | 基于内容哈希锚点的行编辑（抗空白/行号漂移） |
| `run_shell`         | 执行 Shell 命令（超时 60s，输出截断 30KB） |
| `git`               | Git 操作封装（status / diff / log / commit 等） |
| `search_files`      | 搜索文件内容         |
| `search_sessions`   | 跨历史会话语义搜索   |
| `list_dir`          | 列出目录内容         |
| `run_skill`         | 运行内置技能         |
| `list_skills`       | 列出可用技能         |
| `run_code`          | 编写并执行代码（Python/Node.js/Bash），超时 1-300s，输出截断 50KB |
| `spawn_sub_agent`   | 分派独立上下文的子代理（支持 `profile: explorer/executor/design`） |
| `web_fetch`         | 抓取 URL 内容（默认拒绝私网 / SSRF 防护） |
| `todo_write`        | 会话级待办清单（open-agents 对标） |
| `ask_user_question` | 主动向用户提问并阻塞等待回答 |

### run_code 工具详情

`run_code` 是 v0.40.3 新增的代码执行工具，让 AI 能主动编写脚本解决用户问题。

**参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `language` | string | 是 | 编程语言：`python`、`node`、`bash` |
| `code` | string | 是 | 要执行的代码 |
| `timeout` | number | 否 | 超时时间（秒），默认 60，最大 300 |

**执行流程**：
1. 代码写入临时文件（`os.tmpdir()` + 时间戳）
2. 根据语言选择解释器（`python3`/`python`、`node`、`bash`）
3. 执行并捕获输出（最大 50KB）
4. 返回 `{ success, output, language, duration }` 或错误信息
5. 清理临时文件

**语言选择建议**：
- **Python**: 数据处理、数学计算、Web 抓取、文件批量操作
- **Node.js**: JSON 处理、API 调用、npm 生态相关
- **Bash**: 系统管理、文件操作、管道命令

**使用示例**：
```
> 帮我统计当前目录下每种文件类型的数量

🤖 好的，我来写个脚本统计：
[run_code: node (156 chars)]
  .js: 42
  .json: 8
  .md: 15
  .test.js: 23
共 88 个文件
```

## Auto Pip-Install (自动安装 Python 包)

> v0.40.3+ 新增

当 `run_code` 工具执行 Python 代码遇到 `ModuleNotFoundError` 时，会自动尝试 `pip install` 安装缺失的包，然后重新执行脚本。

### 工作流程

1. 执行 Python 脚本 → 捕获 `ModuleNotFoundError: No module named 'pandas'`
2. 从错误消息中提取包名（取顶层名称：`foo.bar` → `foo`）
3. 通过 `isValidPackageName()` 验证包名安全性（拒绝 Shell 元字符）
4. 执行 `python3 -m pip install pandas`（超时 120s）
5. 重新执行脚本，返回结果

### 返回示例

```json
{
  "success": true,
  "output": "DataFrame shape: (100, 5)\n...",
  "language": "python",
  "duration": "1523ms",
  "autoInstalled": ["pandas"],
  "scriptPath": ".chainlesschain/agent-scripts/2026-03-15-10-30-45-python.py"
}
```

### 安全防护

`isValidPackageName()` 使用正则 `/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/` 验证包名：
- ✅ 合法：`pandas`, `scikit-learn`, `python_dotenv`, `Flask`
- ❌ 拒绝：`foo; rm -rf /`, `$(whoami)`, `foo|bar`, 空字符串, 超过 100 字符

## Script Persistence (脚本持久化)

> v0.40.3+ 新增

`run_code` 工具默认将脚本保存到项目目录下，方便后续查看和复用。

### 持久化模式（默认）

```
.chainlesschain/agent-scripts/
├── 2026-03-15-10-30-45-python.py
├── 2026-03-15-10-31-02-node.js
└── 2026-03-15-10-32-18-bash.sh
```

- 文件名格式：`YYYY-MM-DD-HH-MM-SS-{language}.{ext}`
- 自动创建 `.chainlesschain/agent-scripts/` 目录
- 返回结果中 `scriptPath` 字段指向保存路径

### 临时模式（`persist: false`）

- 脚本写入 `os.tmpdir()`
- 执行完毕后自动清理（`finally` 块中 `unlinkSync`）
- 返回结果中 `scriptPath` 为 `undefined`

## Error Classification (错误分类)

> v0.40.3+ 新增

`run_code` 执行失败时，`classifyError()` 函数将错误分为 5 种类型，每种附带 `hint` 字段提供可操作的修复建议。

| errorType | 匹配模式 | hint 示例 |
|-----------|---------|-----------|
| `import_error` | `ModuleNotFoundError`, `ImportError` | `Missing Python module "pandas". Will attempt auto-install.` |
| `syntax_error` | `SyntaxError`, `IndentationError` | `Syntax error on line 15. Check for typos.` |
| `timeout` | `ETIMEDOUT`, `timed out`, exitCode=null | `Script timed out. Consider increasing timeout.` |
| `permission_error` | `EACCES`, `Permission denied` | `Permission denied. Try a different directory.` |
| `runtime_error` | 其他所有错误 | `Runtime error near line 42. Check traceback.` |

### 返回示例（错误）

```json
{
  "error": "ModuleNotFoundError: No module named 'pandas'",
  "stderr": "...",
  "exitCode": 1,
  "language": "python",
  "errorType": "import_error",
  "hint": "Missing Python module \"pandas\". Will attempt auto-install.",
  "scriptPath": ".chainlesschain/agent-scripts/2026-03-15-10-30-45-python.py"
}
```

## Environment Detection (环境检测)

> v0.40.3+ 新增

`getEnvironmentInfo()` 在进程启动时检测运行环境信息，缓存后注入到 System Prompt 中，帮助 LLM 感知宿主环境。

### 检测项

| 字段 | 说明 | 示例 |
|------|------|------|
| `os` | 操作系统 | `win32`, `linux`, `darwin` |
| `arch` | 架构 | `x64`, `arm64` |
| `python` | Python 解释器 | `python3 (3.11.0)` 或 `null` |
| `pip` | pip 是否可用 | `true` / `false` |
| `node` | Node.js 版本 | `v22.12.0` |
| `git` | Git 是否可用 | `true` / `false` |

### System Prompt 注入

```
## Environment
OS: win32 (x64)
Python: python3 (3.11.0) + pip
Node.js: v22.12.0
Git: available
```

### 架构图

```
agent-core.js （中心模块）
    │
    ├── AGENT_TOOLS (9 工具定义)
    ├── getBaseSystemPrompt() ← getEnvironmentInfo()
    ├── executeTool() → executeToolInner() → _executeRunCode()
    │                                           ├── classifyError()
    │                                           ├── isValidPackageName()
    │                                           └── getCachedPython()
    ├── chatWithTools() → 10 LLM providers
    ├── agentLoop() → 异步生成器 (slot-filling + tool loop)
    └── formatToolArgs()
```

## Context Engineering

代理模式集成了轻量级 Context Engineering 适配器（`cli-context-engineering.js`），在每次 LLM 调用前自动构建优化的上下文消息。

### 6 维上下文注入

| 注入器 | 数据源 | 说明 |
|--------|--------|------|
| **Instinct** | `instinct-manager.js` | 从学习到的用户偏好生成提示（编码风格、工具偏好等） |
| **Memory** | `hierarchical-memory.js` | 召回与当前查询相关的四层记忆（working→core） |
| **BM25 Notes** | `bm25-search.js` + `notes` 表 | 搜索笔记库中的相关内容（topK: 3, threshold: 0.5） |
| **Task Reminder** | 内置 | 重述当前任务目标和进度，保持 AI 聚焦 |
| **Permanent Memory** | `permanent-memory.js` | 跨会话持久记忆 + Daily Notes + MEMORY.md |
| **Compaction Summary** | 内置 | 被压缩消息的单行摘要，支持上下文恢复 |

### 稳定前缀缓存 (Stable Prefix Cache)

Context Engineering 按固定顺序排列注入内容（System Prompt → Instinct → Memory → Notes → Task → Permanent Memory），确保 LLM 的 KV-Cache 前缀尽量稳定。当上下文内容不变时，LLM 可复用已缓存的计算结果，显著降低推理延迟。

### System Prompt 优化

- 清理时间戳 → `[DATE]`、UUID → `[UUID]`、session ID → `[SESSION]`
- 提升 KV-Cache 命中率，减少重复计算

### 错误学习

- 自动记录最近 10 条错误及解决方案
- 注入到上下文中，避免 AI 重复犯错

### 智能压缩 (`/compact`)

基于重要性评分的对话压缩（替代简单的 "保留最后 4 条"）：
- 始终保留 System Prompt
- 评分维度：时间近、含 tool_calls、关联任务目标
- 默认保留得分最高的 6 对消息

### 优雅降级

- 无 DB 时自动跳过所有注入，使用静态 System Prompt
- 每个注入步骤独立 try/catch，单个失败不影响其他

## 斜杠命令

### 基础命令

| 命令             | 说明                                 |
| ---------------- | ------------------------------------ |
| `/exit`          | 退出代理                             |
| `/help`          | 显示所有命令帮助                     |
| `/model <name>`  | 切换/查看模型                        |
| `/provider <p>`  | 切换/查看提供商，支持 8 个提供商 (ollama/anthropic/openai/deepseek/dashscope/mistral/gemini/volcengine) |
| `/clear`         | 清空对话历史                         |
| `/compact`       | 智能压缩对话（基于重要性评分）       |

### Context Engineering 命令

| 命令                      | 说明                                 |
| ------------------------- | ------------------------------------ |
| `/task <objective>`       | 设置当前任务目标                     |
| `/task clear`             | 清除任务                             |
| `/session`                | 显示当前 Session ID 和消息数         |
| `/session resume <id>`    | 加载历史会话消息                     |
| `/reindex`                | 重新索引笔记到 BM25                  |
| `/stats`                  | 显示 Context Engine 统计信息         |

### Plan Mode 命令

| 命令             | 说明                         |
| ---------------- | ---------------------------- |
| `/plan`          | 进入规划模式                 |
| `/plan show`     | 查看当前计划                 |
| `/plan approve`  | 批准计划并开始执行           |
| `/plan reject`   | 拒绝计划，重新规划           |
| `/plan exit`     | 退出规划模式                 |
| `/plan execute`  | 按 DAG 依赖顺序执行计划      |
| `/plan risk`     | 显示风险评估报告             |

### Cowork 命令

| 命令                          | 说明                         |
| ----------------------------- | ---------------------------- |
| `/cowork debate <file>`       | 多视角代码评审               |
| `/cowork compare <prompt>`    | A/B 方案对比                 |
| `/cowork graph`               | ASCII 代码知识图谱           |
| `/cowork decision`            | 决策追踪知识库               |

### 自主模式命令

| 命令                | 说明                         |
| ------------------- | ---------------------------- |
| `/auto <goal>`      | 提交目标，AI 自主分解执行    |
| `/auto status`      | 查看当前自主目标进度         |
| `/auto pause`       | 暂停自主执行                 |
| `/auto resume`      | 恢复自主执行                 |
| `/auto cancel`      | 取消当前目标                 |
| `/auto list`        | 列出所有目标（含历史）       |

## Plan Mode

代理模式内置 Plan Mode（规划模式），让 AI 在执行复杂任务前先制定计划并获得用户审批。

### 规划模式工作流

1. 用户输入 `/plan` 或 AI 自动判断需要规划
2. AI 进入只读模式（仅允许 `read_file`、`search_files`、`list_dir`）
3. AI 生成结构化计划，包含步骤、依赖和风险评估
4. 用户审批（`/plan approve`）后 AI 开始执行
5. 用户可随时拒绝（`/plan reject`）要求重新规划

### 使用示例

```
> /plan

📋 已进入规划模式。请描述您的任务。

> 重构认证模块，从 session 迁移到 JWT

🤖 正在分析代码库...
[只读: read_file auth/session.js]
[只读: search_files "authentication"]

📋 计划:
1. 创建 JWT 工具模块
2. 修改登录接口返回 JWT token
3. 添加 JWT 验证中间件
4. 更新受保护路径
5. 移除 session 依赖
6. 添加单元测试

> /plan approve
✅ 开始执行计划...
```

## 自主模式 (Autonomous Agent)

代理模式内置自主模式，用户只需提交高层目标，AI 自动分解为子任务并循环执行，无需手动逐步指令。

### ReAct 循环

自主模式采用 ReAct（Reason → Act → Observe）循环：

1. **Reason**: AI 分析当前目标和已完成的子任务，决定下一步行动
2. **Act**: 调用工具（读写文件、执行命令、搜索等）执行子任务
3. **Observe**: 观察工具输出，评估结果是否符合预期
4. **重复**: 回到 Reason，直到目标完成或达到 Token 预算上限

### 核心特性

- **目标分解**: 自动将高层目标拆分为可执行的子任务序列
- **自我纠错**: 工具调用失败时自动分析原因并尝试替代方案
- **Token 预算**: 可配置的 Token 消耗上限，防止无限循环
- **进度追踪**: `/auto status` 实时查看已完成/剩余子任务
- **暂停/恢复**: `/auto pause` 和 `/auto resume` 控制执行节奏

### 使用示例

```
> /auto 为项目添加完整的 CI/CD 配置（GitHub Actions + Docker）

🤖 目标已接收，正在分解...
  子任务 1: 分析项目结构和依赖
  子任务 2: 创建 .github/workflows/ci.yml
  子任务 3: 创建 Dockerfile
  子任务 4: 创建 docker-compose.yml
  子任务 5: 添加测试和构建步骤
  子任务 6: 验证配置正确性

[Reason] 开始分析项目结构...
[Act] read_file: package.json
[Observe] Node.js 项目，使用 Vitest 测试...
[Reason] 需要创建 CI 工作流...
[Act] write_file: .github/workflows/ci.yml
...

✅ 目标完成！已创建 4 个文件，所有配置已验证。

> /auto status
目标: 为项目添加完整的 CI/CD 配置
状态: ✅ 已完成 (6/6 子任务)
Token 消耗: 12,450 / 50,000
```

## SlotFiller 意图检测

> v0.41.1 新增

Agent 模式集成了 SlotFiller 参数槽填充引擎，在调用 LLM 之前自动检测用户消息中的已知意图，补全缺失的必需参数。

### 支持的意图类型

| 意图类型 | 触发关键词 | 必需参数 |
|----------|-----------|---------|
| `create_file` | create a file, new file, scaffold | fileType, path |
| `deploy` | deploy, ship it, push to prod | platform |
| `refactor` | refactor, restructure | target |
| `test` | write tests, add test, unit test | target |
| `analyze` | analyze, audit, review code | — |
| `search` | search for, find all, grep | query |
| `install` | install, add package | package |
| `generate` | generate, create component | — |
| `edit_file` | edit file, modify file | target |

### 工作流程

1. 用户输入消息（如 "deploy this"）
2. `CLISlotFiller.detectIntent()` 检测到 `deploy` 意图
3. 检查必需参数 `platform` 缺失
4. 通过 InteractionAdapter 向用户提问 "Which platform?"
5. 用户回答 "docker"
6. 补全结果注入到用户消息末尾：`[Context — user provided: platform: docker]`
7. 带有完整上下文的消息发送给 LLM

### 使用示例

```
> deploy this

? Which platform do you want to deploy to?
  > docker
  > vercel
  > aws
  > heroku

[SlotFiller] platform = "docker"

🤖 好的，我来帮你部署到 Docker...
[run_shell: docker build -t myapp .]
```

未识别的意图（如 "help me understand this code"）不会触发 SlotFiller，直接传给 LLM 处理。

## 使用示例

### 基础使用

```
> 帮我重构 src/utils/helper.js，提取公共方法

🤖 我来分析这个文件...
[调用 read_file: src/utils/helper.js]
[调用 edit_file: 提取公共方法到 src/utils/common.js]
[调用 run_skill: code-review 检查重构质量]

已完成重构，提取了 3 个公共方法到 common.js。
```

### 使用火山引擎（豆包）Agent 模式

```bash
# 设置环境变量
export VOLCENGINE_API_KEY=ark-xxxxxxxxxxxx

# 启动 Agent（默认旗舰模型 doubao-seed-1-6-251015）
chainlesschain agent --provider volcengine

# 指定代码模型
chainlesschain agent --provider volcengine --model doubao-seed-1-6-251015
```

Agent 模式下会自动根据任务类型智能选择最佳模型：

```
you> 写一个 Python 快速排序函数
[auto] 代码任务 → doubao-seed-1-6-251015
ai>  def quicksort(arr): ...

you> 分析 TCP 三次握手的过程
[auto] 复杂推理 → doubao-seed-1-6-251015
ai>  TCP三次握手过程如下：...

you> 今天天气怎么样？
ai>  (使用默认模型，快速响应)
```

### 使用 OpenAI / DeepSeek Agent 模式

```bash
# OpenAI
export OPENAI_API_KEY=sk-xxxxxxxxxxxx
chainlesschain agent --provider openai --model gpt-4o

# DeepSeek
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx
chainlesschain agent --provider deepseek --model deepseek-chat
```

### 通过中转站使用 Agent 模式（无需科学上网）

```bash
# 通过 API2D 中转站使用 GPT-4o
chainlesschain agent \
  --provider openai \
  --base-url https://oa.api2d.net/v1 \
  --api-key fk-xxxxxx \
  --model gpt-4o

# 通过 One-API 网关
chainlesschain agent \
  --provider openai \
  --base-url http://localhost:3000/v1 \
  --api-key sk-oneapi-xxxxxx \
  --model gpt-4o

# 火山引擎通过代理
chainlesschain agent \
  --provider volcengine \
  --base-url https://your-proxy.com/volcengine/v3 \
  --model doubao-seed-1-6-251015

# 企业 Nginx 反向代理
chainlesschain agent \
  --provider openai \
  --base-url https://ai-gateway.company.com/v1 \
  --model gpt-4o
```

> **提示**: `--base-url` 覆盖提供商默认地址，但保留 OpenAI 兼容的 API 格式。所有支持 `/chat/completions` 接口的中转站和代理均可使用。

### Context Engineering 使用

```
> /task 重构认证模块

✓ Task set: 重构认证模块

> 查看当前进度

🤖 当前任务: 重构认证模块
[Context Engine 自动注入任务提醒 + 相关记忆 + 用户偏好]
...

> /stats

DB connected: true
Notes indexed: 42
Error history: 0
Active task: true
```

### 会话恢复

```bash
# 第一次会话
chainlesschain agent
> 帮我写一个 API 服务
> /exit

# 恢复上次会话
chainlesschain agent --session session-17...
Resumed session session-17... (8 messages)
> 继续上次的工作
```

## 关键文件

- `packages/cli/src/commands/agent.js` — 命令入口（含 `--session` 选项）
- `packages/cli/src/repl/agent-repl.js` — 代理 REPL（9 工具 + 138 技能 + Plan Mode + Context Engineering）
- `packages/cli/src/lib/cli-context-engineering.js` — Context Engineering 适配器（6 维注入 + 智能压缩）
- `packages/cli/src/lib/plan-mode.js` — Plan Mode 实现
- `packages/cli/src/lib/instinct-manager.js` — Instinct 学习引擎
- `packages/cli/src/lib/hierarchical-memory.js` — 四层记忆系统
- `packages/cli/src/lib/bm25-search.js` — BM25 搜索引擎
- `packages/cli/src/lib/session-manager.js` — 会话持久化
- `packages/cli/src/lib/permanent-memory.js` — 跨会话持久记忆（Daily Notes + MEMORY.md + BM25 混合搜索）
- `packages/cli/src/lib/autonomous-agent.js` — ReAct 自主任务循环
- `packages/cli/src/lib/content-recommender.js` — TF-IDF 工具相似度 + 工具链推荐
- `packages/cli/src/lib/hook-manager.js` — Hook 管道（PreToolUse/PostToolUse/ToolError）
- `packages/cli/src/lib/slot-filler.js` — SlotFiller 参数槽填充（意图检测 + 交互式补全）
- `packages/cli/src/lib/agent-core.js` — Agent 核心业务逻辑（agentLoop 异步生成器）
- `packages/cli/src/runtime/bootstrap.js` — 7 阶段无头启动

## 安全考虑

- `run_shell` 工具可执行任意 Shell 命令，请在可信环境中使用
- `run_code` 工具可执行 Python/Node.js/Bash 脚本，代码在临时文件中执行并自动清理
- `write_file` / `edit_file` 可修改文件系统，建议在 Git 仓库中使用以便回滚
- Plan Mode 默认只读，需用户审批后才执行写操作
- API Key 仅存储在本地，不会通过工具调用泄露
- Context Engineering 注入的记忆/笔记仅在本地处理，不泄露到外部

## 配置参考

### Agent REPL 选项

```javascript
// packages/cli/src/repl/agent-repl.js
{
  provider: "ollama",              // ollama | anthropic | openai | deepseek |
                                   // dashscope | mistral | gemini | volcengine
  model: "qwen2.5:7b",            // 模型名称
  baseUrl: "http://localhost:11434", // API 基础 URL
  apiKey: null,                    // API 密钥（云端提供商必填）
  sessionId: null,                 // 恢复指定会话 ID
  noRecallMemory: false,           // 禁用启动时记忆召回
  recallLimit: 5,                  // 启动时注入的记忆条数上限
  noStream: false,                 // 禁用流式输出渲染
  noParkOnExit: false,             // 退出时关闭而非 park 会话
  agentId: null,                   // 限定记忆召回范围的 agent ID
}
```

### Context Engineering 选项

```javascript
// packages/cli/src/lib/cli-context-engineering.js
{
  enableInstinct: true,            // 注入用户偏好（Instinct）
  enableMemory: true,              // 注入层次化记忆（top-5 相关记忆）
  enableBm25Notes: true,           // 注入 BM25 笔记搜索结果
  bm25TopK: 3,                     // BM25 返回结果数
  bm25Threshold: 0.5,              // BM25 相关性阈值
  enableTaskReminder: true,        // 注入任务目标提醒
  enablePermanentMemory: true,     // 注入跨会话持久记忆
  enableCompactionSummary: true,   // 注入压缩摘要
  compactKeepCount: 6,             // 智能压缩保留的消息对数
}
```

### Hook 管道选项

```javascript
// packages/cli/src/lib/hook-manager.js
// 通过 chainlesschain hook add 注册
{
  event: "PreToolUse",             // PreToolUse | PostToolUse | ToolError |
                                   // SessionStart | UserPromptSubmit | SessionEnd
  command: "node my-hook.js",      // 钩子命令
  priority: 0,                     // 执行优先级（数值越小越先执行）
  timeout: 5000,                   // 超时时间（ms）
}
```

### Plan Mode 选项

```javascript
// packages/cli/src/lib/plan-mode.js
{
  autoEnter: false,                // 是否在复杂任务时自动进入规划模式
  readOnlyTools: [                 // 规划阶段允许使用的只读工具
    "read_file", "search_files", "list_dir"
  ],
  requireApproval: true,           // 执行前必须用户审批
  enableDagExecution: true,        // 按 DAG 依赖拓扑顺序执行步骤
  enableRiskAssessment: true,      // 执行前显示风险评估报告
}
```

### 自主模式选项

```javascript
// packages/cli/src/lib/autonomous-agent.js
{
  tokenBudget: 50000,              // 单目标最大 token 消耗
  maxSubtasks: 20,                 // 子任务数量上限
  autoRetry: true,                 // 工具失败时自动重试
  retryLimit: 3,                   // 单工具最大重试次数
}
```

## 性能指标

### 启动与初始化

| 指标 | 数值 | 说明 |
|------|------|------|
| 7 阶段无头启动（`bootstrap.js`） | ~200ms | DB 初始化 + 配置加载 + 技能注册 |
| Context Engineering 首次初始化 | ~50ms | BM25 索引加载 + 记忆模型预热 |
| 环境检测（`getEnvironmentInfo`） | ~30ms | 检测 Python/Node/Git，结果缓存 |
| 138 个技能元数据加载（stub） | ~15ms | 仅加载 YAML frontmatter，body 按需读取 |

### 工具执行性能

| 工具 | 典型延迟 | 备注 |
|------|---------|------|
| `read_file` | < 5ms | 本地文件读取 |
| `write_file` / `edit_file` | < 10ms | 含 fsync |
| `edit_file_hashed` | < 5ms | 哈希锚定，无需全文扫描 |
| `search_files` | 10–200ms | 取决于代码库大小 |
| `run_shell` | 视命令而定 | 超时 60s，输出截断 30KB |
| `run_code` (Python/Node) | 500ms–5s | 含解释器启动开销 |
| `run_code` + auto pip-install | +5–15s | 含 `pip install` 耗时 |
| `web_fetch` | 500ms–3s | 含 DNS + TCP + 页面抓取 |
| `spawn_sub_agent` | 200ms+ | 独立上下文初始化 |

### Context Engineering 注入开销

| 注入器 | 典型延迟 | 说明 |
|--------|---------|------|
| Instinct | < 2ms | 内存读取，已缓存 |
| Memory（层次化记忆） | 5–20ms | BM25 + 向量相关性搜索 |
| BM25 Notes | 10–30ms | topK=3，threshold=0.5 |
| Task Reminder | < 1ms | 内存字段拼接 |
| Permanent Memory | 5–15ms | MEMORY.md + Daily Notes 读取 |
| Compaction Summary | < 1ms | 内存字段拼接 |
| **6 维合计** | **20–70ms** | KV-Cache 稳定前缀可复用 |

### 智能压缩效果

| 指标 | 数值 |
|------|------|
| 压缩率 | 0.76–0.93 |
| 节省 token | 7–24% |
| 压缩触发阈值 | 消息数 ≥ 12 |
| 保留消息对数（默认） | 6 对 |

## 测试覆盖率

### 单元测试

```
✅ agent-core.test.js               - 66 测试  (agentLoop / executeTool / chatWithTools)
✅ hashline.test.js                  - 29 测试  (hashLine / annotateLines / findByHash / replaceByHash)
✅ agent-core-edit-hashed.test.js    - 12 测试  (edit_file_hashed handler)
✅ slot-filler.test.js               - 18 测试  (intent detection / slot filling / interaction)
✅ plan-mode.test.js                 - 22 测试  (DAG 执行 / 风险评估 / 审批流)
✅ autonomous-agent.test.js          - 20 测试  (ReAct 循环 / 目标分解 / 自动重试)
✅ context-engineering.test.js       - 24 测试  (6 维注入 / 智能压缩 / 优雅降级)
✅ session-hooks.test.js             - 15 测试  (SessionStart / UserPromptSubmit / SessionEnd)
✅ skill-mcp.test.js                 - 26 测试  (SKILL.md inline MCP / mount / unmount)
```

### 集成测试

```
✅ agent-repl-integration.test.js    - 18 测试  (完整 REPL 生命周期 + 会话恢复)
✅ run-code-integration.test.js      - 16 测试  (Python / Node / Bash 执行 + auto pip-install)
✅ context-engineering-e2e.test.js   - 12 测试  (6 维注入 × 有 DB / 无 DB 场景)
```

### 验证结果（v5.0.2.10）

| 验证项 | 结果 |
|--------|------|
| `agent-core` 定向单测 | ✅ 66/66 |
| `hashline` 单测 | ✅ 29/29 |
| `edit_file_hashed` 单测 | ✅ 12/12 |
| `slot-filler` 单测 | ✅ 18/18 |
| `plan-mode` 单测 | ✅ 22/22 |
| `session-hooks` 单测 | ✅ 15/15 |
| `skill-mcp` 单测 | ✅ 26/26 |
| Agent REPL 集成 | ✅ 18/18 |
| `run-code` 集成 | ✅ 16/16 |
| CLI 本轮定向合计 | ✅ 222/222 |

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 工具调用失败 | 检查当前目录的文件权限 |
| Plan Mode 不生效 | 输入 `/plan` 手动进入规划模式 |
| 代理响应过慢 | 切换到更快的模型（如 `qwen2.5:7b`）或使用云端 API |
| `run_shell` 权限不足 | 检查当前用户的 Shell 执行权限 |
| Context 注入无效果 | 检查 DB 是否初始化（`chainlesschain db init`） |
| `--session` 恢复失败 | 确认 Session ID 存在（`chainlesschain session list`） |
| 记忆/笔记未注入 | 使用 `/stats` 检查 DB 连接和索引状态 |
| `/auto` 无响应 | 检查 LLM 连接和 Token 预算 |
| Hook 执行失败 | 使用 `chainlesschain hook stats` 检查钩子状态 |

## 相关文档

- [LLM 中转站与自定义接入](./cli-llm-proxy) — 中转站、代理、自建网关完整指南
- [技能系统](./cli-skill) — 138 个内置技能
- [Plan Mode](./plan-mode) — 桌面端 Plan Mode 详情
- [AI 对话](./cli-chat) — 基础对话功能
- [会话管理](./cli-session) — 代理会话持久化
- [层次化记忆](./cli-hmemory) — 四层记忆系统
- [Instinct 学习](./cli-instinct) — 用户偏好学习
