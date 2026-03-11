# 代理模式 (agent)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

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
