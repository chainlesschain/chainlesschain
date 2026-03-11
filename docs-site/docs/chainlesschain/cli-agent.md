# 代理模式 (agent)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🤖 **Claude Code 风格**: 代理式 AI 会话，自主完成任务
- 🔧 **8 个内置工具**: 读写文件、执行命令、搜索代码库
- 🎯 **138 个技能**: 集成全部内置技能
- 📋 **Plan Mode**: AI 制定计划，用户审批后执行
- 💾 **会话持久化**: 自动保存，支持断点恢复

## 系统架构

```
agent 命令 → agent.js (Commander) → agent-repl.js
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
               工具系统              Plan Mode           会话管理
            (8 built-in tools)    (plan-mode.js)    (session-manager)
                    │                    │                    │
                    ▼                    ▼                    ▼
          read/write/edit/shell   只读→计划→审批→执行   自动保存到 SQLite
          search/list/skill                              断点恢复
```

## 概述

启动 Claude Code 风格的代理式 AI 会话。AI 可读写文件、执行命令、搜索代码库、调用 138 个内置技能。

## 命令参考

```bash
chainlesschain agent                    # 默认: Ollama qwen2:7b
chainlesschain a --model llama3         # 短别名
chainlesschain agent --provider openai --api-key sk-...
```

> `agent` 命令的短别名为 `a`，两者完全等价。

## 内置工具

代理模式提供 8 个内置工具：

| 工具           | 说明                 |
| -------------- | -------------------- |
| `read_file`    | 读取文件内容         |
| `write_file`   | 写入文件             |
| `edit_file`    | 编辑文件（查找替换） |
| `run_shell`    | 执行 Shell 命令      |
| `search_files` | 搜索文件内容         |
| `list_dir`     | 列出目录内容         |
| `run_skill`    | 运行内置技能         |
| `list_skills`  | 列出可用技能         |

## Plan Mode

代理模式内置 Plan Mode（规划模式），让 AI 在执行复杂任务前先制定计划并获得用户审批。

### 斜杠命令

| 命令             | 说明                         |
| ---------------- | ---------------------------- |
| `/plan`          | 进入规划模式                 |
| `/plan show`     | 查看当前计划                 |
| `/plan approve`  | 批准计划并开始执行           |
| `/plan reject`   | 拒绝计划，重新规划           |
| `/plan exit`     | 退出规划模式                 |

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
4. 更新受保护路��
5. 移除 session 依赖
6. 添加单元测试

> /plan approve
✅ 开始执行计划...
```

## 使用示例

```
> 帮我重构 src/utils/helper.js，提取公共方法

🤖 我来分析这个文件...
[调用 read_file: src/utils/helper.js]
[调用 edit_file: 提取公共方法到 src/utils/common.js]
[调用 run_skill: code-review 检查重构质量]

已完成重构，提取了 3 个公共方法到 common.js。
```

## 关键文件

- `packages/cli/src/commands/agent.js` — 命令入口
- `packages/cli/src/repl/agent-repl.js` — 代理 REPL（8 工具 + 138 技能 + Plan Mode）
- `packages/cli/src/lib/plan-mode.js` — Plan Mode 实现

## 安全考虑

- `run_shell` 工具可执行任意 Shell 命令，请在可信环境中使用
- `write_file` / `edit_file` 可修改文件系统，建议在 Git 仓库中使用以便回滚
- Plan Mode 默认只读，需用户审批后才执行写操作
- API Key 仅存储在本地，不会通过工具调用泄露

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 工具调用失败 | 检查当前目录的文件权限 |
| Plan Mode 不生效 | 输入 `/plan` 手动进入规划模式 |
| 代理响应过慢 | 切换到更快的模型（如 `qwen2:7b`）或使用云端 API |
| `run_shell` 权限不足 | 检查当前用户的 Shell 执行权限 |

## 相关文档

- [技能系统](./cli-skill) — 138 个内置技能
- [Plan Mode](./plan-mode) — 桌面端 Plan Mode 详情
- [AI 对话](./cli-chat) — 基础对话功能
- [会话管理](./cli-session) — 代理会话持久化
