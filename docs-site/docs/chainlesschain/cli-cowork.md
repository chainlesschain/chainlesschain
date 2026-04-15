# 多智能体协作 (cowork)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🤝 **多视角辩论审查**: 多个 AI Agent 从不同角度审查代码，汇总最终裁决
- ⚖️ **A/B 方案对比**: 生成多个解决方案变体，按标准评分排名
- 📊 **代码分析**: 静态代码知识图谱、架构决策提取、项目风格分析
- ⏰ **定时调度 (v0.46.0)**: 5 字段 cron 持久化调度循环任务
- 🔗 **DAG 工作流 (v0.46.0)**: 多任务依赖、批次并行、占位符、失败降级
- 📦 **签名分享 (v0.46.0)**: SHA-256 校验的模板/结果包，可 P2P/邮件传输
- 🧠 **历史学习 (v0.46.0)**: 基于 token 重叠 + 成功率的模板推荐与失败归因
- 🔌 **多 LLM 支持**: Ollama / Anthropic / OpenAI / DeepSeek / DashScope / Gemini / Mistral
- 📄 **JSON 输出**: 支持脚本集成和 CI/CD 流水线

## 系统架构

```
cowork 命令 → cowork.js (Commander)
                    │
   ┌────────┬───────┼───────┬────────┬────────┬──────┬──────┐
   ▼        ▼       ▼       ▼        ▼        ▼      ▼      ▼
 debate  compare analyze  cron    workflow learning share  status
   │        │       │       │        │        │       │
   ▼        ▼       ▼       ▼        ▼        ▼       ▼
  cowork-adapter.js (LLM 适配层 — debate/compare/analyze)
   │        │       │
   ▼        ▼       ▼
debate-r. ab-comp. code-kg/decision-kb/project-style
                    │
                    ▼
              v0.46.0 新模块
        cowork-cron.js      (F4 调度器，5 字段 POSIX cron + JSONL 持久化)
        cowork-workflow.js  (F7 DAG 编排，批次并行 + 占位符 + 失败降级)
        cowork-learning.js  (F9 只读历史学习，token 重叠 × successRate)
        cowork-share.js     (F8 canonical-JSON + SHA-256 包)
        cowork-template-marketplace.js (F3 本地模板市场)
        cowork-task-runner.js / -templates.js (F1-F2 日常任务 10 模板)
```

## 概述

CLI 版 Cowork — 覆盖「代码审查（debate）→ 方案对比（compare）→ 静态分析（analyze）→ 日常任务（templates）→ 定时调度（cron）→ 工作流（workflow）→ 历史学习（learning）→ P2P 分享（share）」完整闭环。所有子命令均为 headless，不依赖桌面 GUI，适合 CI/CD、服务器、容器化环境。v0.46.0（2026-04-15）把 F1–F9 九项演进全部落地。

## 命令参考

```bash
# 多视角辩论审查
chainlesschain cowork debate <file-or-topic>
chainlesschain cowork debate src/index.js --perspectives perf,security,maintain
chainlesschain cowork debate "React vs Vue" --provider openai --model gpt-4 --json

# A/B 方案对比
chainlesschain cowork compare <prompt>
chainlesschain cowork compare "实现用户认证" --variants 3 --criteria quality,performance
chainlesschain cowork compare "设计缓存策略" --provider anthropic --json

# 代码分析
chainlesschain cowork analyze <path>
chainlesschain cowork analyze ./src --type knowledge-graph
chainlesschain cowork analyze ./src --type style --provider ollama
chainlesschain cowork analyze ./docs --type decisions --json

# 查看状态
chainlesschain cowork status
```

## 子命令说明

### debate — 多视角辩论审查

多个 AI Agent 从不同专业角度独立审查代码或话题，最后由"裁判"Agent 综合各方意见生成最终裁决。

```bash
chainlesschain cowork debate <file-or-topic> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--perspectives <list>` | 审查视角（逗号分隔） | `performance,security,maintainability` |
| `--provider <name>` | LLM 提供商 | `ollama` |
| `--model <name>` | 模型名称 | 提供商默认 |
| `--json` | JSON 格式输出 | — |

**内置 5 种审查视角**：

| 视角 | 关注点 |
|------|--------|
| `performance` | 性能瓶颈、复杂度、资源使用 |
| `security` | 安全漏洞、输入验证、数据保护 |
| `maintainability` | 代码可读性、模块化、文档 |
| `correctness` | 逻辑正确性、边界情况、错误处理 |
| `architecture` | 设计模式、耦合度、可扩展性 |

**输出结构**：

```json
{
  "target": "src/index.js",
  "perspectives": ["performance", "security", "maintainability"],
  "reviews": [
    {
      "perspective": "performance",
      "analysis": "...",
      "issues": [...],
      "score": 7
    }
  ],
  "verdict": "APPROVE",
  "consensusScore": 0.85,
  "summary": "..."
}
```

