# 多智能体协作 (cowork)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🤝 **多视角辩论审查**: 多个 AI Agent 从不同角度审查代码，汇总最终裁决
- ⚖️ **A/B 方案对比**: 生成多个解决方案变体，按标准评分排名
- 📊 **代码分析**: 静态代码知识图谱、架构决策提取、项目风格分析
- 🔌 **多 LLM 支持**: Ollama / Anthropic / OpenAI / DeepSeek / DashScope / Gemini / Mistral
- 📄 **JSON 输出**: 支持脚本集成和 CI/CD 流水线

## 系统架构

```
cowork 命令 → cowork.js (Commander)
                    │
     ┌──────────────┼──────────────┬──────────────┐
     ▼              ▼              ▼              ▼
  debate         compare       analyze        status
     │              │              │
     ▼              ▼              ▼
cowork-adapter.js  (LLM 适配层)
     │              │              │
     ▼              ▼              ▼
debate-review   ab-comparator  code-knowledge-graph
 -cli.js         -cli.js        -cli.js
                               decision-kb-cli.js
                               project-style-analyzer-cli.js
```

## 概述

CLI Phase 102 — 将桌面版 Cowork 多智能体协作核心模块移植到 CLI，支持多视角代码辩论审查、A/B 方案对比和代码分析。

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

- `knowledge-graph` 分析完全离线，不发送任何数据到外部
- 使用 Ollama 本地模型时所有分析数据不离开设备
- 使用云端提供商时代码会发送到对应 API
- API Key 存储在 `~/.chainlesschain/config.json`

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

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `debate` 报 LLM 连接失败 | 确认 Ollama 已启动或提供有效的 API Key |
| `analyze` 返回空结果 | 确认目标路径包含代码文件（.js/.ts/.py） |
| `compare` 变体内容相似 | 尝试增加 `--variants` 数量或使用更强的模型 |
| JSON 解析错误 | 部分 LLM 可能返回格式不标准的 JSON，尝试更换模型 |

## 关键文件

- `packages/cli/src/commands/cowork.js` — cowork 命令实现
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
