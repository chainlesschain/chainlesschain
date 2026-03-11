# 技能系统 (skill)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🎯 **138 个内置技能**: 覆盖开发全流程
- 📂 **24 个分类**: 从代码审查到安全分析
- 🔍 **技能搜索**: 按关键词、标签、分类查找
- ▶️ **直接运行**: 命令行一键执行技能
- 📊 **JSON 输出**: 支持脚本集成

## 系统架构

```
skill 命令 → skill.js (Commander) → agent-repl.js
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              skill list/search     skill info          skill run
                    │                    │                    │
                    ▼                    ▼                    ▼
              内置技能定义库       技能元数据+文档     LLM + 技能 Prompt
              (138 skills.md)                         执行并返回结果
```

## 概述

管理和运行 138 个内置 AI 技能，涵盖代码审查、文档生成、测试、安全分析等 24 个分类。

## 命令参考

```bash
chainlesschain skill list               # 按分类列出所有技能
chainlesschain skill list --category automation
chainlesschain skill list --tag code --runnable
chainlesschain skill list --json        # JSON格式输出
chainlesschain skill categories         # 查看分类统计
chainlesschain skill info code-review   # 查看技能详情+文档
chainlesschain skill info code-review --json
chainlesschain skill search "browser"   # 按关键词搜索
chainlesschain skill run code-review "Review this code..."
```

## 子命令说明

### list

按分类列出所有技能，支持筛选。

```bash
chainlesschain skill list                       # 全部技能
chainlesschain skill list --category automation  # 按分类筛选
chainlesschain skill list --tag code --runnable  # 按标签筛选，仅显示可运行的
chainlesschain skill list --json                 # JSON格式输出
```

### categories

查看技能分类统计。

```bash
chainlesschain skill categories
```

### info

查看指定技能的详细信息和文档。

```bash
chainlesschain skill info code-review
chainlesschain skill info code-review --json
```

### search

按关键词搜索技能。

```bash
chainlesschain skill search "browser"
chainlesschain skill search "security"
```

### run

直接运行指定技能。

```bash
chainlesschain skill run code-review "Review this code..."
chainlesschain skill run summarize "Summarize this article..."
```

## 技能分类（24类）

ai, analysis, automation, code-review, data, database, debugging, design, development (41个), devops, document, documentation, general, knowledge, learning, media, productivity, quality, remote, security, system, testing, utility, workflow

## 关键文件

- `packages/cli/src/commands/skill.js` — 命令实现
- `packages/cli/src/repl/agent-repl.js` — 技能运行引擎
- `desktop-app-vue/src/main/ai-engine/cowork/skills/` — 138 个技能定义文件

## 安全考虑

- 技能执行在 FileSandbox 沙箱内运行，限制文件访问范围
- `run` 命令默认使用本地 Ollama，不会将代码发送到外部
- 使用 `--provider openai` 时代码会发送到 OpenAI API

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `run` 报 LLM 连接失败 | 确认 Ollama 已启动或提供有效的 API Key |
| `list` 显示 0 技能 | 技能从内置定义加载，检查 CLI 安装完整性 |
| 技能执行结果为空 | 检查输入内容是否足够，尝试更详细的描述 |

## 相关文档

- [代理模式](./cli-agent) — 代理模式中使用技能
- [Cowork 多智能体协作](./cowork) — 桌面端技能系统详情
- [AI 对话](./cli-chat) — 基础对话功能