裁决结果：`APPROVE` / `NEEDS_WORK` / `REJECT`

### compare — A/B 方案对比

多个 AI Agent 使用不同的风格配置文件独立生成解决方案，然后由"评委"Agent 按标准打分排名。

```bash
chainlesschain cowork compare <prompt> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--variants <n>` | 生成变体数量 | `3` |
| `--criteria <list>` | 评判标准（逗号分隔） | `quality,performance,simplicity` |
| `--provider <name>` | LLM 提供商 | `ollama` |
| `--model <name>` | 模型名称 | 提供商默认 |
| `--json` | JSON 格式输出 | — |

**4 种变体风格**：

| 风格 | 特点 |
|------|------|
| `conservative` | 稳定可靠、经过验证的方案 |
| `innovative` | 创新前沿、实验性方案 |
| `pragmatic` | 实用平衡、快速交付 |
| `performance-focused` | 性能优先、极致优化 |

**输出结构**：

```json
{
  "prompt": "实现用户认证",
  "criteria": ["quality", "performance", "simplicity"],
  "variants": [
    {
      "profile": "conservative",
      "solution": "...",
      "scores": { "quality": 8, "performance": 7, "simplicity": 9 },
      "totalScore": 24
    }
  ],
  "ranking": [...],
  "winner": "pragmatic",
  "reason": "..."
}
```

### analyze — 代码分析

三种分析模式，其中 `knowledge-graph` 无需 LLM（纯静态分析）。

```bash
chainlesschain cowork analyze <path> [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--type <type>` | 分析类型 | `knowledge-graph` |
| `--provider <name>` | LLM 提供商（style/decisions 需要） | `ollama` |
| `--model <name>` | 模型名称 | 提供商默认 |
| `--json` | JSON 格式输出 | — |

**分析类型**：

| 类型 | 说明 | 需要 LLM |
|------|------|----------|
| `knowledge-graph` | 代码知识图谱：提取 imports/exports/classes/functions，构建依赖关系图 | 否 |
| `style` | 项目风格分析：编码约定、命名规范、架构模式 | 是 |
| `decisions` | 架构决策提取：从文档和配置中提取 ADR（Architecture Decision Records） | 是 |

**knowledge-graph 输出**：

```json
{
  "stats": { "fileCount": 15, "defCount": 42, "importCount": 78, "exportCount": 35 },
  "entities": [
    { "name": "MyClass", "type": "class", "file": "src/index.js", "language": "js" }
  ],
  "relationships": [
    { "from": "src/index.js", "type": "imports", "to": "fs" }
  ],
  "summary": "Code Knowledge Graph\nFiles analyzed: 15\nEntities: 42\n..."
}
```

### status — 查看协作状态

显示 cowork 模块可用性和使用说明。

```bash
chainlesschain cowork status
```

## Agent REPL 集成

在 `chainlesschain agent` 会话中可使用 `/cowork` 斜杠命令：

```
> /cowork debate src/main.js
> /cowork compare "设计一个缓存系统"
```

## LLM 提供商配置

cowork 命令默认使用 CLI 配置中的 LLM 设置，也可通过 `--provider` 和 `--model` 覆盖。

支持的提供商：

| 提供商 | 协议 | 说明 |
|--------|------|------|
| `ollama` | 原生 API | 本地运行，数据不出设备 |
| `anthropic` | Anthropic API | Claude 系列（支持 system 消息提取） |
| `openai` | OpenAI 兼容 | GPT 系列 |
| `deepseek` | OpenAI 兼容 | DeepSeek 系列 |
| `dashscope` | OpenAI 兼容 | 通义千问系列 |
| `gemini` | OpenAI 兼容 | Google Gemini 系列 |
| `mistral` | OpenAI 兼容 | Mistral 系列 |

## 安全考虑

- `knowledge-graph` / `analyze --type knowledge-graph` 完全离线，不发送任何数据到外部
- 使用 Ollama 本地模型时所有分析数据不离开设备
- 使用云端提供商时代码会发送到对应 API
- API Key 存储在 `~/.chainlesschain/config.json`
- **v0.46.0 新增**：
  - `cowork share` 包体使用 canonical-JSON + SHA-256 校验，**防数据损坏但不防身份伪造** — 导入他人包体前请人工确认来源；未来可升级 DID 签名（见设计文档 N4）
  - `cowork workflow run` 透传 shell 策略 — `web-research` / `network-tools` 模板声明 `shellPolicyOverrides: ["network-download"]`，其他模板仍受 DENY 保护
  - `cowork learning` 仅读 `.chainlesschain/cowork/history.jsonl`，不上传；冷启动模板最低权重 0.5 防被新模板饿死
  - `cowork cron run` 前台运行，Ctrl-C 停止；任务继承当前 shell 环境变量，不建议在有敏感环境变量的 shell 中启动

## 使用示例

### 场景 1：多视角辩论审查代码

```bash
chainlesschain cowork debate src/auth/login.js --perspectives security,correctness,performance
chainlesschain cowork debate src/auth/login.js --json > review-result.json
```

从安全性、正确性和性能三个角度审查登录模块，输出 JSON 便于集成到 CI 流水线。

### 场景 2：A/B 方案对比

```bash
chainlesschain cowork compare "设计一个分布式缓存系统" --variants 3 --criteria quality,performance,simplicity
```

生成 3 种不同风格的解决方案（保守、创新、务实），按质量、性能和简洁性打分排名，辅助技术选型。

### 场景 3：静态代码分析

```bash
chainlesschain cowork analyze ./src --type knowledge-graph
chainlesschain cowork analyze ./src --type style --provider ollama
```

先用无需 LLM 的知识图谱分析提取代码结构和依赖关系，再用 LLM 分析项目编码风格和约定。

### 场景 4：定时 + DAG + 学习闭环 (v0.46.0)

```bash
# 1) 每天 9:00 抓取并汇总 RSS
chainlesschain cowork cron add "0 9 * * *" --message "fetch tech news"

# 2) 写一个两步 DAG：先研究，再写报告（上游结果注入下游）
cat > pipeline.json <<'JSON'
{
  "id": "daily-brief",
  "name": "Daily Brief",
  "steps": [
    { "id": "fetch", "message": "find top 5 React news today" },
    { "id": "sum",   "message": "summarize: ${step.fetch.summary}", "dependsOn": ["fetch"] }
  ]
}
JSON
chainlesschain cowork workflow add pipeline.json
chainlesschain cowork workflow run daily-brief

# 3) 积累 10+ 次历史后查看哪些模板最好用
chainlesschain cowork learning stats
chainlesschain cowork learning recommend "write weekly report"
chainlesschain cowork learning failures

# 4) 把最爱用的模板导出分享
chainlesschain cowork share export-template writer --out writer.pkt.json --author me
chainlesschain cowork share verify writer.pkt.json
```

### 场景 5：Android 远程协作 (v0.46.0)

在移动端 `/pc-cowork-daily` 或 `/pc-cowork-workflow` 技能通过 P2P 路由到桌面 CLI，手机侧不需要本地 LLM，所有算力在桌面执行。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `debate` 报 LLM 连接失败 | 确认 Ollama 已启动或提供有效的 API Key |
| `analyze` 返回空结果 | 确认目标路径包含代码文件（.js/.ts/.py） |
| `compare` 变体内容相似 | 尝试增加 `--variants` 数量或使用更强的模型 |
| JSON 解析错误 | 部分 LLM 可能返回格式不标准的 JSON，尝试更换模型 |
| `cron add` 报 `bogus` | `validateCron(expr)` 返回字符串即错误描述；只接受 5 字段 POSIX，别名（`@daily`）见设计文档 N5 |
| `workflow run` 卡在某一步 | 检查 `${step.<id>.summary}` 占位符对应的上游 `id` 是否存在；添加 `--continue-on-error` 跳过失败步 |
| `share import` 报 `Invalid packet: checksum mismatch` | 包体在传输中被改过；让发送方用 `cowork share export-*` 重新生成 |
| `learning recommend` 返回 null | `history.jsonl` 里没有与消息 token 重叠的成功任务；先积累一些历史再推荐 |
| `learning stats` 空列表 | 先跑 `cowork` 日常任务产生 history，或手动导入 `shared-results/*.json` |

## v0.46.0 — Cowork Evolution 演进特性

v0.46.0 在既有 debate / compare / analyze 之外新增了 5 组 headless 子命令，覆盖「日常任务 → 历史 → 学习 → 工作流 → 分享 → 定时」闭环：

### cowork cron — 定时任务调度 (F6)

5 字段 POSIX cron 表达式 + OR 语义，持久化到 `.chainlesschain/cowork/schedules.jsonl`。

```bash
chainlesschain cowork cron list
chainlesschain cowork cron add "*/15 * * * *" --message "check status" --files logs/
chainlesschain cowork cron remove <id>
chainlesschain cowork cron enable <id>
chainlesschain cowork cron disable <id>
chainlesschain cowork cron run                  # 前台启动调度器，Ctrl-C 停止
```

表达式用 `parseCron()` 解析，支持 `*`、`a,b,c`、`a-b`、`*/n`；`dow` 字段的 `0` 和 `7` 都表示周日。`validateCron(expr)` 返回 `null` 表示合法，否则返回错误描述字符串。

### cowork workflow — DAG 工作流 (F7)

把多个 Cowork 任务连成 DAG，带批次并行、依赖解析、占位符替换、失败降级。

```bash
chainlesschain cowork workflow add my-pipeline.json
chainlesschain cowork workflow list [--json]
chainlesschain cowork workflow show <id>
chainlesschain cowork workflow run  <id> [--continue-on-error] [--max-parallel 4]
chainlesschain cowork workflow remove <id>
```

`my-pipeline.json` 示例：

```json
{
  "id": "fetch-and-summarize",
  "name": "抓取并汇总",
  "steps": [
    { "id": "fetch", "message": "find items" },
    { "id": "sum",   "message": "summarize: ${step.fetch.summary}", "dependsOn": ["fetch"] }
  ]
}
```

占位符格式：`${step.<id>.summary|status|taskId|tokenCount|iterationCount}`。单次执行会把审计日志追加到 `.chainlesschain/cowork/workflow-history.jsonl`。

### cowork share — P2P 分享数据包 (F8)

导出/导入可校验的 Cowork 模板或任务结果包。包体用规范化 JSON + SHA-256 校验和保证传输完整性。

```bash
chainlesschain cowork share export-template <id> --out tpl.pkt.json --author alice
chainlesschain cowork share export-result   <taskId> --out res.pkt.json
chainlesschain cowork share verify          tpl.pkt.json
chainlesschain cowork share import          tpl.pkt.json    # 自动识别 template / result
```

- **template 包** → 写入本地模板市场（与 `cowork-template-marketplace.js` 同路径）
- **result 包** → 写入 `.chainlesschain/cowork/shared-results/<taskId>.json`
- 校验失败直接抛错并非零退出，适合 P2P / 邮件 / 文件传输后再导入的场景

### cowork learning — 历史学习 (F9)

从 `.chainlesschain/cowork/history.jsonl` 读取所有任务记录，做 ML-less 的模板推荐、统计与失败归因。

```bash
chainlesschain cowork learning stats [--json]              # 按模板的聚合统计
chainlesschain cowork learning recommend <message...> [--min-runs 1] [--json]
chainlesschain cowork learning failures [--limit 3] [--json]
```

- **stats**: `runs / successes / failures / successRate / avgTokens / avgIterations / topTools`
- **recommend**: token 重叠分数 × successRate，支持 CJK + 英文分词；`confidence` 来自样本量
- **failures**: 按模板分组的失败计数，自动归并高频 summary

### Android 远程调用 (F5)

两个新的 REMOTE SKILL 可以把 Cowork 协作能力跨设备调用到手机：

- `pc-cowork-daily` → 桌面的 `cowork-daily`
- `pc-cowork-workflow` → 桌面的 `cowork-workflow`

REMOTE 技能通过 `remoteSkillProvider` 走 P2P 调用桌面，手机上不需要本地 LLM。

## 关键文件

- `packages/cli/src/commands/cowork.js` — cowork 命令实现（含 learning/workflow/share/cron 子树）
- `packages/cli/src/lib/cowork-learning.js` — 历史学习（F9）
- `packages/cli/src/lib/cowork-workflow.js` — DAG 工作流（F7）
- `packages/cli/src/lib/cowork-share.js` — 签名数据包（F8）
- `packages/cli/src/lib/cowork-cron.js` — 定时调度（F6）
- `packages/cli/src/lib/cowork-task-runner.js` — 日常任务运行器（F1-F4）
- `packages/cli/src/lib/cowork-task-templates.js` — 内置 10 模板 + 用户模板
- `packages/cli/src/lib/cowork-template-marketplace.js` — 模板市场
- `packages/cli/src/lib/cowork-adapter.js` — LLM 适配层（createChatFn）
- `packages/cli/src/lib/cowork/debate-review-cli.js` — 多视角辩论审查
- `packages/cli/src/lib/cowork/ab-comparator-cli.js` — A/B 方案对比
- `packages/cli/src/lib/cowork/code-knowledge-graph-cli.js` — 代码知识图谱（无需 LLM）
- `packages/cli/src/lib/cowork/decision-kb-cli.js` — 架构决策提取
- `packages/cli/src/lib/cowork/project-style-analyzer-cli.js` — 项目风格分析

## 相关文档

- [技能系统 (skill)](./cli-skill) — 4 层优先级技能管理
- [项目初始化 (init)](./cli-init) — 项目结构初始化
- [代理模式 (agent)](./cli-agent) — Agent REPL 中使用 /cowork
- [Cowork 多智能体协作](/chainlesschain/cowork) — 桌面端完整 Cowork 系统
- [Web Cowork 日常任务协作](/chainlesschain/web-cowork) — Web 面板版的同套模板
- [Cowork 演进路线图](/chainlesschain/cowork-roadmap) — F1–F9 历史规划与 v0.46.0 之后的 N1–N7 未来演进
- [设计文档 — 86-web-cowork](/design/modules/86-web-cowork) — 完整架构、实施记录、未来演进（N1–N7）
